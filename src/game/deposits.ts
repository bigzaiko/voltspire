// Resources of a map: where the supply crates stand and where the deposits lie, the rules that place both, and a validator.
// Pure and DOM-free: the Sim, the editor and the tests (in Node) all use the same functions.
//
// Order: crates first, then deposits. The crates depend only on the roads, the scenery and the map's own towers
// (planCrates); the deposits are then laid out around them (makeDeposits), so a crate never sits on a deposit and every
// crate of iron ore gets an iron patch on its own side of the road. A map may carry its own deposits (MapDef.ore); then
// those are used as they are (minus any tile a crate, a road or a tower takes) and the rules only run in the editor's
// "Auto-place resources" and in checkResources.
//
// The rules, per region of free deck (roads cut the deck into regions: belts only cross a road through a tunnel, which
// is unlocked later):
//  a. every crate of iron ore has, in its own region, an iron patch within BELT_REACH steps of free deck of its turret
//     tiles (the free tiles beside the road within two tiles of the crate). Those turret tiles never get a deposit.
//  b. every region that holds a crate of iron ore also gets coal, close to that iron (a Smelter needs both).
//  c. copper and oil may lie behind a road (tunnels come later), but every map has at least one patch of each; oil
//     prefers the tiles far from the core. Patch counts and sizes grow with the region's size and the map's tier.
//  d. deposits keep off roads, scenery, towers and crate tiles, and never cover more than half of the roadside tiles
//     around any roadside tile (towers need those).
//  e. deterministic: the same map (roads, core, scenery, tier) always gives the same deposits.
//  f. the arm opening (the Transfer Arm is the only transport at the start; belts come with a card): every crate of iron
//     ore has an ARM LINE on its own side of the road: an iron deposit, then one or two tiles of free deck for Transfer
//     Arms, then a free roadside turret tile, all in one straight line (arms only hand on straight through a tile, so an
//     arm line has no bends), the turret tile at most BELT_REACH steps of free deck from the crate's turret tiles. And
//     every map has two arm lines that share no arm or turret tile (they may share the mine), so a 2-turret opening fits.
//     Where the rules above left none, an iron deposit is added at the back of the best line (shortest, inland mine tile).
import { GW, GH, cellX, cellZ, ORE_TYPES, TOWERS } from './data.ts';
import type { OreType, ItemType } from './data.ts';
import { neighbor, hexDist, disc, inBoard } from './hex.ts';
import { GameMap } from './map.ts';
import type { MapDef, OreLayout, PathOut } from './map.ts';

/** A supply crate a run starts with: its tile and what it holds. */
export interface CrateSpot { cx: number; cz: number; it: ItemType }
/** How far (steps over free deck) an iron patch may lie from a crate's turret tiles: a mine plus at most five belts. */
export const BELT_REACH = 6;
/** Free deck a crate's region should have (see planCrates). */
export const CRATE_ROOM = 24;
/** Deposit value of an ore type (as in Factory.ore: 1 + its index in ORE_TYPES). */
export const oreVal = (o: OreType) => ORE_TYPES.indexOf(o) + 1;

const N = GW * GH;
const idx = (cx: number, cz: number) => (cx >= 0 && cz >= 0 && cx < GW && cz < GH ? cz * GW + cx : -1);
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; }
function nbrs(i: number): number[] {
  const cx = i % GW, cz = (i / GW) | 0, out: number[] = [];
  for (let d = 0; d < 6; d++) { const [x, z] = neighbor(cx, cz, d), j = idx(x, z); if (j >= 0) out.push(j); }
  return out;
}
const NB: number[][] = Array.from({ length: N }, (_, i) => nbrs(i));
/** The neighbour of tile i in direction d (0..5), -1 off the board. */
const NBD = Int32Array.from({ length: N * 6 }, (_, k) => { const i = (k / 6) | 0, [x, z] = neighbor(i % GW, (i / GW) | 0, k % 6); return idx(x, z); });
const DISC2: number[][] = Array.from({ length: N }, (_, i) => disc(i % GW, (i / GW) | 0, 2).map(([x, z]) => idx(x, z)).filter((j) => j >= 0));

