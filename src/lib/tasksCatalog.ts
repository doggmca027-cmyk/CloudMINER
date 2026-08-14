import { supabase } from './supabase'
import type { Task } from '../types'

/**
 * Фолбек-дані на випадок, якщо таблиця `tasks` порожня або запит не
 * вдався (напр. немає мережі) — щоб TasksTab не показував порожній екран
 * при першому запуску, поки адмін ще не додав жодного реального завдання.
 */
export const PARTNER_TASKS: Task[] = [
  {
    id: 'partner-alpha-signals',
    type: 'partner',
    title: 'Alpha Crypto Signals',
    description: 'Подпишитесь на канал партнёра',
    iconUrl: '📡',
    rewardUsd: 0.1,
    rewardCoin: 0,
    actionUrl: 'https://t.me/alpha_crypto_signals_demo',
    status: 'available',
    isActive: true,
    sortOrder: 0,
  },
  {
    id: 'partner-crypto-news',
    type: 'partner',
    title: 'Crypto News Hub',
    description: 'Подпишитесь на новостной канал',
    iconUrl: '📰',
    rewardUsd: 0.05,
    rewardCoin: 0,
    actionUrl: 'https://t.me/crypto_news_hub_demo',
    status: 'available',
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'partner-ambassador-club',
    type: 'partner',
    title: 'Ambassador Club',
    description: 'Вступите в клуб амбассадоров проекта',
    iconUrl: '🎖️',
    rewardUsd: 0.2,
    rewardCoin: 0,
    actionUrl: 'https://t.me/ambassador_club_demo',
    status: 'available',
    isActive: true,
    sortOrder: 2,
  },
]

interface TaskRow {
  id: string
  type: Task['type']
  title: string
  description: string
  icon_url: string | null
  reward_usd: number | string
  reward_coin: number | string
  action_url: string | null
  is_active: boolean
  sort_order: number
}

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    iconUrl: row.icon_url ?? undefined,
    rewardUsd: Number(row.reward_usd),
    rewardCoin: Number(row.reward_coin),
    actionUrl: row.action_url ?? undefined,
    status: 'available',
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }
}

/**
 * Завантажує активні партнерські завдання напряму з таблиці `tasks`
 * (RLS дозволяє публічний SELECT лише для `is_active = true`) — керує
 * каталогом адмін через `admin_create_task`/`admin_set_task_active`.
 * Falls back to {@link PARTNER_TASKS}, якщо запит не вдався або таблиця
 * порожня (напр. свіжий проєкт без жодного заведеного завдання).
 */
export async function fetchActiveTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, type, title, description, icon_url, reward_usd, reward_coin, action_url, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[tasksCatalog] fetchActiveTasks не вдався, використано фолбек:', error.message)
    return PARTNER_TASKS
  }

  const rows = (data ?? []) as TaskRow[]
  return rows.length > 0 ? rows.map(mapTaskRow) : PARTNER_TASKS
}
