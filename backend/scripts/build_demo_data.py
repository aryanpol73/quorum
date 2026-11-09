"""Refresh the cached demo data used by DEMO_MODE (and as a fallback when APIs fail).

    python -m backend.scripts.build_demo_data            # INFY, TATAMOTORS + Nifty 50
    python -m backend.scripts.build_demo_data RELIANCE   # add more tickers

Writes backend/demo_data/<SYMBOL>/{ohlcv.csv, news.json, fundamentals.json} and NSEI/ohlcv.csv.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone

from ..config import DEMO_DATA_DIR
from ..data import fundamentals, market, news
from ..tickers import resolve


IST = timezone(timedelta(hours=5, minutes=30))


def _completed_sessions(df):
    """Drop today's bar while the NSE session is still open (partial OHLCV)."""
    now = datetime.now(IST)
    if len(df) and df.index[-1].date() == now.date() and (now.hour, now.minute) < (15, 45):
        return df.iloc[:-1]
    return df


def _write_ohlcv(df, folder) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    out = _completed_sessions(df).copy()
    out.index.name = "Date"
    out.round(4).to_csv(folder / "ohlcv.csv", date_format="%Y-%m-%d")


def build(symbols: list[str]) -> None:
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    nifty = market._download(market.NIFTY_SYMBOL, "2y")
    _write_ohlcv(nifty, DEMO_DATA_DIR / "NSEI")
    print(f"NSEI: {len(nifty)} rows")
    for sym in symbols:
        ref = resolve(sym)
        folder = DEMO_DATA_DIR / ref.symbol
        df = market._download(ref.yahoo, "2y")
        if df is None or df.empty:
            print(f"{sym}: no price data, skipped")
            continue
        _write_ohlcv(df, folder)
        heads = news._fetch(news.build_query(ref), 10, None)
        (folder / "news.json").write_text(
            json.dumps({"fetched_at": stamp, "query": news.build_query(ref), "headlines": heads}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        info = fundamentals._fetch_info(ref.yahoo) or {}
        fund = fundamentals.normalise_info(info) if info else {"name": ref.name, "metrics": {}, "missing": []}
        fund["fetched_at"] = stamp
        fund["yahoo_symbol"] = ref.yahoo
        (folder / "fundamentals.json").write_text(json.dumps(fund, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"{ref.symbol} ({ref.yahoo}): {len(_completed_sessions(df))} rows, {len(heads)} headlines, missing={fund.get('missing')}")


if __name__ == "__main__":
    build([s.upper() for s in sys.argv[1:]] or ["INFY", "TATAMOTORS"])
