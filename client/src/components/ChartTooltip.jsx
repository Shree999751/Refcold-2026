export default function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter = (v) => v }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="tip">
      <div className="tip-title">{labelFormatter ? labelFormatter(label) : label}</div>
      {payload.filter((p) => p.value !== undefined && p.value !== null && !p.hide).map((p) => (
        <div className="tip-row" key={p.dataKey}>
          <i style={{ background: p.color || p.stroke }} />
          <span>{p.name}</span>
          <b style={{ marginLeft: 'auto', paddingLeft: 12 }}>{valueFormatter(p.value, p)}</b>
        </div>
      ))}
    </div>
  );
}
