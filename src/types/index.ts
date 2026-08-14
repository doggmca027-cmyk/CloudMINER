/**
 * Загальні типи даних доменної моделі CloudMiner.
 * Відповідають структурі таблиць у Supabase (PostgreSQL).
 */

/** Валюта операції/балансу. */
export type CurrencyCode = 'USD' | 'USDT' | 'COIN'

/** Тип запису в журналі транзакцій. */
export type TransactionType = 'deposit' | 'withdrawal'

/** Статус транзакції (депозиту або виводу). */
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'rejected'

/** Мережа переказу. */
export type TransactionNetwork = 'TON' | 'TRC20'

/** Тип завдання. */
export type TaskType = 'daily' | 'partner' | 'special'

/** Статус виконання завдання користувачем. */
export type TaskStatus = 'available' | 'in_progress' | 'completed' | 'claimed'

/** Користувач застосунку (профіль, пов'язаний із Telegram-акаунтом). */
export interface User {
  id: string
  telegramId: number
  username?: string
  firstName: string
  lastName?: string
  photoUrl?: string
  languageCode: string
  balanceUsd: number
  balanceCoin: number
  totalIncome: number
  isVip: boolean
  referralCode: string
  referredBy?: string | null
  /** Чи є в користувача хоча б один завершений депозит — розблоковує вивід коштів. */
  hasCompletedDeposit: boolean
  createdAt: string
  updatedAt: string
}

/** Шаблон майнера, доступний у каталозі для покупки (модель 10 днів / 150%). */
export interface MinerTemplate {
  id: string
  name: string
  description: string
  imageUrl: string
  /** Сума депозиту для покупки цього майнера, USDT. */
  depositUsd: number
  /** Множник повернення за весь строк роботи, напр. 1.5 = 150% від депозиту. */
  returnMultiplier: number
  /** Тривалість роботи майнера в днях. */
  durationDays: number
  isVip: boolean
  isActive: boolean
  sortOrder: number
}

/**
 * Придбаний користувачем екземпляр майнера.
 * Дохід нараховується рівномірно протягом `durationDays` до суми
 * `depositUsd * returnMultiplier`, і зупиняється, коли майнер неактивний
 * (наприклад, free-майнер заморожується без підписки на канал/чат).
 */
export interface UserMiner {
  id: string
  userId: string
  templateId: string | null
  template?: MinerTemplate
  /** Назва для відображення в картці. */
  name: string
  /** Чи це безкоштовний майнер, виданий за підписку. */
  isFree: boolean
  /** Сума депозиту, USDT. */
  depositUsd: number
  /** Множник повернення за весь строк, напр. 1.5 = 150%. */
  returnMultiplier: number
  /** Тривалість роботи майнера в днях. */
  durationDays: number
  /** Момент видачі/покупки майнера (ISO). */
  startedAt: string
  /** Скільки мс майнер вже пропрацював в активному стані (накопичено до останньої паузи). */
  accruedActiveMs: number
  /** Момент останнього відновлення нарахувань; null, якщо зараз на паузі/заморожений. */
  activeSince: string | null
  /** Скільки USDT вже зібрано (переведено на баланс користувача). */
  claimedUsd: number
  /** Чи наразі активний (триває нарахування доходу). */
  isActive: boolean
}

/** Завдання (щоденне / партнерське / спеціальне) для отримання нагороди. */
export interface Task {
  id: string
  type: TaskType
  title: string
  description: string
  iconUrl?: string
  rewardUsd: number
  rewardCoin: number
  actionUrl?: string
  status: TaskStatus
  isActive: boolean
  sortOrder: number
}

/** Запис у журналі транзакцій (депозит або вивід коштів). */
export interface Transaction {
  id: string
  userId: string
  type: TransactionType
  network: TransactionNetwork | null
  amountUsd: number
  feeUsd: number
  currency: CurrencyCode
  /** Депозит: адреса відправника. Вивід: адреса отримувача. */
  walletAddress?: string | null
  /** Хеш транзакції в блокчейні (депозити) — null для заявок на вивід. */
  txHash?: string | null
  status: TransactionStatus
  comment?: string | null
  createdAt: string
  processedAt?: string | null
}
