"""A tiny two-level TTL cache (memory + pickle files on disk).

yfinance and Google News both rate-limit aggressively, so every external fetch goes
through `cached(...)`. The disk layer means repeated CLI runs also hit the cache.
"""

from __future__ import annotations

import hashlib
import pickle
import threading
import time
from typing import Any, Callable, TypeVar

from .config import CACHE_DIR, get_settings

T = TypeVar("T")

_memory: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()


def _path(key: str):
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]
    return CACHE_DIR / f"{digest}.pkl"


def get(key: str, ttl: float | None = None) -> Any | None:
    ttl = get_settings().cache_ttl_s if ttl is None else ttl
    now = time.time()
    with _lock:
        hit = _memory.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    path = _path(key)
    if path.exists():
        try:
            with path.open("rb") as fh:
                stored_at, value = pickle.load(fh)
            if now - stored_at < ttl:
                with _lock:
                    _memory[key] = (stored_at, value)
                return value
        except Exception:
            pass
    return None


def put(key: str, value: Any) -> None:
    stamp = time.time()
    with _lock:
        _memory[key] = (stamp, value)
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with _path(key).open("wb") as fh:
            pickle.dump((stamp, value), fh)
    except Exception:
        pass


def cached(key: str, loader: Callable[[], T], ttl: float | None = None) -> tuple[T, bool]:
    """Return (value, was_cache_hit). Empty/None results are not cached."""
    hit = get(key, ttl)
    if hit is not None:
        return hit, True
    value = loader()
    if value is not None and not (hasattr(value, "__len__") and len(value) == 0):
        put(key, value)
    return value, False
