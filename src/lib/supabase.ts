import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Відсутні змінні оточення VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Створіть .env файл на основі .env.example.',
  )
}

/** Скільки чекати відповіді, перш ніж вважати запит таким, що "завис". */
const REQUEST_TIMEOUT_MS = 20_000

/**
 * `fetch` без явного таймауту (дефолт supabase-js) на нестабільному
 * мобільному з'єднанні (саме контекст Telegram Mini App — WebView,
 * перемикання Wi-Fi/LTE, згортання застосунку) може просто ЗАВИСНУТИ на
 * невизначений час замість помилки — тоді UI лишається на вічному
 * "Загрузка..."/спінері без жодного пояснення, а не показує реальну
 * помилку (як-от щойно живий кейс "TypeError: Load failed" — той хоч
 * ЗАВЕРШИВСЯ помилкою й був показаний користувачу; запит, що просто
 * висить, гірший — його взагалі нічим не побачити). AbortController тут
 * гарантує, що будь-який запит явно провалиться найпізніше через
 * REQUEST_TIMEOUT_MS, а не висітиме нескінченно.
 */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  return fetch(input, { ...init, signal: init?.signal ?? controller.signal }).finally(() => {
    clearTimeout(timeoutId)
  })
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  },
)
