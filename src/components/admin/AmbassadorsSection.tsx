import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchAmbassadors, setAmbassador } from '../../lib/admin'
import { adminErrorMessage } from '../../lib/adminErrors'
import { haptic } from '../../lib/telegram'
import type { AmbassadorStats } from '../../types'

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

/** Призначення/зняття статусу амбассадора + таблиця мережевої статистики кожного. */
export default function AmbassadorsSection() {
  const { t } = useTranslation()
  const [ambassadors, setAmbassadors] = useState<AmbassadorStats[]>([])
  const [loading, setLoading] = useState(true)
  const [telegramIdInput, setTelegramIdInput] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<number | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchAmbassadors()
      setAmbassadors(list)
    } catch {
      // Список залишиться попереднім/порожнім — форма призначення й так покаже помилку окремо.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleAssign() {
    const telegramId = Number(telegramIdInput)
    if (!Number.isFinite(telegramId) || telegramId <= 0) return

    setStatus('submitting')
    setErrorMessage(null)
    haptic.impact('light')
    try {
      await setAmbassador(telegramId, true)
      setStatus('success')
      setTelegramIdInput('')
      haptic.notification('success')
      await reload()
    } catch (err) {
      setStatus('error')
      setErrorMessage(adminErrorMessage(err instanceof Error ? err.message : String(err), t))
      haptic.notification('error')
    }
  }

  async function handleRemove(telegramId: number) {
    setRowBusyId(telegramId)
    haptic.impact('light')
    try {
      await setAmbassador(telegramId, false)
      await reload()
      haptic.notification('success')
    } catch {
      haptic.notification('error')
    } finally {
      setRowBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <p className="text-sm font-semibold text-slate-200">{t('admin.ambassadors.assignTitle')}</p>

        <label className="mt-3 block">
          <span className="text-[11px] text-slate-400">{t('admin.ambassadors.telegramIdLabel')}</span>
          <input
            type="number"
            inputMode="numeric"
            value={telegramIdInput}
            onChange={(e) => setTelegramIdInput(e.target.value)}
            placeholder="123456789"
            className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-cyan-500/50"
          />
        </label>

        {status === 'error' && errorMessage && (
          <p className="mt-2 text-xs text-red-400">{errorMessage}</p>
        )}
        {status === 'success' && (
          <p className="mt-2 text-xs text-emerald-400">{t('admin.ambassadors.success')}</p>
        )}

        <button
          type="button"
          onClick={handleAssign}
          disabled={status === 'submitting' || !telegramIdInput.trim()}
          className="mt-3 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('admin.ambassadors.assign')}
        </button>
      </div>

      <div className="glass-card p-4">
        <p className="mb-3 text-sm font-semibold text-slate-200">{t('admin.ambassadors.listTitle')}</p>

        {loading ? (
          <p className="text-center text-xs text-slate-500">{t('common.loading')}</p>
        ) : ambassadors.length === 0 ? (
          <p className="text-center text-xs text-slate-500">{t('admin.ambassadors.empty')}</p>
        ) : (
          <div className="space-y-2">
            {ambassadors.map((amb) => (
              <div
                key={amb.telegramId}
                className="rounded-xl border border-cyan-500/10 bg-slate-800/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {amb.username ? `@${amb.username}` : amb.firstName}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">{amb.telegramId}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(amb.telegramId)}
                    disabled={rowBusyId === amb.telegramId}
                    className="whitespace-nowrap rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-400 transition-opacity disabled:opacity-40"
                  >
                    {t('admin.ambassadors.remove')}
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
                  <MiniStat label={t('admin.ambassadors.level1')} value={amb.level1Count} />
                  <MiniStat label={t('admin.ambassadors.level2')} value={amb.level2Count} />
                  <MiniStat label={t('admin.ambassadors.level3')} value={amb.level3Count} />
                  <MiniStat
                    label={t('admin.ambassadors.totalDeposits')}
                    value={`${amb.totalDepositedUsd.toFixed(0)}$`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-900/60 py-1.5">
      <p className="font-mono text-xs font-semibold text-slate-200">{value}</p>
      <p className="text-[9px] leading-tight text-slate-500">{label}</p>
    </div>
  )
}
