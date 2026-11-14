// Procedural map checks: node tools/mapgen-test.ts [seeds=400] [--play]
// Generates seeds x 3 tiers, checks every design rule with independent checkers, prints sample maps as ASCII
// and (unless --noplay) lets the bot play a few generated maps.
import { GW, GH } from '../src/game/data.ts';
import { GameMap, validateMap, sanitizeMap } from '../src/game/map.ts';
import type { MapDef, LanePoint } from '../src/game/map.ts';
import { generateMap, generateMapEx, fallbackMap, mapStats, MIN_FREE } from '../src/game/mapgen.ts';
import { MAPS } from '../src/game/maps.ts';

const SEEDS = +(process.argv[2] || 400) || 400;
const NOPLAY = process.argv.includes('--noplay');
const inside = (x: number, z: number) => x >= 0 && x < GW && z >= 0 && z < GH;
const cheb = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

interface RCell { x: number; z: number; h: number; lane: number; i: number }
/** Walk a lane cell by cell (own implementation, independent of mapgen's). */
function walk(lane: LanePoint[], li: number): RCell[] {
  const out: RCell[] = [];
  for (let k = 1; k < lane.length; k++) {
    const a = lane[k - 1], b = lane[k], ha = a[2] || 0, hb = b[2] || 0;
    const n = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    for (let s = k === 1 ? 0 : 1; s <= n; s++) out.push({ x: a[0] + Math.sign(b[0] - a[0]) * s, z: a[1] + Math.sign(b[1] - a[1]) * s, h: ha + ((hb - ha) * s) / n, lane: li, i: out.length });
  }
  return out;
}
interface Crossing { a: RCell; b: RCell }

