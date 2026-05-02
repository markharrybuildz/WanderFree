"""Loader for ``data/cards.yaml``.

Validates the YAML structure with Pydantic and resolves slug-based foreign
keys (issuer, network_tier) into actual references. Returns plain Python
objects the rest of the pipeline can iterate over.

Failure modes raised as ``ValueError``:
  * unknown issuer slug on a card
  * unknown network_tier slug on a card
  * duplicate card slug
  * missing required fields

Usage:
    from extract.cards import load_cards
    catalog = load_cards()
    for card in catalog.cards:
        print(card.slug, card.issuer.name, len(card.sources))
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

# ─────────────────────────────────────────────────────────────────────────────
#  YAML row models (raw shape, before FK resolution)
# ─────────────────────────────────────────────────────────────────────────────

SourceKind = Literal["cfpb_agreement", "marketing_page", "benefits_guide"]


class _IssuerRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    name: str


class _NetworkTierRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    network: Literal["visa", "mastercard", "amex", "discover"]
    tier_name: str


class _SourceRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: SourceKind
    url: str  # may be the literal string "TODO"


class _CardRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    name: str
    issuer: str                   # FK slug
    network_tier: str | None      # FK slug or null
    is_business: bool
    annual_fee_cents: int | None = Field(default=None, ge=0)
    sources: list[_SourceRow] = Field(min_length=1)


class _CardsYaml(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issuers: list[_IssuerRow] = Field(min_length=1)
    network_tiers: list[_NetworkTierRow] = Field(min_length=1)
    cards: list[_CardRow] = Field(min_length=1)


# ─────────────────────────────────────────────────────────────────────────────
#  Resolved domain models (what the rest of the pipeline consumes)
# ─────────────────────────────────────────────────────────────────────────────


class Issuer(BaseModel):
    slug: str
    name: str


class NetworkTier(BaseModel):
    slug: str
    network: Literal["visa", "mastercard", "amex", "discover"]
    tier_name: str


class Source(BaseModel):
    kind: SourceKind
    url: str

    @property
    def is_todo(self) -> bool:
        """True if the URL is the placeholder ``TODO`` and should be skipped."""
        return self.url.strip().upper() == "TODO"


class Card(BaseModel):
    """A card with FKs resolved to actual Issuer / NetworkTier instances."""

    slug: str
    name: str
    issuer: Issuer
    network_tier: NetworkTier | None
    is_business: bool
    annual_fee_cents: int | None
    sources: list[Source]

    @property
    def fetchable_sources(self) -> list[Source]:
        """Sources whose URL is real (not TODO) and therefore fetchable."""
        return [s for s in self.sources if not s.is_todo]


class Catalog(BaseModel):
    """Resolved catalog returned by :func:`load_cards`."""

    issuers: list[Issuer]
    network_tiers: list[NetworkTier]
    cards: list[Card]

    def card_by_slug(self, slug: str) -> Card | None:
        return next((c for c in self.cards if c.slug == slug), None)

    @model_validator(mode="after")
    def _check_card_slug_uniqueness(self):
        seen: set[str] = set()
        for c in self.cards:
            if c.slug in seen:
                raise ValueError(f"duplicate card slug: {c.slug}")
            seen.add(c.slug)
        return self


# ─────────────────────────────────────────────────────────────────────────────
#  Loader
# ─────────────────────────────────────────────────────────────────────────────


DEFAULT_CARDS_YAML = Path(__file__).resolve().parents[2] / "data" / "cards.yaml"


def load_cards(path: Path | None = None) -> Catalog:
    """Load and validate ``cards.yaml``, returning a fully-resolved Catalog.

    Parameters
    ----------
    path:
        Override the location of cards.yaml. Defaults to ``pipeline/data/cards.yaml``.
        Useful for tests.

    Raises
    ------
    FileNotFoundError
        If the YAML file doesn't exist.
    pydantic.ValidationError
        If the YAML has structural problems (missing fields, wrong types).
    ValueError
        If a card references an unknown issuer or network_tier slug.
    """
    yaml_path = path or DEFAULT_CARDS_YAML

    with yaml_path.open() as f:
        raw = yaml.safe_load(f)

    parsed = _CardsYaml.model_validate(raw)

    # Build slug → object lookup tables for FK resolution.
    issuers_by_slug = {row.slug: Issuer(slug=row.slug, name=row.name) for row in parsed.issuers}
    tiers_by_slug = {
        row.slug: NetworkTier(slug=row.slug, network=row.network, tier_name=row.tier_name)
        for row in parsed.network_tiers
    }

    resolved_cards: list[Card] = []
    for row in parsed.cards:
        # FK: issuer
        issuer = issuers_by_slug.get(row.issuer)
        if issuer is None:
            raise ValueError(
                f"card {row.slug!r} references unknown issuer {row.issuer!r}; "
                f"known: {sorted(issuers_by_slug)}",
            )

        # FK: network_tier (nullable)
        tier: NetworkTier | None = None
        if row.network_tier is not None:
            tier = tiers_by_slug.get(row.network_tier)
            if tier is None:
                raise ValueError(
                    f"card {row.slug!r} references unknown network_tier "
                    f"{row.network_tier!r}; known: {sorted(tiers_by_slug)}",
                )

        resolved_cards.append(
            Card(
                slug=row.slug,
                name=row.name,
                issuer=issuer,
                network_tier=tier,
                is_business=row.is_business,
                annual_fee_cents=row.annual_fee_cents,
                sources=[Source(kind=s.kind, url=s.url) for s in row.sources],
            ),
        )

    return Catalog(
        issuers=list(issuers_by_slug.values()),
        network_tiers=list(tiers_by_slug.values()),
        cards=resolved_cards,
    )
