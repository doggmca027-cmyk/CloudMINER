-- CloudMiner HYIP — адмін-панель.
--
-- Права адміна: users.is_admin (не VITE_-змінна оточення) — env-список був
-- би клієнтським і його теоретично можна підмінити в DevTools; кожен
-- admin_* RPC нижче незалежно перевіряє is_admin на сервері через
-- is_admin_telegram_id(), тож саме ця колонка — єдине джерело правди.
--
-- Сповіщення користувачам (виданий депозит / підтверджений чи відхилений
-- вивід) НЕ надсилаються напряму з SQL: у Postgres немає безпечного доступу
-- до TELEGRAM_BOT_TOKEN без додаткової інфраструктури (pg_net + Vault).
-- Замість цього admin_* RPC кладуть повідомлення в notification_queue, а
-- нова Edge Function send-notifications (за розкладом, як і
-- check-ton-deposits) забирає їх звідти й надсилає через Bot API.

alter table public.users
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_ambassador boolean not null default false;

-- notification_queue -------------------------------------------------------
create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  message text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index notification_queue_pending_idx on public.notification_queue (created_at) where sent_at is null;

alter table public.notification_queue enable row level security;
-- Без публічних політик: пише лише SECURITY DEFINER RPC нижче, читає й
-- позначає надісланим лише service_role (Edge Function send-notifications).

-- is_admin_telegram_id ------------------------------------------------------
-- Внутрішній helper для решти admin_* RPC. EXECUTE навмисно НЕ видається
-- anon/authenticated — з фронтенду "чи я адмін" читається з
-- user.isAdmin (уже приходить у профілі через get_or_create_user), а не
-- прямим викликом цієї функції.
create or replace function public.is_admin_telegram_id(p_telegram_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select u.is_admin from public.users u where u.telegram_id = p_telegram_id), false);
$$;

revoke all on function public.is_admin_telegram_id(bigint) from public, anon, authenticated;

-- get_or_create_user: додає is_admin/is_ambassador у профіль -------------
-- Вихідні колонки змінюються — CREATE OR REPLACE цього не дозволяє без дропу.
drop function if exists public.get_or_create_user(bigint, text, text, bigint);

