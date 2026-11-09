"""Risk Manager: reflection over the debate + volatility-based position cap."""

from __future__ import annotations

import re

from ..llm import fallback
from . import prompts
from .common import Emitter, llm_json, node
from .evidence import ledger_text
from .schemas import RiskReview
from .state import QuorumState

NUM_RE = re.compile(r"(?<![\w\[])(₹\s?)?(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)(\s?%|x\b)?")


def volatility_cap(vol: float | None) -> float:
    """Inverse-volatility sizing: 20% at <=25% annualised vol, shrinking as vol rises (min 2%)."""
    if vol is None or vol <= 0:
        return 10.0
    return round(max(2.0, min(20.0, 20.0 * 25.0 / vol)), 1)


def _ledger_numbers(ledger: list[dict]) -> list[float]:
    nums = []
    for e in ledger:
        for _cur, n, _unit in NUM_RE.findall(e["detail"]):
            try:
                nums.append(abs(float(n.replace(",", ""))))
            except ValueError:
                pass
    return nums


def _unsupported_figures(text: str, known: list[float]) -> list[str]:
    """Figures quoted with a decimal point, %, x or ₹ that appear nowhere in the ledger."""
    text = re.sub(r"\[[^\]]*\]", " ", text)  # ignore citation IDs
    missing = []
    for cur, n, unit in NUM_RE.findall(text):
        if not (cur or unit or "." in n):
            continue
        try:
            value = abs(float(n.replace(",", "")))
        except ValueError:
            continue
        decimals = len(n.split(".")[1]) if "." in n else 0
        tol = max(0.5 * 10 ** (-decimals) + 1e-9, 0.01 * value)
        if not any(abs(value - k) <= tol for k in known):
            missing.append(f"{cur}{n}{unit}".strip())
    return missing


def citation_checks(transcript: list[dict], ledger: list[dict]) -> list[dict]:
    """Deterministic reflection pass run before the LLM review."""
    by_id = {e["id"]: e for e in ledger}
    known = _ledger_numbers(ledger)
    flags = []
    for t in transcript:
        base = {"round": t["round"], "side": t["side"]}
        if not t["citations"]:
            flags.append({**base, "issue": "Cites no ledger evidence, so the argument is unsupported.", "severity": "high"})
        if t.get("invalid_citations"):
            flags.append({**base, "issue": f"Cites evidence IDs that do not exist: {', '.join(t['invalid_citations'])}.", "severity": "high"})
        cited = [by_id[c] for c in t["citations"] if c in by_id]
        against = "bearish" if t["side"] == "bull" else "bullish"
        if len(cited) >= 2 and sum(1 for e in cited if e["lean"] == against) / len(cited) > 0.5:
            flags.append({**base, "issue": f"Most of its cited evidence actually leans {against}.", "severity": "medium"})
        figures = _unsupported_figures(t["text"], known)
        if figures:
            flags.append({**base, "issue": f"Quotes figure(s) not found in the ledger: {', '.join(figures[:3])}.", "severity": "low"})
    return flags


@node("risk_manager", agent="risk")
async def risk_manager(state: QuorumState) -> dict:
    em = Emitter("risk")
    em.status("thinking")
    transcript = state.get("debate", [])
    ledger = state.get("ledger", [])
    vol = ((state.get("market") or {}).get("indicators") or {}).get("volatility_ann_pct")
    cap = volatility_cap(vol)

    auto = citation_checks(transcript, ledger)
    em.tool_call(
        "reflection.citation_check",
        {"turns": len(transcript), "ledger_items": len(ledger)},
        {"flags": auto, "volatility_ann_pct": vol, "volatility_cap_pct": cap},
        0.0,
    )
    review, llm = await llm_json(
        em,
        prompts.RISK_SYSTEM,
        prompts.risk_prompt(state["company"], state["symbol"], ledger_text(ledger), transcript, auto, vol, cap, state.get("as_of")),
        RiskReview,
        lambda: fallback.risk_review(auto, cap, vol, transcript),
    )

    flags = [{**f, "origin": "auto"} for f in auto]
    seen = {(f["round"], f["side"], f["issue"][:40].lower()) for f in flags}
    if llm == "gemini":
        for f in review.flags:
            key = (f.round, f.side, f.issue[:40].lower())
            if key not in seen:
                seen.add(key)
                flags.append({**f.model_dump(), "origin": "llm"})
    max_pos = round(min(review.max_position_pct, cap), 1)
    result = {
        "flags": flags,
        "max_position_pct": max_pos,
        "volatility_cap_pct": cap,
        "volatility_ann_pct": vol,
        "risk_level": review.risk_level,
        "notes": review.notes,
        "llm": llm,
    }
    em.output(result)
    em.status("done", llm=llm)
    return {"risk": result}
