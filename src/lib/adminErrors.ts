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

/**
 * Те саме, що {@link adminErrorKey} + `t(...)`, але для НЕВІДОМОГО коду
 * повертає перекладене generic-повідомлення З ДОДАНИМ сирим текстом
 * помилки, а не ховає його повністю.
 *
 * Чому це важливо: невідомий код — це майже завжди не "просто мережа",
 * а реальна необроблена помилка з бекенду (напр. живий кейс: Postgres
 * `22P02 invalid input syntax for type numeric` при спробі створити
 * завдання з нагородою, куди мобільна RU/UK-клавіатура підставила кому
 * замість крапки) — раніше такі помилки повністю ховались за generic
 * текстом, і єдиним способом дізнатись справжню причину було живе
 * відтворення запиту розробником. Відомі коди (`not_admin`,
 * `invalid_reward` тощо) і далі показують ЛИШЕ чистий переклад — вони
 * вже людяні самі по собі, дублювати сирий код не треба.
 */
export function adminErrorMessage(message: string, t: (key: string) => string): string {
  if (KNOWN_ERROR_CODES.has(message)) return t(`admin.errors.${message}`)
  return `${t('admin.errors.generic')} (${message})`
}
