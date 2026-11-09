"""System prompts and prompt builders for every agent."""

from __future__ import annotations

import json

GUARDRAIL = (
    "This is an educational simulation, not financial advice. Use only the data you are given; "
    "never invent prices, figures, events or news. Be concise and factual."
)

MARKET_SYSTEM = (
    "You are the Market Data Agent on an NSE (India) equity research desk. You interpret technical "
    "indicators that your tools have already computed. " + GUARDRAIL
)

NEWS_SYSTEM = (
    "You are the News Analyst Agent on an NSE equity research desk. You score how each headline is "
    "likely to affect the company's share price over the next few weeks. Score -1 (very negative) to "
    "+1 (very positive); 0 means neutral or not about this company. " + GUARDRAIL
)

FUNDAMENTALS_SYSTEM = (
    "You are the Fundamentals Agent on an NSE equity research desk. You judge valuation as cheap, fair "
    "or expensive relative to the company's own sector and Indian market norms, citing the metrics. "
    "If a metric is missing, say so instead of guessing. " + GUARDRAIL
)

DEBATE_SYSTEM = {
    "bull": (
        "You are the Bull Agent in a structured investment debate. You argue the case FOR buying the stock. "
        "Rules: (1) use ONLY evidence from the ledger; (2) cite the evidence ID in square brackets right "
        "after each claim, e.g. [T2] or [N3]; (3) never invent numbers or facts; (4) when the Bear has spoken, "
        "rebut their most recent argument directly before adding new points. " + GUARDRAIL
    ),
    "bear": (
        "You are the Bear Agent in a structured investment debate. You argue the case AGAINST buying the stock "
        "(sell or avoid). Rules: (1) use ONLY evidence from the ledger; (2) cite the evidence ID in square "
        "brackets right after each claim, e.g. [T1] or [F2]; (3) never invent numbers or facts; (4) rebut the "
        "Bull's most recent argument directly before adding new points. " + GUARDRAIL
    ),
}

RISK_SYSTEM = (
    "You are the Risk Manager. You perform a reflection step on a Bull vs Bear debate: identify arguments "
    "that are weak, unsupported by the cited evidence, misrepresent the evidence, or ignore an important "
    "counter-signal. You also set the maximum position size (0-20% of portfolio) and must not exceed the "
    "volatility-scaled cap you are given. " + GUARDRAIL
)

PM_SYSTEM = (
    "You are the Portfolio Manager and make the final call: BUY, HOLD or SELL. Weigh the debate, discount "
    "arguments the Risk Manager flagged, and calibrate confidence honestly (conflicting or thin evidence "
    "means 40-60). position_size_pct is the target weight in the portfolio and must not exceed the Risk "
    "Manager's max; use 0 for HOLD and SELL. Give exactly three short rationale bullets that cite ledger IDs. "
    + GUARDRAIL
)


def _as_of_line(as_of: str | None) -> str:
    return f"Analysis date: {as_of}. Treat this as 'today'; you know nothing after it.\n" if as_of else ""


def market_prompt(company: str, symbol: str, ind: dict, as_of: str | None) -> str:
    return (
        f"{_as_of_line(as_of)}Stock: {company} (NSE: {symbol}).\n"
        f"Indicators computed from daily OHLCV:\n{json.dumps(ind, indent=1)}\n\n"
        "Write a 3-4 sentence interpretation covering trend (price vs SMA20/SMA50), momentum (RSI, MACD), "
        "volume and position in the 52-week range. Plain text, no markdown, no recommendation."
    )


def news_prompt(company: str, symbol: str, headlines: list[dict], as_of: str | None) -> str:
    lines = "\n".join(
        f"{i}. {h['title']} ({h.get('source') or 'unknown source'}, {(h.get('published') or '')[:10]})"
        for i, h in enumerate(headlines)
    )
    return (
        f"{_as_of_line(as_of)}Company: {company} (NSE: {symbol}).\nHeadlines:\n{lines}\n\n"
        "Return JSON with one score per headline (use the 0-based index shown), a one-line reason "
        "(max 20 words) each, and a two-sentence summary of the overall news flow."
    )


