-- CloudMiner HYIP — free-майнер стає РЕАЛЬНИМ, персистентним рядком
-- user_miners (як і куплені), а не ефемерним клієнтським React-станом.
--
-- Проблема (звіт користувача: "пользователи могут купить сколько угодно
-- манйеров" — уточнено: ліміт потрібен саме на free-майнер): досі
-- `createFreeMiner()` у MiningTab.tsx створював НОВИЙ об'єкт
-- (claimedUsd=0, accruedActiveMs=0) при КОЖНОМУ монтуванні компонента —
-- а MiningTab розмонтовується/монтується заново щоразу при переході на
-- іншу вкладку й назад (React Router) чи перезавантаженні застосунку.
-- Ефективно це давало НЕСКІНЧЕННЕ поновлення капу free-майнера
-- (depositUsd * returnMultiplier = 1.5 * 1.5 = 2.25 USDT) — досить
-- вийти з вкладки "Майнинг" і повернутись, щоб почати накопичення
-- знову з нуля, необмежену кількість разів. Додатково: "зібраний" дохід
-- free-майнера ніколи не писався на сервер (addBalance — суто
-- клієнтський React-стан), тож ця сума однаково не могла бути виведена
-- (request_withdrawal перевіряє РЕАЛЬНИЙ users.balance_usd), але сам
-- інтерфейс показував користувачу цифри, які нізвідки не бралися і
-- нікуди не вели.
--
-- Рішення: один-єдиний рядок user_miners (is_free = true) НА
-- КОРИСТУВАЧА НАЗАВЖДИ — унікальний частковий індекс не дає створити
-- другий. Дохід рахує/зараховує вже наявний (і нещодавно виправлений,
-- 20260821130000) claim_miner_income — той самий трастовий,
-- server-authoritative шлях, що й для куплених майнерів. Депозит/пауза
-- більше не клієнтський стан — активність теж на сервері
-- (set_free_miner_active), синхронізується з реальним статусом
-- підписки (checkSubscription), а не скидається при кожному ремаунті.

create unique index if not exists user_miners_one_free_per_user
  on public.user_miners (user_id)
  where is_free;

-- ============================================================================
-- ensure_free_miner — створює (якщо ще нема) або повертає ІСНУЮЧИЙ
-- free-майнер користувача. Idempotent: другий і кожен наступний виклик
-- лише повертає той самий рядок (ON CONFLICT DO NOTHING), НЕ скидаючи
-- прогрес — саме це й закриває дірку з нескінченним поновленням капа.
-- ============================================================================
create or replace function public.ensure_free_miner(p_init_data text)
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
  v_free_deposit_usd constant numeric := 1.5;
  v_free_return_multiplier constant numeric := 1.5;
  v_free_duration_days constant integer := 10;
  v_telegram_id bigint;
  v_first_name text;
  v_user_id uuid;
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

  -- НЕ `on conflict (user_id) where is_free do nothing`: предикат `is_free`
  -- у такому вигляді так само неоднозначний із власною OUT-колонкою цієї ж
  -- функції (returns table (..., is_free boolean, ...)) — той самий клас
  -- бага, що й у claim_miner_income/admin_*, щойно відтворений тут-таки.
  -- IF NOT EXISTS + INSERT цього уникає (усередині SELECT `m.is_free` —
  -- кваліфіковано через аліас, без жодної двозначності); унікальний
  -- частковий індекс user_miners_one_free_per_user усе одно захищає від
  -- дубля при паралельному виклику — просто ловимо unique_violation.
  if not exists (
    select 1 from public.user_miners m where m.user_id = v_user_id and m.is_free = true
  ) then
    begin
      insert into public.user_miners
        (user_id, template_id, name, is_free, deposit_usd, return_multiplier, duration_days,
         started_at, accrued_active_ms, active_since, claimed_usd, is_active)
      values (
        v_user_id, null, 'Free Miner', true, v_free_deposit_usd, v_free_return_multiplier,
        v_free_duration_days, now(), 0, null, 0, false
      );
    exception when unique_violation then
      null; -- паралельний виклик уже створив рядок — нижчий select все одно його знайде
    end;
  end if;

  return query
    select m.id, m.template_id, m.name, m.is_free, m.deposit_usd, m.return_multiplier,
           m.duration_days, m.started_at, m.accrued_active_ms, m.active_since, m.claimed_usd, m.is_active
    from public.user_miners m
    where m.user_id = v_user_id and m.is_free = true;
end;
$$;

revoke all on function public.ensure_free_miner(text) from public, anon, authenticated;
grant execute on function public.ensure_free_miner(text) to anon, authenticated;

-- ============================================================================
-- set_free_miner_active — server-side пауза/відновлення free-майнера,
-- викликається клієнтом услід за РЕАЛЬНИМ статусом підписки
-- (checkSubscription). Той самий принцип, що pauseMiner/resumeMiner у
-- src/lib/mining.ts, але тепер джерело правди — сервер, не React-стан,
-- що зникає при розмонтуванні компонента.
-- ============================================================================
create or replace function public.set_free_miner_active(p_init_data text, p_active boolean)
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
  v_miner public.user_miners%rowtype;
  v_duration_ms numeric;
  v_effective_ms numeric;
begin
  select v.telegram_id into v_telegram_id from public.verify_telegram_init_data(p_init_data) v;
  select u.id into v_user_id from public.users u where u.telegram_id = v_telegram_id;

  if v_user_id is null then
    raise exception 'user_not_found';
  end if;

  select * into v_miner
  from public.user_miners m
  where m.user_id = v_user_id and m.is_free = true
  for update;

  if v_miner.id is null then
    raise exception 'free_miner_not_found';
  end if;

  v_duration_ms := v_miner.duration_days::numeric * 86400000;

  if p_active then
    if v_miner.active_since is null and v_miner.accrued_active_ms < v_duration_ms then
      update public.user_miners m
      set active_since = now(), is_active = true
      where m.id = v_miner.id;
    end if;
  else
    if v_miner.active_since is not null then
      v_effective_ms := least(
        v_miner.accrued_active_ms + extract(epoch from (now() - v_miner.active_since)) * 1000,
        v_duration_ms
      );
      update public.user_miners m
      set accrued_active_ms = v_effective_ms::bigint, active_since = null, is_active = false
      where m.id = v_miner.id;
    end if;
  end if;

  return query
    select m.id, m.template_id, m.name, m.is_free, m.deposit_usd, m.return_multiplier,
           m.duration_days, m.started_at, m.accrued_active_ms, m.active_since, m.claimed_usd, m.is_active
    from public.user_miners m
    where m.id = v_miner.id;
end;
$$;

revoke all on function public.set_free_miner_active(text, boolean) from public, anon, authenticated;
grant execute on function public.set_free_miner_active(text, boolean) to anon, authenticated;
