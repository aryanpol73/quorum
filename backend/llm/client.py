"""Gemini wrapper (google-genai) with streaming, strict JSON, timeouts and one retry.

Every call:
  * uses a low temperature (LLM_TEMPERATURE, default 0.2),
  * is wrapped in asyncio.wait_for(LLM_TIMEOUT_SECONDS),
  * is retried once on any transport error / timeout,
  * for structured output: is constrained with `response_schema` and then validated
    with Pydantic; invalid JSON is retried once with the validation error fed back.

If the key is missing, invalid, or the API keeps failing, callers fall back to the
offline rule-based engine (backend/llm/fallback.py) so the pipeline never breaks.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from functools import lru_cache
from typing import Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import Settings, get_settings

log = logging.getLogger("quorum.llm")

M = TypeVar("M", bound=BaseModel)

COOLDOWN_SECONDS = 60.0


class LLMError(Exception):
    pass


class StreamSink(Protocol):
    async def token(self, text: str) -> None: ...
    async def reset(self, reason: str) -> None: ...
    async def notice(self, message: str, level: str = "info") -> None: ...


def _status_code(exc: Exception) -> int | None:
    code = getattr(exc, "code", None)
    return code if isinstance(code, int) else None


def _is_auth_error(exc: Exception) -> bool:
    code = _status_code(exc)
    msg = str(exc).lower()
    return code in (401, 403) or "api key not valid" in msg or "api_key_invalid" in msg or "permission_denied" in msg


def _is_rate_limit(exc: Exception) -> bool:
    return _status_code(exc) == 429 or "resource_exhausted" in str(exc).lower()


def _short(exc: Exception, limit: int = 160) -> str:
    text = str(exc) or exc.__class__.__name__
    api_message = getattr(exc, "message", None)  # google.genai.errors.APIError
    if isinstance(api_message, str) and api_message:
        text = f"{_status_code(exc) or ''} {api_message}".strip()
    if isinstance(exc, asyncio.TimeoutError):
        text = "timed out"
    text = re.sub(r"\s+", " ", text)
    return text[:limit]


def strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


class GeminiLLM:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = settings.gemini_model
        self._client = None
        self._disabled_reason: str | None = None
        self._cooldown_until = 0.0
        if settings.gemini_api_key:
            try:
                from google import genai
                from google.genai import types

                self._client = genai.Client(
                    api_key=settings.gemini_api_key,
                    http_options=types.HttpOptions(timeout=int(settings.llm_timeout_s * 1000)),
                )
            except Exception as exc:  # pragma: no cover - import/config problems
                self._disabled_reason = f"Gemini client could not start: {_short(exc)}"
        else:
            self._disabled_reason = "GEMINI_API_KEY not set"

    # ------------------------------------------------------------------ status
    @property
    def available(self) -> bool:
        return self._client is not None and self._disabled_reason is None and time.time() >= self._cooldown_until

    @property
    def status(self) -> dict:
        if self._client is None or self._disabled_reason:
            state = "offline"
        elif time.time() < self._cooldown_until:
            state = "cooldown"
        else:
            state = "online"
        return {"provider": "gemini", "model": self.model, "state": state, "reason": self._disabled_reason}

    # ------------------------------------------------------------------ calls
    def _config(self, system: str, schema: type[BaseModel] | None):
        from google.genai import types

        kwargs: dict = {"system_instruction": system, "temperature": self.settings.llm_temperature}
        if schema is not None:
            kwargs["response_mime_type"] = "application/json"
            kwargs["response_schema"] = schema
        if self.settings.gemini_thinking_level:
            kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=self.settings.gemini_thinking_level)
        return types.GenerateContentConfig(**kwargs)

    @staticmethod
    def _chunk_text(chunk) -> str:
        try:
            parts = chunk.candidates[0].content.parts or []
        except (AttributeError, IndexError, TypeError):
            return ""
        return "".join(p.text for p in parts if getattr(p, "text", None) and not getattr(p, "thought", False))

    async def stream(self, *, system: str, prompt: str, sink: StreamSink, schema: type[BaseModel] | None = None) -> str:
        """Stream a completion token-by-token into `sink`. One retry on failure."""
        if not self.available:
            raise LLMError(self._disabled_reason or "Gemini temporarily disabled after repeated errors")
        config = self._config(system, schema)
        last_exc: Exception | None = None
        for attempt in (1, 2):
            emitted = False

            async def _run() -> str:
                nonlocal emitted
                parts: list[str] = []
                stream = await self._client.aio.models.generate_content_stream(
                    model=self.model, contents=prompt, config=config
                )
                async for chunk in stream:
                    text = self._chunk_text(chunk)
                    if text:
                        parts.append(text)
                        emitted = True
                        await sink.token(text)
                return "".join(parts)

            try:
                text = await asyncio.wait_for(_run(), timeout=self.settings.llm_timeout_s)
                if not text.strip():
                    raise LLMError("empty response from model")
                return text
            except Exception as exc:
                last_exc = exc
                log.warning("Gemini attempt %s failed: %s", attempt, _short(exc))
                if emitted:
                    await sink.reset(f"stream interrupted: {_short(exc, 80)}")
                if _is_auth_error(exc):
                    self._disabled_reason = f"Gemini rejected the API key ({_short(exc, 80)})"
                    break
                if attempt == 1:
                    await sink.notice(f"Gemini call failed ({_short(exc, 90)}) - retrying once", "warn")
                    await asyncio.sleep(4.0 if _is_rate_limit(exc) else 1.0)
        if last_exc is not None and not _is_auth_error(last_exc):
            self._cooldown_until = time.time() + COOLDOWN_SECONDS
        raise LLMError(_short(last_exc) if last_exc else "unknown error")

    async def json(self, *, system: str, prompt: str, schema: type[M], sink: StreamSink) -> M:
        """Strict structured output: schema-constrained generation + Pydantic validation.

        On invalid JSON the model is asked once more with the validation error appended.
        """
        feedback = ""
        for attempt in (1, 2):
            text = await self.stream(system=system, prompt=prompt + feedback, sink=sink, schema=schema)
            try:
                return schema.model_validate_json(strip_fences(text))
            except ValidationError as exc:
                errors = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:4])
                await sink.reset("invalid JSON")
                if attempt == 1:
                    await sink.notice(f"Output failed Pydantic validation ({errors}) - retrying once", "warn")
                    feedback = (
                        "\n\nYOUR PREVIOUS REPLY FAILED VALIDATION: "
                        f"{errors}. Reply again with ONLY a JSON object that satisfies the schema exactly."
                    )
                else:
                    raise LLMError(f"invalid JSON after retry: {errors}") from exc
        raise LLMError("unreachable")


@lru_cache(maxsize=1)
def get_llm() -> GeminiLLM:
    return GeminiLLM(get_settings())
