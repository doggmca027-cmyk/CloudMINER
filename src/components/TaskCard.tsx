import { useTranslation } from 'react-i18next'
import type { Task } from '../types'

interface TaskCardProps {
  task: Task
  completed: boolean
  verifying: boolean
  onOpenLink: () => void
  onVerify: () => void
}

/** Картка партнерського завдання: підписатись → перевірити → отримати винагороду. */
export default function TaskCard({ task, completed, verifying, onOpenLink, onVerify }: TaskCardProps) {
  const { t } = useTranslation()

  return (
    <div className="glass-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {task.iconUrl && (
            <span className="text-xl" aria-hidden>
              {task.iconUrl}
            </span>
          )}
          <div>
            <p className="text-sm font-semibold text-slate-100">{task.title}</p>
            <p className="text-xs text-slate-400">{task.description}</p>
          </div>
        </div>
        <span className="whitespace-nowrap rounded-full bg-premium/10 px-2 py-0.5 text-[10px] font-semibold text-premium-glow">
          +{task.rewardUsd.toFixed(2)} USDT
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenLink}
          disabled={completed}
          className="rounded-xl border border-cyan-500/30 py-2 text-xs font-medium text-neon-glow transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('tasks.subscribe')}
        </button>
        <button
          type="button"
          onClick={onVerify}
          disabled={completed || verifying}
          className="rounded-xl bg-neon-gradient py-2 text-xs font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {completed
            ? t('tasks.completed')
            : verifying
              ? t('mining.freeMiner.checking')
              : t('tasks.check')}
        </button>
      </div>
    </div>
  )
}
