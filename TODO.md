# TODO

Open work for contributors picking up the project after the initial bootstrap.
See `CLAUDE.md` for repository shape/architecture and the root `README.md` for
locked product decisions.

## Status snapshot

| Layer | State |
|------|-------|
| **Pipeline** | ✅ End-to-end working. Verified extraction of 57 benefits from Chase Sapphire Preferred (~$0.59 Anthropic spend, 220s wall clock). |
| **Supabase schema** | ✅ Migration `0001_init.sql` applied. Catalog + per-user tables + RLS + `user_visible_benefits` view all in place. |
| **Mobile app (web target)** | 🟡 Boots, auth gate redirects to `/sign-in`. Sign-up + benefits flow not yet exercised end-to-end. |
| **Mobile app (iOS/Android)** | ⏳ Not yet tested — set up should work, run via `npm start` then `i`/`a`. |
| **GitHub Actions cron** | ⏳ Workflow file exists but secrets not yet configured in repo settings. |

## Open tasks

### Pipeline / data quality

1. **Inspect 7 low-confidence rows from Sapphire Preferred extraction.**
   Filter `benefits` where `extraction_confidence='low'`. Those rows had
   `source_quote_not_found_in_source` flags — Claude paraphrased instead of
   copying verbatim. Determine whether any are real fabrications vs lightly
   normalized text. Drives whether (2) is needed.

2. **Tighten extraction prompt to reduce paraphrasing.**
   If review of (1) shows >10% real hallucinations, strengthen `SYSTEM_PROMPT`
   in `pipeline/src/extract/extract.py` with: *"source_quote MUST be copied
   character-for-character from the chunk text. Do NOT paraphrase, do NOT
   normalize whitespace, do NOT correct typography. If you cannot find a
   verbatim quote, do not call the tool."*

3. **Run full 25-card extraction.**
   `cd pipeline && .venv/bin/python -m extract.main` — ~30-60 min wall clock,
   ~$10-15 in Anthropic spend. Watch the summary for cards with suspiciously
   low extraction counts (probably means a marketing page is JS-rendered and
   our HTML parser missed the content).

4. **Fill in remaining TODO source URLs in `pipeline/data/cards.yaml`.**
   ~50 of 75 source URLs are `TODO` placeholders (mostly CFPB agreements +
   missing benefits guides). Two sub-tasks:
   - **benefits_guide URLs**: run `cd pipeline && .venv/bin/python -m scripts.discover_sources`
     to auto-discover from marketing pages. Output goes to
     `data/source_suggestions.yaml` for review, or use `--apply` to merge.
   - **CFPB agreement URLs**: auto-discovery is unreliable for the CFPB site.
     Look up manually at https://www.consumerfinance.gov/credit-cards/agreements/
     by issuer and paste into cards.yaml.

5. **Add `chunks_failed` counter to extraction summary.**
   Per-chunk Claude failures (caught at `pipeline/src/extract/main.py:165`)
   are logged as warnings but not counted in `CardRunSummary`. Add
   `chunks_failed: int = 0` to the dataclass, increment in the except branch,
   render in the summary table, exit non-zero if any are nonzero. This avoids
   the silent-failure UX we hit during initial bootstrap (the run looked
   "successful" while every chunk was actually failing).

### Mobile

6. **Complete first end-to-end smoke test.**
   - Disable email confirmation in Supabase Auth → Providers → Email (for dev only)
   - Sign up + sign in
   - Cards tab → add Chase Sapphire Preferred
   - Benefits tab → verify 57 extracted benefits appear
   - Tap a benefit → verify optimistic completion update + persists across reload
   - Force-refresh page → verify TanStack Query cache makes load instant

7. **Filter UI parity with Figma.**
   Currently only category chips are wired in `app/(app)/benefits.tsx`. The
   Figma had three dropdowns (card / category / reward type). Data model
   supports all three; just needs UI.

