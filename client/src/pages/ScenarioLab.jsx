import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pause, Play, RotateCcw, Wrench } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, ReferenceLine, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../lib/api.js';
import { useFleet, useToasts } from '../context/FleetContext.jsx';
import Panel from '../components/Panel.jsx';
import Gauge from '../components/Gauge.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import ServiceDialog from '../components/ServiceDialog.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import { duration, fmtDateTime, fmtShortDate, pct } from '../lib/format.js';

const HOUR = 3600 * 1000;
const SPEEDS = [1, 6, 12, 24];
const SEVERITY = [
  { max: 0.75, label: 'Mild, easy to miss' },
  { max: 1.05, label: 'Typical field fault' },
  { max: 2, label: 'Severe' },
];

function Milestones({ unit, detail }) {
  const s = unit.scenario;
  const lastService = detail && detail.maintenance && detail.maintenance[0];
  if (!s) {
    if (lastService && lastService.faultMode) {
      return (
        <div className="stack" style={{ gap: 6 }}>
          <h3 className="t-h3">Last scenario outcome</h3>
          <p className="t-body">{lastService.outcome}.{lastService.leadDays ? ` The model's warning came ${lastService.leadDays} days before the projected trip.` : ''}</p>
        </div>
      );
    }
    if (unit.status === 'tripped') return <p className="t-body">This compressor has tripped. Log the repair to bring it back into service.</p>;
    return <p className="t-body">No scenario is running on this compressor. Choose a fault on the left and start it.</p>;
  }
  const startHour = s.injectedHour;
  const tripAtHour = startHour + s.durationDays * 24;
  const warned = unit.warningHours !== null;
  const nowHour = startHour + Math.round(s.progress * s.durationDays * 24);
  const warnHour = warned ? nowHour - unit.warningHours : null;
  const t = (h) => fmtDateTime(new Date(detail ? detail.startEpoch + h * HOUR : Date.now()).toISOString());

  return (
    <ul className="timeline">
      <li>
        <span className="dot done" />
        <div>
          <b>Fault starts developing</b>
          <div className="t-small">{s.label}, {s.durationDays} days to failure{detail ? `, ${t(startHour)}` : ''}</div>
        </div>
      </li>
      <li>
        <span className={`dot ${warned ? 'warn' : ''}`} />
        <div>
          <b>{warned ? 'Model raised an early warning' : 'Waiting for the model to notice'}</b>
          <div className="t-small">
            {warned
              ? `${detail ? t(warnHour) : ''}, ${duration(tripAtHour - warnHour)} before the trip`
              : `Drift so far is ${pct(s.progress)} of the way to failure, and every sensor may still look normal`}
          </div>
        </div>
      </li>
      <li>
        <span className={`dot ${unit.status === 'tripped' ? 'crit' : ''}`} />
        <div>
          <b>{unit.status === 'tripped' ? 'Compressor tripped' : 'Projected trip'}</b>
          <div className="t-small">{detail ? t(tripAtHour) : ''}{s.hoursToTrip > 0 ? `, in ${duration(s.hoursToTrip)}` : ''}</div>
        </div>
      </li>
    </ul>
  );
}

