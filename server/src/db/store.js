// Persistence layer.
// With Firebase credentials in .env, alerts, maintenance logs, events and
// periodic telemetry snapshots are written to Cloud Firestore.
// Without credentials the server runs in memory, so a demo never fails
// because of a network or credential problem.

import fs from 'node:fs';
import path from 'node:path';

const COLLECTIONS = {
  units: 'units',
  alerts: 'alerts',
  maintenance: 'maintenance_logs',
  events: 'events',
  telemetry: 'telemetry_snapshots',
};

class MemoryStore {
  constructor() {
    this.mode = 'memory';
    this.alerts = new Map();
    this.maintenance = [];
  }
  async init() {}
  async syncUnits() {}
  async saveAlert(a) { this.alerts.set(a.id, { ...a }); }
  async updateAlert(id, patch) { if (this.alerts.has(id)) Object.assign(this.alerts.get(id), patch); }
  async saveMaintenance(r) { this.maintenance.unshift(r); if (this.maintenance.length > 500) this.maintenance.pop(); }
  async saveEvent() {}
  async saveSnapshots() {}
  listAlerts({ status, limit = 200 } = {}) {
    let list = [...this.alerts.values()].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    if (status === 'active') list = list.filter((a) => a.status === 'open' || a.status === 'acknowledged');
    else if (status) list = list.filter((a) => a.status === status);
    return list.slice(0, limit);
  }
  listMaintenance({ unitId, limit = 200 } = {}) {
    return this.maintenance.filter((m) => !unitId || m.unitId === unitId).slice(0, limit);
  }
}

class FirebaseStore extends MemoryStore {
  constructor(db, admin) {
    super();
    this.mode = 'firebase';
    this.db = db;
    this.admin = admin;
    this.failures = 0;
  }

  async init() {
    // Load recent history so the console keeps its records across restarts.
    const alerts = await this.db.collection(COLLECTIONS.alerts).orderBy('createdAt', 'desc').limit(200).get();
    const stale = [];
    alerts.forEach((d) => {
      const a = d.data();
      if (a.status === 'open' || a.status === 'acknowledged') {
        a.status = 'archived';
        a.resolution = 'Closed when the server restarted';
        stale.push(d.ref);
      }
      this.alerts.set(a.id, a);
    });
    if (stale.length) {
      const batch = this.db.batch();
      stale.forEach((ref) => batch.update(ref, { status: 'archived', resolution: 'Closed when the server restarted' }));
      await batch.commit();
    }
    const logs = await this.db.collection(COLLECTIONS.maintenance).orderBy('createdAt', 'desc').limit(200).get();
    logs.forEach((d) => this.maintenance.push(d.data()));
  }

  write(fn) {
    return fn().catch((e) => {
      this.failures++;
      if (this.failures <= 3 || this.failures % 50 === 0) console.warn(`[firestore] write failed: ${e.message}`);
    });
  }

  async syncUnits(units) {
    const batch = this.db.batch();
    units.forEach((u) => batch.set(this.db.collection(COLLECTIONS.units).doc(u.id), { ...u, updatedAt: new Date().toISOString() }, { merge: true }));
    return this.write(() => batch.commit());
  }

  async saveAlert(a) {
    await super.saveAlert(a);
    return this.write(() => this.db.collection(COLLECTIONS.alerts).doc(a.id).set(a));
  }

  async updateAlert(id, patch) {
    await super.updateAlert(id, patch);
    return this.write(() => this.db.collection(COLLECTIONS.alerts).doc(id).set(patch, { merge: true }));
  }

  async saveMaintenance(r) {
    await super.saveMaintenance(r);
    return this.write(() => this.db.collection(COLLECTIONS.maintenance).doc(r.id).set(r));
  }

  async saveEvent(e) {
    return this.write(() => this.db.collection(COLLECTIONS.events).add(e));
  }

  async saveSnapshots(rows) {
    const batch = this.db.batch();
    rows.forEach((r) => {
      batch.set(this.db.collection(COLLECTIONS.telemetry).doc(), r);
      batch.set(this.db.collection(COLLECTIONS.units).doc(r.unitId), { status: r.status, risk: r.risk, lastSeen: r.createdAt }, { merge: true });
    });
    return this.write(() => batch.commit());
  }
}

function readCredentials(config) {
  const { serviceAccountPath, projectId, clientEmail, privateKey } = config.firebase;
  if (serviceAccountPath) {
    const p = path.resolve(process.cwd(), serviceAccountPath);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    console.warn(`[firestore] FIREBASE_SERVICE_ACCOUNT_PATH points to ${p}, which does not exist.`);
  }
  if (projectId && clientEmail && privateKey && !privateKey.includes('YOUR_PRIVATE_KEY')) {
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey.replace(/\\n/g, '\n') };
  }
  return null;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);

export async function createStore(config) {
  const creds = readCredentials(config);
  if (!creds) {
    console.log('[store] No Firebase credentials found. Running with in-memory storage.');
    return new MemoryStore();
  }
  try {
    const { default: admin } = await import('firebase-admin');
    const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(creds) });
    const db = admin.firestore(app);
    await withTimeout(db.collection('meta').doc('server').set({ lastStart: new Date().toISOString(), version: '1.0.0' }), 8000);
    const store = new FirebaseStore(db, admin);
    await withTimeout(store.init(), 10000);
    console.log(`[store] Connected to Firestore project "${creds.project_id}".`);
    return store;
  } catch (e) {
    console.warn(`[store] Could not connect to Firestore (${e.message}). Falling back to in-memory storage.`);
    return new MemoryStore();
  }
}
