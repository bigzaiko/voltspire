// Procedural map checks: node tools/mapgen-test.ts [seeds=400] [--noplay] [--diffs=easy,normal,hard] [--runs=2] [--samples=0]
// Generates seeds x 3 tiers, checks every design rule with independent checkers, prints sample maps as ASCII
// and (unless --noplay) lets the bot play the hand-made maps and a few generated ones.
import { GW, GH, CELL, cellX, cellZ, hexDist, lineDir, neighbor, neighbors, disc, inBoard } from '../src/game/hex.ts';
import { GameMap, validateMap, sanitizeMap, encodeMap, decodeMap } from '../src/game/map.ts';
import type { MapDef, LanePoint } from '../src/game/map.ts';
import { generateMap, generateMapEx, fallbackMap, mapStats, MIN_FREE } from '../src/game/mapgen.ts';
import { MAPS, mapById } from '../src/game/maps.ts';

const SEEDS = +(process.argv[2] || 400) || 400;
const NOPLAY = process.argv.includes('--noplay');
/** --diffs=easy,normal,hard and --runs=N widen the bot playtest. */
const arg = (name: string, d: string) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || `--${name}=${d}`).split('=')[1];
const DIFFS = arg('diffs', 'normal').split(',').filter((d) => ['easy', 'normal', 'hard'].includes(d));
const RUNS = Math.max(1, Math.min(10, +arg('runs', '2') || 2));
const MORE = +arg('samples', '0') || 0;
const world = (ax: number, az: number, bx: number, bz: number) => Math.hypot(cellX(ax, az) - cellX(bx, bz), cellZ(az) - cellZ(bz)) / CELL;

