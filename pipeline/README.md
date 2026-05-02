# pipeline

Quarterly batch job that hydrates the WanderFree benefits catalog by extracting
structured data from credit card source documents using the Claude API.

## What it does

1. **Fetches sources** for the cards in `data/cards.yaml`:
   - CFPB Credit Card Agreement Database (cardholder agreements)
   - Issuer marketing pages (Chase, Amex, Capital One, etc.)
   - Issuer benefits-guide PDFs (linked from marketing pages)
   - Card-network tier guides (Visa Infinite, World Elite Mastercard, etc.)

   Source bytes are processed in-memory and discarded — no document storage.
   See root `README.md` "Locked decisions" for why.

2. **Converts to text** — `pypdfium2` for PDFs, `selectolax` for HTML.
   Splits into chunks by section heading.

3. **Extracts benefits via Claude API** using forced tool-use mode. The model
   calls `record_benefit(...)` once per discrete benefit it finds. Schema is
   defined in `src/extract/schema.py`.

4. **Validates** each extraction:
   - `source_quote` must appear verbatim in the source text (hallucination tripwire)
   - Required fields present
   - Numeric fields within sane bounds
   Failures are flagged with `extraction_confidence = "low"` rather than dropped.

5. **Upserts** to Supabase Postgres, keyed by `(card_id, benefit_signature)`.
   Benefits not seen in this run get `valid_to = now()` so the read view filters
   them out.

## Local development

Per the personal CLAUDE.md preferences in this repo: use a per-project `.venv`,
prefer explicit interpreter paths over `source activate`, tee install logs.

```bash
cd pipeline

# Create venv pinned to repo's .python-version (3.12)
python3.12 -m venv .venv

# Install editable + dev deps. Tee the log so we can debug compile failures.
.venv/bin/python -m pip install --upgrade pip 2>&1 | tee /tmp/pip-install.log
.venv/bin/python -m pip install -e ".[dev]" 2>&1 | tee -a /tmp/pip-install.log

# Verify the package is importable
.venv/bin/python -c "import extract; print(extract.__file__)"

# Smoke-test the extraction schema (no network calls)
.venv/bin/python -m extract.scripts.dump_tool
```

## Environment variables

Loaded from `.env` (gitignored) locally; from GitHub Secrets in CI.

| Var | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Claude API auth |
| `SUPABASE_URL` | Project URL, e.g. `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — bypasses RLS for the writer. **Server-side only; never ship in the mobile app.** |

## Layout

```
pipeline/
├── pyproject.toml
├── data/
│   └── cards.yaml          The 25 cards + per-card source URLs
├── src/extract/
│   ├── __init__.py
│   ├── schema.py           Pydantic models + the Anthropic tool definition
│   ├── cards.py            Loader for cards.yaml  (next turn)
│   ├── sources.py          Source fetchers       (next turn)
│   ├── parse.py            PDF / HTML → text     (next turn)
│   ├── extract.py          Claude tool-use call  (next turn)
│   ├── validate.py         Source-quote check    (next turn)
│   ├── store.py            Supabase upsert       (next turn)
│   └── main.py             CLI entrypoint        (next turn)
├── scripts/
│   └── dump_tool.py        Smoke test — dumps the Anthropic tool JSON
└── tests/                  Pytest tests
```

## Cost

Per CLAUDE.md preferences, here's the rough cost math so future-me remembers
why this is a non-issue:

- ~3 source documents per card × 25 cards + 4 network-tier guides ≈ 80 docs
- ~30K input tokens / ~5K output tokens per doc on average
- Sonnet pricing as of writing: ~$3/M input, ~$15/M output
- **One full quarterly pass: ~$10–20**
- **Annual cost (4 passes): ~$40–80**

Verify against current pricing at https://docs.claude.com before committing.
