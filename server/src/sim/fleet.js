// Live fleet: steps every compressor forward in simulated time, runs the
// models on each new reading, raises and resolves alerts, and keeps the
// operational impact ledger (failures prevented, trips, false alarms).

import { EventEmitter } from 'node:events';
import { CompressorSim, createUnitProfile, FAULT_MODES } from './physics.js';
import { computeFeatures, CHANNELS } from '../ml/features.js';
import { mulberry32 } from '../ml/random.js';
import { FLEET, SITES, PRESEEDED } from './catalog.js';

const KEEP = 240; // hours of history kept per unit
const BASELINE = 168; // hours of readings needed before the model scores a unit
const WARMUP = BASELINE + 216; // hours simulated before the console opens
const COMMISSIONING = 72; // hours after service before alerts re-arm
const CALM_TO_CLEAR = 36; // hours below threshold before an alert auto-clears
const HOUR_MS = 3600 * 1000;

const round = (v, d = 3) => +v.toFixed(d);

export class Fleet extends EventEmitter {
  constructor({ engine, store, config }) {
    super();
    this.engine = engine;
    this.store = store;
    this.config = config;
    this.thr = engine.thresholds;
    this.hour = 0;
    this.speed = config.simSpeed;
    this.paused = false;
    this.units = new Map();
    this.events = [];
    this.alertSeq = 0;
    this.rng = mulberry32(config.seed);
    this.stats = { alertsRaised: 0, prevented: 0, trips: 0, tripsCaught: 0, falseAlarms: 0, leadTimes: [] };
  }

  simTime(h = this.hour) {
    return new Date(this.startEpoch + h * HOUR_MS).toISOString();
  }

