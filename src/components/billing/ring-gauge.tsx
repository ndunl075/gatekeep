// Ring gauge from the Dugg Usage screen: a thin arc with the remaining share in the middle.
export function RingGauge({ percent, label, color }: { percent: number; label: string; color: string }) {
  const size = 96;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-raised)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="tabular text-[20px] font-light leading-none text-ink">{clamped}%</div>
          <div className="mt-1 text-[10px] text-muted">{label}</div>
        </div>
      </div>
    </div>
  );
}
