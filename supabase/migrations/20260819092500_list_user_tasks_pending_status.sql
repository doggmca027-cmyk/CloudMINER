-- CloudMiner HYIP — list_user_tasks: додає статус 'pending' для завдань,
-- де вже зареєстрована перевірка утримання підписки (subscription_checks,
-- 24h), але нагороду ще не видано — щоб TasksTab не пропонував "Перевірити"
-- ще раз, поки попередня перевірка не відпрацювала.
create or replace function public.list_user_tasks(p_init_data text)
returns table (
  id uuid,
  type text,
  title text,
  description text,
  icon_url text,
  reward_usd numeric,
  reward_coin numeric,
  action_url text,
  verification_type text,
  is_active boolean,
  sort_order integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
  v_user_id uuid;
begin
  select telegram_id into v_telegram_id from public.verify_telegram_init_data(p_init_data);
  select u.id into v_user_id from public.users u where u.telegram_id = v_telegram_id;

  return query
    select
      t.id, t.type::text, t.title, t.description, t.icon_url, t.reward_usd, t.reward_coin,
      t.action_url, t.verification_type, t.is_active, t.sort_order,
      case
        when ut.status = 'claimed' then 'claimed'
        when exists (
          select 1 from public.subscription_checks sc
          where sc.user_id = v_user_id and sc.target_key = 'task:' || t.id::text and sc.status = 'pending'
        ) then 'pending'
        else 'available'
      end
    from public.tasks t
    left join public.user_tasks ut on ut.task_id = t.id and ut.user_id = v_user_id
    where t.is_active = true
    order by t.sort_order, t.id;
end;
$$;
