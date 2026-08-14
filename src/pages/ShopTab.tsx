import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MinerTemplate } from '../types'
import { REGULAR_PACKS, PREMIUM_PACKS } from '../lib/catalog'
import { useUserState } from '../context/UserStateContext'
import { haptic } from '../lib/telegram'
import PackCard from '../components/PackCard'
import PurchaseModal from '../components/PurchaseModal'

type Category = 'regular' | 'premium'

export default function ShopTab() {
  const { t } = useTranslation()
  const { balanceUsd, purchaseMiner } = useUserState()
  const [category, setCategory] = useState<Category>('regular')
  const [selectedPack, setSelectedPack] = useState<MinerTemplate | null>(null)

  const packs = category === 'regular' ? REGULAR_PACKS : PREMIUM_PACKS

  function handleSelectCategory(next: Category) {
    setCategory(next)
    haptic.selection()
  }

  return (
    <div className="space-y-4">
      <div className="glass-card grid grid-cols-2 gap-1 p-1">
        <button
          type="button"
          onClick={() => handleSelectCategory('regular')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors ${
            category === 'regular' ? 'bg-cyan-500/15 text-neon-glow' : 'text-slate-400'
          }`}
        >
          <span aria-hidden>⚡</span> {t('shop.regular')}
        </button>
        <button
          type="button"
          onClick={() => handleSelectCategory('premium')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors ${
            category === 'premium' ? 'bg-premium/15 text-premium-glow' : 'text-slate-400'
          }`}
        >
          <span aria-hidden>💎</span> {t('shop.premium')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {packs.map((pack) => (
          <PackCard key={pack.id} template={pack} onBuy={() => setSelectedPack(pack)} />
        ))}
      </div>

      {selectedPack && (
        <PurchaseModal
          template={selectedPack}
          balanceUsd={balanceUsd}
          onClose={() => setSelectedPack(null)}
          onConfirmBalance={() => purchaseMiner(selectedPack)}
        />
      )}
    </div>
  )
}
