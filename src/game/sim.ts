// BEATSPIRE game simulation (no rendering, no DOM). Runs in the browser and in Node.
import {
  CELL, GW, GH, WIN_WAVE, cellX, cellZ,
  TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, CARDS, CARD_BY_ID,
  LVL_DMG, LVL_RANGE, LVL_RATE, upgradeCost, upgradeMat, waveHpMul, waveBudget, baseMods, TUNE,
  TWIN_BOLT, PULSE_CRIT, RAIL_CAP, LANCE_FOCUS, BREACH_TIME, BREACH_TIME_BOSS, BREACH_SHARE, coopScale,
  FIRST_WAVE_IN, NEXT_WAVE_IN, LINK_RANGE, WALL_HALF, FIRE_RING, SING_COLOR,
  FACS, FAC_TYPES, ITEM_SHOTS, FUEL_PER_TICK, START_MATS, START_GOLD_MUL, TOWER_TIER, TOWER_CHAIN, CRATE_STOCK,
  FAC_UPGRADABLE, FAC_UP_COST, TOWER_NEEDS_L3, TOWER_CHAIN_L3, needsOf, TARGET_MODES, TARGETABLE, TARGET_DEFAULT,
  WHEEL_GUARD, WHEEL_CRAWL, WHEEL_BLEED, WHEEL_DRAG, WHEEL_SINK, WHEEL_REST, WHEEL_SPINUP, WHEEL_PIERCE, WAVE_POOL, gyreCount, GYRE_WAVE,
  BROOD_EVERY, BROOD_FIRST, BROOD_SIZE, BROOD_REACH, MITE_HOLD, MITE_LIFE, JAM_LINGER,
  TITAN_LAND, TITAN_STUN, TITAN_WINDUP, TITAN_STRIKE_EVERY, TITAN_STRIKE, TITAN_SLOW, TITAN_WALK, TITAN_PACE, TITAN_LEAD, TITAN_GOLD, TITAN_SURVIVAL, TITAN_AGAIN, TITAN_TOUGHER, TITAN_SMASH,
} from './data.ts';
import type { TowerType, EnemyType, Mods, Card, FacType, ItemType, TargetMode } from './data.ts';
import { broodCap } from './data.ts';
import { GameMap, DEFAULT_MAP, diffById } from './map.ts';
import type { MapDef, Difficulty, PathOut } from './map.ts';
import { hexDist, neighbor } from './hex.ts';
import { Factory, TOWER_STOCK, TOWER_TANK, towerKey } from './factory.ts';
import { mapResources } from './deposits.ts';
import type { CrateSpot } from './deposits.ts';
import type { Fac, Diag } from './factory.ts';
export { LINK_RANGE, WALL_HALF, FIRE_RING, SING_COLOR, BREACH_TIME, BREACH_TIME_BOSS, TITAN_LAND, TITAN_STUN, TITAN_WINDUP, TITAN_STRIKE_EVERY };
/** How far from the end of its road an enemy stops to attack the core (plus 0.6 of its radius). */
export const CORE_STAND = 1.6;

export interface Enemy {
  id: number; type: EnemyType; x: number; z: number; y: number; yaw: number;
  dist: number; lane: number; off: number; hp: number; maxHp: number; shield: number; maxShield: number; shieldCd: number;
  speed: number; slowT: number; slowF: number; sing: number; alive: boolean; r: number; armor: number;
  /** ground height under the enemy (roads can be raised); the centre height is y = gy + ENEMIES[type].y */
  gy: number;
  /** seconds left frozen solid (Flash Freeze), burning (and burn damage per second), marked vulnerable by a Graviton Well */
  frz: number; burnT: number; burnD: number; burnAcc: number; vulnT: number;
  /** distance still to be dragged back along the lane, and the time until it can be dragged again */
  pull: number; pullCd: number;
  /** a weaker burn waiting underneath the current one (takes over when the stronger burn runs out) */
  burn2T: number; burn2D: number;
  /** At the core: seconds left until its attack lands (0 = not there yet). The core then takes the damage and its discharge destroys the enemy. */
  breach: number;
  /** Gyre: rim spin 0..1 (0 for every other type), seconds until it may spin back up, whether it has stalled (between the 'spindown' and 'spinup' events), and the time of its next 'deflect' event */
  spin: number; spinCd: number; stalled: boolean; deflAt: number;
  /** Mite: the id of the tower it is after (0 for every other type), whether it sits on that tower, and the id of the Broodcarrier it came from. */
  prey: number; latched: boolean; mom: number;
  /** Broodcarrier: seconds until it may let its next swarm loose. Mite: seconds it has left. */
  ttl: number;
}
export interface Tower {
  id: number; type: TowerType; cx: number; cz: number; x: number; z: number;
  lvl: number; cd: number; yaw: number; buff: number; spent: number; h: number;
  /** special: charge 0..1, seconds left of the active special, seconds left offline */
  charge: number; spec: number; down: number;
  /** lance heat 0..1 and its current target id; aux = shells/missiles left in a special burst; fxT = internal timer */
  heat: number; tgt: number; aux: number; fxT: number;
  /** Seconds left jammed by mites, and stunned by the Titan's landing. Either way the tower neither fires nor charges (apart from `down`, the reboot after a special). */
  jam: number; stun: number;
  /** Supply from the factory: ammunition items waiting, shots left of the item in use, petrol in the tank, power satisfaction 0..1,
   *  and whether it ran dry last step (it then does nothing until it is supplied again). spentMat: materials paid into it. */
  stock: number; ammo: number; tank: number; pwr: number; dry: boolean; spentMat: number;
  /** Seconds of the wave it has held no ammunition (not saved: a new wave starts it again). */
  starve: number;
  /** Targeting mode (see TargetMode): set by the player with Sim.setAim, kept over upgrades. Towers without TARGETABLE keep their TARGET_DEFAULT. */
  aim: TargetMode;
}
/** True while a tower does nothing: rebooting, jammed by mites, stunned by the Titan, or out of supply. */
export const towerOff = (t: Tower) => t.down > 0 || t.jam > 0 || t.stun > 0 || t.dry;
export type ProjKind = 'bolt' | 'shell' | 'missile';
const PROJ_KINDS: ProjKind[] = ['bolt', 'shell', 'missile'];
export interface Proj {
  id: number; kind: ProjKind; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  dmg: number; owner: number; target: number; life: number; pierce: number; hit: number[];
  tier: number; aoe: number; chain: number; sx: number; sz: number; tx: number; ty: number; tz: number; t: number; T: number;
  /** fired by a tower special: these hit the Titan at full strength */
  sp?: boolean;
}
export type ZoneKind = 'burn' | 'sing';
const ZONE_KINDS: ZoneKind[] = ['burn', 'sing'];
export interface Zone {
  id: number; kind: ZoneKind; x: number; z: number; r: number; life: number; tick: number; dmg: number; owner: number; pd: number;
  /** deck height under the zone (roads can be raised). Burning ground does not reach through a bridge deck. */
  y: number;
}
/** A wall of fire between two linked Firewall Pylons (a, b = tower ids). `on`: both pylons are online. `hot`: an Inferno is running on it. */
export interface Wall { a: number; b: number; ax: number; az: number; bx: number; bz: number; on: boolean; hot: boolean }
export interface Player {
  /** card offers waiting for this player (each up to three card ids) */
  pending: string[][];
  kills: number;
}
/** What the next startWave() will release, per lane (index = lane index). */
export interface WavePreview { wave: number; lanes: { type: EnemyType; n: number }[][] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ev = { k: string; [key: string]: any };
/**
 * The Titan, the giant Colossus of the finale (one per campaign; in Survival one every few waves; never in Versus).
 * far: it roams the district. warn: `danger` fills toward the wave it arrives on. landing: it leaps onto the gate of its lane
 * (TITAN_LAND seconds). walk: it is an enemy of type 'titan' on that lane. dead: destroyed.
 * `wave` is the wave it arrives on, `t` the seconds spent in this phase, `lane` the road it takes.
 */
export type TitanPhase = 'none' | 'far' | 'warn' | 'landing' | 'walk' | 'dead';
export const TITAN_PHASES: TitanPhase[] = ['none', 'far', 'warn', 'landing', 'walk', 'dead'];
export interface TitanState { phase: TitanPhase; danger: number; wave: number; t: number; lane: number }

/** World scale: combat towers are about 3 to 4.5 units tall. */
export const TOWER_SCALE = 1.15;
export const TOWER_H: Record<TowerType, number> = { pulse: 2.76, cryo: 2.78, arc: 3.7, mortar: 2.4, rail: 3.23, beacon: 3.92, flame: 2.6, lance: 3.6, missile: 3.0, gravity: 3.3 };
/** Radius of a tower's power node (the light on top that shows its special's charge, see nodePos). */
export const NODE_R = 0.6;
/** Blasts and burning ground only reach enemies whose road is within this height of the blast (a bridge deck shields what is under or over it). */
export const DECK_GAP = 1.2;
/** Snapshot event budget: one-shot state events are always sent, cosmetic ones fill what is left of SNAP_EVENTS. */
export const SNAP_EVENTS = 90;
export const SNAP_EVENTS_MAX = 120;
/** Events a co-op guest must never miss (everything else is cosmetic and may be dropped under load). */
export const MUST_EVENTS: ReadonlySet<string> = new Set(['special', 'down', 'up', 'wave', 'boss', 'clear', 'levelup', 'card', 'win', 'lose', 'leak', 'build', 'sell', 'incoming', 'titanLand', 'titanImpact', 'titanDie']);

interface P3 { x: number; y: number; z: number }
/** The power node on top of a tower: it glows while the tower's special is charged. */
export function nodePos<T extends P3>(t: Tower, out: T): T { out.x = t.x; out.y = t.h + 0.55; out.z = t.z; return out; }
/** How far apart (in tiles) a Firewall Pylon links: one tile further at level 3, plus the Long Conduits card. */
export function linkRange(t: Tower, bonus = 0): number { return LINK_RANGE + (t.lvl >= 3 ? 1 : 0) + Math.max(0, Math.min(4, bonus | 0)); }
/**
 * The walls of fire between Firewall Pylons. Two pylons link when either reaches the other; the closest pairs link first
 * and every pylon keeps at most two links. Deterministic, so a co-op replica gets the same walls from the same towers.
 */
export function computeWalls(towers: Tower[], linkBonus = 0): Wall[] {
  const py = towers.filter((t) => t.type === 'flame');
  const pairs: { a: Tower; b: Tower; d: number; w: number }[] = [];
  for (let i = 0; i < py.length; i++) for (let k = i + 1; k < py.length; k++) {
    const a = py[i].id < py[k].id ? py[i] : py[k], b = a === py[i] ? py[k] : py[i];
    const d = hexDist(a.cx, a.cz, b.cx, b.cz);
    if (d >= 1 && d <= Math.max(linkRange(a, linkBonus), linkRange(b, linkBonus))) pairs.push({ a, b, d, w: Math.hypot(a.x - b.x, a.z - b.z) });
  }
  pairs.sort((p, q) => p.d - q.d || p.w - q.w || p.a.id - q.a.id || p.b.id - q.b.id);
  const links = new Map<number, number>(), out: Wall[] = [];
  for (const p of pairs) {
    const na = links.get(p.a.id) || 0, nb = links.get(p.b.id) || 0;
    if (na >= 2 || nb >= 2) continue;
    links.set(p.a.id, na + 1); links.set(p.b.id, nb + 1);
    const on = !towerOff(p.a) && !towerOff(p.b);
    out.push({ a: p.a.id, b: p.b.id, ax: p.a.x, az: p.a.z, bx: p.b.x, bz: p.b.z, on, hot: on && (p.a.spec > 0 || p.b.spec > 0) });
  }
  return out;
}
/** Distance from a point to the segment a-b on the ground. */
export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * u - x, az + dz * u - z);
}
/** An enemy's own pace before slows. A Gyre rolls at WHEEL_CRAWL of its speed with the rim stopped, and at all of it at full spin. */
export function paceOf(e: Enemy): number { return e.type === 'wheel' ? e.speed * (WHEEL_CRAWL + (1 - WHEEL_CRAWL) * e.spin) : e.speed; }
/** How fast an enemy moves right now: its pace after slows, singularities and freezes (the same rule the enemy step moves it by; 0 frozen solid). */
export function paceNow(e: Enemy): number {
  const boss = e.type === 'boss';
  let slow = e.slowT > 0 ? e.slowF : 0;
  if (e.sing > 0) slow = Math.max(slow, boss ? 0.4 : 0.9);
  if (e.frz > 0) slow = Math.max(slow, boss ? 0.6 : 1);
  if (e.type === 'titan') slow *= TITAN_SLOW;
  return paceOf(e) * (1 - slow);
}
const isBig = (e: Enemy) => e.type === 'boss' || e.type === 'titan';

// ---------- legacy exports for the default map (scenery code still reads these) ----------
const DEF = new GameMap(DEFAULT_MAP);
export const CORE_POS = DEF.core;
export const BASE_GRID = DEF.grid;

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

export type Mode = 'solo' | 'coop' | 'versus';
export interface SimOpts {
  mode: Mode; players: number; seed: number; pauseOnCards: boolean; map: MapDef; diff: string; survival: boolean;
  /** Towers need no supply from the factory and cost no materials (the attract demo and headless balance runs, where the bot plays). */
  free: boolean;
}

/** Factory buildings that give back all they cost when taken down. */
const FULL_REFUND: ReadonlySet<FacType> = new Set<FacType>(['belt', 'splitter', 'tunnel', 'pipe', 'ptunnel', 'pole']);
/** The levels whose card offer brings a blueprint (as long as one is left). */
const BP_LEVELS = [2, 4, 6, 8, 10, 13, 16, 19, 22, 25, 28];
const xpNeed = (lvl: number) => Math.round(12 + lvl * 7 + lvl * lvl * 0.55);
const GAPS: Record<EnemyType, number> = { grunt: 0.55, runner: 0.33, drone: 0.5, shield: 0.95, brute: 1.3, boss: 3, wheel: 8, brood: 1.7, mite: 0.1, titan: 5 };
const tmp: PathOut = { x: 0, z: 0, dx: 0, dz: 0, y: 0 };
const W3 = { x: 0, y: 0, z: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Most shots one tower can fire in a single step (60 steps a second: up to 240 shots a second). */
const MAX_SHOTS = 4;
/** Seconds a tower with nothing loaded counts as waiting on a working supply line (a Missile Works takes 10 s an item, a long
 *  line some more to fill at the start of a wave) before it counts as dry after all. */
const WAIT_GRACE = 20;
/** Lance Overload damage multiplier. */
const OVERLOAD = 3.5;
/** Firewall: Inferno heat multiplier and how much wider a hot wall burns; the burn left on whatever crosses, as a share of the pylon's damage per second; a lone pylon's ring as a share of a wall. */
const INFERNO = 2.5;
const INFERNO_WIDE = 1.8;
const BURN_SHARE = 0.4;
const RING_SHARE = 0.5;

/**
 * How forgiving a map's layout is, as an enemy health multiplier: long roads and tiles that overlook a lot of road give
 * the towers more time on each enemy; short or split roads give them less. The first map gets an extra ease (TUNE.starter).
 */
export function mapEase(map: GameMap): number {
  const L = map.lanes.length;
  let len = 0;
  for (const l of map.lanes) len += l.len;
  const cover: number[] = [];
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (map.grid[cz * GW + cx] !== 0) continue;
    const x = cellX(cx, cz), z = cellZ(cz);
    let s = 0;
    for (let l = 0; l < L; l++) for (let d = 0; d < map.lanes[l].len; d += 1) { map.pos(l, d, tmp); if (Math.hypot(tmp.x - x, tmp.z - z) <= 7.5) s += 1 / L; }
    cover.push(s);
  }
  cover.sort((a, b) => b - a);
  let top = 0;
  const n = Math.min(16, cover.length);
  for (let i = 0; i < n; i++) top += cover[i] / n;
  const starter = map.def.id === DEFAULT_MAP.id ? TUNE.starter : 1;
  return clamp(Math.pow(len / L / TUNE.mapLen, TUNE.mapPow) * Math.pow(Math.max(1, top) / TUNE.mapCov, TUNE.mapCovPow) * starter, 0.3, 1.1);
}

