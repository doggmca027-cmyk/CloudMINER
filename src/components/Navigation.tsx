import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Store, Pickaxe, Wallet, Target, type LucideIcon } from 'lucide-react'
import { haptic } from '../lib/telegram'

interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { to: '/shop', labelKey: 'tabs.shop', icon: Store },
  { to: '/', labelKey: 'tabs.mining', icon: Pickaxe },
  { to: '/wallet', labelKey: 'tabs.wallet', icon: Wallet },
  { to: '/tasks', labelKey: 'tabs.tasks', icon: Target },
]

/** Нижнє фіксоване меню з чотирьох основних вкладок застосунку. */
export default function Navigation() {
  const { t } = useTranslation()

  return (
    <nav className="glass-card fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between px-2 py-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={() => haptic.selection()}
          className="flex flex-1 flex-col items-center gap-1 py-1 text-[11px]"
        >
          {({ isActive }) => (
            <>
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                  isActive
                    ? 'border-cyan-400/60 bg-cyan-500/15 shadow-neon'
                    : 'border-slate-700/60 bg-slate-800/40'
                }`}
              >
                <item.icon
                  size={18}
                  strokeWidth={2}
                  className={isActive ? 'text-neon-glow' : 'text-slate-400'}
                  aria-hidden
                />
              </span>
              <span className={isActive ? 'font-medium text-neon-glow' : 'text-slate-500'}>
                {t(item.labelKey)}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
