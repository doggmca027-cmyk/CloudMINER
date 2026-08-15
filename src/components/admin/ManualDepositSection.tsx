import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { issueManualDeposit } from '../../lib/admin'
import { adminErrorMessage } from '../../lib/adminErrors'
import { parseLocaleNumber } from '../../lib/number'
import { haptic } from '../../lib/telegram'
import type { AdminCreditType } from '../../types'

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

/** Ручна видача депозиту/бонусу конкретному користувачу за Telegram ID. */
export default function ManualDepositSection() {
  const { t } = useTranslation()
  const [telegramIdInput, setTelegramIdInput] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [creditType, setCreditType] = useState<AdminCreditType>('real_deposit')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [newBalance, setNewBalance] = useState<number | null>(null)

  const telegramId = Number(telegramIdInput)
  const amount = parseLocaleNumber(amountInput)
  const canSubmit =
    Number.isFinite(telegramId) &&
    telegramId > 0 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    status !== 'submitting'

  async function handleSubmit() {
    if (!canSubmit) return
    setStatus('submitting')
    setErrorMessage(null)
    haptic.impact('light')
    try {
      const balance = await issueManualDeposit(telegramId, amount, creditType)
      setNewBalance(balance)
      setStatus('success')
      setTelegramIdInput('')
      setAmountInput('')
      haptic.notification('success')
    } catch (err) {
      setStatus('error')
      setErrorMessage(adminErrorMessage(err instanceof Error ? err.message : String(err), t))
      haptic.notification('error')
    }
  }

  return (
    <div className="glass-card p-4">
      <p className="text-sm font-semibold text-slate-200">{t('admin.deposit.title')}</p>

      <label className="mt-3 block">
        <span className="text-[11px] text-slate-400">{t('admin.deposit.telegramIdLabel')}</span>
        <input
          type="number"
          inputMode="numeric"
          value={telegramIdInput}
          onChange={(e) => setTelegramIdInput(e.target.value)}
          placeholder="123456789"
          className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-cyan-500/50"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-[11px] text-slate-400">{t('admin.deposit.amountLabel')}</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder="10.00"
          className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
        />
      </label>

      <div className="mt-3">
        <span className="text-[11px] text-slate-400">{t('admin.deposit.typeLabel')}</span>
        <div className="mt-1.5 space-y-1.5">
          <label
            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
              creditType === 'real_deposit'
                ? 'border-cyan-500/50 bg-cyan-500/10 text-slate-100'
                : 'border-slate-700 text-slate-400'
            }`}
          >
            <input
              type="radio"
              name="credit-type"
              className="mt-0.5"
              checked={creditType === 'real_deposit'}
              onChange={() => setCreditType('real_deposit')}
            />
            {t('admin.deposit.typeRealDeposit')}
          </label>
          <label
            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
              creditType === 'balance_only'
                ? 'border-cyan-500/50 bg-cyan-500/10 text-slate-100'
                : 'border-slate-700 text-slate-400'
            }`}
          >
            <input
              type="radio"
              name="credit-type"
              className="mt-0.5"
              checked={creditType === 'balance_only'}
              onChange={() => setCreditType('balance_only')}
            />
            {t('admin.deposit.typeBalanceOnly')}
          </label>
        </div>
      </div>

      {status === 'error' && errorMessage && (
        <p className="mt-2 text-xs text-red-400">{errorMessage}</p>
      )}
      {status === 'success' && newBalance !== null && (
        <p className="mt-2 text-xs text-emerald-400">
          {t('admin.deposit.success', { balance: newBalance.toFixed(2) })}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-4 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === 'submitting' ? t('admin.deposit.submitting') : t('admin.deposit.submit')}
      </button>
    </div>
  )
}