/** The map's grid as a run starts it: roads and the core 1, scenery 3, the map's own towers 2 (the same rule as the Sim). */
export function startGrid(map: GameMap): Uint8Array {
  const g = new Uint8Array(map.grid);
  for (const t of map.def.towers) {
    const i = idx(t.cx, t.cz);
    if (Object.hasOwn(TOWERS, t.t) && Number.isInteger(t.cx) && Number.isInteger(t.cz) && i >= 0 && g[i] === 0) g[i] = 2;
  }
  return g;
}

/**
 * Supply crates: every run starts with a few crates of ammunition beside the roads, so the first towers can fire before
 * any mine runs. Each road gets a crate of iron ore (the Pulse Turret's ammunition) on a free tile beside it with room
 * for towers around it; a single road gets two. Trickier maps (tier 2+) also bring one crate of a later tower's
 * ammunition (copper plates or shells, picked from the map's id and name). Crates keep four tiles apart, and stay out of
 * pockets of free deck smaller than CRATE_ROOM tiles (or mostly roadside) where there is any other choice (an outpost needs room for a mine,
 * coal and a few turrets on its own side of the road).
 */
export function planCrates(map: GameMap, grid: ArrayLike<number>): CrateSpot[] {
  const g = new Uint8Array(grid), lanes = map.lanes, out: CrateSpot[] = [], p: PathOut = { x: 0, z: 0, dx: 0, dz: 0, y: 0 };
  const G0 = ground(grid, []);
  const roadside = (i: number) => NB[i].some((j) => g[j] === 1);
  const room = (i: number) => NB[i].filter((j) => g[j] === 0).length;
  /** the largest stretch of free deck beside tile i, with i taken: CRATE_ROOM tiles, half as many away from the road */
  const roomy = (i: number) => {
    const seen = new Set<number>([i]);
    for (const s0 of NB[i]) {
      if (g[s0] !== 0 || seen.has(s0)) continue;
      const q = [s0]; seen.add(s0);
      let inland = 0;
      for (let k = 0; k < q.length; k++) {
        if (!G0.side[q[k]]) inland++;
        if (q.length >= CRATE_ROOM && inland * 2 >= CRATE_ROOM) return true;
        for (const j of NB[q[k]]) if (g[j] === 0 && !seen.has(j)) { seen.add(j); q.push(j); }
      }
    }
    return false;
  };
  const put = (lane: number, frac: number, it: ItemType) => {
    const L = lanes[lane];
    if (!L) return;
    map.pos(lane, L.len * frac, p);
    const cand: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const cx = i % GW, cz = (i / GW) | 0;
      if (g[i] !== 0 || !roadside(i) || room(i) < 3) continue;
      // (not right beside another crate: each one is the start of a little outpost of its own)
      if (out.some((c) => hexDist(c.cx, c.cz, cx, cz) < 4)) continue;
      cand.push([Math.hypot(cellX(cx, cz) - p.x, cellZ(cz) - p.z), i]);
    }
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const best = (cand.find(([, i]) => roomy(i)) || cand[0] || [0, -1])[1];
    if (best >= 0) { out.push({ cx: best % GW, cz: (best / GW) | 0, it }); g[best] = 2; }
  };
  if (lanes.length === 1) { put(0, 0.3, 'iron_ore'); put(0, 0.65, 'iron_ore'); }
  else for (let l = 0; l < Math.min(3, lanes.length); l++) put(l, 0.5, 'iron_ore');
  if ((map.def.tier || 1) >= 2) {
    let h = 0;
    for (const ch of map.def.id + map.def.name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
    put(lanes.length - 1, 0.78, h % 2 ? 'copper' : 'shell');
  }
  return out;
}

