// BEATSPIRE factory: deposits, mines, conveyor belts, pipes, power lines and the buildings that turn ore into
// tower ammunition and building materials. No rendering and no DOM: it runs inside the Sim, in the browser and in Node.
//
// Everything sits on the hex grid, one building per tile. Nothing has an output side: a building hands what it makes to
// a neighbour that needs it (a tower, another building), or to any belt beside it whose line leads to something that
// needs that item. Belts carry items one tile at a time; towers and buildings take what they need from a belt that points
// at them or simply runs past them. So one line can feed several towers, and a belt never fills up with things nobody on
// it wants. Fluids flow through pipe networks, and straight between neighbouring buildings. Power runs from generators over
// pole-to-pole wires to everything within reach of a pole.
import { GW, GH, cellX, cellZ, FACS, TOWERS, ORE_TYPES, ITEM_TYPES, MAKES } from './data.ts';
import type { FacType, ItemType, FluidType, OreType, Mods, TowerType } from './data.ts';
import { neighbor, hexDist } from './hex.ts';

/** Seconds a mine takes per ore, crude oil a pumpjack pumps per second at full power. */
export const MINE_TIME = 1.6;
export const PUMP_RATE = 5;
/** Seconds a smelter takes per plate, and the plates one coal is good for. */
export const SMELT_TIME = 1.8;
export const COAL_SMELTS = 4;
/** Refinery: crude in, petrol out per batch, and seconds per batch. */
export const REFINE_IN = 10;
export const REFINE_OUT = 8;
export const REFINE_TIME = 2;
/** Generator: power at full load, and seconds of full load one coal gives. */
export const GEN_POWER = 10;
export const COAL_SECONDS = 12;
/** Belts: tiles per second, and the closest two items may follow each other. */
export const BELT_SPEED = 1.6;
export const BELT_GAP = 0.5;
/** How far along a belt tile an item has to be before a tower or building beside the tile may take it. */
export const TAP_AT = 0.3;
/** Seconds between two items a supply crate hands out. */
export const CRATE_TIME = 0.6;
/** Power: how far (in tiles) a pole or generator wires to the next one, and how far it powers buildings and towers. */
export const POLE_REACH = 5;
export const SUPPLY = 2;
/** Fluid each pipe tile holds, and the tanks of buildings and towers. */
export const PIPE_CAP = 20;
export const TANK = 40;
/** Items a building keeps waiting in its output, and ammunition items a tower keeps in stock. */
export const OUT_CAP = 6;
export const TOWER_STOCK = 4;

export type FacState = 'ok' | 'idle' | 'nopower' | 'noinput' | 'nofuel' | 'full' | 'nodeposit' | 'empty';
/** An item on a belt. `c`: it came out of a supply crate (so it does not count as the player's own supply). */
export interface BeltItem { it: ItemType; p: number; c?: boolean }
export interface Fac {
  id: number; type: FacType; cx: number; cz: number; x: number; z: number;
  /** belts: the direction (0..5, see HEX_DIRS) items leave by. Nothing else faces a way. */
  dir: number;
  /** input items waiting, output items waiting (oldest first), and a belt's items (front first, p 0..1 along the tile) */
  inv: Partial<Record<ItemType, number>>; out: ItemType[]; items: BeltItem[];
  /** seconds into the current job, whether a job runs, and the ore a smelter is melting (or melted last) */
  prog: number; busy: boolean; cur: ItemType | null;
  /** smelter: plates left on the coal it burns; generator: seconds of full load left on its fuel */
  fuel: number;
  /** input and output tanks (in: crude for a refinery or cell plant, petrol for a missile works; out: a pumpjack's crude, a refinery's petrol) */
  tin: number; tout: number;
  /** power satisfaction 0..1 last step, and the network ids (pipe network for pipes, power network for poles and generators, -1 none) */
  pwr: number; net: number;
  /** generator: power it delivered last step (for the panel) */
  gen: number;
  state: FacState;
  spent: number;
  /** round robin over the six sides for the output */
  rr: number;
  /** the deposit under a mine or pumpjack */
  ore: OreType | null;
  /** supply crate: what it holds and how many are left */
  hold: ItemType | null; left: number;
  /** a belt or pipe laid across a road (Underpass): it runs under the deck */
  under: boolean;
}

