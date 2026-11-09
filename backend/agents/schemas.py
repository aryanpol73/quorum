"""Strict Pydantic schemas for every structured LLM output.

The same classes are passed to Gemini as `response_schema` (so the model is constrained
to emit matching JSON) and then used to validate the response. Invalid output triggers
one retry with the validation error fed back to the model.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class HeadlineScore(BaseModel):
    index: int = Field(description="0-based index of the headline in the list provided")
    score: float = Field(ge=-1.0, le=1.0, description="Impact on the stock from -1 (very negative) to +1 (very positive)")
    reason: str = Field(description="One-line reason, at most 20 words")


class NewsScoring(BaseModel):
    scores: list[HeadlineScore]
    summary: str = Field(description="Two-sentence summary of the overall news flow")


class FundamentalsJudgement(BaseModel):
    valuation: Literal["cheap", "fair", "expensive"]
    reasons: list[str] = Field(min_length=2, max_length=4, description="2-4 short reasons citing the metrics")
    summary: str = Field(description="One-sentence verdict")


class RiskFlag(BaseModel):
    round: int = Field(ge=1, le=5)
    side: Literal["bull", "bear"]
    issue: str = Field(description="What is weak, unsupported or misrepresented, in one sentence")
    severity: Literal["low", "medium", "high"]


class RiskReview(BaseModel):
    flags: list[RiskFlag]
    max_position_pct: float = Field(ge=0.0, le=20.0, description="Maximum position size as % of portfolio")
    risk_level: Literal["low", "medium", "high"]
    notes: str = Field(description="Two to three sentences on overall risk and debate quality")


class PMDecision(BaseModel):
    decision: Literal["BUY", "HOLD", "SELL"]
    confidence: int = Field(ge=0, le=100)
    position_size_pct: float = Field(ge=0.0, le=20.0, description="Target position as % of portfolio value")
    rationale: list[str] = Field(min_length=3, max_length=3, description="Exactly three bullet points")

    @field_validator("rationale")
    @classmethod
    def _non_empty(cls, v: list[str]) -> list[str]:
        if any(not s.strip() for s in v):
            raise ValueError("rationale bullets must not be empty")
        return [s.strip() for s in v]
