// Training pipeline.
//   npm run train
// 1. Simulate a fleet of compressors (healthy units and units that fail).
// 2. Engineer 33 rolling-window features every 3 hours.
// 3. Split by unit (no leakage between train / validation / test).
// 4. Train Logistic Regression, Random Forest, Isolation Forest, and a
//    fault-mode diagnosis forest.
// 5. Tune each model's threshold on validation, report on held-out test units:
//    precision/recall/F1, ROC, early-warning lead time, false alarms.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeFeatures, FEATURE_NAMES, CHANNELS } from './features.js';
import { mulberry32, uniform, randInt, shuffle } from './random.js';
import { CompressorSim, createUnitProfile, FAULT_KEYS, FAULT_MODES } from '../sim/physics.js';
import { RandomForest } from './forest.js';
import { LogisticRegression } from './logistic.js';
import { IsolationForest } from './isolationForest.js';
import { confusion, bestThreshold, roc } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MODEL_DIR = path.resolve(__dirname, '../../models');

const HORIZON = 168; // label = failure within the next 7 days
const SAMPLE_EVERY = 3;

export function generateDataset({ seed = 42, nHealthy = 90, nPerMode = 20, days = 48 } = {}) {
  const master = mulberry32(seed);
  const units = [];
  let uid = 0;
  const plan = [
    ...Array.from({ length: nHealthy }, () => null),
    ...FAULT_KEYS.flatMap((m) => Array.from({ length: nPerMode }, () => m)),
  ];
  for (const mode of plan) {
    const rng = mulberry32(Math.floor(master() * 2 ** 31));
    const sim = new CompressorSim(rng, createUnitProfile(rng));
    const total = days * 24;
    let failAt = null;
    let faultStart = null;
    let severity = 1;
    if (mode) {
      failAt = randInt(rng, 20 * 24, total - 1);
      const dur = randInt(rng, 3 * 24, 10 * 24);
      faultStart = failAt - dur;
      severity = uniform(rng, 0.55, 1.15);
    }
    const end = mode ? failAt : total;
    const buf = [];
    const rows = [];
    for (let h = 0; h < end; h++) {
      if (mode && h === faultStart) sim.injectFault(mode, severity, failAt - faultStart);
      buf.push(sim.step());
      if (buf.length > 168) buf.shift();
      if (h >= 168 && h % SAMPLE_EVERY === 0) {
        const htf = mode ? failAt - h : null;
        rows.push({ x: computeFeatures(buf), y: mode && htf <= HORIZON ? 1 : 0, hour: h, htf, mode });
      }
    }
    units.push({ id: `SIM-${String(++uid).padStart(3, '0')}`, mode, failAt, severity, rows });
  }
  return units;
}

function leadTimes(units, scorer, thr) {
  // Early warning = first time the score stays above threshold for two
  // consecutive samples inside the final 10 days before the trip.
  return units.filter((u) => u.mode).map((u) => {
    let run = 0;
    let first = null;
    for (const r of u.rows) {
      if (r.htf > 240) continue;
      if (scorer(r.x) >= thr) run++;
      else run = 0;
      if (run >= 2 && first === null) first = r;
    }
    return { unit: u.id, mode: u.mode, leadDays: first ? +(first.htf / 24).toFixed(1) : 0 };
  });
}

function falseAlarmRate(units, scorer, thr) {
  let episodes = 0;
  let hours = 0;
  for (const u of units.filter((x) => !x.mode)) {
    let run = 0;
    let inAlarm = false;
    for (const r of u.rows) {
      hours += SAMPLE_EVERY;
      if (scorer(r.x) >= thr) run++;
      else { run = 0; inAlarm = false; }
      if (run >= 2 && !inAlarm) { episodes++; inAlarm = true; }
    }
  }
  return (episodes / (hours / 24)) * 100;
}

const r4 = (v) => +v.toFixed(4);

