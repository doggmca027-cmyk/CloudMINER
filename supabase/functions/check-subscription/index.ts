// Deno Edge Function: check-subscription
//
// Реальна перевірка підписки через Telegram Bot API (getChatMember) —
// раніше ця функція просто НЕ ІСНУВАЛА, і клієнт (src/lib/subscription.ts)
// завжди падав у "безпечний" фолбек (false у проді). Викликається з
// клієнта для ДВОХ типів цілей:
//   - обов'язкові підписки (канал/канал транзакцій) — гейт для
//     free-майнера в MiningTab;
//   - партнерські/амбассадорські завдання з verification_type='subscription'
//     у TasksTab.
//
// Обов'язкова підписка на чат проєкту прибрана (лишились лише канал і
// канал транзакцій) — target 'mandatory:chat' більше не підтримується.
//
// ⚠️ Бот МУСИТЬ бути адміністратором у КОЖНОМУ каналі/чаті, який тут
// перевіряється — інакше Telegram відмовляє в getChatMember. Це стосується
// й майбутніх амбассадорських каналів, доданих через адмінку
// (admin_create_task): без адмінських прав бота там чекер працювати не буде.
//
// Потік: підтверджуємо підписку ЗАРАЗ через Bot API → якщо підписаний,
// реєструємо pending-запис у subscription_checks на "перевірити ще раз
// через 24 години" (НЕ видаємо нагороду одразу — це робить окрема
// планова функція check-subscription-retention, лише якщо через 24
// години користувач і досі підписаний).
//
// СЕКРЕТИ (supabase secrets set ...):
//   TELEGRAM_BOT_TOKEN                — той самий бот, що й в інших функціях
//   TELEGRAM_TRANSACTIONS_CHANNEL_ID  — той самий, що й для сповіщень адміну;
//                                        тут ще й слугує chat_ref для Bot API
//   MANDATORY_CHANNEL_USERNAME        — опційно, дефолт "@cloudminer_channel"

import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts'
import { checkChatMembership } from '../_shared/telegram.ts'

/** Тримати синхронізовано з очікуваннями користувача проєкту (0.01 USDT за утримання обов'язкової підписки 24г). */
const MANDATORY_RETENTION_REWARD_USD = 0.01
const RETENTION_HOURS = 24

interface CheckSubscriptionRequest {
  initData?: string
  targetKey?: string
}

interface ResolvedTarget {
  chatRef: string
  rewardUsd: number
}

Deno.serve(async (req) => {
  let body: CheckSubscriptionRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const { initData, targetKey } = body
  if (!initData || !targetKey) {
    return jsonResponse({ error: 'missing_parameters' }, 400)
  }

  const supabase = createSupabaseAdminClient()

  const { data: verifyData, error: verifyError } = await supabase.rpc('verify_telegram_init_data', {
    p_init_data: initData,
  })
  if (verifyError) {
    return jsonResponse({ error: 'invalid_init_data', detail: verifyError.message }, 401)
  }
  const verified = (Array.isArray(verifyData) ? verifyData[0] : verifyData) as
    | { telegram_id: number }
    | undefined
  const telegramId = verified?.telegram_id
  if (!telegramId) {
    return jsonResponse({ error: 'invalid_init_data' }, 401)
  }

  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (userError || !userRow) {
    // Профіль ще не створено (get_or_create_user мав відпрацювати при
    // старті застосунку раніше) — рідкісний edge case, просто просимо
    // повторити пізніше замість падіння.
    return jsonResponse({ error: 'user_not_found' }, 404)
  }

  let target: ResolvedTarget
  try {
    target = await resolveTarget(supabase, targetKey)
  } catch (err) {
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 400)
  }

  const membership = await checkChatMembership(target.chatRef, telegramId)
  if (!membership.ok) {
    return jsonResponse({ subscribed: false, error: membership.error }, 200)
  }

  if (!membership.isMember) {
    return jsonResponse({ subscribed: false }, 200)
  }

  // Підписаний ЗАРАЗ — реєструємо (ідемпотентно) перевірку через 24
  // години. Унікальний частковий індекс (user_id, target_key) WHERE
  // status='pending' сам відкидає дублікати повторного "Перевірити".
  const checkAfter = new Date(Date.now() + RETENTION_HOURS * 60 * 60 * 1000).toISOString()
  const { error: insertError } = await supabase.from('subscription_checks').insert({
    user_id: userRow.id,
    target_key: targetKey,
    chat_ref: target.chatRef,
    reward_usd: target.rewardUsd,
    status: 'pending',
    check_after: checkAfter,
  })

  // unique_violation (23505) — уже є активна pending-перевірка на цю ціль,
  // це не помилка, просто нічого нового реєструвати не треба.
  if (insertError && insertError.code !== '23505') {
    console.error('[check-subscription] insert subscription_checks failed:', insertError)
  }

  return jsonResponse({ subscribed: true, pending: true, rewardUsd: target.rewardUsd, checkAfter })
})

async function resolveTarget(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  targetKey: string,
): Promise<ResolvedTarget> {
  if (targetKey === 'mandatory:channel') {
    return { chatRef: Deno.env.get('MANDATORY_CHANNEL_USERNAME') || '@cloudminer_channel', rewardUsd: MANDATORY_RETENTION_REWARD_USD }
  }
  if (targetKey === 'mandatory:tx') {
    const chatRef = Deno.env.get('TELEGRAM_TRANSACTIONS_CHANNEL_ID')
    if (!chatRef) throw new Error('transactions_channel_not_configured')
    return { chatRef, rewardUsd: MANDATORY_RETENTION_REWARD_USD }
  }

  const taskMatch = /^task:([0-9a-f-]{36})$/i.exec(targetKey)
  if (!taskMatch) {
    throw new Error('invalid_target_key')
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .select('action_url, reward_usd, verification_type, is_active')
    .eq('id', taskMatch[1])
    .maybeSingle()

  if (error || !task || !task.is_active || task.verification_type !== 'subscription') {
    throw new Error('task_not_found')
  }
  if (!task.action_url) {
    throw new Error('task_missing_action_url')
  }

  const chatRef = extractChatUsername(task.action_url)
  if (!chatRef) {
    throw new Error('task_action_url_not_a_telegram_link')
  }

  return { chatRef, rewardUsd: Number(task.reward_usd) }
}

/** "https://t.me/somechannel" / "@somechannel" / "somechannel" -> "@somechannel". Bot API не приймає повний URL. */
function extractChatUsername(actionUrl: string): string | null {
  const trimmed = actionUrl.trim()
  const tMeMatch = /^https?:\/\/t\.me\/([A-Za-z0-9_]{5,})\/?$/.exec(trimmed)
  if (tMeMatch) return `@${tMeMatch[1]}`
  if (/^@[A-Za-z0-9_]{5,}$/.test(trimmed)) return trimmed
  if (/^[A-Za-z0-9_]{5,}$/.test(trimmed)) return `@${trimmed}`
  return null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
