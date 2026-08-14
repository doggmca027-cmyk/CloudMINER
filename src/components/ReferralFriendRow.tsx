import { UserCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReferralListItem } from '../types'

interface ReferralFriendRowProps {
  item: ReferralListItem
}

/** Рядок особисто запрошеного (рівень 1): аватар-іконка, замасковане ім'я, депозит, дохід. */
export default function ReferralFriendRow({ item }: ReferralFriendRowProps) {
  const { t, i18n } = useTranslation()
  const joinedDate = new Date(item.joinedAt).toLocaleDateString(i18n.language)

  return (
    <div className="glass-card flex items-center gap-3 p-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-slate-800/60">
        <UserCircle2 size={22} className="text-neon-glow" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-100">{item.maskedName}</p>
        <p className="text-[11px] text-slate-500">{t('friends.joined')}: {joinedDate}</p>
      </div>

      <div className="shrink-0 text-end text-[11px]">
        <p className="text-slate-400">
          {t('friends.depositLabel', { amount: item.totalDepositedUsd.toFixed(2) })}
        </p>
        <p className="font-mono font-semibold tabular-nums text-neon-glow">
          {t('friends.earnedFromLabel', { amount: item.earnedFromUsd.toFixed(2) })}
        </p>
      </div>
    </div>
  )
}
