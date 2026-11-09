"""Shared plumbing for agent nodes: event emitter, node tracing, LLM-or-fallback helpers."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from functools import wraps
from typing import Any, Awaitable, Callable, TypeVar

from pydantic import BaseModel

from ..config import get_settings
from ..llm import LLMError, get_llm

log = logging.getLogger("quorum.agents")
M = TypeVar("M", bound=BaseModel)


def _writer() -> Callable[[dict], None]:
    try:
        from langgraph.config import get_stream_writer

        return get_stream_writer()
    except Exception:  # outside a graph run (e.g. unit use) -> drop events
        return lambda _event: None


class Emitter:
    """Streams typed events for one agent into the LangGraph `custom` stream."""

    def __init__(self, agent: str, turn: str | None = None):
        self.agent = agent
        self.turn = turn
        self._write = _writer()

    def emit(self, type_: str, **data: Any) -> None:
        self._write({"type": type_, "agent": self.agent, "ts": time.time(), **data})

    # StreamSink protocol (used by the LLM client)
    async def token(self, text: str) -> None:
        self.emit("token", text=text, turn=self.turn)

    async def reset(self, reason: str) -> None:
        self.emit("token_reset", reason=reason, turn=self.turn)

    async def notice(self, message: str, level: str = "info") -> None:
        self.emit("notice", message=f"{self.agent}: {message}", level=level)

    # convenience
    def status(self, status: str, **data: Any) -> None:
        self.emit("agent_status", status=status, **data)

    def tool_call(self, tool: str, args: dict, result: Any, ms: float, **data: Any) -> None:
        self.emit("tool_call", tool=tool, args=args, result=result, ms=round(ms, 1), **data)

    def output(self, data: dict) -> None:
        self.emit("agent_output", data=data)


async def timed_tool(em: Emitter, tool: str, args: dict, fn: Callable[[], Any], summarise: Callable[[Any], Any] | None = None):
    """Run a blocking data tool in a thread and log it to the trace as a tool call."""
    t0 = time.perf_counter()
    result = await asyncio.to_thread(fn)
    em.tool_call(tool, args, summarise(result) if summarise else result, (time.perf_counter() - t0) * 1000)
    return result


async def fake_stream(text: str, sink: Emitter, words_per_chunk: int = 3) -> None:
    """Stream offline-engine text in small chunks so the UI behaves like the LLM path."""
    delay = get_settings().offline_token_delay_s
    words = text.split(" ")
    for i in range(0, len(words), words_per_chunk):
        chunk = " ".join(words[i : i + words_per_chunk])
        await sink.token(chunk + (" " if i + words_per_chunk < len(words) else ""))
        if delay:
            await asyncio.sleep(delay)


async def llm_text(em: Emitter, system: str, prompt: str, fallback: Callable[[], str]) -> tuple[str, str]:
    """Streamed free text from Gemini, or the offline engine. Returns (text, source)."""
    llm = get_llm()
    if llm.available:
        try:
            return (await llm.stream(system=system, prompt=prompt, sink=em)).strip(), "gemini"
        except LLMError as exc:
            await em.notice(f"Gemini unavailable ({exc}); switched to the offline engine", "warn")
    text = fallback()
    await fake_stream(text, em)
    return text, "offline"


async def llm_json(em: Emitter, system: str, prompt: str, schema: type[M], fallback: Callable[[], M]) -> tuple[M, str]:
    """Strict JSON from Gemini (validated, one retry), or the offline engine."""
    llm = get_llm()
    if llm.available:
        try:
            return await llm.json(system=system, prompt=prompt, schema=schema, sink=em), "gemini"
        except LLMError as exc:
            await em.notice(f"Gemini unavailable ({exc}); switched to the offline engine", "warn")
    result = fallback()
    await fake_stream(json.dumps(result.model_dump(), ensure_ascii=False), em, words_per_chunk=6)
    return result, "offline"


def node(name: str, agent: str | None = None):
    """Decorator: emits node start/end events with timings and never lets a node crash
    the graph - failures are reported and the pipeline continues with what it has."""

    def deco(fn: Callable[[dict], Awaitable[dict]]):
        @wraps(fn)
        async def wrapper(state: dict) -> dict:
            write = _writer()
            started = state.get("started_at", time.time())
            t0 = time.time()
            write({"type": "node", "node": name, "phase": "start", "t": round(t0 - started, 3), "ts": t0})
            try:
                out = await fn(state) or {}
            except Exception as exc:  # defensive: report and continue
                log.exception("node %s failed", name)
                write({"type": "agent_status", "agent": agent or name, "status": "error", "message": str(exc)[:200], "ts": time.time()})
                write({"type": "notice", "level": "error", "message": f"{agent or name} failed: {str(exc)[:160]}", "ts": time.time()})
                out = {"errors": [f"{name}: {exc}"]}
            t1 = time.time()
            write({"type": "node", "node": name, "phase": "end", "t": round(t1 - started, 3), "ms": round((t1 - t0) * 1000), "ts": t1})
            out["trace"] = list(out.get("trace", [])) + [
                {"node": name, "start": round(t0 - started, 3), "end": round(t1 - started, 3), "ms": round((t1 - t0) * 1000)}
            ]
            return out

        return wrapper

    return deco