  async init() {
    this.startEpoch = Math.floor((Date.now() - WARMUP * HOUR_MS) / HOUR_MS) * HOUR_MS;
    this.hour = 0;
    this.units.clear();
    this.events = [];
    this.stats = { alertsRaised: 0, prevented: 0, trips: 0, tripsCaught: 0, falseAlarms: 0, leadTimes: [] };
    for (const def of FLEET) {
      const rng = mulberry32(Math.floor(this.rng() * 2 ** 31));
      const site = SITES.find((s) => s.id === def.site);
      this.units.set(def.id, {
        ...def,
        siteName: site.name,
        city: site.city,
        sim: new CompressorSim(rng, createUnitProfile(rng)),
        readings: [],
        predictions: [],
        status: 'healthy',
        consecutive: 0,
        calmHours: 0,
        activeAlert: null,
        firstAlertHour: null,
        featureStart: null,
        maintenanceUntil: null,
        trippedAt: null,
        last: null,
        lastX: null,
        scenario: null,
      });
    }
    const pending = PRESEEDED.map((p) => ({ ...p, startHour: Math.round(WARMUP - p.progress * p.durationDays * 24) }));
    this.warming = true;
    for (let h = 0; h < WARMUP; h++) {
      for (const p of pending) {
        if (p.startHour === h) this.injectFault(p.unit, { mode: p.mode, severity: p.severity, durationDays: p.durationDays }, { silent: true });
      }
      this.stepAll();
    }
    this.warming = false;
    await this.store.syncUnits([...this.units.values()].map((u) => this.unitMeta(u)));
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), this.config.tickMs);
    this.snapshotTimer = setInterval(() => this.snapshot(), this.config.snapshotIntervalSec * 1000);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.snapshotTimer);
  }

  tick() {
    if (this.paused) return;
    for (let s = 0; s < this.speed; s++) this.stepAll();
    this.emit('update', this.summary());
  }

  stepAll() {
    for (const u of this.units.values()) this.stepUnit(u);
    this.hour += 1;
  }

  stepUnit(u) {
    if (u.status === 'tripped') return;
    const reading = u.sim.step();
    reading.t = this.hour;
    u.readings.push(reading);
    if (u.readings.length > KEEP) u.readings.shift();

    if (u.sim.fault && u.sim.faultProgress() >= 1) {
      this.trip(u);
      return;
    }
    if (u.featureStart === null && u.readings.length < BASELINE) return;
    if (u.featureStart !== null && this.hour - u.featureStart >= 168) u.featureStart = null;
    const window = u.featureStart === null ? u.readings : u.readings.filter((r) => r.t >= u.featureStart);
    const x = computeFeatures(window);
    const pred = this.engine.predict(x);
    u.lastX = x;
    u.last = pred;
    u.predictions.push({ t: this.hour, rf: round(pred.rf), lr: round(pred.lr), iso: round(pred.iso) });
    if (u.predictions.length > KEEP) u.predictions.shift();
    this.evaluate(u, pred);
    if (!u.sim.fault && this.config.autoFaults && !this.warming) this.maybeAutoFault(u);
  }

  evaluate(u, pred) {
    const thr = this.thr.random_forest;
    if (u.status === 'maintenance') {
      if (this.hour >= u.maintenanceUntil) {
        u.status = 'healthy';
        u.maintenanceUntil = null;
      } else return;
    }
    if (pred.rf >= thr) u.consecutive++;
    else if (pred.rf < thr * 0.85) u.consecutive = 0;

    let level = 'healthy';
    if (u.consecutive >= 6) level = pred.rf >= Math.max(0.85, thr + 0.1) ? 'critical' : 'warning';
    else if (pred.rf >= thr * 0.6 || pred.iso >= this.thr.isolation_forest) level = 'watch';

    if (level === 'warning' || level === 'critical') {
      u.calmHours = 0;
      if (!u.activeAlert) this.raiseAlert(u, level, pred);
      else if (level === 'critical' && u.activeAlert.severity !== 'critical') this.updateAlert(u, { severity: 'critical', probability: round(pred.rf) });
      u.status = level;
      return;
    }
    if (u.activeAlert) {
      u.calmHours++;
      if (u.calmHours >= CALM_TO_CLEAR) {
        this.closeAlert(u, 'cleared', 'Risk stayed below the alert threshold for 36 hours.');
        if (!u.sim.fault) this.stats.falseAlarms++;
        u.firstAlertHour = null;
        u.status = level;
      } else u.status = u.activeAlert.severity === 'critical' ? 'critical' : 'warning';
      return;
    }
    u.status = level;
  }

  diagnosisOf(pred) {
    const d = pred.diagnosis;
    return { mode: d.mode, label: FAULT_MODES[d.mode].label, confidence: round(d.confidence, 3) };
  }

  raiseAlert(u, severity, pred) {
    const explain = this.engine.explain(u.lastX, 4);
    const alert = {
      id: `ALT-${String(++this.alertSeq).padStart(4, '0')}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      unitId: u.id,
      unitName: u.name,
      site: u.siteName,
      city: u.city,
      severity,
      status: 'open',
      kind: 'early_warning',
      probability: round(pred.rf),
      diagnosis: this.diagnosisOf(pred),
      factors: explain.items.filter((i) => i.contribution > 0).slice(0, 3).map((i) => i.feature),
      simTime: this.simTime(),
      simHour: this.hour,
      createdAt: new Date().toISOString(),
      groundTruth: u.sim.fault ? u.sim.fault.mode : null,
    };
    u.activeAlert = alert;
    if (u.firstAlertHour === null) u.firstAlertHour = this.hour;
    this.stats.alertsRaised++;
    this.store.saveAlert(alert);
    this.logEvent(u, 'alert_raised', `${severity === 'critical' ? 'Critical' : 'Early'} warning raised, ${alert.diagnosis.label.toLowerCase()} suspected`);
    if (!this.warming) this.emit('alert', alert);
  }

  updateAlert(u, patch) {
    const wasCritical = u.activeAlert.severity === 'critical';
    Object.assign(u.activeAlert, patch);
    this.store.updateAlert(u.activeAlert.id, patch);
    if (patch.severity === 'critical' && !wasCritical) {
      this.logEvent(u, 'alert_escalated', 'Alert escalated to critical');
      if (!this.warming) this.emit('alert', u.activeAlert);
    }
  }

  closeAlert(u, status, resolution) {
    if (!u.activeAlert) return;
    const patch = { status, resolution, closedAt: new Date().toISOString(), closedSimTime: this.simTime() };
    Object.assign(u.activeAlert, patch);
    this.store.updateAlert(u.activeAlert.id, patch);
    u.activeAlert = null;
  }

  trip(u) {
    const mode = u.sim.fault.mode;
    const leadDays = u.firstAlertHour !== null ? round((this.hour - u.firstAlertHour) / 24, 1) : 0;
    u.status = 'tripped';
    u.trippedAt = this.hour;
    u.consecutive = 0;
    this.stats.trips++;
    if (leadDays > 0) this.stats.tripsCaught++;
    if (u.activeAlert) {
      this.updateAlert(u, { severity: 'critical', kind: 'trip', tripSimTime: this.simTime() });
    } else {
      const alert = {
        id: `ALT-${String(++this.alertSeq).padStart(4, '0')}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
        unitId: u.id, unitName: u.name, site: u.siteName, city: u.city,
        severity: 'critical', status: 'open', kind: 'trip',
        probability: u.last ? round(u.last.rf) : 1,
        diagnosis: { mode, label: FAULT_MODES[mode].label, confidence: 1 },
        factors: [], simTime: this.simTime(), simHour: this.hour, createdAt: new Date().toISOString(), groundTruth: mode,
      };
      u.activeAlert = alert;
      this.store.saveAlert(alert);
      if (!this.warming) this.emit('alert', alert);
    }
    this.logEvent(u, 'trip', leadDays > 0
      ? `Compressor tripped on ${FAULT_MODES[mode].label.toLowerCase()}. The model warned ${leadDays} days earlier.`
      : `Compressor tripped on ${FAULT_MODES[mode].label.toLowerCase()} with no early warning.`, { leadDays, mode });
  }

  injectFault(unitId, { mode, severity = 1, durationDays = 6 }, { silent = false } = {}) {
    const u = this.units.get(unitId);
    if (!u) throw Object.assign(new Error('Unit not found'), { status: 404 });
    if (!FAULT_MODES[mode]) throw Object.assign(new Error(`Unknown fault mode "${mode}"`), { status: 400 });
    if (u.status === 'tripped') throw Object.assign(new Error('Restore this compressor before starting a new scenario.'), { status: 409 });
    if (u.sim.fault) throw Object.assign(new Error('A fault is already developing on this compressor.'), { status: 409 });
    const sev = Math.min(1.3, Math.max(0.4, Number(severity)));
    const days = Math.min(12, Math.max(2, Number(durationDays)));
    u.sim.injectFault(mode, sev, Math.round(days * 24));
    u.scenario = { mode, label: FAULT_MODES[mode].label, severity: sev, durationDays: days, injectedHour: this.hour, injectedSimTime: this.simTime() };
    if (!silent) {
      this.logEvent(u, 'fault_injected', `Scenario started: ${FAULT_MODES[mode].label.toLowerCase()} developing over ${days} days`, { mode });
      this.store.saveEvent({ type: 'fault_injected', unitId, mode, severity: sev, durationDays: days, simTime: this.simTime(), createdAt: new Date().toISOString() });
    }
    return this.unitSummary(u);
  }

  maybeAutoFault(u) {
    const active = [...this.units.values()].filter((x) => x.sim.fault).length;
    if (active >= 3 || u.status !== 'healthy') return;
    if (this.rng() < 1 / (24 * 60)) {
      const modes = Object.keys(FAULT_MODES);
      const mode = modes[Math.floor(this.rng() * modes.length)];
      this.injectFault(u.id, { mode, severity: 0.7 + this.rng() * 0.4, durationDays: 4 + Math.floor(this.rng() * 5) }, { silent: true });
    }
  }

  service(unitId, { technician = 'Duty technician', note = '' } = {}) {
    const u = this.units.get(unitId);
    if (!u) throw Object.assign(new Error('Unit not found'), { status: 404 });
    let action = 'inspection';
    let outcome;
    let leadDays = null;
    const faultMode = u.sim.fault ? u.sim.fault.mode : null;

    if (u.status === 'tripped') {
      action = 'repair_after_trip';
      outcome = 'Repaired after an unplanned trip';
    } else if (u.sim.fault) {
      action = 'preventive_repair';
      const projectedTrip = u.sim.fault.startHour + u.sim.fault.durationH;
      const hoursRemaining = u.sim.hoursToTrip();
      if (u.firstAlertHour !== null) {
        leadDays = round((projectedTrip - u.firstAlertHour) / 24, 1);
        this.stats.leadTimes.push(leadDays);
      }
      this.stats.prevented++;
      outcome = `Failure prevented, found ${FAULT_MODES[faultMode].label.toLowerCase()} about ${round(hoursRemaining / 24, 1)} days before it would have tripped`;
    } else if (u.activeAlert) {
      action = 'inspection';
      outcome = 'No fault found, alert recorded as a false alarm';
      this.stats.falseAlarms++;
    } else {
      outcome = 'Routine service, no fault found';
    }

    const record = {
      id: `SVC-${Date.now().toString(36).toUpperCase()}`,
      unitId: u.id, unitName: u.name, site: u.siteName,
      action, outcome, technician, note, faultMode, leadDays,
      alertId: u.activeAlert ? u.activeAlert.id : null,
      simTime: this.simTime(),
      createdAt: new Date().toISOString(),
    };
    this.closeAlert(u, 'resolved', outcome);
    this.store.saveMaintenance(record);
    u.sim.clearFault();
    u.scenario = null;
    u.status = 'maintenance';
    u.maintenanceUntil = this.hour + COMMISSIONING;
    u.featureStart = this.hour;
    u.trippedAt = null;
    u.consecutive = 0;
    u.calmHours = 0;
    u.firstAlertHour = null;
    this.logEvent(u, 'service', outcome, { leadDays });
    this.emit('update', this.summary());
    return record;
  }

  acknowledge(alertId, by = 'Operator') {
    for (const u of this.units.values()) {
      if (u.activeAlert && u.activeAlert.id === alertId) {
        this.updateAlert(u, { status: 'acknowledged', acknowledgedBy: by, acknowledgedAt: new Date().toISOString() });
        this.logEvent(u, 'alert_acknowledged', `Alert acknowledged by ${by}`);
        return u.activeAlert;
      }
    }
    return null;
  }

  logEvent(u, type, message, extra = {}) {
    const e = { id: `${this.hour}-${u.id}-${type}`, type, unitId: u.id, unitName: u.name, message, simTime: this.simTime(), hour: this.hour, ...extra };
    this.events.unshift(e);
    if (this.events.length > 200) this.events.pop();
    if (!this.warming && (type === 'trip' || type === 'service')) this.store.saveEvent({ ...e, createdAt: new Date().toISOString() });
  }

  setSimulation({ speed, paused }) {
    if (speed !== undefined) this.speed = Math.min(24, Math.max(1, Math.round(Number(speed))));
    if (paused !== undefined) this.paused = Boolean(paused);
    this.emit('update', this.summary());
    return { speed: this.speed, paused: this.paused };
  }

  async reset() {
    this.stop();
    for (const u of this.units.values()) if (u.activeAlert) this.closeAlert(u, 'archived', 'Simulation reset');
    await this.init();
    this.start();
    this.emit('update', this.summary());
  }

  async snapshot() {
    const rows = [...this.units.values()].map((u) => ({
      unitId: u.id,
      status: u.status,
      risk: u.last ? round(u.last.rf) : 0,
      anomaly: u.last ? round(u.last.iso) : 0,
      readings: u.readings.length ? Object.fromEntries(CHANNELS.map((c) => [c.key, u.readings[u.readings.length - 1][c.key]])) : null,
      simTime: this.simTime(),
      createdAt: new Date().toISOString(),
    }));
    await this.store.saveSnapshots(rows);
  }

  // ---------- read models ----------

  unitMeta(u) {
    return { id: u.id, name: u.name, site: u.site, siteName: u.siteName, city: u.city, type: u.type, refrigerant: u.refrigerant, capacityTR: u.capacityTR, installed: u.installed };
  }

  unitSummary(u) {
    const last = u.last;
    const risk = u.status === 'tripped' ? 1 : last ? last.rf : 0;
    const latest = u.readings[u.readings.length - 1] || null;
    const trend = u.predictions.slice(-48).filter((_, i) => i % 2 === 1).map((p) => p.rf);
    return {
      ...this.unitMeta(u),
      status: u.status,
      risk: round(risk),
      logistic: last ? round(last.lr) : 0,
      anomaly: last ? round(last.iso) : 0,
      health: Math.round(100 * (1 - risk)),
      diagnosis: last && risk >= this.thr.random_forest * 0.5 ? this.diagnosisOf(last) : null,
      trend,
      latest,
      activeAlert: u.activeAlert ? { id: u.activeAlert.id, severity: u.activeAlert.severity, status: u.activeAlert.status, kind: u.activeAlert.kind } : null,
      warningHours: u.firstAlertHour !== null ? this.hour - u.firstAlertHour : null,
      maintenanceHoursLeft: u.maintenanceUntil !== null ? u.maintenanceUntil - this.hour : null,
      trippedSimTime: u.trippedAt !== null ? this.simTime(u.trippedAt) : null,
      scenario: u.scenario ? { ...u.scenario, progress: round(Math.min(1, u.sim.faultProgress()), 3), hoursToTrip: u.sim.hoursToTrip() } : null,
    };
  }

  kpis(units) {
    const active = units.filter((u) => u.status !== 'tripped');
    const leads = this.stats.leadTimes;
    return {
      fleetHealth: Math.round(active.reduce((a, u) => a + u.health, 0) / (active.length || 1)),
      atRisk: units.filter((u) => u.status === 'warning' || u.status === 'critical').length,
      watch: units.filter((u) => u.status === 'watch').length,
      tripped: units.filter((u) => u.status === 'tripped').length,
      maintenance: units.filter((u) => u.status === 'maintenance').length,
      openAlerts: units.filter((u) => u.activeAlert).length,
      prevented: this.stats.prevented,
      trips: this.stats.trips,
      tripsCaught: this.stats.tripsCaught,
      falseAlarms: this.stats.falseAlarms,
      alertsRaised: this.stats.alertsRaised,
      meanLeadDays: leads.length ? round(leads.reduce((a, b) => a + b, 0) / leads.length, 1) : null,
    };
  }

  summary() {
    const units = [...this.units.values()].map((u) => this.unitSummary(u));
    return {
      simTime: this.simTime(),
      hour: this.hour,
      speed: this.speed,
      paused: this.paused,
      tickMs: this.config.tickMs,
      storeMode: this.store.mode,
      thresholds: this.thr,
      sites: SITES,
      units,
      kpis: this.kpis(units),
      events: this.events.slice(0, 15),
    };
  }

  detail(unitId) {
    const u = this.units.get(unitId);
    if (!u) return null;
    const hist = u.readings.slice(-168);
    return {
      ...this.unitSummary(u),
      simTime: this.simTime(),
      startEpoch: this.startEpoch,
      thresholds: this.thr,
      channels: CHANNELS,
      readings: hist,
      predictions: u.predictions.slice(-168),
      explanation: u.lastX && u.status !== 'tripped' ? this.engine.explain(u.lastX, 10) : null,
      diagnosisDistribution: u.last
        ? this.engine.faultModes.map((m, i) => ({ mode: m, label: FAULT_MODES[m].label, p: round(u.last.diagnosis.distribution[i], 3) }))
        : [],
      recommendation: u.last && (u.status === 'warning' || u.status === 'critical' || u.status === 'tripped')
        ? { ...FAULT_MODES[u.status === 'tripped' && u.sim.fault ? u.sim.fault.mode : u.last.diagnosis.mode], mode: u.last.diagnosis.mode }
        : null,
      events: this.events.filter((e) => e.unitId === u.id).slice(0, 20),
      alert: u.activeAlert,
    };
  }
}
