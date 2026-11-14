// Procedural maps. generateMap(seed, tier) is pure and deterministic: the same seed and tier always give the same map.
//
// How it works: roads are drawn on a triangular lattice of hex tiles (nodes 3-5 tiles apart along all three hex axes,
// with a random offset), so any two stretches that do not share a node leave at least two free tiles for towers.
// A road starts as a randomly weighted path from a board edge to the core and is then lengthened with chevrons,
// trapezoid bumps and switchbacks through unused nodes. A style per map (wander, diagonal, terraces, orbit) biases
// the weights. Bridges are planned, not accidental: a road is routed straight through a node that another stretch
// passes straight through on a different axis. Heights are then solved per road with a small dynamic programme
// (flat steps, or 3-tile ramps of one level) under the constraints the bridges set.
import { GW, GH, CELL, HEX_DIRS, cellX, cellZ, fromAxial, hexDist, lineDir, lineCells, neighbor, neighbors, inBoard } from './hex.ts';
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

/** Minimum free buildable tiles a generated map keeps. */
export const MIN_FREE = 150;
const RAMP = 3; // tiles of road per level of climb
const EDGE_NAMES = ['west', 'east', 'north', 'south'];
/** Distance between two tile centres, in tiles. */
const tileDist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(cellX(ax, az) - cellX(bx, bz), cellZ(az) - cellZ(bz)) / CELL;
/** How far direction b is turned from direction a: 0 straight, 1 gentle (60 degrees), 2 sharp (120 degrees), 3 back. */
const turn = (a: number, b: number) => { const t = (((b - a) % 6) + 6) % 6; return t > 3 ? 6 - t : t; };

// ---------- lattice ----------
/** Nodes every `k` tiles along the hex axes. Nodes outside the board exist so entry stretches can claim them. */
interface Lat { k: number; n: number; cx: number[]; cz: number[]; wx: number[]; wz: number[]; inside: Uint8Array; nb: Int16Array }
function lattice(k: number, q0: number, r0: number): Lat {
  const cx: number[] = [], cz: number[] = [], at = new Map<number, number>(), ij: Cell[] = [];
  for (let j = -4; j <= 12; j++) for (let i = -14; i <= 16; i++) {
    const [x, z] = fromAxial(q0 + k * i, r0 + k * j);
    if (x < -7 || x > GW + 6 || z < -7 || z > GH + 6) continue;
    at.set((j + 8) * 64 + i + 20, cx.length);
    cx.push(x); cz.push(z); ij.push([i, j]);
  }
  const n = cx.length, nb = new Int16Array(n * 6).fill(-1), inside = new Uint8Array(n);
  for (let u = 0; u < n; u++) {
    inside[u] = cx[u] >= 1 && cx[u] <= GW - 2 && cz[u] >= 1 && cz[u] <= GH - 2 ? 1 : 0;
    for (let d = 0; d < 6; d++) { const v = at.get((ij[u][1] + HEX_DIRS[d][1] + 8) * 64 + ij[u][0] + HEX_DIRS[d][0] + 20); if (v !== undefined) nb[u * 6 + d] = v; }
  }
  return { k, n, cx, cz, wx: cx.map((x, u) => cellX(x, cz[u])), wz: cz.map((z) => cellZ(z)), inside, nb };
}
const dirOf = (L: Lat, u: number, v: number) => { for (let d = 0; d < 6; d++) if (L.nb[u * 6 + d] === v) return d; return -1; };

