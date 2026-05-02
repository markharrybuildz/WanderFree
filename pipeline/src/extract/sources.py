"""HTTP fetcher for card source documents.

Fetches marketing pages, benefits-guide PDFs, and CFPB cardholder agreements
into memory. Returns the raw bytes plus the content type so the parser knows
which converter to use.

Design choices:

* **In-memory only.** Per locked decisions in the root README, we do not
  persist source documents. Bytes flow through the pipeline and are dropped
  after Claude returns. If audit/provenance ever matters, we revisit.

* **Tenacity for retries.** Issuer servers occasionally rate-limit or 503;
  exponential backoff with jitter handles transient failures without DOS-ing
  them.

* **TODO URLs are skipped, not failed.** Some sources in cards.yaml are
  placeholders we haven't filled in yet. The fetcher returns ``None`` for
  those so the orchestrator can carry on with the sources it does have.

* **Dependency-injected client.** Tests can pass a mock httpx.Client to
  avoid real network calls.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from extract.cards import Source
from extract.settings import get_settings

logger = logging.getLogger(__name__)

ContentKind = Literal["pdf", "html", "unknown"]


@dataclass(frozen=True)
class FetchedSource:
    """Result of fetching one Source URL."""

    source: Source
    content_kind: ContentKind
    body: bytes
    final_url: str  # after redirects — useful for relative-URL resolution

    def __repr__(self) -> str:
        # Avoid dumping the entire PDF/HTML body in repr
        return (
            f"FetchedSource(kind={self.source.kind!r}, "
            f"content={self.content_kind!r}, "
            f"bytes={len(self.body)}, url={self.final_url!r})"
        )


# ─────────────────────────────────────────────────────────────────────────────
#  Internal: classify response content type
# ─────────────────────────────────────────────────────────────────────────────


def _classify(response: httpx.Response) -> ContentKind:
    """Decide whether to treat the response as PDF or HTML.

    Trust Content-Type when present, fall back to magic-byte sniffing
    (PDFs always start with ``%PDF-``).
    """
    content_type = response.headers.get("content-type", "").lower()
    if "application/pdf" in content_type:
        return "pdf"
    if "html" in content_type or "xml" in content_type:
        return "html"

    # Fallback: sniff magic bytes
    if response.content[:5] == b"%PDF-":
        return "pdf"
    if response.content[:1] in (b"<",):
        return "html"

    return "unknown"


# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────


def make_http_client() -> httpx.Client:
    """Construct an httpx.Client with our default headers and timeout.

    Separated from ``fetch_source`` so tests can build their own mock client
    and so the orchestrator can reuse one client across all fetches in a run
    (connection pooling).
    """
    settings = get_settings()
    return httpx.Client(
        headers={
            "User-Agent": settings.wanderfree_user_agent,
            # Some issuer pages serve different markup to bots; ask politely
            # for the same content a browser would get.
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "application/pdf;q=0.9,*/*;q=0.5"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
        timeout=httpx.Timeout(settings.wanderfree_request_timeout_seconds),
        follow_redirects=True,
        # Mild retry-friendly transport: HTTP/2 helps with some issuer CDNs
        http2=False,  # opt out unless we install h2; default httpx is HTTP/1.1
    )


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential_jitter(initial=2, max=30),
    retry=retry_if_exception_type(
        (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError),
    ),
)
def _fetch_with_retries(client: httpx.Client, url: str) -> httpx.Response:
    """GET with bounded exponential backoff. Reraises on final failure.

    Note: 4xx responses are NOT retried — they're typically bot blocks or
    truly missing pages; retrying just gets you blocked harder. We let those
    bubble up via ``raise_for_status`` in the caller.
    """
    response = client.get(url)
    return response


def fetch_source(source: Source, client: httpx.Client | None = None) -> FetchedSource | None:
    """Fetch a single source URL into memory.

    Returns ``None`` if the source URL is the TODO placeholder. Raises on
    permanent errors (4xx, exhausted retries) so the orchestrator sees them
    and can decide how to log/skip per-card.

    Parameters
    ----------
    source:
        A :class:`extract.cards.Source` from the loaded catalog.
    client:
        Optional httpx.Client to reuse. If omitted, a one-shot client is
        created. For batch runs, build one with :func:`make_http_client`
        and pass it in.
    """
    if source.is_todo:
        logger.info("Skipping TODO source: kind=%s", source.kind)
        return None

    own_client = client is None
    if client is None:
        client = make_http_client()

    try:
        response = _fetch_with_retries(client, source.url)
        response.raise_for_status()

        content_kind = _classify(response)
        if content_kind == "unknown":
            logger.warning(
                "Unknown content type for %s: %s",
                source.url,
                response.headers.get("content-type", "<missing>"),
            )

        return FetchedSource(
            source=source,
            content_kind=content_kind,
            body=response.content,
            final_url=str(response.url),
        )
    finally:
        if own_client:
            client.close()
