import type { MinerTemplate, UserMiner } from '../types'

/** Стандартна тривалість роботи майнера, днів. */
export const MINER_DURATION_DAYS = 10

/** Стандартний множник повернення за весь строк: 1.5 = 150% від депозиту. */
export const MINER_RETURN_MULTIPLIER = 1.5

/** Депозит безкоштовного майнера, USDT. */
export const FREE_MINER_DEPOSIT_USD = 1.5

const DAY_MS = 24 * 60 * 60 * 1000

type DurationLike = Pick<UserMiner, 'durationDays'>
type CapLike = Pick<UserMiner, 'depositUsd' | 'returnMultiplier'>
type ActivityLike = Pick<UserMiner, 'accruedActiveMs' | 'activeSince' | 'durationDays'>

export function getDurationMs({ durationDays }: DurationLike): number {
  return durationDays * DAY_MS
}

/** Загальна сума, яку майнер виплатить за весь строк (депозит + прибуток). */
export function getCapUsd({ depositUsd, returnMultiplier }: CapLike): number {
  return depositUsd * returnMultiplier
}

/** Швидкість нарахування доходу, USDT/сек. */
export function getRatePerSecond(miner: CapLike & DurationLike): number {
  return getCapUsd(miner) / (miner.durationDays * 24 * 60 * 60)
}

/** Швидкість нарахування доходу, USDT/добу. */
export function getDailyRateUsd(miner: CapLike & DurationLike): number {
  return getRatePerSecond(miner) * DAY_MS / 1000
}

/** Скільки мс майнер фактично пропрацював в активному стані на момент `nowMs`. */
export function getEffectiveActiveMs(miner: ActivityLike, nowMs: number): number {
  const liveMs = miner.activeSince
    ? Math.max(0, nowMs - new Date(miner.activeSince).getTime())
    : 0
  return Math.min(miner.accruedActiveMs + liveMs, getDurationMs(miner))
}

/** Прогрес роботи майнера від 0 до 1. */
export function getProgressRatio(miner: ActivityLike, nowMs: number): number {
  const duration = getDurationMs(miner)
  if (duration <= 0) return 0
  return getEffectiveActiveMs(miner, nowMs) / duration
}

/** Чи майнер вже відпрацював повний строк (нарахування вичерпано). */
export function isMinerCompleted(miner: ActivityLike, nowMs: number): boolean {
  return getEffectiveActiveMs(miner, nowMs) >= getDurationMs(miner)
}

/** Загальна нарахована сума (депозит + прибуток) на момент `nowMs`. */
export function getAccruedUsd(miner: UserMiner, nowMs: number): number {
  return getCapUsd(miner) * getProgressRatio(miner, nowMs)
}

/** Ще не зібрана (доступна для збору) сума. */
export function getUnclaimedUsd(miner: UserMiner, nowMs: number): number {
  return Math.max(0, getAccruedUsd(miner, nowMs) - miner.claimedUsd)
}

/** Ставить майнер на паузу: фіксує накопичений активний час і зупиняє нарахування. */
export function pauseMiner(miner: UserMiner, atMs: number): UserMiner {
  if (!miner.activeSince) return miner
  return {
    ...miner,
    accruedActiveMs: getEffectiveActiveMs(miner, atMs),
    activeSince: null,
    isActive: false,
  }
}

/** Знімає майнер з паузи й відновлює нарахування (якщо строк ще не вичерпано). */
export function resumeMiner(miner: UserMiner, atMs: number): UserMiner {
  if (miner.activeSince) return miner
  if (isMinerCompleted(miner, atMs)) return { ...miner, isActive: false }
  return {
    ...miner,
    activeSince: new Date(atMs).toISOString(),
    isActive: true,
  }
}

/** Створює новий екземпляр free-майнера (виданий за підписку на канал/чат). */
export function createFreeMiner(nowMs = Date.now()): UserMiner {
  return {
    id: 'free-miner',
    userId: 'me',
    templateId: null,
    name: 'Free Miner',
    isFree: true,
    depositUsd: FREE_MINER_DEPOSIT_USD,
    returnMultiplier: MINER_RETURN_MULTIPLIER,
    durationDays: MINER_DURATION_DAYS,
    startedAt: new Date(nowMs).toISOString(),
    accruedActiveMs: 0,
    activeSince: null,
    claimedUsd: 0,
    isActive: false,
  }
}

/** Форматує суму USDT із фіксованою кількістю знаків після коми (за замовчуванням — 6). */
export function formatUsdt(value: number, decimals = 6): string {
  return `${value.toFixed(decimals)} USDT`
}

/** Створює новий екземпляр майнера з куплено шаблону каталогу (ShopTab). */
export function createMinerFromTemplate(template: MinerTemplate, nowMs = Date.now()): UserMiner {
  return {
    id: `${template.id}-${nowMs}`,
    userId: 'me',
    templateId: template.id,
    template,
    name: template.name,
    isFree: false,
    depositUsd: template.depositUsd,
    returnMultiplier: template.returnMultiplier,
    durationDays: template.durationDays,
    startedAt: new Date(nowMs).toISOString(),
    accruedActiveMs: 0,
    activeSince: new Date(nowMs).toISOString(),
    claimedUsd: 0,
    isActive: true,
  }
}

/**
 * TODO: тестові дані для демонстрації UI. У проді список активних майнерів
 * користувача завантажується з таблиці `user_miners` у Supabase.
 */
export function createMockPurchasedMiners(nowMs = Date.now()): UserMiner[] {
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000
  const sixHoursMs = 6 * 60 * 60 * 1000

  return [
    {
      id: 'demo-miner-1',
      userId: 'me',
      templateId: 'template-stellar',
      name: 'Stellar Rig',
      isFree: false,
      depositUsd: 25,
      returnMultiplier: MINER_RETURN_MULTIPLIER,
      durationDays: MINER_DURATION_DAYS,
      startedAt: new Date(nowMs - twoDaysMs).toISOString(),
      accruedActiveMs: twoDaysMs,
      activeSince: new Date(nowMs).toISOString(),
      claimedUsd: 1.2,
      isActive: true,
    },
    {
      id: 'demo-miner-2',
      userId: 'me',
      templateId: 'template-quantum',
      name: 'Quantum Core',
      isFree: false,
      depositUsd: 100,
      returnMultiplier: MINER_RETURN_MULTIPLIER,
      durationDays: MINER_DURATION_DAYS,
      startedAt: new Date(nowMs - sixHoursMs).toISOString(),
      accruedActiveMs: sixHoursMs,
      activeSince: new Date(nowMs).toISOString(),
      claimedUsd: 0,
      isActive: true,
    },
  ]
}
