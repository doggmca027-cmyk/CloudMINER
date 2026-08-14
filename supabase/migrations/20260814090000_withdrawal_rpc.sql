-- CloudMiner HYIP — RPC для створення заявки на вивід без відкриття
-- прямих RLS-політик на запис у `users`/`withdrawals`.
--
-- Застосунок ще не має серверної перевірки Telegram initData (немає
-- Supabase Auth / кастомного JWT), тож ми не можемо покладатись на
-- auth.uid() у RLS-політиках. Замість того щоб відкривати anon-ключу
-- прямий INSERT на ці таблиці (що дозволило б підміняти чужий user_id чи
-- одразу створювати не-pending заявки), вся операція "знайти/створити
-- користувача за telegram_id і поставити заявку в чергу" виконується
-- одним SECURITY DEFINER-викликом із власною валідацією.
--
-- TODO: коли зʼявиться серверна перевірка initData (Edge Function),
-- замінити довіру до p_telegram_id тут на дані з перевіреного JWT.

create or replace function public.request_withdrawal(
  p_telegram_id bigint,
  p_first_name text,
  p_amount_usd numeric,
  p_wallet_address text,
  p_network text
)
returns table (id uuid, status withdrawal_status, requested_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_amount constant numeric := 10;   -- тримати синхронізовано з MIN_WITHDRAWAL_USD у src/lib/withdrawals.ts
  v_fee_rate constant numeric := 0.05;   -- тримати синхронізовано з WITHDRAWAL_FEE_RATE
  v_user_id uuid;
  v_withdrawal_id uuid;
begin
  if p_amount_usd is null or p_amount_usd < v_min_amount then
    raise exception 'amount_below_minimum';
  end if;

  if coalesce(trim(p_wallet_address), '') = '' then
    raise exception 'wallet_address_required';
  end if;

  if p_network not in ('TON', 'TRC20') then
    raise exception 'invalid_network';
  end if;

  -- Отримати наявного користувача за telegram_id або створити нового.
  insert into public.users (telegram_id, first_name, referral_code)
  values (
    p_telegram_id,
    coalesce(nullif(trim(p_first_name), ''), 'User'),
    substr(md5(random()::text || p_telegram_id::text), 1, 8)
  )
  on conflict (telegram_id) do update set updated_at = now()
  returning users.id into v_user_id;

  insert into public.withdrawals (user_id, amount_usd, fee_usd, currency, wallet_address, status, comment)
  values (
    v_user_id,
    p_amount_usd,
    round(p_amount_usd * v_fee_rate, 6),
    'USDT',
    p_wallet_address,
    'pending',
    'Мережа: ' || p_network
  )
  returning withdrawals.id into v_withdrawal_id;

  return query
    select w.id, w.status, w.requested_at
    from public.withdrawals w
    where w.id = v_withdrawal_id;
end;
$$;

revoke all on function public.request_withdrawal(bigint, text, numeric, text, text) from public;
grant execute on function public.request_withdrawal(bigint, text, numeric, text, text) to anon, authenticated;
