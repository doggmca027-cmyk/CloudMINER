import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUserState } from '../context/UserStateContext'
import { haptic } from '../lib/telegram'
import { parseLocaleNumber } from '../lib/number'
import { MIN_DEPOSIT_USD } from '../lib/deposits'
import {
  MIN_WITHDRAWAL_USD,
  WITHDRAWAL_FEE_RATE,
  createWithdrawalRequest,
  getWithdrawalFeeUsd,
  getWithdrawalNetAmountUsd,
  isDepositRequiredError,
  isValidWithdrawalAddress,
  type WithdrawalNetwork,
} from '../lib/withdrawals'

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

// Вивід доступний лише в мережі TON (USDT-jetton) — TRC-20 прибрано з
// виводу (депозити й досі приймають кілька мереж, це стосується тільки
// виводу коштів). Тримаємо як константу, а не useState, бо вибору більше
// немає.
const NETWORK: WithdrawalNetwork = 'TON'

export default function WithdrawPanel() {
  const { t } = useTranslation()
  const { user, balanceUsd, spendBalance, addBalance } = useUserState()

  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // Показуємо повідомлення про блокування лише після того, як користувач
  // реально спробував вивести кошти — не заздалегідь, при відкритті вкладки.
  const [lockedAttempted, setLockedAttempted] = useState(false)

  // Поки профіль не завантажено, не блокуємо форму заздалегідь (щоб не
  // блимати помилковим "заблоковано" до першої відповіді Supabase) — RPC
  // однаково перевірить deposit-lock ще раз на сервері.
  const isWithdrawalLocked = user !== null && !user.hasCompletedDeposit

  const amountNumber = parseLocaleNumber(amount)
  const hasValidAmount = Number.isFinite(amountNumber) && amountNumber >= MIN_WITHDRAWAL_USD
  const hasEnoughBalance = hasValidAmount && amountNumber <= balanceUsd
  const hasValidAddress = address.trim().length > 0 && isValidWithdrawalAddress(address, NETWORK)
  const canSubmit =
    hasValidAmount &&
    hasEnoughBalance &&
    hasValidAddress &&
    status !== 'submitting'

  async function handleSubmit() {
    if (!canSubmit) return

    if (isWithdrawalLocked) {
      setLockedAttempted(true)
      haptic.notification('error')
      return
    }

    setStatus('submitting')
    setErrorMessage(null)
    haptic.impact('light')

    // Оптимістично резервуємо суму з локального балансу перед мережевим запитом.
    const reserved = spendBalance(amountNumber)
    if (!reserved) {
      setStatus('error')
      setErrorMessage(t('wallet.insufficientBalance'))
      return
    }

    const result = await createWithdrawalRequest({
      amountUsd: amountNumber,
      walletAddress: address,
      network: NETWORK,
    })

    if (result.success) {
      setStatus('success')
      haptic.notification('success')
      setAmount('')
      setAddress('')
    } else {
      // Заявка не створена — повертаємо зарезервовану суму назад на баланс.
      addBalance(amountNumber)
      setStatus('error')
      setErrorMessage(
        isDepositRequiredError(result.error)
          ? t('wallet.withdrawalLockedMessage', { amount: MIN_DEPOSIT_USD })
          : t('wallet.requestError'),
      )
      haptic.notification('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="glass-card p-5 text-center">
        <p className="text-sm font-medium text-neon-glow">{t('wallet.requestSuccess')}</p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-4 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950"
        >
          {t('common.close')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!isWithdrawalLocked && (
        <div className="glass-card p-3 text-center text-sm font-semibold text-emerald-400">
          {t('wallet.withdrawalUnlocked')}
        </div>
      )}

      {lockedAttempted && (
        <>
          <div className="glass-card p-3 text-center text-sm font-semibold text-red-400">
            {t('wallet.withdrawalLocked', { amount: MIN_DEPOSIT_USD })}
          </div>
          <p className="px-1 text-center text-xs text-slate-400">
            {t('wallet.withdrawalLockedMessage', { amount: MIN_DEPOSIT_USD })}
          </p>
        </>
      )}

      <div className="glass-card p-4">
        <p className="mb-2 text-xs font-medium text-slate-400">{t('wallet.network')}</p>
        <div className="rounded-xl bg-slate-800/60 px-3 py-2 text-xs font-semibold text-neon-glow">
          TON (USDT)
        </div>

        <label className="mt-4 block">
          <span className="text-[11px] text-slate-400">{t('wallet.amount')} (USDT)</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={MIN_WITHDRAWAL_USD.toFixed(2)}
            className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-[11px] text-slate-400">{t('wallet.address')}</span>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="UQ..."
            className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-cyan-500/50"
          />
          {address.trim().length > 0 && !hasValidAddress && (
            <span className="mt-1 block text-[11px] text-red-400">{t('wallet.invalidAddress')}</span>
          )}
        </label>

        <div className="mt-4 space-y-1.5 rounded-xl bg-slate-800/60 p-3 text-xs">
          <Row label={t('wallet.minAmount')} value={`${MIN_WITHDRAWAL_USD.toFixed(2)} USDT`} />
          <Row label={t('wallet.fee')} value={`${Math.round(WITHDRAWAL_FEE_RATE * 100)}%`} />
          <Row
            label={t('wallet.youWillReceive')}
            value={
              hasValidAmount
                ? `${getWithdrawalNetAmountUsd(amountNumber).toFixed(2)} USDT`
                : '—'
            }
          />
          {hasValidAmount && (
            <Row label="" value={`(−${getWithdrawalFeeUsd(amountNumber).toFixed(2)} USDT ${t('wallet.fee').toLowerCase()})`} />
          )}
          <Row label={t('wallet.balance')} value={`${balanceUsd.toFixed(2)} USDT`} />
        </div>

        {hasValidAmount && !hasEnoughBalance && (
          <p className="mt-2 text-xs text-red-400">{t('wallet.insufficientBalance')}</p>
        )}
        {status === 'error' && errorMessage && (
          <p className="mt-2 text-xs text-red-400">{errorMessage}</p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="mt-4 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === 'submitting' ? t('wallet.creatingRequest') : t('wallet.requestWithdraw')}
        </button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono font-medium text-slate-200">{value}</span>
    </div>
  )
}
