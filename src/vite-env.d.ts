/// <reference types="vite/client" />

// Усі VITE_-змінні типізовані як `string | undefined`, а НЕ `string` — це
// відповідає реальності: якщо змінна не задана в білді (немає .env і не
// проброшена хостингом при збірці), Vite підставляє саме `undefined`, а
// не порожній рядок. Раніше тут усі поля були оголошені як `string`,
// TypeScript "вірив" цій брехні й не ловив код, що напряму викликав
// `.trim()`/інші string-методи на цих значеннях без фолбека — саме так
// пройшов повз тайпчек `resolveTelegramLink(import.meta.env.VITE_SUPPORT_TELEGRAM_LINK)`
// у Header.tsx, який валив увесь застосунок при білді без цієї змінної.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined
  readonly VITE_SUPABASE_ANON_KEY: string | undefined
  readonly VITE_DEPOSIT_ADDRESS_TON: string | undefined
  readonly VITE_DEPOSIT_ADDRESS_TRC20: string | undefined
  readonly VITE_TELEGRAM_BOT_USERNAME: string | undefined
  readonly VITE_SUPPORT_TELEGRAM_LINK: string | undefined
  readonly VITE_CHANNEL_LINK: string | undefined
  readonly VITE_TRANSACTIONS_CHANNEL_LINK: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
