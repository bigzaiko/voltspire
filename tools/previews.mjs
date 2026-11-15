// Records the hover previews for the landing page: one short loop per tower and enemy, taken from the real game.
//   node tools/previews.mjs [names]     names: comma separated, e.g. tower_pulse,enemy_wheel (default: all of them)
// Needs the dev server (http://localhost:5183, or BASE=...) and ffmpeg. KEEP=1 leaves the frames on disk.
// Output: public/media/prev/<name>.mp4 (480 x 480, 24 fps, 3 s, no sound).
//
// Every clip is a small scene on the long straight of the Coil map, built through the capture hook (window.__volt):
// the tower is placed with the sim and fed a stream of enemies, or a group of enemies walks down the road. The camera
// is set here, close and from a three-quarter bird angle, and drifts once round a small loop per clip.
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'public/media/prev');
const WORK = process.env.FRAMES || join(ROOT, 'tools/trailer/frames/prev');
const BASE = process.env.BASE || 'http://localhost:5183';
const FPS = 24, DT = 1 / FPS, N = 72, SIZE = 480, SUPER = 1.5;
/** Video bitrate: 3 s at 400 kbit/s is about 150 KB. */
const KBPS = +(process.env.KBPS || 400);

// name: [seconds of run-in before the first frame, does Kestrel shoot]
const CLIPS = {
  tower_pulse: [5], tower_cryo: [5], tower_arc: [5], tower_mortar: [7], tower_rail: [6], tower_beacon: [5], tower_flame: [6],
  tower_lance: [6], tower_missile: [6], tower_gravity: [6], tower_spire: [4, true],
  enemy_grunt: [1.5], enemy_runner: [1.5], enemy_drone: [1.5], enemy_shield: [1.5], enemy_brute: [1.5], enemy_wheel: [1.5], enemy_boss: [2.5],
};
const want = process.argv[2] ? process.argv[2].split(',') : Object.keys(CLIPS);
for (const n of want) if (!CLIPS[n]) { console.error('unknown clip: ' + n); process.exit(1); }

