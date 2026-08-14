-- CloudMiner HYIP — переводить усі клієнтські RPC із довіреного
-- `p_telegram_id`/`p_admin_telegram_id` на `p_init_data`, перевірений через
-- `verify_telegram_init_data` (див. 20260818090000_telegram_init_data_auth.sql).
--
-- Стара сигнатура кожної функції DROP-иться явно (не лишається другим
-- оверлоадом) — інакше "дірявий" вхід (голий bigint, якому вірили
-- беззастережно) просто лишався б доступним паралельно з новим.
--
-- p_first_name/p_language_code як окремі клієнтські параметри прибрано
-- всюди, де вони раніше описували "самого себе" — тепер ці дані
-- витягуються з ВЕРИФІКОВАНОГО initData, а не з полів, які клієнт міг
-- підставити довільно.

-- ============================================================================
-- get_or_create_user
-- ============================================================================
drop function if exists public.get_or_create_user(bigint, text, text, bigint);

create or replace function public.get_or_create_user(
  p_init_data text,
  p_referrer_telegram_id bigint default null
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
  total_ref_earned numeric,
  has_completed_deposit boolean,
  is_admin boolean,
  is_ambassador boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
  v_first_name text;
  v_last_name text;
  v_username text;
  v_photo_url text;
  v_language_code text;
  v_referrer_id uuid;
begin
  select v.telegram_id, v.first_name, v.last_name, v.username, v.photo_url, v.language_code
  into v_telegram_id, v_first_name, v_last_name, v_username, v_photo_url, v_language_code
  from public.verify_telegram_init_data(p_init_data) v;

  if p_referrer_telegram_id is not null and p_referrer_telegram_id <> v_telegram_id then
    select u.id into v_referrer_id from public.users u where u.telegram_id = p_referrer_telegram_id;
  end if;

  insert into public.users
    (telegram_id, first_name, last_name, username, photo_url, language_code, referral_code, referred_by)
  values (
    v_telegram_id,
    coalesce(nullif(trim(v_first_name), ''), 'User'),
    nullif(trim(v_last_name), ''),
    nullif(trim(v_username), ''),
    nullif(trim(v_photo_url), ''),
    coalesce(nullif(trim(v_language_code), ''), 'en'),
    substr(md5(random()::text || v_telegram_id::text), 1, 8),
    v_referrer_id
  )
  -- referred_by свідомо НЕ входить у DO UPDATE (фіксується лише раз, як і
  -- раніше) — решта профільних полів тепер освіжається щовізиту РЕАЛЬНИМИ
  -- верифікованими даними Telegram, а не лишається "замороженою" з першого
  -- запуску.
  on conflict on constraint users_telegram_id_key do update
    set updated_at = now(),
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        username = excluded.username,
        photo_url = excluded.photo_url;

  return query
    select
      u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.photo_url,
      u.language_code, u.balance_usd, u.balance_coin, u.total_income, u.is_vip,
      u.referral_code, u.referred_by, u.total_ref_earned,
      exists(
        select 1 from public.transactions t
        where t.user_id = u.id and t.type = 'deposit' and t.status = 'completed'
      ) as has_completed_deposit,
      u.is_admin, u.is_ambassador,
      u.created_at, u.updated_at
    from public.users u
    where u.telegram_id = v_telegram_id;
end;
$$;

revoke all on function public.get_or_create_user(text, bigint) from public, anon, authenticated;
grant execute on function public.get_or_create_user(text, bigint) to anon, authenticated;

-- ============================================================================
-- update_user_language
-- ============================================================================
drop function if exists public.update_user_language(bigint, text, text);

create or replace function public.update_user_language(
  p_init_data text,
  p_language_code text
)
returns table (language_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array['ru', 'en', 'ar', 'id', 'es', 'kk', 'tr'];
  v_telegram_id bigint;
  v_first_name text;
begin
  if p_language_code is null or not (p_language_code = any (v_allowed)) then
    raise exception 'unsupported_language';
  end if;

  select v.telegram_id, v.first_name into v_telegram_id, v_first_name
  from public.verify_telegram_init_data(p_init_data) v;

  insert into public.users (telegram_id, first_name, language_code, referral_code)
  values (
    v_telegram_id,
    coalesce(nullif(trim(v_first_name), ''), 'User'),
    p_language_code,
    substr(md5(random()::text || v_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key
  do update set language_code = excluded.language_code, updated_at = now();

  return query
    select u.language_code from public.users u where u.telegram_id = v_telegram_id;
end;
$$;

revoke all on function public.update_user_language(text, text) from public, anon, authenticated;
grant execute on function public.update_user_language(text, text) to anon, authenticated;

-- ============================================================================
-- create_deposit_intent
-- ============================================================================
drop function if exists public.create_deposit_intent(bigint, text, numeric, text);

create or replace function public.create_deposit_intent(
  p_init_data text,
  p_base_amount_usd numeric,
  p_network text default 'TRC20'
)
returns table (intent_id uuid, exact_amount_usd numeric, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_deposit constant numeric := 5;
  v_telegram_id bigint;
  v_first_name text;
  v_user_id uuid;
  v_exact_amount numeric;
  v_intent_id uuid;
  v_attempt int := 0;
begin
  if p_network <> 'TRC20' then
    raise exception 'invalid_network';
  end if;

  if p_base_amount_usd is null or p_base_amount_usd < v_min_deposit then
    raise exception 'amount_below_minimum';
  end if;

  select v.telegram_id, v.first_name into v_telegram_id, v_first_name
  from public.verify_telegram_init_data(p_init_data) v;

  insert into public.users (telegram_id, first_name, referral_code)
  values (
    v_telegram_id,
    coalesce(nullif(trim(v_first_name), ''), 'User'),
    substr(md5(random()::text || v_telegram_id::text), 1, 8)
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

revoke all on function public.create_deposit_intent(text, numeric, text) from public, anon, authenticated;
grant execute on function public.create_deposit_intent(text, numeric, text) to anon, authenticated;

-- ============================================================================
-- request_withdrawal (TON-only, див. 20260817090000_withdrawal_ton_only.sql)
-- ============================================================================
drop function if exists public.request_withdrawal(bigint, text, numeric, text, text);

create or replace function public.request_withdrawal(
  p_init_data text,
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
  v_telegram_id bigint;
  v_first_name text;
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

  select v.telegram_id, v.first_name into v_telegram_id, v_first_name
  from public.verify_telegram_init_data(p_init_data) v;

  insert into public.users (telegram_id, first_name, referral_code)
  values (
    v_telegram_id,
    coalesce(nullif(trim(v_first_name), ''), 'User'),
    substr(md5(random()::text || v_telegram_id::text), 1, 8)
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

revoke all on function public.request_withdrawal(text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.request_withdrawal(text, numeric, text, text) to anon, authenticated;

-- ============================================================================
-- get_referral_stats / get_referral_list
-- ============================================================================
drop function if exists public.get_referral_stats(bigint);

create or replace function public.get_referral_stats(p_init_data text)
returns table (level integer, invited_count bigint, total_deposited_usd numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
begin
  select telegram_id into v_telegram_id from public.verify_telegram_init_data(p_init_data);

  return query
    with target as (
      select id from public.users where telegram_id = v_telegram_id
    ),
    l1 as (
      select u.id from public.users u join target on u.referred_by = target.id
    ),
    l2 as (
      select u.id from public.users u where u.referred_by in (select id from l1)
    ),
    l3 as (
      select u.id from public.users u where u.referred_by in (select id from l2)
    ),
    deposits as (
      select t.user_id, sum(t.amount_usd) as total
      from public.transactions t
      where t.type = 'deposit' and t.status = 'completed'
      group by t.user_id
    )
    select 1, (select count(*) from l1)::bigint,
      coalesce((select sum(d.total) from l1 join deposits d on d.user_id = l1.id), 0)
    union all
    select 2, (select count(*) from l2)::bigint,
      coalesce((select sum(d.total) from l2 join deposits d on d.user_id = l2.id), 0)
    union all
    select 3, (select count(*) from l3)::bigint,
      coalesce((select sum(d.total) from l3 join deposits d on d.user_id = l3.id), 0);
end;
$$;

revoke all on function public.get_referral_stats(text) from public, anon, authenticated;
grant execute on function public.get_referral_stats(text) to anon, authenticated;

drop function if exists public.get_referral_list(bigint);

create or replace function public.get_referral_list(p_init_data text)
returns table (
  masked_name text,
  total_deposited_usd numeric,
  earned_from_usd numeric,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
begin
  select telegram_id into v_telegram_id from public.verify_telegram_init_data(p_init_data);

  return query
    with target as (
      select id from public.users where telegram_id = v_telegram_id
    ),
    deposits as (
      select t.user_id, sum(t.amount_usd) as total
      from public.transactions t
      where t.type = 'deposit' and t.status = 'completed'
      group by t.user_id
    )
    select
      left(coalesce(nullif(u.username, ''), u.first_name), 3) || '***' as masked_name,
      coalesce(d.total, 0) as total_deposited_usd,
      round(coalesce(d.total, 0) * 0.10, 6) as earned_from_usd,
      u.created_at as joined_at
    from public.users u
    join target on u.referred_by = target.id
    left join deposits d on d.user_id = u.id
    order by u.created_at desc;
end;
$$;

revoke all on function public.get_referral_list(text) from public, anon, authenticated;
grant execute on function public.get_referral_list(text) to anon, authenticated;

-- ============================================================================
-- Адмінка: p_admin_telegram_id -> p_admin_init_data (p_target_telegram_id
-- лишається як є — це НЕ ідентичність викликача, це обраний адміном
-- параметр-ціль дії, не потребує верифікації підписом).
-- ============================================================================

drop function if exists public.admin_set_ambassador(bigint, bigint, boolean);

create or replace function public.admin_set_ambassador(
  p_admin_init_data text,
  p_target_telegram_id bigint,
  p_is_ambassador boolean
)
returns table (telegram_id bigint, is_ambassador boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  update public.users u
  set is_ambassador = p_is_ambassador, updated_at = now()
  where u.telegram_id = p_target_telegram_id;

  if not found then
    raise exception 'user_not_found';
  end if;

  return query
    select u.telegram_id, u.is_ambassador from public.users u where u.telegram_id = p_target_telegram_id;
end;
$$;

revoke all on function public.admin_set_ambassador(text, bigint, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_ambassador(text, bigint, boolean) to anon, authenticated;

drop function if exists public.admin_list_ambassadors(bigint);

create or replace function public.admin_list_ambassadors(p_admin_init_data text)
returns table (
  telegram_id bigint,
  username text,
  first_name text,
  level1_count bigint,
  level2_count bigint,
  level3_count bigint,
  total_deposited_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  return query
    with ambassadors as (
      select u.id, u.telegram_id, u.username, u.first_name
      from public.users u
      where u.is_ambassador = true
    ),
    l1 as (
      select a.telegram_id as amb_tg, u.id from ambassadors a join public.users u on u.referred_by = a.id
    ),
    l2 as (
      select l1.amb_tg, u.id from l1 join public.users u on u.referred_by = l1.id
    ),
    l3 as (
      select l2.amb_tg, u.id from l2 join public.users u on u.referred_by = l2.id
    ),
    deposits as (
      select t.user_id, sum(t.amount_usd) as total
      from public.transactions t
      where t.type = 'deposit' and t.status = 'completed'
      group by t.user_id
    )
    select
      a.telegram_id,
      a.username,
      a.first_name,
      (select count(*) from l1 where l1.amb_tg = a.telegram_id)::bigint,
      (select count(*) from l2 where l2.amb_tg = a.telegram_id)::bigint,
      (select count(*) from l3 where l3.amb_tg = a.telegram_id)::bigint,
      coalesce((
        select sum(d.total) from deposits d
        where d.user_id in (
          select id from l1 where l1.amb_tg = a.telegram_id
          union all select id from l2 where l2.amb_tg = a.telegram_id
          union all select id from l3 where l3.amb_tg = a.telegram_id
        )
      ), 0)
    from ambassadors a
    order by a.telegram_id;
end;
$$;

revoke all on function public.admin_list_ambassadors(text) from public, anon, authenticated;
grant execute on function public.admin_list_ambassadors(text) to anon, authenticated;

drop function if exists public.admin_issue_deposit(bigint, bigint, text, numeric, text);

create or replace function public.admin_issue_deposit(
  p_admin_init_data text,
  p_target_telegram_id bigint,
  p_target_first_name text,
  p_amount_usd numeric,
  p_credit_type text -- 'balance_only' | 'real_deposit'
)
returns table (new_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
  v_user_id uuid;
  v_credit_result record;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_credit_type not in ('balance_only', 'real_deposit') then
    raise exception 'invalid_credit_type';
  end if;

  if p_credit_type = 'real_deposit' then
    select * into v_credit_result
    from public.credit_deposit(
      p_target_telegram_id,
      p_target_first_name,
      p_amount_usd,
      'ADMIN',
      'admin:' || v_admin_id::text,
      'admin-manual-' || gen_random_uuid()::text
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

drop function if exists public.admin_list_pending_withdrawals(bigint);

create or replace function public.admin_list_pending_withdrawals(p_admin_init_data text)
returns table (
  transaction_id uuid,
  telegram_id bigint,
  username text,
  first_name text,
  amount_usd numeric,
  fee_usd numeric,
  network text,
  wallet_address text,
  requested_at timestamptz,
  user_total_deposited_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  return query
    with deposits as (
      select t.user_id, sum(t.amount_usd) as total
      from public.transactions t
      where t.type = 'deposit' and t.status = 'completed'
      group by t.user_id
    )
    select
      t.id, u.telegram_id, u.username, u.first_name,
      t.amount_usd, t.fee_usd, t.network, t.wallet_address, t.created_at,
      coalesce(d.total, 0)
    from public.transactions t
    join public.users u on u.id = t.user_id
    left join deposits d on d.user_id = u.id
    where t.type = 'withdrawal' and t.status = 'pending'
    order by t.created_at asc;
end;
$$;

revoke all on function public.admin_list_pending_withdrawals(text) from public, anon, authenticated;
grant execute on function public.admin_list_pending_withdrawals(text) to anon, authenticated;

drop function if exists public.admin_resolve_withdrawal(bigint, uuid, boolean, text);

create or replace function public.admin_resolve_withdrawal(
  p_admin_init_data text,
  p_transaction_id uuid,
  p_approve boolean,
  p_rejection_reason text default null
)
returns table (id uuid, status transaction_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
  v_user_id uuid;
  v_telegram_id bigint;
  v_amount numeric;
  v_current_status transaction_status;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  -- Підтвердження (approve=true) через цю функцію й далі заборонене — вивід
  -- реально відправляється тільки через process-withdrawal (Edge Function) +
  -- admin_mark_withdrawal_processing/completed/failed, див.
  -- 20260816091000_auto_withdrawal_payout.sql.
  if p_approve then
    raise exception 'use_process_withdrawal_function';
  end if;

  select t.user_id, t.amount_usd, t.status, u.telegram_id
  into v_user_id, v_amount, v_current_status, v_telegram_id
  from public.transactions t
  join public.users u on u.id = t.user_id
  where t.id = p_transaction_id and t.type = 'withdrawal'
  for update of t;

  if v_user_id is null then
    raise exception 'withdrawal_not_found';
  end if;

  if v_current_status <> 'pending' then
    raise exception 'withdrawal_already_resolved';
  end if;

  update public.transactions t
  set status = 'rejected', processed_at = now(),
      comment = coalesce(t.comment, '') || ' | Отклонено: ' ||
                coalesce(nullif(trim(p_rejection_reason), ''), 'без указания причины')
  where t.id = p_transaction_id;

  update public.users u set balance_usd = u.balance_usd + v_amount, updated_at = now() where u.id = v_user_id;

  insert into public.notification_queue (telegram_id, message)
  values (
    v_telegram_id,
    '❌ Ваша заявка на вывод ' || v_amount::text || ' USDT отклонена. Причина: ' ||
    coalesce(nullif(trim(p_rejection_reason), ''), 'не указана') || '. Средства возвращены на баланс.'
  );

  return query select t.id, t.status from public.transactions t where t.id = p_transaction_id;
end;
$$;

revoke all on function public.admin_resolve_withdrawal(text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_resolve_withdrawal(text, uuid, boolean, text) to anon, authenticated;

drop function if exists public.admin_list_tasks(bigint);

create or replace function public.admin_list_tasks(p_admin_init_data text)
returns table (
  id uuid, title text, action_url text, reward_usd numeric,
  verification_type text, is_active boolean, sort_order integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  return query
    select t.id, t.title, t.action_url, t.reward_usd, t.verification_type, t.is_active, t.sort_order
    from public.tasks t
    order by t.sort_order, t.id;
end;
$$;

revoke all on function public.admin_list_tasks(text) from public, anon, authenticated;
grant execute on function public.admin_list_tasks(text) to anon, authenticated;

drop function if exists public.admin_create_task(bigint, text, text, numeric, text);

create or replace function public.admin_create_task(
  p_admin_init_data text,
  p_title text,
  p_action_url text,
  p_reward_usd numeric,
  p_verification_type text
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
  v_id uuid;
  v_next_sort integer;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'title_required';
  end if;

  if p_reward_usd is null or p_reward_usd < 0 then
    raise exception 'invalid_reward';
  end if;

  if p_verification_type not in ('subscription', 'click') then
    raise exception 'invalid_verification_type';
  end if;

  select coalesce(max(t.sort_order), -1) + 1 into v_next_sort from public.tasks t;

  insert into public.tasks (type, title, action_url, reward_usd, verification_type, is_active, sort_order)
  values ('partner', trim(p_title), nullif(trim(p_action_url), ''), p_reward_usd, p_verification_type, true, v_next_sort)
  returning tasks.id into v_id;

  return query select v_id;
end;
$$;

revoke all on function public.admin_create_task(text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_create_task(text, text, text, numeric, text) to anon, authenticated;

drop function if exists public.admin_set_task_active(bigint, uuid, boolean);

create or replace function public.admin_set_task_active(
  p_admin_init_data text,
  p_task_id uuid,
  p_is_active boolean
)
returns table (id uuid, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  update public.tasks t set is_active = p_is_active where t.id = p_task_id;

  if not found then
    raise exception 'task_not_found';
  end if;

  return query select t.id, t.is_active from public.tasks t where t.id = p_task_id;
end;
$$;

revoke all on function public.admin_set_task_active(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_task_active(text, uuid, boolean) to anon, authenticated;

drop function if exists public.admin_delete_task(bigint, uuid);

create or replace function public.admin_delete_task(p_admin_init_data text, p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  delete from public.tasks t where t.id = p_task_id;
end;
$$;

revoke all on function public.admin_delete_task(text, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_task(text, uuid) to anon, authenticated;
