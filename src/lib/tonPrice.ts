import { useEffect, useState } from 'react'

/** Резервний курс TON/USDT, якщо API курсів недоступне. Орієнтовне значення. */
export const FALLBACK_TON_USD_RATE = 5.5

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd'

const POLL_INTERVAL_MS = 60_000

interface CoinGeckoResponse {
  'the-open-network'?: { usd?: number }
}

async function fetchTonUsdRate(): Promise<number | null> {
  try {
    const res = await fetch(COINGECKO_URL)
    if (!res.ok) return null
    const data: CoinGeckoResponse = await res.json()
    const rate = data['the-open-network']?.usd
    return typeof rate === 'number' && rate > 0 ? rate : null
  } catch {
    return null
  }
}

interface TonPriceState {
  /** Поточний курс 1 TON у USDT (актуальний з API або резервний). */
  rate: number
  /** Чи вдалося отримати живий курс з API (false — показано резервне значення). */
  isLive: boolean
  loading: boolean
}

/** Підтягує курс TON/USDT з CoinGecko й оновлює його раз на хвилину. */
export function useTonPrice(): TonPriceState {
  const [rate, setRate] = useState(FALLBACK_TON_USD_RATE)
  const [isLive, setIsLive] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const liveRate = await fetchTonUsdRate()
      if (cancelled) return
      if (liveRate) {
        setRate(liveRate)
        setIsLive(true)
      }
      setLoading(false)
    }

    load()
    const intervalId = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [])

  return { rate, isLive, loading }
}
