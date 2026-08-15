-- CloudMiner HYIP — фікс claim_miner_income: "Собрать прибыль" не працював
-- для куплених майнерів.
--
-- Жива помилка (підтверджено RPC-викликом): 42702 "column reference
-- claimed_usd is ambiguous". Функція оголошена як
-- `returns table (claimed_usd numeric, new_balance_usd numeric)` — у
-- PL/pgSQL це створює НЕЯВНУ змінну `claimed_usd` в scope усієї функції,
-- яка конфліктує зі стовпцем `user_miners.claimed_usd` у
--   update public.user_miners set claimed_usd = claimed_usd + v_unclaimed ...
-- Postgres не міг вирішити, чи праве `claimed_usd` — це OUT-змінна, чи
-- стовпець таблиці, і кидав виняток при КОЖНІЙ спробі забрати дохід
-- будь-якого купленого майнера (клієнт це просто мовчки ковтав — жоден
-- RPC-результат у handleClaimAll не перевірявся, звідси "не собирает
-- прибыль" без жодної видимої помилки).
--
-- Фікс: аліас `m` на таблиці + явна квалфікація `m.claimed_usd` у
-- правій частині SET — знімає будь-яку двозначність.
create or replace function public.claim_miner_income(
  p_init_data text,
  p_miner_id uuid
)
returns table (claimed_usd numeric, new_balance_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telegram_id bigint;
  v_user_id uuid;
  v_miner public.user_miners%rowtype;
  v_duration_ms numeric;
  v_live_ms numeric;
  v_effective_ms numeric;
  v_progress numeric;
  v_accrued_usd numeric;
  v_unclaimed numeric;
begin
  select telegram_id into v_telegram_id from public.verify_telegram_init_data(p_init_data);
  select u.id into v_user_id from public.users u where u.telegram_id = v_telegram_id;

  if v_user_id is null then
    raise exception 'miner_not_found';
  end if;

  -- FOR UPDATE блокує рядок майнера — паралельний "Собрать" (подвійний тап)
  -- на цей самий майнер не зможе зарахувати той самий дохід двічі.
  select * into v_miner
  from public.user_miners m
  where m.id = p_miner_id and m.user_id = v_user_id
  for update;

  if v_miner.id is null then
    raise exception 'miner_not_found';
  end if;

  v_duration_ms := v_miner.duration_days::numeric * 86400000;
  v_live_ms := case
    when v_miner.active_since is not null
    then extract(epoch from (now() - v_miner.active_since)) * 1000
    else 0
  end;
  v_effective_ms := least(v_miner.accrued_active_ms + v_live_ms, v_duration_ms);
  v_progress := case when v_duration_ms > 0 then v_effective_ms / v_duration_ms else 0 end;
  v_accrued_usd := v_miner.deposit_usd * v_miner.return_multiplier * v_progress;
  v_unclaimed := greatest(0, round(v_accrued_usd - v_miner.claimed_usd, 6));

  if v_unclaimed <= 0 then
    raise exception 'nothing_to_claim';
  end if;

  if v_progress >= 1 then
    -- Строк вичерпано — фіксуємо накопичений час і зупиняємо нарахування
    -- (той самий смисл, що pauseMiner на клієнті, але вже назавжди).
    update public.user_miners m
    set claimed_usd = m.claimed_usd + v_unclaimed,
        accrued_active_ms = v_duration_ms::bigint,
        active_since = null,
        is_active = false
    where m.id = p_miner_id;
  else
    update public.user_miners m
    set claimed_usd = m.claimed_usd + v_unclaimed
    where m.id = p_miner_id;
  end if;

  update public.users u set balance_usd = u.balance_usd + v_unclaimed, updated_at = now() where u.id = v_user_id;

  insert into public.transactions (user_id, type, amount_usd, currency, status, comment, processed_at)
  values (v_user_id, 'miner_claim', v_unclaimed, 'USDT', 'completed',
          'Доход майнера "' || v_miner.name || '"', now());

  return query select v_unclaimed, u.balance_usd from public.users u where u.id = v_user_id;
end;
$$;
