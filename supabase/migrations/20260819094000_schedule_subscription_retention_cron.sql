-- CloudMiner HYIP — планувальник для check-subscription-retention.
--
-- Досі жодна з check-* Edge Functions (check-ton-deposits тощо) не мала
-- розкладу всередині репозиторію — коментарі в їхніх заголовках лише
-- документували, ЯК налаштувати виклик за розкладом (Dashboard → Cron,
-- або pg_cron + pg_net вручну), а фактичне налаштування лишалось поза
-- git. Ця міграція вмикає pg_cron/pg_net і реєструє джобу для
-- check-subscription-retention напряму в БД, щоб не залежати від
-- ручного кроку в Dashboard.
--
-- Авторизація виклику — anon-ключ (публічний за задумом, той самий, що
-- в VITE_SUPABASE_ANON_KEY/будь-якому клієнтському бандлі; тримати його
-- тут БЕЗПЕЧНО, на відміну від service_role чи бот-токена). Сама функція
-- всередині все одно працює через service_role-клієнт
-- (createSupabaseAdminClient) незалежно від того, яким ключем її
-- викликали — anon лише проходить перевірку verify_jwt на рівні шлюзу.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'check-subscription-retention',
  '*/20 * * * *', -- кожні 20 хвилин — вікно перевірки й так 24 години, секунди точності не критичні
  $$
  select net.http_post(
    url := 'https://oecgpedirewwudviqzem.supabase.co/functions/v1/check-subscription-retention',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lY2dwZWRpcmV3d3VkdmlxemVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDQyMzIsImV4cCI6MjEwMjIyMDIzMn0.tmLzDPxwFXJp_iLyam2PIpv4ZD8QtbxsonGkSqa3ryg'
    ),
    body := '{}'::jsonb
  );
  $$
);
