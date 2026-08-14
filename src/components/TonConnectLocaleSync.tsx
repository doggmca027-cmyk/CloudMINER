import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useTonConnectUI } from '@tonconnect/ui-react'
import { toTonConnectLocale } from '../lib/tonConnectLocale'

/**
 * Синхронізує мову TON Connect UI (модалка підключення гаманця в
 * DepositPanel) з поточною мовою застосунку.
 *
 * `TonConnectUIProvider` приймає `language` лише як ПОЧАТКОВЕ значення при
 * створенні `TonConnectUI` — подальша зміна мови в LanguageSelector сама
 * по собі нічого не оновлює всередині бібліотеки (це окремий стан поза
 * i18next). Саме так у попередньому проєкті TON Connect "працював лише на
 * RU" — гаманець назавжди застигав на мові першого монтування. Виправлення:
 * рантайм-сеттер `tonConnectUI.uiOptions = {...}` (офіційний спосіб
 * бібліотеки оновити опції після створення) викликається щоразу, коли
 * змінюється `i18n.resolvedLanguage`.
 *
 * Компонент нічого не рендерить — лише синхронізує побічний ефект. Має
 * монтуватися всередині <TonConnectUIProvider> (потребує його контексту).
 */
export default function TonConnectLocaleSync() {
  const [tonConnectUI] = useTonConnectUI()
  const { i18n } = useTranslation()

  useEffect(() => {
    tonConnectUI.uiOptions = { language: toTonConnectLocale(i18n.resolvedLanguage) }
  }, [tonConnectUI, i18n.resolvedLanguage])

  return null
}
