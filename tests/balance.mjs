// Reproducible balance measurement with SIMULATED players (heuristic bots, NOT human playtesters).
// node tests/balance.mjs [seedsPerCell=12] [json=path]
import fs from 'node:fs';
import { Game, STEP } from '../core.js';
import { Bot } from './bot.mjs';
const N = +process.argv[2] || 12;
const profiles = { expert: [1, 0.30], good: [0.85, 0.7], casual: [0.55, 1.1] };
function run(level, [skill, rx], seed) {
  const g = new Game({ seed, level, lives: 3 }); const bot = new Bot(g, { skill, reaction: rx, seed });
  let t = 0, matches = 0, cascades = 0, lost = 0, shots = 0, maxChain = 0;
  while (g.state !== 'complete' && g.state !== 'over' && t < 900) {
    bot.tick(STEP); g.step(STEP); t += STEP;
    for (const e of g.drainEvents()) { if (e.type === 'match') { matches++; if (e.cascade) cascades++; } else if (e.type === 'life_lost') lost++; else if (e.type === 'shot') shots++; }
    if (g.chain.length > maxChain) maxChain = g.chain.length;
  }
  return { won: g.state === 'complete', t, score: g.score, matches, cascades, lost, shots, maxChain };
}
const out = {};
for (const [pn, pr] of Object.entries(profiles)) {
  out[pn] = {};
  for (let lvl = 1; lvl <= 10; lvl++) {
    const rs = []; for (let s = 0; s < N; s++) rs.push(run(lvl, pr, 1000 + lvl * 97 + s * 13));
    const avg = (f) => rs.reduce((a, r) => a + f(r), 0) / N;
    out[pn][lvl] = { runs: N, completion: avg(r => +r.won), survivalSec: avg(r => r.t), score: avg(r => r.score), cascadesPerRun: avg(r => r.cascades), cascadeShare: avg(r => r.matches ? r.cascades / r.matches : 0), lifeLossPerRun: avg(r => r.lost), peakChain: avg(r => r.maxChain) };
  }
}
for (const [pn, rows] of Object.entries(out)) {
  console.log(`\n== ${pn} (${N} seeded runs per level) ==\nlvl | complete | survive(s) | score | cascades/run | cascade% of matches | lives lost/run | peak chain`);
  for (const [l, r] of Object.entries(rows)) console.log(`${l.padStart(3)} | ${(100 * r.completion).toFixed(0).padStart(7)}% | ${r.survivalSec.toFixed(0).padStart(9)} | ${r.score.toFixed(0).padStart(5)} | ${r.cascadesPerRun.toFixed(1).padStart(12)} | ${(100 * r.cascadeShare).toFixed(0).padStart(18)}% | ${r.lifeLossPerRun.toFixed(2).padStart(14)} | ${r.peakChain.toFixed(0)}`);
}
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
