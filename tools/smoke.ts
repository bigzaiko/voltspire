// Quick headless checks: node tools/smoke.ts
// Covers maps, co-op replication, towers and their specials, the enemies (Gyre, Broodcarrier, Titan), the factory
// (deposits, supply crates, mines, belts, splitters, belt and pipe tunnels, smelters, plants, pipes, power, tower supply, building
// levels, level-3 ammunition, the supply diagnosis and links, time standing still between waves, unlocks, waves on call) and bot runs with free towers.
import { Sim, nodePos, towerOff, TITAN_PHASES, computeWalls, paceOf, NODE_R, DECK_GAP, MUST_EVENTS, SNAP_EVENTS_MAX, CORE_STAND } from '../src/game/sim.ts';
import type { Ev, Enemy, Tower } from '../src/game/sim.ts';
import {
  ENEMIES, ENEMY_SCALE, ENEMY_TYPES, WAVE_POOL, gyreCount, broodCap, GYRE_FIRST, GYRE_PAIR, BROOD_EVERY, BROOD_SIZE, BROOD_REACH, MITE_HOLD, JAM_LINGER,
  TITAN_LAND, TITAN_STUN, TITAN_WINDUP, TITAN_STRIKE_EVERY, TITAN_STRIKE, TITAN_SLOW, TITAN_GOLD, TITAN_SURVIVAL, TITAN_AGAIN, TITAN_TOUGHER, TITAN_SMASH, TITAN_LEAD, WHEEL_GUARD, WHEEL_CRAWL, WHEEL_BLEED, WHEEL_DRAG, WHEEL_SINK, WHEEL_REST, WHEEL_SPINUP, WHEEL_PIERCE, TOWERS, TOWER_TYPES, CARDS, CARD_BY_ID, GW, GH, TWIN_BOLT, TUNE, COOP_HP, coopScale,
  BREACH_TIME, BREACH_TIME_BOSS, BREACH_SHARE, FIRST_WAVE_IN, NEXT_WAVE_IN, LINK_RANGE, WALL_HALF, FIRE_RING,
  ORE_TYPES, FACS, FAC_TYPES, MAKES, TOWER_CHAIN, TOWER_TIER, CRATE_STOCK, START_MATS, START_GOLD_MUL, ITEM_SHOTS, upgradeMat,
  TOWER_NEEDS_L3, needsOf, FAC_LVL_SPEED, FAC_UP_COST, FAC_UPGRADABLE, cellX, cellZ, TARGET_MODES, TARGET_DEFAULT, START_FACS, FAC_CARD, PROD_CARDS, AMMO2_CARD,
} from '../src/game/data.ts';
import type { FacType, OreType, TargetMode, TowerType, ItemType, Card } from '../src/game/data.ts';
import { waveHpMul } from '../src/game/data.ts';
import { hexDist, neighbor, disc, inBoard } from '../src/game/hex.ts';
import type { MapDef } from '../src/game/map.ts';
import { Bot } from '../src/game/bot.ts';
import { MAPS } from '../src/game/maps.ts';
import { sanitizeMap, validateMap, encodeMap, decodeMap } from '../src/game/map.ts';
import { makeDeposits, MINE_TIME, OUT_CAP, TOWER_STOCK, TANK, TOWER_TANK, SUPPLY, COAL_SMELTS, SMELT_TIME, CRATE_TIME, BELT_SPEED, BELT_GAP, TUNNEL_REACH, SPLIT_CAP, PUMP_RATE, ARM_TIME, PICK_AT, DROP_AT } from '../src/game/factory.ts';
import type { Fac } from '../src/game/factory.ts';
import { checkResources, BELT_REACH, armLines } from '../src/game/deposits.ts';
import { playOpening } from './opening.ts';
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
  s.nextWaveIn = 1; // (towers and their specials only work while a wave is on)
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
    // targeting modes: each picks the expected enemy of a fixed line-up; defaults; setAim rules; upgrades and co-op keep the mode
    const lineup = (s: Sim) => {
      const at = (type: string, dist: number, hp: number, speed: number) => { const e = put(s, type, dist, 0, speed); e.hp = e.maxHp = hp; e.shield = e.maxShield = 0; return e; };
      const lead = at('grunt', 20, 300, 2), tail = at('grunt', 5, 200, 2), fly = at('drone', 12, 50, 3.8), boss = at('boss', 10, 5000, 1.2);
      const cold = at('grunt', 15, 400, 2); cold.slowT = 1; cold.slowF = 0.5; // pace 1: slower than the boss
      const ice = at('grunt', 8, 250, 2); ice.frz = 2; // frozen solid: pace 0
      return { lead, tail, fly, boss, cold, ice };
    };
    const s = mk(), L = lineup(s), pick = (t: Tower) => priv(s).pickTarget(t, 999, 0) as Enemy | null;
    /** build on the next free cell (where it stands does not matter: the picks below ignore the range) */
    const at = (ty: TowerType) => { for (let i = 0; i < GW * GH; i++) { const t = s.build(ty, i % GW, Math.floor(i / GW)); if (t) return t; } throw new Error('no free cell'); };
    const p = at('pulse'), m = at('mortar'), ra = at('rail'), la = at('lance');
    ok(TOWER_TYPES.every((ty) => at(ty).aim === TARGET_DEFAULT[ty]) && ra.aim === 'strong' && la.aim === 'strong' && p.aim === 'first' && m.aim === 'first', 'new towers start on their default targeting mode');
    ok(pick(p) === L.lead && pick(ra) === L.boss && pick(la) === L.boss && pick(m) === L.lead, 'the defaults: first for the turret and mortar, strongest for rail and lance');
    const want: Record<TargetMode, Enemy> = { first: L.lead, last: L.tail, strong: L.boss, weak: L.fly, fast: L.fly, slow: L.ice };
    for (const mode of TARGET_MODES) { ok(s.setAim(p.id, mode) && p.aim === mode && pick(p) === want[mode], `'${mode}' picks the ${mode === 'slow' ? 'frozen grunt' : want[mode].type}`); }
    L.ice.frz = 0; L.ice.slowT = 0; L.ice.speed = 3;
    ok(pick(p) === L.cold, "'slow' picks a slowed enemy once nothing is frozen");
    // the mortar cannot shell a flyer, whatever its mode: the weakest and the fastest on the ground instead (two grunts at pace 2: the one further along)
    s.setAim(m.id, 'weak'); const mw = pick(m); s.setAim(m.id, 'fast'); const mf = pick(m);
    ok(mw === L.tail && mf === L.ice, `the mortar's modes skip flyers (weak: ${mw?.type} at ${mw?.dist}, fast: ${mf?.type} at ${mf?.dist})`);
    L.ice.speed = 2; s.setAim(m.id, 'fast');
    ok(pick(m) === L.lead, 'an exact tie on pace goes to the enemy further along');
    // the missile volley takes its targets in the same order pickTarget ranks them
    for (const mode of TARGET_MODES.filter((x) => x !== 'first')) { const list = s.enemies.slice().sort((a, b) => priv(s).aimCmp(mode, a, b)); p.aim = mode; ok(list[0] === pick(p), `the volley order agrees with '${mode}'`); }
    // an exact tie on 'strong' goes to the boss, even when the other enemy came first
    const s2 = mk(), g = put(s2, 'grunt', 10), b = put(s2, 'boss', 10); g.hp = b.hp = 900; g.shield = b.shield = 0;
    const r2 = s2.build('rail', 3, 5)!;
    ok(priv(s2).pickTarget(r2, 999, 0) === b, 'strongest: a boss wins an exact tie');
    // setAim rules
    const bc = at('beacon'), fl = at('flame'), gr = at('gravity');
    s.events.length = 0;
    ok(!s.setAim(bc.id, 'last') && !s.setAim(fl.id, 'last') && !s.setAim(gr.id, 'last') && bc.aim === 'first' && fl.aim === 'first' && gr.aim === 'first', 'beacon, firewall pylon and graviton well have no targeting setting');
    ok(!s.setAim(p.id, 'nope' as TargetMode) && !s.setAim(p.id, undefined as unknown as TargetMode) && !s.setAim(-1, 'first') && !s.setAim(NaN, 'first') && !s.setAim(p.id, '__proto__' as TargetMode), 'unknown towers and modes are refused');
    ok(!s.events.length, 'and refused calls emit nothing');
    s.setAim(p.id, 'weak'); s.events.length = 0;
    ok(s.setAim(p.id, 'weak') && !s.events.length, 'setting the mode a tower already has is accepted quietly');
    ok(s.setAim(p.id, 'fast') && s.events.length === 1 && s.events[0].k === 'aim' && s.events[0].id === p.id && s.events[0].m === 'fast' && s.events[0].t === 'pulse', "a change emits an 'aim' event");
    ok(s.upgrade(p.id) && s.upgrade(p.id) && p.lvl === 3 && p.aim === 'fast', 'the mode is kept over upgrades');
    {
      // a sold tower's id is refused; the build phase's time stop takes changes; exact ties stay with the lowest surviving id after deaths
      const s4 = mk(), sold = s4.build('pulse', 3, 5)!;
      ok(s4.planning && s4.setAim(sold.id, 'last') && sold.aim === 'last', 'the mode can be set during the build phase');
      ok(s4.sell(sold.id) && !s4.setAim(sold.id, 'first'), 'a sold tower takes no mode');
      const gs = [0, 1, 2, 3].map(() => { const e = put(s4, 'grunt', 10, 0, 2); e.hp = e.maxHp = 300; e.shield = 0; return e; });
      s4.damage(gs[0], 1e9, -1); run(s4, 1 / 60); // (the step drops the dead one from the list)
      const tw = s4.build('pulse', 3, 5)!;
      ok(s4.enemies.length === 3 && s4.enemies[0] === gs[1], 'the dead grunt is gone and the order is kept');
      for (const mode of TARGET_MODES) { tw.aim = mode; ok(priv(s4).pickTarget(tw, 999, 0) === gs[1], `'${mode}': an exact tie goes to the lowest surviving id`); }
      // shields count as health for 'weak' and 'strong'
      gs[1].shield = 150; gs[2].hp = 400;
      tw.aim = 'weak'; ok(priv(s4).pickTarget(tw, 999, 0) === gs[3], "'weak' counts the shield");
      tw.aim = 'strong'; ok(priv(s4).pickTarget(tw, 999, 0) === gs[1], "'strong' counts the shield");
    }
    // a lance switched to a new mode lets go of its lock at once (and loses its heat like on any retarget)
    const s3 = mk(), A = lineup(s3), ln = s3.build('lance', 3, 5)!;
    priv(s3).mods.tRange = 50; run(s3, 1.5);
    ok(ln.tgt === A.boss.id && ln.heat > 0.2, `the lance holds the boss (heat ${ln.heat.toFixed(2)})`);
    ok(s3.setAim(ln.id, 'first') && ln.tgt === 0 && ln.heat === 0, 'switching its mode drops the lock and the heat');
    run(s3, 1 / 60);
    ok(ln.tgt === A.lead.id, 'and it takes the new target on the very next step');
    // co-op: the guest sees the host's modes; hostile values leave a tower's mode alone; a finished game takes no changes
    const c = mk(); c.replica = true;
    c.applySnapshot(JSON.parse(JSON.stringify(s.snapshot([]))));
    ok(s.towers.every((t) => c.towerById(t.id)?.aim === t.aim), 'the guest replica carries every tower mode');
    const AIM_COL = 15;
    for (const v of [99, -1, 'x', null, 1e9, {}, [2]]) {
      const o = JSON.parse(JSON.stringify(s.snapshot([]))); o.t = o.t.map((row: unknown[]) => { const q = row.slice(); q[AIM_COL] = v; return q; });
      c.applySnapshot(o);
      ok(s.towers.every((t) => c.towerById(t.id)?.aim === t.aim), 'hostile modes from the host are ignored: ' + JSON.stringify(v));
    }
    const o = JSON.parse(JSON.stringify(s.snapshot([]))); o.t = o.t.map((row: unknown[]) => { const q = row.slice(); q[AIM_COL] = 1; return q; });
    c.applySnapshot(o);
    ok(c.towerById(bc.id)?.aim === 'first' && c.towerById(p.id)?.aim === 'last', 'a mode sent for a tower without the setting is ignored');
    const old = JSON.parse(JSON.stringify(s.snapshot([]))); old.t = old.t.map((row: unknown[]) => row.slice(0, 15));
    c.applySnapshot(old);
    ok(c.towerById(p.id)?.aim === 'last', 'a host that sends no modes leaves the guest towers as they are');
    s.over = true;
    ok(!s.setAim(p.id, 'first') && p.aim === 'fast', 'a finished game takes no mode changes');
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
      && TITAN_LAND === 2.5 && TITAN_STUN === 7 && TITAN_WINDUP === 4 && TITAN_STRIKE_EVERY === 5 && TITAN_STRIKE === 0.4 && TITAN_SLOW === 0.4 && TITAN_SURVIVAL === 22 && TITAN_AGAIN === 12 && TITAN_SMASH[0] === 20 && TITAN_SMASH[1] === 40 && TITAN_LEAD === 5
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
    const share = () => { const q = new Sim({ seed: 12, map: bare }); q.level = 5; q.grant('belts'); // (a level without a blueprint, no card forced into the offer)
       let n = 0, all = 0; for (let i = 0; i < 4000; i++) for (const id of q.rollCards(0)) { const c = CARD_BY_ID[id]; if (c.kind === 'blueprint') continue; all++; if (c.rar > 0) n++; } return n / all; };
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
  /** Time runs as it does during a wave (the factory and the towers stand still between waves: see the planning checks). */
  const live = (s: Sim, on = true) => Object.defineProperty(s, 'planning', { get: () => !on && Object.getOwnPropertyDescriptor(Sim.prototype, 'planning')!.get!.call(s), configurable: true });
  const fac = (o: Partial<ConstructorParameters<typeof Sim>[0]> = {}, raw = false) => {
    const s = new Sim({ seed: 31, map: bare, pauseOnCards: false, ...o }); s.gold = 1e5; s.nextWaveIn = 1e9; live(s);
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
  /** The direction from tile a to its neighbour b (-1 when they are not neighbours). */
  const dirTo = (a: [number, number], b: [number, number]) => [0, 1, 2, 3, 4, 5].find((d) => { const q = neighbor(a[0], a[1], d); return q[0] === b[0] && q[1] === b[1]; }) ?? -1;
  /** A Transfer Arm on tile p facing d: it takes from the tile behind it (d + 3) and delivers to the tile in front (d). */
  const arm = (s: Sim, p: [number, number], d: number) => s.buildFac('arm', p[0], p[1], ((d % 6) + 6) % 6)!;
  /** A direction k from tile c along which the next n tiles are free deck (-1 if none). */
  const freeRay = (s: Sim, c: [number, number], n: number, not: number[] = []) => [0, 1, 2, 3, 4, 5].find((k) => !not.includes(k) && Array.from({ length: n }, (_, i) => go(c, k, i + 1)).every((p) => inBoard(p[0], p[1]) && s.grid[at(p[0], p[1])] === 0)) ?? -1;
  /** Generators with endless fuel (off until `on`) so that every tile in `pts` is within SUPPLY of one. */
  const grid = (s: Sim, pts: [number, number][], on = true) => {
    const gs: Fac[] = [];
    for (const p of pts) {
      if (gs.some((g) => hexDist(g.cx, g.cz, p[0], p[1]) <= SUPPLY)) continue;
      const q = disc(p[0], p[1], SUPPLY).find(([x, z]) => inBoard(x, z) && s.grid[at(x, z)] === 0 && !s.factory.oreAt(x, z));
      if (!q) throw new Error('no room for a generator near ' + p.join());
      const g = s.buildFac('generator', q[0], q[1])!; if (on) g.fuel = 1e9; gs.push(g);
    }
    return gs;
  };
  const why = (s: Sim, k: string) => (s.diag().get(k)?.why || []).join('; ');

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
    // the rules (deposits.ts): crates first, then iron within a short belt of every crate of iron ore on its own side of
    // the road; a run uses the map's own ore field when it has one; the validator passes on every pre-made map
    for (const m of MAPS) {
      const s = new Sim({ seed: 3, map: m }), rc = checkResources(m), ore = s.factory.ore;
      ok(rc.ok && a2s(rc.ore) === a2s(ore) && crates(s).map((f) => `${f.cx},${f.cz},${f.hold}`).join(';') === rc.crates.map((c) => `${c.cx},${c.cz},${c.it}`).join(';'),
        `${m.id}: the run starts with the crates and deposits the validator checked, and they pass (${rc.problems.join(' / ') || 'ok'})`);
      // the tutorial's complaint: the first turret's crate and its nearest iron on the same side of the road, within a short belt
      for (const c of crates(s).filter((f) => f.hold === 'iron_ore')) {
        const seen = new Map<number, number>(), q: number[] = [];
        // (from the tiles right beside the crate: a turret there is fed by it, and they are on its side of the road)
        for (let dd = 0; dd < 6; dd++) { const [x, z] = neighbor(c.cx, c.cz, dd); if (inBoard(x, z) && s.grid[at(x, z)] === 0) { seen.set(at(x, z), 0); q.push(at(x, z)); } }
        let near = 99;
        for (let k = 0; k < q.length; k++) {
          const i = q[k], d = seen.get(i)!;
          if (ore[i] === T('iron_ore')) near = Math.min(near, d);
          if (d >= BELT_REACH + 1) continue;
          for (let dd = 0; dd < 6; dd++) { const [x, z] = neighbor(i % GW, Math.floor(i / GW), dd); if (inBoard(x, z) && s.grid[at(x, z)] === 0 && !seen.has(at(x, z))) { seen.set(at(x, z), d + 1); q.push(at(x, z)); } }
        }
        ok(near <= BELT_REACH + 1, `${m.id}: the iron ore crate at ${c.cx},${c.cz} has iron ${near} steps from a tile beside it, no road between`);
      }
    }
    const own = { ...MAPS[0], ore: { iron_ore: [[0, 0], [1, 0]], copper_ore: [[2, 0]], coal: [[3, 0]], oil: [[4, 0]] } } as MapDef;
    const so = new Sim({ seed: 1, map: sanitizeMap(JSON.parse(JSON.stringify(own)))! }).factory.ore;
    ok(so.filter((v) => v).length === 5 && so[at(0, 0)] === T('iron_ore') && so[at(4, 0)] === T('oil'), 'a map with its own ore field starts with exactly those deposits');
    const back = decodeMap(encodeMap(own));
    ok(!!back && JSON.stringify(back.ore) === JSON.stringify(own.ore), 'the ore field survives a share code');
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
      for (const t of s.towers) { const n = TOWERS[t.type].needs; if (n.item || n.fluid) { stocked++; ok((!n.item || t.stock === TOWER_STOCK) && (!n.fluid || t.tank === TOWER_TANK), `${m.id}: its own ${t.type} starts fully stocked`); } }
    }
    ok(stocked > 0, `the maps' own towers start fully stocked (${stocked} checked)`);
    // a Pulse Turret built next to a crate fills up from it; that is not a delivery by the factory
    const s = fac({}, true), cr = crates(s).find((f) => f.hold === 'iron_ore')!, spot = freeNear(s, cr.cx, cr.cz, 1), n0 = cr.left;
    ok(s.unlocked.size === 1 && s.unlocked.has('pulse') && cr.state === 'idle', 'a run starts with the Pulse Turret only');
    const t = s.build('pulse', spot[0], spot[1])!, evs: Ev[] = [];
    ok(!!t && t.stock === 0 && hexDist(t.cx, t.cz, cr.cx, cr.cz) === 1, 'a turret goes up beside a crate, empty');
    step(s, CRATE_TIME * TOWER_STOCK + 1, evs);
    ok(t.stock === TOWER_STOCK && !t.dry && cr.left === n0 - TOWER_STOCK && cr.state === 'ok' && s.factory.delivered === 0 && !evs.some((q) => q.k === 'dry' && q.id === t.id), `the crate fills it up to ${TOWER_STOCK} items, and the empty turret waiting on a working crate never counts as dry (${t.stock}; ${cr.left} of ${n0} left in the crate, delivered ${s.factory.delivered})`);
    // (the turret keeps only TOWER_STOCK items waiting, so it takes one, and the next only once that one is used up)
    cr.left = 2; t.stock = 0;
    step(s, 3);
    ok(cr.left === 1 && t.stock === TOWER_STOCK, `a full turret takes no more than ${TOWER_STOCK} (${cr.left} left in the crate, turret ${t.stock})`);
    t.stock = 0; step(s, 3);
    ok(cr.left === 0 && cr.state === 'empty' && t.stock === 1 && s.factory.delivered === 0, `a crate hands out what it holds and is then empty (${cr.left} left, state ${cr.state}, turret ${t.stock})`);
    t.stock = 0; step(s, 3);
    ok(cr.left === 0 && t.stock === 0, 'an empty crate gives nothing more');
    ok(s.facBlock('crate', spot[0] + 1, spot[1]) === 'unknown' && !s.buildFac('crate', spot[0] + 1, spot[1]) && !FAC_TYPES.includes('crate'), 'a crate cannot be built');
    // an empty crate can be cleared away (for nothing); one that still holds something stays
    const full = crates(s).find((f) => f.left > 0)!, gc = s.gold;
    ok(!!full && !s.sellFac(full.id) && s.factory.facById(full.id) === full && s.sellFac(cr.id) && s.gold === gc && !s.factory.facById(cr.id) && s.grid[at(cr.cx, cr.cz)] === 0, 'an empty crate can be cleared away for nothing, a crate with something in it cannot');
    // a crate feeds nothing but a tower right beside it: not a belt beside it, not a building beside it, not a turret further on
    const q = fac({}, true), c2 = crates(q).find((f) => f.hold === 'iron_ore')!;
    q.facs.add('belt'); q.facs.add('smelter');
    const d = [0, 1, 2, 3, 4, 5].find((k) => [1, 2, 3, 4].every((n) => { const p = go([c2.cx, c2.cz], k, n); return inBoard(p[0], p[1]) && q.grid[at(p[0], p[1])] === 0; }))!;
    const b1 = q.buildFac('belt', ...go([c2.cx, c2.cz], d), d)!, b2 = q.buildFac('belt', ...go([c2.cx, c2.cz], d, 2), d)!, t2 = q.build('pulse', ...go([c2.cx, c2.cz], d, 3))!;
    const sk = [0, 1, 2, 3, 4, 5].find((k) => k !== d && q.grid[at(...go([c2.cx, c2.cz], k))] === 0 && inBoard(...go([c2.cx, c2.cz], k)));
    const sm = sk === undefined ? null : q.buildFac('smelter', ...go([c2.cx, c2.cz], sk))!;
    step(q, 6);
    ok(!!b1 && !!b2 && !!t2 && !b1.items.length && !b2.items.length && t2.stock === 0 && (!sm || !sm.inv.iron_ore) && c2.left === CRATE_STOCK.iron_ore, 'a crate puts nothing on a belt beside it and hands nothing to a smelter beside it; a turret at the end of that belt gets nothing');
    // an arm takes from the crate onto the belt, and an arm at the belt's end hands the ore on into a turret
    q.sellFac(b1.id); q.sell(t2.id);
    const a1 = arm(q, go([c2.cx, c2.cz], d), d), a2 = arm(q, go([c2.cx, c2.cz], d, 3), d), t3 = q.build('pulse', ...go([c2.cx, c2.cz], d, 4))!;
    const ev2: Ev[] = []; step(q, 8, ev2);
    ok(!!a1 && !!a2 && !!t3 && t3.stock === TOWER_STOCK && c2.left < CRATE_STOCK.iron_ore! && q.factory.delivered === 0 && ev2.some((e) => e.k === 'take' && e.id === a1.id && e.x === c2.x && e.tx === a1.x) && ev2.some((e) => e.k === 'put' && e.who === 't' + t3.id && e.x === a2.x && e.tx === t3.x),
      `crate > arm > belt > arm > turret feeds it (${t3.stock}; still crate ore, so not counted as delivered: ${q.factory.delivered})`);
    // a turret beside a crate: the panel names the crate as its supply
    {
      const r = fac({}, true), c3 = crates(r).find((f) => f.hold === 'iron_ore')!, free = (p: [number, number]) => inBoard(p[0], p[1]) && r.grid[at(p[0], p[1])] === 0;
      const k = [0, 1, 2, 3, 4, 5].find((k) => free(go([c3.cx, c3.cz], k)));
      if (k === undefined) ok(false, 'room beside a crate for a turret');
      else {
        const tw = r.build('pulse', ...go([c3.cx, c3.cz], k))!, dg = r.diag().get('t' + tw.id);
        ok(!!tw && dg?.ok === true && dg.from.join() === 'Supply Crate' && r.factory.links().some((l) => l.kind === 'crate' && l.from === c3.id && l.to === 't' + tw.id), `a turret right beside a crate is supplied by it (${dg?.from.join(', ')}), and a 'crate' link says so`);
      }
    }
  }
  {
    // supply: a new Pulse Turret is empty and dry; with ore in stock it fires 9 shots an item and runs dry again; a mine right beside it feeds it nothing, an arm does
    const s = fac(), t = s.build('pulse', 3, 5)!, e = foe(s, 10), evs: Ev[] = [], per = (ITEM_SHOTS.iron_ore || 0) * s.mods.ammo;
    ok(!!t && t.stock === 0 && t.ammo === 0 && t.tank === 0 && t.pwr === 0 && !t.dry && Math.hypot(e.x - t.x, e.z - t.z) < s.range(t), 'a new turret is empty: no ammunition, nothing in the tank');
    step(s, 3, evs);
    ok(t.dry && towerOff(t) && !s.supplied(t) && shotsOf(evs, t.id) === 0 && evs.some((q) => q.k === 'dry' && q.id === t.id), 'so it is dry from the first step and fires nothing at the enemy in range');
    t.stock = 2; evs.length = 0;
    step(s, (2 * per) / s.towerRate(t) + 3, evs);
    const fired = shotsOf(evs, t.id);
    ok(per === 9 && fired === 2 * per && t.dry && t.stock === 0 && evs.some((q) => q.k === 'fed' && q.id === t.id) && evs.some((q) => q.k === 'dry' && q.id === t.id), `with 2 iron ore it fires 2 x ${per} shots and runs dry again (${fired} shots, fed and dry events)`);
    const charge = t.charge; evs.length = 0;
    step(s, 3, evs);
    ok(shotsOf(evs, t.id) === 0 && t.charge === charge, 'a dry tower neither fires nor charges');
    t.charge = 1;
    ok(!s.specialReady(t) && !s.triggerSpecial(t.id, 0) && t.charge === 1, 'and its special cannot be fired');
    t.charge = charge;
    const k = freeRay(s, [t.cx, t.cz], 2), F = go([t.cx, t.cz], k, 2), A = go([t.cx, t.cz], k), F2 = freeNear(s, t.cx, t.cz, 1, [A]);
    ok(k >= 0 && s.facBlock('mine', F[0], F[1]) === 'needs an iron, copper or coal deposit' && !s.buildFac('mine', F[0], F[1]), 'a mine needs a deposit');
    lay(s, F, 'iron_ore'); lay(s, F2, 'iron_ore');
    ok(s.facBlock('pump', F[0], F[1]) === 'needs an oil field' && s.facBlock('mine', F[0], F[1]) === '', 'a pumpjack needs an oil field, a mine goes on ore');
    // the old implicit feeding is gone: a mine right next to the turret hands it nothing by itself
    const near = s.buildFac('mine', F2[0], F2[1])!;
    evs.length = 0; step(s, MINE_TIME * OUT_CAP + 1, evs);
    ok(!!near && t.dry && shotsOf(evs, t.id) === 0 && s.factory.delivered === 0 && near.out.length === OUT_CAP && near.state === 'full' && s.diag().get('t' + t.id)?.missing.join() === 'iron ore' && why(s, 't' + t.id) === 'no Transfer Arm brings it iron ore' && why(s, 'f' + near.id) === 'no Transfer Arm takes its output',
      `a mine right next to the turret feeds it nothing without an arm (${why(s, 't' + t.id)} / ${why(s, 'f' + near.id)})`);
    const mine = s.buildFac('mine', F[0], F[1])!;
    ok(!!mine && mine.ore === 'iron_ore' && s.grid[at(F[0], F[1])] === 2 && s.factory.facAt(F[0], F[1]) === mine && !mine.under, 'the mine stands on its deposit');
    const a = arm(s, A, k + 3);
    ok(!!a && a.dir === (k + 3) % 6 && s.diag().get('t' + t.id)?.ok === true && s.diag().get('t' + t.id)!.from.join() === 'Mine (by arm)' && s.diag().get('f' + a.id)?.ok === true, 'mine > arm > turret in a line: the diagnosis sees the arm bring it ore');
    evs.length = 0; step(s, 8, evs);
    ok(!t.dry && evs.some((q) => q.k === 'fed' && q.id === t.id) && shotsOf(evs, t.id) > 3 && s.factory.delivered >= 2 && mine.state === 'ok' && evs.some((q) => q.k === 'take' && q.id === a.id && q.x === mine.x && q.tx === a.x) && evs.some((q) => q.k === 'put' && q.who === 't' + t.id && q.id === t.id && q.x === a.x && q.tx === t.x && q.it === 'iron_ore'),
      `the arm hands the turret ore and it fires again (${shotsOf(evs, t.id)} shots, ${s.factory.delivered} delivered, take and put events)`);
    // with nothing to shoot at the turret fills up, then the mine does
    s.enemies.length = 0; t.stock = 0; t.ammo = 0; mine.out.length = 0; mine.prog = 0; a.hand = null; a.prog = 0;
    const d0 = s.factory.delivered;
    step(s, MINE_TIME * TOWER_STOCK + 1);
    ok(t.stock === TOWER_STOCK && s.factory.delivered === d0 + TOWER_STOCK, `the mine digs one ore every ${MINE_TIME} s and the arm fills the turret up to ${TOWER_STOCK} (${t.stock})`);
    step(s, MINE_TIME * (OUT_CAP + 1));
    ok(mine.out.length === OUT_CAP && mine.out.every((it) => it === 'iron_ore') && mine.state === 'full' && t.stock === TOWER_STOCK && !a.hand && a.state === 'full' && s.factory.armNote(a) === "arm's target is full", `with nowhere to put more, the arm waits empty-handed and the mine fills up and stops (arm: ${s.factory.armNote(a)})`);
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
    // a belt line: an arm puts the mine's ore on it; a turret it runs past gets nothing; arms off the line (at its side and at its end) feed turrets
    const s = fac(), c = open(s, 3), M = go(c, 3, 2), A0 = go(c, 3), B = [c, go(c, 0)], P1 = go(c, 1), AE = go(c, 0, 2), TE = go(c, 0, 3);
    lay(s, M, 'iron_ore');
    const mine = s.buildFac('mine', M[0], M[1])!, a0 = arm(s, A0, 0), belts = B.map((p) => s.buildFac('belt', p[0], p[1], 0)!);
    step(s, MINE_TIME * 6);
    const onB = () => belts.reduce((n, b) => n + b.items.length, 0);
    ok(!!mine && !!a0 && belts.every((b) => !!b && b.dir === 0) && onB() >= 3 && belts.every((b) => b.items.every((q) => q.it === 'iron_ore')), `an arm puts the ore on a belt whatever lies at its end (${onB()} on the belts)`);
    ok(s.diag().get('f' + belts[1].id)?.missing.join() === 'an arm at its end' && why(s, 'f' + belts[1].id) === 'belt ends without an arm' && !s.diag().has('f' + belts[0].id), 'the last belt of a line that carries ore and ends without an arm says so; the one before has no entry');
    const past = s.build('pulse', P1[0], P1[1])!;
    step(s, 10);
    ok(!!past && past.stock === 0 && s.diag().get('t' + past.id)?.missing.join() === 'iron ore', 'a turret the belt runs past takes nothing from it (belts never feed what they pass)');
    // arms off the line: one at its end, one at the side of the first belt
    s.sell(past.id);
    const ae = arm(s, AE, 0), end = s.build('pulse', TE[0], TE[1])!, as = arm(s, P1, 1), side = s.build('pulse', ...go(P1, 1))!;
    ok(!!ae && !!end && !!as && !!side && !s.diag().has('f' + belts[1].id) && s.diag().get('t' + end.id)!.from.join() === 'Mine (by belt)' && s.diag().get('t' + side.id)!.from.join() === 'Mine (by belt)', 'with arms at its side and at its end both turrets are diagnosed as fed by the mine by belt');
    let moved = 0;
    for (let i = 0; i < 60 * 30; i++) { step(s, 1 / 60); if (belts.some((b) => b.items.some((q) => q.p > 0.3 && q.p < 0.9))) moved++; }
    ok(moved > 0 && end.stock === TOWER_STOCK && side.stock === TOWER_STOCK && !end.dry && !side.dry && s.factory.delivered === 2 * TOWER_STOCK, `both turrets fill up off the belt (${end.stock}, ${side.stock}; ${s.factory.delivered} delivered)`);
    step(s, 40);
    const held = (f: Fac) => (f.hand ? 1 : 0);
    ok(mine.state === 'full' && onB() >= 3 && belts.every((b) => b.items.every((q) => q.it === 'iron_ore' && q.p >= 0 && q.p <= 1)) && s.factory.delivered === 2 * TOWER_STOCK && held(ae) + held(as) === 0,
      `with every turret full the ore waits on the belt and nothing is lost (${belts.map((b) => b.items.length).join('+')} on the belts)`);
    // turning the first arm round: it now takes from the belt and points at the mine, which takes nothing
    s.rotateFac(a0.id, 3);
    ok(a0.dir === 3 && s.diag().get('f' + a0.id)?.missing.join() === 'a target' && why(s, 'f' + a0.id) === "arm's target takes nothing", `an arm can be turned; pointing at the mine it has no target (${why(s, 'f' + a0.id)})`);
    for (const b of belts) b.items.length = 0;
    for (const t of [end, side]) t.stock = 0;
    step(s, 6);
    ok(belts.every((b) => !b.items.length) && end.stock + side.stock === 0 && mine.state === 'full' && a0.state === 'idle', 'turned away, the line stays empty and the turrets get nothing');
    s.rotateFac(a0.id, 0);
    step(s, 14);
    ok(end.stock > 0 && side.stock > 0, 'turned back, the line runs again');
  }
  {
    // a mixed belt as a loop: arms put coal and ore on a ring of belts; an arm off the ring into a generator picks only the
    // coal as it passes, an arm into a turret only the ore. (A ring keeps moving: nothing piles up at an end.)
    const s = fac(), c = open(s, 3), R = [0, 1, 2, 3, 4, 5].map((d) => go(c, d));
    R.forEach((p, i) => s.buildFac('belt', p[0], p[1], dirTo(p, R[(i + 1) % 6])));
    lay(s, go(c, 3, 3), 'coal'); lay(s, go(c, 0, 3), 'iron_ore');
    s.buildFac('mine', ...go(c, 3, 3)); s.buildFac('mine', ...go(c, 0, 3));
    arm(s, go(c, 3, 2), 0); arm(s, go(c, 0, 2), 3);
    const ag = arm(s, go(c, 1, 2), 1), g = s.buildFac('generator', ...go(c, 1, 3))!, at2 = arm(s, go(c, 4, 2), 4), tw = s.build('pulse', ...go(c, 4, 3))!;
    ok(!!g && !!tw && s.diag().get('f' + g.id)?.ok === true && s.diag().get('t' + tw.id)?.ok === true && s.diag().get('f' + ag.id)!.from.join() === 'Mine (by belt)', 'coal and ore on one ring: the diagnosis sees the generator get coal and the turret ore');
    let gotC = 0, gotO = 0, wrong = 0;
    for (let i = 1; i <= 60 * 60; i++) {
      step(s, 1 / 60);
      if ((ag.hand && ag.hand !== 'coal') || (at2.hand && at2.hand !== 'iron_ore')) wrong++;
      if (i % (3 * 60) === 0 && tw.stock > 0) { tw.stock = 0; gotO++; }
      if (i % (6 * 60) === 0 && (g.inv.coal || 0) > 0) { g.inv.coal!--; gotC++; }
    }
    ok(gotO >= 12 && gotC >= 7 && !wrong, `each arm picks only what its target takes off the mixed ring (turret ${gotO}/20 ore, generator ${gotC}/10 coal in 60 s)`);
    // the same mix on a line with a dead end: what the arm at the end does not take piles up at the end and blocks the rest
    // (the player's call: a ring, a splitter, or one belt per kind); the diagnosis sees the jam: the last belt says no arm at its
    // end takes coal, and the turret is not supplied because its line jams (review: it used to say "supplied")
    {
      const q = fac(), qc = open(q, 3), P = (n: number) => go(go(qc, 3), 0, n);
      for (const n of [0, 1, 2]) q.buildFac('belt', ...P(n), 0);
      q.factory.placeCrate(...go(P(0), 4, 2), 'coal', 999); q.factory.placeCrate(...go(P(0), 2, 2), 'iron_ore', 999);
      arm(q, go(P(0), 4), 1); arm(q, go(P(0), 2), 5);
      const ea = arm(q, P(3), 0), et = q.build('pulse', ...P(4))!;
      let ore = 0;
      for (let i = 1; i <= 60 * 40; i++) { step(q, 1 / 60); if (i % (3 * 60) === 0 && et.stock > 0) { et.stock = 0; ore++; } }
      const last = q.factory.facAt(...P(2))!;
      ok(ore < 8 && last.items.every((x) => x.it === 'coal') && ea.state === 'noinput' && q.factory.armNote(ea) === 'arm has nothing to take',
        `a mixed line that dead-ends at a turret's arm jams with coal (${ore} ore in 40 s; the arm: ${q.factory.armNote(ea)}; last belt ${last.items.map((x) => x.it).join()})`);
      const dt = q.diag().get('t' + et.id), dl = q.diag().get('f' + last.id);
      ok(dt?.ok === false && /jams/.test(dt.why.join()) && dl?.ok === false && dl.missing.join() === 'an arm that takes coal' && /takes coal: the line jams/.test(dl.why.join()) && !q.diag().has('f' + q.factory.facAt(...P(1))!.id),
        `the diagnosis sees the jam: turret "${dt?.why}", last belt "${dl?.why}"`);
      // a second arm at the end that takes the coal (into a generator) keeps the line moving: no jam
      const side = go(P(2), 1), ga = arm(q, side, 1); q.buildFac('generator', ...go(side, 1));
      ok(!!ga && q.diag().get('t' + et.id)?.ok === true && !q.diag().has('f' + last.id), `with an arm at the end that takes the coal the line is fine again (${why(q, 't' + et.id)})`);
    }
    // a filter: an arm onto a belt picks anything, with a filter only that item
    const q = fac(), qc = open(q, 2), cr = q.factory.placeCrate(...go(qc, 3), 'coal', 50)!, qa = arm(q, qc, 0), qb = q.buildFac('belt', ...go(qc, 0), 0)!;
    ok(q.setArmFilter(qa.id, 'iron_ore') && qa.only === 'iron_ore' && q.diag().get('f' + qa.id)?.missing.join() === 'something to take', `with an iron ore filter the arm takes no coal from the crate (${why(q, 'f' + qa.id)})`);
    step(q, 3);
    ok(!qb.items.length && cr.left === 50, 'and nothing moves');
    ok(q.setArmFilter(qa.id, null) && qa.only === null && !q.setArmFilter(qb.id, 'coal') && !q.setArmFilter(qa.id, 'nuke' as ItemType) && !q.setArmFilter(9999, 'coal'), 'the filter clears; a belt, an unknown item and an unknown id are refused');
    step(q, 3);
    ok(qb.items.length > 0 && cr.left < 50, 'without the filter the coal goes on the belt');
  }
  {
    // a smelter needs coal as fuel (one for COAL_SMELTS plates) and melts iron ore and copper ore into plates; arms bring and take it all
    const s = fac(), c = open(s, 2), Mi = go(c, 3, 2), Mc = go(c, 1, 2), Mu = go(c, 5, 2);
    lay(s, Mi, 'iron_ore'); lay(s, Mc, 'coal'); lay(s, Mu, 'copper_ore');
    const sm = s.buildFac('smelter', c[0], c[1])!, mine = s.buildFac('mine', Mi[0], Mi[1])!, ai = arm(s, go(c, 3), 0);
    const nextTo = s.buildFac('mine', Mc[0], Mc[1])!; // (a coal mine two tiles off: nothing between yet)
    step(s, 5);
    ok(!!mine && !!sm && !!ai && (sm.inv.iron_ore || 0) > 0 && sm.state === 'nofuel' && !sm.out.length && !sm.inv.coal && !!nextTo, 'an arm hands the mine\'s ore to the smelter, which has no coal yet (no arm from the coal mine)');
    const ac = arm(s, go(c, 1), 4);
    step(s, MINE_TIME + 3 * SMELT_TIME + 2);
    ok(!!ac && sm.out.length === OUT_CAP && sm.out.every((it) => it === 'iron'), `with an arm from a coal mine the smelter melts iron plates (${sm.out.length}: ${sm.out.join(',')})`);
    step(s, 20);
    ok(sm.out.length === OUT_CAP && sm.state === 'full', 'with no arm taking the plates it fills up and stops');
    // copper ore becomes copper plates the same way (the iron mine makes way for a copper mine)
    s.sellFac(mine.id); sm.out.length = 0;
    const cu = s.buildFac('mine', Mu[0], Mu[1])!, au = arm(s, go(c, 5), 2), made: Record<string, number> = {};
    for (let i = 0; i < 60; i++) { step(s, 1); for (const it of sm.out.splice(0)) made[it] = (made[it] || 0) + 1; }
    ok(!!cu && !!au && cu.ore === 'copper_ore' && made.iron > 0 && made.iron <= 7 && made.copper > 10 && Object.keys(made).length === 2, `fed copper ore it melts the iron ore it still holds, then copper plates (${JSON.stringify(made)})`);
    // the fuel: one coal is good for COAL_SMELTS plates
    const q = fac(), qc = open(q, 2), one = q.buildFac('smelter', qc[0], qc[1])!;
    one.inv.iron_ore = 6; one.inv.coal = 1;
    let plates = 0;
    for (let i = 0; i < 30; i++) { step(q, 1); plates += one.out.splice(0).length; }
    ok(COAL_SMELTS === 4 && SMELT_TIME === 4 && plates === COAL_SMELTS && one.inv.iron_ore === 6 - COAL_SMELTS && one.state === 'nofuel' && !FACS.smelter.power, `one coal melts ${COAL_SMELTS} plates, then the smelter is out of fuel (${plates} plates, state ${one.state})`);
    // copper plates are the Railgun's ammunition: a smelter right beside it hands it nothing, an arm between them does
    q.mats = 20;
    const nr = q.build('rail', ...go(qc, 1))!;
    one.out.length = 0; one.inv.iron_ore = 0; one.inv.copper_ore = 4; one.inv.coal = 1;
    step(q, 6);
    ok(!!nr && nr.stock === 0 && one.out.length > 0, 'a Railgun right beside the smelter gets no copper plates by itself');
    const ar = arm(q, go(qc, 0), 0), rail = q.build('rail', ...go(qc, 0, 2))!;
    step(q, 12);
    ok(!!ar && !!rail && rail.stock === TOWER_STOCK && q.factory.delivered === TOWER_STOCK && TOWERS.rail.needs.item === 'copper' && rail.dry, `an arm from the smelter fills the other Railgun with copper plates (${rail.stock}); without power it is still dry`);
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
    step(s, 3 * mk.time + 3, evs);
    const n = evs.filter((q) => q.k === 'mats').length;
    ok(mk.mats === 1 && mk.inp.iron === 2 && !mk.out && n === 3 && s.mats === m0 + n * mk.mats && !works.out.length && !works.inv.iron && works.state === 'noinput' && evs.filter((q) => q.k === 'mats').every((q) => q.n === mk.mats && q.x === works.x && q.z === works.z),
      `with power 6 iron plates become ${n} building materials (${m0} to ${s.mats}), straight into the stock: no Frame item, no Depot`);
    // the whole chain: iron mine and coal mine by arms into a smelter, its plates by arm into the works
    const q = fac(), S = open(q, 3), Mi = go(S, 3, 2), Mc = go(S, 1, 2), W = go(S, 0, 2);
    lay(q, Mi, 'iron_ore'); lay(q, Mc, 'coal');
    q.buildFac('mine', Mi[0], Mi[1]); q.buildFac('mine', Mc[0], Mc[1]); q.buildFac('smelter', S[0], S[1]);
    arm(q, go(S, 3), 0); arm(q, go(S, 1), 4); arm(q, go(S, 0), 0);
    const w2 = q.buildFac('works', W[0], W[1])!, [g2] = grid(q, [W]), q0 = q.mats;
    step(q, 90);
    ok(!!w2 && !!g2 && q.mats >= q0 + 5 && w2.pwr === 1, `mines, smelter and Frame Works joined by arms raise the materials by themselves (${q0} to ${q.mats} in 90 s)`);
  }
  {
    // Shell Press: an iron plate and a coal make a shell; an arm puts it on a belt, an arm at the belt's end into the Plasma Mortar
    const s = fac(), c = open(s, 3), P = go(c, 3), Mo = go(c, 0, 3);
    const press = s.buildFac('press', P[0], P[1])!, a1 = arm(s, c, 0), belt = s.buildFac('belt', ...go(c, 0), 0)!, a2 = arm(s, go(c, 0, 2), 0), mortar = s.build('mortar', Mo[0], Mo[1])!;
    const gens = grid(s, [P, Mo], false);
    ok(!!press && !!a1 && !!belt && !!a2 && !!mortar && mortar.stock === 0 && s.mats === START_MATS - TOWERS.mortar.mat, 'press, arm, belt, arm and an empty mortar are down');
    press.inv.iron = 4; press.inv.coal = 4;
    step(s, 4);
    ok(press.state === 'nopower' && !press.out.length && !belt.items.length && mortar.stock === 0 && mortar.dry, 'without power the press makes nothing and the mortar stays dry');
    for (const g of gens) g.fuel = 1e9;
    let onBelt = 0;
    for (let i = 0; i < 60 * 30; i++) { step(s, 1 / 60); if (belt.items.some((q) => q.it === 'shell')) onBelt++; }
    ok(press.pwr === 1 && onBelt > 0 && mortar.stock === TOWER_STOCK && !mortar.dry && mortar.pwr === 1 && s.factory.delivered === TOWER_STOCK && !press.inv.iron && !press.inv.coal && TOWERS.mortar.needs.item === 'shell',
      `with power 4 plates and 4 coal become 4 shells, and arms and the belt take them to the mortar (${mortar.stock})`);
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
    ok(pylon.tank > TOWER_TANK / 2 && pylon.tank <= TOWER_TANK && TOWER_TANK < TANK && !pylon.dry, `the crude reaches the pylon's small tank (${pylon.tank.toFixed(1)} of ${TOWER_TANK})`);
    step(s, 40);
    ok(pump.state === 'full' && pump.tout === TANK && pylon.tank === TOWER_TANK, 'with everything full the pumpjack stops');
    // a dry pylon burns nothing
    const e = foe(s, s.map.nearest(0, pylon.x, pylon.z));
    if (Math.hypot(e.x - pylon.x, e.z - pylon.z) <= FIRE_RING + e.r) { s.sellFac(p2.id); pylon.tank = 0; const hp = e.hp; step(s, 2); ok(pylon.dry && e.hp === hp, 'a pylon with an empty tank burns nothing'); }
    // a pumpjack right next to a pylon needs no pipe
    const q = fac(), qc = open(q, 2), qg = go(qc, 3), qf = go(qc, 0);
    lay(q, qc, 'oil');
    const qp = q.buildFac('pump', qc[0], qc[1])!, qgen = q.buildFac('generator', qg[0], qg[1])!, qt = q.build('flame', qf[0], qf[1])!;
    qgen.inv.coal = 2; step(q, 10);
    ok(!!qp && qt.tank === TOWER_TANK && !qt.dry, 'a pumpjack right next to a pylon fills it without a pipe');
  }
  {
    // the long chain: pumpjack, refinery (crude to petrol), a pipe to the Missile Works, missiles by arm into the battery
    const s = fac(), c = open(s, 3), Pm = go(c, 3, 2), R = go(c, 3), W = go(c, 0), G = go(c, 4), Po = go(go(c, 0, 2), 1);
    lay(s, Pm, 'oil'); s.mats = 20;
    const pump = s.buildFac('pump', Pm[0], Pm[1])!, ref = s.buildFac('refinery', R[0], R[1])!, pipe = s.buildFac('pipe', c[0], c[1])!, mw = s.buildFac('missiles', W[0], W[1])!;
    const gen = s.buildFac('generator', G[0], G[1])!, am = arm(s, go(c, 0, 2), 0), bat = s.build('missile', ...go(c, 0, 3))!, pole = s.buildFac('pole', Po[0], Po[1])!;
    ok(!!pump && !!ref && !!pipe && !!mw && !!gen && !!pole && !!am && !!bat && bat.stock === 0, 'pumpjack, refinery, pipe, Missile Works, generator, pole, arm and battery are down');
    mw.inv.iron = 4; mw.inv.copper = 4;
    step(s, 5);
    ok(pump.state === 'nopower' && ref.tin === 0 && ref.tout === 0 && mw.tin === 0 && !mw.out.length && bat.stock === 0 && bat.dry && pole.state === 'nopower', 'without power nothing is pumped, cracked or built');
    gen.inv.coal = 4;
    step(s, 3);
    ok(s.factory.wires.length === 1 && pole.state === 'ok' && pole.net === gen.net && bat.pwr > 0 && pump.pwr > 0 && ref.pwr > 0, 'the pole carries the generator\'s power on to the battery');
    gen.fuel = 1e3; // (four coal last 48 s at full load: this keeps the lights on)
    step(s, 80);
    const fl = s.factory.pipeFluid(pipe);
    ok(fl.fluid === 'petrol' && s.factory.fluidIn(mw) === 'petrol' && s.factory.fluidIn(ref) === 'crude', `the refinery takes crude straight from the pumpjack beside it and fills the pipe with petrol (${fl.fluid}, ${(100 * fl.fill).toFixed(0)}% full)`);
    ok(bat.stock === TOWER_STOCK && mw.out.length + (am.hand ? 1 : 0) === OUT_CAP && !bat.dry && s.factory.delivered === TOWER_STOCK && !mw.inv.iron && !mw.inv.copper && TOWERS.missile.needs.item === 'missile', `the Missile Works turns 4 iron, 4 copper and petrol into 4 missile packs: one waits in the battery, three in the works and the arm (${bat.stock} + ${mw.out.length} + ${am.hand ? 1 : 0})`);
    // Cell Plant: a copper plate and crude oil make a cell, an arm takes it to the Lance Emitter
    const q = fac(), qc = open(q, 2), qp = go(qc, 3), qt = go(qc, 0, 2), qg = go(qc, 1);
    lay(q, qp, 'oil'); q.mats = 20;
    const pj = q.buildFac('pump', qp[0], qp[1])!, cells = q.buildFac('cells', qc[0], qc[1])!, g2 = q.buildFac('generator', qg[0], qg[1])!, la = arm(q, go(qc, 0), 0), lance = q.build('lance', qt[0], qt[1])!;
    cells.inv.copper = 4;
    step(q, 4);
    ok(!!pj && !!cells && !!g2 && !!la && !!lance && cells.tin === 0 && !cells.out.length && lance.stock === 0 && lance.dry && cells.state === 'noinput', 'a Cell Plant without crude oil makes nothing');
    g2.inv.coal = 4;
    step(q, 4 * MAKES.cells!.time + 8);
    ok(lance.stock === TOWER_STOCK && cells.out.length + (la.hand ? 1 : 0) === OUT_CAP && !lance.dry && q.factory.delivered === TOWER_STOCK && !cells.inv.copper && q.factory.fluidIn(cells) === 'crude' && TOWERS.lance.needs.item === 'cell' && TOWERS.gravity.needs.item === 'cell', `with power and a pumpjack beside it, 4 copper plates become 4 cells; an arm takes one to the lance (${lance.stock})`);
  }
  {
    // the end of a line: the arm there picks what its target takes from anywhere on the last tile (past PICK_AT), so ore behind
    // a coal its smelter has no room for still gets through; nothing is tipped off a belt any more
    const s = fac(), c = open(s, 2), A = go(c, 3), B2 = go(c, 3, 2);
    const sm = s.buildFac('smelter', c[0], c[1])!, a = arm(s, A, 0), b2 = s.buildFac('belt', B2[0], B2[1], 0)!;
    sm.inv.coal = 2;
    b2.items.push({ it: 'coal', p: 1 }, { it: 'iron_ore', p: 0.5 });
    step(s, 0.05);
    ok(sm.state === 'noinput' && a.hand === 'iron_ore' && b2.items.length === 1 && b2.items[0].it === 'coal', 'an arm at the end of a line takes the ore behind a coal its smelter has no room for');
    step(s, 3);
    ok(sm.inv.iron_ore === 1 || sm.busy, 'and puts it into the smelter');
    // an arm holds an item its target takes but has no room for right now: it waits at the drop (state full), nothing is lost
    const q = fac(), qc = open(q, 2), full = q.buildFac('smelter', qc[0], qc[1])!, qa = arm(q, go(qc, 3), 0), qb = q.buildFac('belt', ...go(qc, 3, 2), 0)!;
    full.inv.coal = 2; full.inv.iron_ore = 2; for (let i = 0; i < OUT_CAP; i++) full.out.push('iron');
    qb.items.push({ it: 'coal', p: 1 }, { it: 'coal', p: 0.5 });
    step(q, 6);
    ok(full.state === 'full' && qb.items.length === 2 && qb.items[0].p === 1 && !qa.hand && qa.state === 'full' && q.factory.armNote(qa) === "arm's target is full", 'at a smelter that is full the coal waits on the belt and the arm waits empty-handed');
    // a hand-off chain: arm > arm > arm hands an item straight through, each picking only what the next takes
    const r = fac(), rc = open(r, 3), cr = r.factory.placeCrate(...go(rc, 3, 2), 'iron_ore', 3)!;
    const chain = [go(rc, 3), rc, go(rc, 0)].map((p) => arm(r, p, 0)), rt = r.build('pulse', ...go(rc, 0, 2))!, ev: Ev[] = [];
    ok(r.diag().get('t' + rt.id)?.ok === true && r.diag().get('t' + rt.id)!.from.join() === 'Supply Crate (by arm)' && chain.every((x) => r.diag().get('f' + x.id)?.ok === true), 'crate > arm > arm > arm > turret: the diagnosis follows the chain');
    step(r, 4, ev);
    ok(rt.stock === 1 && cr.left === 2 && ev.filter((e) => e.k === 'put').length === 3 && ev.filter((e) => e.k === 'take').length === 1 && ev.some((e) => e.k === 'put' && e.who === 'f' + chain[1].id), `the item goes arm to arm into the turret (one take at the crate, three puts; ${cr.left} left)`);
    step(r, 4);
    ok(rt.stock === 1 && cr.left === 2 && chain.every((x) => !x.hand), 'with the turret full no arm in the chain picks anything');
    // (review) the arms of a chain swing at the same time: three arms in a row move as many items a second as one
    {
      const per = (k: number) => {
        const u = fac(), uc = open(u, 3), c0 = go(uc, 3, 2); u.factory.placeCrate(c0[0], c0[1], 'iron_ore', 1e5);
        for (let i = 1; i <= k; i++) arm(u, go(c0, 0, i), 0);
        const b = u.buildFac('belt', ...go(c0, 0, k + 1), 0)!;
        let n = 0; for (let i = 0; i < 60 * 30; i++) { u.step(1 / 60); u.events.length = 0; n += b.items.length; b.items.length = 0; }
        return n / 30;
      };
      const r1 = per(1), r3 = per(3);
      ok(r1 >= 1.1 && r3 >= r1 * 0.95, `a chain of 3 arms onto a belt moves ${r3.toFixed(2)} items/s, one arm ${r1.toFixed(2)}`);
    }
    // a chain only hands on where the next arm faces the same way: one turned aside takes nothing from it
    r.rotateFac(chain[1].id, 1);
    ok(r.diag().get('f' + chain[0].id)?.missing.join() === 'a target' && r.diag().get('t' + rt.id)?.ok === false, 'an arm turned aside in the chain breaks it (the first one has no target any more)');
    // (review) an arm whose target stops taking what it holds drops it: a 'lost' event says so
    {
      const ev2: Ev[] = [], l = fac(), lc = open(l, 2); l.factory.placeCrate(...go(lc, 3), 'iron_ore', 9);
      const la = arm(l, lc, 0), lt = l.build('pulse', ...go(lc, 0))!;
      let k = 0; while (!la.hand && k++ < 120) step(l, 1 / 60);
      l.sell(lt.id); step(l, 1, ev2);
      ok(!la.hand && ev2.some((e) => e.k === 'lost' && e.id === la.id && e.it === 'iron_ore'), "an arm whose turret is sold mid-swing drops its ore with a 'lost' event");
    }
  }
  {
    // (review) arms sharing one source take turns: a Mk1 mine with an arm to a turret on two sides feeds both evenly
    const s = fac(), c = open(s, 3); lay(s, c, 'iron_ore'); s.buildFac('mine', c[0], c[1]);
    const ts = [0, 3].map((d) => { arm(s, go(c, d), d); return s.build('pulse', ...go(c, d, 2))!; }), got = [0, 0];
    for (let i = 0; i < 60 * 120; i++) { step(s, 1 / 60); ts.forEach((t, k) => { if (t.stock) { got[k] += t.stock; t.stock = 0; } }); }
    ok(Math.min(...got) >= 15 && Math.abs(got[0] - got[1]) <= 2, `two arms on one Mk1 mine take turns (${got.join(' / ')} ore in 120 s)`);
  }
  {
    // (review) a splitter deals only to belts leading away from it: a line running past it gets nothing
    const s = fac(), c = open(s, 3); s.factory.placeCrate(...go(c, 3, 3), 'iron_ore', 50);
    arm(s, go(c, 3, 2), 0); s.buildFac('belt', ...go(c, 3), 0); s.buildFac('splitter', c[0], c[1]);
    const outB = s.buildFac('belt', ...go(c, 0), 0)!, past = [go(go(c, 4), 3), go(c, 4), go(go(c, 4), 0)].map((p) => s.buildFac('belt', p[0], p[1], 0)!);
    step(s, 12);
    ok(past.every((b) => !b.items.length) && outB.items.length > 0, `a splitter feeds the belt leading away (${outB.items.length}) and not a line running past (${past.map((b) => b.items.length).join(',')})`);
  }
  {
    // (review) items are never made or lost on the way: random arm, belt, splitter and tunnel layouts with mines, crates and
    // turrets, with filters, turned, sold and rebuilt as they run: what the factory holds changes only by what the mines dig,
    // what the turrets use and what arms drop with a 'lost' event
    let rnd = 7;
    const R = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x80000000; };
    let bad = '', runs = 0;
    for (let run = 0; run < 24 && !bad; run++) {
      const s = fac(), c = open(s, 3), tiles = disc(c[0], c[1], 3), towers: Tower[] = [];
      for (const [x, z] of tiles) {
        const r = R(), d = Math.floor(R() * 6);
        if (r < 0.32) arm(s, [x, z], d);
        else if (r < 0.58) s.buildFac('belt', x, z, d);
        else if (r < 0.68) { s.factory.ore[at(x, z)] = 1 + Math.floor(R() * 3); s.buildFac('mine', x, z); }
        else if (r < 0.71) s.buildFac('splitter', x, z);
        else if (r < 0.75) s.buildFac('tunnel', x, z, d);
        else if (r < 0.77) s.factory.placeCrate(x, z, 'iron_ore', 6);
        else if (r < 0.85) { const t = s.build('pulse', x, z); if (t) towers.push(t); }
      }
      for (const f of s.factory.facs) if (f.type === 'arm' && R() < 0.15) s.setArmFilter(f.id, (['iron_ore', 'copper_ore', 'coal'] as const)[Math.floor(R() * 3)]);
      const held = () => { let h = 0; for (const f of s.factory.facs) { for (const k in f.inv) h += f.inv[k as ItemType] || 0; h += f.out.length + f.items.length + (f.hand ? 1 : 0) + (f.type === 'crate' ? f.left : 0); } for (const t of s.towers) h += t.stock; return h; };
      let H = held();
      for (let k = 0; k < 60 * 40 && !bad; k++) {
        if (k % 30 === 29) {
          const fs = s.factory.facs, f = fs[Math.floor(R() * fs.length)], op = R();
          if (f && f.type !== 'crate' && f.type !== 'mine') {
            if (op < 0.15) s.sellFac(f.id); else if (op < 0.8) s.rotateFac(f.id, Math.floor(R() * 6)); else if (f.type === 'arm') s.setArmFilter(f.id, R() < 0.5 ? null : 'iron_ore');
            // (what a sold building held goes with it, and a turned tunnel re-pairs and may empty an entrance: count afresh)
            s.factory.links(); H = held();
          }
        }
        const mp = s.factory.facs.filter((f) => f.type === 'mine').map((f) => f.prog);
        s.step(1 / 60);
        let dug = 0, lost = 0, used = 0;
        s.factory.facs.filter((f) => f.type === 'mine').forEach((f, i) => { if (f.prog < mp[i] - 1e-9) dug++; });
        for (const e of s.events.splice(0)) if (e.k === 'lost') lost++;
        for (const t of s.towers) if (t.stock) { used += t.stock; t.stock = 0; }
        const H2 = held();
        if (H2 !== H + dug - used - lost) bad = `run ${run} step ${k}: held ${H} -> ${H2}, dug ${dug}, used ${used}, lost ${lost}`;
        H = H2;
      }
      runs++;
    }
    ok(!bad, `no item is made or lost on the way in ${runs} random factories changed as they run ${bad}`);
  }
  {
    // (review) an upgraded Transfer Arm gives back its price but only 60% of its upgrades
    const s = fac(), c = open(s, 1), a = arm(s, c, 0), g0 = s.gold;
    s.upgradeFac(a.id); s.upgradeFac(a.id);
    const up = g0 - s.gold, base = a.spent - up;
    ok(a.lvl === 3 && s.facSellValue(a.id) === base + Math.round(up * 0.6), `an upgraded arm refunds ${s.facSellValue(a.id)} of ${a.spent} (its price ${base} and 60% of ${up} in upgrades)`);
  }
  {
    // unlocks: a run starts with the Pulse Turret, the Transfer Arm and the Mine; every other building comes with its own
    // production card; a blueprint brings only its tower, tier by tier, and the offers push the production cards it waits on
    const s = fac({}, true), [cx, cz] = open(s, 1), g0 = s.gold;
    ok([...s.unlocked].join() === 'pulse' && [...s.facs].sort().join() === 'arm,mine' && START_FACS.join() === 'arm,mine', 'a run starts with the Pulse Turret, the Transfer Arm and the Mine');
    for (const t of FAC_TYPES) if (t !== 'mine' && t !== 'arm') ok(s.facBlock(t, cx, cz) === 'locked' && !s.buildFac(t, cx, cz), `${t} is locked at the start`);
    ok(s.gold === g0 && !s.factory.facAt(cx, cz) && s.facBlock('arm', cx, cz) === '' && !s.canBuild('rail', cx, cz), 'a locked building costs nothing and places nothing');
    ok(FAC_TYPES.every((f) => START_FACS.includes(f) !== !!FAC_CARD[f]) && PROD_CARDS.every((c) => c.max === 1 && c.kind === 'factory' && !!c.unlocks?.length && CARD_BY_ID[c.id] === c) && FACS.arm.cost === 8 && FAC_UPGRADABLE.has('arm'),
      'every building but the arm and the mine has exactly one production card; the Transfer Arm costs 8 and has levels');
    s.players[0].pending = [['bp_rail']]; s.pickCard(0, 0);
    ok(s.unlocked.has('rail') && [...s.facs].sort().join() === 'arm,mine' && !s.canSupply('rail') && s.supplyCards('rail').join() === 'power,smelter,works' && s.facBlock('smelter', cx, cz) === 'locked',
      `the Railgun blueprint brings the tower only; its supply waits on ${s.supplyCards('rail').join(', ')}`);
    s.level = 3; s.grant('smelter');
    ok(s.facs.has('smelter') && !!s.buildFac('smelter', cx, cz) && s.supplyCards('rail').join() === 'power,works' && s.supplyFrontier().join() === 'power', `the Smelting card opens the smelter; the frontier is now ${s.supplyFrontier().join()} (the Frame Works waits for power)`);
    for (const t of TOWER_TYPES) ok(TOWER_CHAIN[t].every((f) => FAC_TYPES.includes(f)) && (!TOWERS[t].needs.power || (TOWER_CHAIN[t].includes('generator') && TOWER_CHAIN[t].includes('pole'))) && (TOWERS[t].mat === 0 || TOWER_CHAIN[t].includes('works')) && TOWER_CHAIN[t].every((f) => START_FACS.includes(f) || !!FAC_CARD[f]), `${t}: its chain covers power and materials, and every building in it has a card`);
    const noCard = TOWER_TYPES.filter((t) => t !== 'pulse' && !Object.hasOwn(CARD_BY_ID, 'bp_' + t));
    ok(!noCard.length && CARDS.filter((c) => c.kind === 'blueprint').every((c) => c.max === 1 && TOWER_TYPES.includes(c.id.slice(3) as TowerType)), 'every tower but the Pulse Turret has a blueprint card');
    // walk the blueprints on every map: tier by tier, each brings only its tower, and at the end every tower is unlocked
    for (const m of MAPS) {
      const q = new Sim({ seed: 3, map: m }), start = [...q.unlocked], facs0 = [...q.facs].sort().join();
      let n = 0, tiers = true;
      for (; n < 30; n++) {
        const offer = q.bpOpen();
        if (!offer.length) break;
        const locked = TOWER_TYPES.filter((t) => !q.unlocked.has(t)), low = Math.min(...locked.map((t) => TOWER_TIER[t]));
        if (!offer.every((t) => TOWER_TIER[t] === low) || !locked.filter((t) => TOWER_TIER[t] === low).every((t) => offer.includes(t))) tiers = false;
        q.players[0].pending = [['bp_' + offer[n % offer.length]]]; q.pickCard(0, 0);
      }
      ok(tiers && TOWER_TYPES.every((t) => q.unlocked.has(t)) && [...q.facs].sort().join() === facs0 && !q.facs.has('crate'), `${m.id}: blueprints come tier by tier and bring their towers only (${n} cards; started with ${start.join(',')}; buildings ${facs0})`);
      ok(!q.rollCards(0).some((id) => id.startsWith('bp_')), `${m.id}: no blueprint is offered once all are taken`);
    }
    ok(!Object.hasOwn(CARD_BY_ID, 'underpass') && !('underpass' in s.mods), 'the Underpass card and its modifier are gone');
  }
  {
    // card preconditions: requires, excludes, minLevel, maxLevel, minWave, guaranteeBy; production cards with nothing left to open are not offered
    const s = new Sim({ seed: 4, map: bare, pauseOnCards: false }), C = (id: string) => CARD_BY_ID[id];
    s.level = 2;
    ok(!s.cardOk(0, C('press')) && !s.cardOk(0, C('pulse_shells')) && !s.cardOk(0, C('tunnels')) && !s.cardOk(0, C('splitter')) && !s.cardOk(0, C('f_belt')) && !s.cardOk(0, C('smelter')) && s.cardOk(0, C('belts')) && s.cardOk(0, C('power')),
      'at level 2: Belts and Power Grid can be offered; not the Shell Press (needs Smelting and Power), Plasma Rounds (needs the press), Tunnels, the Splitter or Express Belts (need Belts and level 4), Smelting (level 3)');
    s.level = 4; s.grant('belts');
    ok(s.cardOk(0, C('tunnels')) && s.cardOk(0, C('splitter')) && s.cardOk(0, C('f_belt')), 'with Belts at level 4 the Tunnels, the Splitter and Express Belts can be');
    s.grant('smelter'); s.grant('power');
    ok(s.cardOk(0, C('press')) && !s.cardOk(0, C('pulse_shells')) && s.cardOk(0, C('works')) && s.cardOk(0, C('oil')) && !s.cardOk(0, C('cells')), 'with Smelting and Power the Shell Press and the Frame Works can be offered; the Cell Plant waits for the oil');
    s.grant('press');
    ok(s.cardOk(0, C('pulse_shells')) && !s.cardOk(0, C('press')) && !s.cardOk(0, C('flame_petrol')), 'with the Shell Press taken, Plasma Rounds can be; the press is not offered twice; Petrol Burners need the Firewall and a refinery');
    // a synthetic card for the rest of the framework
    const x: Card = { id: '_test', name: 'Test', desc: '', rar: 0, kind: 'eco', max: 1, icon: 'x', minLevel: 3, maxLevel: 6, minWave: 2, excludes: ['salvage'], apply: () => {} };
    CARDS.push(x); CARD_BY_ID._test = x;
    s.level = 2; s.wave = 3; const a1 = s.cardOk(0, x); s.level = 7; const a2 = s.cardOk(0, x); s.level = 5; s.wave = 1; const a3 = s.cardOk(0, x); s.wave = 2; const a4 = s.cardOk(0, x);
    s.grant('salvage'); const a5 = s.cardOk(0, x);
    CARDS.pop(); delete CARD_BY_ID._test;
    ok(!a1 && !a2 && !a3 && a4 && !a5, `minLevel, maxLevel, minWave and excludes are honoured (${[a1, a2, a3, a4, a5].join()})`);
    // a production card whose buildings are all open already is not offered (a map's crate opened the power grid; a free run)
    const fr = new Sim({ seed: 4, map: bare, free: true }); fr.level = 9;
    ok(PROD_CARDS.every((c) => !fr.cardOk(0, c)) && fr.taken('press') && fr.cardOk(0, C('f_belt')) && !fr.cardOk(0, C('pulse_shells')), 'a free run is offered no production card (all open), cards that require one count it as taken, and no ammo card');
    // the same seed and the same picks give the same offers
    const play = (seed: number) => { const q = new Sim({ seed, map: bare, pauseOnCards: false }), o: string[] = []; for (let L = 0; L < 25; L++) { priv(q).levelUp(); o.push(q.players[0].pending[0].join()); q.pickCard(0, L % 3); } return o.join('|'); };
    ok(play(77) === play(77) && play(77) !== play(78), 'rollCards is deterministic: the same seed and picks give the same offers');
  }
  {
    // 500 runs with random picks: every offer holds only cards that can be offered; Belts come in the first two offers until
    // taken; the Tunnels never before level 4 or without belts, and from level 7 once belts are in unless they were passed
    // over (they rest DECLINE_REST levels after each time, and are no longer forced after DECLINE_MAX times) or another
    // forced card holds the one forced place; ammo cards only after their plant; at most one blueprint; at most one forced
    // or pushed card (two with a blueprint and its own supply card); and while an unlocked tower waits on production cards,
    // each card of that "frontier" that may still be pushed is offered within N offers. N = 5: the frontier gets one place
    // per offer (not when a forced card or a blueprint and its own card hold it), a fresh blueprint's path comes first.
    const N = 5;
    let bad = 0, maxWait = 0, maxFr = 0, belts2 = 0, runs = 0, tun = 0, firstBad = '';
    const rnd = (() => { let a = 12345; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    for (let r = 0; r < 500; r++) {
      const q = new Sim({ seed: 1000 + r, map: MAPS[r % MAPS.length], pauseOnCards: false }), wait = new Map<string, number>();
      runs++;
      const say = (m: string) => { bad++; if (!firstBad) firstBad = `run ${r} level ${q.level}: ${m}`; };
      for (let L = 2; L <= 30; L++) {
        q.wave = Math.floor(L * 0.8);
        priv(q).levelUp();
        const o = q.players[0].pending[0] || [], pu: string[] = priv(q).offerPushed.get(o) || [];
        const dueNow = (id: string) => { const d = priv(q).dueAt(CARD_BY_ID[id]); return d !== undefined && q.level >= d; };
        if (o.some((id) => !q.cardOk(0, CARD_BY_ID[id]))) say('an offered card cannot be offered: ' + o.join());
        if (o.filter((id) => id.startsWith('bp_')).length > 1) say('two blueprints');
        if (pu.length > (o.some((id) => id.startsWith('bp_')) ? 2 : 1) || pu.filter(dueNow).length > 1) say('too many forced cards: ' + pu.join());
        if (q.level <= 3 && !q.taken('belts') && !o.includes('belts')) say('no Belts in an early offer');
        if (q.level === 2 && o.includes('belts')) belts2++;
        if (o.includes('tunnels') && (q.level < 4 || !q.taken('belts'))) say('Tunnels too early');
        if (q.level >= 7 && q.taken('belts') && !q.taken('tunnels') && !o.includes('tunnels') && priv(q).pushable('tunnels') && !pu.some(dueNow)) say('no Tunnels from level 7');
        if (o.includes('tunnels')) tun++;
        if (o.includes('pulse_shells') && !q.taken('press')) say('Plasma Rounds before the press');
        maxFr = Math.max(maxFr, q.supplyFrontier().length);
        for (const id of q.supplyFrontier()) { const w = o.includes(id) || !priv(q).pushable(id) ? 0 : (wait.get(id) || 0) + 1; wait.set(id, w); maxWait = Math.max(maxWait, w); }
        for (const id of [...wait.keys()]) if (!q.supplyFrontier().includes(id)) wait.delete(id);
        q.pickCard(0, Math.floor(rnd() * o.length));
      }
    }
    ok(!bad && belts2 === runs && tun > 0, `${runs} random runs: every offer valid, Belts in the first offer, Tunnels in their window, at most one forced card (${bad ? firstBad : 'ok'})`);
    console.log(`card offers: a waiting production card came within ${maxWait} offers, the frontier held at most ${maxFr} cards (500 random runs)`);
    ok(maxWait <= N && maxFr <= 4, `a production card a tower waits on is offered within ${N} offers of becoming available (longest wait ${maxWait}, longest frontier ${maxFr} cards)`);
  }
  {
    // card pacing (1): a forced or pushed card the player passes over backs off. The Cryo Lance unlocked by hand (no fresh
    // blueprint) waits on the Power Grid; a player who never takes it sees it pushed at most every third level and, with no
    // Cryo Lance on the field, no longer after the third time; with one built (it cannot be fed) it keeps coming back.
    const pushedIn = (q: Sim, o: string[]): string[] => priv(q).offerPushed.get(o) || [];
    const decline = (built: boolean) => {
      const q = new Sim({ seed: 41, map: bare, pauseOnCards: false }); q.gold = 1e9; q.mats = 1e9; q.nextWaveIn = 1e9;
      q.grant('belts'); q.grant('tunnels'); q.unlocked.add('cryo');
      if (built) for (let i = 0; i < GW * GH; i++) if (q.grid[i] === 0 && q.build('cryo', i % GW, Math.floor(i / GW))) break;
      const lv: number[] = [];
      for (let L = 2; L <= 16; L++) {
        priv(q).levelUp(); const o = q.players[0].pending[0];
        if (pushedIn(q, o).includes('power')) lv.push(q.level);
        q.pickCard(0, Math.max(0, o.findIndex((id) => id !== 'power' && !id.startsWith('bp_') && !CARD_BY_ID[id].unlocks)));
      }
      return lv;
    };
    const a = decline(false), b = decline(true), gaps = (l: number[]) => l.every((v, i) => i === 0 || v - l[i - 1] >= 3);
    console.log(`card offers: a Power Grid always passed over is pushed on levels ${a.join()} (with a Cryo Lance on the field ${b.join()})`);
    ok(a.length === 3 && gaps(a) && b.length >= 4 && gaps(b) && b[b.length - 1] > a[2], `a passed-over Power Grid rests two levels each time and is no longer pushed after three (pushed on levels ${a.join()}; with a Cryo Lance on the field ${b.join()})`);
    // two guarantees due on the same level: one forced card per offer, the later in the table waits a level
    const g: Card = { id: '_due', name: 'Due', desc: '', rar: 2, kind: 'eco', max: 1, icon: 'x', guaranteeBy: 7, apply: () => {} };
    CARDS.push(g); CARD_BY_ID._due = g;
    const q = new Sim({ seed: 42, map: bare, pauseOnCards: false }); q.grant('belts'); q.level = 6;
    priv(q).levelUp(); const o7 = q.players[0].pending[0], p7 = pushedIn(q, o7).join();
    q.pickCard(0, o7.findIndex((id) => id !== 'tunnels' && id !== '_due'));
    priv(q).levelUp(); const o8 = q.players[0].pending[0], p8 = pushedIn(q, o8).join();
    CARDS.pop(); delete CARD_BY_ID._due;
    ok(p7 === 'tunnels' && !o7.includes('_due') && p8.split(',')[0] === '_due' && !o8.includes('tunnels'), `two guarantees due on level 7: the Tunnels are forced on 7 (${o7.join()}), the other card on 8 (${o8.join()})`);
  }
  {
    // card pacing (2): an ammo card comes within three levels of its plant, once a tower of its type on the field is Mk2 or
    // Mk3 (deterministic: the press granted on level 6 with a Mk2 Pulse Turret; the Plasma Rounds are passed over by chance otherwise)
    const mkA = (lvl: number) => {
      const q = new Sim({ seed: 43, map: bare, pauseOnCards: false }); q.gold = 1e9; q.nextWaveIn = 1e9;
      for (let i = 0; i < GW * GH; i++) if (q.grid[i] === 0) { const t = q.build('pulse', i % GW, Math.floor(i / GW)); if (t) { t.lvl = lvl; break; } }
      for (const id of ['belts', 'power', 'smelter']) q.grant(id);
      q.level = 6; q.grant('press');
      let at = 0; for (let L = 7; L <= 12 && !at; L++) { priv(q).levelUp(); const o = q.players[0].pending[0]; if (o.includes('pulse_shells')) at = q.level; else q.pickCard(0, 0); }
      return { at, due: priv(q).dueAt(CARD_BY_ID.pulse_shells) as number | undefined };
    };
    const m2 = mkA(2), m3 = mkA(3), m1 = mkA(1);
    ok(m2.due === 8 && m2.at >= 7 && m2.at <= 9 && m3.due === 8 && m3.at <= 9 && m1.due === undefined, `Plasma Rounds are forced two levels after the Shell Press (level 8; offered on ${m2.at} with a Mk2, ${m3.at} with a Mk3); not with a Mk1 turret only`);
    // 300 random runs that build each tower they unlock at Mk2: the ammo card comes within three levels of its plant
    const rnd = (() => { let a = 4242; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const waits: Record<string, number[]> = { pulse_shells: [], flame_petrol: [] };
    for (let r = 0; r < 300; r++) {
      const q = new Sim({ seed: 9000 + r, map: MAPS[r % MAPS.length], pauseOnCards: false }); q.gold = 1e9; q.mats = 1e9; q.nextWaveIn = 1e9;
      const built = new Set<TowerType>(), from: Record<string, number> = {};
      for (let L = 2; L <= 30; L++) {
        q.wave = Math.floor(L * 0.8);
        for (const t of q.unlocked) if (!built.has(t)) for (let i = 0; i < GW * GH; i++) if (q.grid[i] === 0) { const tw = q.build(t, i % GW, Math.floor(i / GW)); if (tw) { tw.lvl = 2; built.add(t); break; } }
        priv(q).levelUp(); const o = q.players[0].pending[0];
        for (const [ammo, w] of Object.entries(waits)) if (from[ammo] >= 0 && o.includes(ammo)) { w.push(q.level - from[ammo]); from[ammo] = -1; }
        q.pickCard(0, Math.floor(rnd() * o.length));
        for (const [ammo, plant] of [['pulse_shells', 'press'], ['flame_petrol', 'refinery']]) {
          const tw = CARD_BY_ID[ammo].needs!;
          if (from[ammo] === undefined && built.has(tw) && q.taken(plant) && !q.taken(ammo)) from[ammo] = Math.max(q.level, priv(q).cardTakenAt[plant] ?? 0);
        }
      }
    }
    const mx = (a: number[]) => Math.max(0, ...a);
    const hist = (a: number[]) => [1, 2, 3].map((k) => `${a.filter((v) => v === k).length}x ${k}`).join(', ');
    console.log(`card offers: levels from the plant to the ammo card: Plasma Rounds ${hist(waits.pulse_shells)}; Petrol Burners ${hist(waits.flame_petrol)}`);
    ok(waits.pulse_shells.length > 100 && waits.flame_petrol.length > 10 && mx(waits.pulse_shells) <= 3 && mx(waits.flame_petrol) <= 3,
      `300 random runs: Plasma Rounds come at most ${mx(waits.pulse_shells)} levels after the Shell Press (${waits.pulse_shells.length} runs), Petrol Burners at most ${mx(waits.flame_petrol)} after the Refinery (${waits.flame_petrol.length} runs)`);
  }
  {
    // card pacing (3): a blueprint's supply path comes first in the next offers, one card at a time in dependency order. 500
    // random runs that take every blueprint offered: levels from the Mortar blueprint to being able to build its whole
    // supply (Smelter, Frame Works, Shell Press...). Was a median of 8 levels (p75 12, p90 16) before the priority.
    const rnd = (() => { let a = 99; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const d: number[] = []; let n = 0, hit = 0;
    for (let r = 0; r < 500; r++) {
      const q = new Sim({ seed: 20000 + r, map: MAPS[r % MAPS.length], pauseOnCards: false });
      if (q.unlocked.has('mortar')) continue;
      let at = -1;
      for (let L = 2; L <= 40; L++) {
        q.wave = Math.floor(L * 0.8); priv(q).levelUp();
        const o: string[] = q.players[0].pending[0];
        if (at >= 0 && q.level - at <= 6 && !q.canSupply('mortar') && !o.some((id) => id.startsWith('bp_'))) { n++; if (o.some((id) => q.supplyCards('mortar').includes(id))) hit++; }
        const b = o.findIndex((id) => id.startsWith('bp_'));
        q.pickCard(0, b >= 0 ? b : Math.floor(rnd() * o.length));
        if (at < 0 && q.unlocked.has('mortar')) at = q.level;
        if (at >= 0 && q.canSupply('mortar')) { d.push(q.level - at); break; }
      }
    }
    d.sort((x, y) => x - y);
    const P = (p: number) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
    console.log(`card offers: the Mortar is suppliable a median ${P(0.5)} levels after its blueprint (p75 ${P(0.75)}, p90 ${P(0.9)}, ${d.length} runs); its path is in ${(100 * hit / n).toFixed(0)}% of the offers in between`);
    ok(d.length > 200 && P(0.5) <= 5 && P(0.75) <= 9 && hit / n > 0.9, `a fresh blueprint's supply path is in ${(100 * hit / n).toFixed(0)}% of the next offers; the Mortar is suppliable a median ${P(0.5)} levels after its blueprint (was 8)`);
  }
  {
    // no Underpass any more: nothing at all goes on a road, Belt and Pipe Tunnels pass under it instead
    const s = fac(), why = 'road: Belt and Pipe Tunnels pass under it';
    const roads: [number, number][] = []; for (let i = 0; i < GW * GH; i++) if (s.grid[i] === 1) roads.push([i % GW, Math.floor(i / GW)]);
    ok(roads.length > 20 && roads.every(([x, z]) => FAC_TYPES.every((t) => s.facBlock(t, x, z) === why) && !s.buildFac('belt', x, z, 0) && !s.canBuild('pulse', x, z)), `no building and no tower goes on a road (${roads.length} road tiles)`);
    ok(!('underpass' in s.mods) && s.factory.facs.every((f) => !f.under), 'the Underpass is gone: no modifier, no building under a road');
    // a tunnel under the road: mine > arm > entrance, ore comes out of the exit, an arm there hands it into the turret
    const free = (p: [number, number]) => inBoard(p[0], p[1]) && s.grid[at(p[0], p[1])] === 0;
    let X: { r: [number, number]; d: number } | null = null;
    for (const r of roads) { for (let d = 0; d < 6 && !X; d++) if ([1, 2, 3].every((n) => free(go(r, d, n)) && free(go(r, d + 3, n)))) X = { r, d }; if (X) break; }
    ok(!!X, 'the map has a road one tile wide to tunnel under');
    if (X) {
      const { r, d } = X, M = go(r, d + 3, 3), A1 = go(r, d + 3, 2), E = go(r, d + 3), Xt = go(r, d), A2 = go(r, d, 2), T = go(r, d, 3);
      lay(s, M, 'iron_ore');
      const ent = s.buildFac('tunnel', E[0], E[1], d)!;
      ok(!!ent && ent.pair === 0 && s.diag().get('f' + ent.id)?.missing.join() === `a second tunnel facing the same way within ${TUNNEL_REACH} tiles`, 'a lone tunnel is unpaired, and the diagnosis says what it lacks');
      const ex = s.buildFac('tunnel', Xt[0], Xt[1], d)!, mine = s.buildFac('mine', M[0], M[1])!, a1 = arm(s, A1, d), tw = s.build('pulse', T[0], T[1])!;
      ok(!!ex && !!mine && !!a1 && !!tw && (s.factory.sync(), ent.pair === ex.id && ex.pair === ent.id && ex.exit && !ent.exit) && s.grid[at(r[0], r[1])] === 1 && !s.factory.facAt(r[0], r[1]), 'two tunnels facing the same way pair up, entrance and exit; the road stays a road');
      ok(s.diag().get('f' + ex.id)?.missing.join() === 'an arm at its end' && (s.diag().get('f' + ex.id)?.why || []).join() === 'tunnel ends without an arm' && s.diag().get('t' + tw.id)?.ok === false, 'without an arm at the exit the turret gets nothing, and the exit says so');
      const a2 = arm(s, A2, d);
      ok(s.diag().get('t' + tw.id)?.ok === true && s.diag().get('t' + tw.id)!.from.join() === 'Mine (by belt)' && s.diag().get('f' + ent.id)?.ok === true && s.diag().get('f' + ex.id)?.ok === true, 'with an arm at the exit the diagnosis follows the line through the tunnel');
      const evs: Ev[] = []; let under = false;
      for (let i = 0; i < 60 * 14 && !tw.stock; i++) { step(s, 1 / 60, evs); if (ent.items.some((q) => q.p > 0.5 && q.p < 1.5)) under = true; }
      const tk = evs.find((q) => q.k === 'take' && q.id === a2.id), pt = evs.find((q) => q.k === 'put' && q.who === 't' + tw.id);
      ok(under && tw.stock === TOWER_STOCK && !!tk && tk.x === ex.x && tk.z === ex.z && tk.tx === a2.x && !!pt && pt.x === a2.x && pt.tx === tw.x && pt.it === 'iron_ore' && pt.id === tw.id, 'the ore travels underground; the arm takes it at the exit (take event) and puts it into the turret (put event)');
      const e = foe(s, s.map.nearest(0, cellX(r[0], r[1]), cellZ(r[1]))), d0 = e.dist; e.speed = 3; step(s, 1);
      ok(e.dist > d0 + 1, 'enemies walk over the tunnel as before');
      ok(s.facSellValue(ent.id) === FACS.tunnel.cost && s.sellFac(ent.id) && (s.factory.sync(), ex.pair === 0), 'a tunnel sells for its full price, and its partner is unpaired again');
    }
  }
  {
    // a belt tunnel under a tower: the tower in between takes nothing, the arm at the exit hands it all to the turret behind
    const s = fac(), c = open(s, 3), F = go(c, 3, 2), E = go(c, 3), Xt = go(c, 0), A = go(c, 0, 2), T = go(c, 0, 3);
    const feed = s.buildFac('belt', F[0], F[1], 0)!, ent = s.buildFac('tunnel', E[0], E[1], 0)!, mid = s.build('pulse', c[0], c[1])!, ex = s.buildFac('tunnel', Xt[0], Xt[1], 0)!, a = arm(s, A, 0), end = s.build('pulse', T[0], T[1])!;
    s.factory.sync();
    ok(!!feed && ent.pair === ex.id && ex.exit && !!mid && !!a && !!end, 'entrance, a turret on the tile between, exit, an arm and a turret after it');
    feed.items.push({ it: 'iron_ore', p: 0.6 });
    step(s, 0.6 + 1.2);
    ok(!feed.items.length && ent.items.length === 1 && ent.items[0].p > 0 && ent.items[0].p < 2, `the item enters the tunnel and travels inside it (p ${ent.items[0]?.p.toFixed(2)} of 2)`);
    step(s, 2 / BELT_SPEED + 1.5);
    ok(end.stock === 1 && mid.stock === 0 && !ent.items.length, `it comes out at the exit: the turret behind gets it by the arm, the one above the tunnel nothing (${end.stock}, ${mid.stock})`);
    // an unpaired tunnel is a dead end: nothing goes in
    const q = fac(), qc = open(q, 3), QB = go(qc, 3), QT = go(qc, 0);
    const lone = q.buildFac('tunnel', qc[0], qc[1], 0)!, qb = q.buildFac('belt', QB[0], QB[1], 0)!, qt = q.build('pulse', QT[0], QT[1])!;
    qb.items.push({ it: 'iron_ore', p: 0.9 });
    step(q, MINE_TIME * 3);
    ok(lone.pair === 0 && !lone.items.length && qb.items.length === 1 && qt.stock === 0, 'an unpaired tunnel is a dead end: the item waits on the belt before it');
    ok(q.diag().get('t' + qt.id)?.missing.join() === 'iron ore', 'and the turret behind it is diagnosed without iron ore');
    // pairing: the same direction within TUNNEL_REACH tiles straight ahead
    const p = fac(), pc = open(p, 3), A0 = go(pc, 3, 3);
    const a0 = p.buildFac('tunnel', A0[0], A0[1], 0)!, far = p.buildFac('tunnel', ...go(A0, 0, TUNNEL_REACH + 1), 0)!; p.factory.sync();
    ok(TUNNEL_REACH === 4 && a0.pair === 0 && far.pair === 0, `two tunnels ${TUNNEL_REACH + 1} tiles apart do not pair`);
    const back = p.buildFac('tunnel', ...go(A0, 0, 2), 3)!; p.factory.sync();
    ok(a0.pair === 0 && back.pair === 0, 'nor do two facing different ways');
    const near = p.buildFac('tunnel', ...go(A0, 0, TUNNEL_REACH), 0)!; p.factory.sync();
    ok(a0.pair === near.id && near.exit && far.pair === 0, `${TUNNEL_REACH} tiles apart, facing the same way, they do`);
  }
  {
    // pipe tunnels: two in a straight line join their pipe networks under what stands between
    const s = fac(), c = open(s, 3), L = go(c, 3, 3), G = go(L, 1);
    lay(s, L, 'oil');
    const pump = s.buildFac('pump', L[0], L[1])!, gen = s.buildFac('generator', G[0], G[1])!, t1 = s.buildFac('ptunnel', ...go(L, 0, 1))!;
    const block = s.build('pulse', ...go(L, 0, 2))!, sm = s.buildFac('smelter', ...go(L, 0, 3))!, pylon = s.build('flame', ...go(L, 0, 5))!;
    gen.inv.coal = 2;
    step(s, 3);
    ok(!!pump && !!t1 && !!block && !!sm && t1.pair === 0 && pylon.tank === 0 && pylon.dry, 'a lone pipe tunnel joins nothing, the pylon stays dry');
    const t2 = s.buildFac('ptunnel', ...go(L, 0, 4))!;
    s.factory.sync();
    ok(!!t2 && t1.pair === t2.id && t2.pair === t1.id && t1.net === t2.net && t1.net >= 0, 'a second one in a straight line pairs with it: one network');
    step(s, 15);
    ok(pylon.tank > 0 && !pylon.dry && s.factory.pipeFluid(t2).fluid === 'crude', `the crude goes under the turret and the smelter into the pylon (${pylon.tank.toFixed(1)})`);
    ok(s.diag().get('t' + pylon.id)?.missing.join() === 'crude oil' && s.diag().get('f' + pump.id)?.missing.join() === 'power', 'the diagnosis does not count coal put in by hand: nothing makes it');
    const k = freeRay(s, G, 2);
    ok(k >= 0, 'room for a coal mine and an arm at the generator');
    if (k >= 0) {
      const CM = go(G, k, 2); lay(s, CM, 'coal'); s.buildFac('mine', CM[0], CM[1]); arm(s, go(G, k), k + 3);
      ok(s.diag().get('t' + pylon.id)?.ok === true && s.diag().get('t' + pylon.id)!.from.includes('pipe network with a Pumpjack'), 'with a coal mine and an arm at the generator it sees the crude reach the pylon through the tunnels');
    }
  }
  {
    // the Belt Splitter deals what comes in, in turn, to the belts leading away; an arm puts into it and takes from it
    const s = fac(), c = open(s, 3), Cr = go(c, 3, 2), In = go(c, 3);
    const sp = s.buildFac('splitter', c[0], c[1])!, ain = arm(s, In, 0);
    const side = [1, 5].map((d) => ({ b1: s.buildFac('belt', ...go(c, d), d)!, a: arm(s, go(c, d, 2), d), t: s.build('pulse', ...go(c, d, 3))! }));
    const cr = s.factory.placeCrate(Cr[0], Cr[1], 'iron_ore', 8)!;
    ok(!!sp && !!ain && !!cr && side.every((x) => !!x.b1 && !!x.a && !!x.t) && SPLIT_CAP === 2 && FACS.splitter.cost === 12, 'a crate, an arm into a splitter, and on two sides a belt and an arm to a turret');
    const seen = new Set<object>(), order: number[] = [];
    for (let i = 0; i < 60 * 60; i++) { step(s, 1 / 60); side.forEach((x, k) => { for (const it of x.b1.items) if (!seen.has(it)) { seen.add(it); order.push(k); } }); if (i % 60 === 0) for (const x of side) x.t.stock = 0; }
    ok(cr.left === 0 && order.length === 8 && order.filter((k) => k === 0).length === 4 && order.every((k, i) => i === 0 || k !== order[i - 1]), `round robin: the 8 items alternate between the two sides (${order.join('')})`);
    // a turret right beside the splitter takes nothing from it; an arm between them does (take event at the splitter)
    const q = fac(), qc = open(q, 2), QC = go(qc, 3, 2), QI = go(qc, 3);
    const qs = q.buildFac('splitter', qc[0], qc[1])!; arm(q, QI, 0); const nt = q.build('pulse', ...go(qc, 1))!;
    q.factory.placeCrate(QC[0], QC[1], 'iron_ore', 3);
    step(q, 4);
    ok(nt.stock === 0 && qs.items.length > 0, 'a turret right beside the splitter takes nothing from it');
    const qa = arm(q, go(qc, 0), 0), qt = q.build('pulse', ...go(qc, 0, 2))!, evs: Ev[] = [];
    step(q, 4, evs);
    ok(qt.stock === 1 && evs.some((e) => e.k === 'take' && e.id === qa.id && e.x === qs.x && e.z === qs.z), 'an arm takes from the splitter into the turret (take event at the splitter)');
  }
  {
    // two arms put onto the same belt tile: both get their items on, in the gaps the belt leaves
    const s = fac(), c = open(s, 3), P = (n: number) => go(go(c, 3), 0, n);
    for (const n of [0, 1, 2]) s.buildFac('belt', ...P(n), 0);
    const c1 = s.factory.placeCrate(...go(P(0), 4, 2), 'coal', 6)!, c2 = s.factory.placeCrate(...go(P(0), 2, 2), 'iron_ore', 6)!;
    arm(s, go(P(0), 4), 1); arm(s, go(P(0), 2), 5);
    step(s, 20);
    const items = [0, 1, 2].flatMap((n) => s.factory.facAt(...P(n))!.items);
    ok(c1.left + c2.left < 12 && items.length >= 4 && items.some((x) => x.it === 'coal') && items.some((x) => x.it === 'iron_ore') && [0, 1, 2].every((n) => { const b = s.factory.facAt(...P(n))!.items; return b.every((x, i) => i === 0 || b[i - 1].p - x.p >= BELT_GAP - 1e-9); }),
      `both arms load the line, items keep the belt gap (${items.map((x) => x.it[0]).join('')})`);
  }
  {
    // an arm at a splitter takes the item its target can use, past the one in front that it cannot
    const s = fac(), c = open(s, 2);
    const sp = s.buildFac('splitter', ...c)!;
    const ag = arm(s, go(c, 1), 1), g = s.buildFac('generator', ...go(c, 1, 2))!, at3 = arm(s, go(c, 0), 0), t = s.build('pulse', ...go(c, 0, 2))!;
    g.inv.coal = 2; g.fuel = 1e9; s.factory.sync();
    sp.items.push({ it: 'coal', p: 0.5 }, { it: 'iron_ore', p: 0.5 });
    step(s, 1.5);
    ok(!!ag && !!at3 && t.stock === 1 && sp.items.length === 1 && sp.items[0].it === 'coal', 'a splitter is not held up by a coal the full generator cannot take yet: the arm to the turret takes the ore behind it');
  }
  {
    // a Pulse Turret reaching Mk3 keeps its ore; switched to shells it drops the ore, its ore arm stops (the ore in its hand
    // is lost), and an arm from a shell crate feeds it
    const s = fac(), c = open(s, 3), T = go(c, 0, 2);
    s.mats = 1e6;
    const t = s.build('pulse', T[0], T[1])!, ore = s.factory.placeCrate(...go(c, 3), 'iron_ore', 999)!, ao = arm(s, c, 0), ad = arm(s, go(c, 0), 0);
    step(s, 3);
    ok(!!ore && !!ao && !!ad && t.stock === 1, 'crate > arm > arm > turret: the turret is fed ore');
    s.upgrade(t.id); s.upgrade(t.id);
    step(s, 4);
    ok(t.lvl === 3 && needsOf(t).item === 'iron_ore' && t.stock === 1 && !t.ammo2, 'at Mk3 the turret still runs on ore');
    s.grant('pulse_shells');
    ok(s.setAmmo2(t.id, true) && t.ammo2 && t.stock === 0 && needsOf(t).item === 'shell', 'switched to shells it drops its ore');
    step(s, 3);
    ok(t.stock === 0 && !ad.hand && !ao.hand && s.diag().get('f' + ad.id)?.missing.join() === 'something to take', `the ore arms stop: nothing they could take is any use now (${why(s, 'f' + ad.id)})`);
    const k = freeRay(s, T, 2);
    s.factory.placeCrate(...go(T, k, 2), 'shell', 999); arm(s, go(T, k), k + 3);
    let shells = 0;
    for (let i = 0; i < 60; i++) { step(s, 1); if (t.stock > 0) { shells++; t.stock = 0; } }
    ok(shells >= 30, `a shell arm from another side feeds it (${shells} shells in 60 s)`);
  }
  {
    // two pipe tunnel crossings back to back (A ... B C ... D): A pairs with B and C with D, not B with C
    const s = fac(), c = open(s, 3), P = (n: number) => go(go(c, 3, 3), 0, n);
    const ts = [0, 3, 4, 7].map((n) => s.buildFac('ptunnel', ...P(n))!);
    s.factory.sync();
    ok(ts.every((x) => !!x) && ts[0].pair === ts[1].id && ts[2].pair === ts[3].id && ts.every((x) => x.net === ts[0].net), 'back-to-back pipe tunnel crossings pair up as two crossings on one network');
  }
  {
    // a ring of belts carries coal round to an arm into a generator
    const s = fac(), c = open(s, 3), R = [0, 1, 2, 3, 4, 5].map((d) => go(c, d));
    R.forEach((p, i) => s.buildFac('belt', p[0], p[1], dirTo(p, R[(i + 1) % 6])));
    const ga = arm(s, go(c, 0, 2), 0), g = s.buildFac('generator', ...go(c, 0, 3))!; s.factory.placeCrate(...go(c, 3, 3), 'coal', 999); arm(s, go(c, 3, 2), 0);
    const diag = s.diag().get('f' + g.id)?.ok;
    step(s, 30);
    ok(!!ga && diag === true && (g.inv.coal || 0) === 2, `a belt ring carries coal to the generator's arm (diagnosis ${diag}, ${g.inv.coal} coal)`);
  }
  {
    // two Firewall Pylons on one pipe network, burning faster than the pumpjack pumps: they share the crude evenly
    const s = fac(), c = open(s, 3), L = go(c, 3, 3);
    lay(s, L, 'oil');
    const pump = s.buildFac('pump', ...L)!, gen = s.buildFac('generator', ...go(L, 1))!;
    for (const n of [1, 2]) s.buildFac('pipe', ...go(L, 0, n));
    const ps = [1, 2].map((n) => s.build('flame', ...go(go(L, 0, n), 5))!), got = [0, 0];
    for (let i = 0; i < 60 * 60; i++) {
      gen.inv.coal = 2; const was = ps.map((p) => p.tank); step(s, 1 / 60);
      ps.forEach((p, k) => { got[k] += Math.max(0, p.tank - was[k]); p.tank = Math.max(0, p.tank - 1.5 / 60); }); // each burns 1.5 crude a second
    }
    ok(!!pump && got[0] > 40 && Math.abs(got[0] - got[1]) < got[0] * 0.05, `two pylons on one network share the crude (${got.map((x) => x.toFixed(0)).join(' and ')} in 60 s)`);
  }
  {
    // time stands still between waves: no mining, no belts, no arms, no towers; the wave timer still runs
    const s = fac(); live(s, false);
    const c = open(s, 3), M = go(c, 3, 2), B = go(c, 0, 2);
    lay(s, M, 'iron_ore');
    const t = s.build('pulse', c[0], c[1])!, mine = s.buildFac('mine', M[0], M[1])!, am = arm(s, go(c, 3), 0), belt = s.buildFac('belt', B[0], B[1], 0)!, ab = arm(s, go(c, 0), 3);
    belt.items.push({ it: 'iron_ore', p: 0.2 }); t.charge = 0.5; s.nextWaveIn = 30;
    am.prog = 0.25; // (on its way back, empty-handed)
    const t0 = s.time;
    ok(s.planning && s.wave === 0, 'before the first wave the game is planning');
    step(s, 10);
    ok(Math.abs(s.time - t0 - 10) < 1e-6 && Math.abs(s.nextWaveIn - 20) < 1e-6, `Sim.time and the wave timer run (${s.nextWaveIn.toFixed(2)} s to the wave)`);
    ok(mine.prog === 0 && !mine.out.length && belt.items.length === 1 && belt.items[0].p === 0.2 && t.stock === 0 && t.charge === 0.5 && s.factory.delivered === 0 && am.prog === 0.25 && !am.hand && !ab.hand,
      'but nothing is mined, nothing moves on the belt, the arm stands still mid-swing, the turret gets nothing and its special does not charge');
    ok(s.diag().get('t' + t.id)?.ok === true && s.diag().get('t' + t.id)!.from.includes('Mine (by arm)'), 'while the diagnosis already sees that the mine will feed it');
    s.startWave();
    ok(!s.planning && s.queue.length > 0, 'calling the wave ends the planning');
    step(s, MINE_TIME + 0.5);
    ok(mine.prog > 0 || mine.out.length > 0 || s.factory.delivered > 0, 'the first frames of the wave run the factory');
    ok(t.stock + t.ammo > 0 && !belt.items.length, 'the arms swing again and the turret takes the item off the belt');
    s.autoWaves = false; s.queue.length = 0; s.enemies.length = 0; const evs: Ev[] = [];
    step(s, 0.1, evs);
    ok(s.planning && s.cleared && evs.some((e) => e.k === 'clear'), 'the wave is cleared (its bonus paid) and time stands still again');
    const snap = JSON.stringify([mine.prog, mine.out, t.stock, t.ammo, t.charge, s.factory.delivered, am.prog, am.hand, ab.prog, ab.hand]);
    step(s, 8);
    ok(JSON.stringify([mine.prog, mine.out, t.stock, t.ammo, t.charge, s.factory.delivered, am.prog, am.hand, ab.prog, ab.hand]) === snap, 'between waves the factory, its arms and the towers are frozen');
    // a new layout is seen at once while time stands still
    const B2 = go(c, 1), cr = s.build('cryo', ...go(c, 1, 2))!;
    ok(!!cr && s.diag().get('t' + cr.id)?.missing.join() === 'power', 'a tower built between waves is diagnosed at once');
    const g = s.buildFac('generator', B2[0], B2[1])!;
    ok(!!g && (s.factory.sync(), s.factory.powerNets[g.net].potential) === 10 && s.factory.powerNets[g.net].full === TOWERS.cryo.needs.power, 'and the grid shows its potential and full demand without running');
  }
  {
    // diagnose(): what will be supplied, worked out from the layout alone
    const d = (s: Sim, k: string) => s.diag().get(k);
    const s = fac(), c = open(s, 3), S = c, M = go(c, 3, 2), W = go(c, 0, 2), C1 = go(c, 1, 2), G = go(c, 5, 2), C2 = go(c, 4, 2);
    lay(s, M, 'iron_ore'); lay(s, C1, 'coal'); lay(s, C2, 'coal');
    const mine = s.buildFac('mine', M[0], M[1])!, sm = s.buildFac('smelter', S[0], S[1])!; arm(s, go(c, 3), 0);
    ok(d(s, 'f' + sm.id)?.missing.join() === 'coal,a taker for its output' && why(s, 'f' + sm.id) === 'no Transfer Arm brings it coal; no Transfer Arm takes its output' && d(s, 'f' + mine.id)?.ok === true && d(s, 'f' + mine.id)!.from.length === 0, `a smelter with ore but no coal: ${why(s, 'f' + sm.id)}`);
    arm(s, go(c, 0), 0); const w = s.buildFac('works', W[0], W[1])!;
    ok(d(s, 'f' + w.id)?.missing.join() === 'iron plate,power' && d(s, 'f' + sm.id)?.missing.join() === 'coal', `a Frame Works after a smelter without coal: ${why(s, 'f' + w.id)}`);
    s.buildFac('mine', C1[0], C1[1]); arm(s, go(c, 1), 4);
    ok(d(s, 'f' + sm.id)?.ok === true && d(s, 'f' + sm.id)!.from.includes('Mine (by arm)') && d(s, 'f' + w.id)?.missing.join() === 'power' && d(s, 'f' + w.id)!.from.includes('Smelter (by arm)'), 'with coal the smelter is fine, and the works only lacks power');
    const gen = s.buildFac('generator', G[0], G[1])!;
    ok(d(s, 'f' + w.id)?.missing.join() === 'power' && d(s, 'f' + gen.id)?.missing.join() === 'coal' && why(s, 'f' + w.id) === 'its grid has no Generator that gets coal', 'a generator without coal: still no power, and the generator lacks coal');
    s.buildFac('mine', C2[0], C2[1]); arm(s, go(C2, 0), 0); // (coal mine, arm, generator in a row)
    ok(d(s, 'f' + w.id)?.ok === true && d(s, 'f' + w.id)!.from.includes('Generator') && d(s, 'f' + gen.id)?.ok === true, `with an arm from a coal mine into the generator the whole chain is diagnosed ok (${why(s, 'f' + gen.id)})`);
    ok(s.diag() === s.diag(), 'the diagnosis is cached while nothing changes');
    // towers: ore by a belt, a lone mine with no taker, a tower without power, fluid
    const q = fac(), qc = open(q, 3), QM = go(qc, 3, 2), QT = go(qc, 0, 2), QC = go(qc, 2, 3);
    lay(q, QM, 'iron_ore'); lay(q, QC, 'copper_ore');
    const tw = q.build('pulse', QT[0], QT[1])!;
    ok(d(q, 't' + tw.id)?.ok === false && d(q, 't' + tw.id)!.missing.join() === 'iron ore' && why(q, 't' + tw.id) === 'no Transfer Arm brings it iron ore', 'a turret with no supply lacks iron ore');
    q.buildFac('mine', QM[0], QM[1]); arm(q, go(qc, 3), 0); q.buildFac('belt', qc[0], qc[1], 0);
    ok(d(q, 't' + tw.id)?.ok === false && d(q, 'f' + q.factory.facAt(...qc)!.id)?.missing.join() === 'an arm at its end', 'a belt of ore that ends before the turret: the turret lacks it, the belt says it ends without an arm');
    const ta = arm(q, go(qc, 0), 0);
    ok(d(q, 't' + tw.id)?.ok === true && d(q, 't' + tw.id)!.from.join() === 'Mine (by belt)' && d(q, 'f' + ta.id)?.ok === true, `fed by mine > arm > belt > arm it is ok (${d(q, 't' + tw.id)?.from.join()})`);
    const cu = q.buildFac('mine', QC[0], QC[1])!;
    ok(d(q, 'f' + cu.id)?.missing.join() === 'a taker for its output', 'a copper mine nobody takes from lacks a taker');
    // the arm texts
    const lq = fac(), lone = arm(lq, open(lq, 1), 0);
    ok(d(lq, 'f' + lone.id)?.missing.join() === 'a target,something to take' && why(lq, 'f' + lone.id) === 'arm points at nothing; arm has nothing to take', `a lone arm: ${why(lq, 'f' + lone.id)}`);
    step(lq, 0.1);
    ok(lone.state === 'idle' && lq.factory.armNote(lone) === 'arm points at nothing', 'and at run time it stands idle');
    const r = fac(), rc = open(r, 3), cryo = r.build('cryo', rc[0], rc[1])!, pole = r.buildFac('pole', ...go(rc, 0, 3))!;
    ok(d(r, 't' + cryo.id)?.missing.join() === 'power' && d(r, 'f' + pole.id)?.missing.join() === 'a Generator on its grid', 'a Cryo out of reach of any grid lacks power; a pole with no generator says so');
    const am = arm(r, go(rc, 3), 0); lay(r, go(rc, 3, 2), 'coal'); r.buildFac('mine', ...go(rc, 3, 2));
    ok(d(r, 'f' + am.id)?.missing.join() === 'a target' && why(r, 'f' + am.id) === "arm's target takes nothing", `an arm from a coal mine pointing at a Cryo: ${why(r, 'f' + am.id)}`);
    const f = fac(), fc = open(f, 3), FP = go(fc, 3, 2), FG = go(FP, 1), FA = go(FG, 0), FC = go(FG, 0, 2);
    lay(f, FP, 'oil'); lay(f, FC, 'coal');
    const pump = f.buildFac('pump', FP[0], FP[1])!; f.buildFac('pipe', ...go(fc, 3)); f.buildFac('pipe', fc[0], fc[1]); const fl = f.build('flame', ...go(fc, 0))!;
    ok(d(f, 't' + fl.id)?.missing.join() === 'crude oil' && d(f, 'f' + pump.id)?.missing.join() === 'power', 'a pylon on a pipe from an unpowered pumpjack lacks crude oil, the pumpjack power');
    f.buildFac('generator', FG[0], FG[1]); f.buildFac('mine', FC[0], FC[1]); arm(f, FA, 3);
    ok(d(f, 't' + fl.id)?.ok === true && d(f, 't' + fl.id)!.from.join() === 'pipe network with a Pumpjack' && d(f, 'f' + pump.id)?.ok === true, `powered, it is fine: from the pipe network with a Pumpjack (${why(f, 't' + fl.id)} / ${why(f, 'f' + pump.id)})`);
    ok(![...f.diag().keys()].some((k) => { const x = f.factory.facById(+k.slice(1)); return k[0] === 'f' && !!x && x.type === 'pipe'; }), 'pipes have no entry');
    const fr = fac({ free: true }); fr.build('pulse', 3, 5);
    ok(fr.diag().size === 0, 'a free run has no diagnosis');
  }
  {
    // building levels: credits only, faster work, three levels at most (Transfer Arms too)
    const s = fac(), c = open(s, 3);
    lay(s, c, 'iron_ore');
    const mine = s.buildFac('mine', c[0], c[1])!, belt = s.buildFac('belt', ...go(c, 0), 0)!;
    const c1 = s.facUpCost(mine), g0 = s.gold, m0 = s.mats, evs: Ev[] = [];
    s.events.length = 0;
    ok(FAC_LVL_SPEED.join() === '1,1.6,2.3' && FAC_UP_COST.join() === '0.6,1.1' && c1 === Math.round(FACS.mine.cost * 0.6) && s.facUpCost(belt) === 0 && !s.upgradeFac(belt.id) && belt.lvl === 1, `a mine upgrades for ${c1} credits; a belt has no levels`);
    ok(s.upgradeFac(mine.id) && mine.lvl === 2 && s.gold === g0 - c1 && s.mats === m0 && mine.spent === FACS.mine.cost + c1, 'the upgrade costs credits only');
    evs.push(...s.events.splice(0));
    ok(evs.some((e) => e.k === 'build' && e.fac === 1 && e.x === mine.x), 'and says so with a build event');
    const c2 = s.facUpCost(mine);
    ok(c2 === Math.round(FACS.mine.cost * 1.1) && s.upgradeFac(mine.id) && mine.lvl === 3 && s.facUpCost(mine) === 0 && !s.upgradeFac(mine.id) && mine.lvl === 3, `the second step costs ${c2}, then it is at the top`);
    ok(s.facSellValue(mine.id) === Math.round((FACS.mine.cost + c1 + c2) * 0.6), 'selling an upgraded building gives back 60% of all it cost');
    s.gold = 0; const sm = s.buildFac('smelter', ...go(c, 3));
    const sm2 = (s.gold = 1e5, s.buildFac('smelter', ...go(c, 3))!); s.gold = s.facUpCost(sm2) - 1;
    ok(!sm && !s.upgradeFac(sm2.id) && sm2.lvl === 1, 'without the credits nothing is upgraded');
    s.gold = 1e5; s.mods.cheap = 0.9;
    ok(s.facUpCost(sm2) === Math.round(FACS.smelter.cost * 0.6 * 0.9), 'Nano Fabricator makes upgrades cheaper too');
    ok([...FAC_UPGRADABLE].sort().join() === 'arm,cells,generator,mine,missiles,press,pump,refinery,smelter,works', 'arms, mines, pumpjacks, plants and generators have levels');
    // speed: ore per minute at each level, from a mine whose output is cleared away
    const rate = (lvl: number) => { const q = fac(), qc = open(q, 1); lay(q, qc, 'iron_ore'); const m = q.buildFac('mine', qc[0], qc[1])!; m.lvl = lvl; let n = 0; for (let i = 0; i < 60; i++) { step(q, 1); n += m.out.splice(0).length; } return n; };
    const r = [1, 2, 3].map(rate);
    ok(r.every((n, i) => Math.abs(n - (60 / MINE_TIME) * FAC_LVL_SPEED[i]) <= 1.5) && MINE_TIME === 3, `a mine digs ${r.join(', ')} ore a minute at levels 1, 2, 3`);
    // an arm moves one item per ARM_TIME / speed: from a crate onto a belt whose items are cleared away
    const arate = (lvl: number) => { const q = fac(), qc = open(q, 2); q.factory.placeCrate(...go(qc, 3), 'coal', 9999); const a = arm(q, qc, 0), b = q.buildFac('belt', ...go(qc, 0), 0)!; a.lvl = lvl; let n = 0; for (let i = 0; i < 60 * 60; i++) { step(q, 1 / 60); n += b.items.length; b.items.length = 0; } return n; };
    const ar = [1, 2, 3].map(arate);
    ok(ARM_TIME === 0.8 && ar.every((n, i) => Math.abs(n - (60 / ARM_TIME) * FAC_LVL_SPEED[i]) <= 2), `an arm moves ${ar.join(', ')} items a minute at levels 1, 2, 3 (${60 / ARM_TIME} at Mk1)`);
    const ua = arm(s, ...((): [[number, number], number] => { const p = freeNear(s, c[0], c[1], 3); return [p, 0]; })());
    const uc = Math.round(FACS.arm.cost * 0.6 * 0.9);
    ok(s.facUpCost(ua) === uc && s.upgradeFac(ua.id) && ua.lvl === 2 && s.facSellValue(ua.id) === ua.spent - uc + Math.round(uc * 0.6), 'an arm upgrades like the rest, and sells for its price plus 60% of the upgrade (logistics)');
    // a generator's level raises its power
    const g = fac(), gc = open(g, 1), gen = g.buildFac('generator', gc[0], gc[1])!;
    g.factory.sync(); const p1 = g.factory.powerNets[gen.net].potential;
    g.upgradeFac(gen.id); g.factory.sync(); const p2 = g.factory.powerNets[gen.net].potential;
    ok(p1 === 10 && Math.abs(p2 - 16) < 1e-9, `a level-2 generator gives more power (${p1} to ${p2})`);
  }
  {
    // towers keep one item waiting, and one level-1 mine with one arm keeps a Pulse Turret firing
    ok(TOWER_STOCK === 1 && ITEM_SHOTS.iron_ore === 9 && ITEM_SHOTS.missile === 1 && TOWER_TANK === 12 && BELT_SPEED === 0.7 && PUMP_RATE === 2 && PICK_AT === 0.3 && DROP_AT === 0.5, 'tower stock 1, 9 shots an iron ore, one salvo a missile pack, a small tank, slow belts, the arm pick and drop points');
    const s = fac(), t = s.build('pulse', 3, 5)!, k = freeRay(s, [3, 5], 2), F = go([3, 5], k, 2);
    lay(s, F, 'iron_ore'); s.buildFac('mine', F[0], F[1]); arm(s, go([3, 5], k), k + 3); foe(s, 10);
    const evs: Ev[] = []; step(s, 60, evs);
    const n = shotsOf(evs, t.id), full = s.towerRate(t) * 60;
    ok(n > full * 0.8 && n <= full + 1 && t.stock <= TOWER_STOCK, `mine > arm > turret keeps a Pulse Turret near its full rate (${n} of ${full.toFixed(0)} shots in 60 s)`);
    // a belt moves 0.7 tiles a second, Express Belts 40% more per stack
    const b = fac(), bc = open(b, 1), bl = b.buildFac('belt', bc[0], bc[1], 0)!;
    bl.items.push({ it: 'coal', p: 0 }); step(b, 1);
    const p1 = bl.items[0].p; bl.items[0].p = 0; b.players[0].pending = [['f_belt']]; b.pickCard(0, 0); step(b, 1);
    ok(Math.abs(p1 - BELT_SPEED) < 0.02 && Math.abs(bl.items[0].p - BELT_SPEED * 1.4) < 0.02 && CARD_BY_ID.f_belt.max === 3, `a belt carries ${p1.toFixed(2)} tiles a second, ${bl.items[0].p.toFixed(2)} with Express Belts`);
  }
  {
    // the second ammunition: a Mk3 Pulse Turret may be switched to plasma shells once Plasma Rounds is taken, a Mk3 Firewall to petrol with Petrol Burners
    const s = fac({}, true), t = s.build('pulse', 3, 5)!, evs0: Ev[] = [];
    t.stock = 1; t.ammo = 5;
    ok(s.upgrade(t.id) && t.lvl === 2 && t.stock === 1 && t.ammo === 5 && needsOf(t).item === 'iron_ore', 'level 2 keeps the ore');
    ok(s.ammo2Block(t.id) === 'Mk3 only' && !s.setAmmo2(t.id, true), 'a Mk2 cannot be switched');
    ok(s.upgrade(t.id) && t.lvl === 3 && t.stock === 1 && t.ammo === 5 && needsOf(t).item === 'iron_ore' && !t.ammo2 && !s.facs.has('press'), 'level 3 keeps the ore too, and unlocks nothing');
    ok(s.ammo2Block(t.id) === 'needs the Plasma Rounds card' && !s.setAmmo2(t.id, true) && !t.ammo2 && AMMO2_CARD.pulse === 'pulse_shells', `without the card it cannot be switched (${s.ammo2Block(t.id)})`);
    s.level = 5; s.grant('belts');
    ok(!s.cardOk(0, CARD_BY_ID.pulse_shells), 'Plasma Rounds is not offered before the Shell Press');
    s.grant('smelter'); s.grant('power'); s.grant('press');
    ok(s.cardOk(0, CARD_BY_ID.pulse_shells), 'with the Shell Press it is');
    s.grant('pulse_shells'); s.events.length = 0;
    ok(s.setAmmo2(t.id, true) && t.ammo2 && t.stock === 0 && t.ammo === 0 && needsOf(t).item === 'shell' && needsOf(t) === TOWER_NEEDS_L3.pulse && s.events.some((e) => e.k === 'ammo' && e.id === t.id && e.on === 1), 'with the card the switch drops the ore and asks for shells (ammo event)');
    ok(s.setAmmo2(t.id, true) && !s.setAmmo2(t.id, 'yes' as unknown as boolean) && !s.setAmmo2(99999, true), 'switching again is a no-op; garbage is refused');
    ok(Math.abs(s.supplyDmg(t) - 1.3) < 1e-9 && Math.abs(s.towerDmg(t) / (TOWERS.pulse.dmg * TUNE.tdmg * 2.6) - 1.3) < 1e-9, 'shells hit 30% harder');
    ok(s.diag().get('t' + t.id)?.missing.join() === 'shell', 'the diagnosis asks for shells');
    for (const f of crates(s)) if (hexDist(f.cx, f.cz, t.cx, t.cz) <= 1) f.left = 0;
    const C = freeNear(s, 3, 5, 1); s.factory.placeCrate(C[0], C[1], 'shell', 2);
    foe(s, 10); const evs: Ev[] = []; step(s, 30, evs);
    ok(shotsOf(evs, t.id) === 2 * 20 && TOWER_NEEDS_L3.pulse!.shots === 20, `two shells from a crate give ${shotsOf(evs, t.id)} shots (20 each)`);
    ok(s.setAmmo2(t.id, false) && !t.ammo2 && needsOf(t).item === 'iron_ore' && Math.abs(s.supplyDmg(t) - 1) < 1e-9, 'it can be switched back to ore');
    evs0.length = 0;
    // the Firewall Pylon Mk3 burns petrol once switched: crude does nothing for it then, a refinery beside it fills it
    const q = fac(), qc = open(q, 2), fl = q.build('flame', qc[0], qc[1])!, P = go(qc, 3), R = go(qc, 0), G = go(qc, 2);
    fl.tank = 8; q.upgrade(fl.id); q.upgrade(fl.id);
    ok(fl.lvl === 3 && fl.tank === 8 && needsOf(fl).fluid === 'crude', 'a Firewall Mk3 still burns crude');
    q.grant('flame_petrol');
    ok(q.setAmmo2(fl.id, true) && fl.tank === 0 && needsOf(fl).fluid === 'petrol' && Math.abs(q.supplyDmg(fl) - 1.35) < 1e-9 && q.diag().get('t' + fl.id)?.missing.join() === 'petrol', 'switched to petrol it drops its crude, needs petrol, and burns 35% hotter');
    lay(q, P, 'oil'); q.buildFac('pump', P[0], P[1]); const gen = q.buildFac('generator', G[0], G[1])!; gen.inv.coal = 2;
    step(q, 5);
    ok(fl.tank === 0, 'crude from a pumpjack beside it does not fill it');
    const ref = q.buildFac('refinery', R[0], R[1])!; ref.tout = 20;
    step(q, 0.5);
    ok(fl.tank === TOWER_TANK && !fl.dry, 'petrol from a refinery beside it does');
    ok(fac({ free: true }).supplyDmg(t) === 1, 'free runs get no ammunition bonus');
    // co-op: the guest sees the switch
    const h = fac({ mode: 'coop', players: 2 }), g2 = fac({ mode: 'coop', players: 2 }); g2.replica = true;
    const ht = h.build('pulse', 3, 5)!; h.upgrade(ht.id); h.upgrade(ht.id); h.grant('pulse_shells'); h.setAmmo2(ht.id, true);
    g2.applySnapshot(JSON.parse(JSON.stringify(h.snapshot([]))));
    ok(g2.towerById(ht.id)?.ammo2 === true && needsOf(g2.towerById(ht.id)!).item === 'shell', 'the switch reaches a co-op guest');
  }
  {
    // the Missile Battery is limited by production: one salvo per missile pack, as fast as the Missile Works builds them
    const s = fac(); s.mats = 20;
    const bat = s.build('missile', 3, 5)!, k = freeRay(s, [3, 5], 2), W = go([3, 5], k, 2);
    const mw = s.buildFac('missiles', W[0], W[1])!; arm(s, go([3, 5], k), k + 3); grid(s, [W, [3, 5]]);
    foe(s, 10);
    let salvos = 0;
    for (let i = 0; i < 100; i++) {
      mw.inv.iron = 2; mw.inv.copper = 2; mw.tin = TANK;
      const evs: Ev[] = []; step(s, 1, evs); salvos += shotsOf(evs, bat.id);
    }
    const made = s.factory.delivered, cap = s.towerRate(bat) * 100;
    ok(!!bat && !!mw && Math.abs(salvos - made) <= 1 && made >= 8 && made <= 100 / MAKES.missiles!.time + 1 && salvos < cap / 4, `the battery fires as often as missiles arrive (${salvos} salvos from ${made} packs in 100 s; its rate would allow ${cap.toFixed(0)})`);
  }
  {
    // Factory.links(): Transfer Arms, crates, pipe stubs and power cables for the view
    const s = fac(), c = open(s, 3), M = go(c, 3, 2), T1 = go(c, 1, 2), T2 = go(c, 0, 3);
    lay(s, M, 'iron_ore');
    const mine = s.buildFac('mine', M[0], M[1])!, a0 = arm(s, go(c, 3), 0), belts = [c, go(c, 0)].map((p) => s.buildFac('belt', p[0], p[1], 0)!);
    const a1 = arm(s, go(c, 1), 1), past = s.build('pulse', T1[0], T1[1])!, a2 = arm(s, go(c, 0, 2), 0), end = s.build('pulse', T2[0], T2[1])!;
    let L = s.factory.links();
    const al = (id: number) => L.find((l) => l.kind === 'arm' && l.from === id);
    const l0 = al(a0.id), l1 = al(a1.id), l2 = al(a2.id);
    ok(!!l0 && l0.src === 'f' + mine.id && l0.to === 'f' + belts[0].id && l0.x === mine.x && l0.z === mine.z && l0.tx === belts[0].x && l0.tiles!.join() === [at(...M), at(...go(c, 3)), at(...c)].join(), 'an arm links from the mine behind it to the belt in front (src, to, tiles)');
    ok(!!l1 && l1.src === 'f' + belts[0].id && l1.to === 't' + past.id && l1.tx === past.x && l1.tz === past.z && !!l2 && l2.src === 'f' + belts[1].id && l2.to === 't' + end.id, 'the arms off the belt link to their turrets');
    ok(!L.some((l) => l.kind === 'belt') && L.filter((l) => l.kind === 'arm').length === 3, 'belts themselves link to nothing');
    ok(s.factory.links() === L, 'links are cached while nothing changes');
    s.setArmFilter(a1.id, 'coal');
    ok(s.factory.links() !== L && s.diag().get('f' + a1.id)?.missing.join() === 'a target', 'a filter change refreshes links and diagnosis');
    const q = fac(), qc = open(q, 3), QP = go(qc, 3, 2), QG = go(QP, 1);
    lay(q, QP, 'oil');
    q.buildFac('pump', QP[0], QP[1]); const gen = q.buildFac('generator', QG[0], QG[1])!; const pipe = q.buildFac('pipe', ...go(qc, 3))!; const fl = q.build('flame', qc[0], qc[1])!;
    const cr = q.build('cryo', ...go(QG, 1))!;
    L = q.factory.links();
    const pl = L.find((l) => l.kind === 'pipe' && l.to === 't' + fl.id), pw = L.find((l) => l.kind === 'power' && l.to === 't' + cr.id), pp = L.find((l) => l.kind === 'power' && l.to.startsWith('f'));
    ok(!!pl && pl.from === pipe.id && pl.x === pipe.x && pl.tx === fl.x, 'a pipe links to the pylon beside it');
    ok(!!pw && pw.from === gen.id && pw.x === gen.x && pw.tx === cr.x && pw.tz === cr.z && !!pp, 'the generator links to the Cryo and the pumpjack it powers');
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
  {
    // every source and destination of a Transfer Arm, in a straight line source > arm > destination; and the same pairs side
    // by side without the arm hand nothing over (the only exception: a supply crate right beside a tower)
    type Src = 'mine' | 'smelter' | 'crate' | 'belt' | 'splitter' | 'exit';
    type Dst = 'tower' | 'smelter' | 'generator' | 'belt' | 'splitter' | 'entrance' | 'arm';
    const SRC: Src[] = ['mine', 'smelter', 'crate', 'belt', 'splitter', 'exit'], DST: Dst[] = ['tower', 'smelter', 'generator', 'belt', 'splitter', 'entrance', 'arm'];
    const wants: Record<Dst, ItemType> = { tower: 'iron_ore', smelter: 'iron_ore', generator: 'coal', belt: 'coal', splitter: 'coal', entrance: 'coal', arm: 'iron_ore' };
    const takesAny = (d: Dst) => d === 'belt' || d === 'splitter' || d === 'entrance';
    let pairs = 0, moved = 0, refused = 0, implicit = 0;
    const fails: string[] = [];
    for (const withArm of [true, false]) for (const src of SRC) for (const dst of DST) {
      if (!withArm && dst === 'arm') continue; // (an arm there would take from the source itself)
      const s = fac(), c = open(s, 3), S = withArm ? go(c, 3) : c, D = withArm ? go(c, 0) : go(c, 0);
      // what the source holds: the item the destination takes, but a smelter only ever gives plates
      const it: ItemType = src === 'smelter' ? 'iron' : wants[dst];
      const fit = src !== 'smelter' || takesAny(dst);
      let sf: Fac | null = null;
      if (src === 'mine') { lay(s, S, it as OreType); sf = s.buildFac('mine', ...S)!; }
      else if (src === 'smelter') { sf = s.buildFac('smelter', ...S)!; sf.out.push('iron', 'iron'); }
      else if (src === 'crate') sf = s.factory.placeCrate(...S, it, 5)!;
      else if (src === 'belt') { sf = s.buildFac('belt', ...S, withArm ? 0 : 0)!; sf.items.push({ it, p: 1 }, { it, p: 0.5 }); }
      else if (src === 'splitter') { sf = s.buildFac('splitter', ...S)!; sf.items.push({ it, p: 0.5 }); }
      else { const e = s.buildFac('tunnel', ...go(S, 3, 2), 0)!; sf = s.buildFac('tunnel', ...S, 0)!; s.factory.sync(); e.items.push({ it, p: 2 }); }
      if (withArm) arm(s, c, 0);
      let probe: () => boolean;
      if (dst === 'tower') { const t = s.build('pulse', ...D)!; probe = () => t.stock > 0; }
      else if (dst === 'smelter') { const f = s.buildFac('smelter', ...D)!; probe = () => (f.inv[it] || 0) > 0; }
      else if (dst === 'generator') { const f = s.buildFac('generator', ...D)!; probe = () => (f.inv[it] || 0) > 0 || f.fuel > 0; }
      else if (dst === 'belt') { const f = s.buildFac('belt', ...D, 0)!; probe = () => f.items.length > 0 || !!s.factory.facAt(...go(D, 0))?.items.length; }
      else if (dst === 'splitter') { const f = s.buildFac('splitter', ...D)!; probe = () => f.items.length > 0; }
      else if (dst === 'entrance') { const f = s.buildFac('tunnel', ...D, 0)!; s.buildFac('tunnel', ...go(D, 0, 2), 0); s.factory.sync(); probe = () => f.items.length > 0; }
      else { arm(s, D, 0); const t = s.build('pulse', ...go(D, 0))!; probe = () => t.stock > 0; }
      step(s, MINE_TIME + 2);
      // (without an arm only the crate beside a tower hands over, and conveyors carry on into the conveyor in front: that is not a hand-off)
      const conv = (src === 'belt' || src === 'splitter' || src === 'exit') && takesAny(dst) && !(src === 'splitter' && dst === 'splitter');
      const got = probe(), want = withArm ? fit : (src === 'crate' && dst === 'tower') || conv;
      pairs++;
      if (got && withArm) moved++; else if (!got && withArm) refused++; else if (got && !withArm && !conv) implicit++;
      if (got !== want) fails.push(`${src} > ${withArm ? 'arm > ' : ''}${dst}: ${got ? 'moved' : 'nothing'}`);
      if (!sf) fails.push(`${src}: not built`);
    }
    ok(!fails.length && moved === 38 && refused === 4 && implicit === 1, `${pairs} source/destination pairs: ${moved} hand over through an arm, ${refused} refuse an item their destination cannot use (plates), ${implicit} side by side without an arm (the crate beside a tower)${fails.length ? ': ' + fails.join('; ') : ''}`);
  }
  {
    // the arm opening on every pre-made map (deposits.ts rule f): each iron ore crate has a straight mine > arm > turret line
    // on its own side of the road, two lines apart somewhere on the map; a run can build them with arms only
    for (const m of MAPS) {
      const al = armLines(m), s = new Sim({ seed: 2, map: m, pauseOnCards: false }), iron = al.spots.map((c, k) => (c.it === 'iron_ore' ? k : -1)).filter((k) => k >= 0);
      const two = al.all.some((a, i) => al.all.some((b, k) => k > i && a.turret.join() !== b.turret.join() && !a.arms.some((x) => x.join() === b.turret.join()) && !b.arms.some((x) => x.join() === a.turret.join()) && !a.arms.some((x) => b.arms.some((y) => x.join() === y.join()))));
      const l = al.crates[iron[0]]?.[0];
      let built = false;
      if (l) { s.buildFac('mine', ...l.mine); for (const a of l.arms) s.buildFac('arm', a[0], a[1], l.dir); const t = s.build('pulse', ...l.turret); built = !!t && s.diag().get('t' + t.id)?.ok === true && s.diag().get('t' + t.id)!.from.includes('Mine (by arm)'); }
      ok(iron.every((k) => al.crates[k].length > 0) && two && built && al.all.every((x) => x.arms.length >= 1 && x.arms.length <= 2), `${m.id}: every iron ore crate has an arm line (${iron.map((k) => al.crates[k].length).join(', ')} lines), two lines apart, and the first one built with the start's buildings is diagnosed fed`);
    }
  }
  {
    // the opening under the real rules (tools/opening.ts): a script with arms only holds the first waves on three maps
    for (const id of ['switchback', 'spiral', 'crossfire']) {
      const r = playOpening(MAPS.find((m) => m.id === id)!, 7, 4);
      ok(!r.over && r.lives[r.lives.length - 1] >= r.maxLives * 0.75 && r.lines >= 2 && r.delivered > 20, `${id}: the arm opening holds waves 1 to 4 (core ${r.lives.join(' > ')}; wave 1 with ${r.first}; ${r.lines} arm lines, ${r.delivered} ore delivered)`);
    }
  }
}
{
  // bug-report state blocks (snapshot.ts): a run saved, packed into text and restored into a fresh Sim goes on exactly like
  // the original, step for step: the same events every step, the same diagnosis and links, the same whole state after
  const { encodeSnapshot, decodeSnapshot, restoreSim, stateHash, extractBlock, SnapError } = await import('../src/game/snapshot.ts');
  const { bigFactory } = await import('./bench.ts');
  const { generateMap } = await import('../src/game/mapgen.ts');
  const dt = 1 / 60;
  const same = async (a: Sim, label: string, M: number, act?: (s: Sim) => void) => {
    a.events.length = 0;
    const text = await encodeSnapshot(a, { build: 'smoke' }), b = restoreSim(await decodeSnapshot(text));
    const h0 = stateHash(a) === stateHash(b);
    if (act) { act(a); act(b); }
    let evOk = true;
    for (let i = 0; i < M; i++) {
      a.step(dt); b.step(dt);
      if (JSON.stringify(a.events) !== JSON.stringify(b.events)) evOk = false;
      a.events.length = 0; b.events.length = 0;
      if (i % 30 === 0) { a.diag(); b.diag(); }
    }
    const dg = JSON.stringify([...a.factory.diagnose()]) === JSON.stringify([...b.factory.diagnose()]) && JSON.stringify(a.factory.links()) === JSON.stringify(b.factory.links());
    ok(h0 && evOk && dg && stateHash(a) === stateHash(b), `state block round trip, ${label}: ${text.length} characters, ${M} steps on (same state at once ${h0}, same events ${evOk}, same diagnosis ${dg}, same state after ${stateHash(a) === stateHash(b)})`);
    return text;
  };
  for (const seed of [7, 13]) {
    const s = bigFactory(seed);
    await same(s, `big factory seed ${seed}, build phase`, 300);
    s.startWave();
    for (let i = 0; i < 60 * 60 && s.enemies.length < 8; i++) { s.step(dt); s.events.length = 0; }
    await same(s, `big factory seed ${seed}, mid-wave (${s.enemies.length} enemies, ${s.factory.facs.reduce((n, f) => n + f.items.length, 0)} belt items)`, 1200);
  }
  {
    // a card offer waiting (the run pauses for it): both pick the same card
    const s = new Sim({ seed: 21, map: MAPS[1], pauseOnCards: true });
    s.startWave();
    for (let i = 0; i < 600; i++) { s.step(dt); s.events.length = 0; }
    (s as unknown as { levelUp(): void }).levelUp(); s.events.length = 0;
    ok(s.paused, 'state block: the run waits for a card pick');
    await same(s, 'a card offer waiting, then picked', 900, (x) => x.pickCard(0, 1));
  }
  {
    // the Titan on the field (a free bot-played run), a generated map, a map of the player's own (saved whole)
    const s = new Sim({ seed: 11, pauseOnCards: false, free: true }), bot = new Bot(s, 0);
    for (let n = 0; s.titan.phase !== 'walk' && n < 60 * 60 * 60; n++) { bot.step(dt); s.step(dt); s.events.length = 0; }
    for (let i = 0; i < 300; i++) { bot.step(dt); s.step(dt); s.events.length = 0; }
    ok(s.titan.phase === 'walk', 'state block: the bot run reaches the Titan');
    await same(s, `Titan walking (wave ${s.wave})`, 1200);
    const g = new Sim({ seed: 5, map: generateMap(42, 3) });
    g.startWave(); for (let i = 0; i < 900; i++) { g.step(dt); g.events.length = 0; }
    const tg = await same(g, 'generated map', 600);
    const own = new Sim({ seed: 5, map: { ...MAPS[2], id: 'custom-mine', name: 'Mine' } });
    const to = await same(own, 'a map of the player\'s own', 120);
    ok((await decodeSnapshot(tg)).m === generateMap(42, 3).id && typeof (await decodeSnapshot(to)).m === 'object', 'state block: a generated map is saved by its id, a map of the player\'s own whole');
  }
  {
    // reading blocks back: from a whole issue body with the block wrapped over lines; and clear errors for broken ones
    const s = bigFactory(3), text = await encodeSnapshot(s);
    const issue = '### What happened\nstuff\n\n### State\n```text\n' + text.replace(/(.{76})/g, '$1\n') + '\n```\n\nthanks\n';
    ok(extractBlock(issue) === text && stateHash(restoreSim(await decodeSnapshot(issue))) === stateHash(s), 'state block: read back from an issue body with the block wrapped over lines');
    const why = async (t: string) => { try { await decodeSnapshot(t); return ''; } catch (e) { return e instanceof SnapError ? e.message : 'not a SnapError: ' + String(e); } };
    const msgs = [await why('nothing here'), await why(text.slice(0, 900)), await why(text.replace('BSR1:', 'BSR9:')), await why(text.slice(0, 40) + '!' + text.slice(41)), await why(text.slice(0, 60) + 'AAAA' + text.slice(64))];
    ok(/no BEATSPIRE state block/.test(msgs[0]) && /truncated/.test(msgs[1]) && /version 9/.test(msgs[2]) && msgs[3] !== '' && msgs[4] !== '' && msgs.every((m) => !m.startsWith('not a')), 'state block: missing, cut off, another version and damaged blocks are refused with a clear message: ' + msgs.map((m) => m.slice(0, 50)).join(' / '));
  }
  {
    // a block is untrusted input: tampered fields are refused with a SnapError (never another error, never a Sim that throws
    // later), the prototype is never touched, and a fake class member (a method named in the block) is ignored
    const { snapshotOf, trialRun } = await import('../src/game/snapshot.ts');
    const s = bigFactory(7); s.startWave();
    for (let i = 0; i < 600; i++) { s.step(dt); s.events.length = 0; }
    const base = JSON.stringify(snapshotOf(s));
    type O = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const cases: [string, (o: O) => void][] = [
      ['a method', (o) => { o.s.step = 5; }], ['a set', (o) => { o.s.unlocked = 3; }], ['the cards', (o) => { o.s.stacks = null; }],
      ['a number', (o) => { o.s.gold = 'x'; }], ['NaN time', (o) => { o.s.time = '#NaN'; }], ['the players', (o) => { o.s.players = []; }],
      ['the modifiers', (o) => { o.s.mods = {}; }], ['an offer', (o) => { o.s.players = [{ pending: [['nope']], kills: 0 }]; }],
      ['a tower type', (o) => { o.T.k.type = 'bogus'; delete o.T.v.type; }], ['an enemy type', (o) => { o.E.k.type = 'xx'; delete o.E.v.type; }],
      ['a building type', (o) => { o.F.f.k.type = 'zz'; delete o.F.f.v.type; }], ['an inventory', (o) => { o.F.f.k.inv = null; delete o.F.f.v.inv; }],
      ['a wall', (o) => { o.W[0] = null; }], ['a power grid', (o) => { o.F.wn[0] = ['a']; }], ['a pipe', (o) => { o.F.pn[0] = [{ a: 1 }, 'x']; }],
      ['a huge queue', (o) => { o.Q = { c: ['t'], k: { t: 1 }, n: 1e6, v: {} }; }], ['players 1e9', (o) => { o.o.players = 1e9; }],
      ['the mode', (o) => { o.o.mode = 'zz'; }], ['the prototype', (o) => { o.s.stacks = JSON.parse('{"__proto__":{"polluted":1}}'); o.s.mods.__proto__ = { polluted: 1 }; }],
    ];
    const bad: string[] = [];
    for (const [label, mut] of cases) {
      const o = JSON.parse(base); mut(o);
      try { const b = restoreSim(o); if (label !== 'a method' && label !== 'the prototype') bad.push(label + ' loaded'); trialRun(o, 120); for (let i = 0; i < 120; i++) { b.step(dt); b.events.length = 0; } }
      catch (e) { if (!(e instanceof SnapError)) bad.push(`${label}: ${String(e).slice(0, 60)}`); }
    }
    ok(!bad.length && ({} as Record<string, unknown>).polluted === undefined, 'state block: tampered blocks are refused with a clear message or load harmlessly' + (bad.length ? ': ' + bad.join('; ') : ''));
  }
}
// ---------- mid-run saves (src/game/saves.ts, src/platform): save in the build phase, reload, carry on exactly ----------
{
  const { Saves, saveKey, canSave, atBuildPhase, autoStartsIn, SAVES_MAX, SAVE_V } = await import('../src/game/saves.ts');
  const { MemoryStorage, StorageFullError } = await import('../src/platform/core.ts');
  const { WebStorage, NS } = await import('../src/platform/web.ts');
  const { stateHash } = await import('../src/game/snapshot.ts');
  const { RunTracker } = await import('../src/game/records.ts');
  const def = MAPS.find((m) => m.id === 'switchback')!, N = 7, K = 3, key = saveKey('switchback', 'normal', 'campaign');
  // A: the scripted opener, N waves without a break (the state hash after each wave)
  const hashA: string[] = [];
  const A = playOpening(def, 101, N, 'normal', (x) => { hashA.push(stateHash(x)); });
  // B: the same K waves, saved through the platform storage the way the game saves, loaded back
  const store = new MemoryStorage(), saves = new Saves(store);
  let atK: Sim | null = null;
  playOpening(def, 101, K, 'normal', (x, w) => { if (w === K) atK = x; });
  const kSim = atK! as Sim, tr = new RunTracker(kSim);
  ok(canSave(kSim) && atBuildPhase(kSim), 'save: a solo run stands in its build phase after a wave');
  const meta = await saves.put(kSim, { now: 5000, acc: tr.stats });
  ok(!!meta && meta.wave === K && meta.lives === kSim.lives && meta.credits === Math.floor(kSim.gold) && meta.key === key && meta.mode === 'campaign', 'save: written with its metadata ' + JSON.stringify(meta && { wave: meta.wave, lives: meta.lives, credits: meta.credits }));
  const raw = (await store.get(key)) || '';
  const loaded = await saves.load(key, { hold: false });
  ok(!('error' in loaded) && stateHash(loaded.sim) === hashA[K - 1] && loaded.entry.acc?.v === 1, `save: ${raw.length} characters, loads back to the same state as the run after wave ${K}`);
  // ... and continued in place of the original: the same state after every later wave and the same outcome
  const hashB: string[] = [];
  const B = playOpening(def, 101, N, 'normal', (x, w) => { const y = w === K && !('error' in loaded) ? loaded.sim : x; hashB.push(stateHash(y)); return y; });
  ok(hashA.length === N && JSON.stringify(hashA) === JSON.stringify(hashB) && JSON.stringify(A) === JSON.stringify(B), `save: continued after wave ${K}, waves ${K + 1}..${N} end in the same state and the same outcome as the run without a break (core ${B.lives.join(' > ')})`);
  // never mid-wave, never a run that does not count
  const mid = new Sim({ seed: 4, map: def, pauseOnCards: false }); mid.startWave(); for (let i = 0; i < 120; i++) { mid.step(1 / 60); mid.events.length = 0; }
  ok(!atBuildPhase(mid) && (await saves.put(mid)) === null, 'save: refused during a wave');
  const coop = new Sim({ mode: 'coop', players: 2, seed: 4, map: def }), free = new Sim({ seed: 4, map: def, free: true }), solo = new Sim({ seed: 4, map: def });
  ok(!canSave(coop) && !canSave(free) && !canSave(solo, { bot: true }) && !canSave(solo, { attract: true }) && canSave(solo), 'save: co-op, free, bot and attract runs never save');
  ok((await saves.put(free)) === null && (await saves.put(solo, { ctx: { bot: true } })) === null, 'save: put() refuses runs that do not count');
  solo.autoWaves = true; solo.holdFirst = false; solo.nextWaveIn = 0.01;
  ok(autoStartsIn(solo, 1 / 60) && !autoStartsIn(solo, 0.001), 'save: the step that starts an auto wave is seen coming');
  // list, last, clear, the newest first, at most SAVES_MAX
  const s2 = new Sim({ seed: 9, map: MAPS[1], diff: 'hard' });
  await saves.put(s2, { now: 9000 });
  const list = await saves.list();
  ok(list.length === 2 && list[0].map === MAPS[1].id && (await saves.last())?.diff === 'hard' && !('block' in list[0]), 'save: list() newest first without blocks, last() for Continue');
  ok(await saves.has('switchback', 'normal', 'campaign'), 'save: has() for the map picker');
  for (let i = 0; i < SAVES_MAX + 3; i++) await saves.put(solo, { map: 'm' + i, now: 10000 + i });
  const after = await saves.list();
  ok(after.length === SAVES_MAX && after[0].map === 'm' + (SAVES_MAX + 2) && !after.some((x) => x.map === 'switchback'), `save: at most ${SAVES_MAX} kept, the oldest dropped`);
  await saves.clearAll();
  ok((await saves.list()).length === 0, 'save: clearAll');
  // a corrupt or foreign save is dropped with a message, never thrown
  const st2 = new MemoryStorage(), sv2 = new Saves(st2);
  const good = JSON.parse(raw);
  await st2.set('save:a|normal|campaign', '{not json');
  await st2.set('save:b|normal|campaign', JSON.stringify({ ...good, v: SAVE_V + 1 }));
  await st2.set('save:c|normal|campaign', JSON.stringify({ ...good, snap: 99 }));
  await st2.set('save:d|normal|campaign', JSON.stringify({ ...good, block: good.block.slice(0, 200) + 'AAAA' + good.block.slice(204) }));
  await st2.set('save:e|normal|campaign', JSON.stringify({ ...good, block: 'BSR1:zz.' }));
  let threw = '';
  const res: string[] = [];
  try { for (const k of ['save:a|normal|campaign', 'save:b|normal|campaign', 'save:c|normal|campaign', 'save:d|normal|campaign', 'save:e|normal|campaign']) { const r = await sv2.load(k); res.push('error' in r ? r.error : 'LOADED'); } } catch (e) { threw = String(e); }
  ok(!threw && res.every((m) => m !== 'LOADED' && m.length > 10) && JSON.stringify(await st2.keys('save:')) === JSON.stringify(['save:b|normal|campaign', 'save:c|normal|campaign']) && sv2.dropped.length === 3 && /newer/.test(res[1]) && /newer/.test(res[2]), 'save: corrupt and truncated saves are dropped with a message, a newer build\'s save is refused but kept: ' + (threw || res.map((m) => m.slice(0, 50)).join(' / ')));
  // an old-format save (an older build wrote it) is dropped; a block that is not the run its key names is refused
  await st2.set('save:f|normal|campaign', JSON.stringify({ ...good, v: 0 }));
  await st2.set('save:g|normal|campaign', JSON.stringify({ ...good, diff: 'hard' }));
  const rf = await sv2.load('save:f|normal|campaign'), rg = await sv2.load('save:g|normal|campaign');
  ok('error' in rf && 'error' in rg && /match/.test(rg.error) && !(await st2.keys('save:')).some((k) => k.startsWith('save:f') || k.startsWith('save:g')), 'save: an old format is dropped, a save whose block is another difficulty is refused: ' + ('error' in rg ? rg.error : 'LOADED'));
  // the web adapter: namespace, sorted keys, size guard, and a full quota drops the oldest archive entries first
  const mem = new Map<string, string>(); let cap = 4000;
  const fake = {
    get length() { return mem.size; }, key: (i: number) => [...mem.keys()][i] ?? null, getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { const used = [...mem].reduce((n, [a, b]) => n + (a === k ? 0 : a.length + b.length), 0); if (used + k.length + v.length > cap) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(),
  } as unknown as Storage;
  const ws = new WebStorage(fake);
  mem.set('beatspire', '{"v":2}');
  for (let i = 0; i < 6; i++) await ws.set('run:' + String(i).padStart(4, '0'), 'x'.repeat(400));
  await ws.set('ach:state', '{}');
  ok([...mem.keys()].filter((k) => k.startsWith(NS)).length === 7 && mem.has('beatspire') && JSON.stringify(await ws.keys('run:')) === JSON.stringify(['run:0000', 'run:0001', 'run:0002', 'run:0003', 'run:0004', 'run:0005']), 'web storage: namespaced keys, sorted, the old progress key untouched');
  await ws.set('save:big', 'y'.repeat(1800));
  ok(mem.has(NS + 'save:big') && !mem.has(NS + 'run:0000') && mem.has(NS + 'run:0005') && mem.has(NS + 'ach:state'), 'web storage: a full quota drops the oldest runs first, keeps the rest: ' + (await ws.keys('run:')).join(','));
  cap = 100;
  let full = '';
  try { await ws.set('save:huge', 'z'.repeat(5000)); } catch (e) { full = e instanceof StorageFullError ? 'full' : String(e); }
  let big = '';
  try { await ws.set('x', 'q'.repeat(2_000_000)); } catch (e) { big = e instanceof StorageFullError ? 'big' : String(e); }
  ok(full === 'full' && big === 'big' && mem.has(NS + 'ach:state'), 'web storage: too big or still full rejects with StorageFullError, saves and achievements are never dropped');
  const broken = new WebStorage({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); }, key() { throw new Error('blocked'); }, get length() { throw new Error('blocked'); } } as unknown as Storage);
  let bthrew = '';
  try { await broken.get('a'); await broken.remove('a'); await broken.keys(''); } catch (e) { bthrew = String(e); }
  ok(!bthrew, 'web storage: blocked site data reads as empty');
  console.log(`saves: switchback seed 101, saved after wave ${K} (${raw.length} characters), reloaded and played on to wave ${N}: same state hash after every wave, same outcome (core ${B.lives.join(' > ')})`);
}
console.log(fail ? `${fail} FAILED` : 'all smoke checks passed');
process.exit(fail ? 1 : 0);
