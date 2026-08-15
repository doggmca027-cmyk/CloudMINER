-- CloudMiner HYIP — реальний чекер підписок з 24-годинним утриманням.
--
-- ДОСІ "перевірка підписки" (checkSubscription/verifyTaskSubscription)
-- викликала Edge Function `check-subscription`, якої не існувало —
-- клієнт завжди падав у безпечний фолбек (false у проді, локальна
-- заглушка в DEV). Ані обов'язкова підписка (канал/чат), ані партнерські
-- завдання з verification_type='subscription' ніколи не перевірялись
-- реальним Telegram Bot API, і нагорода за завдання видавалась одразу
-- після "підтвердження", без жодного захисту від
-- підписався-забрав-нагороду-відписався.
--
-- Тепер: `subscription_checks` — черга "перевірити ще раз через 24
-- години". Edge Function `check-subscription` (див. відповідний каталог)
-- при першій успішній перевірці РЕАЛЬНИМ Telegram Bot API
-- (getChatMember) ставить сюди pending-запис замість негайної виплати.
-- Друга Edge Function `check-subscription-retention`, за розкладом,
-- через 24 години перевіряє ще раз і видає нагороду ЛИШЕ якщо
-- користувач і досі підписаний.

alter type transaction_type add value if not exists 'subscription_reward';

create table public.subscription_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- 'mandatory:channel' | 'mandatory:chat' | 'mandatory:tx' | 'task:<tasks.id>'
  target_key text not null,
  -- @username чи chat_id, як цього вимагає Telegram Bot API getChatMember
  -- (НЕ повне https://t.me/... посилання).
  chat_ref text not null,
  reward_usd numeric(18, 6) not null check (reward_usd >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'rewarded', 'failed_unsubscribed', 'failed_error')),
  created_at timestamptz not null default now(),
  check_after timestamptz not null,
  checked_at timestamptz
);

-- Не більше одного АКТИВНОГО pending-запису на пару (користувач, ціль) —
-- повторний успішний "Перевірити" на той самий канал/завдання, поки
-- попередня перевірка ще не відпрацювала, нічого не дублює.
create unique index subscription_checks_pending_unique
  on public.subscription_checks (user_id, target_key)
  where status = 'pending';

create index subscription_checks_due_idx
  on public.subscription_checks (check_after)
  where status = 'pending';

alter table public.subscription_checks enable row level security;
-- Без публічних політик: пише лише service_role (обидві Edge Functions
-- напряму, той самий довірений контекст, що й notification_queue).

-- grant_subscription_reward -------------------------------------------------
-- Викликається ЛИШЕ з check-subscription-retention (service_role), ПІСЛЯ
-- того, як Bot API підтвердив, що користувач і через 24 години все ще
-- підписаний. Атомарно: позначає перевірку виконаною, нараховує баланс,
-- пише в journal — той самий патерн, що й admin_mark_withdrawal_completed.
create or replace function public.grant_subscription_reward(p_check_id uuid)
returns table (user_id uuid, reward_usd numeric, new_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_reward numeric;
  v_target_key text;
  v_status text;
begin
  select sc.user_id, sc.reward_usd, sc.target_key, sc.status
  into v_user_id, v_reward, v_target_key, v_status
  from public.subscription_checks sc
  where sc.id = p_check_id
  for update;

  if v_user_id is null then
    raise exception 'subscription_check_not_found';
  end if;

  if v_status <> 'pending' then
    raise exception 'subscription_check_already_resolved';
  end if;

  update public.subscription_checks
  set status = 'rewarded', checked_at = now()
  where id = p_check_id;

  if v_reward > 0 then
    update public.users u set balance_usd = u.balance_usd + v_reward, updated_at = now() where u.id = v_user_id;

    insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
    values (v_user_id, 'subscription_reward', v_reward, 'USDT', 'completed',
            'Награда за удержание подписки 24ч (' || v_target_key || ')', now());
  end if;

  return query select v_user_id, v_reward, u.balance_usd from public.users u where u.id = v_user_id;
end;
$$;

revoke all on function public.grant_subscription_reward(uuid) from public, anon, authenticated;
grant execute on function public.grant_subscription_reward(uuid) to service_role;
