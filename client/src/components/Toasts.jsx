import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useToasts } from '../context/FleetContext.jsx';

export default function Toasts() {
  const { toasts, dismiss } = useToasts();
  const navigate = useNavigate();
  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone || ''}`}>
          <div className="toast-title">{t.title}</div>
          <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss notification"><X size={16} /></button>
          {t.body && <div className="toast-body">{t.body}</div>}
          {t.unitId && (
            <div className="toast-actions">
              <button type="button" className="btn btn-sm" onClick={() => { navigate(`/units/${t.unitId}`); dismiss(t.id); }}>View compressor</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
