import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { haptic } from '../lib/telegram'
import { useUserState } from '../context/UserStateContext'
import DepositPanel from '../components/DepositPanel'
import WithdrawPanel from '../components/WithdrawPanel'

type Direction = 'deposit' | 'withdraw'

/** Як часто оновлювати профіль (баланс/eligibility), поки відкрита вкладка Кошелёк. */
const REFRESH_INTERVAL_MS = 15_000

export default function WalletTab() {
  const { t } = useTranslation()
  const { loadUser } = useUserState()
  const [direction, setDirection] = useState<Direction>('deposit')

  function handleSelect(next: Direction) {
    setDirection(next)
    haptic.selection()
  }

  // Автозарахування депозитів відбувається у фоні (Edge Function), поки
  // застосунок відкритий — періодично підтягуємо свіжий баланс і статус
  // deposit-lock, щоб не змушувати користувача перезавантажувати сторінку.
  useEffect(() => {
    void loadUser()
    const intervalId = setInterval(() => void loadUser(), REFRESH_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [loadUser])

  return (
    <div className="space-y-4">
      <div className="glass-card grid grid-cols-2 gap-1 p-1">
        <button
          type="button"
          onClick={() => handleSelect('deposit')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors ${
            direction === 'deposit' ? 'bg-cyan-500/15 text-neon-glow' : 'text-slate-400'
          }`}
        >
          <span aria-hidden>📥</span> {t('wallet.depositTab')}
        </button>
        <button
          type="button"
          onClick={() => handleSelect('withdraw')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors ${
            direction === 'withdraw' ? 'bg-cyan-500/15 text-neon-glow' : 'text-slate-400'
          }`}
        >
          <span aria-hidden>📤</span> {t('wallet.withdrawTab')}
        </button>
      </div>

      {direction === 'deposit' ? <DepositPanel /> : <WithdrawPanel />}
    </div>
  )
}
