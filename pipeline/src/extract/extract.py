"""Claude API extraction orchestration.

For each (card, source, chunk) triple we send one call to the Claude API
with the ``record_benefit`` tool defined. Claude can call the tool zero or
more times in its response — once per discrete benefit found in the chunk.
We collect those tool calls, validate them against the Pydantic schema, and
hand them back as ``ExtractedBenefit`` instances.

Design points:

* **tool_choice="auto"**, not forced. A chunk about dispute resolution or
  arbitration contains no benefits — forcing a tool call would create
  hallucinated rows. We instruct the model to skip the tool when nothing
  applies.

* **Per-call context injection.** The chunk text is small, but the model
  benefits from knowing what card and source kind it's looking at — that
  context goes in the user message header.

* **source_url and card_id are NOT extracted from the model.** The pipeline
  knows them already; we inject them after extraction. Asking the model to
  populate them just creates a hallucination surface.

* **Retries on rate limits / 5xx**, not on validation failures. A bad tool
  call is surfaced to the caller as a low-confidence row, not retried.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import anthropic
from anthropic.types import Message
from pydantic import ValidationError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from extract.cards import Card, Source
from extract.parse import TextChunk
from extract.schema import RECORD_BENEFIT_TOOL, ExtractedBenefit
from extract.settings import get_settings

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
#  Result types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ChunkExtraction:
    """Output of running one chunk through Claude."""

    card: Card
    source: Source
    chunk: TextChunk
    benefits: list[ExtractedBenefit] = field(default_factory=list)
    skipped_tool_calls: list[dict] = field(default_factory=list)
    """Tool calls that failed Pydantic validation, kept for debugging."""
    input_tokens: int = 0
    output_tokens: int = 0
    stop_reason: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
#  Client construction
# ─────────────────────────────────────────────────────────────────────────────


def make_anthropic_client() -> anthropic.Anthropic:
    """Construct an Anthropic client using settings from env."""
    settings = get_settings()
    return anthropic.Anthropic(
        api_key=settings.anthropic_api_key.get_secret_value(),
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Prompt construction
# ─────────────────────────────────────────────────────────────────────────────


SYSTEM_PROMPT = """\
You extract structured benefit information from credit card source documents.

For each discrete benefit you find in the chunk, call the `record_benefit` tool
ONCE per benefit. Multiple benefits in the same chunk → multiple tool calls in
the same response.

CRITICAL rules:

1. **Be exhaustive within a chunk.** If a section lists "5x on flights, 3x on
   hotels, 2x on dining," that's THREE benefits — three tool calls.

2. **Be conservative across chunks.** Only call the tool for benefits clearly
   stated in THIS chunk. Don't infer from earlier knowledge of the card.

3. **`source_quote` must be a verbatim sentence from the chunk.** Copy it
   directly. We check this downstream — fabricated quotes are auto-flagged
   as low-confidence and may be discarded entirely.

4. **Use 'low' confidence freely.** If a value was inferred (the source said
   "up to $200" without specifying period), set extraction_confidence='low'
   and explain in `notes`. Better to flag than to guess silently.

5. **Skip non-benefit content.** Dispute resolution, arbitration clauses,
   APR schedules, fee schedules (except annual fee, which we capture
   elsewhere), legal disclaimers — none of these are "benefits." Make zero
   tool calls for those chunks; respond with a brief one-line acknowledgment.

6. **Skip terms that apply only to defaulted accounts** or unusual situations.
   We're cataloging the rewards a typical cardholder receives in good standing.

7. **Annual recurring credits split into halves** (like Amex Platinum's $100
   Saks credit: $50 Jan-Jun + $50 Jul-Dec) → recurrence='annual',
   recurrence_split=true, reward_value=10000 (the FULL annual amount).
"""


def _build_user_message(card: Card, source: Source, chunk: TextChunk) -> str:
    """Build the per-chunk user prompt with context injection."""
    section_label = (
        f'\nSection: "{chunk.section_title}"' if chunk.section_title else ""
    )
    return f"""\
