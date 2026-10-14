import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

export const config = {
  port: num(process.env.PORT, 5000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  tickMs: num(process.env.SIM_TICK_MS, 2000),
  simSpeed: num(process.env.SIM_SPEED, 1),
  autoFaults: bool(process.env.SIM_AUTO_FAULTS, true),
  seed: num(process.env.SIM_SEED, 2026),
  snapshotIntervalSec: num(process.env.FIRESTORE_SNAPSHOT_INTERVAL_SEC, 300),
  modelDir: path.resolve(__dirname, '../models'),
  clientDist: path.resolve(__dirname, '../../client/dist'),
  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: process.env.FIREBASE_PRIVATE_KEY || '',
  },
};
