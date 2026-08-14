import { Headphones, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { haptic, openTelegramLink, resolveTelegramLink } from '../lib/telegram'
import { useUserState } from '../context/UserStateContext'
import LanguageSelector from './LanguageSelector'

const SUPPORT_LINK = resolveTelegramLink(import.meta.env.VITE_SUPPORT_TELEGRAM_LINK)

export default function Header() {
  const { t } = useTranslation()
  const { user } = useUserState()

  function handleOpenSupport() {
    if (!SUPPORT_LINK) return
    haptic.impact('light')
    openTelegramLink(SUPPORT_LINK)
  }

  return (
    // relative + z-50 на самому <header>, а не лише на обгортці селектора:
    // .glass-card має backdrop-blur, а backdrop-filter створює власний
    // stacking context — z-50 всередині нього не "пробивається" назовні,
    // тож секції нижче по сторінці (теж glass-card) перекривали б випадний
    // список мов. Піднімаємо весь Header цілком.
    <header className="glass-card relative z-50 mx-auto flex max-w-md items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden>
          ⚡
        </span>
        <span className="text-lg font-extrabold tracking-tight text-neon-glow">
          {t('common.appName')}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {user?.isAdmin && (
          <Link
            to="/admin"
            onClick={() => haptic.impact('light')}
            aria-label={t('header.admin')}
            title={t('header.admin')}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-400/30 bg-slate-900/60 text-amber-300 transition-all hover:border-amber-400 hover:text-amber-200 hover:shadow-neon active:scale-95"
          >
            <ShieldCheck size={18} aria-hidden />
          </Link>
        )}

        <button
          type="button"
          onClick={handleOpenSupport}
          disabled={!SUPPORT_LINK}
          aria-label={t('header.support')}
          title={t('header.support')}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-500/30 bg-slate-900/60 text-slate-300 transition-all hover:border-cyan-400 hover:text-neon-glow hover:shadow-neon active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-cyan-500/30 disabled:hover:shadow-none"
        >
          <Headphones size={18} aria-hidden />
        </button>

        <LanguageSelector />
      </div>
    </header>
  )
}
