import { useTranslation } from 'react-i18next'
import { isFullySubscribed, REQUIRED_LINKS, type SubscriptionStatus } from '../lib/subscription'
import { openTelegramLink } from '../lib/telegram'
import SubscriptionRow from './SubscriptionRow'

interface FreeMinerCardProps {
  subscription: SubscriptionStatus
  checking: boolean
  onCheckSubscription: () => void
}

/**
 * Гейт підписки для free-майнера: статус каналу (+ каналу транзакцій,
 * якщо налаштовано) і кнопка перевірки. Сам майнер відображається разом
 * з рештою у спільному списку MiningTab (через MinerCard) — тут
 * лишається тільки те, що впливає на активність.
 */
export default function FreeMinerCard({
  subscription,
  checking,
  onCheckSubscription,
}: FreeMinerCardProps) {
  const { t } = useTranslation()
  const subscribed = isFullySubscribed(subscription)

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-200">{t('mining.freeMiner.title')}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            subscribed ? 'bg-neon/10 text-neon-glow' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {subscribed ? t('mining.freeMiner.active') : t('mining.freeMiner.frozen')}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-400">{t('mining.freeMiner.subtitle')}</p>

      <div className="mt-3 space-y-1.5">
        <SubscriptionRow
          label={t('mining.freeMiner.channel')}
          subscribed={subscription.channel}
          onOpen={() => openTelegramLink(REQUIRED_LINKS.channel)}
        />
        {REQUIRED_LINKS.tx && (
          <SubscriptionRow
            label={t('mining.freeMiner.tx')}
            subscribed={subscription.tx}
            onOpen={() => openTelegramLink(REQUIRED_LINKS.tx)}
          />
        )}
      </div>

      {!subscribed && (
        <>
          <p className="mt-3 text-xs text-slate-400">{t('mining.freeMiner.subscribeToActivate')}</p>
          <button
            type="button"
            onClick={onCheckSubscription}
            disabled={checking}
            className="mt-2 w-full rounded-xl border border-cyan-500/30 py-2 text-sm font-medium text-neon-glow transition-opacity disabled:opacity-50"
          >
            {checking ? t('mining.freeMiner.checking') : t('mining.freeMiner.checkSubscription')}
          </button>
        </>
      )}
    </div>
  )
}
