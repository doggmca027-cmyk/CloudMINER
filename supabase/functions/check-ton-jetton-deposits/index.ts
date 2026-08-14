// Deno Edge Function: check-ton-jetton-deposits
//
// Опитує TonAPI на вхідні перекази токена USDT (jetton) у мережі TON —
// той самий гаманець проєкту, що й check-ton-deposits (нативний TON), але
// інший актив. На відміну від TRC-20, jetton-перекази в TON
// (як і нативні TON-перекази) підтримують довільний текстовий
// forward-коментар — тому атрибуція через telegram_id у коментарі working
// так само, як check-ton-deposits, БЕЗ exact-amount workaround.
//
// Використовуємо TonAPI /v2/accounts/{address}/events — цей ендпоінт
// повертає вже розпарсені "actions" (включно з типом "JettonTransfer" і
// готовим полем comment), на відміну від сирого /transactions, який
// довелось би розбирати вручну (BOC/op-коди).
//
// ⚠️ БЕЗПЕКА: щоб чужий jetton (будь-хто може задеплоїти токен з символом
// "USDT" і надіслати його на наш гаманець) не зарахувався як справжній
// депозит, перевіряємо адресу jetton master (`action.JettonTransfer.jetton.address`)
// проти секрету `TON_USDT_JETTON_MASTER` — приймаємо переказ, лише якщо
// вона співпадає.
//
// ЗАПУСК: за розкладом, як і решта check-*-deposits (Dashboard → Edge
// Functions → Cron, або pg_cron + pg_net) — не з клієнта.
//
// СЕКРЕТИ (supabase secrets set ...):
//   TON_WALLET_ADDRESS    — той самий гаманець, що VITE_DEPOSIT_ADDRESS_TON (спільний з check-ton-deposits)
//   TON_USDT_JETTON_MASTER — адреса master-контракту USDT-jetton у мережі TON.
//                            Офіційний мейннет-контракт (документований у
//                            публічній екосистемі TON, станом на момент
//                            написання): EQCxE6mUtQJKFnGfaROTDto1qKmGpaHTKMxAn4Sqa5uwl9pE
//                            ⚠️ Обов'язково звірте цю адресу самостійно
//                            (напр. на tonviewer.com) перед продом — я не
//                            можу перевірити її проти живого TonAPI з
//                            цього середовища.
//   TONAPI_KEY             — опційно, підвищує ліміти tonapi.io (спільний з check-ton-deposits)
//   TELEGRAM_BOT_TOKEN / TELEGRAM_TRANSACTIONS_CHANNEL_ID — як у check-ton-deposits
//
// ⚠️ Так само, як у check-ton-deposits: форма відповіді TonAPI нижче
// відповідає публічній документації /v2/accounts/{id}/events на момент
// написання, але я не міг перевірити це проти живого API з цього
// середовища — звірте з https://tonapi.io/api-v2 перед продом і за
// потреби підправте парсинг.

import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts'
import { notifyTransactionsChannel, notifyUserDeposit } from '../_shared/telegram.ts'

const DEFAULT_USDT_JETTON_MASTER = 'EQCxE6mUtQJKFnGfaROTDto1qKmGpaHTKMxAn4Sqa5uwl9pE'

interface JettonTransferAction {
  type: string
  status?: string
  JettonTransfer?: {
    sender?: { address?: string }
    recipient?: { address?: string }
    senders_wallet?: string
    recipients_wallet?: string
    amount?: string
    comment?: string
    jetton?: { address?: string; symbol?: string; decimals?: number }
  }
}

interface TonApiEvent {
  event_id: string
  actions?: JettonTransferAction[]
  in_progress?: boolean
}

interface TonApiEventsResponse {
  events?: TonApiEvent[]
}

