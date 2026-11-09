"""The evidence ledger: every fact the debaters may use, each with a citable ID.

T* = technical (Market Data Agent), N* = news (News Agent), F* = fundamentals.
Each item carries a rule-based `lean` (bullish / bearish / neutral) and a `weight`;
the debaters see the ledger and must cite IDs, and the Risk Manager checks citations
against it (reflection step).
"""

from __future__ import annotations

import re

LEAN_SIGN = {"bullish": 1, "bearish": -1, "neutral": 0}
CITATION_RE = re.compile(r"\[([^\[\]]{1,40})\]")
ID_RE = re.compile(r"\b([TNF]\d{1,2})\b")


def _inr(x: float | None) -> str:
    return f"₹{x:,.2f}" if x is not None else "n/a"


def _item(eid: str, source: str, label: str, detail: str, lean: str, weight: float = 1.0) -> dict:
    return {"id": eid, "source": source, "label": label, "detail": detail, "lean": lean, "weight": weight}


def _technical(ind: dict) -> list[dict]:
    out: list[dict] = []
    r = ind.get("rsi14")
    if r is not None:
        if r >= 70:
            lean, note = "bearish", "overbought territory (>70), raising pullback risk"
        elif r <= 30:
            lean, note = "bullish", "oversold territory (<30), where rebounds are common"
        elif r >= 55:
            lean, note = "bullish", "a positive momentum zone (55-70)"
        elif r <= 45:
            lean, note = "bearish", "a weak momentum zone (30-45)"
        else:
            lean, note = "neutral", "the neutral zone (45-55)"
        out.append(_item("T1", "market", "RSI(14)", f"RSI(14) is {r:.1f}, in {note}", lean))

    close, s20, s50 = ind.get("last_close"), ind.get("sma20"), ind.get("sma50")
    if close and s20 and s50:
        if close > s20 and close > s50:
            lean, rel = "bullish", "above both"
        elif close < s20 and close < s50:
            lean, rel = "bearish", "below both"
        else:
            lean, rel = "neutral", "between"
        out.append(
            _item(
                "T2", "market", "Price vs SMAs",
                f"Price {_inr(close)} is {rel} the 20-day SMA ({_inr(s20)}) and 50-day SMA ({_inr(s50)})", lean,
            )
        )
        if s20 > s50:
            out.append(_item("T3", "market", "SMA alignment", "The 20-day SMA is above the 50-day SMA (short-term trend leading up)", "bullish"))
        else:
            out.append(_item("T3", "market", "SMA alignment", "The 20-day SMA is below the 50-day SMA (short-term trend lagging)", "bearish"))

    hist = ind.get("macd_hist")
    if hist is not None:
        cross = ind.get("macd_recent_cross", "none")
        cross_txt = f", with a {cross} signal-line crossover in the last 5 sessions" if cross != "none" else ""
        lean = "bullish" if hist > 0 else "bearish"
        side = "above" if hist > 0 else "below"
        out.append(_item("T4", "market", "MACD", f"MACD ({ind.get('macd')}) is {side} its signal line (histogram {hist:+.2f}){cross_txt}", lean))

    spike, chg = ind.get("volume_spike_ratio"), ind.get("change_pct") or 0.0
    if spike is not None:
        if spike >= 1.5:
            lean = "bullish" if chg >= 0 else "bearish"
            day = "an up" if chg >= 0 else "a down"
            out.append(_item("T5", "market", "Volume", f"Volume was {spike:.2f}x its 20-day average on {day} day ({chg:+.2f}%)", lean))
        elif spike <= 0.7:
            out.append(_item("T5", "market", "Volume", f"Volume was only {spike:.2f}x its 20-day average, signalling thin conviction", "neutral"))
        else:
            out.append(_item("T5", "market", "Volume", f"Volume was a normal {spike:.2f}x its 20-day average", "neutral"))

    fh, fl = ind.get("pct_from_52w_high"), ind.get("pct_from_52w_low")
    if fh is not None and fl is not None:
        if fh >= -5:
            lean, note = "bullish", "trading near its 52-week high, a sign of strength"
        elif fl <= 10:
            lean, note = "bearish", "trading near its 52-week low, a sign of weakness"
        else:
            lean, note = "neutral", "mid-range within its 52-week band"
        out.append(
            _item(
                "T6", "market", "52-week range",
                f"The stock is {fh:+.1f}% from its 52-week high ({_inr(ind.get('high_52w'))}) and {fl:+.1f}% from its low "
                f"({_inr(ind.get('low_52w'))}), {note}", lean,
            )
        )

    r6, r1 = ind.get("return_6m_pct"), ind.get("return_1m_pct")
    if r6 is not None:
        lean = "bullish" if r6 > 5 else "bearish" if r6 < -5 else "neutral"
        one_m = f" and 1-month return is {r1:+.1f}%" if r1 is not None else ""
        out.append(_item("T7", "market", "Returns", f"6-month return is {r6:+.1f}%{one_m}", lean))

    vol = ind.get("volatility_ann_pct")
    if vol is not None:
        lean = "bearish" if vol > 40 else "neutral"
        level = "high" if vol > 40 else "moderate" if vol > 25 else "low"
        out.append(_item("T8", "market", "Volatility", f"Annualised volatility is {vol:.1f}% ({level})", lean, 0.75))
    return out