// ---------- styles ----------
interface Style {
  /** Cost multiplier per axis: 0 = east-west, 1 = south-east/north-west, 2 = south-west/north-east. */
  axis: [number, number, number];
  /** Pull along a circle around the core (0 = none). */
  orbit: number;
  /** Extra cost of a 60 degree bend and of a 120 degree hairpin while routing. */
  bend: number; sharp: number;
  /** How willing the lengthening pass is to add a hairpin (1 = does not care). */
  hair: number;
  /** Weights for the three ways to lengthen a road. */
  chev: number; bump: number; back: number;
}
const STYLES: Style[] = [
  { axis: [1, 1, 1], orbit: 0, bend: 0.1, sharp: 1, hair: 0.2, chev: 1, bump: 2, back: 1 }, // wander
  { axis: [2.6, 1, 1], orbit: 0, bend: 0.5, sharp: 0.8, hair: 0.4, chev: 1.5, bump: 1, back: 0.5 }, // long diagonals and chevrons
  { axis: [1, 2.4, 2.4], orbit: 0, bend: 0.2, sharp: 0.4, hair: 0.6, chev: 0.4, bump: 0.6, back: 2 }, // terraces joined by short diagonals
  { axis: [1, 1, 1], orbit: 1, bend: 0, sharp: 1.5, hair: 0.08, chev: 0.3, bump: 2.5, back: 0.6 }, // loops around the core
  { axis: [1.3, 1, 1], orbit: 0, bend: 0.8, sharp: 0.2, hair: 0.8, chev: 2.5, bump: 0.3, back: 1 }, // zigzag
];

// ---------- roads ----------
interface Road { edge: number; spawn: Cell; dir: number; nodes: number[]; target: number }
interface Plan { target: number; min: number; max: number; self?: boolean; over?: number; overOptional?: boolean }
interface Entry { node: number; spawn: Cell; dir: number; outs: number[] }

/** Ways onto the board from one edge: straight along a row from the west or east, down or up a diagonal from the north or south. */
function entries(L: Lat, edge: number): Entry[] {
  const out: Entry[] = [];
  const dirs = edge === 0 ? [0] : edge === 1 ? [3] : edge === 2 ? [1, 2] : [4, 5];
  for (let u = 0; u < L.n; u++) {
    if (!L.inside[u]) continue;
    for (const dir of dirs) {
      const back = (dir + 3) % 6, prev = L.nb[u * 6 + back];
      if (prev >= 0 && L.inside[prev]) continue; // not the first node on this line
      let c: Cell = [L.cx[u], L.cz[u]], gone = 0, steps = 0;
      while (gone < 2 && steps < 12) { c = neighbor(c[0], c[1], back); steps++; if (!inBoard(c[0], c[1])) gone++; else if (gone) break; }
      if (gone < 2) continue;
      const ok = edge === 0 ? c[0] === -2 : edge === 1 ? c[0] === GW + 1 : edge === 2 ? c[1] === -2 && c[0] >= 0 && c[0] < GW : c[1] === GH + 1 && c[0] >= 0 && c[0] < GW;
      if (!ok || steps - 2 < 1) continue;
      const outs: number[] = [];
      for (let m = prev, s = L.k; m >= 0 && s <= steps + L.k; m = L.nb[m * 6 + back], s += L.k) outs.push(m);
      out.push({ node: u, spawn: c, dir, outs });
    }
  }
  return out;
}

/** Tiles of a road from the gate to the last tile before the core. */
function roadCells(L: Lat, rd: Road, core: Cell): Cell[] {
  const out: Cell[] = [rd.spawn];
  let a = rd.spawn;
  for (const n of rd.nodes) {
    const b: Cell = [L.cx[n], L.cz[n]];
    const seg = lineCells(a[0], a[1], b[0], b[1]);
    for (let i = 1; i < seg.length; i++) out.push(seg[i]);
    a = b;
  }
  while (out.length > 2 && hexDist(out[out.length - 1][0], out[out.length - 1][1], core[0], core[1]) < 2) out.pop();
  return out;
}
function roadLen(L: Lat, rd: Road) {
  // the last edge stops two tiles short of the core tile
  return hexDist(rd.spawn[0], rd.spawn[1], L.cx[rd.nodes[0]], L.cz[rd.nodes[0]]) + (rd.nodes.length - 1) * L.k - 2;
}
/** Hairpins (120 degree turns) along a node list, counting the turn at the entry node. */
function hairpins(L: Lat, nodes: number[], dir0: number) {
  let n = 0, din = dir0;
  for (let i = 1; i < nodes.length; i++) { const d = dirOf(L, nodes[i - 1], nodes[i]); if (turn(din, d) >= 2) n++; din = d; }
  return n;
}

