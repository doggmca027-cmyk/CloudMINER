-- CloudMiner HYIP — автовиплата виводів після підтвердження в адмінці.
--
-- Раніше "Подтвердить" в WithdrawalsSection просто позначала заявку
-- completed — реальний переказ адмін робив руками десь поза застосунком.
-- Тепер підтвердження в адмінці має РЕАЛЬНО відправити крипту з гарячого
-- гаманця проєкту (Edge Function `process-withdrawal`, бо тільки в неї є
-- доступ до приватного ключа/мнемоніки — ніколи в браузер чи SQL).
--
-- Баланс користувача вже списаний у момент подачі заявки (request_withdrawal
-- в 20260815091000_admin_panel.sql) — тому цей файл лише розбиває "approve"
-- на два безпечні кроки замість одного:
--
--   pending --[admin тисне "Подтвердить"]--> processing --[переказ пройшов]--> completed
--                                                        \-[переказ НЕ пройшов]-> failed (баланс повертається)
--
-- 'processing' блокує рядок так само, як completed/rejected раніше — жодна
-- інша дія (повторний approve, reject, паралельний виклик) більше не може
-- його зачепити, поки Edge Function не завершить спробу переказу. Якщо
-- Edge Function впаде МІЖ переказом і викликом admin_mark_withdrawal_completed
-- (напр. тайм-аут мережі вже ПІСЛЯ того, як крипта пішла) — заявка застрягне
-- в 'processing' без автоматичного повторного списання (не буде подвійної
-- виплати), але й без автоповернення балансу — це свідомий компроміс:
-- дублювати виплату небезпечніше, ніж лишити заявку "в польоті" на ручну
-- звірку адміном за хешем транзакції гаманця.

