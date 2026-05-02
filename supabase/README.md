# supabase

Database schema for WanderFree. Single Postgres instance hosted on Supabase,
with Auth and Row Level Security doing the per-user filtering so the mobile
app can talk to Postgres directly without a backend API.

## Layout

```
supabase/
├── migrations/
│   └── 0001_init.sql        Initial schema: catalog tables, per-user tables,
│                            RLS policies, and the user_visible_benefits view.
└── README.md
```

## Schema overview

```
                        ┌──────────────┐
                        │   issuers    │  Chase, Amex, Capital One, ...
                        └──────┬───────┘
                               │
                        ┌──────┴───────┐         ┌──────────────────┐
                        │    cards     │────────▶│  network_tiers   │
                        └──────┬───────┘         │  Visa Infinite   │
                               │                 │  WE Mastercard   │
                               │                 └────────┬─────────┘
                               │                          │
                               ↓                          ↓
                        ┌──────────────────────────────────────────┐
                        │              benefits                    │
                        │  ONE table; either card_id OR            │
                        │  network_tier_id is set (XOR enforced)   │
                        │  unique by (parent, benefit_signature)   │
                        └──────────────────────┬───────────────────┘
                                               │
        ┌──────────────────┐                   │
        │   user_cards     │                   │
        │ (which cards a   │                   │
        │  user has)       │                   │
        └────────┬─────────┘                   │
                 │                             │
                 │   ┌──────────────────┐      │
                 │   │ user_benefits    │◀─────┘
                 │   │ per-user         │
                 │   │ completion state │
                 │   └──────────────────┘
                 │
                 ↓
        ┌──────────────────────────────────────────┐
        │   user_visible_benefits  (VIEW)          │
        │   security_invoker = true                │
        │   UNION of card-specific benefits + the  │
        │   network-tier benefits the user holds   │
        │   any card at that tier for.             │
        │                                          │
        │   This is what the mobile app SELECTs.   │
        └──────────────────────────────────────────┘
```

## Running migrations

For local development, install the Supabase CLI:

```bash
brew install supabase/tap/supabase

supabase login
supabase link --project-ref <your-project-ref>

# Apply pending migrations to the linked remote project
supabase db push

# Or for a fresh local Postgres started by `supabase start`:
supabase migration up
```

Migrations are timestamped and applied in order. To create a new one:

```bash
supabase migration new <name>
```

## RLS principle

Catalog tables (`issuers`, `network_tiers`, `cards`, `benefits`) are world-
readable to authenticated users. Per-user tables (`user_cards`, `user_benefits`)
are visible only to their owner via `auth.uid() = user_id` policies.

The pipeline writes to catalog tables using the **service role key**, which
bypasses RLS. **Never put the service role key in the mobile app.**

## The view

`user_visible_benefits` is what the app reads. It is defined with
`security_invoker = true` (Postgres 15+), which means RLS evaluates against
the calling user, not the view definer. So a mobile-app query against the
view only returns rows that user is entitled to see.