/** Lengthen a road through unused nodes until it reaches its target length. */
function expand(L: Lat, rd: Road, occ: Uint8Array, xing: Uint8Array, r: Rng, st: Style) {
  const free = (n: number) => n >= 0 && L.inside[n] && !occ[n];
  let len = roadLen(L, rd);
  for (let guard = 0; guard < 60 && len < rd.target; guard++) {
    const base = hairpins(L, rd.nodes, rd.dir);
    const c: { k: number; del: number; ins: number[]; add: number; w: number }[] = [];
    const offer = (k: number, del: number, ins: number[], add: number, w: number) => {
      if (len + add > rd.target + 4) return;
      const nodes = rd.nodes.slice();
      nodes.splice(k + 1, del, ...ins);
      const extra = Math.max(0, hairpins(L, nodes, rd.dir) - base);
      c.push({ k, del, ins, add, w: w * Math.pow(st.hair, extra) });
    };
    for (let k = 0; k < rd.nodes.length - 2; k++) {
      const u = rd.nodes[k], v = rd.nodes[k + 1];
      if (xing[u] || xing[v]) continue;
      const d = dirOf(L, u, v);
      for (const s of [1, 5]) {
        // chevron: out to the node both ends share, and back
        const w = L.nb[u * 6 + ((d + s) % 6)];
        if (free(w)) offer(k, 0, [w], L.k, L.k === 3 ? st.chev * 0.35 : st.chev); // a 3-tile chevron is a cramped triangle
        // trapezoid bump over a straight run of two edges
        const m = rd.nodes[k + 2];
        if (k < rd.nodes.length - 3 && !xing[m] && dirOf(L, v, m) === d && free(w)) { const b = L.nb[w * 6 + d]; if (free(b)) offer(k, 1, [w, b], L.k, st.bump); }
      }
      for (const s of [1, 2, 4, 5]) {
        // switchback: shift the edge sideways by one lattice step
        const a = L.nb[u * 6 + ((d + s) % 6)], b = L.nb[v * 6 + ((d + s) % 6)];
        if (free(a) && free(b)) offer(k, 0, [a, b], 2 * L.k, st.back);
      }
    }
    if (!c.length) break;
    let sum = 0;
    for (const e of c) sum += e.w;
    let at = r() * sum, e = c[c.length - 1];
    for (const o of c) { at -= o.w; if (at <= 0) { e = o; break; } }
    for (const gone of rd.nodes.splice(e.k + 1, e.del, ...e.ins)) occ[gone] = 0;
    for (const n of e.ins) occ[n] = 1;
    len += e.add;
  }
  return len;
}

