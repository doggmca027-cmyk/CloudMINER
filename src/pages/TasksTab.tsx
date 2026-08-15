import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUserState } from '../context/UserStateContext'
import { verifyTaskSubscription } from '../lib/subscription'
import { haptic, openTelegramLink } from '../lib/telegram'
import { fetchUserTasks, PARTNER_TASKS } from '../lib/tasksCatalog'
import type { Task } from '../types'
import TaskCard from '../components/TaskCard'

export default function TasksTab() {
  const { t } = useTranslation()
  const { claimTaskReward } = useUserState()

  const [verifyingTaskId, setVerifyingTaskId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>(PARTNER_TASKS)
  // Раніше будь-яка помилка перевірки (напр. Bot API не може перевірити
  // конкретний канал, або посилання завдання взагалі не резолвиться —
  // живі кейси: приватне інвайт-посилання замість @username, бот не
  // адмін у каналі партнера) тихо трактувалась як "просто не підписаний"
  // — користувач тиснув "Перевірити" нескінченно, і нічого ніколи не
  // спрацьовувало, без жодного пояснення чому.
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})

  // Живий каталог завдань + РЕАЛЬНИЙ статус виконання поточним користувачем
  // (з таблиці user_tasks/subscription_checks, через RPC list_user_tasks) —
  // на відміну від колишнього клієнтського completedTaskIds, цей статус
  // переживає перезавантаження застосунку. Хардкод PARTNER_TASKS лишається
  // як фолбек на час завантаження й на випадок помилки/порожньої таблиці.
  useEffect(() => {
    let cancelled = false
    void fetchUserTasks().then((loaded) => {
      if (!cancelled) setTasks(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 'click'-завдання — миттєва нагорода (claim_task_reward), як і раніше.
   * 'subscription'-завдання — РЕАЛЬНА перевірка Bot API
   * (verifyTaskSubscription): якщо підписаний ЗАРАЗ, сервер сам реєструє
   * 24-годинне очікування (статус 'pending') і видасть нагороду пізніше,
   * лише якщо користувач не відпишеться. Ніякої миттєвої виплати тут
   * більше немає — раніше нагороду можна було забрати й одразу
   * відписатись.
   */
  async function handleVerifyPartnerTask(task: Task) {
    setVerifyingTaskId(task.id)
    setTaskErrors((errors) => {
      const next = { ...errors }
      delete next[task.id]
      return next
    })
    haptic.impact('light')
    try {
      if (task.verificationType === 'click') {
        const result = await claimTaskReward(task.id)
        if (result.success) {
          setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status: 'claimed' } : t)))
          haptic.notification('success')
        } else {
          if (result.error === 'already_claimed') {
            setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status: 'claimed' } : t)))
          } else if (result.error) {
            setTaskErrors((errors) => ({ ...errors, [task.id]: result.error! }))
          }
          haptic.notification('error')
        }
        return
      }

      const result = await verifyTaskSubscription(task.id)
      if (result.subscribed) {
        setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status: 'pending' } : t)))
        haptic.notification('success')
      } else if (result.error) {
        // Справжня помилка (не просто "ще не підписаний") — показуємо її,
        // а не мовчазний warning-гаптик, за яким нічого не видно.
        setTaskErrors((errors) => ({ ...errors, [task.id]: result.error! }))
        haptic.notification('error')
      } else {
        haptic.notification('warning')
      }
    } finally {
      setVerifyingTaskId(null)
    }
  }

  return (
    <div className="space-y-4">
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
                pending={task.status === 'pending'}
                verifying={verifyingTaskId === task.id}
                errorMessage={taskErrors[task.id]}
                onOpenLink={() => task.actionUrl && openTelegramLink(task.actionUrl)}
                onVerify={() => handleVerifyPartnerTask(task)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
