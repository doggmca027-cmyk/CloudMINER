import { supabase } from './supabase'
import { getTelegramUser, requireInitData } from './telegram'
import type {
  AdminCreditType,
  AdminTask,
  AmbassadorStats,
  AppSettings,
  PendingWithdrawal,
  TaskVerificationType,
  TransactionNetwork,
} from '../types'

/**
 * Усі функції нижче — тонкі обгортки над admin_* RPC (SECURITY DEFINER).
 * Реальна перевірка прав живе на сервері (`is_admin_telegram_id` всередині
 * кожної функції) — і сама ідентичність викликача теж: RPC приймає
 * підписаний initData (не голий telegram_id) і сам перевіряє підпис через
 * `verify_telegram_init_data`, тож підміна `user.isAdmin` чи будь-якого ID
 * у DevTools нічого не дає — без справжнього бот-токена підписати чужий
 * initData неможливо.
 */

function requireAdminInitData(): string {
  return requireInitData()
}

// ---------------------------------------------------------------------------
// Амбассадори
// ---------------------------------------------------------------------------

interface AmbassadorRow {
  telegram_id: number
  username: string | null
  first_name: string
  level1_count: number | string
  level2_count: number | string
  level3_count: number | string
  total_deposited_usd: number | string
}

function mapAmbassadorRow(row: AmbassadorRow): AmbassadorStats {
  return {
    telegramId: Number(row.telegram_id),
    username: row.username ?? undefined,
    firstName: row.first_name,
    level1Count: Number(row.level1_count),
    level2Count: Number(row.level2_count),
    level3Count: Number(row.level3_count),
    totalDepositedUsd: Number(row.total_deposited_usd),
  }
}

export async function fetchAmbassadors(): Promise<AmbassadorStats[]> {
  const { data, error } = await supabase.rpc('admin_list_ambassadors', {
    p_admin_init_data: requireAdminInitData(),
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as AmbassadorRow[]).map(mapAmbassadorRow)
}

export async function setAmbassador(targetTelegramId: number, isAmbassador: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_ambassador', {
    p_admin_init_data: requireAdminInitData(),
    p_target_telegram_id: targetTelegramId,
    p_is_ambassador: isAmbassador,
  })
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Ручна видача депозитів
// ---------------------------------------------------------------------------

