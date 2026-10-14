export default function Sparkline({ values = [], threshold, width = 120, height = 32 }) {
  if (values.length < 2) return <svg width={width} height={height} className="spark" aria-hidden="true" />;
  const pad = 2;
  const x = (i) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - v * (height - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  const color = last >= threshold ? 'var(--red)' : last >= threshold * 0.6 ? 'var(--amber)' : 'var(--teal)';
  return (
    <svg width={width} height={height} className="spark" aria-label={`Risk over the last 48 hours, now ${Math.round(last * 100)}%`} role="img">
      <line x1={pad} x2={width - pad} y1={y(threshold)} y2={y(threshold)} stroke="var(--line-strong)" strokeDasharray="3 3" />
      <path d={`${d} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={color} opacity="0.1" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.6" fill={color} />
    </svg>
  );
}