/** What the factory feeds in a tower (the Sim's Tower carries these fields). */
export interface Supplied {
  id: number; type: TowerType; cx: number; cz: number;
  /** ammunition items waiting, shots left of the item in use, crude oil in the tank, power satisfaction 0..1 */
  stock: number; ammo: number; tank: number; pwr: number;
}
/** What the factory needs from the Sim. */
export interface FacHost {
  grid: Uint8Array;
  mods: Mods;
  towers: Supplied[];
  addMats(n: number): void;
  /** true if a belt or pipe may cross under this road tile (a plain stretch of road at deck level, not the core's plinth) */
  roadOk(cx: number, cz: number): boolean;
  events: { k: string; [key: string]: unknown }[];
}

/** Buildings that face a way (only belts: R turns them). */
export const turns = (t: FacType) => t === 'belt';
const idx = (cx: number, cz: number) => (Number.isInteger(cx) && Number.isInteger(cz) && cx >= 0 && cz >= 0 && cx < GW && cz < GH ? cz * GW + cx : -1);
const BIT = Object.fromEntries(ITEM_TYPES.map((t, i) => [t, 1 << i])) as Record<ItemType, number>;
const FLUID_IN: Partial<Record<FacType, FluidType>> = { refinery: 'crude', cells: 'crude', missiles: 'petrol' };
const FLUID_OUT: Partial<Record<FacType, FluidType>> = { pump: 'crude', refinery: 'petrol' };
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
 * cross a road once the Underpass is unlocked), and oil in the larger ones (at least one oil field per map). Deterministic: the same map gives the same
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
    fuel: 0, tin: 0, tout: 0, pwr: 0, net: -1, gen: 0, state: 'idle', spent, rr: 0, ore, hold: null, left: 0, under: false,
  };
}

