// Quick headless checks: node tools/smoke.ts
import { Sim, standY, nodePos, weakPos, raySphere, spireTarget, computeWalls, drawPower, arrowSpeed, paceOf, NODE_R, SPIRE_R, ARROW_PAD, ARROW_SPEED, FULL_DRAW, TOWER_H, DECK_GAP, MUST_EVENTS, SNAP_EVENTS_MAX, CORE_STAND } from '../src/game/sim.ts';
import type { Ev, Enemy } from '../src/game/sim.ts';
import {
  ENEMIES, ENEMY_SCALE, ENEMY_TYPES, WHEEL_GUARD, WHEEL_CRAWL, WHEEL_BLEED, WHEEL_DRAG, WHEEL_SINK, WHEEL_REST, WHEEL_SPINUP, WHEEL_PIERCE, WHEEL_ESCORT, WHEEL_ESCORTS, TOWERS, TOWER_TYPES, MAX_ENERGY, CARDS, CARD_BY_ID, GW, GH, TWIN_BOLT, TUNE, COOP_HP, coopScale, BOW_TIERS,
  BREACH_TIME, BREACH_TIME_BOSS, BREACH_SHARE, FIRST_WAVE_IN, NEXT_WAVE_IN, DRAW_TIME, MIN_DRAW, NOCK_TIME, FULL_DRAW_MUL, HERO_DUR, LINK_RANGE, WALL_HALF, FIRE_RING, SING_COLOR,
} from '../src/game/data.ts';
import { hexDist } from '../src/game/hex.ts';
import type { MapDef } from '../src/game/map.ts';
import { Bot } from '../src/game/bot.ts';
import { MAPS } from '../src/game/maps.ts';
import { sanitizeMap, validateMap, encodeMap, decodeMap } from '../src/game/map.ts';
/** Switchback with its first diagonal raised to level 2. */
const hill: MapDef = { ...MAPS[0], id: 'hill', towers: [], lanes: [MAPS[0].lanes[0].map((p, i) => (i === 1 || i === 2 ? [p[0], p[1], 2] : p))] };
let fail = 0;
const ok = (c: unknown, m: string) => { if (!c) { fail++; console.log('FAIL', m); } };

for (const m of MAPS) { ok(!validateMap(m), 'valid ' + m.id); const r = decodeMap(encodeMap(m)); ok(r && JSON.stringify(r.lanes) === JSON.stringify(m.lanes) && r.gold === m.gold, 'roundtrip ' + m.id); }
for (const bad of [null, 1, 'x', [], {}, { lanes: 'x' }, { lanes: [[[0, 0], [1e9, NaN]]], core: [5, 5] }, JSON.parse('{"__proto__":{"x":1},"lanes":[[[0,0]]],"core":[1,1]}'), { lanes: [Array(1000).fill([1, 1])], core: [3, 3] }])
  ok(sanitizeMap(bad) === null, 'reject ' + JSON.stringify(bad)?.slice(0, 40));
const evil = sanitizeMap({ ...MAPS[0], name: '<img src=x onerror=alert(1)>', gold: 1e12, lives: -5, towers: [{ t: 'nuke', cx: 1, cz: 1 }, { t: 'pulse', cx: 999, cz: -4 }], blocked: [[1e9, 2]] });
ok(evil && !/[<>=]/.test(evil.name) && evil.gold <= 3000 && evil.lives >= 1 && evil.towers.length === 1, 'sanitize evil ' + JSON.stringify(evil?.name));

// co-op replication round trip on a multi-lane map
const host = new Sim({ mode: 'coop', players: 2, pauseOnCards: false, seed: 3, map: MAPS[2] });
const cli = new Sim({ mode: 'coop', players: 2, pauseOnCards: false, seed: 3, map: MAPS[2] }); cli.replica = true;
const bot = new Bot(host, 0), bot2 = new Bot(host, 1);
for (let i = 0; i < 60 * 240; i++) {
  bot.step(1 / 60); bot2.step(1 / 60); host.step(1 / 60);
  if (i % 5 === 0) { cli.applySnapshot(JSON.parse(JSON.stringify(host.snapshot(host.events.splice(0))))); cli.events.length = 0; }
}
cli.applySnapshot(JSON.parse(JSON.stringify(host.snapshot(host.events.splice(0))))); cli.events.length = 0; // compare against the state of the very last step
ok(cli.wave === host.wave && cli.enemies.length === host.enemies.length && cli.towers.length === host.towers.length && Math.floor(cli.gold) === Math.floor(host.gold), `replica in sync (wave ${host.wave}, ${host.towers.length} towers)`);
ok(host.wave >= 5, 'coop progressed to wave ' + host.wave);
{
  // the new state is replicated: specials, elevation, wave intel, missiles, events
  const raised = hill;
  const h2 = new Sim({ mode: 'coop', players: 2, pauseOnCards: false, seed: 11, map: raised, diff: 'hard' });
  const c2 = new Sim({ mode: 'coop', players: 2, pauseOnCards: false, seed: 999, map: raised }); c2.replica = true;
  h2.gold = 1e5; h2.unlocked.add('missile'); h2.unlocked.add('flame');
  const spots: [number, number][] = []; for (let i = 0; i < GW * GH && spots.length < 400; i++) if (h2.grid[i] === 0) spots.push([i % GW, Math.floor(i / GW)]);
  const road = (cx: number, cz: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => cx + dx >= 0 && cx + dx < GW && cz + dz >= 0 && cz + dz < GH && h2.map.grid[(cz + dz) * GW + cx + dx] === 1);
  spots.filter(([cx, cz]) => road(cx, cz)).filter((_, i) => i % 4 === 0).slice(0, 24).forEach(([cx, cz], i) => h2.build((['missile', 'flame', 'pulse'] as const)[i % 3], cx, cz));
  let hostGy = 0;
  // two pylons next to the first turret so there is a wall of fire to replicate
  { const f = spots.filter(([cx, cz]) => h2.grid[cz * GW + cx] === 0 && road(cx, cz)); const a = f[0], b = f.find(([cx, cz]) => { const d = hexDist(a[0], a[1], cx, cz); return d >= 2 && d <= LINK_RANGE; })!; h2.build('flame', a[0], a[1]); h2.build('flame', b[0], b[1]); }
  ok(h2.walls.length >= 1, 'the host has a wall of fire (' + h2.walls.length + ')');
  const kinds = new Set<string>(); let sawMissile = false, sawGy = false, sawDown = false, sawCharge = false, same = true, wallsSame = true, sawHot = false, sawOff = false;
  for (let i = 0; i < 60 * 120 && !h2.over; i++) {
    h2.players.forEach((p) => { p.pending.length = 0; });
    if (i === 60 * 40) for (const t of h2.towers) { t.charge = 1; h2.triggerSpecial(t.id, 0); }
    h2.step(1 / 60);
    for (const e of h2.enemies) hostGy = Math.max(hostGy, e.gy);
    if (i % 4 === 0) {
      c2.applySnapshot(JSON.parse(JSON.stringify(h2.snapshot(h2.events.splice(0)))));
      for (const e of c2.events.splice(0)) kinds.add(e.k);
      if (c2.projs.some((p) => p.kind === 'missile')) sawMissile = true;
      c2.towers.forEach((t, k) => { const o = h2.towers[k]; if (Math.abs(t.charge - o.charge) > 0.011 || Math.abs(t.down - o.down) > 0.011 || Math.abs(t.spec - o.spec) > 0.011) same = false; if (t.down > 0) sawDown = true; if (t.charge > 0 && t.charge < 1) sawCharge = true; });
      c2.enemies.forEach((e, k) => { const o = h2.enemies[k]; if (Math.abs(e.gy - o.gy) > 0.011 || Math.abs(e.y - o.y) > 0.011) same = false; if (e.gy > 0.5) sawGy = true; });
      if (JSON.stringify(c2.preview) !== JSON.stringify(h2.preview) || c2.winWave !== h2.winWave || c2.spires !== h2.spires) same = false;
      if (JSON.stringify(c2.walls.map((w) => [w.a, w.b, w.ax, w.az, w.bx, w.bz])) !== JSON.stringify(h2.walls.map((w) => [w.a, w.b, w.ax, w.az, w.bx, w.bz]))) wallsSame = false;
      if (c2.walls.some((w) => w.hot)) sawHot = true;
      if (c2.walls.some((w) => !w.on)) sawOff = true;
    }
  }
  ok(same, 'replica matches the host on charge/down/spec, enemy height, preview, winWave');
  ok(c2.winWave === 30, 'winWave replicated from the host difficulty');
  ok(sawMissile && sawDown && sawCharge, `replica saw missiles, charging and offline towers (${sawMissile} ${sawDown} ${sawCharge})`);
  ok(sawGy, `replica saw raised enemies (map ${raised.id}, host max height ${hostGy})`);
  ok(kinds.has('special') && kinds.has('down') && !kinds.has('flame'), 'new events reach the replica: ' + [...kinds].join(','));
  ok(wallsSame && c2.walls.length === h2.walls.length && c2.walls.length >= 1, 'the replica rebuilds the same walls of fire');
  ok(sawHot && sawOff, `the replica saw a wall hot during an Inferno and off while a pylon rebooted (${sawHot} ${sawOff})`);
}
// hostile snapshots / inputs must not throw
for (const junk of [null, {}, { a: [], e: 'x' }, { a: [NaN], e: [[1, 99, 'a']], t: [[1, 0, -5, 9e9]], p: [[]], z: [[1, 7]], pl: [[], 5], ev: [{ k: 5 }, null] }]) { try { cli.applySnapshot(junk); } catch (e) { ok(false, 'snapshot threw ' + e); } }
for (const junk of [
  { a: [0, 1e99, -5, 'x', {}, [], null, 1, 2, 3, 4, 5, 6, 1e9, 'y'], u: [-1, 99, 'pulse', 1.5], e: [[1, 5, 1e99, -1e99, NaN, 1, 0, 0, 1, 1e9, 'zz'], [2, -1], [3, '__proto__']], t: [[1, 10, 2, 2, 99, 0, 1e9, 0, 55, -3, 1e9, NaN], [2, 'spire', 1, 1], [3, 0, 2, 2, 1, 0, 0, 0, 'a', {}, [], null]], p: [[1, 3, NaN], [2, 99]], z: [], pl: [[1e9, 1, 'x', {}, [], NaN, 0, 'cds', ['__proto__', 'constructor', 'overclock', 5], 1e9, -4]], w: [1e99, [[[5, 1e9], [99, 1], ['__proto__', 2], 7, [0, -5], [0, 3]], 'x', [[1, 1]], [[2, 2]], [[3, 3]]]], ev: [{ k: 'special', id: {}, t: ['x'], x: 1e999, __proto__: { polluted: 1 }, nested: { a: 1 }, long: 'x'.repeat(100) }, { k: 'x'.repeat(50) }, 'str', 5, [], { k: 'arc', p: Array(5000).fill(1) }] },
  { a: [], e: [], t: [], p: [], z: [], pl: [], w: 'x', ev: 'y' }, { a: [], e: [], t: [], p: [], z: [], pl: [], w: [1, null] },
]) { try { cli.applySnapshot(junk); } catch (e) { ok(false, 'snapshot threw ' + e); } }
ok(cli.towers.every((t) => t.charge >= 0 && t.charge <= 1 && t.down >= 0 && t.spec >= 0 && Number.isFinite(t.down + t.spec + t.heat)) && cli.enemies.every((e) => Number.isFinite(e.x + e.z + e.gy + e.y)), 'junk snapshot is clamped');
ok(cli.preview.lanes.length === cli.map.lanes.length && cli.preview.lanes.every((l) => l.length <= 6 && l.every((o) => Object.hasOwn(ENEMIES, o.type) && o.n >= 0 && o.n <= 999)) && Number.isFinite(cli.preview.wave), 'junk preview is sanitised');
ok(cli.events.every((e) => typeof e.k === 'string' && e.k.length <= 16 && Object.values(e).every((v) => typeof v !== 'object' || (Array.isArray(v) && v.length <= 96))) && ({} as Record<string, unknown>).polluted === undefined, 'junk events are sanitised');
cli.events.length = 0;
for (const v of [NaN, -1, 1e9, 2.5, Infinity]) { host.triggerSpecial(v, v); host.activateHero(0, v); host.nearestSpire(v); }
for (const v of [NaN, -1, 1e9, 2.5]) { host.build('pulse', v, v); host.upgrade(v); host.sell(v); host.pickCard(1, v); host.activateHero(1, v); host.heroTeleport(1, v); host.heroFire(1, v, v, v); host.heroAim(1, v as unknown as boolean, v, v, v); host.heroAim(1, true, v, v, v); host.heroAim(1, false, v, v, v); host.heroSkill(1, v, v, v, v); }
host.step(1 / 60);
ok(Number.isFinite(host.gold) && host.enemies.every((e) => Number.isFinite(e.x)), 'host state finite after junk input');

