"""Source-URL discovery for cards.yaml.

For each card in cards.yaml that has TODO source URLs, this script attempts
to find the real ones automatically:

  * **benefits_guide**: fetches the known marketing_page URL, parses the
    HTML, and scores anchor tags by text patterns ("benefits guide",
    "guide to benefits", "pricing & terms", etc.) plus a bonus for .pdf
    hrefs. Returns the top-scored link.

  * **cfpb_agreement**: best-effort lookup against the CFPB Credit Card
    Agreement Database. The CFPB site's structure can change between
    releases, so this falls back to printing manual instructions if the
    automated lookup fails.

By default writes a YAML diff to ``data/source_suggestions.yaml`` for human
review. With ``--apply``, merges the suggestions directly into cards.yaml
(making a .bak backup first).

Usage:
    .venv/bin/python -m scripts.discover_sources                 # all cards
    .venv/bin/python -m scripts.discover_sources --card chase-sapphire-reserve
    .venv/bin/python -m scripts.discover_sources --apply         # write to cards.yaml
"""

from __future__ import annotations

import argparse
import logging
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
import yaml
from selectolax.parser import HTMLParser

# Make the src layout importable when running this script directly.
PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT / "src"))

from extract.cards import DEFAULT_CARDS_YAML, Card, load_cards  # noqa: E402
from extract.sources import make_http_client  # noqa: E402

logger = logging.getLogger("discover_sources")


# ─────────────────────────────────────────────────────────────────────────────
#  Link scoring patterns
# ─────────────────────────────────────────────────────────────────────────────
#
# Each tuple is (regex matched against the anchor text, points awarded).
# Multiple patterns can match a single link — points stack.

BENEFITS_GUIDE_PATTERNS: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"benefits?\s+guide", re.I), 10),
    (re.compile(r"guide\s+to\s+benefits?", re.I), 10),
    (re.compile(r"benefit\s+terms?", re.I), 8),
    (re.compile(r"rewards?\s+program\s+(rules?|terms?|guide)", re.I), 8),
    (re.compile(r"summary\s+of\s+benefits?", re.I), 7),
    (re.compile(r"(card)?holder\s+agreement", re.I), 5),
    (re.compile(r"pricing\s*&?\s*terms?", re.I), 5),
    (re.compile(r"rates?\s*&?\s*terms?", re.I), 4),
]

CFPB_PATTERNS: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"(card)?holder\s+agreement", re.I), 10),
    (re.compile(r"pricing\s*&?\s*terms?", re.I), 6),
    (re.compile(r"summary\s+of\s+terms?", re.I), 4),
]

# .pdf hrefs get a bonus — most benefits guides ship as PDFs.
PDF_BONUS = 5

# Negative bonus for obvious non-content links (avoid false positives).
NEGATIVE_KEYWORDS = re.compile(r"login|signin|apply|enroll|cookie", re.I)


# ─────────────────────────────────────────────────────────────────────────────
#  Result types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class LinkCandidate:
    """A candidate URL the discovery found, with provenance."""

    href: str
    anchor_text: str
    score: int

    def to_yaml(self) -> dict:
        return {
            "url": self.href,
            "anchor_text": self.anchor_text,
            "discovery_score": self.score,
        }


@dataclass
class CardSuggestions:
    """All discovered URLs for one card."""

    card_slug: str
    benefits_guide: LinkCandidate | None = None
    cfpb_agreement: LinkCandidate | None = None
    notes: list[str] | None = None

    def to_yaml(self) -> dict:
        out: dict = {}
        if self.benefits_guide:
            out["benefits_guide"] = self.benefits_guide.to_yaml()
        if self.cfpb_agreement:
            out["cfpb_agreement"] = self.cfpb_agreement.to_yaml()
        if self.notes:
            out["notes"] = self.notes
        return out


# ─────────────────────────────────────────────────────────────────────────────
#  Link-scoring core (pure function — easy to test)
# ─────────────────────────────────────────────────────────────────────────────


def score_link(
    text: str,
    href: str,
    patterns: list[tuple[re.Pattern[str], int]],
) -> int:
    """Compute a discovery score for one anchor tag.

    Higher = more likely to be the link we want. 0 = irrelevant.
    Penalizes anchors whose text suggests an action (apply, sign in) since
    those are usually NOT the static benefits doc we're looking for.
    """
    if NEGATIVE_KEYWORDS.search(text):
        return 0

    score = 0
    for pattern, points in patterns:
        if pattern.search(text):
            score += points

    # Don't reward zero-text links even if href looks promising — those are
    # usually image-only links to legal docs that are hard for users to find
    # but easy for us to misread.
    if score == 0:
        return 0

    if href.lower().endswith(".pdf"):
        score += PDF_BONUS

    return score


