"""Popular NSE stocks and symbol resolution (NSE symbol -> Yahoo Finance symbol)."""

from __future__ import annotations

from dataclasses import dataclass

# (NSE symbol, company name, Yahoo symbol override or None)
# Tata Motors demerged in Oct 2025: the old TATAMOTORS.NS symbol no longer resolves on
# Yahoo, so TATAMOTORS is aliased to the passenger-vehicle entity TMPV.NS.
POPULAR: list[tuple[str, str, str | None]] = [
    ("RELIANCE", "Reliance Industries", None),
    ("TCS", "Tata Consultancy Services", None),
    ("HDFCBANK", "HDFC Bank", None),
    ("ICICIBANK", "ICICI Bank", None),
    ("INFY", "Infosys", None),
    ("BHARTIARTL", "Bharti Airtel", None),
    ("SBIN", "State Bank of India", None),
    ("ITC", "ITC", None),
    ("HINDUNILVR", "Hindustan Unilever", None),
    ("LT", "Larsen & Toubro", None),
    ("KOTAKBANK", "Kotak Mahindra Bank", None),
    ("AXISBANK", "Axis Bank", None),
    ("BAJFINANCE", "Bajaj Finance", None),
    ("BAJAJFINSV", "Bajaj Finserv", None),
    ("HCLTECH", "HCL Technologies", None),
    ("WIPRO", "Wipro", None),
    ("TECHM", "Tech Mahindra", None),
    ("MARUTI", "Maruti Suzuki", None),
    ("TATAMOTORS", "Tata Motors", "TMPV.NS"),
    ("TMPV", "Tata Motors Passenger Vehicles", None),
    ("M&M", "Mahindra & Mahindra", None),
    ("BAJAJ-AUTO", "Bajaj Auto", None),
    ("EICHERMOT", "Eicher Motors", None),
    ("HEROMOTOCO", "Hero MotoCorp", None),
    ("ASIANPAINT", "Asian Paints", None),
    ("TITAN", "Titan Company", None),
    ("ULTRACEMCO", "UltraTech Cement", None),
    ("GRASIM", "Grasim Industries", None),
    ("NESTLEIND", "Nestle India", None),
    ("BRITANNIA", "Britannia Industries", None),
    ("TATACONSUM", "Tata Consumer Products", None),
    ("SUNPHARMA", "Sun Pharmaceutical", None),
    ("DRREDDY", "Dr Reddy's Laboratories", None),
    ("CIPLA", "Cipla", None),
    ("DIVISLAB", "Divi's Laboratories", None),
    ("APOLLOHOSP", "Apollo Hospitals", None),
    ("TATASTEEL", "Tata Steel", None),
    ("JSWSTEEL", "JSW Steel", None),
    ("HINDALCO", "Hindalco Industries", None),
    ("VEDL", "Vedanta", None),
    ("COALINDIA", "Coal India", None),
    ("ONGC", "Oil and Natural Gas Corporation", None),
    ("BPCL", "Bharat Petroleum", None),
    ("NTPC", "NTPC", None),
    ("POWERGRID", "Power Grid Corporation", None),
    ("ADANIENT", "Adani Enterprises", None),
    ("ADANIPORTS", "Adani Ports and SEZ", None),
    ("HAL", "Hindustan Aeronautics", None),
    ("BEL", "Bharat Electronics", None),
    ("ETERNAL", "Eternal (Zomato)", None),
    ("TRENT", "Trent", None),
    ("DMART", "Avenue Supermarts (DMart)", None),
    ("IRCTC", "Indian Railway Catering and Tourism Corporation", None),
    ("DLF", "DLF", None),
    ("INDUSINDBK", "IndusInd Bank", None),
]

_BY_SYMBOL = {sym: (name, yahoo) for sym, name, yahoo in POPULAR}


@dataclass(frozen=True)
class TickerRef:
    symbol: str  # NSE symbol, e.g. INFY
    yahoo: str  # Yahoo Finance symbol, e.g. INFY.NS
    name: str  # Human readable company name (used for news search)
    known: bool  # True if in the curated popular list


def normalize(raw: str) -> str:
    sym = (raw or "").strip().upper()
    for suffix in (".NS", ".BO"):
        if sym.endswith(suffix):
            sym = sym[: -len(suffix)]
    return sym


def resolve(raw: str) -> TickerRef:
    sym = normalize(raw)
    if sym in _BY_SYMBOL:
        name, yahoo = _BY_SYMBOL[sym]
        return TickerRef(sym, yahoo or f"{sym}.NS", name, True)
    return TickerRef(sym, f"{sym}.NS", sym, False)


def popular_list() -> list[dict[str, str]]:
    return [{"symbol": sym, "name": name} for sym, name, _ in POPULAR]
