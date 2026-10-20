// storage.js — persistent settings/progress. Every access is wrapped: private mode / blocked storage must never break the game.
const KEY = 'zuma3d.v2';
export const DEFAULTS = () => ({
  sfx: true, volume: 0.8, haptics: true, guide: true, marks: true,   // marks: non-colour shape on every marble (accessibility), on by default
  bestCampaign: 0, bestEndless: 0, bestWave: 0, bestCombo: 0,
  unlocked: 1,                 // highest campaign level the player may start
  stars: {},                   // level -> best stars (1..3)
});
const ls = () => { try { return globalThis.localStorage; } catch { return null; } };
export function loadSave(storage) {
  const d = DEFAULTS();
  try {
    storage = storage === undefined ? ls() : storage;
    const raw = storage && storage.getItem(KEY);
    if (!raw) return d;
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return d;
    const out = { ...d };
    for (const k of Object.keys(d)) if (typeof j[k] === typeof d[k] && j[k] !== null) out[k] = j[k];
    out.volume = Math.min(1, Math.max(0, out.volume));
    const stars = out.stars && typeof out.stars === 'object' && !Array.isArray(out.stars) ? out.stars : {};
    out.stars = stars;
    const completed = Object.keys(stars).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 30 && Number(stars[n]) > 0);
    // Migrate progress from the original 10-level campaign: a saved clear of level 10 unlocks the new level 11.
    out.unlocked = Math.min(30, Math.max(1, Math.floor(out.unlocked), ...completed.map(n => n + 1)));
    return out;
  } catch { return d; }
}
export function saveSave(data, storage) {
  try { storage = storage === undefined ? ls() : storage; storage && storage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}
export function resetSave(storage) {
  try { storage = storage === undefined ? ls() : storage; storage && storage.removeItem(KEY); } catch { /* ignore */ }
  return DEFAULTS();
}
