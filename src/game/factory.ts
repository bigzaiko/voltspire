// BEATSPIRE factory: deposits, mines, conveyor belts, splitters, tunnels, pipes, power lines and the buildings that turn ore
// into tower ammunition and building materials. No rendering and no DOM: it runs inside the Sim, in the browser and in Node.
//
// Everything sits on the hex grid, one building per tile. Nothing has an output side: a building hands what it makes to
// a neighbour that needs it (a tower, another building), or to any belt beside it whose line leads to something that
// needs that item. Belts carry items one tile at a time; towers and buildings take what they need from a belt that points
// at them or simply runs past them ("taps" it), so one line can feed a row of towers, and a belt never fills up with things
// nobody on it wants. A belt pointing into another merges onto it, so one belt may carry several kinds of item.
// A Belt Splitter takes what belts bring into it and deals it out in turn to the belts leading away (or to a taker beside it).
// A Belt Tunnel pairs with the next tunnel facing the same way up to TUNNEL_REACH tiles ahead: items go under whatever
// stands between, roads included (nothing else may be built on a road). Fluids flow through pipe networks, and straight
// between neighbouring buildings; two Pipe Tunnels in a straight line join their networks. Power runs from generators over
// pole-to-pole wires to everything within reach of a pole.
//
// The factory only runs while a wave is on (the Sim does not step it between waves). So the player can see before calling
// a wave whether everything will be supplied, diagnose() works out statically what reaches what, and links() lists the
// belt, pipe and power connections for the view. Mines, plants and generators have levels (FAC_LVL_SPEED).
import { GW, GH, cellX, cellZ, FACS, ORE_TYPES, ITEM_TYPES, ITEMS, FLUIDS, MAKES, FAC_LVL_SPEED, needsOf } from './data.ts';
import type { FacType, ItemType, FluidType, OreType, Mods, TowerType } from './data.ts';
import { neighbor, hexDist, lineDir } from './hex.ts';

/** Seconds a mine takes per ore, crude oil a pumpjack pumps per second at full power (both at level 1, see FAC_LVL_SPEED). */
export const MINE_TIME = 3;
export const PUMP_RATE = 2;
/** Seconds a smelter takes per plate, and the plates one coal is good for. */
export const SMELT_TIME = 4;
export const COAL_SMELTS = 4;
/** Refinery: crude in, petrol out per batch, and seconds per batch. */
export const REFINE_IN = 10;
export const REFINE_OUT = 8;
export const REFINE_TIME = 4;
/** Generator: power at full load (level 1), and seconds of full load one coal gives. */
export const GEN_POWER = 10;
export const COAL_SECONDS = 12;
/** Belts: tiles per second (slow until Express Belts), and the closest two items may follow each other. */
export const BELT_SPEED = 0.7;
export const BELT_GAP = 0.5;
/** How far along a belt tile an item has to be before a tower or building beside the tile may take it. */
export const TAP_AT = 0.3;
/** Seconds between two items a supply crate hands out. */
export const CRATE_TIME = 0.6;
/** Power: how far (in tiles) a pole or generator wires to the next one, and how far it powers buildings and towers. */
export const POLE_REACH = 5;
export const SUPPLY = 2;
/** Fluid each pipe tile holds, the tanks of buildings, and the small tank of a tower (it really draws on its pipe). */
export const PIPE_CAP = 20;
export const TANK = 40;
export const TOWER_TANK = 12;
/** Items a building keeps waiting in its output, and ammunition items a tower keeps waiting (plus the item in use). */
export const OUT_CAP = 3;
export const TOWER_STOCK = 1;
/** The farthest apart (in tiles) the two ends of a Belt Tunnel or a Pipe Tunnel may be. */
export const TUNNEL_REACH = 4;
/** Items a splitter holds while it deals them out. */
export const SPLIT_CAP = 2;

export type FacState = 'ok' | 'idle' | 'nopower' | 'noinput' | 'nofuel' | 'full' | 'nodeposit' | 'empty';
/** An item on a belt. `c`: it came out of a supply crate (so it does not count as the player's own supply). */
export interface BeltItem { it: ItemType; p: number; c?: boolean }
export interface Fac {
  id: number; type: FacType; cx: number; cz: number; x: number; z: number;
  /** belts and belt tunnels: the direction (0..5, see HEX_DIRS) items leave by. Nothing else faces a way. */
  dir: number;
  /** input items waiting, output items waiting (oldest first), and the items of a belt (front first, p 0..1 along the tile),
   *  a splitter (p 0..0.5 to its centre) or a tunnel entrance (p 0..the tile distance to its exit) */
  inv: Partial<Record<ItemType, number>>; out: ItemType[]; items: BeltItem[];
  /** seconds into the current job, whether a job runs, and the ore a smelter is melting (or melted last) */
  prog: number; busy: boolean; cur: ItemType | null;
  /** smelter: plates left on the coal it burns; generator: seconds of full load left on its fuel */
  fuel: number;
  /** input and output tanks (in: crude for a refinery or cell plant, petrol for a missile works; out: a pumpjack's crude, a refinery's petrol) */
  tin: number; tout: number;
  /** power satisfaction 0..1 last step, and the network ids (pipe network for pipes and pipe tunnels, power network for poles and generators, -1 none) */
  pwr: number; net: number;
  /** generator: power it delivered last step (for the panel) */
  gen: number;
  state: FacState;
  /** credits paid into it (building and upgrades) */
  spent: number;
  /** round robin over the six sides for the output (a splitter: for the side it serves next) */
  rr: number;
  /** the deposit under a mine or pumpjack */
  ore: OreType | null;
  /** supply crate: what it holds and how many are left */
  hold: ItemType | null; left: number;
  /** level 1..3 (see FAC_LVL_SPEED; only FAC_UPGRADABLE types go past 1) */
  lvl: number;
  /** tunnels: the id of the other end (0 while unpaired) and whether this is the exit end (a belt tunnel; pipe tunnels have no ends) */
  pair: number; exit: boolean;
  /** @deprecated the Underpass is gone (tunnels replace it): always false */
  under: boolean;
}

/** What the factory feeds in a tower (the Sim's Tower carries these fields). */
export interface Supplied {
  id: number; type: TowerType; cx: number; cz: number; lvl: number;
  /** ammunition items waiting, shots left of the item in use, fluid in the tank, power satisfaction 0..1 */
  stock: number; ammo: number; tank: number; pwr: number;
}
/** What the factory needs from the Sim. */
export interface FacHost {
  grid: Uint8Array;
  mods: Mods;
  towers: Supplied[];
  addMats(n: number): void;
  events: { k: string; [key: string]: unknown }[];
}
/**
 * Supply diagnosis of a building or tower (see Factory.diagnose). `missing`: short phrases for what it will not get
 * ("iron ore", "coal", "power", "crude oil", "a taker for its output"); `from`: what will feed it ("Mine (by belt)",
 * "Generator", "pipe network with a Pumpjack").
 */
export interface Diag { ok: boolean; missing: string[]; from: string[] }
/**
 * A supply connection for the view: a belt tile (or splitter, or tunnel exit) to each tower or building that takes from it,
 * a pipe tile to each consumer beside it that draws from its network, a pole or generator to each thing it powers.
 * `from` is the fac id at x, z; `to` the taker at tx, tz ('t' + tower id or 'f' + fac id).
 */
export interface Link { kind: 'belt' | 'pipe' | 'power'; from: number; x: number; z: number; tx: number; tz: number; to: string }

/** Buildings that face a way (belts and belt tunnels: R turns them). */
export const turns = (t: FacType) => t === 'belt' || t === 'tunnel';
/** Pipes and pipe tunnels: both are part of a pipe network. */
export const pipeLike = (t: FacType) => t === 'pipe' || t === 'ptunnel';
/** Belts, splitters and belt tunnels: they move items, nothing takes from them but towers and buildings. */
const conveyor = (t: FacType) => t === 'belt' || t === 'splitter' || t === 'tunnel';
const idx = (cx: number, cz: number) => (Number.isInteger(cx) && Number.isInteger(cz) && cx >= 0 && cz >= 0 && cx < GW && cz < GH ? cz * GW + cx : -1);
const BIT = Object.fromEntries(ITEM_TYPES.map((t, i) => [t, 1 << i])) as Record<ItemType, number>;
const FLUID_IN: Partial<Record<FacType, FluidType>> = { refinery: 'crude', cells: 'crude', missiles: 'petrol' };
const FLUID_OUT: Partial<Record<FacType, FluidType>> = { pump: 'crude', refinery: 'petrol' };
const spd = (f: Fac) => FAC_LVL_SPEED[Math.max(0, Math.min(FAC_LVL_SPEED.length - 1, f.lvl - 1))];
/** The items a building takes in (a bit per item type, see BIT). */
function wantsOf(type: FacType): number {
  if (type === 'smelter') return BIT.iron_ore | BIT.copper_ore | BIT.coal;
  if (type === 'generator') return BIT.coal;
  const r = MAKES[type];
  let m = 0;
  if (r) for (const k in r.inp) m |= BIT[k as ItemType];
  return m;
}
const WANTS = Object.fromEntries(Object.keys(FACS).map((t) => [t, wantsOf(t as FacType)])) as Record<FacType, number>;
const fluidName = (f: FluidType) => FLUIDS[f].name.toLowerCase();

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

