"""Virtual ₹1,00,000 paper portfolio. All state is derived from the persisted trade log."""

from __future__ import annotations

import json
import math
from collections import defaultdict

import pandas as pd
from sqlmodel import delete, select

from .. import db
from ..config import get_settings
from ..data import market
from ..tickers import resolve


def _trades(s) -> list[db.Trade]:
    return list(s.exec(select(db.Trade).order_by(db.Trade.id)))


def _replay(trades: list[db.Trade]) -> tuple[float, dict[str, dict], float]:
    """Average-cost bookkeeping. Returns (cash, positions, realised_pnl)."""
    cash = get_settings().initial_cash
    pos: dict[str, dict] = defaultdict(lambda: {"qty": 0, "cost": 0.0})
    realised = 0.0
    for t in trades:
        p = pos[t.ticker]
        if t.side == "BUY":
            cash -= t.value
            p["qty"] += t.qty
            p["cost"] += t.value
        else:
            avg = p["cost"] / p["qty"] if p["qty"] else t.price
            cash += t.value
            realised += t.value - avg * t.qty
            p["cost"] -= avg * t.qty
            p["qty"] -= t.qty
    return cash, {k: v for k, v in pos.items() if v["qty"] > 0}, realised


def holding_qty(ticker: str) -> int:
    with db.session() as s:
        _, pos, _ = _replay(_trades(s))
    return pos.get(ticker, {}).get("qty", 0)


def snapshot(price_overrides: dict[str, float] | None = None) -> dict:
    price_overrides = price_overrides or {}
    initial = get_settings().initial_cash
    with db.session() as s:
        trades = _trades(s)
    cash, pos, realised = _replay(trades)
    holdings = []
    for ticker, p in sorted(pos.items()):
        last = price_overrides.get(ticker) or market.latest_close(resolve(ticker))
        if last is None:
            last = next((t.price for t in reversed(trades) if t.ticker == ticker), 0.0)
        mv = p["qty"] * last
        avg = p["cost"] / p["qty"]
        holdings.append(
            {
                "ticker": ticker,
                "qty": p["qty"],
                "avg_cost": round(avg, 2),
                "last_price": round(last, 2),
                "market_value": round(mv, 2),
                "unrealised_pnl": round(mv - p["cost"], 2),
                "unrealised_pct": round((last / avg - 1) * 100, 2) if avg else 0.0,
            }
        )
    invested = sum(h["market_value"] for h in holdings)
    total = cash + invested
    for h in holdings:
        h["weight_pct"] = round(h["market_value"] / total * 100, 2) if total else 0.0
    return {
        "initial_cash": initial,
        "cash": round(cash, 2),
        "invested": round(invested, 2),
        "total_value": round(total, 2),
        "pnl": round(total - initial, 2),
        "pnl_pct": round((total / initial - 1) * 100, 2),
        "realised_pnl": round(realised, 2),
        "holdings": holdings,
        "trade_count": len(trades),
    }


def execute(
    ticker: str, decision: str, size_pct: float, price: float, price_date: str, run_id: str, confidence: int
) -> dict:
    """Paper-trade at the latest close. BUY rebalances up to the target weight (cash
    permitting); SELL closes the open position (no short selling); HOLD does nothing."""
    snap = snapshot({ticker: price})
    held = next((h for h in snap["holdings"] if h["ticker"] == ticker), None)
    held_qty = held["qty"] if held else 0

    if decision == "HOLD":
        return {"executed": False, "reason": "HOLD decision: no order placed.", "portfolio": snap}
    if decision == "SELL":
        if held_qty <= 0:
            return {"executed": False, "reason": "SELL signal but no open position (short selling is disabled).", "portfolio": snap}
        qty, side = held_qty, "SELL"
    else:
        target_value = snap["total_value"] * size_pct / 100.0
        current_value = held["market_value"] if held else 0.0
        budget = min(target_value - current_value, snap["cash"])
        qty = math.floor(budget / price) if budget > 0 and price > 0 else 0
        if qty <= 0:
            if target_value <= 0:
                reason = "Position size is 0%: no order placed."
            elif held and current_value >= target_value:
                reason = f"Already holding {held_qty} shares ({held['weight_pct']:.1f}% of portfolio), at or above the {size_pct:.1f}% target."
            elif held:
                reason = (
                    f"Already holding {held_qty} shares ({held['weight_pct']:.1f}%); topping up to the {size_pct:.1f}% "
                    f"target needs less than one share at ₹{price:,.2f}."
                )
            elif snap["cash"] < price:
                reason = f"Insufficient cash (₹{snap['cash']:,.2f}) for one share at ₹{price:,.2f}."
            else:
                reason = f"Target size {size_pct:.1f}% is less than one share at ₹{price:,.2f}."
            return {"executed": False, "reason": reason, "portfolio": snap}
        side = "BUY"

    trade = db.Trade(
        trade_date=price_date, ticker=ticker, side=side, qty=qty, price=round(price, 2),
        value=round(qty * price, 2), run_id=run_id, confidence=confidence,
        note=f"{decision} @ {size_pct:.1f}% target" if side == "BUY" else "Close position",
    )
    with db.session() as s:
        s.add(trade)
        s.commit()
        s.refresh(trade)
    return {"executed": True, "trade": trade.model_dump(mode="json"), "portfolio": snapshot({ticker: price})}


