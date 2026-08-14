import type { Locales } from '@tonconnect/ui-react'

/**
 * TON Connect UI (модалка підключення гаманця) підтримує лише 'en' | 'ru'
 * для власних рядків — тип `Locales` бібліотеки не має жодної іншої мови.
 * Для решти мов застосунку (ar/id/es/kk/tr) чесно фолбечимо на 'en' —
 * так само, як сама бібліотека робить за замовчуванням.
 */
export function toTonConnectLocale(language: string | undefined): Locales {
  return language === 'ru' ? 'ru' : 'en'
}
