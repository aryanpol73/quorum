"""Company fundamentals from yfinance `Ticker.info` (missing fields handled gracefully)."""

from __future__ import annotations

import json
import logging
import math

from .. import cache
from ..config import DEMO_DATA_DIR, get_settings
from ..tickers import TickerRef

log = logging.getLogger("quorum.fundamentals")

FIELDS = {
    "pe": "P/E (trailing)",
    "forward_pe": "P/E (forward)",
    "pb": "P/B",
    "debt_to_equity": "Debt / Equity",
    "revenue_growth_pct": "Revenue growth (YoY)",
    "profit_margin_pct": "Profit margin",
    "roe_pct": "Return on equity",
    "market_cap_cr": "Market cap (₹ crore)",
}
CORE = ["pe", "pb", "debt_to_equity", "revenue_growth_pct", "profit_margin_pct", "market_cap_cr"]


def _num(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _pct(value) -> float | None:
    f = _num(value)
    return round(f * 100, 2) if f is not None else None


def normalise_info(info: dict) -> dict:
    """Map raw yfinance info -> our metrics. yfinance reports debtToEquity in percent."""
    de = _num(info.get("debtToEquity"))
    mcap = _num(info.get("marketCap"))
    pe = _num(info.get("trailingPE"))
    metrics = {
        "pe": round(pe, 2) if pe is not None and pe > 0 else None,
        "forward_pe": round(_num(info.get("forwardPE")), 2) if _num(info.get("forwardPE")) else None,
        "pb": round(_num(info.get("priceToBook")), 2) if _num(info.get("priceToBook")) else None,
        "debt_to_equity": round(de / 100, 2) if de is not None else None,
        "revenue_growth_pct": _pct(info.get("revenueGrowth")),
        "profit_margin_pct": _pct(info.get("profitMargins")),
        "roe_pct": _pct(info.get("returnOnEquity")),
        "market_cap_cr": round(mcap / 1e7) if mcap else None,
    }
    return {
        "name": info.get("longName") or info.get("shortName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "currency": info.get("currency") or "INR",
        "metrics": metrics,
        "missing": [FIELDS[k] for k in CORE if metrics.get(k) is None],
    }


def _fetch_info(yahoo_symbol: str) -> dict | None:
    import yfinance as yf

    info = yf.Ticker(yahoo_symbol).info or {}
    if not info or (info.get("regularMarketPrice") is None and info.get("marketCap") is None):
        return None
    return info


def _load_demo(ref: TickerRef) -> dict | None:
    path = DEMO_DATA_DIR / ref.symbol / "fundamentals.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def get_fundamentals(ref: TickerRef) -> tuple[dict, str]:
    """Returns (normalised fundamentals, source)."""
    if get_settings().demo_mode:
        demo = _load_demo(ref)
        if demo is not None:
            return demo, "demo"
    try:
        info, hit = cache.cached(f"info:{ref.yahoo}", lambda: _fetch_info(ref.yahoo))
        if info:
            return normalise_info(info), "cache" if hit else "live"
    except Exception as exc:
        log.warning("yfinance info failed for %s: %s", ref.yahoo, exc)
    demo = _load_demo(ref)
    if demo is not None:
        return demo, "demo"
    empty = {k: None for k in FIELDS}
    return {
        "name": ref.name,
        "sector": None,
        "industry": None,
        "currency": "INR",
        "metrics": empty,
        "missing": [FIELDS[k] for k in CORE],
    }, "none"
