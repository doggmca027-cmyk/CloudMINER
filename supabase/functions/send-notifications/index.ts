// Deno Edge Function: send-notifications
//
// Розбирає public.notification_queue (заповнюється SECURITY DEFINER RPC —
// admin_issue_deposit, admin_resolve_withdrawal тощо) і надсилає кожне
// повідомлення користувачу через Telegram Bot API. Postgres не може
// безпечно робити такі HTTP-виклики напряму (потрібні pg_net + Vault для
// зберігання TELEGRAM_BOT_TOKEN) — тому чергу забирає ця функція.
//
// ЗАПУСК: періодично (раз на 15–30с), як check-ton-deposits /
// check-tron-deposits — через Supabase Dashboard → Edge Functions → Cron,
// або pg_cron + pg_net:
//   select cron.schedule('send-notifications', '*/30 * * * * *', $$
//     select net.http_post(
//       url := 'https://<project-ref>.supabase.co/functions/v1/send-notifications',
//       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
//     );
//   $$);
//
// СЕКРЕТИ (supabase secrets set ...):
//   TELEGRAM_BOT_TOKEN — той самий бот, що й у check-ton-deposits/check-tron-deposits

import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts'
import { sendTelegramMessage } from '../_shared/telegram.ts'

const BATCH_SIZE = 50

interface QueuedNotification {
  id: string
  telegram_id: number
  message: string
}

Deno.serve(async (_req) => {
  const supabase = createSupabaseAdminClient()
  const summary = { scanned: 0, sent: 0, failed: 0, errors: [] as string[] }

  const { data, error } = await supabase
    .from('notification_queue')
    .select('id, telegram_id, message')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[send-notifications] fetch failed:', error)
    return jsonResponse({ error: error.message }, 500)
  }

  const rows = (data ?? []) as QueuedNotification[]
  summary.scanned = rows.length

  for (const row of rows) {
    try {
      await sendTelegramMessage(row.telegram_id, row.message)

      // Позначаємо надісланим незалежно від фактичного успіху доставки
      // (sendTelegramMessage сама логує помилки Bot API — типово це
      // "користувач ще не натискав /start у боті", і нескінченно
      // ретраїти таке немає сенсу). Якщо колись знадобиться retry-логіка,
      // тут можна перевіряти повернене з sendTelegramMessage значення.
      const { error: updateError } = await supabase
        .from('notification_queue')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', row.id)

      if (updateError) {
        summary.errors.push(`${row.id}: ${updateError.message}`)
        summary.failed++
        continue
      }

      summary.sent++
    } catch (err) {
      console.error('[send-notifications] send failed:', row.id, err)
      summary.errors.push(`${row.id}: ${String(err)}`)
      summary.failed++
    }
  }

  return jsonResponse(summary)
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
