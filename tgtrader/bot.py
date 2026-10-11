import asyncio
import functools
from datetime import datetime, timezone

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

from .backtest import backtest
from .engine import Engine

HELP = """Commands
/status – mode, price, equity, position
/balance – account balances
/startbot – start automated trading
/stopbot – stop automated trading (keeps position)
/buy <amount> – manual market buy (quote currency, e.g. /buy 50)
/sell – sell the open position
/trades – last 10 trades
/backtest [candles] – test strategy on history (default 500)
/set <fast|slow|size|sl|tp> <value> – change parameters
/myid – show your chat id
/help"""


def authorized(fn):
    @functools.wraps(fn)
    async def wrapper(self, update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        chat = update.effective_chat.id
        if chat not in self.cfg.allowed_chat_ids:
            await update.message.reply_text("Not authorized.")
            return
        try:
            await fn(self, update, ctx)
        except Exception as e:
            await update.message.reply_text(f"⚠️ {type(e).__name__}: {e}")
    return wrapper


class TradingBot:
    def __init__(self, cfg, market, broker, strategy):
        self.cfg, self.market, self.broker, self.strategy = cfg, market, broker, strategy
        self.app = Application.builder().token(cfg.telegram_token).post_init(self._post_init).build()
        self.engine = Engine(cfg, market, broker, strategy, self.notify)
        handlers = dict(start=self.help, help=self.help, status=self.status, balance=self.balance,
                        startbot=self.startbot, stopbot=self.stopbot, buy=self.buy, sell=self.sell,
                        trades=self.trades, backtest=self.backtest, set=self.set_param)
        for name, fn in handlers.items():
            self.app.add_handler(CommandHandler(name, fn))
        self.app.add_handler(CommandHandler("myid", self.myid))

    async def _post_init(self, app):
        await self.notify(f"🤖 Bot online in {self.broker.name.upper()} mode. /help")

    async def notify(self, text: str):
        for chat in self.cfg.allowed_chat_ids:
            try:
                await self.app.bot.send_message(chat, text)
            except Exception:
                pass

    def run(self):
        self.app.run_polling()

    async def myid(self, update, ctx):
        await update.message.reply_text(f"Your chat id: {update.effective_chat.id}")

    @authorized
    async def help(self, update, ctx):
        await update.message.reply_text(HELP)

    @authorized
    async def status(self, update, ctx):
        await update.message.reply_text(await self.engine.status())

    @authorized
    async def balance(self, update, ctx):
        bal = await asyncio.to_thread(self.broker.balance)
        text = "\n".join(f"{k}: {v:.6f}" for k, v in bal.items()) or "Empty."
        await update.message.reply_text(f"[{self.broker.name}]\n{text}")

    @authorized
    async def startbot(self, update, ctx):
        ok = self.engine.start()
        await update.message.reply_text("▶️ Bot started." if ok else "Already running.")

    @authorized
    async def stopbot(self, update, ctx):
        ok = self.engine.stop()
        await update.message.reply_text("⏹ Bot stopped." if ok else "Not running.")

    @authorized
    async def buy(self, update, ctx):
        if len(ctx.args) != 1:
            await update.message.reply_text("Usage: /buy <amount in " + self.cfg.quote + ">")
            return
        amount = float(ctx.args[0])
        if amount <= 0:
            raise ValueError("amount must be positive")
        msg = await self.engine.open_position(amount, "manual")
        if not msg.startswith(("🟢",)):
            await update.message.reply_text(msg)

    @authorized
    async def sell(self, update, ctx):
        msg = await self.engine.close_position("manual")
        if not msg.startswith("🔴"):
            await update.message.reply_text(msg)

    @authorized
    async def trades(self, update, ctx):
        rows = self.engine.trades[-10:]
        if not rows:
            await update.message.reply_text("No trades yet.")
            return
        lines = []
        for t in rows:
            when = datetime.fromtimestamp(t["ts"], timezone.utc).strftime("%m-%d %H:%M")
            pnl = f" pnl {t['pnl']:+.2f}" if t.get("pnl") is not None else ""
            lines.append(f"{when} {t['side'].upper()} {t['qty']:.6f} @ {t['price']:.2f}{pnl} ({t['reason']})")
        await update.message.reply_text("\n".join(lines))

    @authorized
    async def backtest(self, update, ctx):
        n = min(int(ctx.args[0]), 1000) if ctx.args else 500
        df = await asyncio.to_thread(self.market.ohlcv, self.cfg.symbol, self.cfg.timeframe, n)
        r = backtest(df, self.strategy, self.cfg.stop_loss_pct, self.cfg.take_profit_pct)
        await update.message.reply_text(
            f"Backtest {self.cfg.symbol} {self.cfg.timeframe}, {len(df)} candles\n"
            f"Trades: {r['trades']} | Win rate: {r['win_rate']:.0f}%\n"
            f"Strategy: {r['return_pct']:+.1f}% | Buy&hold: {r['buy_hold_pct']:+.1f}%\n"
            f"Max drawdown: {r['max_drawdown_pct']:.1f}%\n"
            "Past performance does not predict future results.")

    @authorized
    async def set_param(self, update, ctx):
        if len(ctx.args) != 2:
            await update.message.reply_text("Usage: /set <fast|slow|size|sl|tp> <value>")
            return
        key, val = ctx.args[0].lower(), float(ctx.args[1])
        if val <= 0:
            raise ValueError("value must be positive")
        s, c = self.strategy, self.cfg
        if key == "fast" and val < s.slow:
            s.fast = c.fast_sma = int(val)
        elif key == "slow" and val > s.fast:
            s.slow = c.slow_sma = int(val)
        elif key == "size":
            c.trade_size_quote = val
        elif key == "sl":
            c.stop_loss_pct = val
        elif key == "tp":
            c.take_profit_pct = val
        else:
            raise ValueError("unknown key, or fast must stay below slow")
        await update.message.reply_text(f"✅ {key} = {val:g} (resets on restart; edit .env to persist)")
