import type { Task } from '../types'

/**
 * TODO: тестові дані для демонстрації UI. У проді список партнерських
 * завдань завантажується з таблиці `tasks` у Supabase (адмін керує
 * каталогом окремо, `status` тут ігнорується — реальний прогрес
 * зберігається в `user_tasks` і читається через UserStateContext).
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
