// Phase 4 / Gate 2 unit tests for the marble marks (pure drawing code; the real-pixel visibility test is tests/marks.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MARK_NAMES, drawMark, markURL } from '../render.js';
import { DEFAULTS } from '../storage.js';
import { COLOR_HEX } from '../render.js';

function record(ci, size = 64) {
  const calls = [], coords = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (...a) => { calls.push(k + '(' + a.map(v => typeof v === 'number' ? +v.toFixed(2) : v).join(',') + ')'); for (const v of a) if (typeof v === 'number') coords.push(v); },
    set: (_, k, v) => { calls.push(k + '=' + v); return true; },
  });
  drawMark(ctx, ci, size);
  return { calls, sig: calls.join('|'), coords };
}

test('one mark per marble colour, names match the palette size', () => {
  assert.equal(MARK_NAMES.length, COLOR_HEX.length);
  assert.equal(new Set(MARK_NAMES).size, MARK_NAMES.length);
});
test('every colour index draws, and no two marks are drawn by the same instructions', () => {
  const sigs = MARK_NAMES.map((_, i) => record(i).sig);
  for (const s of sigs) assert.ok(/fill|stroke/.test(s.replace(/fillStyle|strokeStyle/g, '')), 'draws something');
  assert.equal(new Set(sigs).size, sigs.length);
});
test('ink is dark and nearly opaque (readable on every marble hue)', () => {
  for (let i = 0; i < MARK_NAMES.length; i++) {
    const m = record(i).sig.match(/fillStyle=rgba\((\d+),(\d+),(\d+),([\d.]+)\)/); assert.ok(m, 'ink colour set');
    assert.ok(+m[1] < 40 && +m[2] < 40 && +m[3] < 60 && +m[4] >= 0.9);
  }
});
test('glyph geometry stays inside the 64 px canvas with a margin (no clipped marks)', () => {
  for (let i = 0; i < MARK_NAMES.length; i++) {
    const { calls } = record(i);
    const nums = calls.filter(c => /^(fillRect|moveTo|lineTo|arc)\(/.test(c)).map(c => c.replace(/^[a-zA-Z]+\(/, '').replace(')', '').split(',').map(Number));
    for (const c of calls.filter(c => /^(moveTo|lineTo)\(/.test(c))) { const [x, y] = c.replace(/^[a-zA-Z]+\(/, '').replace(')', '').split(',').map(Number); assert.ok(x >= 4 && x <= 60 && y >= 4 && y <= 60, `${MARK_NAMES[i]} ${c}`); }
    for (const c of calls.filter(c => /^fillRect\(/.test(c))) { const [x, y, w, h] = c.replace(/^fillRect\(/, '').replace(')', '').split(',').map(Number); assert.ok(x >= 4 && y >= 4 && x + w <= 60 && y + h <= 60, `${MARK_NAMES[i]} ${c}`); }
    for (const c of calls.filter(c => /^arc\(/.test(c))) { const [x, y, r] = c.replace(/^arc\(/, '').replace(')', '').split(',').map(Number); assert.ok(x - r >= 4 && x + r <= 60 && y - r >= 4 && y + r <= 60, `${MARK_NAMES[i]} ${c}`); }
    assert.ok(nums.length > 0);
  }
});
test('unknown colour indices (rainbow/bomb/-1) draw nothing but the save/restore frame; markURL is safe without a DOM', () => {
  for (const ci of [-1, 6, 99]) assert.ok(!/fill\(|stroke\(|fillRect/.test(record(ci).sig));
  assert.equal(markURL(0), '');          // no document in node: must degrade to '' (CSS then shows no glyph), never throw
});
test('the setting defaults to ON and is a plain boolean in the saved-progress schema', () => {
  assert.equal(DEFAULTS().marks, true);
});
