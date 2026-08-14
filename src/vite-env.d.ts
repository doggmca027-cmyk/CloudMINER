/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_DEPOSIT_ADDRESS_TON: string
  readonly VITE_DEPOSIT_ADDRESS_TRC20: string
  readonly VITE_TELEGRAM_BOT_USERNAME: string
  readonly VITE_SUPPORT_TELEGRAM_LINK: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
