import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { MinerTemplate } from '../types'
import { getCapUsd } from '../lib/mining'
import { payWithTonConnect } from '../lib/tonConnect'
import { haptic } from '../lib/telegram'

interface PurchaseModalProps {
  template: MinerTemplate
  balanceUsd: number
  onClose: () => void
  /** Списує вартість паку з балансу й створює майнер; повертає успіх операції. */
  onConfirmBalance: () => boolean
}

type PaymentMethod = 'balance' | 'ton'

/**
 * Модальне вікно підтвердження купівлі паку: оплата з балансу акаунту
 * (з перевіркою достатності коштів) або через TON Connect (заглушка,
 * див. src/lib/tonConnect.ts).
 */
export default function PurchaseModal({
  template,
  balanceUsd,
  onClose,
  onConfirmBalance,
}: PurchaseModalProps) {
  const { t } = useTranslation()
  const [method, setMethod] = useState<PaymentMethod>('balance')
  const [succeeded, setSucceeded] = useState(false)
  const [tonMessage, setTonMessage] = useState<string | null>(null)

  const capUsd = getCapUsd(template)
  const insufficient = balanceUsd < template.depositUsd

  function handleConfirmBalance() {
    const ok = onConfirmBalance()
    if (ok) {
      setSucceeded(true)
      haptic.notification('success')
    } else {
      haptic.notification('error')
    }
  }

  async function handleConfirmTon() {
    haptic.impact('light')
    const result = await payWithTonConnect({
      amountUsd: template.depositUsd,
      comment: `CloudMiner: ${template.name}`,
    })
    if (!result.success) {
      setTonMessage(t('shop.modal.tonComingSoon'))
    }
  }

  if (succeeded) {
    return (
      <ModalShell onClose={onClose}>
        <p className="text-center text-sm font-medium text-neon-glow">{t('shop.modal.success')}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950"
        >
          {t('common.close')}
        </button>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-center text-base font-bold text-slate-100">{t('shop.modal.title')}</h2>

      <div className="mt-3 space-y-1.5 rounded-xl bg-slate-800/60 p-3 text-sm">
        <Row label={t('shop.modal.pack')} value={template.name} />
        <Row label={t('shop.modal.amount')} value={`${template.depositUsd.toFixed(2)} USDT`} />
        <Row label={t('shop.modal.return')} value={`${capUsd.toFixed(2)} USDT`} />
        <Row label={t('shop.modal.duration')} value={`${template.durationDays} ${t('shop.days')}`} />
      </div>

      <p className="mt-4 text-xs font-medium text-slate-400">{t('shop.modal.paymentMethod')}</p>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMethod('balance')}
          className={`rounded-xl border py-2 text-xs font-semibold transition-colors ${
            method === 'balance'
              ? 'border-cyan-500/50 bg-cyan-500/10 text-neon-glow'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          {t('shop.modal.payBalance')}
        </button>
        <button
          type="button"
          onClick={() => setMethod('ton')}
          className={`rounded-xl border py-2 text-xs font-semibold transition-colors ${
            method === 'ton'
              ? 'border-cyan-500/50 bg-cyan-500/10 text-neon-glow'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          {t('shop.modal.payTon')}
        </button>
      </div>

      {method === 'balance' ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('shop.modal.yourBalance')}</span>
            <span className="font-mono tabular-nums text-slate-200">
              {balanceUsd.toFixed(2)} USDT
            </span>
          </div>
          {insufficient && (
            <p className="mt-2 text-xs text-red-400">{t('shop.modal.insufficientFunds')}</p>
          )}
          <button
            type="button"
            onClick={handleConfirmBalance}
            disabled={insufficient}
            className="mt-3 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('shop.modal.confirm')}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          {tonMessage && <p className="mb-2 text-xs text-slate-400">{tonMessage}</p>}
          <button
            type="button"
            onClick={handleConfirmTon}
            className="w-full rounded-xl border border-cyan-500/30 py-2.5 text-sm font-semibold text-neon-glow"
          >
            {t('shop.modal.payTon')}
          </button>
        </div>
      )}

      <button type="button" onClick={onClose} className="mt-3 w-full py-2 text-xs text-slate-500">
        {t('shop.modal.cancel')}
      </button>
    </ModalShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-200">{value}</span>
    </div>
  )
}

function ModalShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3 sm:items-center"
      onClick={onClose}
    >
      <div className="glass-card w-full max-w-sm p-5 shadow-neon" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
