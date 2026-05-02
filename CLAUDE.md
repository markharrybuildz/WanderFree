# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

WanderFree is a monorepo with **three sub-projects, each with its own toolchain**. Always `cd` into the relevant one before running commands — there is no top-level package or build.

```
pipeline/   Python 3.12  — quarterly batch that hydrates the catalog
supabase/   SQL + CLI    — schema migrations + RLS policies
mobile/     Expo / RN    — the user-facing app (Node 20)
```

Pinned versions: `.python-version` → 3.12, `.nvmrc` → 20.

`README.md` (root) and each sub-project's `README.md` carry the long-form context. Re-read them before touching unfamiliar areas.

## Common commands

### pipeline/

```bash
cd pipeline

# Install (one-time). Tee the log — pip's last line hides earlier compile failures.
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip 2>&1 | tee /tmp/pip-install.log
.venv/bin/python -m pip install -e ".[dev]" 2>&1 | tee -a /tmp/pip-install.log

# Tests
.venv/bin/python -m pytest                                   # all
.venv/bin/python -m pytest tests/test_validate.py            # one file
.venv/bin/python -m pytest tests/test_validate.py::test_x    # one test

# Lint
.venv/bin/python -m ruff check .
.venv/bin/python -m ruff format .

# Smoke-test the extraction tool schema (no network)
.venv/bin/python -m scripts.dump_tool

# Run the extraction CLI
.venv/bin/python -m extract.main                             # full pass
.venv/bin/python -m extract.main --cards chase-sapphire-preferred,amex-gold
.venv/bin/python -m extract.main --dry-run                   # no Supabase writes
.venv/bin/python -m extract.main --verbose                   # DEBUG on extract.* only
```

Always invoke Python with `.venv/bin/python …` (no `source activate`).

### mobile/

```bash
cd mobile
nvm use                       # match .nvmrc (20)
npm install
npx expo install --fix        # align deps to the installed Expo SDK
cp .env.example .env          # then fill in EXPO_PUBLIC_SUPABASE_URL + ANON_KEY

npm start                     # dev server (then i / a / w)
npm run typecheck             # tsc --noEmit
npm run lint                  # expo lint
```

### supabase/

```bash
brew install supabase/tap/supabase   # one-time
supabase link --project-ref <ref>
supabase db push                     # apply pending migrations to remote
supabase migration new <name>        # create a new timestamped migration
```

## Architecture: how the three pieces fit together

The **Supabase Postgres instance is the only shared state**. The pipeline writes to it; the mobile app reads from it. There is no backend API service.

```
pipeline (GitHub Actions cron, quarterly)
   │  service role key  (bypasses RLS)
   ▼
Supabase Postgres
   │  catalog tables    (issuers, network_tiers, cards, benefits)
   │  per-user tables   (user_cards, user_benefits) — RLS gated
   │  user_visible_benefits VIEW (security_invoker = true)
   ▲
   │  anon key + Supabase Auth  (RLS evaluates as the calling user)
mobile (Expo / React Native)
```

A few load-bearing details that you cannot infer from individual files:

- **`user_visible_benefits` is THE read endpoint** for mobile. It UNIONs card-specific benefits with the network-tier benefits a user inherits from any card they hold at that tier. It uses `security_invoker = true` (Postgres 15+) so RLS evaluates against the calling user.
- **Service role key NEVER ships in the mobile app.** It bypasses RLS. Only the pipeline (server-side, GitHub Actions) uses it. Mobile uses the anon key.
- **The pipeline runs quarterly** via `.github/workflows/extract.yml` (`cron: 0 8 1 */3 *`). Manual `workflow_dispatch` exposes `cards`, `dry_run`, `verbose` inputs that map to the CLI flags.
- **Dependency direction**: mobile and pipeline both depend on the Supabase schema. The schema lives in `supabase/migrations/` and is the source of truth for both. If you change the catalog tables, you'll usually need matching changes in `pipeline/src/extract/store.py` (writes) and `mobile/lib/types.ts` + the `user_visible_benefits` view (reads).

## Pipeline internals

The flow inside `pipeline/src/extract/` is **fetch → parse → chunk → Claude tool-use → validate → upsert**, orchestrated per-card by `_extract_one_card` in `main.py:138`. Per-card and per-source errors are caught and recorded in `CardRunSummary` rather than aborting the run.

Things that have already burned us — please preserve:

- **`schema.py` is the contract between Claude and the database.** The Pydantic `ExtractedBenefit` model and the `RECORD_BENEFIT_TOOL` Anthropic tool definition are derived from the same source so they cannot drift. Don't hand-edit one without the other.
- **`benefit_signature(b)` is the dedup key.** Two extractions of "the same" benefit across quarterly runs collapse into one row via `(card_id, benefit_signature)`. Touch this and you risk either duplicate rows or unintended merges.
- **`source_quote` must appear verbatim in the source text** — this is the hallucination tripwire enforced in `validate.py`. Failures get `extraction_confidence = "low"` rather than being dropped.
- **"Unseen this run" benefits get `valid_to = now()`** via `storage.deprecate_unseen_for_card` so the read view filters them out. This is how products get retired without a manual delete.
- **Networking libraries are pinned to WARNING-level logging** in `_setup_logging` (`main.py:95`). At DEBUG, `httpx`/`hpack`/`anthropic` dump request headers — i.e. the Anthropic bearer token and Supabase service role key. `--verbose` only escalates the `extract.*` namespace. **Do not unpin those loggers.**
- **`tests/conftest.py` adds `src/` to `sys.path`** so tests run without `pip install -e`. Don't switch tests to importing from an installed package; the convenience matters.

`scripts/discover_sources.py` is a separate utility (not part of the cron path) that fills in TODO source URLs in `data/cards.yaml` by scraping issuer marketing pages. It writes diffs to `data/source_suggestions.yaml`; `--apply` merges them into `cards.yaml` (with a `.bak`).

## Mobile internals

- **Routing**: Expo Router, file-based, under `mobile/app/`. Route groups `(auth)` and `(app)` get their own `_layout.tsx`. The root `_layout.tsx` wraps everything in `GestureHandlerRootView` → `SafeAreaProvider` → `PersistQueryClientProvider`.
- **Path alias**: `@/*` resolves to the `mobile/` root (see `tsconfig.json`).
- **Styling**: NativeWind v4 — Tailwind classes work directly on RN components. `global.css` is imported once from the root layout.
- **Caching**: TanStack Query + AsyncStorage persister (`lib/queryClient.ts`). `staleTime: 1h`, `gcTime: 7d`. UI renders immediately from cache on cold launch and refetches in the background.
- **Env vars**: only `EXPO_PUBLIC_*` vars are bundled into the JS. Required: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
