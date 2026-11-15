/* Trend statistics for a yearly time series: linear regression (slope, t-test, 95% CI),
   Mann-Kendall test and Sen's slope. No dependencies; checked by stats.test.js (node stats.test.js). */
(function (root) {
"use strict";

// log-gamma (Lanczos) and the regularized incomplete beta function (continued fraction, Numerical Recipes)
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}
function ibeta(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
// two-sided p-value of Student's t with df degrees of freedom
const tP = (t, df) => ibeta(df / 2, 0.5, df / (df + t * t));
// t value with two-sided probability p (bisection; fine for p in (1e-6, 1))
function tCrit(p, df) { let lo = 0, hi = 100; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (tP(mid, df) > p) lo = mid; else hi = mid; } return (lo + hi) / 2; }
// standard normal CDF (Abramowitz-Stegun 7.1.26 erf, |error| < 1.5e-7)
function normCdf(z) {
  const s = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * erf);
}

function ols(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const slope = sxy / sxx, icpt = my - slope * mx;
  let sse = 0; for (let i = 0; i < n; i++) sse += (y[i] - icpt - slope * x[i]) ** 2;
  const df = n - 2, se = Math.sqrt(sse / df / sxx), t = se > 0 ? slope / se : Infinity, tc = tCrit(0.05, df);
  return { slope, icpt, se, t, df, p: se > 0 ? tP(Math.abs(t), df) : 0, ci: [slope - tc * se, slope + tc * se] };
}

function mannKendall(y) {
  const n = y.length; let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(y[j] - y[i]);
  const ties = {}; y.forEach(v => ties[v] = (ties[v] || 0) + 1);
  let tie = 0; for (const k in ties) { const t = ties[k]; tie += t * (t - 1) * (2 * t + 5); }
  const v = (n * (n - 1) * (2 * n + 5) - tie) / 18, z = s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0;
  return { s, z, p: 2 * (1 - normCdf(Math.abs(z))) };
}

function sen(x, y) {
  const d = []; for (let i = 0; i < x.length - 1; i++) for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) d.push((y[j] - y[i]) / (x[j] - x[i]));
  d.sort((a, b) => a - b); const m = d.length >> 1;
  return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
}

// everything the page needs for one series; null years are skipped
function analyse(years, values) {
  const x = [], y = []; years.forEach((yr, i) => { if (values[i] != null && isFinite(values[i])) { x.push(yr); y.push(values[i]); } });
  if (x.length < 8) return null;
  const sl = sen(x, y), r = x.map((xi, i) => y[i] - sl * xi).sort((a, b) => a - b), h = r.length >> 1;
  return { n: x.length, x, y, ols: ols(x, y), mk: mannKendall(y), sen: sl, senIcpt: r.length % 2 ? r[h] : (r[h - 1] + r[h]) / 2 };
}

const api = { ols, mannKendall, sen, analyse, tP, tCrit, normCdf };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.STATS = api;
})(typeof window !== "undefined" ? window : this);
