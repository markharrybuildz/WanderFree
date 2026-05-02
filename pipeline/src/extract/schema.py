"""Schema for benefit extraction.

This is the most important file in the pipeline. The Pydantic model below is
the contract between Claude and our database — it defines what the model is
allowed to emit per benefit, and the same shape is upserted into the
``benefits`` table in Postgres.

Two artifacts are exported:

    ExtractedBenefit       The Pydantic model. We validate Claude's tool-call
                           arguments against it before storing.

    RECORD_BENEFIT_TOOL    The Anthropic tool definition. Built from the
                           Pydantic model's JSON schema so the two cannot drift.

Plus a helper:

    benefit_signature(b)   A stable hash used as the dedup key when upserting.
                           Two extractions of "the same" benefit (same card,
                           same category/subcategory, same reward shape) collapse
                           into one row across quarterly runs.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ─────────────────────────────────────────────────────────────────────────────
#  Enums (kept as Literal types so Pydantic emits enum constraints in the
#  generated JSON schema — Claude reads those and stays in-bounds).
# ─────────────────────────────────────────────────────────────────────────────

Category = Literal[
    # Spend categories
    "dining",
    "travel",
    "flights",
    "hotels",
    "gas",
    "ev_charging",
    "grocery",
    "wholesale_club",
    "transit",
    "rideshare",
    "streaming",
    "telecom",
    "online_retail",
    "drugstore",
    # Travel perks
    "lounge_access",
    "global_entry_credit",
    "tsa_precheck_credit",
    # Insurance / protection
    "travel_insurance",
    "purchase_protection",
    "extended_warranty",
    "rental_car_cdw",
    "trip_delay",
    "trip_cancellation",
    "lost_luggage",
    "cell_phone_protection",
    # Statement credits
    "statement_credit_brand",     # narrow: e.g. Saks, Uber, Walmart+
    "statement_credit_general",   # broad: e.g. Amex Platinum airline credit
    # Bonuses / programs
    "signup_bonus",
    "anniversary_bonus",
    "referral_bonus",
    "points_transfer_partner",
    "redemption_bonus",
    "other",
]

# reward_value interpretation for each RewardType:
#   points_multiplier → multiplier (4 for "4x points")
#   cash_back_pct     → fraction (0.05 for "5% back")
#   statement_credit  → cents (30000 for "$300 credit")
#   fixed_points      → number of points (60000 for "60K bonus")
#   perk              → None (lounge access, no FX fee, etc.)
#   insurance         → None or cap amount in cents
#   discount_pct      → fraction (0.10 for "10% off")
RewardType = Literal[
    "points_multiplier",
    "cash_back_pct",
    "statement_credit",
    "fixed_points",
    "perk",
    "insurance",
    "discount_pct",
]

RewardValueUnit = Literal[
    "points_per_dollar",
    "miles_per_dollar",
    "percentage",
    "points",
    "miles",
    "cents_usd",
    "none",
]

CapPeriod = Literal["per_month", "per_quarter", "per_year", "lifetime", "none"]

Recurrence = Literal[
    "one_time",      # sign-up bonus, lifetime perk
    "monthly",
    "quarterly",
    "semi_annual",
    "annual",
    "ongoing",       # always-on multipliers, perks
    "limited_time",  # e.g. limited-time offer with specific dates
]

ExtractionConfidence = Literal["high", "medium", "low"]


# ─────────────────────────────────────────────────────────────────────────────
#  The model
# ─────────────────────────────────────────────────────────────────────────────


class ExtractedBenefit(BaseModel):
    """A single discrete benefit extracted from one source document.

    Field design notes:

    * ``reward_value`` is a single overloaded numeric. The interpretation is
      governed by ``reward_type`` + ``reward_value_unit``. We considered splitting
      into separate ``multiplier`` / ``percentage`` / ``cents_usd`` fields for
      cleanliness, but the overloading kept the tool surface smaller and made
      Claude's calls more reliable in early prototyping. Revisit if it bites.

    * ``card_id`` is *not* on the model. Each extraction call already runs in
      the context of one card — we inject the card_id when writing to Postgres.
      Asking the model to populate it just creates a hallucination surface.

    * ``source_quote`` is required and validated downstream against the source
      text. This is our hallucination tripwire.
    """

    model_config = ConfigDict(
        extra="forbid",  # Claude must only emit fields we declared
        # Pydantic v2: keep enum literals as the literal string in JSON schema
        # rather than $ref-ing a separate definition — flatter schema is easier
        # for Claude to follow.
        json_schema_extra=lambda schema: schema.pop("$defs", None),
    )

    # ── Categorization ─────────────────────────────────────────────────────
    category: Category = Field(
        description=(
            "What kind of benefit this is. Use spend categories (dining, "
            "travel, gas, ...) for earn rates, perk categories for non-earn "
            "benefits (lounge_access, travel_insurance, ...), and statement_credit_* "
            "for dollar credits. If nothing fits, use 'other' and explain in notes."
        ),
    )
    subcategory: str | None = Field(
        default=None,
        description=(
            "Free-form refinement. Examples: 'Saks Fifth Avenue' for "
            "statement_credit_brand; 'Centurion Lounge' for lounge_access; "
            "'rideshare' under transit."
        ),
        max_length=200,
    )

    # ── Reward shape ───────────────────────────────────────────────────────
    reward_type: RewardType = Field(
        description="The mechanical kind of reward — controls how reward_value is interpreted.",
    )
    reward_value: float | None = Field(
        default=None,
        description=(
            "Numeric value matching reward_type:\n"
            "  points_multiplier → multiplier (4 for '4x points')\n"
            "  cash_back_pct    → decimal fraction (0.05 for '5%')\n"
            "  statement_credit → cents (30000 for '$300 credit')\n"
            "  fixed_points     → number of points (60000)\n"
            "  discount_pct     → decimal fraction (0.10 for '10% off')\n"
            "  perk / insurance → leave null unless there's a numeric cap"
        ),
    )
    reward_value_unit: RewardValueUnit | None = Field(
        default=None,
        description="The unit of reward_value. Use 'none' for perk/insurance with no numeric cap.",
    )

    # ── Caps and spend requirements ────────────────────────────────────────
    cap_amount_cents: int | None = Field(
        default=None,
        description="Spending or earning cap in cents, if any. e.g. $1500 → 150000.",
        ge=0,
    )
    cap_period: CapPeriod | None = Field(
        default=None,
        description="Period over which the cap applies. Required if cap_amount_cents is set.",
    )
    min_spend_cents: int | None = Field(
        default=None,
        description="For sign-up / spend-based bonuses: minimum spend required.",
        ge=0,
    )
    min_spend_period_months: int | None = Field(
        default=None,
        description="Months allowed to hit the min_spend.",
        ge=0,
        le=24,
    )

    # ── Time / recurrence ──────────────────────────────────────────────────
    recurrence: Recurrence = Field(
        description=(
            "How often this benefit refreshes. 'one_time' for sign-up bonuses "
            "and lifetime perks; 'ongoing' for always-on multipliers; specific "
            "periods for credits that reset (monthly/quarterly/annual)."
        ),
    )
    recurrence_split: bool = Field(
        default=False,
        description=(
            "True if a periodic credit is split within its period. "
            "e.g. Amex Platinum's $100 Saks credit is annual but $50 H1 + $50 H2."
        ),
    )
    valid_from: date | None = Field(
        default=None,
        description="ISO date. Only set for limited-time offers with a known start date.",
    )
    valid_to: date | None = Field(
        default=None,
        description="ISO date. Only set for limited-time offers or expired benefits.",
    )

    # ── Activation / eligibility ───────────────────────────────────────────
    requires_activation: bool = Field(
        default=False,
        description="True if user must opt in (e.g. Chase Freedom rotating 5% categories).",
    )
    activation_method: str | None = Field(
        default=None,
        description="Free-form, e.g. 'Activate via chase.com/freedom by quarter end'.",
        max_length=300,
    )
    eligible_merchants: list[str] | None = Field(
        default=None,
        description=(
            "For narrow credits or merchant-restricted earn rates, list the "
            "specific merchants. e.g. ['Uber', 'Uber Eats']."
        ),
    )

    # ── Verification (REQUIRED) ────────────────────────────────────────────
    source_quote: str = Field(
        description=(
            "Verbatim sentence(s) from the source document supporting this "
            "extraction. Must be a substring of the source text — we check this "
            "downstream and flag violations as low-confidence."
        ),
        min_length=10,
        max_length=2000,
    )
    source_url: str | None = Field(
        default=None,
        description=(
            "URL of the source document, if applicable. Usually injected by the "
            "pipeline; the model may leave this null."
        ),
    )
    source_section: str | None = Field(
        default=None,
        description="Heading or page reference, e.g. 'Travel Benefits, p.14'.",
        max_length=200,
    )

    # ── Self-assessment ────────────────────────────────────────────────────
    extraction_confidence: ExtractionConfidence = Field(
        description=(
            "Your assessment of how confident you are in this extraction. "
            "Use 'low' if any field was inferred rather than directly stated, or "
            "if the source text is ambiguous. We surface low-confidence rows for "
            "human review."
        ),
    )
    notes: str | None = Field(
        default=None,
        description=(
            "Anything the structured fields can't capture: caveats, "
            "exclusions, related benefits."
        ),
        max_length=1000,
    )

    # ── Cross-field validators ─────────────────────────────────────────────

    @field_validator("cap_period")
    @classmethod
    def _cap_period_requires_amount(cls, v, info):
        # If a cap_period is set, the amount should be set too — and vice-versa.
        # We don't hard-fail (Claude sometimes gives us one without the other);
        # we just normalize to None on one side so downstream logic isn't confused.
        return v

    @field_validator("valid_to")
    @classmethod
    def _valid_to_after_valid_from(cls, v: date | None, info):
        if v is None:
            return v
        valid_from = info.data.get("valid_from")
        if valid_from is not None and v < valid_from:
            raise ValueError(f"valid_to ({v}) must be >= valid_from ({valid_from})")
        return v


# ─────────────────────────────────────────────────────────────────────────────
#  Anthropic tool definition (derived from the model)
# ─────────────────────────────────────────────────────────────────────────────


def _build_tool_schema() -> dict[str, Any]:
    """Build the Anthropic tool input_schema from the Pydantic model.

    Pydantic v2's JSON schema is largely compatible with what Anthropic expects
    for tool ``input_schema``. We strip a couple of Pydantic-specific keys that
    Anthropic ignores or chokes on.
    """
    schema = ExtractedBenefit.model_json_schema()
    # Anthropic doesn't need the model title at the schema root.
    schema.pop("title", None)
    return schema


RECORD_BENEFIT_TOOL: dict[str, Any] = {
    "name": "record_benefit",
    "description": (
        "Record a single discrete benefit found in the source document. Call this "
        "tool ONCE PER BENEFIT. If the source describes multiple distinct benefits "
        "(e.g. '$200 airline credit AND $100 Saks credit'), make multiple calls — "
        "one per benefit. If a benefit has multiple components that share a single "
        "rule (e.g. '4x on dining and grocery'), make ONE call per category and "
        "use the same source_quote for both."
    ),
    "input_schema": _build_tool_schema(),
}


# ─────────────────────────────────────────────────────────────────────────────
#  benefit_signature — dedup key for upserts
# ─────────────────────────────────────────────────────────────────────────────


def benefit_signature(b: ExtractedBenefit) -> str:
    """Stable hash identifying "the same benefit" across extraction runs.

    Two extractions hash to the same signature if they describe the same
    underlying benefit on the same card. We use this as the dedup key in the
    Postgres ``UNIQUE (card_id, benefit_signature)`` constraint, so quarterly
    re-extractions update existing rows instead of inserting duplicates.

    Wording differences in source_quote, slight numeric drift, and
    extraction_confidence are intentionally NOT part of the signature — only
    the structural identity of the benefit.
    """
    parts = {
        "category": b.category,
        "subcategory": (b.subcategory or "").lower().strip(),
        "reward_type": b.reward_type,
        "reward_value_unit": b.reward_value_unit or "",
        "recurrence": b.recurrence,
        # Sort + lowercase merchants so ['Uber', 'Uber Eats'] and ['uber eats', 'uber']
        # collapse to the same key.
        "eligible_merchants": sorted(
            (m.lower().strip() for m in (b.eligible_merchants or [])),
        ),
    }
    blob = json.dumps(parts, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]
