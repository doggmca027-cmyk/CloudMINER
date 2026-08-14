import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { haptic } from '../lib/telegram'
import { updateUserLanguage } from '../lib/userProfile'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n'

interface LanguageOption {
  code: SupportedLanguage
  /** Назва мови рідною мовою — навмисно НЕ перекладається через t(). */
  label: string
  flag: string
}

const LANGUAGES: LanguageOption[] = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'kk', label: 'Қазақша', flag: '🇰🇿' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
]

// LANGUAGES вище має покривати рівно SUPPORTED_LANGUAGES з i18n.ts — якщо
// хтось додасть мову в один список і забуде інший, це спливе одразу в деві.
if (import.meta.env.DEV) {
  const missing = SUPPORTED_LANGUAGES.filter((code) => !LANGUAGES.some((l) => l.code === code))
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[LanguageSelector] Відсутні мови в LANGUAGES:', missing)
  }
}

/**
 * Випадаючий список вибору мови. Кнопка має фіксований розмір, панель
 * випадає поверх контенту (`absolute` + `z-50`), тож верстка навколо
 * ніколи не зсувається при відкритті/закритті. Позиціонування — через
 * логічні класи (`end-*`, `text-start`), тож у RTL (арабська) панель і
 * текст самі дзеркаляться разом з рештою інтерфейсу.
 */
export default function LanguageSelector() {
  const { i18n, t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // `resolvedLanguage` — фактично активна мова контенту (завжди один з
  // завантажених кодів). Сирий `i18n.language` може бути "en-US" тощо і не
  // збігтися з жодним пунктом списку, через що кнопка показувала б довільну
  // мову замість тієї, якою реально показано текст.
  const current =
    LANGUAGES.find((lang) => lang.code === i18n.resolvedLanguage) ??
    LANGUAGES.find((lang) => lang.code === 'ru') ??
    LANGUAGES[0]

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSelect(code: SupportedLanguage) {
    void i18n.changeLanguage(code)
    haptic.selection()
    setIsOpen(false)
    // Fire-and-forget: локальний UI вже змінився, бекенд синхронізується у
    // фоні для наступних сеансів (get_or_create_user поверне цю мову).
    void updateUserLanguage(code)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={t('profile.language')}
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-slate-900/80 px-3 py-1.5 text-sm"
      >
        <span aria-hidden>{current.flag}</span>
        <span className="text-xs font-medium uppercase text-slate-300">{current.code}</span>
        <span
          aria-hidden
          className={`text-[10px] text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {isOpen && (
        <div className="glass-card absolute end-0 top-full z-50 mt-2 max-h-72 w-48 overflow-y-auto py-1 shadow-neon">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => handleSelect(lang.code)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition-colors hover:bg-cyan-500/10 ${
                lang.code === current.code ? 'text-neon-glow' : 'text-slate-300'
              }`}
            >
              <span aria-hidden>{lang.flag}</span>
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
