// How often does the aim guide's predicted insertion slot differ from where the shot really lands (chain moves during flight)?
// node tests/aimguide.mjs [shotsPerLevel=150]
import { Game, STEP, mulberry32 } from '../core.js';
const N = +process.argv[2] || 150;
export function measure(level, n, seed = 7, opts = {}) {
  const g = new Game({ seed, level, lives: 3 }); const rng = mulberry32(seed * 3 + 1);
  let total = 0, exact = 0, off1 = 0, offMore = 0, skipped = 0, t = 0, since = 0, pending = null, dirty = false;
  while (total < n && g.state !== 'over' && g.state !== 'complete' && t < 1500) {
    g.step(STEP); t += STEP; since += STEP;
    for (const e of g.drainEvents()) {
      if (!pending) continue;
      if (e.type === 'insert') {
        const nb = g.chain.findIndex(b => b.id === e.id), tgt = g.chain.findIndex(b => b.id === pending.ballId);
        if (!dirty && nb >= 0 && tgt >= 0) { const want = pending.side === 'ahead' ? tgt + 1 : tgt - 1; const d = Math.abs(nb - want); total++; if (d === 0) exact++; else if (d === 1) off1++; else offMore++; } else skipped++;
        pending = null;
      } else if (['match', 'bomb', 'rainbow', 'retreat', 'devour', 'life_lost'].includes(e.type)) dirty = true;   // chain re-indexed by something else: sample invalid
    }
    if (g.state === 'playing' && !pending && since > 0.6 && g.chain.length > 4 && !g.rolling) {
      const cand = g.chain.map((b, i) => i).filter(i => g.chain[i].s > 3);
      if (!cand.length) continue;
      const i = cand[Math.floor(rng() * cand.length)], p = g.path.pos(g.chain[i].s, {}), pr = g.predict(p.x, p.z, opts.lead !== false);
      if (!pr.hit) continue;
      pending = pr; dirty = false; since = 0; g.fire(p.x, p.z);
    }
  }
  return { total, skipped, exactPct: 100 * exact / (total || 1), off1Pct: 100 * off1 / (total || 1), offMorePct: 100 * offMore / (total || 1) };
}
if (process.argv[1] && process.argv[1].endsWith('aimguide.mjs')) for (const lead of [false, true]) for (const lvl of [1, 4, 7, 10]) { const r = measure(lvl, N, 7, { lead }); console.log(`${lead ? 'with lead   ' : 'static chain'} L${lvl}: n=${r.total} (skipped ${r.skipped}) exact ${r.exactPct.toFixed(0)}%  off-by-1 ${r.off1Pct.toFixed(0)}%  off-by->1 ${r.offMorePct.toFixed(0)}%`); }
