-- CloudMiner HYIP — прибрано обов'язкову підписку на канал/канал
-- транзакцій як умову активності free-майнера (за прямим запитом).
--
-- ensure_free_miner тепер створює рядок одразу АКТИВНИМ (active_since =
-- now(), is_active = true) — раніше create-код лишав його на паузі
-- (active_since = null, is_active = false), і активація/деактивація
-- йшла окремим викликом set_free_miner_active услід за клієнтською
-- перевіркою підписки. Ця перевірка більше ніде не викликається (див.
-- видалення FreeMinerCard/мандаторної секції TasksTab на клієнті) —
-- set_free_miner_active сам по собі НЕ видаляється (лишається робочим
-- будівельним блоком, напр. для майбутньої адмінської "заморозки"),
-- просто нічого його з клієнта більше не викликає.
--
-- Backfill: усі ІСНУЮЧІ free-майнери, які досі на паузі (юзер ще не
-- встиг підписатись/перевірити до цієї зміни) — активуються одразу тут
-- же, а не лише для нових рядків, створених після цієї міграції.

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

  -- Той самий безпечний патерн, що й раніше (НЕ `on conflict ... where
  -- is_free` — та сама неоднозначність, що з claim_miner_income/admin_*,
  -- див. 20260821150000).
  if not exists (
    select 1 from public.user_miners m where m.user_id = v_user_id and m.is_free = true
  ) then
    begin
      insert into public.user_miners
        (user_id, template_id, name, is_free, deposit_usd, return_multiplier, duration_days,
         started_at, accrued_active_ms, active_since, claimed_usd, is_active)
      values (
        v_user_id, null, 'Free Miner', true, v_free_deposit_usd, v_free_return_multiplier,
        v_free_duration_days, now(), 0, now(), 0, true
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

-- Backfill: активуємо ІСНУЮЧІ free-майнери, що досі на паузі й ще не
-- відпрацювали повний строк.
update public.user_miners m
set active_since = now(), is_active = true
where m.is_free = true
  and m.is_active = false
  and m.accrued_active_ms < (m.duration_days::numeric * 86400000);
