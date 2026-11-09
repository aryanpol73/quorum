"""SQLite persistence (SQLModel): paper trades, analysis runs (agent memory), evaluations."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import event
from sqlmodel import Field, Session, SQLModel, create_engine

from .config import get_settings


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Trade(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=_now)
    trade_date: str  # market date of the close price used
    ticker: str = Field(index=True)
    side: str  # BUY | SELL
    qty: int
    price: float
    value: float
    run_id: str | None = None
    confidence: int | None = None
    note: str = ""


class AnalysisRun(SQLModel, table=True):
    id: str = Field(primary_key=True)
    ts: datetime = Field(default_factory=_now)
    ticker: str = Field(index=True)
    mode: str = "live"  # live | eval
    as_of: str | None = None
    decision: str | None = None
    confidence: int | None = None
    position_size_pct: float | None = None
    max_position_pct: float | None = None
    price: float | None = None
    price_date: str | None = None
    llm_mode: str = "offline"
    rationale_json: str = "[]"
    result_json: str = "{}"


class EvaluationRun(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=_now)
    as_of: str
    horizon: int
    params_json: str = "{}"
    results_json: str = "{}"


_engine = None


def engine():
    global _engine
    if _engine is None:
        path = get_settings().db_path
        path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 15})

        @event.listens_for(_engine, "connect")
        def _pragma(dbapi_conn, _record):  # pragma: no cover - sqlite tuning
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

        SQLModel.metadata.create_all(_engine)
    return _engine


def session() -> Session:
    return Session(engine(), expire_on_commit=False)
