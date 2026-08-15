-- CloudMiner HYIP — знижка на покупку майнерів + бонус до поповнення,
-- обидва — глобальний відсоток, що вручну задає адмін.
--
-- Семантика (навмисний вибір, не єдино можливий):
--   • Знижка на майнер зменшує лише СУМУ СПИСАННЯ з балансу при покупці —
--     сам майнер створюється з ПОВНОЮ ціною шаблону як `deposit_usd`
--     (саме це поле визначає майбутній заробіток: cap = deposit_usd *
--     return_multiplier). Тобто користувач платить менше, а отримує
--     ПОВНУ віддачу пакету — це і є цінність знижки, а не менший майнер
--     за менші гроші.
--   • Бонус до поповнення — це ДОДАТКОВЕ нарахування зверху реального
--     депозиту, окремим рядком у transactions (type='deposit_bonus'),
--     після того, як сам депозит зарахований. НЕ застосовується до
--     ручних адмінських нарахувань (p_network = 'ADMIN') — той шлях уже
--     контролюється вручну самим адміном, дублювати бонус там не варто.
--   • Реферальні бонуси (10/5/2%) рахуються від БАЗОВОЇ суми депозиту
--     (p_amount_usd), а не від суми з бонусом — не змінено.
--
-- Обидва відсотки — 0..100, вмикаються/вимикаються незалежним прапорцем
-- (щоб можна було лишити налаштоване значення, тимчасово вимкнувши
-- акцію, а не стирати число щоразу).

