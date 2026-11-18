// The unit media of the landing page, rendered from the real game on the GPU:
//   node tools/previews.mjs                    everything below
//   node tools/previews.mjs towers             every tower: public/media/tower_<t>.jpg (640 x 640) + public/media/prev/tower_<t>.mp4
//   node tools/previews.mjs enemies            every machine incl. the Colossus and the Titan: enemy_<t>.jpg (480 x 480) + prev/enemy_<t>.mp4
//   node tools/previews.mjs facs               every factory building: public/media/fac_<type>.jpg (640 x 640)
//   node tools/previews.mjs deposits           the four deposits: public/media/dep_<kind>.jpg (640 x 640)
//   node tools/previews.mjs tower_pulse,fac_mine,...   single subjects (STILL_ONLY=1: no clip)
// Needs the dev server (http://localhost:5183, or BASE=...) and ffmpeg. MEDIA=<dir> writes there instead. KEEP=1 leaves the frames in tools/trailer/frames/prev.
// Clips: 480 x 480, 24 fps, 3 s, H.264 two-pass at 400 kbit/s (about 150 KB), no sound, faststart.
//
// Every scene is built through the capture hook (play.html?capture=1 -> window.__volt) on the long straight of the Coil
// map (seed 11, a free run: towers need no supply here). A tower is placed by the sim and fed a stream of machines, fires,
// and fires its special once a second into the clip; machines walk down the road in a small group. The camera is set
// here (close, three-quarter from above, from the north edge of the deck) and drifts once round a small loop per clip;
// the still is the same camera at rest, so a card's picture and its hover clip line up. Buildings stand on the towers'
// tile under the towers' camera (a mine and a pumpjack on the middle of a deposit); deposits are framed the same way.
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { launch, openCapture, installHelpers, installLayout, CANVAS_ONLY } from './trailer/lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const MEDIA = resolve(process.env.MEDIA || join(ROOT, 'public/media'));   // MEDIA=<dir> writes somewhere else (for a test run)
const OUT = join(MEDIA, 'prev');
const WORK = process.env.FRAMES || join(ROOT, 'tools/trailer/frames/prev');
const FPS = 24, DT = 1 / FPS, N = 72, SIZE = 480, SUPER = 2;
/** Video bitrate: 3 s at 400 kbit/s is about 150 KB. */
const KBPS = +(process.env.KBPS || 400);

const TOWERS = ['pulse', 'cryo', 'arc', 'mortar', 'rail', 'beacon', 'flame', 'lance', 'missile', 'gravity'];
const ENEMIES = ['grunt', 'runner', 'drone', 'shield', 'brute', 'wheel', 'boss', 'brood', 'titan'];
const FACS = ['mine', 'generator', 'pole', 'pump', 'pipe', 'smelter', 'works', 'press', 'cells', 'refinery', 'missiles', 'belt', 'splitter', 'tunnel', 'ptunnel', 'crate'];
const DEPOSITS = ['iron', 'copper', 'coal', 'oil'];
// clip: seconds of run-in before the first frame; the still: frame of the clip it is taken from (-1: a separate render at rest)
const RUNIN = { tower: 5, enemy: 1.5 };
const RUNIN_OF = { tower_mortar: 7, tower_rail: 6, tower_flame: 6, tower_lance: 6, tower_missile: 6, tower_gravity: 6, enemy_boss: 2.5, enemy_brood: 2, enemy_titan: 0 };
const STILL_FRAME = { enemy_brood: 52, enemy_titan: 40, enemy_wheel: 6 };

const groups = { towers: TOWERS.map((t) => 'tower_' + t), enemies: ENEMIES.map((t) => 'enemy_' + t), facs: FACS.map((t) => 'fac_' + t), deposits: DEPOSITS.map((t) => 'dep_' + t) };
const want = (process.argv[2] || 'towers,enemies,facs,deposits').split(',').flatMap((n) => groups[n] || [n]);
for (const n of want) if (!Object.values(groups).flat().includes(n)) { console.error('unknown subject: ' + n); process.exit(1); }

