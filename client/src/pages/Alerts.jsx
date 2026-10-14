import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellOff } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFleet, useToasts } from '../context/FleetContext.jsx';
import Panel from '../components/Panel.jsx';
import { fmtDateTime, pct } from '../lib/format.js';

const TABS = [
  { key: 'active', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All alerts' },
  { key: 'service', label: 'Service log' },
];

const SEVERITY = {
  critical: { label: 'Critical', tone: 'crit' },
  warning: { label: 'Early warning', tone: 'warn' },
};

const STATUS_TEXT = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved by service',
  cleared: 'Cleared on its own',
  archived: 'Archived',
};

export default function Alerts() {
  const { fleet } = useFleet();
  const { notify } = useToasts();
  const [tab, setTab] = useState('active');
  const [rows, setRows] = useState(null);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      if (tab === 'service') setRows(await api.maintenance());
      else {
        const all = await api.alerts(tab === 'active' ? 'active' : undefined);
        setRows(tab === 'closed' ? all.filter((a) => a.status !== 'open' && a.status !== 'acknowledged') : all);
      }
    } catch (e) {
      notify({ tone: 'crit', title: 'Could not load records', body: e.message });
    } finally {
      inflight.current = false;
    }
  }, [tab, notify]);

  useEffect(() => { setRows(null); load(); }, [load]);
  useEffect(() => { if (fleet && fleet.hour % 3 === 0) load(); }, [fleet && fleet.hour, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const ack = async (a) => {
    try {
      await api.acknowledge(a.id, 'Shift supervisor');
      notify({ tone: 'ok', title: 'Alert acknowledged', body: `${a.unitName} is marked as being looked at.`, timeout: 5000 });
      load();
    } catch (e) {
      notify({ tone: 'crit', title: 'Could not acknowledge', body: e.message });
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Alerts</h1>
          <p className="t-body" style={{ marginTop: 6 }}>
            Every early warning the model raised, what it suspected, and how it ended.
            {fleet && fleet.storeMode === 'firebase' ? ' Records are stored in Firebase.' : ''}
          </p>
        </div>
      </header>

      <Panel flush>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {!rows ? (
          <div className="panel-body"><div className="skeleton" style={{ height: 160 }} /></div>
        ) : !rows.length ? (
          <div className="empty">
            <BellOff size={22} />
            <b style={{ color: 'var(--ink)' }}>{tab === 'service' ? 'No service visits logged yet' : tab === 'active' ? 'No open alerts' : 'No alerts here yet'}</b>
            <span>{tab === 'service' ? 'Log a service from any compressor page to see it here.' : 'Start a fault in the Scenario lab to see the model raise one.'}</span>
          </div>
        ) : tab === 'service' ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Compressor</th><th>Outcome</th><th>Technician</th><th>Warning lead</th></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.simTime)}</td>
                    <td><Link to={`/units/${m.unitId}`}>{m.unitName}</Link><div className="t-small">{m.site}</div></td>
                    <td style={{ maxWidth: 420 }}>{m.outcome}{m.note && <div className="t-small">{m.note}</div>}</td>
                    <td>{m.technician}</td>
                    <td>{m.leadDays ? `${m.leadDays} days` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Severity</th><th>Compressor</th><th>Suspected fault</th><th>Risk</th><th>Raised</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((a) => {
                  const sev = SEVERITY[a.severity] || SEVERITY.warning;
                  return (
                    <tr key={a.id}>
                      <td><span className={`badge tone-${a.kind === 'trip' ? 'trip' : sev.tone}`}><i />{a.kind === 'trip' ? 'Trip' : sev.label}</span></td>
                      <td><Link to={`/units/${a.unitId}`}>{a.unitName}</Link><div className="t-small">{a.site}, {a.city}</div></td>
                      <td>{a.diagnosis.label}<div className="t-small">{pct(a.diagnosis.confidence)} confidence</div></td>
                      <td style={{ fontWeight: 600 }}>{pct(a.probability)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.simTime)}</td>
                      <td>
                        {STATUS_TEXT[a.status] || a.status}
                        {a.acknowledgedBy && a.status === 'acknowledged' && <div className="t-small">by {a.acknowledgedBy}</div>}
                        {a.resolution && a.status !== 'acknowledged' && <div className="t-small" style={{ maxWidth: 260 }}>{a.resolution}</div>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {a.status === 'open' && <button type="button" className="btn btn-sm" onClick={() => ack(a)}>Acknowledge</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
