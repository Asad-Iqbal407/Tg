# Tg – Telegram-controlled crypto trading bot

Automated trading (SMA-crossover + RSI strategy) on any [ccxt](https://github.com/ccxt/ccxt)
exchange, controlled from Telegram. **Starts in paper mode (simulated money).**

## Setup
```bash
pip install -r requirements.txt
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN (from @BotFather)
python main.py            # send /myid to your bot, put the id in ALLOWED_CHAT_IDS, restart
```
Then in Telegram: `/backtest`, `/startbot`, `/status`.

## Commands
`/status /balance /startbot /stopbot /buy <amt> /sell /trades /backtest [n] /set <fast|slow|size|sl|tp> <v> /myid /help`

## Safety
- Only chat ids in `ALLOWED_CHAT_IDS` can control the bot.
- Paper mode by default. Live needs `TRADING_MODE=live`, API keys and `LIVE_CONFIRM=I_ACCEPT_THE_RISK`.
- Use exchange API keys **without withdrawal permission**, ideally IP-restricted.
- Stop-loss, take-profit, per-trade size cap and a daily loss limit that halts trading.
- Run paper mode for weeks and compare with `/backtest` before ever going live.
- Backtests are optimistic and no strategy guarantees profit; you can lose all the money you trade with.

## Layout
`tgtrader/` – `strategy.py`, `broker.py` (paper/live), `engine.py` (loop + risk), `backtest.py`, `bot.py` (Telegram).
`python -m pytest` runs the tests.

Stocks: add a broker class with the same `buy/sell/balance` methods and a market class with `ohlcv/price` (e.g. Alpaca) in `broker.py`.
