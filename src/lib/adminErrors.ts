/**
 * admin_* RPC (SECURITY DEFINER) кидають `raise exception '<code>'` з
 * короткими машинними кодами (`not_admin`, `user_not_found` тощо) —
 * PostgREST повертає їх як `error.message` без жодного перекладу.
 * Мапимо відомі коди на ключі `admin.errors.*` у locales/*.json; невідомий
 * код (напр. мережева помилка) падає на generic-повідомлення.
 */
const KNOWN_ERROR_CODES = new Set([
  'not_admin',
  'user_not_found',
  'invalid_amount',
  'invalid_credit_type',
  'withdrawal_not_found',
  'withdrawal_already_resolved',
  'title_required',
  'invalid_reward',
  'invalid_verification_type',
  'task_not_found',
  'text_required',
  'invalid_discount_percent',
  'invalid_bonus_percent',
])

/** Повертає ключ i18n (`admin.errors.<code>` або `admin.errors.generic`) для повідомлення RPC-помилки. */
export function adminErrorKey(message: string): string {
  return KNOWN_ERROR_CODES.has(message) ? `admin.errors.${message}` : 'admin.errors.generic'
}
