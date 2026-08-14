// Deno Edge Function: check-tron-deposits
//
// Опитує TronGrid на вхідні TRC-20 USDT-перекази на гаманець проєкту.
//
// ⚠️ ВАЖЛИВЕ ОБМЕЖЕННЯ, на відміну від TON: TRC-20-перекази USDT — це
// виклики смарт-контракту (TRC-20 Transfer), а НЕ звичайні перекази, і не
// мають довільного текстового memo/comment. Прочитати telegram_id
// напряму з такого платежу неможливо — Tron просто не передбачає для
// цього поля. Тому ця функція не читає жоден "коментар": замість цього
// вона зіставляє вхідну суму з `deposit_intents` — записом, який клієнт
// заздалегідь створює через RPC `create_deposit_intent` (DepositPanel
// показує користувачу ТОЧНУ суму на кшталт "10.000427 USDT" замість
// круглої "10 USDT" саме для цього зіставлення). Перекази, для яких
// відповідного pending-наміру не знайдено, зараховані НЕ будуть — вони
// просто логуються для ручної звірки адміністратором.
//
// ЗАПУСК: так само, як check-ton-deposits — за розкладом (Dashboard →
// Edge Functions → Cron, або pg_cron + pg_net), не з клієнта.
//
// СЕКРЕТИ (supabase secrets set ...):
//   TRC20_WALLET_ADDRESS       — той самий гаманець, що VITE_DEPOSIT_ADDRESS_TRC20 у .env
//   TRONGRID_API_KEY           — опційно, підвищує ліміти TronGrid
//   TELEGRAM_BOT_TOKEN / TELEGRAM_TRANSACTIONS_CHANNEL_ID — як у check-ton-deposits
//
// ⚠️ Так само, як у check-ton-deposits: поля відповіді TronGrid нижче
// відповідають публічній документації на момент написання, але я не міг
// перевірити це проти живого API з цього середовища — звірте з
// https://developers.tron.network/reference/get-trc20-transaction-info-by-account-address
// перед продом.

import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts'
import { notifyTransactionsChannel, notifyUserDeposit } from '../_shared/telegram.ts'

/** Офіційний контракт USDT у мережі Tron (мейннет), стабільний, добре відомий. */
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

/**
 * Ширина вікна для попереднього ВИБОРУ кандидатів із deposit_intents —
 * НЕ критерій збігу (той — точна рівність у цілих одиницях токена, див.
 * нижче). Тримається ширшою за крок унікального "хвоста" в
 * create_deposit_intent (0.000001–0.000999), щоб гарантовано захопити
 * потрібний намір навіть на межі округлення.
 */
const CANDIDATE_WINDOW_USD = 0.001

interface TronGridTransfer {
  transaction_id: string
  from: string
  to: string
  value: string
  token_info?: { symbol?: string; decimals?: number }
}

interface TronGridResponse {
  data?: TronGridTransfer[]
  success?: boolean
}