8. **Auth: forgot-password / magic link / social auth.**
   v1 is email+password only. Each is a Supabase config change + a button.
   Defer until a real user asks.

### Infra

9. **Wire up GitHub Actions secrets and trigger a dry-run.**
   Repo Settings → Secrets and variables → Actions → add `ANTHROPIC_API_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Then Actions tab → "Extract
   benefits" workflow → Run workflow with `dry_run: true` to verify CI works
   before the first scheduled cron fires.

10. **Real review queue UI.**
    Currently the only review surface is the Supabase Studio table editor.
    v2 idea: small admin React app listing low-confidence rows with quick
    approve / edit / reject actions. Don't build until extraction quality
    is the bottleneck.

11. **React Native section in personal CLAUDE.md.**
    Per-developer notes (Expo/RN gotchas, version pin lessons). Will grow
    organically; we already have material from the Expo bootstrap that hit
    `react-native-worklets` plugin issues, peer-dep conflicts, and the
    NativeWind dark-mode flag.

## Setup for a new contributor

Before running anything:

1. **Supabase project**:
   ```
   brew install supabase/tap/supabase
   supabase login
   supabase link --project-ref <your-ref>
   supabase db push
   ```

2. **`pipeline/.env`** (copy from `.env.example`):
   - `ANTHROPIC_API_KEY` from console.anthropic.com/settings/keys
   - `SUPABASE_URL` from your Supabase project's API settings
   - `SUPABASE_SERVICE_ROLE_KEY` from same page (the *secret* / service_role
     key, NOT the publishable / anon key) — server-side only

3. **`mobile/.env`** (copy from `.env.example`):
   - `EXPO_PUBLIC_SUPABASE_URL` (same as above)
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` — the **anon / publishable** key,
     NOT the service role. Anything `EXPO_PUBLIC_*` is bundled into the JS
     and visible to clients; service role bypasses RLS.

4. **Python venv**:
   ```
   cd pipeline
   python3.12 -m venv .venv
   .venv/bin/python -m pip install --upgrade pip
   .venv/bin/python -m pip install -e ".[dev]"
   .venv/bin/python -m pytest tests/        # 39 passing
   .venv/bin/python -m scripts.dump_tool    # schema smoke test
   ```

5. **Node / Expo**:
   ```
   cd mobile
   nvm use                   # respects .nvmrc -> Node 20
   npm install               # legacy-peer-deps is on via .npmrc
   npx expo install --fix    # align deps to installed Expo SDK
   npm start                 # press w/i/a for web/iOS/Android
   ```

See `pipeline/README.md`, `supabase/README.md`, and `mobile/README.md` for
component-specific docs.

## Known gotchas burned in during bootstrap

- **`react-native-worklets/plugin` not found** when starting Expo: install
  `react-native-worklets` via `npx expo install`. Babel preset expects it.
- **`Cannot manually set color scheme, as dark mode is type 'media'`** on web:
  the `tailwind.config.js` has `darkMode: 'class'` for this — don't revert.
- **npm peer-dep conflicts (lucide-react-native, etc.)**: handled globally
  via `mobile/.npmrc` `legacy-peer-deps=true`. Don't remove unless you want
  to fight peer ranges in every Expo upgrade.
- **`AsyncStorage / window is not defined` on web**: `app.json` uses
  `web.output: "single"` (SPA mode, not server-static). Don't switch back
  to `static` without making module-level Supabase/AsyncStorage init lazy.
- **Verbose pipeline logging leaks credentials**: `pipeline/src/extract/main.py`
  pins `httpx`/`hpack`/`anthropic`/`supabase` loggers to WARNING regardless
  of `--verbose`. The hpack DEBUG output dumps Authorization headers. Don't
  unpin.
- **Supabase key rotation invalidates `.env`**: if you rotate the service
  role key in the Supabase dashboard, the next `extract.main` run fails with
  `Unregistered API key` until you update `pipeline/.env`. Same for any
  GitHub Actions secret.
