// Difficulty calibration: node tests/calibrate.mjs [seeds]   (informational, not an assertion)
import { Game, STEP } from '../core.js';
import { Bot } from './bot.mjs';
const seeds = +process.argv[2] || 6;
function play(level, skill, reaction, seed, lives = 3) {
  const g = new Game({ seed, level, lives }); const bot = new Bot(g, { skill, reaction, seed });
  let t = 0, lost = 0, lastLives = g.lives;
  while (g.state !== 'complete' && g.state !== 'over' && t < 900) { bot.tick(STEP); g.step(STEP); t += STEP; if (g.lives < lastLives) { lost += lastLives - g.lives; lastLives = g.lives; } }
  return { won: g.state === 'complete', lost, t, stars: g.result?.stars ?? 0, score: g.result?.playScore ?? 0, combo: g.stats.maxCombo };
}
const profiles = [['expert', 1, 0.30], ['good', 0.85, 0.7], ['human', 0.55, 1.1], ['slow', 0.4, 1.5]];
console.log('level | profile : win% | avg lives lost | avg time(s) | avg stars | avg maxCombo');
for (let lvl = 1; lvl <= 10; lvl++) {
  const row = [];
  for (const [name, skill, rx] of profiles) {
    let w = 0, l = 0, t = 0, st = 0, cb = 0, sc = 0;
    for (let s = 1; s <= seeds; s++) { const r = play(lvl, skill, rx, s * 17 + lvl); w += r.won; l += r.lost; t += r.t; st += r.stars; cb += r.combo; sc += r.score; }
    row.push(`${name}: ${(100 * w / seeds).toFixed(0)}% L${(l / seeds).toFixed(1)} ${(t / seeds).toFixed(0)}s sc${(sc / seeds).toFixed(0)}`);
  }
  console.log(String(lvl).padStart(2), '|', row.join(' | '));
}
