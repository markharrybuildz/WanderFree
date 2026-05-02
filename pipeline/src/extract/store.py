"""Supabase upsert layer.

Resolves slug-based catalog entries (issuers, network_tiers, cards) into
their numeric IDs (creating rows if needed), then upserts validated benefits
keyed by ``benefit_signature``. Benefits not seen in the current
``extraction_run_id`` get their ``valid_to`` set to now() so the read view
filters them out.

The writer uses the **service role key**, which bypasses RLS. Per locked
decisions in the root README, this is server-side only — never shipped to
the mobile app.

Two main entry points:

  Store(supabase_client) — production wrapper around supabase-py.
  DryRunStore()           — no-op alternative used by `--dry-run`. Logs
                            everything it WOULD have written.

Both share the same interface so main.py is agnostic.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

from supabase import Client, create_client

from extract.cards import Card
from extract.schema import ExtractedBenefit, benefit_signature
from extract.settings import get_settings
from extract.validate import ValidatedBenefit

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
#  Result aggregation
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class StoreResult:
    """Per-card outcome of writing extracted benefits."""

    card_slug: str
    inserted: int = 0
    updated: int = 0
    deprecated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
#  Storage interface (Protocol so we can dependency-inject)
# ─────────────────────────────────────────────────────────────────────────────


class StorageBackend(Protocol):
    """Minimal interface main.py talks to.

    Both the real Store and DryRunStore satisfy this.
    """

    extraction_run_id: uuid.UUID

    def ensure_card(self, card: Card) -> int | None:
        """Return cards.id for the given card, creating issuer/tier/card rows if needed.

        Returns None if the card couldn't be ensured (e.g. real backend is in
        dry-run mode and the card doesn't exist yet).
        """

    def upsert_card_benefit(
        self,
        card_id: int,
        validated: ValidatedBenefit,
    ) -> str:
        """Upsert one card-specific benefit. Returns 'inserted' | 'updated' | 'skipped'."""

    def deprecate_unseen_for_card(self, card_id: int) -> int:
        """Mark benefits for this card not seen in this extraction_run_id as deprecated.

        Returns count of rows deprecated.
        """


# ─────────────────────────────────────────────────────────────────────────────
#  Real backend
# ─────────────────────────────────────────────────────────────────────────────


class Store:
    """Production storage backend backed by supabase-py."""

    def __init__(self, client: Client | None = None) -> None:
        self.client: Client = client or _make_default_client()
        self.extraction_run_id: uuid.UUID = uuid.uuid4()
        # Cached slug → id lookups so we don't hit Postgres for every benefit.
        self._issuer_id_cache: dict[str, int] = {}
        self._tier_id_cache: dict[str, int] = {}
        self._card_id_cache: dict[str, int] = {}

    # ── Catalog ID resolution / creation ───────────────────────────────────

    def _ensure_issuer(self, slug: str, name: str) -> int:
        if slug in self._issuer_id_cache:
            return self._issuer_id_cache[slug]
        # Upsert by slug, return id
        result = (
            self.client.table("issuers")
            .upsert({"slug": slug, "name": name}, on_conflict="slug")
            .execute()
        )
        issuer_id = result.data[0]["id"]
        self._issuer_id_cache[slug] = issuer_id
        return issuer_id

    def _ensure_network_tier(self, slug: str, network: str, tier_name: str) -> int:
        if slug in self._tier_id_cache:
            return self._tier_id_cache[slug]
        result = (
            self.client.table("network_tiers")
            .upsert(
                {"slug": slug, "network": network, "tier_name": tier_name},
                on_conflict="slug",
            )
            .execute()
        )
        tier_id = result.data[0]["id"]
        self._tier_id_cache[slug] = tier_id
        return tier_id

    def ensure_card(self, card: Card) -> int | None:
        if card.slug in self._card_id_cache:
            return self._card_id_cache[card.slug]

        issuer_id = self._ensure_issuer(card.issuer.slug, card.issuer.name)
        tier_id = (
            self._ensure_network_tier(
                card.network_tier.slug,
                card.network_tier.network,
                card.network_tier.tier_name,
            )
            if card.network_tier
            else None
        )

        payload = {
            "slug": card.slug,
            "name": card.name,
            "issuer_id": issuer_id,
            "network_tier_id": tier_id,
            "is_business": card.is_business,
            "annual_fee_cents": card.annual_fee_cents,
            "is_active": True,
        }
        result = (
            self.client.table("cards")
            .upsert(payload, on_conflict="slug")
            .execute()
        )
        card_id = result.data[0]["id"]
        self._card_id_cache[card.slug] = card_id
        return card_id

    # ── Benefit upsert ─────────────────────────────────────────────────────

    def upsert_card_benefit(
        self,
        card_id: int,
        validated: ValidatedBenefit,
    ) -> str:
        b = validated.benefit
        signature = benefit_signature(b)

        payload = _benefit_to_row(
            b,
            signature=signature,
            extraction_run_id=str(self.extraction_run_id),
            card_id=card_id,
            network_tier_id=None,
        )
        # Augment the notes with any validation flags for reviewer visibility.
        if validated.flags:
            existing = payload.get("notes") or ""
            payload["notes"] = (existing + " " if existing else "") + (
                "[validation: " + ", ".join(validated.flags) + "]"
            )

        # Upsert keyed by (card_id, benefit_signature). Postgres returns the
        # row; we don't get a clean "inserted vs updated" signal from supabase-py
        # here, so we report 'upserted' generically for both. main.py groups by
        # card so the count is still useful.
        self.client.table("benefits").upsert(
            payload,
            on_conflict="card_id,benefit_signature",
        ).execute()

        return "upserted"

    def deprecate_unseen_for_card(self, card_id: int) -> int:
        """Mark card-specific benefits not touched in this run as deprecated.

        We use update-where with extraction_run_id != current. Doing this with
        a service-role client means RLS doesn't get in the way.
        """
        result = (
            self.client.table("benefits")
            .update({"valid_to": "now()"})
            .eq("card_id", card_id)
            .neq("extraction_run_id", str(self.extraction_run_id))
            .is_("valid_to", "null")
            .execute()
        )
        return len(result.data or [])


def _make_default_client() -> Client:
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key.get_secret_value(),
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Dry-run backend
# ─────────────────────────────────────────────────────────────────────────────


class DryRunStore:
    """No-op storage backend used by --dry-run.

    Records what WOULD have been written in self.recorded so callers can
    inspect or assert on it in tests.
    """

    def __init__(self) -> None:
        self.extraction_run_id: uuid.UUID = uuid.uuid4()
        self._fake_id_counter = 1
        self._card_ids: dict[str, int] = {}
        self.recorded: list[dict[str, Any]] = []

    def ensure_card(self, card: Card) -> int | None:
        if card.slug not in self._card_ids:
            self._card_ids[card.slug] = self._fake_id_counter
            self._fake_id_counter += 1
            logger.info("[dry-run] would ensure card: %s", card.slug)
        return self._card_ids[card.slug]

    def upsert_card_benefit(
        self,
        card_id: int,
        validated: ValidatedBenefit,
    ) -> str:
        row = _benefit_to_row(
            validated.benefit,
            signature=benefit_signature(validated.benefit),
            extraction_run_id=str(self.extraction_run_id),
            card_id=card_id,
            network_tier_id=None,
        )
        row["_validation_flags"] = validated.flags
        self.recorded.append(row)
        logger.info(
            "[dry-run] would upsert benefit: card_id=%s category=%s confidence=%s flags=%s",
            card_id,
            row.get("category"),
            row.get("extraction_confidence"),
            validated.flags,
        )
        return "upserted"

    def deprecate_unseen_for_card(self, card_id: int) -> int:
        logger.info("[dry-run] would deprecate unseen benefits for card_id=%s", card_id)
        return 0


# ─────────────────────────────────────────────────────────────────────────────
#  Shared row builder
# ─────────────────────────────────────────────────────────────────────────────


def _benefit_to_row(
    b: ExtractedBenefit,
    *,
    signature: str,
    extraction_run_id: str,
    card_id: int | None,
    network_tier_id: int | None,
) -> dict[str, Any]:
    """Convert an ExtractedBenefit into a row payload for the benefits table.

    Mirrors the column names in supabase/migrations/0001_init.sql exactly.
    Pydantic gives us most of this for free via model_dump; we just add the
    columns the model doesn't carry (signature, run id, parent FK).
    """
    payload = b.model_dump(mode="json")
    # pydantic emits None for optionals; Postgres prefers SQL NULL which the
    # supabase client encodes correctly from None — so leave as is.

    payload["benefit_signature"] = signature
    payload["extraction_run_id"] = extraction_run_id
    payload["card_id"] = card_id
    payload["network_tier_id"] = network_tier_id

    # Drop the source_url field if it ends up identical to what we already
    # store at the source level — the column is keyed below.
    return payload
