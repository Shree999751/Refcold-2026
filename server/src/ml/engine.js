// Loads the trained artefacts and runs all four models on a feature vector.

import fs from 'node:fs';
import path from 'node:path';
import { RandomForest } from './forest.js';
import { LogisticRegression } from './logistic.js';
import { IsolationForest } from './isolationForest.js';
import { FEATURE_NAMES } from './features.js';

export function loadEngine(modelDir) {
  const modelPath = path.join(modelDir, 'model.json');
  const metricsPath = path.join(modelDir, 'metrics.json');
  if (!fs.existsSync(modelPath) || !fs.existsSync(metricsPath)) return null;
  const raw = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  const rf = RandomForest.fromJSON(raw.randomForest);
  const lr = LogisticRegression.fromJSON(raw.logistic);
  const iso = IsolationForest.fromJSON(raw.isolationForest);
  const diag = RandomForest.fromJSON(raw.diagnosis);

  return {
    trainedAt: raw.trainedAt,
    thresholds: raw.thresholds,
    faultModes: raw.faultModes,
    metrics,
    predict(x) {
      const probs = diag.predictProba(x);
      const top = probs.indexOf(Math.max(...probs));
      return {
        rf: rf.predictProba(x),
        lr: lr.predictProba(x),
        iso: iso.score(x),
        diagnosis: { mode: raw.faultModes[top], confidence: probs[top], distribution: probs },
      };
    },
    explain(x, top = 10) {
      const { bias, contributions } = rf.explain(x);
      const items = contributions.map((c, i) => ({ feature: FEATURE_NAMES[i], contribution: c, value: x[i] }))
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, top)
        .map((d) => ({ ...d, contribution: +d.contribution.toFixed(4), value: +d.value.toFixed(4) }));
      return { bias: +bias.toFixed(4), items };
    },
  };
}
