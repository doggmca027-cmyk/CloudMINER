import { useTranslation } from 'react-i18next'
import LanguageSelector from './LanguageSelector'

export default function Header() {
  const { t } = useTranslation()

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

      <LanguageSelector />
    </header>
  )
}