/**
 * Deposits for a map: patches of iron, copper and coal in every stretch of free deck that roads do not cut off (belts only
 * cross a road through a tunnel), and oil in the larger ones (at least one oil field per map). Deterministic: the same map gives the same
 * deposits. Tiles right beside a road are left free where possible, they are the best places for towers.
 * Returns one value per tile: 0 none, else 1 + the index in ORE_TYPES.
 */
export function makeDeposits(grid: ArrayLike<number>, key: string): Uint8Array {
  const ore = new Uint8Array(GW * GH), r = mulberry(hashStr(key) ^ 0x0de905);
  const free = (i: number) => i >= 0 && grid[i] === 0 && ore[i] === 0;
  // tiles next to a road
  const nearRoad = new Uint8Array(GW * GH);
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (grid[cz * GW + cx] !== 1) continue;
    for (let d = 0; d < 6; d++) { const [nx, nz] = neighbor(cx, cz, d), j = idx(nx, nz); if (j >= 0) nearRoad[j] = 1; }
  }
  // regions of free deck
  const reg = new Int32Array(GW * GH).fill(-1), regions: number[][] = [];
  for (let i = 0; i < GW * GH; i++) {
    if (grid[i] !== 0 || reg[i] >= 0) continue;
    const list = [i]; reg[i] = regions.length;
    for (let k = 0; k < list.length; k++) {
      const cx = list[k] % GW, cz = Math.floor(list[k] / GW);
      for (let d = 0; d < 6; d++) { const [nx, nz] = neighbor(cx, cz, d), j = idx(nx, nz); if (j >= 0 && grid[j] === 0 && reg[j] < 0) { reg[j] = regions.length; list.push(j); } }
    }
    regions.push(list);
  }
  // one step back from the road: close enough for a short belt to a turret, and it leaves the roadside tiles free
  const second = new Uint8Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) {
    if (grid[i] !== 0 || nearRoad[i]) continue;
    const cx = i % GW, cz = Math.floor(i / GW);
    for (let d = 0; d < 6; d++) { const [nx, nz] = neighbor(cx, cz, d), j = idx(nx, nz); if (j >= 0 && nearRoad[j]) second[i] = 1; }
  }
  const patch = (cells: number[], type: number, size: number, close = false) => {
    // a seed tile away from the road if there is one (`close`: one step back from it), then grow over free tiles
    const near = close ? cells.filter((i) => free(i) && second[i]) : [];
    const away = near.length ? near : cells.filter((i) => free(i) && !nearRoad[i]), pool = away.length ? away : cells.filter(free);
    if (!pool.length) return false;
    const start = pool[Math.floor(r() * pool.length * 0.999)], got = [start];
    ore[start] = type;
    for (let k = 0; k < got.length && got.length < size; k++) {
      const cx = got[k] % GW, cz = Math.floor(got[k] / GW), o = Math.floor(r() * 6);
      for (let d = 0; d < 6 && got.length < size; d++) {
        const [nx, nz] = neighbor(cx, cz, d + o), j = idx(nx, nz);
        if (free(j) && (!nearRoad[j] || r() < 0.25)) { ore[j] = type; got.push(j); }
      }
    }
    return true;
  };
  const T = (o: OreType) => ORE_TYPES.indexOf(o) + 1;
  const order = regions.map((_, i) => i).sort((a, b) => regions[b].length - regions[a].length);
  let oil = false;
  for (const ri of order) {
    const cells = regions[ri], n = cells.length;
    if (n < 10) continue;
    // (the first iron patch lies close to the road: the first turrets are fed straight from a mine)
    patch(cells, T('iron_ore'), 5, true);
    patch(cells, T('coal'), 4);
    patch(cells, T('copper_ore'), 4);
    if (n >= 45) { patch(cells, T('iron_ore'), 4); patch(cells, T('coal'), 3); }
    if (n >= 70) patch(cells, T('copper_ore'), 3);
    if (n >= 40 || !oil) { if (patch(cells, T('oil'), 3)) oil = true; }
  }
  return ore;
}

function newFac(id: number, type: FacType, cx: number, cz: number, dir: number, spent: number, ore: OreType | null): Fac {
  return {
    id, type, cx, cz, x: cellX(cx, cz), z: cellZ(cz), dir: ((dir % 6) + 6) % 6, inv: {}, out: [], items: [], prog: 0, busy: false, cur: null,
    fuel: 0, tin: 0, tout: 0, pwr: 0, net: -1, gen: 0, state: 'idle', spent, rr: 0, ore, hold: null, left: 0, lvl: 1, pair: 0, exit: false, under: false,
  };
}

interface PipeNet { id: number; pipes: Fac[]; fluid: FluidType | null; amt: number; cap: number; prod: Fac[]; cons: Fac[]; towers: Supplied[]; forced: FluidType | null }
/**
 * A power grid. cap / demand / sat: power the fuelled generators give, power asked for, and the share of it met (last step
 * of a wave). potential: what every generator would give with fuel; full: what everything on the grid asks for when it all
 * runs (both kept up to date while time stands still, for the HUD).
 */
interface PowerNet { id: number; nodes: Fac[]; cons: Fac[]; towers: Supplied[]; cap: number; demand: number; sat: number; potential: number; full: number }
/** What reaches a tile statically (see diagnose): item bits, and per item the names of what will feed it. */
interface Reach { bits: number; names: Map<ItemType, Set<string>> }

export class Factory {
  facs: Fac[] = [];
  /** fac id per tile (0 for none) */
  at = new Int32Array(GW * GH);
  /** deposit per tile: 0 none, else 1 + index in ORE_TYPES */
  ore: Uint8Array;
  /** power wires between poles / generators, as pairs of fac ids (for the view) */
  wires: [number, number][] = [];
  pipeNets: PipeNet[] = [];
  powerNets: PowerNet[] = [];
  /** set whenever a building or a tower comes, goes or changes level: the networks are worked out again before they are next used */
  dirty = true;
  /** counts up with every change to the layout, the towers' included (the view redraws its belts, pipes and links when it moves) */
  rev = 0;
  /** items towers have been handed that did not come out of a supply crate (the tutorial watches it) */
  delivered = 0;
  private nid = 1;
  private byId = new Map<number, Fac>();
  private towerAt = new Map<number, Supplied>();
  /** per belt id: the tiles beside it that hold something that takes items, and per conveyor the items its line still leads to a taker for */
  private taps = new Map<number, number[]>();
  private want = new Map<number, number>();
  /** per belt or tunnel entrance id: the producer that loaded it last, and the producers waiting to load it (with the step they last tried) */
  private lastLoad = new Map<number, number>();
  private loadWait = new Map<number, Map<number, number>>();
  private ticks = 0;
  /** per building / tower key ('f' + id, 't' + id): the pipe networks it hangs on, and the pole or generator that powers it */
  private pipeOf = new Map<string, PipeNet[]>();
  private powerBy = new Map<string, Fac>();
  private diagKey = ''; private diagMap = new Map<string, Diag>();
  private linkRev = -1; private linkList: Link[] = [];
  private host: FacHost;

  constructor(host: FacHost, ore: Uint8Array) { this.host = host; this.ore = ore; }

  oreAt(cx: number, cz: number): OreType | null { const i = idx(cx, cz); return i >= 0 && this.ore[i] ? ORE_TYPES[this.ore[i] - 1] : null; }
  facById(id: number) { return this.byId.get(id); }
  facAt(cx: number, cz: number) { const i = idx(cx, cz); return i >= 0 && this.at[i] ? this.byId.get(this.at[i]) : undefined; }
  private facAtI(j: number) { return j >= 0 && this.at[j] ? this.byId.get(this.at[j]) : undefined; }

