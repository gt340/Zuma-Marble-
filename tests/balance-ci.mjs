// Phase 3 / Gate 4: balance with sample sizes and uncertainty. SIMULATED players (heuristic bots) — NOT human playtesting.
//   node tests/balance-ci.mjs [seedsPerCell=150] [pairedSeeds=400] [out=tests/balance-ci-results.json]
// 1. Full table: expert/good/casual bots x levels 1-10, win rate with Wilson 95% interval, lives lost with mean +- 1.96 SE.
// 2. Paired before/after for the late-level speed change on L7-L10 using the SAME seeds for both variants; discordant counts and exact two-sided sign test.
// 3. Integrity checks: (a) the level table is byte-identical before and after all runs (no shared mutable state leaks between variants),
//    (b) results do not depend on variant order, (c) a repeated run with the same seeds is bit-identical.
// Seeds start at 90000 (held out: earlier tuning used 1000.. and 7000.., so these seeds were never used to choose parameters).
import fs from 'node:fs';
import { Game, STEP, levelConfig, LEVEL_COUNT } from '../core.js';
import { Bot } from './bot.mjs';

const N = +process.argv[2] || 150, NP = +process.argv[3] || 400, OUT = process.argv[4] || new URL('./balance-ci-results.json', import.meta.url).pathname;
const profiles = { expert: [1, 0.30], good: [0.85, 0.7], casual: [0.55, 1.1] };
const VARIANTS = {
  BEFORE: (c, l) => { const s = { 7: 1.40, 8: 1.45, 9: 1.50, 10: 1.55 }[l]; if (s !== undefined) c.speed = s; },   // Phase 1 table (speeds 1.40/1.45/1.50/1.55)
  AFTER: () => { },                                                                                                  // as shipped in core.js (1.36/1.38/1.42/1.46)
};
const tableHash = () => JSON.stringify(Array.from({ length: LEVEL_COUNT }, (_, i) => levelConfig(i + 1)));

function run(level, [skill, rx], seed, mod) {
  const g = new Game({ seed, level, lives: 3 });
  if (g.cfg.surge) g.cfg.surge = { ...g.cfg.surge };       // never mutate the shared table row
  if (Array.isArray(g.cfg.powers)) g.cfg.powers = g.cfg.powers.slice();
  mod(g.cfg, level);
  const bot = new Bot(g, { skill, reaction: rx, seed }); let t = 0, lost = 0;
  while (g.state !== 'complete' && g.state !== 'over' && t < 900) { bot.tick(STEP); g.step(STEP); t += STEP; for (const e of g.drainEvents()) if (e.type === 'life_lost') lost++; }
  return { won: g.state === 'complete' ? 1 : 0, lost, t: +t.toFixed(3), score: g.score };
}
function wilson(k, n, z = 1.96) { const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; }
function meanSe(a) { const n = a.length, m = a.reduce((x, y) => x + y, 0) / n, v = a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, n - 1); return [m, Math.sqrt(v / n)]; }
function signTestP(b, c) {   // exact two-sided binomial test on discordant pairs (p=0.5)
  const n = b + c; if (n === 0) return 1; const k = Math.min(b, c); let s = 0, term = Math.pow(0.5, n), comb = 1;
  for (let i = 0; i <= k; i++) { if (i > 0) comb = comb * (n - i + 1) / i; s += comb * term; } return Math.min(1, 2 * s);
}
const pct = (x) => (100 * x).toFixed(0) + '%';

