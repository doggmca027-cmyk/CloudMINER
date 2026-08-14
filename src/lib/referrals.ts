import { supabase } from './supabase'
import { getInitDataOrNull, getStartParam, getTelegramUser, haptic, openTelegramLink } from './telegram'
import type { ReferralListItem, ReferralLevelStats } from '../types'

/**
 * Відсотки реферальних бонусів по рівнях. Тримати синхронізовано з
 * v_level1_rate/v_level2_rate/v_level3_rate у RPC `credit_deposit`
 * (supabase/migrations/*_referral_system.sql).
 */
export const REFERRAL_RATES: Record<1 | 2 | 3, number> = {
  1: 0.1,
  2: 0.05,
  3: 0.02,
}

/**
 * Витягує telegram_id реферера зі стартового параметра Mini App
 * (`?startapp=ref_123456` або команда боту `/start ref_123456` —
 * в обох випадках Telegram передає значення після `ref_` в
 * `initDataUnsafe.start_param`).
 */
export function getReferrerTelegramIdFromStartParam(): number | null {
  const startParam = getStartParam()
  if (!startParam) return null

  const match = startParam.match(/^ref_(\d+)$/)
  if (!match) return null

  const telegramId = Number(match[1])
  return Number.isFinite(telegramId) ? telegramId : null
}

/** Формує реферальне посилання виду https://t.me/bot_username?start=ref_USERID. */
export function buildReferralLink(botUsername: string, telegramId: number): string {
  return `https://t.me/${botUsername}?start=ref_${telegramId}`
}

/** Ділиться реферальним посиланням через нативний діалог пересилки Telegram. */
export function shareReferralLink(link: string, shareText: string): void {
  haptic.impact('light')
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`
  openTelegramLink(shareUrl)
}

interface ReferralStatsRow {
  level: number
  invited_count: number | string
  total_deposited_usd: number | string
}

/** Статистика по 3 рівнях через RPC `get_referral_stats`. Завжди повертає рівно 3 записи (level 1/2/3). */
export async function fetchReferralStats(): Promise<ReferralLevelStats[]> {
  const initData = getInitDataOrNull()
  const { data, error } = initData
    ? await supabase.rpc('get_referral_stats', { p_init_data: initData })
    : { data: null, error: null }
  if (error || !data) {
    // eslint-disable-next-line no-console
    console.warn('[referrals] get_referral_stats не вдався:', error?.message)
    return [1, 2, 3].map((level) => ({ level: level as 1 | 2 | 3, invitedCount: 0, totalDepositedUsd: 0 }))
  }

  const rows = data as ReferralStatsRow[]
  return [1, 2, 3].map((level) => {
    const row = rows.find((r) => r.level === level)
    return {
      level: level as 1 | 2 | 3,
      invitedCount: row ? Number(row.invited_count) : 0,
      totalDepositedUsd: row ? Number(row.total_deposited_usd) : 0,
    }
  })
}

interface ReferralListRow {
  masked_name: string
  total_deposited_usd: number | string
  earned_from_usd: number | string
  joined_at: string
}

/** Список особисто запрошених (рівень 1) через RPC `get_referral_list`. */
export async function fetchReferralList(): Promise<ReferralListItem[]> {
  const initData = getInitDataOrNull()
  const { data, error } = initData
    ? await supabase.rpc('get_referral_list', { p_init_data: initData })
    : { data: null, error: null }
  if (error || !data) {
    // eslint-disable-next-line no-console
    console.warn('[referrals] get_referral_list не вдався:', error?.message)
    return []
  }

  return (data as ReferralListRow[]).map((row) => ({
    maskedName: row.masked_name,
    totalDepositedUsd: Number(row.total_deposited_usd),
    earnedFromUsd: Number(row.earned_from_usd),
    joinedAt: row.joined_at,
  }))
}

/** Telegram-ідентифікатор поточного користувача (з dev-заглушкою поза Telegram). */
export function getCurrentTelegramId(): number | null {
  return getTelegramUser()?.id ?? (import.meta.env.DEV ? 999_000_111 : null)
}
