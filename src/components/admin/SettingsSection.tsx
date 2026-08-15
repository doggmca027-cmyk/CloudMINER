import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAppSettings } from '../../lib/appSettings'
import { updateAppSettings } from '../../lib/admin'
import { adminErrorMessage } from '../../lib/adminErrors'
import { parseLocaleNumber } from '../../lib/number'
import { haptic } from '../../lib/telegram'
import type { AppSettings } from '../../types'

type FormStatus = 'loading' | 'idle' | 'submitting' | 'success' | 'error'

const EMPTY_SETTINGS: AppSettings = {
  shopDiscountEnabled: false,
  shopDiscountPercent: 0,
  depositBonusEnabled: false,
  depositBonusPercent: 0,
}

/**
 * Глобальні промо-налаштування: знижка на покупку майнерів (% від ціни
 * пакета) і бонус до поповнення (% від суми депозиту) — обидва рахує
 * СЕРВЕР (purchase_miner/credit_deposit), тут лише форма редагування
 * самого відсотка. Кожен прапорець enabled незалежний від значення
 * percent — можна тимчасово вимкнути акцію, не втрачаючи налаштоване число.
 */
export default function SettingsSection() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS)
  const [status, setStatus] = useState<FormStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getAppSettings().then((result) => {
      if (cancelled) return
      setSettings(result)
      setStatus('idle')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const discountValid =
    Number.isFinite(settings.shopDiscountPercent) &&
    settings.shopDiscountPercent >= 0 &&
    settings.shopDiscountPercent <= 100
  const bonusValid =
    Number.isFinite(settings.depositBonusPercent) &&
    settings.depositBonusPercent >= 0 &&
    settings.depositBonusPercent <= 100
  const canSubmit = discountValid && bonusValid && status !== 'submitting' && status !== 'loading'

  async function handleSave() {
    if (!canSubmit) return
    setStatus('submitting')
    setErrorMessage(null)
    haptic.impact('light')
    try {
      const saved = await updateAppSettings(settings)
      setSettings(saved)
      setStatus('success')
      haptic.notification('success')
    } catch (err) {
      setStatus('error')
      setErrorMessage(adminErrorMessage(err instanceof Error ? err.message : String(err), t))
      haptic.notification('error')
    }
  }

  if (status === 'loading') {
    return <div className="glass-card p-6 text-center text-sm text-slate-400">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-3">
      <div className="glass-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">{t('admin.settings.discountTitle')}</p>
          <Toggle
            checked={settings.shopDiscountEnabled}
            onChange={(checked) => {
              setStatus('idle')
              setSettings((s) => ({ ...s, shopDiscountEnabled: checked }))
            }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">{t('admin.settings.discountHint')}</p>

        <label className="mt-3 block">
          <span className="text-[11px] text-slate-400">{t('admin.settings.percentLabel')}</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.1"
              value={settings.shopDiscountPercent}
              onChange={(e) => {
                setStatus('idle')
                setSettings((s) => ({ ...s, shopDiscountPercent: parseLocaleNumber(e.target.value) }))
              }}
              className="w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
            />
            <span className="text-sm font-semibold text-slate-400">%</span>
          </div>
          {!discountValid && (
            <span className="mt-1 block text-[11px] text-red-400">{t('admin.settings.invalidPercent')}</span>
          )}
        </label>

        {settings.shopDiscountEnabled && discountValid && settings.shopDiscountPercent > 0 && (
          <p className="mt-2 text-[11px] text-emerald-400">
            {t('admin.settings.discountExample', {
              before: '100.00',
              after: (100 * (1 - settings.shopDiscountPercent / 100)).toFixed(2),
            })}
          </p>
        )}
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">{t('admin.settings.bonusTitle')}</p>
          <Toggle
            checked={settings.depositBonusEnabled}
            onChange={(checked) => {
              setStatus('idle')
              setSettings((s) => ({ ...s, depositBonusEnabled: checked }))
            }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">{t('admin.settings.bonusHint')}</p>

        <label className="mt-3 block">
          <span className="text-[11px] text-slate-400">{t('admin.settings.percentLabel')}</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.1"
              value={settings.depositBonusPercent}
              onChange={(e) => {
                setStatus('idle')
                setSettings((s) => ({ ...s, depositBonusPercent: parseLocaleNumber(e.target.value) }))
              }}
              className="w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
            />
            <span className="text-sm font-semibold text-slate-400">%</span>
          </div>
          {!bonusValid && (
            <span className="mt-1 block text-[11px] text-red-400">{t('admin.settings.invalidPercent')}</span>
          )}
        </label>

        {settings.depositBonusEnabled && bonusValid && settings.depositBonusPercent > 0 && (
          <p className="mt-2 text-[11px] text-emerald-400">
            {t('admin.settings.bonusExample', {
              amount: '100.00',
              bonus: (100 * (settings.depositBonusPercent / 100)).toFixed(2),
            })}
          </p>
        )}
      </div>

      {status === 'error' && errorMessage && <p className="px-1 text-xs text-red-400">{errorMessage}</p>}
      {status === 'success' && <p className="px-1 text-xs text-emerald-400">{t('admin.settings.success')}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={!canSubmit}
        className="w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === 'submitting' ? t('admin.settings.saving') : t('admin.settings.save')}
      </button>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic.selection()
        onChange(!checked)
      }}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-neon-gradient' : 'bg-slate-700'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
