import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { MinerTemplate, User, UserMiner } from '../types'
import { createMinerFromTemplate, createMockPurchasedMiners } from '../lib/mining'
import { checkSubscription, type SubscriptionStatus } from '../lib/subscription'
import { getTelegramUser, haptic } from '../lib/telegram'
import { loadUserProfile } from '../lib/userProfile'

interface UserStateContextValue {
  /** Профіль користувача, завантажений з Supabase (null, доки не завантажено). */
  user: User | null
  loadingUser: boolean
  /** Завантажує (або створює) профіль користувача й підтягує його баланс. Викликається з App.tsx при старті. */
  loadUser: () => Promise<void>
  /** Підтверджений баланс користувача, USDT. */
  balanceUsd: number
  /** Куплені майнери (без урахування free-майнера — той живе локально в MiningTab). */
  miners: UserMiner[]
  addBalance: (amount: number) => void
  /** Переводить накопичений дохід конкретного майнера на баланс. */
  claimMiner: (minerId: string, amount: number) => void
  /**
   * Списує вартість шаблону з балансу й додає новий майнер у список.
   * Повертає `false`, якщо коштів на балансі недостатньо.
   */
  purchaseMiner: (template: MinerTemplate) => boolean
  /** Списує довільну суму з балансу (напр. після заявки на вивід). Повертає `false`, якщо коштів недостатньо. */
  spendBalance: (amount: number) => boolean
  /** Статус підписки на офіційний канал/чат (гейт для free-майнера, TasksTab). */
  subscription: SubscriptionStatus
  checkingSubscription: boolean
  /** Перевіряє підписку заново й оновлює `subscription`. Спільна для MiningTab і TasksTab. */
  refreshSubscription: () => Promise<void>
  /** Id завдань (партнерських), за які вже нараховано винагороду. */
  completedTaskIds: string[]
  /** Зараховує винагороду за завдання один раз. Повертає `false`, якщо вже зараховано. */
  claimTaskReward: (taskId: string, rewardUsd: number) => boolean
}

const UserStateContext = createContext<UserStateContextValue | null>(null)

/**
 * TODO: список майнерів і виконані завдання поки живуть лише в пам'яті
 * клієнта (mock-дані) — у проді вони так само завантажуються з Supabase
 * (`user_miners`, `user_tasks`) і синхронізуються через API/Realtime.
 * Баланс (`balanceUsd`) вже гідрується реальним значенням з `users.balance_usd`
 * через RPC `get_or_create_user` (див. loadUser), але подальші локальні
 * зміни (claim/purchase/spend) поки не записуються назад у Supabase.
 */
export function UserStateProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const [balanceUsd, setBalanceUsd] = useState(0)
  const [miners, setMiners] = useState<UserMiner[]>(() => createMockPurchasedMiners())
  const [subscription, setSubscription] = useState<SubscriptionStatus>({
    channel: false,
    chat: false,
  })
  const [checkingSubscription, setCheckingSubscription] = useState(false)
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([])

  const loadUser = useCallback(async () => {
    setLoadingUser(true)
    try {
      const profile = await loadUserProfile()
      if (profile) {
        setUser(profile)
        setBalanceUsd(profile.balanceUsd)
      }
    } finally {
      setLoadingUser(false)
    }
  }, [])

  const refreshSubscription = useCallback(async () => {
    setCheckingSubscription(true)
    haptic.impact('light')
    try {
      const telegramId = getTelegramUser()?.id ?? 0
      const status = await checkSubscription(telegramId)
      setSubscription(status)
      haptic.notification(status.channel && status.chat ? 'success' : 'warning')
    } finally {
      setCheckingSubscription(false)
    }
  }, [])

  const value = useMemo<UserStateContextValue>(
    () => ({
      user,
      loadingUser,
      loadUser,
      balanceUsd,
      miners,
      addBalance: (amount) => setBalanceUsd((b) => b + amount),
      claimMiner: (minerId, amount) => {
        setMiners((list) =>
          list.map((m) => (m.id === minerId ? { ...m, claimedUsd: m.claimedUsd + amount } : m)),
        )
        setBalanceUsd((b) => b + amount)
      },
      purchaseMiner: (template) => {
        if (balanceUsd < template.depositUsd) return false
        setBalanceUsd((b) => b - template.depositUsd)
        setMiners((list) => [...list, createMinerFromTemplate(template)])
        return true
      },
      spendBalance: (amount) => {
        if (balanceUsd < amount) return false
        setBalanceUsd((b) => b - amount)
        return true
      },
      subscription,
      checkingSubscription,
      refreshSubscription,
      completedTaskIds,
      claimTaskReward: (taskId, rewardUsd) => {
        if (completedTaskIds.includes(taskId)) return false
        setCompletedTaskIds((ids) => [...ids, taskId])
        setBalanceUsd((b) => b + rewardUsd)
        return true
      },
    }),
    [
      user,
      loadingUser,
      loadUser,
      balanceUsd,
      miners,
      subscription,
      checkingSubscription,
      refreshSubscription,
      completedTaskIds,
    ],
  )

  return <UserStateContext.Provider value={value}>{children}</UserStateContext.Provider>
}

export function useUserState(): UserStateContextValue {
  const ctx = useContext(UserStateContext)
  if (!ctx) throw new Error('useUserState має використовуватись всередині UserStateProvider')
  return ctx
}
