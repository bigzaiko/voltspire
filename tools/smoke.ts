// Quick headless checks: node tools/smoke.ts
import { Sim, standY, nodePos, weakPos, raySphere, NODE_R, ARROW_PAD, TOWER_H, DECK_GAP, MUST_EVENTS, SNAP_EVENTS_MAX } from '../src/game/sim.ts';
import type { Ev, Enemy } from '../src/game/sim.ts';
import { ENEMIES, ENEMY_SCALE, TOWERS, TOWER_TYPES, MAX_ENERGY, CARDS, CARD_BY_ID, GW, GH, SIEGE_TICK, SIEGE_SHARE, TWIN_BOLT, TUNE, COOP_HP, coopScale } from '../src/game/data.ts';
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
  const kinds = new Set<string>(); let sawMissile = false, sawGy = false, sawDown = false, sawCharge = false, same = true;
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
    }
  }
  ok(same, 'replica matches the host on charge/down/spec, enemy height, preview, winWave');
  ok(c2.winWave === 30, 'winWave replicated from the host difficulty');
  ok(sawMissile && sawDown && sawCharge, `replica saw missiles, charging and offline towers (${sawMissile} ${sawDown} ${sawCharge})`);
  ok(sawGy, `replica saw raised enemies (map ${raised.id}, host max height ${hostGy})`);
  ok(kinds.has('special') && kinds.has('down') && kinds.has('flame'), 'new events reach the replica: ' + [...kinds].join(','));
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
for (const v of [NaN, -1, 1e9, 2.5]) { host.build('pulse', v, v); host.upgrade(v); host.sell(v); host.pickCard(1, v); host.activateHero(1, v); host.heroTeleport(1, v); host.heroFire(1, v, v, v); host.heroSkill(1, v, v, v, v); }
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
    const T = Math.hypot(w.x - o.x, w.y - o.y, w.z - o.z) / 85;
    s.heroFire(0, w.x + Math.sin(boss.yaw) * boss.speed * T, w.y, w.z + Math.cos(boss.yaw) * boss.speed * T);
  });
  const crit = evs.find((e) => e.k === 'crit');
  ok(!!crit && crit.n >= base * ENEMIES.boss.weak![1].mul * 0.99, `weak-point hit crits (${crit?.n} vs ${base} per arrow)`);
  ok(ENEMY_SCALE.boss === 1.25 && weakPos(boss, 5, V) === null && weakPos(boss, 0, V)!.y > boss.gy + 2, 'weak point lookup');
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
  for (const k of ['flame', 'lance', 'gravity', 'special', 'down', 'up']) ok(seen.has(k), 'event ' + k);
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
    // a strong burn is not kept alive by a weaker projector
    const s = mk(), a = s.build('flame', 3, 5)!, b = s.build('flame', 4, 5)!; a.lvl = 3;
    const e = put(s, 'grunt', 10);
    const weak = s.towerDmg(b) * 1.6;
    a.charge = 1; ok(s.triggerSpecial(a.id, 0), 'Inferno fires');
    run(s, 3); const hot = e.burnD;
    run(s, 3); ok(s.sell(a.id), 'strong projector removed');
    run(s, 6);
    ok(hot > weak * 3 && Math.abs(e.burnD - weak) < 1e-6 && e.burnT > 0, `burn falls back to the weaker projector's strength (${hot.toFixed(1)} -> ${e.burnD.toFixed(1)}, weak ${weak.toFixed(1)})`);
    run(s, 0.1); s.sell(b.id); run(s, 5);
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
    // a Colossus at the core batters it blow by blow instead of taking half the core at once
    const s = mk(); const len = s.map.lanes[0].len;
    const budget = Math.min(ENEMIES.boss.leak, Math.ceil(s.maxLives * SIEGE_SHARE));
    const boss = put(s, 'boss', len - 0.2, 0, 1.3);
    const start = s.lives; let siege = 0, leaks = 0;
    const each = (evs: Ev[]) => { for (const e of evs) { if (e.k === 'siege') siege++; if (e.k === 'leak') { leaks++; ok(e.n === 1 && e.boss === 1, 'siege leaks are one integrity each'); } } };
    run(s, 0.5, each);
    ok(siege === 1 && boss.siege === budget && s.lives === start && boss.alive, 'the Colossus reaches the core without an instant loss');
    run(s, SIEGE_TICK * 3 + 0.1, each);
    ok(s.lives === start - 3 && leaks === 3, `it takes one integrity per blow (${start - s.lives} after three ticks)`);
    s.damage(boss, 1e12, -1, true); run(s, 5, each);
    ok(!boss.alive && s.lives === start - 3, 'destroying it at the core stops the loss');
    const b2 = put(s, 'boss', len - 0.2, 0, 1.3); run(s, SIEGE_TICK * (budget + 2), each);
    ok(!s.enemies.includes(b2) && s.lives === start - 3 - budget && !s.over, `a spent Colossus has taken ${budget} of ${s.maxLives}, never more`);
    ok(new Sim({ diff: 'hard', map: bare }).maxLives === 12 && Math.ceil(12 * SIEGE_SHARE) === 5, 'siege budget on Nightmare');
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
    for (const k of ['heroOn', 'special', 'down', 'up', 'card', 'levelup', 'boss', 'tele', 'leak', 'siege']) flood.push({ k, p: 1, id: 1 });
    for (let i = 0; i < 100; i++) flood.push({ k: 'boom', x: i, y: 0, z: 0, r: 1, c: 1 });
    const snap = JSON.parse(JSON.stringify(h.snapshot(flood)));
    const ks = snap.ev.map((e: Ev) => e.k);
    ok(['heroOff', 'wave', 'heroOn', 'special', 'down', 'up', 'card', 'levelup', 'boss', 'tele', 'leak', 'siege'].every((k) => ks.includes(k) && MUST_EVENTS.has(k)), 'state events are never dropped from a snapshot');
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
}

// survival keeps going past the campaign's final wave
const sv = new Sim({ pauseOnCards: false, seed: 9, survival: true, diff: 'easy' }); const b3 = new Bot(sv, 0, 2);
for (let i = 0; i < 60 * 1500 && !sv.over; i++) { b3.step(1 / 60); sv.step(1 / 60); sv.events.length = 0; }
ok(!sv.won, 'survival never "wins"'); console.log('survival reached wave', sv.wave);
console.log(fail ? `${fail} FAILED` : 'all smoke checks passed');
process.exit(fail ? 1 : 0);
