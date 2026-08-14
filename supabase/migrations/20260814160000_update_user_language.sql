-- CloudMiner HYIP — зберігає вибір мови користувача (LanguageSelector) у
-- users.language_code. Anon-ключ не має прямого UPDATE на `users` (та сама
-- причина, що й для решти RPC у проєкті — інакше будь-хто міг би змінити
-- довільне поле довільного користувача), тож ця вузько окреслена функція
-- дозволяє мінятиме лише language_code, і лише зі списку підтримуваних мов.

create or replace function public.update_user_language(
  p_telegram_id bigint,
  p_first_name text,
  p_language_code text
)
returns table (language_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array['ru', 'en', 'ar', 'id', 'es', 'kk', 'tr'];
begin
  if p_language_code is null or not (p_language_code = any (v_allowed)) then
    raise exception 'unsupported_language';
  end if;

  insert into public.users (telegram_id, first_name, language_code, referral_code)
  values (
    p_telegram_id,
    coalesce(nullif(trim(p_first_name), ''), 'User'),
    p_language_code,
    substr(md5(random()::text || p_telegram_id::text), 1, 8)
  )
  on conflict on constraint users_telegram_id_key
  do update set language_code = excluded.language_code, updated_at = now();

  return query
    select u.language_code from public.users u where u.telegram_id = p_telegram_id;
end;
$$;

revoke all on function public.update_user_language(bigint, text, text) from public, anon, authenticated;
grant execute on function public.update_user_language(bigint, text, text) to anon, authenticated;
