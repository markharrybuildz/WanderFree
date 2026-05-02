"""Post-extraction validation.

Pydantic already enforced field-level shape inside ``ExtractedBenefit`` (types,
enums, length bounds). This module does the cross-field and content checks
that need access to the original source text:

  * ``source_quote`` substring check — the most important hallucination
    tripwire. If the quote isn't actually present in the source, we don't
    drop the row but we downgrade confidence to 'low' so it lands in the
    review queue.

  * Numeric sanity bounds — catches obvious extraction errors like a
    "$30,000 dining credit" (= 3,000,000 cents, which is plausible for a
    sign-up bonus but not for a dining credit).

  * Cross-field consistency — e.g. ``cap_amount_cents`` set without
    ``cap_period``, or ``min_spend_cents`` set without
    ``min_spend_period_months``.

The output ``ValidatedBenefit`` carries the (possibly adjusted) benefit plus
a list of flags describing what triggered. Flags are persisted alongside the
benefit so a reviewer can see why something was downgraded.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from extract.schema import ExtractedBenefit

# ─────────────────────────────────────────────────────────────────────────────
#  Sanity bounds for numeric fields
#  These catch obvious errors. They're permissive — we'd rather under-flag
#  than over-flag (every flag costs reviewer time).
# ─────────────────────────────────────────────────────────────────────────────

# Largest plausible single statement credit ($10,000 in cents).
# Sign-up bonuses can exceed this; we don't sanity-check those.
SANE_STATEMENT_CREDIT_CENTS = 10_000_00

# Largest plausible reward multiplier (e.g. "20x on travel through portal").
# We've seen up to 14x in real card terms; 50x is the wall.
SANE_MAX_MULTIPLIER = 50.0

# Largest plausible cap amount (per-period spending cap on a category).
# $100K/year is comfortably above any consumer or small-business card.
SANE_MAX_CAP_CENTS = 100_000_00


# ─────────────────────────────────────────────────────────────────────────────
#  Result type
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ValidatedBenefit:
    """Validated wrapper around an ExtractedBenefit.

    ``flags`` documents every check that triggered. Empty list = clean pass.
    ``benefit`` may have its ``extraction_confidence`` downgraded by validation.
    """

    benefit: ExtractedBenefit
    flags: list[str] = field(default_factory=list)

    @property
    def passed_clean(self) -> bool:
        return not self.flags


# ─────────────────────────────────────────────────────────────────────────────
#  Source-quote check (the main hallucination tripwire)
# ─────────────────────────────────────────────────────────────────────────────


_WHITESPACE_RUN = re.compile(r"\s+")


def _normalize_for_comparison(text: str) -> str:
    """Collapse whitespace and normalize quote characters for substring match.

    PDFs especially have inconsistent whitespace from text-layer extraction,
    and curly vs straight quotes round-trip badly through some pipelines. We
    don't want to flag a real quote as missing because of typographic noise.
    """
    text = text.replace("‘", "'").replace("’", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("—", "-")
    text = text.replace("\xa0", " ")  # non-breaking space → space
    return _WHITESPACE_RUN.sub(" ", text).strip().lower()


def source_quote_present(quote: str, source_text: str) -> bool:
    """Check whether the model's source_quote actually appears in the source.

    Both sides are normalized first (whitespace, quote chars, dashes) to
    avoid false negatives from typographic noise.
    """
    needle = _normalize_for_comparison(quote)
    haystack = _normalize_for_comparison(source_text)
    if not needle:
        return False
    return needle in haystack


# ─────────────────────────────────────────────────────────────────────────────
#  Validators
# ─────────────────────────────────────────────────────────────────────────────


def _check_source_quote(b: ExtractedBenefit, source_text: str, flags: list[str]) -> None:
    """Verify the source_quote is a real substring of the source text."""
    if not source_quote_present(b.source_quote, source_text):
        flags.append("source_quote_not_found_in_source")


def _check_numeric_bounds(b: ExtractedBenefit, flags: list[str]) -> None:
    """Sanity-check numeric fields against permissive upper bounds."""
    if (
        b.reward_type == "statement_credit"
        and b.reward_value is not None
        and b.reward_value > SANE_STATEMENT_CREDIT_CENTS
    ):
        flags.append(
            f"statement_credit_value_above_sane_bound({b.reward_value} cents)",
        )

    if (
        b.reward_type == "points_multiplier"
        and b.reward_value is not None
        and b.reward_value > SANE_MAX_MULTIPLIER
    ):
        flags.append(
            f"points_multiplier_above_sane_bound({b.reward_value}x)",
        )

    if b.cap_amount_cents is not None and b.cap_amount_cents > SANE_MAX_CAP_CENTS:
        flags.append(
            f"cap_amount_above_sane_bound({b.cap_amount_cents} cents)",
        )

    # Percentage fields should be 0..1 in our convention
    if (
        b.reward_type in ("cash_back_pct", "discount_pct")
        and b.reward_value is not None
        and not (0.0 < b.reward_value <= 1.0)
    ):
        flags.append(
            f"percentage_outside_0_1_range({b.reward_value})",
        )


def _check_cross_field_consistency(b: ExtractedBenefit, flags: list[str]) -> None:
    """Catch obvious inconsistencies like cap amount without cap period."""
    if b.cap_amount_cents is not None and b.cap_period in (None, "none"):
        flags.append("cap_amount_set_without_cap_period")

    if b.cap_period not in (None, "none") and b.cap_amount_cents is None:
        flags.append("cap_period_set_without_cap_amount")

    if b.min_spend_cents is not None and b.min_spend_period_months is None:
        flags.append("min_spend_set_without_period")

    if b.requires_activation and not b.activation_method:
        # Not strictly wrong but a reviewer should add the method.
        flags.append("requires_activation_without_method")


# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────


def validate(benefit: ExtractedBenefit, source_text: str) -> ValidatedBenefit:
    """Run all checks against one extracted benefit.

    If any flag fires AND the benefit currently claims 'high' confidence, it
    gets downgraded to 'medium' (or 'low' if the source quote was bogus). We
    never UPGRADE confidence — the model's self-assessment is respected when
    it errs on the cautious side.
    """
    flags: list[str] = []

    _check_source_quote(benefit, source_text, flags)
    _check_numeric_bounds(benefit, flags)
    _check_cross_field_consistency(benefit, flags)

    adjusted = benefit
    if "source_quote_not_found_in_source" in flags:
        # Quote fabrication is the worst failure mode → force 'low'.
        adjusted = benefit.model_copy(update={"extraction_confidence": "low"})
    elif flags and benefit.extraction_confidence == "high":
        # Other flags → bump high → medium. Don't touch already-cautious calls.
        adjusted = benefit.model_copy(update={"extraction_confidence": "medium"})

    return ValidatedBenefit(benefit=adjusted, flags=flags)