/** Runs inside the page: the scenes, and a camera that this script owns. */
function install(N) {
  const V = window.__volt, view = V.view, TAU = Math.PI * 2;
  const D = 20;                  // the scenes sit this far down the road from the gate
  let sim, gx = 0, rz = 0, sc = null, star = null, lead = null, frame = 0, clock = 0;
  const cam = { x: 0, y: 9, z: 9, tx: 0, ty: 0, tz: 0 };
  // the game sets its own camera every frame; this one goes on top of it
  const base = view.updateCamera.bind(view);
  view.updateCamera = (dt) => {
    base(dt);
    if (!sc) return;
    place();
    const c = view.camera;
    c.position.set(cam.x, cam.y, cam.z); c.lookAt(cam.tx, cam.ty, cam.tz);
    if (Math.abs(c.fov - 30) > 1e-3) { c.fov = 30; c.updateProjectionMatrix(); }
  };
  /** Camera from the scene's settings: R away from the target, az degrees round from due north of it, el degrees up. One slow drift per loop. */
  function place() {
    const c = sc.cam, u = (frame / N) * TAU;
    const az = ((c.az + (c.sway ?? 5) * Math.sin(u)) * Math.PI) / 180, el = ((c.el + 1.5 * Math.sin(u + 1.3)) * Math.PI) / 180, R = c.R * (1 - 0.035 * Math.cos(u));
    const o = lead && lead.alive ? lead : star;
    const y0 = lead ? (lead.gy || 0) : 0;
    cam.tx = o.x + (c.dx || 0); cam.ty = y0 + c.h; cam.tz = o.z + (c.dz || 0);
    cam.x = cam.tx + R * Math.cos(el) * Math.sin(az); cam.y = cam.ty + R * Math.sin(el); cam.z = cam.tz - R * Math.cos(el) * Math.cos(az);
  }
  function spawn(type, dist, off = 0, hp = 1) {
    sim.spawn(type, 1, 0);
    const e = sim.enemies[sim.enemies.length - 1];
    e.dist = dist; e.off = off; e.x = gx + dist; e.z = rz + off;
    e.hp = e.maxHp = e.maxHp * hp; e.shield = e.maxShield = e.maxShield * hp;
    return e;
  }
  const build = (type, cx, cz) => { const t = sim.build(type, cx, cz); if (!t) throw new Error('cannot build ' + type + ' at ' + cx + ',' + cz); t.cd = 0.2; return t; };
  /** Aim Kestrel at a point: the look angles that put it under the crosshair (the same sums the demo bot uses). */
  function aimAt(tx, ty, tz, k) {
    const o = sim.heroOrigin(0), flat = Math.max(0.5, Math.hypot(tx - o.x, tz - o.z));
    const yaw = Math.atan2(tx - o.x, tz - o.z) + Math.atan2(0.85, flat + 3);
    let pitch = Math.atan2(ty - o.y, flat);
    for (let i = 0; i < 2; i++) pitch = Math.atan2(ty - (o.y + 0.88 - 3 * Math.sin(pitch)), flat + 3 * Math.cos(pitch));
    view.yaw += (yaw - view.yaw) * k; view.pitch += (Math.max(-1.1, Math.min(0.1, pitch)) - view.pitch) * k;
  }

  // A tower scene: what to build (the first one is the star), what walks past and how often, where enemies end
  // (they are destroyed `out` past the scene, so the tower always has its target in the picture), and the camera.
  const tower = (builds, feed, cam, o = {}) => ({ builds, feed, cam, out: 4.2, ...o });
  // An enemy scene: the group as [distance behind the leader, sideways offset], and the camera that follows the leader.
  const enemy = (type, group, cam, o = {}) => ({ type, group, cam, hp: 1, ...o });
  const TCAM = { R: 12, az: 24, el: 33, h: 1.35, dz: -0.9, dx: 0.9 };
  const SCENES = {
    tower_pulse: tower([['pulse', 8, 2]], [{ type: 'grunt', every: 0.62, hp: 1.6 }], TCAM),
    tower_cryo: tower([['cryo', 8, 2]], [{ type: 'grunt', every: 0.5, hp: 3 }, { type: 'runner', every: 0.9, hp: 4 }], TCAM),
    tower_arc: tower([['arc', 8, 2]], [{ type: 'grunt', every: 0.42, hp: 1.6 }], { ...TCAM, h: 1.7 }),
    tower_mortar: tower([['mortar', 8, 2]], [{ type: 'grunt', every: 0.36, hp: 1.6 }], { ...TCAM, R: 16.5, dx: 3.6, h: 1.1 }, { out: 6.5, cd: 0.45 }),
    tower_rail: tower([['rail', 8, 2]], [{ type: 'brute', every: 2.4, hp: 1.2 }, { type: 'grunt', every: 0.9, hp: 2 }], { ...TCAM, R: 13, dx: 1.6, h: 1.5 }, { out: 5.2, cd: 0.9 }),
    tower_beacon: tower([['beacon', 8, 2], ['pulse', 7, 2], ['pulse', 9, 2]], [{ type: 'grunt', every: 0.4, hp: 1.6 }], { ...TCAM, R: 13.5, h: 1.8, dx: 0.4 }),
    tower_flame: tower([['flame', 8, 2], ['flame', 8, 0]], [{ type: 'grunt', every: 0.5, hp: 2.2 }], { ...TCAM, R: 13.5, az: 38, el: 36, dz: -1.75, dx: 0.3, h: 1.1 }),
    tower_lance: tower([['lance', 8, 2]], [{ type: 'brute', every: 2.6, hp: 1.5 }], { ...TCAM, R: 13, dx: 1.4, h: 1.7 }, { out: 5 }),
    tower_missile: tower([['missile', 8, 2]], [{ type: 'drone', every: 0.7, hp: 2.2 }], { ...TCAM, R: 13.5, dx: 1.2, h: 2.2, el: 26 }, { out: 5.5, cd: 0.4 }),
    tower_gravity: tower([['gravity', 8, 2]], [{ type: 'grunt', every: 0.42, hp: 60 }], { ...TCAM, h: 1.5 }, { out: 9, cull: true, cd: 0.5 }),
    tower_spire: tower([['spire', 8, 2]], [{ type: 'grunt', every: 0.8, hp: 1e4 }], { R: 5.6, az: 62, el: 17, h: 7.7, sway: 4 }, { out: 22, cull: true, hero: true }),
    enemy_grunt: enemy('grunt', [[0, 0.1], [1.5, -0.55], [2.5, 0.5]], { R: 6.6, az: 52, el: 30, h: 0.75, dx: -0.5 }),
    enemy_runner: enemy('runner', [[0, 0.2], [1.2, -0.5], [2.1, 0.45], [3.4, -0.1]], { R: 6.2, az: 50, el: 30, h: 0.5, dx: -0.6 }),
    enemy_drone: enemy('drone', [[0, 0.1], [1.8, -0.6], [2.9, 0.55]], { R: 7, az: 50, el: 24, h: 2.3, dx: -0.6 }),
    enemy_shield: enemy('shield', [[0, 0]], { R: 6.6, az: 48, el: 30, h: 0.95 }),
    enemy_brute: enemy('brute', [[0, 0]], { R: 7.8, az: 48, el: 30, h: 1.2 }),
    enemy_wheel: enemy('wheel', [[0, 0]], { R: 9, az: 50, el: 27, h: 1.15 }, { hp: 400, builds: [['pulse', 4, 2], ['pulse', 7, 2], ['pulse', 10, 2], ['pulse', 13, 2]], from: 5 }),
    enemy_boss: enemy('boss', [[0, 0]], { R: 15.5, az: 50, el: 30, h: 1.6 }),
  };

  function start(name) {
    V.demo(11, 0, 'spiral'); V.takeover();
    sim = V.sim; sim.opts.pauseOnCards = false; sim.nextWaveIn = 1e9; sim.xpNext = 1e9; sim.gold = 1e6;
    for (const t of ['pulse', 'cryo', 'arc', 'mortar', 'rail', 'beacon', 'flame', 'lance', 'missile', 'gravity', 'spire']) sim.unlocked.add(t);
    view.skipIntro(); view.setQuality('high');
    // the camera stands outside the north edge of the deck: the lamp posts along that edge would cross the picture
    for (const l of view.lamps || []) if (l.position.z < 0) l.visible = false;
    const L = sim.map.lanes[0];
    gx = L.pts[0][0]; rz = L.pts[0][1];
    sc = SCENES[name]; star = null; lead = null; frame = 0; clock = 0;
    for (const b of sc.builds || []) { const t = build(b[0], b[1], b[2]); star = star || t; }
    for (const f of sc.feed || []) f.t = 0;
    if (sc.type) sc.group.forEach(([back, off], i) => { const e = spawn(sc.type, (sc.from ?? 7) - back, off, sc.hp); if (!i) lead = e; });
    if (sc.hero) { sim.players[0].energy = 100; sim.activateHero(0, star.id); }
    sim.events.length = 0;
  }
  /** One frame. i runs from minus the run-in up to N - 1; frames below 0 are not recorded. */
  function step(i, dt) {
    frame = Math.max(0, i); clock += dt;
    for (const f of sc.feed || []) {
      f.t -= dt;
      if (f.t <= 0) { f.t += f.every; spawn(f.type, D - 12, ((sim.enemies.length * 7) % 5 - 2) * 0.28, f.hp); }
    }
    if (sc.feed) for (let k = sim.enemies.length - 1; k >= 0; k--) {
      const e = sim.enemies[k];
      if (e.dist <= D + sc.out || !e.alive) continue;
      if (sc.cull) sim.enemies.splice(k, 1); else sim.damage(e, 1e9, -1, true);
    }
    if (i === 0 && sc.cd) star.cd = sc.cd;
    if (sc.hero) {
      // Kestrel picks the enemy nearest to a spot down the road and keeps the crosshair on it
      const p = sim.players[0];
      p.heroTime = Math.max(p.heroTime, 6);
      let best = null, bd = 1e9;
      for (const e of sim.enemies) { const d = Math.abs(e.dist - (D + 9)); if (e.alive && d < bd) { bd = d; best = e; } }
      if (best) aimAt(best.x + 0.25, best.y, best.z, clock < 0.3 ? 1 : 0.25);
    }
    if (sc.type === 'wheel' && lead) {
      // the Gyre's guard over one loop: up, worn down by the turrets, down for a moment, then it spins back up
      const u = Math.max(0, i) / N, spin = u < 0.2 ? 1 : u < 0.4 ? 1 - 0.92 * ((u - 0.2) / 0.2) : u < 0.58 ? 0.08 : u < 0.9 ? 0.08 + 0.92 * ((u - 0.58) / 0.32) : 1;
      lead.spinCd = 1; lead.hp = lead.maxHp;
      if (sim.setSpin) sim.setSpin(lead, spin); else lead.spin = spin;
    }
    V.frame(dt);
  }
  window.__pv = { start, step };
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', `--window-size=${SIZE},${SIZE}`, ...(process.env.CHROME_FLAGS || '--use-gl=angle --use-angle=gl --ignore-gpu-blocklist').split(' ')],
  defaultViewport: { width: SIZE, height: SIZE, deviceScaleFactor: SUPER },
});
const page = await browser.newPage();
// the recorder injects a style tag and a script; a production build's CSP would block them
await page.setBypassCSP(true);
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(BASE + '/play.html?capture=1', { waitUntil: 'load' });
await page.waitForFunction('window.__volt', { timeout: 60000 });
// nothing but the game canvas: no HUD, no vignette, no flashes
await page.addStyleTag({ content: 'body > *:not(#c) { display: none !important; } html, body { background: #000 !important; cursor: none !important; }' });
await page.evaluate(install, N);
await page.mouse.move(SIZE / 2, SIZE / 2);

