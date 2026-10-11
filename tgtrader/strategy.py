import pandas as pd


def rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, float("nan"))
    out = 100 - 100 / (1 + rs)
    # no losses at all in the window -> fully overbought
    return out.fillna(100.0).where(gain.notna())


class SmaRsiStrategy:
    """Buy when the fast SMA crosses above the slow SMA (and RSI is not
    overbought); sell when it crosses back below. Long-only."""

    def __init__(self, fast: int, slow: int, rsi_period: int, rsi_max_buy: float):
        self.fast, self.slow = fast, slow
        self.rsi_period, self.rsi_max_buy = rsi_period, rsi_max_buy

    @property
    def min_candles(self) -> int:
        return max(self.slow, self.rsi_period) + 2

    def signals(self, df: pd.DataFrame) -> pd.Series:
        """Per-candle 'buy' / 'sell' / '' computed on closed candles."""
        close = df["close"]
        f = close.rolling(self.fast).mean()
        s = close.rolling(self.slow).mean()
        r = rsi(close, self.rsi_period)
        up = (f.shift(1) <= s.shift(1)) & (f > s)
        down = (f.shift(1) >= s.shift(1)) & (f < s)
        out = pd.Series("", index=df.index)
        out[up & (r < self.rsi_max_buy)] = "buy"
        out[down] = "sell"
        return out

    def signal(self, df: pd.DataFrame) -> str:
        if len(df) < self.min_candles:
            return ""
        return self.signals(df).iloc[-1]
