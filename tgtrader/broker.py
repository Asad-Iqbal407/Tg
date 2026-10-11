import time
from dataclasses import dataclass

import pandas as pd


@dataclass
class Fill:
    side: str
    symbol: str
    qty: float
    price: float
    fee: float  # in quote currency
    ts: float


class Market:
    """Market data (and, when keys are given, order access) via ccxt."""

    def __init__(self, exchange_id: str, api_key: str = "", secret: str = ""):
        import ccxt

        params = {"enableRateLimit": True}
        if api_key:
            params.update(apiKey=api_key, secret=secret)
        self.ex = getattr(ccxt, exchange_id)(params)

    def ohlcv(self, symbol: str, timeframe: str, limit: int = 200) -> pd.DataFrame:
        rows = self.ex.fetch_ohlcv(symbol, timeframe, limit=limit)
        df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
        df.index = pd.to_datetime(df["ts"], unit="ms", utc=True)
        return df

    def price(self, symbol: str) -> float:
        return float(self.ex.fetch_ticker(symbol)["last"])


class PaperBroker:
    """Simulated account on top of real market prices. No real orders."""

    name = "paper"

    def __init__(self, market, quote: str, start_balance: float, fee_rate: float = 0.001):
        self.market, self.fee_rate = market, fee_rate
        self.balances = {quote: start_balance}

    def balance(self) -> dict:
        return {k: v for k, v in self.balances.items() if v > 1e-12}

    def buy(self, symbol: str, quote_amount: float) -> Fill:
        base, quote = symbol.split("/")
        if quote_amount > self.balances.get(quote, 0):
            raise ValueError(f"Insufficient {quote}: have {self.balances.get(quote, 0):.2f}")
        price = self.market.price(symbol)
        fee = quote_amount * self.fee_rate
        qty = (quote_amount - fee) / price
        self.balances[quote] -= quote_amount
        self.balances[base] = self.balances.get(base, 0) + qty
        return Fill("buy", symbol, qty, price, fee, time.time())

    def sell(self, symbol: str, qty: float) -> Fill:
        base, quote = symbol.split("/")
        if qty > self.balances.get(base, 0) + 1e-12:
            raise ValueError(f"Insufficient {base}")
        price = self.market.price(symbol)
        gross = qty * price
        fee = gross * self.fee_rate
        self.balances[base] = max(0.0, self.balances[base] - qty)
        self.balances[quote] = self.balances.get(quote, 0) + gross - fee
        return Fill("sell", symbol, qty, price, fee, time.time())


class LiveBroker:
    """Real market orders through ccxt. USE WITH CARE."""

    name = "live"

    def __init__(self, market: Market):
        self.market = market

    def balance(self) -> dict:
        free = self.market.ex.fetch_balance().get("free", {})
        return {k: float(v) for k, v in free.items() if v and float(v) > 0}

    def _fill(self, order: dict, side: str, symbol: str, qty: float, price: float) -> Fill:
        qty = float(order.get("filled") or qty)
        price = float(order.get("average") or order.get("price") or price)
        fee = 0.0
        base, quote = symbol.split("/")
        f = order.get("fee") or {}
        if f.get("cost"):
            if f.get("currency") == quote:
                fee = float(f["cost"])
            elif f.get("currency") == base:  # fee paid in the asset itself
                fee = float(f["cost"]) * price
                if side == "buy":
                    qty -= float(f["cost"])
        return Fill(side, symbol, qty, price, fee, time.time())

    def buy(self, symbol: str, quote_amount: float) -> Fill:
        ex = self.market.ex
        price = self.market.price(symbol)
        qty = float(ex.amount_to_precision(symbol, quote_amount / price))
        order = ex.create_market_buy_order(symbol, qty)
        return self._fill(order, "buy", symbol, qty, price)

    def sell(self, symbol: str, qty: float) -> Fill:
        ex = self.market.ex
        price = self.market.price(symbol)
        qty = float(ex.amount_to_precision(symbol, qty))
        order = ex.create_market_sell_order(symbol, qty)
        return self._fill(order, "sell", symbol, qty, price)
