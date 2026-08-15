import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TonConnectButton, useTonWallet } from '@tonconnect/ui-react'
import { useTonPrice } from '../lib/tonPrice'
import { getAppSettings, calcDepositBonus } from '../lib/appSettings'
import { parseLocaleNumber } from '../lib/number'
import { haptic } from '../lib/telegram'
import {
  MIN_DEPOSIT_USD,
  createDepositIntent,
  getDepositMemoTelegramId,
  type DepositNetwork,
  type ExactAmountNetwork,
} from '../lib/deposits'

/** TON_USDT — той самий гаманець, що й TON (лише інший актив у ньому). */
const NETWORK_OPTIONS: Array<{ code: DepositNetwork; label: string }> = [
  { code: 'TON', label: 'TON' },
  { code: 'TON_USDT', label: 'USDT (TON)' },
  { code: 'TRC20', label: 'USDT (TRC20)' },
]

const DEPOSIT_ADDRESSES: Record<DepositNetwork, string> = {
  TON: import.meta.env.VITE_DEPOSIT_ADDRESS_TON || '',
  TON_USDT: import.meta.env.VITE_DEPOSIT_ADDRESS_TON || '',
  TRC20: import.meta.env.VITE_DEPOSIT_ADDRESS_TRC20 || '',
}

/** TON і TON_USDT — обидва підтримують вільний текстовий comment/memo із telegram_id. */
const MEMO_NETWORKS: DepositNetwork[] = ['TON', 'TON_USDT']
/** TRC20 — токен-перекази без memo, атрибуція через точну суму (deposit_intents). */
const EXACT_AMOUNT_NETWORKS: DepositNetwork[] = ['TRC20']

type IntentStatus = 'idle' | 'generating' | 'ready' | 'error'

