import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, Legend, Cell,
} from 'recharts';
import { api } from '../lib/api.js';
import Panel from '../components/Panel.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import { featureText, fmtDateTime, pct } from '../lib/format.js';

const COLORS = { random_forest: 'var(--teal)', logistic: 'var(--muted)', isolation_forest: 'var(--violet)' };
const ORDER = ['logistic', 'random_forest', 'isolation_forest'];
const axis = { tick: { fill: 'var(--muted)', fontSize: 12 }, stroke: 'var(--line)' };

function Pipeline({ m }) {
  const steps = [
    { title: 'Eight sensors', text: 'Suction and discharge temperature and pressure, oil pressure differential, vibration, motor current and superheat, read hourly.' },
    { title: `${m.featureCount} trend features`, text: 'The current value, 3-day and 7-day averages and a 7-day slope for each channel, plus the pressure ratio.' },
    { title: 'Three models', text: 'A linear baseline, a 300-tree Random Forest and an Isolation Forest trained only on healthy data.' },
    { title: 'Alert rule', text: 'Warn when Random Forest risk stays above its threshold for six hours; a fifth model names the likely fault.' },
  ];
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 0 }}>
      {steps.map((s, i) => (
        <li key={s.title} style={{ padding: '4px 18px 4px 0', borderLeft: i ? '1px solid var(--line)' : 0, paddingLeft: i ? 18 : 0 }}>
          <div className="t-small" style={{ fontWeight: 600 }}>Step {i + 1}</div>
          <div className="t-h3" style={{ margin: '2px 0 4px' }}>{s.title}</div>
          <p className="t-small" style={{ color: 'var(--ink-2)' }}>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

export default function ModelReport() {
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.model().then(setM).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="page"><div className="panel empty"><b>{error}</b></div></div>;
  if (!m) return <div className="page"><div className="skeleton" style={{ height: 140 }} /><div className="skeleton" style={{ height: 320 }} /></div>;

  const rf = m.models.random_forest;
  const caught = rf.leadTimes.filter((l) => l.leadDays > 0).length;
  const scores = ['precision', 'recall', 'f1'].map((k) => ({
    metric: k === 'f1' ? 'F1 score' : k[0].toUpperCase() + k.slice(1),
    ...Object.fromEntries(ORDER.map((id) => [id, m.models[id][k]])),
  }));
  const leads = rf.leadTimes.map((l, i) => ({
    unit: l.unit.replace('SIM-', 'Unit '),
    mode: l.mode,
    random_forest: l.leadDays,
    isolation_forest: m.models.isolation_forest.leadTimes[i].leadDays,
    logistic: m.models.logistic.leadTimes[i].leadDays,
  }));
  const top = m.importances.slice(0, 10).map((f) => ({ ...f, label: featureText(f.feature) }));
  const impact = m.impact;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Model report</h1>
          <p className="t-body" style={{ marginTop: 6 }}>
            Trained on {m.dataset.units} simulated compressors, {m.dataset.daysPerUnit} days each, and tested on {m.dataset.testUnits.healthy + m.dataset.testUnits.failing} compressors the models never saw.
            Last trained {fmtDateTime(m.trainedAt)} in {m.durationSec} seconds.
          </p>
        </div>
      </header>

      <section className="panel headline-metrics" aria-label="Random Forest results on held-out compressors">
        <div>
          <div className="big t-num">{caught}<small>of {rf.leadTimes.length}</small></div>
          <div className="t-small">failing test compressors warned in advance</div>
        </div>
        <div>
          <div className="big t-num">{rf.meanLeadDays}<small>days</small></div>
          <div className="t-small">average warning before the trip</div>
        </div>
        <div>
          <div className="big t-num">{rf.falseAlarmsPer100Days}<small>per 100 days</small></div>
          <div className="t-small">false alarms on healthy compressors</div>
        </div>
        <div>
          <div className="big t-num">{rf.auc.toFixed(2)}<small>ROC AUC</small></div>
          <div className="t-small">Random Forest, 7-day failure task</div>
        </div>
      </section>

      <Panel title="From sensors to a warning">
        <Pipeline m={m} />
      </Panel>

      <div className="grid-halves">
        <Panel title="Model comparison" subtitle="Precision, recall and F1 on held-out rows, each model at its own tuned threshold">
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={scores} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={3}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="metric" {...axis} />
                <YAxis domain={[0, 1]} {...axis} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip valueFormatter={(v) => v.toFixed(2)} />} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                {ORDER.map((id) => <Bar key={id} dataKey={id} name={m.models[id].name} fill={COLORS[id]} radius={[4, 4, 0, 0]} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="ROC curves" subtitle="Seven-day failure prediction on held-out compressors">
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--chart-grid)" />
                <XAxis dataKey="fpr" type="number" domain={[0, 1]} {...axis} tickFormatter={(v) => v.toFixed(1)} />
                <YAxis dataKey="tpr" type="number" domain={[0, 1]} {...axis} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip content={<ChartTooltip labelFormatter={(v) => `False positive rate ${Number(v).toFixed(2)}`} valueFormatter={(v) => v.toFixed(2)} />} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Line data={[{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }]} dataKey="tpr" name="Chance" stroke="var(--line-strong)" strokeDasharray="4 4" dot={false} legendType="none" isAnimationActive={false} />
                {ORDER.map((id) => (
                  <Line key={id} data={m.models[id].roc} dataKey="tpr" name={`${m.models[id].name} (AUC ${m.models[id].auc.toFixed(2)})`} stroke={COLORS[id]} strokeWidth={2} dot={false} type="stepAfter" isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid-halves">
        <Panel title="What the Random Forest relies on" subtitle="Top ten features by Gini importance">
          <div style={{ height: 340 }}>
            <ResponsiveContainer>
              <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" {...axis} tickFormatter={(v) => pct(v)} />
                <YAxis type="category" dataKey="label" width={210} {...axis} tick={{ fill: 'var(--ink-2)', fontSize: 12.5 }} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip valueFormatter={(v) => pct(v, 1)} />} />
                <Bar dataKey="importance" name="Importance" radius={[0, 4, 4, 0]}>
                  {top.map((f, i) => <Cell key={f.feature} fill="var(--teal)" fillOpacity={1 - i * 0.06} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="t-small">Trend features dominate: the model notices a value drifting while it still reads as normal.</p>
        </Panel>

        <Panel title="Warning lead time per failing test compressor" subtitle="Days between the first sustained alert and the trip. Zero means the failure was missed.">
          <div style={{ height: 340 }}>
            <ResponsiveContainer>
              <BarChart data={leads} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={1}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="unit" {...axis} interval={0} angle={-40} textAnchor="end" height={54} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis {...axis} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip valueFormatter={(v) => `${v} days`} />} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Bar dataKey="random_forest" name="Random Forest" fill={COLORS.random_forest} radius={[3, 3, 0, 0]} />
                <Bar dataKey="isolation_forest" name="Isolation Forest" fill={COLORS.isolation_forest} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid-halves">
        <Panel title="Operational impact" subtitle="Reactive maintenance only acts after a trip, so it has no early warning at all." flush>
          <div className="impact-row" style={{ marginTop: 12, borderTop: '1px solid var(--line)' }}>
            <div>
              <h3 className="t-h3">Reactive, today</h3>
              <div className="big t-num" style={{ marginTop: 10 }}>0%</div>
              <p className="t-small">failures warned in advance</p>
              <div className="big t-num" style={{ marginTop: 14 }}>0<small>days</small></div>
              <p className="t-small">time to plan a repair</p>
            </div>
            <div>
              <h3 className="t-h3">With CryoSense</h3>
              <div className="big t-num" style={{ marginTop: 10, color: 'var(--teal)' }}>{pct(impact.predictive.earlyWarningRate)}</div>
              <p className="t-small">failures warned in advance</p>
              <div className="big t-num" style={{ marginTop: 14, color: 'var(--teal)' }}>{impact.predictive.meanLeadDays}<small>days</small></div>
              <p className="t-small">average time to plan a repair, at {impact.predictive.falseAlarmsPer100Days} false alarms per 100 days</p>
            </div>
          </div>
        </Panel>

        <Panel title="Training data" subtitle={`${m.dataset.rows.train.toLocaleString('en-IN')} training rows, ${m.dataset.rows.validation.toLocaleString('en-IN')} for tuning, ${m.dataset.rows.test.toLocaleString('en-IN')} for testing`}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={m.dataset.composition} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" {...axis} interval={0} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <YAxis {...axis} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip valueFormatter={(v) => `${v} compressors`} />} />
                <Bar dataKey="units" name="Compressors" radius={[4, 4, 0, 0]}>
                  {m.dataset.composition.map((c) => <Cell key={c.outcome} fill={c.outcome === 'healthy' ? 'var(--teal)' : 'var(--amber)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="t-small">
            Splits are made by compressor, never by row, so no test compressor leaks into training. The fault-mode classifier names the right fault on {pct(m.diagnosis.accuracy)} of failing test readings.
          </p>
        </Panel>
      </div>
    </div>
  );
}
