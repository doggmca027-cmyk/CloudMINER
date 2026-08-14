import type { MinerTemplate } from '../types'
import { MINER_DURATION_DAYS, MINER_RETURN_MULTIPLIER } from './mining'

function buildTemplate(depositUsd: number, isVip: boolean, sortOrder: number): MinerTemplate {
  return {
    id: `${isVip ? 'premium' : 'regular'}-${depositUsd}`,
    name: `${depositUsd} USDT`,
    description: '',
    imageUrl: isVip ? '💎' : '⚡',
    depositUsd,
    returnMultiplier: MINER_RETURN_MULTIPLIER,
    durationDays: MINER_DURATION_DAYS,
    isVip,
    isActive: true,
    sortOrder,
  }
}

const REGULAR_DEPOSITS_USD = [5, 25, 50, 100, 250, 500, 1000, 1500]
const PREMIUM_DEPOSITS_USD = [999, 1499, 1999, 2499, 2999]

/** Каталог звичайних майнинг-паків (ціаново-блакитний дизайн). */
export const REGULAR_PACKS: MinerTemplate[] = REGULAR_DEPOSITS_USD.map((amount, index) =>
  buildTemplate(amount, false, index),
)

/** Каталог VIP/преміум майнинг-паків (золотий дизайн). */
export const PREMIUM_PACKS: MinerTemplate[] = PREMIUM_DEPOSITS_USD.map((amount, index) =>
  buildTemplate(amount, true, index),
)
