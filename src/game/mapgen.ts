// Procedural maps. generateMap(seed, tier) is pure and deterministic: the same seed and tier always give the same map.
//
// How it works: roads are drawn on a jittered lattice (grid lines 3-5 cells apart), so parallel stretches always leave
// room for towers. A road starts as a randomly weighted shortest path from a board edge to the core and is then
// lengthened with U-shaped detours through unused lattice nodes. Bridges are planned, not accidental: a road is routed
// straight through a node that another stretch passes straight through at a right angle. Heights are then solved per
// road with a small dynamic programme (flat steps, or 3-cell ramps of one level) under the constraints the bridges set.
import { GW, GH } from './data.ts';
import { GameMap, validateMap } from './map.ts';
import type { MapDef, LanePoint } from './map.ts';

type Rng = () => number;
type Cell = [number, number];

function mulberry(a: number): Rng {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mix(a: number, b: number, c: number) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h + Math.imul(b + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0;
  h = (h + Math.imul(c + 1, 0x165667b1)) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
const int = (r: Rng, n: number) => Math.floor(r() * n);
const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.min(a.length - 1, int(r, a.length))];
function shuffle<T>(r: Rng, a: T[]) { for (let i = a.length - 1; i > 0; i--) { const j = int(r, i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

/** Minimum free buildable cells a generated map keeps. */
export const MIN_FREE = 120;
const RAMP = 3; // cells of road per level of climb
const EDGE_NAMES = ['west', 'east', 'north', 'south'];

// ---------- lattice ----------
interface Lat { xs: number[]; zs: number[]; nc: number; nr: number }
function axis(r: Rng, hi: number, gaps: readonly number[]) {
  const out: number[] = [];
  for (let v = 1; v <= hi; v += pick(r, gaps)) out.push(v);
  const slack = hi - out[out.length - 1];
  const shift = int(r, slack + 1);
  return out.map((v) => v + shift);
}
const nx = (L: Lat, n: number) => L.xs[n % L.nc];
const nz = (L: Lat, n: number) => L.zs[(n / L.nc) | 0];
function nbrs(L: Lat, n: number): number[] {
  const i = n % L.nc, j = (n / L.nc) | 0, o: number[] = [];
  if (i > 0) o.push(n - 1);
  if (i < L.nc - 1) o.push(n + 1);
  if (j > 0) o.push(n - L.nc);
  if (j < L.nr - 1) o.push(n + L.nc);
  return o;
}
const ndist = (L: Lat, a: number, b: number) => Math.abs(nx(L, a) - nx(L, b)) + Math.abs(nz(L, a) - nz(L, b));

/** Randomly weighted shortest path over free lattice nodes. */
function route(L: Lat, from: number, goal: (n: number) => boolean, blk: Uint8Array, r: Rng, wig: number): number[] | null {
  const N = L.nc * L.nr;
  if (from < 0 || from >= N || blk[from]) return null;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int16Array(N).fill(-1), done = new Uint8Array(N);
  dist[from] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let n = 0; n < N; n++) if (!done[n] && dist[n] < best) { best = dist[n]; u = n; }
    if (u < 0) return null;
    if (goal(u)) { const p: number[] = []; for (let n = u; n >= 0; n = prev[n]) p.push(n); return p.reverse(); }
    done[u] = 1;
    for (const v of nbrs(L, u)) {
      if (blk[v] || done[v]) continue;
      const w = ndist(L, u, v) * (1 + r() * wig);
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
  }
}

// ---------- roads ----------
interface Road { edge: number; spawn: Cell; nodes: number[]; target: number }
interface Plan { target: number; min: number; max: number; self?: boolean; over?: number; overOptional?: boolean }

function roadLen(L: Lat, rd: Road) {
  let len = Math.abs(rd.spawn[0] - nx(L, rd.nodes[0])) + Math.abs(rd.spawn[1] - nz(L, rd.nodes[0])) - 1;
  for (let k = 1; k < rd.nodes.length; k++) len += ndist(L, rd.nodes[k - 1], rd.nodes[k]);
  return len;
}
function roadCells(L: Lat, rd: Road): Cell[] {
  const pts: Cell[] = [rd.spawn, ...rd.nodes.map((n): Cell => [nx(L, n), nz(L, n)])];
  const a = pts[pts.length - 2], c = pts[pts.length - 1];
  pts[pts.length - 1] = [c[0] - Math.sign(c[0] - a[0]), c[1] - Math.sign(c[1] - a[1])];
  const out: Cell[] = [[pts[0][0], pts[0][1]]];
  for (let k = 1; k < pts.length; k++) {
    let [x, z] = pts[k - 1];
    const dx = Math.sign(pts[k][0] - x), dz = Math.sign(pts[k][1] - z);
    while (x !== pts[k][0] || z !== pts[k][1]) { x += dx; z += dz; out.push([x, z]); }
  }
  return out;
}

/** Lengthen a road with U-shaped detours through unused nodes until it reaches its target length. */
function expand(L: Lat, rd: Road, occ: Uint8Array, xing: Uint8Array, r: Rng) {
  let len = roadLen(L, rd);
  for (let guard = 0; guard < 60 && len < rd.target; guard++) {
    const c: { k: number; a: number; b: number; add: number }[] = [];
    for (let k = 0; k < rd.nodes.length - 2; k++) {
      const u = rd.nodes[k], v = rd.nodes[k + 1];
      if (xing[u] || xing[v]) continue;
      const horiz = Math.abs(u - v) === 1;
      for (const s of [-1, 1]) {
        const step = horiz ? s * L.nc : s;
        if (horiz) { const j = ((u / L.nc) | 0) + s; if (j < 0 || j >= L.nr) continue; } else { const i = (u % L.nc) + s; if (i < 0 || i >= L.nc) continue; }
        const a = u + step, b = v + step;
        if (occ[a] || occ[b]) continue;
        c.push({ k, a, b, add: 2 * ndist(L, u, a) });
      }
    }
    if (!c.length) break;
    const fit = c.filter((e) => len + e.add <= rd.target + 5);
    if (!fit.length) break;
    const e = pick(r, fit);
    rd.nodes.splice(e.k + 1, 0, e.a, e.b);
    occ[e.a] = occ[e.b] = 1;
    len += e.add;
  }
  return len;
}

// ---------- heights ----------
/** Cheapest height profile along a road: need[i] >= 0 pins a level, cost[i] is the price of one level at cell i. */
function solveHeights(cells: Cell[], need: Int8Array, cost: Float32Array, maxL: number): number[] | null {
  const n = cells.length, W = maxL + 1, INF = 1e9;
  const dp = new Float64Array(n * W).fill(INF), from = new Int8Array(n * W);
  const ok = (i: number, l: number) => need[i] < 0 || need[i] === l;
  const inside = (c: Cell) => c[0] >= 0 && c[0] < GW && c[1] >= 0 && c[1] < GH;
  const rampable = (i: number) => {
    if (i + RAMP >= n || need[i + 1] >= 0 || need[i + 2] >= 0) return false;
    const a = cells[i], b = cells[i + RAMP];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== RAMP || (a[0] !== b[0] && a[1] !== b[1])) return false;
    for (let k = 0; k <= RAMP; k++) if (!inside(cells[i + k])) return false;
    return true;
  };
  for (let l = 0; l < W; l++) if (ok(0, l)) dp[l] = 0;
  for (let i = 0; i < n; i++) for (let l = 0; l < W; l++) {
    const cur = dp[i * W + l];
    if (cur >= INF) continue;
    if (i + 1 < n && ok(i + 1, l)) {
      const c = cur + cost[i + 1] * l;
      if (c < dp[(i + 1) * W + l]) { dp[(i + 1) * W + l] = c; from[(i + 1) * W + l] = 0; }
    }
    if (rampable(i)) for (const dl of [-1, 1]) {
      const nl = l + dl;
      if (nl < 0 || nl > maxL || !ok(i + RAMP, nl)) continue;
      const c = cur + 1.6 + cost[i + 1] * (l + dl / 3) + cost[i + 2] * (l + (2 * dl) / 3) + cost[i + 3] * nl;
      if (c < dp[(i + RAMP) * W + nl]) { dp[(i + RAMP) * W + nl] = c; from[(i + RAMP) * W + nl] = dl; }
    }
  }
  if (dp[(n - 1) * W] >= INF) return null;
  const h = new Array<number>(n).fill(0);
  for (let i = n - 1, l = 0; i > 0;) {
    const f = from[i * W + l];
    if (f === 0) { h[i] = l; i--; } else { h[i] = l; h[i - 1] = l - f / 3; h[i - 2] = l - (2 * f) / 3; i -= RAMP; l -= f; h[i] = l; }
    if (i === 0) h[0] = l;
  }
  return h;
}

/** Waypoints for a road: every corner, plus the start and end of every ramp. */
function toLane(cells: Cell[], h: number[]): LanePoint[] {
  const out: LanePoint[] = [];
  const n = cells.length;
  for (let i = 0; i < n; i++) {
    let keep = i === 0 || i === n - 1;
    if (!keep) {
      const a = cells[i - 1], b = cells[i], c = cells[i + 1];
      const turn = b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1];
      const bend = Math.abs(h[i] - h[i - 1] - (h[i + 1] - h[i])) > 1e-6;
      keep = turn || bend;
    }
    if (!keep) continue;
    const lv = Math.round(h[i]);
    out.push(lv > 0 && i < n - 1 ? [cells[i][0], cells[i][1], lv] : [cells[i][0], cells[i][1]]);
  }
  return out;
}

// ---------- names ----------
const WORDS = [
  'Ashfall', 'Cinder Reach', 'Emberline', 'Rustwater', 'Kiln Row', 'Slagheap', 'Copper Fen', 'Dustgate', 'Saltpan', 'Brasswind',
  'Furnace Flats', 'Ochre Step', 'Tinder Gap', 'Sandglass', 'Smelt Hollow', 'Amber Cut', 'Charline', 'Forgemouth', 'Dry Relay', 'Red Shelf',
  'Lantern Mile', 'Scoria', 'Hearthward', 'Burnt Orchard', 'Glassfield', 'Verdigris', 'Low Kestrel', 'Signal Dune', 'Wickside', 'Old Foundry',
  'Sparrowfall', 'Clay Antenna', 'Mothlight', 'Terracotta', 'Embers End', 'Coalwake', 'Sunder Yard', 'Halcyon Pit', 'Tallow Ridge', 'Flintmarch',
];
const LETTERS = 'ABCDEFGHJKLMNPQRSTVXYZ';
function sectorName(r: Rng) {
  return `Sector ${LETTERS[int(r, LETTERS.length)]}-${String(1 + int(r, 98)).padStart(2, '0')} · ${pick(r, WORDS)}`.slice(0, 28);
}
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

// ---------- statistics ----------
export interface MapCrossing { x: number; z: number; over: number; under: number; overLevel: number; underLevel: number }
export interface MapStats {
  /** Road length in cells, per lane. */
  roads: number[];
  total: number;
  /** Buildable cells left (not road, core, scenery or a pre-placed tower). */
  free: number;
  crossings: MapCrossing[];
  maxLevel: number;
}
/** Cells a lane runs over, in order, with the (possibly fractional) height level at each. */
export function laneCells(lane: LanePoint[]): { x: number; z: number; h: number }[] {
  const out: { x: number; z: number; h: number }[] = [];
  const add = (x: number, z: number, h: number) => { const l = out[out.length - 1]; if (!l || l.x !== x || l.z !== z) out.push({ x, z, h }); };
  for (let i = 1; i < lane.length; i++) {
    const a = lane[i - 1], b = lane[i], ha = a[2] || 0, hb = b[2] || 0;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let s = 0; s <= n; s++) add(Math.round(a[0] + ((b[0] - a[0]) * s) / n), Math.round(a[1] + ((b[1] - a[1]) * s) / n), ha + ((hb - ha) * s) / n);
  }
  return out;
}
export function mapStats(def: MapDef): MapStats {
  const roads = def.lanes.map((l) => { let len = 0; for (let k = 1; k < l.length; k++) len += Math.hypot(l[k][0] - l[k - 1][0], l[k][1] - l[k - 1][1]); return Math.round(len * 10) / 10; });
  const g = new GameMap(def).grid;
  const tw = new Set<number>();
  for (const t of def.towers) { const k = t.cz * GW + t.cx; if (t.cx >= 0 && t.cx < GW && t.cz >= 0 && t.cz < GH && g[k] === 0) tw.add(k); }
  let free = -tw.size;
  for (let i = 0; i < g.length; i++) if (g[i] === 0) free++;
  const seen = new Map<string, { lane: number; h: number }[]>();
  const crossings: MapCrossing[] = [];
  let maxLevel = 0;
  def.lanes.forEach((l, li) => {
    for (const p of l) maxLevel = Math.max(maxLevel, p[2] || 0);
    const cells = laneCells(l);
    // the last cells run into the core, where roads may legitimately meet
    cells.forEach((c, ci) => {
      if (ci >= cells.length - 2) return;
      const k = c.x + ',' + c.z, prev = seen.get(k);
      if (prev) for (const p of prev) {
        const hi = c.h >= p.h;
        crossings.push({ x: c.x, z: c.z, over: hi ? li : p.lane, under: hi ? p.lane : li, overLevel: Math.max(c.h, p.h), underLevel: Math.min(c.h, p.h) });
      }
      if (prev) prev.push({ lane: li, h: c.h }); else seen.set(k, [{ lane: li, h: c.h }]);
    });
  });
  return { roads, total: Math.round(roads.reduce((a, b) => a + b, 0) * 10) / 10, free, crossings, maxLevel };
}

