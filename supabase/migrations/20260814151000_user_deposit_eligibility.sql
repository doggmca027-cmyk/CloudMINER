-- CloudMiner HYIP — додає прапорець has_completed_deposit до профілю
-- користувача, щоб WalletTab міг одразу показати статус розблокування
-- виводу (🟢/🔴), не роблячи окремий запит.
--
-- CREATE OR REPLACE не дозволяє змінювати набір колонок RETURNS TABLE,
-- тож функцію спершу видаляємо.

drop function if exists public.get_or_create_user(bigint, text, text);

create or replace function public.get_or_create_user(
  p_telegram_id bigint,
  p_first_name text,
  p_language_code text default 'en'
)
returns table (
  id uuid,
  telegram_id bigint,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  language_code text,
  balance_usd numeric,
  balance_coin numeric,
  total_income numeric,
  is_vip boolean,
  referral_code text,
  referred_by uuid,
  has_completed_deposit boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (telegram_id, first_name, language_code, referral_code)
  values (
    p_telegram_id,
    coalesce(nullif(trim(p_first_name), ''), 'User'),
    coalesce(nullif(trim(p_language_code), ''), 'en'),
    substr(md5(random()::text || p_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now();

  return query
    select
      u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.photo_url,
      u.language_code, u.balance_usd, u.balance_coin, u.total_income, u.is_vip,
      u.referral_code, u.referred_by,
      exists(
        select 1 from public.transactions t
        where t.user_id = u.id and t.type = 'deposit' and t.status = 'completed'
      ) as has_completed_deposit,
      u.created_at, u.updated_at
    from public.users u
    where u.telegram_id = p_telegram_id;
end;
$$;

revoke all on function public.get_or_create_user(bigint, text, text) from public;
grant execute on function public.get_or_create_user(bigint, text, text) to anon, authenticated;