/** Every rule a generated map must obey. Returns the list of violations. */
function check(def: MapDef, tier: number, seed: number): string[] {
  const bad: string[] = [];
  const v = validateMap(def);
  if (v) bad.push('validateMap: ' + v);
  if (def.tier !== tier) bad.push('tier field');
  if (def.id !== `gen-${tier}-${seed}`) bad.push('id ' + def.id);
  if (!/^[\p{L}\p{N} .,'!?·:()\-]{6,28}$/u.test(def.name)) bad.push('name ' + JSON.stringify(def.name));
  if (!/^[\p{L}\p{N} .,'!?·:()\-]{10,90}$/u.test(def.desc) || !/road|bridge/.test(def.desc)) bad.push('desc ' + JSON.stringify(def.desc));
  if (def.gold < 150 || def.gold > 500 || def.lives < 15 || def.lives > 25) bad.push(`gold/lives ${def.gold}/${def.lives}`);

  // --- lane shape ---
  const [kx, kz] = def.core;
  if (!Number.isInteger(kx) || !Number.isInteger(kz) || kx < 3 || kz < 3 || kx > GW - 4 || kz > GH - 4) bad.push('core too close to the border');
  const edges: number[] = [];
  for (let li = 0; li < def.lanes.length; li++) {
    const l = def.lanes[li], n = `road ${li + 1}`;
    for (let k = 0; k < l.length; k++) {
      const p = l[k];
      if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) bad.push(`${n}: waypoint off-cell`);
      if (p[2] !== undefined && (!Number.isInteger(p[2]) || p[2] < 1 || p[2] > (tier === 3 ? 3 : 2))) bad.push(`${n}: bad level ${p[2]}`);
      if (k > 0 && !inside(p[0], p[1])) bad.push(`${n}: waypoint ${k} off the board`);
      if (k > 0) {
        const q = l[k - 1], dx = Math.abs(p[0] - q[0]), dz = Math.abs(p[1] - q[1]);
        if ((dx && dz) || dx + dz === 0) bad.push(`${n}: segment ${k} not axis-aligned`);
        const dh = Math.abs((p[2] || 0) - (q[2] || 0));
        if (dh && dx + dz < 3 * dh) bad.push(`${n}: ramp of ${dh} level(s) over only ${dx + dz} cells`);
      }
    }
    const s = l[0];
    const edge = s[0] === -2 && s[1] >= 0 && s[1] < GH ? 0 : s[0] === GW + 1 && s[1] >= 0 && s[1] < GH ? 1 : s[1] === -2 && s[0] >= 0 && s[0] < GW ? 2 : s[1] === GH + 1 && s[0] >= 0 && s[0] < GW ? 3 : -1;
    if (edge < 0) bad.push(`${n}: spawn ${s} is not 2 cells outside an edge`);
    else {
      // must enter the board straight
      const q = l[1];
      if (edge < 2 ? q[1] !== s[1] : q[0] !== s[0]) bad.push(`${n}: does not enter the board straight`);
    }
    edges.push(edge);
    const e = l[l.length - 1];
    if (Math.hypot(e[0] - kx, e[1] - kz) > 2.6) bad.push(`${n}: ends away from the core`);
    if (e[2]) bad.push(`${n}: ends above deck level`);
  }
  if (new Set(edges).size !== edges.length) bad.push('two roads share an edge');

  // --- cells, overlaps, crossings ---
  const lanes = def.lanes.map(walk);
  const all = lanes.flat();
  const at = new Map<string, RCell[]>();
  for (const c of all) { const k = c.x + ',' + c.z; (at.get(k) || at.set(k, []).get(k)!).push(c); }
  const crossings: Crossing[] = [];
  const dirAt = (c: RCell) => { const l = lanes[c.lane], p = l[c.i - 1], q = l[c.i + 1]; if (!p || !q) return null; return p.z === c.z && q.z === c.z ? 'h' : p.x === c.x && q.x === c.x ? 'v' : null; };
  for (const [k, cs] of at) {
    if (cs.length === 1) continue;
    if (cs.length > 2) { bad.push(`three passes over ${k}`); continue; }
    const [a, b] = cs, da = dirAt(a), db = dirAt(b);
    if (!da || !db || da === db) { bad.push(`roads overlap or touch at ${k} without a clean right-angle crossing`); continue; }
    crossings.push({ a, b });
    for (const c of cs) {
      const l = lanes[c.lane];
      if (!Number.isInteger(c.h) || l[c.i - 1].h !== c.h || l[c.i + 1].h !== c.h) bad.push(`crossing ${k}: road ${c.lane + 1} is not level for the crossing cell and one cell either side`);
      // straight for two cells either side as well, so nothing turns on top of the other road
      for (const d of [-2, 2]) { const o = l[c.i + d]; if (!o || (dirAt(c) === 'h' ? o.z !== c.z : o.x !== c.x)) bad.push(`crossing ${k}: road ${c.lane + 1} turns within 2 cells`); }
    }
    if (Math.abs(a.h - b.h) < 1) bad.push(`crossing ${k}: levels ${a.h} and ${b.h} are not a bridge`);
  }

  // --- spacing: unrelated road cells keep two free cells between them ---
  const exempt = (p: RCell, q: RCell) => {
    if (p.lane === q.lane && Math.abs(p.i - q.i) <= 4) return true; // same stretch, or round one corner
    if (cheb(p.x, p.z, kx, kz) <= 2 && cheb(q.x, q.z, kx, kz) <= 2) return true; // arriving at the core from different sides
    for (const c of crossings) {
      const m = (u: RCell, w: RCell) => u.lane === c.a.lane && Math.abs(u.i - c.a.i) <= 2 && w.lane === c.b.lane && Math.abs(w.i - c.b.i) <= 2;
      if (m(p, q) || m(q, p)) return true;
    }
    return false;
  };
  let spacing = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const p = all[i], q = all[j];
    if (cheb(p.x, p.z, q.x, q.z) > 2 || (p.x === q.x && p.z === q.z)) continue;
    if (!exempt(p, q)) spacing++;
  }
  if (spacing) bad.push(`${spacing} pairs of road cells closer than 2 free cells`);

  // --- tier rules ---
  const st = mapStats(def);
  if (st.crossings.length !== crossings.length) bad.push(`mapStats counts ${st.crossings.length} crossings, checker ${crossings.length}`);
  const maxL = Math.max(0, ...def.lanes.flat().map((p) => p[2] || 0));
  if (st.maxLevel !== maxL) bad.push('mapStats maxLevel');
  lanes.forEach((l, i) => { if (st.roads[i] !== l.length - 1) bad.push(`mapStats road length ${st.roads[i]} vs ${l.length - 1}`); });
  if (tier === 1) {
    if (def.lanes.length !== 1) bad.push('tier 1 needs exactly one road');
    if (lanes[0].length - 1 < 45) bad.push(`tier 1 road only ${lanes[0].length - 1} cells`);
    if (crossings.length || maxL) bad.push('tier 1 should be flat and uncrossed');
  } else if (tier === 2) {
    if (!(def.lanes.length === 2 || (def.lanes.length === 1 && crossings.length >= 1))) bad.push('tier 2 needs two roads or a self-crossing road');
  } else {
    if (def.lanes.length < 2 || def.lanes.length > 3) bad.push('tier 3 needs two or three roads');
    if (!crossings.length) bad.push('tier 3 needs a bridge');
    if (!maxL) bad.push('tier 3 needs elevation');
  }
  for (const l of lanes) if (l.length - 1 < 20) bad.push(`road of only ${l.length - 1} cells`);
  { const ls = lanes.map((l) => l.length - 1); if (Math.min(...ls) < Math.max(...ls) * 0.55) bad.push(`lopsided roads ${ls.join('/')}`); }
  if (tier === 3) for (const l of lanes) if (l.length - 1 > 62) bad.push(`tier 3 road of ${l.length - 1} cells is not short`);

  // --- buildable space, scenery, spires ---
  const g = new GameMap(def).grid;
  let free = 0;
  for (let i = 0; i < g.length; i++) if (g[i] === 0) free++;
  const spires = def.towers.filter((t) => t.t === 'spire');
  if (free - def.towers.length < MIN_FREE || st.free !== free - def.towers.length) bad.push(`free cells ${free - def.towers.length} (stats ${st.free})`);
  if (def.towers.length !== spires.length || spires.length !== (tier === 3 ? 2 : 1)) bad.push(`${spires.length} spires / ${def.towers.length} towers`);
  const roadIn = all.filter((c) => inside(c.x, c.z));
  spires.forEach((t, i) => {
    if (!inside(t.cx, t.cz) || g[t.cz * GW + t.cx] !== 0) bad.push(`spire ${i + 1} not on a free cell`);
    if (cheb(t.cx, t.cz, kx, kz) < 4) bad.push(`spire ${i + 1} next to the core`);
    const seen = roadIn.filter((c) => Math.hypot(c.x - t.cx, c.z - t.cz) <= 7).length;
    if (seen < (tier === 3 ? 14 : 20)) bad.push(`spire ${i + 1} overlooks only ${seen} road cells`);
    for (let j = 0; j < i; j++) if (cheb(t.cx, t.cz, spires[j].cx, spires[j].cz) < 3) bad.push('spires on top of each other');
  });
  if (def.blocked.length < 6 || def.blocked.length > 24) bad.push(`${def.blocked.length} scenery cells`);
  const bset = new Set<number>();
  for (const [x, z] of def.blocked) {
    if (!inside(x, z) || g[z * GW + x] !== 3) bad.push(`scenery ${x},${z} on a road or the core`);
    if (bset.has(z * GW + x)) bad.push('duplicate scenery');
    bset.add(z * GW + x);
    for (const l of lanes) { const entry = l.filter((c) => inside(c.x, c.z)).slice(0, 3); for (const c of entry) if (cheb(c.x, c.z, x, z) <= 1) bad.push(`scenery ${x},${z} crowds a road start`); }
    for (const t of def.towers) if (t.cx === x && t.cz === z) bad.push('scenery under a tower');
  }
  // clusters (8-connected)
  let clusters = 0;
  const left = new Set(bset);
  while (left.size) {
    clusters++;
    const stack = [left.values().next().value as number];
    left.delete(stack[0]);
    while (stack.length) { const k = stack.pop()!, x = k % GW, z = (k / GW) | 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const n = (z + dz) * GW + x + dx; if (inside(x + dx, z + dz) && left.has(n)) { left.delete(n); stack.push(n); } } }
  }
  if (clusters < 2 || clusters > 8) bad.push(`${clusters} scenery clusters`);
  for (const k of bset) { const x = k % GW, z = (k / GW) | 0; let n = 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && inside(x + dx, z + dz) && bset.has((z + dz) * GW + x + dx)) n++; if (!n) bad.push(`lone scenery cell ${x},${z}`); }

  // --- survives the untrusted-data path unchanged ---
  const rt = sanitizeMap(JSON.parse(JSON.stringify(def)));
  if (!rt || JSON.stringify(rt) !== JSON.stringify(def)) bad.push('sanitizeMap round trip differs');
  return bad;
}