  /** Why a building cannot go on a tile ('' if it can). The credits and the unlocks are the Sim's business. */
  placeBlock(type: FacType, cx: number, cz: number): string {
    const i = idx(cx, cz);
    if (i < 0) return 'off the grid';
    if (this.at[i]) return 'taken';
    const g = this.host.grid[i];
    if (g === 1) return 'road: Belt and Pipe Tunnels pass under it';
    if (g === 3) return 'wreckage';
    if (g !== 0) return 'taken';
    const o = this.oreAt(cx, cz);
    if (type === 'mine' && (!o || o === 'oil')) return 'needs an iron, copper or coal deposit';
    if (type === 'pump' && o !== 'oil') return 'needs an oil field';
    return '';
  }
  place(type: FacType, cx: number, cz: number, dir: number, spent: number): Fac | null {
    if (!Object.hasOwn(FACS, type) || this.placeBlock(type, cx, cz)) return null;
    const f = newFac(this.nid++, type, cx, cz, dir, spent, this.oreAt(cx, cz));
    const i = idx(cx, cz);
    this.facs.push(f); this.byId.set(f.id, f);
    this.at[i] = f.id;
    this.host.grid[i] = 2;
    this.dirty = true; this.rev++;
    return f;
  }
  /** A supply crate on a free tile, holding n of an item. */
  placeCrate(cx: number, cz: number, it: ItemType, n: number): Fac | null {
    const f = this.place('crate', cx, cz, 0, 0);
    if (f) { f.hold = it; f.left = n; }
    return f;
  }
  remove(id: number): Fac | null {
    const k = this.facs.findIndex((f) => f.id === id);
    if (k < 0) return null;
    const f = this.facs[k];
    this.facs.splice(k, 1); this.byId.delete(id);
    const i = idx(f.cx, f.cz);
    this.at[i] = 0;
    this.host.grid[i] = 0;
    this.dirty = true; this.rev++;
    return f;
  }
  /** Turn a belt or a belt tunnel. */
  rotate(id: number, dir: number) {
    const f = this.byId.get(id);
    if (!f || !turns(f.type) || !Number.isFinite(dir)) return;
    const d = ((Math.floor(dir) % 6) + 6) % 6;
    if (d !== f.dir) { f.dir = d; this.dirty = true; this.rev++; }
  }
  /** Work the networks out again if anything changed, and bring the grids' potential / full up to date. Cheap when nothing did. */
  sync() {
    if (this.dirty) this.rebuild();
    const m = this.host.mods;
    for (const net of this.powerNets) {
      let pot = 0, full = 0;
      for (const g of net.nodes) if (g.type === 'generator') pot += GEN_POWER * m.gen * spd(g);
      for (const f of net.cons) full += FACS[f.type].power || 0;
      for (const t of net.towers) full += needsOf(t).power || 0;
      net.potential = pot; net.full = full;
    }
  }