// ---------- heights ----------
/** Cheapest height profile along a road: need[i] >= 0 pins a level, cost[i] is the price of one level at tile i. */
function solveHeights(cells: Cell[], need: Int8Array, cost: Float32Array, maxL: number): number[] | null {
  const n = cells.length, W = maxL + 1, INF = 1e9;
  const dp = new Float64Array(n * W).fill(INF), from = new Int8Array(n * W);
  const ok = (i: number, l: number) => need[i] < 0 || need[i] === l;
  const rampable = (i: number) => {
    if (i + RAMP >= n || need[i + 1] >= 0 || need[i + 2] >= 0) return false;
    const a = cells[i], b = cells[i + RAMP];
    if (hexDist(a[0], a[1], b[0], b[1]) !== RAMP || lineDir(a[0], a[1], b[0], b[1]) < 0) return false;
    for (let k = 0; k <= RAMP; k++) if (!inBoard(cells[i + k][0], cells[i + k][1])) return false;
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
      const corner = lineDir(a[0], a[1], b[0], b[1]) !== lineDir(b[0], b[1], c[0], c[1]);
      const bend = Math.abs(h[i] - h[i - 1] - (h[i + 1] - h[i])) > 1e-6;
      keep = corner || bend;
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
  return `Sector ${LETTERS[int(r, LETTERS.length)]}-${String(1 + int(r, 98)).padStart(2, '0')} ${pick(r, WORDS)}`.slice(0, 28);
}
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

// ---------- statistics ----------
export interface MapCrossing { x: number; z: number; over: number; under: number; overLevel: number; underLevel: number }
export interface MapStats {
  /** Road length in tiles, per lane. */
  roads: number[];
  total: number;
  /** Buildable tiles left (not road, core, scenery or a pre-placed tower). */
  free: number;
  crossings: MapCrossing[];
  maxLevel: number;
}
/** Tiles a lane runs over, in order, with the (possibly fractional) height level at each. */
export function laneCells(lane: LanePoint[]): { x: number; z: number; h: number }[] {
  const out: { x: number; z: number; h: number }[] = [];
  for (let i = 1; i < lane.length; i++) {
    const a = lane[i - 1], b = lane[i], ha = a[2] || 0, hb = b[2] || 0;
    const seg = lineCells(a[0], a[1], b[0], b[1]), n = Math.max(1, seg.length - 1);
    for (let s = i === 1 ? 0 : 1; s < seg.length; s++) out.push({ x: seg[s][0], z: seg[s][1], h: ha + ((hb - ha) * s) / n });
  }
  return out;
}
export function mapStats(def: MapDef): MapStats {
  const roads = def.lanes.map((l) => { let len = 0; for (let k = 1; k < l.length; k++) len += hexDist(l[k - 1][0], l[k - 1][1], l[k][0], l[k][1]); return len; });
  const g = new GameMap(def).grid;
  const tw = new Set<number>();
  for (const t of def.towers) { const k = t.cz * GW + t.cx; if (inBoard(t.cx, t.cz) && g[k] === 0) tw.add(k); }
  let free = -tw.size;
  for (let i = 0; i < g.length; i++) if (g[i] === 0) free++;
  const seen = new Map<string, { lane: number; h: number }[]>();
  const crossings: MapCrossing[] = [];
  let maxLevel = 0;
  def.lanes.forEach((l, li) => {
    for (const p of l) maxLevel = Math.max(maxLevel, p[2] || 0);
    const cells = laneCells(l);
    // the last tiles run into the core, where roads may legitimately meet
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
  return { roads, total: roads.reduce((a, b) => a + b, 0), free, crossings, maxLevel };
}

// ---------- furniture: spires and scenery ----------
/** Free tiles with the best view of the roads, away from the core. `minView` = road tiles that must lie within 7 tiles. */
export function pickSpires(def: MapDef, count: number, r: Rng = () => 0.5, minView = 0): Cell[] {
  const g = new GameMap(def).grid;
  const road: Cell[] = [];
  for (const l of def.lanes) for (const c of laneCells(l)) if (inBoard(c.x, c.z)) road.push([c.x, c.z]);
  for (const t of def.towers) if (inBoard(t.cx, t.cz)) g[t.cz * GW + t.cx] = 2;
  const covered = new Float32Array(road.length);
  const out: Cell[] = [];
  while (out.length < count) {
    let best: Cell | null = null, bs = 0;
    for (let z = 1; z < GH - 1; z++) for (let x = 1; x < GW - 1; x++) {
      if (g[z * GW + x] !== 0) continue;
      if (hexDist(x, z, def.core[0], def.core[1]) < 5) continue;
      if (out.some((o) => hexDist(o[0], o[1], x, z) < 6)) continue;
      let s = 0, view = 0;
      for (let i = 0; i < road.length; i++) {
        const d = tileDist(road[i][0], road[i][1], x, z);
        if (d <= 7) view++;
        if (d < 9) s += (1 - d / 9) * (1 - 0.85 * covered[i]); // a second spire favours road the first cannot see well
      }
      if (view < minView) continue;
      s *= 0.94 + r() * 0.12;
      if (s > bs) { bs = s; best = [x, z]; }
    }
    if (!best) break;
    out.push(best);
    for (let i = 0; i < road.length; i++) { const d = tileDist(road[i][0], road[i][1], best[0], best[1]); if (d < 9) covered[i] = Math.max(covered[i], 1 - d / 9); }
  }
  return out;
}

/** Scenery: a few separate clumps of blocked tiles, mostly away from the roads and never near a gate or a spire. */
function scatter(def: MapDef, gates: Cell[], r: Rng): Cell[] {
  const g = new Uint8Array(new GameMap(def).grid);
  const near = new Uint8Array(GW * GH); // 1 = next to a road
  const owner = new Int8Array(GW * GH).fill(-1);
  for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
    for (const [X, Z] of neighbors(x, z)) if (inBoard(X, Z) && g[Z * GW + X] === 1) { near[z * GW + x] = 1; break; }
  }
  const ok = (x: number, z: number, id: number) => {
    if (!inBoard(x, z) || g[z * GW + x] !== 0) return false;
    for (const e of gates) if (hexDist(e[0], e[1], x, z) <= 2) return false;
    for (const t of def.towers) if (hexDist(t.cx, t.cz, x, z) <= 1) return false;
    // clumps stay clumps: keep a clear tile between different ones
    for (let Z = z - 2; Z <= z + 2; Z++) for (let X = x - 2; X <= x + 2; X++) {
      if (inBoard(X, Z) && owner[Z * GW + X] >= 0 && owner[Z * GW + X] !== id && hexDist(x, z, X, Z) <= 2) return false;
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
      const b = pick(r, cl), [x, z] = neighbor(b[0], b[1], int(r, 6));
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
  const k = pick(r, tier === 1 ? [3, 3, 3, 4] : [3, 3, 3, 4, 4, 5]);
  const L = lattice(k, int(r, k), int(r, k));
  const N = L.n;
  const st = pick(r, STYLES), spin = r() < 0.5 ? 1 : -1;
  const wig = pick(r, [0.2, 0.6, 1.2, 2.2, 3.5]);
  const coreOpts: number[] = [];
  for (let n = 0; n < N; n++) if (L.cx[n] >= 3 && L.cx[n] <= GW - 4 && L.cz[n] >= 3 && L.cz[n] <= GH - 4) coreOpts.push(n);
  if (!coreOpts.length) return null;
  const coreNode = pick(r, coreOpts);
  const core: Cell = [L.cx[coreNode], L.cz[coreNode]];

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
  for (let n = 0; n < N; n++) if (!L.inside[n]) occ[n] = 3;
  occ[coreNode] = 2;
  const edges = shuffle(r, [0, 1, 2, 3]);
  const roads: Road[] = [];
  const arrivals: number[] = []; // directions (seen from the core) roads already come in from
  const coreNbr = (blk: Uint8Array) => (n: number) => {
    if (blk[n]) return false;
    const d = dirOf(L, coreNode, n);
    return d >= 0 && arrivals.every((a) => turn(a, d) >= 2);
  };
  const DX = [1, 0.5, -0.5, -1, -0.5, 0.5], DZ = [0, 0.866, 0.866, 0, -0.866, -0.866];
  const edgeCost = (u: number, d: number, din: number) => {
    let c = st.axis[d % 3];
    if (st.orbit) {
      const rx = L.wx[u] - L.wx[coreNode], rz = L.wz[u] - L.wz[coreNode], rl = Math.hypot(rx, rz) || 1;
      const along = ((rx * DZ[d] - rz * DX[d]) / rl) * spin, inward = -(rx * DX[d] + rz * DZ[d]) / rl;
      c *= 1.7 - 1.1 * along + 0.5 * Math.max(0, inward);
    }
    c *= 1 + r() * wig;
    if (din >= 0) { const t = turn(din, d); c += t >= 2 ? st.sharp : t === 1 ? st.bend : 0; }
    return c;
  };
  /** Randomly weighted cheapest path over free nodes; the turn cost uses the direction each node was first reached by. */
  const path = (from: number, dir0: number, goal: (n: number) => boolean, blk: Uint8Array): number[] | null => {
    if (from < 0 || blk[from]) return null;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int16Array(N).fill(-1), din = new Int8Array(N).fill(-1), done = new Uint8Array(N);
    dist[from] = 0; din[from] = dir0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let n = 0; n < N; n++) if (!done[n] && dist[n] < best) { best = dist[n]; u = n; }
      if (u < 0) return null;
      if (goal(u)) { const p: number[] = []; for (let n = u; n >= 0; n = prev[n]) p.push(n); return p.reverse(); }
      done[u] = 1;
      for (let d = 0; d < 6; d++) {
        const v = L.nb[u * 6 + d];
        if (v < 0 || blk[v] || done[v] || (din[u] >= 0 && turn(din[u], d) === 3)) continue;
        const w = edgeCost(u, d, din[u]);
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; din[v] = d; }
      }
    }
  };
  const free = (n: number) => n >= 0 && !occ[n];
  const straightAt = (rd: Road, i: number) => {
    if (i < 1 || i > rd.nodes.length - 3) return -1; // not the entry node, not the node before the core
    const d = dirOf(L, rd.nodes[i - 1], rd.nodes[i]);
    return d === dirOf(L, rd.nodes[i], rd.nodes[i + 1]) ? d : -1;
  };

  for (let pi = 0; pi < plans.length; pi++) {
    const plan = plans[pi], edge = edges[pi];
    const cand = shuffle(r, entries(L, edge));
    let made: Road | null = null;
    for (const en of cand) {
      const start = en.node;
      if (occ[start] || en.outs.some((m) => occ[m] === 1)) continue;
      if (hexDist(en.spawn[0], en.spawn[1], core[0], core[1]) < 8) continue;
      let nodes: number[] | null = null;
      let crossed = -1;
      if (plan.self) {
        const xs: number[] = [];
        for (let n = 0; n < N; n++) if (free(n) && n !== start) { let all = true; for (let d = 0; d < 6; d++) if (!free(L.nb[n * 6 + d])) all = false; if (all) xs.push(n); }
        shuffle(r, xs);
        for (const X of xs.slice(0, 8)) {
          const a = int(r, 6), b = (a + pick(r, [1, 2, 4, 5])) % 6;
          const A = L.nb[X * 6 + ((a + 3) % 6)], B = L.nb[X * 6 + a], C = L.nb[X * 6 + ((b + 3) % 6)], D = L.nb[X * 6 + b];
          const blk = new Uint8Array(occ);
          blk[X] = blk[B] = blk[C] = blk[D] = 1;
          const p1 = path(start, en.dir, (n) => n === A, blk);
          if (!p1) continue;
          for (const n of p1) blk[n] = 1;
          blk[B] = blk[C] = 0;
          const p2 = path(B, a, (n) => n === C, blk);
          if (!p2) continue;
          for (const n of p2) blk[n] = 1;
          blk[D] = 0;
          const p3 = path(D, b, coreNbr(blk), blk);
          if (!p3) continue;
          nodes = [...p1, X, ...p2, X, ...p3, coreNode];
          crossed = X;
          break;
        }
      } else if (plan.over !== undefined && roads[plan.over]) {
        const q = roads[plan.over], ks: number[] = [];
        for (let i = 1; i < q.nodes.length - 2; i++) if (straightAt(q, i) >= 0 && !xing[q.nodes[i]]) ks.push(i);
        shuffle(r, ks);
        for (const i of ks) {
          const X = q.nodes[i], dq = straightAt(q, i);
          const b = (dq + pick(r, [1, 2, 4, 5])) % 6;
          const A = L.nb[X * 6 + ((b + 3) % 6)], B = L.nb[X * 6 + b];
          if (!free(A) || !free(B)) continue;
          const blk = new Uint8Array(occ);
          blk[B] = 1;
          const p1 = path(start, en.dir, (n) => n === A, blk);
          if (!p1) continue;
          for (const n of p1) blk[n] = 1;
          blk[B] = 0;
          const p2 = path(B, b, coreNbr(blk), blk);
          if (!p2) continue;
          nodes = [...p1, X, ...p2, coreNode];
          crossed = X;
          break;
        }
        if (!nodes && !plan.overOptional) continue;
      }
      if (!nodes) {
        if (plan.self) continue;
        const p = path(start, en.dir, coreNbr(occ), occ);
        if (!p) continue;
        nodes = [...p, coreNode];
      }
      made = { edge, spawn: en.spawn, dir: en.dir, nodes, target: plan.target };
      for (const n of nodes) if (n !== coreNode) occ[n] = 1;
      for (const m of en.outs) occ[m] = 1;
      if (crossed >= 0) xing[crossed] = 1;
      arrivals.push(dirOf(L, coreNode, nodes[nodes.length - 2]));
      break;
    }
    if (!made) return null;
    roads.push(made);
  }
  // lengthen (shortest first, so no road hogs the lattice)
  for (let pass = 0; pass < 2; pass++) for (const rd of [...roads].sort((a, b) => roadLen(L, a) - roadLen(L, b))) expand(L, rd, occ, xing, r, st);

  // tiles and crossings
  const cells = roads.map((rd) => roadCells(L, rd, core));
  const lens = cells.map((c) => c.length - 1);
  for (let i = 0; i < roads.length; i++) if (lens[i] < plans[i].min || lens[i] > plans[i].max) return null;
  if (Math.min(...lens) < Math.max(...lens) * 0.55) return null; // no road is a shortcut compared with the others
  if (tier === 3 && !xing.some((v) => v)) return null;
  const at = new Map<number, { rd: number; i: number }[]>();
  const key = (c: Cell) => (c[1] + 8) * 64 + c[0] + 8;
  const X: { a: { rd: number; i: number }; b: { rd: number; i: number } }[] = [];
  for (let rd = 0; rd < cells.length; rd++) for (let i = 0; i < cells[rd].length; i++) {
    const kk = key(cells[rd][i]), prev = at.get(kk);
    if (!prev) { at.set(kk, [{ rd, i }]); continue; }
    if (prev.length > 1) return null;
    X.push({ a: prev[0], b: { rd, i } });
    prev.push({ rd, i });
  }
  for (const c of X) for (const p of [c.a, c.b]) if (p.i < 4 || p.i > cells[p.rd].length - 5) return null;
  if (X.length !== xing.reduce((a, b) => a + b, 0)) return null;

  // heights: a fancy configuration first, then plain ones (every over/under choice, shortest bridges)
  let heights: number[][] | null = null;
  const tryConfig = (upperBits: number, fancy: boolean): number[][] | null => {
    const maxL = tier === 3 ? (fancy && r() < 0.3 ? 3 : 2) : fancy && r() < 0.25 ? 2 : 1;
    const need = cells.map((c) => new Int8Array(c.length).fill(-1));
    const cost = cells.map((c) => new Float32Array(c.length).fill(1));
    let clash = false;
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
      for (let d = -1; d <= 1; d++) if (!pin(up.rd, up.i + d, top) || !pin(lo.rd, lo.i + d, base)) clash = true;
    });
    if (clash) return null;
    const out: number[][] = [];
    for (let rd = 0; rd < cells.length; rd++) { const h = solveHeights(cells[rd], need[rd], cost[rd], maxL); if (!h) return null; out.push(h); }
    return out;
  };
  const combos = 1 << X.length;
  const first = int(r, combos);
  if (tier > 1) for (let t = 0; t < 3 && !heights; t++) heights = tryConfig(int(r, combos), true);
  for (let b = 0; b < combos && !heights; b++) heights = tryConfig((first + b) % combos, false);
  if (!heights) return null;
  if (tier === 3 && !heights.some((h) => h.some((v) => v > 0))) return null;

  const lanes = cells.map((c, i) => toLane(c, heights![i]));
  if (lanes.some((l) => l.length > 48)) return null;

  const minLen = Math.min(...lens);
  const gold = Math.max(180, Math.min(460, Math.round((150 + 70 * (roads.length - 1) + Math.max(0, 70 - minLen) * 3) / 10) * 10));
  const def: MapDef = {
    id: `gen-${tier}-${seed}`, name: sectorName(r), desc: '', tier, lanes, core,
    gold, lives: roads.length === 3 ? 22 : 20, towers: [], blocked: [],
  };
  for (const [cx, cz] of pickSpires(def, tier === 3 ? 2 : 1, r, tier === 3 ? 14 : 20)) def.towers.push({ t: 'spire', cx, cz });
  if (def.towers.length !== (tier === 3 ? 2 : 1)) return null;
  const gates: Cell[] = [];
  for (const c of cells) { let n = 0; for (const p of c) if (inBoard(p[0], p[1]) && n++ < 4) gates.push(p); }
  def.blocked = scatter(def, gates, r);
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
    desc: 'One long winding road from the south, 86 tiles from gate to core.', tier: 1,
    lanes: [[[2, 21], [4, 17], [7, 17], [6, 14], [3, 14], [1, 11], [3, 8], [1, 5], [3, 2], [9, 2], [10, 5], [7, 11], [10, 17], [22, 17], [24, 14], [21, 14], [19, 11], [21, 8], [18, 8], [15, 14], [12, 14], [13, 11], [13, 10]]],
    core: [12, 8], gold: 180, lives: 20, towers: [{ t: 'spire', cx: 15, cz: 12 }],
    blocked: [[22, 7], [23, 8], [19, 3], [19, 2], [18, 3], [18, 2], [6, 1], [7, 0], [23, 1], [23, 0], [18, 15], [17, 15], [18, 16], [19, 16]],
  },
  {
    desc: 'One road from the north that loops back and bridges over itself. 63 tiles to hold.', tier: 2,
    lanes: [[[4, -2], [6, 3], [9, 3], [11, 6], [8, 12], [5, 12], [3, 15], [2, 12], [3, 9], [6, 9], [5, 6], [8, 6, 1], [11, 12, 1], [9, 15], [11, 18], [14, 18], [12, 15], [15, 15], [14, 12], [14, 11]]],
    core: [15, 9], gold: 180, lives: 20, towers: [{ t: 'spire', cx: 9, cz: 11 }],
    blocked: [[8, 16], [8, 17], [8, 15], [7, 16], [15, 2], [14, 1], [15, 0], [15, 1], [18, 6], [18, 7], [17, 6], [23, 10], [22, 9], [22, 10], [22, 11], [23, 11], [24, 10]],
  },
  {
    desc: 'Two roads from the east and south: one bridge, high viaducts.', tier: 3,
    lanes: [
      [[27, 7, 2], [24, 7, 2], [23, 10, 2], [21, 7, 1], [15, 7, 1], [14, 10, 2], [17, 16, 2], [14, 16, 1], [12, 13], [9, 7], [7, 11]],
      [[20, 21], [23, 16], [20, 10], [17, 10], [20, 4], [17, 4, 1], [12, 4, 1], [9, 4], [8, 4], [3, 13], [4, 13]],
    ],
    core: [6, 13], gold: 310, lives: 20, towers: [{ t: 'spire', cx: 17, cz: 8 }, { t: 'spire', cx: 10, cz: 10 }],
    blocked: [[6, 16], [5, 17], [6, 18], [6, 17], [6, 3], [5, 3], [4, 3], [11, 2], [11, 3]],
  },
];

/** The known-good layout a tier falls back to (never needed so far in testing; exported so the tests can check it). */
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