// ---------- Uplink Spires ----------
const V = { x: 0, y: 0, z: 0 };
const bare: MapDef = { ...MAPS[0], towers: [] };
{
  for (const m of MAPS) ok(new Sim({ seed: 1, map: m }).spires >= 1, 'map has a spire: ' + m.id);
  const a = new Sim({ seed: 1, map: bare, pauseOnCards: false }), b = new Sim({ seed: 77, map: bare });
  const sp = a.towers.find((t) => t.type === 'spire')!;
  ok(sp && a.spires === 1 && a.towers.length === 1, 'a map without a spire gets one for free');
  ok(sp.cx === b.towers[0].cx && sp.cz === b.towers[0].cz, 'spire placement is deterministic');
  ok(Math.max(Math.abs(sp.cx - bare.core[0]), Math.abs(sp.cz - bare.core[1])) > 2, 'spire is not adjacent to the core');
  ok(sp.h === TOWER_H.spire && standY(sp) === sp.h, 'standY of a spire is its height');
  ok(!a.sell(sp.id) && a.sellBlock(sp) === 'last', 'the last spire cannot be sold');
  a.gold = 5000;
  let free: [number, number] = [0, 0], free2: [number, number] = [0, 0];
  for (let i = 0, n = 0; i < GW * GH && n < 2; i++) if (a.grid[i] === 0) { if (n++ === 0) free = [i % GW, Math.floor(i / GW)]; else free2 = [i % GW, Math.floor(i / GW)]; }
  const pulse = a.build('pulse', free[0], free[1])!;
  ok(a.unlocked.has('spire'), 'spires are unlocked from the start');
  const sp2 = a.build('spire', free2[0], free2[1])!;
  ok(pulse && sp2 && a.spires === 2, 'a second spire can be built');
  a.players[0].energy = MAX_ENERGY;
  ok(a.activateHero(0, pulse.id) && a.towerById(a.players[0].heroTower)!.type === 'spire', 'uplink to a turret resolves to the nearest spire');
  const on = a.players[0].heroTower, o = a.heroOrigin(0)!;
  ok(Math.abs(o.y - (standY(a.towerById(on)!) + 0.62)) < 1e-9, 'hero stands on top of the spire');
  ok(!a.heroTeleport(0, pulse.id) && a.players[0].heroTower === on, 'teleport to a turret is refused');
  ok(!a.sell(on), 'a spire with Kestrel on it cannot be sold');
  const other = on === sp.id ? sp2 : sp;
  ok(a.heroTeleport(0, other.id) && a.players[0].heroTower === other.id, 'teleport between spires');
  ok(a.sell(on) && a.spires === 1 && !a.sell(other.id), 'the spare spire can be sold, the last one cannot');
  a.exitHero(0); a.players[0].energy = MAX_ENERGY;
  ok(a.activateHero(0, 987654) && a.players[0].heroTower === other.id, 'uplink with an unknown id uses a spire');
  const before = a.projs.length; a.step(1 / 60);
  ok(a.towers.every((t) => t.type !== 'spire' || t.charge === 0) && a.projs.length === before, 'spires do not attack or charge');
}

