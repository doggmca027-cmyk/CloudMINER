import type { MinerTemplate } from '../types'
import { MINER_DURATION_DAYS, MINER_RETURN_MULTIPLIER } from './mining'

function buildTemplate(
  depositUsd: number,
  name: string,
  isVip: boolean,
  sortOrder: number,
): MinerTemplate {
  return {
    id: `${isVip ? 'premium' : 'regular'}-${depositUsd}`,
    name,
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

/**
 * Назви — фірмові (як "CloudMiner" чи "TON") і навмисно НЕ перекладаються
 * через t(): це імена конкретних майнерів у каталозі, однакові для всіх
 * мов, а не UI-текст.
 */
const REGULAR_TIERS: Array<{ amount: number; name: string }> = [
  { amount: 5, name: 'Nano Miner' },
  { amount: 25, name: 'Micro Rig' },
  { amount: 50, name: 'Spark Core' },
  { amount: 100, name: 'Turbo Node' },
  { amount: 250, name: 'Quantum Rig' },
  { amount: 500, name: 'Hyper Core' },
  { amount: 1000, name: 'Titan Node' },
  { amount: 1500, name: 'Apex Rig' },
]

const PREMIUM_TIERS: Array<{ amount: number; name: string }> = [
  { amount: 999, name: 'Golden Core' },
  { amount: 1499, name: 'Platinum Rig' },
  { amount: 1999, name: 'Diamond Node' },
  { amount: 2499, name: 'Royal Miner' },
  { amount: 2999, name: 'Sovereign Core' },
]

/** Каталог звичайних майнинг-паків (ціаново-блакитний дизайн). */
export const REGULAR_PACKS: MinerTemplate[] = REGULAR_TIERS.map((tier, index) =>
  buildTemplate(tier.amount, tier.name, false, index),
)

/** Каталог VIP/преміум майнинг-паків (золотий дизайн). */
export const PREMIUM_PACKS: MinerTemplate[] = PREMIUM_TIERS.map((tier, index) =>
  buildTemplate(tier.amount, tier.name, true, index),
)