function newTower(id: number, type: TowerType, cx: number, cz: number, spent: number): Tower {
  // a new tower is empty: it fires once a supply crate, a mine or a belt beside it feeds it
  return {
    id, type, cx, cz, x: cellX(cx, cz), z: cellZ(cz), lvl: 1, cd: 0.3, yaw: 0, buff: 0, spent, h: TOWER_H[type], charge: 0, spec: 0, down: 0, heat: 0, tgt: 0, aux: 0, fxT: 0, jam: 0, stun: 0,
    stock: 0, ammo: 0, tank: 0, pwr: 0, dry: false, spentMat: 0, starve: 0, aim: TARGET_DEFAULT[type],
  };
}
/** An enemy of a type with everything else at rest (spawn() and the co-op replica fill in the rest). */
function newEnemy(id: number, type: EnemyType): Enemy {
  const d = ENEMIES[type];
  return {
    id, type, x: 0, z: 0, y: d.y, yaw: 0, dist: 0, lane: 0, off: 0, hp: 1, maxHp: 1, shield: 0, maxShield: 0, shieldCd: 0,
    speed: d.speed, slowT: 0, slowF: 0, sing: 0, alive: true, r: d.r, armor: 0,
    gy: 0, frz: 0, burnT: 0, burnD: 0, burnAcc: 0, vulnT: 0, pull: 0, pullCd: 0, burn2T: 0, burn2D: 0, breach: 0,
    spin: 0, spinCd: 0, stalled: false, deflAt: 0, prey: 0, latched: false, mom: 0, ttl: 0,
  };
}

/** The diagnosis of a free run (no supply): always empty, one shared map. */
const NO_DIAG: Map<string, Diag> = new Map();
const anyGone = (l: { life: number }[]) => { for (let i = 0; i < l.length; i++) if (!(l[i].life > 0)) return true; return false; };
const anyDead = (l: Enemy[]) => { for (let i = 0; i < l.length; i++) if (!l[i].alive) return true; return false; };

export class Sim {
  opts: SimOpts;
  time = 0; wave = 0; lives = 20; maxLives = 20; gold = 220; level = 1; xp = 0; xpNext = xpNeed(1);
  /** building materials: Frames delivered to a Depot. Towers and upgrades cost them on top of credits. */
  mats = START_MATS;
  mods: Mods = baseMods();
  unlocked = new Set<TowerType>(['pulse']);
  /** factory buildings the player may build: a run starts with the Mine and the Belt, each blueprint adds what its tower's supply needs */
  facs = new Set<FacType>(TOWER_CHAIN.pulse);
  /** Waves start by themselves after a pause (off: only when the player calls them). holdFirst: the first wave always waits for the call. */
  autoWaves = true; holdFirst = false;
  stacks: Record<string, number> = {};
  enemies: Enemy[] = []; towers: Tower[] = []; projs: Proj[] = []; zones: Zone[] = [];
  /** Walls of fire between linked Firewall Pylons (rebuilt whenever the towers change, see computeWalls). */
  walls: Wall[] = [];
  players: Player[] = [];
  events: Ev[] = [];
  map: GameMap; diff: Difficulty;
  grid: Uint8Array;
  queue: { t: number; type: EnemyType; mul: number; lane: number }[] = [];
  waveActive = false; nextWaveIn = FIRST_WAVE_IN; cleared = true;
  over = false; won = false; endless = false; replica = false;
  kills = 0; leaked = 0; sent = 0; beacons = 0;
  /** mines, belts, pipes, power and the buildings of the factory (see factory.ts) */
  factory: Factory;
  /** The campaign's final wave (from the difficulty). Survival and Versus ignore it. */
  winWave = WIN_WAVE;
  /** Enemy health multiplier from the map's shape: short roads give the towers less time, so the machines are weaker there and tougher on long roads. Keeps any map (pre-made, edited or generated) at a similar difficulty. */
  mapMul = 1;
  /** The wave the next startWave() releases, per lane. */
  preview: WavePreview = { wave: 0, lanes: [] };
  /** The Titan (see TitanState). */
  titan: TitanState = { phase: 'none', danger: 0, wave: 0, t: 0, lane: 0 };
  /** Titans destroyed so far (each one after the first is tougher), the time until it wrecks the next building, its own random stream, and when the current wave began. */
  private titanN = 0; private smashIn = 0; private trand: () => number = Math.random; private waveT0 = 0;
  /** Set while a hit comes from a tower special: it hits the Titan at full strength. */
  private sp = false;
  private next: { wave: number; items: { t: number; type: EnemyType; lane: number }[] } | null = null;
  private nid = 1;
  private snapN = 0; private modsSig = '';
  private wallTw: [Tower, Tower][] = [];
  private nospecAt = new Map<number, number>();
  private rand: () => number;

  constructor(opts: Partial<SimOpts> = {}) {
    this.opts = { mode: 'solo', players: 1, seed: (Math.random() * 1e9) | 0, pauseOnCards: true, map: DEFAULT_MAP, diff: 'normal', survival: false, free: false, ...opts };
    this.opts.free = this.opts.free === true;
    if (this.opts.seed === undefined) this.opts.seed = (Math.random() * 1e9) | 0;
    this.rand = mulberry(this.opts.seed);
    this.map = new GameMap(this.opts.map || DEFAULT_MAP);
    this.diff = diffById(this.opts.diff);
    this.grid = new Uint8Array(this.map.grid);
    this.gold = Math.round(this.map.def.gold * START_GOLD_MUL);
    // (getters: a co-op replica swaps its tower list and event queue for new arrays)
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
    // crates first, then the deposits around them (the map's own deposits if it has some): see deposits.ts
    const res = mapResources(this.map);
    this.factory = new Factory({
      get grid() { return self.grid; }, get mods() { return self.mods; }, get towers() { return self.towers; }, get events() { return self.events; },
      addMats: (n) => { this.mats += n; },
    }, res.ore);
    this.lives = this.maxLives = Math.max(1, Math.round(this.map.def.lives * this.diff.lives));
    this.endless = this.opts.survival;
    this.winWave = this.diff.waves;
    this.mapMul = mapEase(this.map);
    // the Titan keeps its own random stream, so it does not shift what the waves are made of
    this.trand = mulberry((this.opts.seed ^ 0x7174616e) >>> 0);
    if (this.opts.mode !== 'versus') {
      const T = this.titan, lens = this.map.lanes.map((l) => l.len), top = Math.max(...lens);
      // it takes the longest road (one of them when several are about as long)
      const longest = lens.map((_, i) => i).filter((i) => lens[i] >= top * 0.9);
      T.phase = 'far';
      T.wave = this.endless ? TITAN_SURVIVAL : Math.max(2, this.winWave - 4 + Math.floor(this.trand() * 4 * 0.999));
      T.lane = longest[Math.floor(this.trand() * longest.length * 0.999)] || 0;
      this.smashIn = TITAN_SMASH[0] + this.trand() * (TITAN_SMASH[1] - TITAN_SMASH[0]);
    }
    for (const t of this.map.def.towers) {
      if (!Object.hasOwn(TOWERS, t.t) || !(t.cx >= 0 && t.cz >= 0 && t.cx < GW && t.cz < GH) || this.grid[t.cz * GW + t.cx] !== 0) continue;
      this.grid[t.cz * GW + t.cx] = 2;
      this.unlocked.add(t.t);
      const tw = newTower(this.nid++, t.t, t.cx, t.cz, 0);
      // the map's own towers start fully stocked
      const n = needsOf(tw);
      if (n.item) { tw.stock = TOWER_STOCK; tw.ammo = n.shots || ITEM_SHOTS[n.item] || 1; }
      if (n.fluid) tw.tank = TOWER_TANK;
      this.towers.push(tw);
    }
    if (this.opts.free) for (const f of FAC_TYPES) this.facs.add(f);
    else this.placeCrates(res.crates);
    this.recomputeBuffs();
    for (let i = 0; i < this.opts.players; i++) this.players.push({ pending: [], kills: 0 });
    this.planWave(1);
  }

  get paused() { return this.opts.pauseOnCards && this.players.some((p) => p.pending.length > 0); }
  /** True while the run ends at winWave (not Versus, not Survival / endless). */
  get campaign() { return this.opts.mode !== 'versus' && !this.endless; }
  cost(t: TowerType) { return Math.round(TOWERS[t].cost * this.mods.cheap); }
  /** building materials a tower costs on top of its credits */
  matCost(t: TowerType) { return this.opts.free ? 0 : TOWERS[t].mat; }
  upCost(t: Tower) { return Math.round(upgradeCost(t.type, t.lvl) * this.mods.cheap); }
  upMat(t: Tower) { return this.opts.free ? 0 : upgradeMat(t.type, t.lvl); }
  sellValue(t: Tower) { return Math.round(t.spent * 0.6); }
  sellMats(t: Tower) { return Math.floor(t.spentMat * 0.6); }
  facCost(t: FacType) { return Math.round(FACS[t].cost * this.mods.cheap); }
  towerById(id: number) { return this.towers.find((t) => t.id === id); }
  /** A tower's reach. For a Firewall Pylon this is how far away it links to another pylon (whole tiles, see linkRange). */
  range(t: Tower) {
    if (t.type === 'flame') return linkRange(t, this.mods.flameLink) * CELL;
    return TOWERS[t.type].range * LVL_RANGE[t.lvl - 1] * this.mods.tw[t.type].range * (t.type === 'beacon' ? 1 : this.mods.tRange);
  }
  /** Half the thickness of a wall of fire (wider while an Inferno runs on it, and with Slag Curtain). */
  wallHalf(w: Wall) { return WALL_HALF * (1 + 0.3 * this.mods.flameMelt) * (w.hot ? INFERNO_WIDE : 1); }
  towerDmg(t: Tower) { return TOWERS[t.type].dmg * TUNE.tdmg * LVL_DMG[t.lvl - 1] * this.mods.tDmg * this.mods.tw[t.type].dmg * (1 + t.buff) * this.supplyDmg(t); }
  /** Damage multiplier of a better ammunition (a Pulse Mk3's plasma shells, a Firewall Mk3's petrol). Not in free runs, which have no supply. */
  supplyDmg(t: Tower) { return this.opts.free ? 1 : needsOf(t).dmg || 1; }
  towerRate(t: Tower) { return TOWERS[t.type].rate * LVL_RATE[t.lvl - 1] * this.mods.tRate * this.mods.tw[t.type].rate * (1 + t.buff * 0.6) * this.powerMul(t); }
  /** True if the tower's special can be fired right now. */
  specialReady(t: Tower) { return !!TOWERS[t.type].special && t.charge >= 1 && !towerOff(t) && t.spec <= 0; }
  /** True from the Titan's leap until it is destroyed: nothing else spawns and no wave can be called. */
  get titanBusy() { return this.titan.phase === 'landing' || this.titan.phase === 'walk'; }
  /**
   * True between waves: the last wave is cleared (its bonus paid), no enemies on the field but stray mites, nothing left to
   * spawn, the Titan not landing or walking, the game not over. Time stands still for the defence then: the factory, the towers, their specials' charge and their reboots
   * do not run (the wave timer and Sim.time do), so nothing is made while the player plans. diag() says what will be supplied.
   */
  get planning() { return this.cleared && !this.over && !this.queue.length && !this.titanBusy && !this.enemies.some((e) => e.type !== 'mite'); }
  /** The factory's supply diagnosis (see Factory.diagnose): 'f' + fac id and 't' + tower id. Empty in free runs. */
  diag(): Map<string, Diag> { return this.opts.free ? NO_DIAG : this.factory.diagnose(); }
  /** The Titan's health when it lands: sized by the enemy health of its wave, the difficulty and the number of players. Towers only hurt it at TUNE.titanTower, their specials at full strength. */
  titanHp() {
    return TUNE.titan * waveHpMul(this.titan.wave) * Math.sqrt(this.diff.hp) * this.mapMul * (1 + 0.75 * (this.players.length - 1)) * Math.pow(TITAN_TOUGHER, this.titanN);
  }

