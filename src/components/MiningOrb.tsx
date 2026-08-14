/**
 * Центральний гліф вкладки Mining — гранований кристал з неоновим світінням.
 * Суто декоративний елемент, без бізнес-логіки.
 */
export default function MiningOrb() {
  return (
    <div className="relative mx-auto flex h-36 w-36 items-center justify-center">
      {/* Розмите цянове сяйво позаду кристала */}
      <div className="absolute inset-2 animate-pulse-cyan rounded-full bg-neon/20 blur-2xl" aria-hidden />

      <svg
        viewBox="0 0 200 200"
        className="relative h-full w-full animate-float drop-shadow-neon"
        aria-hidden
      >
        <defs>
          <linearGradient id="orb-gem" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e0feff" stopOpacity="0.9" />
            <stop offset="55%" stopColor="#00f2fe" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#4facfe" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        {/* Зовнішній контур кристала */}
        <polygon
          points="100,15 172,72 100,185 28,72"
          fill="url(#orb-gem)"
          stroke="#00f2fe"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Грані */}
        <polygon
          points="100,15 128,72 100,185 72,72"
          fill="none"
          stroke="#a6fbff"
          strokeOpacity="0.6"
          strokeWidth="1"
        />
        <line x1="28" y1="72" x2="172" y2="72" stroke="#a6fbff" strokeOpacity="0.5" strokeWidth="1" />
        <line x1="72" y1="72" x2="100" y2="185" stroke="#a6fbff" strokeOpacity="0.35" strokeWidth="1" />
        <line x1="128" y1="72" x2="100" y2="185" stroke="#a6fbff" strokeOpacity="0.35" strokeWidth="1" />

        {/* Відблиск */}
        <circle cx="100" cy="60" r="7" fill="#f4feff" opacity="0.9" />
      </svg>
    </div>
  )
}
