"""PDF / HTML → text → chunked sections, ready for LLM extraction.

Two-step pipeline:

  bytes ──parse_pdf/parse_html──▶ clean plain text ──chunk_by_section──▶ TextChunk[]

Why chunk?

  * Cardholder agreements are 30–80 pages and would blow the per-call budget
    if sent whole.
  * Smaller, focused chunks improve recall — Claude is much more reliable
    extracting "all benefits in this Travel Insurance section" than "all
    benefits in this 60-page document."
  * Per-section chunks give us source_section labels for free.

Chunking strategy:

  1. Try to split at heading boundaries (markers we inserted in the parser).
  2. If a section is still too big (rare for HTML, common for unstructured
     PDFs), split it further at paragraph boundaries.
  3. Cap chunk size at MAX_CHUNK_CHARS so single Claude calls stay cheap and
     output fits in the model's reply budget.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import pypdfium2 as pdfium
from selectolax.parser import HTMLParser

from extract.sources import FetchedSource

logger = logging.getLogger(__name__)


# Heading marker we insert in plaintext to remember where headings were.
# Chosen to be vanishingly unlikely to occur in source text.
HEADING_MARKER_RE = re.compile(r"^\x00HEADING\x01(.+?)\x02$", re.MULTILINE)
HEADING_MARKER_FMT = "\x00HEADING\x01{title}\x02"

# Tags we strip from HTML before extracting text — they're never useful for
# benefits content and just inflate token counts.
HTML_STRIP_SELECTORS = (
    "script",
    "style",
    "noscript",
    "nav",
    "footer",
    "header",
    "aside",
    "form",
    "[role=navigation]",
    "[aria-hidden=true]",
)

# Approximate character budget per chunk. ~30k chars ≈ ~7-8k tokens, which
# leaves comfortable room for the system prompt + tool schema + response.
MAX_CHUNK_CHARS = 30_000

# If a heading-bounded section is larger than this, split further.
SPLIT_AT_PARA_THRESHOLD = MAX_CHUNK_CHARS


@dataclass
class TextChunk:
    """One unit of text we send to Claude as a single extraction call."""

    section_title: str | None  # heading the chunk falls under, if known
    section_index: int         # 0-based position in the document
    text: str

    @property
    def char_count(self) -> int:
        return len(self.text)


# ─────────────────────────────────────────────────────────────────────────────
#  PDF → text
# ─────────────────────────────────────────────────────────────────────────────


def parse_pdf(body: bytes) -> str:
    """Extract plain text from a PDF using pypdfium2.

    pypdfium2 reads from a bytes object directly — no temp file. For each page
    we extract text in reading order. We don't attempt heading detection here
    (would require font-size heuristics that are unreliable across issuers);
    chunking falls back to paragraph-boundary splitting for PDFs.
    """
    pdf = pdfium.PdfDocument(body)
    try:
        page_texts: list[str] = []
        for page_idx in range(len(pdf)):
            page = pdf[page_idx]
            try:
                textpage = page.get_textpage()
                try:
                    page_texts.append(textpage.get_text_range())
                finally:
                    textpage.close()
            finally:
                page.close()
        return "\n\n".join(page_texts)
    finally:
        pdf.close()


# ─────────────────────────────────────────────────────────────────────────────
#  HTML → text  (with heading markers preserved)
# ─────────────────────────────────────────────────────────────────────────────


def parse_html(body: bytes) -> str:
    """Extract main-content text from an HTML page.

    Strategy:
      1. Strip noise tags (nav/footer/scripts/etc.).
      2. Pick a main-content node (main / article / role=main / body fallback).
      3. Walk the subtree, inserting our HEADING_MARKER for h1/h2/h3 elements
         so the chunker can split on them later.

    selectolax is Lexbor-backed and ~5–10x faster than BeautifulSoup, which
    matters when we're parsing dozens of pages per run.
    """
    tree = HTMLParser(body.decode("utf-8", errors="replace"))

    # 1. Strip noise — modifies the tree in place.
    for selector in HTML_STRIP_SELECTORS:
        for node in tree.css(selector):
            node.decompose()

    # 2. Pick the main content root.
    root = (
        tree.css_first("main")
        or tree.css_first("article")
        or tree.css_first("[role=main]")
        or tree.body
    )
    if root is None:
        return ""

    # 3. Walk the DOM; emit text with heading markers.
    parts: list[str] = []
    _walk_html(root, parts)
    return "\n".join(parts)


def _walk_html(node, parts: list[str]) -> None:  # type: ignore[no-untyped-def]
    """Recursively walk an selectolax node and emit text + heading markers."""
    tag = node.tag

    # Heading: emit a marker, then descend (children give us the title text).
    if tag in ("h1", "h2", "h3"):
        title = " ".join(node.text(separator=" ", strip=True).split())
        if title:
            parts.append("")
            parts.append(HEADING_MARKER_FMT.format(title=title))
        return

    # Block-ish tags: descend, then add a blank line so paragraphs are clean.
    block_tags = ("p", "div", "section", "article", "li", "tr", "blockquote", "br")

    # Leaf text: emit text content with whitespace normalized
    if tag == "-text":
        text = node.text() if node.text() else ""
        if text.strip():
            parts.append(re.sub(r"\s+", " ", text).strip())
        return

    for child in node.iter(include_text=True):
        _walk_html(child, parts)

    if tag in block_tags:
        parts.append("")


# ─────────────────────────────────────────────────────────────────────────────
#  Chunker
# ─────────────────────────────────────────────────────────────────────────────


def chunk_by_section(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[TextChunk]:
    """Split text into chunks at heading boundaries (or paragraphs as fallback).

    Steps:
      1. If the text contains HEADING_MARKERs (HTML path), split there.
      2. Otherwise (PDF path), split into paragraphs and pack greedily.
      3. Any single section larger than ``max_chars`` is split further at
         paragraph boundaries.

    Returns at least one chunk even for empty input.
    """
    text = text.strip()
    if not text:
        return [TextChunk(section_title=None, section_index=0, text="")]

    # ── Heading-aware path ─────────────────────────────────────────────────
    if HEADING_MARKER_RE.search(text):
        sections = _split_at_heading_markers(text)
    else:
        # ── Paragraph-pack fallback for unstructured text (PDFs) ────────────
        sections = [(None, text)]

    # ── Apply max_chars limit, splitting oversized sections ───────────────
    chunks: list[TextChunk] = []
    section_idx = 0
    for title, body in sections:
        if len(body) <= max_chars:
            chunks.append(TextChunk(section_title=title, section_index=section_idx, text=body))
            section_idx += 1
        else:
            for sub in _split_paragraphs(body, max_chars):
                chunks.append(TextChunk(section_title=title, section_index=section_idx, text=sub))
                section_idx += 1

    return chunks


def _split_at_heading_markers(text: str) -> list[tuple[str | None, str]]:
    """Slice text into (heading_title, body) pairs at HEADING_MARKER positions.

    Anything before the first heading becomes a (None, preamble) chunk.
    """
    matches = list(HEADING_MARKER_RE.finditer(text))
    sections: list[tuple[str | None, str]] = []

    # Preamble before first heading
    if matches and matches[0].start() > 0:
        preamble = text[: matches[0].start()].strip()
        if preamble:
            sections.append((None, preamble))

    for i, m in enumerate(matches):
        title = m.group(1).strip()
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end].strip()
        if body:
            sections.append((title, body))

    if not matches:
        sections.append((None, text))

    return sections


def _split_paragraphs(text: str, max_chars: int) -> list[str]:
    """Pack paragraphs greedily into <= max_chars chunks.

    Splits on blank lines. If a single paragraph is larger than max_chars
    (rare — mostly happens with table-dump PDFs), it gets hard-split at the
    character boundary so we don't lose content.
    """
    paragraphs = re.split(r"\n\s*\n+", text)
    chunks: list[str] = []
    current = ""

    def flush() -> None:
        nonlocal current
        if current.strip():
            chunks.append(current.strip())
        current = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # Single oversized paragraph: hard split.
        if len(para) > max_chars:
            flush()
            for start in range(0, len(para), max_chars):
                chunks.append(para[start : start + max_chars])
            continue

        # Would adding this paragraph overflow? Flush first.
        if current and len(current) + len(para) + 2 > max_chars:
            flush()
        current = (current + "\n\n" + para) if current else para

    flush()
    return chunks


# ─────────────────────────────────────────────────────────────────────────────
#  End-to-end convenience
# ─────────────────────────────────────────────────────────────────────────────


def parse_and_chunk(fetched: FetchedSource) -> list[TextChunk]:
    """Convert one fetched source into ready-to-extract chunks.

    Routes to the right parser based on detected content kind. Skips ``unknown``
    content kinds with a warning rather than crashing — those usually indicate
    a bot block or a redirect to a sign-in page that we can't do anything with.
    """
    if fetched.content_kind == "pdf":
        text = parse_pdf(fetched.body)
    elif fetched.content_kind == "html":
        text = parse_html(fetched.body)
    else:
        logger.warning(
            "Unknown content kind for %s — skipping (no parser available)",
            fetched.final_url,
        )
        return []

    chunks = chunk_by_section(text)
    logger.info(
        "Parsed %s: %d chars → %d chunks",
        fetched.final_url,
        len(text),
        len(chunks),
    )
    return chunks
