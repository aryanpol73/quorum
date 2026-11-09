"""Evidence board (fan-in after the parallel analysts) and the Bull vs Bear debate loop."""

from __future__ import annotations

from ..llm import fallback
from . import prompts
from .common import Emitter, llm_text, node
from .evidence import build_ledger, extract_citations, ledger_text
from .state import QuorumState


@node("evidence_board", agent="evidence")
async def evidence_board(state: QuorumState) -> dict:
    """Join point: merges the three analyst outputs into one citable evidence ledger."""
    em = Emitter("evidence")
    ledger = build_ledger(state.get("market"), state.get("news"), state.get("fundamentals"))
    counts = {src: sum(1 for e in ledger if e["source"] == src) for src in ("market", "news", "fundamentals")}
    em.output({"ledger": ledger, "counts": counts})
    return {"ledger": ledger}


def _make_debater(side: str):
    @node(side, agent=side)
    async def debater(state: QuorumState) -> dict:
        transcript = list(state.get("debate", []))
        rounds = state.get("rounds", 3)
        round_no = sum(1 for t in transcript if t["side"] == side) + 1
        turn_id = f"r{round_no}-{side}"
        ledger = state.get("ledger", [])

        em = Emitter(side, turn=turn_id)
        em.status("thinking", round=round_no)
        em.emit("debate_turn_start", turn=turn_id, round=round_no, side=side)
        text, llm = await llm_text(
            em,
            prompts.DEBATE_SYSTEM[side],
            prompts.debate_prompt(
                side, round_no, rounds, state["company"], state["symbol"],
                ledger_text(ledger) or "(the ledger is empty)", transcript, state.get("as_of"),
            ),
            lambda: fallback.debate_argument(side, round_no, ledger, transcript),
        )
        valid, invalid = extract_citations(text, ledger)
        turn = {
            "id": turn_id, "round": round_no, "side": side, "text": text,
            "citations": valid, "invalid_citations": invalid, "llm": llm,
        }
        em.emit("debate_turn_end", turn=turn)
        em.status("done" if round_no >= rounds else "waiting", round=round_no, llm=llm)
        return {"debate": [turn]}

    debater.__name__ = f"{side}_agent"
    return debater


bull_agent = _make_debater("bull")
bear_agent = _make_debater("bear")


def after_bear(state: QuorumState) -> str:
    """Conditional edge: loop back to the Bull until all rounds are done."""
    bear_turns = sum(1 for t in state.get("debate", []) if t["side"] == "bear")
    return "bull" if bear_turns < state.get("rounds", 3) else "risk_manager"
