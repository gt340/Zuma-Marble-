import { run, ctx, advance, counts, rng, bootScene, getNow, setNow, timers } from './harness.mjs';
const out = (k, v) => console.log(`\n### ${k}\n` + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));
bootScene();

// ---------- E1: path & spacing ----------
{
  const N = 20000, P = [];
  run('globalThis.__P = []');
  for (let i = 0; i <= N; i++) { const p = run(`pathCurve.getPoint(${i / N})`); P.push([p.x, p.z]); }
  let L = 0; const cum = [0];
  for (let i = 1; i <= N; i++) { L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); cum.push(L); }
  const S = run('BALL_SPACING'), R = run('BALL_R');
  const sp = [];
  for (let t = 0.02; t < 0.97; t += 0.005) {
    const a = run(`pathCurve.getPoint(${t})`), b = run(`pathCurve.getPoint(${t + S})`);
    sp.push(Math.hypot(a.x - b.x, a.z - b.z));
  }
  // local speed in world units/sec for BASE_SPEED (t-units per frame*60)
  const base = run('BASE_SPEED');
  const spd = []; for (let t = 0.05; t < 0.95; t += 0.01) { const a = run(`pathCurve.getPoint(${t})`), b = run(`pathCurve.getPoint(${t + 0.001})`); spd.push(Math.hypot(a.x - b.x, a.z - b.z) / 0.001 * base * 60); }
  // path crossings: points far apart in arc length but close in space
  let cross = 0, minD = 1e9; const crossAt = [];
  for (let i = 0; i < N; i += 20) for (let j = i + 1; j <= N; j += 20) {
    if (cum[j] - cum[i] < 6) continue;
    const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
    if (d < 1.2) { cross++; if (crossAt.length < 3) crossAt.push({ t1: +(i / N).toFixed(3), t2: +(j / N).toFixed(3), d: +d.toFixed(2) }); }
    minD = Math.min(minD, d);
  }
  const end = P[N], start = P[0];
  out('E1 path', {
    lengthWorldUnits: +L.toFixed(1), ballDiameter: 2 * R, BALL_SPACING_t: S,
    worldSpacingBetweenNeighbours: { min: +Math.min(...sp).toFixed(2), max: +Math.max(...sp).toFixed(2), avg: +(sp.reduce((a, b) => a + b) / sp.length).toFixed(2) },
    spacingToDiameterRatio: { min: +(Math.min(...sp) / (2 * R)).toFixed(2), max: +(Math.max(...sp) / (2 * R)).toFixed(2) },
    chainSpeedWorldUnitsPerSec_atBASE_SPEED: { min: +Math.min(...spd).toFixed(1), max: +Math.max(...spd).toFixed(1), avg: +(spd.reduce((a, b) => a + b) / spd.length).toFixed(1) },
    pathStart: start.map(v => +v.toFixed(2)), pathEnd: end.map(v => +v.toFixed(2)), endDistanceFromFrog: +Math.hypot(...end).toFixed(2),
    selfCrossingSamples: cross, examples: crossAt,
  });
}

// ---------- E2: time to first life loss with no input ----------
{
  run('reset(); active = true; spawnInit(); prepBall();');
  let t = 0, lost = null; run('globalThis.__lc = 0; { const o = loseLife; loseLife = function(){ __lc++; return o.apply(this, arguments); }; }');
  for (let f = 0; f < 60 * 60; f++) { run('updateChain(1/60)'); setNow(getNow() + 16); advance(0); t += 1 / 60; if (run('__lc') > 0 && lost === null) { lost = t; break; } }
  out('E2 first life lost (no input)', { seconds: lost && +lost.toFixed(2), livesAfter: run('lives'), headProgressAtStart: 0.02 + 17 * run('BALL_SPACING') });
}

// ---------- E3: effective hit radius ----------
{
  run('globalThis.__hit = 0; { const oi = insert; insert = function(){ __hit++; return oi.apply(this, arguments); }; }');
  const rows = [];
  for (const dtFrame of [1 / 60, 1 / 30]) {
    const res = [];
    for (let d = 0; d <= 1.0001; d += 0.1) {
      run(`reset(); active = true; clearAll(); muted = true;`);
      run(`{ const m = makeBallMesh(0); m.position.set(0, 0.5, -6); scene.add(m); meshes=[m]; colors=[0]; powers=[0]; progress=[0.5]; prepBall(); lastShoot = -1e9;
        aim = new THREE.Vector3(${d}, 0, -6); __hit = 0; }`);
      setNow(getNow() + 1000);
      run('shoot()');
      const y0 = run('projectiles[0].mesh.position.y');
      for (let f = 0; f < 200; f++) run(`updateProjectiles(${dtFrame})`);
      res.push([+d.toFixed(1), run('__hit') > 0 ? 'HIT' : 'miss']);
      rows.push(y0);
    }
    out(`E3 hit test, frame dt=${dtFrame.toFixed(4)} (lateral offset of shot line from ball centre @ ball distance 6)`, res.map(r => r.join(':')).join('  '));
  }
  out('E3 projectile spawn height vs ball height', { projectileY: +rows[0].toFixed(2), ballY: 0.5, deltaY: +(rows[0] - 0.5).toFixed(2), ballDiameter: 0.96,
    analyticEffectiveHorizontalHitRadius: +Math.sqrt(0.96 ** 2 - (rows[0] - 0.5) ** 2).toFixed(2), perFrameStepAt60fps: 0.68 });
}

