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
