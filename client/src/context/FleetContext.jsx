import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { streamUrl } from '../lib/api.js';

const FleetContext = createContext(null);
const ToastContext = createContext(null);

export function FleetProvider({ children }) {
  const [fleet, setFleet] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((toast) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, ...toast }]);
    setTimeout(() => dismiss(id), toast.timeout ?? 9000);
  }, [dismiss]);

  useEffect(() => {
    let es;
    let retry;
    const connect = () => {
      es = new EventSource(streamUrl());
      es.addEventListener('open', () => setConnection('live'));
      es.addEventListener('fleet', (e) => {
        setFleet(JSON.parse(e.data));
        setConnection('live');
      });
      es.addEventListener('alert', (e) => {
        const a = JSON.parse(e.data);
        const trip = a.kind === 'trip';
        notify({
          tone: a.severity === 'critical' ? 'crit' : 'warn',
          title: trip ? `${a.unitName} tripped` : `${a.severity === 'critical' ? 'Critical' : 'Early'} warning on ${a.unitName}`,
          body: trip
            ? `${a.city}. The compressor stopped on ${a.diagnosis.label.toLowerCase()}.`
            : `${a.city}. ${a.diagnosis.label} suspected, ${Math.round(a.probability * 100)}% failure risk within 7 days.`,
          unitId: a.unitId,
          timeout: 12000,
        });
      });
      es.onerror = () => {
        setConnection('offline');
        es.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      es && es.close();
    };
  }, [notify]);

  const value = useMemo(() => ({ fleet, connection }), [fleet, connection]);
  const toastValue = useMemo(() => ({ toasts, notify, dismiss }), [toasts, notify, dismiss]);

  return (
    <FleetContext.Provider value={value}>
      <ToastContext.Provider value={toastValue}>{children}</ToastContext.Provider>
    </FleetContext.Provider>
  );
}

export const useFleet = () => useContext(FleetContext);
export const useToasts = () => useContext(ToastContext);