def fundamentals_prompt(company: str, symbol: str, fund: dict, as_of: str | None) -> str:
    return (
        f"{_as_of_line(as_of)}Company: {company} (NSE: {symbol}). Sector: {fund.get('sector') or 'unknown'}, "
        f"industry: {fund.get('industry') or 'unknown'}.\n"
        f"Metrics (None = missing): {json.dumps(fund.get('metrics'), indent=1)}\n"
        f"Missing fields: {', '.join(fund.get('missing') or []) or 'none'}\n\n"
        "Judge the valuation as cheap, fair or expensive with 2-4 short reasons citing the metrics, and a "
        "one-sentence summary. Debt/Equity is a ratio (x); growth and margin are in %; market cap in ₹ crore."
    )


def debate_prompt(side: str, round_no: int, rounds: int, company: str, symbol: str, ledger: str, transcript: list[dict], as_of: str | None) -> str:
    history = "\n\n".join(f"Round {t['round']} - {t['side'].upper()}:\n{t['text']}" for t in transcript) or "(no arguments yet)"
    opponent = "Bear" if side == "bull" else "Bull"
    last = next((t for t in reversed(transcript) if t["side"] != side), None)
    task = (
        f"Respond directly to the {opponent}'s last argument (quoted in the transcript), then strengthen your case."
        if last
        else "Open the debate with your strongest case."
    )
    return (
        f"{_as_of_line(as_of)}Stock: {company} (NSE: {symbol}). Debate round {round_no} of {rounds}.\n\n"
        f"EVIDENCE LEDGER (cite IDs in square brackets):\n{ledger}\n\n"
        f"TRANSCRIPT SO FAR:\n{history}\n\n"
        f"Your task: {task} Write 80-130 words of plain prose (no lists, no markdown). Every claim must cite at "
        "least one ledger ID. Do not repeat points you already made."
    )


def risk_prompt(company: str, symbol: str, ledger: str, transcript: list[dict], auto_flags: list[dict], vol: float | None, cap: float, as_of: str | None) -> str:
    debate = "\n\n".join(
        f"Round {t['round']} - {t['side'].upper()} (cites: {', '.join(t['citations']) or 'none'}):\n{t['text']}" for t in transcript
    )
    return (
        f"{_as_of_line(as_of)}Stock: {company} (NSE: {symbol}).\n\n"
        f"EVIDENCE LEDGER:\n{ledger}\n\nDEBATE:\n{debate}\n\n"
        f"Automatic citation checks already found: {json.dumps(auto_flags) if auto_flags else 'no issues'}.\n"
        f"Annualised volatility: {vol if vol is not None else 'unknown'}%. Volatility-scaled cap: {cap:.1f}% of portfolio.\n\n"
        "Return JSON: flags (each with round, side, issue, severity) for weak/unsupported/misrepresented arguments "
        "beyond the automatic ones (empty list if none), max_position_pct (0 to the cap), risk_level, and notes."
    )


def pm_prompt(company: str, symbol: str, price: float, ledger: str, transcript: list[dict], risk: dict, portfolio: dict | None, memory: list[dict], as_of: str | None) -> str:
    debate = "\n\n".join(f"Round {t['round']} - {t['side'].upper()}:\n{t['text']}" for t in transcript)
    flags = "\n".join(f"- Round {f['round']} {f['side']}: {f['issue']} ({f['severity']})" for f in risk.get("flags", [])) or "- none"
    port = (
        f"Portfolio: cash ₹{portfolio['cash']:,.0f}, total value ₹{portfolio['total_value']:,.0f}, "
        f"current holding in {symbol}: {portfolio['held_qty']} shares.\n"
        if portfolio
        else ""
    )
    mem = (
        "Previous QUORUM decisions on this stock (memory):\n"
        + "\n".join(f"- {m['date']}: {m['decision']} (confidence {m['confidence']}) at ₹{m['price']}" for m in memory)
        + "\n"
        if memory
        else ""
    )
    return (
        f"{_as_of_line(as_of)}Stock: {company} (NSE: {symbol}), latest close ₹{price:,.2f}.\n\n"
        f"EVIDENCE LEDGER:\n{ledger}\n\nDEBATE:\n{debate}\n\n"
        f"RISK MANAGER: risk level {risk.get('risk_level')}, max position {risk.get('max_position_pct')}%.\n"
        f"Flags:\n{flags}\nNotes: {risk.get('notes')}\n\n{port}{mem}\n"
        "Return JSON with decision, confidence (0-100), position_size_pct and exactly three rationale bullets."
    )
