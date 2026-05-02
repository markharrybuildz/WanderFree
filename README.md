# WanderFree

A mobile app that organizes credit card benefits. Users add the cards they hold; the app surfaces every benefit attached to those cards (statement credits, multipliers, lounge access, insurance, etc.) and tracks which ones they've used.

## Repository layout

```
WanderFree/
├── pipeline/        Python service that hydrates the catalog by extracting
│                    structured benefit data from issuer PDFs and marketing
│                    pages via the Claude API. Runs quarterly via GitHub
│                    Actions cron.
│
├── supabase/        Database schema (migrations), RLS policies, and the
│                    user_visible_benefits view that the mobile app reads
│                    against.
│
└── mobile/          Expo / React Native app (scaffolded in a later step).
                     Reads from Supabase directly via supabase-js with
                     TanStack Query + AsyncStorage caching.
```

## Architecture at a glance

```
┌───────────────────────────┐
│ pipeline (GitHub Actions) │
│  CFPB / issuer pages      │
│         ↓                 │
│  PDF/HTML → text          │
│         ↓                 │
│  Claude API (tool use)    │
│         ↓                 │
│  validation               │
└────────────┬──────────────┘
             ↓ upsert
┌────────────────────────────┐
│ Supabase Postgres          │
│  catalog tables (benefits, │
│   cards, network_tiers)    │
│  per-user tables (RLS)     │
│  user_visible_benefits     │
│   view (security_invoker)  │
└────────────┬───────────────┘
             ↓ supabase-js + RLS
┌────────────────────────────┐
│ mobile (Expo / RN)         │
│  TanStack Query + cache    │
│  Renders from cache first, │
│   refetches in background  │
└────────────────────────────┘
```

## Locked decisions

| Decision | Choice |
|----------|--------|
| Backend | Supabase (Postgres + Auth + RLS) |
| Mobile | Expo / React Native |
| Catalog extraction | Claude API (tool-use mode) |
| Catalog scope (v1) | Top 25 cards (consumer + business) |
| Refresh cadence | Quarterly |
| Source documents | Not stored (revisit if audit issues arise) |
| Pipeline host | GitHub Actions cron (free for this workload) |
| Read path | Supabase view + RLS, no backend API |
| Mobile cache | TanStack Query + AsyncStorage persister |

See `pipeline/README.md` and `supabase/README.md` for component-specific docs.

## Getting started

Each sub-project has its own toolchain. See:

- [`pipeline/README.md`](./pipeline/README.md) — Python 3.12, venv, Claude API
- [`supabase/README.md`](./supabase/README.md) — schema migrations, RLS policies
- `mobile/README.md` — *(coming next)*
