// Deno Edge Function runtime.

/**
 * Надсилає повідомлення через Telegram Bot API. Тихо пропускає (з
 * попередженням у логи), якщо TELEGRAM_BOT_TOKEN не налаштовано в секретах
 * функції (`supabase secrets set TELEGRAM_BOT_TOKEN=...`) — щоб відсутність
 * токена не валила все зарахування депозитів.
 *
 * `photoUrl` — опційно (розсилки з фото, admin_broadcast_message): якщо
 * задано, використовує `sendPhoto` (текст стає підписом, ліміт Telegram —
 * 1024 символи, менше за 4096 у звичайного sendMessage), інакше —
 * звичайний sendMessage.
 */
export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  photoUrl?: string | null,
): Promise<void> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN не задано — сповіщення пропущено')
    return
  }

  const method = photoUrl ? 'sendPhoto' : 'sendMessage'
  const body = photoUrl
    ? { chat_id: chatId, photo: photoUrl, caption: text, parse_mode: 'HTML' }
    : { chat_id: chatId, text, parse_mode: 'HTML' }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error(`[telegram] ${method} failed:`, res.status, await res.text())
    }
  } catch (err) {
    console.error(`[telegram] ${method} threw:`, err)
  }
}

/** Особисте сповіщення користувачу про зарахований депозит. */
export async function notifyUserDeposit(
  telegramId: number,
  amountUsd: number,
  network: string,
): Promise<void> {
  await sendTelegramMessage(
    telegramId,
    `🎉 Депозит зачислен! +${amountUsd.toFixed(2)} USDT (${network})`,
  )
}

/**
 * Сповіщення в канал транзакцій — опційне: якщо
 * TELEGRAM_TRANSACTIONS_CHANNEL_ID не задано (chat id каналу/групи, куди
 * бот доданий адміністратором), просто нічого не відправляє.
 */
export async function notifyTransactionsChannel(text: string): Promise<void> {
  const channelId = Deno.env.get('TELEGRAM_TRANSACTIONS_CHANNEL_ID')
  if (!channelId) return
  await sendTelegramMessage(channelId, text)
}

export type ChatMembershipStatus =
  | 'creator'
  | 'administrator'
  | 'member'
  | 'restricted'
  | 'left'
  | 'kicked'

export type ChatMembershipResult =
  | { ok: true; status: ChatMembershipStatus; isMember: boolean }
  | { ok: false; error: string }

/**
 * Перевіряє членство користувача в каналі/чаті через Bot API
 * `getChatMember`. ⚠️ Бот МУСИТЬ бути доданий як адміністратор у
 * відповідний канал/чат — без цього Telegram повертає
 * "Forbidden: bot is not a member" (для чатів) або взагалі відмовляє
 * (для каналів боту завжди потрібні права адміністратора, щоб бачити
 * довільних учасників). Це стосується КОЖНОГО каналу, який бере участь у
 * чекері — включно з майбутніми амбассадорськими/партнерськими каналами.
 *
 * `chatRef` — @username (з "@") або числовий chat_id, саме те, що очікує
 * Bot API, НЕ повне https://t.me/... посилання.
 */
export async function checkChatMembership(
  chatRef: string,
  telegramUserId: number,
): Promise<ChatMembershipResult> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) {
    return { ok: false, error: 'bot_token_not_configured' }
  }

  try {
    const url =
      `https://api.telegram.org/bot${token}/getChatMember` +
      `?chat_id=${encodeURIComponent(chatRef)}&user_id=${telegramUserId}`
    const res = await fetch(url)
    const body = await res.json()

    if (!res.ok || !body.ok) {
      // Типові причини: бот не адмін у каналі/чаті, користувач ще жодного
      // разу не писав боту (Telegram інколи не бачить його в getChatMember
      // для приватних чатів без спільної історії), невалідний chatRef.
      return { ok: false, error: String(body?.description ?? `HTTP ${res.status}`) }
    }

    const status = body.result?.status as ChatMembershipStatus | undefined
    if (!status) {
      return { ok: false, error: 'unexpected_response' }
    }

    return {
      ok: true,
      status,
      isMember: status === 'creator' || status === 'administrator' || status === 'member' || status === 'restricted',
    }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}
