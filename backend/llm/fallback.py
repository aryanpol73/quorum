"""Offline, rule-based stand-in for every LLM call.

Used when GEMINI_API_KEY is missing/invalid or the API fails after its retry, so a live
demo never breaks. Outputs follow exactly the same schemas as the LLM path and are
labelled `offline` in the UI and trace, so nobody mistakes them for model reasoning.
"""

from __future__ import annotations

import math
import re

from ..agents.schemas import FundamentalsJudgement, HeadlineScore, NewsScoring, PMDecision, RiskFlag, RiskReview

# --------------------------------------------------------------------------- market
def market_interpretation(ind: dict, company: str) -> str:
    close, chg = ind.get("last_close"), ind.get("change_pct") or 0.0
    s20, s50, rsi = ind.get("sma20"), ind.get("sma50"), ind.get("rsi14")
    parts = [f"{company} last closed at ₹{close:,.2f} ({chg:+.2f}% on the session)."]
    if s20 and s50:
        structure = "constructive" if close > s20 > s50 else "weak" if close < s20 < s50 else "mixed"
        parts.append(
            f"The trend structure is {structure}: price is {ind.get('price_trend')} "
            f"(SMA20 ₹{s20:,.2f}, SMA50 ₹{s50:,.2f})."
        )
    if rsi is not None:
        zone = "overbought" if rsi >= 70 else "oversold" if rsi <= 30 else "neutral-to-firm" if rsi >= 50 else "soft"
        hist = ind.get("macd_hist") or 0.0
        parts.append(
            f"Momentum is {zone} with RSI(14) at {rsi:.1f}, and the MACD histogram is "
            f"{'positive' if hist > 0 else 'negative'} ({hist:+.2f})."
        )
    if ind.get("volume_spike_ratio") is not None and ind.get("pct_from_52w_high") is not None:
        parts.append(
            f"Volume ran at {ind['volume_spike_ratio']:.2f}x the 20-day average, and the stock sits "
            f"{abs(ind['pct_from_52w_high']):.1f}% below its 52-week high."
        )
    return " ".join(parts)


# --------------------------------------------------------------------------- news
POSITIVE = {
    "surge": 1.0, "surges": 1.0, "soar": 1.0, "soars": 1.0, "jump": 0.8, "jumps": 0.8, "rally": 0.8, "rallies": 0.8,
    "gain": 0.6, "gains": 0.6, "rise": 0.6, "rises": 0.6, "climb": 0.6, "climbs": 0.6, "beat": 0.9, "beats": 0.9,
    "upgrade": 1.0, "upgrades": 1.0, "outperform": 0.8, "record": 0.7, "strong": 0.6, "growth": 0.4,
    "profit": 0.4, "wins": 0.7, "win": 0.6, "bags": 0.7, "order": 0.3, "orders": 0.3, "expands": 0.5,
    "approval": 0.6, "bullish": 0.9, "rebound": 0.7, "recovers": 0.7, "recovery": 0.6, "bottoming": 0.5,
    "dividend": 0.4, "buyback": 0.8, "picks": 0.4, "pick": 0.4, "buy": 0.5, "target": 0.2, "high": 0.3,
    "deal": 0.5, "partnership": 0.5, "launch": 0.3, "launches": 0.3, "positive": 0.5,
    "jumped": 0.8, "surged": 1.0, "rallied": 0.8, "soared": 1.0, "rose": 0.6, "gainer": 0.6, "gainers": 0.6,
    "lifts": 0.4, "raises": 0.5, "raised": 0.5, "hike": 0.4, "upbeat": 0.7, "robust": 0.6, "outperforms": 0.8,
}
NEGATIVE = {
    "fall": 0.7, "falls": 0.7, "drop": 0.7, "drops": 0.7, "slump": 0.9, "slumps": 0.9, "plunge": 1.0,
    "plunges": 1.0, "decline": 0.6, "declines": 0.6, "loss": 0.7, "losses": 0.7, "miss": 0.8, "misses": 0.8,
    "downgrade": 1.0, "downgrades": 1.0, "sell": 0.5, "underperform": 0.8, "weak": 0.6, "cut": 0.5,
    "cuts": 0.5, "probe": 0.8, "penalty": 0.8, "lawsuit": 0.8, "fraud": 1.0, "layoffs": 0.7, "resigns": 0.6,
    "concern": 0.5, "concerns": 0.5, "bearish": 0.9, "crash": 1.0, "slide": 0.6, "slides": 0.6, "tumble": 0.9,
    "tumbles": 0.9, "warning": 0.6, "slowdown": 0.7, "pressure": 0.4, "lower": 0.4, "low": 0.3, "falling": 0.7,
    "fear": 0.6, "fears": 0.6, "risk": 0.3, "risks": 0.3, "negative": 0.5, "exit": 0.3, "tariff": 0.4,
    "crashes": 1.0, "crashed": 1.0, "slips": 0.6, "slip": 0.6, "loser": 0.7, "losers": 0.7, "drags": 0.6,
    "drag": 0.5, "fell": 0.7, "plunged": 1.0, "dropped": 0.7, "declined": 0.6, "sank": 0.8, "sinks": 0.8,
    "tumbled": 0.9, "downgraded": 1.0, "underperforms": 0.8, "selloff": 0.8, "sheds": 0.6,
}
WORD_RE = re.compile(r"[a-z]+")