// The alert threshold is a separate operating point from the F1 threshold:
// a maintenance team cares about catching failures early without being
// paged every week, so we pick the threshold that maximises early warnings
// on validation units while holding false alarms under 1 per 100 unit-days.
function tuneAlertThreshold(valUnits, scorer) {
  const cache = valUnits.map((u) => ({ ...u, rows: u.rows.map((r) => ({ ...r, s: scorer(r.x) })) }));
  const fast = (x) => x.s;
  const all = cache.flatMap((u) => u.rows.map((r) => r.s)).sort((a, b) => a - b);
  let best = null;
  for (let q = 0.5; q < 0.9995; q += 0.0025) {
    const thr = all[Math.floor(q * (all.length - 1))];
    const unitsWithS = cache.map((u) => ({ ...u, rows: u.rows.map((r) => ({ ...r, x: r })) }));
    const leads = leadTimes(unitsWithS, fast, thr);
    const rate = leads.filter((l) => l.leadDays > 0).length / leads.length;
    const lead = leads.reduce((a, l) => a + l.leadDays, 0) / leads.length;
    const fa = falseAlarmRate(unitsWithS, fast, thr);
    const ok = fa <= 1.0;
    const score = (ok ? 100 : 0) + rate * 10 + lead * 0.1;
    if (!best || score > best.score) best = { thr, score };
  }
  return best.thr;
}

