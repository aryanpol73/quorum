"""Portfolio Manager (final decision, strict JSON) and the paper-trade execution node."""

from __future__ import annotations

from ..llm import fallback
from ..services import portfolio
from . import prompts
from .common import Emitter, llm_json, node, timed_tool
from .evidence import ledger_text
from .schemas import PMDecision
from .state import QuorumState


@node("portfolio_manager", agent="pm")
async def portfolio_manager(state: QuorumState) -> dict:
    em = Emitter("pm")
    em.status("thinking")
    symbol, price = state["symbol"], state["price"]
    risk = state.get("risk") or {"flags": [], "max_position_pct": 0.0, "risk_level": "high", "notes": "Risk review unavailable."}
    ledger = state.get("ledger", [])
    live = state.get("mode", "live") == "live"

    portfolio_ctx, memory, held = None, [], 0
    if live:
        snap, memory = await timed_tool(
            em,
            "portfolio.read_state_and_memory",
            {"ticker": symbol},
            lambda: (portfolio.snapshot({symbol: price}), portfolio.recent_decisions(symbol, 3)),
            lambda r: {"cash": r[0]["cash"], "total_value": r[0]["total_value"], "previous_decisions": r[1]},
        )
        held = next((h["qty"] for h in snap["holdings"] if h["ticker"] == symbol), 0)
        portfolio_ctx = {"cash": snap["cash"], "total_value": snap["total_value"], "held_qty": held}

    d, llm = await llm_json(
        em,
        prompts.PM_SYSTEM,
        prompts.pm_prompt(state["company"], symbol, price, ledger_text(ledger), state.get("debate", []), risk, portfolio_ctx, memory, state.get("as_of")),
        PMDecision,
        lambda: fallback.pm_decision(ledger, risk, held),
    )
    decision = d.model_dump()

    # Business rules applied after schema validation.
    adjustments = []
    cap = float(risk.get("max_position_pct", 0.0))
    if decision["decision"] == "BUY" and decision["position_size_pct"] > cap:
        adjustments.append(f"Position size clamped from {decision['position_size_pct']:.1f}% to the Risk Manager cap {cap:.1f}%.")
        decision["position_size_pct"] = cap
    if decision["decision"] != "BUY" and decision["position_size_pct"] != 0:
        adjustments.append(f"{decision['decision']} carries no new position; size set to 0%.")
        decision["position_size_pct"] = 0.0
    decision.update(
        {
            "adjustments": adjustments,
            "max_position_pct": cap,
            "price": price,
            "price_date": state.get("price_date"),
            "held_qty": held,
            "llm": llm,
        }
    )
    em.emit("verdict", decision=decision)
    em.output(decision)
    em.status("done", llm=llm)
    return {"decision": decision}


@node("paper_trade", agent="trade")
async def paper_trade(state: QuorumState) -> dict:
    em = Emitter("trade")
    decision = state.get("decision")
    if not state.get("execute_trade", True) or not decision:
        if not decision:
            reason = "No decision was produced."
        elif state.get("mode") == "eval":
            reason = "Evaluation mode: decisions are scored, not traded."
        else:
            reason = "Trade execution was disabled for this run."
        result = {"executed": False, "reason": reason}
        em.emit("trade", result=result)
        return {"trade": result}
    em.status("thinking")
    result = await timed_tool(
        em,
        "paper_broker.execute",
        {
            "ticker": state["symbol"], "decision": decision["decision"], "size_pct": decision["position_size_pct"],
            "price": state["price"], "price_date": state.get("price_date"),
        },
        lambda: portfolio.execute(
            state["symbol"], decision["decision"], decision["position_size_pct"], state["price"],
            state.get("price_date") or "", state["run_id"], decision["confidence"],
        ),
        lambda r: {k: v for k, v in r.items() if k != "portfolio"},
    )
    em.emit("trade", result=result)
    em.status("done")
    return {"trade": result}
