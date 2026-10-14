import { useEffect, useRef, useState } from 'react';

export default function ServiceDialog({ unit, onClose, onConfirm }) {
  const [technician, setTechnician] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef(null);
  const tripped = unit.status === 'tripped';

  useEffect(() => {
    first.current && first.current.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm({ technician: technician.trim() || 'Duty technician', note: note.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="svc-title" onSubmit={submit}>
        <div>
          <h2 id="svc-title" className="t-h2">{tripped ? 'Log repair and restart' : 'Log a service visit'}</h2>
          <p className="t-small" style={{ marginTop: 4 }}>
            {unit.name}, {unit.siteName}. The compressor goes into recommissioning for 72 hours while the model rebuilds its sensor baseline.
          </p>
        </div>
        <div className="field">
          <label htmlFor="svc-tech">Technician</label>
          <input id="svc-tech" ref={first} className="input" placeholder="Duty technician" value={technician} onChange={(e) => setTechnician(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="svc-note">What was done</label>
          <textarea id="svc-note" className="textarea" placeholder="For example: topped up oil, replaced oil pressure switch" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : tripped ? 'Log repair' : 'Log service'}</button>
        </div>
      </form>
    </div>
  );
}
