# Session Notes — WanderFree Bootstrap

A compact summary of the architectural decisions, work completed, and lessons
learned during the initial bootstrap session. Forward-looking work lives in
`TODO.md`; this file is the backward-looking record of why things are the way
they are.

## Product

A mobile app that organizes credit card benefits. Users add the cards they
hold; the app surfaces every earnable benefit (statement credits, multipliers,
lounge access, insurance, etc.) and tracks which ones they've used. A
quarterly batch hydrates the catalog via Claude API extraction from issuer
documents.

## Architecture

```
Pipeline (GitHub Actions cron, quarterly, Python)
  └─ extracts benefits from CFPB + issuer pages via Claude tool-use
      └─ writes to →

Supabase Postgres (single source of truth)
  └─ catalog tables (issuers, network_tiers, cards, benefits)
  └─ per-user tables (user_cards, user_benefits) — RLS-gated
  └─ user_visible_benefits view (security_invoker, UNIONs card + tier benefits)
      └─ read by →

Mobile app (Expo / React Native, anon key + RLS)
  └─ TanStack Query + AsyncStorage cache for instant cold-start
```

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Backend | Supabase | Postgres for relational data, RLS for per-user filtering, no backend API needed |
| Mobile | Expo / React Native | Cross-platform, no need for native APIs |
| Catalog ingestion | Claude API extraction | No good public API exists; primary docs (CFPB) are public |
| v1 scope | Top 25 cards (18 consumer + 7 business) | Big enough to validate, small enough to ship |
| Refresh cadence | Quarterly | Matches how often issuer benefits change |
| Source docs | Not stored | Skipped to keep architecture simple; revisit if audit needed |
| Pipeline host | GitHub Actions cron | Free, lives next to code, perfect for batch workload |
| Mobile cache | TanStack Query + AsyncStorage persister | Instant render from cache on cold launch, refetches in background |
| Read view | `user_visible_benefits` with `security_invoker = true` | Single SELECT, RLS handles auth |

## Schema highlights

* **Single `benefits` table** with either `card_id` OR `network_tier_id` set
  (CHECK xor). Lets `user_benefits` reference any benefit by single FK.
* **`benefit_signature`** is a hash of category + reward shape. Used as the
  dedup key in quarterly upserts so re-extractions update existing rows.
* **`source_quote` validation** is the hallucination tripwire — must appear
  verbatim in source text. Failures get auto-downgraded to
  `extraction_confidence = "low"`.
* **`network_tier_id` is nullable on cards.** Amex and Discover cards have
  null because their benefits are card-specific, not network-inherited.

## What's built

| Component | State | Verified |
|---|---|---|
| `pipeline/` Python extractor | Complete | 39 unit tests passing, extracted 57 benefits from Sapphire Preferred (~$0.59) |
| `pipeline/scripts/discover_sources.py` | Real impl (benefits guides), best-effort (CFPB) | Schema lints clean |
| `supabase/migrations/0001_init.sql` | Applied | 35 statements parsed clean by pglast, ran against real Supabase |
| `mobile/` Expo app | Boots, auth gate works | Web bundled successfully, redirects to /sign-in correctly |
| `.github/workflows/extract.yml` | File exists | Secrets not yet configured |
| `TODO.md` | Written | Covers 11 open tasks + setup + gotchas |

## Gotchas burned in

These cost real time during this session and are documented at length in
`TODO.md`. Listed here for quick reference:

1. **`react-native-worklets/plugin` not found** — install via
   `npx expo install react-native-worklets`. Babel preset expects it
   post-Reanimated-4.
2. **NativeWind dark mode error on web** — `tailwind.config.js` needs
   `darkMode: 'class'`; default `'media'` mode crashes on boot.
3. **npm peer-dep conflicts** — `mobile/.npmrc` has `legacy-peer-deps=true`.
   Don't remove; lucide-react-native and others lag on peer ranges.
4. **`window is not defined` on web** — `app.json` uses
   `web.output: "single"` (SPA), not `"static"` (SSR). Static mode runs
   Node-side and crashes on AsyncStorage.
