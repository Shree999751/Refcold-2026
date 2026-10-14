import { Router } from 'express';
import { FAULT_MODES } from '../sim/physics.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApiRouter({ fleet, store, engine }) {
  const r = Router();

  r.get('/status', (req, res) => {
    res.json({
      ok: true,
      storeMode: store.mode,
      modelTrainedAt: engine.trainedAt,
      simTime: fleet.simTime(),
      speed: fleet.speed,
      paused: fleet.paused,
      units: fleet.units.size,
    });
  });

  r.get('/fleet', (req, res) => res.json(fleet.summary()));

  r.get('/units/:id', (req, res) => {
    const d = fleet.detail(req.params.id);
    if (!d) return res.status(404).json({ error: 'No compressor with that ID.' });
    res.json({ ...d, maintenance: store.listMaintenance({ unitId: req.params.id, limit: 20 }) });
  });

  r.post('/units/:id/faults', (req, res) => {
    const { mode, severity, durationDays } = req.body || {};
    res.status(201).json(fleet.injectFault(req.params.id, { mode, severity, durationDays }));
  });

  r.post('/units/:id/service', (req, res) => {
    const { technician, note } = req.body || {};
    res.status(201).json(fleet.service(req.params.id, { technician, note }));
  });

  r.get('/alerts', (req, res) => res.json(store.listAlerts({ status: req.query.status, limit: Number(req.query.limit) || 200 })));

  r.post('/alerts/:id/acknowledge', (req, res) => {
    const a = fleet.acknowledge(req.params.id, (req.body && req.body.by) || 'Operator');
    if (!a) return res.status(404).json({ error: 'That alert is no longer open.' });
    res.json(a);
  });

  r.get('/maintenance', (req, res) => res.json(store.listMaintenance({ limit: Number(req.query.limit) || 200 })));

  r.get('/model', (req, res) => res.json({ ...engine.metrics, thresholds: engine.thresholds }));

  r.get('/fault-modes', (req, res) => {
    res.json(Object.entries(FAULT_MODES).map(([key, m]) => ({ key, label: m.label, summary: m.summary, signature: m.signature, action: m.action, effects: m.effects })));
  });

  r.get('/impact', (req, res) => {
    const s = fleet.summary();
    res.json({ offline: engine.metrics.impact, live: s.kpis });
  });

  r.post('/simulation', (req, res) => res.json(fleet.setSimulation(req.body || {})));

  r.post('/simulation/reset', wrap(async (req, res) => {
    await fleet.reset();
    res.json({ ok: true });
  }));

  // Server-sent events: one fleet frame per simulation tick, plus alert pushes.
  r.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('fleet', fleet.summary());
    const onUpdate = (s) => send('fleet', s);
    const onAlert = (a) => send('alert', a);
    fleet.on('update', onUpdate);
    fleet.on('alert', onAlert);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      fleet.off('update', onUpdate);
      fleet.off('alert', onAlert);
    });
  });

  r.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Unexpected server error.' });
  });

  return r;
}
