import { useTranslation } from 'react-i18next'
import type { ReferralLevelStats } from '../types'
import { REFERRAL_RATES } from '../lib/referrals'

interface ReferralLevelCardProps {
  stats: ReferralLevelStats
}

/** Картка зведення по одному рівню реферальної програми: "N рівень (X%)". */
export default function ReferralLevelCard({ stats }: ReferralLevelCardProps) {
  const { t } = useTranslation()
  const percent = Math.round(REFERRAL_RATES[stats.level] * 100)

  return (
    <div className="glass-card p-3">
      <p className="text-xs font-semibold text-neon-glow">
        {t('friends.levelTitle', { level: stats.level, percent })}
      </p>
      <div className="mt-2 space-y-1 text-[11px] text-slate-400">
        <p>{t('friends.invitedCount', { count: stats.invitedCount })}</p>
        <p className="font-mono tabular-nums">
          {t('friends.depositsSum', { amount: stats.totalDepositedUsd.toFixed(2) })}
        </p>
      </div>
    </div>
  )
}
