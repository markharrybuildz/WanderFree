"""Smoke test for the extraction schema.

Runs WITHOUT network access. Verifies that:

  1. ``extract.schema`` imports cleanly.
  2. The Anthropic tool JSON renders and is well-formed.
  3. A representative ExtractedBenefit instance round-trips through the
     model (Pydantic validation passes, dump/reload preserves shape).
  4. ``benefit_signature`` produces a stable hash and that two equivalent
     benefits hash to the same value.

If this fails, the extractor will fail too — fix the schema before running
``wanderfree-extract``.

Usage:
    .venv/bin/python -m scripts.dump_tool
"""

from __future__ import annotations

import json
import sys

from extract.schema import (
    RECORD_BENEFIT_TOOL,
    ExtractedBenefit,
    benefit_signature,
)


def main() -> int:
    # ── 1. Tool definition renders ─────────────────────────────────────────
    tool_json = json.dumps(RECORD_BENEFIT_TOOL, indent=2)
    print("─── Anthropic tool definition (record_benefit) ───")
    print(tool_json)
    print()

    # Sanity-check the tool shape Anthropic expects.
    assert RECORD_BENEFIT_TOOL["name"] == "record_benefit"
    assert "description" in RECORD_BENEFIT_TOOL
    assert RECORD_BENEFIT_TOOL["input_schema"]["type"] == "object"
    assert "properties" in RECORD_BENEFIT_TOOL["input_schema"]
    assert "required" in RECORD_BENEFIT_TOOL["input_schema"]
    print("✓ Tool definition has the shape Anthropic expects")

    # ── 2. A representative benefit round-trips ────────────────────────────
    sample = ExtractedBenefit(
        category="dining",
        subcategory=None,
        reward_type="points_multiplier",
        reward_value=4.0,
        reward_value_unit="points_per_dollar",
        cap_amount_cents=None,
        cap_period=None,
        recurrence="ongoing",
        requires_activation=False,
        source_quote=(
            "Earn 4X Membership Rewards points at restaurants worldwide, "
            "including takeout and delivery in the U.S."
        ),
        source_url="https://www.americanexpress.com/us/credit-cards/card/gold-card/",
        extraction_confidence="high",
    )

    dumped = sample.model_dump(mode="json")
    reloaded = ExtractedBenefit.model_validate(dumped)
    assert reloaded == sample, "round-trip changed the benefit"
    print("✓ Sample benefit round-trips through the Pydantic model")

    # ── 3. Signature is stable and dedupes equivalent benefits ─────────────
    sig_a = benefit_signature(sample)
    sig_b = benefit_signature(reloaded)
    assert sig_a == sig_b, f"reload changed signature: {sig_a} vs {sig_b}"

    # An "equivalent" benefit with different wording / source quote should hash
    # to the same signature — wording is intentionally NOT in the signature.
    sample_diff_wording = sample.model_copy(
        update={
            "source_quote": (
                "Cardmembers earn 4X points per dollar spent at U.S. restaurants."
            ),
            "extraction_confidence": "medium",
        },
    )
    sig_diff = benefit_signature(sample_diff_wording)
    assert sig_a == sig_diff, (
        f"signature should ignore wording: {sig_a} vs {sig_diff}"
    )
    print(f"✓ benefit_signature is stable across wording: {sig_a}")

    # A truly different benefit (different category) should hash differently.
    sample_diff_category = sample.model_copy(update={"category": "grocery"})
    sig_other = benefit_signature(sample_diff_category)
    assert sig_a != sig_other, "different categories should have different signatures"
    print(f"✓ benefit_signature differs across categories: {sig_other}")

    # ── 4. Forbid-extra catches bogus fields (Claude must stay in-schema) ──
    try:
        ExtractedBenefit.model_validate(
            {
                **dumped,
                "made_up_field": "should be rejected",
            },
        )
    except Exception:  # noqa: BLE001 — Pydantic raises ValidationError
        print("✓ Schema rejects unknown fields (extra='forbid' working)")
    else:
        print("✗ Schema accepted an unknown field — extra='forbid' broken")
        return 1

    print()
    print("All schema smoke checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
