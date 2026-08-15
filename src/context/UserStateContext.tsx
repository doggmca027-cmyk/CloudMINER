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
import { claimMinerIncomeRpc, listUserMiners, purchaseMinerRpc } from '../lib/minersApi'
import { claimTaskRewardRpc } from '../lib/tasksCatalog'
import { checkSubscription, type SubscriptionStatus } from '../lib/subscription'
import { haptic } from '../lib/telegram'
import { loadUserProfile } from '../lib/userProfile'

export interface ActionResult {
  success: boolean
  error?: string
}

interface UserStateContextValue {
  /** Профіль користувача, завантажений з Supabase (null, доки не завантажено). */
  user: User | null
  loadingUser: boolean
  /** Завантажує (або створює) профіль користувача й підтягує його баланс. Викликається з App.tsx при старті. */
  loadUser: () => Promise<void>
  /** Підтверджений баланс користувача, USDT. */
  balanceUsd: number
  /** Куплені майнери (без урахування free-майнера — той живе локально в MiningTab), з реального `user_miners`. */
  miners: UserMiner[]
  loadingMiners: boolean
  /** Перезавантажує список майнерів із сервера. */
  refreshMiners: () => Promise<void>
  /**
   * Локальний, НЕ персистентний приріст балансу — використовується ЛИШЕ для
   * free-майнера (виданого за підписку на канал/чат): він не прив'язаний до
   * депозиту/виводу і навмисно не пишеться в Supabase (див. коментар нижче).
   * Для куплених майнерів і завдань баланс синхронізується з реальним
   * `new_balance_usd`, який повертають відповідні RPC.
   */
  addBalance: (amount: number) => void
  /**
   * Купує майнер за шаблоном каталогу — RPC `purchase_miner` реально
   * списує вартість із `users.balance_usd` на сервері (під `FOR UPDATE`,
   * без TOCTOU при подвійному тапу) і створює рядок у `user_miners`.
   */
  purchaseMiner: (template: MinerTemplate) => Promise<ActionResult>
  /**
   * Переводить накопичений дохід конкретного майнера на баланс — RPC
   * `claim_miner_income` рахує суму на сервері (та сама формула, що й
   * клієнтський прев'ю в MinerCard) і реально нараховує її.
   */
  claimMinerIncome: (minerId: string) => Promise<ActionResult & { claimedUsd?: number }>
  /** Списує довільну суму з балансу (напр. після заявки на вивід). Повертає `false`, якщо коштів недостатньо. */
  spendBalance: (amount: number) => boolean
  /** Статус підписки на офіційний канал/чат (гейт для free-майнера, TasksTab). */
  subscription: SubscriptionStatus
  checkingSubscription: boolean
  /** Перевіряє підписку заново й оновлює `subscription`. Спільна для MiningTab і TasksTab. */
  refreshSubscription: () => Promise<void>
  /**
   * Зараховує винагороду за завдання — RPC `claim_task_reward` гарантує
   * (унікальний ключ у `user_tasks`), що та сама нагорода не видасться
   * двічі, навіть при паралельних викликах чи після перезавантаження.
   */
  claimTaskReward: (taskId: string) => Promise<ActionResult & { rewardUsd?: number }>
}

const UserStateContext = createContext<UserStateContextValue | null>(null)

/**
 * ⚠️ Free-майнер (виданий за підписку на офіційний канал/чат/канал
 * транзакцій, не за депозит) і далі живе ЛИШЕ в пам'яті MiningTab, не в
 * цій таблиці — навмисне архітектурне рішення, а не недогляд: сама
 * підписка тепер РЕАЛЬНО перевіряється через Bot API
 * (`check-subscription`, з 24-годинним утриманням — див.
 * subscription_checks), але "розблокування" самого free-майнера все одно
 * лишається клієнтським перемикачем (пауза/відновлення нарахування), не
 * персистентним гаманцем на сервері — його дохід не варто зберігати як
 * реальні гроші, доки в нього немає власного withdrawal-flow. Куплені
 * майнери, навпаки, повністю реальні: список — з `list_user_miners`,
 * покупка — `purchase_miner`, дохід — `claim_miner_income` (див.
 * supabase/migrations/20260818093000_*).
 */
export function UserStateProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const [balanceUsd, setBalanceUsdState] = useState(0)
  const [miners, setMiners] = useState<UserMiner[]>([])
  const [loadingMiners, setLoadingMiners] = useState(false)
  const [subscription, setSubscription] = useState<SubscriptionStatus>({
    channel: false,
    chat: false,
    tx: false,
  })
  const [checkingSubscription, setCheckingSubscription] = useState(false)

  // Дзеркалить balanceUsd, але читається/пишеться СИНХРОННО — інакше
  // подвійний тап встиг би прочитати старе значення зі стану React ДВІЧІ
  // до першого ре-рендера (TOCTOU). Актуально для spendBalance/addBalance
  // (free-майнер) — покупка/клейм куплених майнерів тепер атомарні на
  // сервері (FOR UPDATE), тут лише синхронізують локальне відображення.
  const balanceRef = useRef(0)

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

  const refreshMiners = useCallback(async () => {
    setLoadingMiners(true)
    try {
      const list = await listUserMiners()
      setMiners(list)
    } finally {
      setLoadingMiners(false)
    }
  }, [])

  const refreshSubscription = useCallback(async () => {
    setCheckingSubscription(true)
    haptic.impact('light')
    try {
      const status = await checkSubscription()
      setSubscription(status)
      haptic.notification(status.channel && status.chat && status.tx ? 'success' : 'warning')
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
      loadingMiners,
      refreshMiners,
      addBalance: (amount) => {
        setBalanceUsd(balanceRef.current + amount)
      },
      purchaseMiner: async (template) => {
        const result = await purchaseMinerRpc(template.id)
        if (!result.success) return { success: false, error: result.error }
        if (result.newBalanceUsd !== undefined) setBalanceUsd(result.newBalanceUsd)
        await refreshMiners()
        return { success: true }
      },
      claimMinerIncome: async (minerId) => {
        const result = await claimMinerIncomeRpc(minerId)
        if (!result.success) return { success: false, error: result.error }
        if (result.newBalanceUsd !== undefined) setBalanceUsd(result.newBalanceUsd)
        await refreshMiners()
        return { success: true, claimedUsd: result.claimedUsd }
      },
      spendBalance: (amount) => {
        if (balanceRef.current < amount) return false
        setBalanceUsd(balanceRef.current - amount)
        return true
      },
      subscription,
      checkingSubscription,
      refreshSubscription,
      claimTaskReward: async (taskId) => {
        const result = await claimTaskRewardRpc(taskId)
        if (!result.success) return { success: false, error: result.error }
        if (result.newBalanceUsd !== undefined) setBalanceUsd(result.newBalanceUsd)
        return { success: true, rewardUsd: result.rewardUsd }
      },
    }),
    [
      user,
      loadingUser,
      loadUser,
      balanceUsd,
      miners,
      loadingMiners,
      refreshMiners,
      subscription,
      checkingSubscription,
      refreshSubscription,
    ],
  )

  return <UserStateContext.Provider value={value}>{children}</UserStateContext.Provider>
}

export function useUserState(): UserStateContextValue {
  const ctx = useContext(UserStateContext)
  if (!ctx) throw new Error('useUserState має використовуватись всередині UserStateProvider')
  return ctx
}
