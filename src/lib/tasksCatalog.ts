import { supabase } from './supabase'
import { getInitDataOrNull } from './telegram'
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
    verificationType: 'subscription',
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
    verificationType: 'subscription',
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
    verificationType: 'subscription',
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
  verification_type?: Task['verificationType']
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
    verificationType: row.verification_type ?? 'subscription',
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }
}

/**
 * Завантажує активні партнерські завдання напряму з таблиці `tasks`
 * (RLS дозволяє публічний SELECT лише для `is_active = true`) — БЕЗ статусу
 * виконання (усі 'available'). Використовується як фолбек у
 * {@link fetchUserTasks}, коли немає підписаного initData (поза Telegram)
 * або сам RPC не вдався.
 */
export async function fetchActiveTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(
      'id, type, title, description, icon_url, reward_usd, reward_coin, action_url, verification_type, is_active, sort_order',
    )
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

interface UserTaskRow extends TaskRow {
  status: 'claimed' | 'pending' | 'available'
}

/**
 * Те саме, що {@link fetchActiveTasks}, але з РЕАЛЬНИМ статусом виконання
 * поточним користувачем (`status: 'claimed' | 'pending' | 'available'`)
 * через RPC `list_user_tasks` — 'pending' означає, що Bot API щойно
 * підтвердив підписку і йде 24-годинне очікування на нагороду (див.
 * subscription_checks). На відміну від старого клієнтського
 * completedTaskIds, цей статус переживає перезавантаження застосунку.
 */
export async function fetchUserTasks(): Promise<Task[]> {
  const initData = getInitDataOrNull()
  if (initData) {
    const { data, error } = await supabase.rpc('list_user_tasks', { p_init_data: initData })
    if (!error && data) {
      const rows = data as UserTaskRow[]
      if (rows.length > 0) {
        return rows.map((row) => ({ ...mapTaskRow(row), status: row.status }))
      }
      return PARTNER_TASKS
    }
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[tasksCatalog] list_user_tasks не вдався, використано фолбек:', error.message)
    }
  }
  return fetchActiveTasks()
}

export interface ClaimTaskResult {
  success: boolean
  rewardUsd?: number
  newBalanceUsd?: number
  error?: string
}

/** Миттєва винагорода за 'click'-завдання — реально нараховує на сервері (RPC `claim_task_reward`). */
export async function claimTaskRewardRpc(taskId: string): Promise<ClaimTaskResult> {
  const initData = getInitDataOrNull()
  if (!initData) return { success: false, error: 'no_telegram_user' }

  const { data, error } = await supabase.rpc('claim_task_reward', {
    p_init_data: initData,
    p_task_id: taskId,
  })
  if (error) return { success: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  return {
    success: true,
    rewardUsd: row ? Number(row.reward_usd) : 0,
    newBalanceUsd: row ? Number(row.new_balance_usd) : undefined,
  }
}
