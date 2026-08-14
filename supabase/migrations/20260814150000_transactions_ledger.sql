-- CloudMiner HYIP — уніфікований журнал транзакцій (depозити + виводи) і
-- нові бізнес-правила: мінімальний депозит 5 USDT, мінімальний вивід
-- 2 USDT, і "deposit lock" — вивід недоступний, доки не буде хоча б одного
-- завершеного депозиту.
--
-- Таблиця `withdrawals` з попередньої міграції видаляється: обидва типи
-- операцій (депозит/вивід) тепер живуть в одній таблиці `transactions` з
-- полем `type`, як і потрібно для перевірки deposit-lock
-- (`type = 'deposit' and status = 'completed'`). Проєкт ще не в проді й
-- реальних рядків у `withdrawals` немає, тож видалення безпечне.

-- Стара request_withdrawal повертає withdrawal_status — прибираємо її перед
-- дропом типу, інакше "cannot drop type ... because other objects depend on it".
drop function if exists public.request_withdrawal(bigint, text, numeric, text, text);
drop table if exists public.withdrawals;
drop type if exists withdrawal_status;

create type transaction_type as enum ('deposit', 'withdrawal');
create type transaction_status as enum ('pending', 'completed', 'failed', 'rejected');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type transaction_type not null,
  /** Мережа переказу: 'TON' | 'TRC20'. Null для операцій без мережі (напр. майбутні внутрішні коригування). */
  network text,
  amount_usd numeric(18, 6) not null check (amount_usd > 0),
  fee_usd numeric(18, 6) not null default 0 check (fee_usd >= 0),
  currency currency_code not null default 'USDT',
  /** Депозит: адреса відправника. Вивід: адреса отримувача. */
  wallet_address text,
  /** Хеш транзакції в блокчейні. Унікальний — головний захист від подвійного зарахування депозитів. */
  tx_hash text,
  status transaction_status not null default 'pending',
  comment text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Частковий унікальний індекс: tx_hash обов'язково унікальний, коли він є
-- (депозити), але не заважає багатьом заявкам на вивід мати tx_hash = null.
create unique index transactions_tx_hash_key on public.transactions (tx_hash) where tx_hash is not null;
create index transactions_user_id_idx on public.transactions (user_id);
create index transactions_type_status_idx on public.transactions (type, status);

alter table public.transactions enable row level security;
-- Жодних публічних політик: усі операції з журналом ідуть тільки через
-- SECURITY DEFINER RPC (request_withdrawal, credit_deposit) нижче.

-- request_withdrawal ---------------------------------------------------
-- Оновлена версія: мінімальна сума 2 USDT (було 10) і нова перевірка
-- "deposit lock" — вивід дозволений лише за наявності хоча б одного
-- завершеного депозиту (`transactions` де type='deposit' і status='completed').
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
  v_min_amount constant numeric := 2;    -- тримати синхронізовано з MIN_WITHDRAWAL_USD у src/lib/withdrawals.ts
  v_fee_rate constant numeric := 0.05;   -- тримати синхронізовано з WITHDRAWAL_FEE_RATE
  v_user_id uuid;
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

  -- Отримати наявного користувача за telegram_id або створити нового.
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

revoke all on function public.request_withdrawal(bigint, text, numeric, text, text) from public;
grant execute on function public.request_withdrawal(bigint, text, numeric, text, text) to anon, authenticated;
