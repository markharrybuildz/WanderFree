# admin-scripts

Hand-written SQL for one-off operator work — deleting a user, reassigning a
portfolio, patching catalog data, etc. Run these from Supabase Studio's
**SQL Editor** (authenticated as a dashboard user, so RLS is bypassed).

Convention: every destructive script has a sibling `*_preview.sql` that
returns the rows it would touch, without modifying anything. Run the
preview first, look at the output, then run the destructive script.

Files prefixed with `_install_` are one-time setup — run them once per
environment to register helper functions that the per-operation scripts
then call.

| Script | Purpose |
|---|---|
| `_install_admin_functions.sql` | One-time: installs `admin_delete_user(email)`. |
| `delete_user.sql` | Standalone hard-delete (no function install needed). Edit email, run. |
| `delete_user_preview.sql` | Read-only preview of what `delete_user.sql` would touch. |

## Two workflows

**One-off deletion** — open `delete_user.sql`, edit the email
placeholder, paste into Supabase Studio's SQL Editor, run. Optionally
run `delete_user_preview.sql` first.

**Repeated deletion** (e.g. testing onboarding by deleting the same
test account over and over): run `_install_admin_functions.sql` once
to register `admin_delete_user(text)`. From then on, deletion is a
single line in the SQL Editor:

```sql
select admin_delete_user('user@example.com');
```

The function returns a human-readable confirmation including the user
id and the number of portfolios it deleted.

## psql alternative

All scripts work via `psql` too:

```bash
psql "$(supabase status -o env DB_URL)" -f delete_user.sql
```

Or once the function is installed:

```bash
psql "$(supabase status -o env DB_URL)" -c "select admin_delete_user('user@example.com');"
```