interface PipeNet { id: number; pipes: Fac[]; fluid: FluidType | null; amt: number; cap: number; prod: Fac[]; cons: Fac[]; towers: Supplied[]; forced: FluidType | null }
interface PowerNet { id: number; nodes: Fac[]; cons: Fac[]; towers: Supplied[]; cap: number; demand: number; sat: number }

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
  /** set whenever a building or a tower comes or goes: the networks are worked out again before the next step */
  dirty = true;
  /** counts up with every change to the layout (the view redraws its belts and pipes when it moves) */
  rev = 0;
  /** items towers have been handed that did not come out of a supply crate (the tutorial watches it) */
  delivered = 0;
  private nid = 1;
  private byId = new Map<number, Fac>();
  private towerAt = new Map<number, Supplied>();
  /** per belt id: the tiles beside it that hold something that takes items, and the items its line still leads to a taker for */
  private taps = new Map<number, number[]>();
  private want = new Map<number, number>();
  private host: FacHost;

  constructor(host: FacHost, ore: Uint8Array) { this.host = host; this.ore = ore; }

  oreAt(cx: number, cz: number): OreType | null { const i = idx(cx, cz); return i >= 0 && this.ore[i] ? ORE_TYPES[this.ore[i] - 1] : null; }
  facById(id: number) { return this.byId.get(id); }
  facAt(cx: number, cz: number) { const i = idx(cx, cz); return i >= 0 && this.at[i] ? this.byId.get(this.at[i]) : undefined; }

  /** Why a building cannot go on a tile ('' if it can). The credits and the unlocks are the Sim's business. */
  placeBlock(type: FacType, cx: number, cz: number): string {
    const i = idx(cx, cz);
    if (i < 0) return 'off the grid';
    if (this.at[i]) return 'taken';
    const g = this.host.grid[i];
    if (g === 1) {
      if (type !== 'belt' && type !== 'pipe') return 'road';
      if (!this.host.mods.underpass) return 'road: belts and pipes cross it once you have the Underpass';
      return this.host.roadOk(cx, cz) ? '' : 'no way under here';
    }
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
    f.under = this.host.grid[i] === 1;
    this.facs.push(f); this.byId.set(f.id, f);
    this.at[i] = f.id;
    if (!f.under) this.host.grid[i] = 2;
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
    if (!f.under) this.host.grid[i] = 0;
    this.dirty = true; this.rev++;
    return f;
  }
  /** Turn a belt. */
  rotate(id: number, dir: number) {
    const f = this.byId.get(id);
    if (!f || f.type !== 'belt' || !Number.isFinite(dir)) return;
    const d = ((Math.floor(dir) % 6) + 6) % 6;
    if (d !== f.dir) { f.dir = d; this.dirty = true; this.rev++; }
  }

  // ---------- networks ----------
  /** The items whatever stands on tile j takes in (a bit per item type): a building's inputs, a tower's ammunition. */
  private wantsAt(j: number): number {
    const q = this.at[j] ? this.byId.get(this.at[j]) : undefined;
    if (q) return q.type === 'belt' ? 0 : WANTS[q.type];
    const t = this.towerAt.get(j), it = t && TOWERS[t.type].needs.item;
    return it ? BIT[it] : 0;
  }
  /** The items a belt's line still leads to a taker for: what stands beside it, and beside every belt after it. */
  private wantOf(b: Fac, seen: Set<number>): number {
    const have = this.want.get(b.id);
    if (have !== undefined) return have;
    if (seen.has(b.id)) return 0; // a loop of belts
    seen.add(b.id);
    let m = 0;
    for (const j of this.taps.get(b.id)!) m |= this.wantsAt(j);
    const [nx, nz] = neighbor(b.cx, b.cz, b.dir), q = this.facAt(nx, nz);
    if (q && q.type === 'belt') m |= this.wantOf(q, seen);
    this.want.set(b.id, m);
    return m;
  }
  private rebuild() {
    this.dirty = false;
    this.towerAt.clear();
    for (const t of this.host.towers) this.towerAt.set(t.cz * GW + t.cx, t);
    // belts: who stands beside each one, and what its line is good for
    this.taps.clear(); this.want.clear();
    for (const b of this.facs) {
      if (b.type !== 'belt') continue;
      const list: number[] = [];
      for (let d = 0; d < 6; d++) {
        const [nx, nz] = neighbor(b.cx, b.cz, d), j = idx(nx, nz);
        if (j >= 0 && this.wantsAt(j)) list.push(j);
      }
      this.taps.set(b.id, list);
    }
    for (const b of this.facs) if (b.type === 'belt') this.wantOf(b, new Set());
    // pipe networks: pipes joined to the pipes beside them; buildings and towers beside a pipe hang on its network
    const old = new Map<Fac, PipeNet>();
    for (const n of this.pipeNets) for (const p of n.pipes) old.set(p, n);
    this.pipeNets = [];
    for (const f of this.facs) f.net = -1;
    for (const f of this.facs) {
      if (f.type !== 'pipe' || f.net >= 0) continue;
      const net: PipeNet = { id: this.pipeNets.length, pipes: [f], fluid: null, amt: 0, cap: 0, prod: [], cons: [], towers: [], forced: null };
      f.net = net.id;
      for (let k = 0; k < net.pipes.length; k++) {
        const p = net.pipes[k];
        for (let d = 0; d < 6; d++) {
          const [nx, nz] = neighbor(p.cx, p.cz, d), q = this.facAt(nx, nz);
          if (q && q.type === 'pipe' && q.net < 0) { q.net = net.id; net.pipes.push(q); }
        }
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
        const q = this.at[j] ? this.byId.get(this.at[j]) : undefined;
        if (q && q.type !== 'pipe' && !att.has(q.id)) {
          att.add(q.id);
          if (FLUID_OUT[q.type]) net.prod.push(q);
          if (FLUID_IN[q.type]) net.cons.push(q);
        }
        const t = this.towerAt.get(j);
        if (t && TOWERS[t.type].needs.fluid && !atTw.has(t.id)) { atTw.add(t.id); net.towers.push(t); }
      }
      // what the network carries: crude if a pumpjack feeds it, else petrol if a refinery does, else whatever is in it
      net.forced = net.prod.some((q) => q.type === 'pump') ? 'crude' : net.prod.some((q) => q.type === 'refinery') ? 'petrol' : null;
      if (net.forced && net.fluid !== net.forced) { net.fluid = net.forced; net.amt = 0; }
      this.pipeNets.push(net);
    }
    // power networks: poles and generators wired to each other within POLE_REACH
    this.powerNets = []; this.wires = [];
    const nodes = this.facs.filter((f) => f.type === 'pole' || f.type === 'generator');
    for (const a of nodes) {
      if (a.net >= 0) continue;
      const net: PowerNet = { id: this.powerNets.length, nodes: [a], cons: [], towers: [], cap: 0, demand: 0, sat: 0 };
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
    // consumers: the first network that has a node within SUPPLY
    const netOf = (cx: number, cz: number): PowerNet | undefined => {
      for (const net of this.powerNets) for (const n of net.nodes) if (hexDist(n.cx, n.cz, cx, cz) <= SUPPLY) return net;
      return undefined;
    };
    for (const f of this.facs) { if (!FACS[f.type].power) continue; const n = netOf(f.cx, f.cz); if (n) n.cons.push(f); else f.pwr = 0; }
    for (const t of this.host.towers) { if (!TOWERS[t.type].needs.power) continue; const n = netOf(t.cx, t.cz); if (n) n.towers.push(t); else t.pwr = 0; }
  }

  /** The power network a tile is supplied from, or -1. */
  powerAt(cx: number, cz: number): number {
    for (const net of this.powerNets) for (const n of net.nodes) if (hexDist(n.cx, n.cz, cx, cz) <= SUPPLY) return net.id;
    return -1;
  }
  /** Which of the six sides of a pipe connect (to a pipe, a fluid building or a fluid tower): a bit per direction. */
  pipeMask(f: Fac): number {
    let m = 0;
    for (let d = 0; d < 6; d++) {
      const [nx, nz] = neighbor(f.cx, f.cz, d), j = idx(nx, nz);
      if (j < 0) continue;
      const q = this.at[j] ? this.byId.get(this.at[j]) : undefined;
      if (q && (q.type === 'pipe' || FLUID_OUT[q.type] || FLUID_IN[q.type])) m |= 1 << d;
      else { const t = this.towerAt.get(j); if (t && TOWERS[t.type].needs.fluid) m |= 1 << d; }
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
  /** How many of an item a building would still take. */
  private room(f: Fac, it: ItemType): number {
    const have = f.inv[it] || 0;
    if (f.type === 'smelter') {
      if (it === 'coal') return 4 - have;
      // (each ore has its own room, so a smelter fed both kinds keeps making both)
      if (it === 'iron_ore' || it === 'copper_ore') return 3 - have;
      return 0;
    }
    if (f.type === 'generator') return it === 'coal' ? 4 - have : 0;
    const r = MAKES[f.type], need = r && r.inp[it];
    return need ? Math.max(4, need * 2) - have : 0;
  }
  /** Hand an item to whatever stands on tile j (not a belt). True if it was taken. */
  private give(j: number, it: ItemType, crate = false): boolean {
    const q = this.at[j] ? this.byId.get(this.at[j]) : undefined;
    if (q) {
      if (q.type === 'belt' || this.room(q, it) <= 0) return false;
      q.inv[it] = (q.inv[it] || 0) + 1;
      return true;
    }
    const t = this.towerAt.get(j);
    if (t && TOWERS[t.type].needs.item === it && t.stock < TOWER_STOCK) { t.stock++; if (!crate) this.delivered++; return true; }
    return false;
  }
  /** Put an item on a belt at its start, if there is room there. */
  private onBelt(b: Fac, it: ItemType, crate = false): boolean {
    const last = b.items[b.items.length - 1];
    if (last && last.p < BELT_GAP) return false;
    b.items.push(crate ? { it, p: 0, c: true } : { it, p: 0 });
    return true;
  }
  /** Hand one item out of a building or crate to the next side that takes it: a neighbour that needs it, or a belt whose line leads to one. */
  private push(f: Fac, it: ItemType): boolean {
    const bit = BIT[it];
    for (let k = 0; k < 6; k++) {
      const d = (f.rr + k) % 6, [nx, nz] = neighbor(f.cx, f.cz, d), j = idx(nx, nz);
      if (j < 0) continue;
      const q = this.at[j] ? this.byId.get(this.at[j]) : undefined;
      const ok = q && q.type === 'belt' ? !!(this.want.get(q.id)! & bit) && this.onBelt(q, it, f.type === 'crate') : this.give(j, it, f.type === 'crate');
      if (ok) { f.rr = (d + 1) % 6; return true; }
    }
    return false;
  }
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
        for (const j of taps) if (this.give(j, it.it, it.c)) { took = true; break; }
        if (took) { b.items.splice(i, 1); break; }
      }
    }
    const head = b.items[0];
    if (!head || head.p < 1) return;
    const [nx, nz] = neighbor(b.cx, b.cz, b.dir), j = idx(nx, nz);
    if (j < 0) return;
    const q = this.at[j] ? this.byId.get(this.at[j]) : undefined;
    if (q && q.type === 'belt') {
      const [bx, bz] = neighbor(q.cx, q.cz, q.dir);
      // two belts pointing at each other do not trade items back and forth
      if (!(bx === b.cx && bz === b.cz) && this.onBelt(q, head.it, head.c)) b.items.shift();
      return;
    }
    // the end of the line: the item waits for a taker beside the tile. If the building it waits at is starved of something
    // else and can never take this one (its stock of it is full), the item is tipped off the end so the line cannot lock up.
    if (q && (WANTS[q.type] & BIT[head.it]) && (q.state === 'noinput' || q.state === 'nofuel') && this.room(q, head.it) <= 0) b.items.shift();
  }

  // ---------- step ----------
  step(dt: number) {
    if (this.dirty) this.rebuild();
    const m = this.host.mods;
    // power: what the generators can give against what is asked of them
    for (const net of this.powerNets) {
      let cap = 0, demand = 0;
      for (const g of net.nodes) if (g.type === 'generator' && (g.fuel > 0 || (g.inv.coal || 0) > 0)) cap += GEN_POWER * m.gen;
      for (const f of net.cons) if (f.busy || (f.type === 'pump' && f.tout < TANK)) demand += FACS[f.type].power || 0;
      for (const t of net.towers) demand += TOWERS[t.type].needs.power || 0;
      net.cap = cap; net.demand = demand;
      net.sat = cap <= 0 ? 0 : demand <= 0 ? 1 : Math.min(1, cap / demand);
      const load = cap > 0 ? Math.min(1, demand / cap) : 0;
      for (const g of net.nodes) {
        if (g.type !== 'generator') continue;
        g.gen = 0;
        if (g.fuel <= 0 && (g.inv.coal || 0) > 0) { g.inv.coal!--; g.fuel += COAL_SECONDS; }
        if (g.fuel > 0) { g.fuel -= dt * load; g.gen = GEN_POWER * m.gen * load; g.state = load > 0 ? 'ok' : 'idle'; } else g.state = 'nofuel';
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
      for (const c of net.cons) {
        if (FLUID_IN[c.type] !== net.fluid) continue;
        const n = Math.min(net.amt, TANK - c.tin);
        if (n > 0) { c.tin += n; net.amt -= n; }
      }
      for (const t of net.towers) {
        if (TOWERS[t.type].needs.fluid !== net.fluid) continue;
        const n = Math.min(net.amt, TANK - t.tank);
        if (n > 0) { t.tank += n; net.amt -= n; }
      }
    }
    for (const p of this.facs) {
      const fl = FLUID_OUT[p.type];
      if (!fl || p.tout <= 0) continue;
      for (let d = 0; d < 6 && p.tout > 0; d++) {
        const [nx, nz] = neighbor(p.cx, p.cz, d), j = idx(nx, nz);
        if (j < 0) continue;
        const q = this.at[j] ? this.byId.get(this.at[j]) : undefined;
        if (q && q.type !== 'pipe' && FLUID_IN[q.type] === fl) { const n = Math.min(p.tout, TANK - q.tin); q.tin += n; p.tout -= n; continue; }
        const t = this.towerAt.get(j);
        if (t && TOWERS[t.type].needs.fluid === fl) { const n = Math.min(p.tout, TANK - t.tank); t.tank += n; p.tout -= n; }
      }
    }

    // buildings at work
    for (const f of this.facs) {
      switch (f.type) {
        case 'mine': {
          if (!f.ore || f.ore === 'oil') { f.state = 'nodeposit'; break; }
          if (f.out.length >= OUT_CAP) { f.state = 'full'; break; }
          f.prog += dt * m.mine; f.state = 'ok';
          if (f.prog >= MINE_TIME) { f.prog -= MINE_TIME; f.out.push(f.ore as ItemType); }
          break;
        }
        case 'pump': {
          if (f.ore !== 'oil') { f.state = 'nodeposit'; break; }
          if (f.tout >= TANK) { f.state = 'full'; break; }
          if (f.pwr <= 0) { f.state = 'nopower'; break; }
          f.tout = Math.min(TANK, f.tout + PUMP_RATE * m.mine * f.pwr * dt); f.state = 'ok';
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
          f.prog += dt * m.craft;
          // (cur stays: it says which ore was melted last)
          if (f.prog >= SMELT_TIME) { f.out.push(f.cur === 'copper_ore' ? 'copper' : 'iron'); f.busy = false; f.prog = 0; }
          break;
        }
        case 'works': case 'press': case 'cells': case 'missiles': {
          const r = MAKES[f.type]!;
          if (!f.busy) {
            if (r.out && f.out.length >= OUT_CAP) { f.state = 'full'; break; }
            let ok = true;
            for (const k in r.inp) if ((f.inv[k as ItemType] || 0) < r.inp[k as ItemType]!) ok = false;
            if (r.fluid && f.tin < r.fluid[1]) ok = false;
            if (!ok) { f.state = 'noinput'; break; }
            for (const k in r.inp) f.inv[k as ItemType]! -= r.inp[k as ItemType]!;
            if (r.fluid) f.tin -= r.fluid[1];
            f.busy = true; f.prog = 0;
          }
          if (f.pwr <= 0) { f.state = 'nopower'; break; }
          f.state = 'ok';
          f.prog += dt * m.craft * f.pwr;
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
          f.prog += dt * m.craft * f.pwr;
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
        case 'pipe': { const n = this.pipeNets[f.net]; f.state = n && n.fluid ? 'ok' : 'idle'; break; }
      }
    }
    // items move: buildings hand on their output, belts carry theirs one tile on
    for (const f of this.facs) if (f.out.length && this.push(f, f.out[0])) f.out.shift();
    for (const f of this.facs) if (f.type === 'belt') this.stepBelt(f, dt);
  }
}
