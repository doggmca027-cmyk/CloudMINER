// Deno Edge Function runtime.

/** Резервний курс TON/USDT, якщо CoinGecko недоступний. Орієнтовне значення. */
export const FALLBACK_TON_USD_RATE = 5.5

/** Той самий CoinGecko-ендпоїнт, що й клієнтський src/lib/tonPrice.ts. */
export async function fetchTonUsdRate(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
  )
  if (!res.ok) throw new Error(`CoinGecko error: HTTP ${res.status}`)

  const data = (await res.json()) as { 'the-open-network'?: { usd?: number } }
  const rate = data['the-open-network']?.usd

  if (typeof rate !== 'number' || rate <= 0) {
    throw new Error('CoinGecko: неочікувана відповідь (немає курсу TON/USD)')
  }
  return rate
}

/** fetchTonUsdRate() з фолбеком замість викидання помилки. */
export async function fetchTonUsdRateSafe(): Promise<number> {
  try {
    return await fetchTonUsdRate()
  } catch (err) {
    console.warn('[rate] fetchTonUsdRate не вдався, використано резервний курс:', err)
    return FALLBACK_TON_USD_RATE
  }
}
