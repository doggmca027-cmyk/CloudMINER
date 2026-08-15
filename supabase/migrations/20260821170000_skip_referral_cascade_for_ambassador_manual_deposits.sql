-- CloudMiner HYIP — ручні депозити амбасадорам (адмінка → "Депозиты",
-- тип "Как реальный депозит") більше НЕ каскадують реферальні бонуси
-- (10/5/2%) їхньому апланду.
--
-- Причина: credit_deposit і досі нараховував реферальний каскад для
-- КОЖНОГО депозиту, включно з тими, що адмін видає вручну через
-- admin_issue_deposit (network='ADMIN') — незалежно від того, хто
-- отримувач. Для амбасадора це означало реальну діру: адмін видає
-- амбасадору, скажімо, $1000 "як реальний депозит" (потрібно для
-- розблокування виводу самому амбасадору), і хтось вище в його
-- реферальному ланцюжку автоматично отримує $100 (10%) з ПОВІТРЯ —
-- сума, яку ніхто насправді не депонував ончейн.
--
-- Рішення: новий параметр `p_skip_referral_cascade` у credit_deposit
-- (default false — жодна існуюча поведінка для РЕАЛЬНИХ ончейн-депозитів
-- не змінюється, викликають ті самі 3 Edge Function без цього
-- параметра). admin_issue_deposit сам вмикає його, коли профіль
-- отримувача вже позначений is_ambassador = true НА МОМЕНТ видачі.
-- Бонус до поповнення (deposit_bonus) і так уже не діяв на
-- network='ADMIN' — не змінено.

drop function if exists public.credit_deposit(bigint, text, numeric, text, text, text);

