import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useFleet } from '../context/FleetContext.jsx';
import Gauge from '../components/Gauge.jsx';
import Sparkline from '../components/Sparkline.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Panel from '../components/Panel.jsx';
import EventFeed from '../components/EventFeed.jsx';
import { STATUS_ORDER, duration, plural } from '../lib/format.js';

function headline(fleet) {
  const { units, kpis } = fleet;
  const ranked = [...units].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.risk - a.risk);
  const top = ranked[0];
  if (kpis.tripped) {
    const t = units.find((u) => u.status === 'tripped');
    return {
      title: `${plural(kpis.tripped, 'compressor')} ${kpis.tripped === 1 ? 'has' : 'have'} tripped. ${t.name} in ${t.city} is waiting for repair.`,
      tone: 'crit',
    };
  }
  if (kpis.atRisk) {
    return {
      title: `${kpis.atRisk === 1 ? 'One compressor needs' : `${kpis.atRisk} compressors need`} attention. ${top.diagnosis ? top.diagnosis.label : 'A fault'} is developing on ${top.name} in ${top.city}.`,
      tone: 'warn',
    };
  }
  if (kpis.watch) {
    return { title: `The fleet is running normally, with ${plural(kpis.watch, 'compressor')} on watch.`, tone: 'watch' };
  }
  return { title: `All ${units.length} compressors are running normally.`, tone: 'ok' };
}

function unitNote(u) {
  if (u.status === 'tripped') return <><b>Stopped</b> <span>on {u.diagnosis ? u.diagnosis.label.toLowerCase() : 'a fault'}. Repair needed.</span></>;
  if (u.status === 'maintenance') return <><b>Recommissioning</b> <span>alerts re-arm in {duration(u.maintenanceHoursLeft)}</span></>;
  if (u.diagnosis && (u.status === 'warning' || u.status === 'critical' || u.status === 'watch')) {
    return <><b>{u.diagnosis.label}</b> <span>suspected, {Math.round(u.diagnosis.confidence * 100)}% confidence</span></>;
  }
  return <span>{u.type}, {u.refrigerant}, {u.capacityTR} TR</span>;
}

export default function Overview() {
  const { fleet } = useFleet();
  if (!fleet) return null;
  const { kpis, units, sites, thresholds } = fleet;
  const thr = thresholds.random_forest;
  const h = headline(fleet);

  const kpiItems = [
    { label: 'Average fleet health', value: kpis.fleetHealth, unit: '/ 100' },
    { label: 'Need attention now', value: kpis.atRisk + kpis.tripped, unit: `of ${units.length}` },
    { label: 'Failures prevented', value: kpis.prevented, unit: kpis.prevented === 1 ? 'repair' : 'repairs' },
    { label: 'Average warning lead', value: kpis.meanLeadDays ?? '0', unit: 'days' },
    { label: 'Trips with early warning', value: kpis.trips ? `${kpis.tripsCaught}/${kpis.trips}` : '0', unit: kpis.trips ? '' : 'trips so far' },
  ];

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-head-row">
          <div>
            <div className="prototype-badge-pill">
              <i />
              <span>REFCOLD India 2026 Prototype</span>
            </div>
            <h1 className="t-display">{h.title}</h1>
            <div className="hero-meta">
              <span>{units.length} compressors across {sites.length} sites</span>
              <span>Random Forest scores every compressor each simulated hour</span>
              <span>{fleet.storeMode === 'firebase' ? 'Records saved to Firebase' : 'Records kept in memory (Firebase not connected)'}</span>
            </div>
          </div>
          <a
            href="https://refcold-2026.onrender.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary hero-prototype-cta"
            title="Open CryoSense | Compressor health in new tab"
          >
            <span>Live Prototype</span>
            <ExternalLink size={15} />
          </a>
        </div>
      </header>

      <section className="prototype-banner" aria-label="Interactive Prototype Deployment">
        <div className="prototype-banner-left">
          <div className="prototype-icon-badge" aria-hidden="true">
            <ExternalLink size={20} />
          </div>
          <div>
            <div className="prototype-badge-row">
              <span className="prototype-status-tag">Live Deployment</span>
              <span className="prototype-pill-text">REFCOLD India 2026</span>
            </div>
            <h2 className="prototype-headline">Explore the REFCOLD 2026 Interactive Prototype</h2>
            <p className="prototype-desc">
              Access the deployed prototype at{' '}
              <a
                href="https://refcold-2026.onrender.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="prototype-raw-link"
              >
                CryoSense | Compressor health
              </a>
            </p>
          </div>
        </div>
        <a
          href="https://refcold-2026.onrender.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary prototype-btn"
          title="Open prototype in a new tab"
        >
          <span>Open Prototype</span>
          <ExternalLink size={16} />
        </a>
      </section>


      <section className="panel kpis" aria-label="Fleet indicators">
        {kpiItems.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="kpi-value t-num">{k.value}<small>{k.unit}</small></div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </section>

      <div className="grid-2">
        <Panel title="Compressors" subtitle="Grouped by site. The dial shows the chance of failure within 7 days." flush>
          <div style={{ paddingTop: 6 }}>
            {sites.map((s) => (
              <div className="site" key={s.id}>
                <div className="site-head">
                  <h3 className="t-h3">{s.name}</h3>
                  <span className="t-small">{s.city}</span>
                </div>
                {units.filter((u) => u.site === s.id).map((u) => (
                  <Link key={u.id} to={`/units/${u.id}`} className="unit-row" data-status={u.status}>
                    <Gauge value={u.risk} threshold={thr} size={58} compact dimmed={u.status === 'maintenance'} />
                    <div style={{ minWidth: 0 }}>
                      <div className="unit-name">{u.name}</div>
                      <div className="unit-id">{u.id}</div>
                    </div>
                    <div><StatusBadge status={u.status} /></div>
                    <div className="unit-diag">{unitNote(u)}</div>
                    <Sparkline values={u.trend} threshold={thr} width={118} height={34} />
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </Panel>

        <div className="stack">
          <Panel title="Activity" subtitle="Warnings, trips and service visits, newest first" flush>
            <div style={{ paddingTop: 8 }}>
              <EventFeed events={fleet.events.slice(0, 10)} />
            </div>
          </Panel>
          <Panel title="How to read the dials">
            <div className="stack" style={{ gap: 10 }}>
              <p className="t-body">The needle is the Random Forest's estimate that the compressor fails within 7 days, built from 33 trend features across eight sensors.</p>
              <p className="t-body">An early warning opens when risk stays above {Math.round(thr * 100)}% for six hours in a row. That persistence rule is what keeps false alarms rare. Open the model report for the measured rates.</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