// ---------- tower special through the power node, weak points, wave intel, elevation ----------
{
  const s = new Sim({ seed: 5, map: bare, pauseOnCards: false });
  s.gold = 5000;
  // a pulse turret next to the first stretch of road
  const turret = s.build('pulse', 3, 5)!;
  ok(!!turret, 'built a turret beside the road');
  const evs: Ev[] = [];
  const run = (n: number, each?: () => void) => { for (let i = 0; i < n; i++) { if (each) each(); s.step(1 / 60); evs.push(...s.events.splice(0)); s.players[0].pending.length = 0; } };
  // wave intel: what was previewed is exactly what gets released
  for (let w = 1; w <= 3; w++) {
    const pv = JSON.stringify(s.preview);
    s.queue.length = 0; s.startWave();
    const lanes: { type: string; n: number }[][] = s.map.lanes.map(() => []);
    for (const q of s.queue) { const f = lanes[q.lane].find((x) => x.type === q.type); if (f) f.n++; else lanes[q.lane].push({ type: q.type, n: 1 }); }
    ok(pv === JSON.stringify({ wave: w, lanes }), 'preview matches released wave ' + w);
    ok(s.preview.wave === w + 1 && s.preview.lanes.length === s.map.lanes.length, 'next wave is previewed');
  }
  turret.charge = 0.5; run(60);
  ok(turret.charge > 0.5 && turret.charge < 1, 'special charges over time');
  turret.charge = 1;
  s.players[0].energy = MAX_ENERGY; ok(s.activateHero(0, 0), 'uplink');
  s.players[0].heroTime = s.players[0].heroDur = 600;
  const o = s.heroOrigin(0)!;
  ok(s.specialReady(turret) && !s.triggerSpecial(turret.id, 0) || s.enemies.some((e) => Math.hypot(e.x - turret.x, e.z - turret.z) < 10), 'a special with nothing to hit is not wasted');
  // wait for the wave to reach the turret, then put an arrow through its node
  run(60 * 30, () => { if (s.specialReady(turret) && s.enemies.some((e) => Math.hypot(e.x - turret.x, e.z - turret.z) < s.range(turret))) { nodePos(turret, V); s.heroFire(0, V.x, V.y, V.z); } });
  ok(Math.abs(nodePos(turret, V).y - (turret.h + 0.55)) < 1e-9 && NODE_R === 0.6, 'node position');
  const iSpec = evs.findIndex((e) => e.k === 'special' && e.id === turret.id && e.t === 'pulse'), iDown = evs.findIndex((e) => e.k === 'down' && e.id === turret.id), iUp = evs.findIndex((e) => e.k === 'up' && e.id === turret.id);
  ok(iSpec >= 0, 'an arrow through the node fires the special');
  ok(iDown > iSpec && iUp > iDown, 'the tower goes offline after the special and comes back');
  ok(turret.down === 0 && turret.spec === 0 && turret.charge > 0 && turret.charge < 1, 'back online, charging from zero');
  ok(!s.triggerSpecial(turret.id, 0), 'an uncharged special cannot be fired');
  // weak point: a Colossus walks in; arrows at its weak point crit
  evs.length = 0; s.enemies.length = 0; s.queue.length = 0;
  (s as unknown as { spawn(t: string, m: number, l: number): void }).spawn('boss', 50, 0);
  const boss = s.enemies[0];
  ok(boss && boss.type === 'boss', 'boss spawned');
  boss.dist = 20; boss.armor = 0;
  const base = s.arrowDmg(s.players[0]);
  run(60 * 6, () => {
    const w = weakPos(boss, 1, V)!; // the front-top weak point, visible from a spire
    const T = Math.hypot(w.x - o.x, w.y - o.y, w.z - o.z) / ARROW_SPEED;
    s.heroFire(0, w.x + Math.sin(boss.yaw) * boss.speed * T, w.y, w.z + Math.cos(boss.yaw) * boss.speed * T);
  });
  const crit = evs.find((e) => e.k === 'crit');
  ok(!!crit && crit.n >= base * FULL_DRAW_MUL * ENEMIES.boss.weak![1].mul * 0.99, `weak-point hit crits (${crit?.n} vs ${base * FULL_DRAW_MUL} per full-draw arrow)`);
  ok(ENEMY_SCALE.boss === 0.95 && ENEMIES.boss.r === 1.6 && weakPos(boss, 5, V) === null && Math.abs(weakPos(boss, 0, V)!.y - (boss.gy + ENEMIES.boss.weak![0].y * 0.95)) < 1e-9, 'weak points scale with the smaller Colossus');
  run(60, () => {}); // let arrows in flight land
  evs.length = 0;
  // aim at a part of the hull where no weak point is in the way
  const hull = () => {
    const vx = boss.x - o.x, vz = boss.z - o.z, vl = Math.hypot(vx, vz);
    for (const k of [0, 0.6, -0.6, 1.2, -1.2, 1.7, -1.7]) for (const dy of [0, -0.8, 0.8]) {
      const p = { x: boss.x + (vz / vl) * k, y: boss.y + dy, z: boss.z - (vx / vl) * k };
      const dx = p.x - o.x, dy2 = p.y - o.y, dz = p.z - o.z, L = Math.hypot(dx, dy2, dz);
      if (raySphere(o.x, o.y, o.z, dx / L, dy2 / L, dz / L, boss.x, boss.y, boss.z, boss.r) < 0) continue;
      if ([0, 1].every((i) => { const w = weakPos(boss, i, V)!; return raySphere(o.x, o.y, o.z, dx / L, dy2 / L, dz / L, w.x, w.y, w.z, ENEMIES.boss.weak![i].r * ENEMY_SCALE.boss + 0.5) < 0; })) return p;
    }
    return null;
  };
  let hullShots = 0;
  run(60 * 3, () => { const p = hull(); if (p && s.players[0].fireCd <= 0) { hullShots++; s.heroFire(0, p.x, p.y, p.z); } });
  ok(hullShots > 3, 'found a clear line to the hull');
  ok(!evs.some((e) => e.k === 'crit') && evs.some((e) => e.k === 'dmg'), 'body hits do not crit');
  // no aim assistance: an arrow that passes beside the hull misses
  evs.length = 0;
  run(60, () => {}); // let arrows in flight land
  evs.length = 0;
  run(60 * 2, () => { const vx = boss.x - o.x, vz = boss.z - o.z, vl = Math.hypot(vx, vz), k = boss.r + ARROW_PAD + 1.6; s.heroFire(0, boss.x + (vz / vl) * k, boss.y, boss.z - (vx / vl) * k); });
  ok(!evs.some((e) => e.k === 'dmg' || e.k === 'crit'), 'no aim assist: near misses miss');
}
{
  // elevation: a road that climbs to level 2 and comes back down
  ok(!validateMap(hill), 'raised map is valid');
  const s = new Sim({ seed: 2, map: hill, pauseOnCards: false });
  s.startWave();
  let top = 0, bad = 0;
  for (let i = 0; i < 60 * 25; i++) { s.step(1 / 60); for (const e of s.enemies) { top = Math.max(top, e.gy); if (Math.abs(e.y - (e.gy + ENEMIES[e.type].y)) > 1e-9 || e.gy < 0) bad++; } }
  ok(Math.abs(top - 3.2) < 1e-6 && !bad, `enemies follow the road height (top ${top})`);
}
{
  // every new tower works: flame, lance, missile, gravity fire, emit their events and stay finite
  const s = new Sim({ seed: 8, map: bare, pauseOnCards: false });
  s.gold = 1e5; for (const t of ['flame', 'lance', 'missile', 'gravity', 'arc', 'mortar', 'rail', 'beacon'] as const) s.unlocked.add(t);
  const cells: [number, number][] = [[3, 5], [4, 5], [6, 5], [7, 7], [8, 9], [6, 11], [8, 12], [8, 14], [11, 14], [13, 9]]; // free tiles along Switchback's road
  (['flame', 'lance', 'missile', 'gravity', 'flame', 'lance', 'missile', 'gravity', 'beacon', 'mortar'] as const).forEach((t, i) => ok(!!s.build(t, cells[i][0], cells[i][1]), 'build ' + t));
  const seen = new Set<string>(); let missile = false, specials = 0;
  for (let i = 0; i < 60 * 150 && !s.over; i++) {
    s.players[0].pending.length = 0;
    if (i % 600 === 0) for (const t of s.towers) if (s.specialReady(t) && s.triggerSpecial(t.id, 0)) specials++;
    s.step(1 / 60);
    for (const e of s.events.splice(0)) seen.add(e.k);
    if (s.projs.some((p) => p.kind === 'missile')) missile = true;
  }
  for (const k of ['lance', 'gravity', 'special', 'down', 'up']) ok(seen.has(k), 'event ' + k);
  ok(!seen.has('flame') && !seen.has('siege'), 'the old flame and siege events are gone');
  ok(missile, 'missile projectiles fly');
  ok(specials >= 4, 'specials of the new towers fire (' + specials + ')');
  ok(s.enemies.every((e) => Number.isFinite(e.x + e.z + e.y + e.hp + e.dist)) && s.projs.every((p) => Number.isFinite(p.x + p.y + p.z)), 'state stays finite with the new towers');
  // cards: the pool is sane and blueprints are offered at the early levels
  ok(new Set(CARDS.map((c) => c.id)).size === CARDS.length && CARDS.every((c) => !c.needs || Object.hasOwn(TOWERS, c.needs)), 'card ids unique');
  const c = new Sim({ seed: 4, map: bare });
  for (const lvl of [2, 3, 5, 7, 9, 11, 13]) { c.level = lvl; ok(c.rollCards(0).some((id) => id.startsWith('bp_')), 'blueprint offered at level ' + lvl); }
  ok(new Sim({ diff: 'easy' }).winWave === 20 && new Sim({ diff: 'normal' }).winWave === 25 && new Sim({ diff: 'hard' }).winWave === 30, 'waves per difficulty');
}


