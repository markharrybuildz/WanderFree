"""Tests for the cards.yaml loader.

Covers:
  * The real cards.yaml loads cleanly and has the expected shape
  * FK validation rejects unknown issuer / network_tier slugs
  * Duplicate slugs are caught
  * is_todo property correctly identifies placeholder URLs
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from extract.cards import load_cards

# ─────────────────────────────────────────────────────────────────────────────
#  Real cards.yaml
# ─────────────────────────────────────────────────────────────────────────────


def test_real_cards_yaml_loads():
    """The shipped cards.yaml should always load cleanly."""
    catalog = load_cards()
    assert len(catalog.cards) == 25, "v1 catalog is locked at 25 cards"

    # Spot-check the consumer/business split locked into the design
    biz = sum(1 for c in catalog.cards if c.is_business)
    assert biz == 7, "v1 expects 7 business cards"
    assert len(catalog.cards) - biz == 18, "v1 expects 18 consumer cards"


def test_card_lookup_by_slug():
    catalog = load_cards()
    found = catalog.card_by_slug("chase-sapphire-preferred")
    assert found is not None
    assert found.issuer.slug == "chase"
    assert found.network_tier is not None
    assert found.network_tier.slug == "visa-signature"


# ─────────────────────────────────────────────────────────────────────────────
#  Synthetic YAML — failure modes
# ─────────────────────────────────────────────────────────────────────────────


def _write_yaml(tmp_path: Path, doc: dict) -> Path:
    target = tmp_path / "cards.yaml"
    target.write_text(yaml.safe_dump(doc))
    return target


_MIN_VALID = {
    "issuers": [{"slug": "test-issuer", "name": "Test Issuer"}],
    "network_tiers": [
        {"slug": "test-tier", "network": "visa", "tier_name": "Test"}
    ],
    "cards": [
        {
            "slug": "test-card",
            "name": "Test Card",
            "issuer": "test-issuer",
            "network_tier": "test-tier",
            "is_business": False,
            "annual_fee_cents": 0,
            "sources": [{"kind": "marketing_page", "url": "https://example.com/"}],
        }
    ],
}


def test_minimal_valid_yaml(tmp_path):
    path = _write_yaml(tmp_path, _MIN_VALID)
    catalog = load_cards(path)
    assert len(catalog.cards) == 1
    card = catalog.cards[0]
    assert card.issuer.name == "Test Issuer"
    assert card.network_tier is not None
    assert card.network_tier.tier_name == "Test"


def test_unknown_issuer_rejected(tmp_path):
    bad = {**_MIN_VALID, "cards": [{**_MIN_VALID["cards"][0], "issuer": "no-such-issuer"}]}
    path = _write_yaml(tmp_path, bad)
    with pytest.raises(ValueError, match="unknown issuer 'no-such-issuer'"):
        load_cards(path)


def test_unknown_network_tier_rejected(tmp_path):
    bad = {
        **_MIN_VALID,
        "cards": [{**_MIN_VALID["cards"][0], "network_tier": "no-such-tier"}],
    }
    path = _write_yaml(tmp_path, bad)
    with pytest.raises(ValueError, match="unknown network_tier 'no-such-tier'"):
        load_cards(path)


def test_null_network_tier_allowed(tmp_path):
    """Amex / Discover cards have null network_tier — that's legal."""
    doc = {**_MIN_VALID, "cards": [{**_MIN_VALID["cards"][0], "network_tier": None}]}
    path = _write_yaml(tmp_path, doc)
    catalog = load_cards(path)
    assert catalog.cards[0].network_tier is None


def test_duplicate_card_slug_rejected(tmp_path):
    doc = {
        **_MIN_VALID,
        "cards": [_MIN_VALID["cards"][0], _MIN_VALID["cards"][0]],
    }
    path = _write_yaml(tmp_path, doc)
    with pytest.raises(ValueError, match="duplicate card slug"):
        load_cards(path)


def test_extra_field_in_card_rejected(tmp_path):
    """We use extra='forbid' so typos in the YAML get caught."""
    doc = {
        **_MIN_VALID,
        "cards": [{**_MIN_VALID["cards"][0], "totally_made_up": "value"}],
    }
    path = _write_yaml(tmp_path, doc)
    with pytest.raises(ValidationError):
        load_cards(path)


# ─────────────────────────────────────────────────────────────────────────────
#  Source.is_todo behavior
# ─────────────────────────────────────────────────────────────────────────────


def test_is_todo_url_is_skippable(tmp_path):
    doc = {
        **_MIN_VALID,
        "cards": [
            {
                **_MIN_VALID["cards"][0],
                "sources": [
                    {"kind": "marketing_page", "url": "https://example.com/"},
                    {"kind": "cfpb_agreement", "url": "TODO"},
                    {"kind": "benefits_guide", "url": "todo"},  # case insensitive
                ],
            }
        ],
    }
    path = _write_yaml(tmp_path, doc)
    catalog = load_cards(path)
    sources = catalog.cards[0].sources
    fetchable = catalog.cards[0].fetchable_sources

    assert len(sources) == 3
    assert len(fetchable) == 1
    assert fetchable[0].kind == "marketing_page"
