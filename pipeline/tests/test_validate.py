"""Tests for validate.py — post-extraction validation.

The hallucination tripwire (source_quote check) is the most important one,
so it gets the most coverage. Numeric bounds + cross-field consistency
get representative cases each.
"""

from __future__ import annotations

import pytest

from extract.schema import ExtractedBenefit
from extract.validate import (
    SANE_MAX_CAP_CENTS,
    SANE_STATEMENT_CREDIT_CENTS,
    source_quote_present,
    validate,
)

# ─────────────────────────────────────────────────────────────────────────────
#  Helpers — build a minimum-valid benefit for tests to mutate.
# ─────────────────────────────────────────────────────────────────────────────


def _benefit(**overrides) -> ExtractedBenefit:
    base = {
        "category": "dining",
        "reward_type": "points_multiplier",
        "reward_value": 4.0,
        "reward_value_unit": "points_per_dollar",
        "recurrence": "ongoing",
        "source_quote": "Earn 4X points at restaurants worldwide.",
        "extraction_confidence": "high",
    }
    base.update(overrides)
    return ExtractedBenefit(**base)


# ─────────────────────────────────────────────────────────────────────────────
#  source_quote_present — normalization behavior
# ─────────────────────────────────────────────────────────────────────────────


def test_quote_present_exact_match():
    src = "You earn 4X points at restaurants worldwide. Other text."
    assert source_quote_present("Earn 4X points at restaurants worldwide", src)


def test_quote_present_handles_curly_quotes():
    """PDFs frequently round-trip 'smart' quotes inconsistently — we normalize."""
    src = "Earn 4X points on “dining” worldwide."
    assert source_quote_present('Earn 4X points on "dining" worldwide.', src)


def test_quote_present_collapses_whitespace():
    """Extra whitespace from PDF text-layer extraction shouldn't trip us up."""
    src = "Earn   4X    points\non dining   worldwide."
    assert source_quote_present("Earn 4X points on dining worldwide.", src)


def test_quote_present_handles_em_dash():
    src = "Earn 4X — at restaurants worldwide."
    assert source_quote_present("Earn 4X - at restaurants worldwide.", src)


def test_quote_absent_when_truly_fabricated():
    src = "The card has no rewards on dining."
    assert not source_quote_present(
        "Earn 4X points at restaurants worldwide.",
        src,
    )


def test_quote_absent_for_empty_quote():
    assert not source_quote_present("", "any source text")


# ─────────────────────────────────────────────────────────────────────────────
#  validate() — clean pass
# ─────────────────────────────────────────────────────────────────────────────


def test_clean_benefit_passes_no_flags():
    src = "Earn 4X points at restaurants worldwide."
    result = validate(_benefit(), src)
    assert result.passed_clean
    assert result.benefit.extraction_confidence == "high"


# ─────────────────────────────────────────────────────────────────────────────
#  source_quote check — downgrade behavior
# ─────────────────────────────────────────────────────────────────────────────


def test_missing_source_quote_forces_low_confidence():
    """The most important test: hallucinated quotes can never stay 'high'."""
    src = "This document is about dispute resolution and arbitration."
    result = validate(_benefit(), src)
    assert "source_quote_not_found_in_source" in result.flags
    assert result.benefit.extraction_confidence == "low"


def test_missing_quote_downgrades_even_from_medium():
    src = "Unrelated text."
    result = validate(_benefit(extraction_confidence="medium"), src)
    assert result.benefit.extraction_confidence == "low"


# ─────────────────────────────────────────────────────────────────────────────
#  Numeric bounds
# ─────────────────────────────────────────────────────────────────────────────


def test_unreasonable_statement_credit_flagged():
    src = "Up to $999,999 in dining credits — clearly absurd."
    b = _benefit(
        reward_type="statement_credit",
        reward_value=SANE_STATEMENT_CREDIT_CENTS + 100,
        reward_value_unit="cents_usd",
        source_quote="Up to $999,999 in dining credits",
    )
    result = validate(b, src)
    assert any(f.startswith("statement_credit_value_above_sane_bound") for f in result.flags)


def test_huge_multiplier_flagged():
    src = "Earn 100X points on flights."
    b = _benefit(
        reward_value=100.0,
        reward_value_unit="points_per_dollar",
        source_quote="Earn 100X points on flights",
    )
    result = validate(b, src)
    assert any(f.startswith("points_multiplier_above_sane_bound") for f in result.flags)


def test_percentage_outside_0_1_range_flagged():
    """We expect 0.05 for 5%, NOT 5.0. Catch that confusion."""
    src = "Get 5 percent back on grocery."
    b = _benefit(
        category="grocery",
        reward_type="cash_back_pct",
        reward_value=5.0,  # ← bug: should be 0.05
        reward_value_unit="percentage",
        source_quote="Get 5 percent back on grocery",
    )
    result = validate(b, src)
    assert any("percentage_outside_0_1_range" in f for f in result.flags)


def test_huge_cap_flagged():
    src = "Spending cap"
    b = _benefit(
        cap_amount_cents=SANE_MAX_CAP_CENTS + 1,
        cap_period="per_year",
        source_quote="Spending cap",
    )
    result = validate(b, src)
    assert any(f.startswith("cap_amount_above_sane_bound") for f in result.flags)


# ─────────────────────────────────────────────────────────────────────────────
#  Cross-field consistency
# ─────────────────────────────────────────────────────────────────────────────


def test_cap_amount_without_period_flagged():
    src = "There is a cap of $1500."
    b = _benefit(
        cap_amount_cents=150000,
        cap_period=None,
        source_quote="There is a cap of $1500",
    )
    result = validate(b, src)
    assert "cap_amount_set_without_cap_period" in result.flags


def test_cap_period_without_amount_flagged():
    src = "A quarterly cap applies."
    b = _benefit(
        cap_amount_cents=None,
        cap_period="per_quarter",
        source_quote="A quarterly cap applies",
    )
    result = validate(b, src)
    assert "cap_period_set_without_cap_amount" in result.flags


def test_min_spend_without_period_flagged():
    src = "Spend $4000 to earn the bonus."
    b = _benefit(
        category="signup_bonus",
        reward_type="fixed_points",
        reward_value=60000,
        reward_value_unit="points",
        recurrence="one_time",
        min_spend_cents=400000,
        min_spend_period_months=None,
        source_quote="Spend $4000 to earn the bonus",
    )
    result = validate(b, src)
    assert "min_spend_set_without_period" in result.flags


def test_requires_activation_without_method_flagged():
    src = "5% rotating categories — activation required."
    b = _benefit(
        category="other",
        reward_type="cash_back_pct",
        reward_value=0.05,
        reward_value_unit="percentage",
        recurrence="quarterly",
        requires_activation=True,
        activation_method=None,
        source_quote="5% rotating categories — activation required",
    )
    result = validate(b, src)
    assert "requires_activation_without_method" in result.flags
    # Less severe: high → medium, not high → low
    assert result.benefit.extraction_confidence == "medium"


# ─────────────────────────────────────────────────────────────────────────────
#  Multiple flags — confidence downgrade rules
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "starting,expected_when_quote_missing",
    [
        ("high", "low"),
        ("medium", "low"),
        ("low", "low"),
    ],
)
def test_quote_check_always_forces_low_when_failing(starting, expected_when_quote_missing):
    src = "Unrelated text."
    b = _benefit(extraction_confidence=starting)
    result = validate(b, src)
    assert result.benefit.extraction_confidence == expected_when_quote_missing