export default function DepositPanel() {
  const { t } = useTranslation()
  const wallet = useTonWallet()
  const { rate, isLive } = useTonPrice()

  const [network, setNetwork] = useState<DepositNetwork>('TON')
  const [tonAmount, setTonAmount] = useState('1')
  const [usdtAmount, setUsdtAmount] = useState((Number('1') * rate).toFixed(2))
  const [copied, setCopied] = useState<'address' | 'memo' | 'amount' | null>(null)

  const [intentStatus, setIntentStatus] = useState<IntentStatus>('idle')
  const [exactAmountUsd, setExactAmountUsd] = useState<number | null>(null)
  const [intentError, setIntentError] = useState<string | null>(null)
  // Бонус — глобальний, з адмінки (0, якщо вимкнений/не налаштований).
  // Сервер (credit_deposit) все одно рахує й нараховує його незалежно —
  // це лише відображення в UI, не джерело правди.
  const [bonusPercent, setBonusPercent] = useState(0)

  useEffect(() => {
    let cancelled = false
    void getAppSettings().then((settings) => {
      if (!cancelled && settings.depositBonusEnabled) setBonusPercent(settings.depositBonusPercent)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const telegramId = getDepositMemoTelegramId()
  const usdtAmountNumber = parseLocaleNumber(usdtAmount)
  const isBelowMinimum = Number.isFinite(usdtAmountNumber) && usdtAmountNumber < MIN_DEPOSIT_USD
  const isMemoNetwork = MEMO_NETWORKS.includes(network)
  const isExactAmountNetwork = EXACT_AMOUNT_NETWORKS.includes(network)
  const networkLabel = NETWORK_OPTIONS.find((opt) => opt.code === network)?.label ?? network

  function handleTonChange(value: string) {
    setTonAmount(value)
    const parsed = parseLocaleNumber(value)
    setUsdtAmount(Number.isFinite(parsed) ? (parsed * rate).toFixed(2) : '')
  }

  function handleUsdtChange(value: string) {
    setUsdtAmount(value)
    const parsed = parseLocaleNumber(value)
    setTonAmount(Number.isFinite(parsed) && rate > 0 ? (parsed / rate).toFixed(4) : '')
  }

  function handleSelectNetwork(next: DepositNetwork) {
    setNetwork(next)
    haptic.selection()
    // Точна сума/намір прив'язані до конкретної мережі — при перемиканні їх
    // варто скидати, щоб не показати застарілу суму від іншої мережі.
    setIntentStatus('idle')
    setExactAmountUsd(null)
    setIntentError(null)
  }

  const address = DEPOSIT_ADDRESSES[network]

  async function copyToClipboard(text: string, kind: 'address' | 'memo' | 'amount') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      haptic.notification('success')
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Буфер обміну недоступний (напр. немає HTTPS) — тихо ігноруємо.
    }
  }

  async function handleGenerateExactAmount() {
    if (!isExactAmountNetwork) return
    setIntentStatus('generating')
    setIntentError(null)
    haptic.impact('light')

    const base =
      Number.isFinite(usdtAmountNumber) && usdtAmountNumber >= MIN_DEPOSIT_USD
        ? usdtAmountNumber
        : MIN_DEPOSIT_USD
    const result = await createDepositIntent(base, network as ExactAmountNetwork)

    if (result.success && result.exactAmountUsd) {
      setExactAmountUsd(result.exactAmountUsd)
      setIntentStatus('ready')
      haptic.notification('success')
    } else {
      setIntentStatus('error')
      setIntentError(t('wallet.intentError'))
      haptic.notification('error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <p className="text-sm font-semibold text-slate-200">{t('wallet.connectTon')}</p>
        <p className="mt-1 text-xs text-slate-400">
          {wallet ? t('wallet.walletConnected') : t('common.comingSoon')}
        </p>
        <div className="mt-3">
          <TonConnectButton />
        </div>
      </div>

      <div className="glass-card p-4">
        <p className="text-sm font-semibold text-slate-200">{t('wallet.manualTransfer')}</p>

        <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-800/60 p-1">
          {NETWORK_OPTIONS.map((opt) => (
            <button
              key={opt.code}
              type="button"
              onClick={() => handleSelectNetwork(opt.code)}
              className={`rounded-lg py-1.5 text-center text-[11px] font-semibold leading-tight transition-colors ${
                network === opt.code ? 'bg-cyan-500/15 text-neon-glow' : 'text-slate-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {network === 'TON' ? (
          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-200">{t('wallet.calculator')}</p>
            <p className="mt-1 text-xs text-slate-400">
              {t('wallet.rate')}: 1 TON ≈ {rate.toFixed(2)} USDT
              {!isLive && <span className="text-amber-400"> · {t('wallet.rateEstimated')}</span>}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-slate-400">{t('wallet.tonAmount')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={tonAmount}
                  onChange={(e) => handleTonChange(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">{t('wallet.usdtAmount')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={usdtAmount}
                  onChange={(e) => handleUsdtChange(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                />
              </label>
            </div>
          </div>
        ) : (
          <label className="mt-4 block">
            <span className="text-[11px] text-slate-400">{t('wallet.usdtAmount')}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={usdtAmount}
              onChange={(e) => setUsdtAmount(e.target.value)}
              placeholder={MIN_DEPOSIT_USD.toFixed(2)}
              className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
            />
          </label>
        )}

        {bonusPercent > 0 && (
          <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
            <p className="text-xs font-semibold text-emerald-400">
              {t('wallet.depositBonusBadge', { percent: bonusPercent })}
            </p>
            {Number.isFinite(usdtAmountNumber) && usdtAmountNumber >= MIN_DEPOSIT_USD && (
              <p className="mt-0.5 text-[11px] text-emerald-400/80">
                {t('wallet.depositBonusExample', {
                  bonus: calcDepositBonus(usdtAmountNumber, bonusPercent).toFixed(2),
                })}
              </p>
            )}
          </div>
        )}

        <p className="mt-2 text-[11px] text-slate-500">
          {t('wallet.minDepositNotice', { amount: MIN_DEPOSIT_USD })}
        </p>
        {isBelowMinimum && (
          <p className="mt-1 text-[11px] text-amber-400">
            {t('wallet.belowMinDeposit', { amount: MIN_DEPOSIT_USD })}
          </p>
        )}

        {address ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => copyToClipboard(address, 'address')}
              className="w-full break-all rounded-lg bg-slate-800/60 px-3 py-2 text-center font-mono text-xs text-slate-300"
            >
              {address}
            </button>
            <span className="text-xs text-neon-glow">
              {copied === 'address' ? t('common.copied') : t('common.copy')}
            </span>

            {isMemoNetwork ? (
              <div className="w-full rounded-xl border border-cyan-500/20 bg-slate-800/40 p-3">
                <p className="text-xs font-semibold text-slate-200">{t('wallet.depositMemoTitle')}</p>
                <p className="mt-1 text-[11px] text-slate-400">{t('wallet.depositMemoNotice')}</p>
                {telegramId ? (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(String(telegramId), 'memo')}
                    className="mt-2 w-full rounded-lg bg-slate-900/80 px-3 py-2 text-center font-mono text-sm font-semibold text-neon-glow"
                  >
                    {telegramId}
                  </button>
                ) : (
                  <p className="mt-2 text-[11px] text-amber-400">{t('common.error')}</p>
                )}
                <span className="mt-1 block text-center text-[11px] text-slate-500">
                  {copied === 'memo' ? t('common.copied') : t('wallet.yourTelegramId')}
                </span>
              </div>
            ) : (
              <div className="w-full rounded-xl border border-cyan-500/20 bg-slate-800/40 p-3">
                <p className="text-xs font-semibold text-slate-200">
                  {t('wallet.depositExactAmountTitle', { network: networkLabel })}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {t('wallet.depositExactAmountNotice', { network: networkLabel })}
                </p>

                {intentStatus === 'ready' && exactAmountUsd ? (
                  <>
                    <p className="mt-2 text-[11px] text-slate-400">{t('wallet.exactAmountToSend')}</p>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(exactAmountUsd.toFixed(6), 'amount')}
                      className="mt-1 w-full rounded-lg bg-slate-900/80 px-3 py-2 text-center font-mono text-sm font-semibold text-neon-glow"
                    >
                      {exactAmountUsd.toFixed(6)} USDT
                    </button>
                    <span className="mt-1 block text-center text-[11px] text-slate-500">
                      {copied === 'amount' ? t('common.copied') : t('wallet.intentExpiresNotice')}
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleGenerateExactAmount}
                    disabled={intentStatus === 'generating'}
                    className="mt-2 w-full rounded-xl bg-neon-gradient py-2 text-sm font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {intentStatus === 'generating'
                      ? t('wallet.generatingAmount')
                      : t('wallet.generateExactAmount')}
                  </button>
                )}
                {intentStatus === 'error' && intentError && (
                  <p className="mt-2 text-[11px] text-red-400">{intentError}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 text-center text-xs text-slate-500">{t('wallet.addressNotConfigured')}</p>
        )}
      </div>
    </div>
  )
}
