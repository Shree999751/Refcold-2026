const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new Error('Cannot reach the CryoSense server. Check that it is running on port 5000.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server returned ${res.status}.`);
  return data;
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const api = {
  fleet: () => request('/fleet'),
  unit: (id) => request(`/units/${encodeURIComponent(id)}`),
  startScenario: (id, body) => post(`/units/${encodeURIComponent(id)}/faults`, body),
  service: (id, body) => post(`/units/${encodeURIComponent(id)}/service`, body),
  alerts: (status) => request(`/alerts${status ? `?status=${status}` : ''}`),
  acknowledge: (id, by) => post(`/alerts/${encodeURIComponent(id)}/acknowledge`, { by }),
  maintenance: () => request('/maintenance'),
  model: () => request('/model'),
  faultModes: () => request('/fault-modes'),
  setSimulation: (body) => post('/simulation', body),
  resetSimulation: () => post('/simulation/reset'),
};

export const streamUrl = () => `${BASE}/api/stream`;
