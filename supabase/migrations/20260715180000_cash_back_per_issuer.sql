-- Split the pooled "Cash back" program into one program per issuer
-- ("Chase Cash Back", "Discover Cash Back", ...). Cash rewards live and
-- are redeemed per issuer, so pooling them into one wallet was too coarse.
--
-- Data-driven: creates a program for every issuer that currently has a
-- product mapped to the generic program, remaps those products, then
-- retires the generic program if nothing references it anymore. If a
-- wallet_accounts row already points at the pooled program (someone set a
-- balance before this ran), the program is kept so the balance stays
-- visible; the user can move the number to the issuer wallet and zero it.

insert into public.rewards_programs (name, unit_type)
select distinct ci.name || ' Cash Back', 'cash_back'::public.program_unit_type
from public.card_products cp
join public.card_issuers ci on ci.id = cp.issuer_id
where cp.rewards_program_id = (select id from public.rewards_programs where name = 'Cash back')
  and not exists (
    select 1 from public.rewards_programs rp where rp.name = ci.name || ' Cash Back'
  );

update public.card_products cp
set rewards_program_id = rp.id
from public.card_issuers ci
join public.rewards_programs rp on rp.name = ci.name || ' Cash Back'
where ci.id = cp.issuer_id
  and cp.rewards_program_id = (select id from public.rewards_programs where name = 'Cash back');

delete from public.rewards_programs rp
where rp.name = 'Cash back'
  and not exists (select 1 from public.card_products cp where cp.rewards_program_id = rp.id)
  and not exists (select 1 from public.wallet_accounts w  where w.rewards_program_id = rp.id);
