"""Self-test: `python -m backend.selftest`

Runs without network or API key (uses DEMO_MODE data):
  1. the full LangGraph pipeline on the offline engine,
  2. the Gemini code path against a scripted fake Gemini (token streaming, strict JSON,
     the invalid-JSON -> retry-once path, citations),
  3. evaluation metric maths and the look-ahead (knowledge cutoff) guard.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from datetime import date
from pathlib import Path
from types import SimpleNamespace

os.environ["DEMO_MODE"] = "true"
os.environ["OFFLINE_TOKEN_DELAY"] = "0"
os.environ["DB_PATH"] = str(Path(tempfile.mkdtemp()) / "selftest.db")
os.environ.setdefault("GEMINI_API_KEY", "")

from google.genai import types  # noqa: E402

from .agents.runner import analyze  # noqa: E402
from .agents.schemas import FundamentalsJudgement, NewsScoring, PMDecision, RiskReview  # noqa: E402
from .llm import client as llm_client  # noqa: E402
from .services import evaluation  # noqa: E402

PASS = "\033[32mPASS\033[0m" if sys.stdout.isatty() else "PASS"


async def collect(ticker: str, **kw) -> list[dict]:
    return [ev async for ev in analyze(ticker, **kw)]


def check(cond: bool, label: str) -> None:
    if not cond:
        raise AssertionError(label)
    print(f"  {PASS} {label}")


class FakeModels:
    """Stands in for client.aio.models: replies per response_schema, streamed in chunks."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.pm_attempts = 0

    def _reply(self, schema, contents: str) -> str:
        if schema is None:
            side = "bull" if "Bull Agent" in contents or "FOR buying" in contents else "debater"
            return f"As the {side}, the trend is constructive [T2] and momentum is positive [T1]; the 52-week position also matters [T6]."
        if schema is NewsScoring:
            n = contents.count("\n") // 2 or 3
            return json.dumps({"scores": [{"index": i, "score": 0.2, "reason": "Mildly positive"} for i in range(n)], "summary": "Mixed but leaning positive. Nothing decisive."})
        if schema is FundamentalsJudgement:
            return json.dumps({"valuation": "fair", "reasons": ["P/E is mid-range", "Margins are healthy"], "summary": "Fairly valued."})
        if schema is RiskReview:
            return json.dumps({"flags": [{"round": 1, "side": "bear", "issue": "Leans on a single headline.", "severity": "low"}], "max_position_pct": 19.5, "risk_level": "medium", "notes": "Moderate risk."})
        if schema is PMDecision:
            self.pm_attempts += 1
            if self.pm_attempts == 1:  # deliberately invalid: confidence > 100 and only 2 bullets
                return json.dumps({"decision": "BUY", "confidence": 150, "position_size_pct": 12, "rationale": ["a", "b"]})
            return json.dumps({"decision": "BUY", "confidence": 61, "position_size_pct": 30 / 2, "rationale": ["Trend up [T2]", "News positive [N0]", "Risk capped"]})
        raise ValueError(schema)

    async def generate_content_stream(self, *, model, contents, config):
        schema = getattr(config, "response_schema", None)
        self.calls.append(getattr(schema, "__name__", "text"))
        text = self._reply(schema, contents)

        async def gen():
            for i in range(0, len(text), 24):
                part = types.Part(text=text[i : i + 24])
                yield types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[part]))])

        return gen()


async def main() -> int:
    print("1) Offline pipeline (DEMO_MODE, no API key)")
    events = await collect("INFY", rounds=2, execute_trade=True)
    types_seen = {e["type"] for e in events}
    done = events[-1]
    check(done["type"] == "done" and done["status"] == "ok", "run completes with status ok")
    check({"run_start", "node", "tool_call", "token", "debate_turn_end", "verdict", "trade"} <= types_seen, "all event types streamed")
    starts = [e for e in events if e["type"] == "node" and e["phase"] == "start"]
    analysts = [e["t"] for e in starts if e["node"].endswith("_analyst")]
    check(len(analysts) == 3 and max(analysts) - min(analysts) < 0.5, "three analysts start in the same super-step (parallel)")
    turns = [e["turn"] for e in events if e["type"] == "debate_turn_end"]
    check(len(turns) == 4 and all(t["citations"] for t in turns), "2 rounds x 2 debaters, every argument cites evidence")
    check(done["result"]["decision"]["decision"] in ("BUY", "HOLD", "SELL"), "Portfolio Manager produced a decision")

    print("2) Gemini path with a scripted fake model")
    llm = llm_client.get_llm()
    fake = FakeModels()
    llm._client = SimpleNamespace(aio=SimpleNamespace(models=fake))
    llm._disabled_reason = None
    llm._cooldown_until = 0.0
    events = await collect("TATAMOTORS", rounds=1, execute_trade=False, persist=False)
    done = events[-1]
    check(done["status"] == "ok" and done["llm_mode"] == "gemini", "all agents ran on the Gemini path")
    notices = [e["message"] for e in events if e["type"] == "notice"]
    check(any("failed Pydantic validation" in n for n in notices), "invalid PM JSON detected and retried once")
    check(fake.pm_attempts == 2, "exactly one retry for invalid JSON")
    decision = done["result"]["decision"]
    risk = done["result"]["risk"]
    check(risk["max_position_pct"] <= risk["volatility_cap_pct"], "risk cap clamped to the volatility-scaled cap")
    check(decision["position_size_pct"] <= risk["max_position_pct"], "PM size clamped to the Risk Manager cap")
    check(any(f["origin"] == "llm" for f in risk["flags"]), "LLM reflection flags merged with automatic checks")
    tokens = [e for e in events if e["type"] == "token"]
    check(len(tokens) > 20, f"tokens streamed in chunks ({len(tokens)} chunks)")
    llm._client = None
    llm._disabled_reason = "selftest finished"

    print("3) Evaluation maths and look-ahead guard")
    rows = [
        {"ticker": "A", "fwd_return": 0.05, "agent": "BUY", "rsi_rule": "HOLD"},
        {"ticker": "B", "fwd_return": -0.03, "agent": "SELL", "rsi_rule": "BUY"},
        {"ticker": "C", "fwd_return": 0.01, "agent": "HOLD", "rsi_rule": "SELL"},
        {"ticker": "D", "fwd_return": 0.04, "agent": "SELL", "rsi_rule": "HOLD"},
    ]
    res = {s["key"]: s for s in evaluation.compute_results(rows, band=0.02)["strategies"]}
    check(res["agent"]["hit_rate"] == 75.0, "agent hit rate = 3/4")
    check(res["agent"]["avg_return_pct"] == round((0.05 + 0.03 + 0 - 0.04) / 4 * 100, 2), "agent average return (shorts earn the inverse)")
    check(res["buy_hold"]["hit_rate"] == 75.0, "buy & hold hit rate")
    check(res["random"]["hit_rate_p5"] <= res["random"]["hit_rate"] <= res["random"]["hit_rate_p95"], "random baseline has a noise band")
    guard = [ev async for ev in evaluation.run(date(2020, 1, 1), 10)]
    check(any(ev["type"] == "error" and "look-ahead" in ev["message"] for ev in guard), "dates before LLM_KNOWLEDGE_CUTOFF are refused")

    print("\nAll self-tests passed.")
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass
    sys.exit(asyncio.run(main()))
