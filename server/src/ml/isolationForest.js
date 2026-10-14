// Isolation Forest trained only on healthy rows. It never sees a labelled
// failure, so it is the model to rely on when failure labels are scarce.

import { mulberry32 } from './random.js';

const EULER = 0.5772156649;
const cFactor = (n) => (n > 2 ? 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n : n === 2 ? 1 : 0);
const sig = (v) => parseFloat(v.toPrecision(6));

export class IsolationForest {
  constructor(opts = {}) {
    this.nTrees = opts.nTrees ?? 150;
    this.sampleSize = opts.sampleSize ?? 256;
    this.seed = opts.seed ?? 11;
  }

  fit(X) {
    const rng = mulberry32(this.seed);
    const psi = Math.min(this.sampleSize, X.length);
    const limit = Math.ceil(Math.log2(psi));
    const d = X[0].length;
    this.psi = psi;
    this.trees = [];
    for (let t = 0; t < this.nTrees; t++) {
      const sample = Array.from({ length: psi }, () => X[Math.floor(rng() * X.length)]);
      const T = { f: [], t: [], l: [], r: [], s: [] };
      const grow = (rows, depth) => {
        const id = T.f.length;
        T.f.push(-1); T.t.push(0); T.l.push(-1); T.r.push(-1); T.s.push(rows.length);
        if (depth >= limit || rows.length <= 1) return id;
        for (let attempt = 0; attempt < 6; attempt++) {
          const f = Math.floor(rng() * d);
          let lo = Infinity, hi = -Infinity;
          for (const r of rows) { if (r[f] < lo) lo = r[f]; if (r[f] > hi) hi = r[f]; }
          if (hi - lo < 1e-12) continue;
          const thr = lo + rng() * (hi - lo);
          const L = [], R = [];
          for (const r of rows) (r[f] < thr ? L : R).push(r);
          T.f[id] = f; T.t[id] = sig(thr);
          T.l[id] = grow(L, depth + 1);
          T.r[id] = grow(R, depth + 1);
          return id;
        }
        return id;
      };
      grow(sample, 0);
      this.trees.push(T);
    }
    return this;
  }

  // Anomaly score in (0, 1). Around 0.5 is normal; closer to 1 is anomalous.
  score(x) {
    let total = 0;
    for (const T of this.trees) {
      let n = 0, depth = 0;
      while (T.f[n] !== -1) { n = x[T.f[n]] < T.t[n] ? T.l[n] : T.r[n]; depth++; }
      total += depth + cFactor(T.s[n]);
    }
    return 2 ** (-(total / this.trees.length) / cFactor(this.psi));
  }

  toJSON() {
    return { nTrees: this.nTrees, psi: this.psi, trees: this.trees };
  }

  static fromJSON(o) {
    const m = new IsolationForest({ nTrees: o.nTrees });
    m.psi = o.psi;
    m.trees = o.trees;
    return m;
  }
}
