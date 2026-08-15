import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createAdminTask, deleteAdminTask, fetchAdminTasks, setAdminTaskActive } from '../../lib/admin'
import { adminErrorMessage } from '../../lib/adminErrors'
import { parseLocaleNumber } from '../../lib/number'
import { haptic } from '../../lib/telegram'
import type { AdminTask, TaskVerificationType } from '../../types'

type FormStatus = 'idle' | 'submitting' | 'error'

/** Створення нових партнерських завдань і керування наявними (увімкнути/вимкнути/видалити). */
export default function TasksSection() {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<AdminTask[]>([])
  const [loading, setLoading] = useState(true)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [link, setLink] = useState('')
  const [reward, setReward] = useState('')
  const [verificationType, setVerificationType] = useState<TaskVerificationType>('subscription')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchAdminTasks()
      setTasks(list)
    } catch {
      // Список лишиться попереднім/порожнім.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const rewardNumber = parseLocaleNumber(reward)
  const canCreate =
    title.trim().length > 0 &&
    link.trim().length > 0 &&
    Number.isFinite(rewardNumber) &&
    rewardNumber >= 0 &&
    status !== 'submitting'

  async function handleCreate() {
    if (!canCreate) return
    setStatus('submitting')
    setErrorMessage(null)
    haptic.impact('light')
    try {
      await createAdminTask(title.trim(), link.trim(), rewardNumber, verificationType)
      setTitle('')
      setLink('')
      setReward('')
      setStatus('idle')
      haptic.notification('success')
      await reload()
    } catch (err) {
      setStatus('error')
      setErrorMessage(adminErrorMessage(err instanceof Error ? err.message : String(err), t))
      haptic.notification('error')
    }
  }

  async function handleToggleActive(task: AdminTask) {
    setRowBusyId(task.id)
    haptic.impact('light')
    try {
      await setAdminTaskActive(task.id, !task.isActive)
      await reload()
    } catch {
      haptic.notification('error')
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleDelete(taskId: string) {
    setRowBusyId(taskId)
    haptic.impact('light')
    try {
      await deleteAdminTask(taskId)
      setTasks((list) => list.filter((task) => task.id !== taskId))
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
        <p className="text-sm font-semibold text-slate-200">{t('admin.tasks.createTitle')}</p>

        <label className="mt-3 block">
          <span className="text-[11px] text-slate-400">{t('admin.tasks.titleLabel')}</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-[11px] text-slate-400">{t('admin.tasks.linkLabel')}</span>
          <input
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://t.me/..."
            className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-cyan-500/50"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-[11px] text-slate-400">{t('admin.tasks.rewardLabel')}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            placeholder="0.10"
            className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
          />
        </label>

        <div className="mt-3">
          <span className="text-[11px] text-slate-400">{t('admin.tasks.verificationLabel')}</span>
          <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-slate-800/60 p-1">
            <button
              type="button"
              onClick={() => setVerificationType('subscription')}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                verificationType === 'subscription' ? 'bg-cyan-500/15 text-neon-glow' : 'text-slate-400'
              }`}
            >
              {t('admin.tasks.verificationSubscription')}
            </button>
            <button
              type="button"
              onClick={() => setVerificationType('click')}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                verificationType === 'click' ? 'bg-cyan-500/15 text-neon-glow' : 'text-slate-400'
              }`}
            >
              {t('admin.tasks.verificationClick')}
            </button>
          </div>
        </div>

        {status === 'error' && errorMessage && (
          <p className="mt-2 text-xs text-red-400">{errorMessage}</p>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={!canCreate}
          className="mt-4 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === 'submitting' ? t('admin.tasks.creating') : t('admin.tasks.create')}
        </button>
      </div>

      <div className="glass-card p-4">
        <p className="mb-3 text-sm font-semibold text-slate-200">{t('admin.tasks.listTitle')}</p>

        {loading ? (
          <p className="text-center text-xs text-slate-500">{t('common.loading')}</p>
        ) : tasks.length === 0 ? (
          <p className="text-center text-xs text-slate-500">{t('admin.tasks.empty')}</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-cyan-500/10 bg-slate-800/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{task.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">+{task.rewardUsd.toFixed(2)} USDT</p>
                  </div>
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      task.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700/40 text-slate-400'
                    }`}
                  >
                    {task.isActive ? '🟢' : '⚪'}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(task)}
                    disabled={rowBusyId === task.id}
                    className="rounded-lg border border-cyan-500/30 py-2 text-xs font-medium text-neon-glow disabled:opacity-40"
                  >
                    {task.isActive ? t('admin.tasks.deactivate') : t('admin.tasks.activate')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(task.id)}
                    disabled={rowBusyId === task.id}
                    className="rounded-lg border border-red-500/30 py-2 text-xs font-medium text-red-400 disabled:opacity-40"
                  >
                    {t('admin.tasks.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