// ---------- E4: removeRange overlap / ordering ----------
{
  const res = [];
  for (const n of [3, 4, 5, 6, 7, 9]) {
    run('reset(); clearAll();');
    run(`for (let i = 0; i < 24; i++) { addBall(0.1 + i * BALL_SPACING, i % 6, 0); }`);
    run(`removeRange(8, ${8 + n - 1});`);
    const prog = run('progress.slice()'), S = run('BALL_SPACING');
    const gaps = []; for (let i = 1; i < prog.length; i++) gaps.push((prog[i] - prog[i - 1]) / S);
    res.push({ removed: n, minSpacingInBallSpacings: +Math.min(...gaps).toFixed(2), orderInverted: gaps.some(g => g < 0), spacingAtJoin: +gaps[7].toFixed(2) });
  }
  out('E4 removeRange: spacing of neighbours after removal (1.00 = correct)', res);
}

// ---------- E5: empty-chain handling ----------
{
  run('reset(); clearAll(); active = true; muted = true; globalThis.__si = 0; globalThis.__origSI = spawnInit; { const o = spawnInit; spawnInit = function(){ __si++; return o.apply(this, arguments); }; }');
  const s0 = run('score');
  for (let f = 0; f < 60 * 2.2; f++) { run('updateChain(1/60)'); setNow(getNow() + 1000 / 60); advance(0); }
  advance(2500);
  out('E5 cleared chain: reward & respawn', { scoreGained: run('score') - s0, spawnInitCalls: run('__si'), ballsOnBoardAfter: run('meshes.length'), MAX_BALLS: run('MAX_BALLS') });
  run('spawnInit = __origSI;');
}

// ---------- E6: spawn ordering ----------
{
  run('reset(); clearAll(); active = true; slowTimer = 1e9; speedMul = 0.04; spawnInit();');
  for (let f = 0; f < 60 * 12; f++) { run('updateChain(1/60)'); setNow(getNow() + 1000 / 60); advance(0); }
  const prog = run('progress.slice()'), col = run('colors.slice()'), S = run('BALL_SPACING');
  let inv = 0; for (let i = 0; i < prog.length; i++) for (let j = i + 1; j < prog.length; j++) if (prog[i] > prog[j]) inv++;
  let far = 0, farSame = 0; for (let i = 1; i < prog.length; i++) if (Math.abs(prog[i] - prog[i - 1]) > 3 * S) { far++; if (col[i] === col[i - 1]) farSame++; }
  out('E6 array order vs path order after 12 s of spawns', { balls: prog.length, orderInversionPairs: inv, indexAdjacentButFarApart: far, ofWhichSameColour: farSame,
    lastFiveProgress: prog.slice(-5).map(v => +v.toFixed(3)), firstProgress: +prog[0].toFixed(3) });
}

// ---------- E7: power distribution ----------
{
  rng(99); const N = 200000; const c = [0, 0, 0, 0];
  run('reset(); clearAll(); spawnInit();');
  for (let i = 0; i < N; i++) { run('prepBall()'); c[run('currentPower')]++; }
  out('E7 shooter marble types over 200k shots', { none: +(100 * c[0] / N).toFixed(1) + '%', bomb: +(100 * c[1] / N).toFixed(1) + '%', rainbow: +(100 * c[2] / N).toFixed(1) + '%', slow: +(100 * c[3] / N).toFixed(1) + '%',
    shareOfPowerShots: { bomb: +(100 * c[1] / (N - c[0])).toFixed(0) + '%', rainbow: +(100 * c[2] / (N - c[0])).toFixed(0) + '%', slow: +(100 * c[3] / (N - c[0])).toFixed(0) + '%' } });
}

// ---------- E8: stale callbacks after restart ----------
{
  rng(5); timers.length = 0;
  run('reset(); clearAll(); active = true; spawnInit(); prepBall();');
  run('insert(5, 0, POWER.BOMB, new THREE.Vector3(0, 0.5, 0));'); // schedules explodeBomb in 45ms
  run('restart();');
  const before = { score: run('score'), balls: run('meshes.length') };
  advance(500);
  out('E8 restart() then pending timers fire into the NEW game (no shot fired)', { before, after: { score: run('score'), balls: run('meshes.length') }, pendingTimersAtRestart: 'bomb+match timers were not cancelled' });
}

// ---------- E9: allocation counts ----------
{
  run('reset(); clearAll();');
  const c0 = { ...counts };
  run('for (let i = 0; i < 10; i++) prepBall();');
  const c1 = { ...counts };
  run('spawnBurst(new THREE.Vector3(), 0xff0000, 12);');
  const c2 = { ...counts };
  out('E9 allocations', { per_prepBall: { geometries: (c1.geometry - c0.geometry) / 10, materials: (c1.material - c0.material) / 10, meshes: (c1.mesh - c0.mesh) / 10 },
    per_spawnBurst12: { geometries: c2.geometry - c1.geometry, materials: c2.material - c1.material } });
}