export async function trainAndSave({ modelDir = DEFAULT_MODEL_DIR, log = console.log } = {}) {
  const t0 = Date.now();
  log('Simulating training fleet...');
  const units = generateDataset();
  const rng = mulberry32(99);
  const healthy = shuffle(rng, units.filter((u) => !u.mode));
  const failing = shuffle(rng, units.filter((u) => u.mode));
  const cut = (arr) => {
    const nTest = Math.round(arr.length * 0.25);
    const nVal = Math.round(arr.length * 0.15);
    return { test: arr.slice(0, nTest), val: arr.slice(nTest, nTest + nVal), train: arr.slice(nTest + nVal) };
  };
  const H = cut(healthy);
  const F = cut(failing);
  const split = { train: [...H.train, ...F.train], val: [...H.val, ...F.val], test: [...H.test, ...F.test] };
  const flat = (us) => us.flatMap((u) => u.rows);
  const trainRows = flat(split.train);
  const valRows = flat(split.val);
  const testRows = flat(split.test);
  const Xtr = trainRows.map((r) => r.x);
  const ytr = trainRows.map((r) => r.y);
  log(`  ${units.length} units, ${trainRows.length + valRows.length + testRows.length} feature rows (${trainRows.length} train)`);

  log('Training Logistic Regression...');
  const lr = new LogisticRegression().fit(Xtr.map((x) => Array.from(x)), ytr);

  log('Training Random Forest (300 trees, depth 8)...');
  const rf = new RandomForest({ nTrees: 300, maxDepth: 8, samplesPerClass: 1500, seed: 7 }).fit(Xtr, ytr, 2);

  log('Training Isolation Forest on healthy rows only...');
  const healthyRows = trainRows.filter((r) => !r.mode || r.htf > 14 * 24).map((r) => r.x);
  const iso = new IsolationForest({ nTrees: 150, sampleSize: 256 }).fit(healthyRows);

  log('Training fault-mode diagnosis forest...');
  const posRows = trainRows.filter((r) => r.y === 1);
  const diag = new RandomForest({ nTrees: 120, maxDepth: 8, samplesPerClass: 500, seed: 21 })
    .fit(posRows.map((r) => r.x), posRows.map((r) => FAULT_KEYS.indexOf(r.mode)), FAULT_KEYS.length);

  const scorers = {
    logistic: (x) => lr.predictProba(x),
    random_forest: (x) => rf.predictProba(x),
    isolation_forest: (x) => iso.score(x),
  };
  const labels = { logistic: 'Logistic Regression', random_forest: 'Random Forest', isolation_forest: 'Isolation Forest' };

  log('Tuning thresholds and evaluating on held-out units...');
  const yVal = valRows.map((r) => r.y);
  const yTest = testRows.map((r) => r.y);
  const models = {};
  for (const [key, score] of Object.entries(scorers)) {
    const thr = bestThreshold(valRows.map((r) => score(r.x)), yVal);
    const s = testRows.map((r) => score(r.x));
    const c = confusion(s, yTest, thr);
    const { auc, curve } = roc(s, yTest);
    const alertThr = tuneAlertThreshold(split.val, score);
    const leads = leadTimes(split.test, score, alertThr);
    const caught = leads.filter((l) => l.leadDays > 0);
    models[key] = {
      name: labels[key],
      threshold: r4(thr),
      alertThreshold: r4(alertThr),
      precision: r4(c.precision), recall: r4(c.recall), f1: r4(c.f1), auc: r4(auc),
      confusion: { tp: c.tp, fp: c.fp, tn: c.tn, fn: c.fn },
      roc: curve,
      leadTimes: leads,
      earlyWarningRate: r4(caught.length / leads.length),
      meanLeadDays: +(caught.reduce((a, l) => a + l.leadDays, 0) / (caught.length || 1)).toFixed(2),
      falseAlarmsPer100Days: +falseAlarmRate(split.test, score, alertThr).toFixed(2),
    };
    log(`  ${labels[key].padEnd(20)} F1 ${c.f1.toFixed(2)}  AUC ${auc.toFixed(3)}  caught ${caught.length}/${leads.length}  lead ${models[key].meanLeadDays}d`);
  }

  const testPos = testRows.filter((r) => r.y === 1);
  const diagAcc = testPos.filter((r) => {
    const p = diag.predictProba(r.x);
    return FAULT_KEYS[p.indexOf(Math.max(...p))] === r.mode;
  }).length / testPos.length;
  log(`  Diagnosis accuracy on failing rows: ${(diagAcc * 100).toFixed(1)}%`);

  const importances = FEATURE_NAMES.map((name, i) => ({ feature: name, importance: r4(rf.importances[i]) }))
    .sort((a, b) => b.importance - a.importance);

  const composition = [
    { outcome: 'healthy', label: 'Healthy', units: healthy.length },
    ...FAULT_KEYS.map((m) => ({ outcome: m, label: FAULT_MODES[m].label, units: failing.filter((u) => u.mode === m).length })),
  ];

  const rfm = models.random_forest;
  const metrics = {
    trainedAt: new Date().toISOString(),
    durationSec: +((Date.now() - t0) / 1000).toFixed(1),
    horizonHours: HORIZON,
    dataset: {
      units: units.length,
      rows: { train: trainRows.length, validation: valRows.length, test: testRows.length },
      positiveRate: r4(ytr.reduce((a, b) => a + b, 0) / ytr.length),
      testUnits: { healthy: H.test.length, failing: F.test.length },
      composition,
      daysPerUnit: 48,
      sampleEveryHours: SAMPLE_EVERY,
    },
    featureCount: FEATURE_NAMES.length,
    channels: CHANNELS,
    models,
    diagnosis: { accuracy: r4(diagAcc), classes: FAULT_KEYS },
    importances,
    impact: {
      reactive: { earlyWarningRate: 0, meanLeadDays: 0, falseAlarmsPer100Days: 0 },
      predictive: { earlyWarningRate: rfm.earlyWarningRate, meanLeadDays: rfm.meanLeadDays, falseAlarmsPer100Days: rfm.falseAlarmsPer100Days },
    },
  };

  const model = {
    version: 1,
    trainedAt: metrics.trainedAt,
    featureNames: FEATURE_NAMES,
    faultModes: FAULT_KEYS,
    thresholds: {
      logistic: models.logistic.alertThreshold,
      random_forest: rfm.alertThreshold,
      isolation_forest: models.isolation_forest.alertThreshold,
    },
    logistic: lr.toJSON(),
    randomForest: rf.toJSON(),
    isolationForest: iso.toJSON(),
    diagnosis: diag.toJSON(),
  };

  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, 'model.json'), JSON.stringify(model));
  fs.writeFileSync(path.join(modelDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  log(`Saved models to ${modelDir} in ${metrics.durationSec}s`);
  return metrics;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  trainAndSave().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
