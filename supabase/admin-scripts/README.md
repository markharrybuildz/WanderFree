# admin-scripts

Hand-written SQL for one-off operator work — deleting a user, reassigning a
portfolio, patching catalog data, etc. Run these from Supabase Studio's
**SQL Editor** (authenticated as a dashboard user, so RLS is bypassed).

Convention: every destructive script has a sibling `*_preview.sql` that
returns the rows it would touch, without modifying anything. Run the
preview first, look at the output, then run the destructive operation.

Files prefixed with `_install_` are one-time setup — run them once per
environment to register helper functions that you then call.

| Script | Purpose |
|---|---|
| `_install_admin_functions.sql` | One-time: installs `admin_delete_user(email)`. |
| `delete_user_preview.sql` | Read-only preview of what `admin_delete_user()` would touch. |
| `analytics_reporting_role.sql` | One-time: creates the read-only `metabase_ro` role for BI dashboards. |

User deletion is a single canonical implementation, `public.purge_user(uuid)`,
shipped in migration `20260710130000_purge_user_helper.sql`. Both the self-serve
RPC (`delete_own_account()`) and the admin helper (`admin_delete_user()`)
delegate to it, so there is exactly one copy of the transfer/cascade logic.

## Deleting a user

Run `_install_admin_functions.sql` once per environment to register
`admin_delete_user(text)`. From then on, deletion is a single line in the SQL
Editor:

```sql
select admin_delete_user('user@example.com');
```

Optionally run `delete_user_preview.sql` first (edit the email placeholder) to
see exactly what will be touched.

Behavior: solo portfolios the user created are deleted and cascade all their
hanging data; any portfolio they created that is **shared** with other members
is **transferred** to a surviving member (most-privileged, then oldest) rather
than deleted, so no one else's data is destroyed. Portfolios they are only a
member of are kept — just their membership row is removed. The function returns
a human-readable confirmation including the user id.

## psql alternative

Once the function is installed:

```bash
psql "$(supabase status -o env DB_URL)" -c "select admin_delete_user('user@example.com');"
```

## Analytics / Metabase

Analytics is two layers. **Layer A** (business metrics — cards, redemptions,
dollars captured) is a set of read-only views derived from the domain tables,
so it can never drift from reality. **Layer B** (behavioral events — screens,
funnels) is a separate `analytics_events` table added later. This is Layer A.

### Setup (one-time)

1. Apply the views migration `migrations/20260711120000_analytics_views.sql`
   (creates the `analytics` schema and the reporting views).
2. Edit `analytics_reporting_role.sql`, set a strong password (store it in your
   password manager), and run it. This creates `metabase_ro` — a login role that
   can read **only** the `analytics.*` views, never the base tables, and cannot
   write.

### Connect Metabase

Run Metabase (self-hosted is free):

```bash
docker run -d -p 3000:3000 --name metabase metabase/metabase
```

Then in Metabase → Admin → Databases → Add PostgreSQL, using the connection
details from **Supabase → Project Settings → Database → Connection string
(Session pooler)**, but swapping in the reporting role:

- Host / Port: from the Session-pooler string (IPv4-friendly)
- Database: `postgres`
- User: `metabase_ro` (pooler format is `metabase_ro.<project-ref>`; direct
  connections on port 5432 use just `metabase_ro`)
- Password: the one you set above
- Schema: `analytics`

### First dashboard

Suggested cards, all straight from the views:

| Card | Query source |
|---|---|
| Headline KPIs (users, cards, $ redeemed) | `analytics.kpis` |
| New users over time | `analytics.signups_daily` |
| Redemptions & $ captured per day | `analytics.redemptions_daily` |
| Top cards by adoption | `analytics.card_adoption` |
| Top benefits by value redeemed | `analytics.benefit_performance` |
| Benefit cycle status breakdown | `analytics.benefit_cycle_status` |
| Portfolios (members / cards) | `analytics.portfolios_overview` |