// ---------- regression checks for the review findings ----------
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv = (s: Sim) => s as any;
  const mk = (o: Partial<ConstructorParameters<typeof Sim>[0]> = {}) => { const s = new Sim({ seed: 21, map: bare, pauseOnCards: false, ...o }); s.gold = 1e6; s.nextWaveIn = 1e9; for (const t of TOWER_TYPES) s.unlocked.add(t); return s; };
  /** A stationary enemy with a huge health pool at a lane distance. */
  const put = (s: Sim, type: string, dist: number, lane = 0, speed = 0): Enemy => { priv(s).spawn(type, 1e6, lane); const e = s.enemies[s.enemies.length - 1]; e.speed = speed; e.dist = dist; e.off = 0; e.armor = 0; priv(s).place(e); return e; };
  const run = (s: Sim, sec: number, each?: (evs: Ev[]) => void) => { for (let i = 0; i < Math.round(sec * 60); i++) { s.step(1 / 60); const evs = s.events.splice(0); if (each) each(evs); s.players.forEach((p) => { p.pending.length = 0; }); } };
  const shots = (s: Sim, id: number, sec: number) => { let n = 0; run(s, sec, (evs) => { for (const e of evs) if (e.k === 'shot' && e.id === id) n++; }); return n; };
  {
    // fire rate: the cooldown carries over, so fast turrets and Bullet Storm deliver their full rate
    const s = mk(), t = s.build('pulse', 3, 5)!; put(s, 'grunt', 10);
    t.lvl = 3; s.mods.tRate = 1.15 ** 6; s.mods.tw.pulse.rate = 1.2 ** 3;
    const rate = s.towerRate(t);
    run(s, 1);
    const n = shots(s, t.id, 10);
    ok(rate > 15 && Math.abs(n - rate * 10) <= 1.5, `pulse fires at its rate (${n} shots in 10 s at ${rate.toFixed(2)}/s)`);
    t.charge = 1; ok(s.triggerSpecial(t.id, 0), 'storm fires');
    const m = shots(s, t.id, 4);
    ok(rate * 5 > 60 && Math.abs(m - rate * 5 * 4) <= rate * 5 * 4 * 0.02 + 1, `Bullet Storm is five times as fast (${m} shots in 4 s, expected ${(rate * 20).toFixed(0)})`);
    const s2 = mk(), l = s2.build('lance', 3, 5)!; put(s2, 'grunt', 10);
    run(s2, 1); let beams = 0; run(s2, 10, (evs) => { for (const e of evs) if (e.k === 'lance' && e.id === l.id) beams++; });
    ok(Math.abs(beams - s2.towerRate(l) * 10) <= 1, `lance ticks at its rate (${beams} in 10 s)`);
  }
  {
    // specials need a target the tower could actually shoot
    for (const type of ['pulse', 'lance'] as const) {
      const s = mk(), t = s.build(type, 3, 5)!;
      // the turret sits one row below the first stretch of road, level with distance 11 along it
      const off = Math.abs(t.z - s.map.lanes[0].pts[0][1]), r = s.range(t), d = r + 1.2, e = put(s, 'boss', 11 - Math.sqrt(d * d - off * off));
      t.charge = 1;
      ok(Math.hypot(e.x - t.x, e.z - t.z) > r && !s.triggerSpecial(t.id, 0) && t.charge === 1 && t.down === 0, type + ' special is refused when nothing is in firing range (charge kept)');
      e.dist = 10; priv(s).place(e);
      ok(s.triggerSpecial(t.id, 0), type + ' special fires with a target in range');
    }
  }
  {
    // Collapse (and any singularity) never hurries enemies along the road
    const s = mk(), g = s.build('gravity', 3, 5)!; g.cd = 1e9; g.charge = 1;
    put(s, 'brute', 12);
    const pack = [8, 9, 10, 11].map((d) => put(s, 'grunt', d, 0, 2));
    ok(s.triggerSpecial(g.id, 0), 'Collapse fires');
    let worst = -Infinity;
    for (let i = 1; i <= 150; i++) { s.step(1 / 60); pack.forEach((e, k) => { worst = Math.max(worst, e.dist - (8 + k + 2 * i / 60)); }); }
    ok(worst <= 1e-6, `Collapse never moves an enemy forward faster than it walks (worst lead ${worst.toFixed(3)})`);
    ok(pack.every((e, k) => e.dist < 8 + k + 2 * 2.5 - 1), 'Collapse holds the pack back');
  }
  {
    // a strong burn is not kept alive by a weaker one: the weaker burn waits underneath and takes over
    const s = mk(), e = put(s, 'grunt', 10);
    priv(s).burn(e, 40, 2); priv(s).burn(e, 10, 6);
    ok(e.burnD === 40 && Math.abs(e.burnT - 2) < 1e-9, 'a weaker burn does not replace or extend a stronger one');
    run(s, 2.2);
    ok(e.burnD === 10 && e.burnT > 3, `the burn falls back to the weaker strength (${e.burnD} for ${e.burnT.toFixed(1)} s)`);
    run(s, 5);
    ok(e.burnT <= 0 && e.burnD === 0 && e.burn2T <= 0, 'burn ends when nothing refreshes it');
  }
  {
    // blasts stay on their own deck: a bridge shields the road under it
    const hl = MAPS.find((m) => m.id === 'highline')!;
    const s = mk({ map: hl });
    const up = put(s, 'grunt', 14, 1), low = put(s, 'grunt', 38, 0); // the bridge tile: 7 tiles down road 2, 19 tiles along road 1
    ok(Math.hypot(up.x - low.x, up.z - low.z) < 1 && up.gy - low.gy > DECK_GAP, `test enemies are above each other (gap ${(up.gy - low.gy).toFixed(1)})`);
    const hp = () => [up.maxHp - up.hp, low.maxHp - low.hp];
    priv(s).aoe(up.x, up.z, 2.8, 50, -1, true, up.gy);
    ok(hp()[0] === 50 && hp()[1] === 0, 'a blast on the bridge does not hit the road below');
    priv(s).aoe(low.x, low.z, 2.8, 50, -1, true, low.gy);
    ok(hp()[0] === 50 && hp()[1] === 50, 'a blast under the bridge does not hit the bridge');
    priv(s).arrowHit({ dmg: 10, aoe: 1.5, owner: 0, tier: 0, chain: 0 }, up.x, up.y, up.z, up, 1);
    ok(hp()[0] === 60 && hp()[1] === 50, 'an exploding arrow stays on its deck');
    // a mortar shell fired at the bridge
    const m = s.build('mortar', ...((): [number, number] => { for (let i = 0; i < GW * GH; i++) { const cx = i % GW, cz = Math.floor(i / GW); const d = Math.hypot((cx - GW / 2 + 0.5) * 2 - up.x, (cz - GH / 2 + 0.5) * 2 - up.z); if (s.grid[i] === 0 && d > 4 && d < 9) return [cx, cz]; } return [0, 0]; })())!;
    low.speed = 0; const before = hp();
    m.cd = 0; run(s, 3);
    const after = hp();
    ok(!!m && (after[0] > before[0]) !== (after[1] > before[1]), `a mortar shell hits one deck only (${after[0] - before[0]} / ${after[1] - before[1]})`);
  }
  {
    // Aftershock covers Bullet Storm and Surge too
    const storm = (pow: number) => { const s = mk(), t = s.build('pulse', 3, 5)!, e = put(s, 'grunt', 10); s.mods.specPow = pow; t.charge = 1; s.triggerSpecial(t.id, 0); run(s, 4.9); return e.maxHp - e.hp; };
    const d1 = storm(1), d2 = storm(2);
    ok(Math.abs(d2 / d1 - 2) < 0.05, `Aftershock scales Bullet Storm (${d1.toFixed(0)} -> ${d2.toFixed(0)})`);
    const s = mk(), bc = s.build('beacon', 3, 5)!; s.mods.specPow = 1.25; bc.charge = 1;
    ok(s.triggerSpecial(bc.id, 0) && Math.abs(bc.spec - 10) < 1e-9, 'Aftershock makes Surge last longer');
  }
  {
    // Deep Well: every stack and every level adds drag
    const pull = (lvl: number, stacks: number) => { const s = mk(), g = s.build('gravity', 3, 5)!; g.lvl = lvl; g.cd = 0; s.mods.gravPull = stacks; const e = put(s, 'grunt', 10, 0, 3); s.step(1 / 60); return e.pull; };
    let mono = true;
    for (let lvl = 1; lvl <= 3; lvl++) for (let st = 0; st <= CARD_BY_ID.g_deep.max; st++) {
      if (st > 0 && pull(lvl, st) < pull(lvl, st - 1) * 1.1) mono = false;
      if (lvl > 1 && pull(lvl, st) <= pull(lvl - 1, st)) mono = false;
    }
    ok(mono && CARD_BY_ID.g_deep.max === 2, 'every Deep Well stack and every Graviton level drags further');
  }
  {
    // the core fights back: an enemy that reaches it stops and attacks; the damage lands when its timer runs out, and the discharge destroys it
    const s = mk(); const len = s.map.lanes[0].len;
    const evs: Ev[] = []; const each = (e: Ev[]) => { evs.push(...e); };
    const g = put(s, 'grunt', len - 0.2, 0, 3);
    const start = s.lives;
    run(s, 0.2, each);
    ok(g.alive && g.breach > 0 && g.breach <= BREACH_TIME && Math.abs(g.dist - (len - (CORE_STAND + 0.6 * g.r))) < 1e-9 && s.lives === start && !evs.some((e) => e.k === 'leak'), 'an enemy at the core stops there before it hurts');
    run(s, BREACH_TIME + 0.1, each);
    const leak = evs.find((e) => e.k === 'leak'), br = evs.find((e) => e.k === 'breach');
    ok(!g.alive && !s.enemies.includes(g) && s.lives === start - ENEMIES.grunt.leak && s.leaked === 1, 'when the timer runs out the core takes the damage and the enemy is destroyed');
    ok(!!leak && leak.n === ENEMIES.grunt.leak && [leak.x, leak.y, leak.z].every(Number.isFinite) && !!br && br.id === g.id && br.t === 'grunt' && Math.abs(br.x - g.x) < 1e-9 && Math.abs(br.y - g.y) < 1e-9, 'leak and breach events carry the place and the enemy');
    // killing it in time prevents the damage (a breaching enemy can still be shot)
    const g2 = put(s, 'runner', len - 0.2, 0, 5); run(s, 0.3, each);
    ok(g2.breach > 0, 'second enemy is breaching');
    const kills = s.kills; s.damage(g2, 1e12, 0, true); run(s, 2, each);
    ok(!g2.alive && s.kills === kills + 1 && s.lives === start - ENEMIES.grunt.leak, 'destroying it before the timer runs out saves the core');
    // a frozen attacker does not get its blow in
    const g3 = put(s, 'grunt', len - 0.2, 0, 3); run(s, 0.2, each); g3.frz = 3; const left = g3.breach; run(s, 2, each);
    ok(g3.alive && Math.abs(g3.breach - left) < 1e-9 && s.lives === start - ENEMIES.grunt.leak, 'a frozen enemy at the core is held');
    s.damage(g3, 1e12, -1, true);
    // the Colossus takes longer and hits for a capped share of the core
    const budget = Math.min(ENEMIES.boss.leak, Math.ceil(s.maxLives * BREACH_SHARE));
    const boss = put(s, 'boss', len - 0.2, 0, 1.3); evs.length = 0;
    run(s, 0.5, each);
    ok(boss.alive && boss.breach > BREACH_TIME && boss.breach <= BREACH_TIME_BOSS && s.lives === start - ENEMIES.grunt.leak, 'the Colossus winds up for longer');
    const snap = JSON.parse(JSON.stringify(s.snapshot([]))); const c = mk(); c.replica = true; c.applySnapshot(snap);
    ok(c.enemies.length === 1 && Math.abs(c.enemies[0].breach - boss.breach) < 0.011, 'the breach timer reaches the replica');
    run(s, BREACH_TIME_BOSS, each);
    ok(!boss.alive && s.lives === start - ENEMIES.grunt.leak - budget && !s.over && evs.some((e) => e.k === 'breach' && e.t === 'boss') && evs.some((e) => e.k === 'leak' && e.n === budget), `a Colossus breach takes ${budget} of ${s.maxLives}`);
    ok(new Sim({ diff: 'hard', map: bare }).maxLives === 12 && Math.ceil(12 * BREACH_SHARE) === 3 && BREACH_TIME === 0.7 && BREACH_TIME_BOSS === 1.6, 'breach numbers');
  }
  {
    // the bow: draw, hold, release
    const s = mk(), p = s.players[0];
    p.energy = MAX_ENERGY; ok(s.activateHero(0, 0) && p.heroDur === HERO_DUR && HERO_DUR === 17.5, 'the Uplink lasts 17.5 s');
    p.heroTime = p.heroDur = 600; p.fireCd = 0;
    const o = s.heroOrigin(0)!, aim: [number, number, number] = [o.x + 30, o.y, o.z];
    const evs: Ev[] = [];
    const hold = (sec: number, down: boolean) => { for (let i = 0; i < Math.round(sec * 60); i++) { s.heroAim(0, down, ...aim); s.step(1 / 60); evs.push(...s.events.splice(0)); } };
    hold(DRAW_TIME / 2, true);
    ok(p.drawing && Math.abs(p.draw - 0.5) < 0.05, `half a draw after half the draw time (${p.draw.toFixed(2)})`);
    hold(DRAW_TIME / 2 + 0.05, true);
    ok(p.draw === 1, 'full draw after DRAW_TIME');
    hold(2, true);
    ok(p.draw === 1 && !s.projs.length && !evs.some((e) => e.k === 'arrow'), 'holding at full draw looses nothing: no auto-fire');
    hold(1 / 60, false);
    const full = s.projs.filter((q) => q.kind === 'arrow');
    const ev = evs.find((e) => e.k === 'arrow');
    ok(full.length === 1 && !p.drawing && p.draw === 0 && !!ev && ev.pw === 1 && ev.p === 0, 'letting go looses one arrow at full power');
    ok(Math.abs(full[0].dmg - s.arrowDmg(p) * FULL_DRAW_MUL) < 1e-9 && FULL_DRAW_MUL === 2.2 && full[0].pierce === 1 && Math.abs(Math.hypot(full[0].vx, full[0].vy, full[0].vz) - ARROW_SPEED) < 1e-6, 'a full draw is worth 2.2 stream arrows, pierces one more target and flies at full speed');
    hold(1, false); s.projs.length = 0; evs.length = 0;
    // a short pull is cancelled
    hold(MIN_DRAW * DRAW_TIME * 0.5, true); hold(1 / 60, false);
    ok(!s.projs.length && p.draw === 0, 'a pull shorter than MIN_DRAW is cancelled');
    hold(0.3, false);
    // half a draw is clearly worse than half the damage
    hold(DRAW_TIME / 2, true); const d = p.draw; hold(1 / 60, false);
    const half = s.projs.filter((q) => q.kind === 'arrow')[0];
    ok(!!half && d > 0.4 && d < 0.6 && Math.abs(half.dmg - s.arrowDmg(p) * FULL_DRAW_MUL * drawPower(d)) < 1e-9 && half.dmg < full[0].dmg * d * 0.8 && half.pierce === 0 && d < FULL_DRAW, `half a draw is worth ${(100 * half.dmg / full[0].dmg).toFixed(0)}% and does not pierce`);
    ok(Math.abs(Math.hypot(half.vx, half.vy, half.vz) - arrowSpeed(d)) < 1e-6 && arrowSpeed(d) < ARROW_SPEED && evs.some((e) => e.k === 'arrow' && Math.abs(e.pw - d) < 1e-9), 'a weak draw flies slower and reports its power');
    // the nock time: the next draw starts NOCK_TIME after a loose
    s.projs.length = 0; hold(NOCK_TIME * 0.5, true);
    ok(p.draw === 0 && p.drawing, 'no draw while the next arrow is nocked');
    hold(1, false);
    // heroFire is an instant full-power loose, then the bow needs its draw time again
    s.projs.length = 0; s.heroFire(0, ...aim);
    ok(s.projs.length === 1 && Math.abs(s.projs[0].dmg - full[0].dmg) < 1e-9 && Math.abs(p.fireCd - (NOCK_TIME + DRAW_TIME)) < 1e-9, 'heroFire looses at full power');
    s.heroFire(0, ...aim); ok(s.projs.length === 1, 'heroFire cannot stream arrows');
    hold(1, false); s.projs.length = 0;
    // cards per volley: Split Shot, Phase Tips, Quick Draw
    p.stats.arrows = 3; p.stats.pierce = 2; p.stats.rate = 1.25 * 1.25;
    hold(DRAW_TIME / 1.5625 + 0.03, true);
    ok(p.draw === 1, 'Quick Draw shortens the draw');
    hold(1 / 60, false);
    ok(s.projs.length === 3 && s.projs.every((q) => q.pierce === 3 && Math.abs(q.dmg - full[0].dmg) < 1e-9), 'Split Shot and Phase Tips apply to the loosed volley');
    // a skill takes the string
    hold(1, false); s.projs.length = 0; hold(DRAW_TIME / 1.5625 * 0.6, true); const before = p.draw;
    s.heroSkill(0, 0, ...aim);
    ok(before > 0.4 && p.draw === 0, 'a skill resets a draw in progress');
    // the draw is replicated
    hold(1, true); hold(0.1, true);
    const h = mk({ mode: 'coop', players: 2 }), c = mk({ mode: 'coop', players: 2 }); c.replica = true;
    h.players[1].energy = MAX_ENERGY; h.activateHero(1, 0); h.players[1].fireCd = 0;
    for (let i = 0; i < 12; i++) { h.heroAim(1, true, 5, 1, 5); h.step(1 / 60); }
    c.applySnapshot(JSON.parse(JSON.stringify(h.snapshot([]))));
    ok(c.players[1].drawing && Math.abs(c.players[1].draw - h.players[1].draw) < 0.011 && h.players[1].draw > 0.3, 'draw and drawing reach the replica');
    h.exitHero(1); ok(h.players[1].draw === 0 && !h.players[1].drawing, 'leaving the Uplink drops the draw');
    ok(BOW_TIERS.map((b) => b.color).join() === [0xe3dc92, 0x6fe0c8, 0xf68b56, 0xff5a3c, 0xfff2c4].join() && SING_COLOR !== 0xff2bd6, 'bow tiers use the Ember colours');
  }
  {
    // firewall: two pylons within link range burn a wall between them
    const s = mk(), cz = 5;
    // the first stretch of Switchback runs east along row 4; pylons go on rows 3 and 5, so the wall crosses the road
    const a = s.build('flame', 4, 3)!, b = s.build('flame', 4, 5)!;
    ok(!!a && !!b && s.walls.length === 1 && s.walls[0].on && !s.walls[0].hot && s.walls[0].a === a.id && s.walls[0].b === b.id, 'two pylons two tiles apart link into one wall');
    ok(JSON.stringify(computeWalls(s.towers, s.mods.flameLink)) === JSON.stringify(s.walls) && TOWERS.flame.name === 'Firewall Pylon' && s.range(a) === LINK_RANGE * 2, 'computeWalls is what the sim uses; the range is the link reach');
    const w = s.walls[0], mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
    const at = (x: number, z: number, type = 'grunt') => { const e = put(s, type, s.map.nearest(0, x, z)); return e; };
    const inside = at(mx, mz), outside = at(mx - WALL_HALF - ENEMIES.grunt.r - 0.6, mz), drone = at(mx, mz, 'drone');
    ok(Math.hypot(inside.x - mx, inside.z - mz) < 0.3, 'test enemy stands in the wall');
    run(s, 10);
    const dps = TOWERS.flame.dmg * TOWERS.flame.rate, took = (e: Enemy) => e.maxHp - e.hp;
    // direct heat for 10 s plus the burn it leaves (raw), within a tick of tolerance
    ok(took(inside) > dps * 10 * 0.95 && took(inside) < dps * 10 * 1.6 && inside.burnT > 0, `a wall deals the pylons' damage per second and sets alight (${took(inside).toFixed(0)} in 10 s at ${dps}/s)`);
    ok(took(outside) === 0 && outside.burnT <= 0, 'an enemy beside the wall is not touched');
    ok(Math.abs(took(drone) / took(inside) - 0.5) < 0.05, `flyers take half (${(took(drone) / took(inside)).toFixed(2)})`);
    // upgrades raise the damage
    const before = took(inside); s.upgrade(a.id); s.upgrade(b.id); run(s, 10);
    ok((took(inside) - before) / before > 1.5, 'upgraded pylons burn harder');
    // Inferno: 2.5 times as hard and wider, then the pylon reboots and its wall is off
    const edge = at(mx - WALL_HALF * 1.5 - ENEMIES.grunt.r, mz);
    ok(took(edge) === 0, 'edge enemy is outside the normal wall');
    a.charge = 1; const b0 = took(inside); run(s, 5); const normal = took(inside) - b0;
    a.charge = 1; ok(s.triggerSpecial(a.id, 0), 'Inferno fires'); run(s, 0.05);
    ok(s.walls[0].hot && s.wallHalf(s.walls[0]) > WALL_HALF * 1.5, 'the wall is hot and wider');
    const b1 = took(inside); run(s, 4.9); const hot = took(inside) - b1;
    ok(hot / normal > 2.2 && hot / normal < 2.8 && took(edge) > 0, `Inferno burns 2.5 times as hard and reaches further (${(hot / normal).toFixed(2)}x)`);
    run(s, 0.3);
    ok(a.down > 0 && !s.walls[0].on && !s.walls[0].hot, 'the wall is off while its pylon reboots');
    inside.burnT = 0; inside.burn2T = 0; const b2 = took(inside); run(s, 2);
    ok(took(inside) === b2, 'a wall that is off does not burn');
    run(s, 6); ok(s.walls[0].on, 'the wall comes back with the pylon');
    // nothing near: Inferno is refused with a nospec event and the charge is kept
    s.enemies.length = 0; a.charge = 1; a.down = 0; let no = 0;
    ok(!s.triggerSpecial(a.id, 0) && a.charge === 1 && s.events.some((e) => e.k === 'nospec' && e.id === a.id && Math.abs(e.y - (a.h + 0.55)) < 1e-9), 'a special with nothing to hit answers with nospec');
    s.events.length = 0; for (let i = 0; i < 20; i++) { s.triggerSpecial(a.id, 0); s.step(1 / 60); } for (const e of s.events.splice(0)) if (e.k === 'nospec') no++;
    ok(no <= 1, 'nospec is not spammed (' + no + ')');
    // link range: 4 tiles, 5 from level 3, one more per Long Conduits; each pylon keeps its two nearest links
    const far = (d: number, lvl: number, bonus: number) => { const q = mk(); q.mods.flameLink = bonus; const t = q.build('flame', 3, cz)!; t.lvl = lvl; q.build('flame', 3 + d, cz); return q.walls.length; };
    ok(far(4, 1, 0) === 1 && far(5, 1, 0) === 0 && far(5, 3, 0) === 1 && far(6, 3, 0) === 0 && far(5, 1, 1) === 1 && far(6, 1, 2) === 1 && far(7, 1, 2) === 0 && LINK_RANGE === 4, 'link range in tiles');
    const q = mk(); for (let i = 0; i < 6; i++) q.build('flame', 3 + i, 17);
    const n = new Map<number, number>(); for (const x of q.walls) { n.set(x.a, (n.get(x.a) || 0) + 1); n.set(x.b, (n.get(x.b) || 0) + 1); }
    ok(q.walls.length === 5 && [...n.values()].every((v) => v <= 2) && q.walls.every((x) => Math.hypot(x.ax - x.bx, x.az - x.bz) < 2.01), 'six pylons in a row make five short walls, two links each at most');
    const sold = q.towers.filter((t) => t.type === 'flame')[2]; q.sell(sold.id);
    ok(q.walls.length === 4 && q.walls.every((x) => x.a !== sold.id && x.b !== sold.id), 'selling a pylon relinks the rest');
    // a lone pylon burns a small ring, weaker than a wall
    const r = mk(), lone = r.build('flame', 4, 5)!;
    const near = put(r, 'grunt', r.map.nearest(0, lone.x, lone.z)), away = put(r, 'grunt', r.map.nearest(0, lone.x, lone.z) + FIRE_RING + ENEMIES.grunt.r + 1.5);
    ok(!r.walls.length && Math.hypot(near.x - lone.x, near.z - lone.z) <= FIRE_RING + ENEMIES.grunt.r, 'lone pylon beside the road');
    run(r, 10);
    ok(took(near) > 0 && took(near) < took(inside) && took(away) === 0 && took(near) > dps * 10 * 0.45, `a lone pylon burns a ring at half a wall's heat (${took(near).toFixed(0)} in 10 s)`);
    void b;
  }
  {
    // jumping between Spires by shooting the target above the other one
    const s = mk(), p = s.players[0];
    const s1 = s.towers.find((t) => t.type === 'spire')!, s2 = s.build('spire', 20, 17)!;
    p.energy = MAX_ENERGY; s.activateHero(0, s1.id); p.heroTime = p.heroDur = 600; p.fireCd = 0;
    const T = spireTarget(s2, { x: 0, y: 0, z: 0 });
    ok(Math.abs(T.y - (s2.h + 1.7)) < 1e-9 && T.x === s2.x && SPIRE_R === 0.75, 'spire target position');
    let tele = 0; const each = (evs: Ev[]) => { for (const e of evs) if (e.k === 'tele') tele++; };
    // a miss by more than the radius does nothing
    s.heroFire(0, T.x, T.y + SPIRE_R + 0.5, T.z); run(s, 1.2, each);
    ok(p.heroTower === s1.id && !tele, 'an arrow past the target does not jump');
    s.heroFire(0, T.x, T.y, T.z); run(s, 1.2, each);
    ok(p.heroTower === s2.id && tele === 1 && !s.projs.length, 'an arrow through the target of another Spire jumps there');
    // and back with the Rail Shot
    const T1 = spireTarget(s1, { x: 0, y: 0, z: 0 });
    s.heroSkill(0, 0, T1.x, T1.y, T1.z); run(s, 0.1, each);
    ok(p.heroTower === s1.id && tele === 2, 'the Rail Shot ray jumps too');
    ok(s.heroTeleport(0, s2.id) && p.heroTower === s2.id, 'the direct teleport still works');
  }
  {
    // the first wave waits 30 s and pays for an early call like every other wave
    const s = new Sim({ seed: 3, map: bare, pauseOnCards: false });
    ok(s.nextWaveIn === FIRST_WAVE_IN && FIRST_WAVE_IN === 30 && s.callBonus() === NEXT_WAVE_IN * 2, 'first wave in 30 s, early-call bonus ' + s.callBonus());
    const g = s.gold; s.startWave();
    ok(s.wave === 1 && s.gold === g + NEXT_WAVE_IN * 2 && s.callBonus() === 0 && s.nextWaveIn === NEXT_WAVE_IN, 'calling wave 1 early pays the bonus');
    const t = new Sim({ seed: 3, map: bare, pauseOnCards: false }); const g2 = t.gold;
    for (let i = 0; i < 60 * 31 && !t.wave; i++) t.step(1 / 60);
    ok(t.wave === 1 && Math.abs(t.time - FIRST_WAVE_IN) < 0.1 && t.gold === g2, 'left alone, wave 1 comes after 30 s without a bonus');
    s.queue.length = 0; s.nextWaveIn = 7.2;
    ok(s.callBonus() === 14, 'the bonus is two credits per second saved');
  }
  {
    // hero skills on a raised road sit on the deck (and the replica hears about it)
    const hl = MAPS.find((m) => m.id === 'highline')!;
    const s = mk({ map: hl }), p = s.players[0];
    const up = put(s, 'grunt', 14, 1), low = put(s, 'grunt', 12, 0);
    p.energy = MAX_ENERGY; s.activateHero(0, 0); p.heroTime = p.heroDur = 600;
    s.heroSkill(0, 1, up.x, up.gy, up.z); s.heroSkill(0, 2, low.x, low.gy, low.z);
    const rain = s.zones.find((z) => z.kind === 'rain')!, sing = s.zones.find((z) => z.kind === 'sing')!;
    ok(up.gy > 1 && Math.abs(rain.y - up.gy) < 0.4 && sing.y === low.gy, `Arrow Rain sits on the viaduct deck (${rain.y.toFixed(2)} vs ${up.gy.toFixed(2)}), Singularity on the ground road`);
    const sk = s.events.filter((e) => e.k === 'skill');
    ok(sk.length === 2 && Math.abs(sk[0].y - rain.y) < 1e-9, 'the skill event carries the deck height');
    const c = mk({ map: hl }); c.replica = true; c.applySnapshot(JSON.parse(JSON.stringify(s.snapshot([]))));
    ok(Math.abs(c.zones.find((z) => z.kind === 'rain')!.y - rain.y) < 0.011, 'zone height reaches the replica');
    let boomY = -1; run(s, 3, (evs) => { for (const e of evs) if (e.k === 'boom' && e.c === SING_COLOR) boomY = e.y; });
    ok(boomY === sing.y + 1, 'the collapse flash is at the zone height, in the singularity colour');
  }
  {
    // pulse cards: extra bolts are weaker
    const s = mk(), t = s.build('pulse', 3, 5)!; put(s, 'grunt', 10); s.mods.twin = 2; t.cd = 0; s.step(1 / 60);
    const b = s.projs.filter((p) => p.kind === 'bolt').map((p) => p.dmg);
    ok(b.length === 3 && Math.abs(b[1] / b[0] - TWIN_BOLT) < 1e-9 && TWIN_BOLT < 1, 'Twin Barrels bolts are weaker than the main bolt');
  }
  {
    // co-op: the shared tower cards are offered to one player per level, the other gets hero cards
    const s = mk({ mode: 'coop', players: 2 });
    for (let lv = 0; lv < 6; lv++) {
      s.xp = s.xpNext; const e = put(s, 'grunt', 5); s.damage(e, 1e12, -1, true);
      const full = s.level % 2, other = 1 - full;
      ok(s.players[full].pending.length === 1 && s.players[other].pending.length <= 1 && s.players[other].pending.every((o) => o.every((id) => CARD_BY_ID[id].kind === 'hero')), `co-op level ${s.level}: only player ${full} is offered shared cards`);
      s.players.forEach((_, i) => s.pickCard(i, 0));
      ok(s.players.every((p) => !p.pending.length), 'offers consumed');
    }
  }
  {
    // co-op scaling: the opening waves are the solo ones (two players share one purse), the full multiplier arrives later
    ok(coopScale(COOP_HP, 1) === 1 && coopScale(COOP_HP, TUNE.coopFrom) === 1 && Math.abs(coopScale(COOP_HP, TUNE.coopFrom + TUNE.coopRamp) - COOP_HP) < 1e-9 && coopScale(COOP_HP, 99) === COOP_HP && COOP_HP >= 2, 'co-op multiplier ramps in');
    const hpAt = (mode: 'solo' | 'coop', wave: number) => { const s = mk({ mode, players: mode === 'coop' ? 2 : 1 }); s.wave = wave; return put(s, 'grunt', 5).maxHp; };
    ok(hpAt('coop', 1) === hpAt('solo', 1) && Math.abs(hpAt('coop', 20) / hpAt('solo', 20) - COOP_HP) < 1e-9, 'co-op enemies: solo health in wave 1, COOP_HP times as much later');
    // Colossus plating: towers are blunted until a weak-point hit cracks it open
    const s = mk({}); const boss = put(s, 'boss', 5); boss.armor = 0;
    const plated = s.damage(boss, 100, -1), hero = s.damage(boss, 100, 0); boss.crackT = 1; const open = s.damage(boss, 100, -1);
    ok(Math.abs(plated - 100 * TUNE.plate) < 1e-9 && hero === 100 && Math.abs(open - 100 * TUNE.cracked) < 1e-9 && TUNE.plate < 1 && TUNE.cracked > 1, `plating: towers ${plated}, arrows ${hero}, cracked ${open}`);
  }
  {
    // snapshot: state events survive a flood of cosmetic ones, damage numbers are summed, modifiers are replicated
    const h = mk({ mode: 'coop', players: 2 }), c = mk({ mode: 'coop', players: 2 }); c.replica = true;
    const t = h.build('pulse', 3, 5)!;
    const flood: Ev[] = [{ k: 'heroOff', p: 1, x: 0, y: 0, z: 0 }];
    for (let i = 0; i < 400; i++) flood.push({ k: 'dmg', x: 0, y: 0, z: 0, n: 5, p: 1, id: 100 + (i % 200) });
    flood.push({ k: 'wave', n: 3 });
    for (let i = 0; i < 300; i++) flood.push({ k: 'hit', x: i, y: 0, z: 0, c: 1 });
    for (const k of ['heroOn', 'special', 'down', 'up', 'card', 'levelup', 'boss', 'tele', 'leak']) flood.push({ k, p: 1, id: 1 });
    for (let i = 0; i < 100; i++) flood.push({ k: 'boom', x: i, y: 0, z: 0, r: 1, c: 1 });
    const snap = JSON.parse(JSON.stringify(h.snapshot(flood)));
    const ks = snap.ev.map((e: Ev) => e.k);
    ok(['heroOff', 'wave', 'heroOn', 'special', 'down', 'up', 'card', 'levelup', 'boss', 'tele', 'leak'].every((k) => ks.includes(k) && MUST_EVENTS.has(k)), 'state events are never dropped from a snapshot');
    ok(snap.ev.length <= SNAP_EVENTS_MAX && snap.ev[snap.ev.length - 1].k === 'boom', `snapshot event budget (${snap.ev.length}), newest cosmetic events kept`);
    const agg = JSON.parse(JSON.stringify(h.snapshot([{ k: 'dmg', x: 0, y: 0, z: 0, n: 5, p: 1, id: 7 }, { k: 'dmg', x: 1, y: 0, z: 0, n: 6, p: 1, id: 7 }, { k: 'dmg', x: 0, y: 0, z: 0, n: 2, p: 0, id: 7 }]))).ev;
    ok(agg.length === 2 && agg[0].n === 11 && agg[0].x === 1 && agg[1].n === 2, 'damage numbers are summed per enemy and player');
    h.mods.tRange = 1.21; h.mods.tDmg = 1.44; h.mods.tRate = 1.15; h.mods.tw.pulse.dmg = 1.2; h.mods.tw.pulse.rate = 1.2; h.mods.beacon = 0.15;
    c.applySnapshot(JSON.parse(JSON.stringify(h.snapshot([]))));
    const ct = c.towerById(t.id)!;
    ok(!!ct && Math.abs(c.range(ct) - h.range(t)) < 0.01 && Math.abs(c.towerDmg(ct) - h.towerDmg(t)) < 0.05 && Math.abs(c.towerRate(ct) - h.towerRate(t)) < 0.02, 'card modifiers reach the guest (range, damage, rate)');
    ok(c.maxLives === h.maxLives, 'maxLives replicated');
    let withM = 0; for (let i = 0; i < 40; i++) if (h.snapshot([]).m) withM++;
    ok(withM >= 1 && withM <= 3, `modifiers are only resent now and then (${withM}/40)`);
    c.applySnapshot({ ...JSON.parse(JSON.stringify(h.snapshot([]))), m: Array(40).fill(NaN).map((_, i) => (i % 3 ? 1e9 : -5)) });
    ok(Number.isFinite(c.range(ct)) && c.range(ct) <= TOWERS.pulse.range * 1.16 * 100 * 100 && c.mods.tDmg >= 0.1 && c.mods.tw.rail.rate <= 100, 'hostile modifiers are clamped');
    // hostile host: duplicate cells / ids, towers on the road, event floods
    const base = JSON.parse(JSON.stringify(h.snapshot([])));
    const roadCell = h.map.grid.findIndex((v) => v === 1);
    const fr: number[] = []; h.map.grid.forEach((v, i) => { if (v === 0 && fr.length < 3) fr.push(i); });
    const fc = (k: number) => [fr[k] % GW, Math.floor(fr[k] / GW)];
    base.t = [[9001, 0, roadCell % GW, Math.floor(roadCell / GW), 1, 0, 0, 0, 0, 0, 0, 0], [77, 0, ...fc(1), 1, 0, 0, 0, 0, 0, 0, 0], [77, 1, ...fc(2), 1, 0, 0, 0, 0, 0, 0, 0], ...Array(5000).fill(0).map((_, i) => [1000 + i, 0, ...fc(0), 1, 0, 0, 0, 0, 0, 0, 0])];
    base.e = Array(5000).fill([5, 5, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
    base.ev = Array(399).fill({ k: 'arc', p: Array(96).fill(1) });
    c.events.length = 0; c.applySnapshot(base);
    ok(c.towers.length === 2 && c.towers.filter((x) => x.cx === fc(0)[0] && x.cz === fc(0)[1]).length === 1 && c.enemies.length === 1 && c.events.length <= SNAP_EVENTS_MAX, `hostile snapshot is bounded (${c.towers.length} towers, ${c.enemies.length} enemies, ${c.events.length} events)`);
  }
  {
    // ---------- the Gyre: a spinning rim that deflects hits ----------
    ok(ENEMY_TYPES.join() === 'grunt,runner,drone,shield,brute,boss,wheel', 'the Gyre is appended to the enemy types: ' + ENEMY_TYPES.join());
    const d = ENEMIES.wheel;
    ok(d.name === 'Gyre' && !d.fly && d.from === 9 && d.leak === 2 && Math.abs(d.r - 1.05) < 0.1 && Math.abs(d.y - 1.1) < 0.1 && ENEMY_SCALE.wheel === 1 && WHEEL_GUARD === 0.8, 'Gyre data follows the contract');
    const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
    const gyre = (sim: Sim, dist = 10, hp = 1000, speed = 0) => { const e = put(sim, 'wheel', dist, 0, speed); e.hp = e.maxHp = hp; return e; };
    const count = (evs: Ev[], k: string, id?: number) => evs.filter((e) => e.k === k && (id === undefined || e.id === id)).length;
    {
      // the guard, the throttled 'deflect' event, the half guard
      const s = mk(), g = gyre(s), other = put(s, 'grunt', 6);
      ok(g.spin === 1 && other.spin === 0 && paceOf(other) === other.speed, 'a Gyre starts at full spin, other types have none');
      const a = s.damage(g, 10, -1), evs = s.events.splice(0);
      ok(near(a, 10 * (1 - WHEEL_GUARD * 0.99)) && near(g.spin, 1 - (WHEEL_BLEED * 10) / 1000), `at full spin a hit is mostly deflected and bleeds spin (${a.toFixed(3)} of 10 through, spin ${g.spin})`);
      ok(count(evs, 'deflect') === 1 && evs.filter((e) => e.k === 'deflect').every((e) => near(e.x, g.x) && near(e.y, g.y) && near(e.z, g.z)), 'a deflected hit reports where');
      s.damage(g, 10, -1); s.damage(g, 10, -1);
      ok(count(s.events.splice(0), 'deflect') === 0, 'deflect events are throttled');
      ok(s.damage(other, 10, -1) === 10, 'other types are not guarded');
      const s2 = mk(), g2 = gyre(s2), b = s2.damage(g2, 10, -1, false, WHEEL_PIERCE);
      ok(near(b, 10 * (1 - WHEEL_GUARD * (1 - WHEEL_PIERCE) * 0.99)) && count(s2.events, 'deflect') === 0 && b > a * 2, `a piercing hit ignores half of the guard (${b.toFixed(3)} of 10)`);
    }
    {
      // spin loss follows the damage, not the number of hits; a hit larger than what stops the rim lands the rest in full
      const s3 = mk(), g3 = gyre(s3), s4 = mk(), g4 = gyre(s4);
      const big = s3.damage(g3, 300, -1); let small = 0; for (let i = 0; i < 30; i++) small += s4.damage(g4, 10, -1);
      ok(near(big, small, 1e-6) && near(g3.spin, g4.spin) && near(g3.spin, 1 - WHEEL_BLEED * 0.3), `one heavy hit and thirty light ones strip the same spin (${big.toFixed(1)} / ${small.toFixed(1)} through, spin ${g3.spin.toFixed(2)})`);
      const s5 = mk(), g5 = gyre(s5), stop = 1000 / WHEEL_BLEED, huge = s5.damage(g5, stop + 300, -1), evs = s5.events.splice(0);
      ok(near(huge, stop * (1 - WHEEL_GUARD * 0.5) + 300) && g5.spin === 0, `a hit that stops the rim lands the rest in full (${huge})`);
      ok(count(evs, 'spindown', g5.id) === 1 && count(evs, 'spinup') === 0, 'spindown is reported once when the spin falls below 0.25');
      ok(near(s5.damage(g5, 50, -1), 50), 'a stopped rim deflects nothing');
      // recovery: nothing for WHEEL_REST seconds after a hit, then WHEEL_SPINUP per second, 'spinup' above 0.6
      let up = 0, down = 0; const tally = (e: Ev[]) => { up += count(e, 'spinup', g5.id); down += count(e, 'spindown', g5.id); };
      run(s5, WHEEL_REST - 0.1, tally);
      ok(g5.spin === 0, 'no recovery right after a hit');
      run(s5, 0.1 + 1, tally);
      ok(near(g5.spin, WHEEL_SPINUP, 0.02) && up === 0, `left alone it spins back up (${g5.spin.toFixed(3)} after a second)`);
      run(s5, 1.5, tally);
      ok(up === 1 && down === 0 && g5.spin > 0.6, 'spinup is reported once when it recovers above 0.6');
      run(s5, 2, tally);
      ok(g5.spin === 1 && up === 1, 'and it reaches full spin again');
      // chip damage: half a percent of its health twice a second barely scratches the spin
      for (let i = 0; i < 20; i++) { s5.damage(g5, 5, -1); run(s5, 0.5); }
      ok(g5.spin > 0.75 && g5.hp > 1000 - 50 - 300 - stop * 0.6 - 30, `chip damage does not strip the rim (spin ${g5.spin.toFixed(2)})`);
      // a burn is not a hit: it does not stop the recovery
      const s6 = mk(), g6 = gyre(s6, 10, 1e6); g6.spin = 0.3; g6.burnT = 5; g6.burnD = 10;
      run(s6, 2);
      ok(g6.spin > 0.3 + WHEEL_SPINUP * 1.5 && g6.hp < 1e6, `a burning Gyre still spins back up (${g6.spin.toFixed(2)})`);
    }
    {
      // pace follows the spin; slows, wells, singularities and freezes take the spin away
      const s = mk(), g = gyre(s, 10, 1000, 4.4);
      ok(near(paceOf(g), 4.4), 'full pace at full spin');
      g.spin = 0; g.spinCd = 1e9;
      ok(near(paceOf(g), 4.4 * WHEEL_CRAWL), 'crawl pace with the rim stopped');
      const d0 = g.dist; run(s, 1);
      ok(near(g.dist - d0, 4.4 * WHEEL_CRAWL, 0.01), `a stopped Gyre covers ${(g.dist - d0).toFixed(2)} a second`);
      const slow = gyre(s, 20); slow.slowT = 5; slow.slowF = 0.4;
      run(s, 1);
      ok(near(slow.spin, 1 - WHEEL_DRAG, 0.02), `a slow bleeds spin steadily (${slow.spin.toFixed(2)})`);
      const held = gyre(s, 30); s.zones.push({ id: 9e6, kind: 'sing', x: held.x, z: held.z, r: 3, life: 0.5, tick: 1e9, dmg: 0, owner: -1, pd: 0, y: 0 });
      run(s, 0.5);
      ok(near(held.spin, 1 - WHEEL_SINK * 0.5, 0.05), `a singularity drags it down fast (${held.spin.toFixed(2)})`);
      const ice = gyre(s, 40); ice.frz = 0.5; s.events.length = 0;
      let down = 0; run(s, 1 / 60, (e) => { down += count(e, 'spindown', ice.id); });
      ok(ice.spin === 0 && down === 1, 'a freeze stops the rim dead');
      // Flash Freeze: the rim stops before the cold bites, so the whole hit lands
      const sc = mk(), cryo = sc.build('cryo', 3, 5)!; cryo.cd = 1e9; cryo.charge = 1;
      const gc = gyre(sc, 10, 1e6);
      ok(sc.triggerSpecial(cryo.id, 0) && gc.spin === 0 && near(1e6 - gc.hp, sc.towerDmg(cryo) * 4, 1e-6), `Flash Freeze lands in full on a Gyre (${(1e6 - gc.hp).toFixed(1)})`);
      // Graviton Well: no damage, but its grip stops the rim
      const sg = mk(), well = sg.build('gravity', 3, 5)!; const gg = gyre(sg, 10, 1e6);
      run(sg, 1.6);
      ok(!!well && gg.spin === 0 && gg.hp === 1e6, `a Graviton Well drags the rim to a stop (${gg.spin.toFixed(2)})`);
    }
    {
      // Rail shots and full-draw arrows cut through half of the guard; everything else meets all of it
      const through = (type: 'rail' | 'pulse') => {
        const s = mk(), t = s.build(type, 3, 5)!, g = gyre(s, 10, 1e9);
        let hit = false;
        for (let i = 0; i < 600 && !hit; i++) { s.step(1 / 60); s.events.length = 0; hit = g.hp < 1e9; }
        return (1e9 - g.hp) / s.towerDmg(t);
      };
      const rail = through('rail'), pulse = through('pulse');
      ok(near(rail, 1 - WHEEL_GUARD * (1 - WHEEL_PIERCE), 1e-3) && near(pulse, 1 - WHEEL_GUARD, 1e-3), `a Railgun lands ${rail.toFixed(2)} of its damage on a spinning Gyre, a Pulse Turret ${pulse.toFixed(2)}`);
      const s = mk(), p = s.players[0], g = gyre(s, 10, 1e9);
      p.energy = MAX_ENERGY; s.activateHero(0, 0); p.heroTime = p.heroDur = 600; p.fireCd = 0;
      s.heroFire(0, g.x, g.y, g.z);
      ok(s.projs.length === 1 && s.projs[0].cut === WHEEL_PIERCE, 'a full-draw arrow carries the guard cut');
      const want = s.arrowDmg(p) * FULL_DRAW_MUL * (1 - WHEEL_GUARD * (1 - WHEEL_PIERCE));
      let got = 0; run(s, 1.5, (evs) => { for (const e of evs) if (e.k === 'dmg' && e.id === g.id) got += e.n; });
      ok(Math.abs(got - want) <= 0.6, `a full-draw arrow lands ${got} on a spinning Gyre (expected ${want.toFixed(1)})`);
      // a half-drawn arrow meets the whole guard
      s.projs.length = 0;
      for (let i = 0; i < 200 && p.draw < 0.5; i++) { s.heroAim(0, true, g.x, g.y, g.z); s.step(1 / 60); }
      s.heroAim(0, false, g.x, g.y, g.z);
      ok(s.projs.length === 1 && !s.projs[0].cut && p.draw === 0, 'a half-drawn arrow does not');
      // Rail Shot (Kestrel's skill) cuts through as well
      s.events.length = 0; const hp0 = g.hp; p.cds[0] = 0; s.heroSkill(0, 0, g.x, g.y, g.z);
      ok(near(hp0 - g.hp, s.arrowDmg(p) * 8 * (1 - WHEEL_GUARD * (1 - WHEEL_PIERCE)), 0.01), 'Rail Shot ignores half of the guard');
    }
    {
      // waves: in the pool from its first wave, escorting each Colossus from wave WHEEL_ESCORT, listed in the wave preview
      let early = 0, late = 0, escorted = true, listed = true, plain = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const s = mk({ seed, map: MAPS[2] });
        for (let w = 1; w <= 30; w++) {
          priv(s).planWave(w);
          const items: { t: number; type: string; lane: number }[] = priv(s).next.items;
          const n = items.filter((q) => q.type === 'wheel').length;
          if (w < d.from) early += n; else if (n) late++;
          if (w % 5 === 0) for (const b of items.filter((q) => q.type === 'boss')) {
            const esc = items.filter((q) => q.type === 'wheel' && q.lane === b.lane && q.t > b.t && q.t < b.t + 5).length;
            if (w >= WHEEL_ESCORT) { if (esc < WHEEL_ESCORTS) escorted = false; } else plain++;
          }
          if (n && s.preview.lanes.reduce((a, l) => a + (l.find((o) => o.type === 'wheel')?.n || 0), 0) !== n) listed = false;
        }
      }
      ok(early === 0 && late >= 6 * (30 - d.from + 1) * 0.6, `Gyres join the waves from wave ${d.from} on (${late} of ${6 * (30 - d.from + 1)} later waves, ${early} before)`);
      ok(escorted && plain > 0 && WHEEL_ESCORT === 15, 'Gyres escort every Colossus from wave 15');
      ok(listed, 'the wave preview counts the Gyres');
    }
    {
      // co-op: the type index and the spin round-trip, hostile values are clamped
      const h = mk({ mode: 'coop', players: 2 }), c = mk({ mode: 'coop', players: 2 }); c.replica = true;
      const g = gyre(h, 10, 500), gr = put(h, 'grunt', 6); g.spin = 0.37;
      h.preview = { wave: 9, lanes: [[{ type: 'wheel', n: 3 }, { type: 'grunt', n: 2 }]] };
      const snap = JSON.parse(JSON.stringify(h.snapshot([{ k: 'deflect', x: 1, y: 2, z: 3 }, { k: 'spindown', id: g.id, x: 1, y: 2, z: 3 }, { k: 'spinup', id: g.id, x: 1, y: 2, z: 3 }])));
      c.applySnapshot(snap);
      const cg = c.enemies.find((e) => e.id === g.id), cr = c.enemies.find((e) => e.id === gr.id);
      ok(!!cg && cg.type === 'wheel' && near(cg.spin, 0.37) && near(cg.y, g.y) && !!cr && cr.type === 'grunt' && cr.spin === 0, 'the Gyre and its spin reach the guest');
      ok(c.preview.lanes[0].length === 2 && c.preview.lanes[0][0].type === 'wheel' && c.preview.lanes[0][0].n === 3, 'the guest sees Gyres in the wave preview');
      ok(['deflect', 'spindown', 'spinup'].every((k) => c.events.some((e) => e.k === k && e.x === 1 && e.z === 3)) && c.events.some((e) => e.k === 'spindown' && e.id === g.id), 'the Gyre events reach the guest');
      const wi = ENEMY_TYPES.indexOf('wheel');
      const bad = (v: unknown) => { const o = JSON.parse(JSON.stringify(snap)); o.e = [[1, wi, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, v], [2, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, v]]; c.applySnapshot(o); return c.enemies.map((e) => e.spin); };
      ok(bad(99).join() === '1,0' && bad(-5).join() === '0,0' && bad(NaN).join() === '1,0' && bad('x').join() === '1,0' && bad({}).join() === '1,0', 'a hostile spin is clamped, and only a Gyre has one');
      const old = JSON.parse(JSON.stringify(snap)); old.e = [[1, wi, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0]]; c.applySnapshot(old);
      ok(c.enemies.length === 1 && c.enemies[0].spin === 1, 'a row without the spin field reads as full spin');
    }
  }
}

// survival keeps going past the campaign's final wave
const sv = new Sim({ pauseOnCards: false, seed: 9, survival: true, diff: 'easy' }); const b3 = new Bot(sv, 0, 2);
for (let i = 0; i < 60 * 1500 && !sv.over; i++) { b3.step(1 / 60); sv.step(1 / 60); sv.events.length = 0; }
ok(!sv.won, 'survival never "wins"'); console.log('survival reached wave', sv.wave);
console.log(fail ? `${fail} FAILED` : 'all smoke checks passed');
process.exit(fail ? 1 : 0);
