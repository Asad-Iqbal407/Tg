import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

LIVE_PHRASE = "I_ACCEPT_THE_RISK"


@dataclass
class Config:
    telegram_token: str = ""
    allowed_chat_ids: set = field(default_factory=set)
    mode: str = "paper"
    exchange: str = "binance"
    api_key: str = ""
    api_secret: str = ""
    symbol: str = "BTC/USDT"
    timeframe: str = "1h"
    fast_sma: int = 10
    slow_sma: int = 30
    rsi_period: int = 14
    rsi_max_buy: float = 70.0
    trade_size_quote: float = 50.0
    stop_loss_pct: float = 3.0
    take_profit_pct: float = 6.0
    daily_loss_limit_pct: float = 5.0
    paper_start_balance: float = 1000.0
    poll_seconds: int = 30
    state_file: str = "state.json"

    @property
    def quote(self) -> str:
        return self.symbol.split("/")[1]

    @property
    def base(self) -> str:
        return self.symbol.split("/")[0]

    def validate(self) -> None:
        if self.mode not in ("paper", "live"):
            raise ValueError("TRADING_MODE must be 'paper' or 'live'")
        if self.mode == "live":
            if os.environ.get("LIVE_CONFIRM") != LIVE_PHRASE:
                raise ValueError(f"Live mode requires LIVE_CONFIRM={LIVE_PHRASE}")
            if not (self.api_key and self.api_secret):
                raise ValueError("Live mode requires API_KEY and API_SECRET")
        if self.fast_sma >= self.slow_sma:
            raise ValueError("FAST_SMA must be smaller than SLOW_SMA")
        if self.trade_size_quote <= 0:
            raise ValueError("TRADE_SIZE_QUOTE must be positive")


def load_config() -> Config:
    load_dotenv()
    e = os.environ.get
    ids = {int(x) for x in e("ALLOWED_CHAT_IDS", "").replace(" ", "").split(",") if x}
    cfg = Config(
        telegram_token=e("TELEGRAM_BOT_TOKEN", ""),
        allowed_chat_ids=ids,
        mode=e("TRADING_MODE", "paper").lower(),
        exchange=e("EXCHANGE", "binance"),
        api_key=e("API_KEY", ""),
        api_secret=e("API_SECRET", ""),
        symbol=e("SYMBOL", "BTC/USDT"),
        timeframe=e("TIMEFRAME", "1h"),
        fast_sma=int(e("FAST_SMA", 10)),
        slow_sma=int(e("SLOW_SMA", 30)),
        rsi_period=int(e("RSI_PERIOD", 14)),
        rsi_max_buy=float(e("RSI_MAX_BUY", 70)),
        trade_size_quote=float(e("TRADE_SIZE_QUOTE", 50)),
        stop_loss_pct=float(e("STOP_LOSS_PCT", 3)),
        take_profit_pct=float(e("TAKE_PROFIT_PCT", 6)),
        daily_loss_limit_pct=float(e("DAILY_LOSS_LIMIT_PCT", 5)),
        paper_start_balance=float(e("PAPER_START_BALANCE", 1000)),
        poll_seconds=int(e("POLL_SECONDS", 30)),
    )
    cfg.validate()
    return cfg
