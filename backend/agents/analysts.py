"""Agents 1-3 (run in parallel): Market Data, News, Fundamentals. Each is tool-using:
it calls a data tool, then asks the LLM to interpret the tool output."""

from __future__ import annotations

from ..data import fundamentals as fundamentals_tool
from ..data import market as market_tool
from ..data import news as news_tool
from ..llm import fallback
from . import prompts
from .common import Emitter, llm_json, llm_text, node, timed_tool
from .schemas import FundamentalsJudgement, NewsScoring
from .state import QuorumState, as_of_date, ref_of


@node("market_analyst", agent="market")
async def market_agent(state: QuorumState) -> dict:
    em = Emitter("market")
    em.status("thinking")
    ref, as_of = ref_of(state), as_of_date(state)

    df, source = await timed_tool(
        em,
        "yfinance.history",
        {"symbol": ref.yahoo, "period": "2y", "interval": "1d", "as_of": state.get("as_of")},
        lambda: market_tool.history_for(ref, as_of),
        lambda r: {"rows": len(r[0]), "from": r[0].index[0].date().isoformat(), "to": r[0].index[-1].date().isoformat(), "source": r[1]},
    )
    ind = await timed_tool(em, "compute_indicators", {"window": "6 months (52w for range)"}, lambda: market_tool.compute_indicators(df))
    em.emit("agent_data", data={"indicators": ind})

    text, llm = await llm_text(
        em,
        prompts.MARKET_SYSTEM,
        prompts.market_prompt(ref.name, ref.symbol, ind, state.get("as_of")),
        lambda: fallback.market_interpretation(ind, ref.name),
    )
    result = {"indicators": ind, "interpretation": text, "data_source": source, "llm": llm}
    em.output(result)
    em.status("done", llm=llm)
    return {"market": result}


def _aggregate(headlines: list[dict]) -> dict:
    if not headlines:
        return {"score": 0.0, "label": "neutral", "count": 0, "positive": 0, "negative": 0, "neutral": 0}
    scores = [h["score"] for h in headlines]
    avg = sum(scores) / len(scores)
    return {
        "score": round(avg, 3),
        "label": "positive" if avg > 0.1 else "negative" if avg < -0.1 else "neutral",
        "count": len(scores),
        "positive": sum(1 for s in scores if s >= 0.15),
        "negative": sum(1 for s in scores if s <= -0.15),
        "neutral": sum(1 for s in scores if -0.15 < s < 0.15),
    }


@node("news_analyst", agent="news")
async def news_agent(state: QuorumState) -> dict:
    em = Emitter("news")
    em.status("thinking")
    ref, as_of = ref_of(state), as_of_date(state)

    headlines, source, query = await timed_tool(
        em,
        "google_news_rss",
        {"query": news_tool.build_query(ref, as_of), "limit": 10},
        lambda: news_tool.get_headlines(ref, as_of, 10),
        lambda r: {"count": len(r[0]), "source": r[1], "titles": [h["title"] for h in r[0]]},
    )
    if not headlines:
        result = {
            "headlines": [], "aggregate": _aggregate([]), "summary": "No recent headlines were found, so news is treated as neutral.",
            "query": query, "data_source": source, "llm": "none",
        }
        em.output(result)
        em.status("done", llm="none")
        return {"news": result}

    em.emit("agent_data", data={"headlines": headlines})
    scoring, llm = await llm_json(
        em,
        prompts.NEWS_SYSTEM,
        prompts.news_prompt(ref.name, ref.symbol, headlines, state.get("as_of")),
        NewsScoring,
        lambda: fallback.score_headlines(headlines),
    )
    by_index = {s.index: s for s in scoring.scores}
    scored = []
    for i, h in enumerate(headlines):
        s = by_index.get(i)
        scored.append({**h, "score": round(s.score, 2) if s else 0.0, "reason": s.reason if s else "Not scored by the model"})
    result = {
        "headlines": scored, "aggregate": _aggregate(scored), "summary": scoring.summary,
        "query": query, "data_source": source, "llm": llm,
    }
    em.output(result)
    em.status("done", llm=llm)
    return {"news": result}


@node("fundamentals_analyst", agent="fundamentals")
async def fundamentals_agent(state: QuorumState) -> dict:
    em = Emitter("fundamentals")
    if not state.get("include_fundamentals", True):
        em.status("skipped", message="Excluded in strict evaluation mode (fundamentals snapshot is current, not point-in-time).")
        return {"fundamentals": None}
    em.status("thinking")
    ref = ref_of(state)

    fund, source = await timed_tool(
        em,
        "yfinance.info",
        {"symbol": ref.yahoo, "fields": ["trailingPE", "priceToBook", "debtToEquity", "revenueGrowth", "profitMargins", "marketCap"]},
        lambda: fundamentals_tool.get_fundamentals(ref),
        lambda r: {**r[0]["metrics"], "missing": r[0]["missing"], "source": r[1]},
    )
    em.emit("agent_data", data={"metrics": fund["metrics"], "missing": fund["missing"]})
    if all(v is None for v in fund["metrics"].values()):
        judgement = {"valuation": "fair", "reasons": ["No fundamental data was available", "Valuation cannot be assessed"], "summary": "Insufficient data; treated as neutral."}
        llm = "none"
    else:
        j, llm = await llm_json(
            em,
            prompts.FUNDAMENTALS_SYSTEM,
            prompts.fundamentals_prompt(ref.name, ref.symbol, fund, state.get("as_of")),
            FundamentalsJudgement,
            lambda: fallback.judge_valuation(fund),
        )
        judgement = j.model_dump()
    result = {**fund, "judgement": judgement, "data_source": source, "llm": llm}
    em.output(result)
    em.status("done", llm=llm)
    return {"fundamentals": result}
