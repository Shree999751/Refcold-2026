// Risk dial styled after a refrigeration manifold gauge: a 240° sweep with
// a graduated scale, colour zones set by the model's alert threshold, and a
// needle that swings when the risk changes.

const START = -120;
const SWEEP = 240;

const polar = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
};

function arc(cx, cy, r, from, to) {
  const [x1, y1] = polar(cx, cy, r, START + SWEEP * from);
  const [x2, y2] = polar(cx, cy, r, START + SWEEP * to);
  const large = SWEEP * (to - from) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export default function Gauge({ value = 0, threshold = 0.7, size = 220, compact = false, dimmed = false, label = 'failure risk, next 7 days' }) {
  const v = Math.min(1, Math.max(0, value));
  const c = size / 2;
  const r = size * 0.4;
  const stroke = compact ? size * 0.09 : size * 0.05;
  const watch = threshold * 0.6;
  const needle = START + SWEEP * v;
  const tone = v >= threshold ? 'var(--red)' : v >= watch ? 'var(--amber)' : 'var(--teal)';
  const ticks = compact ? [] : Array.from({ length: 21 }, (_, i) => i / 20);
  const h = compact ? size * 0.86 : size * 0.84;

  return (
    <svg
      width={size}
      height={h}
      viewBox={`0 0 ${size} ${h}`}
      role="img"
      aria-label={`${Math.round(v * 100)} percent ${label}`}
      style={{ opacity: dimmed ? 0.45 : 1, display: 'block' }}
    >
      <path d={arc(c, c, r, 0, 1)} stroke="var(--surface-2)" strokeWidth={stroke} fill="none" strokeLinecap="round" />
      <path d={arc(c, c, r, 0, watch)} stroke="var(--teal)" strokeWidth={stroke} fill="none" opacity="0.28" />
      <path d={arc(c, c, r, watch, threshold)} stroke="var(--amber)" strokeWidth={stroke} fill="none" opacity="0.32" />
      <path d={arc(c, c, r, threshold, 1)} stroke="var(--red)" strokeWidth={stroke} fill="none" opacity="0.3" />
      <path d={arc(c, c, r, 0, Math.max(v, 0.004))} stroke={tone} strokeWidth={stroke} fill="none" strokeLinecap="round" style={{ transition: 'stroke 0.4s' }} />

      {ticks.map((t) => {
        const major = Math.round(t * 20) % 5 === 0;
        const [x1, y1] = polar(c, c, r - stroke * 0.9, START + SWEEP * t);
        const [x2, y2] = polar(c, c, r - stroke * 0.9 - (major ? size * 0.05 : size * 0.025), START + SWEEP * t);
        return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--line-strong)" strokeWidth={major ? 2 : 1} />;
      })}
      {!compact && [0, 0.5, 1].map((t) => {
        const [x, y] = polar(c, c, r - stroke - size * 0.12, START + SWEEP * t);
        return <text key={t} x={x} y={y + 4} textAnchor="middle" fontSize={size * 0.05} fill="var(--muted)">{t * 100}</text>;
      })}
      {!compact && (() => {
        const [x1, y1] = polar(c, c, r + stroke * 0.9, START + SWEEP * threshold);
        const [x2, y2] = polar(c, c, r - stroke * 0.9, START + SWEEP * threshold);
        return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />;
      })()}

      <g style={{ transform: `rotate(${needle}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform 0.9s cubic-bezier(.3,1.4,.5,1)' }}>
        <line x1={c} y1={c + (compact ? 0 : size * 0.05)} x2={c} y2={c - r + stroke * (compact ? 0.2 : 1.3)} stroke="var(--ink)" strokeWidth={compact ? 2.5 : 3} strokeLinecap="round" />
      </g>
      <circle cx={c} cy={c} r={compact ? size * 0.06 : size * 0.035} fill="var(--ink)" />
      {!compact && <circle cx={c} cy={c} r={size * 0.014} fill="var(--surface)" />}

      {!compact && (
        <>
          <text x={c} y={c + size * 0.24} textAnchor="middle" fontSize={size * 0.17} fontWeight="650" style={{ fontStretch: '118%' }} fill="var(--ink)">
            {Math.round(v * 100)}
            <tspan fontSize={size * 0.08} fill="var(--muted)" fontWeight="500">%</tspan>
          </text>
          <text x={c} y={c + size * 0.32} textAnchor="middle" fontSize={size * 0.055} fill="var(--muted)">{label}</text>
        </>
      )}
    </svg>
  );
}
