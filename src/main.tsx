import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { TonConnectUIProvider } from '@tonconnect/ui-react'
import './index.css'
import './i18n'
import { initTelegramWebApp } from './lib/telegram'
import { UserStateProvider } from './context/UserStateContext'
import TonConnectLocaleSync from './components/TonConnectLocaleSync'
import App from './App.tsx'

initTelegramWebApp()

// public/tonconnect-manifest.json посилається на реальний домен
// (www.cloudminer.site) — гаманці TON перевіряють доступність цього
// маніфесту за адресою деплою.
const tonConnectManifestUrl = new URL('/tonconnect-manifest.json', window.location.href).toString()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TonConnectUIProvider manifestUrl={tonConnectManifestUrl}>
      <TonConnectLocaleSync />
      <UserStateProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </UserStateProvider>
    </TonConnectUIProvider>
  </StrictMode>,
)
