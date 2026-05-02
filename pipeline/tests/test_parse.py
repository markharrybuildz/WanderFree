"""Tests for parse.py — HTML extraction and chunking.

PDF parsing is exercised by the chunker tests via synthetic plaintext;
testing the actual pypdfium2 path would require a real PDF binary which
is overkill at the unit level.
"""

from __future__ import annotations

from extract.parse import (
    HEADING_MARKER_FMT,
    MAX_CHUNK_CHARS,
    chunk_by_section,
    parse_html,
)

# ─────────────────────────────────────────────────────────────────────────────
#  HTML parsing
# ─────────────────────────────────────────────────────────────────────────────


def test_html_main_content_extracted():
    html = b"""
    <html>
      <head><title>x</title><style>.a {color: red}</style></head>
      <body>
        <nav>NAV LINKS YOU SHOULD NOT SEE</nav>
        <main>
          <h2>Travel benefits</h2>
          <p>Earn 4x points on dining at restaurants.</p>
          <h2>Insurance</h2>
          <p>Trip cancellation up to $10,000 per trip.</p>
        </main>
        <footer>FOOTER YOU SHOULD NOT SEE</footer>
      </body>
    </html>
    """
    text = parse_html(html)

    # Main content present
    assert "Earn 4x points on dining at restaurants." in text
    assert "Trip cancellation up to $10,000 per trip." in text

    # Stripped sections gone
    assert "NAV LINKS YOU SHOULD NOT SEE" not in text
    assert "FOOTER YOU SHOULD NOT SEE" not in text

    # Heading markers inserted
    assert HEADING_MARKER_FMT.format(title="Travel benefits") in text
    assert HEADING_MARKER_FMT.format(title="Insurance") in text


def test_html_falls_back_to_body_when_no_main():
    html = b"""
    <html><body>
      <p>The whole body is the content</p>
    </body></html>
    """
    text = parse_html(html)
    assert "The whole body is the content" in text


def test_html_handles_no_content_gracefully():
    text = parse_html(b"<html></html>")
    assert text == ""


# ─────────────────────────────────────────────────────────────────────────────
#  Chunker — heading-aware path
# ─────────────────────────────────────────────────────────────────────────────


def test_chunker_splits_at_heading_markers():
    text = (
        HEADING_MARKER_FMT.format(title="Travel")
        + "\nEarn 5x on flights.\n\n"
        + HEADING_MARKER_FMT.format(title="Dining")
        + "\nEarn 3x at restaurants.\n"
    )
    chunks = chunk_by_section(text)

    assert len(chunks) == 2
    assert chunks[0].section_title == "Travel"
    assert "Earn 5x on flights" in chunks[0].text
    assert chunks[1].section_title == "Dining"
    assert "Earn 3x at restaurants" in chunks[1].text


def test_chunker_captures_preamble_before_first_heading():
    text = (
        "Front matter explaining the document.\n\n"
        + HEADING_MARKER_FMT.format(title="Section")
        + "\nSection body text.\n"
    )
    chunks = chunk_by_section(text)
    assert len(chunks) == 2
    assert chunks[0].section_title is None
    assert "Front matter" in chunks[0].text
    assert chunks[1].section_title == "Section"


# ─────────────────────────────────────────────────────────────────────────────
#  Chunker — paragraph-pack fallback (no heading markers, e.g. PDFs)
# ─────────────────────────────────────────────────────────────────────────────


def test_chunker_unstructured_text_returns_one_chunk_when_small():
    text = "Paragraph one.\n\nParagraph two.\n\nParagraph three."
    chunks = chunk_by_section(text)
    assert len(chunks) == 1
    assert chunks[0].section_title is None


def test_chunker_paragraph_pack_when_oversized():
    """Force the paragraph-packing path with a tiny max_chars."""
    text = "Paragraph one is short.\n\nParagraph two is also short.\n\nThird paragraph here."
    chunks = chunk_by_section(text, max_chars=30)
    # Each paragraph is < 30 chars but two-together exceed → expect ≥2 chunks
    assert len(chunks) >= 2
    # Every chunk should fit under the limit
    assert all(c.char_count <= 30 for c in chunks)


def test_chunker_hard_splits_oversized_paragraph():
    """A single paragraph larger than max_chars gets character-sliced."""
    text = "x" * 100
    chunks = chunk_by_section(text, max_chars=30)
    assert sum(c.char_count for c in chunks) == 100
    assert all(c.char_count <= 30 for c in chunks)


def test_chunker_handles_empty_input():
    chunks = chunk_by_section("")
    assert len(chunks) == 1
    assert chunks[0].text == ""


def test_max_chunk_chars_is_reasonable():
    """Sanity bound — our default chunk size should leave room for prompts."""
    # 30K chars ≈ 7-8K tokens; leaves comfortable room for system prompt + tool schema
    assert 10_000 <= MAX_CHUNK_CHARS <= 50_000
