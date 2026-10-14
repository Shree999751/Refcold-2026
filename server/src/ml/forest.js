// Random Forest classifier written from scratch (no Python needed).
// Histogram-binned CART trees, class-balanced bootstrap subsampling,
// Gini importances, and per-prediction feature contributions (Saabas method)
// so every alert can explain which sensor trends pushed the risk up.

import { mulberry32 } from './random.js';

const sig = (v) => (Number.isFinite(v) ? parseFloat(v.toPrecision(6)) : 0);

class Binner {
  constructor(nBins = 32) {
    this.nBins = nBins;
    this.edges = [];
  }
  fit(X) {
    const nF = X[0].length;
    const step = Math.max(1, Math.floor(X.length / 8000));
    this.edges = [];
    for (let f = 0; f < nF; f++) {
      const vals = [];
      for (let i = 0; i < X.length; i += step) vals.push(X[i][f]);
      vals.sort((a, b) => a - b);
      const e = [];
      for (let b = 1; b < this.nBins; b++) {
        const v = vals[Math.min(vals.length - 1, Math.floor((b * vals.length) / this.nBins))];
        if (!e.length || v > e[e.length - 1]) e.push(v);
      }
      this.edges.push(e);
    }
    return this;
  }
  transform(X) {
    const nF = this.edges.length;
    const out = new Uint8Array(X.length * nF);
    for (let i = 0; i < X.length; i++) {
      for (let f = 0; f < nF; f++) {
        const edges = this.edges[f];
        const v = X[i][f];
        let lo = 0;
        let hi = edges.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (v <= edges[mid]) hi = mid;
          else lo = mid + 1;
        }
        out[i * nF + f] = lo;
      }
    }
    return out;
  }
}

function pickFeatures(nF, m, rng) {
  const all = Array.from({ length: nF }, (_, i) => i);
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(rng() * (nF - i));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, m);
}

function buildTree(ctx, rootIdx) {
  const { Xb, y, nF, k, maxDepth, minLeaf, mtry, rng, edges, importance } = ctx;
  const T = { f: [], t: [], l: [], r: [], v: [] };

  const grow = (idx, depth) => {
    const id = T.f.length;
    T.f.push(-1);
    T.t.push(0);
    T.l.push(-1);
    T.r.push(-1);
    const n = idx.length;
    const counts = new Float64Array(k);
    for (let q = 0; q < n; q++) counts[y[idx[q]]]++;
    if (k === 2) T.v.push(sig(counts[1] / n));
    else for (let c = 0; c < k; c++) T.v.push(sig(counts[c] / n));

    let impurity = 1;
    for (let c = 0; c < k; c++) impurity -= (counts[c] / n) ** 2;
    if (depth >= maxDepth || n < 2 * minLeaf || impurity < 1e-9) return id;

    let bestGain = 1e-7;
    let bestF = -1;
    let bestB = -1;
    const left = new Float64Array(k);
    for (const f of pickFeatures(nF, mtry, rng)) {
      const ne = edges[f].length;
      if (ne === 0) continue;
      const hist = new Float64Array((ne + 1) * k);
      for (let q = 0; q < n; q++) {
        const i = idx[q];
        hist[Xb[i * nF + f] * k + y[i]]++;
      }
      left.fill(0);
      let nl = 0;
      for (let b = 0; b < ne; b++) {
        for (let c = 0; c < k; c++) {
          left[c] += hist[b * k + c];
          nl += hist[b * k + c];
        }
        const nr = n - nl;
        if (nl < minLeaf) continue;
        if (nr < minLeaf) break;
        let gl = 1;
        let gr = 1;
        for (let c = 0; c < k; c++) {
          gl -= (left[c] / nl) ** 2;
          gr -= ((counts[c] - left[c]) / nr) ** 2;
        }
        const gain = impurity - (nl * gl + nr * gr) / n;
        if (gain > bestGain) {
          bestGain = gain;
          bestF = f;
          bestB = b;
        }
      }
    }
    if (bestF < 0) return id;

    importance[bestF] += bestGain * n;
    const L = [];
    const R = [];
    for (let q = 0; q < n; q++) {
      const i = idx[q];
      (Xb[i * nF + bestF] <= bestB ? L : R).push(i);
    }
    T.f[id] = bestF;
    T.t[id] = sig(edges[bestF][bestB]);
    T.l[id] = grow(L, depth + 1);
    T.r[id] = grow(R, depth + 1);
    return id;
  };

  grow(rootIdx, 0);
  return T;
}

