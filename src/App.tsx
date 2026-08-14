import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import Navigation from './components/Navigation'
import MiningTab from './pages/MiningTab'
import ShopTab from './pages/ShopTab'
import TasksTab from './pages/TasksTab'
import TeamPage from './pages/TeamPage'
import WalletTab from './pages/WalletTab'
import ProfilePage from './pages/ProfilePage'
import { useUserState } from './context/UserStateContext'

function App() {
  const { loadUser } = useUserState()

  // Завантажує (або створює) профіль користувача з Supabase одразу при старті.
  useEffect(() => {
    void loadUser()
  }, [loadUser])

  return (
    <div className="min-h-screen bg-base px-3 pb-24 pt-3">
      <div className="mx-auto max-w-md">
        <Header />
      </div>
      <main className="mx-auto mt-4 max-w-md">
        <Routes>
          <Route path="/" element={<MiningTab />} />
          <Route path="/shop" element={<ShopTab />} />
          <Route path="/tasks" element={<TasksTab />} />
          <Route path="/wallet" element={<WalletTab />} />
          {/* Team/Profile поки без пункту в нижньому меню (не входять до
              чотирьох основних вкладок), але маршрути лишаються доступними. */}
          <Route path="/team" element={<TeamPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>
      </main>
      <Navigation />
    </div>
  )
}

export default App
