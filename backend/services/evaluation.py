"""Honest evaluation: agent decisions vs simple baselines on forward returns.

Look-ahead bias guard: evaluation dates must be AFTER LLM_KNOWLEDGE_CUTOFF, otherwise the
model may simply "remember" what happened next. Price data, indicators and news are all
truncated at the as-of date; fundamentals (a current snapshot, not point-in-time) are
excluded by default.
"""

from __future__ import annotations

import asyncio
import json
import random
import statistics
from datetime import date, timedelta
from typing import AsyncIterator

import pandas as pd
from sqlmodel import select

from .. import db
from ..agents.runner import analyze
from ..config import get_settings
from ..data import market
from ..llm import get_llm
from ..tickers import resolve

STRATEGIES = [
    ("agent", "QUORUM agents"),
    ("buy_hold", "Buy & hold"),
    ("rsi_rule", "RSI rule (<30 buy, >70 sell)"),
    ("random", "Random (expected)"),
]


def strategy_return(decision: str, r: float) -> float:
    return r if decision == "BUY" else -r if decision == "SELL" else 0.0


def is_hit(decision: str, r: float, band: float) -> bool:
    if decision == "BUY":
        return r > 0
    if decision == "SELL":
        return r < 0
    return abs(r) <= band


def rsi_rule(rsi: float | None) -> str:
    if rsi is None:
        return "HOLD"
    return "BUY" if rsi < 30 else "SELL" if rsi > 70 else "HOLD"


def _metrics(decisions: list[str], returns: list[float], band: float) -> dict:
    n = len(decisions)
    if n == 0:
        return {"n": 0, "hit_rate": None, "avg_return_pct": None, "counts": {"BUY": 0, "HOLD": 0, "SELL": 0}}
    hits = sum(is_hit(d, r, band) for d, r in zip(decisions, returns))
    rets = [strategy_return(d, r) for d, r in zip(decisions, returns)]
    return {
        "n": n,
        "hit_rate": round(hits / n * 100, 1),
        "avg_return_pct": round(sum(rets) / n * 100, 2),
        "counts": {k: decisions.count(k) for k in ("BUY", "HOLD", "SELL")},
    }


def compute_results(rows: list[dict], band: float, sims: int = 2000) -> dict:
    valid = [r for r in rows if r.get("fwd_return") is not None]
    rets = [r["fwd_return"] for r in valid]
    agent_rows = [r for r in valid if r.get("agent")]
    out = {
        "agent": _metrics([r["agent"] for r in agent_rows], [r["fwd_return"] for r in agent_rows], band),
        "buy_hold": _metrics(["BUY"] * len(valid), rets, band),
        "rsi_rule": _metrics([r["rsi_rule"] for r in valid], rets, band),
    }
    # Random: expected value over many seeded simulations, plus a 90% band to show noise.
    rng = random.Random(42)
    hit_rates, avg_rets = [], []
    for _ in range(sims if valid else 0):
        picks = [rng.choice(("BUY", "HOLD", "SELL")) for _ in valid]
        m = _metrics(picks, rets, band)
        hit_rates.append(m["hit_rate"])
        avg_rets.append(m["avg_return_pct"])
    if hit_rates:
        qs = statistics.quantiles(hit_rates, n=20)
        out["random"] = {
            "n": len(valid),
            "hit_rate": round(statistics.mean(hit_rates), 1),
            "avg_return_pct": round(statistics.mean(avg_rets), 2),
            "hit_rate_p5": round(qs[0], 1),
            "hit_rate_p95": round(qs[-1], 1),
            "counts": None,
        }
    else:
        out["random"] = {"n": 0, "hit_rate": None, "avg_return_pct": None, "counts": None}
    return {
        "strategies": [{"key": k, "name": name, **out[k]} for k, name in STRATEGIES],
        "rows": rows,
    }


def default_dates(horizon: int) -> dict:
    """Latest as-of date that still has `horizon` trading days of forward data."""
    settings = get_settings()
    cutoff = settings.llm_knowledge_cutoff
    try:
        nifty, _ = market.get_history(market.NIFTY_SYMBOL)
        idx = nifty.index
        max_as_of = idx[-(horizon + 1)].date() if len(idx) > horizon else None
    except Exception:
        max_as_of = date.today() - timedelta(days=int(horizon * 1.5) + 3)
    return {
        "knowledge_cutoff": cutoff.isoformat(),
        "min_as_of": (cutoff + timedelta(days=1)).isoformat(),
        "max_as_of": max_as_of.isoformat() if max_as_of else None,
        "default_as_of": max_as_of.isoformat() if max_as_of else None,
    }


