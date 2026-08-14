// Deno Edge Function: process-withdrawal
//
// Викликається ТІЛЬКИ з адмінки (WithdrawalsSection → resolveWithdrawal у
// src/lib/admin.ts), коли адмін тисне "Подтвердить" на заявці виводу.
// На відміну від решти admin_* дій (де достатньо одного SQL RPC),
// підтвердження виводу тепер має РЕАЛЬНО відправити крипту користувачу —
// це вимагає приватного ключа/мнемоніки, яких не повинно бути в браузері,
// тож уся операція живе тут, у service_role-контексті Edge Function.
//
// Потік:
//   1) admin_mark_withdrawal_processing — блокує заявку, pending -> processing
//   2) відправляємо USDT-jetton у мережі TON (вивід — лише TON, TRC-20
//      прибрано з виводу; request_withdrawal на рівні БД теж більше не
//      приймає інших мереж — див. 20260817090000_withdrawal_ton_only.sql)
//   3) переказ пройшов    -> admin_mark_withdrawal_completed (tx_hash, повідомлення користувачу)
//      переказ НЕ пройшов -> admin_mark_withdrawal_failed (повертає баланс, повідомлення користувачу)
//                            + сповіщення в канал транзакцій, щоб адмін одразу побачив збій
//
// СЕКРЕТИ: див. коментарі в _shared/tonPayout.ts, плюс TELEGRAM_BOT_TOKEN /
// TELEGRAM_TRANSACTIONS_CHANNEL_ID (спільні з іншими функціями).
//
// ⚠️ Як і TON-інтеграції в check-ton*-deposits, реальна відправка крипти
// (sendTonUsdtJetton) НЕ перевірена проти живої мережі з цього середовища —
// обов'язково протестувати маленькою сумою перед продом.

import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts'
import { notifyTransactionsChannel } from '../_shared/telegram.ts'
import { AmbiguousPayoutError, sendTonUsdtJetton } from '../_shared/tonPayout.ts'

interface ProcessWithdrawalRequest {
  adminTelegramId?: number
  transactionId?: string
}

interface ProcessingRow {
  amount_usd: number
  fee_usd: number
  network: string
  wallet_address: string
  telegram_id: number
}