def find_links(
    html: bytes,
    base_url: str,
    patterns: list[tuple[re.Pattern[str], int]],
) -> list[LinkCandidate]:
    """Score every anchor in the HTML against the given patterns.

    Returns candidates sorted by descending score.
    """
    tree = HTMLParser(html.decode("utf-8", errors="replace"))
    candidates: list[LinkCandidate] = []

    for a in tree.css("a"):
        href = (a.attributes.get("href") or "").strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue

        # Anchor text — collapse whitespace so "Benefits   Guide" matches "Benefits Guide".
        text = " ".join((a.text() or "").split())
        if not text:
            continue

        s = score_link(text, href, patterns)
        if s > 0:
            absolute = href if href.startswith(("http://", "https://")) else urljoin(base_url, href)
            candidates.append(
                LinkCandidate(href=absolute, anchor_text=text[:120], score=s),
            )

    candidates.sort(key=lambda c: -c.score)
    return candidates


# ─────────────────────────────────────────────────────────────────────────────
#  Per-source discovery
# ─────────────────────────────────────────────────────────────────────────────


def discover_benefits_guide(
    client: httpx.Client,
    marketing_url: str,
) -> LinkCandidate | None:
    """Fetch the marketing page and pick the best benefits-guide candidate."""
    try:
        response = client.get(marketing_url)
        response.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("Failed to fetch marketing page %s: %s", marketing_url, e)
        return None

    candidates = find_links(response.content, str(response.url), BENEFITS_GUIDE_PATTERNS)
    if not candidates:
        return None

    top = candidates[0]
    logger.info(
        "Found benefits_guide candidate for %s: score=%d href=%s",
        marketing_url,
        top.score,
        top.href,
    )
    return top


def discover_cfpb_agreement(
    client: httpx.Client,
    issuer_name: str,
    card_name: str,
) -> tuple[LinkCandidate | None, str | None]:
    """Best-effort CFPB CCAD lookup.

    Returns (candidate, note). The note is an explanation when the lookup
    fails, suitable for display alongside the suggestion.

    The CFPB site's URL structure has changed over the years; rather than
    bake in a brittle assumption about the current shape, we hit the public
    search endpoint and fall back to a clear "do this manually" note.
    """
    # The CFPB search interface accepts ``q`` and returns HTML results.
    # As of our last check this endpoint exists but exact response markup
    # may differ — this code is intentionally defensive.
    search_url = "https://www.consumerfinance.gov/credit-cards/agreements/"
    params = {"q": f"{issuer_name} {card_name}"}

    try:
        response = client.get(search_url, params=params, timeout=20.0)
        response.raise_for_status()
    except httpx.HTTPError as e:
        return None, (
            f"CFPB search failed ({e}). Look up manually at "
            f"{search_url}?q={issuer_name}+{card_name}"
        )

    # Look for any anchors in the result that match cardholder agreement
    # patterns. This is fuzzy by design — if the CFPB redesigns the
    # results page, we'll find nothing rather than something wrong.
    candidates = find_links(response.content, str(response.url), CFPB_PATTERNS)
    cfpb_candidates = [
        c for c in candidates
        if "consumerfinance.gov" in urlparse(c.href).netloc
    ]
    if not cfpb_candidates:
        return None, (
            f"CFPB search returned no recognizable agreement link. "
            f"Look up manually at {search_url}?q={issuer_name}+{card_name}"
        )

    top = cfpb_candidates[0]
    logger.info(
        "Found cfpb_agreement candidate for %s %s: %s",
        issuer_name,
        card_name,
        top.href,
    )
    return top, None


# ─────────────────────────────────────────────────────────────────────────────
#  Per-card orchestration
# ─────────────────────────────────────────────────────────────────────────────


