import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TonConnectButton, useTonWallet } from '@tonconnect/ui-react'
import QRCode from 'react-qr-code'
import { useTonPrice } from '../lib/tonPrice'
import { haptic } from '../lib/telegram'
import { MIN_DEPOSIT_USD, createDepositIntent, getDepositMemoTelegramId } from '../lib/deposits'

type DepositNetwork = 'TON' | 'TRC20'

const DEPOSIT_ADDRESSES: Record<DepositNetwork, string> = {
  TON: import.meta.env.VITE_DEPOSIT_ADDRESS_TON,
  TRC20: import.meta.env.VITE_DEPOSIT_ADDRESS_TRC20,
}

type IntentStatus = 'idle' | 'generating' | 'ready' | 'error'

export default function DepositPanel() {
  const { t } = useTranslation()
  const wallet = useTonWallet()
  const { rate, isLive } = useTonPrice()

  const [tonAmount, setTonAmount] = useState('1')
  const [usdtAmount, setUsdtAmount] = useState((Number('1') * rate).toFixed(2))
  const [network, setNetwork] = useState<DepositNetwork>('TON')
  const [copied, setCopied] = useState<'address' | 'memo' | 'amount' | null>(null)

  const [intentStatus, setIntentStatus] = useState<IntentStatus>('idle')
  const [exactAmountUsd, setExactAmountUsd] = useState<number | null>(null)
  const [intentError, setIntentError] = useState<string | null>(null)

  const telegramId = getDepositMemoTelegramId()
  const usdtAmountNumber = Number(usdtAmount)
  const isBelowMinimum = Number.isFinite(usdtAmountNumber) && usdtAmountNumber < MIN_DEPOSIT_USD

  function handleTonChange(value: string) {
    setTonAmount(value)
    const parsed = Number(value)
    setUsdtAmount(Number.isFinite(parsed) ? (parsed * rate).toFixed(2) : '')
  }

  function handleUsdtChange(value: string) {
    setUsdtAmount(value)
    const parsed = Number(value)
    setTonAmount(Number.isFinite(parsed) && rate > 0 ? (parsed / rate).toFixed(4) : '')
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
    setIntentStatus('generating')
    setIntentError(null)
    haptic.impact('light')

    const base = Number.isFinite(usdtAmountNumber) && usdtAmountNumber >= MIN_DEPOSIT_USD
      ? usdtAmountNumber
      : MIN_DEPOSIT_USD
    const result = await createDepositIntent(base)

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
        <p className="text-sm font-semibold text-slate-200">{t('wallet.calculator')}</p>
        <p className="mt-1 text-xs text-slate-400">
          {t('wallet.rate')}: 1 TON ≈ {rate.toFixed(2)} USDT
          {!isLive && <span className="text-amber-400"> · {t('wallet.rateEstimated')}</span>}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {t('wallet.minDepositNotice', { amount: MIN_DEPOSIT_USD })}
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

        {isBelowMinimum && (
          <p className="mt-2 text-[11px] text-amber-400">
            {t('wallet.belowMinDeposit', { amount: MIN_DEPOSIT_USD })}
          </p>
        )}
      </div>

      <div className="glass-card p-4">
        <p className="text-sm font-semibold text-slate-200">{t('wallet.manualTransfer')}</p>

        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-800/60 p-1">
          {(['TON', 'TRC20'] as const).map((net) => (
            <button
              key={net}
              type="button"
              onClick={() => setNetwork(net)}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                network === net ? 'bg-cyan-500/15 text-neon-glow' : 'text-slate-400'
              }`}
            >
              {net}
            </button>
          ))}
        </div>

        {address ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            <div className="rounded-xl bg-white p-3">
              <QRCode value={address} size={144} />
            </div>
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

            {network === 'TON' ? (
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
                <p className="text-xs font-semibold text-slate-200">{t('wallet.depositTrc20Title')}</p>
                <p className="mt-1 text-[11px] text-slate-400">{t('wallet.depositTrc20Notice')}</p>

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
          <p className="mt-4 text-center text-xs text-slate-500">
            {t('wallet.addressNotConfigured')}
          </p>
        )}
      </div>
    </div>
  )
}
