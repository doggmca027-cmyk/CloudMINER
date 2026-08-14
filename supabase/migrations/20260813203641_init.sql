-- CloudMiner HYIP — початкова схема БД.
-- Відповідає доменним типам у src/types/index.ts (User, MinerTemplate,
-- UserMiner, Task, Withdrawal). Модель нарахувань — 10 днів / 150%,
-- див. src/lib/mining.ts.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

create type currency_code as enum ('USD', 'USDT', 'COIN');
create type withdrawal_status as enum ('pending', 'approved', 'rejected', 'completed');
create type task_type as enum ('daily', 'partner', 'special');
create type user_task_status as enum ('available', 'in_progress', 'completed', 'claimed');

-- users ---------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null,
  last_name text,
  photo_url text,
  language_code text not null default 'en',
  balance_usd numeric(18, 6) not null default 0 check (balance_usd >= 0),
  balance_coin numeric(18, 6) not null default 0 check (balance_coin >= 0),
  total_income numeric(18, 6) not null default 0 check (total_income >= 0),
  is_vip boolean not null default false,
  referral_code text not null unique,
  referred_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_referred_by_idx on public.users (referred_by);

-- miner_templates -------------------------------------------------------
-- Каталог паків (ShopTab). Відповідає src/lib/catalog.ts.
create table public.miner_templates (
  id text primary key,
  name text not null,
  description text not null default '',
  image_url text not null default '',
  deposit_usd numeric(18, 6) not null check (deposit_usd > 0),
  return_multiplier numeric(6, 4) not null check (return_multiplier > 1),
  duration_days integer not null check (duration_days > 0),
  is_vip boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

-- user_miners -------------------------------------------------------------
-- Придбані (або видані безкоштовно) екземпляри майнерів.
-- accrued_active_ms / active_since — дозволяють ставити майнер на паузу
-- (напр. free-майнер без підписки на канал/чат) без втрати прогресу.
create table public.user_miners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  template_id text references public.miner_templates (id) on delete set null,
  name text not null,
  is_free boolean not null default false,
  deposit_usd numeric(18, 6) not null check (deposit_usd > 0),
  return_multiplier numeric(6, 4) not null check (return_multiplier > 1),
  duration_days integer not null check (duration_days > 0),
  started_at timestamptz not null default now(),
  accrued_active_ms bigint not null default 0 check (accrued_active_ms >= 0),
  active_since timestamptz,
  claimed_usd numeric(18, 6) not null default 0 check (claimed_usd >= 0),
  is_active boolean not null default true
);

create index user_miners_user_id_idx on public.user_miners (user_id);
create index user_miners_template_id_idx on public.user_miners (template_id);

-- tasks -------------------------------------------------------------------
-- Визначення завдань, спільні для всіх користувачів.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  type task_type not null,
  title text not null,
  description text not null default '',
  icon_url text,
  reward_usd numeric(18, 6) not null default 0 check (reward_usd >= 0),
  reward_coin numeric(18, 6) not null default 0 check (reward_coin >= 0),
  action_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

-- user_tasks ----------------------------------------------------------------
-- Прогрес виконання завдання конкретним користувачем (frontend-тип `Task`
-- у src/types/index.ts — це `tasks` LEFT JOIN `user_tasks` для поточного
-- користувача, зібрані в одну форму на рівні API/Edge Function).
create table public.user_tasks (
  user_id uuid not null references public.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  status user_task_status not null default 'available',
  claimed_at timestamptz,
  primary key (user_id, task_id)
);

-- withdrawals ---------------------------------------------------------------
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount_usd numeric(18, 6) not null check (amount_usd > 0),
  fee_usd numeric(18, 6) not null default 0 check (fee_usd >= 0),
  currency currency_code not null default 'USDT',
  wallet_address text not null,
  status withdrawal_status not null default 'pending',
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  comment text
);

create index withdrawals_user_id_idx on public.withdrawals (user_id);
create index withdrawals_status_idx on public.withdrawals (status);

-- updated_at тригер для users -----------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- Row Level Security ----------------------------------------------------
-- Застосунок автентифікує користувачів через Telegram initData, а не через
-- Supabase Auth, тож auth.uid() поки не пов'язаний з user_id. До підключення
-- кастомної автентифікації (JWT з telegram_id у claims): каталожні таблиці
-- відкриті на читання всім (anon key), решта — тільки через service role
-- (Edge Functions). Замінити на реальні `user_id = auth.uid()` політики,
-- коли з'явиться авторизація.
alter table public.users enable row level security;
alter table public.miner_templates enable row level security;
alter table public.user_miners enable row level security;
alter table public.tasks enable row level security;
alter table public.user_tasks enable row level security;
alter table public.withdrawals enable row level security;

create policy "miner_templates are publicly readable"
on public.miner_templates for select
using (is_active = true);

create policy "tasks are publicly readable"
on public.tasks for select
using (is_active = true);

-- Стартові дані каталогу (10 днів / 150%), синхронізовано з src/lib/catalog.ts
insert into public.miner_templates
  (id, name, description, image_url, deposit_usd, return_multiplier, duration_days, is_vip, is_active, sort_order)
values
  ('regular-5', '5 USDT', '', '⚡', 5, 1.5, 10, false, true, 0),
  ('regular-25', '25 USDT', '', '⚡', 25, 1.5, 10, false, true, 1),
  ('regular-50', '50 USDT', '', '⚡', 50, 1.5, 10, false, true, 2),
  ('regular-100', '100 USDT', '', '⚡', 100, 1.5, 10, false, true, 3),
  ('regular-250', '250 USDT', '', '⚡', 250, 1.5, 10, false, true, 4),
  ('regular-500', '500 USDT', '', '⚡', 500, 1.5, 10, false, true, 5),
  ('regular-1000', '1000 USDT', '', '⚡', 1000, 1.5, 10, false, true, 6),
  ('regular-1500', '1500 USDT', '', '⚡', 1500, 1.5, 10, false, true, 7),
  ('premium-999', '999 USDT', '', '💎', 999, 1.5, 10, true, true, 0),
  ('premium-1499', '1499 USDT', '', '💎', 1499, 1.5, 10, true, true, 1),
  ('premium-1999', '1999 USDT', '', '💎', 1999, 1.5, 10, true, true, 2),
  ('premium-2499', '2499 USDT', '', '💎', 2499, 1.5, 10, true, true, 3),
  ('premium-2999', '2999 USDT', '', '💎', 2999, 1.5, 10, true, true, 4)
on conflict (id) do nothing;
