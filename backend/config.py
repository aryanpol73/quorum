"""Central configuration, read from environment variables (and the root .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
DEMO_DATA_DIR = BACKEND_DIR / "demo_data"
STORAGE_DIR = BACKEND_DIR / "storage"
CACHE_DIR = BACKEND_DIR / ".cache"

load_dotenv(ROOT_DIR / ".env")

DEFAULT_EVAL_TICKERS = "INFY,TCS,RELIANCE,HDFCBANK,ICICIBANK,SBIN,ITC,BHARTIARTL,LT,TATAMOTORS"


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _date(name: str, default: str) -> date:
    raw = (os.getenv(name) or default).strip()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return date.fromisoformat(default)


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    gemini_thinking_level: str = ""
    llm_temperature: float = 0.2
    llm_timeout_s: float = 45.0
    demo_mode: bool = False
    llm_knowledge_cutoff: date = date(2026, 6, 30)
    cache_ttl_s: int = 900
    initial_cash: float = 100_000.0
    debate_rounds: int = 3
    eval_debate_rounds: int = 1
    eval_tickers: list[str] = field(default_factory=list)
    eval_hold_band: float = 0.02
    offline_token_delay_s: float = 0.03
    db_path: Path = STORAGE_DIR / "quorum.db"

    @property
    def llm_configured(self) -> bool:
        return bool(self.gemini_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    tickers = [t.strip().upper() for t in os.getenv("EVAL_TICKERS", DEFAULT_EVAL_TICKERS).split(",") if t.strip()]
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "").strip() or "gemini-flash-latest",
        gemini_thinking_level=os.getenv("GEMINI_THINKING_LEVEL", "").strip().lower(),
        llm_temperature=_float("LLM_TEMPERATURE", 0.2),
        llm_timeout_s=_float("LLM_TIMEOUT_SECONDS", 45.0),
        demo_mode=_bool("DEMO_MODE", False),
        llm_knowledge_cutoff=_date("LLM_KNOWLEDGE_CUTOFF", "2026-06-30"),
        cache_ttl_s=_int("CACHE_TTL_SECONDS", 900),
        initial_cash=_float("INITIAL_CASH", 100_000.0),
        debate_rounds=max(1, min(5, _int("DEBATE_ROUNDS", 3))),
        eval_debate_rounds=max(1, min(3, _int("EVAL_DEBATE_ROUNDS", 1))),
        eval_tickers=tickers[:10] if tickers else DEFAULT_EVAL_TICKERS.split(","),
        eval_hold_band=_float("EVAL_HOLD_BAND", 0.02),
        offline_token_delay_s=_float("OFFLINE_TOKEN_DELAY", 0.03),
        db_path=Path(os.getenv("DB_PATH", "").strip() or STORAGE_DIR / "quorum.db"),
    )