  // ---------- building ----------
  canBuild(type: TowerType, cx: number, cz: number) {
    return Number.isInteger(cx) && Number.isInteger(cz) && cx >= 0 && cz >= 0 && cx < GW && cz < GH && this.grid[cz * GW + cx] === 0 &&
      this.unlocked.has(type) && this.gold >= this.cost(type) && this.mats >= this.matCost(type);
  }
  build(type: TowerType, cx: number, cz: number) {
    if (this.over || !Object.hasOwn(TOWERS, type) || !this.canBuild(type, cx, cz)) return null;
    const c = this.cost(type), mt = this.matCost(type);
    this.gold -= c; this.mats -= mt;
    this.grid[cz * GW + cx] = 2;
    const t = newTower(this.nid++, type, cx, cz, c);
    t.spentMat = mt;
    this.towers.push(t);
    this.recomputeBuffs();
    this.factory.dirty = true;
    this.events.push({ k: 'build', x: t.x, z: t.z, c: TOWERS[type].color });
    return t;
  }
  upgrade(id: number) {
    const t = this.towerById(id);
    if (!t || t.lvl >= 3 || this.over) return false;
    const c = this.upCost(t), mt = this.upMat(t);
    if (this.gold < c || this.mats < mt) return false;
    this.gold -= c; this.mats -= mt; t.spent += c; t.spentMat += mt; t.lvl++;
    if (t.lvl === 3 && TOWER_NEEDS_L3[t.type]) {
      // a new ammunition from level 3 on: the old one is dropped, and the building that makes the new one is unlocked with it
      t.stock = 0; t.ammo = 0; t.tank = 0;
      for (const f of TOWER_CHAIN_L3[t.type] || []) this.facs.add(f);
    }
    this.factory.dirty = true; // (what it takes off the belts can change with its level)
    this.recomputeBuffs();
    this.events.push({ k: 'build', x: t.x, z: t.z, c: TOWERS[t.type].color });
    return true;
  }
  sell(id: number) {
    const i = this.towers.findIndex((t) => t.id === id);
    if (i < 0 || this.over) return false;
    const t = this.towers[i];
    this.gold += this.sellValue(t); this.mats += this.sellMats(t);
    this.grid[t.cz * GW + t.cx] = 0;
    this.towers.splice(i, 1);
    this.recomputeBuffs();
    this.factory.dirty = true;
    this.events.push({ k: 'sell', x: t.x, z: t.z });
    return true;
  }
  /**
   * Set a tower's targeting mode. False for an unknown tower or mode, a tower type without the setting (TARGETABLE), or a
   * finished game; true (and no event) when the mode is already set. The tower takes its next target by the new mode on the
   * next step; a Lance drops the enemy it is locked on and loses its heat the same way as on any retarget.
   * Emits { k: 'aim', id, t: type, m: mode, x, z }.
   */
  setAim(id: number, mode: TargetMode): boolean {
    const t = this.towerById(id);
    if (!t || this.over || !TARGETABLE[t.type] || typeof mode !== 'string' || !TARGET_MODES.includes(mode)) return false;
    if (t.aim === mode) return true;
    t.aim = mode;
    if (t.tgt) { if (t.type === 'lance' && t.spec <= 0) t.heat *= this.mods.lanceRamp ? 0.5 : 0; t.tgt = 0; }
    this.events.push({ k: 'aim', id: t.id, t: t.type, m: mode, x: t.x, z: t.z });
    return true;
  }
  /** A beacon's current boost (0 while it reboots; tripled during Surge). */
  beaconBoost(b: Tower) { return towerOff(b) ? 0 : (0.25 + 0.1 * (b.lvl - 1) + this.mods.beacon) * (b.spec > 0 ? 3 : 1); }
  recomputeBuffs() {
    this.beacons = 0;
    for (const t of this.towers) if (t.type === 'beacon') this.beacons++;
    for (const t of this.towers) {
      t.buff = 0;
      if (t.type === 'beacon') continue;
      for (const b of this.towers) {
        if (b.type !== 'beacon' || towerOff(b)) continue;
        if (Math.hypot(b.x - t.x, b.z - t.z) <= this.range(b)) t.buff = Math.max(t.buff, this.beaconBoost(b));
      }
    }
    this.rebuildWalls();
  }
  private rebuildWalls() {
    this.walls = computeWalls(this.towers, this.mods.flameLink);
    this.wallTw = this.walls.map((w) => [this.towerById(w.a)!, this.towerById(w.b)!]);
  }
  // ---------- the factory ----------
  /**
   * Supply crates: every run starts with a few crates of ammunition beside the roads, so the first towers can fire before
   * any mine runs (where they go: planCrates in deposits.ts, worked out before the deposits so these never clash). Trickier
   * maps also bring one crate of a later tower's ammunition, and that tower (with the Generator and Pole it needs for power)
   * is open from the start: a different opening per map.
   */
  private placeCrates(spots: CrateSpot[]) {
    const F = this.factory;
    for (const c of spots) F.placeCrate(c.cx, c.cz, c.it, CRATE_STOCK[c.it] || 10);
    for (const it of ['copper', 'shell'] as ItemType[]) {
      if (!F.facs.some((f) => f.type === 'crate' && f.hold === it)) continue;
      for (const t of TOWER_TYPES) if (TOWERS[t].needs.item === it) { this.unlocked.add(t); if (TOWERS[t].needs.power) { this.facs.add('generator'); this.facs.add('pole'); } }
    }
  }

  // ---------- the factory ----------
  /** Why a factory building cannot go on a tile ('' if it can). */
  facBlock(type: FacType, cx: number, cz: number): string {
    if (!Object.hasOwn(FACS, type) || type === 'crate') return 'unknown';
    if (!Number.isInteger(cx) || !Number.isInteger(cz)) return 'off the grid';
    if (!this.facs.has(type)) return 'locked';
    const why = this.factory.placeBlock(type, cx, cz);
    if (why) return why;
    return this.gold < this.facCost(type) ? 'not enough credits' : '';
  }
  /** Build a factory building (a belt facing `dir`). */
  buildFac(type: FacType, cx: number, cz: number, dir = 0) {
    if (this.over || this.facBlock(type, cx, cz)) return null;
    dir = Number.isFinite(dir) ? Math.floor(dir) : 0; // (from a click it is always 0..5; anything else must not reach the belt step)
    const c = this.facCost(type);
    const f = this.factory.place(type, cx, cz, dir, c);
    if (!f) return null;
    this.gold -= c;
    this.events.push({ k: 'build', x: f.x, z: f.z, c: FACS[type].color, fac: 1 });
    return f;
  }
  /** Take a factory building down. Logistics (belts, splitters, tunnels, pipes, poles) give back all they cost (they are moved around a lot), the rest 60%. Items in it are lost. */
  sellFac(id: number) {
    if (this.over) return false;
    const f = this.factory.facById(id);
    if (!f || (f.type === 'crate' && f.left > 0)) return false; // a crate goes once it is empty
    this.gold += this.facSellValue(id);
    this.factory.remove(id);
    this.events.push({ k: 'sell', x: f.x, z: f.z, fac: 1 });
    return true;
  }
  facSellValue(id: number) { const f = this.factory.facById(id); return !f ? 0 : FULL_REFUND.has(f.type) ? f.spent : Math.round(f.spent * 0.6); }
  /** Credits the next level of a factory building costs (FAC_UP_COST of its price), or 0 when it is at the top or has no levels. */
  facUpCost(f: Fac) { return FAC_UPGRADABLE.has(f.type) && f.lvl < 3 ? Math.round(FACS[f.type].cost * FAC_UP_COST[f.lvl - 1] * this.mods.cheap) : 0; }
  /** Upgrade a mine, pumpjack, plant or generator one level (it works FAC_LVL_SPEED faster). */
  upgradeFac(id: number) {
    const f = this.factory.facById(id);
    if (!f || this.over) return false;
    const c = this.facUpCost(f);
    if (!c || this.gold < c) return false;
    this.gold -= c; f.spent += c; f.lvl++;
    this.events.push({ k: 'build', x: f.x, z: f.z, c: FACS[f.type].color, fac: 1 });
    return true;
  }
  rotateFac(id: number, dir: number) { this.factory.rotate(id, dir); }

  // ---------- tower supply ----------
  /** True if a tower has what it needs to fire right now (power, petrol, and ammunition loaded or in stock). */
  supplied(t: Tower): boolean {
    if (this.opts.free) return true;
    const n = needsOf(t);
    if (n.power && t.pwr < 0.05) return false;
    if (n.item && t.ammo <= 0 && t.stock <= 0) return false;
    if (n.fluid && t.tank < FUEL_PER_TICK) return false;
    return true;
  }
  /**
   * Between two items of a supply line that works (a slow Missile Works, a belt shared by a row of towers) a tower holds
   * nothing, but it is not cut off: it fires as fast as it is fed. It must not count as dry, or a production-limited tower
   * would flash "out of supply" with every item and its special would hardly ever charge.
   */
  private waiting(t: Tower): boolean {
    const n = needsOf(t);
    if (!n.item || t.ammo > 0 || t.stock > 0 || (n.power && t.pwr < 0.05) || (n.fluid && t.tank < FUEL_PER_TICK)) return false;
    // the diagnosis only says the item can reach it: a tower that has had nothing for a long while (its line is jammed, or the
    // towers before it on the belt take everything) is dry all the same
    return t.starve < WAIT_GRACE && !!this.diag().get(towerKey(t.id))?.ok;
  }
  /** Spend one shot of a tower's ammunition. False (and nothing spent) when it has none left. */
  private useAmmo(t: Tower, n = 1): boolean {
    if (this.opts.free) return true;
    const nd = needsOf(t), it = nd.item;
    if (!it) return true;
    if (t.ammo < n) {
      if (t.stock <= 0) return false;
      t.stock--; t.ammo += (nd.shots || ITEM_SHOTS[it] || 1) * this.mods.ammo;
    }
    t.ammo = Math.max(0, t.ammo - n);
    return true;
  }
  /** Burn crude oil for `ticks` ticks of a Firewall Pylon's fire. False when the tank is dry. */
  private useFuel(t: Tower, ticks: number): boolean {
    if (this.opts.free || !needsOf(t).fluid) return true;
    const need = FUEL_PER_TICK * ticks;
    if (t.tank < need) return false;
    t.tank -= need;
    return true;
  }
  /** Fire rate scale from a part-supplied power grid. */
  private powerMul(t: Tower) { return this.opts.free || !needsOf(t).power ? 1 : Math.max(0.05, Math.min(1, t.pwr)); }

  // ---------- waves ----------
  /** Generate wave w one wave ahead, so the HUD can show what is coming and where. */
  private planWave(w: number) {
    const r = this.rand;
    const items: { t: number; type: EnemyType; lane: number }[] = [];
    let budget = waveBudget(w) * this.diff.count * (this.opts.mode === 'coop' ? coopScale(TUNE.coopCount, w) : 1);
    const L = this.map.lanes.length, lane = () => Math.floor(r() * L * 0.999);
    let t = 0.5;
    const gapMul = Math.max(0.35, 0.8 - w * 0.02);
    const T = this.titan;
    if (T.phase !== 'none' && w === T.wave && !(T.phase === 'dead' && this.campaign)) {
      // the Titan comes alone: nothing else spawns on its wave
      items.push({ t: 0, type: 'titan', lane: T.lane });
      budget = 0;
    } else if (w % 5 === 0) {
      const n = 1 + Math.floor(w / 15);
      budget *= 0.55;
      for (let i = 0; i < n; i++) items.push({ t: t + 3 + i * 14, type: 'boss', lane: lane() });
    } else if (gyreCount(w)) {
      // the Gyre is a mini-boss: it rolls in on its own (two from wave GYRE_PAIR), with a thinner wave around it
      budget *= GYRE_WAVE;
      for (let i = 0; i < gyreCount(w); i++) items.push({ t: t + 4 + i * GAPS.wheel, type: 'wheel', lane: lane() });
    }
    const avail = WAVE_POOL.filter((e) => ENEMIES[e].from <= w);
    let broods = broodCap(w);
    while (budget > 0.5 && items.length < 500) {
      // biased toward the newest enemy types, with grunts always in the mix
      const type = avail[avail.length - 1 - Math.floor(r() * r() * avail.length * 0.999)];
      let pick: EnemyType = r() < 0.35 ? 'grunt' : type;
      if (pick === 'brood' && broods <= 0) pick = 'grunt'; // only so many Broodcarriers per wave
      const def = ENEMIES[pick];
      let n = Math.max(1, Math.min(14, Math.round((3 + r() * 6) / Math.pow(def.cost, 0.7))));
      if (pick === 'brood') { n = Math.min(n, broods); broods -= n; }
      const ln = lane();
      for (let i = 0; i < n && budget > 0; i++) {
        items.push({ t, type: pick, lane: ln });
        t += GAPS[pick] * gapMul;
        budget -= def.cost;
      }
      t += 1.4 * gapMul;
    }
    items.sort((a, b) => a.t - b.t);
    this.next = { wave: w, items };
    const lanes: WavePreview['lanes'] = this.map.lanes.map(() => []);
    for (const q of items) {
      const row = lanes[q.lane], f = row.find((o) => o.type === q.type);
      if (f) f.n++; else row.push({ type: q.type, n: 1 });
    }
    this.preview = { wave: w, lanes };
  }
  private planAhead() {
    if (this.campaign && this.wave >= this.winWave) { if (this.next || this.preview.wave) { this.next = null; this.preview = { wave: 0, lanes: this.map.lanes.map(() => []) }; } }
    else if (!this.next || this.next.wave !== this.wave + 1) this.planWave(this.wave + 1);
  }
  /** Credits paid for calling the next wave right now (two per second saved, counting at most NEXT_WAVE_IN seconds; also before the first wave). */
  callBonus(): number {
    if (!this.autoWaves || (this.holdFirst && this.wave === 0) || this.queue.length || this.over || this.titanBusy || this.nextWaveIn <= 0.5 || (this.campaign && this.wave >= this.winWave)) return 0;
    return Math.round(Math.min(NEXT_WAVE_IN, this.nextWaveIn) * 2);
  }
  startWave() {
    if (this.queue.length || this.over || this.replica) return;
    if (this.titanBusy) return; // nothing else comes while the Titan is on the field
    if (this.wave >= this.winWave && this.campaign) return; // the final wave must be cleared, not skipped
    const T = this.titan;
    if (T.phase === 'dead' && !this.campaign) {
      // no last wave: another Titan takes up the roaming (a campaign that plays on after its win gets its next one here)
      while (T.wave <= this.wave + 1) T.wave += TITAN_AGAIN;
      T.phase = 'far'; T.t = 0; T.danger = 0;
    }
    this.planAhead();
    if (!this.next) return;
    this.gold += this.callBonus(); // early-call bonus
    this.wave++;
    if (!this.waveActive) for (const t of this.towers) t.starve = 0; // (the factory starts again: it gets the whole grace to deliver)
    this.waveActive = true; this.cleared = false; this.nextWaveIn = NEXT_WAVE_IN; this.waveT0 = this.time;
    const w = this.wave, mul = waveHpMul(w);
    for (const q of this.next.items) {
      if (q.type === 'titan') this.titanLeap(q.lane);
      else this.queue.push({ t: this.time + q.t, type: q.type, mul, lane: q.lane });
    }
    if (w % 5 === 0 && this.queue.some((q) => q.type === 'boss')) this.events.push({ k: 'boss' });
    this.next = null;
    this.planAhead();
    this.events.push({ k: 'wave', n: w });
  }
  /** Versus: enemies sent by the rival. */
  injectSquad(type: EnemyType, n: number) {
    if (!Object.hasOwn(ENEMIES, type) || type === 'boss' || type === 'titan' || type === 'mite' || this.over) return;
    if (this.queue.length + this.enemies.length > 400) return;
    const mul = waveHpMul(Math.max(1, this.wave));
    for (let i = 0; i < Math.min(n, 20); i++) this.queue.push({ t: this.time + 1 + i * GAPS[type] * 0.7, type, mul, lane: Math.floor(this.rand() * this.map.lanes.length * 0.999) });
    this.queue.sort((a, b) => a.t - b.t);
    this.events.push({ k: 'incoming', type, n });
  }
  private spawn(type: EnemyType, mul: number, lane: number) {
    const d = ENEMIES[type];
    const e = newEnemy(this.nid++, type);
    e.lane = lane;
    if (type === 'titan') {
      // its health is its own (titanHp), and it paces itself to take about TITAN_WALK seconds for the road
      e.hp = e.maxHp = this.titanHp();
      e.speed = clamp(this.map.lanes[lane].len / TITAN_WALK, TITAN_PACE[0], TITAN_PACE[1]);
    } else {
      const up = 1;
      const hp = d.hp * mul * this.diff.hp * this.mapMul * (this.opts.mode === 'coop' ? coopScale(TUNE.coopHp, Math.max(1, this.wave)) : 1) * (type === 'boss' ? TUNE.boss : 1) * up;
      e.off = type === 'boss' ? 0 : (this.rand() - 0.5) * 1.3;
      e.hp = e.maxHp = hp; e.shield = e.maxShield = d.shield * mul * this.mapMul * up;
      e.speed = d.speed * (0.94 + this.rand() * 0.12); e.armor = d.armor * (1 + this.wave * 0.04);
      if (type === 'wheel') e.spin = 1;
      if (type === 'brood') e.ttl = BROOD_FIRST;
    }
    this.place(e);
    this.enemies.push(e);
  }
  /** A mite leaves its Broodcarrier for a tower. It is a real enemy, but it runs across the deck instead of along a road. */
  private spawnMite(mom: Enemy, prey: Tower, i: number) {
    const e = newEnemy(this.nid++, 'mite'), a = mom.yaw + 1.2 + i * 1.3;
    // the lane and distance of the carrier are only there for target priority: the towers take a mite as if it stood where it was let go
    e.lane = mom.lane; e.dist = mom.dist;
    e.x = mom.x + Math.sin(a) * 0.6; e.z = mom.z + Math.cos(a) * 0.6; e.gy = mom.gy; e.y = e.gy + ENEMIES.mite.y;
    e.yaw = Math.atan2(prey.x - e.x, prey.z - e.z);
    e.speed = ENEMIES.mite.speed * (0.85 + 0.1 * i);
    e.prey = prey.id; e.mom = mom.id; e.ttl = MITE_LIFE;
    this.enemies.push(e);
  }

