// Deno Edge Function: check-ton-deposits
//
// Опитує TonAPI (https://tonapi.io) на вхідні транзакції на гаманець
// проєкту, читає telegram_id з comment/memo, конвертує суму TON у USDT за
// поточним курсом і атомарно зараховує депозит через RPC credit_deposit.
//
// ЗАПУСК: цю функцію ніхто не викликає з клієнта. Плануйте періодичний
// виклик (раз на 30–60с) через Supabase Dashboard → Edge Functions → Cron,
// або через `pg_cron` + `pg_net`:
//   select cron.schedule('check-ton-deposits', '* * * * *', $$
//     select net.http_post(
//       url := 'https://<project-ref>.supabase.co/functions/v1/check-ton-deposits',
//       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
//     );
//   $$);
//
// СЕКРЕТИ (supabase secrets set ...):
//   TON_WALLET_ADDRESS         — той самий гаманець, що VITE_DEPOSIT_ADDRESS_TON у .env
//   TONAPI_KEY                 — опційно, підвищує ліміти tonapi.io (без нього теж працює)
//   TELEGRAM_BOT_TOKEN         — для сповіщення користувача
//   TELEGRAM_TRANSACTIONS_CHANNEL_ID — опційно, для сповіщення в канал транзакцій
//
// ⚠️ Поля відповіді TonAPI нижче (in_msg.decoded_body.text, in_msg.value
// тощо) відповідають публічній документації TonAPI v2 на момент написання,
// але я не міг це протестувати проти живого API з цього середовища —
// звірте з https://tonapi.io/api-v2 перед продом і за потреби підправте
// `extractComment`/`extractAmountNanoTon`.

import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts'
import { notifyTransactionsChannel, notifyUserDeposit } from '../_shared/telegram.ts'
import { fetchTonUsdRateSafe } from '../_shared/rate.ts'

const NANO_TON = 1_000_000_000

interface TonApiTransaction {
  hash: string
  in_msg?: {
    source?: { address?: string }
    destination?: { address?: string }
    value?: number
    decoded_body?: { text?: string }
    decoded_op_name?: string
    message?: string
  }
}

interface TonApiTransactionsResponse {
  transactions?: TonApiTransaction[]
}

function extractComment(tx: TonApiTransaction): string {
  return tx.in_msg?.decoded_body?.text ?? tx.in_msg?.message ?? ''
}

/**
 * Витягує telegram_id з коментаря — коментар МАЄ складатись рівно з цифр
 * (те саме, що DepositPanel копіює в буфер обміну, без жодного зайвого
 * тексту). Раніше тут був `/\d{5,15}/` без прив'язки до меж рядка, який
 * підхоплював ПЕРШЕ число будь-де в коментарі — якщо гаманець користувача
 * дописував свій службовий текст (напр. "TX-202608141822 987654321"),
 * депозит міг зарахуватись на чужий/неіснуючий акаунт. Якщо в коментарі є
 * щось окрім цифр — краще не вгадувати й лишити платіж на ручну звірку
 * (гілка `!telegramId` нижче), ніж ризикнути неправильною атрибуцією.
 */
function extractTelegramId(comment: string): number | null {
  const trimmed = comment.trim()
  return /^\d{5,15}$/.test(trimmed) ? Number(trimmed) : null
}

async function fetchIncomingTransactions(walletAddress: string): Promise<TonApiTransaction[]> {
  const apiKey = Deno.env.get('TONAPI_KEY')
  const res = await fetch(
    `https://tonapi.io/v2/blockchain/accounts/${walletAddress}/transactions?limit=20`,
    {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    },
  )
  if (!res.ok) {
    throw new Error(`TonAPI error: HTTP ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as TonApiTransactionsResponse
  return (data.transactions ?? []).filter(
    (tx) => tx.in_msg && tx.in_msg.value && tx.in_msg.value > 0,
  )
}

Deno.serve(async (_req) => {
  const walletAddress = Deno.env.get('TON_WALLET_ADDRESS')
  if (!walletAddress) {
    return jsonResponse({ error: 'TON_WALLET_ADDRESS не налаштовано в секретах функції' }, 500)
  }

  const supabase = createSupabaseAdminClient()
  const summary = { scanned: 0, credited: 0, skipped: 0, errors: [] as string[] }

  let transactions: TonApiTransaction[]
  try {
    transactions = await fetchIncomingTransactions(walletAddress)
  } catch (err) {
    console.error('[check-ton-deposits] fetch failed:', err)
    return jsonResponse({ error: String(err) }, 502)
  }

  summary.scanned = transactions.length
  if (transactions.length === 0) {
    return jsonResponse(summary)
  }

  const tonUsdRate = await fetchTonUsdRateSafe()

  for (const tx of transactions) {
    try {
      const comment = extractComment(tx)
      const telegramId = extractTelegramId(comment)

      if (!telegramId) {
        // Без розпізнаного telegram_id в memo зарахувати автоматично
        // неможливо — платіж потребує ручної звірки адміністратором.
        summary.skipped++
        continue
      }

      const amountTon = (tx.in_msg?.value ?? 0) / NANO_TON
      const amountUsd = amountTon * tonUsdRate

      const { data, error } = await supabase.rpc('credit_deposit', {
        p_telegram_id: telegramId,
        p_first_name: 'TON User',
        p_amount_usd: amountUsd,
        p_network: 'TON',
        p_wallet_address: tx.in_msg?.source?.address ?? '',
        p_tx_hash: tx.hash,
      })

      if (error) {
        summary.errors.push(`${tx.hash}: ${error.message}`)
        continue
      }

      const row = Array.isArray(data) ? data[0] : data
      if (row?.credited) {
        summary.credited++
        await notifyUserDeposit(telegramId, amountUsd, 'TON')
        await notifyTransactionsChannel(
          `📥 Депозит TON\nПользователь: <code>${telegramId}</code>\nСумма: ${amountUsd.toFixed(2)} USDT (${amountTon.toFixed(4)} TON)\nHash: <code>${tx.hash}</code>`,
        )
      } else {
        // Або вже було зараховано раніше (повторне опитування того самого
        // tx_hash), або сума нижча мінімуму — в обох випадках не помилка.
        summary.skipped++
      }
    } catch (err) {
      console.error('[check-ton-deposits] tx processing failed:', tx.hash, err)
      summary.errors.push(`${tx.hash}: ${String(err)}`)
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
