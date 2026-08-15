-- CloudMiner HYIP — claim_task_reward тепер ЛИШЕ для verification_type='click'.
-- 'subscription'-завдання йдуть через check-subscription +
-- check-subscription-retention (24h утримання) — без цього обмеження
-- клієнт міг би викликати claim_task_reward напряму для
-- subscription-завдання й забрати нагороду, жодного разу не пройшовши
-- реальну перевірку Bot API.
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
  v_verification_type text;
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

  select t.reward_usd, t.verification_type into v_reward, v_verification_type
  from public.tasks t
  where t.id = p_task_id and t.is_active = true;

  if v_reward is null then
    raise exception 'task_not_found';
  end if;

  if v_verification_type = 'subscription' then
    raise exception 'use_subscription_check_flow';
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