// ---------- furniture: spires and scenery ----------
/** Free cells with the best view of the roads, away from the core. `minView` = road cells that must lie within 7 cells. */
export function pickSpires(def: MapDef, count: number, r: Rng = () => 0.5, minView = 0): Cell[] {
  const g = new GameMap(def).grid;
  const road: Cell[] = [];
  for (const l of def.lanes) for (const c of laneCells(l)) if (c.x >= 0 && c.x < GW && c.z >= 0 && c.z < GH) road.push([c.x, c.z]);
  for (const t of def.towers) if (t.cx >= 0 && t.cx < GW && t.cz >= 0 && t.cz < GH) g[t.cz * GW + t.cx] = 2;
  const covered = new Float32Array(road.length);
  const out: Cell[] = [];
  while (out.length < count) {
    let best: Cell | null = null, bs = 0;
    for (let z = 1; z < GH - 1; z++) for (let x = 1; x < GW - 1; x++) {
      if (g[z * GW + x] !== 0) continue;
      if (Math.max(Math.abs(x - def.core[0]), Math.abs(z - def.core[1])) < 5) continue;
      if (out.some((o) => Math.max(Math.abs(o[0] - x), Math.abs(o[1] - z)) < 5)) continue;
      let s = 0, view = 0;
      for (let i = 0; i < road.length; i++) {
        const d = Math.hypot(road[i][0] - x, road[i][1] - z);
        if (d <= 7) view++;
        if (d < 9) s += (1 - d / 9) * (1 - 0.85 * covered[i]); // a second spire favours road the first cannot see well
      }
      if (view < minView) continue;
      s *= 0.94 + r() * 0.12;
      if (s > bs) { bs = s; best = [x, z]; }
    }
    if (!best) break;
    out.push(best);
    for (let i = 0; i < road.length; i++) { const d = Math.hypot(road[i][0] - best[0], road[i][1] - best[1]); if (d < 9) covered[i] = Math.max(covered[i], 1 - d / 9); }
  }
  return out;
}

