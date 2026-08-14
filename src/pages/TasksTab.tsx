import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUserState } from '../context/UserStateContext'
import { REQUIRED_LINKS, verifyTaskSubscription } from '../lib/subscription'
import { getTelegramUser, haptic, openTelegramLink } from '../lib/telegram'
import { fetchUserTasks, PARTNER_TASKS } from '../lib/tasksCatalog'
import type { Task } from '../types'
import SubscriptionRow from '../components/SubscriptionRow'
import TaskCard from '../components/TaskCard'

export default function TasksTab() {
  const { t } = useTranslation()
  const { subscription, checkingSubscription, refreshSubscription, claimTaskReward } = useUserState()

  const [verifyingTaskId, setVerifyingTaskId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>(PARTNER_TASKS)

  // Живий каталог завдань + РЕАЛЬНИЙ статус виконання поточним користувачем
  // (з таблиці user_tasks, через RPC list_user_tasks) — на відміну від
  // колишнього клієнтського completedTaskIds, цей статус переживає
  // перезавантаження застосунку. Хардкод PARTNER_TASKS лишається як фолбек
  // на час завантаження й на випадок помилки/порожньої таблиці.
  useEffect(() => {
    let cancelled = false
    void fetchUserTasks().then((loaded) => {
      if (!cancelled) setTasks(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const subscribed = subscription.channel && subscription.chat

  async function handleVerifyPartnerTask(taskId: string, actionUrl: string) {
    setVerifyingTaskId(taskId)
    haptic.impact('light')
    try {
      const telegramId = getTelegramUser()?.id ?? 0
      const isSubscribed = await verifyTaskSubscription(actionUrl, telegramId)
      if (!isSubscribed) {
        haptic.notification('warning')
        return
      }

      const result = await claimTaskReward(taskId)
      if (result.success) {
        setTasks((list) => list.map((t) => (t.id === taskId ? { ...t, status: 'claimed' } : t)))
        haptic.notification('success')
      } else {
        // 'already_claimed' — заявку вже видано раніше (напр. в іншій
        // сесії) — просто підтягуємо реальний стан замість помилки.
        if (result.error === 'already_claimed') {
          setTasks((list) => list.map((t) => (t.id === taskId ? { ...t, status: 'claimed' } : t)))
        }
        haptic.notification('error')
      }
    } finally {
      setVerifyingTaskId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Обов'язкові завдання — без них free-майнер не нараховує дохід (MiningTab). */}
      <section className="glass-card p-4">
        <p className="text-sm font-semibold text-slate-200">{t('tasks.mandatoryTitle')}</p>
        <p className="mt-1 text-xs text-slate-400">{t('tasks.mandatorySubtitle')}</p>

        <div className="mt-3 space-y-1.5">
          <SubscriptionRow
            label={t('mining.freeMiner.channel')}
            subscribed={subscription.channel}
            onOpen={() => openTelegramLink(REQUIRED_LINKS.channel)}
          />
          <SubscriptionRow
            label={t('mining.freeMiner.chat')}
            subscribed={subscription.chat}
            onOpen={() => openTelegramLink(REQUIRED_LINKS.chat)}
          />
        </div>

        <button
          type="button"
          onClick={refreshSubscription}
          disabled={checkingSubscription}
          className="mt-3 w-full rounded-xl border border-cyan-500/30 py-2 text-sm font-medium text-neon-glow transition-opacity disabled:opacity-50"
        >
          {checkingSubscription ? t('mining.freeMiner.checking') : t('tasks.check')}
        </button>

        {!subscribed && <p className="mt-2 text-[11px] text-amber-400">{t('tasks.mandatoryWarning')}</p>}
      </section>

      {/* Завдання від амбасадорів/партнерів — разова винагорода за підписку. */}
      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-slate-300">{t('tasks.partners')}</h2>
        {tasks.length === 0 ? (
          <div className="glass-card p-6 text-center text-sm text-slate-400">{t('tasks.noTasks')}</div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                completed={task.status === 'claimed'}
                verifying={verifyingTaskId === task.id}
                onOpenLink={() => task.actionUrl && openTelegramLink(task.actionUrl)}
                onVerify={() => handleVerifyPartnerTask(task.id, task.actionUrl ?? task.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
