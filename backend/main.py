"""FastAPI app: REST endpoints + Server-Sent Events streams for the agent pipeline.

Run from the repo root:  uvicorn backend.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import date
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .agents.graph import graph_topology
from .agents.runner import analyze
from .config import ROOT_DIR, get_settings
from .data import DataUnavailable, market
from .llm import get_llm
from .services import evaluation, portfolio
from .tickers import popular_list, resolve

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("quorum.api")

DISCLAIMER = "QUORUM is an educational simulation. Nothing here is financial advice."


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.engine()  # create tables
    s = get_settings()
    log.info("QUORUM ready | demo_mode=%s | llm=%s", s.demo_mode, get_llm().status)
    yield


app = FastAPI(title="QUORUM API", version="1.0.0", description=DISCLAIMER, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SSE_HEADERS = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}


async def sse(events: AsyncIterator[dict]) -> AsyncIterator[str]:
    """Serialise events as SSE `data:` frames, with keep-alive comments every 15s.
    The producer runs as a task so a client disconnect cancels the agent run."""
    queue: asyncio.Queue = asyncio.Queue()
    sentinel = object()

    async def pump() -> None:
        try:
            async for ev in events:
                await queue.put(ev)
        except Exception as exc:  # never leave the client hanging
            log.exception("stream failed")
            await queue.put({"type": "error", "message": f"Server error: {exc}"})
            await queue.put({"type": "done", "status": "error"})
        finally:
            await queue.put(sentinel)

    task = asyncio.create_task(pump())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=15)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if item is sentinel:
                break
            yield f"data: {json.dumps(item, default=str, ensure_ascii=False)}\n\n"
    finally:
        task.cancel()


# ------------------------------------------------------------------ meta
@app.get("/api/health")
def health() -> dict:
    s = get_settings()
    return {
        "status": "ok",
        "demo_mode": s.demo_mode,
        "llm": get_llm().status,
        "knowledge_cutoff": s.llm_knowledge_cutoff.isoformat(),
        "debate_rounds": s.debate_rounds,
        "initial_cash": s.initial_cash,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/tickers")
def tickers() -> list[dict]:
    return popular_list()


@app.get("/api/graph")
def graph() -> dict:
    return graph_topology()


# ------------------------------------------------------------------ market + analysis
@app.get("/api/chart/{ticker}")
async def chart(ticker: str) -> dict:
    ref = resolve(ticker)
    try:
        df, source = await asyncio.to_thread(market.history_for, ref)
    except DataUnavailable as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Price data unavailable: {exc}") from exc
    return {
        "ticker": ref.symbol,
        "yahoo": ref.yahoo,
        "company": ref.name,
        "source": source,
        "series": market.chart_series(df),
        "indicators": market.compute_indicators(df),
    }


@app.get("/api/analyze/{ticker}/stream")
async def analyze_stream(ticker: str, rounds: int | None = Query(default=None, ge=1, le=5)) -> StreamingResponse:
    return StreamingResponse(sse(analyze(ticker, rounds=rounds)), media_type="text/event-stream", headers=SSE_HEADERS)


@app.get("/api/runs")
def runs(limit: int = Query(default=20, ge=1, le=100)) -> list[dict]:
    return portfolio.runs(limit)


# ------------------------------------------------------------------ portfolio
@app.get("/api/portfolio")
async def get_portfolio() -> dict:
    return await asyncio.to_thread(portfolio.snapshot)


@app.get("/api/portfolio/history")
async def get_history() -> dict:
    return await asyncio.to_thread(portfolio.history)


@app.get("/api/trades")
def get_trades() -> list[dict]:
    return portfolio.trades()


@app.post("/api/portfolio/reset")
def reset_portfolio() -> dict:
    portfolio.reset()
    return {"ok": True, "message": "Portfolio reset to the initial cash balance."}


# ------------------------------------------------------------------ evaluation
@app.get("/api/evaluation/config")
async def eval_config(horizon: int = Query(default=10, ge=1, le=60)) -> dict:
    cfg = await asyncio.to_thread(evaluation.config)
    return {**cfg, **(await asyncio.to_thread(evaluation.default_dates, horizon)), "default_horizon": 10}


@app.get("/api/evaluation/latest")
def eval_latest() -> dict | None:
    return evaluation.latest()


@app.get("/api/evaluation/stream")
async def eval_stream(
    as_of: date = Query(...),
    horizon: int = Query(default=10, ge=1, le=60),
    include_fundamentals: bool = Query(default=False),
) -> StreamingResponse:
    return StreamingResponse(
        sse(evaluation.run(as_of, horizon, include_fundamentals)), media_type="text/event-stream", headers=SSE_HEADERS
    )


# ------------------------------------------------------------------ built frontend (optional)
DIST = ROOT_DIR / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        root = DIST.resolve()
        target = (root / path).resolve()
        if path and target.is_file() and root in target.parents:
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
