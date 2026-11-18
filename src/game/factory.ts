// BEATSPIRE factory: deposits, mines, Transfer Arms, conveyor belts, splitters, tunnels, pipes, power lines and the buildings
// that turn ore into tower ammunition and building materials. No rendering and no DOM: it runs inside the Sim, in the browser and in Node.
//
// Everything sits on the hex grid, one building per tile. ITEMS NEVER MOVE BETWEEN NEIGHBOURS BY THEMSELVES: mines, plants,
// crates and towers do not push into or pull from what stands beside them, and belts neither tap what they run past nor feed
// what they end at. Every hand-off of an item (building to tower, building to building, onto a belt, off a belt) goes
// through a Transfer Arm ('arm'), so the player decides what goes where. The one exception keeps the first minute simple:
// a supply crate feeds a TOWER standing right beside it by itself (never a belt, a building or an arm; arms may take from it).
//
// Transfer Arm. One tile, facing a way (dir 0..5, R turns it like a belt). It takes from the tile at its back edge
// (dir + 3) and delivers to the tile at its front edge (dir), straight through the hex. No power. One item per swing:
// Fac.prog runs 0..1 over ARM_TIME / FAC_LVL_SPEED[lvl - 1] seconds (0.8 s at Mk1): the arm picks at prog 0 (the item is then
// in Fac.hand), carries it to prog 0.5, drops it there, and swings back empty to 1 (= 0 again, ready to pick). If the front
// cannot take the item at 0.5 the arm waits there holding it (state 'full'). If the front no longer takes that kind of item
// at all (it was turned, rebuilt or switched its ammunition) the item is dropped and lost so the arm cannot lock up.
//  - it picks only an item its front will take right now ("accepts"): a tower whose ammunition it is, with its one stock
//    slot free; a building that uses it, with room for it (room()); an arm whose back is this arm, that is empty and ready,
//    and whose own front accepts it (chains hand over directly, up to ARM_CHAIN arms deep); a belt, a splitter or a paired
//    tunnel entrance with room (any item: a belt carries anything). With a filter (Fac.only) it picks only that item.
//  - it takes from: a mine's or plant's output (the first item in Fac.out its front accepts), a supply crate, the belt tile at
//    its back (the frontmost acceptable item that has come PICK_AT along the tile; any belt direction, so an arm beside a line
//    pulls one kind off it and an arm at its end empties it), a splitter (items that reached its centre), a tunnel exit (the
//    item that came out). Another arm hands into it from behind; arms never pull from arms.
//  - it puts onto a belt at p = 0 when it stands right behind the belt's start (the belt points away from it), else at
//    DROP_AT (the middle of the tile, from the side) if no item on the tile is closer than BELT_GAP to that point.
//  - 'take' event when it picks ({k, x, z: the source tile, tx, tz: the arm, it, id: arm id, who: 'f' + arm id}), 'put'
//    when it drops ({k, x, z: the arm, tx, tz: the target, it, id: target id, who: 't' + tower id or 'f' + fac id}).
// Belts carry items one tile at a time and hand the head on to the belt (not one pointing back), splitter or tunnel
// entrance in front; a belt pointing into another merges onto it. At the end of a line items wait for an arm.
// A Belt Splitter takes what belts bring into it and deals it out in turn to the belts leading away (those whose back edge
// touches it; a line running past it gets nothing). Arms may take from it.
// A Belt Tunnel pairs with the next tunnel facing the same way up to TUNNEL_REACH tiles ahead: items go under whatever
// stands between, roads included (nothing else may be built on a road); what comes out goes on ahead or waits for an arm.
// Fluids flow through pipe networks, and straight between neighbouring buildings; two Pipe Tunnels in a straight line join
// their networks. Power runs from generators over pole-to-pole wires to everything within reach of a pole.
//
// The factory only runs while a wave is on (the Sim does not step it between waves: arms freeze mid-swing like everything
// else). So the player can see before calling a wave whether everything will be supplied, diagnose() works out statically
// what reaches what, and links() lists the arm, crate, pipe and power connections for the view. Mines, plants, generators and
// arms have levels (FAC_LVL_SPEED).
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
/**
 * Transfer Arm: seconds per item at level 1 (pick, swing, drop, swing back); how far along a belt tile an item has to be
 * before an arm behind the tile can pick it; where an arm beside a belt puts its item; how many arms one hand-off may
 * look ahead through a chain.
 */
export const ARM_TIME = 0.8;
export const PICK_AT = 0.3;
export const DROP_AT = 0.5;
export const ARM_CHAIN = 12;
/** @deprecated nothing taps belts any more: the pick point of a Transfer Arm (PICK_AT). */
export const TAP_AT = PICK_AT;
/** Seconds between two items a supply crate hands to a tower beside it. */
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
  /** belts, belt tunnels and Transfer Arms: the direction (0..5, see HEX_DIRS) items leave by (an arm takes from dir + 3). Nothing else faces a way. */
  dir: number;
  /** input items waiting, output items waiting (oldest first), and the items of a belt (front first, p 0..1 along the tile),
   *  a splitter (p 0..0.5 to its centre) or a tunnel entrance (p 0..the tile distance to its exit) */
  inv: Partial<Record<ItemType, number>>; out: ItemType[]; items: BeltItem[];
  /** seconds into the current job (an arm: its swing 0..1, see the header), whether a job runs, and the ore a smelter is melting (or melted last) */
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
  /** round robin over the six sides (a crate: the next tower beside it; a splitter: the side it serves next) */
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
  /** Transfer Arm: the item in its hand (null when empty), whether it came out of a supply crate, and its filter (null: any item) */
  hand: ItemType | null; handC: boolean; only: ItemType | null;
  /** a source arms take from (producer, crate, belt, splitter, tunnel exit): the side (0..5) of the arm that took from it last,
   *  so arms sharing it take turns (see fairTurn); -1 before any did */
  trr: number;
}