def discover_for_card(card: Card, client: httpx.Client) -> CardSuggestions | None:
    """Discover URLs for any TODO source in this card. Returns None if nothing to do."""
    todo_kinds = {s.kind for s in card.sources if s.is_todo}
    if not todo_kinds:
        return None

    suggestions = CardSuggestions(card_slug=card.slug)
    notes: list[str] = []

    # The marketing page is our launching point for benefits-guide discovery.
    marketing_url = next(
        (s.url for s in card.sources if s.kind == "marketing_page" and not s.is_todo),
        None,
    )

    if "benefits_guide" in todo_kinds:
        if marketing_url:
            suggestions.benefits_guide = discover_benefits_guide(client, marketing_url)
            if suggestions.benefits_guide is None:
                notes.append(
                    "No benefits_guide link found on marketing page. "
                    "May need to be located manually."
                )
        else:
            notes.append(
                "No marketing_page URL set — can't search for benefits_guide. "
                "Fill in marketing_page first, then re-run."
            )

    if "cfpb_agreement" in todo_kinds:
        candidate, note = discover_cfpb_agreement(
            client,
            card.issuer.name,
            card.name,
        )
        suggestions.cfpb_agreement = candidate
        if note:
            notes.append(note)

    if notes:
        suggestions.notes = notes

    return suggestions


# ─────────────────────────────────────────────────────────────────────────────
#  Output: write to source_suggestions.yaml or apply directly
# ─────────────────────────────────────────────────────────────────────────────


def write_suggestions(suggestions: dict[str, CardSuggestions], out_path: Path) -> None:
    payload = {slug: s.to_yaml() for slug, s in suggestions.items()}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(yaml.safe_dump(payload, sort_keys=False, default_flow_style=False))
    logger.info("Wrote %d card suggestions to %s", len(suggestions), out_path)


def apply_to_cards_yaml(
    suggestions: dict[str, CardSuggestions],
    cards_yaml_path: Path,
) -> int:
    """Merge suggestions into cards.yaml in place (with .bak backup).

    Only updates URLs whose current value is the literal "TODO". We never
    overwrite a real URL the user might have set themselves.

    Returns the count of URLs actually updated.
    """
    backup = cards_yaml_path.with_suffix(cards_yaml_path.suffix + ".bak")
    shutil.copy2(cards_yaml_path, backup)
    logger.info("Backed up cards.yaml to %s", backup)

    raw = yaml.safe_load(cards_yaml_path.read_text())
    updated = 0

    for card_row in raw["cards"]:
        slug = card_row["slug"]
        card_suggestions = suggestions.get(slug)
        if card_suggestions is None:
            continue

        for source_row in card_row["sources"]:
            kind = source_row["kind"]
            current_url = source_row.get("url", "")
            if current_url.strip().upper() != "TODO":
                continue  # only fill TODOs

            candidate: LinkCandidate | None = None
            if kind == "benefits_guide":
                candidate = card_suggestions.benefits_guide
            elif kind == "cfpb_agreement":
                candidate = card_suggestions.cfpb_agreement

            if candidate is not None:
                source_row["url"] = candidate.href
                updated += 1
                logger.info("[%s] updated %s URL", slug, kind)

    cards_yaml_path.write_text(
        yaml.safe_dump(raw, sort_keys=False, default_flow_style=False, width=120),
    )
    return updated


# ─────────────────────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="discover-sources",
        description=(
            "Discover benefits_guide and cfpb_agreement URLs for cards in "
            "cards.yaml that currently have TODO placeholders."
        ),
    )
    parser.add_argument(
        "--card",
        type=str,
        default=None,
        help="Only discover for this card slug (default: all cards with TODOs).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help=(
            "Write discovered URLs back to cards.yaml in place "
            "(makes a .bak backup first). Default: write to a separate "
            "suggestions file for review."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PIPELINE_ROOT / "data" / "source_suggestions.yaml",
        help="Where to write suggestions (ignored if --apply).",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    catalog = load_cards()
    if args.card:
        cards = [c for c in catalog.cards if c.slug == args.card]
        if not cards:
            print(f"No such card: {args.card}", file=sys.stderr)
            return 2
    else:
        cards = catalog.cards

    cards_with_todos = [c for c in cards if any(s.is_todo for s in c.sources)]
    if not cards_with_todos:
        print("No cards have TODO source URLs — nothing to do.")
        return 0

    logger.info("Discovering sources for %d cards with TODO URLs", len(cards_with_todos))

    suggestions: dict[str, CardSuggestions] = {}
    client = make_http_client()
    try:
        for card in cards_with_todos:
            logger.info("─── %s ───", card.slug)
            result = discover_for_card(card, client)
            if result is not None:
                suggestions[card.slug] = result
    finally:
        client.close()

    if args.apply:
        count = apply_to_cards_yaml(suggestions, DEFAULT_CARDS_YAML)
        print(f"Applied {count} URL updates to {DEFAULT_CARDS_YAML}")
    else:
        write_suggestions(suggestions, args.output)
        print(f"Suggestions written to {args.output}")
        print("Review them and either copy URLs into cards.yaml manually,")
        print("or re-run with --apply to merge automatically.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
