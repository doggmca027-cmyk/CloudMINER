interface SubscriptionRowProps {
  label: string
  subscribed: boolean
  onOpen: () => void
}

/** Один рядок статусу підписки (канал/чат/партнерський ресурс) з переходом за посиланням. */
export default function SubscriptionRow({ label, subscribed, onOpen }: SubscriptionRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-xs"
    >
      <span className="text-slate-300">{label}</span>
      <span aria-hidden className={subscribed ? 'text-neon-glow' : 'text-slate-500'}>
        {subscribed ? '✓' : '↗'}
      </span>
    </button>
  )
}
