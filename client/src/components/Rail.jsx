import { NavLink } from 'react-router-dom';
import { Gauge as GaugeIcon, BellRing, FlaskConical, LineChart, Moon, Sun } from 'lucide-react';
import { useFleet } from '../context/FleetContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { fmtDate, fmtTime } from '../lib/format.js';

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#16384f" />
      <path d="M7 21a9 9 0 1 1 18 0" fill="none" stroke="#5cc6cf" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 21l5-7" stroke="#f0a43a" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="21" r="2.4" fill="#fff" />
    </svg>
  );
}

export default function Rail() {
  const { fleet, connection } = useFleet();
  const { theme, toggle } = useTheme();
  const open = fleet ? fleet.kpis.openAlerts : 0;
  const links = [
    { to: '/', label: 'Fleet', icon: GaugeIcon, end: true },
    { to: '/alerts', label: 'Alerts', icon: BellRing, count: open },
    { to: '/scenarios', label: 'Scenario lab', icon: FlaskConical },
    { to: '/model', label: 'Model report', icon: LineChart },
  ];
  const connLabel = { live: 'Live', connecting: 'Connecting', offline: 'Reconnecting' }[connection];

  return (
    <aside className="rail">
      <NavLink to="/" className="brand" aria-label="CryoSense home">
        <Logo />
        <div>
          <div className="brand-name">CryoSense</div>
          <div className="brand-sub">Compressor health for the cold chain</div>
        </div>
      </NavLink>
      <nav className="nav" aria-label="Main">
        {links.map(({ to, label, icon: Icon, end, count }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
            <span className="label">{label}</span>
            {count ? <span className="count" aria-label={`${count} open`}>{count}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="rail-foot">
        {fleet && (
          <div className="clock" aria-live="off">
            <div className="clock-date">{fmtDate(fleet.simTime)}</div>
            <div className="clock-time">{fmtTime(fleet.simTime)} IST</div>
            <div className="clock-row">
              <span className={`conn ${connection}`}><i />{connLabel}</span>
              <span>{fleet.paused ? 'Paused' : `${fleet.speed} h per tick`}</span>
            </div>
          </div>
        )}
        <button type="button" className="rail-btn" onClick={toggle}>
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          <span className="label">{theme === 'light' ? 'Night shift theme' : 'Day theme'}</span>
        </button>
      </div>
    </aside>
  );
}

