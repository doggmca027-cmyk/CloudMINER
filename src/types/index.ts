/**
 * Загальні типи даних доменної моделі CloudMiner.
 * Відповідають структурі таблиць у Supabase (PostgreSQL).
 */

/** Валюта операції/балансу. */
export type CurrencyCode = 'USD' | 'USDT' | 'COIN'

/** Тип запису в журналі транзакцій. */
export type TransactionType = 'deposit' | 'withdrawal' | 'referral_bonus' | 'admin_credit'

/** Статус транзакції (депозиту або виводу). */
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'rejected'

/** Мережа переказу. TON_USDT — токен USDT (jetton) у мережі TON, окремо від нативної монети TON. */
export type TransactionNetwork = 'TON' | 'TON_USDT' | 'TRC20'

/** Тип завдання. */
export type TaskType = 'daily' | 'partner' | 'special'

/**
 * Статус виконання завдання користувачем. 'pending' — підписка щойно
 * підтверджена Bot API, але нагорода видається лише через 24 години
 * утримання (див. subscription_checks) — 'completed' лишається для
 * майбутнього daily/special use-case, наразі не використовується.
 */
export type TaskStatus = 'available' | 'pending' | 'in_progress' | 'completed' | 'claimed'

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
  /** Загальна сума реферальних бонусів, зароблених за весь час (3 рівні, лише з депозитів). */
  totalRefEarned: number
  /** Чи є в користувача хоча б один завершений депозит — розблоковує вивід коштів. */
  hasCompletedDeposit: boolean
  /** Права адміністратора — єдине джерело правди server-side, кожен admin_* RPC перевіряє незалежно. */
  isAdmin: boolean
  /** Статус амбассадора реферальної програми. */
  isAmbassador: boolean
  createdAt: string
  updatedAt: string
}

/** Агрегована статистика одного рівня реферальної програми. */
export interface ReferralLevelStats {
  level: 1 | 2 | 3
  invitedCount: number
  totalDepositedUsd: number
}

/** Один запис у списку особисто запрошених (рівень 1). */
export interface ReferralListItem {
  /** Замасковане ім'я/username, напр. "alex***" — повне ім'я сервер не віддає. */
  maskedName: string
  totalDepositedUsd: number
  /** Скільки саме з цього реферала зароблено (10% від його депозитів). */
  earnedFromUsd: number
  joinedAt: string
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
  /** 'subscription' — нагорода лише через 24г утримання (реальна Bot API перевірка); 'click' — миттєво. */
  verificationType: TaskVerificationType
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

// ---------------------------------------------------------------------------
// Адмін-панель
// ---------------------------------------------------------------------------

/** Тип видачі депозиту вручну адміном. */
export type AdminCreditType = 'balance_only' | 'real_deposit'

/** Спосіб перевірки виконання завдання. */
export type TaskVerificationType = 'subscription' | 'click'

/** Рядок статистики амбассадора в адмін-панелі. */
export interface AmbassadorStats {
  telegramId: number
  username?: string | null
  firstName: string
  level1Count: number
  level2Count: number
  level3Count: number
  totalDepositedUsd: number
}

/** Заявка на вивід, що очікує модерації. */
export interface PendingWithdrawal {
  transactionId: string
  telegramId: number
  username?: string | null
  firstName: string
  amountUsd: number
  feeUsd: number
  network: TransactionNetwork
  walletAddress: string
  requestedAt: string
  /** Сума всіх завершених депозитів користувача — сигнал довіри для модератора. */
  userTotalDepositedUsd: number
}

/** Завдання в адмін-списку управління завданнями. */
export interface AdminTask {
  id: string
  title: string
  actionUrl?: string | null
  rewardUsd: number
  verificationType: TaskVerificationType
  isActive: boolean
  sortOrder: number
}
