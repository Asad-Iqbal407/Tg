import numpy as np
import pandas as pd
import pytest

from tgtrader.backtest import backtest
from tgtrader.broker import PaperBroker
from tgtrader.config import Config
from tgtrader.engine import Engine
from tgtrader.strategy import SmaRsiStrategy


def make_df(closes):
    closes = np.array(closes, dtype=float)
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="h", tz="UTC")
    return pd.DataFrame({"ts": (idx.astype("int64") // 10**6), "open": closes, "high": closes * 1.001,
                         "low": closes * 0.999, "close": closes, "volume": 1.0}, index=idx)


class FakeMarket:
    def __init__(self, closes):
        self.df, self.p = make_df(closes), float(closes[-1])

    def ohlcv(self, *a, **k):
        return self.df

    def price(self, symbol):
        return self.p


def strat():
    return SmaRsiStrategy(3, 6, 5, 70)


def cross_up_series():
    return [100] * 10 + [90, 85, 80, 78, 77, 76] + [80, 90, 100, 110, 120]


def test_buy_signal_on_cross_up():
    df = make_df(cross_up_series())
    assert "buy" in set(strat().signals(df))


def test_sell_signal_on_cross_down():
    df = make_df([100] * 10 + [110, 120, 130, 140, 150, 140, 120, 100, 80, 60])
    assert "sell" in set(strat().signals(df))


def test_paper_broker_round_trip_and_insufficient_funds():
    m = FakeMarket([100.0] * 5)
    b = PaperBroker(m, "USDT", 1000, fee_rate=0.001)
    f = b.buy("BTC/USDT", 500)
    assert f.qty == pytest.approx(4.995)
    assert b.balance()["USDT"] == pytest.approx(500)
    with pytest.raises(ValueError):
        b.buy("BTC/USDT", 600)
    b.sell("BTC/USDT", f.qty)
    assert b.balance()["USDT"] == pytest.approx(999.0, abs=0.01)  # lost only 2x fee
    with pytest.raises(ValueError):
        b.sell("BTC/USDT", 1)


def test_backtest_runs():
    r = backtest(make_df(cross_up_series() * 3), strat(), 3, 6)
    assert {"trades", "win_rate", "return_pct", "max_drawdown_pct"} <= r.keys()


async def make_engine(tmp_path, closes, **cfg_kw):
    kw = dict(fast_sma=3, slow_sma=6, rsi_period=5, trade_size_quote=100,
              state_file=str(tmp_path / "s.json"))
    cfg = Config(**{**kw, **cfg_kw})
    market = FakeMarket(closes)
    broker = PaperBroker(market, "USDT", 1000)
    msgs = []

    async def notify(t):
        msgs.append(t)
    return Engine(cfg, market, broker, strat(), notify), market, msgs


async def test_engine_stop_loss(tmp_path):
    eng, market, msgs = await make_engine(tmp_path, [100.0] * 30)
    await eng.open_position(100, "test")
    market.p = 90.0
    market.df = make_df([100.0] * 29 + [90.0])
    await eng.tick()
    assert eng.position is None
    assert any("stop-loss" in m for m in msgs)


async def test_engine_daily_loss_halts(tmp_path):
    eng, market, msgs = await make_engine(tmp_path, [100.0] * 30, stop_loss_pct=50, daily_loss_limit_pct=5,
                                         trade_size_quote=1000)
    await eng.tick()  # sets day start equity
    await eng.open_position(1000 - 1, "test")
    market.df = make_df([100.0] * 29 + [93.0])
    market.p = 93.0
    await eng.tick()
    assert eng.halted_reason and eng.position is None
    assert "halted" in (await eng.open_position(10, "x")).lower()


async def test_open_position_size_cap(tmp_path):
    eng, _, _ = await make_engine(tmp_path, [100.0] * 30)
    assert "Refused" in await eng.open_position(10_000, "manual")


async def test_state_persists(tmp_path):
    eng, _, _ = await make_engine(tmp_path, [100.0] * 30)
    await eng.open_position(100, "test")
    eng2, _, _ = await make_engine(tmp_path, [100.0] * 30)
    assert eng2.position and eng2.position["entry"] == 100.0
