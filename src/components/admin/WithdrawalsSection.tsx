import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchPendingWithdrawals, resolveWithdrawal } from '../../lib/admin'
import { haptic } from '../../lib/telegram'
import type { PendingWithdrawal } from '../../types'

/** Модерація заявок на вивід: підтвердити або відхилити (з поверненням балансу). */
export default function WithdrawalsSection() {
  const { t } = useTranslation()
  const [withdrawals, setWithdrawals] = useState<PendingWithdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchPendingWithdrawals()
      setWithdrawals(list)
    } catch {
      // Список лишиться попереднім — конкретна дія все одно покаже власну помилку.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleApprove(transactionId: string) {
    setBusyId(transactionId)
    setMessage(null)
    haptic.impact('light')
    try {
      await resolveWithdrawal(transactionId, true)
      setWithdrawals((list) => list.filter((w) => w.transactionId !== transactionId))
      setMessage({ type: 'success', text: t('admin.withdrawals.approveSuccess') })
      haptic.notification('success')
    } catch {
      setMessage({ type: 'error', text: t('admin.withdrawals.error') })
      haptic.notification('error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(transactionId: string) {
    setBusyId(transactionId)
    setMessage(null)
    haptic.impact('light')
    try {
      await resolveWithdrawal(transactionId, false, reason.trim() || undefined)
      setWithdrawals((list) => list.filter((w) => w.transactionId !== transactionId))
      setMessage({ type: 'success', text: t('admin.withdrawals.rejectSuccess') })
      haptic.notification('success')
      setRejectingId(null)
      setReason('')
    } catch {
      setMessage({ type: 'error', text: t('admin.withdrawals.error') })
      haptic.notification('error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="glass-card p-4">
      <p className="mb-3 text-sm font-semibold text-slate-200">{t('admin.withdrawals.title')}</p>

      {message && (
        <p className={`mb-3 text-xs ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      {loading ? (
        <p className="text-center text-xs text-slate-500">{t('common.loading')}</p>
      ) : withdrawals.length === 0 ? (
        <p className="text-center text-xs text-slate-500">{t('admin.withdrawals.empty')}</p>
      ) : (
        <div className="space-y-3">
          {withdrawals.map((w) => (
            <div key={w.transactionId} className="rounded-xl border border-cyan-500/10 bg-slate-800/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    {w.username ? `@${w.username}` : w.firstName}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">{w.telegramId}</p>
                </div>
                <span className="whitespace-nowrap font-mono text-sm font-semibold text-slate-100">
                  {w.amountUsd.toFixed(2)} USDT
                </span>
              </div>

              <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                <p>
                  {w.network} · <span className="font-mono text-slate-300">{w.walletAddress}</span>
                </p>
                <p>{new Date(w.requestedAt).toLocaleString()}</p>
                <p className="text-emerald-400/80">
                  {t('admin.withdrawals.totalDeposits', { amount: w.userTotalDepositedUsd.toFixed(2) })}
                </p>
              </div>

              {rejectingId === w.transactionId ? (
                <div className="mt-3 space-y-2">
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('admin.withdrawals.reasonPlaceholder')}
                    className="w-full rounded-lg border border-red-500/30 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-red-400"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null)
                        setReason('')
                      }}
                      className="rounded-lg border border-slate-700 py-2 text-xs font-medium text-slate-400"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(w.transactionId)}
                      disabled={busyId === w.transactionId}
                      className="rounded-lg bg-red-500/20 py-2 text-xs font-semibold text-red-300 disabled:opacity-40"
                    >
                      {t('admin.withdrawals.reject')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRejectingId(w.transactionId)}
                    disabled={busyId === w.transactionId}
                    className="rounded-lg border border-red-500/30 py-2 text-xs font-medium text-red-400 disabled:opacity-40"
                  >
                    🔴 {t('admin.withdrawals.reject')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApprove(w.transactionId)}
                    disabled={busyId === w.transactionId}
                    className="rounded-lg bg-neon-gradient py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
                  >
                    🟢 {t('admin.withdrawals.approve')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
