import { useTranslation } from 'react-i18next'
import type { MinerTemplate } from '../types'
import { getCapUsd, getRatePerSecond } from '../lib/mining'
import { applyDiscount } from '../lib/appSettings'

interface PackCardProps {
  template: MinerTemplate
  /** Глобальна знижка з адмінки, % (0 — вимкнена/не налаштована). */
  discountPercent: number
  onBuy: () => void
}

/** Картка майнинг-паку в каталозі ShopTab: звичайний (ціан) або VIP (золото). */
export default function PackCard({ template, discountPercent, onBuy }: PackCardProps) {
  const { t } = useTranslation()
  const isVip = template.isVip

  const capUsd = getCapUsd(template)
  const dailyUsd = capUsd / template.durationDays
  const ratePerSecond = getRatePerSecond(template)
  const profitPercent = Math.round((template.returnMultiplier - 1) * 100)
  const hasDiscount = discountPercent > 0
  const discountedPriceUsd = hasDiscount ? applyDiscount(template.depositUsd, discountPercent) : template.depositUsd

  return (
    <div
      className={
        isVip
          ? 'relative overflow-hidden rounded-2xl border border-premium/40 bg-gradient-to-br from-amber-950/50 via-slate-900/90 to-slate-900/90 p-4 shadow-premium animate-pulse-gold'
          : 'glass-card p-4'
      }
    >
      {isVip && (
        <span className="absolute end-3 top-3 rounded-full bg-premium-gradient px-2 py-0.5 text-[10px] font-bold text-slate-950">
          VIP
        </span>
      )}
      {hasDiscount && (
        <span className="absolute start-3 top-3 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
          −{discountPercent}%
        </span>
      )}

      <p
        className={`truncate text-xs font-bold uppercase tracking-wide ${
          isVip ? 'text-premium-glow' : 'text-slate-300'
        }`}
      >
        {template.name}
      </p>

      {hasDiscount ? (
        <div className="flex items-baseline gap-1.5">
          <p className={`text-2xl font-extrabold tabular-nums ${isVip ? 'text-premium-glow' : 'text-neon-glow'}`}>
            {discountedPriceUsd.toLocaleString()} <span className="text-sm font-medium">USDT</span>
          </p>
          <p className="text-xs font-medium text-slate-500 line-through">
            {template.depositUsd.toLocaleString()}
          </p>
        </div>
      ) : (
        <p
          className={`text-2xl font-extrabold tabular-nums ${
            isVip ? 'text-premium-glow' : 'text-neon-glow'
          }`}
        >
          {template.depositUsd.toLocaleString()} <span className="text-sm font-medium">USDT</span>
        </p>
      )}
      <p className="mt-0.5 text-xs text-slate-400">
        {template.durationDays} {t('shop.days')} · {Math.round(template.returnMultiplier * 100)}%
      </p>
      <p className="text-[11px] text-slate-500">
        {t('shop.bodyPlusProfit', { body: 100, profit: profitPercent })}
      </p>

      <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-800/60 px-2.5 py-2">
        <div>
          <p className="text-[10px] text-slate-400">{t('shop.dailyProfit')}</p>
          <p
            className={`font-mono text-xs font-semibold tabular-nums ${
              isVip ? 'text-premium-glow' : 'text-neon-glow'
            }`}
          >
            {dailyUsd.toFixed(2)}
          </p>
        </div>
        <div className="text-end">
          <p className="text-[10px] text-slate-400">{t('shop.perSecond')}</p>
          <p
            className={`font-mono text-xs font-semibold tabular-nums ${
              isVip ? 'text-premium-glow' : 'text-neon-glow'
            }`}
          >
            +{ratePerSecond.toFixed(6)}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onBuy}
        className={
          isVip
            ? 'mt-3 w-full rounded-xl bg-premium-gradient py-2.5 text-sm font-bold text-slate-950'
            : 'mt-3 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950'
        }
      >
        {t('shop.buy')}
      </button>
    </div>
  )
}