Card: {card.name}
Issuer: {card.issuer.name}
Card type: {"business" if card.is_business else "consumer"}
Source kind: {source.kind} ({source.url}){section_label}

Extract every discrete benefit in the chunk below by calling `record_benefit`.
If the chunk contains no benefits (e.g. it's legal boilerplate, dispute terms,
or APR info), make zero tool calls and respond with a single short sentence
confirming there's nothing to extract.

─── CHUNK START ─────────────────────────────────────────────────────────────
{chunk.text}
─── CHUNK END ───────────────────────────────────────────────────────────────
"""


# ─────────────────────────────────────────────────────────────────────────────
#  Calling Claude
# ─────────────────────────────────────────────────────────────────────────────


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential_jitter(initial=4, max=60),
    retry=retry_if_exception_type(
        (
            anthropic.RateLimitError,
            anthropic.APIConnectionError,
            anthropic.InternalServerError,
        ),
    ),
)
def _call_claude(
    client: anthropic.Anthropic,
    *,
    model: str,
    max_tokens: int,
    system: str,
    user_text: str,
) -> Message:
    """One Anthropic Messages call with retries on transient errors.

    Validation errors are NOT retried — they get bubbled up so the caller
    can decide what to do (typically log + carry on).
    """
    return client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        tools=[RECORD_BENEFIT_TOOL],
        # 'auto' (default) lets the model skip the tool when there's nothing
        # to extract. 'any' would force at least one call, which we don't want
        # for chunks of legal boilerplate.
        tool_choice={"type": "auto"},
        messages=[{"role": "user", "content": user_text}],
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Per-chunk orchestration
# ─────────────────────────────────────────────────────────────────────────────


def extract_chunk(
    *,
    card: Card,
    source: Source,
    chunk: TextChunk,
    client: anthropic.Anthropic | None = None,
    model: str | None = None,
) -> ChunkExtraction:
    """Run one chunk through Claude and parse out structured benefits.

    The pipeline injects ``source_url`` and ``source_section`` into each
    extracted benefit (the model is told not to populate them).

    Parameters
    ----------
    client:
        Optional Anthropic client. Pass one for batch runs to share the
        connection. Tests use this seam to inject a mock.
    model:
        Override the model. Defaults to settings.wanderfree_model.
    """
    settings = get_settings()
    if client is None:
        client = make_anthropic_client()

    user_text = _build_user_message(card, source, chunk)

    response = _call_claude(
        client,
        model=model or settings.wanderfree_model,
        max_tokens=settings.wanderfree_max_tokens,
        system=SYSTEM_PROMPT,
        user_text=user_text,
    )

    extraction = ChunkExtraction(
        card=card,
        source=source,
        chunk=chunk,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        stop_reason=response.stop_reason,
    )

    # Walk the response content blocks. We want all `tool_use` blocks named
    # 'record_benefit'. Any text blocks the model returned are informational
    # (typically the "no benefits in this chunk" acknowledgment).
    for block in response.content:
        if block.type != "tool_use" or block.name != "record_benefit":
            continue

        raw_args = dict(block.input)  # type: ignore[arg-type]

        # Inject pipeline-known fields the model isn't supposed to populate.
        # If the model populated them anyway, our values win.
        raw_args["source_url"] = source.url
        if chunk.section_title and not raw_args.get("source_section"):
            raw_args["source_section"] = chunk.section_title

        try:
            benefit = ExtractedBenefit.model_validate(raw_args)
            extraction.benefits.append(benefit)
        except ValidationError as ve:
            logger.warning(
                "Invalid tool call from Claude on %s / chunk %d: %s",
                card.slug,
                chunk.section_index,
                ve.errors(include_url=False),
            )
            extraction.skipped_tool_calls.append(raw_args)

    logger.info(
        "Extracted %d benefits from %s / chunk %d (%s) — input=%d out=%d",
        len(extraction.benefits),
        card.slug,
        chunk.section_index,
        chunk.section_title or "(no title)",
        extraction.input_tokens,
        extraction.output_tokens,
    )
    return extraction
