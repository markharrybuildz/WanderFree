# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

WanderFree is a monorepo with **two sub-projects, each with its own toolchain**. Always `cd` into the relevant one before running commands — there is no top-level package or build.

```
supabase/   SQL + CLI    — schema migrations + RLS policies (source of truth)
mobile/     Expo / RN    — the user-facing app (Node 20)
```

Pinned versions: `.nvmrc` → 20.

The catalog (issuers, card products, benefit definitions, reward categories) is **populated manually** in Supabase. There is no extraction pipeline — an earlier Anthropic-driven extractor lived in `pipeline/` and was removed; do not re-introduce it without a clear reason.

`README.md` (root) and each sub-project's `README.md` carry the long-form context. Re-read them before touching unfamiliar areas.

## Common commands

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

# Pull the live schema into a fresh migration file. Use this whenever the
# DB has been edited via the Supabase dashboard so the repo stays in sync.
supabase db pull

# Apply pending migrations to the linked remote project
supabase db push

# Create a new empty migration (timestamped)
supabase migration new <name>
```

## Architecture: how the two pieces fit together

The **Supabase Postgres instance is the only shared state**. There is no backend API service — the mobile app talks to Postgres directly via `@supabase/supabase-js`, and Row Level Security does the per-user filtering.

```
Supabase Postgres
   │  catalog tables    (card_issuers, card_products, rewards_programs,
   │                      reward_categories, benefit_categories,
   │                      benefit_definitions, card_reward_rules,
   │                      transfer_partners, program_transfer_partners)
   │  per-portfolio     (portfolios, portfolio_members, wallet_accounts,
   │                      user_cards, user_signup_bonuses, spend_entries,
   │                      user_benefit_cycles, benefit_redemptions)
   ▲
   │  anon key + Supabase Auth  (RLS evaluates as the calling user)
mobile (Expo / React Native)
```

A few load-bearing details that you cannot infer from individual files:

- **The "user" in this product is a portfolio, not a profile.** A portfolio can be shared between multiple `profiles` via the `portfolio_members` join table. All per-user data (`user_cards`, `wallet_accounts`, `spend_entries`, `user_benefit_cycles`, `benefit_redemptions`) hangs off `portfolio_id`, not `auth.uid()`. RLS uses two SQL helper functions — `is_portfolio_member(portfolio_id)` and `can_access_user_card(user_card_id)` — to gate access. See `supabase/README.md` for the per-table policy table.
- **Portfolio mutation is creator-only.** Anyone can `INSERT` a portfolio (and become its `created_by`), but only the creator can UPDATE/DELETE the portfolio row itself. Members can still read+write the data hanging off it.
- **Benefit cycle status drives the UI.** `benefit_cycle_status` is `unused | partially_used | fully_used | expired`. The mobile `useBenefits` hook treats `fully_used` as "fully redeemed" and ignores `expired`. There's no "active" status — current cycle is identified by date range (`period_start <= today <= period_end`).
- **Mobile assumes a single "current portfolio"** — the first one the signed-in user belongs to. See `useCurrentPortfolio` in `mobile/lib/hooks.ts`. Multi-portfolio switching can be layered on later without changing existing hook signatures (they already accept `portfolioId`).
- **Reward earn rules and benefits are separate concepts.** `card_reward_rules` model multipliers on spend categories (e.g. "3x on dining"); `benefit_definitions` model recurring credits / perks (e.g. "$300 travel credit per year"). They don't overlap.
- **Benefit cycles ≠ benefit definitions.** A `benefit_definition` is the catalog row ("$300 travel credit, annual, calendar-year"). A `user_benefit_cycle` is one instance of that benefit for one `user_card` during one period, with an `allotted_value` and a `status`. Redemptions hang off the cycle.
- **The mobile `useBenefits` hook synthesizes a flat "benefit + cycle + running redemption total" shape client-side** because no equivalent Postgres view ships yet. If this query becomes hot, push it into a view (consider `security_invoker = true` so RLS still evaluates against the caller).

## Mobile internals

- **Routing**: Expo Router, file-based, under `mobile/app/`. Route groups `(auth)` and `(app)` get their own `_layout.tsx`. The root `_layout.tsx` wraps everything in `GestureHandlerRootView` → `SafeAreaProvider` → `PersistQueryClientProvider`.
- **Path alias**: `@/*` resolves to the `mobile/` root (see `tsconfig.json`).
- **Styling**: NativeWind v4 — Tailwind classes work directly on RN components. `global.css` is imported once from the root layout.
- **Caching**: TanStack Query + AsyncStorage persister (`lib/queryClient.ts`). `staleTime: 1h`, `gcTime: 7d`. UI renders immediately from cache on cold launch and refetches in the background.
- **Env vars**: only `EXPO_PUBLIC_*` vars are bundled into the JS. Required: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The Supabase **service role key never ships in the mobile app** — it bypasses RLS.
- **Enum unions in `lib/types.ts` are educated guesses from the ERD** and need confirmation against the live DB. Regenerate with `supabase gen types typescript` once the schema settles.