/** Runs inside the page: the scenes, and a camera that this script owns. */
function install(N) {
  const V = window.__volt, view = V.view, TAU = Math.PI * 2;
  const D = 20;                  // the scenes sit this far down the road from the gate
  let sim, gx = 0, rz = 0, sc = null, star = null, lead = null, frame = 0, clock = 0, still = false;
  const cam = { x: 0, y: 9, z: 9, tx: 0, ty: 0, tz: 0 };
  // the game sets its own camera every frame; this one goes on top of it
  const base = view.updateCamera.bind(view);
  view.updateCamera = (dt) => {
    base(dt);
    if (!sc) return;
    place();
    // the camera stands outside the north edge of the deck: the lamp posts along that edge would cross the picture
    // (a scene shot from the south hides the other row). They are bones of one merged mesh: hidden by scaling them away.
    for (const l of view.lamps || []) if (sc.south ? l.position.z > 0 : l.position.z < 0) l.scale.setScalar(1e-4);
    const c = view.camera;
    c.position.set(cam.x, cam.y, cam.z); c.lookAt(cam.tx, cam.ty, cam.tz);
    if (Math.abs(c.fov - 30) > 1e-3) { c.fov = 30; c.updateProjectionMatrix(); }
  };
  /** Camera from the scene's settings: R away from the target, az degrees round from due north of it, el degrees up. One slow drift per loop (none for a still). */
  function place() {
    const c = sc.cam, u = still ? 0 : (frame / N) * TAU, k = still ? 0 : 1;
    const az = ((c.az + k * (c.sway ?? 5) * Math.sin(u)) * Math.PI) / 180, el = ((c.el + k * 1.5 * Math.sin(u + 1.3)) * Math.PI) / 180, R = c.R * (1 - k * 0.035 * Math.cos(u));
    const o = sc.watch || !lead ? star : lead.alive || !sc.at ? lead : star;
    const y0 = lead && !sc.watch && o === lead ? (lead.gy || 0) : 0;
    cam.tx = (o ? o.x : sc.at[0]) + (c.dx || 0); cam.ty = y0 + c.h; cam.tz = (o ? o.z : sc.at[1]) + (c.dz || 0);
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

  // A tower scene: what to build (the first one is the star), what walks past and how often, where enemies end
  // (they are destroyed `out` past the scene, so the tower always has its target in the picture), the camera, and the
  // frame its special fires on (it is charged then).
  const tower = (builds, feed, cam, o = {}) => ({ builds, feed, cam, out: 4.2, special: 26, ...o });
  // An enemy scene: the group as [distance behind the leader, sideways offset], and the camera that follows the leader.
  const enemy = (type, group, cam, o = {}) => ({ type, group, cam, hp: 1, ...o });
  // the one tower camera: every tower stands at the same place in the picture at the same size
  const TCAM = { R: 11.8, az: 24, el: 31, h: 2.1, dz: -0.9, dx: 0.9 };
  const SCENES = {
    tower_pulse: tower([['pulse', 8, 2]], [{ type: 'grunt', every: 0.5, hp: 2.4 }], TCAM),
    tower_cryo: tower([['cryo', 8, 2]], [{ type: 'grunt', every: 0.42, hp: 4 }, { type: 'runner', every: 0.9, hp: 5 }], TCAM, { special: 30 }),
    tower_arc: tower([['arc', 8, 2]], [{ type: 'grunt', every: 0.36, hp: 2 }], TCAM),
    tower_mortar: tower([['mortar', 8, 2]], [{ type: 'grunt', every: 0.32, hp: 2.2 }], TCAM, { out: 6.5, cd: 0.45 }),
    tower_rail: tower([['rail', 8, 2]], [{ type: 'brute', every: 1.6, hp: 1.5 }, { type: 'grunt', every: 0.7, hp: 2.5 }], TCAM, { out: 5.2, cd: 0.9 }),
    tower_beacon: tower([['beacon', 8, 2], ['pulse', 7, 2], ['pulse', 9, 2]], [{ type: 'grunt', every: 0.4, hp: 2 }], TCAM),
    tower_flame: tower([['flame', 8, 2], ['flame', 11, 0]], [{ type: 'grunt', every: 0.45, hp: 2.6 }], TCAM),
    tower_lance: tower([['lance', 8, 2]], [{ type: 'brute', every: 2.2, hp: 1.6 }, { type: 'grunt', every: 0.8, hp: 2 }], TCAM, { out: 5 }),
    tower_missile: tower([['missile', 8, 2]], [{ type: 'drone', every: 0.6, hp: 2.6 }, { type: 'grunt', every: 0.7, hp: 2.6 }], TCAM, { out: 5.5, cd: 0.4 }),
    tower_gravity: tower([['gravity', 8, 2]], [{ type: 'grunt', every: 0.38, hp: 60 }], TCAM, { out: 9, cull: true, cd: 0.5 }),
    enemy_grunt: enemy('grunt', [[0, 0.1], [1.5, -0.55], [2.5, 0.5]], { R: 6.6, az: 52, el: 30, h: 0.75, dx: -0.5 }),
    enemy_runner: enemy('runner', [[0, 0.2], [1.2, -0.5], [2.1, 0.45], [3.4, -0.1]], { R: 6.2, az: 50, el: 30, h: 0.5, dx: -0.6 }),
    enemy_drone: enemy('drone', [[0, 0.1], [1.8, -0.6], [2.9, 0.55]], { R: 7, az: 50, el: 24, h: 2.3, dx: -0.6 }),
    enemy_shield: enemy('shield', [[0, 0]], { R: 6.6, az: 48, el: 30, h: 0.95 }),
    enemy_brute: enemy('brute', [[0, 0]], { R: 7.8, az: 48, el: 30, h: 1.2 }),
    enemy_wheel: enemy('wheel', [[0, 0]], { R: 11.5, az: 50, el: 27, h: 1.55 }, { hp: 400, builds: [['pulse', 4, 2], ['pulse', 7, 2], ['pulse', 10, 2], ['pulse', 13, 2]], from: 5 }),
    enemy_boss: enemy('boss', [[0, 0]], { R: 18, az: 50, el: 30, h: 1.6 }),
    // a Broodcarrier comes up to a Railgun and lets its swarm loose on it: the camera stays on the tower
    enemy_brood: enemy('brood', [[0, 0]], { R: 13.5, az: 30, el: 30, h: 1.3, dx: 0.4, dz: -1.5 }, { hp: 30, builds: [['rail', 9, 2]], from: 14.2, watch: true }),
    // the Titan walks down the road past two Railguns that cannot hurt it much; seen from the south, its moonlit side
    enemy_titan: enemy('titan', [], { R: 44, az: 150, el: 10, h: 7.2, dx: 1.5, sway: 3 }, { titan: true, builds: [['rail', 13, 3], ['pulse', 17, 3], ['pulse', 21, 2]], south: true, calm: true }),
  };

  function start(name, asStill) {
    V.demo(11, 0, 'spiral'); V.takeover();
    sim = V.sim; sim.opts.pauseOnCards = false; sim.nextWaveIn = 1e9; sim.xpNext = 1e9; sim.gold = 1e6; sim.lives = sim.maxLives = 999;
    for (const t of ['pulse', 'cryo', 'arc', 'mortar', 'rail', 'beacon', 'flame', 'lance', 'missile', 'gravity']) sim.unlocked.add(t);
    view.skipIntro(); view.setQuality('high');
    sc = SCENES[name]; star = null; lead = null; frame = 0; clock = 0; still = !!asStill;
    const L = sim.map.lanes[0];
    gx = L.pts[0][0]; rz = L.pts[0][1];
    for (const b of sc.builds || []) { const t = build(b[0], b[1], b[2]); star = star || t; }
    for (const f of sc.feed || []) f.t = 0;
    if (sc.type && !sc.titan) sc.group.forEach(([back, off], i) => { const e = spawn(sc.type, (sc.from ?? 7) - back, off, sc.hp); if (!i) lead = e; });
    if (sc.titan) {
      // the real entrance: the leap onto the gate, the impact, then it walks; the clip starts once it is on its way
      sim.titanLeap(0);
      for (let i = 0; i < 900 && sim.titan.phase !== 'walk'; i++) V.frame(1 / 30);
      lead = sim.enemies.find((e) => e.type === 'titan');
      for (let i = 0; i < 150; i++) { for (const t of sim.towers) t.stun = 0; V.frame(1 / 30); }
    }
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
    if (sc.special !== undefined && star && !still) {
      if (i < sc.special) star.charge = Math.min(star.charge, 0.9);
      if (i === sc.special) { star.charge = 1; star.spec = 0; star.down = 0; sim.triggerSpecial(star.id, 0); }
    }
    if (sc.calm) for (const t of sim.towers) t.stun = 0;
    if (sc.type === 'wheel' && lead) {
      // the Gyre's guard over one loop: up, worn down by the turrets, down for a moment, then it spins back up
      const u = Math.max(0, i) / N, spin = u < 0.2 ? 1 : u < 0.4 ? 1 - 0.92 * ((u - 0.2) / 0.2) : u < 0.58 ? 0.08 : u < 0.9 ? 0.08 + 0.92 * ((u - 0.58) / 0.32) : 1;
      lead.spinCd = 1; lead.hp = lead.maxHp;
      if (sim.setSpin) sim.setSpin(lead, spin); else lead.spin = spin;
    }
    V.frame(dt);
  }
  /** A still of a tower at rest: built, nothing on the road, the camera of its clip without the drift. */
  function rest(name) {
    start(name, true);
    for (let i = 0; i < 48; i++) V.frame(1 / 24);
  }

  // ---- buildings and deposits: on the tile of the towers' scenes, with the towers' camera ----
  const C = window.__cap;
  /** the free run of the tower scenes, nothing on it */
  function bare() {
    V.demo(11, 0, 'spiral'); V.takeover();
    sim = V.sim; sim.opts.pauseOnCards = false; sim.nextWaveIn = 1e9; sim.xpNext = 1e9; sim.gold = 1e6;
    view.skipIntro(); view.setQuality('high');
    star = null; lead = null; frame = 0; still = true;
  }
  /**
   * A deposit of one kind laid on the towers' tile and the six round it (the free run has its own deposits elsewhere,
   * mostly at the edges and mixed with others): every deposit and the mine and pumpjack on one are shot alike.
   */
  function paint(ore) {
    const S = sim.factory, k = ['iron_ore', 'copper_ore', 'coal', 'oil'].indexOf(ore) + 1;
    for (const [cx, cz] of [[8, 2], [7, 2], [9, 2], [6, 2], [7, 3], [8, 3], [9, 3]]) S.ore[cz * 26 + cx] = k;
    V.resync();
  }
  const H = { pole: 2.2, refinery: 1.4, pump: 1.2, crate: 0.8, belt: 0.5, pipe: 0.6, splitter: 0.5, tunnel: 0.7, ptunnel: 0.7, mine: 1.1 };
  function facScene(type) {
    bare();
    const cx = 8, cz = 2;
    if (type === 'mine') paint('iron_ore');
    if (type === 'pump') paint('oil');
    let fx = C.wx(cx, cz), fz = C.wz(cz);
    const S = sim.factory, mid = (a, b) => { fx = (C.wx(a[0], a[1]) + C.wx(b[0], b[1])) / 2; fz = (C.wz(a[1]) + C.wz(b[1])) / 2; };
    if (type === 'crate') S.placeCrate(cx, cz, 'iron_ore', 45);
    else if (type === 'belt') C.belt([[6, 2], [7, 2], [8, 2], [8, 3], [9, 3]], 0);
    else if (type === 'splitter') {
      C.belt([[6, 2], [7, 2]], [8, 2]); C.fac('splitter', 8, 2);
      C.belt([[9, 2], [10, 2]], 0); C.belt([[8, 3]], 1); C.belt([[7, 3]], 2);
    } else if (type === 'tunnel') {
      // under the road: in on the deck side, out beyond it
      C.belt([[6, 3], [7, 3]], [8, 2]); C.fac('tunnel', 8, 2, 5); C.fac('tunnel', 9, 0, 5); mid([8, 2], [9, 0]);
    } else if (type === 'ptunnel') {
      C.pipe([[6, 3], [7, 3]]); C.fac('ptunnel', 8, 2); C.fac('ptunnel', 9, 0); C.pipe([[10, 0]]); mid([8, 2], [9, 0]);
    } else if (type === 'pipe') C.pipe([[6, 2], [7, 2], [8, 2], [8, 3], [9, 3]]);
    else C.fac(type, cx, cz);
    // items on the belts for the conveyor shots (time stands still between waves, so they are set down by hand)
    for (const q of S.facs) if (q.type === 'belt') q.items = [{ it: 'iron_ore', p: 0.15 }, { it: 'iron_ore', p: 0.7 }];
    sc = { cam: { ...TCAM, R: 9.5, h: H[type] ?? 1.1 }, at: [fx, fz] };
    for (let i = 0; i < 40; i++) V.frame(1 / 24);
  }
  /** a deposit: the camera on the middle of its largest patch, nothing built */
  function depScene(kind) {
    bare();
    paint({ iron: 'iron_ore', copper: 'copper_ore', coal: 'coal', oil: 'oil' }[kind]);
    sc = { cam: { ...TCAM, R: 9.5, el: 38, h: 0.3, dx: 0.3, dz: 0.4 }, at: [(C.wx(8, 2) + C.wx(8, 3)) / 2, (C.wz(2) + C.wz(3)) / 2] };
    for (let i = 0; i < 40; i++) V.frame(1 / 24);
  }
  window.__pv = { start, step, rest, facScene, depScene };
}

const pad = (i) => String(i).padStart(3, '0');
const jpeg = (src, size, dst) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${size}:${size}:flags=lanczos`, '-q:v', '2', dst], { stdio: 'inherit' });

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
// the stills are taken at 640 CSS px (1280 device px) and scaled down; the clips at 480 (960 device px)
const browser = await launch(640, 640, SUPER);
const page = await openCapture(browser);
// nothing but the game canvas: no HUD, no vignette, no flashes
await page.addStyleTag({ content: CANVAS_ONLY });
await page.evaluate(installHelpers);
await page.evaluate(installLayout);
await page.evaluate(install, N);
const size = async (w) => { await page.setViewport({ width: w, height: w, deviceScaleFactor: SUPER }); await page.evaluate(() => window.__volt.view.resize()); };

for (const name of want) {
  const kind = name.split('_')[0], sub = name.slice(kind.length + 1);
  const dir = join(WORK, name);
  mkdirSync(dir, { recursive: true });
  if (kind === 'fac' || kind === 'dep') {
    await size(640);
    await page.evaluate((k, s) => (k === 'fac' ? window.__pv.facScene(s) : window.__pv.depScene(s)), kind, sub);
    const png = join(dir, 'still.png');
    await page.screenshot({ path: png });
    jpeg(png, 640, join(MEDIA, name + '.jpg'));
    console.log(`${name}.jpg`);
    continue;
  }
  const stillSize = kind === 'tower' ? 640 : 480;
  // the still: a tower at rest from its clip's camera; a machine from a frame of its clip
  if (kind === 'tower' || STILL_FRAME[name] === undefined) {
    await size(stillSize);
    await page.evaluate((n) => window.__pv.rest(n), name);
    if (kind === 'enemy') await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__pv.step(-1, 1 / 24); });
    const png = join(dir, 'still.png');
    await page.screenshot({ path: png });
    jpeg(png, stillSize, join(MEDIA, name + '.jpg'));
    console.log(`${name}.jpg`);
  }
  if (process.env.STILL_ONLY) continue;
  await size(SIZE);
  const lead = Math.round((RUNIN_OF[name] ?? RUNIN[kind]) * FPS / 24) * 24;   // whole seconds of run-in
  await page.evaluate((n) => window.__pv.start(n), name);
  for (let i = -lead; i < N; i++) {
    await page.evaluate((i, dt) => window.__pv.step(i, dt), i, DT);
    if (i >= 0) await page.screenshot({ path: join(dir, `f${pad(i)}.png`) });
  }
  if (STILL_FRAME[name] !== undefined) {
    jpeg(join(dir, `f${pad(STILL_FRAME[name])}.png`), stillSize, join(MEDIA, name + '.jpg'));
    console.log(`${name}.jpg`);
  }
  // two passes at a fixed bitrate, so every clip comes out near the same size whatever is in it
  const out = join(OUT, name + '.mp4'), log = join(dir, 'pass');
  const enc = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%03d.png'),
    '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos:out_range=tv:out_color_matrix=bt709,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryslow', '-b:v', KBPS + 'k', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-an', '-passlogfile', log];
  execFileSync('ffmpeg', [...enc, '-pass', '1', '-f', 'null', '/dev/null'], { stdio: 'inherit' });
  execFileSync('ffmpeg', [...enc, '-pass', '2', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log(`${name}.mp4  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
await browser.close();
if (!process.env.KEEP) rmSync(WORK, { recursive: true, force: true });