for (const name of want) {
  const [pre, hero] = CLIPS[name];
  const dir = join(WORK, name), lead = Math.round(pre * FPS / 24) * 24;   // whole seconds of run-in, so Kestrel's rhythm carries over the loop
  mkdirSync(dir, { recursive: true });
  await page.evaluate((n) => window.__pv.start(n), name);
  let held = false;
  for (let i = -lead; i < N; i++) {
    if (hero) {
      // the bow: held for two thirds of a second, loosed, a third of a second to nock
      const k = ((i % 24) + 24) % 24;
      if (k === 0) { await page.mouse.down(); held = true; } else if (k === 16) { await page.mouse.up(); held = false; }
    }
    await page.evaluate((i, dt) => window.__pv.step(i, dt), i, DT);
    if (i >= 0) await page.screenshot({ path: join(dir, `f${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 95 });
  }
  if (held) await page.mouse.up();
  // two passes at a fixed bitrate, so every clip comes out near the same size whatever is in it
  const out = join(OUT, name + '.mp4'), log = join(dir, 'pass');
  // (the screenshots are full-range JPEG: the scaler brings them to plain video-range yuv420p, which every browser plays)
  const enc = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%03d.jpg'),
    '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos:out_range=tv:out_color_matrix=bt709,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryslow', '-b:v', KBPS + 'k', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-an', '-passlogfile', log];
  execFileSync('ffmpeg', [...enc, '-pass', '1', '-f', 'null', '/dev/null'], { stdio: 'inherit' });
  execFileSync('ffmpeg', [...enc, '-pass', '2', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log(`${name}.mp4  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
await browser.close();
if (!process.env.KEEP) rmSync(WORK, { recursive: true, force: true });
