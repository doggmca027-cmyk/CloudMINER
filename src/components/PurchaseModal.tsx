import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { MinerTemplate } from '../types'
import { getCapUsd } from '../lib/mining'
import { haptic } from '../lib/telegram'

interface PurchaseModalProps {
  template: MinerTemplate
  balanceUsd: number
  onClose: () => void
  /** Списує вартість паку з балансу й створює майнер на сервері; повертає успіх операції. */
  onConfirmBalance: () => Promise<{ success: boolean; error?: string }>
}

/**
 * Модальне вікно підтвердження купівлі паку. Оплата — ЛИШЕ з балансу
 * акаунту: покупка майнерів напряму через TON Connect свідомо не
 * підтримується (це вимагало б окремого бекенду для підтвердження
 * блокчейн-транзакцій, якого немає, — див. видалений src/lib/tonConnect.ts).
 * Єдиний шлях поповнити баланс — вкладка "Кошелёк" (WalletTab), тому при
 * нестачі коштів тут одразу пропонується перейти туди, а не платити напряму.
 */
export default function PurchaseModal({
  template,
  balanceUsd,
  onClose,
  onConfirmBalance,
}: PurchaseModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [succeeded, setSucceeded] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // Захист від подвійного тапу: без цього прапорця швидкий подвійний тап на
  // "Підтвердити" міг встигнути викликати onConfirmBalance() двічі до
  // ре-рендера з succeeded=true, купуючи майнер вдвічі (якщо балансу
  // вистачало на обидва рази). Сама покупка тепер ще й атомарна на сервері
  // (RPC purchase_miner, FOR UPDATE), тож це суто UI-запобіжник.
  const [submitting, setSubmitting] = useState(false)

  const capUsd = getCapUsd(template)
  const insufficient = balanceUsd < template.depositUsd

  async function handleConfirmBalance() {
    if (submitting) return
    setSubmitting(true)
    setErrorMessage(null)
    const result = await onConfirmBalance()
    if (result.success) {
      setSucceeded(true)
      haptic.notification('success')
    } else {
      setSubmitting(false)
      setErrorMessage(
        result.error === 'insufficient_balance'
          ? t('shop.modal.insufficientFunds')
          : t('shop.modal.purchaseFailed'),
      )
      haptic.notification('error')
    }
  }

  function handleGoToWallet() {
    haptic.impact('light')
    onClose()
    navigate('/wallet')
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

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{t('shop.modal.yourBalance')}</span>
          <span className="font-mono tabular-nums text-slate-200">{balanceUsd.toFixed(2)} USDT</span>
        </div>

        {insufficient ? (
          <>
            <p className="mt-2 text-xs text-red-400">{t('shop.modal.insufficientFunds')}</p>
            <button
              type="button"
              onClick={handleGoToWallet}
              className="mt-3 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950"
            >
              {t('shop.modal.topUp')}
            </button>
          </>
        ) : (
          <>
            {errorMessage && <p className="mt-2 text-xs text-red-400">{errorMessage}</p>}
            <button
              type="button"
              onClick={handleConfirmBalance}
              disabled={submitting}
              className="mt-3 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? t('shop.modal.confirming') : t('shop.modal.confirm')}
            </button>
          </>
        )}
      </div>

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
