import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Wrench, Eye, FlaskConical } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, LineChart,
} from 'recharts';
import { api } from '../lib/api.js';
import { useFleet, useToasts } from '../context/FleetContext.jsx';
import Gauge from '../components/Gauge.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Panel from '../components/Panel.jsx';
import EventFeed from '../components/EventFeed.jsx';
import ServiceDialog from '../components/ServiceDialog.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import { duration, featureLabel, fmtDateTime, fmtShortDate, pct } from '../lib/format.js';

const HOUR = 3600 * 1000;

function verdict(d) {
  const diag = d.diagnosis ? d.diagnosis.label.toLowerCase() : 'a fault';
  switch (d.status) {
    case 'tripped':
      return `Tripped on ${diag}. The compressor is stopped until it is repaired.`;
    case 'critical':
      return `Critical: ${diag} is close to tripping this compressor.`;
    case 'warning':
      return `Early warning: ${diag} is likely within the next 7 days.`;
    case 'watch':
      return 'Worth watching. Risk is rising, but it has not stayed above the alert threshold.';
    case 'maintenance':
      return `Recommissioning after service. Alerts re-arm in ${duration(d.maintenanceHoursLeft)}.`;
    default:
      return 'Running normally. No sensor trend points toward a failure.';
  }
}

function Meter({ name, value, threshold, color, note }) {
  return (
    <div className="meter">
      <div className="meter-top"><span>{name}</span><b>{pct(value)}</b></div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.min(100, value * 100)}%`, background: value >= threshold ? 'var(--red)' : color }} />
        <div className="meter-thr" style={{ left: `calc(${threshold * 100}% - 1px)` }} title={`Alert threshold ${pct(threshold)}`} />
      </div>
      <div className="meter-note">{note}</div>
    </div>
  );
}

function Contributions({ explanation, risk }) {
  if (!explanation) return <p className="t-small">The model explanation returns once the compressor is running again.</p>;
  const items = explanation.items.slice(0, 8);
  const max = Math.max(...items.map((i) => Math.abs(i.contribution)), 0.01);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="t-small">
        The average compressor starts at {pct(explanation.bias)} risk. These are the features that moved this one to {pct(risk)}.
        Bars to the right raise risk, bars to the left lower it.
      </p>
      <div className="contrib">
        {items.map((i) => {
          const f = featureLabel(i.feature);
          const w = (Math.abs(i.contribution) / max) * 50;
          const up = i.contribution > 0;
          return (
            <div className="contrib-row" key={i.feature}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{f.channel}</div>
                <div className="t-small">{f.window}</div>
              </div>
              <div className="contrib-bar" aria-hidden="true">
                <span style={{ left: up ? '50%' : `${50 - w}%`, width: `${w}%`, background: up ? 'var(--amber)' : 'var(--teal)' }} />
              </div>
              <div className="contrib-val" style={{ color: up ? 'var(--amber)' : 'var(--teal)' }}>
                {up ? '+' : '−'}{Math.abs(i.contribution * 100).toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="t-small">Values are percentage points of risk, from a per-tree decomposition of the Random Forest.</p>
    </div>
  );
}

function SensorTile({ channel, readings, tick }) {
  const last = readings.length ? readings[readings.length - 1][channel.key] : null;
  const recent = readings.slice(-6);
  const avg = recent.length ? recent.reduce((a, r) => a + r[channel.key], 0) / recent.length : null;
  const out = avg !== null && (avg < channel.min || avg > channel.max);
  const decimals = channel.key === 'vibration_rms' ? 2 : channel.max > 200 ? 0 : 1;
  return (
    <div className="sensor">
      <div className="sensor-head">
        <div>
          <div className="t-h3">{channel.label}</div>
          <div className="t-small">Healthy {channel.min} to {channel.max} {channel.unit}</div>
        </div>
        <div className={`sensor-value t-num ${out ? 'out' : ''}`}>
          {last === null ? '–' : avg.toFixed(decimals)}<small>{channel.unit}</small>
        </div>
      </div>
      <div style={{ height: 86, marginTop: 6 }}>
        <ResponsiveContainer>
          <LineChart data={readings} margin={{ top: 6, right: 2, bottom: 0, left: 2 }}>
            <ReferenceArea y1={channel.min} y2={channel.max} fill="var(--teal)" fillOpacity={0.09} stroke="none" ifOverflow="extendDomain" />
            <YAxis hide domain={['auto', 'auto']} />
            <XAxis dataKey="t" hide />
            <Tooltip content={<ChartTooltip labelFormatter={tick} valueFormatter={(v) => `${v} ${channel.unit}`} />} />
            <Line type="monotone" dataKey={channel.key} name={channel.label} stroke={out ? 'var(--red)' : 'var(--ink-2)'} strokeWidth={1.4} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function UnitDetail() {
  const { id } = useParams();
  const { fleet } = useFleet();
  const { notify } = useToasts();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(false);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      setD(await api.unit(id));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      inflight.current = false;
    }
  }, [id]);

  useEffect(() => { setD(null); load(); }, [load]);
  useEffect(() => { if (fleet) load(); }, [fleet && fleet.hour, load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !d) {
    return (
      <div className="page">
        <Link to="/" className="crumb"><ArrowLeft size={15} /> Fleet</Link>
        <div className="panel empty"><b>{error}</b><span>Pick a compressor from the fleet list.</span></div>
      </div>
    );
  }
  if (!d) return <div className="page"><div className="skeleton" style={{ height: 320 }} /><div className="skeleton" style={{ height: 260 }} /></div>;

  const thr = d.thresholds;
  const tick = (t) => fmtDateTime(new Date(d.startEpoch + t * HOUR).toISOString());
  const dayTick = (t) => fmtShortDate(d.startEpoch + t * HOUR);
  const above = [d.risk >= thr.random_forest, d.logistic >= thr.logistic, d.anomaly >= thr.isolation_forest].filter(Boolean).length;
  const warnStart = d.warningHours !== null ? d.predictions.length && d.predictions[d.predictions.length - 1].t - d.warningHours : null;
  const alert = d.alert;

  const onService = async (body) => {
    try {
      const rec = await api.service(d.id, body);
      notify({ tone: 'ok', title: 'Service logged', body: rec.outcome, timeout: 7000 });
      setDialog(false);
      load();
    } catch (e) {
      notify({ tone: 'crit', title: 'Service not logged', body: e.message });
    }
  };

  const onAck = async () => {
    try {
      await api.acknowledge(alert.id, 'Shift supervisor');
      notify({ tone: 'ok', title: 'Alert acknowledged', body: `${d.name} is marked as being looked at.`, timeout: 5000 });
      load();
    } catch (e) {
      notify({ tone: 'crit', title: 'Could not acknowledge', body: e.message });
    }
  };

  return (
    <div className="page">
      <div>
        <Link to="/" className="crumb"><ArrowLeft size={15} /> Fleet</Link>
        <div className="page-head">
          <div>
            <h1 className="t-h1">{d.name}</h1>
            <p className="t-small" style={{ marginTop: 4 }}>{d.id}, {d.siteName}, {d.city}</p>
          </div>
          <StatusBadge status={d.status} />
        </div>
      </div>

      <section className="panel unit-hero">
        <div className="gauge-wrap">
          <Gauge value={d.risk} threshold={thr.random_forest} size={250} dimmed={d.status === 'maintenance'} />
          <p className="t-small">Health score {d.health} of 100</p>
        </div>

        <div className="verdict">
          <h2 className="verdict-title">{verdict(d)}</h2>
          {d.recommendation && (
            <div className={`reco ${d.status === 'warning' ? '' : 'crit'}`}>
              <h3 className="t-h3">What to check</h3>
              <p className="t-body">{d.recommendation.action}</p>
            </div>
          )}
          <dl className="facts">
            <div><dt>Compressor</dt><dd>{d.type}</dd></div>
            <div><dt>Refrigerant</dt><dd>{d.refrigerant}</dd></div>
            <div><dt>Capacity</dt><dd>{d.capacityTR} TR</dd></div>
            <div><dt>Installed</dt><dd>{new Date(d.installed).getFullYear()}</dd></div>
            {d.warningHours !== null && <div><dt>Warning open for</dt><dd>{duration(d.warningHours)}</dd></div>}
            {alert && <div><dt>Alert</dt><dd>{alert.status === 'acknowledged' ? `Acknowledged by ${alert.acknowledgedBy}` : 'Open, not acknowledged'}</dd></div>}
          </dl>
          <div className="actions">
            <button type="button" className={`btn ${d.status === 'warning' || d.status === 'critical' || d.status === 'tripped' ? 'btn-primary' : ''}`} onClick={() => setDialog(true)} disabled={d.status === 'maintenance'}>
              <Wrench size={16} /> {d.status === 'tripped' ? 'Log repair' : 'Log service'}
            </button>
            {alert && alert.status === 'open' && (
              <button type="button" className="btn" onClick={onAck}><Eye size={16} /> Acknowledge alert</button>
            )}
            {!d.scenario && d.status !== 'tripped' && d.status !== 'maintenance' && (
              <Link to={`/scenarios?unit=${d.id}`} className="btn btn-ghost" style={{ textDecoration: 'none' }}><FlaskConical size={16} /> Run a scenario</Link>
            )}
          </div>
        </div>

        <div className="consensus">
          <div>
            <h2 className="t-h3">Model consensus</h2>
            <p className="t-small">{above} of 3 models are above their alert threshold.</p>
          </div>
          <Meter name="Random Forest" value={d.risk} threshold={thr.random_forest} color="var(--teal)" note="Primary model, drives alerts" />
          <Meter name="Logistic Regression" value={d.logistic} threshold={thr.logistic} color="var(--muted)" note="Linear baseline" />
          <Meter name="Isolation Forest" value={d.anomaly} threshold={thr.isolation_forest} color="var(--violet)" note="Anomaly score, trained on healthy data only" />
          {d.diagnosisDistribution.length > 0 && d.risk >= thr.random_forest * 0.5 && (
            <div className="stack" style={{ gap: 8 }}>
              <h3 className="t-h3">Likely fault</h3>
              {d.diagnosisDistribution.slice().sort((a, b) => b.p - a.p).map((m) => (
                <div key={m.mode} style={{ display: 'grid', gridTemplateColumns: '1fr 44px', gap: 8, fontSize: 13.5 }}>
                  <div>
                    <div>{m.label}</div>
                    <div className="meter-track" style={{ height: 5, marginTop: 4 }}>
                      <div className="meter-fill" style={{ width: `${m.p * 100}%`, background: 'var(--ink-2)' }} />
                    </div>
                  </div>
                  <b style={{ textAlign: 'right', fontStretch: '112%' }}>{pct(m.p)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Panel
        title="Failure risk over the last 7 days"
        subtitle="Each point is one hourly prediction. The dashed line is the alert threshold."
        actions={
          <div className="legend">
            <span><i style={{ background: 'var(--teal)' }} />Random Forest</span>
            <span><i style={{ background: 'var(--muted)' }} />Logistic Regression</span>
            <span><i style={{ background: 'var(--violet)' }} />Isolation Forest</span>
          </div>
        }
      >
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={d.predictions} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="riskFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--teal)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              {warnStart !== null && d.predictions.length > 0 && warnStart >= d.predictions[0].t && (
                <ReferenceArea x1={warnStart} x2={d.predictions[d.predictions.length - 1].t} fill="var(--amber)" fillOpacity={0.08} />
              )}
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={dayTick} tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--line)" tickCount={8} />
              <YAxis domain={[0, 1]} tickFormatter={(v) => `${v * 100}%`} tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--line)" width={52} />
              <Tooltip content={<ChartTooltip labelFormatter={tick} valueFormatter={(v) => pct(v)} />} />
              <ReferenceLine y={thr.random_forest} stroke="var(--ink)" strokeDasharray="5 4" />
              <Area type="monotone" dataKey="rf" name="Random Forest" stroke="var(--teal)" strokeWidth={2.2} fill="url(#riskFill)" isAnimationActive={false} />
              <Line type="monotone" dataKey="lr" name="Logistic Regression" stroke="var(--muted)" strokeWidth={1.3} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="iso" name="Isolation Forest" stroke="var(--violet)" strokeWidth={1.3} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid-halves">
        <Panel title="Why the model thinks so">
          <Contributions explanation={d.explanation} risk={d.risk} />
        </Panel>
        <Panel title="History" subtitle="Events on this compressor during the simulation" flush>
          <div style={{ paddingTop: 8 }}>
            <EventFeed events={d.events} showUnit={false} empty="No warnings, trips or service visits yet." />
          </div>
          {d.maintenance.length > 0 && (
            <div className="panel-body" style={{ borderTop: '1px solid var(--line)' }}>
              <h3 className="t-h3" style={{ marginBottom: 8 }}>Service records</h3>
              {d.maintenance.slice(0, 4).map((m) => (
                <p key={m.id} className="t-body" style={{ marginBottom: 8 }}>
                  <b>{fmtDateTime(m.simTime)}</b>, {m.technician}. {m.outcome}.{m.note ? ` ${m.note}` : ''}
                </p>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Sensor channels" subtitle="Last 7 days, hourly. The shaded band is the healthy operating range; the value shown is the 6-hour average." flush>
        <div className="sensors" style={{ marginTop: 12, borderTop: '1px solid var(--line)' }}>
          {d.channels.map((c) => <SensorTile key={c.key} channel={c} readings={d.readings} tick={tick} />)}
        </div>
      </Panel>

      {dialog && <ServiceDialog unit={d} onClose={() => setDialog(false)} onConfirm={onService} />}
    </div>
  );
}