5. **CRITICAL: `--verbose` leaks credentials** — `pipeline/src/extract/main.py`
   pins `httpx`/`hpack`/`anthropic`/`supabase` to WARNING regardless of
   `--verbose`. The hpack DEBUG output dumps Authorization headers. We
   rotated a Supabase key after this leaked once. Never unpin those loggers.
6. **Supabase key rotation invalidates `.env`** — after rotating in
   dashboard, update `pipeline/.env` AND any GitHub Actions secret. Symptom:
   401 "Unregistered API key".
7. **Anthropic API requires billing setup** — keys created on a fresh
   account return errors until you add credit at
   console.anthropic.com/settings/billing.
8. **Per-card error isolation** — `_extract_one_card` in `main.py` catches
   per-card and per-chunk exceptions and continues. Failures are logged as
   warnings; if you ignore stderr, runs look "successful" with 0 stored.
   Task #5 in `TODO.md` fixes the silent-failure UX.

## File map

```
WanderFree/
├── README.md                       Project overview + locked decisions
├── CLAUDE.md                       Repo shape, architecture, commands
├── SESSION_NOTES.md                This file
├── TODO.md                         Open work, setup, gotchas
├── .github/workflows/extract.yml   Quarterly cron
│
├── pipeline/                       Python extractor
│   ├── pyproject.toml              Deps + ruff config
│   ├── README.md                   Setup, env vars, cost math
│   ├── data/cards.yaml             25 cards + per-card source URLs
│   ├── src/extract/
│   │   ├── schema.py               Pydantic ExtractedBenefit + Anthropic tool
│   │   ├── settings.py             pydantic-settings env loader
│   │   ├── cards.py                cards.yaml loader with FK validation
│   │   ├── sources.py              httpx fetcher with retries
│   │   ├── parse.py                pypdfium2/selectolax + heading-aware chunker
│   │   ├── extract.py              Claude tool-use orchestrator
│   │   ├── validate.py             source_quote tripwire + numeric bounds
│   │   ├── store.py                Supabase upsert + DryRunStore
│   │   └── main.py                 CLI entrypoint, summary table
│   ├── scripts/
│   │   ├── dump_tool.py            Schema smoke test (no network)
│   │   └── discover_sources.py     Real discovery script
│   └── tests/                      39 unit tests
│
├── supabase/
│   ├── README.md                   Schema overview, RLS principle
│   └── migrations/
│       └── 0001_init.sql           Tables, RLS, user_visible_benefits view
│
└── mobile/                         Expo / React Native app
    ├── README.md                   Setup, env vars, port-the-Figma guide
    ├── package.json                Expo SDK 54, RN 0.81, React 19 (pinned to App Store Expo Go's SDK)
    ├── .npmrc                      legacy-peer-deps=true (load-bearing)
    ├── app.json                    web.output: "single" (load-bearing)
    ├── babel.config.js             nativewind/babel
    ├── tailwind.config.js          darkMode: "class" (load-bearing)
    ├── app/                        Expo Router file-based routes
    │   ├── _layout.tsx             Root: providers
    │   ├── index.tsx               Auth gate
    │   ├── (auth)/sign-in.tsx
    │   └── (app)/                  Tab nav: benefits, cards, settings
    ├── components/                 BenefitCard, StatsCard
    └── lib/                        supabase, queryClient, auth, hooks, types
```

## Cost summary

| Spend | Estimate |
|---|---|
| One full quarterly extraction (25 cards) | ~$10–20 in Anthropic API |
| Annual extraction (4 runs) | ~$40–80 |
| Supabase | $0 on free tier through MVP |
| GitHub Actions | $0 (~6 hours/year of CI used out of generous allowance) |
| Mobile distribution | $0 via EAS Build free tier; ~$99/year if you ship to App Store |
| **Total infra to MVP** | **~$0/month + ~$60/year API** |

## Where we left off

Mobile app boots on web (`http://localhost:8081`), correctly redirects
unauthenticated users to `/sign-in`. The next concrete step is creating an
account and verifying the full Cards → Benefits flow renders the 57
already-extracted benefits from Supabase.

For full step-by-step on what to do next, see **`TODO.md`**.
