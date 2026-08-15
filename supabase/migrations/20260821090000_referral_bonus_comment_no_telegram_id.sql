-- CloudMiner HYIP — прибирає telegram_id депозитора з коментаря
-- реферального бонусу.
--
-- Раніше `credit_deposit` писав у transactions.comment СПРАВЖНІЙ
-- telegram_id того, хто зробив депозит — напр. "Уровень 1 (10%) от
-- депозита пользователя 123456789". Це поки НІДЕ не показувалось
-- звичайним користувачам (в застосунку немає екрана "історія
-- транзакцій" для гравця, лише в адмінці), тож активної витоку не було —
-- але якщо такий екран колись з'явиться і покаже `comment` як є,
-- маскування імені в get_referral_list (masked_name, "Inv***") втратило
-- б сенс: справжній ID приглашённого був би видний прямим текстом у
-- власній транзакції реферера. Прибираємо ідентифікатор із коментаря
-- заздалегідь — рівень і ставка лишаються, самого telegram_id більше
-- немає.
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
