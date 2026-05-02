"""WanderFree extraction pipeline.

Public surface (so far):
    schema.ExtractedBenefit       — Pydantic model the LLM populates
    schema.RECORD_BENEFIT_TOOL    — Anthropic tool definition derived from the model
    schema.benefit_signature      — Stable hash for upsert dedup
"""

from extract.schema import (
    ExtractedBenefit,
    RECORD_BENEFIT_TOOL,
    benefit_signature,
)

__all__ = [
    "ExtractedBenefit",
    "RECORD_BENEFIT_TOOL",
    "benefit_signature",
]