  // ---------- the Titan ----------
  /** The leap: the Titan's wave has begun. It lands on the gate of its lane TITAN_LAND seconds later (see titanImpact). */
  private titanLeap(lane: number) {
    const T = this.titan;
    T.lane = clamp(lane | 0, 0, this.map.lanes.length - 1);
    T.phase = 'landing'; T.t = 0; T.danger = 1;
    this.map.pos(T.lane, 0, tmp);
    this.events.push({ k: 'titanLand', x: tmp.x, z: tmp.z, lane: T.lane });
  }
  /** The impact: every enemy on the field is destroyed (no rewards), every tower is stunned, and the Titan starts down its road. */
  private titanImpact() {
    const T = this.titan;
    let shown = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.alive = false;
      if (shown++ < 40) this.events.push({ k: 'die', x: e.x, y: e.y, z: e.z, t: e.type, h: 0 });
    }
    this.enemies = [];
    for (const t of this.towers) t.stun = TITAN_STUN;
    this.recomputeBuffs();
    this.spawn('titan', 1, T.lane);
    T.phase = 'walk'; T.t = 0;
    this.map.pos(T.lane, 0, tmp);
    this.events.push({ k: 'titanImpact', x: tmp.x, z: tmp.z });
  }
  /** The Titan at the core: a blow for TITAN_STRIKE of the core's maximum, and the next one TITAN_STRIKE_EVERY seconds later. */
  private titanStrike(e: Enemy) {
    const n = Math.max(1, Math.ceil(this.maxLives * TITAN_STRIKE));
    e.breach = TITAN_STRIKE_EVERY;
    this.lives -= n; this.leaked++;
    this.events.push({ k: 'leak', n, x: e.x, y: e.gy + 2, z: e.z });
    this.events.push({ k: 'titanStrike', id: e.id, x: e.x, z: e.z, n });
    if (this.lives <= 0) { this.lives = 0; this.over = true; this.events.push({ k: 'lose' }); }
  }
  private titanDown(e: Enemy, owner: number) {
    const T = this.titan;
    T.phase = 'dead'; T.t = 0; T.danger = 0; this.titanN++;
    if (!this.campaign) T.wave += TITAN_AGAIN; // no last wave: the next one is already on its way
    this.kills++;
    const p = this.players[owner];
    if (p) p.kills++;
    this.gold += TITAN_GOLD * this.diff.gold;
    this.events.push({ k: 'titanDie', x: e.x, y: e.y, z: e.z });
    this.levelUp();
  }
  /** The Titan off the field: it wrecks a building now and then, and its danger fills over the last waves before it comes. */
  private stepTitan(dt: number) {
    const T = this.titan;
    if (T.phase === 'none') return;
    T.t += dt;
    if (T.phase === 'landing') { if (T.t >= TITAN_LAND) this.titanImpact(); return; }
    if (T.phase !== 'far' && T.phase !== 'warn') return;
    this.smashIn -= dt;
    if (this.smashIn <= 0) { this.smashIn = TITAN_SMASH[0] + this.trand() * (TITAN_SMASH[1] - TITAN_SMASH[0]); this.events.push({ k: 'titanSmash' }); }
    const from = this.campaign ? this.winWave - TITAN_LEAD : T.wave - TITAN_LEAD;
    if (T.phase === 'far' && this.wave >= from && this.wave < T.wave) { T.phase = 'warn'; T.t = 0; }
    if (T.phase === 'warn') {
      // each wave of the warning fills its share, over the first 45 seconds of the wave; the last step to 1 is the leap itself
      const f = Math.min(1, (this.time - this.waveT0) / 45);
      T.danger = Math.max(T.danger, clamp(((this.wave - from + f) / Math.max(1, T.wave - from)) * 0.96, 0, 0.96));
    }
  }
  private place(e: Enemy) {
    this.map.pos(e.lane, e.dist, tmp);
    e.x = tmp.x - tmp.dz * e.off; e.z = tmp.z + tmp.dx * e.off;
    e.yaw = Math.atan2(tmp.dx, tmp.dz);
    e.gy = tmp.y || 0;
    e.y = e.gy + ENEMIES[e.type].y;
  }

  // ---------- damage ----------
  /** Returns the damage that got through to the hull. `cut` is the share of a Gyre's guard the hit ignores. */
  damage(e: Enemy, amt: number, owner: number, raw = false, cut = 0): number {
    if (!e.alive) return 0;
    if (e.type === 'mite') { if (!(amt > 0)) return 0; e.hp = 0; this.kill(e, owner); return 1; } // a sliver of health: any hit destroys it
    if (e.type === 'titan') amt *= this.sp ? TUNE.titanSpec : TUNE.titanTower; // its hull turns most tower fire; specials get through
    if ((e.slowT > 0 || e.frz > 0) && this.mods.shatter) amt *= 1 + this.mods.shatter;
    if (e.vulnT > 0) amt *= 1 + this.mods.gravVuln;
    if (!raw && e.armor) {
      const armor = e.burnT > 0 && this.mods.flameMelt ? e.armor * Math.max(0.2, 1 - 0.4 * this.mods.flameMelt) : e.armor;
      amt = Math.max(amt * 0.35, amt - armor);
    }
    if (e.type === 'wheel') amt = this.deflect(e, amt, cut);
    if (e.maxShield > 0) e.shieldCd = 3; // every hit delays the regeneration
    let dealt = amt;
    if (e.shield > 0) {
      const before = e.shield, s = Math.min(e.shield, amt);
      e.shield -= s; amt -= s;
      if (e.shield <= 0 && before > e.maxShield * 0.1) this.events.push({ k: 'shieldbreak', x: e.x, y: e.y, z: e.z });
    }
    e.hp -= amt;
    if (owner >= 0 && amt > 0) this.events.push({ k: 'dmg', x: e.x, y: e.y + e.r, z: e.z, n: Math.round(amt), p: owner, id: e.id });
    if (e.hp <= 0) { dealt += e.hp; this.kill(e, owner); }
    return Math.max(0, dealt);
  }
  /**
   * A Gyre's spinning rim turns part of a hit aside, and the hit bleeds spin off as it lands: the guard follows the spin down
   * through the hit, so one heavy hit and the same damage in small hits strip the rim and get through alike. Returns what gets through.
   */
  private deflect(e: Enemy, amt: number, cut: number): number {
    if (!(amt > 0)) return amt;
    const s0 = e.spin, part = Math.min(amt, (s0 * e.maxHp) / WHEEL_BLEED); // `part` is the share of the hit that meets a moving rim
    const s1 = s0 - (part * WHEEL_BLEED) / e.maxHp;
    const through = amt - part * WHEEL_GUARD * (1 - clamp(cut, 0, 1)) * (s0 + s1) * 0.5;
    e.spinCd = WHEEL_REST;
    this.setSpin(e, s1);
    if (through < amt * 0.5 && this.time >= e.deflAt) { e.deflAt = this.time + 0.25; this.events.push({ k: 'deflect', x: e.x, y: e.y, z: e.z }); }
    return through;
  }
  /** Set a Gyre's spin and report when the rim stalls (below 0.25) and when it is back up to speed (above 0.6). */
  private setSpin(e: Enemy, v: number) {
    e.spin = clamp(v, 0, 1);
    if (!e.stalled && e.spin < 0.25) { e.stalled = true; this.events.push({ k: 'spindown', id: e.id, x: e.x, y: e.y, z: e.z }); }
    else if (e.stalled && e.spin > 0.6) { e.stalled = false; this.events.push({ k: 'spinup', id: e.id, x: e.x, y: e.y, z: e.z }); }
  }
  private kill(e: Enemy, owner: number) {
    e.alive = false;
    const d = ENEMIES[e.type];
    if (e.type === 'titan') { this.titanDown(e, owner); return; }
    if (e.type === 'mite') { // no reward and no kill count
      this.events.push({ k: 'die', x: e.x, y: e.y, z: e.z, t: e.type, h: owner >= 0 ? 1 : 0 });
      return;
    }
    this.kills++;
    this.gold += d.bounty * TUNE.bounty * this.mods.gold * this.diff.gold;
    this.xp += d.xp * TUNE.xp * this.mods.xp;
    this.events.push({ k: 'die', x: e.x, y: e.y, z: e.z, t: e.type, h: owner >= 0 ? 1 : 0 });
    while (this.xp >= this.xpNext) { this.xp -= this.xpNext; this.levelUp(); }
  }
  private levelUp() {
    this.level++; this.xpNext = xpNeed(this.level);
    // co-op: the players take turns, one offer per level
    const i = this.level % this.players.length, o = this.rollCards(i);
    if (o.length) this.players[i].pending.push(o);
    this.events.push({ k: 'levelup', n: this.level });
  }
  /** Area damage. With `gy` (ground height of the blast) enemies on a road more than DECK_GAP above or below are shielded by the deck. */
  private aoe(x: number, z: number, r: number, dmg: number, owner: number, ground = false, gy?: number) {
    for (const e of this.enemies) {
      if (!e.alive || (ground && ENEMIES[e.type].fly)) continue;
      if (gy !== undefined && e.type !== 'mite' && Math.abs(e.gy - gy) > DECK_GAP) continue; // (a mite's height is its perch on a tower, not a deck)
      if (Math.hypot(e.x - x, e.z - z) <= r + e.r) this.damage(e, dmg, owner);
    }
  }
  private chainFrom(src: Enemy, n: number, dmg: number, owner: number, c: number, slow = 0, fall = 0.8, reach = 4.5) {
    const pts = [src.x, src.y, src.z];
    const hit = new Set<number>([src.id]);
    let cur = src;
    for (let i = 0; i < n; i++) {
      let best: Enemy | null = null, bd = reach;
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e.id)) continue;
        const d = Math.hypot(e.x - cur.x, e.z - cur.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      hit.add(best.id); pts.push(best.x, best.y, best.z);
      if (slow && best.type !== 'boss') { best.slowT = Math.max(best.slowT, 1); best.slowF = Math.max(best.slowF, slow); }
      this.damage(best, dmg, owner);
      dmg *= fall; cur = best;
    }
    if (pts.length > 3) this.events.push({ k: 'arc', p: pts, c });
  }

  // ---------- cards ----------
  private cardOk(_pi: number, c: Card) {
    const stack = this.stacks[c.id] || 0;
    if (c.kind === 'blueprint') return this.bpOpen().includes(c.id.slice(3) as TowerType);
    if (c.id === 'tunnels' && this.level < 3) return false; // (not before there is a factory to connect)
    return stack < c.max && (!c.needs || this.unlocked.has(c.needs));
  }
  /**
   * The blueprints on offer right now. They come tier by tier (see TOWER_TIER): only the lowest tier that still has something
   * locked, so every new tower adds one step to what the player already runs.
   * A tower a map opened early (its crate) still has a blueprint while its supply buildings are locked.
   */
  bpOpen(): TowerType[] {
    const locked = TOWER_TYPES.filter((t) => !this.unlocked.has(t) || TOWER_CHAIN[t].some((f) => !this.facs.has(f)));
    if (!locked.length) return [];
    const low = Math.min(...locked.map((t) => TOWER_TIER[t])), first = locked.filter((t) => TOWER_TIER[t] === low);
    return first;
  }
  /** Roll an offer of up to three cards. */
  rollCards(pi: number): string[] {
    const all = CARDS.filter((c) => this.cardOk(pi, c));
    const out: string[] = [];
    // blueprints come on set levels only, one at a time, so each new supply chain has a few waves to be built in
    const bps = all.filter((c) => c.kind === 'blueprint'), pool = all.filter((c) => c.kind !== 'blueprint');
    if (bps.length && BP_LEVELS.includes(this.level)) out.push(bps[Math.floor(this.rand() * bps.length)].id);
    const W = [10, TUNE.rare, TUNE.epic];
    // dedicated upgrades are only useful once that tower is on the field, so they are offered less often until it is
    const built = new Set(this.towers.map((t) => t.type));
    const wt = (c: Card) => W[c.rar] * (c.needs && !built.has(c.needs) ? 0.3 : 1);
    while (out.length < 3) {
      const rest = pool.filter((c) => !out.includes(c.id));
      if (!rest.length) break;
      let tot = 0;
      for (const c of rest) tot += wt(c);
      let x = this.rand() * tot, got = rest[rest.length - 1];
      for (const c of rest) { x -= wt(c); if (x <= 0) { got = c; break; } }
      out.push(got.id);
    }
    return out;
  }
  pickCard(pi: number, idx: number) {
    const p = this.players[pi];
    if (!p || !p.pending.length) return;
    const offer = p.pending.shift()!;
    const id = offer[Math.max(0, Math.min(offer.length - 1, idx | 0))];
    const card = typeof id === 'string' && Object.hasOwn(CARD_BY_ID, id) ? CARD_BY_ID[id] : undefined;
    if (!card) return;
    const st = this.stacks;
    if ((st[card.id] || 0) >= card.max) { this.gold += 100; return; }
    st[card.id] = (st[card.id] || 0) + 1;
    card.apply({
      mods: this.mods, unlocked: this.unlocked, facs: this.facs,
      addGold: (n) => { this.gold += n; }, addLives: (n) => { this.lives = Math.min(30, this.lives + n); }, addMats: (n) => { this.mats += n; },
    });
    this.recomputeBuffs();
    // offers rolled earlier may now contain a card that is maxed or a blueprint that is already unlocked
    this.players.forEach((q, i) => {
      q.pending = q.pending.map((offer2) => (offer2.some((c) => !this.cardOk(i, CARD_BY_ID[c])) ? this.rollCards(i) : offer2)).filter((o) => o.length > 0);
    });
    this.events.push({ k: 'card', id: card.id, p: pi });
  }

  // ---------- tower specials ----------
  private anyIn(t: Tower, range: number, ground = false) {
    for (const e of this.enemies) if (e.alive && !(ground && ENEMIES[e.type].fly) && Math.hypot(e.x - t.x, e.z - t.z) <= range + e.r) return true;
    return false;
  }
  /**
   * Fire a tower's special (the player presses Fire on the charged tower). Needs a full charge and an online tower,
   * and something for the special to hit. Otherwise false is returned and the charge is kept; a charged tower with
   * nothing to hit answers with a 'nospec' event.
   */
  triggerSpecial(towerId: number, owner: number): boolean {
    const t = this.towerById(towerId);
    if (!t || this.over || this.replica || !this.specialReady(t)) return false;
    if (this.fireSpecial(t, owner)) return true;
    // charged but with nothing to hit: the charge is kept, and the node says so (at most twice a second per tower)
    if ((this.nospecAt.get(t.id) ?? -1) <= this.time) {
      this.nospecAt.set(t.id, this.time + 0.5);
      nodePos(t, W3);
      this.events.push({ k: 'nospec', id: t.id, x: W3.x, y: W3.y, z: W3.z });
    }
    return false;
  }
  /** True if something stands within `pad` of the fire this pylon would make during an Inferno: its live walls, or its ring when it has no partner. */
  private flameReach(t: Tower, pad: number): boolean {
    let linked = false;
    for (const w of this.walls) {
      if (w.a !== t.id && w.b !== t.id) continue;
      linked = true;
      if (!w.on) continue;
      const half = WALL_HALF * (1 + 0.3 * this.mods.flameMelt) * INFERNO_WIDE + pad;
      for (const e of this.enemies) if (e.alive && segDist(e.x, e.z, w.ax, w.az, w.bx, w.bz) <= half + e.r) return true;
    }
    return !linked && this.anyIn(t, FIRE_RING * 1.5 + pad);
  }
  private fireSpecial(t: Tower, owner: number): boolean {
    this.sp = true; // a special hurts the Titan
    const fired = this.runSpecial(t, owner);
    this.sp = false;
    return fired;
  }
  private runSpecial(t: Tower, owner: number): boolean {
    const range = this.range(t), pow = this.mods.specPow, dmg = this.towerDmg(t), c = TOWERS[t.type].color;
    let dur = 0.5;
    switch (t.type) {
      case 'pulse': // Bullet Storm (the same test the turret fires with)
        if (!this.pickTarget(t, range, 0)) return false;
        dur = 5; t.cd = 0;
        break;
      case 'cryo': { // Flash Freeze
        if (!this.anyIn(t, range)) return false;
        for (const e of this.enemies) {
          if (!e.alive || Math.hypot(e.x - t.x, e.z - t.z) > range + e.r) continue;
          e.frz = Math.max(e.frz, 3);
          if (e.type === 'wheel') this.setSpin(e, 0); // frozen solid: the rim stops dead before the cold bites
          this.damage(e, dmg * 4 * pow, -1);
        }
        dur = 3;
        break;
      }
      case 'arc': { // Thunderhead
        const e = this.pickTarget(t, range * 1.3, 0);
        if (!e) return false;
        this.events.push({ k: 'arc', p: [t.x, t.h * 0.95, t.z, e.x, e.y, e.z], c, big: 1 });
        this.damage(e, dmg * 8 * pow, -1);
        this.chainFrom(e, 12, dmg * 8 * pow * 0.92, -1, c, 0.3, 0.92, 7);
        break;
      }
      case 'mortar': // Barrage
        if (!this.anyIn(t, range, true)) return false;
        t.aux = 8; t.fxT = 0; dur = 1.8;
        break;
      case 'rail': { // Overcharge
        let e: Enemy | null = null;
        for (const o of this.enemies) if (o.alive && (!e || o.hp + o.shield > e.hp + e.shield)) e = o;
        if (!e) return false;
        let dx = e.x - t.x, dz = e.z - t.z;
        const L = Math.hypot(dx, dz) || 1, R = 90;
        dx /= L; dz /= L;
        t.yaw = Math.atan2(dx, dz);
        for (const o of this.enemies) {
          if (!o.alive) continue;
          const ex = o.x - t.x, ez = o.z - t.z, u = ex * dx + ez * dz;
          if (u >= 0 && u <= R && Math.abs(ex * dz - ez * dx) < o.r + 0.8) this.damage(o, dmg * 8 * pow * (1 + RAIL_CAP * this.mods.railCap), -1, true, WHEEL_PIERCE);
        }
        this.events.push({ k: 'rail', x: t.x + dx, y: t.h * 0.8, z: t.z + dz, tx: t.x + dx * R, ty: 0.8, tz: t.z + dz * R, c, big: 1 });
        break;
      }
      case 'beacon': dur = 8 * pow; break; // Surge
      case 'flame': // Inferno
        if (!this.flameReach(t, 2.5)) return false;
        dur = 5; t.cd = 0;
        break;
      case 'lance': // Overload
        if (!this.pickTarget(t, range, 0)) return false;
        dur = 5; t.heat = 1;
        break;
      case 'missile': // Swarm
        if (!this.enemies.some((e) => e.alive)) return false;
        t.aux = 24; t.fxT = 0; dur = 1.2;
        break;
      case 'gravity': { // Collapse
        let e: Enemy | null = null;
        for (const o of this.enemies) if (o.alive && Math.hypot(o.x - t.x, o.z - t.z) <= range + o.r && (!e || o.hp + o.shield > e.hp + e.shield)) e = o;
        if (!e) return false;
        const zd = 14 * LVL_DMG[t.lvl - 1] * this.mods.tDmg * (1 + t.buff) * (1 + this.wave * 0.2) * pow;
        this.zones.push({ id: this.nid++, kind: 'sing', x: e.x, z: e.z, r: 5, life: 2.6, tick: 0, dmg: zd, owner: -1, pd: 0, y: e.gy });
        dur = 2.6;
        break;
      }
      default: return false;
    }
    t.charge = 0; t.spec = dur;
    if (t.type === 'beacon') this.recomputeBuffs();
    nodePos(t, W3);
    this.events.push({ k: 'special', id: t.id, t: t.type, x: W3.x, y: W3.y, z: W3.z, p: owner });
    return true;
  }
  private endSpecial(t: Tower) {
    const sp = TOWERS[t.type].special;
    t.spec = 0; t.aux = 0; t.tgt = 0; t.charge = 0;
    if (t.type !== 'lance') t.heat = 0; // a Lance comes back from its Overload still hot
    t.down = (sp ? sp.down : 0) * this.mods.reboot;
    this.events.push({ k: 'down', id: t.id, x: t.x, z: t.z });
    if (t.type === 'beacon') this.recomputeBuffs();
  }

  // ---------- main step ----------
  step(dt: number) {
    if (this.over || this.replica || this.paused) return;
    this.time += dt;
    if (!this.next && !(this.campaign && this.wave >= this.winWave)) this.planAhead(); // e.g. the run was switched to endless after the final wave

    // waves: the next one is called 12s after the last spawn, or sooner once the field is clear
    while (this.queue.length && this.queue[0].t <= this.time) { const q = this.queue.shift()!; this.spawn(q.type, q.mul, q.lane); }
    this.stepTitan(dt);
    // stray mites do not hold a wave open; the Titan does, from its leap until it is destroyed
    const busy = this.titanBusy, left = busy || this.enemies.some((e) => e.type !== 'mite');
    this.waveActive = this.queue.length > 0 || left;
    if (!this.queue.length && !busy) {
      const last = this.campaign && this.wave >= this.winWave;
      if (!this.cleared && !left) {
        this.cleared = true;
        this.nextWaveIn = Math.min(this.nextWaveIn, 5);
        const bonus = TUNE.clear0 + this.wave * TUNE.clear1 + Math.min(60, this.gold * this.mods.interest);
        this.gold += bonus;
        this.events.push({ k: 'clear', n: this.wave, g: Math.round(bonus) });
        if (last) { this.won = true; this.over = true; this.events.push({ k: 'win' }); return; }
      }
      // the next wave comes by itself only where that is switched on, and the first one never does where it is held for the call
      if (!last && this.autoWaves && !(this.holdFirst && this.wave === 0)) { this.nextWaveIn -= dt; if (this.nextWaveIn <= 0) this.startWave(); }
    }

    // zones (indexed loops over the array as it stands, like for-of, without an iterator per loop every step)
    const zones = this.zones;
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      z.life -= dt; z.tick -= dt;
      if (z.kind === 'sing') {
        const es = this.enemies;
        for (let ei = 0; ei < es.length; ei++) {
          const e = es[ei];
          if (!e.alive || Math.hypot(e.x - z.x, e.z - z.z) > z.r) continue;
          const boss = e.type === 'boss' || e.type === 'titan' || e.type === 'mite'; // too heavy to drag, or not on a road
          e.sing = 0.2; // held by the singularity (tracked apart from cryo/arc slows)
          if (!boss && e.breach <= 0) {
            const len = this.map.lanes[e.lane].len, pd = Math.min(this.map.nearest(e.lane, z.x, z.z), len - 4);
            // only ever backward: enemies behind the centre are held (e.sing), never hurried along the road
            e.dist = Math.min(len - 0.5, e.dist + Math.max(-1, Math.min(0, pd - e.dist)) * 5 * dt);
            e.off *= 1 - 3 * dt;
          }
        }
      }
      this.sp = z.kind === 'sing'; // a Collapse is a tower special: it hits the Titan at full strength
      if (z.tick <= 0) {
        z.tick = 0.25;
        if (z.kind === 'burn') this.aoe(z.x, z.z, z.r, z.dmg * 0.25, -1, true, z.y);
        else this.aoe(z.x, z.z, z.r, z.dmg * 0.3, z.owner);
      }
      if (z.life <= 0 && z.kind === 'sing') {
        this.aoe(z.x, z.z, z.r, z.dmg * 7, z.owner);
        this.events.push({ k: 'boom', x: z.x, y: z.y + 1, z: z.z, r: z.r, c: SING_COLOR });
      }
      this.sp = false;
    }
    if (this.zones.length && anyGone(this.zones)) this.zones = this.zones.filter((z) => z.life > 0);

    // enemies
    const ens = this.enemies;
    for (let ei = 0; ei < ens.length; ei++) {
      const e = ens[ei];
      if (!e.alive) continue;
      let v = e.speed;
      let slow = 0;
      if (e.slowT > 0) { e.slowT -= dt; slow = e.slowF; if (e.slowT <= 0) e.slowF = 0; }
      if (e.sing > 0) { e.sing -= dt; slow = Math.max(slow, e.type === 'boss' ? 0.4 : 0.9); }
      if (e.frz > 0) { e.frz -= dt; slow = Math.max(slow, e.type === 'boss' ? 0.6 : 1); }
      if (e.type === 'titan') slow *= TITAN_SLOW; // slowing effects only work at part strength on the Titan
      v *= 1 - slow;
      if (e.type === 'mite') { this.stepMite(e, dt, slow); continue; }
      if (e.type === 'wheel') {
        // the rim: a freeze stops it dead, a well or a singularity drags it down fast, a slow steadily; left alone it spins back up
        if (e.spinCd > 0) e.spinCd -= dt;
        if (e.frz > 0) this.setSpin(e, 0);
        else if (e.sing > 0 || e.pullCd > 0) this.setSpin(e, e.spin - WHEEL_SINK * dt);
        else if (slow > 0) this.setSpin(e, e.spin - WHEEL_DRAG * dt);
        else if (e.spinCd <= 0 && e.spin < 1) this.setSpin(e, e.spin + WHEEL_SPINUP * dt);
        v *= WHEEL_CRAWL + (1 - WHEEL_CRAWL) * e.spin;
      }
      if (e.vulnT > 0) e.vulnT -= dt;
      if (e.pullCd > 0) e.pullCd -= dt;
      if (e.burnT > 0) {
        e.burnT -= dt; e.burnAcc += dt;
        if (e.burnAcc >= 0.5) { e.burnAcc -= 0.5; const cd = e.spinCd; this.damage(e, e.burnD * 0.5, -1, true); e.spinCd = cd; if (!e.alive) continue; } // a burn is not a hit: it does not keep a Gyre from spinning back up
        if (e.burn2T > 0) e.burn2T -= dt;
        if (e.burnT <= 0) {
          if (e.burn2T > 0) { e.burnD = e.burn2D; e.burnT = e.burn2T; } else { e.burnD = 0; e.burnAcc = 0; }
          e.burn2T = 0; e.burn2D = 0;
        }
      }
      if (e.maxShield > 0 && e.shield < e.maxShield) { e.shieldCd -= dt; if (e.shieldCd <= 0) e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.25 * dt); }
      if (e.breach > 0) { // at the core: its attack lands when the timer runs out (slows and freezes delay it) unless it is destroyed first
        e.breach -= dt * (1 - slow);
        if (e.breach <= 0) { if (e.type === 'titan') this.titanStrike(e); else this.breachHit(e); }
        continue;
      }
      e.dist += v * dt;
      if (e.pull > 0) { const d = Math.min(e.pull, 6 * dt); e.pull -= d; e.dist = Math.max(0, e.dist - d); }
      const len = this.map.lanes[e.lane].len;
      // enemies pull up at the edge of the core's plinth (the view draws them there too), not at its centre
      const stand = Math.max(0, len - (CORE_STAND + 0.6 * e.r));
      if (e.dist >= stand) { e.dist = stand; e.pull = 0; e.breach = e.type === 'titan' ? TITAN_WINDUP : e.type === 'boss' ? BREACH_TIME_BOSS : BREACH_TIME; }
      this.place(e);
      if (e.type === 'brood') this.stepBrood(e, dt);
    }

    // walls of fire follow their pylons: off while one of them reboots, hot while an Inferno runs
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i], tw = this.wallTw[i];
      w.on = !towerOff(tw[0]) && !towerOff(tw[1]); w.hot = w.on && (tw[0].spec > 0 || tw[1].spec > 0);
    }

    // the factory runs, then the towers fire on what it delivered; between waves time stands still for both
    // (the networks are still worked out, so the view and diag() see a new layout at once)
    if (this.planning) this.factory.sync();
    else {
      this.factory.step(dt);
      const tws = this.towers;
      for (let i = 0; i < tws.length; i++) this.stepTower(tws[i], dt);
    }

    // projectiles (the last shots of a wave still fly out)
    const ps = this.projs;
    for (let i = 0; i < ps.length; i++) this.stepProj(ps[i], dt);
    // (a new array only when something has gone: no garbage on the steps where nothing did)
    if (this.projs.length && anyGone(this.projs)) this.projs = this.projs.filter((p) => p.life > 0);
    if (anyDead(this.enemies)) this.enemies = this.enemies.filter((e) => e.alive);

  }

  /** The attack of an enemy at the core lands: the core takes the damage and its discharge destroys the attacker. */
  private breachHit(e: Enemy) {
    e.breach = 0; e.alive = false;
    const n = e.type === 'boss' ? Math.max(1, Math.min(ENEMIES.boss.leak, Math.ceil(this.maxLives * BREACH_SHARE))) : ENEMIES[e.type].leak;
    this.lives -= n; this.leaked++;
    this.events.push({ k: 'leak', n, x: e.x, y: e.y, z: e.z });
    this.events.push({ k: 'breach', id: e.id, x: e.x, y: e.y, z: e.z, t: e.type });
    if (this.lives <= 0) { this.lives = 0; this.over = true; this.events.push({ k: 'lose' }); }
  }

  /** A Broodcarrier lets a swarm of mites loose on the nearest tower that is still working, once its last swarm is gone. */
  private stepBrood(e: Enemy, dt: number) {
    if (e.frz > 0) return; // frozen solid: nothing gets out
    e.ttl -= dt;
    if (e.ttl > 0) return;
    const taken = new Set<number>();
    for (const o of this.enemies) {
      if (!o.alive || o.type !== 'mite') continue;
      if (o.mom === e.id) { e.ttl = 0.3; return; } // its last swarm is still out
      taken.add(o.prey);
    }
    // never a tower that is already offline, jammed or spoken for
    let best: Tower | null = null, bd = BROOD_REACH;
    for (const t of this.towers) {
      if (towerOff(t) || taken.has(t.id)) continue;
      const d = Math.hypot(t.x - e.x, t.z - e.z);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) { e.ttl = 0.4; return; }
    e.ttl = BROOD_EVERY;
    for (let i = 0; i < BROOD_SIZE; i++) this.spawnMite(e, best, i);
    this.events.push({ k: 'brood', id: e.id, x: e.x, y: e.y, z: e.z, prey: best.id });
  }
  /** A mite runs straight across the deck to its tower, climbs it and jams it for as long as it sits there. It burns out after MITE_HOLD seconds on the tower. */
  private stepMite(e: Enemy, dt: number, slow: number) {
    e.ttl -= dt;
    const t = this.towerById(e.prey);
    if (!t || e.ttl <= 0) { e.alive = false; this.events.push({ k: 'die', x: e.x, y: e.y, z: e.z, t: 'mite', h: 0 }); return; }
    if (!e.latched) {
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz), v = e.speed * (1 - slow) * dt;
      if (d <= 0.55 + v) { e.latched = true; e.ttl = Math.min(e.ttl, MITE_HOLD); }
      else { e.x += (dx / d) * v; e.z += (dz / d) * v; e.yaw = Math.atan2(dx, dz); e.gy = Math.max(0, e.gy - 6 * dt); }
    }
    if (e.latched) {
      // each mite of a swarm has a perch of its own around the tower, so they can be shot off one by one
      const k = e.id % 4, a = k * 1.5708 + 0.6;
      e.x = t.x + Math.sin(a) * 0.5; e.z = t.z + Math.cos(a) * 0.5; e.yaw = a + Math.PI;
      e.gy = Math.min(t.h * (0.34 + 0.14 * k), e.gy + 3.5 * dt);
      if (t.jam <= 0) { this.events.push({ k: 'jam', id: t.id, x: t.x, z: t.z }); t.jam = JAM_LINGER; if (t.type === 'beacon') this.recomputeBuffs(); }
      t.jam = Math.max(t.jam, JAM_LINGER);
    }
    e.y = e.gy + ENEMIES.mite.y;
  }

  private turn(t: Tower, x: number, z: number, dt: number) {
    let d = Math.atan2(x - t.x, z - t.z) - t.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    t.yaw += d * Math.min(1, dt * 12);
  }

  private stepTower(t: Tower, dt: number) {
    const def = TOWERS[t.type], sp = def.special;
    if (t.stun > 0) { t.stun -= dt; if (t.stun <= 0) { t.stun = 0; if (t.type === 'beacon') this.recomputeBuffs(); } }
    if (t.jam > 0) {
      t.jam -= dt;
      if (t.jam <= 0) { t.jam = 0; this.events.push({ k: 'unjam', id: t.id, x: t.x, z: t.z }); if (t.type === 'beacon') this.recomputeBuffs(); }
    }
    if (t.down > 0) { // rebooting after a special: does nothing and does not charge
      t.down -= dt;
      if (t.down <= 0) {
        t.down = 0; t.charge = 0; t.cd = 0.3;
        this.events.push({ k: 'up', id: t.id, x: t.x, z: t.z });
        if (t.type === 'beacon') this.recomputeBuffs();
      }
      return;
    }
    if (t.stun > 0 || t.jam > 0) return; // stunned or jammed: idle, and the special neither runs nor charges
    // out of supply (no power, no petrol, no ammunition): idle until the factory delivers, and the special does not charge
    t.starve = t.ammo > 0 || t.stock > 0 ? 0 : t.starve + dt;
    const dry = !this.supplied(t) && !this.waiting(t);
    if (dry !== t.dry) {
      t.dry = dry;
      this.events.push({ k: dry ? 'dry' : 'fed', id: t.id, t: t.type, x: t.x, z: t.z });
      if (t.type === 'beacon') this.recomputeBuffs();
    }
    if (dry) { if (t.spec > 0) this.endSpecial(t); return; }
    if (sp) {
      if (t.spec > 0) { t.spec -= dt; if (t.spec <= 0) { this.endSpecial(t); return; } }
      else if (t.charge < 1) t.charge = Math.min(1, t.charge + (dt * this.mods.specCharge) / sp.charge);
    }
    if (t.type === 'beacon') return;
    const range = this.range(t);
    if (t.aux > 0) { // Barrage / Swarm in progress
      t.fxT -= dt;
      while (t.fxT <= 0 && t.aux > 0) {
        t.aux--;
        if (t.type === 'mortar') { t.fxT += 0.2; this.barrageShell(t, range); }
        else { t.fxT += 0.045; this.swarmMissile(t); }
      }
      return;
    }
    if (t.type === 'flame') { this.stepFlame(t, dt); return; }
    if (t.type === 'lance') { this.stepLance(t, dt, range); return; }
    if (t.type === 'gravity') { this.stepGravity(t, dt, range); return; }
    t.cd -= dt;
    const tgt = this.pickTarget(t, range, def.minRange || 0);
    if (!tgt) { if (t.cd < 0) t.cd = 0; return; }
    this.turn(t, tgt.x, tgt.z, dt);
    if (t.cd > 0) return;
    // the cooldown carries its remainder, and a fast tower may fire several times in one step, so the fire rate is exact
    const storm = t.type === 'pulse' && t.spec > 0;
    const iv = 1 / (this.towerRate(t) * (storm ? 5 : 1)), dmg = this.towerDmg(t) * (storm ? this.mods.specPow : 1);
    let e: Enemy | null = tgt;
    for (let n = 0; n < MAX_SHOTS && t.cd <= 0 && e; n++) {
      if (!storm && !this.useAmmo(t)) break; // a Bullet Storm is the tower's special: it costs no ammunition
      t.cd += iv;
      this.fire(t, e, dmg, range);
      if (!e.alive) e = this.pickTarget(t, range, def.minRange || 0);
    }
    if (t.cd < 0) t.cd = 0;
  }
  /** How many shots a tower owes this step (cooldown with carry-over, at most MAX_SHOTS). */
  private shots(t: Tower): number {
    const iv = 1 / this.towerRate(t);
    let n = 0;
    while (t.cd <= 0 && n < MAX_SHOTS) { t.cd += iv; n++; }
    if (t.cd < 0) t.cd = 0;
    return n;
  }
  /** Set an enemy burning. A weaker burn never extends a stronger one: it waits underneath and takes over when the stronger burn runs out. */
  private burn(e: Enemy, d: number, T: number) {
    if (e.burnT <= 0 || d >= e.burnD) { e.burnD = d; e.burnT = Math.max(e.burnT, T); }
    else { e.burn2D = e.burn2T > 0 ? Math.max(e.burn2D, d) : d; e.burn2T = Math.max(e.burn2T, T); }
  }

  /**
   * Firewall Pylon. On every tick it burns whatever stands in its walls and sets it alight; each of a wall's two pylons brings
   * half of the heat, so a wall deals the mean of their damage per second. Flyers take half. A pylon without a partner burns
   * a small ring around itself at RING_SHARE of that.
   */
  private stepFlame(t: Tower, dt: number) {
    t.cd -= dt;
    if (t.cd > 0) return;
    if (!this.enemies.length) { t.cd = 0; return; }
    const shots = this.shots(t), fb = this.mods.flameBurn;
    if (!this.useFuel(t, shots)) return;
    const dmg = this.towerDmg(t), hot = INFERNO * this.mods.specPow;
    const bD = dmg * this.towerRate(t) * BURN_SHARE * (1 + 0.4 * fb), bT = 2.5 + 1.5 * fb;
    let linked = false;
    for (const w of this.walls) {
      if (w.a !== t.id && w.b !== t.id) continue;
      linked = true;
      if (!w.on) continue;
      const half = this.wallHalf(w), k = w.hot ? hot : 1;
      for (const e of this.enemies) {
        if (!e.alive || segDist(e.x, e.z, w.ax, w.az, w.bx, w.bz) > half + e.r) continue;
        const f = k * (ENEMIES[e.type].fly ? 0.5 : 1);
        this.sp = w.hot; // an Inferno is a special
        for (let n = 0; n < shots && e.alive; n++) this.damage(e, dmg * 0.5 * f, -1);
        this.sp = false;
        if (e.alive) this.burn(e, bD * f, bT);
      }
    }
    if (linked) return;
    const inferno = t.spec > 0, R = FIRE_RING * (inferno ? 1.5 : 1);
    for (const e of this.enemies) {
      if (!e.alive || Math.hypot(e.x - t.x, e.z - t.z) > R + e.r) continue;
      const f = RING_SHARE * (inferno ? hot : 1) * (ENEMIES[e.type].fly ? 0.5 : 1);
      this.sp = inferno;
      for (let n = 0; n < shots && e.alive; n++) this.damage(e, dmg * f, -1);
      this.sp = false;
      if (e.alive) this.burn(e, bD * f, bT);
    }
  }

  /** Lance Emitter: a continuous beam on one target that ramps up while it holds; the heat is lost on a retarget. */
  private stepLance(t: Tower, dt: number, range: number) {
    const over = t.spec > 0;
    let e: Enemy | null = null;
    if (t.tgt) { for (const o of this.enemies) if (o.id === t.tgt) { if (o.alive && Math.hypot(o.x - t.x, o.z - t.z) <= range + 0.5) e = o; break; } }
    if (!e) {
      if (t.tgt) t.heat *= this.mods.lanceRamp ? 0.5 : 0;
      e = this.pickTarget(t, range, 0);
      t.tgt = e ? e.id : 0;
    }
    if (over) t.heat = 1;
    t.cd -= dt;
    if (!e) { if (t.cd < 0) t.cd = 0; return; }
    this.turn(t, e.x, e.z, dt);
    t.heat = Math.min(1, t.heat + (dt * (1 + 0.4 * this.mods.lanceRamp)) / 4);
    if (t.cd > 0) return;
    const ticks = this.shots(t);
    if (!over && !this.useAmmo(t, ticks)) return;
    const dmg = this.towerDmg(t) * (1 + (TUNE.lanceHeat + LANCE_FOCUS * this.mods.lanceHeat) * t.heat) * (over ? OVERLOAD * this.mods.specPow : 1) * ticks;
    const y = t.h * 0.85;
    let tx = e.x, tz = e.z;
    this.sp = over;
    if (over) { // Overload: the beam pierces everything along its line
      let dx = e.x - t.x, dz = e.z - t.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
      for (const o of this.enemies) {
        if (!o.alive) continue;
        const ex = o.x - t.x, ez = o.z - t.z, u = ex * dx + ez * dz;
        if (u >= 0 && u <= range + 1 && Math.abs(ex * dz - ez * dx) < o.r + 0.6) this.damage(o, dmg, -1);
      }
      tx = t.x + dx * (range + 1); tz = t.z + dz * (range + 1);
    } else this.damage(e, dmg, -1);
    this.sp = false;
    this.events.push({ k: 'lance', id: t.id, x: t.x, y, z: t.z, tx, ty: e.y, tz, heat: t.heat, o: over ? 1 : 0 });
  }

  /** Graviton Well: no damage; each pulse slows enemies in range and drags them back along their lane. */
  private stepGravity(t: Tower, dt: number, range: number) {
    t.cd -= dt;
    if (t.cd > 0 || !this.anyIn(t, range)) return;
    if (!this.useAmmo(t)) return;
    t.cd = 1 / this.towerRate(t);
    // the drag is a share of the ground the enemy would cover until it can be dragged again, so nothing is ever held in place for good
    // (every Deep Well stack and every level adds drag; the cap is only a safety net. A Beacon makes the well pulse faster, not drag further.)
    const k = Math.min(0.72, (0.3 + 0.07 * (t.lvl - 1)) * (1 + 0.25 * this.mods.gravPull));
    const f = 0.3 + 0.06 * (t.lvl - 1);
    for (const e of this.enemies) {
      if (!e.alive || Math.hypot(e.x - t.x, e.z - t.z) > range + e.r) continue;
      const boss = e.type === 'boss', ff = boss ? f * 0.5 : f;
      if (ff >= e.slowF || e.slowT <= 0) { e.slowF = ff; e.slowT = Math.max(e.slowT, 1.6); }
      if (e.pullCd <= 0 && e.type !== 'titan' && e.type !== 'mite') { // the Titan is too heavy to drag, and a mite is not on a road
        const slow = Math.max(e.slowT > 0 ? e.slowF : 0, e.sing > 0 ? (boss ? 0.4 : 0.9) : 0, e.frz > 0 ? (boss ? 0.6 : 1) : 0);
        e.pull += paceOf(e) * (1 - slow) * 1.8 * k * (boss ? 0.3 : 1); e.pullCd = 1.8;
      }
      if (this.mods.gravVuln) e.vulnT = 2.4;
    }
    this.events.push({ k: 'gravity', id: t.id, x: t.x, z: t.z, r: range });
  }

  /**
   * The enemy a tower aims at, by its targeting mode (t.aim, see TargetMode in data.ts), among those it can hit: in range, outside
   * its minimum range, on the ground for a mortar. Allocation-free: it runs for every tower on every step.
   */
  private pickTarget(t: Tower, range: number, minRange: number): Enemy | null {
    let best: Enemy | null = null, bv = -Infinity, bp = -Infinity;
    const ground = t.type === 'mortar', m = t.aim, lanes = this.map.lanes;
    // (a squared distance well past the range rules an enemy out before the exact Math.hypot: the same picks, far fewer hypot calls)
    const far = range * range * (1 + 1e-9) + 1e-9;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive || (ground && (ENEMIES[e.type].fly || e.type === 'mite'))) continue; // a mortar cannot shell a mite off a tower
      const dx = e.x - t.x, dz = e.z - t.z;
      if (dx * dx + dz * dz > far) continue;
      const d = Math.hypot(dx, dz);
      if (d > range || d < minRange) continue;
      const prog = e.dist - lanes[e.lane].len; // 0 = at the core (a mite counts as standing where its carrier let it go)
      let v: number;
      if (m === 'first') v = prog;
      else if (m === 'strong') v = e.hp + e.shield + prog * 0.01;
      else if (m === 'last') v = -prog;
      else if (m === 'weak') v = prog * 0.01 - e.hp - e.shield;
      else v = m === 'fast' ? paceNow(e) : -paceNow(e);
      // exact ties: the enemy met first (lower id) keeps it, except a boss or the Titan for 'strong' and the one further along for 'fast' / 'slow'
      if (v > bv || (v === bv && (m === 'strong' ? isBig(e) && (best === null || !isBig(best)) : (m === 'fast' || m === 'slow') && prog > bp))) { bv = v; bp = prog; best = e; }
    }
    return best;
  }

  /** Order two enemies by a targeting mode the way pickTarget ranks them (negative: a comes first). */
  private aimCmp(m: TargetMode, a: Enemy, b: Enemy): number {
    const pa = a.dist - this.map.lanes[a.lane].len, pb = b.dist - this.map.lanes[b.lane].len;
    let d: number;
    if (m === 'first') d = pb - pa;
    else if (m === 'last') d = pa - pb;
    else if (m === 'strong') d = (b.hp + b.shield + pb * 0.01) - (a.hp + a.shield + pa * 0.01) || +isBig(b) - +isBig(a);
    else if (m === 'weak') d = (pb * 0.01 - b.hp - b.shield) - (pa * 0.01 - a.hp - a.shield);
    else d = (m === 'fast' ? paceNow(b) - paceNow(a) : paceNow(a) - paceNow(b)) || pb - pa;
    return d || a.id - b.id;
  }
  private shell(t: Tower, tx: number, ty: number, tz: number, dmg: number, T: number, sp = false) {
    this.projs.push({ sp, id: this.nid++, kind: 'shell', owner: -1, hit: [], tier: 0, chain: 0, pierce: 0, x: t.x, y: t.h * 0.8, z: t.z, vx: 0, vy: 0, vz: 0, dmg, target: 0, life: T + 0.1, aoe: TOWERS.mortar.aoe! * (1 + 0.1 * (t.lvl - 1)) * (1 + 0.25 * this.mods.mortarAoe), sx: t.x, sz: t.z, tx, ty, tz, t: 0, T });
    this.events.push({ k: 'shot', t: 'mortar', id: t.id, d: Math.hypot(tx - t.x, tz - t.z), x: t.x, y: t.h * 0.8, z: t.z });
  }
  private barrageShell(t: Tower, range: number) {
    const dmg = this.towerDmg(t) * 2 * this.mods.specPow;
    const list: Enemy[] = [];
    for (const e of this.enemies) if (e.alive && !ENEMIES[e.type].fly && e.type !== 'mite' && Math.hypot(e.x - t.x, e.z - t.z) <= range + e.r) list.push(e);
    const T = 0.85;
    if (list.length) {
      const e = list[(t.aux * 3) % list.length];
      this.map.pos(e.lane, e.dist + paceOf(e) * (e.slowT > 0 ? 1 - e.slowF : 1) * (e.frz > 0 ? 0 : 1) * T, tmp);
    } else {
      let ok = false;
      for (let i = 0; i < 8 && !ok; i++) {
        const l = Math.floor(this.rand() * this.map.lanes.length * 0.999);
        this.map.pos(l, this.rand() * this.map.lanes[l].len, tmp);
        ok = Math.hypot(tmp.x - t.x, tmp.z - t.z) <= range;
      }
      if (!ok) return;
    }
    this.shell(t, tmp.x, tmp.y || 0, tmp.z, dmg, T, true);
  }
  private missile(t: Tower, e: Enemy, dmg: number, i: number, sp = false) {
    const a = t.yaw + (i % 2 ? 1 : -1) * (0.45 + 0.3 * ((i >> 1) % 4)) + (this.rand() - 0.5) * 0.2;
    this.projs.push({
      sp, id: this.nid++, kind: 'missile', owner: -1, hit: [], tier: 0, chain: 0, pierce: 0,
      x: t.x, y: t.h * 0.9, z: t.z, vx: Math.sin(a) * 5, vy: 9 + (i % 3), vz: Math.cos(a) * 5,
      dmg, target: e.id, life: 5, aoe: TOWERS.missile.aoe! * (1 + 0.3 * this.mods.missileAoe), sx: t.x, sz: t.z, tx: e.x, ty: e.y, tz: e.z, t: 0, T: 0,
    });
  }
  private swarmMissile(t: Tower) {
    const list = this.enemies.filter((e) => e.alive);
    if (!list.length) return;
    list.sort((a, b) => (b.dist - this.map.lanes[b.lane].len) - (a.dist - this.map.lanes[a.lane].len));
    this.missile(t, list[t.aux % list.length], this.towerDmg(t) * 1.5 * this.mods.specPow, t.aux, true);
    if (t.aux % 4 === 0) this.events.push({ k: 'shot', t: 'missile', id: t.id, x: t.x, y: t.h * 0.9, z: t.z });
  }

  private fire(t: Tower, e: Enemy, dmg: number, range: number) {
    const c = TOWERS[t.type].color, y = t.h * 0.8;
    const blank = { owner: -1, hit: [], tier: 0, chain: 0, pierce: 0, sp: t.type === 'pulse' && t.spec > 0 }; // Bullet Storm bolts count as a special
    switch (t.type) {
      case 'pulse': {
        const n = 1 + this.mods.twin;
        for (let i = 0; i < n; i++) {
          const o = (i - (n - 1) / 2) * 0.35;
          this.projs.push({ ...blank, id: this.nid++, kind: 'bolt', x: t.x + Math.cos(t.yaw) * o + Math.sin(t.yaw) * 0.8, y, z: t.z - Math.sin(t.yaw) * o + Math.cos(t.yaw) * 0.8, vx: 0, vy: 0, vz: 0, dmg: dmg * (i > 0 ? TWIN_BOLT : 1) * (this.mods.pulseCrit && this.rand() < this.mods.pulseCrit ? PULSE_CRIT : 1), target: e.id, life: 2, aoe: 0, sx: 0, sz: 0, tx: e.x, ty: e.y, tz: e.z, t: 0, T: 0 });
        }
        this.events.push({ k: 'shot', t: 'pulse', id: t.id, x: t.x, y, z: t.z });
        break;
      }
      case 'cryo': {
        const r = TOWERS.cryo.aoe! * (1 + 0.35 * this.mods.cryoAoe);
        for (const o of this.enemies) {
          if (!o.alive || Math.hypot(o.x - e.x, o.z - e.z) > r + o.r) continue;
          const f = Math.min(0.85, 0.4 + 0.07 * (t.lvl - 1) + 0.08 * this.mods.cryoSlow) * (o.type === 'boss' ? 0.5 : 1);
          if (f >= o.slowF || o.slowT <= 0) { o.slowF = f; }
          o.slowT = Math.max(o.slowT, 2.2 + this.mods.cryoSlow);
          this.damage(o, dmg, -1);
        }
        this.events.push({ k: 'cryo', id: t.id, x: t.x, y, z: t.z, tx: e.x, ty: e.y, tz: e.z, r });
        break;
      }
      case 'arc': {
        this.events.push({ k: 'arc', p: [t.x, t.h * 0.95, t.z, e.x, e.y, e.z], c });
        this.damage(e, dmg, -1);
        if (this.mods.arcSlow && e.type !== 'boss') { e.slowT = Math.max(e.slowT, 1); e.slowF = Math.max(e.slowF, 0.2 * this.mods.arcSlow); }
        this.chainFrom(e, 2 + this.mods.arcChain + (t.lvl - 1), dmg * 0.8, -1, c, 0.2 * this.mods.arcSlow);
        this.events.push({ k: 'shot', t: 'arc', id: t.id, x: t.x, y, z: t.z });
        break;
      }
      case 'mortar': {
        const T = 0.9 + Math.hypot(e.x - t.x, e.z - t.z) * 0.03;
        const sp = paceOf(e) * (e.slowT > 0 ? 1 - e.slowF : 1);
        this.map.pos(e.lane, e.dist + sp * T, tmp);
        this.shell(t, tmp.x, tmp.y || 0, tmp.z, dmg, T);
        break;
      }
      case 'rail': {
        let dx = e.x - t.x, dz = e.z - t.z;
        const L = Math.hypot(dx, dz) || 1;
        dx /= L; dz /= L;
        const cap = this.mods.railCap;
        const list: { e: Enemy; u: number }[] = [];
        for (const o of this.enemies) {
          if (!o.alive) continue;
          const ex = o.x - t.x, ez = o.z - t.z, u = ex * dx + ez * dz;
          if (u < 0 || u > range + 2) continue;
          if (Math.abs(ex * dz - ez * dx) < o.r + 0.5) list.push({ e: o, u });
        }
        list.sort((a, b) => a.u - b.u);
        const max = cap ? 999 : 3 + t.lvl;
        const brk = this.mods.railBreak;
        for (let i = 0; i < list.length && i < max; i++) { const o = list[i].e, heavy = o.type === 'brute' || o.type === 'boss'; this.damage(o, dmg * (1 + RAIL_CAP * cap) * (heavy ? 1 + 0.3 * brk : 1), -1, brk > 0, WHEEL_PIERCE); }
        this.events.push({ k: 'rail', x: t.x + dx, y, z: t.z + dz, tx: t.x + dx * (range + 2), ty: 0.8, tz: t.z + dz * (range + 2), c });
        this.events.push({ k: 'shot', t: 'rail', id: t.id, x: t.x, y, z: t.z });
        break;
      }
      case 'missile': {
        // up to three different targets: on 'first' flyers before anything on the ground, then whoever is closest to the core;
        // on any other mode the best three by that mode (the order pickTarget would take them in)
        const list: Enemy[] = [];
        for (const o of this.enemies) if (o.alive && o.type !== 'mite' && Math.hypot(o.x - t.x, o.z - t.z) <= range) list.push(o);
        if (t.aim === 'first') {
          const val = (o: Enemy) => (ENEMIES[o.type].fly ? 1000 : 0) + o.dist - this.map.lanes[o.lane].len;
          list.sort((a, b) => val(b) - val(a));
        } else list.sort((a, b) => this.aimCmp(t.aim, a, b));
        const k = Math.min(3, list.length), n = 3 + this.mods.missilePods;
        for (let i = 0; i < n && k > 0; i++) this.missile(t, list[i % k], dmg, i);
        this.events.push({ k: 'shot', t: 'missile', id: t.id, x: t.x, y: t.h * 0.9, z: t.z });
        break;
      }
    }
  }

  private stepProj(p: Proj, dt: number) {
    p.life -= dt;
    if (p.kind === 'bolt') {
      const e = this.enemies.find((o) => o.id === p.target && o.alive);
      if (e) { p.tx = e.x; p.ty = e.y; p.tz = e.z; }
      const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, L = Math.hypot(dx, dy, dz);
      const s = 34 * dt;
      if (L <= s + (e ? e.r : 0.2)) {
        if (e) { this.sp = !!p.sp; this.damage(e, p.dmg, -1); this.sp = false; this.events.push({ k: 'hit', x: e.x, y: e.y, z: e.z, c: TOWERS.pulse.color }); }
        p.life = 0;
      } else { p.vx = (dx / L) * 34; p.vy = (dy / L) * 34; p.vz = (dz / L) * 34; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
    } else if (p.kind === 'shell') {
      p.t += dt;
      const u = Math.min(1, p.t / p.T);
      const nx = p.sx + (p.tx - p.sx) * u, nz = p.sz + (p.tz - p.sz) * u, ny = 1.6 + 7 * 4 * u * (1 - u) - 1.4 * u + p.ty * u;
      p.vx = (nx - p.x) / dt; p.vy = (ny - p.y) / dt; p.vz = (nz - p.z) / dt;
      p.x = nx; p.y = ny; p.z = nz;
      if (u >= 1) {
        this.sp = !!p.sp;
        this.aoe(p.tx, p.tz, p.aoe, p.dmg, -1, true, p.ty);
        this.sp = false;
        this.events.push({ k: 'boom', x: p.tx, y: p.ty + 0.3, z: p.tz, r: p.aoe, c: TOWERS.mortar.color });
        if (this.mods.napalm) this.zones.push({ id: this.nid++, kind: 'burn', x: p.tx, z: p.tz, r: p.aoe * 0.9, life: 2 + this.mods.napalm, tick: 0.25, dmg: p.dmg * 0.5 * this.mods.napalm, owner: -1, pd: 0, y: p.ty });
        p.life = 0;
      }
    } else if (p.kind === 'missile') {
      p.t += dt;
      let e: Enemy | undefined;
      for (const o of this.enemies) if (o.id === p.target) { if (o.alive) e = o; break; }
      if (!e && p.T < 3) { // the target is gone: pick whatever is nearest to where it was
        p.T++;
        let bd = 10;
        for (const o of this.enemies) { if (!o.alive) continue; const d = Math.hypot(o.x - p.tx, o.z - p.tz); if (d < bd) { bd = d; e = o; } }
        if (e) p.target = e.id;
      }
      if (e) { p.tx = e.x; p.ty = e.y; p.tz = e.z; }
      const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, L = Math.hypot(dx, dy, dz) || 1e-6;
      const sp = Math.min(30, 10 + p.t * 24), k = Math.min(1, dt * (2 + p.t * 9));
      p.vx += ((dx / L) * sp - p.vx) * k; p.vy += ((dy / L) * sp - p.vy) * k; p.vz += ((dz / L) * sp - p.vz) * k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (Math.hypot(p.tx - p.x, p.ty - p.y, p.tz - p.z) <= sp * dt + (e ? e.r : 0.2) + 0.3 || p.life <= 0) {
        const near = Math.hypot(p.tx - p.x, p.tz - p.z) < 3 + (e ? e.r : 0);
        this.sp = !!p.sp;
        if (e && near) this.damage(e, p.dmg, -1);
        if (near) for (const o of this.enemies) if (o.alive && o !== e && Math.hypot(o.x - p.x, o.z - p.z) <= p.aoe + o.r && Math.abs(o.y - p.y) < 3) this.damage(o, p.dmg * 0.5, -1);
        this.sp = false;
        this.events.push({ k: 'boom', x: p.x, y: p.y, z: p.z, r: p.aoe, c: TOWERS.missile.color, s: 1 });
        p.life = 0;
      }
    }
  }

  // ---------- co-op replication ----------
  /** Card modifiers the guest needs for its tower panel, range rings and build ghost: tDmg, tRate, tRange, beacon, then dmg/rate/range per tower type, then the firewall link and thickness stacks. */
  private modsRow(): number[] {
    const m = this.mods, a = [m.tDmg, m.tRate, m.tRange, m.beacon];
    for (const t of TOWER_TYPES) a.push(m.tw[t].dmg, m.tw[t].rate, m.tw[t].range);
    a.push(m.flameLink, m.flameMelt); // the guest rebuilds the walls of fire from these
    return a.map((n) => Math.round(n * 1000) / 1000);
  }
  /**
   * Host state for the co-op guest. `evs` are the events since the last snapshot: one-shot state events (MUST_EVENTS) are
   * always included, 'dmg' is summed per enemy and player, and the newest cosmetic events fill what is left of SNAP_EVENTS.
   * `m` (card modifiers) is only present when they changed, and every 20th snapshot.
   */
  snapshot(evs: Ev[]) {
    const r = (n: number) => Math.round(n * 100) / 100;
    const row = this.modsRow(), sig = row.join(',');
    const sendMods = sig !== this.modsSig || this.snapN % 20 === 0;
    this.modsSig = sig; this.snapN++;
    return {
      a: [r(this.time), this.wave, this.lives, Math.floor(this.gold), this.level, Math.floor(this.xp), this.xpNext, this.waveActive ? 1 : 0, r(this.queue.length ? -1 : this.nextWaveIn), this.over ? 1 : 0, this.won ? 1 : 0, this.kills, this.mods.cheap, this.winWave, this.endless ? 1 : 0, this.maxLives, 0, 0, Math.floor(this.mats)],
      ti: [TITAN_PHASES.indexOf(this.titan.phase), r(this.titan.danger), this.titan.wave, r(this.titan.t), this.titan.lane],
      u: [...this.unlocked].map((t) => TOWER_TYPES.indexOf(t)),
      e: this.enemies.map((e) => [e.id, ENEMY_TYPES.indexOf(e.type), r(e.x), r(e.z), r(e.yaw), Math.ceil(e.hp), Math.ceil(e.maxHp), Math.ceil(e.shield), e.slowT > 0 ? 1 : 0, r(e.gy), (e.burnT > 0 ? 1 : 0) | (e.frz > 0 ? 2 : 0) | (e.vulnT > 0 ? 4 : 0) | (e.latched ? 32 : 0), r(e.breach), r(e.spin), e.prey]),
      t: this.towers.map((t) => [t.id, TOWER_TYPES.indexOf(t.type), t.cx, t.cz, t.lvl, r(t.yaw), r(t.buff), t.spent, r(t.charge), r(t.down), r(t.spec), r(t.heat), r(t.jam), r(t.stun), t.dry ? 1 : 0, TARGET_MODES.indexOf(t.aim)]),
      p: this.projs.map((p) => [p.id, PROJ_KINDS.indexOf(p.kind), r(p.x), r(p.y), r(p.z), r(p.vx), r(p.vy), r(p.vz), p.tier]),
      z: this.zones.map((z) => [z.id, ZONE_KINDS.indexOf(z.kind), r(z.x), r(z.z), r(z.r), r(z.life), r(z.y)]),
      pl: this.players.map((p) => [p.pending[0] || [], p.pending.length]),
      w: [this.preview.wave, this.preview.lanes.map((l) => l.map((o) => [ENEMY_TYPES.indexOf(o.type), o.n]))],
      m: sendMods ? row : undefined,
      ev: packEvents(evs).map((e) => { const o: Ev = { k: e.k }; for (const key in e) { const v = e[key]; o[key] = typeof v === 'number' ? r(v) : Array.isArray(v) ? v.map((n: unknown) => (typeof n === 'number' ? r(n) : n)) : v; } return o; }),
    };
  }
  /** Apply a host snapshot on a co-op client. Input is validated defensively. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applySnapshot(s: any) {
    const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    if (!s || !Array.isArray(s.a) || !Array.isArray(s.e) || !Array.isArray(s.t) || !Array.isArray(s.p) || !Array.isArray(s.z) || !Array.isArray(s.pl)) return;
    const a = s.a;
    this.time = num(a[0]); this.wave = clamp(num(a[1]) | 0, 0, 100000); this.lives = num(a[2]) | 0; this.gold = num(a[3]); this.level = clamp(num(a[4]) | 0, 1, 100000);
    this.xp = num(a[5]); this.xpNext = num(a[6], 1) || 1; this.waveActive = !!a[7]; this.nextWaveIn = num(a[8]);
    this.over = !!a[9]; this.won = !!a[10]; this.kills = num(a[11]) | 0; this.mods.cheap = Math.max(0.3, Math.min(1, num(a[12], 1)));
    if (a.length > 13) { this.winWave = clamp(num(a[13], this.winWave) | 0, 1, 1000); this.endless = !!a[14]; }
    if (a.length > 15) this.maxLives = clamp(num(a[15], this.maxLives) | 0, 1, 1000);
    if (a.length > 18) this.mats = Math.max(0, num(a[18]));
    if (Array.isArray(s.ti)) {
      const T = this.titan, ph = TITAN_PHASES[num(s.ti[0], -1) | 0];
      if (ph) T.phase = ph;
      T.danger = clamp(num(s.ti[1]), 0, 1); T.wave = clamp(num(s.ti[2]) | 0, 0, 100000); T.t = clamp(num(s.ti[3]), 0, 1e6);
      T.lane = clamp(num(s.ti[4]) | 0, 0, this.map.lanes.length - 1);
    }
    if (Array.isArray(s.m) && s.m.length >= 4 + 3 * TOWER_TYPES.length) {
      const m = this.mods, mv = (i: number) => clamp(num(s.m[i], 1), 0.1, 100);
      m.tDmg = mv(0); m.tRate = mv(1); m.tRange = mv(2); m.beacon = clamp(num(s.m[3]), 0, 10);
      TOWER_TYPES.forEach((t, i) => { const w = m.tw[t]; w.dmg = mv(4 + i * 3); w.rate = mv(5 + i * 3); w.range = mv(6 + i * 3); });
      const k = 4 + 3 * TOWER_TYPES.length;
      if (s.m.length >= k + 2) { m.flameLink = clamp(num(s.m[k]) | 0, 0, 4); m.flameMelt = clamp(num(s.m[k + 1]) | 0, 0, 4); }
    }
    if (Array.isArray(s.u)) { this.unlocked = new Set(s.u.slice(0, 64).map((i: unknown) => TOWER_TYPES[num(i, -1) | 0]).filter(Boolean)); }
    const em = new Map(this.enemies.map((e) => [e.id, e]));
    this.enemies = [];
    const seen = new Set<number>();
    for (const v of s.e.slice(0, 600)) {
      if (!Array.isArray(v)) continue;
      const type = ENEMY_TYPES[num(v[1], -1) | 0];
      if (!type || seen.has(num(v[0]))) continue; // unknown type or duplicate id
      seen.add(num(v[0]));
      const d = ENEMIES[type];
      let e = em.get(v[0]);
      if (!e || e.type !== type) { e = newEnemy(num(v[0]), type); e.maxShield = d.shield ? 1 : 0; }
      e.x = clamp(num(v[2]), -200, 200); e.z = clamp(num(v[3]), -200, 200); e.yaw = num(v[4]); e.hp = num(v[5]); e.maxHp = num(v[6], 1) || 1; e.shield = num(v[7]); e.slowT = v[8] ? 1 : 0;
      e.gy = clamp(num(v[9]), 0, 20); e.y = e.gy + d.y;
      const fl = num(v[10]) | 0;
      e.burnT = fl & 1 ? 1 : 0; e.frz = fl & 2 ? 1 : 0; e.vulnT = fl & 4 ? 1 : 0;
      e.breach = clamp(num(v[11]), 0, 10);
      e.spin = type === 'wheel' ? clamp(num(v[12], 1), 0, 1) : 0; // a host that does not send it yet: full spin
      e.prey = type === 'mite' ? clamp(num(v[13]) | 0, 0, 1e9) : 0; e.latched = type === 'mite' && !!(fl & 32);
      this.enemies.push(e);
    }
    const tm = new Map(this.towers.map((t) => [t.id, t]));
    this.towers = [];
    this.grid.set(this.map.grid);
    seen.clear();
    for (const v of s.t.slice(0, GW * GH)) {
      if (!Array.isArray(v)) continue;
      const type = TOWER_TYPES[num(v[1], -1) | 0];
      const cx = num(v[2], -1) | 0, cz = num(v[3], -1) | 0;
      if (!type || cx < 0 || cz < 0 || cx >= GW || cz >= GH) continue;
      // one tower per free cell and per id: a row on a road, on scenery or on a cell taken earlier in this snapshot is dropped
      if (this.grid[cz * GW + cx] !== 0 || seen.has(num(v[0]))) continue;
      seen.add(num(v[0]));
      let t = tm.get(v[0]);
      if (!t || t.type !== type || t.cx !== cx || t.cz !== cz) t = newTower(num(v[0]), type, cx, cz, 0);
      t.lvl = Math.max(1, Math.min(3, num(v[4], 1) | 0)); t.yaw = num(v[5]); t.buff = clamp(num(v[6]), 0, 10); t.spent = num(v[7]);
      t.charge = clamp(num(v[8]), 0, 1); t.down = clamp(num(v[9]), 0, 120); t.spec = clamp(num(v[10]), 0, 120); t.heat = clamp(num(v[11]), 0, 1);
      t.jam = clamp(num(v[12]), 0, 60); t.stun = clamp(num(v[13]), 0, 60); t.dry = v[14] === 1;
      const aim = TARGET_MODES[num(v[15], -1) | 0]; // (a host that does not send it yet: the tower keeps what it has)
      if (aim && TARGETABLE[type]) t.aim = aim;
      this.grid[cz * GW + cx] = 2;
      this.towers.push(t);
    }
    this.beacons = 0;
    for (const t of this.towers) if (t.type === 'beacon') this.beacons++;
    this.rebuildWalls(); // from the replicated towers (and their down / spec state), the same way the host builds them
    this.projs = [];
    for (const v of s.p.slice(0, 600)) {
      if (!Array.isArray(v)) continue;
      const kind = PROJ_KINDS[num(v[1], -1) | 0];
      if (!kind) continue;
      this.projs.push({ id: num(v[0]), kind, x: num(v[2]), y: num(v[3]), z: num(v[4]), vx: num(v[5]), vy: num(v[6]), vz: num(v[7]), tier: Math.max(0, Math.min(4, num(v[8]) | 0)), dmg: 0, owner: -1, target: 0, life: 1, pierce: 0, hit: [], aoe: 0, chain: 0, sx: 0, sz: 0, tx: 0, ty: 0, tz: 0, t: 0, T: 0 });
    }
    this.zones = [];
    for (const v of s.z.slice(0, 100)) {
      if (!Array.isArray(v)) continue;
      const kind = ZONE_KINDS[num(v[1], -1) | 0];
      if (kind) this.zones.push({ id: num(v[0]), kind, x: num(v[2]), z: num(v[3]), r: clamp(num(v[4]), 0, 30), life: num(v[5]), tick: 0, dmg: 0, owner: -1, pd: 0, y: clamp(num(v[6]), 0, 20) });
    }
    for (let i = 0; i < this.players.length && i < s.pl.length; i++) {
      const v = s.pl[i], p = this.players[i];
      if (!Array.isArray(v)) continue;
      const offer = Array.isArray(v[0]) ? v[0].slice(0, 8).filter((id: unknown) => typeof id === 'string' && Object.hasOwn(CARD_BY_ID, id as string)).slice(0, 3) : [];
      const n = Math.max(0, Math.min(50, num(v[1]) | 0));
      p.pending = offer.length && n ? [offer, ...Array(n - 1).fill(offer)] : [];
    }
    if (Array.isArray(s.w)) {
      const rows: unknown = s.w[1];
      const lanes: WavePreview['lanes'] = this.map.lanes.map((_, li) => {
        const row: unknown = Array.isArray(rows) ? rows[li] : null;
        const out: { type: EnemyType; n: number }[] = [];
        if (Array.isArray(row)) for (const v of row.slice(0, ENEMY_TYPES.length)) {
          if (!Array.isArray(v)) continue;
          const type = ENEMY_TYPES[num(v[0], -1) | 0];
          if (type && !out.some((o) => o.type === type)) out.push({ type, n: clamp(num(v[1]) | 0, 0, 999) });
        }
        return out;
      });
      this.preview = { wave: clamp(num(s.w[0]) | 0, 0, 100000), lanes };
    }
    if (Array.isArray(s.ev)) for (const e of s.ev.slice(0, SNAP_EVENTS_MAX)) { const c = cleanEv(e); if (c) this.events.push(c); }
  }
}

/** Choose the events of one snapshot: all one-shot state events, 'dmg' summed per enemy and player, then the newest cosmetic ones. */
function packEvents(evs: Ev[]): Ev[] {
  const out: Ev[] = [], agg = new Map<string, Ev>();
  let must = 0;
  for (const e of evs) {
    if (e.k === 'dmg' && e.id) {
      const key = e.id + ':' + e.p, a = agg.get(key);
      if (a) { a.n += e.n; a.x = e.x; a.y = e.y; a.z = e.z; continue; }
      const c = { ...e };
      agg.set(key, c); out.push(c);
    } else { out.push(e); if (MUST_EVENTS.has(e.k)) must++; }
  }
  if (out.length <= SNAP_EVENTS) return out;
  let skipMust = Math.max(0, must - SNAP_EVENTS_MAX), skipRest = out.length - must - Math.max(0, SNAP_EVENTS - Math.min(must, SNAP_EVENTS_MAX));
  // drop from the oldest end: cosmetic events first, state events only beyond the hard cap
  return out.filter((e) => (MUST_EVENTS.has(e.k) ? skipMust-- <= 0 : skipRest-- <= 0));
}

/** Copy an event received from a peer, keeping only plain bounded values (numbers, short strings, short number arrays). */
function cleanEv(e: unknown): Ev | null {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const src = e as Record<string, unknown>;
  if (typeof src.k !== 'string' || src.k.length > 16) return null;
  const o: Ev = { k: src.k };
  let n = 0;
  for (const key of Object.keys(src)) {
    if (key === 'k' || key === '__proto__' || key === 'constructor' || key === 'prototype' || key.length > 8 || ++n > 16) continue;
    const v = src[key];
    if (typeof v === 'number') { if (Number.isFinite(v)) o[key] = v; }
    else if (typeof v === 'string') { if (v.length <= 24) o[key] = v; }
    else if (Array.isArray(v) && v.length <= 96 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) o[key] = v.slice();
  }
  return o;
}

export { CELL };