  // ---------- networks ----------
  /** The items whatever stands on tile j takes in (a bit per item type): a building's inputs, a tower's ammunition. */
  private wantsAt(j: number): number {
    const q = this.facAtI(j);
    if (q) return conveyor(q.type) ? 0 : WANTS[q.type];
    const t = this.towerAt.get(j), it = t && needsOf(t).item;
    return it ? BIT[it] : 0;
  }
  /** True if belt b points at tile (cx, cz). */
  private pointsAt(b: Fac, cx: number, cz: number) { const [x, z] = neighbor(b.cx, b.cz, b.dir); return x === cx && z === cz; }
  /** True if a tunnel is an entrance items may be fed into from tile (cx, cz): paired, and that tile is not the one in front of it. */
  private entranceFrom(q: Fac, cx: number, cz: number) { return q.type === 'tunnel' && q.pair > 0 && !q.exit && !this.pointsAt(q, cx, cz); }
  /** The items a conveyor's line still leads to a taker for: what stands beside a belt and beside everything after it. */
  private wantOf(c: Fac, seen: Set<number>): number {
    const have = this.want.get(c.id);
    if (have !== undefined) return have;
    if (seen.has(c.id)) return 0; // a loop of belts (rebuild() goes round it again until nothing changes)
    seen.add(c.id);
    const m = this.wantHere(c, seen);
    this.want.set(c.id, m);
    return m;
  }
  /** wantOf() of one conveyor from what its neighbours are known to want so far. */
  private wantHere(c: Fac, seen: Set<number>): number {
    let m = 0;
    if (c.type === 'belt') {
      for (const j of this.taps.get(c.id) || []) m |= this.wantsAt(j);
      m |= this.wantAhead(c, seen);
    } else if (c.type === 'tunnel') {
      const e = c.pair && !c.exit ? this.byId.get(c.pair) : undefined;
      if (e) m = this.wantAhead(e, seen);
    } else if (c.type === 'splitter') for (let d = 0; d < 6; d++) m |= this.wantSide(c, d, seen);
    return m;
  }
  /** What the tile in front of a belt (or tunnel exit) leads to. */
  private wantAhead(b: Fac, seen: Set<number>): number {
    const [nx, nz] = neighbor(b.cx, b.cz, b.dir), j = idx(nx, nz), q = this.facAtI(j);
    if (j < 0) return 0;
    if (!q) return this.wantsAt(j);
    if (q.type === 'belt') return this.pointsAt(q, b.cx, b.cz) ? 0 : this.wantOf(q, seen);
    if (q.type === 'splitter') return this.wantOf(q, seen);
    if (q.type === 'tunnel') return this.entranceFrom(q, b.cx, b.cz) ? this.wantOf(q, seen) : 0;
    return this.wantsAt(j);
  }
  /** What one side of a splitter leads to: a belt or tunnel leading away, or a taker beside it. */
  private wantSide(s: Fac, d: number, seen: Set<number>): number {
    const [nx, nz] = neighbor(s.cx, s.cz, d), j = idx(nx, nz), q = this.facAtI(j);
    if (j < 0) return 0;
    if (!q) return this.wantsAt(j);
    if (q.type === 'belt') return this.pointsAt(q, s.cx, s.cz) ? 0 : this.wantOf(q, seen);
    if (q.type === 'tunnel') return this.entranceFrom(q, s.cx, s.cz) ? this.wantOf(q, seen) : 0;
    if (q.type === 'splitter') return 0; // (splitters do not hand on to each other: no ping-pong)
    return this.wantsAt(j);
  }
  /** Pair the tunnels: a belt tunnel with the first unpaired one facing the same way within reach ahead, pipe tunnels nearest first in a straight line. */
  private pairTunnels() {
    const tun = this.facs.filter((f) => f.type === 'tunnel'), pt = this.facs.filter((f) => f.type === 'ptunnel');
    for (const f of tun) { f.pair = 0; f.exit = false; }
    for (const f of pt) { f.pair = 0; f.exit = false; }
    const sameAt = (f: Fac, d: number, k: number) => {
      let c: [number, number] = [f.cx, f.cz];
      for (let i = 0; i < k; i++) c = neighbor(c[0], c[1], d);
      const q = this.facAt(c[0], c[1]);
      return q && q.type === 'tunnel' && q.dir === f.dir && !q.pair ? q : undefined;
    };
    // the upstream-most unpaired tunnel of a row pairs first, so a row A B C pairs A with B and leaves C for the next one
    for (let changed = true; changed;) {
      changed = false;
      for (const a of tun) {
        if (a.pair) continue;
        let behind = false;
        for (let k = 1; k <= TUNNEL_REACH && !behind; k++) if (sameAt(a, (a.dir + 3) % 6, k)) behind = true;
        if (behind) continue;
        for (let k = 1; k <= TUNNEL_REACH; k++) {
          const b = sameAt(a, a.dir, k);
          if (b) { a.pair = b.id; b.pair = a.id; b.exit = true; changed = true; break; }
        }
      }
    }
    const pairs: [Fac, Fac, number][] = [];
    for (let i = 0; i < pt.length; i++) for (let k = i + 1; k < pt.length; k++) {
      const a = pt[i], b = pt[k], d = hexDist(a.cx, a.cz, b.cx, b.cz);
      // (two side by side already join as pipes: pairing them would leave the ends of two crossings in a row unpaired)
      if (d >= 2 && d <= TUNNEL_REACH && lineDir(a.cx, a.cz, b.cx, b.cz) >= 0) pairs.push([a, b, d]);
    }
    pairs.sort((p, q) => p[2] - q[2] || p[0].id - q[0].id || p[1].id - q[1].id);
    for (const [a, b] of pairs) if (!a.pair && !b.pair) { a.pair = b.id; b.pair = a.id; }
    // items in a tunnel that lost its exit are lost; a shorter tunnel squeezes them
    for (const f of tun) {
      if (!f.pair || f.exit) { f.items.length = 0; continue; }
      const e = this.byId.get(f.pair)!, len = hexDist(f.cx, f.cz, e.cx, e.cz);
      for (const it of f.items) it.p = Math.min(it.p, len);
    }
  }
  private rebuild() {
    this.dirty = false; this.rev++;
    this.towerAt.clear();
    for (const t of this.host.towers) this.towerAt.set(t.cz * GW + t.cx, t);
    this.pairTunnels();
    // belts: who stands beside each one, and what every line is good for
    this.taps.clear(); this.want.clear(); this.lastLoad.clear(); this.loadWait.clear();
    for (const b of this.facs) {
      if (b.type !== 'belt') continue;
      const list: number[] = [];
      for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(b.cx, b.cz, d), j = idx(nx, nz);
        if (j >= 0 && this.wantsAt(j)) list.push(j);
      }
      this.taps.set(b.id, list);
    }
    for (const b of this.facs) if (conveyor(b.type)) this.wantOf(b, new Set());
    // a loop of belts was cut where it closed, so what it leads to may be short on the way back: go round until it settles
    // (every conveyor is known by now, so each pass looks one tile ahead; it only ever adds bits)
    const conv = this.facs.filter((b) => conveyor(b.type));
    for (let changed = true; changed;) {
      changed = false;
      for (const c of conv) {
        const was = this.want.get(c.id)!, m = was | this.wantHere(c, new Set());
        if (m !== was) { this.want.set(c.id, m); changed = true; }
      }
    }
    // pipe networks: pipes (and paired pipe tunnels) joined to each other; buildings and towers beside a pipe hang on its network
    const old = new Map<Fac, PipeNet>();
    for (const n of this.pipeNets) for (const p of n.pipes) old.set(p, n);
    this.pipeNets = []; this.pipeOf.clear();
    const hang = (key: string, n: PipeNet) => { const l = this.pipeOf.get(key); if (!l) this.pipeOf.set(key, [n]); else if (!l.includes(n)) l.push(n); };
    for (const f of this.facs) f.net = -1;
    for (const f of this.facs) {
      if (!pipeLike(f.type) || f.net >= 0) continue;
      const net: PipeNet = { id: this.pipeNets.length, pipes: [f], fluid: null, amt: 0, cap: 0, prod: [], cons: [], towers: [], forced: null };
      f.net = net.id;
      for (let k = 0; k < net.pipes.length; k++) {
        const p = net.pipes[k];
        for (let d = 0; d < 6; d++) {
          const [nx, nz] = neighbor(p.cx, p.cz, d), q = this.facAt(nx, nz);
          if (q && pipeLike(q.type) && q.net < 0) { q.net = net.id; net.pipes.push(q); }
        }
        const o = p.type === 'ptunnel' && p.pair ? this.byId.get(p.pair) : undefined;
        if (o && o.net < 0) { o.net = net.id; net.pipes.push(o); }
      }
      net.cap = net.pipes.length * PIPE_CAP;
      // the fluid already in these pipes stays (shared out when networks were split or joined)
      const seen = new Set<PipeNet>();
      for (const p of net.pipes) { const o = old.get(p); if (o && !seen.has(o)) { seen.add(o); if (o.fluid && o.amt > 0) { if (!net.fluid) net.fluid = o.fluid; if (net.fluid === o.fluid) net.amt += o.amt * (o.pipes.filter((q) => q.net === net.id).length / Math.max(1, o.pipes.length)); } } }
      net.amt = Math.min(net.amt, net.cap);
      const att = new Set<number>(), atTw = new Set<number>();
      for (const p of net.pipes) for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(p.cx, p.cz, d), j = idx(nx, nz);
        if (j < 0) continue;
        const q = this.facAtI(j);
        if (q && !pipeLike(q.type) && !att.has(q.id) && (FLUID_OUT[q.type] || FLUID_IN[q.type])) {
          att.add(q.id); hang('f' + q.id, net);
          if (FLUID_OUT[q.type]) net.prod.push(q);
          if (FLUID_IN[q.type]) net.cons.push(q);
        }
        const t = this.towerAt.get(j);
        if (t && needsOf(t).fluid && !atTw.has(t.id)) { atTw.add(t.id); net.towers.push(t); hang('t' + t.id, net); }
      }
      // what the network carries: crude if a pumpjack feeds it, else petrol if a refinery does, else whatever is in it
      net.forced = net.prod.some((q) => q.type === 'pump') ? 'crude' : net.prod.some((q) => q.type === 'refinery') ? 'petrol' : null;
      if (net.forced && net.fluid !== net.forced) { net.fluid = net.forced; net.amt = 0; }
      this.pipeNets.push(net);
    }
    // power networks: poles and generators wired to each other within POLE_REACH
    this.powerNets = []; this.wires = []; this.powerBy.clear();
    const nodes = this.facs.filter((f) => f.type === 'pole' || f.type === 'generator');
    for (const a of nodes) {
      if (a.net >= 0) continue;
      const net: PowerNet = { id: this.powerNets.length, nodes: [a], cons: [], towers: [], cap: 0, demand: 0, sat: 0, potential: 0, full: 0 };
      a.net = net.id;
      for (let k = 0; k < net.nodes.length; k++) {
        const p = net.nodes[k];
        for (const q of nodes) if (q.net < 0 && hexDist(p.cx, p.cz, q.cx, q.cz) <= POLE_REACH) { q.net = net.id; net.nodes.push(q); }
      }
      this.powerNets.push(net);
    }
    // wires: each node to its nearest partner already wired (a tree, no clutter)
    for (const net of this.powerNets) {
      const inTree = new Set<number>([net.nodes[0].id]);
      while (inTree.size < net.nodes.length) {
        let best: [Fac, Fac] | null = null, bd = Infinity;
        for (const a of net.nodes) {
          if (!inTree.has(a.id)) continue;
          for (const b of net.nodes) {
            if (inTree.has(b.id)) continue;
            const d = hexDist(a.cx, a.cz, b.cx, b.cz);
            if (d <= POLE_REACH && d < bd) { bd = d; best = [a, b]; }
          }
        }
        if (!best) break;
        inTree.add(best[1].id); this.wires.push([best[0].id, best[1].id]);
      }
    }
    // consumers: powered by the nearest pole or generator within SUPPLY (and so by its network)
    for (const f of this.facs) {
      if (!FACS[f.type].power) continue;
      const n = this.nodeNear(f.cx, f.cz);
      if (n) { this.powerNets[n.net].cons.push(f); this.powerBy.set('f' + f.id, n); } else f.pwr = 0;
    }
    for (const t of this.host.towers) {
      if (!needsOf(t).power) { t.pwr = 0; continue; }
      const n = this.nodeNear(t.cx, t.cz);
      if (n) { this.powerNets[n.net].towers.push(t); this.powerBy.set('t' + t.id, n); } else t.pwr = 0;
    }
  }
  /** The pole or generator nearest to a tile within SUPPLY (the lowest id on a tie), if any. */
  private nodeNear(cx: number, cz: number): Fac | undefined {
    let best: Fac | undefined, bd = Infinity;
    for (const net of this.powerNets) for (const n of net.nodes) {
      const d = hexDist(n.cx, n.cz, cx, cz);
      if (d <= SUPPLY && (d < bd || (d === bd && best && n.id < best.id))) { bd = d; best = n; }
    }
    return best;
  }

  /** The power network a tile is supplied from, or -1. */
  powerAt(cx: number, cz: number): number {
    this.sync();
    const n = this.nodeNear(cx, cz);
    return n ? n.net : -1;
  }
  /** Which of the six sides of a pipe or pipe tunnel connect (to a pipe, a fluid building or a fluid tower): a bit per direction. */
  pipeMask(f: Fac): number {
    if (this.dirty) this.rebuild();
    let m = 0;
    for (let d = 0; d < 6; d++) {
      const [nx, nz] = neighbor(f.cx, f.cz, d), j = idx(nx, nz);
      if (j < 0) continue;
      const q = this.facAtI(j);
      if (q && (pipeLike(q.type) || FLUID_OUT[q.type] || FLUID_IN[q.type])) m |= 1 << d;
      else { const t = this.towerAt.get(j); if (t && needsOf(t).fluid) m |= 1 << d; }
    }
    return m;
  }
  pipeFluid(f: Fac): { fluid: FluidType | null; fill: number } {
    const n = this.pipeNets[f.net];
    return n ? { fluid: n.fluid, fill: n.cap > 0 ? n.amt / n.cap : 0 } : { fluid: null, fill: 0 };
  }
  powerNet(id: number) { return this.powerNets[id]; }
  /** The fluid a building draws. */
  fluidIn(f: Fac): FluidType | null { return FLUID_IN[f.type] || null; }

  // ---------- items ----------
  /** How many of an item a building would still take. (Small: what it waits for stays on the belts, where it can be seen.) */
  private room(f: Fac, it: ItemType): number {
    const have = f.inv[it] || 0;
    if (f.type === 'smelter') {
      if (it === 'coal') return 2 - have;
      // (each ore has its own room, so a smelter fed both kinds keeps making both)
      if (it === 'iron_ore' || it === 'copper_ore') return 2 - have;
      return 0;
    }
    if (f.type === 'generator') return it === 'coal' ? 2 - have : 0;
    const r = MAKES[f.type], need = r && r.inp[it];
    return need ? Math.max(2, need * 2) - have : 0;
  }
  /** Hand an item to whatever stands on tile j (not a conveyor). Returns the taker (a building or a tower), or null. */
  private give(j: number, it: ItemType, crate = false): Fac | Supplied | null {
    const q = this.facAtI(j);
    if (q) {
      if (conveyor(q.type) || this.room(q, it) <= 0) return null;
      q.inv[it] = (q.inv[it] || 0) + 1;
      return q;
    }
    const t = this.towerAt.get(j);
    if (t && needsOf(t).item === it && t.stock < TOWER_STOCK) { t.stock++; if (!crate) this.delivered++; return t; }
    return null;
  }
  /** A tower or building takes an item off a conveyor tile `from`: hand it over and tell the view ('take'). */
  private take(from: Fac, j: number, it: BeltItem): boolean {
    const q = this.give(j, it.it, it.c);
    if (!q) return false;
    const tw = this.byId.get(q.id) !== q; // (fac ids and tower ids are counted apart)
    const x = cellX(q.cx, q.cz), z = cellZ(q.cz);
    this.host.events.push({ k: 'take', x: from.x, z: from.z, tx: x, tz: z, it: it.it, id: q.id, who: (tw ? 't' : 'f') + q.id });
    return true;
  }
  /** Put an item on a belt (or into a tunnel entrance) at its start, if there is room there. */
  private onBelt(b: Fac, it: ItemType, crate = false): boolean {
    const last = b.items[b.items.length - 1];
    if (last && last.p < BELT_GAP) return false;
    b.items.push(crate ? { it, p: 0, c: true } : { it, p: 0 });
    return true;
  }
  /**
   * How many more of an item what stands on tile j will take before long: a building's room for it (see room()), a tower's
   * free stock plus one (the item in use runs out).
   */
  private need(j: number, it: ItemType): number {
    const q = this.facAtI(j);
    if (q) return conveyor(q.type) ? 0 : Math.max(0, this.room(q, it));
    const t = this.towerAt.get(j);
    return t && needsOf(t).item === it ? Math.max(0, TOWER_STOCK - t.stock) + 1 : 0;
  }
  /**
   * True if loading one more of an item onto conveyor c would only clog a merged line: the line also leads to takers of other
   * items, and it already carries as many of this one as its takers will take (see need()). Without this the producer first
   * in line fills every free slot, and what its takers cannot take yet queues up in front of the takers of the other kinds.
   */
  private glut(c: Fac, it: ItemType): boolean {
    const bit = BIT[it];
    if (!((this.want.get(c.id) || 0) & ~bit)) return false; // a line for this item alone keeps its queue
    const seen = new Set<number>([c.id]), list = [c], takers = new Set<number>();
    let carried = 0;
    const next = (from: Fac, j: number) => {
      const q = this.facAtI(j);
      if (!q) { if (this.wantsAt(j) & bit) takers.add(j); return; }
      if (!conveyor(q.type)) { if (WANTS[q.type] & bit) takers.add(j); return; }
      const on = q.type === 'belt' ? !this.pointsAt(q, from.cx, from.cz) : q.type === 'splitter' ? from.type !== 'splitter' : this.entranceFrom(q, from.cx, from.cz);
      if (on && (this.want.get(q.id) || 0) & bit && !seen.has(q.id)) { seen.add(q.id); list.push(q); }
    };
    for (let k = 0; k < list.length && k < 400; k++) {
      const q = list[k];
      for (const x of q.items) if (x.it === it) carried++;
      if (q.type === 'belt') {
        for (const j of this.taps.get(q.id) || []) if (this.wantsAt(j) & bit) takers.add(j);
        const [nx, nz] = neighbor(q.cx, q.cz, q.dir), j = idx(nx, nz);
        if (j >= 0) next(q, j);
      } else if (q.type === 'tunnel') {
        const e = q.pair && !q.exit ? this.byId.get(q.pair) : undefined;
        if (!e) continue;
        const [nx, nz] = neighbor(e.cx, e.cz, e.dir), j = idx(nx, nz);
        if (j >= 0) next(e, j);
      } else for (let d = 0; d < 6; d++) { const [nx, nz] = neighbor(q.cx, q.cz, d), j = idx(nx, nz); if (j >= 0) next(q, j); }
    }
    let need = 0;
    for (const j of takers) need += this.need(j, it);
    return carried >= need;
  }
  /**
   * Producers that load the same belt take turns: one that loaded it last waits while another has been waiting for a slot
   * there (the step before or this one), noted by waitFor().
   */
  private turn(b: Fac, f: Fac): boolean {
    const w = this.loadWait.get(b.id);
    if (w && this.lastLoad.get(b.id) === f.id) for (const [id, t] of w) if (id !== f.id && t >= this.ticks - 1) return false;
    return true;
  }
  private waitFor(b: Fac, f: Fac) { let w = this.loadWait.get(b.id); if (!w) this.loadWait.set(b.id, (w = new Map())); w.set(f.id, this.ticks); }
  /** Hand one item out of a building or crate to the next side that takes it: a neighbour that needs it, or a belt (or tunnel) whose line leads to one. */
  private push(f: Fac, it: ItemType): boolean {
    const bit = BIT[it], crate = f.type === 'crate';
    for (let k = 0; k < 6; k++) {
      const d = (f.rr + k) % 6, [nx, nz] = neighbor(f.cx, f.cz, d), j = idx(nx, nz);
      if (j < 0) continue;
      const q = this.facAtI(j);
      let ok = false;
      if (q && (q.type === 'belt' || this.entranceFrom(q, f.cx, f.cz))) {
        if (!(this.want.get(q.id)! & bit) || this.glut(q, it)) continue;
        ok = this.turn(q, f) && this.onBelt(q, it, crate);
        if (ok) { this.lastLoad.set(q.id, f.id); this.loadWait.get(q.id)?.delete(f.id); } else this.waitFor(q, f);
      } else if (!q || !conveyor(q.type)) ok = !!this.give(j, it, crate);
      if (ok) { f.rr = (d + 1) % 6; return true; }
    }
    return false;
  }
  /** Move the head item of a belt (or a tunnel exit, `from`) onto the tile in front: a belt, a splitter, a tunnel entrance; out of a tunnel also straight to a taker. */
  private passOn(from: Fac, it: BeltItem): boolean {
    const [nx, nz] = neighbor(from.cx, from.cz, from.dir), j = idx(nx, nz);
    if (j < 0) return false;
    const q = this.facAtI(j);
    if (q && q.type === 'belt') return !this.pointsAt(q, from.cx, from.cz) && this.onBelt(q, it.it, it.c); // (two belts pointing at each other do not trade)
    if (q && q.type === 'splitter') { if (q.items.length >= SPLIT_CAP) return false; q.items.push({ it: it.it, p: 0, c: it.c }); return true; }
    if (q && q.type === 'tunnel') return this.entranceFrom(q, from.cx, from.cz) && this.onBelt(q, it.it, it.c);
    if (from.type === 'tunnel') return this.take(from, j, it);
    return false;
  }
  /** True if a conveyor's line leads to takers, but none of them for this item. */
  private unwanted(c: Fac, it: ItemType) { const w = this.want.get(c.id) || 0; return w !== 0 && !(w & BIT[it]); }
  private stepBelt(b: Fac, dt: number) {
    const v = BELT_SPEED * this.host.mods.belt * dt;
    for (let i = 0; i < b.items.length; i++) {
      const lim = i === 0 ? 1 : b.items[i - 1].p - BELT_GAP;
      b.items[i].p = Math.min(lim, b.items[i].p + v);
    }
    // what stands beside the belt takes the first item it needs that has come far enough along the tile
    const taps = this.taps.get(b.id);
    if (taps && taps.length) {
      for (let i = 0; i < b.items.length; i++) {
        const it = b.items[i];
        if (it.p < TAP_AT) break;
        let took = false;
        for (const j of taps) if (this.take(b, j, it)) { took = true; break; }
        if (took) { b.items.splice(i, 1); break; }
      }
    }
    const head = b.items[0];
    if (!head || head.p < 1) return;
    if (this.passOn(b, head)) { b.items.shift(); return; }
    // an item nothing beside or ahead takes any more, on a line that leads to takers of other items (a merged line whose taker
    // upstream is full, a tower that changed its ammunition with its level), is tipped off the end, or it would hold up
    // everything behind it for good. (On a line that leads nowhere at all it waits, so the dead end can be seen.)
    if (this.unwanted(b, head.it)) { b.items.shift(); return; }
    // the end of the line: the item waits for a taker beside the tile. If the building it waits at is starved of something
    // else and can never take this one (its stock of it is full), the item is tipped off the end so the line cannot lock up.
    const [nx, nz] = neighbor(b.cx, b.cz, b.dir), q = this.facAt(nx, nz);
    if (q && (WANTS[q.type] & BIT[head.it]) && (q.state === 'noinput' || q.state === 'nofuel') && this.room(q, head.it) <= 0) b.items.shift();
  }
  /** A tunnel entrance: items travel underground at belt speed to the exit, then on from the exit like off a belt end. */
  private stepTunnel(t: Fac, dt: number) {
    const e = t.pair && !t.exit ? this.byId.get(t.pair) : undefined;
    if (!e) return;
    const len = hexDist(t.cx, t.cz, e.cx, e.cz), v = BELT_SPEED * this.host.mods.belt * dt;
    for (let i = 0; i < t.items.length; i++) {
      const lim = i === 0 ? len : t.items[i - 1].p - BELT_GAP;
      t.items[i].p = Math.min(lim, t.items[i].p + v);
    }
    const head = t.items[0];
    if (head && head.p >= len && (this.passOn(e, head) || this.unwanted(t, head.it))) t.items.shift(); // (tipped off as off a belt)
  }
  /** A splitter: each item goes, in turn, to the next side that takes it (a belt or tunnel leading away whose line wants it, or a taker beside it). */
  private stepSplitter(s: Fac, dt: number) {
    const v = BELT_SPEED * this.host.mods.belt * dt;
    for (let i = 0; i < s.items.length; i++) s.items[i].p = Math.min(i === 0 ? 0.5 : s.items[i - 1].p, s.items[i].p + v);
    const head = s.items[0];
    if (!head || head.p < 0.5) return;
    if (this.unwanted(s, head.it)) { s.items.shift(); return; } // no side takes it: tipped off, or the splitter stops for good
    // the first item held that some side takes right now goes (one whose only taker is full does not hold up the others)
    for (let i = 0; i < s.items.length; i++) {
      const it = s.items[i], bit = BIT[it.it];
      if (it.p < 0.5) break;
      for (let k = 0; k < 6; k++) {
        const d = (s.rr + k) % 6, [nx, nz] = neighbor(s.cx, s.cz, d), j = idx(nx, nz);
        if (j < 0) continue;
        const q = this.facAtI(j);
        let ok = false;
        if (q && (q.type === 'belt' ? !this.pointsAt(q, s.cx, s.cz) : this.entranceFrom(q, s.cx, s.cz))) ok = !!(this.want.get(q.id)! & bit) && this.onBelt(q, it.it, it.c);
        else if (!q || !conveyor(q.type)) ok = this.take(s, j, it);
        if (ok) { s.rr = (d + 1) % 6; s.items.splice(i, 1); return; }
      }
    }
  }

  // ---------- step ----------
  step(dt: number) {
    this.sync();
    this.ticks++;
    const m = this.host.mods;
    // power: what the generators can give against what is asked of them
    for (const net of this.powerNets) {
      let cap = 0, demand = 0;
      for (const g of net.nodes) if (g.type === 'generator' && (g.fuel > 0 || (g.inv.coal || 0) > 0)) cap += GEN_POWER * m.gen * spd(g);
      for (const f of net.cons) if (f.busy || (f.type === 'pump' && f.tout < TANK)) demand += FACS[f.type].power || 0;
      for (const t of net.towers) demand += needsOf(t).power || 0;
      net.cap = cap; net.demand = demand;
      net.sat = cap <= 0 ? 0 : demand <= 0 ? 1 : Math.min(1, cap / demand);
      const load = cap > 0 ? Math.min(1, demand / cap) : 0;
      for (const g of net.nodes) {
        if (g.type !== 'generator') continue;
        g.gen = 0;
        if (g.fuel <= 0 && (g.inv.coal || 0) > 0) { g.inv.coal!--; g.fuel += COAL_SECONDS; }
        // (a bigger generator burns its coal faster: a level buys power, not fuel)
        if (g.fuel > 0) { g.fuel -= dt * load * spd(g); g.gen = GEN_POWER * m.gen * spd(g) * load; g.state = load > 0 ? 'ok' : 'idle'; } else g.state = 'nofuel';
      }
      for (const f of net.cons) f.pwr = net.sat;
      for (const t of net.towers) t.pwr = net.sat;
    }

    // fluids: producers fill their networks, consumers draw from them; neighbours trade directly too
    for (const net of this.pipeNets) {
      if (!net.forced && net.amt <= 0.001) { net.fluid = null; net.amt = 0; }
      for (const p of net.prod) {
        const fl = FLUID_OUT[p.type]!;
        if (net.fluid && net.fluid !== fl) continue;
        const n = Math.min(p.tout, net.cap - net.amt);
        if (n > 0) { net.fluid = fl; net.amt += n; p.tout -= n; }
      }
      if (!net.fluid) continue;
      // shared out in proportion to the room in each tank, so when the producers cannot keep up nobody runs dry first
      let room = 0;
      for (const c of net.cons) if (FLUID_IN[c.type] === net.fluid) room += Math.max(0, TANK - c.tin);
      for (const t of net.towers) if (needsOf(t).fluid === net.fluid) room += Math.max(0, TOWER_TANK - t.tank);
      if (room <= 0 || net.amt <= 0) continue;
      const share = Math.min(1, net.amt / room);
      for (const c of net.cons) {
        if (FLUID_IN[c.type] !== net.fluid) continue;
        const n = Math.max(0, TANK - c.tin) * share;
        c.tin += n; net.amt -= n;
      }
      for (const t of net.towers) {
        if (needsOf(t).fluid !== net.fluid) continue;
        const n = Math.max(0, TOWER_TANK - t.tank) * share;
        t.tank += n; net.amt -= n;
      }
      net.amt = Math.max(0, net.amt);
    }
    for (const p of this.facs) {
      const fl = FLUID_OUT[p.type];
      if (!fl || p.tout <= 0) continue;
      for (let d = 0; d < 6 && p.tout > 0; d++) {
        const [nx, nz] = neighbor(p.cx, p.cz, d), j = idx(nx, nz);
        if (j < 0) continue;
        const q = this.facAtI(j);
        if (q && !pipeLike(q.type) && FLUID_IN[q.type] === fl) { const n = Math.min(p.tout, TANK - q.tin); q.tin += n; p.tout -= n; continue; }
        const t = this.towerAt.get(j);
        if (t && needsOf(t).fluid === fl) { const n = Math.min(p.tout, TOWER_TANK - t.tank); if (n > 0) { t.tank += n; p.tout -= n; } }
      }
    }

    // buildings at work
    for (const f of this.facs) {
      const k = spd(f);
      switch (f.type) {
        case 'mine': {
          if (!f.ore || f.ore === 'oil') { f.state = 'nodeposit'; break; }
          if (f.out.length >= OUT_CAP) { f.state = 'full'; break; }
          f.prog += dt * m.mine * k; f.state = 'ok';
          if (f.prog >= MINE_TIME) { f.prog -= MINE_TIME; f.out.push(f.ore as ItemType); }
          break;
        }
        case 'pump': {
          if (f.ore !== 'oil') { f.state = 'nodeposit'; break; }
          if (f.tout >= TANK) { f.state = 'full'; break; }
          if (f.pwr <= 0) { f.state = 'nopower'; break; }
          f.tout = Math.min(TANK, f.tout + PUMP_RATE * m.mine * k * f.pwr * dt); f.state = 'ok';
          break;
        }
        case 'smelter': {
          if (!f.busy) {
            // the ore it has more of; with as much of both, the other kind than last time
            const fe = f.inv.iron_ore || 0, cu = f.inv.copper_ore || 0;
            const ore: ItemType | null = !fe && !cu ? null : fe > cu || (fe === cu && f.cur !== 'iron_ore') ? 'iron_ore' : 'copper_ore';
            if (!ore) { f.state = 'noinput'; break; }
            if (f.out.length >= OUT_CAP) { f.state = 'full'; break; }
            if (f.fuel <= 0) { if ((f.inv.coal || 0) > 0) { f.inv.coal!--; f.fuel = COAL_SMELTS; } else { f.state = 'nofuel'; break; } }
            f.inv[ore]!--; f.fuel--; f.cur = ore; f.busy = true; f.prog = 0;
          }
          f.state = 'ok';
          f.prog += dt * m.craft * k;
          // (cur stays: it says which ore was melted last)
          if (f.prog >= SMELT_TIME) { f.out.push(f.cur === 'copper_ore' ? 'copper' : 'iron'); f.busy = false; f.prog = 0; }
          break;
        }
        case 'works': case 'press': case 'cells': case 'missiles': {
          const r = MAKES[f.type]!;
          if (!f.busy) {
            if (r.out && f.out.length >= OUT_CAP) { f.state = 'full'; break; }
            let ok = true;
            for (const key in r.inp) if ((f.inv[key as ItemType] || 0) < r.inp[key as ItemType]!) ok = false;
            if (r.fluid && f.tin < r.fluid[1]) ok = false;
            if (!ok) { f.state = 'noinput'; break; }
            for (const key in r.inp) f.inv[key as ItemType]! -= r.inp[key as ItemType]!;
            if (r.fluid) f.tin -= r.fluid[1];
            f.busy = true; f.prog = 0;
          }
          if (f.pwr <= 0) { f.state = 'nopower'; break; }
          f.state = 'ok';
          f.prog += dt * m.craft * k * f.pwr;
          if (f.prog >= r.time) {
            f.busy = false; f.prog = 0;
            if (r.out) f.out.push(r.out);
            if (r.mats) { this.host.addMats(r.mats); this.host.events.push({ k: 'mats', x: f.x, z: f.z, n: r.mats }); }
          }
          break;
        }
        case 'refinery': {
          if (!f.busy) {
            if (f.tout > TANK - REFINE_OUT) { f.state = 'full'; break; }
            if (f.tin < REFINE_IN) { f.state = 'noinput'; break; }
            f.tin -= REFINE_IN; f.busy = true; f.prog = 0;
          }
          if (f.pwr <= 0) { f.state = 'nopower'; break; }
          f.state = 'ok';
          f.prog += dt * m.craft * k * f.pwr;
          if (f.prog >= REFINE_TIME) { f.tout += REFINE_OUT; f.busy = false; f.prog = 0; }
          break;
        }
        case 'crate': {
          // hands out what it holds, one item at a time, for as long as it lasts
          if (f.left <= 0 || !f.hold) { f.state = 'empty'; break; }
          f.state = 'ok';
          f.prog += dt;
          if (f.prog >= CRATE_TIME) { if (this.push(f, f.hold)) { f.left--; f.prog = 0; } else f.prog = CRATE_TIME; }
          break;
        }
        case 'pole': f.state = f.net >= 0 && this.powerNets[f.net] && this.powerNets[f.net].cap > 0 ? 'ok' : 'nopower'; break;
        case 'pipe': case 'ptunnel': { const n = this.pipeNets[f.net]; f.state = n && n.fluid ? 'ok' : 'idle'; break; }
        case 'tunnel': f.state = f.pair ? (f.items.length ? 'ok' : 'idle') : 'noinput'; break;
      }
    }
    // items move: buildings hand on their output, belts, splitters and tunnels carry theirs on
    for (const f of this.facs) if (f.out.length && this.push(f, f.out[0])) f.out.shift();
    for (const f of this.facs) {
      if (f.type === 'belt') this.stepBelt(f, dt);
      else if (f.type === 'splitter') this.stepSplitter(f, dt);
      else if (f.type === 'tunnel') this.stepTunnel(f, dt);
    }
  }

  // ---------- what will reach what (while time stands still) ----------
  /**
   * The items that will travel on each conveyor, given what each producer makes (`out`: fac id -> item bits), and per item the
   * names of the producers they come from. Producers load the belts and tunnel entrances beside them whose line wants the
   * item; belts carry on whatever they hold; a splitter only hands on what a side wants; a tunnel carries to its exit.
   */
  private carry(out: Map<number, number>) {
    const bits = new Map<number, number>(), src = new Map<number, Map<ItemType, Set<string>>>(), queue: Fac[] = [];
    const add = (q: Fac, b: number, names: (it: ItemType) => Iterable<string>) => {
      if (!b) return;
      let m = src.get(q.id);
      if (!m) src.set(q.id, (m = new Map()));
      let grew = (bits.get(q.id) || 0) !== ((bits.get(q.id) || 0) | b);
      bits.set(q.id, (bits.get(q.id) || 0) | b);
      for (const it of ITEM_TYPES) {
        if (!(b & BIT[it])) continue;
        let s = m.get(it);
        if (!s) m.set(it, (s = new Set()));
        for (const n of names(it)) if (!s.has(n)) { s.add(n); grew = true; }
      }
      if (grew) queue.push(q);
    };
    for (const f of this.facs) {
      const b = out.get(f.id) || 0;
      if (!b) continue;
      const name = [FACS[f.type].name + ' (by belt)'];
      for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(f.cx, f.cz, d), q = this.facAt(nx, nz);
        if (q && (q.type === 'belt' || this.entranceFrom(q, f.cx, f.cz))) add(q, b & (this.want.get(q.id) || 0), () => name);
      }
    }
    for (let k = 0; k < queue.length && k < 20000; k++) {
      const c = queue[k], b = bits.get(c.id) || 0, from = (it: ItemType) => src.get(c.id)!.get(it) || [];
      const ahead = (e: Fac) => {
        const [nx, nz] = neighbor(e.cx, e.cz, e.dir), q = this.facAt(nx, nz);
        if (!q) return;
        if (q.type === 'belt' && !this.pointsAt(q, e.cx, e.cz)) add(q, b, from);
        else if (q.type === 'splitter') add(q, b, from);
        else if (this.entranceFrom(q, e.cx, e.cz)) add(q, b, from);
      };
      if (c.type === 'belt') ahead(c);
      else if (c.type === 'tunnel' && c.pair && !c.exit) { const e = this.byId.get(c.pair)!; add(e, b, from); }
      else if (c.type === 'tunnel' && c.exit) ahead(c);
      else if (c.type === 'splitter') for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(c.cx, c.cz, d), q = this.facAt(nx, nz);
        if (q && (q.type === 'belt' ? !this.pointsAt(q, c.cx, c.cz) : this.entranceFrom(q, c.cx, c.cz))) add(q, b & (this.want.get(q.id) || 0), from);
      }
    }
    return { bits, src };
  }
  /** What reaches the thing on tile (cx, cz): from producers right beside it, belts it taps, splitters beside it, tunnel exits facing it. */
  private reach(cx: number, cz: number, out: Map<number, number>, cr: ReturnType<Factory['carry']>): Reach {
    const r: Reach = { bits: 0, names: new Map() };
    const add = (b: number, names: (it: ItemType) => Iterable<string>) => {
      for (const it of ITEM_TYPES) {
        if (!(b & BIT[it])) continue;
        r.bits |= BIT[it];
        let s = r.names.get(it);
        if (!s) r.names.set(it, (s = new Set()));
        for (const n of names(it)) s.add(n);
      }
    };
    for (let d = 0; d < 6; d++) {
      const [nx, nz] = neighbor(cx, cz, d), q = this.facAt(nx, nz);
      if (!q) continue;
      const via = (it: ItemType) => cr.src.get(q.id)?.get(it) || [];
      if (q.type === 'belt' || q.type === 'splitter' || (q.type === 'tunnel' && q.exit && this.pointsAt(q, cx, cz))) add(cr.bits.get(q.id) || 0, via);
      else if (!conveyor(q.type)) add(out.get(q.id) || 0, () => [FACS[q.type].name]);
    }
    return r;
  }
  /** Who will take an item a producer on tile (cx, cz) makes: a neighbour that needs it, or a belt or tunnel beside it whose line wants it. */
  private taker(f: Fac, bit: number): boolean {
    for (let d = 0; d < 6; d++) {
      const [nx, nz] = neighbor(f.cx, f.cz, d), j = idx(nx, nz), q = this.facAtI(j);
      if (j < 0) continue;
      if (q && (q.type === 'belt' || this.entranceFrom(q, f.cx, f.cz))) { if ((this.want.get(q.id) || 0) & bit) return true; }
      else if ((!q || !conveyor(q.type)) && this.wantsAt(j) & bit) return true;
    }
    return false;
  }
  /** Who will take a fluid a producer makes: a neighbour that draws it, or a pipe network it feeds with a consumer of it. */
  private fluidTaker(f: Fac, fl: FluidType): boolean {
    for (let d = 0; d < 6; d++) {
      const [nx, nz] = neighbor(f.cx, f.cz, d), j = idx(nx, nz), q = this.facAtI(j);
      if (j < 0) continue;
      if (q && !pipeLike(q.type) && FLUID_IN[q.type] === fl) return true;
      const t = this.towerAt.get(j);
      if (t && needsOf(t).fluid === fl) return true;
    }
    for (const n of this.pipeOf.get('f' + f.id) || []) {
      if (n.forced && n.forced !== fl) continue;
      if (n.cons.some((c) => FLUID_IN[c.type] === fl) || n.towers.some((t) => needsOf(t).fluid === fl)) return true;
    }
    return false;
  }

  /**
   * Supply diagnosis for every building ('f' + id) and tower ('t' + id), worked out from the layout alone (no time needs to
   * pass), so it holds while time stands still between waves. An input counts as supplied when something that will make it
   * stands beside the consumer or on a belt line that reaches it (through splitters and tunnels). Something "will make" an
   * item when it is a mine on its deposit, a crate with stock left, or a building whose own inputs are supplied (worked out
   * to a fixed point, so a chain of buildings is followed back to its mines). Power counts when the consumer is in reach of a
   * grid with a generator that gets coal; a fluid when a pipe network it hangs on (or a neighbour) has a working producer
   * of it. A producer whose output nobody takes says so. Cached until the layout, the towers or a crate's stock change.
   */
  diagnose(): Map<string, Diag> {
    this.sync();
    let crates = 0;
    for (const f of this.facs) if (f.type === 'crate' && f.left > 0) crates++;
    const key = this.rev + ':' + crates;
    if (key === this.diagKey) return this.diagMap;
    this.diagKey = key;
    // fixed point: what every producer will make, which generators get coal, which fluid producers work
    const out = new Map<number, number>(), fluidOk = new Set<number>();
    let gens = new Set<number>(), cr = this.carry(out);
    const powered = (key: string) => { const n = this.powerBy.get(key); return !!n && this.powerNets[n.net].nodes.some((g) => g.type === 'generator' && gens.has(g.id)); };
    const fluidFor = (key: string, cx: number, cz: number, fl: FluidType): string | null => {
      for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(cx, cz, d), q = this.facAt(nx, nz);
        if (q && FLUID_OUT[q.type] === fl && fluidOk.has(q.id)) return FACS[q.type].name;
      }
      for (const n of this.pipeOf.get(key) || []) {
        if (n.forced !== fl) continue;
        const p = n.prod.find((q) => FLUID_OUT[q.type] === fl && fluidOk.has(q.id));
        if (p) return 'pipe network with a ' + FACS[p.type].name;
      }
      return null;
    };
    const makes = (f: Fac): number => {
      const k = 'f' + f.id;
      switch (f.type) {
        case 'mine': return f.ore && f.ore !== 'oil' ? BIT[f.ore as ItemType] : 0;
        case 'crate': return f.left > 0 && f.hold ? BIT[f.hold] : 0;
        case 'smelter': {
          const r = this.reach(f.cx, f.cz, out, cr);
          if (!(r.bits & BIT.coal)) return 0;
          return (r.bits & BIT.iron_ore ? BIT.iron : 0) | (r.bits & BIT.copper_ore ? BIT.copper : 0);
        }
        case 'press': case 'cells': case 'missiles': {
          const rec = MAKES[f.type]!, r = this.reach(f.cx, f.cz, out, cr);
          for (const it in rec.inp) if (!(r.bits & BIT[it as ItemType])) return 0;
          if (rec.fluid && !fluidFor(k, f.cx, f.cz, rec.fluid[0])) return 0;
          return powered(k) && rec.out ? BIT[rec.out] : 0;
        }
      }
      return 0;
    };
    for (let round = 0; round < 64; round++) {
      let changed = false;
      for (const f of this.facs) {
        const b = makes(f);
        if (b !== (out.get(f.id) || 0)) { out.set(f.id, b); changed = true; }
        const k = 'f' + f.id;
        if (f.type === 'generator') {
          const ok = !!(this.reach(f.cx, f.cz, out, cr).bits & BIT.coal);
          if (ok !== gens.has(f.id)) { gens = new Set(gens); if (ok) gens.add(f.id); else gens.delete(f.id); changed = true; }
        } else if (f.type === 'pump' || f.type === 'refinery') {
          const ok = f.type === 'pump' ? f.ore === 'oil' && powered(k) : !!fluidFor(k, f.cx, f.cz, 'crude') && powered(k);
          if (ok !== fluidOk.has(f.id)) { if (ok) fluidOk.add(f.id); else fluidOk.delete(f.id); changed = true; }
        }
      }
      if (!changed) break;
      cr = this.carry(out);
    }
    // the diagnosis itself
    const res = new Map<string, Diag>();
    const report = (key: string, missing: string[], from: Set<string>) => res.set(key, { ok: !missing.length, missing, from: [...from] });
    const power = (key: string, missing: string[], from: Set<string>) => {
      if (powered(key)) from.add(FACS[this.powerBy.get(key)!.type].name); else missing.push('power');
    };
    const item = (r: Reach, it: ItemType, missing: string[], from: Set<string>) => {
      if (r.bits & BIT[it]) { for (const n of r.names.get(it) || []) from.add(n); } else missing.push(ITEMS[it].short);
    };
    const fluid = (key: string, cx: number, cz: number, fl: FluidType, missing: string[], from: Set<string>) => {
      const n = fluidFor(key, cx, cz, fl);
      if (n) from.add(n); else missing.push(fluidName(fl));
    };
    for (const f of this.facs) {
      const k = 'f' + f.id, missing: string[] = [], from = new Set<string>();
      switch (f.type) {
        case 'mine': if (!makes(f)) missing.push('an ore deposit'); else if (!this.taker(f, out.get(f.id)!)) missing.push('a taker for its output'); break;
        case 'crate': if (f.left > 0 && f.hold && !this.taker(f, BIT[f.hold])) missing.push('a taker for its output'); break;
        case 'generator': item(this.reach(f.cx, f.cz, out, cr), 'coal', missing, from); break;
        case 'pump':
          if (f.ore !== 'oil') missing.push('an oil field');
          power(k, missing, from);
          if (!this.fluidTaker(f, 'crude')) missing.push('a taker for its output');
          break;
        case 'refinery':
          fluid(k, f.cx, f.cz, 'crude', missing, from); power(k, missing, from);
          if (!this.fluidTaker(f, 'petrol')) missing.push('a taker for its output');
          break;
        case 'smelter': {
          const r = this.reach(f.cx, f.cz, out, cr);
          if (r.bits & (BIT.iron_ore | BIT.copper_ore)) { item(r, r.bits & BIT.iron_ore ? 'iron_ore' : 'copper_ore', missing, from); if (r.bits & BIT.iron_ore && r.bits & BIT.copper_ore) item(r, 'copper_ore', missing, from); }
          else missing.push('iron or copper ore');
          item(r, 'coal', missing, from);
          const b = (r.bits & BIT.iron_ore ? BIT.iron : 0) | (r.bits & BIT.copper_ore ? BIT.copper : 0);
          for (const it of ['iron', 'copper'] as ItemType[]) if (b & BIT[it] && !this.taker(f, BIT[it])) { missing.push('a taker for its output'); break; }
          break;
        }
        case 'works': case 'press': case 'cells': case 'missiles': {
          const rec = MAKES[f.type]!, r = this.reach(f.cx, f.cz, out, cr);
          for (const it in rec.inp) item(r, it as ItemType, missing, from);
          if (rec.fluid) fluid(k, f.cx, f.cz, rec.fluid[0], missing, from);
          power(k, missing, from);
          if (rec.out && !this.taker(f, BIT[rec.out])) missing.push('a taker for its output');
          break;
        }
        case 'pole': if (!this.powerNets[f.net]?.nodes.some((g) => g.type === 'generator')) missing.push('a Generator on its grid'); break;
        case 'tunnel': case 'ptunnel': if (!f.pair) missing.push(f.type === 'tunnel' ? 'a second tunnel facing the same way within ' + TUNNEL_REACH + ' tiles' : 'a second pipe tunnel in a straight line within ' + TUNNEL_REACH + ' tiles'); break;
        default: continue; // belts, splitters, pipes
      }
      report(k, missing, from);
    }
    for (const t of this.host.towers) {
      const k = 't' + t.id, n = needsOf(t), missing: string[] = [], from = new Set<string>();
      if (n.item) item(this.reach(t.cx, t.cz, out, cr), n.item, missing, from);
      if (n.fluid) fluid(k, t.cx, t.cz, n.fluid, missing, from);
      if (n.power) power(k, missing, from);
      report(k, missing, from);
    }
    this.diagMap = res;
    return res;
  }

  /**
   * The supply connections for the view (see Link), recomputed with the layout. A belt line that runs past a tower links to
   * it once, at its first tile beside it that carries something the tower takes (any producer counted as working, so a
   * line shows even while its mine waits for something else; a line nothing feeds yet links to every taker beside it).
   * A pipe network links once to each consumer beside it.
   */
  links(): Link[] {
    this.sync();
    if (this.linkRev === this.rev) return this.linkList;
    this.linkRev = this.rev;
    const out = new Map<number, number>();
    for (const f of this.facs) {
      let b = 0;
      if (f.type === 'mine' && f.ore && f.ore !== 'oil') b = BIT[f.ore as ItemType];
      else if (f.type === 'crate' && f.left > 0 && f.hold) b = BIT[f.hold];
      else if (f.type === 'smelter') b = BIT.iron | BIT.copper;
      else if (MAKES[f.type]?.out) b = BIT[MAKES[f.type]!.out!];
      if (b) out.set(f.id, b);
    }
    const cr = this.carry(out), list: Link[] = [];
    const who = (j: number): [string, number, number] | null => {
      const q = this.facAtI(j);
      if (q) return conveyor(q.type) ? null : ['f' + q.id, q.x, q.z];
      const t = this.towerAt.get(j);
      return t ? ['t' + t.id, cellX(t.cx, t.cz), cellZ(t.cz)] : null;
    };
    const link = (kind: Link['kind'], f: Fac, j: number) => { const w = who(j); if (w) list.push({ kind, from: f.id, x: f.x, z: f.z, tx: w[1], tz: w[2], to: w[0] }); };
    // a line that carries nothing yet (no producer on it) still shows where it will deliver
    const fits = (j: number, bits: number) => !!(bits ? this.wantsAt(j) & bits : this.wantsAt(j));
    for (const b of this.facs) {
      const bits = cr.bits.get(b.id) || 0;
      if (b.type === 'belt') {
        for (const j of this.taps.get(b.id) || []) {
          if (!fits(j, bits)) continue;
          // (not where the belt before this one already runs past the same taker with the same items)
          let dup = false;
          for (let d = 0; d < 6 && !dup; d++) {
            const [nx, nz] = neighbor(b.cx, b.cz, d), u = this.facAt(nx, nz);
            if (u && u.type === 'belt' && this.pointsAt(u, b.cx, b.cz) && (this.taps.get(u.id) || []).includes(j) && fits(j, cr.bits.get(u.id) || 0)) dup = true;
          }
          if (!dup) link('belt', b, j);
        }
      } else if (b.type === 'splitter') {
        for (let d = 0; d < 6; d++) {
          const [nx, nz] = neighbor(b.cx, b.cz, d), j = idx(nx, nz), q = this.facAtI(j);
          if (j >= 0 && !(q && conveyor(q.type)) && fits(j, bits)) link('belt', b, j);
        }
      } else if (b.type === 'tunnel' && b.exit) {
        const e = this.byId.get(b.pair), [nx, nz] = neighbor(b.cx, b.cz, b.dir), j = idx(nx, nz);
        if (e && j >= 0 && fits(j, cr.bits.get(e.id) || 0)) link('belt', b, j);
      }
    }
    for (const net of this.pipeNets) {
      const done = new Set<string>();
      for (const p of net.pipes) for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(p.cx, p.cz, d), j = idx(nx, nz);
        if (j < 0) continue;
        const q = this.facAtI(j), t = q ? undefined : this.towerAt.get(j);
        const fl = q ? (pipeLike(q.type) ? undefined : FLUID_IN[q.type]) : t && needsOf(t).fluid;
        if (!fl || (net.forced && net.forced !== fl)) continue;
        const key = q ? 'f' + q.id : 't' + t!.id;
        if (done.has(key)) continue;
        done.add(key); link('pipe', p, j);
      }
    }
    for (const [key, n] of this.powerBy) {
      const id = +key.slice(1), f = key[0] === 'f' ? this.byId.get(id) : undefined, t = f ? undefined : this.host.towers.find((o) => o.id === id);
      const x = f ? f.x : t ? cellX(t.cx, t.cz) : 0, z = f ? f.z : t ? cellZ(t.cz) : 0;
      if (f || t) list.push({ kind: 'power', from: n.id, x: n.x, z: n.z, tx: x, tz: z, to: key });
    }
    this.linkList = list;
    return list;
  }
}
