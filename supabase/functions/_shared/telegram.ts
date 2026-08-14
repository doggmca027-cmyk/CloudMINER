// Deno Edge Function runtime.

/**
 * Надсилає повідомлення через Telegram Bot API. Тихо пропускає (з
 * попередженням у логи), якщо TELEGRAM_BOT_TOKEN не налаштовано в секретах
 * функції (`supabase secrets set TELEGRAM_BOT_TOKEN=...`) — щоб відсутність
 * токена не валила все зарахування депозитів.
 */
export async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN не задано — сповіщення пропущено')
    return
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
    if (!res.ok) {
      console.error('[telegram] sendMessage failed:', res.status, await res.text())
    }
  } catch (err) {
    console.error('[telegram] sendMessage threw:', err)
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
