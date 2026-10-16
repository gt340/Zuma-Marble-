import test from 'node:test';
import assert from 'node:assert/strict';
import { PATH_DEFS, getPath } from '../core.js';
import { fitView, footprint, project, unproject, pointerToAim, BALL_Y } from '../view.js';

const SIZES = [[390, 844], [360, 640], [412, 915], [844, 390], [915, 412], [768, 1024], [1280, 720], [1920, 1080], [2560, 1080]];

test('17. camera fits every path inside the safe area at phone, tablet and desktop sizes (portrait + landscape)', () => {
  for (const name of Object.keys(PATH_DEFS)) {
    for (const shift of [0, 0.7, 1.4]) {
      const path = getPath(name, shift), pts = footprint(path);
      for (const [w, h] of SIZES) {
        const v = fitView(w / h, pts);
        for (const p of pts) {
          const q = project(v, [p[0], BALL_Y, p[1]]);
          assert.ok(Math.abs(q[0]) <= 0.966 && q[1] <= 0.781 && q[1] >= -0.801, `${name} ${w}x${h}: (${q[0].toFixed(2)},${q[1].toFixed(2)})`);
        }
      }
    }
  }
});

test('picking: project -> unproject round-trips at marble height (no parallax error)', () => {
  const v = fitView(390 / 844, footprint(getPath('spiral')));
  for (const P of [[6, BALL_Y, -4], [-5, BALL_Y, -6], [0, BALL_Y, -7], [5, BALL_Y, 4], [-3, BALL_Y, 2]]) {
    const q = project(v, P), g = unproject(v, q[0], q[1], BALL_Y);
    assert.ok(Math.hypot(g[0] - P[0], g[2] - P[2]) < 1e-9);
  }
});

test('pointerToAim aims exactly at the world point under the finger', () => {
  const w = 390, h = 844, v = fitView(w / h, footprint(getPath('spiral')));
  const target = [4.2, BALL_Y, -5.1], q = project(v, target);
  const a = pointerToAim(v, (q[0] + 1) / 2 * w, (1 - q[1]) / 2 * h, w, h);
  assert.ok(Math.abs(a.x - 4.2) < 1e-6 && Math.abs(a.z + 5.1) < 1e-6);
  assert.ok(Math.abs(Math.hypot(a.dx, a.dz) - 1) < 1e-9);
  assert.equal(pointerToAim(v, w / 2, 0 - 1e6, w, h), null, 'a ray that never reaches the ground plane yields no aim');
});

test('18. marble edges + glow (0.65 u) stay on screen for every path, orientation and phone size after the tighter fit', () => {
  const sizes = [[360, 640], [390, 844], [412, 915], [640, 360], [844, 390], [915, 412]];
  for (const name of Object.keys(PATH_DEFS)) for (const shift of [0, 0.7, 1.4]) for (const [w, h] of sizes) {
    const path = getPath(name, shift), v = fitView(w / h, footprint(path));
    for (let s = 0; s <= path.L; s += 0.5) {
      const p = path.pos(s, {});
      for (let a = 0; a < 8; a++) {
        const q = project(v, [p.x + 0.65 * Math.cos(a * Math.PI / 4), 0.5, p.z + 0.65 * Math.sin(a * Math.PI / 4)]);
        assert.ok(Math.abs(q[0]) <= 1 && q[1] <= 1 && q[1] >= -1, `${name}+${shift} ${w}x${h} s=${s.toFixed(1)} offscreen (${q[0].toFixed(3)},${q[1].toFixed(3)})`);
      }
    }
  }
});