def _headline_score(title: str) -> tuple[float, list[str], list[str]]:
    words = WORD_RE.findall(title.lower())
    pos = [w for w in words if w in POSITIVE]
    neg = [w for w in words if w in NEGATIVE]
    raw = sum(POSITIVE[w] for w in pos) - sum(NEGATIVE[w] for w in neg)
    return round(math.tanh(raw / 1.5), 2), pos, neg


def score_headlines(headlines: list[dict]) -> NewsScoring:
    scores = []
    for i, h in enumerate(headlines):
        s, pos, neg = _headline_score(h["title"])
        if pos or neg:
            reason = "Keyword signal: " + ", ".join([f"+{w}" for w in pos[:3]] + [f"-{w}" for w in neg[:3]])
        else:
            reason = "No clear directional keywords; treated as neutral"
        scores.append(HeadlineScore(index=i, score=s, reason=reason))
    n_pos = sum(1 for s in scores if s.score >= 0.15)
    n_neg = sum(1 for s in scores if s.score <= -0.15)
    avg = sum(s.score for s in scores) / len(scores) if scores else 0.0
    tone = "mildly positive" if avg > 0.1 else "mildly negative" if avg < -0.1 else "broadly neutral"
    summary = (
        f"Keyword scoring finds {n_pos} positive and {n_neg} negative headlines out of {len(scores)}. "
        f"The overall news flow looks {tone} (average {avg:+.2f})."
    )
    return NewsScoring(scores=scores, summary=summary)


# --------------------------------------------------------------------------- fundamentals
def judge_valuation(fund: dict) -> FundamentalsJudgement:
    m = fund.get("metrics") or {}
    points, reasons = 0.0, []
    pe, pb = m.get("pe"), m.get("pb")
    if pe is not None:
        if pe < 18:
            points += 1
            reasons.append(f"P/E of {pe:.1f} is modest for a listed Indian company")
        elif pe > 40:
            points -= 1
            reasons.append(f"P/E of {pe:.1f} prices in substantial future growth")
        else:
            reasons.append(f"P/E of {pe:.1f} sits in a middle band")
    if pb is not None:
        if pb < 2:
            points += 0.5
            reasons.append(f"P/B of {pb:.2f} is close to book value")
        elif pb > 8:
            points -= 0.5
            reasons.append(f"P/B of {pb:.2f} is a steep premium to book")
    rg, pm = m.get("revenue_growth_pct"), m.get("profit_margin_pct")
    if rg is not None and pm is not None:
        reasons.append(f"Revenue growth {rg:+.1f}% with a {pm:.1f}% net margin")
    de = m.get("debt_to_equity")
    if de is not None and de > 1.5:
        points -= 0.5
        reasons.append(f"Leverage is elevated at {de:.2f}x debt-to-equity")
    if fund.get("missing"):
        reasons.append("Missing data: " + ", ".join(fund["missing"][:3]))
    while len(reasons) < 2:
        reasons.append("Limited fundamental data available, so the judgement is low-conviction")
    valuation = "cheap" if points >= 1 else "expensive" if points <= -1 else "fair"
    return FundamentalsJudgement(
        valuation=valuation,
        reasons=reasons[:4],
        summary=f"Rule-based screen rates the stock {valuation} on the available multiples.",
    )


