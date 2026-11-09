"""Runs the graph for one ticker and yields a flat stream of UI/CLI events."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from datetime import date
from typing import AsyncIterator

from .. import db
from ..config import get_settings
from ..data import DataUnavailable
from ..data import fundamentals as fundamentals_tool
from ..data import market
from ..llm import get_llm
from ..tickers import TickerRef, resolve
from .graph import get_graph

log = logging.getLogger("quorum.runner")
SYMBOL_RE = re.compile(r"^[A-Z0-9&\-]{1,20}$")


def _llm_mix(final: dict) -> str:
    sources = []
    for key in ("market", "news", "fundamentals", "risk", "decision"):
        part = final.get(key) or {}
        if part.get("llm") in ("gemini", "offline"):
            sources.append(part["llm"])
    sources += [t.get("llm") for t in final.get("debate", []) if t.get("llm")]
    uniq = set(sources)
    if not uniq:
        return "none"
    return uniq.pop() if len(uniq) == 1 else "mixed"


def _save_run(run_id: str, final: dict, llm_mode: str) -> None:
    decision = final.get("decision") or {}
    risk = final.get("risk") or {}
    stored = {k: final.get(k) for k in ("market", "news", "fundamentals", "ledger", "debate", "risk", "decision", "trace", "errors")}
    trade = dict(final.get("trade") or {})
    trade.pop("portfolio", None)
    stored["trade"] = trade
    row = db.AnalysisRun(
        id=run_id,
        ticker=final["symbol"],
        mode=final.get("mode", "live"),
        as_of=final.get("as_of"),
        decision=decision.get("decision"),
        confidence=decision.get("confidence"),
        position_size_pct=decision.get("position_size_pct"),
        max_position_pct=risk.get("max_position_pct"),
        price=final.get("price"),
        price_date=final.get("price_date"),
        llm_mode=llm_mode,
        rationale_json=json.dumps(decision.get("rationale", [])),
        result_json=json.dumps(stored, default=str),
    )
    with db.session() as s:
        s.add(row)
        s.commit()


async def analyze(
    ticker: str,
    *,
    as_of: date | None = None,
    rounds: int | None = None,
    include_fundamentals: bool = True,
    execute_trade: bool = True,
    persist: bool = True,
) -> AsyncIterator[dict]:
    settings = get_settings()
    rounds = rounds or settings.debate_rounds
    mode = "eval" if as_of else "live"
    ref = resolve(ticker)
    run_id = uuid.uuid4().hex[:12]
    started = time.time()
    llm = get_llm()

    def ev(type_: str, **data) -> dict:
        now = time.time()
        return {"type": type_, "run_id": run_id, "ts": now, "t": round(now - started, 3), **data}

    if not SYMBOL_RE.match(ref.symbol):
        yield ev("error", message=f"'{ticker}' is not a valid NSE symbol.")
        yield ev("done", status="error")
        return

    # Pre-flight: make sure price data exists before convening the agents.
    try:
        df, source = await asyncio.to_thread(market.history_for, ref, as_of)
    except DataUnavailable as exc:
        yield ev("error", message=str(exc))
        yield ev("done", status="error")
        return
    except Exception as exc:  # unexpected data-layer failure
        log.exception("pre-flight failed")
        yield ev("error", message=f"Could not load data for {ref.symbol}: {exc}")
        yield ev("done", status="error")
        return

    if not ref.known:  # unknown symbol: use the official company name for the news search
        try:
            fund, _ = await asyncio.to_thread(fundamentals_tool.get_fundamentals, ref)
            if fund.get("name"):
                ref = TickerRef(ref.symbol, ref.yahoo, fund["name"], False)
        except Exception:
            pass

    price = round(float(df["Close"].iloc[-1]), 2)
    price_date = df.index[-1].date().isoformat()
    yield ev(
        "run_start",
        ticker=ref.symbol, yahoo=ref.yahoo, company=ref.name, mode=mode, as_of=as_of.isoformat() if as_of else None,
        rounds=rounds, price=price, price_date=price_date, data_source=source, llm=llm.status, demo_mode=settings.demo_mode,
        include_fundamentals=include_fundamentals,
    )
    if source == "demo":
        yield ev("notice", level="info", message=f"Using cached demo data for {ref.symbol} (DEMO_MODE or live API unavailable).")
    if not llm.available:
        reason = llm.status.get("reason") or "temporarily unavailable"
        yield ev("notice", level="warn", message=f"Gemini offline ({reason}) - agents are using the rule-based offline engine.")

    state = {
        "run_id": run_id, "started_at": started, "mode": mode, "as_of": as_of.isoformat() if as_of else None,
        "rounds": rounds, "include_fundamentals": include_fundamentals, "execute_trade": execute_trade and mode == "live",
        "symbol": ref.symbol, "yahoo": ref.yahoo, "company": ref.name, "price": price, "price_date": price_date,
        "debate": [], "trace": [], "errors": [],
    }

    final: dict = {}
    try:
        async for stream_mode, chunk in get_graph().astream(state, stream_mode=["custom", "values"]):
            if stream_mode == "custom":
                yield {**chunk, "run_id": run_id, "t": round(chunk.get("ts", time.time()) - started, 3)}
            else:
                final = chunk
    except Exception as exc:
        log.exception("graph run failed")
        yield ev("error", message=f"Agent pipeline failed: {exc}")
        yield ev("done", status="error")
        return

    llm_mode = _llm_mix(final)
    if persist and final.get("decision"):
        try:
            await asyncio.to_thread(_save_run, run_id, final, llm_mode)
        except Exception as exc:
            log.warning("could not persist run: %s", exc)

    trade = dict(final.get("trade") or {})
    yield ev(
        "done",
        status="ok",
        total_ms=round((time.time() - started) * 1000),
        llm_mode=llm_mode,
        result={
            "ticker": ref.symbol, "company": ref.name, "price": price, "price_date": price_date, "as_of": state["as_of"],
            "decision": final.get("decision"), "risk": final.get("risk"), "trade": trade,
            "trace": final.get("trace", []), "errors": final.get("errors", []),
            "rsi14": ((final.get("market") or {}).get("indicators") or {}).get("rsi14"),
        },
    )
