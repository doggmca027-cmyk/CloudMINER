-- CloudMiner HYIP — 3-рівнева реферальна система.
--
-- Реферальний зв'язок уже існував з першої міграції: users.referred_by
-- (uuid, FK -> users.id). Окремий "referrer_id bigint" не додаємо — у
-- users.id uuid, а не bigint, тож такий зовнішній ключ був би просто
-- неможливий; referred_by виконує рівно ту саму роль.
--
-- Бонуси нараховуються ТІЛЬКИ з депозитів (не з доходу майнінгу і не з
-- бонусів за завдання), тому каскад зашитий прямо в credit_deposit —
-- це єдине місце, де депозит стає 'completed'.

alter table public.users
  add column if not exists total_ref_earned numeric(18, 6) not null default 0;

-- get_or_create_user: реферал фіксується лише при ПЕРШІЙ реєстрації ------
-- Сигнатура змінюється (новий параметр) — CREATE OR REPLACE не може
-- розширити список аргументів без дропу, інакше лишається "зайва" стара
-- 3-аргументна версія функції як окремий оверлоад.
drop function if exists public.get_or_create_user(bigint, text, text);

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
  -- Реферала шукаємо лише якщо він переданий і це не сам користувач
  -- (self-referral заборонений). Якщо telegram_id реферера ще не існує в
  -- users, v_referrer_id лишиться null — це нормально, реферал просто не
  -- прив'яжеться (реферер мусить сам хоч раз відкрити застосунок).
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
  -- referred_by свідомо НЕ входить у DO UPDATE — реферал фіксується лише
  -- при створенні рядка й ніколи не перезаписується наступними візитами.
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
      u.created_at, u.updated_at
    from public.users u
    where u.telegram_id = p_telegram_id;
end;
$$;

revoke all on function public.get_or_create_user(bigint, text, text, bigint) from public, anon, authenticated;
grant execute on function public.get_or_create_user(bigint, text, text, bigint) to anon, authenticated;

-- credit_deposit: каскад реферальних бонусів -----------------------------
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
  v_min_deposit constant numeric := 5;      -- тримати синхронізовано з MIN_DEPOSIT_USD у src/lib/deposits.ts
  v_level1_rate constant numeric := 0.10;   -- тримати синхронізовано з REFERRAL_RATES у src/lib/referrals.ts
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

  if p_amount_usd < v_min_deposit then
    -- Нижче мінімуму: фіксуємо як 'failed', щоб цей tx_hash більше не
    -- намагались обробити повторно при наступних опитуваннях, але баланс
    -- (і реферальний каскад) не чіпаємо.
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
    -- Рядок з таким tx_hash вже існував — цей платіж уже зараховано раніше
    -- (і реферальні бонуси з нього теж уже нараховані одного разу).
    return query
      select null::uuid, false, (select u.balance_usd from public.users u where u.id = v_user_id);
    return;
  end if;

  update public.users
  set balance_usd = balance_usd + p_amount_usd, updated_at = now()
  where id = v_user_id;

  -- Реферальний каскад — ТІЛЬКИ з депозитів (не з майнінгу, не з бонусів
  -- за завдання, бо ті взагалі не проходять через credit_deposit).
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

-- get_referral_stats: агрегати по 3 рівнях --------------------------------
create or replace function public.get_referral_stats(p_telegram_id bigint)
returns table (level integer, invited_count bigint, total_deposited_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select id from public.users where telegram_id = p_telegram_id
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
$$;

revoke all on function public.get_referral_stats(bigint) from public, anon, authenticated;
grant execute on function public.get_referral_stats(bigint) to anon, authenticated;

-- get_referral_list: деталізований фід рефералів 1-го рівня ---------------
create or replace function public.get_referral_list(p_telegram_id bigint)
returns table (
  masked_name text,
  total_deposited_usd numeric,
  earned_from_usd numeric,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select id from public.users where telegram_id = p_telegram_id
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
$$;

revoke all on function public.get_referral_list(bigint) from public, anon, authenticated;
grant execute on function public.get_referral_list(bigint) to anon, authenticated;
