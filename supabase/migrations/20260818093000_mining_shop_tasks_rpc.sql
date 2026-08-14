-- CloudMiner HYIP — реальний бекенд для майнінгу/шопу/завдань.
--
-- ДОСІ ShopTab/MiningTab/TasksTab керували куплеими майнерами й
-- виконаними завданнями ЛИШЕ через клієнтський React-стан
-- (UserStateContext) — таблиці `user_miners`/`tasks`/`user_tasks` уже
-- існували в схемі з першого дня, але жоден RPC їх не читав і не писав.
-- Наслідок: "покупка" майнера чи "збір" доходу ніяк не торкались
-- users.balance_usd на сервері (справжній withdrawal-баланс лишався
-- незмінним), а сам список майнерів/виконаних завдань зникав при
-- кожному перезавантаженні застосунку. Ця міграція додає RPC, які
-- реально списують/нараховують users.balance_usd і пишуть у
-- transactions — так само атомарно й під FOR UPDATE, як
-- request_withdrawal/credit_deposit.
--
-- Усі функції — клієнтські, тож ідентичність береться з підпису initData
-- (verify_telegram_init_data), як і решта RPC після
-- 20260818091000_migrate_rpcs_to_init_data.sql.

-- ============================================================================
-- list_user_miners — майнери поточного користувача (без free-майнера, той
-- і далі живе лише в MiningTab — не прив'язаний до депозиту/виводу).
-- ============================================================================
create or replace function public.list_user_miners(p_init_data text)
returns table (
  id uuid,
  template_id text,
  name text,
  is_free boolean,
  deposit_usd numeric,
  return_multiplier numeric,
  duration_days integer,
  started_at timestamptz,
  accrued_active_ms bigint,
  active_since timestamptz,
  claimed_usd numeric,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
  v_user_id uuid;
begin
  select telegram_id into v_telegram_id from public.verify_telegram_init_data(p_init_data);
  select u.id into v_user_id from public.users u where u.telegram_id = v_telegram_id;

  if v_user_id is null then
    return; -- новий користувач ще не має жодного рядка/майнера — порожній список, не помилка
  end if;

  return query
    select
      m.id, m.template_id, m.name, m.is_free, m.deposit_usd, m.return_multiplier,
      m.duration_days, m.started_at, m.accrued_active_ms, m.active_since, m.claimed_usd, m.is_active
    from public.user_miners m
    where m.user_id = v_user_id
    order by m.started_at desc;
end;
$$;

revoke all on function public.list_user_miners(text) from public, anon, authenticated;
grant execute on function public.list_user_miners(text) to anon, authenticated;

-- ============================================================================
-- purchase_miner — списує вартість шаблону з балансу, створює user_miners.
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
begin
  select v.telegram_id, v.first_name into v_telegram_id, v_first_name
  from public.verify_telegram_init_data(p_init_data) v;

  select * into v_template
  from public.miner_templates t
  where t.id = p_template_id and t.is_active = true;

  if v_template.id is null then
    raise exception 'template_not_found';
  end if;

  -- get_or_create_user мав уже відпрацювати на цей момент (профіль
  -- завантажується при вході в застосунок) — але про всяк випадок так само
  -- гарантуємо існування рядка users, як і решта RPC.
  insert into public.users (telegram_id, first_name, referral_code)
  values (
    v_telegram_id, coalesce(nullif(trim(v_first_name), ''), 'User'),
    substr(md5(random()::text || v_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now()
  returning users.id into v_user_id;

  select u.balance_usd into v_balance from public.users u where u.id = v_user_id for update;

  if v_balance < v_template.deposit_usd then
    raise exception 'insufficient_balance';
  end if;

  update public.users u
  set balance_usd = u.balance_usd - v_template.deposit_usd, updated_at = now()
  where u.id = v_user_id;

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
  values (v_user_id, 'miner_purchase', v_template.deposit_usd, 'USDT', 'completed',
          'Покупка майнера "' || v_template.name || '"', now());

  return query
    select v_miner_id, v_template.deposit_usd, u.balance_usd from public.users u where u.id = v_user_id;
end;
$$;

revoke all on function public.purchase_miner(text, text) from public, anon, authenticated;
grant execute on function public.purchase_miner(text, text) to anon, authenticated;

-- ============================================================================
-- claim_miner_income — переводить накопичений (ще не зібраний) дохід
-- конкретного майнера на баланс. Формула нарахування ТОЧНО повторює
-- src/lib/mining.ts (getUnclaimedUsd) — тримати синхронізовано.
-- ============================================================================
create or replace function public.claim_miner_income(
  p_init_data text,
  p_miner_id uuid
)
returns table (claimed_usd numeric, new_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
  v_user_id uuid;
  v_miner public.user_miners%rowtype;
  v_duration_ms numeric;
  v_live_ms numeric;
  v_effective_ms numeric;
  v_progress numeric;
  v_accrued_usd numeric;
  v_unclaimed numeric;
begin
  select telegram_id into v_telegram_id from public.verify_telegram_init_data(p_init_data);
  select u.id into v_user_id from public.users u where u.telegram_id = v_telegram_id;

  if v_user_id is null then
    raise exception 'miner_not_found';
  end if;

  -- FOR UPDATE блокує рядок майнера — паралельний "Собрать" (подвійний тап)
  -- на цей самий майнер не зможе зарахувати той самий дохід двічі.
  select * into v_miner
  from public.user_miners m
  where m.id = p_miner_id and m.user_id = v_user_id
  for update;

  if v_miner.id is null then
    raise exception 'miner_not_found';
  end if;

  v_duration_ms := v_miner.duration_days::numeric * 86400000;
  v_live_ms := case
    when v_miner.active_since is not null
    then extract(epoch from (now() - v_miner.active_since)) * 1000
    else 0
  end;
  v_effective_ms := least(v_miner.accrued_active_ms + v_live_ms, v_duration_ms);
  v_progress := case when v_duration_ms > 0 then v_effective_ms / v_duration_ms else 0 end;
  v_accrued_usd := v_miner.deposit_usd * v_miner.return_multiplier * v_progress;
  v_unclaimed := greatest(0, round(v_accrued_usd - v_miner.claimed_usd, 6));

  if v_unclaimed <= 0 then
    raise exception 'nothing_to_claim';
  end if;

  if v_progress >= 1 then
    -- Строк вичерпано — фіксуємо накопичений час і зупиняємо нарахування
    -- (той самий смисл, що pauseMiner на клієнті, але вже назавжди).
    update public.user_miners
    set claimed_usd = claimed_usd + v_unclaimed,
        accrued_active_ms = v_duration_ms::bigint,
        active_since = null,
        is_active = false
    where id = p_miner_id;
  else
    update public.user_miners
    set claimed_usd = claimed_usd + v_unclaimed
    where id = p_miner_id;
  end if;

  update public.users u set balance_usd = u.balance_usd + v_unclaimed, updated_at = now() where u.id = v_user_id;

  insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
  values (v_user_id, 'miner_claim', v_unclaimed, 'USDT', 'completed',
          'Доход майнера "' || v_miner.name || '"', now());

  return query select v_unclaimed, u.balance_usd from public.users u where u.id = v_user_id;
end;
$$;

revoke all on function public.claim_miner_income(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_miner_income(text, uuid) to anon, authenticated;

-- ============================================================================
-- list_user_tasks — активні завдання + статус виконання поточним
-- користувачем ("claimed"/"available"). tasks і так публічно читається
-- (RLS "is_active = true"), але user_tasks — ні (лежить лише через RPC),
-- тож TasksTab тепер отримує обидва одним викликом.
-- ============================================================================
create or replace function public.list_user_tasks(p_init_data text)
returns table (
  id uuid,
  type text,
  title text,
  description text,
  icon_url text,
  reward_usd numeric,
  reward_coin numeric,
  action_url text,
  verification_type text,
  is_active boolean,
  sort_order integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
  v_user_id uuid;
begin
  select telegram_id into v_telegram_id from public.verify_telegram_init_data(p_init_data);
  select u.id into v_user_id from public.users u where u.telegram_id = v_telegram_id;

  return query
    select
      t.id, t.type::text, t.title, t.description, t.icon_url, t.reward_usd, t.reward_coin,
      t.action_url, t.verification_type, t.is_active, t.sort_order,
      case when ut.status = 'claimed' then 'claimed' else 'available' end
    from public.tasks t
    left join public.user_tasks ut on ut.task_id = t.id and ut.user_id = v_user_id
    where t.is_active = true
    order by t.sort_order, t.id;
end;
$$;

revoke all on function public.list_user_tasks(text) from public, anon, authenticated;
grant execute on function public.list_user_tasks(text) to anon, authenticated;

-- ============================================================================
-- claim_task_reward — одноразова винагорода за завдання (unique PK
-- (user_id, task_id) у user_tasks гарантує, що той самий tsk не
-- зарахується двічі навіть при паралельних викликах).
--
-- ⚠️ Сама ПЕРЕВІРКА виконання завдання (підписка на партнерський канал
-- тощо) і далі відбувається на клієнті через checkSubscription/
-- verifyTaskSubscription (Edge Function "check-subscription" — ще не
-- розгорнута, лишається окремим TODO) — ця функція лише гарантує, що
-- ОДНА й та сама нагорода не буде видана більше одного разу і що вона
-- реально потрапляє в баланс/журнал. Захист від фальшивого "я підписався"
-- поки що НЕ криптографічний.
-- ============================================================================
create or replace function public.claim_task_reward(
  p_init_data text,
  p_task_id uuid
)
returns table (reward_usd numeric, new_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
  v_first_name text;
  v_user_id uuid;
  v_reward numeric;
  v_row_count int;
begin
  select v.telegram_id, v.first_name into v_telegram_id, v_first_name
  from public.verify_telegram_init_data(p_init_data) v;

  insert into public.users (telegram_id, first_name, referral_code)
  values (
    v_telegram_id, coalesce(nullif(trim(v_first_name), ''), 'User'),
    substr(md5(random()::text || v_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now()
  returning users.id into v_user_id;

  select t.reward_usd into v_reward from public.tasks t where t.id = p_task_id and t.is_active = true;
  if v_reward is null then
    raise exception 'task_not_found';
  end if;

  insert into public.user_tasks (user_id, task_id, status, claimed_at)
  values (v_user_id, p_task_id, 'claimed', now())
  on conflict (user_id, task_id) do nothing;

  get diagnostics v_row_count = row_count;
  if v_row_count = 0 then
    raise exception 'already_claimed';
  end if;

  if v_reward > 0 then
    update public.users u set balance_usd = u.balance_usd + v_reward, updated_at = now() where u.id = v_user_id;

    insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
    values (v_user_id, 'task_reward', v_reward, 'USDT', 'completed', 'Награда за задание', now());
  end if;

  return query select v_reward, u.balance_usd from public.users u where u.id = v_user_id;
end;
$$;

revoke all on function public.claim_task_reward(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_task_reward(text, uuid) to anon, authenticated;