/**
 * Витягує telegram_id з коментаря — коментар МАЄ складатись рівно з цифр,
 * без прив'язки до меж рядка `/\d{5,15}/` підхоплював би ПЕРШЕ число
 * будь-де в тексті (напр. службовий префікс гаманця відправника) і міг би
 * зарахувати платіж на чужий акаунт. Див. той самий фікс і докладніший
 * коментар у check-ton-deposits/index.ts.
 */
function extractTelegramId(comment: string): number | null {
  const trimmed = comment.trim()
  return /^\d{5,15}$/.test(trimmed) ? Number(trimmed) : null
}

async function fetchIncomingJettonEvents(walletAddress: string): Promise<TonApiEvent[]> {
  const apiKey = Deno.env.get('TONAPI_KEY')
  const res = await fetch(`https://tonapi.io/v2/accounts/${walletAddress}/events?limit=20`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  })
  if (!res.ok) {
    throw new Error(`TonAPI error: HTTP ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as TonApiEventsResponse
  return (data.events ?? []).filter((e) => !e.in_progress)
}

Deno.serve(async (_req) => {
  const walletAddress = Deno.env.get('TON_WALLET_ADDRESS')
  const jettonMaster = Deno.env.get('TON_USDT_JETTON_MASTER') || DEFAULT_USDT_JETTON_MASTER
  if (!walletAddress) {
    return jsonResponse({ error: 'TON_WALLET_ADDRESS не налаштовано в секретах функції' }, 500)
  }

  const supabase = createSupabaseAdminClient()
  const summary = { scanned: 0, credited: 0, skipped: 0, errors: [] as string[] }

  let events: TonApiEvent[]
  try {
    events = await fetchIncomingJettonEvents(walletAddress)
  } catch (err) {
    console.error('[check-ton-jetton-deposits] fetch failed:', err)
    return jsonResponse({ error: String(err) }, 502)
  }

  for (const event of events) {
    const transfers = (event.actions ?? []).filter(
      (a) =>
        a.type === 'JettonTransfer' &&
        a.status !== 'failed' &&
        a.JettonTransfer?.recipient?.address === walletAddress &&
        a.JettonTransfer?.jetton?.address === jettonMaster,
    )

    for (const action of transfers) {
      const transfer = action.JettonTransfer!
      summary.scanned++

      try {
        const comment = transfer.comment ?? ''
        const telegramId = extractTelegramId(comment)

        if (!telegramId) {
          // Без розпізнаного telegram_id в коментарі зарахувати автоматично
          // неможливо — платіж потребує ручної звірки адміністратором
          // (той самий принцип, що й для нативного TON без memo).
          summary.skipped++
          continue
        }

        const decimals = transfer.jetton?.decimals ?? 6
        const amountUsd = Number(transfer.amount ?? '0') / 10 ** decimals
        // event_id унікальний для всієї події — достатньо для ідемпотентності
        // (унікальний tx_hash у transactions), навіть якщо в одній події
        // кілька actions (малоймовірно для простого переказу).
        const txHash = `jetton:${event.event_id}`

        const { data, error } = await supabase.rpc('credit_deposit', {
          p_telegram_id: telegramId,
          p_first_name: 'TON USDT User',
          p_amount_usd: amountUsd,
          p_network: 'TON_USDT',
          p_wallet_address: transfer.sender?.address ?? '',
          p_tx_hash: txHash,
        })

        if (error) {
          summary.errors.push(`${txHash}: ${error.message}`)
          continue
        }

        const row = Array.isArray(data) ? data[0] : data
        if (row?.credited) {
          summary.credited++
          await notifyUserDeposit(telegramId, amountUsd, 'TON (USDT)')
          await notifyTransactionsChannel(
            `📥 Депозит USDT (TON)\nПользователь: <code>${telegramId}</code>\nСумма: ${amountUsd.toFixed(2)} USDT\nEvent: <code>${event.event_id}</code>`,
          )
        } else {
          summary.skipped++
        }
      } catch (err) {
        console.error('[check-ton-jetton-deposits] transfer processing failed:', event.event_id, err)
        summary.errors.push(`${event.event_id}: ${String(err)}`)
      }
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
