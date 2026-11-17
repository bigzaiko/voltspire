// Quick headless checks: node tools/smoke.ts
// Covers maps, co-op replication, towers and their specials, the enemies (Gyre, Broodcarrier, Titan), the factory
// (deposits, supply crates, mines, belts, smelters, plants, pipes, power, tower supply, unlocks, waves on call) and bot runs with free towers.
import { Sim, nodePos, towerOff, TITAN_PHASES, computeWalls, paceOf, NODE_R, DECK_GAP, MUST_EVENTS, SNAP_EVENTS_MAX, CORE_STAND } from '../src/game/sim.ts';
import type { Ev, Enemy, Tower } from '../src/game/sim.ts';
import {
  ENEMIES, ENEMY_SCALE, ENEMY_TYPES, WAVE_POOL, gyreCount, broodCap, GYRE_FIRST, GYRE_PAIR, BROOD_EVERY, BROOD_SIZE, BROOD_REACH, MITE_HOLD, JAM_LINGER,
  TITAN_LAND, TITAN_STUN, TITAN_WINDUP, TITAN_STRIKE_EVERY, TITAN_STRIKE, TITAN_SLOW, TITAN_GOLD, TITAN_SURVIVAL, TITAN_AGAIN, TITAN_TOUGHER, TITAN_SMASH, TITAN_LEAD, WHEEL_GUARD, WHEEL_CRAWL, WHEEL_BLEED, WHEEL_DRAG, WHEEL_SINK, WHEEL_REST, WHEEL_SPINUP, WHEEL_PIERCE, TOWERS, TOWER_TYPES, CARDS, CARD_BY_ID, GW, GH, TWIN_BOLT, TUNE, COOP_HP, coopScale,
  BREACH_TIME, BREACH_TIME_BOSS, BREACH_SHARE, FIRST_WAVE_IN, NEXT_WAVE_IN, LINK_RANGE, WALL_HALF, FIRE_RING,
  ORE_TYPES, FACS, FAC_TYPES, MAKES, TOWER_CHAIN, TOWER_TIER, CRATE_STOCK, START_MATS, START_GOLD_MUL, ITEM_SHOTS, upgradeMat,
} from '../src/game/data.ts';
import type { FacType, OreType } from '../src/game/data.ts';
import { waveHpMul } from '../src/game/data.ts';
import { hexDist, neighbor, disc, inBoard } from '../src/game/hex.ts';
import type { MapDef } from '../src/game/map.ts';
import { Bot } from '../src/game/bot.ts';
import { MAPS } from '../src/game/maps.ts';
import { sanitizeMap, validateMap, encodeMap, decodeMap } from '../src/game/map.ts';
import { makeDeposits, MINE_TIME, OUT_CAP, TOWER_STOCK, TANK, SUPPLY, COAL_SMELTS, CRATE_TIME } from '../src/game/factory.ts';
import type { Fac } from '../src/game/factory.ts';
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
const host = new Sim({ mode: 'coop', players: 2, pauseOnCards: false, seed: 3, map: MAPS[2], free: true });
const cli = new Sim({ mode: 'coop', players: 2, pauseOnCards: false, seed: 3, map: MAPS[2], free: true }); cli.replica = true;
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
  const h2 = new Sim({ mode: 'coop', players: 2, pauseOnCards: false, seed: 11, map: raised, diff: 'hard', free: true });
  h2.nextWaveIn = 30; // the first wave arrives while the specials are fired below (FIRST_WAVE_IN leaves time for a factory)
  const c2 = new Sim({ mode: 'coop', players: 2, pauseOnCards: false, seed: 999, map: raised, free: true }); c2.replica = true;
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
      if (JSON.stringify(c2.preview) !== JSON.stringify(h2.preview) || c2.winWave !== h2.winWave) same = false;
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
for (const v of [NaN, -1, 1e9, 2.5, Infinity]) host.triggerSpecial(v, v);
for (const v of [NaN, -1, 1e9, 2.5]) { host.build('pulse', v, v); host.upgrade(v); host.sell(v); host.pickCard(1, v); }
host.step(1 / 60);
ok(Number.isFinite(host.gold) && host.enemies.every((e) => Number.isFinite(e.x)), 'host state finite after junk input');

const V = { x: 0, y: 0, z: 0 };
const bare: MapDef = { ...MAPS[0], towers: [] };

// ---------- tower specials fired by the player, wave intel, elevation ----------
{
  const s = new Sim({ seed: 5, map: bare, pauseOnCards: false, free: true });
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
  ok(s.specialReady(turret) && !s.triggerSpecial(turret.id, 0) || s.enemies.some((e) => Math.hypot(e.x - turret.x, e.z - turret.z) < 10), 'a special with nothing to hit is not wasted');
  // wait for the wave to reach the turret, then press Fire on it
  run(60 * 30, () => { if (s.specialReady(turret) && s.enemies.some((e) => Math.hypot(e.x - turret.x, e.z - turret.z) < s.range(turret))) s.triggerSpecial(turret.id, 0); });
  ok(Math.abs(nodePos(turret, V).y - (turret.h + 0.55)) < 1e-9 && NODE_R === 0.6, 'node position');
  const iSpec = evs.findIndex((e) => e.k === 'special' && e.id === turret.id && e.t === 'pulse' && e.p === 0), iDown = evs.findIndex((e) => e.k === 'down' && e.id === turret.id), iUp = evs.findIndex((e) => e.k === 'up' && e.id === turret.id);
  ok(iSpec >= 0, 'triggerSpecial fires the special (and names the player)');
  ok(iDown > iSpec && iUp > iDown, 'the tower goes offline after the special and comes back');
  ok(turret.down === 0 && turret.spec === 0 && turret.charge > 0 && turret.charge < 1, 'back online, charging from zero');
  ok(!s.triggerSpecial(turret.id, 0), 'an uncharged special cannot be fired');
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
  const s = new Sim({ seed: 8, map: bare, pauseOnCards: false, free: true });
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
  // (blueprints come on set levels only, one at a time: the first at level 2, then every second or third level)
  const bpAt: number[] = [];
  for (let lvl = 1; lvl <= 28; lvl++) { c.level = lvl; const n = c.rollCards(0).filter((id) => id.startsWith('bp_')).length; ok(n <= 1, 'at most one blueprint in an offer at level ' + lvl); if (n) bpAt.push(lvl); }
  ok(bpAt[0] === 2 && bpAt.length >= 8 && bpAt.length <= 14 && bpAt.every((l, i) => i === 0 || l - bpAt[i - 1] >= 2), 'blueprints are offered at the early levels, never two levels in a row: ' + bpAt.join(','));
  ok(new Sim({ diff: 'easy' }).winWave === 20 && new Sim({ diff: 'normal' }).winWave === 25 && new Sim({ diff: 'hard' }).winWave === 30, 'waves per difficulty');
}


