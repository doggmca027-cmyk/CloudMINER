-- CloudMiner HYIP — планувальник для send-notifications.
--
-- Без цього вся черга notification_queue (депозити, виводи, розсилки
-- адміна тощо) лежала мертвим вантажем — pg_cron до цього моменту не був
-- увімкнений на проєкті взагалі (перевірено напряму: жодної джоби, крім
-- check-subscription-retention, зареєстрованої окремою міграцією раніше,
-- не існувало). pg_cron/pg_net вже увімкнені попередньою міграцією
-- (20260819094000) — тут лише реєструємо ще одну джобу.
--
-- Кожні 30 секунд (той самий інтервал, що вже був задокументований у
-- заголовку send-notifications/index.ts) — авторизація тим самим
-- публічним anon-ключем, що й для check-subscription-retention (сама
-- функція всередині працює через service_role незалежно від того, яким
-- ключем її викликали).
select cron.schedule(
  'send-notifications',
  '*/30 * * * * *',
  $$
  select net.http_post(
    url := 'https://oecgpedirewwudviqzem.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lY2dwZWRpcmV3d3VkdmlxemVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NDQyMzIsImV4cCI6MjEwMjIyMDIzMn0.tmLzDPxwFXJp_iLyam2PIpv4ZD8QtbxsonGkSqa3ryg'
    ),
    body := '{}'::jsonb
  );
  $$
);