Deno.serve(async (req) => {
  let body: ProcessWithdrawalRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ success: false, error: 'invalid_json' }, 400)
  }

  const { adminTelegramId, transactionId } = body
  if (!adminTelegramId || !transactionId) {
    return jsonResponse({ success: false, error: 'missing_parameters' }, 400)
  }

  const supabase = createSupabaseAdminClient()

  // Крок 1: блокуємо заявку й переводимо pending -> processing. Звідси й
  // до кінця функції жоден інший виклик (повторний клік "Подтвердить",
  // паралельний запит) не зможе зачепити цю ж заявку — RPC сама кине
  // withdrawal_already_resolved, якщо статус вже не 'pending'.
  const { data: markData, error: markError } = await supabase.rpc('admin_mark_withdrawal_processing', {
    p_admin_telegram_id: adminTelegramId,
    p_transaction_id: transactionId,
  })

  if (markError) {
    return jsonResponse({ success: false, error: markError.message }, 400)
  }

  const row = (Array.isArray(markData) ? markData[0] : markData) as ProcessingRow | undefined
  if (!row) {
    return jsonResponse({ success: false, error: 'withdrawal_not_found' }, 404)
  }

  const netAmountUsd = Number(row.amount_usd) - Number(row.fee_usd)

  // Крок 2: власне переказ у блокчейні.
  let txHash: string
  try {
    if (row.network === 'TON') {
      txHash = await sendTonUsdtJetton(row.wallet_address, netAmountUsd)
    } else {
      // Вивід дозволений лише в TON на рівні request_withdrawal — сюди
      // потрапити з іншою мережею можна тільки якщо рядок був створений
      // до 20260817090000_withdrawal_ton_only.sql (легасі TRC-20 заявка).
      throw new Error(`unsupported_network:${row.network}`)
    }
  } catch (err) {
    console.error('[process-withdrawal] payout failed:', transactionId, err)
    const errorMessage = String(err instanceof Error ? err.message : err)

    if (err instanceof AmbiguousPayoutError) {
      // Помилка сталась ПІД ЧАС/ПІСЛЯ відправки підписаного повідомлення —
      // ми НЕ можемо бути впевнені, що крипта нікуди не пішла. Автоматично
      // повертати баланс тут небезпечно (ризик подвійної виплати, якщо
      // переказ насправді пройшов) — свідомо лишаємо заявку в 'processing'
      // БЕЗ виклику admin_mark_withdrawal_failed і гучно просимо адміна
      // звірити вручну (гаманець на tonviewer.com/tonscan.org за seqno з
      // повідомлення нижче, потім вручну completed/failed через SQL).
      await notifyTransactionsChannel(
        `🆘 НЕОДНОЗНАЧНА ПОМИЛКА автовиплати — ПОТРІБНА РУЧНА ЗВІРКА\n` +
          `Заявка: <code>${transactionId}</code>\nСеть: ${row.network}\n` +
          `Сумма: ${netAmountUsd.toFixed(2)} USDT\nКошелёк: <code>${row.wallet_address}</code>\n` +
          `Ошибка: ${errorMessage}\n` +
          `Баланс пользователя НЕ возвращён — сначала проверьте, ушли ли деньги в блокчейне.`,
      )
      return jsonResponse({ success: false, error: 'ambiguous_payout_needs_manual_review', detail: errorMessage }, 500)
    }

    // Крипта НЕ пішла (помилка сталась ДО відправки — валідація,
    // недостатній баланс гарячого гаманця тощо) — безпечно повернути
    // заявку в 'failed' і віддати гроші користувачу назад.
    const { error: failError } = await supabase.rpc('admin_mark_withdrawal_failed', {
      p_admin_telegram_id: adminTelegramId,
      p_transaction_id: transactionId,
      p_error: errorMessage,
    })

    if (failError) {
      // Найгірший сценарій: не вдалось навіть відкотити заявку назад — вона
      // лишається 'processing' без повернення балансу. Це потребує РУЧНОГО
      // втручання (перевірити в БД, чи гроші справді не пішли, і вирішити
      // вручну — повернути баланс чи повторити спробу).
      console.error('[process-withdrawal] CRITICAL: rollback after payout error also failed:', failError)
      await notifyTransactionsChannel(
        `🆘 КРИТИЧНО: вивід <code>${transactionId}</code> завис у processing після помилки переказу, ` +
          `і автоматичний відкат теж не спрацював (${failError.message}). Потрібна РУЧНА перевірка в БД.`,
      )
      return jsonResponse({ success: false, error: 'payout_and_rollback_failed', detail: errorMessage }, 500)
    }

    await notifyTransactionsChannel(
      `⚠️ Автовыплата не прошла\nЗаявка: <code>${transactionId}</code>\nСеть: ${row.network}\n` +
        `Сумма: ${netAmountUsd.toFixed(2)} USDT\nОшибка: ${errorMessage}\n` +
        `Средства возвращены на баланс пользователя.`,
    )
    return jsonResponse({ success: false, error: 'payout_failed', detail: errorMessage }, 502)
  }

  // Крок 3: крипта пішла — фіксуємо завершення заявки.
  const { error: completeError } = await supabase.rpc('admin_mark_withdrawal_completed', {
    p_admin_telegram_id: adminTelegramId,
    p_transaction_id: transactionId,
    p_tx_hash: txHash,
  })

  if (completeError) {
    // Гроші вже відправлені — НЕ намагаємось відкотити (повторне
    // зарахування балансу тут створило б подвійну виплату). Просто гучно
    // сигналимо, що потрібна ручна звірка статусу заявки.
    console.error('[process-withdrawal] payout succeeded but mark-completed failed:', completeError)
    await notifyTransactionsChannel(
      `🆘 Вивід <code>${transactionId}</code> успішно відправлено (tx: <code>${txHash}</code>), ` +
        `але не вдалось позначити заявку завершеною: ${completeError.message}. Перевірте вручну.`,
    )
    return jsonResponse({ success: true, txHash, warning: 'mark_completed_failed' })
  }

  await notifyTransactionsChannel(
    `📤 Автовыплата\nСеть: ${row.network}\nПользователь: <code>${row.telegram_id}</code>\n` +
      `Сумма: ${netAmountUsd.toFixed(2)} USDT\nTx: <code>${txHash}</code>`,
  )

  return jsonResponse({ success: true, txHash })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