/** What the rules and the validator need to know about a grid and its crates. */
interface Ground {
  grid: ArrayLike<number>;
  /** free deck a deposit or a belt may use: grid 0 and no crate */
  open: Uint8Array;
  crate: Uint8Array;
  /** free tiles beside a road or the core */
  side: Uint8Array;
  /** region id per tile of open deck (crate tiles break it: belts cannot pass a crate), -1 elsewhere; regions[] lists their tiles */
  reg: Int32Array;
  regions: number[][];
  /** per crate: the largest region beside it (-1 if none), its "own side" */
  home: number[];
  /** per crate: its turret tiles (free roadside tiles within two of it on its side of the road; any such free tile if there are none) */
  spots: number[][];
  /** turret tiles of every crate: no deposit goes there */
  keep: Uint8Array;
}
function ground(grid: ArrayLike<number>, crates: CrateSpot[]): Ground {
  const open = new Uint8Array(N), crate = new Uint8Array(N), side = new Uint8Array(N), keep = new Uint8Array(N);
  for (const c of crates) { const i = idx(c.cx, c.cz); if (i >= 0) crate[i] = 1; }
  for (let i = 0; i < N; i++) {
    if (grid[i] !== 0) continue;
    if (!crate[i]) open[i] = 1;
    if (NB[i].some((j) => grid[j] === 1)) side[i] = 1;
  }
  const reg = new Int32Array(N).fill(-1), regions: number[][] = [];
  for (let i = 0; i < N; i++) {
    if (!open[i] || reg[i] >= 0) continue;
    const list = [i]; reg[i] = regions.length;
    for (let k = 0; k < list.length; k++) for (const j of NB[list[k]]) if (open[j] && reg[j] < 0) { reg[j] = regions.length; list.push(j); }
    regions.push(list);
  }
  const home: number[] = [];
  const spots = crates.map((c) => {
    // (on the crate's side(s) of the road only: the regions it touches)
    const ci = idx(c.cx, c.cz), touch = new Set(ci >= 0 ? NB[ci].filter((j) => open[j]).map((j) => reg[j]) : []);
    home.push([...touch].sort((a, b) => regions[b].length - regions[a].length || a - b)[0] ?? -1);
    // (by walking, not by hex distance: a region can wrap round a road, as on a spiral, and a tile two hexes away across
    // the road is then in the same region but a long belt away)
    const first = ci >= 0 ? NB[ci].filter((j) => open[j]) : [], near = first.slice();
    for (const i of first) for (const j of NB[i]) if (open[j] && !near.includes(j) && hexDist(j % GW, (j / GW) | 0, c.cx, c.cz) <= 2) near.push(j);
    const s = near.filter((j) => side[j]);
    return s.length ? s : near;
  });
  for (const s of spots) for (const j of s) keep[j] = 1;
  return { grid, open, crate, side, reg, regions, home, spots, keep };
}
/** Steps over free deck (deposits included, crates and everything else not) from a set of tiles; -1 where it cannot go. */
function steps(G: Ground, from: number[], limit = 99): Int16Array {
  const D = new Int16Array(N).fill(-1), q: number[] = [];
  for (const i of from) if (G.open[i] && D[i] < 0) { D[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    if (D[i] >= limit) continue;
    for (const j of NB[i]) if (G.open[j] && D[j] < 0) { D[j] = D[i] + 1; q.push(j); }
  }
  return D;
}
/** True if the roadside around tile i (two tiles each way) is at most half covered by deposits. */
function sideFine(G: Ground, ore: ArrayLike<number>, i: number) {
  let w = 0, o = 0;
  for (const j of DISC2[i]) if (G.side[j] && !G.crate[j]) { w++; if (ore[j]) o++; }
  return o * 2 <= w;
}
/** Roadside tiles whose surroundings are more than half covered by deposits. */
function crowded(G: Ground, ore: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) if (G.side[i] && !G.crate[i] && !sideFine(G, ore, i)) out.push(i);
  return out;
}

