import { Fan, Gem, Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UserMiner } from '../types'
import { getDailyRateUsd, getProgressRatio, isMinerCompleted } from '../lib/mining'

interface MinerCardProps {
  miner: UserMiner
  /** Поточний момент часу (мс), передається зверху, щоб усі картки тікали синхронно. */
  now: number
}

export default function MinerCard({ miner, now }: MinerCardProps) {
  const { t } = useTranslation()

  const progress = getProgressRatio(miner, now)
  const completed = isMinerCompleted(miner, now)
  const dailyRate = getDailyRateUsd(miner)
  const isVip = Boolean(miner.template?.isVip)

  const Icon = miner.isFree ? Gift : isVip ? Gem : Fan
  const accentClass = isVip ? 'border-premium/40 text-premium-glow' : 'border-cyan-500/30 text-neon-glow'

  const statusLabel = completed
    ? t('mining.card.completed')
    : miner.isActive
      ? t('mining.card.statusActive')
      : t('mining.card.statusFrozen')
  const statusColorClass = completed
    ? 'text-slate-400'
    : miner.isActive
      ? 'text-emerald-400'
      : 'text-amber-400'

  return (
    <div className="glass-card flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold uppercase tracking-wide text-slate-100">
          {miner.name}
        </p>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-neon-gradient transition-[width] duration-300 ease-linear"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="font-mono font-semibold tabular-nums text-neon-glow">
            {dailyRate.toFixed(2)} {t('mining.card.perDay')}
          </span>
          <span className="text-slate-500">
            {t('mining.card.statusLabel')}:{' '}
            <span className={`font-semibold ${statusColorClass}`}>{statusLabel}</span>
          </span>
        </div>
      </div>

      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border bg-slate-800/60 ${accentClass}`}
      >
        <Icon size={20} aria-hidden />
      </div>
    </div>
  )
}
