import { supabase } from './supabase'
import type { AppSettings } from '../types'

/**
 * Публічний (без адмін-прав) читальний доступ до глобальних промо-
 * налаштувань — RPC `get_app_settings` (SECURITY DEFINER, singleton-рядок
 * `app_settings`). Використовується і звичайними вкладками (ShopTab —
 * показати знижену ціну, DepositPanel — показати бонус), і самою
 * адмінкою (SettingsSection — підвантажити поточні значення у форму).
 * Нічого чутливого тут немає, тож жодного initData не потрібно.
 */
interface AppSettingsRow {
  shop_discount_enabled: boolean
  shop_discount_percent: number | string
  deposit_bonus_enabled: boolean
  deposit_bonus_percent: number | string
}

function mapAppSettingsRow(row: AppSettingsRow): AppSettings {
  return {
    shopDiscountEnabled: row.shop_discount_enabled,
    shopDiscountPercent: Number(row.shop_discount_percent),
    depositBonusEnabled: row.deposit_bonus_enabled,
    depositBonusPercent: Number(row.deposit_bonus_percent),
  }
}

/** Дефолт (усе вимкнено) — і для "поза Telegram", і як безпечний фолбек при збої мережі. */
const DISABLED_SETTINGS: AppSettings = {
  shopDiscountEnabled: false,
  shopDiscountPercent: 0,
  depositBonusEnabled: false,
  depositBonusPercent: 0,
}

export async function getAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.rpc('get_app_settings')
  if (error || !data) {
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[appSettings] get_app_settings не вдався:', error.message)
    }
    return DISABLED_SETTINGS
  }
  const row = Array.isArray(data) ? data[0] : data
  return row ? mapAppSettingsRow(row as AppSettingsRow) : DISABLED_SETTINGS
}

/** Рахує ціну ПІСЛЯ знижки (від price/amount, як задокументовано на сервері в purchase_miner). */
export function applyDiscount(priceUsd: number, discountPercent: number): number {
  return Math.round(priceUsd * (1 - discountPercent / 100) * 1e6) / 1e6
}

/** Рахує суму бонусу від суми поповнення (та сама формула, що credit_deposit на сервері). */
export function calcDepositBonus(amountUsd: number, bonusPercent: number): number {
  return Math.round(amountUsd * (bonusPercent / 100) * 1e6) / 1e6
}
