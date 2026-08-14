import { useEffect } from 'react'
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
  const { loadUser, refreshMiners } = useUserState()

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
