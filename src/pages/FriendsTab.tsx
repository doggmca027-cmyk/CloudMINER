import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Share2 } from 'lucide-react'
import { useUserState } from '../context/UserStateContext'
import { haptic } from '../lib/telegram'
import {
  buildReferralLink,
  fetchReferralList,
  fetchReferralStats,
  shareReferralLink,
} from '../lib/referrals'
import type { ReferralLevelStats, ReferralListItem } from '../types'
import ReferralLevelCard from '../components/ReferralLevelCard'
import ReferralFriendRow from '../components/ReferralFriendRow'

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME

export default function FriendsTab() {
  const { t } = useTranslation()
  const { user } = useUserState()

  const [stats, setStats] = useState<ReferralLevelStats[]>([])
  const [list, setList] = useState<ReferralListItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoadingList(true)

    Promise.all([fetchReferralStats(user.telegramId), fetchReferralList(user.telegramId)])
      .then(([statsResult, listResult]) => {
        if (cancelled) return
        setStats(statsResult)
        setList(listResult)
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  if (!user) {
    return (
      <div className="glass-card p-6 text-center text-sm text-slate-400">{t('common.loading')}</div>
    )
  }

  const referralLink = BOT_USERNAME ? buildReferralLink(BOT_USERNAME, user.telegramId) : null

  async function handleCopyLink() {
    if (!referralLink) return
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      haptic.notification('success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Буфер обміну недоступний (напр. немає HTTPS) — тихо ігноруємо.
    }
  }

  function handleShare() {
    if (!referralLink) return
    shareReferralLink(referralLink, t('friends.shareText'))
  }

  return (
    <div className="space-y-4">
      <h1 className="px-1 text-2xl font-extrabold uppercase tracking-tight text-slate-100">
        {t('tabs.friends')}
      </h1>

      <section className="glass-card p-4">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
          {t('friends.yourLink')}
        </p>

        {referralLink ? (
          <>
            <p className="mt-2 w-full break-all rounded-lg bg-slate-800/60 px-3 py-2 text-start font-mono text-xs text-slate-300">
              {referralLink}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/30 py-2 text-sm font-medium text-neon-glow"
              >
                <Copy size={16} aria-hidden />
                {copied ? t('common.copied') : t('common.copy')}
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-neon-gradient py-2 text-sm font-semibold text-slate-950"
              >
                <Share2 size={16} aria-hidden />
                {t('friends.shareInTelegram')}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-xs text-amber-400">{t('friends.linkNotConfigured')}</p>
        )}

        <div className="mt-4 rounded-xl bg-slate-800/60 p-3 text-center">
          <p className="text-[11px] text-slate-400">{t('friends.totalEarned')}</p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums text-neon-glow">
            {user.totalRefEarned.toFixed(2)} USDT
          </p>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {stats.map((levelStats) => (
          <ReferralLevelCard key={levelStats.level} stats={levelStats} />
        ))}
      </section>

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-slate-300">{t('friends.feedTitle')}</h2>
        {loadingList ? (
          <div className="glass-card p-6 text-center text-sm text-slate-400">{t('common.loading')}</div>
        ) : list.length === 0 ? (
          <div className="glass-card p-6 text-center text-sm text-slate-400">
            {t('friends.noReferrals')}
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((item, index) => (
              <ReferralFriendRow key={`${item.maskedName}-${item.joinedAt}-${index}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
