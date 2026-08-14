import { supabase } from './supabase'

/** Статус підписки на обов'язкові ресурси спільноти. */
export interface SubscriptionStatus {
  channel: boolean
  chat: boolean
}

/** Посилання на офіційний канал і чат, підписка на які активує free-майнер. */
export const REQUIRED_LINKS = {
  channel: 'https://t.me/cloudminer_channel',
  chat: 'https://t.me/cloudminer_chat',
}

const MOCK_SUBSCRIBED_KEY = 'cloudminer:mockSubscribed'

/**
 * Перевіряє підписку користувача на офіційний канал і чат.
 *
 * Клієнт не може перевірити членство в Telegram-каналі напряму (немає
 * bot-токена), тож у проді це має робити Supabase Edge Function
 * `check-subscription`, яка звертається до Telegram Bot API (getChatMember).
 * Поки функція не розгорнута — повертаємо безпечний фолбек.
 */
export async function checkSubscription(telegramId: number): Promise<SubscriptionStatus> {
  try {
    const { data, error } = await supabase.functions.invoke<SubscriptionStatus>(
      'check-subscription',
      { body: { telegramId } },
    )
    if (error || !data) throw error ?? new Error('check-subscription: порожня відповідь')
    return data
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      '[subscription] Edge Function "check-subscription" недоступна, використано фолбек.',
    )
    if (import.meta.env.DEV) {
      // У розробці дозволяємо локально імітувати підписку, щоб перевірити UI без бекенда.
      const mocked = localStorage.getItem(MOCK_SUBSCRIBED_KEY) === '1'
      return { channel: mocked, chat: mocked }
    }
    return { channel: false, chat: false }
  }
}

/** Dev-заглушка: імітує підписку локально, поки не розгорнуто Edge Function. */
export function setMockSubscribed(value: boolean): void {
  if (import.meta.env.DEV) {
    localStorage.setItem(MOCK_SUBSCRIBED_KEY, value ? '1' : '0')
  }
}

/**
 * Перевіряє підписку на один довільний партнерський ресурс (для завдань
 * від амбасадорів/партнерів у TasksTab). Той самий принцип, що й
 * {@link checkSubscription}: у проді — Edge Function `check-subscription`
 * з переданою ціллю, поки її немає — безпечний фолбек.
 */
export async function verifyTaskSubscription(target: string, telegramId: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke<{ subscribed: boolean }>(
      'check-subscription',
      { body: { telegramId, target } },
    )
    if (error || !data) throw error ?? new Error('check-subscription: порожня відповідь')
    return data.subscribed
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[subscription] Edge Function "check-subscription" недоступна для цілі "${target}", використано фолбек.`,
    )
    if (import.meta.env.DEV) {
      // Той самий dev-перемикач, що й для обов'язкової підписки — цього
      // достатньо для локальної перевірки UI без окремого стану на завдання.
      return localStorage.getItem(MOCK_SUBSCRIBED_KEY) === '1'
    }
    return false
  }
}
