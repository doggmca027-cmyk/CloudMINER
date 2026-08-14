-- CloudMiner HYIP — розширення поповнень до 4 способів:
--   TON        — нативна монета TON (як і раніше, memo/comment-атрибуція)
--   TON_USDT   — токен USDT (jetton) у мережі TON (новий, memo-атрибуція —
--                jetton-перекази теж підтримують текстовий forward-коментар)
--   TRC20      — USDT у мережі Tron (як і раніше, exact-amount-атрибуція)
--   BEP20      — USDT у мережі BNB Smart Chain (новий, exact-amount-атрибуція
--                — у ERC-20/BEP-20 Transfer немає поля коментаря, той самий
--                принцип, що й TRC-20)

-- deposit_intents: дозволяємо мережу BEP20 (не тільки TRC20) -------------
alter table public.deposit_intents drop constraint deposit_intents_network_check;
alter table public.deposit_intents add constraint deposit_intents_network_check
  check (network in ('TRC20', 'BEP20'));

-- create_deposit_intent: додає параметр p_network -------------------------
-- УВАГА: на відміну від зміни RETURNS TABLE, додавання нового параметра
-- змінює сигнатуру функції (навіть з default-значенням) — CREATE OR REPLACE
-- в цьому випадку НЕ замінює стару 3-параметричну версію, а створює
-- окремий overload, через що виклик з 3 аргументами стає неоднозначним
-- ("is not unique", впіймано живим тестом). Тому явно дропаємо стару.
drop function if exists public.create_deposit_intent(bigint, text, numeric);

create or replace function public.create_deposit_intent(
  p_telegram_id bigint,
  p_first_name text,
  p_base_amount_usd numeric,
  p_network text default 'TRC20'
)
returns table (intent_id uuid, exact_amount_usd numeric, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_deposit constant numeric := 5;  -- тримати синхронізовано з MIN_DEPOSIT_USD
  v_user_id uuid;
  v_exact_amount numeric;
  v_intent_id uuid;
  v_attempt int := 0;
begin
  if p_network not in ('TRC20', 'BEP20') then
    raise exception 'invalid_network';
  end if;

  if p_base_amount_usd is null or p_base_amount_usd < v_min_deposit then
    raise exception 'amount_below_minimum';
  end if;

  insert into public.users (telegram_id, first_name, referral_code)
  values (
    p_telegram_id,
    coalesce(nullif(trim(p_first_name), ''), 'User'),
    substr(md5(random()::text || p_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now()
  returning users.id into v_user_id;

  update public.deposit_intents di
  set status = 'expired'
  where di.user_id = v_user_id and di.status = 'pending' and di.expires_at < now();

  loop
    v_attempt := v_attempt + 1;
    v_exact_amount := round(p_base_amount_usd, 2) + (floor(random() * 999) + 1) / 1000000.0;

    begin
      insert into public.deposit_intents (user_id, network, expected_amount_usd)
      values (v_user_id, p_network, v_exact_amount)
      returning id into v_intent_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'could_not_generate_unique_amount';
      end if;
    end;
  end loop;

  return query
    select v_intent_id, v_exact_amount, di.expires_at
    from public.deposit_intents di
    where di.id = v_intent_id;
end;
$$;

revoke all on function public.create_deposit_intent(bigint, text, numeric, text) from public, anon, authenticated;
grant execute on function public.create_deposit_intent(bigint, text, numeric, text) to anon, authenticated;

-- credit_deposit: дозволяємо мережі TON_USDT і BEP20 -----------------------
create or replace function public.credit_deposit(
  p_telegram_id bigint,
  p_first_name text,
  p_amount_usd numeric,
  p_network text,
  p_wallet_address text,
  p_tx_hash text
)
returns table (transaction_id uuid, credited boolean, new_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_deposit constant numeric := 5;
  v_level1_rate constant numeric := 0.10;
  v_level2_rate constant numeric := 0.05;
  v_level3_rate constant numeric := 0.02;
  v_user_id uuid;
  v_new_id uuid;
  v_level1_id uuid;
  v_level2_id uuid;
  v_level3_id uuid;
  v_bonus numeric;
begin
  if p_tx_hash is null or trim(p_tx_hash) = '' then
    raise exception 'tx_hash_required';
  end if;

  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_network not in ('TON', 'TON_USDT', 'TRC20', 'BEP20', 'ADMIN') then
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

  if p_amount_usd < v_min_deposit then
    insert into public.transactions
      (user_id, type, network, amount_usd, currency, wallet_address, tx_hash, status, comment)
    values
      (v_user_id, 'deposit', p_network, p_amount_usd, 'USDT', p_wallet_address, p_tx_hash, 'failed',
       'Сума нижча мінімального депозиту (5 USDT)')
    on conflict (tx_hash) where tx_hash is not null do nothing
    returning transactions.id into v_new_id;

    return query
      select v_new_id, false, (select u.balance_usd from public.users u where u.id = v_user_id);
    return;
  end if;

  insert into public.transactions
    (user_id, type, network, amount_usd, currency, wallet_address, tx_hash, status, processed_at)
  values
    (v_user_id, 'deposit', p_network, p_amount_usd, 'USDT', p_wallet_address, p_tx_hash, 'completed', now())
  on conflict (tx_hash) where tx_hash is not null do nothing
  returning transactions.id into v_new_id;

  if v_new_id is null then
    return query
      select null::uuid, false, (select u.balance_usd from public.users u where u.id = v_user_id);
    return;
  end if;

  update public.users
  set balance_usd = balance_usd + p_amount_usd, updated_at = now()
  where id = v_user_id;

  select u.referred_by into v_level1_id from public.users u where u.id = v_user_id;

  if v_level1_id is not null then
    v_bonus := round(p_amount_usd * v_level1_rate, 6);
    update public.users
    set balance_usd = balance_usd + v_bonus, total_ref_earned = total_ref_earned + v_bonus, updated_at = now()
    where id = v_level1_id;
    insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
    values (v_level1_id, 'referral_bonus', v_bonus, 'USDT', 'completed',
            'Уровень 1 (10%) от депозита пользователя ' || p_telegram_id, now());

    select u.referred_by into v_level2_id from public.users u where u.id = v_level1_id;
  end if;

  if v_level2_id is not null then
    v_bonus := round(p_amount_usd * v_level2_rate, 6);
    update public.users
    set balance_usd = balance_usd + v_bonus, total_ref_earned = total_ref_earned + v_bonus, updated_at = now()
    where id = v_level2_id;
    insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
    values (v_level2_id, 'referral_bonus', v_bonus, 'USDT', 'completed',
            'Уровень 2 (5%) от депозита пользователя ' || p_telegram_id, now());

    select u.referred_by into v_level3_id from public.users u where u.id = v_level2_id;
  end if;

  if v_level3_id is not null then
    v_bonus := round(p_amount_usd * v_level3_rate, 6);
    update public.users
    set balance_usd = balance_usd + v_bonus, total_ref_earned = total_ref_earned + v_bonus, updated_at = now()
    where id = v_level3_id;
    insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
    values (v_level3_id, 'referral_bonus', v_bonus, 'USDT', 'completed',
            'Уровень 3 (2%) от депозита пользователя ' || p_telegram_id, now());
  end if;

  return query
    select v_new_id, true, (select u.balance_usd from public.users u where u.id = v_user_id);
end;
$$;

revoke all on function public.credit_deposit(bigint, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.credit_deposit(bigint, text, numeric, text, text, text) to service_role;