// ---------- regression checks for the review findings ----------
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv = (s: Sim) => s as any;
  const mk = (o: Partial<ConstructorParameters<typeof Sim>[0]> = {}) => { const s = new Sim({ seed: 21, map: bare, pauseOnCards: false, free: true, ...o }); s.gold = 1e6; s.nextWaveIn = 1e9; for (const t of TOWER_TYPES) s.unlocked.add(t); return s; };
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
    // the first wave waits 75 s (there is a factory to set up first) and pays for an early call like every other wave
    const s = new Sim({ seed: 3, map: bare, pauseOnCards: false });
    ok(s.nextWaveIn === FIRST_WAVE_IN && FIRST_WAVE_IN === 75 && s.callBonus() === NEXT_WAVE_IN * 2, 'first wave in 75 s, early-call bonus ' + s.callBonus());
    const g = s.gold; s.startWave();
    ok(s.wave === 1 && s.gold === g + NEXT_WAVE_IN * 2 && s.callBonus() === 0 && s.nextWaveIn === NEXT_WAVE_IN, 'calling wave 1 early pays the bonus');
    const t = new Sim({ seed: 3, map: bare, pauseOnCards: false }); const g2 = t.gold;
    for (let i = 0; i < 60 * (FIRST_WAVE_IN + 1) && !t.wave; i++) t.step(1 / 60);
    ok(t.wave === 1 && Math.abs(t.time - FIRST_WAVE_IN) < 0.1 && t.gold === g2, 'left alone, wave 1 comes after 75 s without a bonus');
    s.queue.length = 0; s.nextWaveIn = 7.2;
    ok(s.callBonus() === 14, 'the bonus is two credits per second saved');
  }
  {
    // pulse cards: extra bolts are weaker
    const s = mk(), t = s.build('pulse', 3, 5)!; put(s, 'grunt', 10); s.mods.twin = 2; t.cd = 0; s.step(1 / 60);
    const b = s.projs.filter((p) => p.kind === 'bolt').map((p) => p.dmg);
    ok(b.length === 3 && Math.abs(b[1] / b[0] - TWIN_BOLT) < 1e-9 && TWIN_BOLT < 1, 'Twin Barrels bolts are weaker than the main bolt');
  }
  {
    // co-op: the players take turns, one card offer per level
    const s = mk({ mode: 'coop', players: 2 });
    for (let lv = 0; lv < 6; lv++) {
      s.xp = s.xpNext; const e = put(s, 'grunt', 5); s.damage(e, 1e12, -1, true);
      const who = s.level % 2;
      ok(s.players[who].pending.length === 1 && s.players[1 - who].pending.length === 0, `co-op level ${s.level}: only player ${who} is offered cards`);
      s.pickCard(who, 0);
      ok(s.players.every((p) => !p.pending.length), 'offers consumed');
    }
  }
  {
    // co-op scaling: the opening waves are the solo ones (two players share one purse), the full multiplier arrives later
    ok(coopScale(COOP_HP, 1) === 1 && coopScale(COOP_HP, TUNE.coopFrom) === 1 && Math.abs(coopScale(COOP_HP, TUNE.coopFrom + TUNE.coopRamp) - COOP_HP) < 1e-9 && coopScale(COOP_HP, 99) === COOP_HP && COOP_HP >= 2, 'co-op multiplier ramps in');
    const hpAt = (mode: 'solo' | 'coop', wave: number) => { const s = mk({ mode, players: mode === 'coop' ? 2 : 1 }); s.wave = wave; return put(s, 'grunt', 5).maxHp; };
    ok(hpAt('coop', 1) === hpAt('solo', 1) && Math.abs(hpAt('coop', 20) / hpAt('solo', 20) - COOP_HP) < 1e-9, 'co-op enemies: solo health in wave 1, COOP_HP times as much later');
  }
  {
    // snapshot: state events survive a flood of cosmetic ones, damage numbers are summed, modifiers are replicated
    const h = mk({ mode: 'coop', players: 2 }), c = mk({ mode: 'coop', players: 2 }); c.replica = true;
    const t = h.build('pulse', 3, 5)!;
    const flood: Ev[] = [{ k: 'build', x: 0, z: 0, c: 1 }];
    for (let i = 0; i < 400; i++) flood.push({ k: 'dmg', x: 0, y: 0, z: 0, n: 5, p: 1, id: 100 + (i % 200) });
    flood.push({ k: 'wave', n: 3 });
    for (let i = 0; i < 300; i++) flood.push({ k: 'hit', x: i, y: 0, z: 0, c: 1 });
    for (const k of ['sell', 'special', 'down', 'up', 'card', 'levelup', 'boss', 'titanLand', 'leak']) flood.push({ k, p: 1, id: 1 });
    for (let i = 0; i < 100; i++) flood.push({ k: 'boom', x: i, y: 0, z: 0, r: 1, c: 1 });
    const snap = JSON.parse(JSON.stringify(h.snapshot(flood)));
    const ks = snap.ev.map((e: Ev) => e.k);
    ok(['build', 'wave', 'sell', 'special', 'down', 'up', 'card', 'levelup', 'boss', 'titanLand', 'leak'].every((k) => ks.includes(k) && MUST_EVENTS.has(k)), 'state events are never dropped from a snapshot');
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
      // Rail shots cut through half of the guard; everything else meets all of it
      const through = (type: 'rail' | 'pulse') => {
        const s = mk(), t = s.build(type, 3, 5)!, g = gyre(s, 10, 1e9);
        let hit = false;
        for (let i = 0; i < 600 && !hit; i++) { s.step(1 / 60); s.events.length = 0; hit = g.hp < 1e9; }
        return (1e9 - g.hp) / s.towerDmg(t);
      };
      const rail = through('rail'), pulse = through('pulse');
      ok(near(rail, 1 - WHEEL_GUARD * (1 - WHEEL_PIERCE), 1e-3) && near(pulse, 1 - WHEEL_GUARD, 1e-3), `a Railgun lands ${rail.toFixed(2)} of its damage on a spinning Gyre, a Pulse Turret ${pulse.toFixed(2)}`);
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
      // never a tower that is offline
      const s = mk(), c = put(s, 'brood', 20);
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
      run(s, 40, (evs) => {
        for (const e of evs) { if (e.k === 'jam') jams++; if (e.k === 'breach' && e.t === 'mite') miteBreach++; }
        for (const e of s.enemies) if (!Number.isFinite(e.x + e.z + e.y + e.gy + e.hp + e.dist + e.yaw)) bad++;
        if (s.time % 9 < 0.02) for (const t of s.towers) { t.charge = 1; s.triggerSpecial(t.id, 0); }
      });
      ok(jams >= 3 && bad === 0 && miteBreach === 0 && s.towers.every((t) => t.jam >= 0 && Number.isFinite(t.jam)), `mites among all the towers and specials: ${jams} jams, state stays finite`);
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
      ok(c.towers.every((x) => x.jam === 0 && x.stun === 0 && !x.dry) && c.enemies.every((e) => e.prey === 0), 'a snapshot without the new fields reads as not jammed, not stunned, not dry');
    }
  }
  {
    // ---------- the Titan ----------
    const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
    const count = (evs: Ev[], k: string, id?: number) => evs.filter((e) => e.k === k && (id === undefined || e.id === id)).length;
    const dT = ENEMIES.titan;
    ok(ENEMY_SCALE.titan === 1 && dT.r === 3.2 && dT.y === 9
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
    {
      // when it comes: one per campaign, on a wave picked by the seed out of the four before the last; wave 22 in Survival; never in Versus
      for (const [diff, last] of [['easy', 20], ['normal', 25], ['hard', 30]] as const) {
        const seen = new Set<number>(); let far = true;
        for (let seed = 1; seed <= 80; seed++) { const q = new Sim({ seed, map: bare, diff }); seen.add(q.titan.wave); if (q.titan.phase !== 'far' || q.titan.danger !== 0) far = false; if (new Sim({ seed, map: bare, diff }).titan.wave !== q.titan.wave) far = false; }
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
      // the leap, the impact, the stun
      const s = mk(), turret = s.build('pulse', 3, 5)!, rail = s.build('rail', 4, 5)!;
      const g1 = put(s, 'grunt', 20), g2 = put(s, 'brute', 30);
      const evs: Ev[] = [];
      land(s, true, evs);
      const gold = s.gold, xp = s.xp, kills = s.kills;
      const gate = s.map.pos(s.titan.lane, 0, { x: 0, z: 0, dx: 0, dz: 0, y: 0 });
      const leap = evs.find((e) => e.k === 'titanLand');
      ok(s.wave === s.titan.wave && s.titan.phase === 'landing' && s.titan.danger === 1 && !!leap && leap.x === gate.x && leap.z === gate.z && leap.lane === s.titan.lane && s.queue.length === 0 && s.titanBusy, 'its wave begins with the leap (titanLand at the gate of its lane), and nothing else is queued');
      run(s, TITAN_LAND - 0.1, (e) => { evs.push(...e); });
      ok(s.titan.phase === 'landing' && g1.alive && g2.alive && !s.enemies.some((e) => e.type === 'titan') && count(evs, 'titanImpact') === 0, 'it is in the air for TITAN_LAND seconds');
      run(s, 0.15, (e) => { evs.push(...e); });
      const ti = s.enemies.find((e) => e.type === 'titan')!, hit = evs.find((e) => e.k === 'titanImpact');
      ok(s.titan.phase === 'walk' && !!hit && hit.x === gate.x && hit.z === gate.z, 'the impact (titanImpact) puts it on the road');
      ok(!g1.alive && !g2.alive && s.enemies.length === 1 && s.gold === gold && s.xp === xp && s.kills === kills, 'the impact destroys every enemy on the field, for no reward');
      ok(s.towers.length >= 2 && s.towers.every((t) => t.stun > TITAN_STUN - 0.2 && t.stun <= TITAN_STUN && towerOff(t)), 'and stuns every tower for TITAN_STUN seconds');
      const len = s.map.lanes[s.titan.lane].len;
      ok(!!ti && ti.lane === s.titan.lane && ti.dist < 0.5 && ti.r === 3.2 && near(ti.y, ti.gy + 9) && ti.maxHp === s.titanHp() && near(ti.speed, Math.max(0.9, Math.min(1.7, len / 70))) && MUST_EVENTS.has('titanLand') && MUST_EVENTS.has('titanImpact') && MUST_EVENTS.has('titanDie'), 'the Titan is an enemy of type titan on its lane, pacing itself to the road');
      const hard = mk({ diff: 'hard' }), easy = mk({ diff: 'easy', seed: 4 });
      ok(near(s.titanHp(), TUNE.titan * waveHpMul(s.titan.wave) * s.mapMul) && near(hard.titanHp() / easy.titanHp(), Math.sqrt(1.3 / 0.72) * (waveHpMul(hard.titan.wave) / waveHpMul(easy.titan.wave)), 1e-6) && near(mk({ mode: 'coop', players: 2 }).titanHp(), s.titanHp() * 1.75), 'its health follows the enemy health of its wave, the difficulty and the number of players');
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
      // regular tower fire only gets through at TUNE.titanTower, tower specials at full strength
      evs.length = 0; const hp = ti.hp;
      run(s, 3, (e) => { evs.push(...e); });
      ok(count(evs, 'shot', turret.id) > 3 && count(evs, 'shot', rail.id) >= 1 && ti.hp < hp && turret.charge > 0.3 && turret.stun === 0, `after the stun the towers fire again and chip at the Titan (${(hp - ti.hp).toFixed(0)})`);
      const h0 = ti.hp, plain = s.damage(ti, 100, -1), rawHit = s.damage(ti, 100, 0, true);
      ok(TUNE.titanTower === 0.35 && near(plain, 100 * TUNE.titanTower) && near(rawHit, 100 * TUNE.titanTower) && near(h0 - ti.hp, 200 * TUNE.titanTower, 1e-6), `plain damage gets through at ${TUNE.titanTower}`);
      priv(s).sp = true; const spHit = s.damage(ti, 100, -1); priv(s).sp = false;
      ok(near(spHit, 100 * TUNE.titanSpec) && TUNE.titanSpec >= 1, 'a hit from a special lands in full');
      const hpS = ti.hp;
      ok(s.triggerSpecial(rail.id, 0), 'Overcharge fires at the Titan');
      ok(near(hpS - ti.hp, s.towerDmg(rail) * 8 * TUNE.titanSpec, 1e-6), `a tower special hurts it in full (${(hpS - ti.hp).toFixed(0)})`);
      const hp2 = ti.hp; turret.charge = 1;
      ok(s.triggerSpecial(turret.id, 0), 'Bullet Storm fires at the Titan');
      run(s, 3);
      ok(ti.hp < hp2 - s.towerDmg(turret) * 20, `Bullet Storm bolts hurt it too (${(hp2 - ti.hp).toFixed(0)})`);
      // slowing effects at 40% strength
      ti.speed = 1; const d0 = ti.dist; run(s, 1); const free = ti.dist - d0;
      ti.slowT = 5; ti.slowF = 0.5; const d1 = ti.dist; run(s, 1);
      ok(near(free, 1, 0.01) && near(ti.dist - d1, 1 - 0.5 * TITAN_SLOW, 0.01), `a 50% slow takes ${(100 * (1 - (ti.dist - d1))).toFixed(0)}% off its pace`);
      ti.slowT = 0; ti.frz = 5; const d2 = ti.dist; run(s, 1);
      ok(near(ti.dist - d2, 1 - TITAN_SLOW, 0.01), 'a freeze only slows it');
      ti.frz = 0; ti.speed = 0;
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
      // destroyed: titanDie, credits and a level, the wave clears and the remaining waves follow
      const s = mk(), evs: Ev[] = [], each = (e: Ev[]) => { evs.push(...e); };
      const ti = land(s), p = s.players[0];
      run(s, 2, each);
      const gold = s.gold, level = s.level, kills = s.kills, wave = s.wave;
      priv(s).sp = true; s.damage(ti, 1e12, 0); priv(s).sp = false;
      evs.push(...s.events.splice(0));
      const die = evs.find((e) => e.k === 'titanDie');
      ok(!ti.alive && s.titan.phase === 'dead' && !s.titanBusy && !!die && near(die.x, ti.x) && near(die.y, ti.y) && near(die.z, ti.z) && count(evs, 'die') === 0, 'titanDie: the Titan is destroyed');
      ok(near(s.gold, gold + TITAN_GOLD) && s.level === level + 1 && count(evs, 'levelup') === 1 && p.pending.length === 1 && s.kills === kills + 1 && p.kills === 1, 'its reward: credits and a level-up');
      p.pending.length = 0;
      run(s, 1, each);
      ok(count(evs, 'clear') === 1 && s.cleared && s.nextWaveIn <= 5, 'normal rules resume: the wave is cleared');
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
      ok(s.wave === TITAN_SURVIVAL + TITAN_AGAIN && !!t2 && near(t2.maxHp / hp1, TITAN_TOUGHER * waveHpMul(TITAN_SURVIVAL + TITAN_AGAIN) / waveHpMul(TITAN_SURVIVAL), 1e-6), `the second Titan is tougher, on top of its later wave (${Math.round(hp1)} then ${Math.round(t2.maxHp)})`);
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
      ok(c.titan.phase === 'walk' && c.titan.wave === h.titan.wave && c.titan.lane === h.titan.lane && c.titan.danger === 1 && Math.abs(c.titan.t - h.titan.t) < 0.011, 'the Titan state reaches the guest');
      ok(!!ct && ct.type === 'titan' && ct.r === 3.2 && near(ct.y, ct.gy + 9) && Math.abs(ct.hp - ti.hp) <= 1 && c.towers.length === h.towers.length && c.towers.every((t, i) => Math.abs(t.stun - h.towers[i].stun) < 0.011 && t.stun > 0), 'the Titan itself and the stunned towers reach the guest');
      ok(['titanLand', 'titanImpact', 'titanSmash', 'titanDie', 'titanStrike'].every((k) => c.events.some((e) => e.k === k)) && c.events.some((e) => e.k === 'titanLand' && e.lane === 0 && e.x === 1), 'the Titan events reach the guest');
      h.preview = { wave: 22, lanes: [[{ type: 'titan', n: 1 }]] };
      c.applySnapshot(JSON.parse(JSON.stringify(h.snapshot([]))));
      ok(c.preview.lanes[0].length === 1 && c.preview.lanes[0][0].type === 'titan', 'the guest sees the Titan in the wave preview');
      for (const bad of [[99, 5, 'x', -1, 1e9], ['walk', NaN, 1e99, {}, -4], [-1, -1, -1, -1, -1], [2.7, 0.5, 23.9, 1e99, 0.4], 'x', null, [[]]]) {
        const o = JSON.parse(JSON.stringify(snap)); o.ti = bad; o.a[16] = bad;
        try { c.applySnapshot(o); } catch (e) { ok(false, 'hostile Titan state threw ' + e); }
        ok(TITAN_PHASES.includes(c.titan.phase) && c.titan.danger >= 0 && c.titan.danger <= 1 && Number.isInteger(c.titan.wave) && c.titan.wave >= 0 && c.titan.t >= 0 && Number.isFinite(c.titan.t) && Number.isInteger(c.titan.lane) && c.titan.lane >= 0 && c.titan.lane < c.map.lanes.length, 'hostile Titan state is clamped: ' + JSON.stringify(bad));
      }
    }
    {
      // the bot fires a charged special at the Titan: specials are what hurts it most
      const s = mk(), rail = s.build('rail', 4, 5)!, bot = new Bot(s, 0);
      const ti = land(s);
      let specials = 0;
      const hp = ti.hp;
      for (let i = 0; i < 60 * 14; i++) {
        if (i === 60) { for (const t of s.towers) t.stun = 0; rail.charge = 1; }
        bot.step(1 / 60); s.step(1 / 60);
        for (const e of s.events.splice(0)) if (e.k === 'special' && e.id === rail.id) specials++;
        s.players[0].pending.length = 0;
      }
      ok(specials === 1 && ti.hp < hp, 'the bot fires a charged special at the Titan');
    }
    {
      // a whole campaign with the bot: the Titan comes, is destroyed, and the final waves still play
      const s = new Sim({ seed: 7, map: MAPS[0], diff: 'easy', pauseOnCards: false, free: true }), bot = new Bot(s, 0);
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
    // the nudge after measuring: a little more health on the early waves, the same from wave 20 on
    const before = (w: number) => 1 + 0.2 * (w - 1) + 0.055 * (w - 1) ** 2 + 0.0033 * (w - 1) ** 3, up = (w: number) => waveHpMul(w) / before(w);
    ok(up(1) === 1 && up(5) > 1.02 && up(5) < 1.04 && up(10) > 1.01 && up(10) < 1.025 && Math.abs(up(20) - 1) < 0.005 && Math.abs(up(25) - 1) < 0.005 && Math.abs(up(30) - 1) < 0.01,
      `early waves are a little tougher, late ones as before (wave 5 ${up(5).toFixed(3)}, 10 ${up(10).toFixed(3)}, 20 ${up(20).toFixed(3)}, 25 ${up(25).toFixed(3)})`);
  }
}

// survival keeps going past the campaign's final wave
const sv = new Sim({ pauseOnCards: false, seed: 9, survival: true, diff: 'easy', free: true }); const b3 = new Bot(sv, 0, 2);
for (let i = 0; i < 60 * 1500 && !sv.over; i++) { b3.step(1 / 60); sv.step(1 / 60); sv.events.length = 0; }
ok(!sv.won, 'survival never "wins"'); console.log('survival reached wave', sv.wave);

// ---------- the factory: deposits, supply crates, mines, belts, smelters, plants, pipes, power, tower supply, unlocks, waves on call ----------
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv = (s: Sim) => s as any;
  const T = (o: OreType) => ORE_TYPES.indexOf(o) + 1;
  const at = (cx: number, cz: number) => cz * GW + cx;
  const a2s = (a: ArrayLike<number>) => Array.prototype.join.call(a, '');
  /**
   * A run with the factory switched on (not free), no waves coming, and plenty of credits. Every tower and building is unlocked and
   * the map's supply crates are cleared away, so each test lays out exactly what it checks (`raw`: unlocks and crates as a run starts with them).
   */
  const fac = (o: Partial<ConstructorParameters<typeof Sim>[0]> = {}, raw = false) => {
    const s = new Sim({ seed: 31, map: bare, pauseOnCards: false, ...o }); s.gold = 1e5; s.nextWaveIn = 1e9;
    if (!raw) { for (const f of s.factory.facs.slice()) s.factory.remove(f.id); for (const t of TOWER_TYPES) s.unlocked.add(t); for (const f of FAC_TYPES) s.facs.add(f); }
    return s;
  };
  const step = (s: Sim, sec: number, evs?: Ev[]) => { for (let i = 0; i < Math.round(sec * 60); i++) { s.step(1 / 60); const e = s.events.splice(0); if (evs) evs.push(...e); s.players.forEach((p) => { p.pending.length = 0; }); } };
  /** The centre of a patch of free deck of radius r, cleared of deposits (the tests lay their own). */
  const open = (s: Sim, r: number, skip = 0): [number, number] => {
    for (let i = 0; i < GW * GH; i++) {
      const cx = i % GW, cz = Math.floor(i / GW), d = disc(cx, cz, r);
      if (!d.every(([x, z]) => inBoard(x, z) && s.grid[at(x, z)] === 0)) continue;
      if (skip-- > 0) continue;
      for (const [x, z] of d) s.factory.ore[at(x, z)] = 0;
      return [cx, cz];
    }
    throw new Error('no free patch of radius ' + r);
  };
  /** The tile n steps from c in direction d. */
  const go = (c: [number, number], d: number, n = 1): [number, number] => { let p = c; for (let i = 0; i < n; i++) p = neighbor(p[0], p[1], d); return p; };
  const lay = (s: Sim, c: [number, number], o: OreType) => { s.factory.ore[at(c[0], c[1])] = T(o); };
  /** A stationary enemy that does not die. */
  const foe = (s: Sim, dist: number) => { priv(s).spawn('grunt', 1e6, 0); const e: Enemy = s.enemies[s.enemies.length - 1]; e.speed = 0; e.dist = dist; e.off = 0; priv(s).place(e); return e; };
  /** A free tile within r of a cell, not one of `not`. */
  const freeNear = (s: Sim, cx: number, cz: number, r: number, not: [number, number][] = []): [number, number] => {
    for (const [x, z] of disc(cx, cz, r)) if (inBoard(x, z) && s.grid[at(x, z)] === 0 && !(x === cx && z === cz) && !not.some((q) => q[0] === x && q[1] === z)) return [x, z];
    throw new Error('no free tile near ' + cx + ',' + cz);
  };
  const shotsOf = (evs: Ev[], id: number) => evs.filter((e) => e.k === 'shot' && e.id === id).length;
  const crates = (s: Sim) => s.factory.facs.filter((f) => f.type === 'crate');
  const roadside = (g: ArrayLike<number>, cx: number, cz: number) => [0, 1, 2, 3, 4, 5].some((d) => { const [x, z] = neighbor(cx, cz, d); return inBoard(x, z) && g[at(x, z)] === 1; });

  {
    // deposits: every pre-made map has iron, copper, coal and oil, on free deck only, the same for any seed, and iron close to a road
    for (const m of MAPS) {
      const s = new Sim({ seed: 1, map: m }), ore = s.factory.ore, kinds = new Set<number>();
      let bad = 0, near = 0;
      for (let i = 0; i < GW * GH; i++) if (ore[i]) {
        kinds.add(ore[i]); if (s.map.grid[i] !== 0 || ore[i] > ORE_TYPES.length) bad++;
        if (ore[i] === T('iron_ore') && disc(i % GW, Math.floor(i / GW), 2).some(([x, z]) => inBoard(x, z) && s.map.grid[at(x, z)] === 1)) near++;
      }
      ok(kinds.size === ORE_TYPES.length && !bad, `${m.id}: deposits of every kind, on free deck (${[...kinds].sort().map((k) => ORE_TYPES[k - 1]).join(', ')}${bad ? `, ${bad} on roads or scenery` : ''})`);
      ok(near > 0, `${m.id}: some iron lies within 2 tiles of a road (${near} tiles)`);
      const again = new Sim({ seed: 999, map: m }).factory.ore, free = new Sim({ seed: 5, map: m, free: true }).factory.ore;
      ok(again.every((v, i) => v === ore[i]) && free.every((v, i) => v === ore[i]), `${m.id}: deposits do not depend on the seed or on free towers`);
    }
    const g = new Sim({ seed: 1, map: bare }).map.grid;
    ok(makeDeposits(g, 'x').every((v, i, a) => v === makeDeposits(g, 'x')[i] && (v === 0 || g[i] === 0)) && a2s(makeDeposits(g, 'x')) !== a2s(makeDeposits(g, 'y')), 'makeDeposits is deterministic per key, and the key matters');
  }
  {
    // supply crates: every run that needs a factory starts with iron ore beside its roads; trickier maps bring a later tower's ammunition too
    let stocked = 0;
    for (const m of MAPS) {
      const s = new Sim({ seed: 1, map: m }), cr = crates(s), iron = cr.filter((f) => f.hold === 'iron_ore');
      const sound = cr.every((f) => s.map.grid[at(f.cx, f.cz)] === 0 && s.grid[at(f.cx, f.cz)] === 2 && !s.factory.ore[at(f.cx, f.cz)] && roadside(s.map.grid, f.cx, f.cz) && s.factory.facAt(f.cx, f.cz) === f && !!f.hold && f.left === CRATE_STOCK[f.hold] && f.left > 0);
      ok(iron.length >= 1 && sound, `${m.id}: at least one crate of iron ore, every crate on a free roadside tile off the deposits (${cr.map((f) => `${f.left} ${f.hold} at ${f.cx},${f.cz}`).join('; ')})`);
      const sig = (q: Sim) => crates(q).map((f) => [f.cx, f.cz, f.hold, f.left].join()).join(';');
      ok(sig(new Sim({ seed: 777, map: m })) === sig(s), `${m.id}: the crates do not depend on the seed`);
      const f = new Sim({ seed: 1, map: m, free: true });
      ok(!f.factory.facs.length && FAC_TYPES.every((t) => f.facs.has(t)) && !f.facs.has('crate'), `${m.id}: a free run has no crates and every building unlocked`);
      const extra = cr.find((c) => c.hold === 'copper' || c.hold === 'shell');
      if ((m.tier || 1) >= 2) {
        const tw = TOWER_TYPES.find((t) => extra && TOWERS[t].needs.item === extra.hold);
        ok(!!extra && !!tw && s.unlocked.has(tw) && s.facs.has('generator') && s.facs.has('pole') && cr.length === iron.length + 1, `${m.id} (tier ${m.tier}): one crate of copper plates or shells, and its tower, the Generator and the Pole are open (${extra ? extra.hold : 'none'}, ${[...s.unlocked].join(',')})`);
      } else ok(!extra && s.unlocked.size === 1 + new Set(m.towers.map((t) => t.t)).size - (m.towers.some((t) => t.t === 'pulse') ? 1 : 0) && s.facs.size === 2, `${m.id} (tier 1): iron ore only, nothing unlocked beyond the start`);
      // the map's own towers start fully stocked
      for (const t of s.towers) { const n = TOWERS[t.type].needs; if (n.item || n.fluid) { stocked++; ok((!n.item || t.stock === TOWER_STOCK) && (!n.fluid || t.tank === TANK), `${m.id}: its own ${t.type} starts fully stocked`); } }
    }
    ok(stocked > 0, `the maps' own towers start fully stocked (${stocked} checked)`);
    // a Pulse Turret built next to a crate fills up from it; that is not a delivery by the factory
    const s = fac({}, true), cr = crates(s).find((f) => f.hold === 'iron_ore')!, spot = freeNear(s, cr.cx, cr.cz, 1), n0 = cr.left;
    ok(s.unlocked.size === 1 && s.unlocked.has('pulse') && cr.state === 'idle', 'a run starts with the Pulse Turret only');
    const t = s.build('pulse', spot[0], spot[1])!, evs: Ev[] = [];
    ok(!!t && t.stock === 0 && hexDist(t.cx, t.cz, cr.cx, cr.cz) === 1, 'a turret goes up beside a crate, empty');
    step(s, CRATE_TIME * TOWER_STOCK + 1, evs);
    ok(t.stock === TOWER_STOCK && !t.dry && cr.left === n0 - TOWER_STOCK && cr.state === 'ok' && s.factory.delivered === 0 && evs.some((q) => q.k === 'fed' && q.id === t.id), `the crate fills it up to ${TOWER_STOCK} items (${t.stock}; ${cr.left} of ${n0} left in the crate, delivered ${s.factory.delivered})`);
    cr.left = 2; t.stock = 0;
    step(s, 3);
    ok(cr.left === 0 && cr.state === 'empty' && t.stock === 2 && s.factory.delivered === 0, `a crate hands out what it holds and is then empty (${cr.left} left, state ${cr.state}, turret ${t.stock})`);
    step(s, 3);
    ok(cr.left === 0 && t.stock === 2, 'an empty crate gives nothing more');
    ok(s.facBlock('crate', spot[0] + 1, spot[1]) === 'unknown' && !s.buildFac('crate', spot[0] + 1, spot[1]) && !FAC_TYPES.includes('crate'), 'a crate cannot be built');
    // an empty crate can be cleared away (for nothing); one that still holds something stays
    const full = crates(s).find((f) => f.left > 0)!, gc = s.gold;
    ok(!!full && !s.sellFac(full.id) && s.factory.facById(full.id) === full && s.sellFac(cr.id) && s.gold === gc && !s.factory.facById(cr.id) && s.grid[at(cr.cx, cr.cz)] === 0, 'an empty crate can be cleared away for nothing, a crate with something in it cannot');
    // a crate also loads a belt that leads to a turret, and no belt that does not
    const q = fac({}, true), c2 = crates(q).find((f) => f.hold === 'iron_ore')!;
    const d = [0, 1, 2, 3, 4, 5].find((k) => [1, 2, 3].every((n) => { const p = go([c2.cx, c2.cz], k, n); return inBoard(p[0], p[1]) && q.grid[at(p[0], p[1])] === 0; }))!;
    const b1 = q.buildFac('belt', ...go([c2.cx, c2.cz], d), d)!, b2 = q.buildFac('belt', ...go([c2.cx, c2.cz], d, 2), d)!;
    step(q, 3);
    ok(!!b1 && !!b2 && !b1.items.length && !b2.items.length && c2.left === CRATE_STOCK.iron_ore, 'a crate puts nothing on a belt that leads to no turret');
    const t2 = q.build('pulse', ...go([c2.cx, c2.cz], d, 3))!;
    step(q, 8);
    ok(!!t2 && t2.stock === TOWER_STOCK && c2.left < CRATE_STOCK.iron_ore!, `with a turret at the end of the belt the crate feeds it (${t2.stock})`);
  }
  {
    // supply: a new Pulse Turret is empty and dry; with ore in stock it fires 15 shots an item and runs dry again; a mine right beside it feeds it
    const s = fac(), t = s.build('pulse', 3, 5)!, e = foe(s, 10), evs: Ev[] = [], per = (ITEM_SHOTS.iron_ore || 0) * s.mods.ammo;
    ok(!!t && t.stock === 0 && t.ammo === 0 && t.tank === 0 && t.pwr === 0 && !t.dry && Math.hypot(e.x - t.x, e.z - t.z) < s.range(t), 'a new turret is empty: no ammunition, nothing in the tank');
    step(s, 3, evs);
    ok(t.dry && towerOff(t) && !s.supplied(t) && shotsOf(evs, t.id) === 0 && evs.some((q) => q.k === 'dry' && q.id === t.id), 'so it is dry from the first step and fires nothing at the enemy in range');
    t.stock = 2; evs.length = 0;
    step(s, (2 * per) / s.towerRate(t) + 3, evs);
    const fired = shotsOf(evs, t.id);
    ok(per === 15 && fired === 2 * per && t.dry && t.stock === 0 && evs.some((q) => q.k === 'fed' && q.id === t.id) && evs.some((q) => q.k === 'dry' && q.id === t.id), `with 2 iron ore it fires 2 x ${per} shots and runs dry again (${fired} shots, fed and dry events)`);
    const charge = t.charge; evs.length = 0;
    step(s, 3, evs);
    ok(shotsOf(evs, t.id) === 0 && t.charge === charge, 'a dry tower neither fires nor charges');
    t.charge = 1;
    ok(!s.specialReady(t) && !s.triggerSpecial(t.id, 0) && t.charge === 1, 'and its special cannot be fired');
    t.charge = charge;
    const F = freeNear(s, t.cx, t.cz, 1);
    ok(s.facBlock('mine', F[0], F[1]) === 'needs an iron, copper or coal deposit' && !s.buildFac('mine', F[0], F[1]), 'a mine needs a deposit');
    lay(s, F, 'iron_ore');
    ok(s.facBlock('pump', F[0], F[1]) === 'needs an oil field' && s.facBlock('mine', F[0], F[1]) === '', 'a pumpjack needs an oil field, a mine goes on ore');
    const mine = s.buildFac('mine', F[0], F[1])!;
    ok(!!mine && mine.ore === 'iron_ore' && s.grid[at(F[0], F[1])] === 2 && s.factory.facAt(F[0], F[1]) === mine && !mine.under, 'the mine stands on its deposit');
    evs.length = 0; step(s, 8, evs);
    ok(!t.dry && evs.some((q) => q.k === 'fed' && q.id === t.id) && shotsOf(evs, t.id) > 3 && s.factory.delivered >= 2 && mine.state === 'ok', `a mine right next to the turret hands it ore and it fires again (${shotsOf(evs, t.id)} shots, ${s.factory.delivered} delivered)`);
    // with nothing to shoot at the turret fills up, then the mine does
    s.enemies.length = 0; t.stock = 0; t.ammo = 0; mine.out.length = 0; mine.prog = 0;
    const d0 = s.factory.delivered;
    step(s, MINE_TIME * TOWER_STOCK + 0.5);
    ok(t.stock === TOWER_STOCK && s.factory.delivered === d0 + TOWER_STOCK, `the mine digs one ore every ${MINE_TIME} s and fills the turret up to ${TOWER_STOCK} (${t.stock})`);
    step(s, MINE_TIME * (OUT_CAP + 1));
    ok(mine.out.length === OUT_CAP && mine.out.every((it) => it === 'iron_ore') && mine.state === 'full' && t.stock === TOWER_STOCK, 'with nowhere to put more, the mine fills up and stops');
    // a tower that runs on power: dry without a grid, working once a generator is in reach
    const far = (() => { for (let i = 0; i < GW * GH; i++) { const x = i % GW, z = Math.floor(i / GW); if (s.grid[i] === 0 && hexDist(x, z, F[0], F[1]) > SUPPLY + 3 && disc(x, z, SUPPLY).filter(([u, v]) => inBoard(u, v) && s.grid[at(u, v)] === 0).length > 3) return [x, z] as [number, number]; } return [0, 0] as [number, number]; })();
    const cryo = s.build('cryo', far[0], far[1])!;
    step(s, 0.1);
    ok(!!cryo && cryo.dry && cryo.pwr === 0, 'a Cryo Emitter without power is dry from the start');
    const G2 = freeNear(s, cryo.cx, cryo.cz, SUPPLY);
    const gen2 = s.buildFac('generator', G2[0], G2[1], 0)!;
    step(s, 0.5);
    ok(!!gen2 && cryo.dry && gen2.state === 'nofuel', 'a generator without coal powers nothing');
    gen2.inv.coal = 2;
    step(s, 0.5);
    ok(!cryo.dry && cryo.pwr > 0.99 && gen2.state === 'ok' && s.factory.powerAt(cryo.cx, cryo.cz) === gen2.net, `a generator with coal within ${SUPPLY} tiles powers it`);
    s.sellFac(gen2.id);
    step(s, 0.5);
    ok(cryo.dry && cryo.pwr === 0, 'and it goes dry again when the generator is sold');
  }
  {
    // one belt line from a mine feeds the turret at its end and the turrets it only runs past
    const s = fac(), c = open(s, 3), M = go(c, 3, 2), E = go(c, 0, 2), P1 = go(c, 1), P2 = go(go(c, 0), 5);
    lay(s, M, 'iron_ore');
    const mine = s.buildFac('mine', M[0], M[1])!, belts = [go(c, 3), c, go(c, 0)].map((p) => s.buildFac('belt', p[0], p[1], 0)!);
    step(s, 5);
    ok(!!mine && belts.every((b) => !!b && b.dir === 0 && !b.items.length) && mine.out.length >= 3, 'a mine puts nothing on a belt that leads to nothing that wants its ore');
    const end = s.build('pulse', E[0], E[1])!, past1 = s.build('pulse', P1[0], P1[1])!, past2 = s.build('pulse', P2[0], P2[1])!;
    ok(!!end && !!past1 && !!past2 && [end, past1, past2].every((t) => hexDist(t.cx, t.cz, M[0], M[1]) > 1) && hexDist(past1.cx, past1.cz, c[0], c[1]) === 1 && hexDist(past2.cx, past2.cz, belts[2].cx, belts[2].cz) === 1, 'three turrets: one at the end of the line, two beside it, none next to the mine');
    let onBelt = 0;
    for (let i = 0; i < 60 * 30; i++) { step(s, 1 / 60); if (belts.some((b) => b.items.some((q) => q.it === 'iron_ore'))) onBelt++; }
    ok(onBelt > 0 && end.stock === TOWER_STOCK && !end.dry, `ore rides the belt into the turret it points at (${end.stock})`);
    ok(past1.stock === TOWER_STOCK && past2.stock === TOWER_STOCK && !past1.dry && !past2.dry, `and the turrets the belt only runs past take theirs from it (${past1.stock}, ${past2.stock})`);
    ok(s.factory.delivered === 3 * TOWER_STOCK, `all of it counts as delivered (${s.factory.delivered})`);
    step(s, 40);
    ok(mine.state === 'full' && belts.every((b) => b.items.length >= 2 && b.items.every((q) => q.it === 'iron_ore' && q.p >= 0 && q.p <= 1)) && s.factory.delivered === 3 * TOWER_STOCK, `with every turret full the ore waits on the belt and nothing is thrown away (${belts.map((b) => b.items.length).join('+')} on the belts)`);
    // a belt turned back toward the mine leads nowhere: the mine loads nothing
    s.rotateFac(belts[0].id, 3);
    ok(belts[0].dir === 3, 'a belt can be turned');
    for (const b of belts) b.items.length = 0;
    for (const t of [end, past1, past2]) t.stock = 0;
    step(s, 6);
    ok(belts.every((b) => !b.items.length) && end.stock + past1.stock + past2.stock === 0 && mine.state === 'full', 'a belt that points back at the mine takes nothing from it');
    s.rotateFac(belts[0].id, 0);
    step(s, 12);
    ok(end.stock > 0 && past1.stock > 0 && past2.stock > 0, 'turned forward again, the line runs again');
  }
  {
    // a coal mine beside a belt that leads to nothing that burns coal loads nothing; a generator beside the belt changes that
    const s = fac(), c = open(s, 3), M = go(c, 3), B2 = go(c, 0), E = go(c, 0, 2), G = go(B2, 1);
    lay(s, M, 'coal');
    const mine = s.buildFac('mine', M[0], M[1])!, b1 = s.buildFac('belt', c[0], c[1], 0)!, b2 = s.buildFac('belt', B2[0], B2[1], 0)!, tw = s.build('pulse', E[0], E[1])!;
    step(s, 12);
    ok(!!mine && mine.ore === 'coal' && !!tw && !b1.items.length && !b2.items.length && mine.state === 'full' && tw.stock === 0, 'coal is not loaded onto a belt that only leads to a Pulse Turret');
    const gen = s.buildFac('generator', G[0], G[1])!;
    ok(!!gen && hexDist(G[0], G[1], M[0], M[1]) > 1 && hexDist(G[0], G[1], B2[0], B2[1]) === 1, 'a generator beside the second belt, not next to the mine');
    let coal = 0;
    for (let i = 0; i < 60 * 20; i++) { step(s, 1 / 60); if (b1.items.some((q) => q.it === 'coal')) coal++; }
    ok(coal > 0 && (gen.inv.coal || 0) === 4 && gen.fuel > 0 && gen.state === 'idle' && tw.stock === 0 && b2.items.every((q) => q.it === 'coal'), `now the coal rides the belt and the generator takes it as it passes (${gen.inv.coal} coal in the generator)`);
  }
  {
    // a smelter needs coal as fuel (one for COAL_SMELTS plates) and melts iron ore and copper ore into plates
    const s = fac(), c = open(s, 2), S = go(c, 0), M2 = go(S, 0), M3 = go(S, 1);
    lay(s, c, 'iron_ore'); lay(s, M2, 'coal'); lay(s, M3, 'copper_ore');
    const mine = s.buildFac('mine', c[0], c[1])!, sm = s.buildFac('smelter', S[0], S[1])!;
    step(s, 5);
    ok(!!mine && !!sm && (sm.inv.iron_ore || 0) > 0 && mine.out.length < OUT_CAP && sm.state === 'nofuel' && !sm.out.length, 'the mine hands its ore to the smelter beside it, which has no coal yet');
    const coal = s.buildFac('mine', M2[0], M2[1])!;
    step(s, 14);
    ok(!!coal && coal.ore === 'coal' && sm.out.length >= 4 && sm.out.every((it) => it === 'iron'), `with coal from a coal mine the smelter melts iron plates (${sm.out.length}: ${sm.out.join(',')})`);
    step(s, 20);
    ok(sm.out.length === OUT_CAP && sm.state === 'full', 'with nowhere to put the plates it fills up and stops');
    // copper ore becomes copper plates the same way (the iron mine makes way for a copper mine)
    s.sellFac(mine.id); sm.out.length = 0;
    const cu = s.buildFac('mine', M3[0], M3[1])!, made: Record<string, number> = {};
    for (let i = 0; i < 60; i++) { step(s, 1); for (const it of sm.out.splice(0)) made[it] = (made[it] || 0) + 1; }
    ok(!!cu && cu.ore === 'copper_ore' && made.iron > 0 && made.iron <= 7 && made.copper > 10 && Object.keys(made).length === 2, `fed copper ore it melts the iron ore it still holds, then copper plates (${JSON.stringify(made)})`);
    // the fuel: one coal is good for COAL_SMELTS plates
    const q = fac(), qc = open(q, 1), one = q.buildFac('smelter', qc[0], qc[1])!;
    one.inv.iron_ore = 6; one.inv.coal = 1;
    step(q, 20);
    ok(COAL_SMELTS === 4 && one.out.length === COAL_SMELTS && one.inv.iron_ore === 6 - COAL_SMELTS && one.state === 'nofuel' && !FACS.smelter.power, `one coal melts ${COAL_SMELTS} plates, then the smelter is out of fuel (${one.out.length} plates, state ${one.state})`);
    // copper plates are the Railgun's ammunition: a smelter next to it hands them over
    const R = go(qc, 0), rail = (q.mats = 20, q.build('rail', R[0], R[1])!);
    one.out.length = 0; one.inv.iron_ore = 0; one.inv.copper_ore = 4; one.inv.coal = 1;
    step(q, 12);
    ok(!!rail && rail.stock === TOWER_STOCK && q.factory.delivered === TOWER_STOCK && TOWERS.rail.needs.item === 'copper' && rail.dry, `a smelter beside a Railgun fills it with copper plates (${rail.stock}); without power it is still dry`);
  }
  {
    // Frame Works: two iron plates become one building material, with power only
    const s = fac(), c = open(s, 2), G = go(c, 3);
    const works = s.buildFac('works', c[0], c[1])!, gen = s.buildFac('generator', G[0], G[1])!, mk = MAKES.works!;
    works.inv.iron = 6;
    const m0 = s.mats, evs: Ev[] = [];
    step(s, 6, evs);
    ok(!!works && !!gen && works.state === 'nopower' && works.pwr === 0 && gen.state === 'nofuel' && s.mats === m0 && !evs.some((q) => q.k === 'mats'), 'without power a Frame Works makes nothing');
    gen.inv.coal = 4;
    step(s, 12, evs);
    const n = evs.filter((q) => q.k === 'mats').length;
    ok(mk.mats === 1 && mk.inp.iron === 2 && !mk.out && n === 3 && s.mats === m0 + n * mk.mats && !works.out.length && !works.inv.iron && works.state === 'noinput' && evs.filter((q) => q.k === 'mats').every((q) => q.n === mk.mats && q.x === works.x && q.z === works.z),
      `with power 6 iron plates become ${n} building materials (${m0} to ${s.mats}), straight into the stock: no Frame item, no Depot`);
    // the whole chain: iron mine and coal mine into a smelter, its plates into the works beside it
    const q = fac(), S = open(q, 2), Mi = go(S, 3), W = go(S, 0), Mc = go(S, 1), Gq = go(Mc, 1);
    lay(q, Mi, 'iron_ore'); lay(q, Mc, 'coal');
    q.buildFac('mine', Mi[0], Mi[1]); q.buildFac('mine', Mc[0], Mc[1]); q.buildFac('smelter', S[0], S[1]);
    const w2 = q.buildFac('works', W[0], W[1])!, g2 = q.buildFac('generator', Gq[0], Gq[1])!, q0 = q.mats;
    step(q, 90);
    ok(!!w2 && !!g2 && hexDist(Gq[0], Gq[1], W[0], W[1]) <= SUPPLY && q.mats >= q0 + 5 && w2.pwr === 1 && g2.fuel > 0, `mines, smelter, generator and Frame Works in a row raise the materials by themselves (${q0} to ${q.mats} in 90 s)`);
  }
  {
    // Shell Press: an iron plate and a coal make a shell, which a belt carries to the Plasma Mortar
    const s = fac(), c = open(s, 3), B = go(c, 0), Mo = go(c, 0, 2), G = go(B, 1);
    const press = s.buildFac('press', c[0], c[1])!, belt = s.buildFac('belt', B[0], B[1], 0)!, gen = s.buildFac('generator', G[0], G[1])!, mortar = s.build('mortar', Mo[0], Mo[1])!;
    ok(!!press && !!belt && !!gen && !!mortar && mortar.stock === 0 && s.mats === START_MATS - TOWERS.mortar.mat, 'press, belt, generator and an empty mortar are down');
    press.inv.iron = 4; press.inv.coal = 4;
    step(s, 4);
    ok(press.state === 'nopower' && !press.out.length && !belt.items.length && mortar.stock === 0 && mortar.dry, 'without power the press makes nothing and the mortar stays dry');
    gen.inv.coal = 4;
    let onBelt = 0;
    for (let i = 0; i < 60 * 20; i++) { step(s, 1 / 60); if (belt.items.some((q) => q.it === 'shell')) onBelt++; }
    ok(press.pwr === 1 && onBelt > 0 && mortar.stock === TOWER_STOCK && !mortar.dry && mortar.pwr === 1 && s.factory.delivered === TOWER_STOCK && !press.inv.iron && !press.inv.coal && TOWERS.mortar.needs.item === 'shell',
      `with power 4 plates and 4 coal become 4 shells, and the belt takes them to the mortar (${mortar.stock})`);
  }
  {
    // a pumpjack on oil fills a pipe network with crude, which reaches a Firewall Pylon's tank; nothing flows without power
    const s = fac(), c = open(s, 3), G = go(c, 3), P1 = go(c, 0), P2 = go(c, 0, 2), Fl = go(c, 0, 3);
    lay(s, c, 'oil');
    ok(s.facBlock('mine', c[0], c[1]) !== '' && s.facBlock('pump', c[0], c[1]) === '', 'oil takes a pumpjack, not a mine');
    const pump = s.buildFac('pump', c[0], c[1])!, gen = s.buildFac('generator', G[0], G[1])!;
    const p1 = s.buildFac('pipe', P1[0], P1[1])!, p2 = s.buildFac('pipe', P2[0], P2[1])!, pylon = s.build('flame', Fl[0], Fl[1])!;
    ok(!!pump && !!gen && !!p1 && !!p2 && !!pylon && pylon.tank === 0 && TOWERS.flame.needs.fluid === 'crude' && !TOWERS.flame.needs.power, 'pumpjack, generator, two pipes and a pylon with an empty tank are down');
    step(s, 3);
    ok(pump.state === 'nopower' && pump.tout === 0 && pylon.tank === 0 && pylon.dry && s.factory.pipeFluid(p1).fill === 0, 'nothing flows without power, and the pylon is dry');
    gen.inv.coal = 4;
    step(s, 20);
    const fl = s.factory.pipeFluid(p1);
    ok(pump.pwr === 1 && fl.fluid === 'crude' && p1.net === p2.net && p1.net >= 0 && p1.state === 'ok' && (s.factory.pipeMask(p2) & 1) === 1, `with power the pumpjack fills the pipes with crude oil (${fl.fluid}, ${(100 * fl.fill).toFixed(0)}% full)`);
    ok(pylon.tank > TANK / 2 && pylon.tank <= TANK && !pylon.dry, `the crude reaches the pylon's tank (${pylon.tank.toFixed(1)} of ${TANK})`);
    step(s, 10);
    ok(pump.state === 'full' && pump.tout === TANK && pylon.tank === TANK, 'with everything full the pumpjack stops');
    // a dry pylon burns nothing
    const e = foe(s, s.map.nearest(0, pylon.x, pylon.z));
    if (Math.hypot(e.x - pylon.x, e.z - pylon.z) <= FIRE_RING + e.r) { s.sellFac(p2.id); pylon.tank = 0; const hp = e.hp; step(s, 2); ok(pylon.dry && e.hp === hp, 'a pylon with an empty tank burns nothing'); }
    // a pumpjack right next to a pylon needs no pipe
    const q = fac(), qc = open(q, 2), qg = go(qc, 3), qf = go(qc, 0);
    lay(q, qc, 'oil');
    const qp = q.buildFac('pump', qc[0], qc[1])!, qgen = q.buildFac('generator', qg[0], qg[1])!, qt = q.build('flame', qf[0], qf[1])!;
    qgen.inv.coal = 2; step(q, 10);
    ok(!!qp && qt.tank === TANK && !qt.dry, 'a pumpjack right next to a pylon fills it without a pipe');
  }
  {
    // the long chain: pumpjack, refinery (crude to petrol), a pipe to the Missile Works, missiles into the battery beside it
    const s = fac(), c = open(s, 3), Pm = go(c, 3), P = go(c, 0), W = go(c, 0, 2), Tw = go(c, 0, 3), G = go(c, 1), Po = go(W, 1);
    lay(s, Pm, 'oil'); s.mats = 20;
    const pump = s.buildFac('pump', Pm[0], Pm[1])!, ref = s.buildFac('refinery', c[0], c[1])!, pipe = s.buildFac('pipe', P[0], P[1])!, mw = s.buildFac('missiles', W[0], W[1])!;
    const gen = s.buildFac('generator', G[0], G[1])!, pole = s.buildFac('pole', Po[0], Po[1])!, bat = s.build('missile', Tw[0], Tw[1])!;
    ok(!!pump && !!ref && !!pipe && !!mw && !!gen && !!pole && !!bat && bat.stock === 0, 'pumpjack, refinery, pipe, Missile Works, generator, pole and battery are down');
    mw.inv.iron = 4; mw.inv.copper = 4;
    step(s, 5);
    ok(pump.state === 'nopower' && ref.tin === 0 && ref.tout === 0 && mw.tin === 0 && !mw.out.length && bat.stock === 0 && bat.dry && pole.state === 'nopower', 'without power nothing is pumped, cracked or built');
    gen.inv.coal = 4;
    step(s, 3);
    ok(s.factory.wires.length === 1 && pole.state === 'ok' && pole.net === gen.net && bat.pwr > 0 && pump.pwr > 0 && ref.pwr > 0, 'the pole carries the generator\'s power on to the battery');
    step(s, 40);
    const fl = s.factory.pipeFluid(pipe);
    ok(fl.fluid === 'petrol' && s.factory.fluidIn(mw) === 'petrol' && s.factory.fluidIn(ref) === 'crude', `the refinery takes crude straight from the pumpjack beside it and fills the pipe with petrol (${fl.fluid}, ${(100 * fl.fill).toFixed(0)}% full)`);
    ok(bat.stock === TOWER_STOCK && !bat.dry && s.factory.delivered === TOWER_STOCK && !mw.inv.iron && !mw.inv.copper && TOWERS.missile.needs.item === 'missile', `the Missile Works turns 4 iron, 4 copper and petrol into 4 missile packs for the battery (${bat.stock})`);
    // Cell Plant: a copper plate and crude oil make a cell for the Lance Emitter
    const q = fac(), qc = open(q, 2), qp = go(qc, 3), qt = go(qc, 0), qg = go(qc, 1);
    lay(q, qp, 'oil'); q.mats = 20;
    const pj = q.buildFac('pump', qp[0], qp[1])!, cells = q.buildFac('cells', qc[0], qc[1])!, g2 = q.buildFac('generator', qg[0], qg[1])!, lance = q.build('lance', qt[0], qt[1])!;
    cells.inv.copper = 4;
    step(q, 4);
    ok(!!pj && !!cells && !!g2 && !!lance && cells.tin === 0 && !cells.out.length && lance.stock === 0 && lance.dry && cells.state === 'noinput', 'a Cell Plant without crude oil makes nothing');
    g2.inv.coal = 4;
    step(q, 25);
    ok(lance.stock === TOWER_STOCK && !lance.dry && q.factory.delivered === TOWER_STOCK && !cells.inv.copper && q.factory.fluidIn(cells) === 'crude' && TOWERS.lance.needs.item === 'cell' && TOWERS.gravity.needs.item === 'cell', `with power and a pumpjack beside it, 4 copper plates become 4 cells for the lance (${lance.stock})`);
  }
  {
    // no deadlock: a line that ends at a smelter full of coal but out of ore, with coal at its head, tips the coal off so the ore behind gets through
    const s = fac(), c = open(s, 2), B2 = go(c, 3), B1 = go(c, 3, 2);
    const sm = s.buildFac('smelter', c[0], c[1])!, b1 = s.buildFac('belt', B1[0], B1[1], 0)!, b2 = s.buildFac('belt', B2[0], B2[1], 0)!;
    sm.inv.coal = 4;
    for (const p of [1, 0.5, 0]) { b2.items.push({ it: 'coal', p }); b1.items.push({ it: 'iron_ore', p }); }
    step(s, 0.05);
    ok(sm.state === 'noinput' && sm.inv.coal === 4, 'a smelter with all the coal it holds and no ore, three coal at the end of its line and the ore behind them');
    step(s, 12);
    ok(sm.out.length === 3 && sm.out.every((it) => it === 'iron') && !b1.items.length && !b2.items.some((q) => q.it === 'iron_ore'), `the line does not lock up: the coal in the way is tipped off and the ore is melted (${sm.out.length} plates, ${b2.items.length} items left on the last belt)`);
    // (only a starved building tips: where the smelter is merely full, the coal waits)
    const q = fac(), qc = open(q, 2), Q2 = go(qc, 3);
    const full = q.buildFac('smelter', qc[0], qc[1])!, qb = q.buildFac('belt', Q2[0], Q2[1], 0)!;
    full.inv.coal = 4; full.inv.iron_ore = 6; for (let i = 0; i < OUT_CAP; i++) full.out.push('iron');
    for (const p of [1, 0.5, 0]) qb.items.push({ it: 'coal', p });
    step(q, 6);
    ok(full.state === 'full' && qb.items.length === 3 && qb.items[0].p === 1, 'at a smelter that is full, not starved, the coal waits on the belt');
  }
  {
    // unlocks: a run starts with the Pulse Turret, the Mine and the Belt; blueprints bring a tower with its supply chain, tier by tier
    const s = fac({}, true), [cx, cz] = open(s, 1), g0 = s.gold;
    ok([...s.unlocked].join() === 'pulse' && [...s.facs].sort().join() === 'belt,mine' && TOWER_CHAIN.pulse.join() === 'mine,belt', 'a run starts with the Pulse Turret, the Mine and the Belt');
    for (const t of FAC_TYPES) if (t !== 'mine' && t !== 'belt') ok(s.facBlock(t, cx, cz) === 'locked' && !s.buildFac(t, cx, cz), `${t} is locked at the start`);
    ok(s.gold === g0 && !s.factory.facAt(cx, cz) && s.facBlock('belt', cx, cz) === '' && !s.canBuild('rail', cx, cz), 'a locked building costs nothing and places nothing');
    ok(s.bpOpen().join() === TOWER_TYPES.filter((t) => TOWER_TIER[t] === 1).join(), 'the first blueprints on offer are the tier 1 towers: ' + s.bpOpen().join(', '));
    s.players[0].pending = [['bp_rail']]; s.pickCard(0, 0);
    ok(s.unlocked.has('rail') && TOWER_CHAIN.rail.every((f) => s.facs.has(f)) && s.facs.size === 2 + TOWER_CHAIN.rail.length && s.facBlock('smelter', cx, cz) === '' && s.facBlock('press', cx, cz) === 'locked' && !!s.buildFac('smelter', cx, cz),
      `the Railgun blueprint unlocks the tower and ${TOWER_CHAIN.rail.join(', ')}`);
    for (const t of TOWER_TYPES) ok(TOWER_CHAIN[t].every((f) => FAC_TYPES.includes(f)) && (!TOWERS[t].needs.power || (TOWER_CHAIN[t].includes('generator') && TOWER_CHAIN[t].includes('pole'))) && (TOWERS[t].mat === 0 || TOWER_CHAIN[t].includes('works')), `${t}: its chain covers power and materials`);
    const noCard = TOWER_TYPES.filter((t) => t !== 'pulse' && !Object.hasOwn(CARD_BY_ID, 'bp_' + t));
    ok(!noCard.length && CARDS.filter((c) => c.kind === 'blueprint').every((c) => c.max === 1 && TOWER_TYPES.includes(c.id.slice(3) as typeof TOWER_TYPES[number])), 'every tower but the Pulse Turret has a blueprint card' + (noCard.length ? ' (none for: ' + noCard.join(', ') + ', so the blueprints stop at its tier)' : ''));
    // walk the whole tree on every map: the offer never reaches past the tier after the lowest one still locked
    // (not while a tower has no card: the walk cannot get past it, and the check above says so once)
    for (const m of noCard.length ? [] : MAPS) {
      const q = new Sim({ seed: 3, map: m }), seen = new Set<string>(), start = [...q.unlocked];
      let n = 0, tiers = true, took = true;
      for (; n < 30; n++) {
        const offer = q.bpOpen();
        if (!offer.length) break;
        const locked = TOWER_TYPES.filter((t) => !q.unlocked.has(t) || TOWER_CHAIN[t].some((f) => !q.facs.has(f)));
        const low = Math.min(...locked.map((t) => TOWER_TIER[t])), lowest = locked.filter((t) => TOWER_TIER[t] === low);
        if (!offer.every((t) => locked.includes(t) && TOWER_TIER[t] <= low + 1) || !lowest.every((t) => offer.includes(t)) || (lowest.length > 1 && offer.length !== lowest.length)) tiers = false;
        // every card rolled is one of them
        q.level = 2; for (let i = 0; i < 40; i++) { const r = q.rollCards(0); if (!r[0].startsWith('bp_') || r.some((id) => id.startsWith('bp_') && !offer.includes(id.slice(3) as typeof offer[number]))) tiers = false; }
        const pick = offer[n % offer.length]; seen.add(pick);
        q.players[0].pending = [['bp_' + pick]]; q.pickCard(0, 0);
        if (!q.unlocked.has(pick) || !TOWER_CHAIN[pick].every((f) => q.facs.has(f))) took = false;
      }
      ok(tiers && took && n <= TOWER_TYPES.length && TOWER_TYPES.every((t) => q.unlocked.has(t)) && FAC_TYPES.every((f) => q.facs.has(f)) && !q.facs.has('crate') && start.every((t) => t === 'pulse' || seen.has(t)),
        `${m.id}: blueprints come tier by tier and end with everything unlocked (${n} cards; started with ${start.join(',')})`);
      ok(!q.rollCards(0).some((id) => id.startsWith('bp_')), `${m.id}: no blueprint is offered once all are taken`);
    }
    // Underpass: not before level 3, and once only
    const u = fac({}, true), has = (lvl: number) => { u.level = lvl; let n = 0; for (let i = 0; i < 1500; i++) if (u.rollCards(0).includes('underpass')) n++; return n; };
    const l1 = has(1), l2 = has(2), l3 = has(3), l8 = has(8);
    u.players[0].pending = [['underpass']]; u.pickCard(0, 0);
    ok(l1 === 0 && l2 === 0 && l3 > 0 && l8 > 0 && u.mods.underpass === 1 && has(8) === 0 && CARD_BY_ID.underpass.max === 1, `the Underpass card is offered from level 3 on, once (in 1500 offers: ${l1} at level 1, ${l2} at 2, ${l3} at 3, ${l8} at 8)`);
  }
  {
    // Underpass: belts and pipes may cross under a plain stretch of road; nothing else may, and not at the core or under a ramp
    const s = fac(), core = s.map.def.core, why = 'road: belts and pipes cross it once you have the Underpass';
    const roads: [number, number][] = []; for (let i = 0; i < GW * GH; i++) if (s.grid[i] === 1) roads.push([i % GW, Math.floor(i / GW)]);
    const far = roads.filter(([x, z]) => hexDist(x, z, core[0], core[1]) > 1), near = roads.filter(([x, z]) => hexDist(x, z, core[0], core[1]) <= 1);
    ok(s.mods.underpass === 0 && roads.every(([x, z]) => s.facBlock('belt', x, z) === why && s.facBlock('pipe', x, z) === why && s.facBlock('smelter', x, z) === 'road') && !s.buildFac('belt', far[0][0], far[0][1], 0), 'without the Underpass nothing goes on a road');
    s.mods.underpass = 1;
    ok(far.length > 20 && far.every(([x, z]) => s.facBlock('belt', x, z) === '' && s.facBlock('pipe', x, z) === ''), `with it, belts and pipes go on every road tile of a flat map away from the core (${far.length} tiles)`);
    ok(near.length > 0 && near.every(([x, z]) => s.facBlock('belt', x, z) === 'no way under here' && s.facBlock('pipe', x, z) === 'no way under here' && !s.buildFac('belt', x, z, 0)), `but not within a tile of the core (${near.length} tiles)`);
    ok(FAC_TYPES.every((t) => t === 'belt' || t === 'pipe' || (s.facBlock(t, far[0][0], far[0][1]) === 'road' && !s.buildFac(t, far[0][0], far[0][1]))) && !s.canBuild('pulse', far[0][0], far[0][1]), 'no other building and no tower goes on a road');
    // a straight crossing: belt, belt under the road, turret on the far side
    const free = (p: [number, number]) => inBoard(p[0], p[1]) && s.grid[at(p[0], p[1])] === 0;
    let X: { r: [number, number]; d: number } | null = null;
    for (const r of far) { for (let d = 0; d < 6 && !X; d++) if (free(go(r, d)) && free(go(r, d + 3)) && free(go(r, d + 3, 2))) X = { r, d }; if (X) break; }
    ok(!!X, 'the map has a road one tile wide to cross');
    if (X) {
      const { r, d } = X, A = go(r, d + 3), B = go(r, d), g0 = s.gold;
      const a = s.buildFac('belt', A[0], A[1], d)!, u = s.buildFac('belt', r[0], r[1], d)!, tw = s.build('pulse', B[0], B[1])!;
      ok(!!a && !a.under && !!u && u.under && s.grid[at(r[0], r[1])] === 1 && s.factory.facAt(r[0], r[1]) === u && s.facBlock('pipe', r[0], r[1]) === 'taken', 'a belt laid on the road runs under it: the tile stays a road');
      a.items.push({ it: 'iron_ore', p: 0 });
      step(s, 3);
      ok(!!tw && tw.stock === 1 && !a.items.length && !u.items.length, 'an item crosses under the road and reaches the turret on the other side');
      const e = foe(s, s.map.nearest(0, u.x, u.z)), d0 = e.dist; e.speed = 3; step(s, 1);
      ok(e.dist > d0 + 1, 'enemies walk over it as before');
      const g1 = s.gold;
      ok(s.sellFac(u.id) && s.gold === g1 + FACS.belt.cost && s.grid[at(r[0], r[1])] === 1 && !s.factory.facAt(r[0], r[1]) && g0 > g1, 'sold again, the road is still a road');
      const p = s.buildFac('pipe', r[0], r[1])!;
      ok(!!p && p.under && s.grid[at(r[0], r[1])] === 1, 'a pipe crosses the same way');
    }
    // under a ramp or a bridge there is no room
    const h = fac({ map: hill }); h.mods.underpass = 1;
    const hr: [number, number][] = []; for (let i = 0; i < GW * GH; i++) if (h.grid[i] === 1 && hexDist(i % GW, Math.floor(i / GW), h.map.def.core[0], h.map.def.core[1]) > 1) hr.push([i % GW, Math.floor(i / GW)]);
    const shut = hr.filter(([x, z]) => h.facBlock('belt', x, z) === 'no way under here'), okay = hr.filter(([x, z]) => h.facBlock('belt', x, z) === '');
    ok(shut.length > 0 && okay.length > 0 && shut.length + okay.length === hr.length && shut.every(([x, z]) => !h.buildFac('pipe', x, z)), `on a map with a raised road, nothing goes under the ramps and the raised stretch (${shut.length} of ${hr.length} road tiles shut)`);
  }
  {
    // waves on call: with autoWaves off nothing comes until the player calls it; holdFirst holds only the first wave
    const mk = () => new Sim({ seed: 8, map: bare, pauseOnCards: false });
    const idle = (s: Sim, sec: number) => { for (let i = 0; i < sec * 20; i++) { s.step(1 / 20); s.events.length = 0; s.players[0].pending.length = 0; } };
    const clear = (s: Sim) => { s.queue.length = 0; s.enemies.length = 0; };
    const d = mk();
    ok(d.autoWaves === true && d.holdFirst === false && d.callBonus() === Math.round(Math.min(NEXT_WAVE_IN, FIRST_WAVE_IN) * 2), 'by default waves come by themselves, and calling one early pays');
    idle(d, FIRST_WAVE_IN + 1);
    ok(d.wave === 1, `by default the first wave starts after ${FIRST_WAVE_IN} s`);
    const m = mk(); m.autoWaves = false;
    ok(m.callBonus() === 0, 'with waves on call there is no bonus for calling');
    idle(m, FIRST_WAVE_IN * 4);
    ok(m.wave === 0 && !m.enemies.length && !m.queue.length && !m.waveActive && m.callBonus() === 0, `autoWaves off: no wave after ${FIRST_WAVE_IN * 4} s of waiting`);
    const g0 = m.gold; m.startWave();
    ok(m.wave === 1 && m.queue.length > 0 && m.gold === g0, 'startWave() starts it, without a bonus');
    clear(m); idle(m, NEXT_WAVE_IN * 10);
    ok(m.wave === 1 && !m.queue.length && m.callBonus() === 0, 'and the next one waits for the call as well');
    m.startWave();
    ok(m.wave === 2 && m.queue.length > 0, 'which starts it');
    const h = mk(); h.holdFirst = true;
    idle(h, FIRST_WAVE_IN * 4);
    ok(h.wave === 0 && !h.enemies.length && h.callBonus() === 0, 'holdFirst: the first wave never starts by itself, and calling it pays nothing');
    const g1 = h.gold; h.startWave();
    ok(h.wave === 1 && h.gold === g1, 'startWave() starts it');
    clear(h); idle(h, 1);
    ok(h.wave === 1 && h.callBonus() > 0, `after it the waves are on the timer again: calling the next one early pays ${h.callBonus()}`);
    idle(h, NEXT_WAVE_IN + 1);
    ok(h.wave === 2, 'and it comes by itself');
  }
  {
    // what building costs and what selling gives back: credits and materials
    const s = fac(), g0 = s.gold;
    ok(s.mats === START_MATS && START_MATS === 4 && START_GOLD_MUL === 1.5 && new Sim({ seed: 1, map: bare }).gold === Math.round(bare.gold * START_GOLD_MUL), `a run starts with ${START_MATS} materials and ${START_GOLD_MUL} times the map's credits`);
    ok(TOWER_TYPES.filter((t) => TOWERS[t].mat > 0).sort().join() === 'gravity,lance,missile,mortar,rail' && TOWER_TYPES.every((t) => (TOWERS[t].mat > 0) === (upgradeMat(t, 1) > 0) && (TOWERS[t].mat > 0) === (upgradeMat(t, 2) > 0)), 'only the Railgun, Mortar, Lance, Graviton Well and Missile Battery cost materials, to build and to upgrade');
    const [cx, cz] = open(s, 1), N = neighbor(cx, cz, 0);
    const belt = s.buildFac('belt', cx, cz, 2)!;
    ok(!!belt && belt.dir === 2 && s.gold === g0 - FACS.belt.cost && s.facCost('belt') === FACS.belt.cost && s.mats === START_MATS, 'a belt costs its credits and no materials');
    ok(s.facSellValue(belt.id) === FACS.belt.cost && s.sellFac(belt.id) && s.gold === g0 && !s.factory.facAt(cx, cz) && s.grid[at(cx, cz)] === 0, 'a belt sells for its full price and frees the tile');
    for (const t of ['pipe', 'pole'] as const) { const f = s.buildFac(t, cx, cz)!; ok(s.facSellValue(f.id) === FACS[t].cost && s.sellFac(f.id) && s.gold === g0, `a ${t} sells for its full price`); }
    const sm = s.buildFac('smelter', cx, cz, 0)!;
    ok(s.facSellValue(sm.id) === Math.round(FACS.smelter.cost * 0.6) && s.sellFac(sm.id) && s.gold === g0 - FACS.smelter.cost + Math.round(FACS.smelter.cost * 0.6), 'a smelter sells for 60%');
    ok(!s.sellFac(sm.id) && s.facSellValue(sm.id) === 0, 'selling twice gives nothing');
    const g1 = s.gold, t = s.build('pulse', cx, cz)!;
    ok(!!t && s.gold === g1 - TOWERS.pulse.cost && s.mats === START_MATS && t.spentMat === 0 && s.matCost('pulse') === 0 && TOWERS.pulse.mat === 0, `a Pulse Turret costs ${TOWERS.pulse.cost} credits and no materials`);
    ok(!s.buildFac('belt', cx, cz) && s.facBlock('belt', cx, cz) === 'taken', 'nothing is built on a tower');
    ok(s.upMat(t) === 0 && s.upgrade(t.id) && s.mats === START_MATS && t.spentMat === 0, 'nor does its upgrade');
    const g2 = s.gold;
    ok(s.sell(t.id) && s.mats === START_MATS && s.gold === g2 + Math.round(t.spent * 0.6), 'selling it gives back 60% of the credits');
    // a tower that costs materials
    const g3 = s.gold, r = s.build('rail', cx, cz)!;
    ok(!!r && TOWERS.rail.mat > 0 && TOWERS.rail.mat <= START_MATS && s.gold === g3 - TOWERS.rail.cost && s.mats === START_MATS - TOWERS.rail.mat && r.spentMat === TOWERS.rail.mat && s.matCost('rail') === TOWERS.rail.mat, `a Railgun costs ${TOWERS.rail.cost} credits and ${TOWERS.rail.mat} materials: the starting materials pay for the first one`);
    const up = s.upMat(r), m1 = s.mats;
    ok(up === upgradeMat('rail', 1) && up > m1 && !s.upgrade(r.id) && r.lvl === 1 && s.mats === m1, `its upgrade costs ${up} materials and is refused without them`);
    s.mats = up + 1;
    ok(s.upgrade(r.id) && r.lvl === 2 && s.mats === 1 && r.spentMat === TOWERS.rail.mat + up, 'with the materials it goes through');
    const m2 = s.mats, g4 = s.gold;
    ok(s.sell(r.id) && s.mats === m2 + Math.floor(r.spentMat * 0.6) && s.gold === g4 + Math.round(r.spent * 0.6), 'selling a tower gives back 60% of the credits and of the materials');
    s.mats = TOWERS.rail.mat - 1; const g5 = s.gold;
    ok(!s.canBuild('rail', cx, cz) && !s.build('rail', cx, cz) && s.gold === g5 && s.mats === TOWERS.rail.mat - 1, 'without the materials a tower cannot be built');
    s.gold = FACS.mine.cost - 1;
    ok(s.facBlock('belt', N[0], N[1]) === '' && s.facBlock('smelter', N[0], N[1]) === 'not enough credits' && !s.buildFac('smelter', N[0], N[1]), 'without the credits a building cannot be built');
    s.gold = 1e5; s.mods.cheap = 0.9;
    ok(s.facCost('refinery') === Math.round(FACS.refinery.cost * 0.9), 'Nano Fabricator makes the factory cheaper too');
    s.over = true;
    ok(!s.buildFac('belt', N[0], N[1]), 'nothing is built once the run is over');
    // free towers: no materials, no supply
    const f = fac({ free: true }), ft = f.build('rail', 3, 5) || f.build('pulse', 3, 5)!;
    ok(f.opts.free && f.matCost('rail') === 0 && f.upMat(ft) === 0 && f.mats === START_MATS && ft.spentMat === 0 && f.supplied(ft), 'with free towers nothing costs materials and every tower counts as supplied');
    ok(new Sim({ free: 'yes' as unknown as boolean }).opts.free === false && new Sim({}).opts.free === false, 'only free: true switches free towers on');
  }
  {
    // garbage input: bad types, cells off the board or between tiles, NaN directions, unknown ids
    const s = fac(), [cx, cz] = open(s, 2), n0 = s.factory.facs.length, g0 = s.gold, grid0 = s.grid.slice();
    const types = ['nuke', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 5, null, undefined, {}, NaN, 'Belt', 'crate', 'fab', 'depot'] as unknown as FacType[];
    const vals = [NaN, -1, GW, 1e9, -1e9, 0.5, 2.5, Infinity, -Infinity, '3', null] as unknown as number[];
    let threw = '';
    try {
      for (const t of types) { s.facBlock(t, cx, cz); s.buildFac(t, cx, cz, 0); }
      for (const t of [...FAC_TYPES, 'crate' as FacType]) for (const v of vals) { s.facBlock(t, v, v); s.buildFac(t, v, cz, 0); s.buildFac(t, cx, v, 0); s.buildFac(t, v, v, v); s.canBuild('pulse', v, cz); s.canBuild('pulse', cx, v); }
      for (const v of [...vals, 0, 1e15]) { s.sellFac(v); s.rotateFac(v, v); s.facSellValue(v); }
      step(s, 0.5);
    } catch (e) { threw = String(e); }
    const moved = s.grid.reduce((a, v, i) => a + (v !== grid0[i] ? 1 : 0), 0);
    ok(!threw && s.factory.facs.length === n0 && s.gold === g0 && !moved, `garbage in buildFac / sellFac / rotateFac throws nothing and places nothing (${threw || `${s.factory.facs.length - n0} placed, ${moved} tiles changed, ${g0 - s.gold} credits spent`})`);
    ok(vals.every((v) => s.facBlock('belt', v, cz) !== '' && s.facBlock('belt', cx, v) !== '' && !s.canBuild('pulse', v, cz) && !s.canBuild('pulse', cx, v)) && s.facBlock('belt', cx, cz) === '', 'facBlock and canBuild refuse cells that are not whole tiles on the board');
    for (const v of [0.5, 2.5]) { const q = fac(), n = q.towers.length; for (let x = 0; x < GW; x++) q.build('pulse', x, v); ok(q.towers.length === n, `a tower is not built between rows (cz ${v}: ${q.towers.length - n} built)`); }
    // a belt laid with a direction that is not a number still gets one, and items still move on it
    const q = fac(), [bx, bz] = open(q, 2), belts: Fac[] = [];
    let err = '';
    try {
      for (const d of [NaN, Infinity, -Infinity, 7.5, -13] as number[]) { const B = belts.length ? neighbor(belts[belts.length - 1].cx, belts[belts.length - 1].cz, 0) : [bx, bz]; const b = q.buildFac('belt', B[0], B[1], d); if (b) { b.items.push({ it: 'iron', p: 0 }); belts.push(b); } }
      step(q, 2);
    } catch (e) { err = String(e); }
    ok(!err && belts.length >= 3 && belts.every((b) => Number.isInteger(b.dir) && b.dir >= 0 && b.dir < 6) && belts.slice(0, 3).every((b) => b.dir === 0), `buildFac with a NaN, infinite or fractional direction gives a belt a direction 0..5 (${err || belts.map((b) => b.dir).join(',')})`);
    // turning: only belts face a way
    const r = fac(), [rx, rz] = open(r, 2), G = neighbor(rx, rz, 0);
    const bl = r.buildFac('belt', rx, rz, 1)!, gn = r.buildFac('generator', G[0], G[1], 4)!, rev = r.factory.rev;
    r.rotateFac(gn.id, 2); r.rotateFac(bl.id, NaN); r.rotateFac(bl.id, Infinity);
    ok(gn.dir === 4 && bl.dir === 1 && r.factory.rev === rev, 'a generator does not turn, and a belt ignores a direction that is not a number');
    r.rotateFac(bl.id, 5); const a = bl.dir; r.rotateFac(bl.id, -1); const b = bl.dir; r.rotateFac(bl.id, 8.7); const c = bl.dir;
    ok(a === 5 && b === 5 && c === 2 && r.factory.rev === rev + 2, `a belt turns to any direction, wrapped into 0..5 (${a}, ${b}, ${c})`);
  }
  {
    // the snapshot carries the materials and whether a tower is dry; hostile values are clamped
    const h = fac({ mode: 'coop', players: 2 }), c = fac({ mode: 'coop', players: 2 }); c.replica = true;
    const t = h.build('cryo', 3, 5)!, p = h.build('pulse', 5, 3) || h.build('pulse', 4, 5)!; step(h, 0.1); h.mats = 17;
    c.applySnapshot(JSON.parse(JSON.stringify(h.snapshot([]))));
    const ct = c.towerById(t.id), cp = c.towerById(p.id);
    ok(t.dry && p.dry && c.mats === 17 && !!ct && ct.dry && !!cp && cp.dry, 'materials and dry towers reach the guest');
    p.stock = 1; step(h, 0.1);
    c.applySnapshot(JSON.parse(JSON.stringify(h.snapshot([]))));
    ok(!p.dry && !c.towerById(p.id)!.dry && c.towerById(t.id)!.dry, 'and so does a tower that has been fed');
    for (const v of [-5, 'x', NaN, null, {}]) {
      const o = JSON.parse(JSON.stringify(h.snapshot([]))); o.a[18] = v; o.t = o.t.map((row: unknown[]) => { const q = row.slice(); q[14] = v; return q; });
      c.applySnapshot(o);
      ok(c.mats === 0 && c.towers.every((x) => !x.dry), 'hostile materials and dry flags are clamped: ' + JSON.stringify(v));
    }
  }
  {
    // free towers: the bot plays with them (it lays out no factory) and the run is deterministic; towers fire without supply
    const play = () => {
      const s = new Sim({ seed: 13, map: MAPS[1], diff: 'easy', pauseOnCards: false, free: true }), b = new Bot(s, 0);
      let shots = 0, dry = 0;
      for (let i = 0; i < 60 * 60 * 40 && !s.over; i++) { b.step(1 / 60); s.step(1 / 60); for (const e of s.events.splice(0)) { if (e.k === 'shot') shots++; else if (e.k === 'dry') dry++; } }
      return { s, shots, dry };
    };
    const a = play(), b = play();
    const sig = (q: Sim) => [q.over, q.won, q.wave, q.lives, q.kills, Math.floor(q.gold), q.level, q.towers.length, q.time.toFixed(3)].join();
    ok(a.s.over && sig(a.s) === sig(b.s) && a.shots === b.shots, `a free-tower bot run ends the same way every time (${a.s.won ? 'won' : 'lost'} on wave ${a.s.wave} of ${a.s.winWave}, ${a.s.lives} lives left)`);
    // a tower built in a free run is as empty as any other, and never uses or needs a thing
    const own = new Set(MAPS[1].towers.map((t) => t.cx + ',' + t.cz));
    const built = a.s.towers.filter((t) => !own.has(t.cx + ',' + t.cz));
    ok(a.dry === 0 && a.shots > 1000 && a.s.towers.length >= 6 && built.length >= 5 && a.s.towers.every((t) => !t.dry && t.ammo === 0 && a.s.supplied(t)) && built.every((t) => t.stock === 0 && t.tank === 0) && !a.s.factory.facs.length && a.s.factory.delivered === 0,
      `its ${a.s.towers.length} towers fired ${a.shots} shots without any supply and never went dry`);
  }
}
console.log(fail ? `${fail} FAILED` : 'all smoke checks passed');
process.exit(fail ? 1 : 0);
