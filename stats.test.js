// Self-check of stats.js against textbook values. Run: node stats.test.js
const S = require("./stats.js");
const near = (a, b, tol, what) => { if (Math.abs(a - b) > tol) throw new Error(`${what}: got ${a}, expected ${b}`); };

// Student t: two-sided p and critical values from standard tables
near(S.tP(2.228, 10), 0.05, 2e-4, "t p, df=10");
near(S.tP(2.086, 20), 0.05, 2e-4, "t p, df=20");
near(S.tCrit(0.05, 44), 2.0154, 1e-3, "t crit, df=44");
near(S.normCdf(1.96), 0.975, 1e-4, "normal cdf");

// OLS on a small hand-checked example: y = [2,3,5,4,6] -> slope 0.9, intercept 1.3, SSE 1.9
const o = S.ols([1, 2, 3, 4, 5], [2, 3, 5, 4, 6]);
near(o.slope, 0.9, 1e-12, "ols slope"); near(o.icpt, 1.3, 1e-12, "ols intercept");
near(o.se, Math.sqrt(1.9 / 3 / 10), 1e-12, "ols se");

// Mann-Kendall on 1..10: S = 45, var = 125, Z = 44/sqrt(125) = 3.9355, p ~ 8.3e-5
const mk = S.mannKendall([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
near(mk.s, 45, 0, "MK S"); near(mk.z, 44 / Math.sqrt(125), 1e-9, "MK Z"); near(mk.p, 8.3e-5, 1e-5, "MK p");
// with ties: [1,1,2,3] -> S = 5, var = (4*3*13 - 2*1*9)/18 = 7.6667
const mk2 = S.mannKendall([1, 1, 2, 3]); near(mk2.s, 5, 0, "MK ties S"); near(mk2.z, 4 / Math.sqrt(138 / 18), 1e-9, "MK ties Z");
// no trend -> S = 0, p = 1
near(S.mannKendall([3, 1, 2, 2, 1, 3]).p, 1, 1e-6, "MK no trend");

// Sen's slope: median of pairwise slopes; robust to one outlier
near(S.sen([1, 2, 3, 4, 5], [1, 2, 3, 4, 100]), 1, 1e-12, "Sen outlier");

// analyse skips missing values
const a = S.analyse([2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009], [1, null, 3, 4, 5, 6, 7, 8, 9, 10]);
near(a.n, 9, 0, "analyse n"); near(a.ols.slope, 1, 1e-12, "analyse slope");
near(a.sen, 1, 1e-12, "analyse Sen"); near(a.senIcpt, -1999, 1e-9, "analyse Sen intercept");
console.log("stats.js: all checks passed");
