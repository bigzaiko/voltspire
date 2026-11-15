// Quick headless checks: node tools/smoke.ts
import { Sim, standY, nodePos, weakPos, weakOpen, towerOff, RAIN_DELAY, TITAN_PHASES, raySphere, spireTarget, computeWalls, drawPower, arrowSpeed, paceOf, NODE_R, SPIRE_R, ARROW_PAD, ARROW_SPEED, FULL_DRAW, TOWER_H, DECK_GAP, MUST_EVENTS, SNAP_EVENTS_MAX, CORE_STAND } from '../src/game/sim.ts';
import type { Ev, Enemy } from '../src/game/sim.ts';
import {
  ENEMIES, ENEMY_SCALE, ENEMY_TYPES, WAVE_POOL, gyreCount, broodCap, GYRE_FIRST, GYRE_PAIR, BROOD_EVERY, BROOD_SIZE, BROOD_REACH, MITE_HOLD, JAM_LINGER,
  TITAN_LAND, TITAN_STUN, TITAN_WINDUP, TITAN_STRIKE_EVERY, TITAN_STRIKE, TITAN_SLOW, TITAN_GOLD, TITAN_SURVIVAL, TITAN_AGAIN, TITAN_TOUGHER, TITAN_SMASH, TITAN_LEAD, WHEEL_GUARD, WHEEL_CRAWL, WHEEL_BLEED, WHEEL_DRAG, WHEEL_SINK, WHEEL_REST, WHEEL_SPINUP, WHEEL_PIERCE, TOWERS, TOWER_TYPES, MAX_ENERGY, CARDS, CARD_BY_ID, GW, GH, TWIN_BOLT, TUNE, COOP_HP, coopScale, BOW_TIERS,
  BREACH_TIME, BREACH_TIME_BOSS, BREACH_SHARE, FIRST_WAVE_IN, NEXT_WAVE_IN, DRAW_TIME, MIN_DRAW, NOCK_TIME, FULL_DRAW_MUL, HERO_DUR, LINK_RANGE, WALL_HALF, FIRE_RING, SING_COLOR,
} from '../src/game/data.ts';
import { bowTier as bowTierOf } from '../src/game/data.ts';
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
    ok(ENEMY_TYPES.join() === 'grunt,runner,drone,shield,brute,boss,wheel,brood,mite,titan', 'new enemy types are appended, the old indices stay: ' + ENEMY_TYPES.join());
    const d = ENEMIES.wheel;
    ok(d.name === 'Gyre' && !d.fly && d.from === GYRE_FIRST && GYRE_FIRST === 8 && d.leak === 4 && d.hp === 520 && d.bounty >= 44 && d.xp >= 20 && ENEMY_SCALE.wheel === 1.35 && Math.abs(d.r - 1.05 * 1.35) < 0.1 && Math.abs(d.y - 1.1 * 1.35) < 0.1 && WHEEL_GUARD === 0.8, 'Gyre data follows the contract: a mini-boss with four times the health, leak 4, a larger reward, scale 1.35');
    ok(WHEEL_SPINUP <= 0.15 && WHEEL_REST >= 2, 'the rim recovers slowly');
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
      run(s5, 0.6 / WHEEL_SPINUP - 0.5, tally);
      ok(up === 1 && down === 0 && g5.spin > 0.6, 'spinup is reported once when it recovers above 0.6');
      run(s5, 0.4 / WHEEL_SPINUP, tally);
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
      // waves: a mini-boss on its own. One on waves 8, 13, 18, ... (two from wave 18), never in the normal pool, never beside a Colossus, listed in the wave preview
      let wrong = 0, listed = true, escorts = 0, seenOne = 0, seenTwo = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const s = mk({ seed, map: MAPS[2], survival: true });
        for (let w = 1; w <= 40; w++) {
          if (w === s.titan.wave) continue; // the Titan's wave has nothing else
          priv(s).planWave(w);
          const items: { t: number; type: string; lane: number }[] = priv(s).next.items;
          const n = items.filter((q) => q.type === 'wheel').length, want = gyreCount(w);
          if (n !== want) wrong++;
          if (n === 1) seenOne++; else if (n === 2) seenTwo++;
          if (n && items.some((q) => q.type === 'boss')) escorts++;
          if (n && s.preview.lanes.reduce((a, l) => a + (l.find((o) => o.type === 'wheel')?.n || 0), 0) !== n) listed = false;
          if (n && items.length < 5) wrong++; // the rest of the wave still comes, a little thinner
        }
      }
      ok([8, 13, 18, 23, 28].every((w) => gyreCount(w) === (w >= 18 ? 2 : 1)) && [1, 7, 9, 10, 12, 14, 15, 20, 25].every((w) => gyreCount(w) === 0) && GYRE_PAIR === 18, 'the Gyre comes on waves 8, 13, 18, 23, 28, two from wave 18');
      ok(wrong === 0 && seenOne > 0 && seenTwo > 0 && !WAVE_POOL.includes('wheel'), `the waves hold exactly the planned Gyres and none from the pool (${wrong} wrong)`);
      ok(escorts === 0, 'no Gyre rolls in beside a Colossus any more');
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
  {
    // ---------- Broodcarrier and mites ----------
    const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
    const count = (evs: Ev[], k: string, id?: number) => evs.filter((e) => e.k === k && (id === undefined || e.id === id)).length;
    const mitesOf = (s: Sim) => s.enemies.filter((e) => e.type === 'mite');
    const d = ENEMIES.brood, m = ENEMIES.mite;
    ok(d.name === 'Broodcarrier' && d.from === 6 && d.speed < ENEMIES.grunt.speed && d.hp > ENEMIES.brute.hp && WAVE_POOL.includes('brood') && !WAVE_POOL.includes('mite') && m.leak === 0 && m.bounty === 0 && m.xp === 0 && m.hp <= 1
      && BROOD_SIZE === 4 && BROOD_EVERY === 7 && MITE_HOLD + JAM_LINGER <= 5.2 && broodCap(6) === 1 && broodCap(30) >= 3, 'Broodcarrier and mite data');
    {
      // a carrier beside a turret: a swarm of four runs across the deck, climbs the turret and jams it
      const s = mk(), t = s.build('pulse', 3, 5)!, c = put(s, 'brood', 10);
      const evs: Ev[] = [], each = (e: Ev[]) => { evs.push(...e); };
      t.charge = 0.2; c.ttl = 0;
      run(s, 0.05, each);
      const born = s.time - 0.05 + 1 / 60, runTo = (at: number) => run(s, Math.max(0, at - s.time), each);
      const first = mitesOf(s), b = evs.find((e) => e.k === 'brood');
      ok(first.length === BROOD_SIZE && first.every((q) => q.prey === t.id && q.mom === c.id && !q.latched && q.hp <= 1 && q.alive), 'a swarm of four mites leaves the carrier for the nearest tower');
      ok(!!b && b.id === c.id && b.prey === t.id && near(b.x, c.x) && near(b.y, c.y) && near(b.z, c.z), 'the brood event names the carrier, where it is and the tower');
      const d0 = first.map((q) => Math.hypot(q.x - t.x, q.z - t.z)), road = first.map((q) => q.dist);
      run(s, 0.1, each);
      ok(first.every((q, i) => q.latched || Math.hypot(q.x - t.x, q.z - t.z) < d0[i] - 0.3) && first.every((q, i) => q.dist === road[i]), 'mites run straight at the tower, not along the road');
      run(s, 1, each);
      const jam = evs.find((e) => e.k === 'jam');
      ok(first.every((q) => q.latched && Math.hypot(q.x - t.x, q.z - t.z) < 0.8 && q.gy > 0.3 && near(q.y, q.gy + m.y)) && new Set(first.map((q) => q.gy.toFixed(2))).size === BROOD_SIZE, 'the mites climb the tower, each to a perch of its own');
      ok(t.jam > 0 && towerOff(t) && !!jam && jam.id === t.id && jam.x === t.x && jam.z === t.z && count(evs, 'jam') === 1, 'the tower is jammed (jam event)');
      evs.length = 0; const charge = t.charge;
      run(s, 2.5, each);
      ok(count(evs, 'shot', t.id) === 0 && t.charge === charge && !s.specialReady(t) && t.jam > 0, 'a jammed tower neither fires nor charges');
      t.charge = 1; ok(!s.triggerSpecial(t.id, 0) && t.charge === 1, 'and its special cannot be fired'); t.charge = charge;
      run(s, 2.4, each);
      const un = evs.find((e) => e.k === 'unjam');
      ok(first.every((q) => !q.alive) && mitesOf(s).length === 0 && t.jam === 0 && !!un && un.id === t.id && un.x === t.x, 'the mites burn out and the jam ends (unjam event)');
      ok(s.time - born < 1.2 + 5.1 && s.leaked === 0 && count(evs, 'breach') === 0, 'a jam lasts about five seconds at most, and mites never go for the core');
      evs.length = 0; run(s, 0.6, each);
      ok(count(evs, 'shot', t.id) > 0 && t.charge > charge, 'the tower fires and charges again');
      // the next swarm leaves BROOD_EVERY seconds after the first
      runTo(born + BROOD_EVERY - 0.15);
      ok(count(evs, 'brood') === 0, 'no second swarm before its time');
      run(s, 0.5, each);
      ok(count(evs, 'brood') === 1 && mitesOf(s).length === BROOD_SIZE, 'the next swarm leaves about seven seconds after the last');
      // one hit destroys a mite, and it pays nothing
      const gold = s.gold, xp = s.xp, kills = s.kills, second = mitesOf(s);
      ok(s.damage(second[0], 0.01, -1) > 0 && !second[0].alive && s.gold === gold && s.xp === xp && s.kills === kills && s.events.some((e) => e.k === 'die' && e.t === 'mite'), 'any hit destroys a mite, for no reward');
      ok(s.damage(second[1], 0, -1) === 0 && second[1].alive, 'a hit without damage does not');
      // Kestrel shoots the rest off: the tower is free again at once
      run(s, 1.2, each);
      const p = s.players[0]; p.energy = MAX_ENERGY; s.activateHero(0, 0); p.heroTime = p.heroDur = 600; p.stats.pierce = 6;
      evs.length = 0; const t0 = s.time;
      run(s, 3, () => { const q = mitesOf(s).find((o) => o.latched); if (q && p.fireCd <= 0) s.heroFire(0, q.x, q.y, q.z); });
      run(s, JAM_LINGER + 0.1, each);
      ok(mitesOf(s).length === 0 && t.jam === 0 && s.time - t0 < MITE_HOLD - 0.5, 'Kestrel can shoot the mites off a tower and end the jam early');
    }
    {
      // a neighbour may shoot them: tower B covers tower A but not the carrier
      const s = mk(), a = s.build('pulse', 3, 5)!, c = put(s, 'brood', 10);
      for (let dd = 10; dd > 0 && Math.hypot(c.x - a.x, c.z - a.z) < 6.5; dd -= 0.5) { c.dist = dd; priv(s).place(c); }
      ok(Math.hypot(c.x - a.x, c.z - a.z) < BROOD_REACH - 0.5, 'the carrier stands away from tower A, still within reach');
      let spot: [number, number] | null = null;
      for (let i = 0; i < GW * GH && !spot; i++) {
        if (s.grid[i] !== 0) continue;
        const cx = i % GW, cz = Math.floor(i / GW), probe = s.build('pulse', cx, cz)!;
        const da = Math.hypot(probe.x - a.x, probe.z - a.z), dc = Math.hypot(probe.x - c.x, probe.z - c.z);
        s.sell(probe.id);
        if (da > 3 && da < 6.5 && dc > 9) spot = [cx, cz];
      }
      ok(!!spot, 'found a tile that covers tower A but not the carrier');
      const bT = s.build('pulse', spot![0], spot![1])!;
      c.ttl = 0;
      let jamAt = -1, unAt = -1, shotOff = 0;
      run(s, 5.5, (evs) => { for (const e of evs) { if (e.k === 'jam' && e.id === a.id) jamAt = s.time; if (e.k === 'unjam' && e.id === a.id && unAt < 0) unAt = s.time; if (e.k === 'die' && e.t === 'mite') shotOff++; } });
      ok(jamAt > 0 && unAt > jamAt && unAt - jamAt < 3.5 && shotOff === BROOD_SIZE && bT.jam === 0, `a tower beside the jammed one shoots the mites off (jam ${(unAt - jamAt).toFixed(1)} s)`);
    }
    {
      // never a Spire, never a tower that is offline
      const s = mk(), sp = s.towers.find((t) => t.type === 'spire')!;
      const c = put(s, 'brood', s.map.nearest(0, sp.x, sp.z));
      ok(Math.hypot(c.x - sp.x, c.z - sp.z) < BROOD_REACH, 'the carrier stands within reach of the Spire');
      c.ttl = 0; run(s, 1);
      ok(mitesOf(s).length === 0, 'mites never go for a Spire');
      let cell: [number, number] = [0, 0], bd = 1e9;
      for (let i = 0; i < GW * GH; i++) if (s.grid[i] === 0) { const probe = s.build('pulse', i % GW, Math.floor(i / GW))!, dd = Math.hypot(probe.x - c.x, probe.z - c.z); s.sell(probe.id); if (dd < bd) { bd = dd; cell = [i % GW, Math.floor(i / GW)]; } }
      const t = s.build('pulse', cell[0], cell[1])!;
      t.down = 3; run(s, 1);
      ok(bd < BROOD_REACH && mitesOf(s).length === 0, 'nor for a tower that is offline');
      run(s, 2.6);
      ok(mitesOf(s).length === BROOD_SIZE && mitesOf(s).every((q) => q.prey === t.id), 'they go for it once it is back');
      // a frozen carrier lets nothing out, and a carrier holds the wave open while stray mites do not
      const evs: Ev[] = [];
      s.wave = 3; s.cleared = false;
      run(s, 0.5, (e) => { evs.push(...e); });
      ok(!s.cleared && !evs.some((e) => e.k === 'clear'), 'a wave is not cleared while a carrier lives');
      s.damage(c, 1e12, -1, true);
      run(s, 0.1, (e) => { evs.push(...e); });
      ok(mitesOf(s).length > 0 && s.cleared && evs.some((e) => e.k === 'clear' && e.n === 3), 'stray mites alone do not hold a wave open');
      const s2 = mk(), t2 = s2.build('pulse', 3, 5)!, c2 = put(s2, 'brood', 10); c2.ttl = 0; c2.frz = 2;
      run(s2, 1.5); ok(mitesOf(s2).length === 0 && !!t2, 'a frozen carrier lets nothing out');
    }
    {
      // mites among every kind of tower, slow, pull and blast: nothing breaks, nothing but road enemies reaches the core
      const s = mk({ seed: 8 });
      const cells: [number, number][] = [[3, 5], [4, 5], [6, 5], [7, 7], [8, 9], [6, 11], [8, 12], [8, 14], [11, 14], [13, 9]];
      (['gravity', 'cryo', 'mortar', 'missile', 'rail', 'lance', 'arc', 'flame', 'beacon', 'pulse'] as const).forEach((t, i) => s.build(t, cells[i][0], cells[i][1]));
      let jams = 0, bad = 0, miteBreach = 0;
      for (let k = 0; k < 4; k++) { priv(s).spawn('brood', 30, 0); s.enemies[s.enemies.length - 1].dist = 4 + k * 9; for (let g = 0; g < 4; g++) { priv(s).spawn('grunt', 30, 0); s.enemies[s.enemies.length - 1].dist = k * 9 + g; } }
      const p = s.players[0]; p.energy = MAX_ENERGY; s.activateHero(0, 0); p.heroTime = p.heroDur = 600;
      run(s, 40, (evs) => {
        for (const e of evs) { if (e.k === 'jam') jams++; if (e.k === 'breach' && e.t === 'mite') miteBreach++; }
        for (const e of s.enemies) if (!Number.isFinite(e.x + e.z + e.y + e.gy + e.hp + e.dist + e.yaw)) bad++;
        if (s.time % 6 < 0.02) { const e = s.enemies[0]; if (e) { p.cds[1] = p.cds[2] = 0; s.heroSkill(0, 1, e.x, e.gy, e.z); s.heroSkill(0, 2, e.x, e.gy, e.z); } }
        if (s.time % 9 < 0.02) for (const t of s.towers) { t.charge = 1; s.triggerSpecial(t.id, 0); }
      });
      ok(jams >= 3 && bad === 0 && miteBreach === 0 && s.towers.every((t) => t.jam >= 0 && Number.isFinite(t.jam)), `mites among all the towers and skills: ${jams} jams, state stays finite`);
    }
    {
      // co-op: prey, latched and the jam reach the guest; hostile values are clamped
      const h = mk({ mode: 'coop', players: 2 }), c = mk({ mode: 'coop', players: 2 }); c.replica = true;
      const t = h.build('pulse', 3, 5)!, car = put(h, 'brood', 10); car.ttl = 0;
      run(h, 1.5);
      const snap = JSON.parse(JSON.stringify(h.snapshot([{ k: 'brood', id: car.id, x: 1, y: 2, z: 3, prey: t.id }, { k: 'jam', id: t.id, x: 1, z: 3 }, { k: 'unjam', id: t.id, x: 1, z: 3 }])));
      c.applySnapshot(snap);
      const cm = c.enemies.filter((e) => e.type === 'mite'), ct = c.towerById(t.id)!, cc = c.enemies.find((e) => e.id === car.id)!;
      ok(cm.length === BROOD_SIZE && cm.every((q) => q.prey === t.id && q.latched && q.gy > 0.3) && cc.type === 'brood' && cc.prey === 0 && !cc.latched, 'mites, their prey and whether they sit on it reach the guest');
      ok(!!ct && Math.abs(ct.jam - t.jam) < 0.011 && ct.jam > 0 && towerOff(ct) && ct.stun === 0, 'the jam reaches the guest');
      ok(['brood', 'jam', 'unjam'].every((k) => c.events.some((e) => e.k === k)) && c.events.some((e) => e.k === 'brood' && e.prey === t.id), 'the brood and jam events reach the guest');
      const mi = ENEMY_TYPES.indexOf('mite');
      for (const v of [99.7, -5, NaN, 'x', {}, 1e99, null]) {
        const o = JSON.parse(JSON.stringify(snap));
        o.e = [[1, mi, 0, 0, 0, 1, 1, 0, 0, 0, 32, 0, 0, v], [2, 0, 0, 0, 0, 5, 5, 0, 0, 0, 32, 0, 0, 7]];
        o.t = o.t.map((r: unknown[]) => { const q = r.slice(); q[12] = v; q[13] = v; return q; });
        c.applySnapshot(o);
        ok(c.enemies.length === 2 && Number.isInteger(c.enemies[0].prey) && c.enemies[0].prey >= 0 && c.enemies[0].prey <= 1e9 && c.enemies[0].latched && c.enemies[1].prey === 0 && !c.enemies[1].latched
          && c.towers.every((x) => x.jam >= 0 && x.jam <= 60 && x.stun >= 0 && x.stun <= 60), 'hostile prey / jam / stun values are clamped: ' + JSON.stringify(v));
      }
      const old = JSON.parse(JSON.stringify(snap)); old.t = old.t.map((r: unknown[]) => r.slice(0, 12)); old.e = old.e.map((r: unknown[]) => r.slice(0, 13)); delete old.ti; old.a = old.a.slice(0, 16);
      c.applySnapshot(old);
      ok(c.towers.every((x) => x.jam === 0 && x.stun === 0) && c.enemies.every((e) => e.prey === 0) && !c.overlink, 'a snapshot without the new fields reads as not jammed, not stunned, no overlink');
    }
  }
  {
    // ---------- the Titan ----------
    const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
    const count = (evs: Ev[], k: string, id?: number) => evs.filter((e) => e.k === k && (id === undefined || e.id === id)).length;
    const dT = ENEMIES.titan, wk = dT.weak!;
    ok(ENEMY_SCALE.titan === 1 && dT.r === 3.2 && dT.y === 9 && wk.length === 4 && JSON.stringify(wk.map((w) => [w.x, w.y, w.z, w.r])) === JSON.stringify([[0, 13.4, 2.2, 0.9], [0, 10.2, -2.0, 1.1], [2.4, 6.4, 0, 0.8], [-2.4, 6.4, 0, 0.8]])
      && TITAN_LAND === 2.5 && TITAN_STUN === 6 && TITAN_WINDUP === 4 && TITAN_STRIKE_EVERY === 5 && TITAN_STRIKE === 0.4 && TITAN_SLOW === 0.4 && TITAN_SURVIVAL === 22 && TITAN_AGAIN === 12 && TITAN_SMASH[0] === 20 && TITAN_SMASH[1] === 40 && TITAN_LEAD === 5
      && TITAN_PHASES.join() === 'none,far,warn,landing,walk,dead' && !WAVE_POOL.includes('titan'), 'Titan data follows the contract');
    /** Start the Titan's wave and (unless `leap` is set) run to just after the impact. Returns the Titan. */
    const land = (s: Sim, leap = false, evs?: Ev[]): Enemy => {
      s.wave = s.titan.wave - 1; priv(s).next = null; s.queue.length = 0; s.nextWaveIn = 1e9;
      s.startWave();
      if (evs) evs.push(...s.events);
      if (!leap) run(s, TITAN_LAND + 0.05, (e) => { if (evs) evs.push(...e); });
      return s.enemies.find((e) => e.type === 'titan')!;
    };
    /** Hold the Titan still at a lane distance. */
    const hold = (s: Sim, ti: Enemy, dist: number) => { ti.speed = 0; ti.dist = dist; priv(s).place(ti); };
    /** A weak point an arrow from `o` reaches by the rules of the sim, or -1. */
    const openWeak = (ti: Enemy, o: { x: number; y: number; z: number }) => {
      for (let i = 0; i < wk.length; i++) {
        const w = weakPos(ti, i, { x: 0, y: 0, z: 0 })!, dx = w.x - o.x, dy = w.y - o.y, dz = w.z - o.z, L = Math.hypot(dx, dy, dz);
        if (!weakOpen(ti, i, dx, dz)) continue;
        const ub = raySphere(o.x, o.y, o.z, dx / L, dy / L, dz / L, ti.x, ti.y, ti.z, ti.r + ARROW_PAD), uw = raySphere(o.x, o.y, o.z, dx / L, dy / L, dz / L, w.x, w.y, w.z, wk[i].r);
        if (ub < 0 || uw <= ub + 0.2) return i;
      }
      return -1;
    };
    /** A point on the hull with no weak point anywhere near the line of fire. */
    const hullAim = (ti: Enemy, o: { x: number; y: number; z: number }) => {
      const vx = ti.x - o.x, vz = ti.z - o.z, vl = Math.hypot(vx, vz);
      for (const k of [0, 1, -1, 2, -2]) for (const dy of [0, 1.5, -1.5, 2.5, -2.5]) {
        const q = { x: ti.x + (vz / vl) * k, y: ti.y + dy, z: ti.z - (vx / vl) * k };
        const dx = q.x - o.x, dy2 = q.y - o.y, dz = q.z - o.z, L = Math.hypot(dx, dy2, dz);
        if (raySphere(o.x, o.y, o.z, dx / L, dy2 / L, dz / L, ti.x, ti.y, ti.z, ti.r) < 0) continue;
        if (wk.every((w, i) => { const c = weakPos(ti, i, { x: 0, y: 0, z: 0 })!; return raySphere(o.x, o.y, o.z, dx / L, dy2 / L, dz / L, c.x, c.y, c.z, w.r + 0.7) < 0; })) return q;
      }
      return null;
    };
    {
      // when it comes: one per campaign, on a wave picked by the seed out of the four before the last; wave 22 in Survival; never in Versus
      for (const [diff, last] of [['easy', 20], ['normal', 25], ['hard', 30]] as const) {
        const seen = new Set<number>(); let far = true;
        for (let seed = 1; seed <= 80; seed++) { const q = new Sim({ seed, map: bare, diff }); seen.add(q.titan.wave); if (q.titan.phase !== 'far' || q.titan.danger !== 0 || q.overlink) far = false; if (new Sim({ seed, map: bare, diff }).titan.wave !== q.titan.wave) far = false; }
        ok(far && [...seen].sort((a, b) => a - b).join() === [last - 4, last - 3, last - 2, last - 1].join(), `${diff}: the Titan arrives on a wave from ${last - 4} to ${last - 1}, picked by the seed (${[...seen].sort((a, b) => a - b).join()})`);
      }
      ok(new Sim({ seed: 3, map: bare, mode: 'versus', players: 1 }).titan.phase === 'none', 'no Titan in Versus');
      const sv = new Sim({ seed: 3, map: bare, survival: true });
      ok(sv.titan.phase === 'far' && sv.titan.wave === TITAN_SURVIVAL, 'in Survival it comes on wave 22');
      const tri = new Sim({ seed: 3, map: MAPS.find((q) => q.id === 'highline')! });
      ok(tri.map.lanes[tri.titan.lane].len === Math.max(...tri.map.lanes.map((l) => l.len)), 'it takes the longest road');
      // far: it wrecks a building every 20 to 40 seconds
      const s = mk(); const at: number[] = [];
      run(s, 200, (evs) => { for (const e of evs) if (e.k === 'titanSmash') at.push(s.time); });
      const gaps = at.map((t, i) => t - (i ? at[i - 1] : 0));
      ok(at.length >= 5 && gaps.every((g) => g >= TITAN_SMASH[0] - 0.02 && g <= TITAN_SMASH[1] + 0.02) && s.titan.phase === 'far' && s.titan.danger === 0, `titanSmash every 20 to 40 s while it roams (${gaps.map((g) => g.toFixed(0)).join(' ')})`);
      // warn: from wave winWave - 5 the danger fills, and it is full only when it leaps
      const from = s.winWave - TITAN_LEAD;
      s.wave = from - 1; run(s, 1);
      ok(s.titan.phase === 'far', 'still far before the warning');
      let last = 0, mono = true;
      for (let w = from; w < s.titan.wave; w++) { s.wave = w; priv(s).waveT0 = s.time; run(s, 60, () => { if (s.titan.danger < last) mono = false; last = s.titan.danger; }); }
      ok(s.titan.phase === 'warn' && mono && last > 0.9 && last < 1, `warn: the danger fills toward the arrival (${last.toFixed(2)})`);
      // the wave preview lists it, alone, on its lane
      s.wave = s.titan.wave - 1; priv(s).next = null; priv(s).planAhead();
      ok(s.preview.wave === s.titan.wave && s.preview.lanes.every((l, i) => (i === s.titan.lane ? JSON.stringify(l) === JSON.stringify([{ type: 'titan', n: 1 }]) : l.length === 0)), 'the wave preview lists the Titan, and nothing else, for its wave');
    }
    {
      // the leap, the impact, the stun, the overlink
      const s = mk(), turret = s.build('pulse', 3, 5)!, rail = s.build('rail', 4, 5)!;
      const g1 = put(s, 'grunt', 20), g2 = put(s, 'brute', 30);
      const evs: Ev[] = [];
      land(s, true, evs);
      const gold = s.gold, xp = s.xp, kills = s.kills;
      const gate = s.map.pos(s.titan.lane, 0, { x: 0, z: 0, dx: 0, dz: 0, y: 0 });
      const leap = evs.find((e) => e.k === 'titanLand');
      ok(s.wave === s.titan.wave && s.titan.phase === 'landing' && s.titan.danger === 1 && !!leap && leap.x === gate.x && leap.z === gate.z && leap.lane === s.titan.lane && s.queue.length === 0 && s.titanBusy && !s.overlink, 'its wave begins with the leap (titanLand at the gate of its lane), and nothing else is queued');
      run(s, TITAN_LAND - 0.1, (e) => { evs.push(...e); });
      ok(s.titan.phase === 'landing' && g1.alive && g2.alive && !s.enemies.some((e) => e.type === 'titan') && count(evs, 'titanImpact') === 0, 'it is in the air for TITAN_LAND seconds');
      run(s, 0.15, (e) => { evs.push(...e); });
      const ti = s.enemies.find((e) => e.type === 'titan')!, hit = evs.find((e) => e.k === 'titanImpact');
      ok(s.titan.phase === 'walk' && !!hit && hit.x === gate.x && hit.z === gate.z && s.overlink, 'the impact (titanImpact) puts it on the road and opens the overlink');
      ok(!g1.alive && !g2.alive && s.enemies.length === 1 && s.gold === gold && s.xp === xp && s.kills === kills, 'the impact destroys every enemy on the field, for no reward');
      ok(s.towers.length >= 3 && s.towers.every((t) => t.stun > TITAN_STUN - 0.2 && t.stun <= TITAN_STUN && towerOff(t)), 'and stuns every tower for TITAN_STUN seconds');
      const len = s.map.lanes[s.titan.lane].len;
      ok(!!ti && ti.lane === s.titan.lane && ti.dist < 0.5 && ti.r === 3.2 && near(ti.y, ti.gy + 9) && ti.maxHp === s.titanHp() && near(ti.speed, Math.max(0.9, Math.min(1.7, len / 70))) && MUST_EVENTS.has('titanLand') && MUST_EVENTS.has('titanImpact') && MUST_EVENTS.has('titanDie'), 'the Titan is an enemy of type titan on its lane, pacing itself to the road');
      ok(near(s.titanHp(), TUNE.titan * BOW_TIERS[4].mul) && near(mk({ diff: 'hard' }).titanHp() / mk({ diff: 'easy', seed: 4 }).titanHp(), Math.sqrt(1.3 / 0.72) * (BOW_TIERS[4].mul / BOW_TIERS[bowTierOf(mk({ diff: 'easy', seed: 4 }).titan.wave)].mul), 1e-6) && near(mk({ mode: 'coop', players: 2 }).titanHp(), s.titanHp() * 1.75), 'its health follows the bow tier of its wave, the difficulty and the number of players');
      // stunned towers are idle and dark: no shots, no charge, no special
      hold(s, ti, 10); evs.length = 0;
      turret.charge = 0.3; rail.charge = 1;
      ok(!s.specialReady(rail) && !s.triggerSpecial(rail.id, 0) && rail.charge === 1, 'a stunned tower cannot fire its special');
      run(s, TITAN_STUN - 0.4, (e) => { evs.push(...e); });
      ok(count(evs, 'shot') === 0 && turret.charge === 0.3 && turret.stun > 0, 'stunned towers neither fire nor charge');
      // nothing else comes while it walks
      const wave = s.wave, wait = s.nextWaveIn;
      s.startWave();
      ok(s.wave === wave && s.callBonus() === 0 && s.nextWaveIn === wait && s.waveActive && !s.cleared && s.queue.length === 0, 'no wave can start while the Titan walks');
      run(s, 1.2, (e) => { evs.push(...e); });
      // regular tower fire does not hurt it; slows work at 40%
      evs.length = 0; const hp = ti.hp;
      run(s, 3, (e) => { evs.push(...e); });
      ok(count(evs, 'shot', turret.id) > 3 && count(evs, 'shot', rail.id) >= 1 && ti.hp === hp && turret.charge > 0.3 && turret.stun === 0, 'after the stun the towers fire again, and regular fire does not hurt the Titan');
      ok(s.damage(ti, 1e6, -1) === 0 && s.damage(ti, 1e6, 0) === 0 && s.damage(ti, 1e6, -1, true) === 0 && ti.hp === hp, 'plain damage does nothing to it');
      // tower specials do
      ok(s.triggerSpecial(rail.id, 0), 'Overcharge fires at the Titan');
      ok(near(hp - ti.hp, s.towerDmg(rail) * 8 * TUNE.titanSpec, 1e-6), `a tower special hurts it (${(hp - ti.hp).toFixed(0)})`);
      const hp2 = ti.hp; turret.charge = 1;
      ok(s.triggerSpecial(turret.id, 0), 'Bullet Storm fires at the Titan');
      run(s, 3);
      ok(ti.hp < hp2 - s.towerDmg(turret) * 20, `Bullet Storm bolts hurt it too (${(hp2 - ti.hp).toFixed(0)})`);
      run(s, 3.5); const hp3 = ti.hp; run(s, 8);
      ok(turret.spec === 0 && ti.hp === hp3, 'once the storm is over the bolts do nothing again');
      // slowing effects at 40% strength
      ti.speed = 1; const d0 = ti.dist; run(s, 1); const free = ti.dist - d0;
      ti.slowT = 5; ti.slowF = 0.5; const d1 = ti.dist; run(s, 1);
      ok(near(free, 1, 0.01) && near(ti.dist - d1, 1 - 0.5 * TITAN_SLOW, 0.01), `a 50% slow takes ${(100 * (1 - (ti.dist - d1))).toFixed(0)}% off its pace`);
      ti.slowT = 0; ti.frz = 5; const d2 = ti.dist; run(s, 1);
      ok(near(ti.dist - d2, 1 - TITAN_SLOW, 0.01), 'a freeze only slows it');
      ti.frz = 0; ti.speed = 0;
      // the overlink: charge pinned at full, the Uplink does not run down, leaving and coming back is free
      const p = s.players[0];
      p.energy = 0; run(s, 0.05);
      ok(p.energy === MAX_ENERGY, 'overlink: the charge is pinned at full');
      p.energy = 0;
      ok(s.activateHero(0, 0) && p.energy === MAX_ENERGY, 'the Uplink opens');
      const left = p.heroTime; run(s, 4);
      ok(p.heroActive && p.heroTime === left && left === p.heroDur, 'the Uplink timer does not run down');
      s.exitHero(0);
      ok(!p.heroActive && p.energy === MAX_ENERGY && s.activateHero(0, 0) && p.heroActive, 'leaving and coming back is free');
      // arrows and the Rail Shot: weak points only
      const o = s.heroOrigin(0)!;
      let wi = -1, at = 10;
      for (const dd of [10, 14, 18, 24, 30, 6]) { hold(s, ti, dd); wi = openWeak(ti, o); if (wi >= 0) { at = dd; break; } }
      ok(wi >= 0, 'a weak point shows from the Spire (at lane distance ' + at + ')');
      p.fireCd = 0; p.stats.arrows = 1; s.wave = 1; // (wave 1: a plain bow, one arrow, no blast)
      run(s, 1); evs.length = 0; const hp4 = ti.hp;
      const w = weakPos(ti, wi, { x: 0, y: 0, z: 0 })!;
      s.heroFire(0, w.x, w.y, w.z); run(s, 1.2, (e) => { evs.push(...e); });
      const crit = evs.find((e) => e.k === 'crit'), want = s.arrowDmg(p) * FULL_DRAW_MUL * wk[wi].mul;
      ok(!!crit && near(hp4 - ti.hp, want, 1e-6) && Math.abs(crit.n - want) <= 0.5 && count(evs, 'deflect') === 0, `an arrow on a weak point hurts it (${(hp4 - ti.hp).toFixed(1)} of ${want.toFixed(1)})`);
      const aim = hullAim(ti, o)!; evs.length = 0; const hp5 = ti.hp;
      ok(!!aim, 'found a clear line to its hull');
      s.heroFire(0, aim.x, aim.y, aim.z); run(s, 1.2, (e) => { evs.push(...e); });
      const defl = evs.find((e) => e.k === 'deflect');
      ok(!!defl && ti.hp === hp5 && count(evs, 'crit') === 0 && count(evs, 'dmg') === 0 && Math.abs(Math.hypot(defl.x - ti.x, defl.y - ti.y, defl.z - ti.z) - (ti.r + ARROW_PAD)) < 0.05, 'an arrow anywhere else glances off (deflect, where it met the hull)');
      p.cds[0] = 0; evs.length = 0; s.heroSkill(0, 0, aim.x, aim.y, aim.z); evs.push(...s.events.splice(0));
      ok(ti.hp === hp5 && count(evs, 'deflect') === 1 && count(evs, 'crit') === 0, 'a Rail Shot on the hull glances off as well');
      p.cds[0] = 0; evs.length = 0; s.heroSkill(0, 0, w.x, w.y, w.z); evs.push(...s.events.splice(0));
      ok(near(hp5 - ti.hp, s.arrowDmg(p) * 8 * wk[wi].mul, 1e-6) && count(evs, 'crit') === 1, `a Rail Shot through a weak point hurts it (${(hp5 - ti.hp).toFixed(1)} of ${(s.arrowDmg(p) * 8 * wk[wi].mul).toFixed(1)}, weak point ${wi}, ${count(evs, 'crit')} crits)`);
      // the eye only shows from in front
      const fx = Math.sin(ti.yaw), fz = Math.cos(ti.yaw);
      ok(wk[0].front === true && weakOpen(ti, 0, -fx, -fz) && weakOpen(ti, 0, fz, -fx) && !weakOpen(ti, 0, fx, fz) && [1, 2, 3].every((i) => weakOpen(ti, i, fx, fz) && weakOpen(ti, i, -fx, -fz)) && !weakOpen(ti, 9, fx, fz), 'the eye can be hit from in front and from the side, not from behind');
      // Arrow Rain and Singularity only slow it
      run(s, 1); const hp6 = ti.hp; ti.speed = 1; ti.slowT = 0; ti.slowF = 0;
      p.cds[1] = 0; s.heroSkill(0, 1, ti.x, ti.gy, ti.z); run(s, RAIN_DELAY + 0.3);
      const d3 = ti.dist; run(s, 1);
      ok(ti.hp === hp6 && near(ti.dist - d3, 1 - 0.5 * TITAN_SLOW, 0.02), `Arrow Rain does not hurt the Titan, it slows it (${(ti.dist - d3).toFixed(2)} a second)`);
      run(s, 4); ti.slowT = 0; ti.slowF = 0;
      p.cds[2] = 0; s.heroSkill(0, 2, ti.x, ti.gy, ti.z); run(s, 0.3);
      const d4 = ti.dist; run(s, 1);
      ok(near(ti.dist - d4, 1 - 0.9 * TITAN_SLOW, 0.02), 'a Singularity holds it at part strength and does not drag it');
      run(s, 3);
      ok(ti.hp === hp6, 'and its collapse does not hurt it');
    }
    {
      // at the core: four seconds of wind-up, then 40% of the core's maximum, again every five seconds until the core falls
      const s = mk(), evs: Ev[] = [], each = (e: Ev[]) => { evs.push(...e); };
      const ti = land(s), len = s.map.lanes[ti.lane].len, start = s.lives, blow = Math.ceil(s.maxLives * TITAN_STRIKE);
      ti.speed = 2; ti.dist = len - 5; priv(s).place(ti);
      run(s, 1, each);
      ok(near(ti.dist, len - (CORE_STAND + 0.6 * ti.r)) && ti.breach > TITAN_WINDUP - 0.5 && ti.breach <= TITAN_WINDUP && s.lives === start, 'at the core it winds up');
      run(s, TITAN_WINDUP - 0.6, each);
      ok(s.lives === start && count(evs, 'titanStrike') === 0, 'no damage during the wind-up');
      run(s, 0.4, each);
      const st = evs.find((e) => e.k === 'titanStrike'), lk = evs.find((e) => e.k === 'leak');
      ok(s.lives === start - blow && blow === 8 && !!st && st.n === blow && st.id === ti.id && !!lk && lk.n === blow && ti.alive && s.enemies.includes(ti) && !s.over, `its blow takes 40% of the core's maximum (${blow} of ${s.maxLives}) and it stays`);
      ok(ti.breach > TITAN_STRIKE_EVERY - 0.5 && ti.breach <= TITAN_STRIKE_EVERY, 'the next blow is five seconds away');
      run(s, TITAN_STRIKE_EVERY, each);
      ok(s.lives === start - 2 * blow && count(evs, 'titanStrike') === 2 && !s.over, 'it strikes again');
      run(s, TITAN_STRIKE_EVERY + 0.1, each);
      ok(s.lives === 0 && s.over && !s.won && count(evs, 'lose') === 1 && count(evs, 'titanStrike') === 3, 'until the core falls');
    }
    {
      // destroyed: titanDie, credits and a level, the overlink closes, the wave clears and the remaining waves follow
      const s = mk(), evs: Ev[] = [], each = (e: Ev[]) => { evs.push(...e); };
      const ti = land(s), p = s.players[0];
      s.activateHero(0, 0); run(s, 2, each);
      const gold = s.gold, level = s.level, kills = s.kills, wave = s.wave;
      priv(s).sp = true; s.damage(ti, 1e12, 0); priv(s).sp = false;
      evs.push(...s.events.splice(0));
      const die = evs.find((e) => e.k === 'titanDie');
      ok(!ti.alive && s.titan.phase === 'dead' && !s.overlink && !s.titanBusy && !!die && near(die.x, ti.x) && near(die.y, ti.y) && near(die.z, ti.z) && count(evs, 'die') === 0, 'titanDie: the Titan is destroyed and the overlink closes');
      ok(near(s.gold, gold + TITAN_GOLD) && s.level === level + 1 && count(evs, 'levelup') === 1 && p.pending.length === 1 && s.kills === kills + 1 && p.kills === 1, 'its reward: credits and a level-up');
      p.pending.length = 0;
      const left = p.heroTime; run(s, 1, each);
      ok(p.heroActive && p.heroTime < left - 0.9 && count(evs, 'clear') === 1 && s.cleared && s.nextWaveIn <= 5, 'normal rules resume: the Uplink runs down again and the wave is cleared');
      run(s, 5, each);
      ok(s.wave === wave + 1 && s.wave <= s.winWave && s.queue.length + s.enemies.length > 0 && s.titan.phase === 'dead' && !s.queue.some((q) => q.type === 'titan'), 'the remaining waves follow');
      let again = 0;
      for (let w = s.wave + 1; w <= s.winWave + 20; w++) { priv(s).planWave(w); if (priv(s).next.items.some((q: { type: string }) => q.type === 'titan')) again++; }
      ok(again === 0, 'one Titan per campaign');
    }
    {
      // Survival: wave 22, then every 12 waves, tougher each time
      const s = mk({ survival: true });
      const ti = land(s), hp1 = ti.maxHp;
      ok(s.wave === TITAN_SURVIVAL && !!ti, 'the Survival Titan lands on wave 22');
      priv(s).sp = true; s.damage(ti, 1e12, 0); priv(s).sp = false; s.players[0].pending.length = 0;
      ok(s.titan.phase === 'dead' && s.titan.wave === TITAN_SURVIVAL + TITAN_AGAIN, 'the next one is due twelve waves later');
      run(s, 6.5, () => { for (const e of s.enemies) s.damage(e, 1e12, -1, true); });
      ok(s.wave === TITAN_SURVIVAL + 1 && s.titan.phase === 'far' && s.titan.danger === 0, 'and roams the district again');
      s.enemies.length = 0;
      const t2 = land(s);
      ok(s.wave === TITAN_SURVIVAL + TITAN_AGAIN && !!t2 && near(t2.maxHp, hp1 * TITAN_TOUGHER, 1e-6), `the second Titan is tougher (${Math.round(hp1)} then ${Math.round(t2.maxHp)})`);
      // a campaign that plays on after its win gets one as well
      const c = mk(); const t3 = land(c);
      priv(c).sp = true; c.damage(t3, 1e12, 0); priv(c).sp = false; c.players[0].pending.length = 0;
      c.wave = c.winWave; c.endless = true; c.queue.length = 0; c.enemies.length = 0; priv(c).next = null;
      c.startWave();
      ok(c.titan.phase === 'far' && c.titan.wave > c.wave && (c.titan.wave - (c.winWave - 4)) % 1 === 0, 'an endless run after a win gets its next Titan');
    }
    {
      // co-op: the Titan's state, the overlink and the stun reach the guest; hostile values are clamped
      const h = mk({ mode: 'coop', players: 2 }), c = mk({ mode: 'coop', players: 2, seed: 99 }); c.replica = true;
      h.build('pulse', 3, 5);
      const ti = land(h); run(h, 0.5);
      const snap = JSON.parse(JSON.stringify(h.snapshot([{ k: 'titanLand', x: 1, z: 2, lane: 0 }, { k: 'titanImpact', x: 1, z: 2 }, { k: 'titanSmash' }, { k: 'titanDie', x: 1, y: 2, z: 3 }, { k: 'titanStrike', id: ti.id, x: 1, z: 2, n: 8 }])));
      c.applySnapshot(snap);
      const ct = c.enemies.find((e) => e.id === ti.id)!;
      ok(c.titan.phase === 'walk' && c.titan.wave === h.titan.wave && c.titan.lane === h.titan.lane && c.titan.danger === 1 && Math.abs(c.titan.t - h.titan.t) < 0.011 && c.overlink, 'the Titan state and the overlink reach the guest');
      ok(!!ct && ct.type === 'titan' && ct.r === 3.2 && near(ct.y, ct.gy + 9) && Math.abs(ct.hp - ti.hp) <= 1 && c.towers.length === h.towers.length && c.towers.every((t, i) => Math.abs(t.stun - h.towers[i].stun) < 0.011 && t.stun > 0), 'the Titan itself and the stunned towers reach the guest');
      ok(['titanLand', 'titanImpact', 'titanSmash', 'titanDie', 'titanStrike'].every((k) => c.events.some((e) => e.k === k)) && c.events.some((e) => e.k === 'titanLand' && e.lane === 0 && e.x === 1), 'the Titan events reach the guest');
      h.preview = { wave: 22, lanes: [[{ type: 'titan', n: 1 }]] };
      c.applySnapshot(JSON.parse(JSON.stringify(h.snapshot([]))));
      ok(c.preview.lanes[0].length === 1 && c.preview.lanes[0][0].type === 'titan', 'the guest sees the Titan in the wave preview');
      for (const bad of [[99, 5, 'x', -1, 1e9], ['walk', NaN, 1e99, {}, -4], [-1, -1, -1, -1, -1], [2.7, 0.5, 23.9, 1e99, 0.4], 'x', null, [[]]]) {
        const o = JSON.parse(JSON.stringify(snap)); o.ti = bad; o.a[16] = bad;
        try { c.applySnapshot(o); } catch (e) { ok(false, 'hostile Titan state threw ' + e); }
        ok(TITAN_PHASES.includes(c.titan.phase) && c.titan.danger >= 0 && c.titan.danger <= 1 && Number.isInteger(c.titan.wave) && c.titan.wave >= 0 && c.titan.t >= 0 && Number.isFinite(c.titan.t) && Number.isInteger(c.titan.lane) && c.titan.lane >= 0 && c.titan.lane < c.map.lanes.length && c.overlink === false, 'hostile Titan state is clamped: ' + JSON.stringify(bad));
      }
    }
    {
      // the bot: uplinks when the overlink is on (also in the runs without the hero), goes for the weak points and fires charged specials at it
      const s = mk(), rail = s.build('rail', 4, 5)!, bot = new Bot(s, 0);
      bot.useHero = false;
      const ti = land(s), p = s.players[0];
      let crits = 0, specials = 0, on = -1;
      const hp = ti.hp;
      for (let i = 0; i < 60 * 14; i++) {
        p.energy = 0; // the no-hero balance runs do this every step
        if (i === 60) { for (const t of s.towers) t.stun = 0; rail.charge = 1; }
        bot.step(1 / 60); s.step(1 / 60);
        if (p.heroActive && on < 0) on = s.time;
        for (const e of s.events.splice(0)) { if (e.k === 'crit') crits++; if (e.k === 'special' && e.id === rail.id) specials++; }
        p.pending.length = 0;
      }
      ok(on >= 0 && on - (s.time - 14) < 1.2, 'the bot uplinks as soon as the overlink is on, even when it plays without the hero');
      ok(crits >= 8 && ti.hp < hp - s.arrowDmg(p) * FULL_DRAW_MUL * 8, `the bot hits the Titan's weak points (${crits} crits)`);
      ok(specials === 1, 'and fires a charged special at it');
      // mites on a tower: the bot shoots them off during the Uplink
      const q = mk(), t = q.build('pulse', 3, 5)!, c = put(q, 'brood', 10), b2 = new Bot(q, 0), p2 = q.players[0];
      c.ttl = 0; p2.energy = MAX_ENERGY; q.activateHero(0, 0); p2.heroTime = p2.heroDur = 600;
      let shotOff = 0, jamT = 0;
      for (let i = 0; i < 60 * 14; i++) { b2.step(1 / 60); q.step(1 / 60); if (t.jam > 0) jamT += 1 / 60; for (const e of q.events.splice(0)) if (e.k === 'die' && e.t === 'mite' && e.h === 1) shotOff++; p2.pending.length = 0; }
      ok(shotOff >= 4 && jamT < 2 * (MITE_HOLD + JAM_LINGER) * 0.85, `the bot shoots mites off a jammed tower (${shotOff} shot off, jammed ${jamT.toFixed(1)} s of 14)`);
    }
    {
      // a whole campaign with the bot: the Titan comes, is destroyed, and the final waves still play
      const s = new Sim({ seed: 7, map: MAPS[0], diff: 'easy', pauseOnCards: false }), bot = new Bot(s, 0);
      let dieWave = 0, landWave = 0, wavesAfter = 0, wonWhileAlive = false, spawnsDuring = 0;
      for (let i = 0; i < 60 * 60 * 40 && !s.over; i++) {
        bot.step(1 / 60); s.step(1 / 60);
        if (s.titanBusy && (s.queue.length > 0 || s.enemies.some((e) => e.type !== 'titan'))) spawnsDuring++;
        for (const e of s.events.splice(0)) {
          if (e.k === 'titanImpact') landWave = s.wave;
          if (e.k === 'titanDie') dieWave = s.wave;
          if (e.k === 'wave' && dieWave) wavesAfter++;
          if (e.k === 'win' && s.titanBusy) wonWhileAlive = true;
        }
      }
      ok(landWave === s.titan.wave && landWave >= s.winWave - 4 && landWave < s.winWave && spawnsDuring <= 60 * TITAN_LAND + 1, `the Titan landed on wave ${landWave} of ${s.winWave}, alone`);
      ok(dieWave === landWave && wavesAfter === s.winWave - landWave && s.won && !wonWhileAlive && s.wave === s.winWave, `the bot destroyed it, the last ${wavesAfter} waves were played and the campaign was won`);
    }
  }
  {
    // ---------- Arrow Rain: the volley is in the air for RAIN_DELAY seconds ----------
    const s = mk(), p = s.players[0], e = put(s, 'grunt', 10);
    p.energy = MAX_ENERGY; s.activateHero(0, 0); p.heroTime = p.heroDur = 600;
    s.heroSkill(0, 1, e.x, e.gy, e.z);
    const z = s.zones.find((q) => q.kind === 'rain')!, tick = s.arrowDmg(p) * 0.75;
    ok(RAIN_DELAY === 0.8 && !!z && Math.abs(z.life - (3.5 + RAIN_DELAY)) < 1e-9 && z.tick === RAIN_DELAY, 'the rain zone exists from the cast and lasts the delay longer');
    run(s, RAIN_DELAY - 0.05);
    ok(e.hp === e.maxHp, 'no damage while the volley is in the air');
    run(s, 0.1);
    ok(Math.abs(e.maxHp - e.hp - tick) < 1e-6, `the first hits land about 0.8 s after the cast (${(e.maxHp - e.hp).toFixed(1)})`);
    run(s, 4);
    ok(Math.abs(e.maxHp - e.hp - tick * 14) < 1e-6 && !s.zones.length, 'and it deals the same fourteen ticks as before');
  }
  {
    // ---------- the balance pass: tower damage, credits, xp and rare cards ----------
    const s = mk(), t = s.build('pulse', 3, 5)!;
    ok(TUNE.tdmg === 0.92 && Math.abs(s.towerDmg(t) - TOWERS.pulse.dmg * 0.92) < 1e-9, 'towers deal 8% less');
    const e = put(s, 'grunt', 30), gold = s.gold, xp = s.xp;
    s.damage(e, 1e12, -1, true);
    ok(Math.abs(s.gold - gold - ENEMIES.grunt.bounty * 0.92) < 1e-9 && Math.abs(s.xp - xp - ENEMIES.grunt.xp * 0.92) < 1e-9 && TUNE.bounty === 0.92 && TUNE.xp === 0.92, 'kills pay 8% less credits and xp');
    ok(Math.abs(TUNE.clear0 / 15 - 0.92) < 1e-9 && Math.abs(TUNE.clear1 / 3 - 0.92) < 1e-9, 'the wave bonus is 8% smaller');
    ok(Math.abs(TUNE.rare / 5 - 0.85) < 1e-9 && Math.abs(TUNE.epic / 2 - 0.85) < 1e-9, 'rare and epic cards weigh 15% less');
    const share = () => { const q = new Sim({ seed: 12, map: bare }); q.level = 4; let n = 0, all = 0; for (let i = 0; i < 4000; i++) for (const id of q.rollCards(0)) { const c = CARD_BY_ID[id]; if (c.kind === 'blueprint') continue; all++; if (c.rar > 0) n++; } return n / all; };
    const now = share(), rare = TUNE.rare, epic = TUNE.epic;
    TUNE.rare = 5; TUNE.epic = 2; const was = share(); TUNE.rare = rare; TUNE.epic = epic;
    ok(now / was > 0.8 && now / was < 0.94, `rare and epic cards are offered less often (${(100 * was).toFixed(1)}% of the offers before, ${(100 * now).toFixed(1)}% now)`);
  }
}

// survival keeps going past the campaign's final wave
const sv = new Sim({ pauseOnCards: false, seed: 9, survival: true, diff: 'easy' }); const b3 = new Bot(sv, 0, 2);
for (let i = 0; i < 60 * 1500 && !sv.over; i++) { b3.step(1 / 60); sv.step(1 / 60); sv.events.length = 0; }
ok(!sv.won, 'survival never "wins"'); console.log('survival reached wave', sv.wave);
console.log(fail ? `${fail} FAILED` : 'all smoke checks passed');
process.exit(fail ? 1 : 0);
