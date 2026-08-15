// Deno Edge Function: check-subscription-retention
//
// За розкладом (як check-ton-deposits) — розбирає public.subscription_checks
// (заповнюється check-subscription при першому успішному "Перевірити"),
// і для кожної заявки, чий 24-годинний термін настав, ще РАЗ перевіряє
// членство через Telegram Bot API:
//   - і досі підписаний -> grant_subscription_reward (реально нараховує
//     users.balance_usd + пише в transactions)
//   - відписався          -> позначає 'failed_unsubscribed', нагороди немає
//   - Bot API не відповів -> позначає 'failed_error' і сигналить у канал
//     транзакцій на ручну перевірку (той самий принцип, що й
//     process-withdrawal: краще зупинитись і попросити людину, ніж
//     мовчки видати чи не видати гроші на підставі непевного результату).
//
// ЗАПУСК: періодично (раз на 15-30 хв достатньо — вікно перевірки й так
// 24 години, секунди точності не критичні), через Supabase Dashboard →
// Edge Functions → Cron, або pg_cron + pg_net — той самий патерн, що й
// check-ton-deposits/send-notifications.
//
// СЕКРЕТИ: TELEGRAM_BOT_TOKEN, TELEGRAM_TRANSACTIONS_CHANNEL_ID — спільні
// з check-subscription.

import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts'
import { checkChatMembership, notifyTransactionsChannel, sendTelegramMessage } from '../_shared/telegram.ts'

const BATCH_SIZE = 50

interface DueCheckRow {
  id: string
  user_id: string
  target_key: string
  chat_ref: string
  reward_usd: number
}

Deno.serve(async (_req) => {
  const supabase = createSupabaseAdminClient()
  const summary = { scanned: 0, rewarded: 0, unsubscribed: 0, errors: 0 }

  const { data, error } = await supabase
    .from('subscription_checks')
    .select('id, user_id, target_key, chat_ref, reward_usd')
    .eq('status', 'pending')
    .lte('check_after', new Date().toISOString())
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[check-subscription-retention] fetch failed:', error)
    return jsonResponse({ error: error.message }, 500)
  }

  const rows = (data ?? []) as DueCheckRow[]
  summary.scanned = rows.length

  for (const row of rows) {
    try {
      const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('id', row.user_id)
        .maybeSingle()

      if (userError || !userRow) {
        summary.errors++
        await supabase
          .from('subscription_checks')
          .update({ status: 'failed_error', checked_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'pending')
        continue
      }

      const membership = await checkChatMembership(row.chat_ref, userRow.telegram_id)

      if (!membership.ok) {
        summary.errors++
        await supabase
          .from('subscription_checks')
          .update({ status: 'failed_error', checked_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'pending')
        await notifyTransactionsChannel(
          `⚠️ Не удалось повторно проверить подписку (24ч)\nЗапись: <code>${row.id}</code>\n` +
            `Цель: ${row.target_key}\nОшибка: ${membership.error}\n` +
            `Награда НЕ выдана — возможно, боту не хватает прав администратора в этом канале.`,
        )
        continue
      }

      if (!membership.isMember) {
        summary.unsubscribed++
        await supabase
          .from('subscription_checks')
          .update({ status: 'failed_unsubscribed', checked_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'pending')
        await sendTelegramMessage(
          userRow.telegram_id,
          `❌ Вы отписались раньше, чем через 24 часа — награда ${row.reward_usd} USDT не начислена.`,
        )
        continue
      }

      const { data: rewardData, error: rewardError } = await supabase.rpc('grant_subscription_reward', {
        p_check_id: row.id,
      })

      if (rewardError) {
        summary.errors++
        console.error('[check-subscription-retention] grant_subscription_reward failed:', row.id, rewardError)
        await notifyTransactionsChannel(
          `🆘 Подписка подтверждена (24ч), но начислить награду не удалось\n` +
            `Запись: <code>${row.id}</code>\nОшибка: ${rewardError.message}. Проверьте вручную.`,
        )
        continue
      }

      summary.rewarded++
      const rewardRow = Array.isArray(rewardData) ? rewardData[0] : rewardData
      await sendTelegramMessage(
        userRow.telegram_id,
        `✅ Вы удержали подписку 24 часа — начислено +${Number(rewardRow?.reward_usd ?? row.reward_usd).toFixed(2)} USDT.`,
      )
    } catch (err) {
      summary.errors++
      console.error('[check-subscription-retention] row processing failed:', row.id, err)
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