/** A straight arm line (rule f), as tile indices: the mine's tile, the arms' tiles (from the mine on), the turret tile, and the direction from the mine to the turret. */
interface Line { m: number; arms: number[]; t: number; d: number }
/** The tiles of a straight line back from turret tile t against direction d: n arm tiles, then the mine tile; null if it leaves the board or crosses anything but free deck (no crate). */
function lineBack(G: Ground, t: number, d: number, n: number): Line | null {
  const back = (d + 3) % 6, arms: number[] = [];
  let i = t;
  for (let k = 0; k < n; k++) { i = NBD[i * 6 + back]; if (i < 0 || !G.open[i]) return null; arms.unshift(i); }
  const m = NBD[i * 6 + back];
  return m >= 0 && G.open[m] ? { m, arms, t, d } : null;
}
/** Every arm line on the board whose mine tile already holds iron: shorter lines first, then by turret tile and direction. */
function armLinesOf(G: Ground, O: ArrayLike<number>): Line[] {
  const IRON = oreVal('iron_ore'), out: Line[] = [];
  for (const n of [1, 2]) for (let t = 0; t < N; t++) {
    if (!G.open[t] || !G.side[t]) continue;
    for (let d = 0; d < 6; d++) { const l = lineBack(G, t, d, n); if (l && O[l.m] === IRON) out.push(l); }
  }
  return out;
}
/** Two lines that share no arm or turret tile (the mine may be shared). */
const apart = (a: Line, b: Line) => a.t !== b.t && !a.arms.includes(b.t) && !b.arms.includes(a.t) && !a.arms.some((i) => b.arms.includes(i));
/** True if some two of the lines are apart. */
function twoApart(L: Line[]): boolean { for (let i = 0; i < L.length; i++) for (let k = i + 1; k < L.length; k++) if (apart(L[i], L[k])) return true; return false; }

/**
 * Deposits for a map (rules a to f above). `grid`: the start grid (startGrid), `key`: what makes the layout differ between
 * maps (oreKey), `crates`: the run's supply crates (planCrates), `tier`: the map's tier, `core`: its core tile. Returns one value per tile:
 * 0 none, else 1 + the index in ORE_TYPES.
 */