def trades() -> list[dict]:
    with db.session() as s:
        return [t.model_dump(mode="json") for t in reversed(_trades(s))]


def recent_decisions(ticker: str, limit: int = 3) -> list[dict]:
    """Agent memory: the last few live QUORUM decisions on this ticker."""
    with db.session() as s:
        rows = s.exec(
            select(db.AnalysisRun)
            .where(db.AnalysisRun.ticker == ticker, db.AnalysisRun.mode == "live", db.AnalysisRun.decision.is_not(None))
            .order_by(db.AnalysisRun.ts.desc())
            .limit(limit)
        ).all()
    return [
        {
            "date": r.ts.date().isoformat(),
            "decision": r.decision,
            "confidence": r.confidence,
            "price": r.price,
            "rationale": json.loads(r.rationale_json or "[]")[:1],
        }
        for r in rows
    ]


def runs(limit: int = 20) -> list[dict]:
    with db.session() as s:
        rows = s.exec(select(db.AnalysisRun).where(db.AnalysisRun.mode == "live").order_by(db.AnalysisRun.ts.desc()).limit(limit)).all()
    return [
        {
            "id": r.id, "ts": r.ts.isoformat(), "ticker": r.ticker, "decision": r.decision, "confidence": r.confidence,
            "position_size_pct": r.position_size_pct, "price": r.price, "llm_mode": r.llm_mode,
        }
        for r in rows
    ]


def reset() -> None:
    with db.session() as s:
        s.exec(delete(db.Trade))
        s.commit()


def history() -> dict:
    """Daily portfolio value vs Nifty 50, both normalised to 100 at the first trade date."""
    with db.session() as s:
        all_trades = _trades(s)
    if not all_trades:
        return {"series": [], "message": "No trades yet - run an analysis to place the first paper trade."}
    try:
        nifty, _ = market.get_history(market.NIFTY_SYMBOL)
    except Exception:
        return {"series": [], "message": "Nifty 50 history unavailable right now."}
    start = pd.Timestamp(min(t.trade_date for t in all_trades))
    dates = nifty.index[nifty.index >= start]
    if len(dates) == 0:
        dates = pd.DatetimeIndex([nifty.index[-1]])

    closes: dict[str, pd.Series] = {}
    for ticker in {t.ticker for t in all_trades}:
        try:
            df, _ = market.get_history(resolve(ticker).yahoo, ticker)
            closes[ticker] = df["Close"].reindex(df.index.union(dates)).ffill().reindex(dates)
        except Exception:
            closes[ticker] = pd.Series(index=dates, dtype=float)

    initial = get_settings().initial_cash
    series = []
    base_val, base_nifty = None, None
    for d in dates:
        day_trades = [t for t in all_trades if pd.Timestamp(t.trade_date) <= d]
        cash, pos, _ = _replay(day_trades)
        value = cash
        for ticker, p in pos.items():
            px = closes[ticker].get(d)
            if px is None or pd.isna(px):
                px = next(t.price for t in reversed(day_trades) if t.ticker == ticker)
            value += p["qty"] * float(px)
        n = float(nifty.loc[d, "Close"])
        if base_val is None:
            base_val, base_nifty = initial, n
        series.append(
            {
                "date": d.date().isoformat(),
                "portfolio": round(value / base_val * 100, 2),
                "nifty": round(n / base_nifty * 100, 2),
                "value": round(value, 2),
            }
        )
    message = None
    if len(series) < 2:
        message = "Only one trading day since the first trade - the comparison fills in as days pass."
    return {"series": series, "message": message, "start": series[0]["date"]}
