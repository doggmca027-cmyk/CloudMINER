interface TokenIconProps {
  size?: number
}

/** Значок токена USDT — кружечок з градієнтом і літерою "T". */
export default function TokenIcon({ size = 24 }: TokenIconProps) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-neon-gradient font-black text-slate-950"
    >
      T
    </span>
  )
}