const h0 = tableHash(); const out = { N, NP, seedBase: 90000, table: {}, paired: {}, integrity: {} }; const lines = [];
lines.push(`SIMULATED players (heuristic bots), not humans. Full table: ${N} seeds per cell. Paired: ${NP} seeds per cell. Seeds from 90000 (held out).`);
lines.push('cell = win% [Wilson 95% CI] ; lives lost per run mean +-1.96SE');
for (const [pn, pr] of Object.entries(profiles)) {
  out.table[pn] = {};
  for (let l = 1; l <= LEVEL_COUNT; l++) {
    const rs = []; for (let s = 0; s < N; s++) rs.push(run(l, pr, 90000 + l * 1009 + s * 7, VARIANTS.AFTER));
    const w = rs.reduce((a, r) => a + r.won, 0), [lo, hi] = wilson(w, N), [m, se] = meanSe(rs.map(r => r.lost));
    out.table[pn][l] = { n: N, wins: w, win: w / N, ci: [lo, hi], livesLost: m, livesLostCI: 1.96 * se };
    lines.push(`${pn.padEnd(6)} L${String(l).padStart(2)}  n=${N}  win ${pct(w / N).padStart(4)} [${pct(lo)}-${pct(hi)}]  lives lost ${m.toFixed(2)} +-${(1.96 * se).toFixed(2)}`);
  }
}
lines.push('', `Paired BEFORE vs AFTER (late-level speed change), same ${NP} seeds per cell. b = won only AFTER, c = won only BEFORE; p = exact two-sided sign test on discordant pairs`);
const store = {};
for (const [pn, pr] of Object.entries(profiles)) for (const l of [7, 8, 9, 10]) {
  const seeds = Array.from({ length: NP }, (_, s) => 90000 + l * 1009 + 500000 + s * 7);
  const A = seeds.map(sd => run(l, pr, sd, VARIANTS.AFTER)), B = seeds.map(sd => run(l, pr, sd, VARIANTS.BEFORE));
  store[pn + l] = { A, B };
  const wa = A.reduce((a, r) => a + r.won, 0), wb = B.reduce((a, r) => a + r.won, 0);
  let b = 0, c = 0; for (let i = 0; i < NP; i++) { if (A[i].won && !B[i].won) b++; if (!A[i].won && B[i].won) c++; }
  const [la, ha] = wilson(wa, NP), [lb, hb] = wilson(wb, NP), p = signTestP(b, c);
  const dl = A.map((r, i) => r.lost - B[i].lost), [dm, dse] = meanSe(dl);
  out.paired[pn + ' L' + l] = { n: NP, before: { wins: wb, win: wb / NP, ci: [lb, hb] }, after: { wins: wa, win: wa / NP, ci: [la, ha] }, diffPP: 100 * (wa - wb) / NP, discordant: { onlyAfter: b, onlyBefore: c }, signTestP: p, livesLostDelta: dm, livesLostDeltaCI: 1.96 * dse };
  lines.push(`${pn.padEnd(6)} L${String(l).padStart(2)}  BEFORE ${pct(wb / NP).padStart(4)} [${pct(lb)}-${pct(hb)}]  AFTER ${pct(wa / NP).padStart(4)} [${pct(la)}-${pct(ha)}]  diff ${(100 * (wa - wb) / NP).toFixed(1)}pp  b=${b} c=${c} p=${p.toExponential(1)}  d(lives lost) ${dm.toFixed(2)} +-${(1.96 * dse).toFixed(2)}`);
}
// ---- integrity
const h1 = tableHash();
out.integrity.tableUnchangedAfterAllRuns = h0 === h1; lines.push('', `integrity: level table identical before/after all runs: ${h0 === h1}`);
{ // order independence + exact repeat, on the cell most sensitive to contamination (L10 casual and good)
  let ok = true; const bad = [];
  for (const pn of ['good', 'casual']) { const l = 10, pr = profiles[pn]; const M = Math.min(40, NP), seeds = Array.from({ length: M }, (_, s) => 90000 + l * 1009 + 500000 + s * 7);
    const rev = seeds.map(sd => run(l, pr, sd, VARIANTS.BEFORE)), fwd = seeds.map(sd => run(l, pr, sd, VARIANTS.AFTER)); // opposite order from above (BEFORE first)
    const A = store[pn + l].A.slice(0, M), B = store[pn + l].B.slice(0, M);
    if (JSON.stringify(A) !== JSON.stringify(fwd) || JSON.stringify(B) !== JSON.stringify(rev)) { ok = false; bad.push(pn); } }
  out.integrity.orderIndependentAndRepeatable = ok; lines.push(`integrity: BEFORE-first re-run is bit-identical to the original AFTER-first run (order independence + determinism), L10 good/casual, first ${Math.min(40, NP)} seeds: ${ok}${bad.length ? ' FAILED for ' + bad : ''}`);
}
console.log(lines.join('\n'));
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
fs.writeFileSync(OUT.replace(/\.json$/, '.txt'), lines.join('\n') + '\n');
process.exit(out.integrity.tableUnchangedAfterAllRuns && out.integrity.orderIndependentAndRepeatable ? 0 : 1);