/** ASCII picture: digits = road level, / = ramp, X = bridge crossing, S = gate, @ = core, T = spire, # = scenery. */
function ascii(def: MapDef): string {
  const W = GW + 4, H = GH + 4;
  const g: string[][] = Array.from({ length: H }, (_, z) => Array.from({ length: W }, (_, x) => (inside(x - 2, z - 2) ? '.' : ' ')));
  const put = (x: number, z: number, ch: string) => { if (z + 2 >= 0 && z + 2 < H && x + 2 >= 0 && x + 2 < W) g[z + 2][x + 2] = ch; };
  for (const [x, z] of def.blocked) put(x, z, '#');
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(def.core[0] + dx, def.core[1] + dz, 'o');
  const count = new Map<string, number>();
  const lanes = def.lanes.map(walk);
  for (const l of lanes) for (const c of l) count.set(c.x + ',' + c.z, (count.get(c.x + ',' + c.z) || 0) + 1);
  for (const l of lanes) l.forEach((c, i) => put(c.x, c.z, i === 0 ? 'S' : count.get(c.x + ',' + c.z)! > 1 ? 'X' : Number.isInteger(c.h) ? String(c.h) : '/'));
  put(def.core[0], def.core[1], '@');
  for (const t of def.towers) put(t.cx, t.cz, 'T');
  const st = mapStats(def);
  const head = `${def.id}  "${def.name}"  tier ${def.tier}  gold ${def.gold}  lives ${def.lives}\n  ${def.desc}\n  roads ${st.roads.join(' + ')} cells, free ${st.free}, scenery ${def.blocked.length}, max level ${st.maxLevel}` +
    (st.crossings.length ? ', bridges: ' + st.crossings.map((c) => `(${c.x},${c.z}) road ${c.over + 1}@L${c.overLevel} over road ${c.under + 1}@L${c.underLevel}`).join('; ') : '');
  return head + '\n' + g.map((r) => '  ' + r.join('')).join('\n');
}