# --------------------------------------------------------------------------- debate
OPENERS = {
    "bull": ["The case for buying rests on the data.", "The evidence still tilts toward upside.", "Weighing everything, the bull case holds."],
    "bear": ["The case for caution is stronger than it looks.", "The risks outweigh the upside here.", "On balance, the evidence argues for restraint."],
}
CLOSERS = {
    "bull": ["That supports a measured long position.", "Pullbacks look like opportunities rather than warnings.", "The balance of evidence favours accumulation."],
    "bear": ["That argues against adding exposure now.", "Capital is better protected by waiting.", "The prudent call is to stay defensive."],
}


REBUTTAL_OPENERS = ["The {other} argues that {x} [{id}]", "The {other} leans on the point that {x} [{id}]", "The {other} stresses that {x} [{id}]"]
COUNTERS = {
    "bull": [", but that is a single signal against an otherwise constructive picture.", ", yet that risk already looks priced in.", ", but it does not change the broader trend."],
    "bear": [", but one supportive data point does not make a trend.", ", yet that optimism already looks priced in.", ", but it glosses over the weaker signals in the ledger."],
}


def _phrase(item: dict) -> str:
    """Evidence text usable mid-sentence (lower-case ordinary first words, keep acronyms)."""
    text = item.get("short") or item["detail"]
    text = text.rstrip(". ")
    first = text.split(" ", 1)[0]
    if first[:1].isupper() and first[1:].replace("-", "").islower() and first != "Fundamentals":
        text = text[0].lower() + text[1:]
    return text


def debate_argument(side: str, round_no: int, ledger: list[dict], turns: list[dict]) -> str:
    mine = "bullish" if side == "bull" else "bearish"
    theirs = "bearish" if side == "bull" else "bullish"
    other = "Bear" if side == "bull" else "Bull"
    by_id = {e["id"]: e for e in ledger}
    used = {c for t in turns if t["side"] == side for c in t.get("citations", [])}
    support = sorted((e for e in ledger if e["lean"] == mine), key=lambda e: -e["weight"])
    fresh = [e for e in support if e["id"] not in used]
    k = (round_no - 1) % 3
    parts: list[str] = []

    opp_turns = [t for t in turns if t["side"] != side]
    if opp_turns:
        cited = [by_id[c] for c in opp_turns[-1].get("citations", []) if c in by_id]
        # Rebut the opponent's own supporting evidence that has not been answered yet.
        candidates = [e for e in cited if e["lean"] == theirs and e["id"] not in used] or [e for e in cited if e["id"] not in used] or cited
        if candidates:
            target = candidates[0]
            same_source = next((e for e in fresh if e["source"] == target["source"]), None)
            opener = REBUTTAL_OPENERS[k].format(other=other, x=_phrase(target), id=target["id"])
            if same_source:
                parts.append(f"{opener}, but on the same {target['source']} evidence, {_phrase(same_source)} [{same_source['id']}].")
                fresh = [e for e in fresh if e["id"] != same_source["id"]]
            else:
                parts.append(opener + COUNTERS[side][k])
        else:
            parts.append(f"The {other}'s last argument cited no ledger evidence, so it deserves little weight.")
    else:
        parts.append(OPENERS[side][k])

    if fresh:
        lead = "More importantly," if opp_turns else "First,"
        parts.append(f"{lead} {_phrase(fresh[0])} [{fresh[0]['id']}].")
        if len(fresh) > 1:
            parts.append(f"{'Also' if opp_turns else 'Second'}, {_phrase(fresh[1])} [{fresh[1]['id']}].")
    elif support:
        parts.append(f"As argued earlier, {_phrase(support[0])} [{support[0]['id']}], and that point still stands unanswered.")
    else:
        neutral = next((e for e in ledger if e["lean"] == "neutral"), None)
        if neutral:
            parts.append(
                f"Admittedly the ledger offers little direct support for the {side} case; "
                f"the most that can be said is that {_phrase(neutral)} [{neutral['id']}]."
            )
        else:
            parts.append(f"Admittedly the ledger offers little direct support for the {side} case.")
    parts.append(CLOSERS[side][k])
    return " ".join(parts)