-- ============================================================================
-- app_settings — singleton-таблиця (рівно один рядок, id завжди `true`).
-- ============================================================================
create table if not exists public.app_settings (
  id boolean primary key default true,
  shop_discount_enabled boolean not null default false,
  shop_discount_percent numeric not null default 0
    constraint app_settings_shop_discount_range check (shop_discount_percent >= 0 and shop_discount_percent <= 100),
  deposit_bonus_enabled boolean not null default false,
  deposit_bonus_percent numeric not null default 0
    constraint app_settings_deposit_bonus_range check (deposit_bonus_percent >= 0 and deposit_bonus_percent <= 100),
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;
-- Жодних policy — прямий доступ anon/authenticated повністю закритий
-- (RLS-деним за замовчуванням), як і решта таблиць проєкту; єдиний шлях
-- читання/запису — SECURITY DEFINER RPC нижче.

-- ============================================================================
-- get_app_settings — публічний (без адмін-прав) читальний RPC: і
-- ShopTab/DepositPanel, і сама адмінка (щоб підвантажити поточні
-- значення у форму) використовують той самий виклик. Нічого чутливого
-- тут немає — просто поточна глобальна акція.
-- ============================================================================
create or replace function public.get_app_settings()
returns table (
  shop_discount_enabled boolean,
  shop_discount_percent numeric,
  deposit_bonus_enabled boolean,
  deposit_bonus_percent numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select s.shop_discount_enabled, s.shop_discount_percent, s.deposit_bonus_enabled, s.deposit_bonus_percent
  from public.app_settings s
  where s.id = true;
$$;

revoke all on function public.get_app_settings() from public, anon, authenticated;
grant execute on function public.get_app_settings() to anon, authenticated;

-- ============================================================================
-- admin_update_settings — адмін-редагування обох відсотків одразу.
-- ============================================================================
create or replace function public.admin_update_settings(
  p_admin_init_data text,
  p_shop_discount_enabled boolean,
  p_shop_discount_percent numeric,
  p_deposit_bonus_enabled boolean,
  p_deposit_bonus_percent numeric
)
returns table (
  shop_discount_enabled boolean,
  shop_discount_percent numeric,
  deposit_bonus_enabled boolean,
  deposit_bonus_percent numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select v.telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data) v;
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  if p_shop_discount_percent is null or p_shop_discount_percent < 0 or p_shop_discount_percent > 100 then
    raise exception 'invalid_discount_percent';
  end if;

  if p_deposit_bonus_percent is null or p_deposit_bonus_percent < 0 or p_deposit_bonus_percent > 100 then
    raise exception 'invalid_bonus_percent';
  end if;

  update public.app_settings s
  set shop_discount_enabled = p_shop_discount_enabled,
      shop_discount_percent = p_shop_discount_percent,
      deposit_bonus_enabled = p_deposit_bonus_enabled,
      deposit_bonus_percent = p_deposit_bonus_percent,
      updated_at = now()
  where s.id = true;

  return query
    select s.shop_discount_enabled, s.shop_discount_percent, s.deposit_bonus_enabled, s.deposit_bonus_percent
    from public.app_settings s
    where s.id = true;
end;
$$;

revoke all on function public.admin_update_settings(text, boolean, numeric, boolean, numeric) from public, anon, authenticated;
grant execute on function public.admin_update_settings(text, boolean, numeric, boolean, numeric) to anon, authenticated;

-- ============================================================================
-- purchase_miner — застосовує shop_discount_percent до СУМИ СПИСАННЯ.
-- ============================================================================
create or replace function public.purchase_miner(
  p_init_data text,
  p_template_id text
)
returns table (miner_id uuid, deposit_usd numeric, new_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
  v_first_name text;
  v_user_id uuid;
  v_balance numeric;
  v_template public.miner_templates%rowtype;
  v_miner_id uuid;
  v_discount_percent numeric;
  v_charge_amount numeric;
begin
  select v.telegram_id, v.first_name into v_telegram_id, v_first_name
  from public.verify_telegram_init_data(p_init_data) v;

  select * into v_template
  from public.miner_templates t
  where t.id = p_template_id and t.is_active = true;

  if v_template.id is null then
    raise exception 'template_not_found';
  end if;

  select s.shop_discount_percent into v_discount_percent
  from public.app_settings s
  where s.id = true and s.shop_discount_enabled = true;

  v_discount_percent := coalesce(v_discount_percent, 0);
  -- Ціна ПАКЕТУ (v_template.deposit_usd) лишається базою розрахунку
  -- знижки — саме "від ціни", як просив адмін, а не від довільної іншої
  -- суми.
  v_charge_amount := round(v_template.deposit_usd * (1 - v_discount_percent / 100), 6);

  insert into public.users (telegram_id, first_name, referral_code)
  values (
    v_telegram_id, coalesce(nullif(trim(v_first_name), ''), 'User'),
    substr(md5(random()::text || v_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now()
  returning users.id into v_user_id;

  select u.balance_usd into v_balance from public.users u where u.id = v_user_id for update;

  if v_balance < v_charge_amount then
    raise exception 'insufficient_balance';
  end if;

  update public.users u
  set balance_usd = u.balance_usd - v_charge_amount, updated_at = now()
  where u.id = v_user_id;

  -- v_template.deposit_usd (ПОВНА ціна, не v_charge_amount) — майнер дає
  -- повний обсяг заробітку пакету незалежно від знижки, див. коментар
  -- угорі файлу.
  insert into public.user_miners
    (user_id, template_id, name, is_free, deposit_usd, return_multiplier, duration_days,
     started_at, accrued_active_ms, active_since, claimed_usd, is_active)
  values (
    v_user_id, v_template.id, v_template.name, false, v_template.deposit_usd,
    v_template.return_multiplier, v_template.duration_days,
    now(), 0, now(), 0, true
  )
  returning id into v_miner_id;

  insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
  values (
    v_user_id, 'miner_purchase', v_charge_amount, 'USDT', 'completed',
    'Покупка майнера "' || v_template.name || '"' ||
      case when v_discount_percent > 0 then ' (скидка ' || v_discount_percent::text || '%)' else '' end,
    now()
  );

  return query
    select v_miner_id, v_template.deposit_usd, u.balance_usd from public.users u where u.id = v_user_id;
end;
$$;

revoke all on function public.purchase_miner(text, text) from public, anon, authenticated;
grant execute on function public.purchase_miner(text, text) to anon, authenticated;

-- ============================================================================
-- credit_deposit — нараховує deposit_bonus_percent ЗВЕРХУ реального
-- депозиту (окремою транзакцією), не зачіпаючи ручні адмінські
-- нарахування (p_network = 'ADMIN').
-- ============================================================================
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

  -- Бонус до поповнення — зверху БАЗОВОЇ суми депозиту (p_amount_usd,
  -- "від суми", як просив адмін), окремим рядком у журналі. Не для
  -- ручних адмінських нарахувань — там адмін і так контролює суму напряму.
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

  return query
    select v_new_id, true, (select u.balance_usd from public.users u where u.id = v_user_id);
end;
$$;

-- ⚠️ УВАГА: лише service_role, НЕ anon/authenticated — так само, як в
-- усіх попередніх версіях цієї функції (20260814150500 і далі).
-- credit_deposit викликається ТІЛЬКИ з Edge Functions (перевірені
-- ончейн-депозити) і admin_issue_deposit (сам SECURITY DEFINER, тож
-- викликає з привілеями власника незалежно від цього гранту) — надання
-- anon/authenticated дозволило б будь-якому клієнту напряму сфабрикувати
-- собі депозит в обхід перевірки блокчейну.
revoke all on function public.credit_deposit(bigint, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.credit_deposit(bigint, text, numeric, text, text, text) to service_role;