/** What the factory feeds in a tower (the Sim's Tower carries these fields). */
export interface Supplied {
  id: number; type: TowerType; cx: number; cz: number; lvl: number;
  /** switched to its second ammunition (see needsOf) */
  ammo2?: boolean;
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
 * Supply diagnosis of a building, an arm, a belt or a tower (see Factory.diagnose). `missing`: short tokens for what it will
 * not get (an item's short name, "iron or copper ore", "coal", "power", "crude oil", "a taker for its output", and for an
 * arm "a target" / "something to take", for a belt "an arm at its end"); `from`: what will feed it ("Mine (by arm)", "Mine
 * (by belt)", "Supply Crate", "Generator", "pipe network with a Pumpjack"); `why`: the same in sentences for the panel
 * ("no Transfer Arm brings it iron ore", "arm has nothing to take", "arm points at nothing", "belt ends without an arm").
 */
export interface Diag { ok: boolean; missing: string[]; from: string[]; why?: string[] }
/**
 * A supply connection for the view. 'arm': a Transfer Arm (`from`, its fac id) from the tile at its back (x, z; `src` its key,
 * '' for none) to the tile at its front (tx, tz; `to`), `tiles` = [back tile, arm tile, front tile] (cz * GW + cx).
 * 'crate': a supply crate to the tower beside it it feeds by itself. 'pipe': a pipe tile to a consumer beside it that draws
 * from its network. 'power': a pole or generator to what it powers. ('belt' is no longer made: belts feed nothing.)
 * `from` is the fac id at x, z; `to` the taker at tx, tz ('t' + tower id or 'f' + fac id).
 */
export interface Link { kind: 'arm' | 'crate' | 'belt' | 'pipe' | 'power'; from: number; x: number; z: number; tx: number; tz: number; to: string; src?: string; tiles?: number[] }

const TKEYS: string[] = [], FKEYS: string[] = [];
/** The diagnosis key of a tower ('t' + id) and of a building ('f' + id), made once per id: no new string per lookup every frame. */
export const towerKey = (id: number): string => TKEYS[id] ?? (TKEYS[id] = 't' + id);
export const facKey = (id: number): string => FKEYS[id] ?? (FKEYS[id] = 'f' + id);

/** Buildings that face a way (belts, belt tunnels and Transfer Arms: R turns them). */
export const turns = (t: FacType) => t === 'belt' || t === 'tunnel' || t === 'arm';
/** Pipes and pipe tunnels: both are part of a pipe network. */
export const pipeLike = (t: FacType) => t === 'pipe' || t === 'ptunnel';
/** Belts, splitters and belt tunnels: they carry items; only Transfer Arms put items on them and take them off. */
export const conveyor = (t: FacType) => t === 'belt' || t === 'splitter' || t === 'tunnel';
const idx = (cx: number, cz: number) => (Number.isInteger(cx) && Number.isInteger(cz) && cx >= 0 && cz >= 0 && cx < GW && cz < GH ? cz * GW + cx : -1);
/** The tile index of every tile's six neighbours, -1 off the grid: NB[i * 6 + d] = idx(...neighbor(cx, cz, d)) (no arrays on the hot paths). */
const NB = (() => {
  const a = new Int32Array(GW * GH * 6);
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) for (let d = 0; d < 6; d++) { const [x, z] = neighbor(cx, cz, d); a[(cz * GW + cx) * 6 + d] = idx(x, z); }
  return a;
})();
/** The tile index next to a building (or tower) on side d (0..5), -1 off the grid. */
const nb = (f: { cx: number; cz: number }, d: number) => NB[(f.cz * GW + f.cx) * 6 + d];
const tileOf = (f: { cx: number; cz: number }) => f.cz * GW + f.cx;
/** A Transfer Arm's back tile (where it takes from) and front tile (where it delivers to). */
export const armBack = (f: Fac) => nb(f, (f.dir + 3) % 6);
export const armFront = (f: Fac) => nb(f, f.dir);
const BIT = Object.fromEntries(ITEM_TYPES.map((t, i) => [t, 1 << i])) as Record<ItemType, number>;
const ALL = (1 << ITEM_TYPES.length) - 1;
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
/** A recipe's inputs as a flat list (item, count, item, count, ...) in the order of MAKES, for the work step. */
const RECIPE_IN = Object.fromEntries(Object.entries(MAKES).map(([t, r]) => [t, Object.entries(r!.inp).flat()])) as Partial<Record<FacType, (ItemType | number)[]>>;
const WANTS = Object.fromEntries(Object.keys(FACS).map((t) => [t, wantsOf(t as FacType)])) as Record<FacType, number>;
/** Buildings with an output queue (Fac.out) an arm can take from. */
const MAKER: ReadonlySet<FacType> = new Set<FacType>(['mine', 'smelter', 'press', 'cells', 'missiles']);
const fluidName = (f: FluidType) => FLUIDS[f].name.toLowerCase();
/** Remove items[i] without the array splice() allocates. */
function cut<T>(a: T[], i: number) { for (let k = i; k < a.length - 1; k++) a[k] = a[k + 1]; a.length--; }

// Deposits are laid out by deposits.ts (with the supply crates, region by region); re-exported here for older callers.
export { makeDeposits } from './deposits.ts';

function newFac(id: number, type: FacType, cx: number, cz: number, dir: number, spent: number, ore: OreType | null): Fac {
  return {
    id, type, cx, cz, x: cellX(cx, cz), z: cellZ(cz), dir: ((dir % 6) + 6) % 6, inv: {}, out: [], items: [], prog: 0, busy: false, cur: null,
    fuel: 0, tin: 0, tout: 0, pwr: 0, net: -1, gen: 0, state: 'idle', spent, rr: 0, ore, hold: null, left: 0, lvl: 1, pair: 0, exit: false, under: false,
    hand: null, handC: false, only: null, trr: -1,
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
interface Reach { bits: number; names: Map<ItemType, Set<string>>; jam: number }
/** What travels where statically (see carry()): item bits per arm and conveyor, and per item the names of their producers. */
interface Carry {
  bits: Map<number, number>; src: Map<number, Map<ItemType, Set<string>>>;
  /** conveyors a jam stops for good (see jams()), with the items no arm takes there; and the flow as if nothing jammed */
  dead: Map<number, number>; free: Carry | null;
}

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
  /** per building / tower key ('f' + id, 't' + id): the pipe networks it hangs on, and the pole or generator that powers it */
  private pipeOf = new Map<string, PipeNet[]>();
  private powerBy = new Map<string, Fac>();
  private diagRev = -1; private diagCrates = -1; private diagMap = new Map<string, Diag>();
  private linkRev = -1; private linkList: Link[] = [];
  private host: FacHost;

  constructor(host: FacHost, ore: Uint8Array) { this.host = host; this.ore = ore; }

  oreAt(cx: number, cz: number): OreType | null { const i = idx(cx, cz); return i >= 0 && this.ore[i] ? ORE_TYPES[this.ore[i] - 1] : null; }
  facById(id: number) { return this.byId.get(id); }
  facAt(cx: number, cz: number) { const i = idx(cx, cz); return i >= 0 && this.at[i] ? this.byId.get(this.at[i]) : undefined; }
  private facAtI(j: number) { return j >= 0 && this.at[j] ? this.byId.get(this.at[j]) : undefined; }
  /** The tower on tile j (cz * GW + cx), if any (as the factory last saw the towers). */
  towerOn(j: number): Supplied | undefined { if (this.dirty) this.rebuild(); return this.towerAt.get(j); }

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
  /** Turn a belt, a belt tunnel or a Transfer Arm (an arm keeps what it holds; see the header for what happens to it). */
  rotate(id: number, dir: number) {
    const f = this.byId.get(id);
    if (!f || !turns(f.type) || !Number.isFinite(dir)) return;
    const d = ((Math.floor(dir) % 6) + 6) % 6;
    if (d !== f.dir) { f.dir = d; this.dirty = true; this.rev++; }
  }
  /** Set a Transfer Arm's filter: it then picks only that item (null: any). False for anything that is not an arm or not an item. */
  setFilter(id: number, it: ItemType | null): boolean {
    const f = this.byId.get(id);
    if (!f || f.type !== 'arm' || (it !== null && !(typeof it === 'string' && Object.hasOwn(ITEMS, it)))) return false;
    if (f.only !== it) { f.only = it; this.rev++; }
    return true;
  }
  /** Work the networks out again if anything changed, and bring the grids' potential / full up to date. Cheap when nothing did. */
  sync() {
    if (this.dirty) this.rebuild();
    const m = this.host.mods;
    for (let n = 0; n < this.powerNets.length; n++) {
      const net = this.powerNets[n], nodes = net.nodes, cons = net.cons, towers = net.towers;
      let pot = 0, full = 0;
      for (let i = 0; i < nodes.length; i++) if (nodes[i].type === 'generator') pot += GEN_POWER * m.gen * spd(nodes[i]);
      for (let i = 0; i < cons.length; i++) full += FACS[cons[i].type].power || 0;
      for (let i = 0; i < towers.length; i++) full += needsOf(towers[i]).power || 0;
      net.potential = pot; net.full = full;
    }
  }

  // ---------- networks ----------
  /** True if belt b points at tile (cx, cz). */
  private pointsAt(b: Fac, cx: number, cz: number) { const j = nb(b, b.dir); return j >= 0 && j === cz * GW + cx; }
  /** True if a tunnel is an entrance items may be fed into from tile (cx, cz): paired, and that tile is not the one in front of it. */
  private entranceFrom(q: Fac, cx: number, cz: number) { return q.type === 'tunnel' && q.pair > 0 && !q.exit && !this.pointsAt(q, cx, cz); }
  /** True if q is a belt or a paired tunnel entrance leading away from splitter s (the tile at its back is the splitter's): the only belts a splitter deals to, so a line running past it gets nothing. */
  private leadsFrom(q: Fac, s: Fac) { return (q.type === 'belt' || (q.type === 'tunnel' && q.pair > 0 && !q.exit)) && nb(q, (q.dir + 3) % 6) === tileOf(s); }
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
          const q = this.facAtI(nb(p, d));
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
        const j = nb(p, d);
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
      const j = nb(f, d);
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
  /** How many of an item a building would still take. (Small: what it waits for stays where it can be seen.) 0 for anything that takes no items. */
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
  /** Room on a belt for an item an arm on tile `from` puts there: at its start from right behind it, else at DROP_AT (see the header). -1 for none, else the p it goes in at. */
  private beltSlot(b: Fac, from: number): number {
    const items = b.items;
    if (nb(b, (b.dir + 3) % 6) === from) { const last = items[items.length - 1]; return last && last.p < BELT_GAP ? -1 : 0; }
    for (let i = 0; i < items.length; i++) if (Math.abs(items[i].p - DROP_AT) < BELT_GAP - 1e-9) return -1;
    return DROP_AT;
  }
  /**
   * The items the thing on tile j will ever take from arm `a` (bits, see BIT), ignoring room: a tower its ammunition, a building
   * its inputs, a belt, splitter or tunnel entrance anything, an arm behind which `a` stands what its own front takes (and its
   * filter lets through). 0 for nothing (an empty tile, a mine, a crate, a pumpjack, a pipe, a pole, a tunnel exit).
   */
  acceptMask(j: number, a: Fac, depth = 0): number {
    if (j < 0) return 0;
    const q = this.facAtI(j);
    if (q) {
      switch (q.type) {
        case 'belt': case 'splitter': return ALL;
        case 'tunnel': return this.entranceFrom(q, a.cx, a.cz) ? ALL : 0;
        case 'arm': {
          if (depth >= ARM_CHAIN || armBack(q) !== tileOf(a)) return 0;
          return (q.only ? BIT[q.only] : ALL) & this.acceptMask(armFront(q), q, depth + 1);
        }
        default: return WANTS[q.type];
      }
    }
    const t = this.towerAt.get(j), it = t && needsOf(t).item;
    return it ? BIT[it] : 0;
  }
  /**
   * True if the thing on tile j takes item `it` from arm `a` right now (see the header: "accepts"). An arm in front takes it
   * when its own front does, ignoring where the arms ahead are in their swing, so the arms of a chain swing at the same time
   * instead of one after another; but a tower or building at the chain's end must have room for this item on top of the
   * `held` items the arms ahead already carry towards it (so nothing waits in a hand for room it never gets; a belt, splitter
   * or tunnel takes them all in time). `ready` (the hand-over itself) also needs the arm in front empty and back at the start of its swing.
   */
  private takes(j: number, it: ItemType, a: Fac, depth: number, ready = false, held = 0): boolean {
    if (j < 0) return false;
    const q = this.facAtI(j);
    if (q) {
      switch (q.type) {
        case 'belt': return this.beltSlot(q, tileOf(a)) >= 0;
        case 'splitter': return q.items.length < SPLIT_CAP;
        case 'tunnel': { if (!this.entranceFrom(q, a.cx, a.cz)) return false; const last = q.items[q.items.length - 1]; return !last || last.p >= BELT_GAP; }
        case 'arm': return depth < ARM_CHAIN && armBack(q) === tileOf(a) && (!q.only || q.only === it) && (!ready || (q.hand === null && q.prog === 0)) && this.takes(armFront(q), it, q, depth + 1, false, held + (q.hand ? 1 : 0));
        default: return this.room(q, it) > held;
      }
    }
    const t = this.towerAt.get(j);
    return !!t && needsOf(t).item === it && t.stock + held < TOWER_STOCK;
  }
  /** The key and world position of what stands on tile j, for events ('' when nothing does). */
  private keyAt(j: number): string { const q = this.facAtI(j); if (q) return facKey(q.id); const t = this.towerAt.get(j); return t ? towerKey(t.id) : ''; }
  /** Arm `a` puts what it holds on tile j (takes() said yes). */
  private drop(a: Fac, j: number) {
    const it = a.hand!, crate = a.handC, q = this.facAtI(j);
    let id = 0, who = '', tx = 0, tz = 0;
    if (q) {
      id = q.id; who = facKey(q.id); tx = q.x; tz = q.z;
      if (q.type === 'belt') {
        const p = this.beltSlot(q, tileOf(a)), items = q.items;
        let k = 0;
        while (k < items.length && items[k].p > p) k++;
        items.splice(k, 0, crate ? { it, p, c: true } : { it, p });
      } else if (q.type === 'splitter' || q.type === 'tunnel') q.items.push(crate ? { it, p: 0, c: true } : { it, p: 0 });
      else if (q.type === 'arm') { q.hand = it; q.handC = crate; q.prog = 0; }
      else q.inv[it] = (q.inv[it] || 0) + 1;
    } else {
      const t = this.towerAt.get(j)!;
      t.stock++; if (!crate) this.delivered++;
      id = t.id; who = towerKey(t.id); tx = cellX(t.cx, t.cz); tz = cellZ(t.cz);
    }
    a.hand = null; a.handC = false;
    this.host.events.push({ k: 'put', x: a.x, z: a.z, tx, tz, it, id, who });
  }
  /** Arm `a` picks an item from tile j its front accepts right now (see the header). Returns the item (in its hand), or null. */
  private pick(a: Fac, j: number): ItemType | null {
    const q = this.facAtI(j);
    if (!q) return null;
    const front = armFront(a), mask = (a.only ? BIT[a.only] : ALL) & this.acceptMask(front, a);
    if (!mask) return null;
    let got: ItemType | null = null, crate = false;
    if (MAKER.has(q.type)) {
      const out = q.out;
      for (let i = 0; i < out.length; i++) { const it = out[i]; if (mask & BIT[it] && this.takes(front, it, a, 0) && this.fairTurn(q, a, it)) { got = it; cut(out, i); break; } }
    } else if (q.type === 'crate') {
      if (q.left > 0 && q.hold && mask & BIT[q.hold] && this.takes(front, q.hold, a, 0) && this.fairTurn(q, a, q.hold)) { got = q.hold; crate = true; q.left--; }
    } else if (q.type === 'belt' || q.type === 'splitter') {
      const items = q.items, at = q.type === 'belt' ? PICK_AT : 0.5;
      for (let i = 0; i < items.length; i++) {
        const b = items[i];
        if (b.p < at) break;
        if (mask & BIT[b.it] && this.takes(front, b.it, a, 0) && this.fairTurn(q, a, b.it)) { got = b.it; crate = !!b.c; cut(items, i); break; }
      }
    } else if (q.type === 'tunnel' && q.exit) {
      const e = this.byId.get(q.pair), head = e && e.items[0];
      if (head && head.p >= hexDist(e.cx, e.cz, q.cx, q.cz) && mask & BIT[head.it] && this.takes(front, head.it, a, 0) && this.fairTurn(q, a, head.it)) { got = head.it; crate = !!head.c; e.items.shift(); }
    }
    if (!got) return null;
    a.hand = got; a.handC = crate; q.trr = a.dir;
    this.host.events.push({ k: 'take', x: q.x, z: q.z, tx: a.x, tz: a.z, it: got, id: a.id, who: facKey(a.id) });
    return got;
  }
  /**
   * Arms sharing a source take turns: an arm may take `it` from source q unless an arm that comes before it in q's round
   * robin (the sides after the one that took last, Fac.trr) is ready right now (empty, at the start of its swing) and would
   * take `it` too. (An arm stands on the side a.dir of the tile at its back.) Without this the arm stepped first would take
   * every item of a slow mine and the other one would get nothing.
   */
  private fairTurn(q: Fac, a: Fac, it: ItemType): boolean {
    const base = q.trr < 0 ? 5 : q.trr, j = tileOf(q);
    for (let k = 1; k <= 6; k++) {
      const d = (base + k) % 6;
      if (d === a.dir) return true;
      const o = this.facAtI(nb(q, d));
      if (o && o.type === 'arm' && o.dir === d && armBack(o) === j && o.hand === null && o.prog === 0 && (!o.only || o.only === it) && this.takes(armFront(o), it, o, 0)) return false;
    }
    return true;
  }
  /** A Transfer Arm's swing (see the header for the timing model). */
  private stepArm(a: Fac, dt: number) {
    const v = (dt * spd(a)) / ARM_TIME;
    if (a.hand) {
      // (1e-9: a swing of whole steps must not lose one to rounding; the swing past the drop point is kept)
      const p = a.prog < 0.5 ? a.prog + v : a.prog;
      if (p < 0.5 - 1e-9) { a.prog = p; a.state = 'ok'; return; }
      const front = armFront(a);
      if (!(this.acceptMask(front, a) & BIT[a.hand])) { // nothing there takes it any more: lost ('lost' event, so the view can show it)
        this.host.events.push({ k: 'lost', x: a.x, z: a.z, it: a.hand, id: a.id, who: facKey(a.id) });
        a.hand = null; a.handC = false; a.state = 'idle';
      } else if (this.takes(front, a.hand, a, 0, true)) { this.drop(a, front); a.state = 'ok'; }
      else { a.prog = 0.5; a.state = 'full'; return; }
      a.prog = Math.max(0.5, p);
      return;
    }
    if (a.prog > 0) {
      a.prog += v; a.state = 'ok';
      if (a.prog < 1 - 1e-9) return;
      a.prog = Math.max(0, a.prog - 1);
      // (the swing that is left over goes into the next item, so an arm keeps its rate whatever the step)
      if (this.pick(a, armBack(a))) a.prog = Math.min(0.5, a.prog); else a.prog = 0;
      return;
    }
    if (this.pick(a, armBack(a))) { a.prog = Math.min(0.5, v); a.state = 'ok'; return; }
    const m = (a.only ? BIT[a.only] : ALL) & this.acceptMask(armFront(a), a);
    a.state = !m ? 'idle' : this.offers(armBack(a), m) ? 'full' : 'noinput';
  }
  /** True if what stands on tile j has an item of `mask` an arm behind which it stands could take (ignoring the arm's front). */
  private offers(j: number, mask: number): boolean {
    const q = this.facAtI(j);
    if (!q) return false;
    if (MAKER.has(q.type)) { for (let i = 0; i < q.out.length; i++) if (mask & BIT[q.out[i]]) return true; return false; }
    if (q.type === 'crate') return q.left > 0 && !!q.hold && !!(mask & BIT[q.hold]);
    if (q.type === 'belt' || q.type === 'splitter') { const at = q.type === 'belt' ? PICK_AT : 0.5; for (let i = 0; i < q.items.length && q.items[i].p >= at; i++) if (mask & BIT[q.items[i].it]) return true; return false; }
    if (q.type === 'tunnel' && q.exit) { const e = this.byId.get(q.pair), h = e && e.items[0]; return !!h && h.p >= hexDist(e.cx, e.cz, q.cx, q.cz) && !!(mask & BIT[h.it]); }
    return false;
  }
  /** Put an item on a belt (or into a tunnel entrance) at its start, if there is room there. */
  private onBelt(b: Fac, it: BeltItem): boolean {
    const last = b.items[b.items.length - 1];
    if (last && last.p < BELT_GAP) return false;
    b.items.push(it.c ? { it: it.it, p: 0, c: true } : { it: it.it, p: 0 });
    return true;
  }
  /** Move the head item of a belt (or a tunnel exit, `from`) onto the tile in front: a belt, a splitter, a tunnel entrance. */
  private passOn(from: Fac, it: BeltItem): boolean {
    const j = nb(from, from.dir);
    if (j < 0) return false;
    const q = this.facAtI(j);
    if (!q) return false;
    if (q.type === 'belt') return !this.pointsAt(q, from.cx, from.cz) && this.onBelt(q, it); // (two belts pointing at each other do not trade)
    if (q.type === 'splitter') { if (q.items.length >= SPLIT_CAP) return false; q.items.push(it.c ? { it: it.it, p: 0, c: true } : { it: it.it, p: 0 }); return true; }
    if (q.type === 'tunnel') return this.entranceFrom(q, from.cx, from.cz) && this.onBelt(q, it);
    return false;
  }
  private stepBelt(b: Fac, dt: number) {
    const v = BELT_SPEED * this.host.mods.belt * dt;
    for (let i = 0; i < b.items.length; i++) {
      const lim = i === 0 ? 1 : b.items[i - 1].p - BELT_GAP;
      b.items[i].p = Math.min(lim, b.items[i].p + v);
    }
    const head = b.items[0];
    // at the end of a line the item waits (for an arm, or for the belt ahead to make room)
    if (head && head.p >= 1 && this.passOn(b, head)) b.items.shift();
  }
  /** A tunnel entrance: items travel underground at belt speed to the exit, then on from the exit like off a belt end (or an arm takes them there). */
  private stepTunnel(t: Fac, dt: number) {
    const e = t.pair && !t.exit ? this.byId.get(t.pair) : undefined;
    if (!e) return;
    const len = hexDist(t.cx, t.cz, e.cx, e.cz), v = BELT_SPEED * this.host.mods.belt * dt;
    for (let i = 0; i < t.items.length; i++) {
      const lim = i === 0 ? len : t.items[i - 1].p - BELT_GAP;
      t.items[i].p = Math.min(lim, t.items[i].p + v);
    }
    const head = t.items[0];
    if (head && head.p >= len && this.passOn(e, head)) t.items.shift();
  }
  /** A splitter: each item goes, in turn, to the next side with a belt (or tunnel entrance) leading away that has room. Arms take from it too. */
  private stepSplitter(s: Fac, dt: number) {
    const v = BELT_SPEED * this.host.mods.belt * dt;
    for (let i = 0; i < s.items.length; i++) s.items[i].p = Math.min(i === 0 ? 0.5 : s.items[i - 1].p, s.items[i].p + v);
    const head = s.items[0];
    if (!head || head.p < 0.5) return;
    for (let k = 0; k < 6; k++) {
      const d = (s.rr + k) % 6, q = this.facAtI(nb(s, d));
      if (!q || !this.leadsFrom(q, s)) continue;
      if (this.onBelt(q, head)) { s.rr = (d + 1) % 6; s.items.shift(); return; }
    }
  }
  /** A supply crate hands one item every CRATE_TIME to a tower beside it that runs on it (the only hand-off without an arm). */
  private stepCrate(f: Fac, dt: number) {
    if (f.left <= 0 || !f.hold) { f.state = 'empty'; return; }
    f.state = 'ok';
    f.prog += dt;
    if (f.prog < CRATE_TIME) return;
    f.prog = CRATE_TIME;
    for (let k = 0; k < 6; k++) {
      const d = (f.rr + k) % 6, j = nb(f, d), t = j >= 0 ? this.towerAt.get(j) : undefined;
      if (!t || needsOf(t).item !== f.hold || t.stock >= TOWER_STOCK) continue;
      t.stock++; f.left--; f.prog = 0; f.rr = (d + 1) % 6;
      this.host.events.push({ k: 'take', x: f.x, z: f.z, tx: cellX(t.cx, t.cz), tz: cellZ(t.cz), it: f.hold, id: t.id, who: towerKey(t.id) });
      return;
    }
  }

  // ---------- step ----------
  step(dt: number) {
    this.sync();
    // (indexed loops, no iterators or arrays: this runs every step of the game)
    this.stepPower(dt);
    this.stepFluids();
    this.stepWork(dt);
    // items move: arms swing, belts, splitters and tunnels carry theirs on
    const facs = this.facs;
    for (let i = 0; i < facs.length; i++) {
      const f = facs[i];
      if (f.type === 'arm') this.stepArm(f, dt);
      else if (f.type === 'belt') this.stepBelt(f, dt);
      else if (f.type === 'splitter') this.stepSplitter(f, dt);
      else if (f.type === 'tunnel') this.stepTunnel(f, dt);
    }
  }
  /** Power: what the generators can give against what is asked of them. */
  private stepPower(dt: number) {
    const m = this.host.mods, nets = this.powerNets;
    for (let n = 0; n < nets.length; n++) {
      const net = nets[n], nodes = net.nodes, cons = net.cons, towers = net.towers;
      let cap = 0, demand = 0;
      for (let i = 0; i < nodes.length; i++) { const g = nodes[i]; if (g.type === 'generator' && (g.fuel > 0 || (g.inv.coal || 0) > 0)) cap += GEN_POWER * m.gen * spd(g); }
      for (let i = 0; i < cons.length; i++) { const f = cons[i]; if (f.busy || (f.type === 'pump' && f.tout < TANK)) demand += FACS[f.type].power || 0; }
      for (let i = 0; i < towers.length; i++) demand += needsOf(towers[i]).power || 0;
      net.cap = cap; net.demand = demand;
      net.sat = cap <= 0 ? 0 : demand <= 0 ? 1 : Math.min(1, cap / demand);
      const load = cap > 0 ? Math.min(1, demand / cap) : 0;
      for (let i = 0; i < nodes.length; i++) {
        const g = nodes[i];
        if (g.type !== 'generator') continue;
        g.gen = 0;
        if (g.fuel <= 0 && (g.inv.coal || 0) > 0) { g.inv.coal!--; g.fuel += COAL_SECONDS; }
        // (a bigger generator burns its coal faster: a level buys power, not fuel)
        if (g.fuel > 0) { g.fuel -= dt * load * spd(g); g.gen = GEN_POWER * m.gen * spd(g) * load; g.state = load > 0 ? 'ok' : 'idle'; } else g.state = 'nofuel';
      }
      for (let i = 0; i < cons.length; i++) cons[i].pwr = net.sat;
      for (let i = 0; i < towers.length; i++) towers[i].pwr = net.sat;
    }
  }
  /** Fluids: producers fill their networks, consumers draw from them; neighbours trade directly too. */
  private stepFluids() {
    const nets = this.pipeNets;
    for (let n = 0; n < nets.length; n++) {
      const net = nets[n], prod = net.prod, cons = net.cons, towers = net.towers;
      if (!net.forced && net.amt <= 0.001) { net.fluid = null; net.amt = 0; }
      for (let i = 0; i < prod.length; i++) {
        const p = prod[i];
        const fl = FLUID_OUT[p.type]!;
        if (net.fluid && net.fluid !== fl) continue;
        const n = Math.min(p.tout, net.cap - net.amt);
        if (n > 0) { net.fluid = fl; net.amt += n; p.tout -= n; }
      }
      if (!net.fluid) continue;
      // shared out in proportion to the room in each tank, so when the producers cannot keep up nobody runs dry first
      let room = 0;
      for (let i = 0; i < cons.length; i++) { const c = cons[i]; if (FLUID_IN[c.type] === net.fluid) room += Math.max(0, TANK - c.tin); }
      for (let i = 0; i < towers.length; i++) { const t = towers[i]; if (needsOf(t).fluid === net.fluid) room += Math.max(0, TOWER_TANK - t.tank); }
      if (room <= 0 || net.amt <= 0) continue;
      const share = Math.min(1, net.amt / room);
      for (let i = 0; i < cons.length; i++) {
        const c = cons[i];
        if (FLUID_IN[c.type] !== net.fluid) continue;
        const n = Math.max(0, TANK - c.tin) * share;
        c.tin += n; net.amt -= n;
      }
      for (let i = 0; i < towers.length; i++) {
        const t = towers[i];
        if (needsOf(t).fluid !== net.fluid) continue;
        const n = Math.max(0, TOWER_TANK - t.tank) * share;
        t.tank += n; net.amt -= n;
      }
      net.amt = Math.max(0, net.amt);
    }
    const facs = this.facs;
    for (let i = 0; i < facs.length; i++) {
      const p = facs[i], fl = FLUID_OUT[p.type];
      if (!fl || p.tout <= 0) continue;
      for (let d = 0; d < 6 && p.tout > 0; d++) {
        const j = nb(p, d);
        if (j < 0) continue;
        const q = this.facAtI(j);
        if (q && !pipeLike(q.type) && FLUID_IN[q.type] === fl) { const n = Math.min(p.tout, TANK - q.tin); q.tin += n; p.tout -= n; continue; }
        const t = this.towerAt.get(j);
        if (t && needsOf(t).fluid === fl) { const n = Math.min(p.tout, TOWER_TANK - t.tank); if (n > 0) { t.tank += n; p.tout -= n; } }
      }
    }
  }
  /** Buildings at work. */
  private stepWork(dt: number) {
    const m = this.host.mods, facs = this.facs;
    for (let i = 0; i < facs.length; i++) {
      const f = facs[i], k = spd(f);
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
            const inp = RECIPE_IN[f.type]!;
            for (let q = 0; q < inp.length; q += 2) if ((f.inv[inp[q] as ItemType] || 0) < (inp[q + 1] as number)) ok = false;
            if (r.fluid && f.tin < r.fluid[1]) ok = false;
            if (!ok) { f.state = 'noinput'; break; }
            for (let q = 0; q < inp.length; q += 2) f.inv[inp[q] as ItemType]! -= inp[q + 1] as number;
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
        case 'crate': this.stepCrate(f, dt); break;
        case 'pole': f.state = f.net >= 0 && this.powerNets[f.net] && this.powerNets[f.net].cap > 0 ? 'ok' : 'nopower'; break;
        case 'pipe': case 'ptunnel': { const n = this.pipeNets[f.net]; f.state = n && n.fluid ? 'ok' : 'idle'; break; }
        case 'tunnel': f.state = f.pair ? (f.items.length ? 'ok' : 'idle') : 'noinput'; break;
      }
    }
  }

  // ---------- what will reach what (while time stands still) ----------
  /** The Transfer Arms by the tile at their back (the tile they take from). */
  private armsByBack(): Map<number, Fac[]> {
    const m = new Map<number, Fac[]>();
    for (const a of this.facs) {
      if (a.type !== 'arm') continue;
      const j = armBack(a);
      if (j < 0) continue;
      const l = m.get(j);
      if (l) l.push(a); else m.set(j, [a]);
    }
    return m;
  }
  /** The items an arm can ever pick: its filter and what its front takes. */
  private amask(a: Fac): number { return (a.only ? BIT[a.only] : ALL) & this.acceptMask(armFront(a), a); }
  /** True if there is something on tile j an arm `a` behind which it stands could ever take items from. */
  private sourceAt(j: number, a: Fac): boolean {
    const q = this.facAtI(j);
    if (!q) return false;
    return MAKER.has(q.type) || q.type === 'crate' || q.type === 'belt' || q.type === 'splitter' || (q.type === 'tunnel' && q.exit) || (q.type === 'arm' && armFront(q) === tileOf(a));
  }
  /**
   * The items that will travel through each Transfer Arm and on each conveyor, given what each producer makes (`out`: fac id ->
   * item bits), and per item the names of the producers they come from ("Mine" straight through arms, "Mine (by belt)"
   * once they rode a conveyor). Arms take from the producer, belt, splitter or tunnel exit behind them what their front
   * takes; an arm hands on into the arm in front of it, or onto the belt, splitter or tunnel entrance there; belts carry on
   * what they hold; a splitter deals to the belts leading away; a tunnel carries to its exit.
   */
  private carry(out: Map<number, number>, back: Map<number, Fac[]>): Carry {
    const free = this.flow(out, back, null), dead = this.jams(free, back);
    if (!dead.size) return free;
    const c = this.flow(out, back, dead);
    c.dead = dead; c.free = free;
    return c;
  }
  /** The conveyors a conveyor hands its items on to: the belt (not one pointing back), splitter or tunnel entrance in front; a tunnel entrance its exit; a splitter the belts leading away. */
  private fwd(c: Fac): Fac[] {
    const r: Fac[] = [];
    if (c.type === 'tunnel' && !c.exit) { const e = c.pair ? this.byId.get(c.pair) : undefined; if (e) r.push(e); return r; }
    if (c.type === 'splitter') { for (let d = 0; d < 6; d++) { const q = this.facAtI(nb(c, d)); if (q && this.leadsFrom(q, c)) r.push(q); } return r; }
    const q = this.facAtI(nb(c, c.dir));
    if (q && (q.type === 'belt' ? !this.pointsAt(q, c.cx, c.cz) : q.type === 'splitter' || this.entranceFrom(q, c.cx, c.cz))) r.push(q);
    return r;
  }
  /**
   * Belt jams (from the flow `c`): a conveyor tile whose items cannot all leave it stops for good once one it cannot pass on
   * reaches its head: where the line ends (or every way on is itself jammed) and an item rides it that no arm at that tile
   * takes, that item waits there forever and everything behind it piles up (an arm picks only what came PICK_AT along, so it
   * cannot reach past it either). Returns the dead conveyors with the items no arm takes there (an arm-less end: all it carries).
   */
  private jams(c: Carry, back: Map<number, Fac[]>): Map<number, number> {
    const dead = new Map<number, number>(), feeders = new Map<number, Fac[]>(), todo: Fac[] = [];
    const bad = (f: Fac) => {
      let take = 0;
      if (f.type !== 'tunnel' || f.exit) for (const a of back.get(tileOf(f)) || []) take |= this.amask(a);
      return (c.bits.get(f.id) || 0) & ~take;
    };
    const ways = new Map<number, Fac[]>();
    for (const f of this.facs) {
      if (!conveyor(f.type)) continue;
      const w = this.fwd(f);
      ways.set(f.id, w);
      for (const q of w) { const l = feeders.get(q.id); if (l) l.push(f); else feeders.set(q.id, [f]); }
      if (!w.length) todo.push(f);
    }
    for (let k = 0; k < todo.length; k++) {
      const f = todo[k];
      if (dead.has(f.id) || (ways.get(f.id) || []).some((q) => !dead.has(q.id))) continue;
      const b = bad(f);
      if (!b) continue;
      dead.set(f.id, b);
      for (const u of feeders.get(f.id) || []) todo.push(u);
    }
    return dead;
  }
  /** carry() with the conveyors in `dead` handing nothing to the arms behind them. */
  private flow(out: Map<number, number>, back: Map<number, Fac[]>, dead: Map<number, number> | null): Carry {
    const bits = new Map<number, number>(), src = new Map<number, Map<ItemType, Set<string>>>(), queue: Fac[] = [];
    const add = (q: Fac, b: number, names: (it: ItemType) => Iterable<string>) => {
      if (!b) return;
      let m = src.get(q.id);
      if (!m) src.set(q.id, (m = new Map()));
      const was = bits.get(q.id) || 0;
      let grew = was !== (was | b);
      bits.set(q.id, was | b);
      for (const it of ITEM_TYPES) {
        if (!(b & BIT[it])) continue;
        let s = m.get(it);
        if (!s) m.set(it, (s = new Set()));
        for (const n of names(it)) if (!s.has(n)) { s.add(n); grew = true; }
      }
      if (grew) queue.push(q);
    };
    const belted = (n: string) => (n.endsWith(')') ? n : n + ' (by belt)');
    for (const f of this.facs) {
      const b = out.get(f.id) || 0;
      if (!b) continue;
      const name = [FACS[f.type].name];
      for (const a of back.get(tileOf(f)) || []) add(a, b & this.amask(a), () => name);
    }
    for (let k = 0; k < queue.length && k < 40000; k++) {
      const c = queue[k], b = bits.get(c.id) || 0, from = (it: ItemType) => src.get(c.id)!.get(it) || [];
      const viaBelt = (it: ItemType) => [...from(it)].map(belted);
      if (c.type === 'arm') {
        const q = this.facAtI(armFront(c));
        if (!q) continue;
        if (q.type === 'arm') { if (armBack(q) === tileOf(c)) add(q, b & this.amask(q), from); }
        else if (q.type === 'belt' || q.type === 'splitter' || this.entranceFrom(q, c.cx, c.cz)) add(q, b, viaBelt);
        continue;
      }
      // a conveyor: on along the line, and into every arm behind which it stands
      const ahead = (e: Fac) => {
        const q = this.facAtI(nb(e, e.dir));
        if (!q) return;
        if (q.type === 'belt' && !this.pointsAt(q, e.cx, e.cz)) add(q, b, from);
        else if (q.type === 'splitter') add(q, b, from);
        else if (this.entranceFrom(q, e.cx, e.cz)) add(q, b, from);
      };
      if (c.type === 'belt') ahead(c);
      else if (c.type === 'tunnel' && c.pair && !c.exit) { const e = this.byId.get(c.pair)!; add(e, b, from); continue; }
      else if (c.type === 'tunnel' && c.exit) ahead(c);
      else if (c.type === 'splitter') for (let d = 0; d < 6; d++) {
        const q = this.facAtI(nb(c, d));
        if (q && this.leadsFrom(q, c)) add(q, b, from);
      }
      if (!dead || !dead.has(c.id)) for (const a of back.get(tileOf(c)) || []) add(a, b & this.amask(a), from);
    }
    return { bits, src, dead: new Map(), free: null };
  }
  /** What reaches the thing on tile (cx, cz): what the Transfer Arms pointing at it bring, and for a tower a supply crate right beside it. */
  private reach(cx: number, cz: number, cr: Carry, tower: boolean): Reach {
    const r: Reach = { bits: 0, names: new Map(), jam: 0 }, j0 = cz * GW + cx;
    const add = (b: number, names: (it: ItemType) => Iterable<string>) => {
      for (const it of ITEM_TYPES) {
        if (!(b & BIT[it])) continue;
        r.bits |= BIT[it];
        let s = r.names.get(it);
        if (!s) r.names.set(it, (s = new Set()));
        for (const n of names(it)) s.add(n);
      }
    };
    const byArm = (n: string) => (n.endsWith(')') ? n : n + ' (by arm)');
    for (let d = 0; d < 6; d++) {
      const q = this.facAtI(NB[j0 * 6 + d]);
      if (!q) continue;
      if (q.type === 'arm' && armFront(q) === j0) add(cr.bits.get(q.id) || 0, (it) => [...(cr.src.get(q.id)?.get(it) || [])].map(byArm));
      else if (tower && q.type === 'crate' && q.left > 0 && q.hold) add(BIT[q.hold], () => [FACS.crate.name]);
    }
    // (what would come if no belt line jammed: told apart in the diagnosis)
    if (cr.free) { const f = this.reach(cx, cz, cr.free, tower); r.jam = f.bits & ~r.bits; }
    return r;
  }
  /** True if a Transfer Arm takes some of `bit` out of producer f (or, for a crate, a tower beside it runs on it). */
  private taker(f: Fac, bit: number, back: Map<number, Fac[]>): boolean {
    for (const a of back.get(tileOf(f)) || []) if (this.amask(a) & bit) return true;
    if (f.type === 'crate') for (let d = 0; d < 6; d++) { const j = nb(f, d), t = j >= 0 ? this.towerAt.get(j) : undefined; if (t && needsOf(t).item && bit & BIT[needsOf(t).item!]) return true; }
    return false;
  }
  /** Who will take a fluid a producer makes: a neighbour that draws it, or a pipe network it feeds with a consumer of it. */
  private fluidTaker(f: Fac, fl: FluidType): boolean {
    for (let d = 0; d < 6; d++) {
      const j = nb(f, d), q = this.facAtI(j);
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
   * Supply diagnosis for every building, Transfer Arm and tower ('f' + id, 't' + id), and for every belt (or tunnel exit)
   * where a line that carries something ends without an arm, worked out from the layout alone (no time needs to pass), so
   * it holds while time stands still between waves. An input counts as supplied when a Transfer Arm pointing at the
   * consumer will bring it (straight from a producer, through a chain of arms, or off a belt line through splitters and
   * tunnels), or, for a tower, when a supply crate of it stands right beside it. Something "will make" an item when it is a
   * mine on its deposit, a crate with stock left, or a building whose own inputs are supplied (worked out to a fixed point,
   * so a chain of buildings is followed back to its mines). Power counts when the consumer is in reach of a grid with a
   * generator that gets coal; a fluid when a pipe network it hangs on (or a neighbour) has a working producer of it. A
   * producer no arm takes from says so. The texts are listed in Diag. Cached until the layout, the towers, a filter or a
   * crate's stock change. (That an arm's target is full right now is not static: see armNote().)
   */
  diagnose(): Map<string, Diag> {
    this.sync();
    let crates = 0;
    for (let i = 0; i < this.facs.length; i++) { const f = this.facs[i]; if (f.type === 'crate' && f.left > 0) crates++; }
    if (this.rev === this.diagRev && crates === this.diagCrates) return this.diagMap;
    this.diagRev = this.rev; this.diagCrates = crates;
    const back = this.armsByBack();
    // fixed point: what every producer will make, which generators get coal, which fluid producers work
    const out = new Map<number, number>(), fluidOk = new Set<number>();
    let gens = new Set<number>(), cr = this.carry(out, back);
    const powered = (key: string) => { const n = this.powerBy.get(key); return !!n && this.powerNets[n.net].nodes.some((g) => g.type === 'generator' && gens.has(g.id)); };
    const fluidFor = (key: string, cx: number, cz: number, fl: FluidType): string | null => {
      for (let d = 0; d < 6; d++) {
        const q = this.facAtI(NB[(cz * GW + cx) * 6 + d]);
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
          const r = this.reach(f.cx, f.cz, cr, false);
          if (!(r.bits & BIT.coal)) return 0;
          return (r.bits & BIT.iron_ore ? BIT.iron : 0) | (r.bits & BIT.copper_ore ? BIT.copper : 0);
        }
        case 'press': case 'cells': case 'missiles': {
          const rec = MAKES[f.type]!, r = this.reach(f.cx, f.cz, cr, false);
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
          const ok = !!(this.reach(f.cx, f.cz, cr, false).bits & BIT.coal);
          if (ok !== gens.has(f.id)) { gens = new Set(gens); if (ok) gens.add(f.id); else gens.delete(f.id); changed = true; }
        } else if (f.type === 'pump' || f.type === 'refinery') {
          const ok = f.type === 'pump' ? f.ore === 'oil' && powered(k) : !!fluidFor(k, f.cx, f.cz, 'crude') && powered(k);
          if (ok !== fluidOk.has(f.id)) { if (ok) fluidOk.add(f.id); else fluidOk.delete(f.id); changed = true; }
        }
      }
      if (!changed) break;
      cr = this.carry(out, back);
    }
    // the diagnosis itself
    const res = new Map<string, Diag>();
    // (a supplier named once: "Supply Crate" or "Mine (by arm)", not also "... (by belt)" for the same producer)
    const base = (n: string) => n.replace(/ \(by (belt|arm)\)$/, '');
    const report = (key: string, missing: string[], from: Set<string>, why: string[]) =>
      res.set(key, { ok: !missing.length, missing, why, from: [...from].filter((n) => !n.endsWith(' (by belt)') || ![...from].some((o) => o !== n && base(o) === base(n))) });
    const power = (key: string, missing: string[], from: Set<string>, why: string[]) => {
      if (powered(key)) from.add(FACS[this.powerBy.get(key)!.type].name);
      else { missing.push('power'); why.push(this.powerBy.has(key) ? 'its grid has no Generator that gets coal' : 'no power: no Power Pole or Generator within ' + SUPPLY + ' tiles'); }
    };
    const item = (r: Reach, it: ItemType, missing: string[], from: Set<string>, why: string[]) => {
      if (r.bits & BIT[it]) { for (const n of r.names.get(it) || []) from.add(n); }
      else { missing.push(ITEMS[it].short); why.push(r.jam & BIT[it] ? `the belt line that brings it ${ITEMS[it].short} jams: an item rides it that no arm at its end takes` : 'no Transfer Arm brings it ' + ITEMS[it].short); }
    };
    const fluid = (key: string, cx: number, cz: number, fl: FluidType, missing: string[], from: Set<string>, why: string[]) => {
      const n = fluidFor(key, cx, cz, fl);
      if (n) from.add(n); else { missing.push(fluidName(fl)); why.push('no pipe brings it ' + fluidName(fl)); }
    };
    const noTaker = (missing: string[], why: string[]) => { missing.push('a taker for its output'); why.push('no Transfer Arm takes its output'); };
    const ends = (b: Fac) => {
      const q = this.facAtI(nb(b, b.dir));
      return !q || !(q.type === 'belt' ? !this.pointsAt(q, b.cx, b.cz) : q.type === 'splitter' || this.entranceFrom(q, b.cx, b.cz));
    };
    for (const f of this.facs) {
      const k = 'f' + f.id, missing: string[] = [], from = new Set<string>(), why: string[] = [];
      switch (f.type) {
        case 'mine': if (!makes(f)) { missing.push('an ore deposit'); why.push('no ore deposit under it'); } else if (!this.taker(f, out.get(f.id)!, back)) noTaker(missing, why); break;
        case 'crate': if (f.left > 0 && f.hold && !this.taker(f, BIT[f.hold], back)) { missing.push('a taker for its output'); why.push('no tower that uses it beside it, and no Transfer Arm takes from it'); } break;
        case 'generator': item(this.reach(f.cx, f.cz, cr, false), 'coal', missing, from, why); break;
        case 'pump':
          if (f.ore !== 'oil') { missing.push('an oil field'); why.push('no oil field under it'); }
          power(k, missing, from, why);
          if (!this.fluidTaker(f, 'crude')) { missing.push('a taker for its output'); why.push('no pipe or building takes its crude oil'); }
          break;
        case 'refinery':
          fluid(k, f.cx, f.cz, 'crude', missing, from, why); power(k, missing, from, why);
          if (!this.fluidTaker(f, 'petrol')) { missing.push('a taker for its output'); why.push('no pipe or building takes its petrol'); }
          break;
        case 'smelter': {
          const r = this.reach(f.cx, f.cz, cr, false);
          if (r.bits & (BIT.iron_ore | BIT.copper_ore)) { item(r, r.bits & BIT.iron_ore ? 'iron_ore' : 'copper_ore', missing, from, why); if (r.bits & BIT.iron_ore && r.bits & BIT.copper_ore) item(r, 'copper_ore', missing, from, why); }
          else { missing.push('iron or copper ore'); why.push('no Transfer Arm brings it iron or copper ore'); }
          item(r, 'coal', missing, from, why);
          const b = (r.bits & BIT.iron_ore ? BIT.iron : 0) | (r.bits & BIT.copper_ore ? BIT.copper : 0);
          if (b && !this.taker(f, b, back)) noTaker(missing, why);
          break;
        }
        case 'works': case 'press': case 'cells': case 'missiles': {
          const rec = MAKES[f.type]!, r = this.reach(f.cx, f.cz, cr, false);
          for (const it in rec.inp) item(r, it as ItemType, missing, from, why);
          if (rec.fluid) fluid(k, f.cx, f.cz, rec.fluid[0], missing, from, why);
          power(k, missing, from, why);
          if (rec.out && !this.taker(f, BIT[rec.out], back)) noTaker(missing, why);
          break;
        }
        case 'arm': {
          const j = armFront(f), m = this.acceptMask(j, f);
          if (j < 0 || (!this.facAtI(j) && !this.towerAt.get(j))) { missing.push('a target'); why.push('arm points at nothing'); }
          else if (!m) {
            // (a chain longer than ARM_CHAIN hands nothing on: say so, not that its target takes nothing)
            let q: Fac | undefined = f, n = 0;
            while (q && q.type === 'arm' && n <= ARM_CHAIN + 1) { const nx = this.facAtI(armFront(q)); q = nx && nx.type === 'arm' && armBack(nx) === tileOf(q) ? nx : undefined; n++; }
            missing.push('a target'); why.push(n > ARM_CHAIN + 1 ? `arm chain is longer than ${ARM_CHAIN + 1} arms` : "arm's target takes nothing");
          }
          else if (f.only && !(m & BIT[f.only])) { missing.push('a target'); why.push("arm's target does not take what its filter lets through"); }
          if (!this.sourceAt(armBack(f), f)) { missing.push('something to take'); why.push('arm has nothing to take'); }
          else if (!missing.length && !cr.bits.get(f.id)) { missing.push('something to take'); why.push('arm has nothing to take that its target uses'); }
          for (const s of cr.src.get(f.id)?.values() || []) for (const n of s) from.add(n);
          break;
        }
        case 'belt': case 'tunnel': {
          if (f.type === 'tunnel' && !f.pair) { missing.push(`a second tunnel facing the same way within ${TUNNEL_REACH} tiles`); why.push('tunnel has no other end'); break; }
          // a line that carries something and ends without an arm to empty it, or with arms that leave an item on it (it jams
          // there for good, see jams()); a belt has an entry only then, a tunnel always
          const bad = (f.type === 'belt' || f.exit) && ends(f) ? cr.dead.get(f.id) || 0 : 0;
          if (bad && !(back.get(tileOf(f)) || []).length) { missing.push('an arm at its end'); why.push(f.type === 'belt' ? 'belt ends without an arm' : 'tunnel ends without an arm'); }
          else if (bad) {
            const names = ITEM_TYPES.filter((it) => bad & BIT[it]).map((it) => ITEMS[it].short).join(', ');
            missing.push('an arm that takes ' + names); why.push(`no arm at the ${f.type === 'belt' ? "belt's" : "tunnel's"} end takes ${names}: the line jams`);
          }
          else if (f.type === 'belt') continue;
          break;
        }
        case 'pole': if (!this.powerNets[f.net]?.nodes.some((g) => g.type === 'generator')) { missing.push('a Generator on its grid'); why.push('no Generator on its grid'); } break;
        case 'ptunnel': if (!f.pair) { missing.push('a second pipe tunnel in a straight line within ' + TUNNEL_REACH + ' tiles'); why.push('pipe tunnel has no other end'); } break;
        default: continue; // splitters, pipes
      }
      report(k, missing, from, why);
    }
    for (const t of this.host.towers) {
      const k = 't' + t.id, n = needsOf(t), missing: string[] = [], from = new Set<string>(), why: string[] = [];
      if (n.item) item(this.reach(t.cx, t.cz, cr, true), n.item, missing, from, why);
      if (n.fluid) fluid(k, t.cx, t.cz, n.fluid, missing, from, why);
      if (n.power) power(k, missing, from, why);
      report(k, missing, from, why);
    }
    this.diagMap = res;
    return res;
  }
  /** What holds a Transfer Arm up right now, in words ('' when it works or waits for nothing in particular): "arm's target is full", "arm has nothing to take". */
  armNote(f: Fac): string {
    if (f.type !== 'arm') return '';
    if (f.state === 'full') return "arm's target is full";
    if (f.state === 'noinput') return 'arm has nothing to take';
    if (f.state === 'idle' && !f.hand) return this.acceptMask(armFront(f), f) ? '' : 'arm points at nothing';
    return '';
  }

  /**
   * The supply connections for the view (see Link), recomputed with the layout: every Transfer Arm from its back tile to its
   * front tile (the keys of what stands there, '' for an empty tile), every crate to the tower beside it it feeds, a pipe
   * network once to each consumer beside it, a pole or generator to what it powers.
   */
  links(): Link[] {
    this.sync();
    if (this.linkRev === this.rev) return this.linkList;
    this.linkRev = this.rev;
    const list: Link[] = [];
    const cx = (j: number) => cellX(j % GW, (j / GW) | 0), cz = (j: number) => cellZ((j / GW) | 0);
    for (const a of this.facs) {
      if (a.type === 'arm') {
        const b = armBack(a), f = armFront(a);
        if (b < 0 || f < 0) continue;
        list.push({ kind: 'arm', from: a.id, x: cx(b), z: cz(b), tx: cx(f), tz: cz(f), to: this.keyAt(f), src: this.keyAt(b), tiles: [b, tileOf(a), f] });
      } else if (a.type === 'crate' && a.left > 0 && a.hold) {
        for (let d = 0; d < 6; d++) {
          const j = nb(a, d), t = j >= 0 ? this.towerAt.get(j) : undefined;
          if (t && needsOf(t).item === a.hold) list.push({ kind: 'crate', from: a.id, x: a.x, z: a.z, tx: cellX(t.cx, t.cz), tz: cellZ(t.cz), to: towerKey(t.id) });
        }
      }
    }
    const who = (j: number): [string, number, number] | null => {
      const q = this.facAtI(j);
      if (q) return conveyor(q.type) ? null : ['f' + q.id, q.x, q.z];
      const t = this.towerAt.get(j);
      return t ? ['t' + t.id, cellX(t.cx, t.cz), cellZ(t.cz)] : null;
    };
    const link = (kind: Link['kind'], f: Fac, j: number) => { const w = who(j); if (w) list.push({ kind, from: f.id, x: f.x, z: f.z, tx: w[1], tz: w[2], to: w[0] }); };
    for (const net of this.pipeNets) {
      const done = new Set<string>();
      for (const p of net.pipes) for (let d = 0; d < 6; d++) {
        const j = nb(p, d);
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
