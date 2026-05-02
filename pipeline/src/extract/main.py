"""CLI entrypoint for the extraction pipeline.

Usage:
    # Run the full quarterly pass
    .venv/bin/python -m extract.main

    # Just one or two cards (smoke testing)
    .venv/bin/python -m extract.main --cards chase-sapphire-preferred,amex-gold

    # Dry run — extract and log but don't write to Supabase
    .venv/bin/python -m extract.main --dry-run

    # Verbose logging (DEBUG level)
    .venv/bin/python -m extract.main --verbose

This module is also exposed as the ``wanderfree-extract`` console script
(see pyproject.toml [project.scripts]).
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from collections import Counter
from dataclasses import dataclass, field

from extract.cards import Card, Catalog, load_cards
from extract.extract import ChunkExtraction, extract_chunk, make_anthropic_client
from extract.parse import parse_and_chunk
from extract.settings import get_settings
from extract.sources import fetch_source, make_http_client
from extract.store import DryRunStore, StorageBackend, Store
from extract.validate import validate

logger = logging.getLogger("extract")


# ─────────────────────────────────────────────────────────────────────────────
#  Per-run aggregation
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class CardRunSummary:
    """Per-card outcome of one extraction run."""

    card_slug: str
    sources_attempted: int = 0
    sources_skipped_todo: int = 0
    sources_failed: int = 0
    chunks_processed: int = 0
    benefits_extracted: int = 0
    benefits_stored: int = 0
    flag_counter: Counter[str] = field(default_factory=Counter)
    input_tokens: int = 0
    output_tokens: int = 0
    error: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
#  CLI argument parsing
# ─────────────────────────────────────────────────────────────────────────────


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="wanderfree-extract",
        description="Hydrate the WanderFree benefits catalog from issuer documents.",
    )
    parser.add_argument(
        "--cards",
        type=str,
        default=None,
        help=(
            "Comma-separated card slugs to extract. "
            "Default: every card in cards.yaml."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run extraction but DO NOT write to Supabase. Logs what would be written.",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="DEBUG-level logging (default: INFO).",
    )
    return parser.parse_args(argv)


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)-20s %(message)s",
        datefmt="%H:%M:%S",
        # httpx and anthropic are noisy at INFO; quiet them unless --verbose
        force=True,
    )
    if not verbose:
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("anthropic").setLevel(logging.WARNING)


# ─────────────────────────────────────────────────────────────────────────────
#  Per-card extraction
# ─────────────────────────────────────────────────────────────────────────────


def _extract_one_card(
    card: Card,
    *,
    storage: StorageBackend,
    http_client,  # httpx.Client
    anthropic_client,
) -> CardRunSummary:
    """Run the full pipeline for one card. Errors are caught + summarized."""
    summary = CardRunSummary(card_slug=card.slug)

    try:
        card_id = storage.ensure_card(card)
        if card_id is None:
            summary.error = "ensure_card returned None"
            return summary

        for source in card.sources:
            summary.sources_attempted += 1

            if source.is_todo:
                summary.sources_skipped_todo += 1
                continue

            # ── Fetch ──────────────────────────────────────────────────────
            try:
                fetched = fetch_source(source, client=http_client)
            except Exception as e:  # noqa: BLE001 — log + continue per-source
                logger.warning("Fetch failed for %s / %s: %s", card.slug, source.url, e)
                summary.sources_failed += 1
                continue

            if fetched is None:
                continue

            # ── Parse + chunk ──────────────────────────────────────────────
            chunks = parse_and_chunk(fetched)
            # The full source text — used for source_quote validation.
            source_text = "\n\n".join(c.text for c in chunks)

            for chunk in chunks:
                summary.chunks_processed += 1

                # ── Extract ────────────────────────────────────────────────
                try:
                    extraction: ChunkExtraction = extract_chunk(
                        card=card,
                        source=source,
                        chunk=chunk,
                        client=anthropic_client,
                    )
                except Exception as e:  # noqa: BLE001 — log + continue
                    logger.warning(
                        "Claude call failed for %s chunk %d: %s",
                        card.slug,
                        chunk.section_index,
                        e,
                    )
                    continue

                summary.input_tokens += extraction.input_tokens
                summary.output_tokens += extraction.output_tokens
                summary.benefits_extracted += len(extraction.benefits)

                # ── Validate + store each benefit ──────────────────────────
                for benefit in extraction.benefits:
                    validated = validate(benefit, source_text)
                    for flag in validated.flags:
                        summary.flag_counter[flag] += 1

                    try:
                        storage.upsert_card_benefit(card_id, validated)
                        summary.benefits_stored += 1
                    except Exception as e:  # noqa: BLE001
                        logger.error(
                            "Failed to store benefit for %s: %s",
                            card.slug,
                            e,
                        )

        # ── Deprecate benefits not seen this run ───────────────────────────
        deprecated = storage.deprecate_unseen_for_card(card_id)
        if deprecated:
            logger.info(
                "Deprecated %d previously-seen benefits no longer present in sources for %s",
                deprecated,
                card.slug,
            )

    except Exception as e:
        logger.exception("Card %s raised an unhandled error", card.slug)
        summary.error = str(e)

    return summary


# ─────────────────────────────────────────────────────────────────────────────
#  Top-level orchestration
# ─────────────────────────────────────────────────────────────────────────────


def _filter_cards(catalog: Catalog, slug_csv: str | None) -> list[Card]:
    if not slug_csv:
        return catalog.cards
    wanted = {s.strip() for s in slug_csv.split(",") if s.strip()}
    found = [c for c in catalog.cards if c.slug in wanted]
    missing = wanted - {c.slug for c in found}
    if missing:
        raise SystemExit(
            f"Unknown card slug(s): {sorted(missing)}. "
            f"Run without --cards to see all available slugs."
        )
    return found


def _print_summary(summaries: list[CardRunSummary], elapsed_s: float, dry_run: bool) -> None:
    """One-line-per-card summary plus totals. Goes to stdout."""
    print()
    print("─── extraction summary ─────────────────────────────────────────────")
    if dry_run:
        print("** DRY RUN — no changes written to Supabase **")
    print(
        f"{'card':<40} {'src':>4} {'chunks':>6} {'extr':>5} {'stored':>6} "
        f"{'in':>7} {'out':>6}",
    )
    print("─" * 80)
    totals = CardRunSummary(card_slug="TOTAL")
    for s in summaries:
        ok_marker = " " if not s.error else "✗"
        print(
            f"{ok_marker} {s.card_slug:<38} "
            f"{s.sources_attempted - s.sources_skipped_todo:>4} "
            f"{s.chunks_processed:>6} "
            f"{s.benefits_extracted:>5} "
            f"{s.benefits_stored:>6} "
            f"{s.input_tokens:>7} "
            f"{s.output_tokens:>6}",
        )
        if s.error:
            print(f"    ↳ ERROR: {s.error}")

        totals.sources_attempted += s.sources_attempted - s.sources_skipped_todo
        totals.chunks_processed += s.chunks_processed
        totals.benefits_extracted += s.benefits_extracted
        totals.benefits_stored += s.benefits_stored
        totals.input_tokens += s.input_tokens
        totals.output_tokens += s.output_tokens
        totals.flag_counter.update(s.flag_counter)

    print("─" * 80)
    print(
        f"  {'TOTAL':<38} "
        f"{totals.sources_attempted:>4} "
        f"{totals.chunks_processed:>6} "
        f"{totals.benefits_extracted:>5} "
        f"{totals.benefits_stored:>6} "
        f"{totals.input_tokens:>7} "
        f"{totals.output_tokens:>6}",
    )
    print()
    print(f"Elapsed: {elapsed_s:.1f}s")

    if totals.flag_counter:
        print()
        print("Validation flags raised:")
        for flag, count in totals.flag_counter.most_common():
            print(f"  {count:>4}  {flag}")
    print()


def cli(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    _setup_logging(args.verbose)

    # Load settings up-front so we fail fast on missing env vars.
    # (In dry-run we still need ANTHROPIC_API_KEY but don't need Supabase keys
    #  to exist for the actual API calls — but pydantic-settings will require
    #  all fields. For now: require everything, even in dry-run, to keep config
    #  honest. Override later if dev workflow demands it.)
    settings = get_settings()
    logger.info(
        "Pipeline starting: model=%s dry_run=%s",
        settings.wanderfree_model,
        args.dry_run,
    )

    catalog = load_cards()
    cards = _filter_cards(catalog, args.cards)
    logger.info("Will process %d card(s)", len(cards))

    storage: StorageBackend = DryRunStore() if args.dry_run else Store()
    logger.info("extraction_run_id = %s", storage.extraction_run_id)

    http_client = make_http_client()
    anthropic_client = make_anthropic_client()

    summaries: list[CardRunSummary] = []
    started = time.monotonic()
    try:
        for card in cards:
            logger.info("─── %s ───", card.slug)
            summary = _extract_one_card(
                card,
                storage=storage,
                http_client=http_client,
                anthropic_client=anthropic_client,
            )
            summaries.append(summary)
    finally:
        http_client.close()

    _print_summary(summaries, time.monotonic() - started, args.dry_run)

    # Exit non-zero if any card errored. GitHub Actions surfaces this.
    return 0 if not any(s.error for s in summaries) else 1


if __name__ == "__main__":
    sys.exit(cli())
