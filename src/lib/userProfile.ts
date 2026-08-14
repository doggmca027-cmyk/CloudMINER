import { supabase } from './supabase'
import { getInitDataOrNull } from './telegram'
import { getReferrerTelegramIdFromStartParam } from './referrals'
import type { User } from '../types'

interface UserRow {
  id: string
  telegram_id: number
  username: string | null
  first_name: string
  last_name: string | null
  photo_url: string | null
  language_code: string
  balance_usd: number | string
  balance_coin: number | string
  total_income: number | string
  is_vip: boolean
  referral_code: string
  referred_by: string | null
  total_ref_earned: number | string
  has_completed_deposit: boolean
  is_admin: boolean
  is_ambassador: boolean
  created_at: string
  updated_at: string
}

function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    username: row.username ?? undefined,
    firstName: row.first_name,
    lastName: row.last_name ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    languageCode: row.language_code,
    balanceUsd: Number(row.balance_usd),
    balanceCoin: Number(row.balance_coin),
    totalIncome: Number(row.total_income),
    isVip: row.is_vip,
    referralCode: row.referral_code,
    referredBy: row.referred_by,
    totalRefEarned: Number(row.total_ref_earned),
    hasCompletedDeposit: row.has_completed_deposit,
    isAdmin: row.is_admin,
    isAmbassador: row.is_ambassador,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Завантажує (або створює) профіль поточного користувача через RPC
 * `get_or_create_user` (SECURITY DEFINER, див.
 * supabase/migrations/*_get_or_create_user.sql та
 * 20260818091000_migrate_rpcs_to_init_data.sql) — так само, як і
 * `request_withdrawal`, це обходить потребу відкривати anon-ключу прямий
 * SELECT/INSERT на таблицю `users` (що дозволило б будь-кому читати чужі
 * баланси через RLS-політику "using (true)").
 *
 * Ідентичність береться НЕ з клієнтського параметра, а з підпису initData —
 * RPC сам перевіряє його й дістає telegram_id/ім'я/username із верифікованих
 * даних (`verify_telegram_init_data`), тож підмінити чужий акаунт підміною
 * значення в DevTools більше не можна.
 *
 * Поза Telegram (напр. `npm run dev` у звичайному браузері) підписаного
 * initData не існує — профіль просто не завантажується (повертає null),
 * так само, як і раніше для "немає telegram-користувача".
 */
export async function loadUserProfile(): Promise<User | null> {
  const initData = getInitDataOrNull()
  if (!initData) return null

  // Реферер береться зі start_param (?startapp=ref_123 / бот-команда
  // /start ref_123) — RPC сам ігнорує його, якщо користувач уже існував
  // раніше (referred_by фіксується лише при першому створенні рядка).
  const referrerTelegramId = getReferrerTelegramIdFromStartParam()

  const { data, error } = await supabase.rpc('get_or_create_user', {
    p_init_data: initData,
    p_referrer_telegram_id: referrerTelegramId,
  })

  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[userProfile] get_or_create_user не вдався:', error.message)
    return null
  }

  const row = Array.isArray(data) ? data[0] : data
  return row ? mapUserRow(row as UserRow) : null
}

/**
 * Зберігає вибір мови користувача (LanguageSelector) у `users.language_code`
 * через RPC `update_user_language` (SECURITY DEFINER) — так само, як і
 * решта RPC у проєкті, anon-ключ не має прямого UPDATE на `users`, тільки
 * до цієї вузько окресленої функції, яка змінює виключно language_code.
 * Викликається "fire-and-forget" з UI — локальний i18next-стан і так уже
 * змінився, а ця функція лише синхронізує вибір із бекендом на майбутнє.
 */
export async function updateUserLanguage(languageCode: string): Promise<boolean> {
  const initData = getInitDataOrNull()
  if (!initData) return false

  const { error } = await supabase.rpc('update_user_language', {
    p_init_data: initData,
    p_language_code: languageCode,
  })

  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[userProfile] update_user_language не вдався:', error.message)
    return false
  }
  return true
}
