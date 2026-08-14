-- CloudMiner HYIP — "наміри депозиту" для мережі TRC-20.
--
-- TON-перекази несуть вільний текстовий comment/memo — туди кладеться
-- telegram_id, і check-ton-deposits прив'язує депозит до користувача
-- напряму. USDT-перекази в мережі TRC-20 (Tron) — це виклики контракту
-- (TRC-20 Transfer), а не звичайні перекази, і НЕ мають довільного
-- текстового memo. Тобто check-tron-deposits в принципі не може прочитати
-- telegram_id із самого вхідного платежу.
--
-- Стандартне рішення для рейлів без memo (те саме, що банківські перекази
-- без призначення платежу): просимо користувача надіслати НЕ круглу суму,
-- а суму з унікальним "хвостом" у 6-му знаку після коми, яку заздалегідь
-- зареєстрував клієнт. check-tron-deposits зіставляє вхідний платіж із
-- pending-наміром за точною сумою.

create table public.deposit_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  network text not null default 'TRC20' check (network = 'TRC20'),
  expected_amount_usd numeric(18, 6) not null check (expected_amount_usd > 0),
  status text not null default 'pending' check (status in ('pending', 'matched', 'expired')),
  matched_transaction_id uuid references public.transactions (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours')
);

create index deposit_intents_lookup_idx
  on public.deposit_intents (network, status, expected_amount_usd);
create index deposit_intents_user_id_idx on public.deposit_intents (user_id);

-- Унікальність лише серед АКТИВНИХ намірів для однієї мережі — після
-- matched/expired та сама сума знову може використовуватись.
create unique index deposit_intents_pending_amount_key
  on public.deposit_intents (network, expected_amount_usd)
  where status = 'pending';

alter table public.deposit_intents enable row level security;
-- Без публічних політик — доступ лише через RPC нижче (anon) і
-- check-tron-deposits (service_role, напряму бачить усе як власник функцій).

-- create_deposit_intent ---------------------------------------------------
-- Викликається з клієнта (DepositPanel) перед показом адреси для TRC-20:
-- повертає ТОЧНУ суму, яку користувач має надіслати. Безпечно доступна
-- anon — вона лише створює запис-очікування, не чіпає нічий баланс.
create or replace function public.create_deposit_intent(
  p_telegram_id bigint,
  p_first_name text,
  p_base_amount_usd numeric
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

  -- Прострочені попередні наміри цього користувача більше не заважають.
  -- (Аліас di + di.expires_at обов'язкові: RETURNS TABLE нижче оголошує
  -- OUT-параметр expires_at, і голе посилання ловить "ambiguous column".)
  update public.deposit_intents di
  set status = 'expired'
  where di.user_id = v_user_id and di.status = 'pending' and di.expires_at < now();

  loop
    v_attempt := v_attempt + 1;
    -- Унікальний "хвіст" у 6-му знаку (0.000001–0.000999 USDT) — з точністю
    -- USDT це не помітно, але дозволяє відрізнити платіж від інших.
    v_exact_amount := round(p_base_amount_usd, 2) + (floor(random() * 999) + 1) / 1000000.0;

    begin
      insert into public.deposit_intents (user_id, network, expected_amount_usd)
      values (v_user_id, 'TRC20', v_exact_amount)
      returning id into v_intent_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'could_not_generate_unique_amount';
      end if;
      -- колізія суми серед активних намірів — пробуємо ще раз з новим хвостом
    end;
  end loop;

  return query
    select v_intent_id, v_exact_amount, di.expires_at
    from public.deposit_intents di
    where di.id = v_intent_id;
end;
$$;

revoke all on function public.create_deposit_intent(bigint, text, numeric) from public, anon, authenticated;
grant execute on function public.create_deposit_intent(bigint, text, numeric) to anon, authenticated;
