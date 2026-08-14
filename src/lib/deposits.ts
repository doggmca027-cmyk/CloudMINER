import { supabase } from './supabase'
import { getInitDataOrNull, getTelegramUser } from './telegram'

/** Мінімальна сума депозиту, USDT. Тримати синхронізовано з RPC credit_deposit / create_deposit_intent. */
export const MIN_DEPOSIT_USD = 5

/**
 * TON — нативна монета TON; TON_USDT — токен USDT (jetton) у тій самій
 * мережі TON, той самий гаманець, атрибуція через memo/comment, як і TON.
 * TRC20 — USDT без memo, атрибуція через deposit_intents (exact-amount).
 */
export type DepositNetwork = 'TON' | 'TON_USDT' | 'TRC20'

/** Мережі, де немає поля коментаря — вимагають "намір депозиту" з точною сумою. */
export type ExactAmountNetwork = 'TRC20'

export interface DepositIntentResult {
  success: boolean
  intentId?: string
  /** Точна сума з унікальним "хвостом" — саме її треба надіслати, щоб платіж розпізнали автоматично. */
  exactAmountUsd?: number
  expiresAt?: string
  error?: string
}

/**
 * Створює "намір депозиту" для мережі TRC-20 через RPC `create_deposit_intent`
 * (SECURITY DEFINER, безпечно викликати з anon-ключа — вона лише ставить
 * запис-очікування в чергу, не чіпає нічий баланс; ідентичність все одно
 * перевіряється підписом initData, а не довіреним параметром). TRC-20
 * USDT-перекази не мають вільного memo (на відміну від TON), тож
 * check-tron-deposits зіставляє вхідний платіж із цим наміром за ТОЧНОЮ
 * сумою — тому в DepositPanel користувачу показується не кругла сума, а
 * `exactAmountUsd`.
 */
export async function createDepositIntent(
  baseAmountUsd: number,
  network: ExactAmountNetwork,
): Promise<DepositIntentResult> {
  const initData = getInitDataOrNull()
  if (!initData) {
    return { success: false, error: 'no_telegram_user' }
  }

  const { data, error } = await supabase.rpc('create_deposit_intent', {
    p_init_data: initData,
    p_base_amount_usd: baseAmountUsd,
    p_network: network,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { success: false, error: 'empty_response' }

  return {
    success: true,
    intentId: row.intent_id,
    exactAmountUsd: Number(row.exact_amount_usd),
    expiresAt: row.expires_at,
  }
}

/** Telegram-ідентифікатор поточного користувача — саме його треба вказати в comment/memo TON-перекладу. */
export function getDepositMemoTelegramId(): number | null {
  const telegramUser = getTelegramUser()
  return telegramUser?.id ?? (import.meta.env.DEV ? 999_000_111 : null)
}