export function makeDeposits(grid: ArrayLike<number>, key: string, crates: CrateSpot[] = [], tier = 2, core: [number, number] = [GW >> 1, GH >> 1]): Uint8Array {
  const G = ground(grid, crates), ore = new Uint8Array(N), r = mulberry(hashStr(key) ^ 0x0de905);
  const can = (i: number) => i >= 0 && G.open[i] === 1 && !G.keep[i] && !ore[i];
  /** place a deposit if the tile is free and the roadside around it stays at least half free */
  const put = (i: number, t: number) => {
    if (!can(i)) return false;
    ore[i] = t;
    if (G.side[i]) for (const j of DISC2[i]) if (G.side[j] && !G.crate[j] && !sideFine(G, ore, j)) { ore[i] = 0; return false; }
    return true;
  };
  const lonely = (i: number) => !NB[i].some((j) => ore[j]);
  /** seeds from a pool in a random order until a patch grows (a seed can fail: the roadside around it would be too full) */
  const seeded = (pool: number[], fn: (seed: number) => boolean) => {
    const a = pool.slice();
    for (let k = 0; k < a.length && k < 40; k++) {
      const j = k + Math.floor(r() * (a.length - k) * 0.999), t = a[j]; a[j] = a[k]; a[k] = t;
      if (fn(a[k])) return true;
    }
    return false;
  };
  /** grow a patch from a seed over free tiles (`ok` limits where it may spread); roadside tiles only now and then */
  const grow = (seed: number, t: number, size: number, ok: (i: number) => boolean = () => true) => {
    if (!put(seed, t)) return 0;
    const got = [seed];
    for (let k = 0; k < got.length && got.length < size; k++) {
      const o = Math.floor(r() * 6), nb = NB[got[k]];
      for (let d = 0; d < nb.length && got.length < size; d++) {
        const j = nb[(d + o) % nb.length];
        if (can(j) && ok(j) && (!G.side[j] || r() < 0.2) && put(j, t)) got.push(j);
      }
    }
    return got.length;
  };
  const IRON = oreVal('iron_ore'), COAL = oreVal('coal'), COPPER = oreVal('copper_ore'), OIL = oreVal('oil');
  const T = Math.max(1, Math.min(3, Math.round(tier) || 2));
  const SIZE: Record<OreType, number> = { iron_ore: T === 1 ? 5 : 4, coal: 4, copper_ore: T >= 3 ? 5 : 4, oil: T >= 3 ? 4 : 3 };
  // (bigger in big regions, smaller in small ones: a patch never takes more than a sixth of its region)
  const sizeIn = (o: OreType, n: number) => Math.max(2, Math.min(SIZE[o] + (n >= 150 ? 1 : 0), Math.floor(n / 6)));
  const patches = G.regions.map(() => ({ iron_ore: 0, copper_ore: 0, coal: 0, oil: 0 } as Record<OreType, number>));
  const placed = (o: OreType, ri: number, got: number) => { if (got) patches[ri][o]++; return got > 0; };

  // a. an iron patch close to each crate of iron ore, in its own region
  const ironCrates = crates.map((c, k) => ({ c, k })).filter((x) => x.c.it === 'iron_ore' && G.spots[x.k].length);
  for (const { c, k } of ironCrates) {
    const D = steps(G, G.spots[k]), reached: number[] = [];
    for (let i = 0; i < N; i++) if (D[i] >= 0) reached.push(i);
    if (reached.some((i) => ore[i] === IRON && D[i] <= BELT_REACH)) continue; // (another crate's patch already serves it)
    const at = (lo: number, hi: number, side: boolean) => reached.filter((i) => can(i) && D[i] >= lo && D[i] <= hi && (side || !G.side[i]));
    let c1 = at(1, 3, false);
    if (!c1.length) c1 = at(1, 4, true);
    if (!c1.length) c1 = at(1, BELT_REACH, true);
    // seeds one step back from the turret tiles first: a mine there feeds a turret straight away, or through one belt
    const best = c1.filter((i) => D[i] <= 2);
    for (const pool of [best, c1]) if (seeded(pool, (q) => placed('iron_ore', G.reg[q], grow(q, IRON, sizeIn('iron_ore', G.regions[G.reg[q]].length), (j) => D[j] >= 0 && D[j] <= BELT_REACH + 1)))) break;
    if (!ore.some((v, i) => v === IRON && D[i] >= 0 && D[i] <= BELT_REACH)) {
      // a crate in a pocket its own turret tiles fill: one of them (never the last) becomes a single tile of iron
      const sp = G.spots[k].filter((i) => !ore[i]);
      if (sp.length >= 2) { const q = sp[sp.length - 1]; G.keep[q] = 0; if (!placed('iron_ore', G.reg[q], put(q, IRON) ? 1 : 0)) G.keep[q] = 1; }
    }
  }
  // b. coal near each crate of iron ore (a short walk from its turret tiles), and at least somewhere in its region
  for (const { c, k } of ironCrates) {
    const D = steps(G, G.spots[k]), ri = G.home[k];
    if (ri < 0) continue;
    const cells = G.regions[ri];
    if (ore.some((v, i) => v === COAL && D[i] >= 0 && D[i] <= 9)) continue;
    const tries = [
      cells.filter((i) => can(i) && !G.side[i] && lonely(i) && D[i] >= 3 && D[i] <= 8),
      cells.filter((i) => can(i) && lonely(i) && D[i] >= 2 && D[i] <= 9),
    ];
    if (!patches[ri].coal) tries.push(cells.filter((i) => can(i) && lonely(i)), cells.filter(can));
    for (const c1 of tries) if (seeded(c1, (q) => placed('coal', ri, grow(q, COAL, sizeIn('coal', cells.length))))) break;
    if (!patches[ri].coal) {
      // a cramped strip with no room left beside the road: the far end of the crate's iron patch turns to coal
      const iron = cells.filter((i) => ore[i] === IRON && D[i] >= 0).sort((a, b) => D[b] - D[a] || a - b);
      if (iron.length >= 2) { ore[iron[0]] = COAL; patches[ri].coal++; }
    }
  }
  // f. the arm opening: an arm line for every crate of iron ore, and two apart somewhere on the map (no random draws here:
  // a map whose rules a and b already give the lines keeps exactly the deposits it had)
  const lineFor = (k: number, need: (l: Line) => boolean) => {
    const D = steps(G, G.spots[k]);
    const ok = (l: Line) => D[l.t] >= 0 && D[l.t] <= BELT_REACH && need(l);
    if (armLinesOf(G, ore).some(ok)) return true;
    // the best new line: fewest arms, an inland mine tile, nearest the crate's turret tiles
    const cand: [number, number, Line][] = [];
    for (const n of [1, 2]) for (let t = 0; t < N; t++) {
      if (!G.open[t] || !G.side[t] || D[t] < 0 || D[t] > BELT_REACH) continue;
      for (let d = 0; d < 6; d++) {
        const l = lineBack(G, t, d, n);
        if (l && can(l.m) && need(l)) cand.push([n * 100 + (G.side[l.m] ? 50 : 0) + D[t] * 2 + (l.arms.some((i) => ore[i]) ? 10 : 0), cand.length, l]);
      }
    }
    cand.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    // (a mine tile beside the road can be refused: it would crowd the roadside, see put)
    for (const [, , l] of cand) if (put(l.m, IRON)) return true;
    return false;
  };
  for (const { k } of ironCrates) lineFor(k, () => true);
  if (!twoApart(armLinesOf(G, ore))) {
    const have = armLinesOf(G, ore);
    for (const { k } of ironCrates) if (lineFor(k, (l) => !have.length || have.some((h) => apart(h, l)))) break;
  }
  // c. the rest, per region by size: counts grow with the region and the tier
  const farFromCore = (list: number[]) => {
    const dist = (i: number) => hexDist(i % GW, (i / GW) | 0, core[0], core[1]);
    const s = list.slice().sort((a, b) => dist(b) - dist(a) || a - b);
    return s.slice(0, Math.max(1, Math.ceil(s.length * 0.4)));
  };
  const want = (o: OreType, n: number) => {
    if (o === 'iron_ore') return n >= 18 ? 1 + Math.floor(n / 150) : 0;
    if (o === 'coal') return n >= 30 ? 1 + Math.floor(n / 220) : 0;
    if (o === 'copper_ore') return n >= 40 ? 1 + Math.floor(n / (T >= 3 ? 150 : 220)) : 0;
    return n >= 60 ? 1 + (T >= 2 && n >= 200 ? 1 : 0) : 0;
  };
  const order = G.regions.map((_, i) => i).sort((a, b) => G.regions[b].length - G.regions[a].length || a - b);
  const VAL: Record<OreType, number> = { iron_ore: IRON, copper_ore: COPPER, coal: COAL, oil: OIL };
  const patchIn = (ri: number, o: OreType, relaxed: boolean) => {
    const cells = G.regions[ri];
    let c1 = cells.filter((i) => can(i) && !G.side[i] && lonely(i) && NB[i].every((j) => !ore[j] || ore[j] === VAL[o]));
    if (!c1.length && relaxed) c1 = cells.filter((i) => can(i) && lonely(i));
    if (!c1.length && relaxed) c1 = cells.filter(can);
    if (o === 'oil') c1 = farFromCore(c1);
    return seeded(c1, (q) => placed(o, ri, grow(q, VAL[o], relaxed ? Math.min(3, sizeIn(o, cells.length)) : sizeIn(o, cells.length))));
  };
  for (const ri of order) {
    const n = G.regions[ri].length;
    for (const o of ['iron_ore', 'coal', 'copper_ore', 'oil'] as OreType[]) while (patches[ri][o] < want(o, n)) if (!patchIn(ri, o, false)) break;
  }
  // every map has every kind (oil preferably far from the core, see farFromCore)
  for (const o of ORE_TYPES) {
    if (ore.some((v) => v === VAL[o])) continue;
    for (const ri of order) if (patchIn(ri, o, true)) break;
  }
  return ore;
}