export class RandomForest {
  constructor(opts = {}) {
    this.nTrees = opts.nTrees ?? 300;
    this.maxDepth = opts.maxDepth ?? 8;
    this.minLeaf = opts.minLeaf ?? 5;
    this.samplesPerClass = opts.samplesPerClass ?? 1500;
    this.nBins = opts.nBins ?? 32;
    this.seed = opts.seed ?? 7;
    this.trees = [];
    this.nClasses = 2;
    this.importances = [];
  }

  fit(X, y, nClasses = 2) {
    this.nClasses = nClasses;
    const nF = X[0].length;
    const rng = mulberry32(this.seed);
    const binner = new Binner(this.nBins).fit(X);
    const Xb = binner.transform(X);
    const byClass = Array.from({ length: nClasses }, () => []);
    y.forEach((c, i) => byClass[c].push(i));
    const importance = new Float64Array(nF);
    const ctx = {
      Xb, y, nF, k: nClasses, maxDepth: this.maxDepth, minLeaf: this.minLeaf,
      mtry: Math.max(1, Math.round(Math.sqrt(nF))), rng, edges: binner.edges, importance,
    };
    this.trees = [];
    for (let t = 0; t < this.nTrees; t++) {
      // Class-balanced bootstrap: every tree sees the same number of rows per class.
      const idx = [];
      for (const group of byClass) {
        if (!group.length) continue;
        for (let s = 0; s < this.samplesPerClass; s++) idx.push(group[Math.floor(rng() * group.length)]);
      }
      this.trees.push(buildTree(ctx, idx));
    }
    const total = importance.reduce((a, b) => a + b, 0) || 1;
    this.importances = Array.from(importance, (v) => v / total);
    return this;
  }

  leaf(tree, x) {
    let n = 0;
    while (tree.f[n] !== -1) n = x[tree.f[n]] <= tree.t[n] ? tree.l[n] : tree.r[n];
    return n;
  }

  // Binary: probability of class 1. Multiclass: probability array.
  predictProba(x) {
    if (this.nClasses === 2) {
      let s = 0;
      for (const tree of this.trees) s += tree.v[this.leaf(tree, x)];
      return s / this.trees.length;
    }
    const k = this.nClasses;
    const out = new Array(k).fill(0);
    for (const tree of this.trees) {
      const n = this.leaf(tree, x);
      for (let c = 0; c < k; c++) out[c] += tree.v[n * k + c];
    }
    return out.map((v) => v / this.trees.length);
  }

  // Saabas decomposition: risk = bias + sum(contributions).
  explain(x) {
    const contrib = new Float64Array(x.length);
    let bias = 0;
    for (const tree of this.trees) {
      let n = 0;
      bias += tree.v[0];
      while (tree.f[n] !== -1) {
        const next = x[tree.f[n]] <= tree.t[n] ? tree.l[n] : tree.r[n];
        contrib[tree.f[n]] += tree.v[next] - tree.v[n];
        n = next;
      }
    }
    const m = this.trees.length;
    return { bias: bias / m, contributions: Array.from(contrib, (v) => v / m) };
  }

  toJSON() {
    return {
      nClasses: this.nClasses,
      params: { nTrees: this.nTrees, maxDepth: this.maxDepth, minLeaf: this.minLeaf, samplesPerClass: this.samplesPerClass },
      importances: this.importances.map(sig),
      trees: this.trees,
    };
  }

  static fromJSON(obj) {
    const rf = new RandomForest(obj.params);
    rf.nClasses = obj.nClasses;
    rf.importances = obj.importances;
    rf.trees = obj.trees;
    return rf;
  }
}
