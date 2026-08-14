import { useTranslation } from 'react-i18next'

export default function ProfilePage() {
  const { t } = useTranslation()

  return (
    <div className="glass-card p-6">
      <h1 className="text-xl font-bold text-neon-glow">{t('profile.title')}</h1>
      <p className="mt-2 text-sm text-slate-400">{t('common.comingSoon')}</p>
    </div>
  )
}