create or replace function public.get_or_create_user(
  p_telegram_id bigint,
  p_first_name text,
  p_language_code text default 'en',
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
  v_referrer_id uuid;
begin
  if p_referrer_telegram_id is not null and p_referrer_telegram_id <> p_telegram_id then
    select u.id into v_referrer_id from public.users u where u.telegram_id = p_referrer_telegram_id;
  end if;

  insert into public.users (telegram_id, first_name, language_code, referral_code, referred_by)
  values (
    p_telegram_id,
    coalesce(nullif(trim(p_first_name), ''), 'User'),
    coalesce(nullif(trim(p_language_code), ''), 'en'),
    substr(md5(random()::text || p_telegram_id::text), 1, 8),
    v_referrer_id
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now();

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
    where u.telegram_id = p_telegram_id;
end;
$$;

revoke all on function public.get_or_create_user(bigint, text, text, bigint) from public, anon, authenticated;
grant execute on function public.get_or_create_user(bigint, text, text, bigint) to anon, authenticated;

-- credit_deposit: дозволяємо мережу 'ADMIN' для ручних видач адміном -------
-- (той самий каскад/ідемпотентність — admin_issue_deposit нижче просто
-- викликає цю саму функцію з унікальним синтетичним tx_hash).
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

  if p_network not in ('TON', 'TRC20', 'ADMIN') then
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
-- admin_issue_deposit (SECURITY DEFINER, окремо нижче) викликає цю функцію
-- напряму зсередини — внутрішній виклик між функціями одного власника не
-- потребує окремого EXECUTE-гранту для anon/authenticated.

-- request_withdrawal: тепер РЕАЛЬНО перевіряє й списує баланс на сервері ---
-- Раніше баланс списувався лише оптимістично на клієнті (WithdrawPanel) —
-- сервер ніяк не перевіряв достатність коштів і не резервував суму. Без
-- цього "Відхилити → повернути на баланс" в адмінці не мало б сенсу
-- (нічого було б повертати).
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

  if p_network not in ('TON', 'TRC20') then
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

  -- FOR UPDATE: блокує рядок користувача проти паралельного withdrawal-
  -- запиту, що міг би "проскочити" ту саму перевірку балансу до коміту.
  -- Явний аліас u.id обов'язковий: RETURNS TABLE цієї функції має вихідну
  -- колонку "id", і без аліаса PL/pgSQL підставляє його замість users.id.
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

-- ============================================================================
-- Розділ 1: Амбассадори
-- ============================================================================

create or replace function public.admin_set_ambassador(
  p_admin_telegram_id bigint,
  p_target_telegram_id bigint,
  p_is_ambassador boolean
)
returns table (telegram_id bigint, is_ambassador boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
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

revoke all on function public.admin_set_ambassador(bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_ambassador(bigint, bigint, boolean) to anon, authenticated;

create or replace function public.admin_list_ambassadors(p_admin_telegram_id bigint)
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
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
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

revoke all on function public.admin_list_ambassadors(bigint) from public, anon, authenticated;
grant execute on function public.admin_list_ambassadors(bigint) to anon, authenticated;

-- ============================================================================
-- Розділ 2: Ручна видача депозитів
-- ============================================================================

create or replace function public.admin_issue_deposit(
  p_admin_telegram_id bigint,
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
  v_user_id uuid;
  v_credit_result record;
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_credit_type not in ('balance_only', 'real_deposit') then
    raise exception 'invalid_credit_type';
  end if;

  if p_credit_type = 'real_deposit' then
    -- Реюзаємо credit_deposit — той самий каскад і той самий захист від
    -- подвійного зарахування (унікальний tx_hash), що й для TON/TRC-20.
    select * into v_credit_result
    from public.credit_deposit(
      p_target_telegram_id,
      p_target_first_name,
      p_amount_usd,
      'ADMIN',
      'admin:' || p_admin_telegram_id::text,
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

  -- balance_only: чистий бонус на баланс — НЕ депозит, не розблоковує
  -- вивід і не тригерить реферальний каскад.
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
          'Начислено администратором ' || p_admin_telegram_id, now());

  insert into public.notification_queue (telegram_id, message)
  values (
    p_target_telegram_id,
    '💰 Ваш баланс пополнен администратором на ' || p_amount_usd::text || ' USDT.'
  );

  return query select u.balance_usd from public.users u where u.id = v_user_id;
end;
$$;

revoke all on function public.admin_issue_deposit(bigint, bigint, text, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_issue_deposit(bigint, bigint, text, numeric, text) to anon, authenticated;

-- ============================================================================
-- Розділ 3: Модерація виводів
-- ============================================================================

create or replace function public.admin_list_pending_withdrawals(p_admin_telegram_id bigint)
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
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
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

revoke all on function public.admin_list_pending_withdrawals(bigint) from public, anon, authenticated;
grant execute on function public.admin_list_pending_withdrawals(bigint) to anon, authenticated;

create or replace function public.admin_resolve_withdrawal(
  p_admin_telegram_id bigint,
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
  v_user_id uuid;
  v_telegram_id bigint;
  v_amount numeric;
  v_current_status transaction_status;
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  -- FOR UPDATE замикає рядок заявки — захист від подвійного підтвердження/
  -- відхилення тим самим чи іншим адміном одночасно.
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

  if p_approve then
    update public.transactions t
    set status = 'completed', processed_at = now()
    where t.id = p_transaction_id;

    insert into public.notification_queue (telegram_id, message)
    values (
      v_telegram_id,
      '✅ Ваша заявка на вывод ' || v_amount::text || ' USDT подтверждена и обработана.'
    );
  else
    update public.transactions t
    set status = 'rejected', processed_at = now(),
        comment = coalesce(t.comment, '') || ' | Отклонено: ' ||
                  coalesce(nullif(trim(p_rejection_reason), ''), 'без указания причины')
    where t.id = p_transaction_id;

    -- Повертаємо повну суму назад — вона була списана в момент подачі заявки.
    -- Аліас u.id обов'язковий: RETURNS TABLE має вихідну колонку "id".
    update public.users u set balance_usd = u.balance_usd + v_amount, updated_at = now() where u.id = v_user_id;

    insert into public.notification_queue (telegram_id, message)
    values (
      v_telegram_id,
      '❌ Ваша заявка на вывод ' || v_amount::text || ' USDT отклонена. Причина: ' ||
      coalesce(nullif(trim(p_rejection_reason), ''), 'не указана') || '. Средства возвращены на баланс.'
    );
  end if;

  return query select t.id, t.status from public.transactions t where t.id = p_transaction_id;
end;
$$;

revoke all on function public.admin_resolve_withdrawal(bigint, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_resolve_withdrawal(bigint, uuid, boolean, text) to anon, authenticated;

-- ============================================================================
-- Розділ 4: Управління завданнями
-- ============================================================================

alter table public.tasks
  add column if not exists verification_type text not null default 'click'
  check (verification_type in ('subscription', 'click'));

create or replace function public.admin_list_tasks(p_admin_telegram_id bigint)
returns table (
  id uuid, title text, action_url text, reward_usd numeric,
  verification_type text, is_active boolean, sort_order integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  return query
    select t.id, t.title, t.action_url, t.reward_usd, t.verification_type, t.is_active, t.sort_order
    from public.tasks t
    order by t.sort_order, t.id;
end;
$$;

revoke all on function public.admin_list_tasks(bigint) from public, anon, authenticated;
grant execute on function public.admin_list_tasks(bigint) to anon, authenticated;

create or replace function public.admin_create_task(
  p_admin_telegram_id bigint,
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
  v_id uuid;
  v_next_sort integer;
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
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

revoke all on function public.admin_create_task(bigint, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_create_task(bigint, text, text, numeric, text) to anon, authenticated;

create or replace function public.admin_set_task_active(
  p_admin_telegram_id bigint,
  p_task_id uuid,
  p_is_active boolean
)
returns table (id uuid, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  update public.tasks t set is_active = p_is_active where t.id = p_task_id;

  if not found then
    raise exception 'task_not_found';
  end if;

  return query select t.id, t.is_active from public.tasks t where t.id = p_task_id;
end;
$$;

revoke all on function public.admin_set_task_active(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_task_active(bigint, uuid, boolean) to anon, authenticated;

create or replace function public.admin_delete_task(p_admin_telegram_id bigint, p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  delete from public.tasks t where t.id = p_task_id;
end;
$$;

revoke all on function public.admin_delete_task(bigint, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_task(bigint, uuid) to anon, authenticated;

-- Сідуємо verification_type для вже наявних 3 демо-завдань (усі — перевірка підписки).
update public.tasks set verification_type = 'subscription' where verification_type is null or verification_type = 'click';

-- ============================================================================
-- Bootstrap: перший адмін
-- ============================================================================
-- Ставимо is_admin = true конкретним telegram_id, створюючи рядок
-- користувача, якщо він ще жодного разу не відкривав застосунок.
-- 6288342755 — реальний адмін проєкту.
-- 999000111 — dev-заглушка (getTelegramUser fallback поза Telegram, лише
-- коли import.meta.env.DEV) — зручно для локального тестування адмінки.

insert into public.users (telegram_id, first_name, referral_code, is_admin)
values (6288342755, 'Admin', substr(md5(random()::text || '6288342755'), 1, 8), true)
on conflict on constraint users_telegram_id_key do update set is_admin = true;

insert into public.users (telegram_id, first_name, referral_code, is_admin)
values (999000111, 'Dev Admin', substr(md5(random()::text || '999000111'), 1, 8), true)
on conflict on constraint users_telegram_id_key do update set is_admin = true;