create or replace function public.credit_deposit(
  p_telegram_id bigint,
  p_first_name text,
  p_amount_usd numeric,
  p_network text,
  p_wallet_address text,
  p_tx_hash text,
  p_skip_referral_cascade boolean default false
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
  v_deposit_bonus_percent numeric;
  v_deposit_bonus_amount numeric;
begin
  if p_tx_hash is null or trim(p_tx_hash) = '' then
    raise exception 'tx_hash_required';
  end if;

  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_network not in ('TON', 'TON_USDT', 'TRC20', 'ADMIN') then
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

  -- Бонус до поповнення — зверху БАЗОВОЇ суми депозиту, не для ручних
  -- адмінських нарахувань (не змінено цією міграцією).
  if p_network <> 'ADMIN' then
    select s.deposit_bonus_percent into v_deposit_bonus_percent
    from public.app_settings s
    where s.id = true and s.deposit_bonus_enabled = true;

    v_deposit_bonus_percent := coalesce(v_deposit_bonus_percent, 0);

    if v_deposit_bonus_percent > 0 then
      v_deposit_bonus_amount := round(p_amount_usd * v_deposit_bonus_percent / 100, 6);

      update public.users
      set balance_usd = balance_usd + v_deposit_bonus_amount, updated_at = now()
      where id = v_user_id;

      insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
      values (v_user_id, 'deposit_bonus', v_deposit_bonus_amount, 'USDT', 'completed',
              'Бонус ' || v_deposit_bonus_percent::text || '% к пополнению', now());
    end if;
  end if;

  -- НОВЕ: реферальний каскад (10/5/2%) повністю пропускається, якщо
  -- p_skip_referral_cascade = true (адмінка вмикає це для ручних
  -- депозитів амбасадорам, див. коментар угорі файлу).
  if not p_skip_referral_cascade then
    select u.referred_by into v_level1_id from public.users u where u.id = v_user_id;

    if v_level1_id is not null then
      v_bonus := round(p_amount_usd * v_level1_rate, 6);
      update public.users
      set balance_usd = balance_usd + v_bonus, total_ref_earned = total_ref_earned + v_bonus, updated_at = now()
      where id = v_level1_id;
      insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
      values (v_level1_id, 'referral_bonus', v_bonus, 'USDT', 'completed',
              'Уровень 1 (10%) от депозита реферала', now());

      select u.referred_by into v_level2_id from public.users u where u.id = v_level1_id;
    end if;

    if v_level2_id is not null then
      v_bonus := round(p_amount_usd * v_level2_rate, 6);
      update public.users
      set balance_usd = balance_usd + v_bonus, total_ref_earned = total_ref_earned + v_bonus, updated_at = now()
      where id = v_level2_id;
      insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
      values (v_level2_id, 'referral_bonus', v_bonus, 'USDT', 'completed',
              'Уровень 2 (5%) от депозита реферала', now());

      select u.referred_by into v_level3_id from public.users u where u.id = v_level2_id;
    end if;

    if v_level3_id is not null then
      v_bonus := round(p_amount_usd * v_level3_rate, 6);
      update public.users
      set balance_usd = balance_usd + v_bonus, total_ref_earned = total_ref_earned + v_bonus, updated_at = now()
      where id = v_level3_id;
      insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
      values (v_level3_id, 'referral_bonus', v_bonus, 'USDT', 'completed',
              'Уровень 3 (2%) от депозита реферала', now());
    end if;
  end if;

  return query
    select v_new_id, true, (select u.balance_usd from public.users u where u.id = v_user_id);
end;
$$;

-- ⚠️ Лише service_role — той самий захист, що й раніше (див. коментар у
-- 20260821161000_shop_discount_and_deposit_bonus.sql).
revoke all on function public.credit_deposit(bigint, text, numeric, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.credit_deposit(bigint, text, numeric, text, text, text, boolean) to service_role;

-- ============================================================================
-- admin_issue_deposit — визначає is_ambassador отримувача ДО виклику
-- credit_deposit і вмикає p_skip_referral_cascade саме для нього.
-- ============================================================================
create or replace function public.admin_issue_deposit(
  p_admin_init_data text,
  p_target_telegram_id bigint,
  p_target_first_name text,
  p_amount_usd numeric,
  p_credit_type text
)
returns table (new_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
  v_user_id uuid;
  v_target_is_ambassador boolean;
  v_credit_result record;
begin
  select v.telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data) v;
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_credit_type not in ('balance_only', 'real_deposit') then
    raise exception 'invalid_credit_type';
  end if;

  -- Профіль отримувача ще ДО credit_deposit (той сам створить рядок,
  -- якщо його нема) — новий користувач природно is_ambassador = false,
  -- каскад для нього лишається як був.
  select u.is_ambassador into v_target_is_ambassador
  from public.users u
  where u.telegram_id = p_target_telegram_id;
  v_target_is_ambassador := coalesce(v_target_is_ambassador, false);

  if p_credit_type = 'real_deposit' then
    select * into v_credit_result
    from public.credit_deposit(
      p_target_telegram_id,
      p_target_first_name,
      p_amount_usd,
      'ADMIN',
      'admin:' || v_admin_id::text,
      'admin-manual-' || gen_random_uuid()::text,
      v_target_is_ambassador
    );

    insert into public.notification_queue (telegram_id, message)
    values (
      p_target_telegram_id,
      '🎉 Депозит зачислен! +' || p_amount_usd::text || ' USDT (начислено администратором).'
    );

    return query select v_credit_result.new_balance_usd;
    return;
  end if;

  insert into public.users (telegram_id, first_name, referral_code)
  values (
    p_target_telegram_id,
    coalesce(nullif(trim(p_target_first_name), ''), 'User'),
    substr(md5(random()::text || p_target_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now()
  returning id into v_user_id;

  update public.users
  set balance_usd = balance_usd + p_amount_usd, updated_at = now()
  where id = v_user_id;

  insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
  values (v_user_id, 'admin_credit', p_amount_usd, 'USDT', 'completed',
          'Начислено администратором ' || v_admin_id, now());

  insert into public.notification_queue (telegram_id, message)
  values (
    p_target_telegram_id,
    '💰 Ваш баланс пополнен администратором на ' || p_amount_usd::text || ' USDT.'
  );

  return query select u.balance_usd from public.users u where u.id = v_user_id;
end;
$$;

revoke all on function public.admin_issue_deposit(text, bigint, text, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_issue_deposit(text, bigint, text, numeric, text) to anon, authenticated;
