-- CloudMiner HYIP — планувальник для трьох сканерів депозитів.
--
-- check-ton-deposits / check-ton-jetton-deposits / check-tron-deposits
-- ніколи не мали жодної cron-задачі в БД (перевірено напряму: до цієї
-- міграції в cron.job існували лише check-subscription-retention і
-- send-notifications, зареєстровані попередніми міграціями) — а секрети
-- (TON_WALLET_ADDRESS, TRC20_WALLET_ADDRESS тощо) на самих Edge Functions
-- взагалі не були задані до щойного `supabase secrets set`. Тобто реальні
-- депозити користувачів дотепер НІЯК не детектувались і не зараховувались.
--
-- Кожні 30 секунд (як і задокументовано в заголовках цих функцій) —
-- авторизація тим самим публічним anon-ключем, що й в інших джобах.
select cron.schedule(
  'check-ton-deposits',
  '*/30 * * * * *',
  $$
  select net.http_post(
    url := 'https://oecgpedirewwudviqzem.supabase.co/functions/v1/check-ton-deposits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lY2dwZWRpcmV3d3VkdmlxemVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDQyMzIsImV4cCI6MjEwMjIyMDIzMn0.tmLzDPxwFXJp_iLyam2PIpv4ZD8QtbxsonGkSqa3ryg'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'check-ton-jetton-deposits',
  '*/30 * * * * *',
  $$
  select net.http_post(
    url := 'https://oecgpedirewwudviqzem.supabase.co/functions/v1/check-ton-jetton-deposits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lY2dwZWRpcmV3d3VkdmlxemVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDQyMzIsImV4cCI6MjEwMjIyMDIzMn0.tmLzDPxwFXJp_iLyam2PIpv4ZD8QtbxsonGkSqa3ryg'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'check-tron-deposits',
  '*/30 * * * * *',
  $$
  select net.http_post(
    url := 'https://oecgpedirewwudviqzem.supabase.co/functions/v1/check-tron-deposits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lY2dwZWRpcmV3d3VkdmlxemVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDQyMzIsImV4cCI6MjEwMjIyMDIzMn0.tmLzDPxwFXJp_iLyam2PIpv4ZD8QtbxsonGkSqa3ryg'
    ),
    body := '{}'::jsonb
  );
  $$
);
