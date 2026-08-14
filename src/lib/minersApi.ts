import { supabase } from './supabase'
import { getInitDataOrNull } from './telegram'
import type { UserMiner } from '../types'

/**
 * Реальний бекенд для куплених майнерів (на відміну від free-майнера, який
 * і далі живе лише в MiningTab — не прив'язаний до депозиту/виводу). RPC —
 * `list_user_miners`/`purchase_miner`/`claim_miner_income`, див.
 * supabase/migrations/20260818093000_mining_shop_tasks_rpc.sql.
 */

interface UserMinerRow {
  id: string
  template_id: string | null
  name: string
  is_free: boolean
  deposit_usd: number | string
  return_multiplier: number | string
  duration_days: number
  started_at: string
  accrued_active_ms: number | string
  active_since: string | null
  claimed_usd: number | string
  is_active: boolean
}

function mapUserMinerRow(row: UserMinerRow): UserMiner {
  return {
    id: row.id,
    userId: '',
    templateId: row.template_id,
    name: row.name,
    isFree: row.is_free,
    depositUsd: Number(row.deposit_usd),
    returnMultiplier: Number(row.return_multiplier),
    durationDays: row.duration_days,
    startedAt: row.started_at,
    accruedActiveMs: Number(row.accrued_active_ms),
    activeSince: row.active_since,
    claimedUsd: Number(row.claimed_usd),
    isActive: row.is_active,
  }
}

/** Майнери поточного користувача. Порожній список поза Telegram (немає initData) — не помилка. */
export async function listUserMiners(): Promise<UserMiner[]> {
  const initData = getInitDataOrNull()
  if (!initData) return []

  const { data, error } = await supabase.rpc('list_user_miners', { p_init_data: initData })
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[minersApi] list_user_miners не вдався:', error.message)
    return []
  }
  return ((data ?? []) as UserMinerRow[]).map(mapUserMinerRow)
}

export interface PurchaseMinerResult {
  success: boolean
  minerId?: string
  newBalanceUsd?: number
  error?: string
}

/** Купує майнер за шаблоном каталогу — реально списує баланс на сервері (RPC `purchase_miner`). */
export async function purchaseMinerRpc(templateId: string): Promise<PurchaseMinerResult> {
  const initData = getInitDataOrNull()
  if (!initData) return { success: false, error: 'no_telegram_user' }

  const { data, error } = await supabase.rpc('purchase_miner', {
    p_init_data: initData,
    p_template_id: templateId,
  })
  if (error) return { success: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  return {
    success: true,
    minerId: row?.miner_id,
    newBalanceUsd: row ? Number(row.new_balance_usd) : undefined,
  }
}

export interface ClaimMinerResult {
  success: boolean
  claimedUsd?: number
  newBalanceUsd?: number
  error?: string
}

/** Переводить накопичений дохід майнера на баланс — реально нараховує на сервері (RPC `claim_miner_income`). */
export async function claimMinerIncomeRpc(minerId: string): Promise<ClaimMinerResult> {
  const initData = getInitDataOrNull()
  if (!initData) return { success: false, error: 'no_telegram_user' }

  const { data, error } = await supabase.rpc('claim_miner_income', {
    p_init_data: initData,
    p_miner_id: minerId,
  })
  if (error) return { success: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  return {
    success: true,
    claimedUsd: row ? Number(row.claimed_usd) : 0,
    newBalanceUsd: row ? Number(row.new_balance_usd) : undefined,
  }
}