/** What makes one map's automatic deposits differ from another's: its roads, core, scenery and tier (not its name). */
export function oreKey(def: MapDef): string {
  return JSON.stringify([def.lanes, def.core, def.blocked, def.tier || 1]);
}
/** A deposit grid as a map's ore field: per kind (in ORE_TYPES order), its tiles in board order; kinds without tiles left out. */
export function oreLayout(ore: ArrayLike<number>): OreLayout {
  const out: OreLayout = {};
  for (const o of ORE_TYPES) {
    const v = oreVal(o), list: [number, number][] = [];
    for (let i = 0; i < N; i++) if (ore[i] === v) list.push([i % GW, (i / GW) | 0]);
    if (list.length) out[o] = list;
  }
  return out;
}
/** A map's ore field as a deposit grid. With `grid`/`crates`, tiles that are not free deck or that a crate takes are left out. */
export function layoutOre(layout: OreLayout, grid?: ArrayLike<number>, crates: CrateSpot[] = []): Uint8Array {
  const ore = new Uint8Array(N), crate = new Set(crates.map((c) => idx(c.cx, c.cz)));
  for (const o of ORE_TYPES) for (const p of layout[o] || []) {
    const i = Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) ? idx(p[0], p[1]) : -1;
    if (i < 0 || ore[i] || crate.has(i) || (grid && grid[i] !== 0)) continue;
    ore[i] = oreVal(o);
  }
  return ore;
}

