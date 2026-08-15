import { supabase } from './supabase'
import { getInitDataOrNull } from './telegram'

interface CheckSubscriptionResponse {
  subscribed: boolean
  pending?: boolean
  rewardUsd?: number
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
async function checkTarget(targetKey: string): Promise<boolean> {
  const initData = getInitDataOrNull()
  if (!initData) return false

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
    return false
  }
}

/**
 * Перевіряє підписку на один партнерський/амбассадорський канал завдання
 * (TasksTab, `verification_type = 'subscription'`) — реальна перевірка
 * Bot API + реєстрація 24-годинного утримання, нагорода — окремою
 * плановою функцією.
 */
export async function verifyTaskSubscription(taskId: string): Promise<boolean> {
  return checkTarget(`task:${taskId}`)
}
