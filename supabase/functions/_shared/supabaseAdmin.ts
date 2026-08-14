// Deno Edge Function runtime — @ts-nocheck-friendly import via npm: specifier.
import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Створює Supabase-клієнт з service_role-ключем — ТІЛЬКИ для використання
 * всередині Edge Functions, ніколи в браузері. `SUPABASE_URL` і
 * `SUPABASE_SERVICE_ROLE_KEY` Supabase підставляє автоматично для кожної
 * задеплоєної функції — вручну задавати їх через `supabase secrets set` не
 * потрібно (тільки для локального `supabase functions serve` знадобиться
 * `supabase/functions/.env`).
 */
export function createSupabaseAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY недоступні в середовищі Edge Function',
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
