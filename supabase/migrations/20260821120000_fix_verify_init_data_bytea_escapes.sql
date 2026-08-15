-- CloudMiner HYIP — третій хотфікс verify_telegram_init_data.
--
-- Справжня причина живої помилки "invalid input syntax for type bytea"
-- (get_or_create_user падав для реального юзера з emoji в імені,
-- напр. "Feel🦄 PIRATEking 🏴‍☠️💰"): `v_data_check_string::bytea` і
-- `v_bot_token::bytea` кастили TEXT у BYTEA через `::bytea`, а це
-- прогонить рядок через "escape"-парсер byteain(), який інтерпретує
-- зворотні слеші як escape-послідовності (`\ooo` — рівно 3 вісімкові
-- цифри, `\\` — сам слеш). JSON-серіалізація `user=` у реальному
-- initData escapить не-ASCII символи (emoji, суррогатні пари) як
-- `\uXXXX` — і саме ці "\u" в v_data_check_string (частина JSON з поля
-- user) не є валідною octal-послідовністю, звідси помилка.
--
-- Тестовий forged initData з попередніх сесій мав first_name "Admin"
-- (чистий ASCII, без жодного `\`) — тому баг був непомітний при
-- живому end-to-end тесті через forged initData і виявився лише на
-- реальному акаунті з emoji в імені.
--
-- Фікс: convert_to(text, 'UTF8') замість `::bytea` — офіційний спосіб
-- Postgres отримати сирі UTF-8-байти рядка БЕЗ проходження через
-- escape-парсер, коректно для будь-якого вмісту тексту.
create or replace function public.verify_telegram_init_data(
  p_init_data text,
  p_max_age_seconds int default 86400
)
returns table (
  telegram_id bigint,
  first_name text,
  last_name text,
  username text,
  photo_url text,
  language_code text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bot_token text;
  v_secret_key bytea;
  v_pairs text[];
  v_pair text;
  v_eq_pos int;
  v_key text;
  v_value text;
  v_hash text;
  v_auth_date bigint;
  v_check_lines text[] := array[]::text[];
  v_data_check_string text;
  v_computed_hash text;
  v_user_json jsonb;
begin
  if p_init_data is null or trim(p_init_data) = '' then
    raise exception 'invalid_init_data';
  end if;

  select decrypted_secret into v_bot_token
  from vault.decrypted_secrets
  where name = 'telegram_bot_token'
  limit 1;

  if v_bot_token is null or trim(v_bot_token) = '' then
    raise exception 'bot_token_not_configured';
  end if;

  v_pairs := string_to_array(p_init_data, '&');

  foreach v_pair in array v_pairs loop
    v_eq_pos := strpos(v_pair, '=');
    if v_eq_pos = 0 then
      continue;
    end if;

    v_key := substr(v_pair, 1, v_eq_pos - 1);
    v_value := public.url_decode(substr(v_pair, v_eq_pos + 1));

    if v_value is null then
      raise exception 'invalid_init_data';
    end if;

    if v_key = 'hash' then
      v_hash := v_value;
    else
      v_check_lines := array_append(v_check_lines, v_key || '=' || v_value);
      if v_key = 'auth_date' then
        v_auth_date := nullif(v_value, '')::bigint;
      elsif v_key = 'user' then
        v_user_json := v_value::jsonb;
      end if;
    end if;
  end loop;

  if v_hash is null or v_user_json is null or v_auth_date is null then
    raise exception 'invalid_init_data';
  end if;

  select string_agg(line, E'\n' order by line)
  into v_data_check_string
  from unnest(v_check_lines) as line;

  -- convert_to(..., 'UTF8') — НЕ ::bytea (див. коментар вище).
  v_secret_key := hmac(convert_to(v_bot_token, 'UTF8'), convert_to('WebAppData', 'UTF8'), 'sha256');
  v_computed_hash := encode(hmac(convert_to(v_data_check_string, 'UTF8'), v_secret_key, 'sha256'), 'hex');

  if v_computed_hash is distinct from lower(v_hash) then
    raise exception 'invalid_init_data_signature';
  end if;

  if v_auth_date < extract(epoch from now())::bigint - p_max_age_seconds then
    raise exception 'init_data_expired';
  end if;

  if (v_user_json ->> 'id') is null then
    raise exception 'invalid_init_data';
  end if;

  return query
    select
      (v_user_json ->> 'id')::bigint,
      v_user_json ->> 'first_name',
      v_user_json ->> 'last_name',
      v_user_json ->> 'username',
      v_user_json ->> 'photo_url',
      v_user_json ->> 'language_code';
end;
$$;
