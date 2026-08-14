-- CloudMiner HYIP — хотфікс verify_telegram_init_data.
--
-- pgcrypto's hmac(data, key, type) приймає ТІЛЬКИ bytea/bytea/text — без
-- явного каста text->bytea Postgres не може підібрати оверлоад і кидає
-- "function hmac(text, unknown, unknown) does not exist". Виявлено
-- одразу ж end-to-end тестом (згенерований підписаний initData реальним
-- бот-токеном), перш ніж це побачив хоч один реальний користувач.
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
set search_path = public
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

  -- pgcrypto's hmac() приймає bytea, не text — без явного каста Postgres
  -- не може підібрати оверлоад.
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
