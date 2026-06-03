# WanderFree

A mobile app that organizes credit card benefits. Users add the cards they hold; the app surfaces every benefit attached to those cards (statement credits, multipliers, lounge access, insurance, etc.) and tracks redemptions against each benefit's cycle.

## Repository layout

```
WanderFree/
├── supabase/        Database schema (migrations), RLS policies.
│                    The catalog (issuers, card products, benefits, reward
│                    categories) is hand-curated in Supabase — there is no
│                    extraction pipeline.
│
└── mobile/          Expo / React Native app. Reads + writes Supabase
                     directly via supabase-js with TanStack Query +
                     AsyncStorage caching.
```

## Architecture at a glance

```
┌────────────────────────────┐
│ Supabase Postgres          │
│  catalog tables (manually  │
│   curated)                 │
│  portfolio-scoped tables   │
│   (RLS by membership)      │
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
| Catalog source | Hand-curated in Supabase |
| Per-user scoping | Portfolios (shared via `portfolio_members`) — not direct user ownership |
| Read path | Supabase tables + RLS, no backend API |
| Mobile cache | TanStack Query + AsyncStorage persister |

See `supabase/README.md` and `mobile/README.md` for component-specific docs.

## Getting started

Each sub-project has its own toolchain. See:

- [`supabase/README.md`](./supabase/README.md) — schema migrations, RLS policies
- [`mobile/README.md`](./mobile/README.md) — Expo / RN, env vars, caching
