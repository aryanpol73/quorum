"""Command-line runner: `python -m backend.cli INFY`.

Prints every agent event as it streams (tool calls, debate tokens, risk flags, verdict,
paper trade) so the full pipeline can be verified without the frontend.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import textwrap
from datetime import date

C = {"g": "\033[32m", "r": "\033[31m", "y": "\033[33m", "c": "\033[36m", "m": "\033[35m", "d": "\033[2m", "b": "\033[1m", "x": "\033[0m"}
AGENT_COLOR = {"market": "c", "news": "m", "fundamentals": "c", "bull": "g", "bear": "r", "risk": "y", "pm": "b", "trade": "b"}


def col(text: str, key: str) -> str:
    return f"{C[key]}{text}{C['x']}" if sys.stdout.isatty() else text


def wrap(text: str, indent: str = "    ") -> str:
    return textwrap.fill(text, width=100, initial_indent=indent, subsequent_indent=indent)


async def main(args: argparse.Namespace) -> int:
    if args.demo:
        os.environ["DEMO_MODE"] = "true"
    if args.offline:
        os.environ["GEMINI_API_KEY"] = ""
    from .agents.runner import analyze  # imported after env overrides

    as_of = date.fromisoformat(args.as_of) if args.as_of else None
    streaming_turn: str | None = None
    status = 1
    async for ev in analyze(args.ticker, as_of=as_of, rounds=args.rounds, execute_trade=not args.no_trade):
        if args.json:
            print(json.dumps(ev, default=str, ensure_ascii=False))
            if ev["type"] == "done":
                status = 0 if ev.get("status") == "ok" else 1
            continue
        t, agent = ev["type"], ev.get("agent", "")
        stamp = col(f"[{ev.get('t', 0):6.2f}s]", "d")
        if t == "token":
            if agent in ("bull", "bear"):
                if streaming_turn != ev.get("turn"):
                    streaming_turn = ev.get("turn")
                print(ev["text"], end="", flush=True)
            continue
        if streaming_turn and t != "token":
            print()
            streaming_turn = None
        if t == "run_start":
            llm = ev["llm"]
            print(col(f"\nQUORUM :: {ev['company']} ({ev['ticker']} -> {ev['yahoo']})", "b"))
            print(f"  price ₹{ev['price']:,.2f} ({ev['price_date']}), data={ev['data_source']}, "
                  f"LLM={llm['model']} [{llm['state']}], rounds={ev['rounds']}, mode={ev['mode']}")
        elif t == "notice":
            print(f"{stamp} {col('NOTICE', 'y')} {ev['message']}")
        elif t == "error":
            print(f"{stamp} {col('ERROR', 'r')} {ev['message']}")
        elif t == "node" and ev["phase"] == "start":
            print(f"{stamp} {col('>> node', 'd')} {ev['node']}")
        elif t == "agent_status" and ev["status"] in ("done", "skipped", "error"):
            extra = f" via {ev['llm']}" if ev.get("llm") else ""
            print(f"{stamp} {col(agent, AGENT_COLOR.get(agent, 'x'))} {ev['status']}{extra}")
        elif t == "tool_call":
            res = json.dumps(ev["result"], default=str, ensure_ascii=False)
            print(f"{stamp}   {col('tool', 'd')} {ev['tool']}({json.dumps(ev['args'], ensure_ascii=False)[:90]}) {ev['ms']}ms")
            print(col(f"      -> {res[:220]}{'...' if len(res) > 220 else ''}", "d"))
        elif t == "agent_output":
            d = ev["data"]
            if agent == "market":
                print(wrap(d["interpretation"]))
            elif agent == "news":
                a = d["aggregate"]
                print(f"    sentiment {a['score']:+.2f} ({a['label']}, {a['count']} headlines)")
                for h in d["headlines"][:10]:
                    print(f"      {h['score']:+.2f}  {h['title'][:88]}")
            elif agent == "fundamentals":
                j = d["judgement"]
                print(f"    valuation: {j['valuation'].upper()} - {j['summary']}")
                print(f"    metrics: {json.dumps(d['metrics'])}  missing: {d['missing']}")
            elif agent == "evidence":
                print(f"    ledger: {len(d['ledger'])} items {d['counts']}")
            elif agent == "risk":
                print(f"    max position {d['max_position_pct']}% (vol cap {d['volatility_cap_pct']}%, vol {d['volatility_ann_pct']}%), risk {d['risk_level']}")
                for f in d["flags"]:
                    print(col(f"      ! R{f['round']} {f['side']}: {f['issue']} [{f['severity']}, {f['origin']}]", "y"))
                print(wrap(d["notes"]))
        elif t == "debate_turn_start":
            print(col(f"\n  ── Round {ev['round']} · {ev['side'].upper()} ──", AGENT_COLOR[ev["side"]]))
            print("    ", end="")
        elif t == "debate_turn_end":
            turn = ev["turn"]
            bad = f" INVALID: {turn['invalid_citations']}" if turn["invalid_citations"] else ""
            print(col(f"    cites: {', '.join(turn['citations']) or 'none'}{bad}", "d"))
        elif t == "verdict":
            d = ev["decision"]
            colour = {"BUY": "g", "SELL": "r", "HOLD": "y"}[d["decision"]]
            print(col(f"\n  VERDICT: {d['decision']}  confidence {d['confidence']}  size {d['position_size_pct']}% (cap {d['max_position_pct']}%)", colour))
            for r in d["rationale"]:
                print(wrap(f"• {r}"))
            for a in d.get("adjustments", []):
                print(col(f"    adjusted: {a}", "d"))
        elif t == "trade":
            r = ev["result"]
            if r.get("executed"):
                tr = r["trade"]
                print(col(f"  TRADE: {tr['side']} {tr['qty']} x {tr['ticker']} @ ₹{tr['price']:,.2f} = ₹{tr['value']:,.2f}", "b"))
            else:
                print(f"  TRADE: none - {r.get('reason')}")
            if r.get("portfolio"):
                p = r["portfolio"]
                print(f"  Portfolio: cash ₹{p['cash']:,.2f} | total ₹{p['total_value']:,.2f} | P&L ₹{p['pnl']:,.2f} ({p['pnl_pct']:+.2f}%)")
        elif t == "done":
            status = 0 if ev.get("status") == "ok" else 1
            if ev.get("status") == "ok":
                trace = ev["result"]["trace"]
                print(col(f"\n  done in {ev['total_ms'] / 1000:.1f}s · LLM mode: {ev['llm_mode']} · {len(trace)} node executions", "d"))
                order = " -> ".join(f"{n['node']}({n['ms']}ms)" for n in sorted(trace, key=lambda n: n["start"]))
                print(wrap(order, "  "))
    print(col("\n  Educational simulation only - not financial advice.\n", "d"))
    return status


def run() -> None:
    parser = argparse.ArgumentParser(prog="python -m backend.cli", description="Run the QUORUM agent pipeline for one NSE ticker.")
    parser.add_argument("ticker", help="NSE symbol, e.g. INFY, TATAMOTORS, RELIANCE")
    parser.add_argument("--rounds", type=int, default=None, help="debate rounds (default: DEBATE_ROUNDS or 3)")
    parser.add_argument("--no-trade", action="store_true", help="do not execute the paper trade")
    parser.add_argument("--demo", action="store_true", help="force DEMO_MODE (cached data)")
    parser.add_argument("--offline", action="store_true", help="ignore GEMINI_API_KEY and use the offline engine")
    parser.add_argument("--as-of", help="historical analysis date YYYY-MM-DD (no trade)")
    parser.add_argument("--json", action="store_true", help="print raw events as JSON lines")
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass
    if os.name == "nt":
        os.system("")  # enable ANSI colours on Windows terminals
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    sys.exit(asyncio.run(main(args)))


if __name__ == "__main__":
    run()