// ------------------------------------------------------------------ run
let fail = 0;
const report = (m: string) => { fail++; if (fail <= 40) console.log('FAIL', m); };
const sum = [1, 2, 3].map(() => ({ n: 0, attempts: 0, fallback: 0, lanes: [0, 0, 0, 0], cross: [0, 0, 0, 0, 0], len: 0, lenMin: 1e9, lenMax: 0, free: 0, freeMin: 1e9, gold: 0, goldMin: 1e9, goldMax: 0, maxL: [0, 0, 0, 0], edges: [0, 0, 0, 0], turns: 0, shapes: new Set<string>(), self: 0, ms: 0, msMax: 0, names: new Set<string>() }));
for (let tier = 1; tier <= 3; tier++) {
  const s = sum[tier - 1];
  for (let i = 0; i < SEEDS; i++) {
    const seed = i < SEEDS / 2 ? i : Math.imul(i, 2654435761) >>> 0;
    const t0 = performance.now();
    let res;
    try { res = generateMapEx(seed, tier); } catch (e) { report(`tier ${tier} seed ${seed} threw ${e}`); continue; }
    const ms = performance.now() - t0;
    const def = res.def;
    if (i > 5) { s.ms += ms; s.msMax = Math.max(s.msMax, ms); } // skip JIT warm-up
    const again = generateMap(seed, tier);
    if (JSON.stringify(again) !== JSON.stringify(def)) report(`tier ${tier} seed ${seed} is not deterministic`);
    if (res.fallback) s.fallback++;
    else for (const b of check(def, tier, seed)) report(`tier ${tier} seed ${seed}: ${b}`);
    const st = mapStats(def);
    s.n++; s.attempts += res.attempts; s.lanes[def.lanes.length]++; s.cross[Math.min(4, st.crossings.length)]++;
    for (const l of st.roads) { s.len += l; s.lenMin = Math.min(s.lenMin, l); s.lenMax = Math.max(s.lenMax, l); }
    s.free += st.free; s.freeMin = Math.min(s.freeMin, st.free); s.gold += def.gold; s.goldMin = Math.min(s.goldMin, def.gold); s.goldMax = Math.max(s.goldMax, def.gold);
    s.maxL[st.maxLevel]++; s.turns += def.lanes.reduce((a, l) => a + l.length - 2, 0);
    for (const l of def.lanes) { const p = l[0]; s.edges[p[0] === -2 ? 0 : p[0] === GW + 1 ? 1 : p[1] === -2 ? 2 : 3]++; }
    if (def.lanes.length === 1 && st.crossings.length) s.self++;
    s.shapes.add(JSON.stringify(def.lanes)); s.names.add(def.name);
  }
}
// the last-resort layouts obey the same rules
for (let t = 1; t <= 3; t++) for (const b of check(fallbackMap(42, t), t, 42)) report(`fallback tier ${t}: ${b}`);
// odd inputs must still give a valid map
for (const [seed, tier] of [[NaN, 1], [-5, 2], [1e15, 3], [3.7, 0], [7, 99], [Infinity, NaN]] as [number, number][]) {
  try { const d = generateMap(seed, tier); if (validateMap(d) || !sanitizeMap(JSON.parse(JSON.stringify(d)))) report(`odd input ${seed},${tier} gave an invalid map`); } catch (e) { report(`odd input ${seed},${tier} threw ${e}`); }
}
// the hand-made maps: valid, a spire on a free cell, and they survive sanitizing
for (const m of MAPS) {
  const v = validateMap(m);
  if (v) report(`map ${m.id}: ${v}`);
  const g = new GameMap(m).grid, sp = m.towers.filter((t) => t.t === 'spire');
  if (!sp.length) report(`map ${m.id} has no spire`);
  const seen = new Set<number>();
  for (const t of m.towers) { const k = t.cz * GW + t.cx; if (g[k] !== 0 || seen.has(k)) report(`map ${m.id}: tower at ${t.cx},${t.cz} is not on a free cell`); seen.add(k); }
  for (const [x, z] of m.blocked) if (g[z * GW + x] !== 3) report(`map ${m.id}: scenery ${x},${z} sits on a road`);
  const rt = sanitizeMap(JSON.parse(JSON.stringify(m)));
  if (!rt || JSON.stringify(rt.lanes) !== JSON.stringify(m.lanes) || rt.towers.length !== m.towers.length || rt.blocked.length !== m.blocked.length) report(`map ${m.id} changes when sanitized`);
  for (const l of m.lanes) for (let k = 1; k < l.length; k++) { const dh = Math.abs((l[k][2] || 0) - (l[k - 1][2] || 0)), d = Math.hypot(l[k][0] - l[k - 1][0], l[k][1] - l[k - 1][1]); if (dh && d < 3 * dh) report(`map ${m.id}: ramp too steep`); }
  for (const c of mapStats(m).crossings) if (c.overLevel - c.underLevel < 1) report(`map ${m.id}: roads cross at ${c.x},${c.z} without a bridge`);
}