export interface MapResources { grid: Uint8Array; crates: CrateSpot[]; ore: Uint8Array; auto: boolean }
/** The crates and deposits a run on this map starts with: the map's own layout if it has one, else the rules. */
export function mapResources(map: GameMap, auto = false): MapResources {
  const grid = startGrid(map), crates = planCrates(map, grid), def = map.def;
  const own = !auto && !!def.ore;
  const ore = own ? layoutOre(def.ore!, grid, crates) : makeDeposits(grid, oreKey(def), crates, def.tier || 1, def.core);
  return { grid, crates, ore, auto: !own };
}
/** The deposits the rules give a map (whatever its own ore field says), as an ore field. */
export function autoOre(def: MapDef): OreLayout {
  return oreLayout(mapResources(new GameMap(def), true).ore);
}

/** A straight Transfer Arm line from an iron deposit to a turret tile (rule f): mine, arms (from the mine on, each facing `dir`), turret. */
export interface ArmLine { mine: [number, number]; arms: [number, number][]; turret: [number, number]; dir: number }
const cell = (i: number): [number, number] => [i % GW, (i / GW) | 0];
const toArm = (l: Line): ArmLine => ({ mine: cell(l.m), arms: l.arms.map(cell), turret: cell(l.t), dir: l.d });
/**
 * The arm lines of a run on this map (rule f): `crates[k]` the lines of the k-th supply crate (empty for crates that are not
 * iron ore), nearest first; `all` every line on the board (one or two arms, shorter first). Uses the deposits a run gets.
 */
export function armLines(def: MapDef, ore?: ArrayLike<number>): { crates: ArmLine[][]; all: ArmLine[]; spots: CrateSpot[] } {
  const res = mapResources(new GameMap(def)), O = ore ?? res.ore, G = ground(res.grid, res.crates), L = armLinesOf(G, O);
  const crates = res.crates.map((c, k) => {
    if (c.it !== 'iron_ore') return [];
    const D = steps(G, G.spots[k]);
    return L.filter((l) => D[l.t] >= 0 && D[l.t] <= BELT_REACH).sort((a, b) => a.arms.length - b.arms.length || D[a.t] - D[b.t] || a.t - b.t || a.d - b.d).map(toArm);
  });
  return { crates, all: L.map(toArm), spots: res.crates };
}

export interface ResourceCheck {
  ok: boolean;
  /** what is wrong, in words for the player (empty when ok) */
  problems: string[];
  /** a tile each problem is about (for markers), or null */
  at: ([number, number] | null)[];
  crates: CrateSpot[];
  ore: Uint8Array;
}
const where = (i: number) => `col ${i % GW}, row ${(i / GW) | 0}`;
/**
 * Check a map's resources: the map's own ore field if it has one (or `ore`, a deposit grid, if given), else what the rules
 * give it. Problems: deposits on a road, scenery, a starting tower, a crate or off the board; a kind missing; a crate of
 * iron ore with no iron within BELT_REACH steps of its turret tiles on its own side of the road, or with no free turret
 * tile; a region with a crate of iron ore but no coal; roadside tiles more than half covered.
 */
