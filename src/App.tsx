import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import Navigation from './components/Navigation'
import MiningTab from './pages/MiningTab'
import ShopTab from './pages/ShopTab'
import FriendsTab from './pages/FriendsTab'
import TasksTab from './pages/TasksTab'
import WalletTab from './pages/WalletTab'
import ProfilePage from './pages/ProfilePage'
import AdminTab from './pages/AdminTab'
import { useUserState } from './context/UserStateContext'

function App() {
  const { t } = useTranslation()
  const { loadUser, refreshMiners, loadingUser, userLoadError } = useUserState()

  // Завантажує (або створює) профіль користувача й список куплених
  // майнерів із Supabase одразу при старті.
  useEffect(() => {
    void loadUser()
    void refreshMiners()
  }, [loadUser, refreshMiners])

  return (
    <div className="min-h-screen bg-base px-3 pb-24 pt-3">
      <div className="mx-auto max-w-md">
        <Header />
      </div>
      <main className="mx-auto mt-4 max-w-md">
        {/* Раніше невдалий get_or_create_user (мережа, протухлий initData,
            збій RPC) лишав користувача на вічному "Загрузка..." у кожній
            вкладці окремо, без жодного пояснення — помилка губилась у
            console.warn. Показуємо її тут ОДИН раз, з реальним текстом і
            кнопкою "Повторити", а не мовчазним нескінченним спінером. */}
        {!loadingUser && userLoadError && (
          <div className="glass-card mb-4 p-4 text-center text-sm">
            <p className="font-semibold text-red-400">{t('common.profileLoadError')}</p>
            <p className="mt-1 break-words text-xs text-slate-400">{userLoadError}</p>
            <button
              type="button"
              onClick={() => void loadUser()}
              className="mt-3 rounded-xl border border-cyan-500/30 px-4 py-1.5 text-xs font-medium text-neon-glow"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<MiningTab />} />
          <Route path="/shop" element={<ShopTab />} />
          <Route path="/friends" element={<FriendsTab />} />
          <Route path="/tasks" element={<TasksTab />} />
          <Route path="/wallet" element={<WalletTab />} />
          {/* Profile поки без пункту в нижньому меню (не входить до п'яти
              основних вкладок), але маршрут лишається доступним. */}
          <Route path="/profile" element={<ProfilePage />} />
          {/* /admin: без пункту в нижньому меню, лише через Shield-кнопку в
              Header, видиму тільки user?.isAdmin. AdminTab сам показує
              "немає доступу" для не-адмінів — реальний захист усе одно на
              сервері (кожен admin_* RPC перевіряє is_admin незалежно). */}
          <Route path="/admin" element={<AdminTab />} />
        </Routes>
      </main>
      <Navigation />
    </div>
  )
}

export default App