export async function issueManualDeposit(
  targetTelegramId: number,
  amountUsd: number,
  creditType: AdminCreditType,
): Promise<number> {
  const { data, error } = await supabase.rpc('admin_issue_deposit', {
    p_admin_init_data: requireAdminInitData(),
    p_target_telegram_id: targetTelegramId,
    p_target_first_name: getTelegramUser()?.first_name ?? 'User',
    p_amount_usd: amountUsd,
    p_credit_type: creditType,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return Number(row?.new_balance_usd ?? 0)
}

// ---------------------------------------------------------------------------
// Модерація виводів
// ---------------------------------------------------------------------------

interface PendingWithdrawalRow {
  transaction_id: string
  telegram_id: number
  username: string | null
  first_name: string
  amount_usd: number | string
  fee_usd: number | string
  network: TransactionNetwork
  wallet_address: string
  requested_at: string
  user_total_deposited_usd: number | string
}

function mapPendingWithdrawalRow(row: PendingWithdrawalRow): PendingWithdrawal {
  return {
    transactionId: row.transaction_id,
    telegramId: Number(row.telegram_id),
    username: row.username ?? undefined,
    firstName: row.first_name,
    amountUsd: Number(row.amount_usd),
    feeUsd: Number(row.fee_usd),
    network: row.network,
    walletAddress: row.wallet_address,
    requestedAt: row.requested_at,
    userTotalDepositedUsd: Number(row.user_total_deposited_usd),
  }
}

export async function fetchPendingWithdrawals(): Promise<PendingWithdrawal[]> {
  const { data, error } = await supabase.rpc('admin_list_pending_withdrawals', {
    p_admin_init_data: requireAdminInitData(),
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as PendingWithdrawalRow[]).map(mapPendingWithdrawalRow)
}

export interface ResolveWithdrawalResult {
  /** Хеш/референс транзакції в блокчейні — присутній лише при approve=true. */
  txHash?: string
}

/**
 * Відхилення (approve=false) — звичайний RPC, гроші нікуди не йдуть, лише
 * повертаються на баланс.
 *
 * Підтвердження (approve=true) — НЕ прямий RPC: викликає Edge Function
 * `process-withdrawal`, яка сама відправляє крипту з гарячого гаманця
 * проєкту (приватні ключі живуть тільки в секретах Edge Function, ніколи в
 * браузері) і лише потім позначає заявку завершеною. Пряме "approve=true"
 * через admin_resolve_withdrawal сервер більше не приймає (див.
 * supabase/migrations/20260816091000_auto_withdrawal_payout.sql). Сама
 * Edge Function теж перевіряє підпис `adminInitData` (не довіряє голому
 * ID з тіла запиту) — див. supabase/functions/process-withdrawal/index.ts.
 */
export async function resolveWithdrawal(
  transactionId: string,
  approve: boolean,
  rejectionReason?: string,
): Promise<ResolveWithdrawalResult> {
  const adminInitData = requireAdminInitData()

  if (!approve) {
    const { error } = await supabase.rpc('admin_resolve_withdrawal', {
      p_admin_init_data: adminInitData,
      p_transaction_id: transactionId,
      p_approve: false,
      p_rejection_reason: rejectionReason ?? null,
    })
    if (error) throw new Error(error.message)
    return {}
  }

  const { data, error } = await supabase.functions.invoke('process-withdrawal', {
    body: { adminInitData, transactionId },
  })
  if (error) throw new Error(error.message)
  if (!data?.success) throw new Error(data?.error ?? 'payout_failed')
  return { txHash: data.txHash }
}

// ---------------------------------------------------------------------------
// Управління завданнями
// ---------------------------------------------------------------------------

interface AdminTaskRow {
  id: string
  title: string
  action_url: string | null
  reward_usd: number | string
  verification_type: TaskVerificationType
  is_active: boolean
  sort_order: number
}

function mapAdminTaskRow(row: AdminTaskRow): AdminTask {
  return {
    id: row.id,
    title: row.title,
    actionUrl: row.action_url ?? undefined,
    rewardUsd: Number(row.reward_usd),
    verificationType: row.verification_type,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }
}

export async function fetchAdminTasks(): Promise<AdminTask[]> {
  const { data, error } = await supabase.rpc('admin_list_tasks', {
    p_admin_init_data: requireAdminInitData(),
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as AdminTaskRow[]).map(mapAdminTaskRow)
}

export async function createAdminTask(
  title: string,
  actionUrl: string,
  rewardUsd: number,
  verificationType: TaskVerificationType,
): Promise<void> {
  const { error } = await supabase.rpc('admin_create_task', {
    p_admin_init_data: requireAdminInitData(),
    p_title: title,
    p_action_url: actionUrl,
    p_reward_usd: rewardUsd,
    p_verification_type: verificationType,
  })
  if (error) throw new Error(error.message)
}

export async function setAdminTaskActive(taskId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_task_active', {
    p_admin_init_data: requireAdminInitData(),
    p_task_id: taskId,
    p_is_active: isActive,
  })
  if (error) throw new Error(error.message)
}

export async function deleteAdminTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_task', {
    p_admin_init_data: requireAdminInitData(),
    p_task_id: taskId,
  })
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Скидки/бонусы (глобальні промо-налаштування)
// ---------------------------------------------------------------------------

interface AppSettingsRow {
  shop_discount_enabled: boolean
  shop_discount_percent: number | string
  deposit_bonus_enabled: boolean
  deposit_bonus_percent: number | string
}

function mapAppSettingsRow(row: AppSettingsRow): AppSettings {
  return {
    shopDiscountEnabled: row.shop_discount_enabled,
    shopDiscountPercent: Number(row.shop_discount_percent),
    depositBonusEnabled: row.deposit_bonus_enabled,
    depositBonusPercent: Number(row.deposit_bonus_percent),
  }
}

/**
 * Оновлює обидва промо-налаштування одразу (RPC `admin_update_settings`,
 * SECURITY DEFINER) — сервер сам валідує 0..100 і рахує знижку/бонус
 * "від суми/ціни" у purchase_miner/credit_deposit; це лише
 * читання/запис самого відсотка.
 */
export async function updateAppSettings(next: AppSettings): Promise<AppSettings> {
  const { data, error } = await supabase.rpc('admin_update_settings', {
    p_admin_init_data: requireAdminInitData(),
    p_shop_discount_enabled: next.shopDiscountEnabled,
    p_shop_discount_percent: next.shopDiscountPercent,
    p_deposit_bonus_enabled: next.depositBonusEnabled,
    p_deposit_bonus_percent: next.depositBonusPercent,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('empty_response')
  return mapAppSettingsRow(row as AppSettingsRow)
}

// ---------------------------------------------------------------------------
// Розсилка
// ---------------------------------------------------------------------------

/** Кількість гравців (рядків у `users`) — для UI перед підтвердженням розсилки. */
export async function fetchBroadcastRecipientCount(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_user_count', {
    p_admin_init_data: requireAdminInitData(),
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

/**
 * Ставить повідомлення в чергу для КОЖНОГО гравця (`notification_queue`,
 * RPC `admin_broadcast_message`) — реальна відправка йде окремо, Edge
 * Function `send-notifications` за розкладом. Повертає кількість
 * поставлених у чергу повідомлень.
 */
export async function broadcastMessage(text: string, photoUrl?: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_broadcast_message', {
    p_admin_init_data: requireAdminInitData(),
    p_text: text,
    p_photo_url: photoUrl?.trim() || null,
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
