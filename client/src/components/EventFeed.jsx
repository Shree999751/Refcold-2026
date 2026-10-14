import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Wrench, Zap, FlaskConical, Eye } from 'lucide-react';
import { fmtDateTime } from '../lib/format.js';

const ICON = {
  alert_raised: { icon: AlertTriangle, color: 'var(--amber)' },
  alert_escalated: { icon: AlertTriangle, color: 'var(--red)' },
  alert_acknowledged: { icon: Eye, color: 'var(--muted)' },
  trip: { icon: Zap, color: 'var(--red)' },
  service: { icon: Wrench, color: 'var(--violet)' },
  fault_injected: { icon: FlaskConical, color: 'var(--muted)' },
};

export default function EventFeed({ events, showUnit = true, empty = 'Nothing has happened yet. New warnings, trips and service visits appear here.' }) {
  if (!events || !events.length) return <div className="empty"><CheckCircle2 size={22} /><span>{empty}</span></div>;
  return (
    <ul className="feed">
      {events.map((e) => {
        const meta = ICON[e.type] || ICON.alert_raised;
        const Icon = meta.icon;
        return (
          <li key={e.id}>
            <Icon size={17} className="feed-icon" color={meta.color} aria-hidden="true" />
            <div>
              <div className="feed-msg">
                {showUnit && <><Link to={`/units/${e.unitId}`}>{e.unitName}</Link>{'. '}</>}
                {e.message}
              </div>
              <div className="feed-time">{fmtDateTime(e.simTime)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
