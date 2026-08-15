import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  /**
   * Причина, чому `user` лишається `null` ПІСЛЯ завершення завантаження
   * (`loadingUser === false`) — `null`, якщо або ще вантажиться, або вже
   * успішно завантажено. Дозволяє UI показати РЕАЛЬНУ помилку замість
   * вічного "Загрузка..." (див. {@link LoadUserProfileResult}).
   */
  userLoadError: string | null
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
  const [userLoadError, setUserLoadError] = useState<string | null>(null)
  const [balanceUsd, setBalanceUsdState] = useState(0)
  const [miners, setMiners] = useState<UserMiner[]>([])
  const [loadingMiners, setLoadingMiners] = useState(false)
  const [subscription, setSubscription] = useState<SubscriptionStatus>({
    channel: false,
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

  // Синхронний прапорець "профіль уже колись успішно завантажувався" — НЕ
  // React-стан (щоб не потрапити в залежності loadUser і не зламати його
  // стабільну ідентичність, від якої залежить ефект автозавантаження в
  // App.tsx). Потрібен, щоб відрізнити ПЕРШЕ завантаження (нема що
  // показати, доки не завантажиться — помилку варто показати) від
  // фонового періодичного опитування (дані вже є на екрані, і тимчасовий
  // збій мережі не повинен ховати їх за страшним банером помилки).
  const hasLoadedOnceRef = useRef(false)

  const loadUser = useCallback(async () => {
    setLoadingUser(true)
    try {
      const result = await loadUserProfile()
      if (result.status === 'ok') {
        setUser(result.user)
        setBalanceUsd(result.user.balanceUsd)
        setUserLoadError(null)
        hasLoadedOnceRef.current = true
      } else if (result.status === 'error') {
        if (hasLoadedOnceRef.current) {
          // Фонове опитування — дані вже на екрані, лишаємо їх як є й лише
          // тихо логуємо. Показ банера тут прибрав би вже робочий профіль
          // з екрана через щось таке ж дрібне, як миттєвий обрив Wi-Fi.
          // eslint-disable-next-line no-console
          console.warn('[UserStateContext] фонове оновлення профілю не вдалось:', result.message)
        } else {
          setUserLoadError(result.message)
        }
      }
      // 'no_init_data' — штатний стан поза Telegram, без помилки в UI.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Не мало б статись (loadUserProfile сама ловить помилки RPC), але
      // без цього catch будь-який неочікуваний виняток (напр. якщо сам
      // supabase-js кине щось до повернення {data, error}) лишав би
      // userLoadError порожнім і користувача — знову на вічному "Загрузка...".
      if (hasLoadedOnceRef.current) {
        // eslint-disable-next-line no-console
        console.warn('[UserStateContext] фонове оновлення профілю не вдалось:', message)
      } else {
        setUserLoadError(message)
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
    } catch (err) {
      // listUserMiners тепер кидає при реальній помилці (мережа тощо) —
      // навмисно НЕ очищуємо miners тут: цей виклик тепер триггериться і
      // періодичним фоновим опитуванням, де вже показаний на екрані список
      // не повинен зникати через тимчасовий збій з'єднання.
      // eslint-disable-next-line no-console
      console.warn('[UserStateContext] refreshMiners не вдався:', err instanceof Error ? err.message : err)
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
      haptic.notification(status.channel && status.tx ? 'success' : 'warning')
    } finally {
      setCheckingSubscription(false)
    }
  }, [])

  // Фонова синхронізація профілю/майнерів — без цього баланс/прогрес на
  // екрані міг "розсинхронитись" із реальним сервером: усе, що зараховується
  // НЕ клієнтським екшеном самого користувача (реферальний бонус від
  // депозиту запрошеного, нагорода за 24г утримання підписки, вручну
  // нарахований адміном депозит), ніколи не підтягувалось — сторінка
  // просто ніколи не питала сервер знову, поки користувач сам не
  // перезавантажить застосунок. Два джерела оновлення:
  //  1) періодичний опитувальний інтервал, ЛИШЕ поки вкладка видима
  //     (document.hidden — не марнуємо запити й батарею, поки Telegram
  //     згорнутий у фон);
  //  2) миттєве оновлення одразу, як тільки застосунок повертається з фону
  //     (Telegram Mini App часто "заморожує" WebView при згортанні — після
  //     повернення дані могли встигнути протухнути значно довше за
  //     інтервал).
  useEffect(() => {
    const POLL_INTERVAL_MS = 25_000

    function refreshIfVisible() {
      if (document.hidden) return
      void loadUser()
      void refreshMiners()
    }

    const intervalId = setInterval(refreshIfVisible, POLL_INTERVAL_MS)

    function handleVisibilityChange() {
      if (!document.hidden) refreshIfVisible()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadUser, refreshMiners])

  const value = useMemo<UserStateContextValue>(
    () => ({
      user,
      loadingUser,
      userLoadError,
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
      userLoadError,
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
