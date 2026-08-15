import { supabase } from './supabase'
import { getInitDataOrNull } from './telegram'

/** Мінімальна сума виводу, USDT. Тримати синхронізовано з RPC `request_withdrawal`. */
export const MIN_WITHDRAWAL_USD = 2

/** Комісія за вивід, частка від суми (0.10 = 10%). Тримати синхронізовано з RPC. */
export const WITHDRAWAL_FEE_RATE = 0.1

/** Вивід дозволений лише в мережі TON (USDT-jetton) — TRC-20 прибрано з виводу. */
export type WithdrawalNetwork = 'TON'

export function getWithdrawalFeeUsd(amountUsd: number): number {
  return amountUsd * WITHDRAWAL_FEE_RATE
}

export function getWithdrawalNetAmountUsd(amountUsd: number): number {
  return Math.max(0, amountUsd - getWithdrawalFeeUsd(amountUsd))
}

/** Дуже наближена перевірка формату TON-адреси (raw або user-friendly base64url). */
export function isValidTonAddress(address: string): boolean {
  const trimmed = address.trim()
  return /^(-1|0):[a-fA-F0-9]{64}$/.test(trimmed) || /^[A-Za-z0-9_-]{48}$/.test(trimmed)
}

export function isValidWithdrawalAddress(address: string, network: WithdrawalNetwork): boolean {
  return network === 'TON' && isValidTonAddress(address)
}

export interface WithdrawalRequestInput {
  amountUsd: number
  walletAddress: string
  network: WithdrawalNetwork
}

export interface WithdrawalRequestResult {
  success: boolean
  id?: string
  error?: string
}

/**
 * Створює заявку на вивід через RPC `request_withdrawal` (SECURITY DEFINER,
 * див. supabase/migrations/*_transactions_ledger.sql та
 * 20260818091000_migrate_rpcs_to_init_data.sql). RPC сам перевіряє підпис
 * initData (звідти й бере реальний telegram_id — підмінити чужий акаунт
 * підміною параметра з DevTools більше не можна), знаходить або створює
 * рядок у `users`, перевіряє deposit-lock (кидає виняток `deposit_required`,
 * якщо в користувача ще немає жодного завершеного депозиту — див.
 * {@link isDepositRequiredError}) і вставляє рядок у `transactions` зі
 * статусом `pending`.
 */
export async function createWithdrawalRequest(
  input: WithdrawalRequestInput,
): Promise<WithdrawalRequestResult> {
  const initData = getInitDataOrNull()
  if (!initData) {
    return { success: false, error: 'no_telegram_user' }
  }

  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_init_data: initData,
    p_amount_usd: input.amountUsd,
    p_wallet_address: input.walletAddress.trim(),
    p_network: input.network,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const row = Array.isArray(data) ? data[0] : data
  return { success: true, id: row?.id }
}

/** Чи це помилка "потрібен хоча б один завершений депозит" від RPC `request_withdrawal`. */
export function isDepositRequiredError(errorMessage: string | undefined): boolean {
  return Boolean(errorMessage?.includes('deposit_required'))
}
