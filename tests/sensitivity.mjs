// What drives late-level difficulty? Mutates one level parameter at a time (simulated casual/good players).
// node tests/sensitivity.mjs [seeds=16] [levels=7,8,10]
import { Game, STEP } from '../core.js';
import { Bot } from './bot.mjs';
const N = +process.argv[2] || 16, levels = (process.argv[3] || '7,8,10').split(',').map(Number);
const profiles = { casual: [0.55, 1.1], good: [0.85, 0.7] };
const variants = {
  base: c => c,
  'speed x0.90': c => { c.speed *= 0.9; },
  'speed x0.80': c => { c.speed *= 0.8; },
  'no surge': c => { c.surge = null; },
  'surge x1.4 (was higher)': c => { if (c.surge) c.surge.mult = Math.min(c.surge.mult, 1.4); },
  'one colour less': c => { c.colors -= 1; },
  'power chance x1.6': c => { c.powerP *= 1.6; },
};
function run(level, [skill, rx], seed, mod) {
  const g = new Game({ seed, level, lives: 3 }); if (g.cfg.surge) g.cfg.surge = { ...g.cfg.surge }; mod(g.cfg); const bot = new Bot(g, { skill, reaction: rx, seed }); let t = 0, lost = 0;
  while (g.state !== 'complete' && g.state !== 'over' && t < 900) { bot.tick(STEP); g.step(STEP); t += STEP; for (const e of g.drainEvents()) if (e.type === 'life_lost') lost++; }
  return { won: g.state === 'complete', lost };
}
for (const [pn, pr] of Object.entries(profiles)) for (const lvl of levels) {
  const row = []; for (const [vn, mod] of Object.entries(variants)) { let w = 0, l = 0; for (let s = 0; s < N; s++) { const r = run(lvl, pr, 5000 + lvl * 31 + s * 7, mod); w += r.won; l += r.lost; } row.push(`${vn}: ${(100 * w / N).toFixed(0)}%/L${(l / N).toFixed(1)}`); }
  console.log(`${pn} L${lvl} | ${row.join(' | ')}`);
}