# --------------------------------------------------------------------------- risk
def risk_review(det_flags: list[dict], rule_cap: float, vol: float | None, turns: list[dict]) -> RiskReview:
    flags = [RiskFlag(**f) for f in det_flags]
    high = sum(1 for f in flags if f.severity == "high")
    max_pos = max(0.0, round(rule_cap - 2.0 * high, 1))
    level = "high" if (vol or 0) > 40 else "medium" if (vol or 0) > 25 else "low"
    vol_txt = f"{vol:.1f}%" if vol is not None else "unknown"
    notes = (
        f"Annualised volatility is {vol_txt}, giving a volatility-scaled cap of {rule_cap:.1f}% of the portfolio. "
        f"{len(flags)} argument issue(s) were flagged across {len(turns)} debate turns"
        + (f", including {high} high-severity, so the cap is reduced to {max_pos:.1f}%." if high else ".")
    )
    return RiskReview(flags=flags, max_position_pct=max_pos, risk_level=level, notes=notes)


# --------------------------------------------------------------------------- portfolio manager
def pm_decision(ledger: list[dict], risk: dict, holding_qty: int = 0) -> PMDecision:
    total_w = sum(e["weight"] for e in ledger) or 1.0
    score = sum(e["weight"] * (1 if e["lean"] == "bullish" else -1 if e["lean"] == "bearish" else 0) for e in ledger) / total_w
    flags = risk.get("flags", [])
    score -= 0.05 * sum(1 for f in flags if f["side"] == "bull" and f["severity"] == "high")
    score += 0.05 * sum(1 for f in flags if f["side"] == "bear" and f["severity"] == "high")
    max_pos = float(risk.get("max_position_pct", 0.0))

    if score >= 0.15:
        decision = "BUY"
    elif score <= -0.15:
        decision = "SELL"
    else:
        decision = "HOLD"
    if decision == "BUY":
        confidence = int(min(85, 50 + 60 * abs(score)))
        size = round(max_pos * min(1.0, 0.4 + abs(score)), 1)
    elif decision == "SELL":
        confidence = int(min(85, 50 + 60 * abs(score)))
        size = 0.0
    else:
        confidence = int(max(35, 60 - 100 * abs(score)))
        size = 0.0

    bull = sorted((e for e in ledger if e["lean"] == "bullish"), key=lambda e: -e["weight"])
    bear = sorted((e for e in ledger if e["lean"] == "bearish"), key=lambda e: -e["weight"])
    r1 = f"Evidence balance score is {score:+.2f}: {len(bull)} bullish vs {len(bear)} bearish ledger items."
    if decision == "BUY" and bull:
        r2 = f"Strongest support: {bull[0]['detail']} [{bull[0]['id']}]."
    elif decision == "SELL" and bear:
        r2 = f"Strongest concern: {bear[0]['detail']} [{bear[0]['id']}]."
        if holding_qty <= 0:
            r2 += " No position is held, so this is an avoid/exit signal only."
    else:
        b = f"{bull[0]['label']} [{bull[0]['id']}]" if bull else "no strong bullish item"
        s = f"{bear[0]['label']} [{bear[0]['id']}]" if bear else "no strong bearish item"
        r2 = f"Signals conflict ({b} vs {s}), so there is no clear edge."
    r3 = f"Risk Manager caps exposure at {max_pos:.1f}% ({risk.get('risk_level', 'n/a')} risk); target size {size:.1f}%."
    return PMDecision(decision=decision, confidence=confidence, position_size_pct=size, rationale=[r1, r2, r3])
