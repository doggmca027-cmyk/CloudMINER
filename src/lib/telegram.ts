/**
 * Утиліти для роботи з Telegram Mini App WebApp API.
 * Документація: https://core.telegram.org/bots/webapps
 */

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: {
    user?: TelegramUser
    query_id?: string
    auth_date?: number
    hash?: string
    start_param?: string
  }
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  isExpanded: boolean
  viewportHeight: number
  viewportStableHeight: number
  headerColor: string
  backgroundColor: string
  ready: () => void
  expand: () => void
  close: () => void
  enableClosingConfirmation: () => void
  disableClosingConfirmation: () => void
  setHeaderColor: (color: string) => void
  setBackgroundColor: (color: string) => void
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void
  openTelegramLink: (url: string) => void
  openInvoice: (url: string, callback?: (status: string) => void) => void
  showPopup: (params: {
    title?: string
    message: string
    buttons?: Array<{ id?: string; type?: string; text?: string }>
  }, callback?: (buttonId: string) => void) => void
  showAlert: (message: string, callback?: () => void) => void
  showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
    selectionChanged: () => void
  }
  MainButton: {
    text: string
    color: string
    textColor: string
    isVisible: boolean
    isActive: boolean
    show: () => void
    hide: () => void
    enable: () => void
    disable: () => void
    setText: (text: string) => void
    onClick: (callback: () => void) => void
    offClick: (callback: () => void) => void
    showProgress: (leaveActive?: boolean) => void
    hideProgress: () => void
  }
  BackButton: {
    isVisible: boolean
    show: () => void
    hide: () => void
    onClick: (callback: () => void) => void
    offClick: (callback: () => void) => void
  }
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp
    }
  }
}

/** Повертає інстанс Telegram WebApp, якщо застосунок відкрито всередині Telegram. */
export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp ?? null
}

/** Перевіряє, чи запущено застосунок всередині Telegram Mini App. */
export function isTelegramWebApp(): boolean {
  return getTelegramWebApp() !== null
}

/** Ініціалізує WebApp: сигналізує готовність та розгортає на весь екран. */
export function initTelegramWebApp(): void {
  const webApp = getTelegramWebApp()
  if (!webApp) return
  webApp.ready()
  webApp.expand()
}

/** Сире значення initData для валідації на бекенді. */
export function getInitData(): string {
  return getTelegramWebApp()?.initData ?? ''
}

/**
 * `getInitData()`, але `null` замість порожнього рядка — зручно для
 * "graceful" гілок (`if (!initData) return null`), яких у клієнтських
 * lib-функціях багато. Кожен RPC, що ідентифікує "поточного користувача",
 * тепер приймає САМЕ initData (не telegram_id) і перевіряє його підпис на
 * сервері через `verify_telegram_init_data` — без реального Telegram-сеансу
 * (напр. `npm run dev` у звичайному браузері) підписаного initData просто
 * нема, і такі виклики закономірно нічого не поверне.
 */
export function getInitDataOrNull(): string | null {
  const initData = getInitData()
  return initData ? initData : null
}

/** Те саме, що {@link getInitDataOrNull}, але кидає — для місць, де відсутність initData є помилкою, а не штатним "не залогінений". */
export function requireInitData(): string {
  const initData = getInitDataOrNull()
  if (!initData) throw new Error('no_init_data')
  return initData
}

/** Дані поточного користувача Telegram (не валідовані, лише для UI). */
export function getTelegramUser(): TelegramUser | null {
  return getTelegramWebApp()?.initDataUnsafe.user ?? null
}

/**
 * Параметр запуску (start_param), напр. реферальний код.
 *
 * Основне джерело — `initDataUnsafe.start_param` (офіційний спосіб). Але
 * додатково перевіряємо `tgWebAppStartParam` у query/hash самого URL —
 * Telegram Web / деякі версії клієнта передають той самий параметр і
 * туди при відкритті через `?startapp=`, а WebApp SDK не завжди встигає
 * розпарсити `initDataUnsafe` синхронно до першого рендера. Захисний
 * резерв, що нічого не коштує, якщо основне джерело вже спрацювало.
 */
export function getStartParam(): string | null {
  const fromWebApp = getTelegramWebApp()?.initDataUnsafe.start_param
  if (fromWebApp) return fromWebApp

  if (typeof window === 'undefined') return null
  const fromQuery = new URLSearchParams(window.location.search).get('tgWebAppStartParam')
  if (fromQuery) return fromQuery

  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const fromHash = new URLSearchParams(hash).get('tgWebAppStartParam')
  return fromHash || null
}

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
type NotificationType = 'error' | 'success' | 'warning'

/** Тактильний відгук (haptic feedback). Тихо ігнорується поза Telegram. */
export const haptic = {
  impact(style: ImpactStyle = 'light'): void {
    getTelegramWebApp()?.HapticFeedback.impactOccurred(style)
  },
  notification(type: NotificationType): void {
    getTelegramWebApp()?.HapticFeedback.notificationOccurred(type)
  },
  selection(): void {
    getTelegramWebApp()?.HapticFeedback.selectionChanged()
  },
}

/**
 * Відкриває зовнішнє посилання. Всередині Telegram — через нативний
 * openLink, поза Telegram — у новій вкладці браузера.
 */
export function openExternalLink(url: string, tryInstantView = false): void {
  const webApp = getTelegramWebApp()
  if (webApp) {
    webApp.openLink(url, { try_instant_view: tryInstantView })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Відкриває посилання на бота/канал/чат Telegram (t.me/...). */
export function openTelegramLink(url: string): void {
  const webApp = getTelegramWebApp()
  if (webApp) {
    webApp.openTelegramLink(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Закриває Mini App. */
export function closeWebApp(): void {
  getTelegramWebApp()?.close()
}

/**
 * Нормалізує значення на кшталт `VITE_SUPPORT_TELEGRAM_LINK` до повного
 * https://t.me/... URL — приймає як готовий URL, так і `@username` чи
 * голий `username` без префіксу. `raw` — саме `string | undefined`, а не
 * `string`: якщо змінна оточення не задана в білді взагалі (а не просто
 * порожня), `import.meta.env.VITE_...` повертає `undefined`, і виклик тут
 * — на верхньому рівні модуля Header.tsx, тобто ще до рендеру будь-чого —
 * раніше валив увесь застосунок одразу при завантаженні ("Cannot read
 * properties of undefined (reading 'trim')").
 */
export function resolveTelegramLink(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://t.me/${trimmed.replace(/^@/, '')}`
}
