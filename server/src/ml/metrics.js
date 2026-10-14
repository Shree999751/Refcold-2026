// Evaluation utilities: ROC/AUC, precision/recall/F1 and threshold tuning.

export function confusion(scores, labels, thr) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const p = scores[i] >= thr;
    if (p && labels[i]) tp++;
    else if (p) fp++;
    else if (labels[i]) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, tn, fn, precision, recall, f1 };
}

export function bestThreshold(scores, labels) {
  const sorted = Array.from(scores).sort((a, b) => a - b);
  let best = { thr: 0.5, f1: -1 };
  for (let q = 1; q < 400; q++) {
    const thr = sorted[Math.floor((q / 400) * (sorted.length - 1))];
    const { f1 } = confusion(scores, labels, thr);
    if (f1 > best.f1) best = { thr, f1 };
  }
  return best.thr;
}

export function roc(scores, labels, maxPoints = 90) {
  const idx = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
  const P = labels.reduce((a, b) => a + b, 0);
  const N = labels.length - P;
  let tp = 0, fp = 0, auc = 0, prevFpr = 0, prevTpr = 0;
  const pts = [{ fpr: 0, tpr: 0 }];
  for (let q = 0; q < idx.length; q++) {
    if (labels[idx[q]]) tp++;
    else fp++;
    const last = q === idx.length - 1 || scores[idx[q + 1]] !== scores[idx[q]];
    if (!last) continue;
    const fpr = fp / N;
    const tpr = tp / P;
    auc += ((fpr - prevFpr) * (tpr + prevTpr)) / 2;
    prevFpr = fpr;
    prevTpr = tpr;
    pts.push({ fpr, tpr });
  }
  const step = Math.max(1, Math.floor(pts.length / maxPoints));
  const curve = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map((p) => ({ fpr: +p.fpr.toFixed(4), tpr: +p.tpr.toFixed(4) }));
  return { auc, curve };
}
