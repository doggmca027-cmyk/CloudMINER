import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserMiner } from '../types'
import {
  createFreeMiner,
  getRatePerSecond,
  getUnclaimedUsd,
  isMinerCompleted,
  pauseMiner,
  resumeMiner,
} from '../lib/mining'
import { haptic } from '../lib/telegram'
import { useUserState } from '../context/UserStateContext'
import FreeMinerCard from '../components/FreeMinerCard'
import MinerCard from '../components/MinerCard'
import MiningOrb from '../components/MiningOrb'
import TokenIcon from '../components/TokenIcon'

export default function MiningTab() {
  const { t } = useTranslation()
  const {
    balanceUsd,
    miners: purchasedMiners,
    addBalance,
    claimMinerIncome,
    subscription,
    checkingSubscription,
    refreshSubscription,
  } = useUserState()

  // Тікає кожні 100мс — від нього перераховуються всі "живі" суми на екрані.
  const [now, setNow] = useState(() => Date.now())
  const [freeMiner, setFreeMiner] = useState<UserMiner>(() => createFreeMiner())
  // Захист від подвійного тапу на "Собрать" — claimMinerIncome тепер
  // мережевий виклик (RPC), а не миттєва локальна мутація.
  const [claiming, setClaiming] = useState(false)

  const subscribed = subscription.channel && subscription.chat

  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(intervalId)
  }, [])

  // Заморожує/розморожує free-майнер услід за статусом підписки (перевіряється
  // тут або на вкладці Задания — стан підписки спільний через UserStateContext).
  useEffect(() => {
    const atMs = Date.now()
    setFreeMiner((miner) => (subscribed ? resumeMiner(miner, atMs) : pauseMiner(miner, atMs)))
  }, [subscribed])

  const allMiners = [freeMiner, ...purchasedMiners]
  const totalUnclaimedUsd = allMiners.reduce((sum, miner) => sum + getUnclaimedUsd(miner, now), 0)
  const liveBalanceUsd = balanceUsd + totalUnclaimedUsd
  const totalRatePerSecond = allMiners
    .filter((miner) => miner.isActive && !isMinerCompleted(miner, now))
    .reduce((sum, miner) => sum + getRatePerSecond(miner), 0)

  async function handleClaimAll() {
    if (totalUnclaimedUsd <= 0 || claiming) return
    setClaiming(true)
    haptic.impact('light')

    try {
      // Free-майнер — локальний приріст (не персистентний, див. коментар у
      // UserStateContext.tsx). Куплені майнери — реальний RPC-виклик на
      // кожен майнер з непустим доходом; сервер сам рахує точну суму на
      // момент запиту (не довіряє `amount` з клієнта).
      const freeAmount = getUnclaimedUsd(freeMiner, now)
      if (freeAmount > 0) {
        setFreeMiner((miner) => ({ ...miner, claimedUsd: miner.claimedUsd + freeAmount }))
        addBalance(freeAmount)
      }

      const claimable = purchasedMiners.filter((miner) => getUnclaimedUsd(miner, now) > 0)
      await Promise.all(claimable.map((miner) => claimMinerIncome(miner.id)))

      haptic.notification('success')
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="px-1 text-2xl font-extrabold uppercase tracking-tight text-slate-100">
        {t('tabs.mining')}
      </h1>

      <section className="glass-card relative overflow-hidden p-6 text-center">
        {/* Декоративна "схемна" сітка на фоні картки */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(#00f2fe 1px, transparent 1px), linear-gradient(90deg, #00f2fe 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative">
          <MiningOrb />

          <p className="mt-2 text-xs font-medium uppercase tracking-widest text-slate-400">
            {t('mining.yourBalance')}
          </p>
          <div className="mt-1 flex items-center justify-center gap-2">
            <TokenIcon />
            <span className="font-mono text-3xl font-extrabold tabular-nums text-neon-glow">
              {liveBalanceUsd.toLocaleString('en-US', {
                minimumFractionDigits: 6,
                maximumFractionDigits: 6,
              })}
            </span>
            <span className="text-sm font-medium text-slate-400">USDT</span>
          </div>

          <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full border border-dashed border-cyan-400/40 bg-slate-900/40 px-5 py-2 shadow-neon">
            <span className="font-mono text-sm font-semibold tabular-nums text-neon">
              +{totalRatePerSecond.toFixed(6)}
            </span>
            <span className="text-xs text-slate-400">USDT{t('mining.perSecond')}</span>
          </div>

          <button
            type="button"
            onClick={handleClaimAll}
            disabled={totalUnclaimedUsd <= 0 || claiming}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-neon-gradient py-3.5 text-sm font-bold uppercase tracking-wide text-slate-950 shadow-neon transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span aria-hidden>👆</span>
            {t('mining.card.collect')} (+{totalUnclaimedUsd.toFixed(2)})
          </button>
        </div>
      </section>

      <FreeMinerCard
        subscription={subscription}
        checking={checkingSubscription}
        onCheckSubscription={refreshSubscription}
      />

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-slate-300">
          {t('mining.activeMiners')}
        </h2>
        <div className="space-y-3">
          {allMiners.map((miner) => (
            <MinerCard key={miner.id} miner={miner} now={now} />
          ))}
        </div>
      </section>
    </div>
  )
}
