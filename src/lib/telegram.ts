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

/** Дані поточного користувача Telegram (не валідовані, лише для UI). */
export function getTelegramUser(): TelegramUser | null {
  return getTelegramWebApp()?.initDataUnsafe.user ?? null
}

/** Параметр запуску (start_param), напр. реферальний код. */
export function getStartParam(): string | null {
  return getTelegramWebApp()?.initDataUnsafe.start_param ?? null
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
 * голий `username` без префіксу.
 */
export function resolveTelegramLink(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://t.me/${trimmed.replace(/^@/, '')}`
}
