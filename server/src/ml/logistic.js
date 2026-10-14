// Class-balanced, L2-regularised logistic regression on standardised features.
// This is the poster's baseline: it sets the floor a simple model can reach.

const sig = (v) => parseFloat(v.toPrecision(6));
const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));

export class LogisticRegression {
  constructor(opts = {}) {
    this.epochs = opts.epochs ?? 400;
    this.lr = opts.lr ?? 0.3;
    this.l2 = opts.l2 ?? 1e-3;
  }

  fit(X, y) {
    const n = X.length;
    const d = X[0].length;
    this.mu = new Array(d).fill(0);
    this.sd = new Array(d).fill(0);
    for (const x of X) for (let j = 0; j < d; j++) this.mu[j] += x[j] / n;
    for (const x of X) for (let j = 0; j < d; j++) this.sd[j] += (x[j] - this.mu[j]) ** 2 / n;
    this.sd = this.sd.map((v) => Math.sqrt(v) || 1);
    const Z = X.map((x) => x.map((v, j) => (v - this.mu[j]) / this.sd[j]));

    const pos = y.reduce((a, b) => a + b, 0);
    const wPos = n / (2 * pos);
    const wNeg = n / (2 * (n - pos));
    this.w = new Array(d).fill(0);
    this.b = 0;
    // Adam optimiser, full batch.
    const m = new Array(d + 1).fill(0);
    const v = new Array(d + 1).fill(0);
    const b1 = 0.9, b2 = 0.999;
    for (let e = 1; e <= this.epochs; e++) {
      const g = new Array(d + 1).fill(0);
      let wsum = 0;
      for (let i = 0; i < n; i++) {
        const z = Z[i];
        let s = this.b;
        for (let j = 0; j < d; j++) s += this.w[j] * z[j];
        const wi = y[i] ? wPos : wNeg;
        const err = (sigmoid(s) - y[i]) * wi;
        wsum += wi;
        for (let j = 0; j < d; j++) g[j] += err * z[j];
        g[d] += err;
      }
      for (let j = 0; j <= d; j++) {
        let gj = g[j] / wsum;
        if (j < d) gj += this.l2 * this.w[j];
        m[j] = b1 * m[j] + (1 - b1) * gj;
        v[j] = b2 * v[j] + (1 - b2) * gj * gj;
        const step = (this.lr * 0.1 * (m[j] / (1 - b1 ** e))) / (Math.sqrt(v[j] / (1 - b2 ** e)) + 1e-8);
        if (j < d) this.w[j] -= step;
        else this.b -= step;
      }
    }
    return this;
  }

  predictProba(x) {
    let s = this.b;
    for (let j = 0; j < this.w.length; j++) s += (this.w[j] * (x[j] - this.mu[j])) / this.sd[j];
    return sigmoid(s);
  }

  toJSON() {
    return { w: this.w.map(sig), b: sig(this.b), mu: this.mu.map(sig), sd: this.sd.map(sig) };
  }

  static fromJSON(o) {
    const m = new LogisticRegression();
    Object.assign(m, o);
    return m;
  }
}
