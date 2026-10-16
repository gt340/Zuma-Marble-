// Phase 4 / Gate 3: before/after table for the adaptive-quality policy on SYNTHETIC frame-time profiles (model, not device data).
//   node tests/quality-compare.mjs  -> tests/evidence-phase4/quality-compare.txt
// "old" = the Phase 3 policy re-implemented exactly (45-frame mean > 28 ms => one step, max 6 steps, never recovers; ladder = same rungs).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { AdaptiveQuality } from '../quality.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VS = 1000 / 60, LEVELS = 5;                       // ladder of 5 rungs (DPR-3 phone): 0 = full ... 4 = 0.75x no glow
function rnd(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const profiles = {
  'fast 60 Hz (16.7 ms)':                       { s: 600, c: () => VS },
  'fast 120 Hz (8.3 ms)':                       { s: 600, c: () => VS / 2 },
  'STABLE 30 fps CAP (33.3 ms at every rung)':  { s: 600, c: () => 1000 / 30 },
  'overloaded, cost falls 22 %/rung (70 ms)':   { s: 600, c: (l) => 70 * Math.pow(0.78, l) },
  'vsync-quantised overload (36 ms @60 Hz)':    { s: 600, c: (l) => Math.ceil(36 * Math.pow(0.85, l) / VS - 1e-9) * VS },
  'transient: 6 s hitchy burst (45 ms) then 16.7 ms': { s: 600, c: (l, t) => t < 6 ? 45 : VS },
  'thermal: 16.7 ms, 60-180 s heavy (40 ms @rung0, -22 %/rung), then 16.7': { s: 600, c: (l, t) => t > 60 && t < 180 ? 40 * Math.pow(0.78, l) : VS },
  'unstable: 3 s smooth / 1 s heavy (45 ms), repeating': { s: 600, c: (l, t) => (t % 4 < 3 ? VS : 45 * Math.pow(0.78, l)) },
};
function simOld(p, seed) { const r = rnd(seed); let t = 0, lvl = 0, acc = 0, n = 0, changes = 0, below = 0, last = 0, ups = 0; const lowT = []; 
  while (t < p.s * 1000) { const ms = Math.max(1, p.c(lvl, t / 1000) + (r() - .5)); t += ms; acc += ms; n++; if (lvl > 0) below += ms;
    if (n >= 45) { const avg = acc / n; acc = 0; n = 0; if (avg > 28 && changes < 6 && lvl < LEVELS - 1) { lvl++; changes++; } } }
  return { final: lvl, changes, belowPct: 100 * below / (p.s * 1000), reverts: 0, ups }; }
function simNew(p, seed) { const r = rnd(seed), aq = new AdaptiveQuality(LEVELS); let t = 0, below = 0, ups = 0;
  while (t < p.s * 1000) { const ms = Math.max(1, p.c(aq.level, t / 1000) + (r() - .5)); t += ms; if (aq.level > 0) below += ms; const x = aq.sample(ms, true); if (x && x.action === 'up') ups++; }
  return { final: aq.level, changes: aq.state.changes, belowPct: 100 * below / (p.s * 1000), reverts: aq.state.reverts, ups }; }
const lines = ['profile | policy | final rung | level changes | reverts | upgrades | % of 10 min below full quality', '--- | --- | --- | --- | --- | --- | ---'];
for (const [name, p] of Object.entries(profiles)) for (const [pol, f] of [['old (Phase 3)', simOld], ['new (Phase 4)', simNew]]) { const o = f(p, 7); lines.push(`${name} | ${pol} | ${o.final} | ${o.changes} | ${o.reverts} | ${o.ups} | ${o.belowPct.toFixed(1)}%`); }
console.log(lines.join('\n'));
fs.mkdirSync(path.join(ROOT, 'tests', 'evidence-phase4'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tests', 'evidence-phase4', 'quality-compare.txt'), '# SYNTHETIC frame-time profiles, 10 simulated minutes each, 5-rung ladder. A model of the policies, not measurements of any device.\n' + lines.join('\n') + '\n');