export default function ScenarioLab() {
  const { fleet } = useFleet();
  const { notify } = useToasts();
  const [params, setParams] = useSearchParams();
  const [modes, setModes] = useState([]);
  const [mode, setMode] = useState('oil_starvation');
  const [severity, setSeverity] = useState(1);
  const [days, setDays] = useState(5);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [dialog, setDialog] = useState(false);
  const inflight = useRef(false);

  useEffect(() => { api.faultModes().then(setModes).catch(() => {}); }, []);

  const units = fleet ? fleet.units : [];
  const unitId = params.get('unit') || (units.find((u) => u.scenario) || units.find((u) => u.status === 'healthy') || units[0] || {}).id;
  const unit = units.find((u) => u.id === unitId);
  const selectedMode = modes.find((m) => m.key === mode);

  const loadDetail = useCallback(async () => {
    if (!unitId || inflight.current) return;
    inflight.current = true;
    try { setDetail(await api.unit(unitId)); } catch { /* shown via fleet state */ } finally { inflight.current = false; }
  }, [unitId]);
  useEffect(() => { setDetail(null); loadDetail(); }, [loadDetail]);
  useEffect(() => { if (fleet) loadDetail(); }, [fleet && fleet.hour, loadDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = !unit ? 'Choose a compressor.'
    : unit.status === 'tripped' ? 'This compressor has tripped. Log the repair first.'
      : unit.status === 'maintenance' ? 'This compressor is recommissioning after service.'
        : unit.scenario ? 'A fault is already developing on this compressor.' : null;

  const start = async () => {
    setBusy(true);
    try {
      await api.startScenario(unitId, { mode, severity, durationDays: days });
      notify({ tone: 'ok', title: 'Scenario started', body: `${selectedMode ? selectedMode.label : 'A fault'} is now developing on ${unit.name}. Watch how many days of warning the model gives.`, timeout: 6000 });
      loadDetail();
    } catch (e) {
      notify({ tone: 'crit', title: 'Scenario not started', body: e.message });
    } finally {
      setBusy(false);
    }
  };

  const setSim = async (body) => {
    try { await api.setSimulation(body); } catch (e) { notify({ tone: 'crit', title: 'Simulation not changed', body: e.message }); }
  };

  const reset = async () => {
    if (!window.confirm('Reset the whole fleet? Every compressor restarts healthy apart from the two pre-seeded faults, and the impact counters return to zero.')) return;
    try {
      await api.resetSimulation();
      notify({ tone: 'ok', title: 'Fleet reset', body: 'The simulation restarted from a fresh baseline.', timeout: 5000 });
    } catch (e) {
      notify({ tone: 'crit', title: 'Fleet not reset', body: e.message });
    }
  };

  const onService = async (body) => {
    try {
      const rec = await api.service(unitId, body);
      notify({ tone: 'ok', title: 'Service logged', body: rec.outcome, timeout: 8000 });
      setDialog(false);
      loadDetail();
    } catch (e) {
      notify({ tone: 'crit', title: 'Service not logged', body: e.message });
    }
  };

  const chartData = useMemo(() => (detail ? detail.predictions : []), [detail]);
  const sevLabel = SEVERITY.find((s) => severity <= s.max).label;

  if (!fleet) return null;
  const thr = fleet.thresholds.random_forest;
  const s = unit && unit.scenario;
  const leadHours = s && unit.warningHours !== null ? unit.warningHours + Math.max(0, s.hoursToTrip) : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Scenario lab</h1>
          <p className="t-body" style={{ marginTop: 6 }}>Start a fault on any compressor and watch how many days of warning the model gives before it would trip.</p>
        </div>
      </header>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)' }}>
        <div className="stack">
          <Panel title="Set up a scenario">
            <div className="stack" style={{ gap: 18 }}>
              <div className="field">
                <label htmlFor="sc-unit">Compressor</label>
                <select id="sc-unit" className="select" value={unitId || ''} onChange={(e) => setParams({ unit: e.target.value })}>
                  {fleet.sites.map((site) => (
                    <optgroup key={site.id} label={`${site.name}, ${site.city}`}>
                      {units.filter((u) => u.site === site.id).map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.id}){u.scenario ? ', scenario running' : u.status === 'tripped' ? ', tripped' : ''}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="field">
                <span className="label" id="mode-label">Fault</span>
                <div className="modes" role="group" aria-labelledby="mode-label">
                  {modes.map((m) => (
                    <button key={m.key} type="button" className="mode" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>
                      <span className="mode-name">{m.label}</span>
                      <span className="mode-sig">{m.signature}</span>
                    </button>
                  ))}
                </div>
                {selectedMode && <p className="t-small" style={{ marginTop: 4 }}>{selectedMode.summary}</p>}
              </div>

              <div className="grid-halves" style={{ gap: 18 }}>
                <div className="field">
                  <label htmlFor="sc-sev">Severity: {sevLabel}</label>
                  <input id="sc-sev" type="range" className="range" min="0.6" max="1.2" step="0.05" value={severity} onChange={(e) => setSeverity(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label htmlFor="sc-days">Days until failure: {days}</label>
                  <input id="sc-days" type="range" className="range" min="3" max="10" step="1" value={days} onChange={(e) => setDays(Number(e.target.value))} />
                </div>
              </div>

              <div className="actions" style={{ alignItems: 'center' }}>
                <button type="button" className="btn btn-warn" onClick={start} disabled={busy || Boolean(blocked)}>Start scenario</button>
                {blocked && <span className="t-small">{blocked}</span>}
              </div>
            </div>
          </Panel>

          <Panel title="Simulation clock" subtitle={`One tick every ${fleet.tickMs / 1000} s. Each tick advances the chosen number of hours.`}>
            <div className="actions" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="segmented" role="group" aria-label="Hours per tick">
                {SPEEDS.map((v) => (
                  <button key={v} type="button" aria-pressed={fleet.speed === v} onClick={() => setSim({ speed: v })}>{v} h</button>
                ))}
              </div>
              <div className="actions">
                <button type="button" className="btn" onClick={() => setSim({ paused: !fleet.paused })}>
                  {fleet.paused ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
                </button>
                <button type="button" className="btn btn-ghost" onClick={reset}><RotateCcw size={16} /> Reset fleet</button>
              </div>
            </div>
          </Panel>
        </div>

        {unit && (
          <Panel
            title={`Watching ${unit.name}`}
            subtitle={`${unit.id}, ${unit.siteName}`}
            actions={<StatusBadge status={unit.status} />}
          >
            <div className="stack" style={{ gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 24, alignItems: 'center' }}>
                <Gauge value={unit.risk} threshold={thr} size={210} dimmed={unit.status === 'maintenance'} />
                <div className="stack" style={{ gap: 6 }}>
                  <span className="t-small">Early warning lead</span>
                  <div className="lead-clock t-num">
                    {leadHours !== null ? (leadHours / 24).toFixed(1) : '0.0'}<small>days</small>
                  </div>
                  <p className="t-small">
                    {leadHours !== null ? 'Time between the first warning and the projected trip. This is the window a technician has to act.' : s ? 'Counting starts when the model raises its first warning.' : 'Start a scenario to measure lead time.'}
                  </p>
                  {(s || unit.status === 'tripped') && (
                    <div className="actions" style={{ marginTop: 6 }}>
                      <button type="button" className="btn btn-primary" onClick={() => setDialog(true)}><Wrench size={16} /> {unit.status === 'tripped' ? 'Log repair' : 'Send technician now'}</button>
                      <Link to={`/units/${unit.id}`} className="btn btn-ghost" style={{ textDecoration: 'none' }}>Open compressor</Link>
                    </div>
                  )}
                </div>
              </div>

              <Milestones unit={unit} detail={detail} />

              <div style={{ height: 170 }}>
                <ResponsiveContainer>
                  <AreaChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => (detail ? fmtShortDate(detail.startEpoch + t * HOUR) : '')} tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--line)" tickCount={6} />
                    <YAxis domain={[0, 1]} tickFormatter={(v) => `${v * 100}%`} tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--line)" width={50} />
                    <Tooltip content={<ChartTooltip labelFormatter={(t) => (detail ? fmtDateTime(new Date(detail.startEpoch + t * HOUR).toISOString()) : t)} valueFormatter={(v) => pct(v)} />} />
                    <ReferenceLine y={thr} stroke="var(--ink)" strokeDasharray="5 4" />
                    {s && detail && <ReferenceLine x={s.injectedHour} stroke="var(--amber)" />}
                    <Area type="monotone" dataKey="rf" name="Failure risk" stroke="var(--teal)" strokeWidth={2} fill="var(--teal)" fillOpacity={0.12} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>
        )}
      </div>

      {dialog && unit && <ServiceDialog unit={unit} onClose={() => setDialog(false)} onConfirm={onService} />}
    </div>
  );
}
