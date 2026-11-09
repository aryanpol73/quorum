"""Typed shared state for the LangGraph StateGraph."""

from __future__ import annotations

import operator
from datetime import date
from typing import Annotated, TypedDict

from ..tickers import TickerRef


class QuorumState(TypedDict, total=False):
    # run metadata
    run_id: str
    started_at: float
    mode: str  # "live" (trades) | "eval" (historical, no trades)
    as_of: str | None
    rounds: int
    include_fundamentals: bool
    execute_trade: bool
    # stock
    symbol: str
    yahoo: str
    company: str
    price: float
    price_date: str
    # agent outputs (parallel analysts write disjoint keys)
    market: dict | None
    news: dict | None
    fundamentals: dict | None
    ledger: list[dict]
    debate: Annotated[list[dict], operator.add]
    risk: dict
    decision: dict
    trade: dict
    # observability (reducers merge writes from parallel branches)
    trace: Annotated[list[dict], operator.add]
    errors: Annotated[list[str], operator.add]


def ref_of(state: QuorumState) -> TickerRef:
    return TickerRef(state["symbol"], state["yahoo"], state["company"], True)


def as_of_date(state: QuorumState) -> date | None:
    raw = state.get("as_of")
    return date.fromisoformat(raw) if raw else None