def config() -> dict:
    s = get_settings()
    return {
        **default_dates(10),
        "default_horizon": 10,
        "tickers": s.eval_tickers,
        "debate_rounds": s.eval_debate_rounds,
        "hold_band_pct": s.eval_hold_band * 100,
        "llm": get_llm().status,
        "demo_mode": s.demo_mode,
    }


def latest() -> dict | None:
    with db.session() as s:
        row = s.exec(select(db.EvaluationRun).order_by(db.EvaluationRun.ts.desc()).limit(1)).first()
    if not row:
        return None
    return {"id": row.id, "ts": row.ts.isoformat(), "params": json.loads(row.params_json), **json.loads(row.results_json)}


def _save(params: dict, results: dict) -> int:
    with db.session() as s:
        row = db.EvaluationRun(as_of=params["as_of"], horizon=params["horizon"], params_json=json.dumps(params), results_json=json.dumps(results, default=str))
        s.add(row)
        s.commit()
        s.refresh(row)
        return row.id


async def run(as_of: date, horizon: int, include_fundamentals: bool = False) -> AsyncIterator[dict]:
    settings = get_settings()
    tickers = settings.eval_tickers
    cutoff = settings.llm_knowledge_cutoff
    band = settings.eval_hold_band
    params = {
        "as_of": as_of.isoformat(), "horizon": horizon, "tickers": tickers, "knowledge_cutoff": cutoff.isoformat(),
        "include_fundamentals": include_fundamentals, "debate_rounds": settings.eval_debate_rounds,
        "hold_band_pct": band * 100, "llm": get_llm().status,
    }
    yield {"type": "eval_start", "params": params}
    if as_of <= cutoff:
        yield {
            "type": "error",
            "message": f"As-of date {as_of} is not after the LLM knowledge cutoff {cutoff}. The model may already "
            "know what happened next (look-ahead bias), so this evaluation is refused.",
        }
        yield {"type": "done", "status": "error"}
        return
    if horizon < 1 or horizon > 60:
        yield {"type": "error", "message": "Horizon must be between 1 and 60 trading days."}
        yield {"type": "done", "status": "error"}
        return

    rows: list[dict] = []
    for i, sym in enumerate(tickers):
        ref = resolve(sym)
        base = {"ticker": ref.symbol, "index": i, "total": len(tickers)}
        yield {"type": "eval_progress", **base, "stage": "data"}
        row: dict = {"ticker": ref.symbol, "agent": None, "fwd_return": None, "note": None}
        try:
            df, _ = await asyncio.to_thread(market.get_history, ref.yahoo, ref.symbol)
        except Exception as exc:
            row["note"] = f"no price data ({exc})"
            rows.append(row)
            yield {"type": "eval_row", "row": row}
            continue
        past = df[df.index <= pd.Timestamp(as_of)]
        future = df[df.index > (past.index[-1] if len(past) else pd.Timestamp(as_of))]
        if len(past) < 60:
            row["note"] = "not enough history before the as-of date"
        elif len(future) < horizon:
            row["note"] = f"only {len(future)} trading days after the as-of date (need {horizon})"
        if row["note"]:
            rows.append(row)
            yield {"type": "eval_row", "row": row}
            continue

        d0 = past.index[-1]
        entry, exit_ = float(past["Close"].iloc[-1]), float(future["Close"].iloc[horizon - 1])
        rsi_val = market.rsi(past["Close"]).iloc[-1]
        rsi_val = None if pd.isna(rsi_val) else round(float(rsi_val), 1)
        row.update(
            {
                "as_of": d0.date().isoformat(), "exit_date": future.index[horizon - 1].date().isoformat(),
                "entry": round(entry, 2), "exit": round(exit_, 2), "fwd_return": round(exit_ / entry - 1, 5),
                "rsi": rsi_val, "rsi_rule": rsi_rule(rsi_val),
            }
        )

        yield {"type": "eval_progress", **base, "stage": "agents"}
        async for ev in analyze(
            ref.symbol, as_of=d0.date(), rounds=settings.eval_debate_rounds,
            include_fundamentals=include_fundamentals, execute_trade=False, persist=True,
        ):
            if ev["type"] == "agent_status":
                yield {"type": "eval_agent", **base, "agent": ev.get("agent"), "status": ev.get("status")}
            elif ev["type"] == "error":
                row["note"] = ev.get("message")
            elif ev["type"] == "done" and ev.get("status") == "ok":
                d = ev["result"].get("decision") or {}
                row.update({"agent": d.get("decision"), "confidence": d.get("confidence"), "llm_mode": ev.get("llm_mode"), "run_id": ev.get("run_id")})
        rows.append(row)
        yield {"type": "eval_row", "row": row}

    results = compute_results(rows, band)
    eval_id = await asyncio.to_thread(_save, params, results)
    yield {"type": "eval_done", "id": eval_id, "params": params, **results}
    yield {"type": "done", "status": "ok"}
