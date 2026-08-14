-- CloudMiner HYIP — RPC для завантаження профілю користувача при старті
-- застосунку (App.tsx). Той самий принцип, що й у request_withdrawal:
-- анонімний ключ не має прямого SELECT/INSERT на `users` (це відкрило б
-- читання чужих балансів усім), тож "знайти або створити користувача за
-- telegram_id" виконується вузько окресленим SECURITY DEFINER-викликом.
--
-- TODO: коли з'явиться серверна перевірка Telegram initData, замінити
-- довіру до p_telegram_id тут на дані з перевіреного JWT.

create or replace function public.get_or_create_user(
  p_telegram_id bigint,
  p_first_name text,
  p_language_code text default 'en'
)
returns table (
  id uuid,
  telegram_id bigint,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  language_code text,
  balance_usd numeric,
  balance_coin numeric,
  total_income numeric,
  is_vip boolean,
  referral_code text,
  referred_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ON CONFLICT ON CONSTRAINT (а не "(telegram_id)"): RETURNS TABLE нижче
  -- оголошує OUT-параметр з таким самим іменем telegram_id, і PL/pgSQL
  -- намагається зіставити голий ідентифікатор у ON CONFLICT (...) саме з
  -- ним, через що "(telegram_id)" ловить "column reference is ambiguous".
  -- Посилання на ім'я обмеження цю неоднозначність обходить.
  insert into public.users (telegram_id, first_name, language_code, referral_code)
  values (
    p_telegram_id,
    coalesce(nullif(trim(p_first_name), ''), 'User'),
    coalesce(nullif(trim(p_language_code), ''), 'en'),
    substr(md5(random()::text || p_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key do update set updated_at = now();

  return query
    select
      u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.photo_url,
      u.language_code, u.balance_usd, u.balance_coin, u.total_income, u.is_vip,
      u.referral_code, u.referred_by, u.created_at, u.updated_at
    from public.users u
    where u.telegram_id = p_telegram_id;
end;
$$;

revoke all on function public.get_or_create_user(bigint, text, text) from public;
grant execute on function public.get_or_create_user(bigint, text, text) to anon, authenticated;
