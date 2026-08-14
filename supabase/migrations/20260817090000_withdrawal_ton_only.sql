-- CloudMiner HYIP — вивід коштів тепер лише в мережі TON (USDT-jetton).
--
-- Депозити й далі приймають кілька мереж (TON / TON_USDT / TRC20) — це
-- стосується лише виводу. Причина: єдиний гарячий гаманець і менше
-- операційного ризику з автовиплатами (process-withdrawal). На момент
-- написання жодної заявки на вивід у мережі TRC20 в базі немає (перевірено
-- вручну), тож звужувати перевірку безпечно.
create or replace function public.request_withdrawal(
  p_telegram_id bigint,
  p_first_name text,
  p_amount_usd numeric,
  p_wallet_address text,
  p_network text
)
returns table (id uuid, status transaction_status, requested_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_amount constant numeric := 2;
  v_fee_rate constant numeric := 0.05;
  v_user_id uuid;
  v_balance numeric;
  v_has_deposit boolean;
  v_withdrawal_id uuid;
begin
  if p_amount_usd is null or p_amount_usd < v_min_amount then
    raise exception 'amount_below_minimum';
  end if;

  if coalesce(trim(p_wallet_address), '') = '' then
    raise exception 'wallet_address_required';
  end if;

  if p_network <> 'TON' then
    raise exception 'invalid_network';
  end if;

  insert into public.users (telegram_id, first_name, referral_code)
  values (
    p_telegram_id,
    coalesce(nullif(trim(p_first_name), ''), 'User'),
    substr(md5(random()::text || p_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now()
  returning users.id into v_user_id;

  select exists(
    select 1 from public.transactions t
    where t.user_id = v_user_id and t.type = 'deposit' and t.status = 'completed'
  ) into v_has_deposit;

  if not v_has_deposit then
    raise exception 'deposit_required';
  end if;

  select u.balance_usd into v_balance from public.users u where u.id = v_user_id for update;

  if v_balance < p_amount_usd then
    raise exception 'insufficient_balance';
  end if;

  update public.users u
  set balance_usd = u.balance_usd - p_amount_usd, updated_at = now()
  where u.id = v_user_id;

  insert into public.transactions (user_id, type, network, amount_usd, fee_usd, currency, wallet_address, status, comment)
  values (
    v_user_id,
    'withdrawal',
    p_network,
    p_amount_usd,
    round(p_amount_usd * v_fee_rate, 6),
    'USDT',
    p_wallet_address,
    'pending',
    'Мережа: ' || p_network
  )
  returning transactions.id into v_withdrawal_id;

  return query
    select t.id, t.status, t.created_at
    from public.transactions t
    where t.id = v_withdrawal_id;
end;
$$;

revoke all on function public.request_withdrawal(bigint, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.request_withdrawal(bigint, text, numeric, text, text) to anon, authenticated;
