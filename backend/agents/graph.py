"""The QUORUM LangGraph StateGraph.

    START ─┬─> market_analyst ───────┐
           ├─> news_analyst ─────────┼─> evidence_board -> bull -> bear ─┬─> bull (next round)
           └─> fundamentals_analyst ─┘                                    └─> risk_manager -> portfolio_manager -> paper_trade -> END

The three analysts run in the same super-step (in parallel); `evidence_board` waits for
all three. `bear -> bull` is a conditional edge that loops for N debate rounds.
"""

from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from .analysts import fundamentals_agent, market_agent, news_agent
from .debate import after_bear, bear_agent, bull_agent, evidence_board
from .portfolio_manager import paper_trade, portfolio_manager
from .risk import risk_manager
from .state import QuorumState

ANALYSTS = ["market_analyst", "news_analyst", "fundamentals_analyst"]


def build_graph():
    g = StateGraph(QuorumState)
    g.add_node("market_analyst", market_agent)
    g.add_node("news_analyst", news_agent)
    g.add_node("fundamentals_analyst", fundamentals_agent)
    g.add_node("evidence_board", evidence_board)
    g.add_node("bull", bull_agent)
    g.add_node("bear", bear_agent)
    g.add_node("risk_manager", risk_manager)
    g.add_node("portfolio_manager", portfolio_manager)
    g.add_node("paper_trade", paper_trade)

    for name in ANALYSTS:  # fan-out: parallel execution
        g.add_edge(START, name)
    g.add_edge(ANALYSTS, "evidence_board")  # fan-in: waits for all three
    g.add_edge("evidence_board", "bull")
    g.add_edge("bull", "bear")
    g.add_conditional_edges("bear", after_bear, {"bull": "bull", "risk_manager": "risk_manager"})
    g.add_edge("risk_manager", "portfolio_manager")
    g.add_edge("portfolio_manager", "paper_trade")
    g.add_edge("paper_trade", END)
    return g.compile()


@lru_cache(maxsize=1)
def get_graph():
    return build_graph()


def graph_topology() -> dict:
    """Nodes/edges straight from LangGraph, plus Mermaid source (used by the UI and README)."""
    g = get_graph().get_graph()
    nodes = [n for n in g.nodes]
    edges = [{"source": e.source, "target": e.target, "conditional": bool(e.conditional)} for e in g.edges]
    return {"nodes": nodes, "edges": edges, "mermaid": g.draw_mermaid()}
