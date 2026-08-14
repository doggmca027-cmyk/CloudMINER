import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { MinerTemplate, User, UserMiner } from '../types'
import { createMinerFromTemplate } from '../lib/mining'
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
 * клієнта — у проді вони так само завантажуються з Supabase
 * (`user_miners`, `user_tasks`) і синхронізуються через API/Realtime.
 * Баланс (`balanceUsd`) вже гідрується реальним значенням з `users.balance_usd`
 * через RPC `get_or_create_user` (див. loadUser), але подальші локальні
 * зміни (claim/purchase/spend) поки не записуються назад у Supabase —
 * тобто це ВСЕ ЩЕ демонстраційна поведінка UI, а не реальні операції з
 * коштами. Реальний баланс (`users.balance_usd`) захищений незалежно на
 * сервері (напр. `request_withdrawal` перевіряє його з `FOR UPDATE"),
 * тож ці локальні дії не можуть призвести до реального виводу неіснуючих
 * коштів — але вони показують користувачу оманливі цифри й "губляться"
 * при кожному перезавантаженні застосунку. Це найбільший архітектурний
 * розрив у застосунку — потребує окремого фронту роботи, не патчиться тут.
 */
export function UserStateProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const [balanceUsd, setBalanceUsdState] = useState(0)
  const [miners, setMiners] = useState<UserMiner[]>([])
  const [subscription, setSubscription] = useState<SubscriptionStatus>({
    channel: false,
    chat: false,
  })
  const [checkingSubscription, setCheckingSubscription] = useState(false)
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([])

  // Дзеркалять відповідний useState, але читаються/пишуться СИНХРОННО — на
  // відміну від React-стану (яке під час подвійного тапу можна встигнути
  // прочитати ДВІЧІ зі старим значенням до першого ре-рендера). Два швидкі
  // послідовні виклики purchaseMiner/spendBalance — це два окремих,
  // синхронних виклики функції в тому самому JS-тіку; звірка й списання
  // через ref не залишають вікна між "перевірили" і "списали".
  const balanceRef = useRef(0)
  const completedTaskIdsRef = useRef<Set<string>>(new Set())

  function setBalanceUsd(next: number) {
    balanceRef.current = next
    setBalanceUsdState(next)
  }

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
      addBalance: (amount) => {
        setBalanceUsd(balanceRef.current + amount)
      },
      claimMiner: (minerId, amount) => {
        setMiners((list) =>
          list.map((m) => (m.id === minerId ? { ...m, claimedUsd: m.claimedUsd + amount } : m)),
        )
        setBalanceUsd(balanceRef.current + amount)
      },
      purchaseMiner: (template) => {
        if (balanceRef.current < template.depositUsd) return false
        setBalanceUsd(balanceRef.current - template.depositUsd)
        setMiners((list) => [...list, createMinerFromTemplate(template)])
        return true
      },
      spendBalance: (amount) => {
        if (balanceRef.current < amount) return false
        setBalanceUsd(balanceRef.current - amount)
        return true
      },
      subscription,
      checkingSubscription,
      refreshSubscription,
      completedTaskIds,
      claimTaskReward: (taskId, rewardUsd) => {
        if (completedTaskIdsRef.current.has(taskId)) return false
        completedTaskIdsRef.current.add(taskId)
        setCompletedTaskIds((ids) => [...ids, taskId])
        setBalanceUsd(balanceRef.current + rewardUsd)
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
