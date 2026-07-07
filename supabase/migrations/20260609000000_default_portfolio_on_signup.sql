-- Extend handle_new_user() to also create a default "My Cards" portfolio
-- and an owner membership for the new user. The on_auth_user_created
-- trigger binding stays as-is; only the function body changes.
--
-- Idempotent: the portfolio is only created if the user has no
-- existing portfolio_members row (covers re-runs and any future
-- pre-provisioning).

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  new_portfolio_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.portfolio_members pm where pm.profile_id = new.id
  ) then
    insert into public.portfolios (name, type, created_by)
    values ('My Cards', 'personal', new.id)
    returning id into new_portfolio_id;

    insert into public.portfolio_members (portfolio_id, profile_id, role)
    values (new_portfolio_id, new.id, 'owner');
  end if;

  return new;
end;
$$;
