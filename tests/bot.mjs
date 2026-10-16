// Heuristic player used for tests and difficulty calibration. Uses only the public Game API.
import { mulberry32, D } from '../core.js';

export class Bot {
  /** skill 0..1 controls aim noise and decision quality; reaction = seconds between decisions. */
  constructor(game, { skill = 1, reaction = 0.4, seed = 1 } = {}) {
    this.g = game; this.skill = skill; this.reaction = reaction; this.cd = reaction; this.rng = mulberry32(seed);
  }
  tick(dt) {
    const g = this.g;
    if (g.state === 'complete' || g.state === 'over' || g.paused) return;
    this.cd -= dt; if (this.cd > 0) return;
    this.cd = this.reaction * (0.8 + 0.4 * this.rng());
    if (g.state !== 'playing' || !g.chain.length) return;
    if (g.danger > 0.7 && g.charges.slow > 0 && g.slowT <= 0) g.usePower('slow');
    if (g.danger > 0.85 && g.charges.reverse > 0) g.usePower('reverse');
    const choice = this.choose();
    if (!choice) return;
    if (choice.swap) g.swap();
    if (choice.arm) g.usePower(choice.arm);
    const aim = g.path.pos(g.chain[choice.idx].s, {});
    // aim noise grows as skill drops
    const noise = (1 - this.skill) * 0.9 * (this.rng() - 0.5) * 2;
    const tg = g.path.tan(g.chain[choice.idx].s, {});
    const ax = aim.x + tg.x * noise, az = aim.z + tg.z * noise;
    g.fire(ax, az);
  }
  choose() {
    const g = this.g, c = g.chain;
    let best = null;
    const colors = [g.cur.color, g.next.color];
    for (let k = 0; k < 2; k++) {
      const col = colors[k];
      for (let i = 0; i < c.length; i++) {
        if (c[i].s < 1) continue;
        // can this marble actually be hit first from the frog? use the game's own prediction
        const p = g.path.pos(c[i].s, {}); const pr = g.predict(p.x, p.z, false);
        if (!pr.hit || pr.index !== i) continue;
        // value: size of group created by inserting `col` next to marble i on the predicted side
        let run = 0;
        if (c[i].color === col) {
          run = 2;
          for (let j = i - 1; j >= 0 && c[j].color === col && c[j + 1].s - c[j].s <= D + 1e-5; j--) run++;
          for (let j = i + 1; j < c.length && c[j].color === col && c[j].s - c[j - 1].s <= D + 1e-5; j++) run++;
        }
        const nearHead = c[i].s / g.path.L;
        let val;
        if (run >= 3) val = 10 * run + 5 * nearHead;                       // makes a match: always best
        else if (c[i].color === col) val = 1 + nearHead;                    // builds a pair next to the danger end
        else val = this.skill > 0.5 ? -1 - nearHead : -0.2 * nearHead;     // no match: dump it on the tail, away from the hole
        if (k === 1) val -= 0.5;                       // swapping has a cost
        if (!best || val > best.val) best = { val, idx: i, swap: k === 1 };
      }
    }
    if (best && g.charges.bomb > 0 && g.danger > 0.5) { best.arm = 'bomb'; }
    return best;
  }
}
