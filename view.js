// view.js — pure camera / picking math (no Three.js). The renderer feeds these numbers to a THREE.PerspectiveCamera,
// and input uses the SAME math to turn a pointer position into a world-space aim point, so what you tap is what you hit.
export const BALL_Y = 0.5;         // marbles and projectiles travel in the plane y = BALL_Y
export const FOV = 48;             // vertical field of view (degrees)
export const PITCH = 60 * Math.PI / 180;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

export function basis(pos, target) {
  const f = norm(sub(target, pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return { f, r, u };
}

function viewAt(aspect, d, target) {
  const pos = [target[0], target[1] + d * Math.sin(PITCH), target[2] + d * Math.cos(PITCH)];
  return { aspect, fov: FOV, pos, target, ...basis(pos, target), th: Math.tan(FOV * Math.PI / 360) };
}

export function project(v, P) {
  const d = sub(P, v.pos), z = dot(d, v.f);
  return [dot(d, v.r) / (z * v.th * v.aspect), dot(d, v.u) / (z * v.th), z];
}

/** Ray through normalised device coords (nx,ny in [-1,1], y up) intersected with the plane y = planeY. */
export function unproject(v, nx, ny, planeY = BALL_Y) {
  const dir = norm([
    v.f[0] + v.r[0] * nx * v.th * v.aspect + v.u[0] * ny * v.th,
    v.f[1] + v.r[1] * nx * v.th * v.aspect + v.u[1] * ny * v.th,
    v.f[2] + v.r[2] * nx * v.th * v.aspect + v.u[2] * ny * v.th,
  ]);
  if (Math.abs(dir[1]) < 1e-9) return null;
  const t = (planeY - v.pos[1]) / dir[1];
  if (t <= 0) return null;
  return [v.pos[0] + dir[0] * t, planeY, v.pos[2] + dir[2] * t];
}

/**
 * Fit the camera so every point of `pts` ([x,z] ground points, already padded) is inside the safe screen area.
 * margins are in NDC: top/bottom leave room for the HUD and the marble tray.
 */
export function fitView(aspect, pts, { top = 0.78, bottom = -0.80, side = 0.965 } = {}) {
  const target = [0, 0, 0.6];
  const inside = (v) => {
    for (const p of pts) {
      const q = project(v, [p[0], BALL_Y, p[1]]);
      if (q[2] <= 0 || Math.abs(q[0]) > side || q[1] > top || q[1] < bottom) return false;
    }
    return true;
  };
  let lo = 8, hi = 90;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (inside(viewAt(aspect, mid, target))) hi = mid; else lo = mid; }
  return viewAt(aspect, hi, target);
}

/** Ground points covering a path's footprint with padding for marble size and the gate/skull. */
export function footprint(path, pad = 0.85) {   // marble radius 0.48 (+0.15 glow) = 0.63; was 1.1, which wasted ~6% of portrait width
  const pts = [];
  for (let s = 0; s <= path.L; s += 1.5) {
    const p = path.pos(s, {});
    for (const [ox, oz] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad]]) pts.push([p.x + ox, p.z + oz]);
  }
  const e = path.pos(path.L, {}); pts.push([e.x, e.z]);
  const b = path.pos(0, {}); pts.push([b.x, b.z]);
  return pts;
}

/** Pointer (client px) -> world ground point at marble height; also returns the unit aim direction from the frog. */
export function pointerToAim(v, clientX, clientY, width, height) {
  const nx = (clientX / width) * 2 - 1, ny = -((clientY / height) * 2 - 1);
  const g = unproject(v, nx, ny, BALL_Y);
  if (!g) return null;
  const l = Math.hypot(g[0], g[2]);
  if (l < 0.3) return null;                      // too close to the frog to define a direction
  return { x: g[0], z: g[2], dx: g[0] / l, dz: g[2] / l };
}
