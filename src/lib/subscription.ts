import { supabase } from './supabase'
import { getInitDataOrNull } from './telegram'

/** Статус підписки на обов'язкові ресурси спільноти. */
export interface SubscriptionStatus {
  channel: boolean
  /** Канал транзакцій — обов'язкова підписка нарівні з channel. */
  tx: boolean
}

/**
 * Посилання на офіційний канал і канал транзакцій, підписка на які
 * активує free-майнер. `tx` — опційний `VITE_TRANSACTIONS_CHANNEL_LINK`
 * (порожньо, доки не налаштовано — той самий патерн, що й
 * VITE_DEPOSIT_ADDRESS_TON / VITE_SUPPORT_TELEGRAM_LINK: UI ховає
 * посилання, а не показує фейкове).
 *
 * Обов'язкова підписка на чат проєкту прибрана — free-майнер тепер
 * розблоковується лише каналом (+ каналом транзакцій, якщо налаштовано).
 */
export const REQUIRED_LINKS = {
  channel: 'https://t.me/cloudminer_channel',
  tx: (import.meta.env.VITE_TRANSACTIONS_CHANNEL_LINK as string | undefined) || '',
}

const MOCK_SUBSCRIBED_KEY = 'cloudminer:mockSubscribed'

interface CheckSubscriptionResponse {
  subscribed: boolean
  pending?: boolean
  rewardUsd?: number
  error?: string
}

/**
 * Перевіряє членство в одній конкретній цілі через Edge Function
 * `check-subscription` (РЕАЛЬНИЙ Telegram Bot API `getChatMember` —
 * `targetKey` ∈ {'mandatory:channel', 'mandatory:tx', `task:<uuid>`}).
 * При успіху сервер сам реєструє 24-годинну перевірку утримання підписки
 * (нагорода видається пізніше, окремою плановою функцією, лише якщо
 * користувач не відписався).
 */
async function checkTarget(targetKey: string): Promise<boolean> {
  const initData = getInitDataOrNull()
  if (!initData) {
    // Поза Telegram (напр. `npm run dev`) підписаного initData нема —
    // реальну перевірку виконати неможливо. У DEV дозволяємо локально
    // імітувати підписку, щоб перевірити UI без бекенда.
    return import.meta.env.DEV && localStorage.getItem(MOCK_SUBSCRIBED_KEY) === '1'
  }

  try {
    const { data, error } = await supabase.functions.invoke<CheckSubscriptionResponse>(
      'check-subscription',
      { body: { initData, targetKey } },
    )
    if (error || !data) throw error ?? new Error('check-subscription: порожня відповідь')
    return data.subscribed
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[subscription] check-subscription не вдався для "${targetKey}":`, err)
    return import.meta.env.DEV && localStorage.getItem(MOCK_SUBSCRIBED_KEY) === '1'
  }
}

/** Перевіряє обов'язкові підписки одразу (канал, канал транзакцій). */
export async function checkSubscription(): Promise<SubscriptionStatus> {
  const [channel, tx] = await Promise.all([
    checkTarget('mandatory:channel'),
    checkTarget('mandatory:tx'),
  ])
  return { channel, tx }
}

/**
 * Чи виконані ВСІ обов'язкові підписки. Канал транзакцій вимагається,
 * лише якщо для нього налаштоване публічне посилання
 * (`VITE_TRANSACTIONS_CHANNEL_LINK`) — доки його немає, користувачу
 * нема куди підписатись, тож блокувати free-майнер цією вимогою не варто.
 */
export function isFullySubscribed(status: SubscriptionStatus): boolean {
  return status.channel && (status.tx || !REQUIRED_LINKS.tx)
}

/** Dev-заглушка: імітує підписку локально, поки не розгорнуто Edge Function. */
export function setMockSubscribed(value: boolean): void {
  if (import.meta.env.DEV) {
    localStorage.setItem(MOCK_SUBSCRIBED_KEY, value ? '1' : '0')
  }
}

/**
 * Перевіряє підписку на один партнерський/амбассадорський канал завдання
 * (TasksTab, `verification_type = 'subscription'`). Той самий принцип, що
 * й {@link checkSubscription}: реальна перевірка Bot API + реєстрація
 * 24-годинного утримання, нагорода — окремою плановою функцією.
 */
export async function verifyTaskSubscription(taskId: string): Promise<boolean> {
  return checkTarget(`task:${taskId}`)
}