/** Scenery: a few separate clumps of blocked cells, mostly away from the roads and never near a gate or a spire. */
function scatter(def: MapDef, entries: Cell[], r: Rng): Cell[] {
  const g = new Uint8Array(new GameMap(def).grid);
  const near = new Uint8Array(GW * GH); // 1 = next to a road
  const owner = new Int8Array(GW * GH).fill(-1);
  for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
    for (let dz = -1; dz <= 1 && !near[z * GW + x]; dz++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Z = z + dz;
      if (X >= 0 && X < GW && Z >= 0 && Z < GH && g[Z * GW + X] === 1) { near[z * GW + x] = 1; break; }
    }
  }
  const ok = (x: number, z: number, id: number) => {
    if (x < 0 || x >= GW || z < 0 || z >= GH || g[z * GW + x] !== 0) return false;
    for (const e of entries) if (Math.max(Math.abs(e[0] - x), Math.abs(e[1] - z)) <= 2) return false;
    for (const t of def.towers) if (Math.max(Math.abs(t.cx - x), Math.abs(t.cz - z)) <= 1) return false;
    // clumps stay clumps: keep a clear cell between different ones
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const X = x + dx, Z = z + dz;
      if (X >= 0 && X < GW && Z >= 0 && Z < GH && owner[Z * GW + X] >= 0 && owner[Z * GW + X] !== id) return false;
    }
    return true;
  };
  const out: Cell[] = [];
  const want = 8 + int(r, 14), clumps = 3 + int(r, 3);
  let made = 0;
  for (let c = 0; c < 24 && out.length < want && made < 6; c++) {
    const size = Math.min(want - out.length, 2 + int(r, Math.max(1, Math.ceil(want / clumps) + 1)), 7);
    const roadside = r() < 0.3;
    let seed: Cell | null = null;
    for (let t = 0; t < 40 && !seed; t++) { const x = int(r, GW), z = int(r, GH); if (ok(x, z, made) && (roadside || !near[z * GW + x])) seed = [x, z]; }
    if (!seed) continue;
    const cl: Cell[] = [seed];
    g[seed[1] * GW + seed[0]] = 3; owner[seed[1] * GW + seed[0]] = made;
    for (let t = 0; t < 40 && cl.length < size; t++) {
      const b = pick(r, cl), d = pick(r, [[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
      const x = b[0] + d[0], z = b[1] + d[1];
      if (!ok(x, z, made) || (!roadside && near[z * GW + x] && r() < 0.7)) continue;
      g[z * GW + x] = 3; owner[z * GW + x] = made; cl.push([x, z]);
    }
    if (cl.length < 2) { g[seed[1] * GW + seed[0]] = 0; owner[seed[1] * GW + seed[0]] = -1; continue; } // no lone pebbles
    out.push(...cl);
    made++;
  }
  return made >= 2 ? out : [];
}

// ---------- one attempt ----------
function attempt(r: Rng, tier: number, seed: number): MapDef | null {
  const L: Lat = { xs: axis(r, GW - 2, [3, 3, 4, 4, 5]), zs: axis(r, GH - 2, [3, 3, 3, 4]), nc: 0, nr: 0 };
  L.nc = L.xs.length; L.nr = L.zs.length;
  const N = L.nc * L.nr;
  const coreOpts: number[] = [];
  for (let n = 0; n < N; n++) if (nx(L, n) >= 3 && nx(L, n) <= GW - 4 && nz(L, n) >= 3 && nz(L, n) <= GH - 4) coreOpts.push(n);
  if (!coreOpts.length) return null;
  const coreNode = pick(r, coreOpts);
  const core: Cell = [nx(L, coreNode), nz(L, coreNode)];

  // what to build
  const plans: Plan[] = [];
  if (tier === 1) plans.push({ target: 52 + int(r, 40), min: 45, max: 99 });
  else if (tier === 2) {
    if (r() < 0.42) plans.push({ target: 44 + int(r, 20), min: 40, max: 68, self: true });
    else { plans.push({ target: 28 + int(r, 18), min: 22, max: 56 }); plans.push({ target: 28 + int(r, 18), min: 22, max: 56, over: r() < 0.35 ? 0 : undefined, overOptional: true }); }
  } else if (r() < 0.4) {
    if (r() < 0.3) { plans.push({ target: 40 + int(r, 16), min: 30, max: 62, self: true }); plans.push({ target: 24 + int(r, 14), min: 20, max: 44, over: r() < 0.4 ? 0 : undefined, overOptional: true }); }
    else { plans.push({ target: 26 + int(r, 16), min: 20, max: 48 }); plans.push({ target: 26 + int(r, 16), min: 20, max: 48, over: 0 }); }
  } else {
    plans.push({ target: 22 + int(r, 14), min: 20, max: 40 });
    plans.push({ target: 22 + int(r, 14), min: 20, max: 40, over: 0 });
    plans.push({ target: 22 + int(r, 14), min: 20, max: 40, over: r() < 0.4 ? int(r, 2) : undefined, overOptional: true });
  }

  const occ = new Uint8Array(N), xing = new Uint8Array(N);
  occ[coreNode] = 2;
  const wig = pick(r, [0.2, 0.6, 1.2, 2.2, 3.5]);
  const edges = shuffle(r, [0, 1, 2, 3]);
  const roads: Road[] = [];
  const coreNbr = (blk: Uint8Array) => (n: number) => !blk[n] && nbrs(L, coreNode).includes(n);
  const straightAt = (rd: Road, k: number) => {
    if (k < 1 || k > rd.nodes.length - 3) return 0; // not the entry node, not the node before the core
    const a = rd.nodes[k - 1], b = rd.nodes[k], c = rd.nodes[k + 1];
    if (b - a !== c - b) return 0;
    return Math.abs(b - a) === 1 ? 1 : 2; // 1 = runs east-west, 2 = runs north-south
  };

  for (let pi = 0; pi < plans.length; pi++) {
    const plan = plans[pi], edge = edges[pi];
    // entry node on this edge
    const cand: number[] = [];
    if (edge < 2) for (let j = 0; j < L.nr; j++) cand.push(j * L.nc + (edge === 0 ? 0 : L.nc - 1));
    else for (let i = 0; i < L.nc; i++) cand.push((edge === 2 ? 0 : L.nr - 1) * L.nc + i);
    shuffle(r, cand);
    let made: Road | null = null;
    for (const start of cand) {
      if (occ[start]) continue;
      const spawn: Cell = edge === 0 ? [-2, nz(L, start)] : edge === 1 ? [GW + 1, nz(L, start)] : edge === 2 ? [nx(L, start), -2] : [nx(L, start), GH + 1];
      if (Math.hypot(spawn[0] - core[0], spawn[1] - core[1]) < 8) continue;
      let nodes: number[] | null = null;
      let crossed = -1;
      if (plan.self) {
        const xs: number[] = [];
        for (let n = 0; n < N; n++) if (!occ[n] && n !== start && nbrs(L, n).length === 4 && nbrs(L, n).every((m) => !occ[m])) xs.push(n);
        shuffle(r, xs);
        for (const X of xs.slice(0, 8)) {
          const ew = r() < 0.5, fl1 = r() < 0.5, fl2 = r() < 0.5;
          let A = X - 1, B = X + 1, C = X - L.nc, D = X + L.nc;
          if (fl1) [A, B] = [B, A];
          if (fl2) [C, D] = [D, C];
          if (!ew) [A, B, C, D] = [C, D, A, B];
          const blk = new Uint8Array(occ);
          blk[X] = blk[B] = blk[C] = blk[D] = 1;
          const p1 = route(L, start, (n) => n === A, blk, r, wig);
          if (!p1) continue;
          for (const n of p1) blk[n] = 1;
          blk[B] = blk[C] = 0;
          const p2 = route(L, B, (n) => n === C, blk, r, wig);
          if (!p2) continue;
          for (const n of p2) blk[n] = 1;
          blk[D] = 0;
          const p3 = route(L, D, coreNbr(blk), blk, r, wig);
          if (!p3) continue;
          nodes = [...p1, X, ...p2, X, ...p3, coreNode];
          crossed = X;
          break;
        }
      } else if (plan.over !== undefined && roads[plan.over]) {
        const q = roads[plan.over], ks: number[] = [];
        for (let k = 1; k < q.nodes.length - 2; k++) if (straightAt(q, k) && !xing[q.nodes[k]]) ks.push(k);
        shuffle(r, ks);
        for (const k of ks) {
          const X = q.nodes[k], dir = straightAt(q, k);
          const i = X % L.nc, j = (X / L.nc) | 0;
          let A: number, B: number;
          if (dir === 1) { if (j < 1 || j > L.nr - 2) continue; A = X - L.nc; B = X + L.nc; } else { if (i < 1 || i > L.nc - 2) continue; A = X - 1; B = X + 1; }
          if (r() < 0.5) [A, B] = [B, A];
          if (occ[A] || occ[B]) continue;
          const blk = new Uint8Array(occ);
          blk[B] = 1;
          const p1 = route(L, start, (n) => n === A, blk, r, wig);
          if (!p1) continue;
          for (const n of p1) blk[n] = 1;
          blk[B] = 0;
          const p2 = route(L, B, coreNbr(blk), blk, r, wig);
          if (!p2) continue;
          nodes = [...p1, X, ...p2, coreNode];
          crossed = X;
          break;
        }
        if (!nodes && !plan.overOptional) continue;
      }
      if (!nodes) {
        if (plan.self) continue;
        const p = route(L, start, coreNbr(occ), occ, r, wig);
        if (!p) continue;
        nodes = [...p, coreNode];
      }
      made = { edge, spawn, nodes, target: plan.target };
      for (const n of nodes) if (n !== coreNode) occ[n] = 1;
      if (crossed >= 0) xing[crossed] = 1;
      break;
    }
    if (!made) return null;
    roads.push(made);
  }
  // lengthen (shortest first, so no road hogs the lattice)
  for (let pass = 0; pass < 2; pass++) for (const rd of [...roads].sort((a, b) => roadLen(L, a) - roadLen(L, b))) expand(L, rd, occ, xing, r);
  for (let i = 0; i < roads.length; i++) { const len = roadLen(L, roads[i]); if (len < plans[i].min || len > plans[i].max) return null; }
  { const ls = roads.map((rd) => roadLen(L, rd)); if (Math.min(...ls) < Math.max(...ls) * 0.55) return null; } // no road is a shortcut compared with the others
  if (tier === 3 && !xing.some((v) => v)) return null;

  // cells and crossings
  const cells = roads.map((rd) => roadCells(L, rd));
  const at = new Map<number, { rd: number; i: number }[]>();
  const key = (c: Cell) => (c[1] + 4) * 64 + c[0] + 4;
  const X: { a: { rd: number; i: number }; b: { rd: number; i: number } }[] = [];
  for (let rd = 0; rd < cells.length; rd++) for (let i = 0; i < cells[rd].length; i++) {
    const k = key(cells[rd][i]), prev = at.get(k);
    if (!prev) { at.set(k, [{ rd, i }]); continue; }
    if (prev.length > 1) return null;
    X.push({ a: prev[0], b: { rd, i } });
    prev.push({ rd, i });
  }
  for (const c of X) for (const p of [c.a, c.b]) if (p.i < 4 || p.i > cells[p.rd].length - 5) return null;
  if (X.length !== xing.reduce((a, b) => a + b, 0)) return null;

  // heights: a fancy configuration first, then plain ones (every over/under choice, shortest bridges)
  let heights: number[][] | null = null;
  const tryConfig = (upperBits: number, fancy: boolean): number[][] | null => {
    const maxL = tier === 3 ? (fancy && r() < 0.3 ? 3 : 2) : 1;
    const need = cells.map((c) => new Int8Array(c.length).fill(-1));
    const cost = cells.map((c) => new Float32Array(c.length).fill(1));
    const pin = (rd: number, i: number, v: number) => { if (need[rd][i] >= 0 && need[rd][i] !== v) return false; need[rd][i] = v; return true; };
    for (let rd = 0; rd < cells.length; rd++) {
      const n = cells[rd].length;
      let s = 0;
      if (fancy && tier === 3 && r() < 0.3) { s = 1 + int(r, Math.min(2, maxL)); for (let i = 0; i < Math.min(n - 6, 6 + int(r, 10)); i++) cost[rd][i] = -0.5; }
      pin(rd, 0, s); pin(rd, 1, s); pin(rd, 2, s);
      if (!pin(rd, n - 1, 0) || !pin(rd, n - 2, 0)) return null;
      if (fancy && tier >= 2 && r() < (tier === 3 ? 0.65 : 0.3)) {
        const len = 7 + int(r, 12), a = 3 + int(r, Math.max(1, n - len - 6));
        for (let i = a; i < Math.min(n - 3, a + len); i++) cost[rd][i] = -0.8;
      }
    }
    X.forEach((c, ci) => {
      const up = (upperBits >> ci) & 1 ? c.b : c.a, lo = up === c.a ? c.b : c.a;
      const base = fancy && maxL >= 2 && r() < 0.2 ? 1 : 0;
      const top = Math.min(maxL, base + (fancy && maxL >= 2 && r() < 0.4 ? 2 : 1));
      for (let d = -1; d <= 1; d++) if (!pin(up.rd, up.i + d, top) || !pin(lo.rd, lo.i + d, base)) need[0][0] = 99; // contradiction: poisons the solve
    });
    const out: number[][] = [];
    for (let rd = 0; rd < cells.length; rd++) { const h = solveHeights(cells[rd], need[rd], cost[rd], maxL); if (!h) return null; out.push(h); }
    return out;
  };
  const combos = 1 << X.length;
  const first = int(r, combos);
  for (let t = 0; t < 3 && !heights; t++) heights = tryConfig(int(r, combos), true);
  for (let b = 0; b < combos && !heights; b++) heights = tryConfig((first + b) % combos, false);
  if (!heights) return null;

  const lanes = cells.map((c, i) => toLane(c, heights![i]));
  if (lanes.some((l) => l.length > 48)) return null;

  const lens = roads.map((rd) => roadLen(L, rd));
  const minLen = Math.min(...lens);
  const gold = Math.max(180, Math.min(460, Math.round((150 + 70 * (roads.length - 1) + Math.max(0, 70 - minLen) * 3) / 10) * 10));
  const def: MapDef = {
    id: `gen-${tier}-${seed}`, name: sectorName(r), desc: '', tier, lanes, core,
    gold, lives: roads.length === 3 ? 22 : 20, towers: [], blocked: [],
  };
  for (const [cx, cz] of pickSpires(def, tier === 3 ? 2 : 1, r, tier === 3 ? 14 : 20)) def.towers.push({ t: 'spire', cx, cz });
  if (def.towers.length !== (tier === 3 ? 2 : 1)) return null;
  const entries: Cell[] = [];
  for (const c of cells) { let n = 0; for (const p of c) if (p[0] >= 0 && p[0] < GW && p[1] >= 0 && p[1] < GH && n++ < 4) entries.push(p); }
  def.blocked = scatter(def, entries, r);
  if (def.blocked.length < 6 || def.blocked.length > 24) return null;

  // description
  const from = roads.map((rd) => EDGE_NAMES[rd.edge]);
  const bridges = X.length;
  const raised = Math.max(0, ...lanes.flat().map((p) => p[2] || 0));
  let desc: string;
  if (roads.length === 1) {
    desc = bridges ? `One road from the ${from[0]} that loops back and bridges over itself. ${lens[0]} tiles to hold.`
      : `One long winding road from the ${from[0]}, ${lens[0]} tiles from gate to core.`;
  } else {
    const list = from.length === 2 ? `${from[0]} and ${from[1]}` : `${from[0]}, ${from[1]} and ${from[2]}`;
    const tail = bridges ? `${NUM[bridges] || bridges} bridge${bridges > 1 ? 's' : ''}${raised > 1 ? ', high viaducts' : ''}` : raised ? 'no bridges, one raised stretch' : 'no bridges';
    desc = `${roads.length === 2 ? 'Two' : 'Three'} roads from the ${list}: ${tail}.`;
  }
  def.desc = desc.slice(0, 90);
  if (mapStats(def).free < MIN_FREE) return null;
  return def;
}

// ---------- known-good layouts, used only if every attempt fails ----------
const FALLBACK: Omit<MapDef, 'id' | 'name'>[] = [
  {
    desc: 'One long winding road from the west, 60 tiles from gate to core.', tier: 1,
    lanes: [[[-2, 3], [5, 3], [5, 13], [11, 13], [11, 5], [17, 5], [17, 13], [22, 13], [22, 9]]],
    core: [22, 8], gold: 190, lives: 20, towers: [{ t: 'spire', cx: 14, cz: 9 }], blocked: [[2, 8], [2, 9], [3, 9], [8, 16], [9, 16], [14, 1], [15, 1], [15, 2]],
  },
  {
    desc: 'One road from the west that loops back and bridges over itself. 62 tiles to hold.', tier: 2,
    lanes: [[[-2, 10], [16, 10], [16, 3], [14, 3], [11, 3, 1], [8, 3, 1], [8, 11, 1], [8, 14], [21, 14]]],
    core: [22, 14], gold: 180, lives: 20, towers: [{ t: 'spire', cx: 12, cz: 7 }], blocked: [[3, 5], [3, 6], [4, 6], [20, 5], [20, 6], [21, 6], [12, 16], [13, 16]],
  },
  {
    desc: 'Two roads from the west and north: two bridges, high viaducts.', tier: 3,
    lanes: [[[-2, 4], [13, 4], [13, 14], [22, 14], [22, 10]], [[10, -2, 2], [10, 9, 2], [15, 9, 2], [21, 9]]],
    core: [22, 9], gold: 370, lives: 20, towers: [{ t: 'spire', cx: 8, cz: 8 }, { t: 'spire', cx: 17, cz: 11 }], blocked: [[2, 9], [2, 10], [3, 10], [17, 3], [18, 3], [18, 4], [8, 16], [9, 16]],
  },
];

/** The hand-checked layout a tier falls back to (never needed so far in testing; exported so the tests can check it). */
export function fallbackMap(s: number, t: number): MapDef {
  const f = FALLBACK[t - 1];
  const def: MapDef = {
    id: `gen-${t}-${s}`, name: sectorName(mulberry(mix(s, t, 999))), desc: f.desc, tier: f.tier,
    lanes: f.lanes.map((l) => l.map((p) => [...p] as LanePoint)), core: [f.core[0], f.core[1]], gold: f.gold, lives: f.lives,
    towers: f.towers.map((x) => ({ ...x })), blocked: f.blocked.map((b) => [b[0], b[1]]),
  };
  return def;
}

export interface GenResult { def: MapDef; attempts: number; fallback: boolean }
/** generateMap plus how hard it was (for tests). */
export function generateMapEx(seed: number, tier: number): GenResult {
  const s = Number.isFinite(seed) ? Math.floor(Math.abs(seed)) >>> 0 : 0;
  const t = Number.isFinite(tier) ? Math.max(1, Math.min(3, Math.round(tier))) : 1;
  for (let k = 0; k < 60; k++) {
    try {
      const def = attempt(mulberry(mix(s, t, k)), t, s);
      if (def && !validateMap(def)) return { def, attempts: k + 1, fallback: false };
    } catch { /* try the next derived seed */ }
  }
  return { def: fallbackMap(s, t), attempts: 60, fallback: true };
}

/**
 * A procedural map. Deterministic in (seed, tier); always passes validateMap.
 * tier 1 = one long winding road, 2 = two roads or one that bridges over itself, 3 = two or three roads with bridges and raised stretches.
 */
export function generateMap(seed: number, tier: number): MapDef {
  return generateMapEx(seed, tier).def;
}
