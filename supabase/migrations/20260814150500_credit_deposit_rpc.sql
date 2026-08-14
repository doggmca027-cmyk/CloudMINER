-- CloudMiner HYIP — атомарне зарахування депозиту.
--
-- Викликається ВИКЛЮЧНО Edge Functions check-ton-deposits / check-tron-deposits
-- через service_role-ключ (ніколи з клієнта!). Ця функція довіряє
-- p_amount_usd/p_tx_hash як вхідним даним — саму перевірку "чи ця
-- транзакція справді існує в блокчейні на таку суму" робить викликач
-- (Edge Function, звертаючись до TonAPI/TronGrid), а не ця функція. Тому
-- EXECUTE на неї не надається anon/authenticated — якби надавався, будь-хто
-- міг би зарахувати собі баланс, просто вигадавши tx_hash.
--
-- Ідемпотентність: захист від подвійного зарахування того самого платежу
-- не "SELECT exists, потім INSERT" (це має TOCTOU-гонку між паралельними
-- викликами), а унікальний індекс на tx_hash + `ON CONFLICT DO NOTHING` —
-- атомарно на рівні Postgres, тож навіть два одночасні виклики з однаковим
-- tx_hash гарантовано зарахують суму лише один раз.
--
-- Індекс transactions_tx_hash_key частковий (WHERE tx_hash IS NOT NULL),
-- тому arbiter-вираз ON CONFLICT нижче повторює той самий предикат —
-- голий "ON CONFLICT (tx_hash)" його не бачить і падає з
-- "no unique or exclusion constraint matching the ON CONFLICT specification".

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
  v_min_deposit constant numeric := 5;   -- тримати синхронізовано з MIN_DEPOSIT_USD у src/lib/deposits.ts
  v_user_id uuid;
  v_new_id uuid;
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
    -- не чіпаємо.
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
    -- Рядок з таким tx_hash вже існував — цей платіж уже зараховано раніше.
    return query
      select null::uuid, false, (select u.balance_usd from public.users u where u.id = v_user_id);
    return;
  end if;

  update public.users
  set balance_usd = balance_usd + p_amount_usd, updated_at = now()
  where id = v_user_id;

  return query
    select v_new_id, true, (select u.balance_usd from public.users u where u.id = v_user_id);
end;
$$;

-- ВАЖЛИВО: Supabase має ALTER DEFAULT PRIVILEGES на схему public, який
-- автоматично видає EXECUTE на anon/authenticated для кожної НОВОЇ функції
-- в момент її створення. "REVOKE ALL ... FROM PUBLIC" знімає право лише з
-- псевдо-ролі PUBLIC і НЕ чіпає ці окремі гранти — тож anon/authenticated
-- треба відкликати явно поіменно, інакше anon-ключ зможе викликати цю
-- функцію і зарахувати собі баланс, просто вигадавши tx_hash.
revoke all on function public.credit_deposit(bigint, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.credit_deposit(bigint, text, numeric, text, text, text) to service_role;
