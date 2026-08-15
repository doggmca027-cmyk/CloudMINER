import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crown, HandCoins, ListChecks, Megaphone, ShieldCheck, type LucideIcon } from 'lucide-react'
import { haptic } from '../lib/telegram'
import { useUserState } from '../context/UserStateContext'
import AmbassadorsSection from '../components/admin/AmbassadorsSection'
import ManualDepositSection from '../components/admin/ManualDepositSection'
import WithdrawalsSection from '../components/admin/WithdrawalsSection'
import TasksSection from '../components/admin/TasksSection'
import BroadcastSection from '../components/admin/BroadcastSection'

type AdminSection = 'ambassadors' | 'deposit' | 'withdrawals' | 'tasks' | 'broadcast'

interface SectionTab {
  key: AdminSection
  labelKey: string
  icon: LucideIcon
}

const SECTION_TABS: SectionTab[] = [
  { key: 'ambassadors', labelKey: 'admin.tabs.ambassadors', icon: Crown },
  { key: 'deposit', labelKey: 'admin.tabs.deposits', icon: HandCoins },
  { key: 'withdrawals', labelKey: 'admin.tabs.withdrawals', icon: ShieldCheck },
  { key: 'tasks', labelKey: 'admin.tabs.tasks', icon: ListChecks },
  { key: 'broadcast', labelKey: 'admin.tabs.broadcast', icon: Megaphone },
]

/**
 * Адмін-панель — доступ гейтується на клієнті (`user?.isAdmin`, лише для
 * зручності UX: приховати посилання від звичайних користувачів), але
 * реальний захист живе на сервері — кожен admin_* RPC незалежно
 * перевіряє `users.is_admin` через `is_admin_telegram_id()`, тож навіть
 * пряме відкриття /admin в DevTools нічого не дасть без цього прапорця в БД.
 */
export default function AdminTab() {
  const { t } = useTranslation()
  const { user } = useUserState()
  const [section, setSection] = useState<AdminSection>('ambassadors')

  function handleSelect(next: AdminSection) {
    setSection(next)
    haptic.selection()
  }

  if (!user?.isAdmin) {
    return <div className="glass-card p-6 text-center text-sm text-slate-400">{t('admin.noAccess')}</div>
  }

  return (
    <div className="space-y-4">
      <h1 className="px-1 text-lg font-bold text-neon-glow">{t('admin.title')}</h1>

      <div className="glass-card grid grid-cols-5 gap-1 p-1">
        {SECTION_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleSelect(tab.key)}
            className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-[10px] font-semibold leading-tight transition-colors ${
              section === tab.key ? 'bg-cyan-500/15 text-neon-glow' : 'text-slate-400'
            }`}
          >
            <tab.icon size={16} aria-hidden />
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {section === 'ambassadors' && <AmbassadorsSection />}
      {section === 'deposit' && <ManualDepositSection />}
      {section === 'withdrawals' && <WithdrawalsSection />}
      {section === 'tasks' && <TasksSection />}
      {section === 'broadcast' && <BroadcastSection />}
    </div>
  )
}
