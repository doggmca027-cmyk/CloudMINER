-- CloudMiner HYIP — розсилка адміном усім гравцям, що запускали бота.
--
-- Перевикористовує вже наявну інфраструктуру `notification_queue` +
-- Edge Function `send-notifications` (Bot API sendMessage) — та сама
-- черга, куди вже пишуть admin_issue_deposit/admin_resolve_withdrawal
-- тощо, лише додаємо опційний `photo_url` (якщо задано, send-notifications
-- відправляє sendPhoto з текстом як підпис, інакше — звичайний sendMessage).

alter table public.notification_queue
  add column if not exists photo_url text;

-- admin_user_count -----------------------------------------------------------
-- Кількість гравців, яким піде розсилка — для UI (показати "N гравців"
-- перед підтвердженням, це маловідворотна масова дія).
create or replace function public.admin_user_count(p_admin_init_data text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  return (select count(*)::integer from public.users);
end;
$$;

revoke all on function public.admin_user_count(text) from public, anon, authenticated;
grant execute on function public.admin_user_count(text) to anon, authenticated;

-- admin_broadcast_message ------------------------------------------------------
-- Ставить в чергу одне повідомлення на КОЖНОГО користувача з `users`
-- (= кожен, хто хоч раз відкрив застосунок через бота — саме так рядок у
-- `users` і з'являється, через get_or_create_user). Повертає кількість
-- поставлених у чергу повідомлень. Реальна відправка — Edge Function
-- send-notifications, за розкладом (батчами по 50, як і решта черги).
create or replace function public.admin_broadcast_message(
  p_admin_init_data text,
  p_text text,
  p_photo_url text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
  v_count integer;
begin
  select telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data);
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  if coalesce(trim(p_text), '') = '' then
    raise exception 'text_required';
  end if;

  insert into public.notification_queue (telegram_id, message, photo_url)
  select u.telegram_id, p_text, nullif(trim(p_photo_url), '')
  from public.users u;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_broadcast_message(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_broadcast_message(text, text, text) to anon, authenticated;