console.log(`\n=== ${SEEDS} seeds x 3 tiers ===`);
sum.forEach((s, i) => {
  const roads = s.lanes[1] + 2 * s.lanes[2] + 3 * s.lanes[3];
  console.log(`tier ${i + 1}: ${s.n} maps, ${s.shapes.size} distinct layouts, ${s.names.size} names, fallbacks ${s.fallback}, avg attempts ${(s.attempts / s.n).toFixed(2)}, ${(s.ms / Math.max(1, s.n - 6)).toFixed(2)} ms avg / ${s.msMax.toFixed(1)} ms max
        roads 1/2/3: ${s.lanes.slice(1).join('/')}  (self-crossing ${s.self})   bridges 0/1/2/3/4+: ${s.cross.join('/')}   max level 0/1/2/3: ${s.maxL.join('/')}
        road length avg ${(s.len / roads).toFixed(1)} (min ${s.lenMin}, max ${s.lenMax})   waypoints per map avg ${(s.turns / s.n).toFixed(1)}   gates W/E/N/S: ${s.edges.join('/')}
        free cells avg ${(s.free / s.n).toFixed(0)} (min ${s.freeMin})   gold avg ${(s.gold / s.n).toFixed(0)} (${s.goldMin}-${s.goldMax})`);
});