async function fetchIncomingUsdtTransfers(walletAddress: string): Promise<TronGridTransfer[]> {
  const apiKey = Deno.env.get('TRONGRID_API_KEY')
  const url =
    `https://api.trongrid.io/v1/accounts/${walletAddress}/transactions/trc20` +
    `?limit=20&only_to=true&contract_address=${USDT_TRC20_CONTRACT}`

  const res = await fetch(url, {
    headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined,
  })
  if (!res.ok) {
    throw new Error(`TronGrid error: HTTP ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as TronGridResponse
  return (data.data ?? []).filter((t) => t.token_info?.symbol === 'USDT')
}

Deno.serve(async (_req) => {
  const walletAddress = Deno.env.get('TRC20_WALLET_ADDRESS')
  if (!walletAddress) {
    return jsonResponse({ error: 'TRC20_WALLET_ADDRESS не налаштовано в секретах функції' }, 500)
  }

  const supabase = createSupabaseAdminClient()
  const summary = { scanned: 0, credited: 0, unmatched: 0, errors: [] as string[] }

  let transfers: TronGridTransfer[]
  try {
    transfers = await fetchIncomingUsdtTransfers(walletAddress)
  } catch (err) {
    console.error('[check-tron-deposits] fetch failed:', err)
    return jsonResponse({ error: String(err) }, 502)
  }

  summary.scanned = transfers.length
  if (transfers.length === 0) {
    return jsonResponse(summary)
  }

  for (const transfer of transfers) {
    try {
      const decimals = transfer.token_info?.decimals ?? 6
      const amountUsd = Number(transfer.value) / 10 ** decimals
      // Точна сума в цілих одиницях токена (як прийшла з TronGrid) — жодних
      // помилок округлення double, на відміну від `amountUsd` вище (той
      // лишається тільки для логів/сповіщень).
      const transferUnits = BigInt(transfer.value)

      // Кандидати в невеликому вікні навколо суми — саме вікно (для
      // ефективності запиту, щоб не сканувати всі pending-наміри) НЕ є
      // критерієм збігу: остаточне зіставлення нижче робиться ТОЧНОЮ
      // рівністю в цілих одиницях, а не належністю до цього діапазону.
      // Раніше `.gte/.lte` з `AMOUNT_MATCH_TOLERANCE_USD` (0.000001) саме й
      // БУВ критерієм збігу — а оскільки унікальний "хвіст" у
      // create_deposit_intent генерується кроком в ту саму 0.000001, вікно
      // могло накрити відразу ДВА різні pending-наміри різних користувачів,
      // і `.limit(1)` за `created_at` довільно обирав один з них — тобто
      // чужий платіж міг зарахуватись не тому користувачу. Унікальний
      // індекс `deposit_intents_pending_amount_key` гарантує не більше
      // одного pending-наміру з ТОЧНО такою сумою — точна рівність нижче
      // просто повертає цю гарантію.
      const { data: candidates, error: intentError } = await supabase
        .from('deposit_intents')
        .select('id, user_id, expected_amount_usd')
        .eq('network', 'TRC20')
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .gte('expected_amount_usd', amountUsd - CANDIDATE_WINDOW_USD)
        .lte('expected_amount_usd', amountUsd + CANDIDATE_WINDOW_USD)
        .order('created_at', { ascending: true })

      if (intentError) {
        summary.errors.push(`${transfer.transaction_id}: ${intentError.message}`)
        continue
      }

      const intent = (candidates ?? []).find(
        (c) => BigInt(Math.round(Number(c.expected_amount_usd) * 10 ** decimals)) === transferUnits,
      )
      if (!intent) {
        // Немає збігу — платіж отримано, але привʼязати до користувача
        // автоматично неможливо (див. коментар угорі файлу). Потребує
        // ручної звірки.
        summary.unmatched++
        await notifyTransactionsChannel(
          `⚠️ Незіставлений TRC-20 депозит\nСумма: ${amountUsd} USDT\nВід: <code>${transfer.from}</code>\nHash: <code>${transfer.transaction_id}</code>`,
        )
        continue
      }

      // Дізнаємось telegram_id власника наміру для credit_deposit.
      const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('id', intent.user_id)
        .single()

      if (userError || !userRow) {
        summary.errors.push(`${transfer.transaction_id}: не знайдено користувача наміру ${intent.id}`)
        continue
      }

      const { data: creditData, error: creditError } = await supabase.rpc('credit_deposit', {
        p_telegram_id: userRow.telegram_id,
        p_first_name: 'TRC20 User',
        p_amount_usd: amountUsd,
        p_network: 'TRC20',
        p_wallet_address: transfer.from,
        p_tx_hash: transfer.transaction_id,
      })

      if (creditError) {
        summary.errors.push(`${transfer.transaction_id}: ${creditError.message}`)
        continue
      }

      const row = Array.isArray(creditData) ? creditData[0] : creditData

      // Намір відпрацював незалежно від того, чи credit_deposit щойно
      // зарахував баланс, чи цей tx_hash вже було оброблено раніше —
      // головне, що збіг суми знайдено і намір більше не "висить" pending.
      await supabase
        .from('deposit_intents')
        .update({ status: 'matched', matched_transaction_id: row?.transaction_id ?? null })
        .eq('id', intent.id)

      if (row?.credited) {
        summary.credited++
        await notifyUserDeposit(userRow.telegram_id, amountUsd, 'TRC20')
        await notifyTransactionsChannel(
          `📥 Депозит TRC-20\nПользователь: <code>${userRow.telegram_id}</code>\nСумма: ${amountUsd.toFixed(6)} USDT\nHash: <code>${transfer.transaction_id}</code>`,
        )
      }
    } catch (err) {
      console.error('[check-tron-deposits] transfer processing failed:', transfer.transaction_id, err)
      summary.errors.push(`${transfer.transaction_id}: ${String(err)}`)
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
