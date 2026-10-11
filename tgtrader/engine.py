import asyncio
import json
import os
import time
from datetime import datetime, timezone

from .broker import Fill


class Engine:
    """Polls the market, applies the strategy and risk rules, places orders."""

    def __init__(self, cfg, market, broker, strategy, notify):
        self.cfg, self.market, self.broker = cfg, market, broker
        self.strategy, self.notify = strategy, notify
        self.running = False
        self.halted_reason = ""
        self._task = None
        self.position = None  # {"qty", "entry", "ts"}
        self.trades = []
        self.last_candle = None
        self.day = None
        self.day_start_equity = None
        self._load()

    # ---------- persistence ----------
    def _load(self):
        if os.path.exists(self.cfg.state_file):
            with open(self.cfg.state_file) as f:
                st = json.load(f)
            if st.get("mode") == self.cfg.mode:  # never mix paper/live state
                self.position = st.get("position")
                self.trades = st.get("trades", [])
                self.last_candle = st.get("last_candle")
                self.day = st.get("day")
                self.day_start_equity = st.get("day_start_equity")

    def _save(self):
        st = dict(mode=self.cfg.mode, position=self.position, trades=self.trades[-200:],
                  last_candle=self.last_candle, day=self.day,
                  day_start_equity=self.day_start_equity)
        tmp = self.cfg.state_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump(st, f)
        os.replace(tmp, self.cfg.state_file)

    # ---------- helpers ----------
    def equity(self, price: float) -> float:
        bal = self.broker.balance()
        held = self.position["qty"] if self.position else 0.0
        return bal.get(self.cfg.quote, 0.0) + held * price

    def _record(self, fill: Fill, reason: str, pnl: float = None):
        self.trades.append(dict(ts=fill.ts, side=fill.side, qty=fill.qty, price=fill.price,
                                fee=fill.fee, reason=reason, pnl=pnl))

    # ---------- trading actions ----------
    async def open_position(self, quote_amount: float, reason: str) -> str:
        if self.position:
            return "A position is already open."
        if self.halted_reason:
            return f"Trading halted: {self.halted_reason}"
        if quote_amount > self.cfg.trade_size_quote * 5:
            return "Refused: amount is more than 5x TRADE_SIZE_QUOTE."
        fill = await asyncio.to_thread(self.broker.buy, self.cfg.symbol, quote_amount)
        self.position = dict(qty=fill.qty, entry=fill.price, ts=fill.ts)
        self._record(fill, reason)
        self._save()
        msg = f"🟢 BUY {fill.qty:.6f} {self.cfg.base} @ {fill.price:.2f} ({reason}) [{self.broker.name}]"
        await self.notify(msg)
        return msg

    async def close_position(self, reason: str) -> str:
        if not self.position:
            return "No open position."
        pos = self.position
        fill = await asyncio.to_thread(self.broker.sell, self.cfg.symbol, pos["qty"])
        pnl = (fill.price - pos["entry"]) * fill.qty - fill.fee
        self.position = None
        self._record(fill, reason, pnl)
        self._save()
        msg = (f"🔴 SELL {fill.qty:.6f} {self.cfg.base} @ {fill.price:.2f} ({reason}) "
               f"PnL {pnl:+.2f} {self.cfg.quote} [{self.broker.name}]")
        await self.notify(msg)
        return msg

    # ---------- main logic ----------
    async def tick(self):
        cfg = self.cfg
        df = await asyncio.to_thread(self.market.ohlcv, cfg.symbol, cfg.timeframe, 200)
        price = float(df["close"].iloc[-1])

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self.day != today:
            self.day, self.day_start_equity, self.halted_reason = today, self.equity(price), ""
            self._save()

        if self.day_start_equity and not self.halted_reason:
            drop = (self.day_start_equity - self.equity(price)) / self.day_start_equity * 100
            if drop >= cfg.daily_loss_limit_pct:
                self.halted_reason = f"daily loss limit hit (-{drop:.1f}%)"
                await self.notify(f"⛔ Trading halted: {self.halted_reason}")
                await self.close_position("daily loss limit")
                return

        if self.position:
            chg = (price / self.position["entry"] - 1) * 100
            if chg <= -cfg.stop_loss_pct:
                await self.close_position(f"stop-loss {chg:.2f}%")
                return
            if chg >= cfg.take_profit_pct:
                await self.close_position(f"take-profit {chg:.2f}%")
                return

        closed = df.iloc[:-1]  # last candle is still forming
        if len(closed) < self.strategy.min_candles:
            return
        candle_ts = int(closed["ts"].iloc[-1])
        if candle_ts == self.last_candle:
            return
        self.last_candle = candle_ts
        self._save()

        sig = self.strategy.signal(closed)
        if sig == "buy" and not self.position and not self.halted_reason:
            await self.open_position(cfg.trade_size_quote, "signal")
        elif sig == "sell" and self.position:
            await self.close_position("signal")

    async def _loop(self):
        while self.running:
            try:
                await self.tick()
            except Exception as e:  # keep the bot alive on network/exchange errors
                await self.notify(f"⚠️ Error: {type(e).__name__}: {e}")
                await asyncio.sleep(max(self.cfg.poll_seconds, 60))
                continue
            await asyncio.sleep(self.cfg.poll_seconds)

    def start(self):
        if self.running:
            return False
        self.running = True
        self._task = asyncio.create_task(self._loop())
        return True

    def stop(self):
        if not self.running:
            return False
        self.running = False
        if self._task:
            self._task.cancel()
        return True

    async def status(self) -> str:
        price = await asyncio.to_thread(self.market.price, self.cfg.symbol)
        lines = [f"Mode: {self.broker.name.upper()} | Bot: {'RUNNING' if self.running else 'stopped'}",
                 f"{self.cfg.symbol} {self.cfg.timeframe} | price {price:.2f}",
                 f"Equity: {self.equity(price):.2f} {self.cfg.quote}"]
        if self.position:
            p = self.position
            chg = (price / p["entry"] - 1) * 100
            lines.append(f"Position: {p['qty']:.6f} {self.cfg.base} @ {p['entry']:.2f} ({chg:+.2f}%)")
        else:
            lines.append("Position: none")
        if self.halted_reason:
            lines.append(f"⛔ Halted: {self.halted_reason}")
        return "\n".join(lines)