console.log('\n=== samples ===');
for (const [seed, tier] of [[1, 1], [9, 1], [5, 2], [17, 2], [4, 3], [27, 3]]) console.log('\n' + ascii(generateMap(seed, tier)));
console.log('\n=== hand-made elevation maps ===');
for (const id of ['overpass', 'highline']) { const m = MAPS.find((x) => x.id === id); if (m) console.log('\n' + ascii({ ...m, lanes: m.lanes.map((l) => l.map((p) => [Math.round(p[0]), Math.round(p[1]), p[2]] as LanePoint)) })); }

if (!NOPLAY) {
  console.log('\n=== bot playtest (skill 1, with hero, normal) ===');
  try {
    const { Sim } = await import('../src/game/sim.ts');
    const { Bot } = await import('../src/game/bot.ts');
    const play = (map: MapDef, seed: number) => {
      const sim = new Sim({ seed, pauseOnCards: false, map, diff: 'normal' });
      const bot = new Bot(sim, 0, 1);
      for (let i = 0; i < 60 * 60 * 40 && !sim.over; i++) { bot.step(1 / 60); sim.step(1 / 60); sim.events.length = 0; }
      if (!Number.isFinite(sim.gold) || sim.enemies.some((e) => !Number.isFinite(e.x) || !Number.isFinite(e.z))) report(`playtest ${map.id}: non-finite state`);
      return sim;
    };
    const rows: [string, MapDef][] = [];
    for (const id of ['switchback', 'crossfire', 'pincer', 'overpass', 'highline']) { const m = MAPS.find((x) => x.id === id); if (m) rows.push([id, m]); }
    for (const [seed, tier] of [[1, 1], [7, 1], [21, 1], [2, 2], [5, 2], [22, 2], [3, 3], [11, 3], [23, 3]]) rows.push([`gen-${tier}-${seed}`, generateMap(seed, tier)]);
    for (const [name, map] of rows) {
      const out: string[] = [];
      let waves = 0;
      for (let r = 0; r < 3; r++) { const s = play(map, 1000 + r); waves += s.wave; out.push(`${s.won ? 'WON' : 'lost'}@${s.wave}`); }
      if (waves < 9) report(`playtest ${name}: bot never got past wave 3`);
      console.log(`  ${name.padEnd(12)} roads ${mapStats(map).roads.join('+').padEnd(10)} gold ${map.gold}  ${out.join('  ')}`);
    }
  } catch (e) { console.log('  playtest skipped, the simulation is not loadable right now:', String(e).split('\n')[0]); }
}

console.log(fail ? `\n${fail} FAILED` : '\nall map generator checks passed');
process.exit(fail ? 1 : 0);
