-- CloudMiner HYIP — той самий клас бага, що й claim_miner_income
-- (20260821130000), тепер знайдений і виправлений одразу в УСІХ RPC, де
-- він реально трапляється.
--
-- Причина: `returns table (telegram_id bigint, ...)` неявно оголошує
-- PL/pgSQL-змінну `telegram_id` у скоупі всієї функції. Усередині ці
-- функції робили `select telegram_id into v_admin_id from
-- public.verify_telegram_init_data(...)` — БЕЗ аліаса на джерелі, тож
-- Postgres не міг вирішити, чи `telegram_id` тут — власна OUT-змінна
-- функції, чи стовпець, який повертає verify_telegram_init_data.
-- Помилка (42702 "column reference is ambiguous") траплялась
-- ГАРАНТОВАНО при КОЖНОМУ виклику — підтверджено живими RPC-викликами
-- для всіх трьох:
--   • admin_list_pending_withdrawals — тому створені заявки на вивід
--     ніколи не з'являлись в адмінці для підтвердження;
--   • admin_list_ambassadors — список амбасадорів в адмінці;
--   • admin_set_ambassador — призначення/зняття амбасадора.
--
-- Знайдено systematic-скануванням pg_proc: серед УСІХ 21 функцій, що
-- викликають verify_telegram_init_data, рівно ці три мають "telegram_id"
-- у власному returns table (get_or_create_user теж повертає telegram_id,
-- але вже коректно використовує аліас `v.telegram_id` — саме тому й не
-- падала).
--
-- Фікс: аліас `v` на джерелі + кваліфікований `v.telegram_id` — той
-- самий безпечний патерн, що вже в get_or_create_user.

create or replace function public.admin_list_pending_withdrawals(p_admin_init_data text)
returns table (
  transaction_id uuid,
  telegram_id bigint,
  username text,
  first_name text,
  amount_usd numeric,
  fee_usd numeric,
  network text,
  wallet_address text,
  requested_at timestamptz,
  user_total_deposited_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select v.telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data) v;
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  return query
    with deposits as (
      select t.user_id, sum(t.amount_usd) as total
      from public.transactions t
      where t.type = 'deposit' and t.status = 'completed'
      group by t.user_id
    )
    select
      t.id, u.telegram_id, u.username, u.first_name,
      t.amount_usd, t.fee_usd, t.network, t.wallet_address, t.created_at,
      coalesce(d.total, 0)
    from public.transactions t
    join public.users u on u.id = t.user_id
    left join deposits d on d.user_id = u.id
    where t.type = 'withdrawal' and t.status = 'pending'
    order by t.created_at asc;
end;
$$;

create or replace function public.admin_list_ambassadors(p_admin_init_data text)
returns table (
  telegram_id bigint,
  username text,
  first_name text,
  level1_count bigint,
  level2_count bigint,
  level3_count bigint,
  total_deposited_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select v.telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data) v;
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  return query
    with ambassadors as (
      select u.id, u.telegram_id, u.username, u.first_name
      from public.users u
      where u.is_ambassador = true
    ),
    l1 as (
      select a.telegram_id as amb_tg, u.id from ambassadors a join public.users u on u.referred_by = a.id
    ),
    l2 as (
      select l1.amb_tg, u.id from l1 join public.users u on u.referred_by = l1.id
    ),
    l3 as (
      select l2.amb_tg, u.id from l2 join public.users u on u.referred_by = l2.id
    ),
    deposits as (
      select t.user_id, sum(t.amount_usd) as total
      from public.transactions t
      where t.type = 'deposit' and t.status = 'completed'
      group by t.user_id
    )
    select
      a.telegram_id,
      a.username,
      a.first_name,
      (select count(*) from l1 where l1.amb_tg = a.telegram_id)::bigint,
      (select count(*) from l2 where l2.amb_tg = a.telegram_id)::bigint,
      (select count(*) from l3 where l3.amb_tg = a.telegram_id)::bigint,
      coalesce((
        select sum(d.total) from deposits d
        where d.user_id in (
          select id from l1 where l1.amb_tg = a.telegram_id
          union all select id from l2 where l2.amb_tg = a.telegram_id
          union all select id from l3 where l3.amb_tg = a.telegram_id
        )
      ), 0)
    from ambassadors a
    order by a.telegram_id;
end;
$$;

create or replace function public.admin_set_ambassador(
  p_admin_init_data text,
  p_target_telegram_id bigint,
  p_is_ambassador boolean
)
returns table (telegram_id bigint, is_ambassador boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id bigint;
begin
  select v.telegram_id into v_admin_id from public.verify_telegram_init_data(p_admin_init_data) v;
  if not public.is_admin_telegram_id(v_admin_id) then
    raise exception 'not_admin';
  end if;

  update public.users u
  set is_ambassador = p_is_ambassador, updated_at = now()
  where u.telegram_id = p_target_telegram_id;

  if not found then
    raise exception 'user_not_found';
  end if;

  return query
    select u.telegram_id, u.is_ambassador from public.users u where u.telegram_id = p_target_telegram_id;
end;
$$;
