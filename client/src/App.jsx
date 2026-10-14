import { Route, Routes, Link } from 'react-router-dom';
import { useFleet } from './context/FleetContext.jsx';
import Rail from './components/Rail.jsx';
import Toasts from './components/Toasts.jsx';
import Overview from './pages/Overview.jsx';
import UnitDetail from './pages/UnitDetail.jsx';
import Alerts from './pages/Alerts.jsx';
import ScenarioLab from './pages/ScenarioLab.jsx';
import ModelReport from './pages/ModelReport.jsx';

function Boot({ connection }) {
  return (
    <div className="boot">
      <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
        <svg width="56" height="56" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M7 21a9 9 0 1 1 18 0" fill="none" stroke="#5cc6cf" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M16 21l5-7" stroke="#f0a43a" strokeWidth="2.5" strokeLinecap="round" style={{ transformOrigin: '16px 21px', animation: 'sweep 1.6s ease-in-out infinite alternate' }} />
          <circle cx="16" cy="21" r="2.2" fill="#fff" />
        </svg>
        <h1 className="t-h1" style={{ color: '#fff' }}>{connection === 'offline' ? 'Waiting for the CryoSense server' : 'Connecting to the fleet'}</h1>
        <p>
          {connection === 'offline'
            ? 'The console could not reach the API. Start it with "npm run dev" in the server folder, and this page connects on its own.'
            : 'Loading live telemetry from twelve compressors.'}
        </p>
      </div>
      <style>{'@keyframes sweep { from { transform: rotate(-80deg); } to { transform: rotate(10deg); } }'}</style>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <div className="panel empty">
        <b style={{ color: 'var(--ink)' }}>There is no page at this address.</b>
        <Link to="/" className="btn">Go to the fleet</Link>
      </div>
    </div>
  );
}

export default function App() {
  const { fleet, connection } = useFleet();
  if (!fleet) return <Boot connection={connection} />;
  return (
    <div className="shell">
      <Rail />
      <main className="main" id="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/units/:id" element={<UnitDetail />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/scenarios" element={<ScenarioLab />} />
          <Route path="/model" element={<ModelReport />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Toasts />
    </div>
  );
}
