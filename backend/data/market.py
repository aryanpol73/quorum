"""Price history (yfinance) and technical indicators.

Tool functions return plain Python data so they can be serialised into the agent trace.
"""

from __future__ import annotations

import logging
import math
from datetime import date

import numpy as np
import pandas as pd

from .. import cache
from ..config import DEMO_DATA_DIR, get_settings
from ..tickers import TickerRef
from . import DataUnavailable

log = logging.getLogger("quorum.market")

NIFTY_SYMBOL = "^NSEI"
_COLUMNS = ["Open", "High", "Low", "Close", "Volume"]


# --------------------------------------------------------------------------- fetching
def _demo_key(yahoo_symbol: str, nse_symbol: str | None = None) -> str:
    if yahoo_symbol == NIFTY_SYMBOL:
        return "NSEI"
    return nse_symbol or yahoo_symbol.replace(".NS", "")


def _load_demo_history(key: str) -> pd.DataFrame | None:
    path = DEMO_DATA_DIR / key / "ohlcv.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path, parse_dates=["Date"], index_col="Date")
    df.index = pd.DatetimeIndex(df.index).normalize()
    return df[_COLUMNS].astype(float)


def _download(yahoo_symbol: str, period: str) -> pd.DataFrame | None:
    import yfinance as yf

    df = yf.Ticker(yahoo_symbol).history(period=period, interval="1d", auto_adjust=False)
    if df is None or df.empty:
        return None
    df = df[_COLUMNS].copy()
    idx = pd.DatetimeIndex(df.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    df.index = idx.normalize()
    df = df[~df.index.duplicated(keep="last")].dropna(subset=["Close"])
    return df.astype(float)


def get_history(yahoo_symbol: str, nse_symbol: str | None = None, period: str = "2y") -> tuple[pd.DataFrame, str]:
    """Daily OHLCV. Returns (dataframe, source) where source is 'live', 'cache' or 'demo'.

    In DEMO_MODE (or when the live API fails) cached sample data from backend/demo_data
    is used for the demo tickers so the app never breaks during a presentation.
    """
    settings = get_settings()
    key = _demo_key(yahoo_symbol, nse_symbol)
    if settings.demo_mode:
        demo = _load_demo_history(key)
        if demo is not None:
            return demo, "demo"
    try:
        df, hit = cache.cached(f"hist:{yahoo_symbol}:{period}", lambda: _download(yahoo_symbol, period))
        if df is not None and not df.empty:
            return df, "cache" if hit else "live"
    except Exception as exc:  # network / rate-limit / parsing errors
        log.warning("yfinance history failed for %s: %s", yahoo_symbol, exc)
    demo = _load_demo_history(key)
    if demo is not None:
        return demo, "demo"
    raise DataUnavailable(f"No price data available for {yahoo_symbol}. Check the ticker symbol or your connection.")


def history_for(ref: TickerRef, as_of: date | None = None) -> tuple[pd.DataFrame, str]:
    df, source = get_history(ref.yahoo, ref.symbol)
    if as_of is not None:
        df = df[df.index <= pd.Timestamp(as_of)]
    if len(df) < 30:
        raise DataUnavailable(f"Not enough price history for {ref.symbol} (got {len(df)} rows).")
    return df, source


def latest_close(ref: TickerRef) -> float | None:
    try:
        df, _ = history_for(ref)
        return float(df["Close"].iloc[-1])
    except Exception:
        return None


# --------------------------------------------------------------------------- indicators
def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100 - (100 / (1 + rs))
    return out.where(avg_loss != 0, 100.0)


def macd(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    line = ema12 - ema26
    signal = line.ewm(span=9, adjust=False).mean()
    return line, signal, line - signal


def _r(x: float | None, nd: int = 2) -> float | None:
    if x is None:
        return None
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(xf) or math.isinf(xf):
        return None
    return round(xf, nd)


def compute_indicators(df: pd.DataFrame) -> dict:
    """RSI(14), SMA20/50, MACD, 20-day volume spike, 52-week distance, returns, volatility."""
    close = df["Close"]
    vol = df["Volume"]
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    m_line, m_signal, m_hist = macd(close)
    rsi14 = rsi(close)

    # MACD crossover within the last 5 sessions
    cross = "none"
    sign = np.sign(m_hist.iloc[-6:])
    for i in range(1, len(sign)):
        if sign.iloc[i - 1] <= 0 < sign.iloc[i]:
            cross = "bullish"
        elif sign.iloc[i - 1] >= 0 > sign.iloc[i]:
            cross = "bearish"

    avg_vol20 = vol.iloc[-21:-1].mean() if len(vol) > 21 else vol.mean()
    # Last session's volume vs the average of the 20 sessions before it.
    spike = float(vol.iloc[-1] / avg_vol20) if avg_vol20 and avg_vol20 > 0 else None

    year = close[close.index >= close.index[-1] - pd.Timedelta(days=365)]
    hi52, lo52 = float(year.max()), float(year.min())
    six = close[close.index >= close.index[-1] - pd.Timedelta(days=182)]
    one = close[close.index >= close.index[-1] - pd.Timedelta(days=30)]
    rets = six.pct_change().dropna()

    s20, s50 = _r(sma20.iloc[-1]), _r(sma50.iloc[-1])
    if s20 and s50:
        if last > s20 and last > s50:
            trend = "above both SMAs"
        elif last < s20 and last < s50:
            trend = "below both SMAs"
        else:
            trend = "between SMAs"
    else:
        trend = "insufficient data"

    return {
        "as_of": close.index[-1].date().isoformat(),
        "last_close": _r(last),
        "prev_close": _r(prev),
        "change_pct": _r((last / prev - 1) * 100),
        "rsi14": _r(rsi14.iloc[-1], 1),
        "sma20": s20,
        "sma50": s50,
        "sma20_above_sma50": bool(s20 and s50 and s20 > s50),
        "price_trend": trend,
        "macd": _r(m_line.iloc[-1]),
        "macd_signal": _r(m_signal.iloc[-1]),
        "macd_hist": _r(m_hist.iloc[-1]),
        "macd_recent_cross": cross,
        "volume_last": int(vol.iloc[-1]) if not math.isnan(vol.iloc[-1]) else None,
        "volume_avg20": int(avg_vol20) if avg_vol20 and not math.isnan(avg_vol20) else None,
        "volume_spike_ratio": _r(spike),
        "high_52w": _r(hi52),
        "low_52w": _r(lo52),
        "pct_from_52w_high": _r((last / hi52 - 1) * 100),
        "pct_from_52w_low": _r((last / lo52 - 1) * 100),
        "return_1m_pct": _r((last / float(one.iloc[0]) - 1) * 100),
        "return_6m_pct": _r((last / float(six.iloc[0]) - 1) * 100),
        "volatility_ann_pct": _r(float(rets.std() * math.sqrt(252) * 100)) if len(rets) > 5 else None,
        "sessions_analysed": int(len(six)),
    }


def chart_series(df: pd.DataFrame, days: int = 182) -> list[dict]:
    """Last ~6 months of OHLCV with SMA overlays, shaped for lightweight-charts."""
    close = df["Close"]
    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    start = df.index[-1] - pd.Timedelta(days=days)
    rows = []
    for ts, row in df[df.index >= start].iterrows():
        rows.append(
            {
                "time": ts.date().isoformat(),
                "open": _r(row["Open"]),
                "high": _r(row["High"]),
                "low": _r(row["Low"]),
                "close": _r(row["Close"]),
                "volume": int(row["Volume"]) if not math.isnan(row["Volume"]) else 0,
                "sma20": _r(sma20.loc[ts]),
                "sma50": _r(sma50.loc[ts]),
            }
        )
    return rows