def _news(news: dict) -> list[dict]:
    out: list[dict] = []
    agg = news.get("aggregate") or {}
    if agg.get("count"):
        s = agg.get("score", 0.0)
        lean = "bullish" if s > 0.1 else "bearish" if s < -0.1 else "neutral"
        out.append(
            _item(
                "N0", "news", "News sentiment",
                f"Average headline sentiment is {s:+.2f} across {agg['count']} headlines "
                f"({agg.get('positive', 0)} positive, {agg.get('negative', 0)} negative)", lean, 1.5,
            )
        )
    for i, h in enumerate(news.get("headlines") or [], start=1):
        s = h.get("score", 0.0)
        lean = "bullish" if s >= 0.15 else "bearish" if s <= -0.15 else "neutral"
        src = f" ({h['source']})" if h.get("source") else ""
        item = _item(f"N{i}", "news", "Headline", f"Headline{src}: \"{h['title']}\" scored {s:+.1f} - {h.get('reason', '')}", lean, 0.5)
        item["short"] = f"the headline \"{h['title']}\"{src} scored {s:+.1f}"
        out.append(item)
    return out


def _fundamentals(f: dict) -> list[dict]:
    out: list[dict] = []
    m = f.get("metrics") or {}
    pe = m.get("pe")
    if pe is not None:
        lean = "bullish" if pe < 18 else "bearish" if pe > 40 else "neutral"
        out.append(_item("F1", "fundamentals", "P/E", f"Trailing P/E is {pe:.1f}", lean, 0.75))
    pb = m.get("pb")
    if pb is not None:
        lean = "bullish" if pb < 2 else "bearish" if pb > 8 else "neutral"
        out.append(_item("F2", "fundamentals", "P/B", f"Price-to-book is {pb:.2f}", lean, 0.75))
    de = m.get("debt_to_equity")
    if de is not None:
        lean = "bullish" if de < 0.5 else "bearish" if de > 1.5 else "neutral"
        out.append(_item("F3", "fundamentals", "Debt/Equity", f"Debt-to-equity is {de:.2f}x", lean, 0.75))
    rg = m.get("revenue_growth_pct")
    if rg is not None:
        lean = "bullish" if rg > 10 else "bearish" if rg < 0 else "neutral"
        out.append(_item("F4", "fundamentals", "Revenue growth", f"Revenue growth (YoY) is {rg:+.1f}%", lean, 0.75))
    pm = m.get("profit_margin_pct")
    if pm is not None:
        lean = "bullish" if pm > 15 else "bearish" if pm < 5 else "neutral"
        out.append(_item("F5", "fundamentals", "Profit margin", f"Net profit margin is {pm:.1f}%", lean, 0.75))
    roe = m.get("roe_pct")
    if roe is not None:
        lean = "bullish" if roe > 15 else "bearish" if roe < 8 else "neutral"
        out.append(_item("F6", "fundamentals", "ROE", f"Return on equity is {roe:.1f}%", lean, 0.75))
    mc = m.get("market_cap_cr")
    if mc is not None:
        size = "large-cap" if mc >= 100_000 else "mid-cap" if mc >= 30_000 else "small-cap"
        out.append(_item("F7", "fundamentals", "Market cap", f"Market cap is ₹{mc:,.0f} crore ({size})", "neutral", 0.5))
    judgement = f.get("judgement")
    if judgement:
        v = judgement.get("valuation")
        lean = {"cheap": "bullish", "expensive": "bearish"}.get(v, "neutral")
        item = _item("F8", "fundamentals", "Valuation verdict", f"Fundamentals Agent judges valuation {str(v).upper()}: {judgement.get('summary', '')}", lean, 1.5)
        item["short"] = f"the Fundamentals Agent judges the valuation {v}"
        out.append(item)
    return out


def build_ledger(market: dict | None, news: dict | None, fundamentals: dict | None) -> list[dict]:
    ledger: list[dict] = []
    if market and market.get("indicators"):
        ledger += _technical(market["indicators"])
    if news:
        ledger += _news(news)
    if fundamentals:
        ledger += _fundamentals(fundamentals)
    return ledger


def ledger_text(ledger: list[dict]) -> str:
    return "\n".join(f"[{e['id']}] ({e['source']}, leans {e['lean']}) {e['detail']}" for e in ledger)


def extract_citations(text: str, ledger: list[dict]) -> tuple[list[str], list[str]]:
    """Return (valid_ids, invalid_ids) cited in square brackets, preserving order."""
    known = {e["id"] for e in ledger}
    valid: list[str] = []
    invalid: list[str] = []
    for group in CITATION_RE.findall(text):
        for eid in ID_RE.findall(group.upper()):
            target = valid if eid in known else invalid
            if eid not in target:
                target.append(eid)
    return valid, invalid
