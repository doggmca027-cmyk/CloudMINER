import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector, { type DetectorOptions } from 'i18next-browser-languagedetector'
import { getTelegramUser } from './lib/telegram'

import ru from './locales/ru.json'
import en from './locales/en.json'
import ar from './locales/ar.json'
import id from './locales/id.json'
import es from './locales/es.json'
import kk from './locales/kk.json'
import tr from './locales/tr.json'

export const defaultNS = 'translation'

/** Мови, доступні в LanguageSelector — ru завжди перша (дефолтна/резервна). */
export const SUPPORTED_LANGUAGES = ['ru', 'en', 'ar', 'id', 'es', 'kk', 'tr'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/** Мови RTL — наразі лише арабська. */
const RTL_LANGUAGES: readonly string[] = ['ar']

function isSupportedLanguage(code: string): code is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code)
}

/**
 * Кастомний детектор мови для i18next-browser-languagedetector: читає
 * `language_code` із Telegram WebApp SDK.
 *
 * Правила (як просив користувач):
 *  - якщо мова Telegram входить у SUPPORTED_LANGUAGES (окрім ru) — саме її;
 *  - якщо мови немає, вона не підтримується, або це ru/uk/be — 'ru'
 *    (російська лишається дефолтною/резервною для СНД-аудиторії).
 */
const telegramLanguageDetector = {
  name: 'telegramWebApp',
  lookup(): string | undefined {
    const rawCode = getTelegramUser()?.language_code
    if (!rawCode) return undefined

    const normalized = rawCode.toLowerCase().split('-')[0]
    if (normalized === 'ru' || normalized === 'uk' || normalized === 'be') return 'ru'
    return isSupportedLanguage(normalized) ? normalized : 'ru'
  },
  // Саме кешування в localStorage виконує вбудований детектор 'localStorage'
  // нижче в `detection.order` — тут нічого додатково робити не треба.
  cacheUserLanguage(): void {},
}

const languageDetector = new LanguageDetector()
languageDetector.addDetector(telegramLanguageDetector)

/** Застосовує dir="rtl"/"ltr" та lang на <html> — викликається при кожній зміні мови. */
function applyDocumentDirection(language: string): void {
  const isRtl = RTL_LANGUAGES.includes(language)
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
  document.documentElement.lang = language
}

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ru },
      en: { translation: en },
      ar: { translation: ar },
      id: { translation: id },
      es: { translation: es },
      kk: { translation: kk },
      tr: { translation: tr },
    },
    supportedLngs: SUPPORTED_LANGUAGES,
    // ru — дефолтна/резервна мова: використовується, якщо жоден детектор
    // нічого не повернув, і як фолбек для відсутніх ключів перекладу.
    fallbackLng: 'ru',
    defaultNS,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      // Збережений вибір користувача (localStorage) має пріоритет над
      // Telegram-мовою — інакше перемикач у Header був би марним при
      // кожному новому запуску міні-застосунку.
      order: ['localStorage', 'telegramWebApp', 'navigator'],
      caches: ['localStorage'],
    } satisfies DetectorOptions,
  })
  .then(() => applyDocumentDirection(i18n.language))

i18n.on('languageChanged', applyDocumentDirection)

export default i18n
