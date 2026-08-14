-- CloudMiner HYIP — реальна автентифікація через підпис Telegram initData.
--
-- ДОСІ кожен RPC, що представляє "поточного користувача", просто приймав
-- `p_telegram_id bigint` від клієнта й беззастережно йому вірив — anon-ключ
-- публічний (лежить у кожному білді фронтенду), тож будь-хто міг викликати
-- `supabase.rpc('request_withdrawal', { p_telegram_id: <чужий_id>, ... })`
-- і списати чужий реальний баланс, або прочитати чужу реферальну
-- статистику через get_referral_stats/get_referral_list. TODO про це стояв
-- у коді з першого дня (get_or_create_user, request_withdrawal) — цей файл
-- його нарешті закриває.
--
-- Telegram Mini Apps підписують `window.Telegram.WebApp.initData` (сирий
-- query-string з даними користувача) за допомогою HMAC-SHA256, ключ для
-- якого виводиться з токена бота. Офіційний алгоритм перевірки:
-- https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
--   1. secret_key   = HMAC_SHA256(data = <bot_token>, key = "WebAppData")
--   2. data_check_string = відсортовані "key=value" пари (крім hash), \n-розділені
--   3. hash обчислюється як HMAC_SHA256(data = data_check_string, key = secret_key)
--   4. порівнюється з hash, який прийшов у самому initData
-- Токен бота НІКОЛИ не потрапляє в клієнтський код — зберігається лише в
-- Supabase Vault (шифрований, читає тільки ця SECURITY DEFINER функція).
-- Значення секрету заводиться ОКРЕМО (не в цій, git-комітній, міграції):
--   select vault.create_secret('<TELEGRAM_BOT_TOKEN>', 'telegram_bot_token');

-- url_decode -----------------------------------------------------------------
-- Значення в initData percent-encoded (як звичайний query string) — стандартної
-- url_decode функції в PL/pgSQL немає, пишемо мінімальну реалізацію.
-- Побайтово збирає bytea (multi-byte UTF-8 послідовності з кількох %XX
-- складаються коректно) і конвертує в text лише в самому кінці.
create or replace function public.url_decode(input text)
returns text
language plpgsql
immutable
as $$
declare
  result bytea := ''::bytea;
  i int := 1;
  len int := length(input);
  c text;
begin
  while i <= len loop
    c := substr(input, i, 1);
    if c = '%' and i + 2 <= len then
      result := result || decode(substr(input, i + 1, 2), 'hex');
      i := i + 3;
    elsif c = '+' then
      result := result || convert_to(' ', 'UTF8');
      i := i + 1;
    else
      result := result || convert_to(c, 'UTF8');
      i := i + 1;
    end if;
  end loop;
  return convert_from(result, 'UTF8');
exception when others then
  -- Побитий percent-encoding (напр. "%" в кінці рядка чи невалідний hex) —
  -- краще повернути null і провалити перевірку підпису вище по стеку, ніж
  -- впасти з незрозумілою помилкою бази.
  return null;
end;
$$;

revoke all on function public.url_decode(text) from public, anon, authenticated;

-- verify_telegram_init_data ---------------------------------------------------
-- Перевіряє підпис initData і повертає ВЕРИФІКОВАНІ дані користувача.
-- Кидає виняток (не повертає null) при БУДЬ-якій проблемі — виклик з
-- SECURITY DEFINER RPC вище по стеку просто пропускає це далі клієнту як
-- помилку, замість того, щоб продовжити з підробленими даними.
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
-- pgcrypto (hmac) на Supabase-проєктах живе в схемі `extensions`, не
-- `public` — без неї у search_path hmac() взагалі не резолвиться.
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

  -- data_check_string: решта пар, відсортовані за ключем, з'єднані \n.
  select string_agg(line, E'\n' order by line)
  into v_data_check_string
  from unnest(v_check_lines) as line;

  -- pgcrypto's hmac() приймає bytea, не text — без явного каста Postgres
  -- не може підібрати оверлоад ("function hmac(text, unknown, unknown)
  -- does not exist").
  v_secret_key := hmac(v_bot_token::bytea, 'WebAppData'::bytea, 'sha256');
  v_computed_hash := encode(hmac(v_data_check_string::bytea, v_secret_key, 'sha256'), 'hex');

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

-- Викликається як з інших SECURITY DEFINER RPC (внутрішній виклик між
-- функціями одного власника, без гранту), так і НАПРЯМУ з Edge Functions
-- (service_role) — напр. process-withdrawal перевіряє initData адміна
-- перед тим, як довірити yому запуск реальної виплати.
revoke all on function public.verify_telegram_init_data(text, int) from public, anon, authenticated;
grant execute on function public.verify_telegram_init_data(text, int) to service_role;
