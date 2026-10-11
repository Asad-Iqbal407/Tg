import pandas as pd


def backtest(df: pd.DataFrame, strategy, stop_loss_pct: float, take_profit_pct: float,
             fee_rate: float = 0.001, start: float = 1000.0) -> dict:
    """Long-only, all-in simulation on closed candles.
    Signals fill at the NEXT candle's open; SL/TP are checked against candle
    low/high (stop wins if both hit in one candle)."""
    sig = strategy.signals(df)
    cash, qty, entry = start, 0.0, 0.0
    trades, equity_curve = [], []
    for i in range(len(df) - 1):
        row, nxt = df.iloc[i], df.iloc[i + 1]
        if qty:
            sl, tp = entry * (1 - stop_loss_pct / 100), entry * (1 + take_profit_pct / 100)
            exit_price = sl if nxt["low"] <= sl else tp if nxt["high"] >= tp else None
            if exit_price is None and sig.iloc[i] == "sell":
                exit_price = nxt["open"]
            if exit_price is not None:
                cash = qty * exit_price * (1 - fee_rate)
                trades.append(cash / (qty * entry) - 1)
                qty = 0.0
        elif sig.iloc[i] == "buy":
            entry = nxt["open"]
            qty = cash * (1 - fee_rate) / entry
            cash = 0.0
        equity_curve.append(cash + qty * nxt["close"])
    final = equity_curve[-1] if equity_curve else start
    peak, max_dd = start, 0.0
    for e in equity_curve:
        peak = max(peak, e)
        max_dd = max(max_dd, (peak - e) / peak)
    wins = [t for t in trades if t > 0]
    bh = df["close"].iloc[-1] / df["close"].iloc[0] - 1
    return dict(trades=len(trades), win_rate=len(wins) / len(trades) * 100 if trades else 0.0,
                return_pct=(final / start - 1) * 100, buy_hold_pct=bh * 100,
                max_drawdown_pct=max_dd * 100)