interface RCell { x: number; z: number; h: number; lane: number; i: number; dir: number }
/** Walk a lane tile by tile (own implementation, independent of mapgen's). dir = direction of the step that leaves the tile. */
function walk(lane: LanePoint[], li: number): RCell[] {
  const out: RCell[] = [];
  for (let k = 1; k < lane.length; k++) {
    const a = lane[k - 1], b = lane[k], ha = a[2] || 0, hb = b[2] || 0;
    const dir = lineDir(a[0], a[1], b[0], b[1]), n = hexDist(a[0], a[1], b[0], b[1]);
    if (dir < 0) { out.push({ x: b[0], z: b[1], h: hb, lane: li, i: out.length, dir }); continue; }
    let c: [number, number] = [a[0], a[1]];
    for (let s = 0; s <= n; s++) {
      if (s > 0 || k === 1) out.push({ x: c[0], z: c[1], h: ha + ((hb - ha) * s) / n, lane: li, i: out.length, dir });
      else out[out.length - 1].dir = dir;
      c = neighbor(c[0], c[1], dir);
    }
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
  if (!/^[A-Za-z0-9 .,'!?:()\-]{6,28}$/.test(def.name)) bad.push('name ' + JSON.stringify(def.name));
  if (!/^[A-Za-z0-9 .,'!?:()\-]{10,90}$/.test(def.desc) || !/road|bridge/.test(def.desc)) bad.push('desc ' + JSON.stringify(def.desc));
  if (def.gold < 150 || def.gold > 500 || def.lives < 15 || def.lives > 25) bad.push(`gold/lives ${def.gold}/${def.lives}`);

  // --- lane shape ---
  const [kx, kz] = def.core;
  if (!Number.isInteger(kx) || !Number.isInteger(kz) || kx < 3 || kz < 3 || kx > GW - 4 || kz > GH - 4) bad.push('core too close to the border');
  const edges: number[] = [];
  for (let li = 0; li < def.lanes.length; li++) {
    const l = def.lanes[li], n = `road ${li + 1}`;
    for (let k = 0; k < l.length; k++) {
      const p = l[k];
      if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) bad.push(`${n}: waypoint off-tile`);
      if (p[2] !== undefined && (!Number.isInteger(p[2]) || p[2] < 1 || p[2] > (tier === 3 ? 3 : 2))) bad.push(`${n}: bad level ${p[2]}`);
      if (k > 0 && !inBoard(p[0], p[1])) bad.push(`${n}: waypoint ${k} off the board`);
      if (k > 0) {
        const q = l[k - 1], d = hexDist(p[0], p[1], q[0], q[1]);
        if (lineDir(q[0], q[1], p[0], p[1]) < 0) bad.push(`${n}: stretch ${k} is not on a hex line`);
        const dh = Math.abs((p[2] || 0) - (q[2] || 0));
        if (dh && d < 3 * dh) bad.push(`${n}: ramp of ${dh} level(s) over only ${d} tiles`);
      }
    }
    const s = l[0], q = l[1], d0 = lineDir(s[0], s[1], q[0], q[1]);
    const edge = s[0] === -2 && s[1] >= 0 && s[1] < GH ? 0 : s[0] === GW + 1 && s[1] >= 0 && s[1] < GH ? 1 : s[1] === -2 && s[0] >= 0 && s[0] < GW ? 2 : s[1] === GH + 1 && s[0] >= 0 && s[0] < GW ? 3 : -1;
    if (edge < 0) bad.push(`${n}: gate ${s} is not 2 tiles outside an edge`);
    else if (!(edge === 0 ? d0 === 0 : edge === 1 ? d0 === 3 : edge === 2 ? d0 === 1 || d0 === 2 : d0 === 4 || d0 === 5)) bad.push(`${n}: does not enter the board head-on`);
    edges.push(edge);
    const e = l[l.length - 1];
    if (hexDist(e[0], e[1], kx, kz) > 2) bad.push(`${n}: ends away from the core`);
    if (hexDist(e[0], e[1], kx, kz) < 1) bad.push(`${n}: ends on the core tile`);
    if (e[2]) bad.push(`${n}: ends above deck level`);
  }
  if (new Set(edges).size !== edges.length) bad.push('two roads share an edge');

  // --- tiles, overlaps, crossings ---
  const lanes = def.lanes.map(walk);
  const all = lanes.flat();
  lanes.forEach((l, li) => l.forEach((c, i) => { if ((i < 2) === inBoard(c.x, c.z)) bad.push(`road ${li + 1}: tile ${i} (${c.x},${c.z}) is on the wrong side of the border`); }));
  const at = new Map<string, RCell[]>();
  for (const c of all) { const k = c.x + ',' + c.z; (at.get(k) || at.set(k, []).get(k)!).push(c); }
  const crossings: Crossing[] = [];
  /** Axis (0..2) a road runs along through a tile, or -1 if it turns or ends there. */
  const axisAt = (c: RCell, reach = 1) => {
    const l = lanes[c.lane];
    for (let d = -reach; d < reach; d++) { const o = l[c.i + d]; if (!o || c.i + d + 1 >= l.length || o.dir !== c.dir) return -1; }
    return c.dir % 3;
  };
  for (const [k, cs] of at) {
    if (cs.length === 1) continue;
    if (cs.length > 2) { bad.push(`three passes over ${k}`); continue; }
    const [a, b] = cs, da = axisAt(a), db = axisAt(b);
    if (da < 0 || db < 0 || da === db) { bad.push(`roads overlap or touch at ${k} without a clean crossing`); continue; }
    crossings.push({ a, b });
    for (const c of cs) {
      const l = lanes[c.lane];
      if (!Number.isInteger(c.h) || l[c.i - 1].h !== c.h || l[c.i + 1].h !== c.h) bad.push(`crossing ${k}: road ${c.lane + 1} is not level for the crossing tile and one tile either side`);
      // straight for two tiles either side as well, so nothing turns on top of the other road
      if (axisAt(c, 2) < 0) bad.push(`crossing ${k}: road ${c.lane + 1} turns within 2 tiles`);
    }
    if (Math.abs(a.h - b.h) < 1) bad.push(`crossing ${k}: levels ${a.h} and ${b.h} are not a bridge`);
  }

  // --- spacing: unrelated road tiles keep two free tiles between them ---
  const exempt = (p: RCell, q: RCell) => {
    if (p.lane === q.lane && Math.abs(p.i - q.i) <= 4) return true; // same stretch, or round one corner
    if (hexDist(p.x, p.z, kx, kz) <= 2 && hexDist(q.x, q.z, kx, kz) <= 2) return true; // arriving at the core from different sides
    for (const c of crossings) {
      const m = (u: RCell, w: RCell) => u.lane === c.a.lane && Math.abs(u.i - c.a.i) <= 2 && w.lane === c.b.lane && Math.abs(w.i - c.b.i) <= 2;
      if (m(p, q) || m(q, p)) return true;
    }
    return false;
  };
  let spacing = 0, where = '';
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const p = all[i], q = all[j];
    if (hexDist(p.x, p.z, q.x, q.z) > 2 || (p.x === q.x && p.z === q.z)) continue;
    if (!exempt(p, q)) { spacing++; where = `${p.x},${p.z} / ${q.x},${q.z}`; }
  }
  if (spacing) bad.push(`${spacing} pairs of road tiles closer than 2 free tiles (e.g. ${where})`);

  // --- tier rules ---
  const st = mapStats(def);
  if (st.crossings.length !== crossings.length) bad.push(`mapStats counts ${st.crossings.length} crossings, checker ${crossings.length}`);
  const maxL = Math.max(0, ...def.lanes.flat().map((p) => p[2] || 0));
  if (st.maxLevel !== maxL) bad.push('mapStats maxLevel');
  lanes.forEach((l, i) => { if (st.roads[i] !== l.length - 1) bad.push(`mapStats road length ${st.roads[i]} vs ${l.length - 1}`); });
  if (tier === 1) {
    if (def.lanes.length !== 1) bad.push('tier 1 needs exactly one road');
    if (lanes[0].length - 1 < 45) bad.push(`tier 1 road only ${lanes[0].length - 1} tiles`);
    if (crossings.length || maxL) bad.push('tier 1 should be flat and uncrossed');
  } else if (tier === 2) {
    if (!(def.lanes.length === 2 || (def.lanes.length === 1 && crossings.length >= 1))) bad.push('tier 2 needs two roads or a self-crossing road');
  } else {
    if (def.lanes.length < 2 || def.lanes.length > 3) bad.push('tier 3 needs two or three roads');
    if (!crossings.length) bad.push('tier 3 needs a bridge');
    if (!maxL) bad.push('tier 3 needs elevation');
  }
  for (const l of lanes) if (l.length - 1 < 20) bad.push(`road of only ${l.length - 1} tiles`);
  { const ls = lanes.map((l) => l.length - 1); if (Math.min(...ls) < Math.max(...ls) * 0.55) bad.push(`lopsided roads ${ls.join('/')}`); }
  if (tier === 3) for (const l of lanes) if (l.length - 1 > 62) bad.push(`tier 3 road of ${l.length - 1} tiles is not short`);

  // --- buildable space, scenery, spires ---
  const g = new GameMap(def).grid;
  let free = 0;
  for (let i = 0; i < g.length; i++) if (g[i] === 0) free++;
  // the grid the game builds must agree with the tiles the checker walked
  { const want = new Set<number>(); for (const c of all) if (inBoard(c.x, c.z)) want.add(c.z * GW + c.x); for (const [x, z] of disc(kx, kz, 1)) want.add(z * GW + x); let got = 0; for (let i = 0; i < g.length; i++) if (g[i] === 1) { got++; if (!want.has(i)) bad.push(`grid marks ${i % GW},${(i / GW) | 0} as road but no road runs there`); } if (got !== want.size) bad.push(`grid has ${got} road tiles, the walk ${want.size}`); }
  const spires = def.towers.filter((t) => t.t === 'spire');
  if (free - def.towers.length < MIN_FREE || MIN_FREE < 150 || st.free !== free - def.towers.length) bad.push(`free tiles ${free - def.towers.length} (stats ${st.free})`);
  if (def.towers.length !== spires.length || spires.length !== (tier === 3 ? 2 : 1)) bad.push(`${spires.length} spires / ${def.towers.length} towers`);
  const roadIn = all.filter((c) => inBoard(c.x, c.z));
  spires.forEach((t, i) => {
    if (!inBoard(t.cx, t.cz) || g[t.cz * GW + t.cx] !== 0) bad.push(`spire ${i + 1} not on a free tile`);
    if (hexDist(t.cx, t.cz, kx, kz) < 4) bad.push(`spire ${i + 1} next to the core`);
    const seen = roadIn.filter((c) => world(c.x, c.z, t.cx, t.cz) <= 7).length;
    if (seen < (tier === 3 ? 14 : 20)) bad.push(`spire ${i + 1} overlooks only ${seen} road tiles`);
    for (let j = 0; j < i; j++) if (hexDist(t.cx, t.cz, spires[j].cx, spires[j].cz) < 3) bad.push('spires on top of each other');
  });
  if (def.blocked.length < 6 || def.blocked.length > 24) bad.push(`${def.blocked.length} scenery tiles`);
  const bset = new Set<number>();
  for (const [x, z] of def.blocked) {
    if (!inBoard(x, z) || g[z * GW + x] !== 3) bad.push(`scenery ${x},${z} on a road or the core`);
    if (bset.has(z * GW + x)) bad.push('duplicate scenery');
    bset.add(z * GW + x);
    for (const l of lanes) { const entry = l.filter((c) => inBoard(c.x, c.z)).slice(0, 3); for (const c of entry) if (hexDist(c.x, c.z, x, z) <= 1) bad.push(`scenery ${x},${z} crowds a road start`); }
    for (const t of def.towers) if (t.cx === x && t.cz === z) bad.push('scenery under a tower');
  }
  // clumps (tiles that touch)
  let clusters = 0;
  const left = new Set(bset);
  while (left.size) {
    clusters++;
    const stack = [left.values().next().value as number];
    left.delete(stack[0]);
    while (stack.length) { const k = stack.pop()!; for (const [x, z] of neighbors(k % GW, (k / GW) | 0)) { const n = z * GW + x; if (inBoard(x, z) && left.has(n)) { left.delete(n); stack.push(n); } } }
  }
  if (clusters < 2 || clusters > 8) bad.push(`${clusters} scenery clumps`);
  for (const k of bset) { if (!neighbors(k % GW, (k / GW) | 0).some(([x, z]) => inBoard(x, z) && bset.has(z * GW + x))) bad.push(`lone scenery tile ${k % GW},${(k / GW) | 0}`); }

  // --- survives the untrusted-data path unchanged ---
  const rt = sanitizeMap(JSON.parse(JSON.stringify(def)));
  if (!rt || JSON.stringify(rt) !== JSON.stringify(def)) bad.push('sanitizeMap round trip differs');
  const viaCode = decodeMap(encodeMap(def));
  if (!viaCode || JSON.stringify(viaCode.lanes) !== JSON.stringify(def.lanes) || JSON.stringify(viaCode.blocked) !== JSON.stringify(def.blocked)) bad.push('share code round trip differs');
  return bad;
}

/**
 * ASCII picture in offset-hex layout (two characters per tile, odd rows indented by one):
 * digits = road level, / = ramp, X = bridge crossing, S = gate, @ = core, o = core ring, T = spire, # = scenery.
 */
function ascii(def: MapDef): string {
  const rows: string[][] = [];
  const cell = (x: number, z: number) => rows[z + 2]?.[x + 2];
  for (let z = -2; z < GH + 2; z++) rows.push(Array.from({ length: GW + 4 }, (_, i) => (inBoard(i - 2, z) ? '.' : ' ')));
  const put = (x: number, z: number, ch: string) => { if (cell(x, z) !== undefined) rows[z + 2][x + 2] = ch; };
  for (const [x, z] of def.blocked) put(x, z, '#');
  for (const [x, z] of disc(def.core[0], def.core[1], 1)) put(x, z, 'o');
  const count = new Map<string, number>();
  const lanes = def.lanes.map(walk);
  for (const l of lanes) for (const c of l) count.set(c.x + ',' + c.z, (count.get(c.x + ',' + c.z) || 0) + 1);
  for (const l of lanes) l.forEach((c, i) => put(c.x, c.z, i === 0 ? 'S' : count.get(c.x + ',' + c.z)! > 1 ? 'X' : Number.isInteger(c.h) ? String(c.h) : '/'));
  put(def.core[0], def.core[1], '@');
  for (const t of def.towers) put(t.cx, t.cz, t.t === 'spire' ? 'T' : 't');
  const st = mapStats(def);
  const head = `${def.id}  "${def.name}"  tier ${def.tier}  gold ${def.gold}  lives ${def.lives}\n  ${def.desc}\n  roads ${st.roads.join(' + ')} tiles, free ${st.free}, scenery ${def.blocked.length}, max level ${st.maxLevel}` +
    (st.crossings.length ? ', bridges: ' + st.crossings.map((c) => `(${c.x},${c.z}) road ${c.over + 1}@L${c.overLevel} over road ${c.under + 1}@L${c.underLevel}`).join('; ') : '');
  return head + '\n' + rows.map((r, i) => '  ' + (i & 1 ? ' ' : '') + r.join(' ')).join('\n');
}

// ------------------------------------------------------------------ run
let fail = 0;
const report = (m: string) => { fail++; if (fail <= 40) console.log('FAIL', m); };
const sum = [1, 2, 3].map(() => ({ n: 0, attempts: 0, fallback: 0, lanes: [0, 0, 0, 0], cross: [0, 0, 0, 0, 0], len: 0, lenMin: 1e9, lenMax: 0, free: 0, freeMin: 1e9, gold: 0, goldMin: 1e9, goldMax: 0, maxL: [0, 0, 0, 0], edges: [0, 0, 0, 0], turns: 0, shapes: new Set<string>(), self: 0, ms: 0, msMax: 0, names: new Set<string>(), axis: [0, 0, 0], axes: [0, 0, 0, 0], hairpins: 0, bends: 0, longest: 0 }));
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
    // how hex the layout is: tiles per axis, axes in use, bends and hairpins, the longest straight
    const used = [0, 0, 0];
    for (const l of def.lanes) {
      let run = 0, last = -1;
      for (let k = 1; k < l.length; k++) {
        const d = lineDir(l[k - 1][0], l[k - 1][1], l[k][0], l[k][1]), n = hexDist(l[k - 1][0], l[k - 1][1], l[k][0], l[k][1]);
        if (d < 0) continue;
        used[d % 3] += n; s.axis[d % 3] += n;
        if (last >= 0 && d !== last) { const t = Math.min((d - last + 6) % 6, (last - d + 6) % 6); if (t >= 2) s.hairpins++; else s.bends++; }
        run = d === last ? run + n : n; last = d;
        s.longest = Math.max(s.longest, run);
      }
    }
    s.axes[used.filter((n) => n >= 3).length]++;
  }
}
// the last-resort layouts obey the same rules
for (let t = 1; t <= 3; t++) { try { for (const b of check(fallbackMap(42, t), t, 42)) report(`fallback tier ${t}: ${b}`); } catch (e) { report(`fallback tier ${t} threw ${e}`); } }
// odd inputs must still give a valid map
for (const [seed, tier] of [[NaN, 1], [-5, 2], [1e15, 3], [3.7, 0], [7, 99], [Infinity, NaN]] as [number, number][]) {
  try { const d = generateMap(seed, tier); if (validateMap(d) || !sanitizeMap(JSON.parse(JSON.stringify(d)))) report(`odd input ${seed},${tier} gave an invalid map`); } catch (e) { report(`odd input ${seed},${tier} threw ${e}`); }
}
// the hand-made maps: valid, on the hex grid, a spire on a free tile, bridges where roads meet, and they survive sanitizing
if (MAPS.length !== 8 || new Set(MAPS.map((m) => m.id)).size !== 8) report('expected eight hand-made maps with distinct ids');
for (const id of ['switchback', 'spiral', 'crossfire', 'gauntlet', 'pincer', 'trident', 'overpass', 'highline']) if (mapById(id)?.id !== id) report(`mapById(${id})`);
for (const m of MAPS) {
  const v = validateMap(m);
  if (v) { report(`map ${m.id}: ${v}`); continue; }
  const g = new GameMap(m).grid, sp = m.towers.filter((t) => t.t === 'spire');
  if (!sp.length) report(`map ${m.id} has no spire`);
  const seen = new Set<number>();
  for (const t of m.towers) { const k = t.cz * GW + t.cx; if (!inBoard(t.cx, t.cz) || g[k] !== 0 || seen.has(k)) report(`map ${m.id}: tower at ${t.cx},${t.cz} is not on a free tile`); seen.add(k); }
  for (const t of sp) if (hexDist(t.cx, t.cz, m.core[0], m.core[1]) < 3) report(`map ${m.id}: spire next to the core`);
  for (const [x, z] of m.blocked) if (!inBoard(x, z) || g[z * GW + x] !== 3) report(`map ${m.id}: scenery ${x},${z} sits on a road`);
  if (new Set(m.blocked.map(([x, z]) => z * GW + x)).size !== m.blocked.length) report(`map ${m.id}: duplicate scenery`);
  let free = 0;
  for (let i = 0; i < g.length; i++) if (g[i] === 0) free++;
  if (free < 150) report(`map ${m.id}: only ${free} free tiles`);
  const rt = sanitizeMap(JSON.parse(JSON.stringify(m)));
  if (!rt || JSON.stringify(rt) !== JSON.stringify(m)) report(`map ${m.id} changes when sanitized`);
  if (/[^\x20-\x7e]/.test(m.name + m.desc)) report(`map ${m.id}: fancy characters in the text`);
  const lanes = m.lanes.map(walk);
  m.lanes.forEach((l, li) => {
    for (let k = 1; k < l.length; k++) {
      const dh = Math.abs((l[k][2] || 0) - (l[k - 1][2] || 0)), d = hexDist(l[k][0], l[k][1], l[k - 1][0], l[k - 1][1]);
      if (lineDir(l[k - 1][0], l[k - 1][1], l[k][0], l[k][1]) < 0) report(`map ${m.id}: road ${li + 1} leaves the hex grid`);
      if (dh && d < 3 * dh) report(`map ${m.id}: ramp too steep`);
    }
    const e = l[l.length - 1];
    if (e[2] || hexDist(e[0], e[1], m.core[0], m.core[1]) !== 2) report(`map ${m.id}: road ${li + 1} does not end at the core ring on deck level`);
    lanes[li].forEach((c, i) => { if ((i < 2) === inBoard(c.x, c.z)) report(`map ${m.id}: road ${li + 1} tile ${i} is on the wrong side of the border`); });
  });
  // roads only share a tile as a bridge that both pass straight through
  const at = new Map<string, RCell[]>();
  for (const c of lanes.flat()) { const k = c.x + ',' + c.z; (at.get(k) || at.set(k, []).get(k)!).push(c); }
  let bridges = 0;
  for (const [k, cs] of at) {
    if (cs.length === 1) continue;
    bridges++;
    const flat = (c: RCell) => { const l = lanes[c.lane], p = l[c.i - 1], q = l[c.i + 1]; return !!p && !!q && p.dir === c.dir && Number.isInteger(c.h) && p.h === c.h && q.h === c.h; };
    if (cs.length !== 2 || !flat(cs[0]) || !flat(cs[1]) || cs[0].dir % 3 === cs[1].dir % 3 || Math.abs(cs[0].h - cs[1].h) < 1) report(`map ${m.id}: roads meet at ${k} without a proper bridge`);
  }
  if (mapStats(m).crossings.length !== bridges) report(`map ${m.id}: mapStats bridge count`);
  if ((m.id === 'overpass' || m.id === 'highline') && !bridges) report(`map ${m.id} should show a bridge`);
}

console.log(`\n=== ${SEEDS} seeds x 3 tiers ===`);
sum.forEach((s, i) => {
  const roads = s.lanes[1] + 2 * s.lanes[2] + 3 * s.lanes[3], ax = s.axis[0] + s.axis[1] + s.axis[2] || 1;
  console.log(`tier ${i + 1}: ${s.n} maps, ${s.shapes.size} distinct layouts, ${s.names.size} names, fallbacks ${s.fallback}, avg attempts ${(s.attempts / s.n).toFixed(2)}, ${(s.ms / Math.max(1, s.n - 6)).toFixed(2)} ms avg / ${s.msMax.toFixed(1)} ms max
        roads 1/2/3: ${s.lanes.slice(1).join('/')}  (self-crossing ${s.self})   bridges 0/1/2/3/4+: ${s.cross.join('/')}   max level 0/1/2/3: ${s.maxL.join('/')}
        road length avg ${(s.len / roads).toFixed(1)} (min ${s.lenMin}, max ${s.lenMax})   waypoints per map avg ${(s.turns / s.n).toFixed(1)}   gates W/E/N/S: ${s.edges.join('/')}
        tiles by axis E-W / SE-NW / SW-NE: ${s.axis.map((n) => Math.round((100 * n) / ax) + '%').join(' / ')}   maps using 1/2/3 axes: ${s.axes.slice(1).join('/')}   per map: ${(s.bends / s.n).toFixed(1)} bends, ${(s.hairpins / s.n).toFixed(1)} hairpins   longest straight ${s.longest}
        free tiles avg ${(s.free / s.n).toFixed(0)} (min ${s.freeMin})   gold avg ${(s.gold / s.n).toFixed(0)} (${s.goldMin}-${s.goldMax})`);
});

console.log('\n=== samples ===');
const samples = [[1, 1], [9, 1], [14, 1], [33, 1], [5, 2], [17, 2], [21, 2], [40, 2], [4, 3], [27, 3], [31, 3], [52, 3]];
for (let i = 0; i < MORE; i++) samples.push([100 + i, 1 + (i % 3)]);
for (const [seed, tier] of samples) console.log('\n' + ascii(generateMap(seed, tier)));
console.log('\n=== hand-made maps ===');
for (const m of MAPS) console.log('\n' + ascii(m));

if (!NOPLAY) {
  console.log(`\n=== bot playtest (skill 1, with hero, ${RUNS} runs each; cells are wins and the average wave reached) ===`);
  try {
    const { Sim, mapEase } = await import('../src/game/sim.ts');
    const { Bot } = await import('../src/game/bot.ts');
    const play = (map: MapDef, seed: number, diff: string) => {
      const sim = new Sim({ seed, pauseOnCards: false, map, diff });
      const bot = new Bot(sim, 0, 1);
      for (let i = 0; i < 60 * 60 * 60 && !sim.over; i++) { bot.step(1 / 60); sim.step(1 / 60); sim.events.length = 0; }
      if (!Number.isFinite(sim.gold) || sim.enemies.some((e) => !Number.isFinite(e.x) || !Number.isFinite(e.z))) report(`playtest ${map.id}: non-finite state`);
      return sim;
    };
    const rows: [string, MapDef][] = MAPS.map((m) => [m.id, m]);
    for (const [seed, tier] of [[1, 1], [7, 1], [21, 1], [33, 1], [2, 2], [5, 2], [22, 2], [40, 2], [3, 3], [11, 3], [23, 3], [52, 3]]) rows.push([`gen-${tier}-${seed}`, generateMap(seed, tier)]);
    console.log(`  ${'map'.padEnd(12)} ${'roads'.padEnd(10)} gold ease  ${DIFFS.map((d) => d.padEnd(14)).join('')}`);
    for (const [name, map] of rows) {
      const out: string[] = [];
      for (const diff of DIFFS) {
        let waves = 0, wins = 0, goal = 0;
        for (let r = 0; r < RUNS; r++) { const s = play(map, 1000 + r, diff); waves += s.wave; goal = s.winWave; if (s.won) wins++; }
        if (waves < 3 * RUNS) report(`playtest ${name} ${diff}: bot never got past wave 3`);
        out.push(`${wins}/${RUNS} w${(waves / RUNS).toFixed(1)}/${goal}`.padEnd(14));
      }
      console.log(`  ${name.padEnd(12)} ${mapStats(map).roads.join('+').padEnd(10)} ${String(map.gold).padEnd(4)} ${mapEase(new GameMap(map)).toFixed(2)}  ${out.join('')}`);
    }
  } catch (e) { console.log('  playtest skipped, the simulation is not loadable right now:', String(e).split('\n')[0]); }
}

console.log(fail ? `\n${fail} FAILED` : '\nall map generator checks passed');
process.exit(fail ? 1 : 0);
