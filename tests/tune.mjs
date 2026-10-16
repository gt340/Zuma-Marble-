// Paired-seed comparison of candidate late-level adjustments (SIMULATED players). node tests/tune.mjs [seeds=24] [levels=7,8,9,10]
// Candidates mutate the level config after construction; the same seeds are used for every candidate, so differences are paired.
import { Game, STEP } from '../core.js';
import { Bot } from './bot.mjs';
const N = +process.argv[2] || 24, levels = (process.argv[3] || '7,8,9,10').split(',').map(Number);
const profiles = { good: [0.85, 0.7], casual: [0.55, 1.1] };
const cand = {
  'BEFORE (L7-10 speed 1.40/1.45/1.50/1.55)': (c, l) => { c.speed = { 7: 1.40, 8: 1.45, 9: 1.50, 10: 1.55 }[l] ?? c.speed; },
  'AFTER  (core.js as shipped: 1.36/1.38/1.42/1.46)': () => { },
};
function run(level, [skill, rx], seed, mod) {
  const g = new Game({ seed, level, lives: 3 }); if (g.cfg.surge) g.cfg.surge = { ...g.cfg.surge }; mod(g.cfg, level); const bot = new Bot(g, { skill, reaction: rx, seed }); let t = 0, lost = 0;
  while (g.state !== 'complete' && g.state !== 'over' && t < 900) { bot.tick(STEP); g.step(STEP); t += STEP; for (const e of g.drainEvents()) if (e.type === 'life_lost') lost++; }
  return { won: g.state === 'complete', lost };
}
console.log(`simulated players, ${N} paired seeds per cell. cell = win% / lives lost per run`);
console.log('profile | candidate | ' + levels.map(l => 'L' + l).join(' | '));
for (const [pn, pr] of Object.entries(profiles)) for (const [cn, mod] of Object.entries(cand)) {
  const row = levels.map(l => { let w = 0, lo = 0; for (let s = 0; s < N; s++) { const r = run(l, pr, 7000 + l * 53 + s * 11, mod); w += r.won; lo += r.lost; } return `${(100 * w / N).toFixed(0)}%/${(lo / N).toFixed(1)}`; });
  console.log(`${pn} | ${cn} | ${row.join(' | ')}`);
}
