import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { broadcastMessage, fetchBroadcastRecipientCount } from '../../lib/admin'
import { adminErrorMessage } from '../../lib/adminErrors'
import { haptic } from '../../lib/telegram'

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

/** Telegram caption-ліміт для sendPhoto — менший за 4096 у звичайного sendMessage. */
const CAPTION_LIMIT = 1024
const TEXT_LIMIT = 4096

/**
 * Розсилка адміном усім гравцям, що хоч раз відкривали застосунок через
 * бота (= кожен рядок у `users`). Реальна відправка йде через чергу
 * notification_queue + Edge Function send-notifications за розкладом —
 * "Отправлено в очередь" тут означає саме це, а не миттєву доставку.
 */
export default function BroadcastSection() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState<FormStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [queuedCount, setQueuedCount] = useState<number | null>(null)
  const [recipientCount, setRecipientCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchBroadcastRecipientCount()
      .then((count) => {
        if (!cancelled) setRecipientCount(count)
      })
      .catch(() => {
        // Лічильник — лише інформаційний, тиха відмова без блокування форми.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const limit = photoUrl.trim() ? CAPTION_LIMIT : TEXT_LIMIT
  const canSubmit = text.trim().length > 0 && text.length <= limit && status !== 'submitting'

  function handleStartConfirm() {
    if (!canSubmit) return
    haptic.impact('light')
    setConfirming(true)
  }

  async function handleConfirmSend() {
    setStatus('submitting')
    setErrorMessage(null)
    haptic.impact('light')
    try {
      const count = await broadcastMessage(text.trim(), photoUrl.trim() || undefined)
      setQueuedCount(count)
      setStatus('success')
      setText('')
      setPhotoUrl('')
      setConfirming(false)
      haptic.notification('success')
    } catch (err) {
      setStatus('error')
      setErrorMessage(adminErrorMessage(err instanceof Error ? err.message : String(err), t))
      haptic.notification('error')
    }
  }

  return (
    <div className="glass-card p-4">
      <p className="text-sm font-semibold text-slate-200">{t('admin.broadcast.title')}</p>
      <p className="mt-1 text-xs text-slate-400">
        {recipientCount === null
          ? t('common.loading')
          : t('admin.broadcast.recipients', { count: recipientCount })}
      </p>

      <label className="mt-3 block">
        <span className="text-[11px] text-slate-400">{t('admin.broadcast.textLabel')}</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setConfirming(false)
          }}
          rows={5}
          placeholder={t('admin.broadcast.textPlaceholder')}
          className="mt-1 w-full resize-none rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
        />
        <span className={`mt-1 block text-right text-[10px] ${text.length > limit ? 'text-red-400' : 'text-slate-500'}`}>
          {text.length} / {limit}
        </span>
      </label>

      <label className="mt-1 block">
        <span className="text-[11px] text-slate-400">{t('admin.broadcast.photoLabel')}</span>
        <input
          type="url"
          value={photoUrl}
          onChange={(e) => {
            setPhotoUrl(e.target.value)
            setConfirming(false)
          }}
          placeholder="https://..."
          className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-slate-800/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-500/50"
        />
        <span className="mt-1 block text-[10px] text-slate-500">{t('admin.broadcast.photoHint')}</span>
      </label>

      {status === 'error' && errorMessage && (
        <p className="mt-2 text-xs text-red-400">{errorMessage}</p>
      )}
      {status === 'success' && queuedCount !== null && (
        <p className="mt-2 text-xs text-emerald-400">
          {t('admin.broadcast.success', { count: queuedCount })}
        </p>
      )}

      {confirming ? (
        <div className="mt-4 space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="text-xs text-amber-300">
            {t('admin.broadcast.confirmWarning', { count: recipientCount ?? 0 })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-700 py-2 text-xs font-medium text-slate-400"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmSend}
              disabled={status === 'submitting'}
              className="rounded-lg bg-red-500/20 py-2 text-xs font-semibold text-red-300 disabled:opacity-40"
            >
              {status === 'submitting' ? t('admin.broadcast.sending') : t('admin.broadcast.confirmSend')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleStartConfirm}
          disabled={!canSubmit}
          className="mt-4 w-full rounded-xl bg-neon-gradient py-2.5 text-sm font-semibold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('admin.broadcast.send')}
        </button>
      )}
    </div>
  )
}