-- admin_mark_withdrawal_processing -------------------------------------------
-- Перший крок: блокує заявку, переводить pending -> processing, повертає всі
-- дані, потрібні Edge Function для самого переказу.
create or replace function public.admin_mark_withdrawal_processing(
  p_admin_telegram_id bigint,
  p_transaction_id uuid
)
returns table (
  amount_usd numeric,
  fee_usd numeric,
  network text,
  wallet_address text,
  telegram_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_current_status transaction_status;
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  select t.user_id, t.status
  into v_user_id, v_current_status
  from public.transactions t
  where t.id = p_transaction_id and t.type = 'withdrawal'
  for update of t;

  if v_user_id is null then
    raise exception 'withdrawal_not_found';
  end if;

  if v_current_status <> 'pending' then
    raise exception 'withdrawal_already_resolved';
  end if;

  update public.transactions t
  set status = 'processing'
  where t.id = p_transaction_id;

  return query
    select t.amount_usd, t.fee_usd, t.network, t.wallet_address, u.telegram_id
    from public.transactions t
    join public.users u on u.id = t.user_id
    where t.id = p_transaction_id;
end;
$$;

-- Тільки service_role (Edge Function process-withdrawal) — НЕ anon/authenticated:
-- на відміну від інших admin_* RPC, цей крок не завершує заявку сам собою
-- (переводить лише в проміжний 'processing'), тож прямий виклик з браузера
-- міг би "підвісити" заявку без фактичної відправки грошей і без автоматичного
-- повернення балансу.
revoke all on function public.admin_mark_withdrawal_processing(bigint, uuid) from public, anon, authenticated;
grant execute on function public.admin_mark_withdrawal_processing(bigint, uuid) to service_role;

-- admin_mark_withdrawal_completed --------------------------------------------
-- Другий крок (успіх): переказ підтверджено мережею, фіксуємо tx_hash.
create or replace function public.admin_mark_withdrawal_completed(
  p_admin_telegram_id bigint,
  p_transaction_id uuid,
  p_tx_hash text
)
returns table (id uuid, status transaction_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_telegram_id bigint;
  v_amount numeric;
  v_net_amount numeric;
  v_current_status transaction_status;
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  select t.user_id, t.amount_usd, t.amount_usd - t.fee_usd, t.status, u.telegram_id
  into v_user_id, v_amount, v_net_amount, v_current_status, v_telegram_id
  from public.transactions t
  join public.users u on u.id = t.user_id
  where t.id = p_transaction_id and t.type = 'withdrawal'
  for update of t;

  if v_user_id is null then
    raise exception 'withdrawal_not_found';
  end if;

  if v_current_status <> 'processing' then
    raise exception 'withdrawal_not_processing';
  end if;

  update public.transactions t
  set status = 'completed', processed_at = now(), tx_hash = p_tx_hash
  where t.id = p_transaction_id;

  insert into public.notification_queue (telegram_id, message)
  values (
    v_telegram_id,
    '✅ Ваша заявка на вывод ' || v_amount::text || ' USDT подтверждена. Отправлено: ' ||
    v_net_amount::text || ' USDT. Хеш транзакции: ' || p_tx_hash
  );

  return query select t.id, t.status from public.transactions t where t.id = p_transaction_id;
end;
$$;

revoke all on function public.admin_mark_withdrawal_completed(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mark_withdrawal_completed(bigint, uuid, text) to service_role;

-- admin_mark_withdrawal_failed ------------------------------------------------
-- Другий крок (невдача): мережа відхилила переказ / RPC блокчейну впав до
-- фактичної відправки — повертаємо повну суму на баланс, так само, як при
-- звичайному відхиленні заявки.
create or replace function public.admin_mark_withdrawal_failed(
  p_admin_telegram_id bigint,
  p_transaction_id uuid,
  p_error text
)
returns table (id uuid, status transaction_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_telegram_id bigint;
  v_amount numeric;
  v_current_status transaction_status;
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  select t.user_id, t.amount_usd, t.status, u.telegram_id
  into v_user_id, v_amount, v_current_status, v_telegram_id
  from public.transactions t
  join public.users u on u.id = t.user_id
  where t.id = p_transaction_id and t.type = 'withdrawal'
  for update of t;

  if v_user_id is null then
    raise exception 'withdrawal_not_found';
  end if;

  if v_current_status <> 'processing' then
    raise exception 'withdrawal_not_processing';
  end if;

  update public.transactions t
  set status = 'failed', processed_at = now(),
      comment = coalesce(t.comment, '') || ' | Автовыплата не прошла: ' || coalesce(nullif(trim(p_error), ''), 'неизвестная ошибка')
  where t.id = p_transaction_id;

  update public.users u set balance_usd = u.balance_usd + v_amount, updated_at = now() where u.id = v_user_id;

  insert into public.notification_queue (telegram_id, message)
  values (
    v_telegram_id,
    '⚠️ Не удалось автоматически отправить вывод ' || v_amount::text || ' USDT. Средства возвращены на баланс, администратор проверит заявку.'
  );

  return query select t.id, t.status from public.transactions t where t.id = p_transaction_id;
end;
$$;

revoke all on function public.admin_mark_withdrawal_failed(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mark_withdrawal_failed(bigint, uuid, text) to service_role;

-- admin_resolve_withdrawal: більше не приймає p_approve = true -----------
-- Підтвердження тепер завжди йде через admin_mark_withdrawal_processing +
-- Edge Function process-withdrawal (реальна відправка крипти) — пряме
-- "approve=true" через цю функцію більше НЕ позначає заявку completed без
-- фактичного переказу, щоб клієнт (чи старий кеш фронтенду) не міг
-- випадково "підтвердити" вивід, так і не відправивши гроші.
-- Відхилення (approve=false) без змін — воно ніколи не чіпало блокчейн.
create or replace function public.admin_resolve_withdrawal(
  p_admin_telegram_id bigint,
  p_transaction_id uuid,
  p_approve boolean,
  p_rejection_reason text default null
)
returns table (id uuid, status transaction_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_telegram_id bigint;
  v_amount numeric;
  v_current_status transaction_status;
begin
  if not public.is_admin_telegram_id(p_admin_telegram_id) then
    raise exception 'not_admin';
  end if;

  if p_approve then
    raise exception 'use_process_withdrawal_function';
  end if;

  select t.user_id, t.amount_usd, t.status, u.telegram_id
  into v_user_id, v_amount, v_current_status, v_telegram_id
  from public.transactions t
  join public.users u on u.id = t.user_id
  where t.id = p_transaction_id and t.type = 'withdrawal'
  for update of t;

  if v_user_id is null then
    raise exception 'withdrawal_not_found';
  end if;

  if v_current_status <> 'pending' then
    raise exception 'withdrawal_already_resolved';
  end if;

  update public.transactions t
  set status = 'rejected', processed_at = now(),
      comment = coalesce(t.comment, '') || ' | Отклонено: ' ||
                coalesce(nullif(trim(p_rejection_reason), ''), 'без указания причины')
  where t.id = p_transaction_id;

  -- Повертаємо повну суму назад — вона була списана в момент подачі заявки.
  update public.users u set balance_usd = u.balance_usd + v_amount, updated_at = now() where u.id = v_user_id;

  insert into public.notification_queue (telegram_id, message)
  values (
    v_telegram_id,
    '❌ Ваша заявка на вывод ' || v_amount::text || ' USDT отклонена. Причина: ' ||
    coalesce(nullif(trim(p_rejection_reason), ''), 'не указана') || '. Средства возвращены на баланс.'
  );

  return query select t.id, t.status from public.transactions t where t.id = p_transaction_id;
end;
$$;

revoke all on function public.admin_resolve_withdrawal(bigint, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_resolve_withdrawal(bigint, uuid, boolean, text) to anon, authenticated;

-- admin_list_pending_withdrawals: адмінка більше не повинна показувати
-- заявки, які вже 'processing' (переказ у польоті — щоб адмін не тиснув
-- "Подтвердить" ще раз, поки попередній виклик не завершився).
-- WHERE t.status = 'pending' лишається без змін (processing вже й так
-- виключено, це не потребує редагування функції) — коментар для наступного
-- читача, чому окремого запиту сюди не додано.
