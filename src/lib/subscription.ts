import { supabase } from './supabase'
import { getInitDataOrNull } from './telegram'

interface CheckSubscriptionResponse {
  subscribed: boolean
  pending?: boolean
  rewardUsd?: number
  error?: string
}

/** Результат перевірки — на відміну від голого `boolean`, несе РЕАЛЬНУ причину відмови (не лише "не підписаний"). */
export interface TaskVerifyResult {
  subscribed: boolean
  /**
   * Присутнє лише коли перевірка не змогла дати відповідь взагалі (не
   * плутати з "subscribed: false" — це "не вдалось перевірити", а не
   * "перевірено: не підписаний"). Живий приклад: завдання з приватним
   * інвайт-посиланням замість @username — Bot API такий чат просто не
   * резолвить (`task_action_url_not_a_telegram_link`), і без цього поля
   * користувач бачив би те саме "не підписаний", скільки б не тиснув
   * "Перевірити" й скільки б насправді не був підписаний.
   */
  error?: string
}

/**
 * Перевіряє членство в одній конкретній цілі через Edge Function
 * `check-subscription` (РЕАЛЬНИЙ Telegram Bot API `getChatMember` —
 * `targetKey` = `task:<uuid>` для партнерських/амбасадорських завдань).
 * При успіху сервер сам реєструє 24-годинну перевірку утримання підписки
 * (нагорода видається пізніше, окремою плановою функцією, лише якщо
 * користувач не відписався).
 *
 * ⚠️ Обов'язкова підписка на офіційний канал/канал транзакцій (колишні
 * `mandatory:channel`/`mandatory:tx`, що гейтили free-майнер) прибрана
 * за прямим запитом — free-майнер тепер активний одразу, без будь-якої
 * перевірки Bot API. `check-subscription` і далі підтримує ці targetKey
 * на бекенді (нешкідливо лишити), просто більше ніхто з клієнта їх не
 * викликає.
 */
async function checkTarget(targetKey: string): Promise<TaskVerifyResult> {
  const initData = getInitDataOrNull()
  if (!initData) return { subscribed: false, error: 'no_init_data' }

  try {
    const { data, error } = await supabase.functions.invoke<CheckSubscriptionResponse>(
      'check-subscription',
      { body: { initData, targetKey } },
    )
    if (error || !data) throw error ?? new Error('check-subscription: порожня відповідь')
    // Edge Function сама завжди повертає 200 + {subscribed, error?} —
    // навіть для збоїв (невалідне завдання, getChatMember відмовив тощо),
    // саме щоб `data` тут ніколи не було порожнім і `error` з відповіді
    // доходив до виклику, а не губився в обгортці supabase-js для non-2xx.
    return { subscribed: data.subscribed, error: data.error }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn(`[subscription] check-subscription не вдався для "${targetKey}":`, err)
    return { subscribed: false, error: message }
  }
}

/**
 * Перевіряє підписку на один партнерський/амбассадорський канал завдання
 * (TasksTab, `verification_type = 'subscription'`) — реальна перевірка
 * Bot API + реєстрація 24-годинного утримання, нагорода — окремою
 * плановою функцією.
 */
export async function verifyTaskSubscription(taskId: string): Promise<TaskVerifyResult> {
  return checkTarget(`task:${taskId}`)
}