export function checkResources(def: MapDef, ore?: ArrayLike<number>): ResourceCheck {
  const map = new GameMap(def), grid = startGrid(map), crates = planCrates(map, grid), G = ground(grid, crates);
  const problems: string[] = [], at: ([number, number] | null)[] = [];
  const say = (msg: string, i = -1) => { problems.push(msg); at.push(i >= 0 ? [i % GW, (i / GW) | 0] : null); };
  let O: Uint8Array;
  if (ore) O = Uint8Array.from(ore);
  else if (def.ore) {
    O = new Uint8Array(N);
    const seen = new Set<number>();
    for (const o of ORE_TYPES) for (const p of def.ore[o] || []) {
      const ok = Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && inBoard(p[0], p[1]);
      if (!ok) { say(`A ${o.replace('_ore', '')} deposit lies off the board.`); continue; }
      const i = idx(p[0], p[1]);
      if (seen.has(i)) { say(`Two deposits share ${where(i)}.`, i); continue; }
      seen.add(i); O[i] = oreVal(o);
    }
  } else O = makeDeposits(grid, oreKey(def), crates, def.tier || 1, def.core);
  for (let i = 0; i < N; i++) {
    if (!O[i]) continue;
    const g = grid[i];
    if (g === 1) say(`A deposit at ${where(i)} lies on a road or the core.`, i);
    else if (g === 3) say(`A deposit at ${where(i)} lies on scenery.`, i);
    else if (g === 2) say(`A deposit at ${where(i)} lies under a starting tower.`, i);
    else if (G.crate[i]) say(`A deposit at ${where(i)} lies on a supply crate's tile.`, i);
  }
  const NAMES: Record<OreType, string> = { iron_ore: 'iron', copper_ore: 'copper', coal: 'coal', oil: 'oil' };
  const usable = (i: number) => G.open[i] === 1;
  for (const o of ORE_TYPES) if (!O.some((v, i) => v === oreVal(o) && usable(i))) say(`The map has no ${NAMES[o]} deposit.`);
  const coalChecked = new Set<number>();
  crates.forEach((c, k) => {
    if (c.it !== 'iron_ore') return;
    const ci = idx(c.cx, c.cz), spots = G.spots[k].filter((i) => !O[i]);
    if (!spots.length) { say(`The iron ore crate at ${where(ci)} has no free tile beside the road for a turret.`, ci); return; }
    const D = steps(G, spots);
    if (!O.some((v, i) => v === oreVal('iron_ore') && D[i] >= 0 && D[i] <= BELT_REACH)) say(`No iron within a ${BELT_REACH}-tile belt of the iron ore crate at ${where(ci)} on its side of the road.`, ci);
    if (!armLinesOf(G, O).some((l) => D[l.t] >= 0 && D[l.t] <= BELT_REACH)) say(`No straight line iron deposit > Transfer Arm (one or two) > roadside turret tile within ${BELT_REACH} steps of the iron ore crate at ${where(ci)}.`, ci);
    const ri = G.home[k];
    if (ri >= 0 && !coalChecked.has(ri)) {
      coalChecked.add(ri);
      if (!G.regions[ri].some((i) => O[i] === oreVal('coal') && usable(i))) say(`No coal on the side of the road of the iron ore crate at ${where(ci)}.`, ci);
    }
  });
  if (crates.some((c) => c.it === 'iron_ore') && !twoApart(armLinesOf(G, O))) say('No room anywhere for two turrets fed by Transfer Arms from iron (two straight arm lines that share no tile).');
  const crowd = crowded(G, O), told: number[] = [];
  for (const i of crowd) {
    if (told.some((j) => hexDist(i % GW, (i / GW) | 0, j % GW, (j / GW) | 0) <= 4)) continue;
    told.push(i);
    if (told.length <= 3) say(`Deposits crowd the roadside around ${where(i)}: keep at least half of it free for towers.`, i);
  }
  return { ok: !problems.length, problems, at, crates, ore: O };
}
