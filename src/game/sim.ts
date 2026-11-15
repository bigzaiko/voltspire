// VOLTSPIRE game simulation (no rendering, no DOM). Runs in the browser and in Node.
import {
  CELL, GW, GH, MAX_ENERGY, WIN_WAVE, cellX, cellZ,
  TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, ENEMY_SCALE, CARDS, CARD_BY_ID, BOW_TIERS, bowTier,
  LVL_DMG, LVL_RANGE, LVL_RATE, upgradeCost, waveHpMul, waveBudget, baseMods, baseHero, TUNE,
  TWIN_BOLT, PULSE_CRIT, RAIL_CAP, LANCE_FOCUS, BREACH_TIME, BREACH_TIME_BOSS, BREACH_SHARE, coopScale,
  FIRST_WAVE_IN, NEXT_WAVE_IN, DRAW_TIME, MIN_DRAW, NOCK_TIME, FULL_DRAW_MUL, HERO_DUR, LINK_RANGE, WALL_HALF, FIRE_RING, SING_COLOR,
} from './data.ts';
import type { TowerType, EnemyType, Mods, HeroStats, Card } from './data.ts';
import { GameMap, DEFAULT_MAP, diffById } from './map.ts';
import type { MapDef, Difficulty, PathOut } from './map.ts';
import { hexDist } from './hex.ts';
export { DRAW_TIME, MIN_DRAW, NOCK_TIME, HERO_DUR, LINK_RANGE, WALL_HALF, FIRE_RING, SING_COLOR, BREACH_TIME, BREACH_TIME_BOSS };
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
  /** Colossus plating: seconds left cracked open (towers deal full damage while it is > 0, see TUNE.plate) */
  crackT: number;
}
export interface Tower {
  id: number; type: TowerType; cx: number; cz: number; x: number; z: number;
  lvl: number; cd: number; yaw: number; buff: number; spent: number; h: number;
  /** special: charge 0..1, seconds left of the active special, seconds left offline */
  charge: number; spec: number; down: number;
  /** lance heat 0..1 and its current target id; aux = shells/missiles left in a special burst; fxT = internal timer */
  heat: number; tgt: number; aux: number; fxT: number;
}
export type ProjKind = 'bolt' | 'shell' | 'arrow' | 'missile';
const PROJ_KINDS: ProjKind[] = ['bolt', 'shell', 'arrow', 'missile'];
export interface Proj {
  id: number; kind: ProjKind; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  dmg: number; owner: number; target: number; life: number; pierce: number; hit: number[];
  tier: number; aoe: number; chain: number; sx: number; sz: number; tx: number; ty: number; tz: number; t: number; T: number;
}
export type ZoneKind = 'burn' | 'rain' | 'sing';
const ZONE_KINDS: ZoneKind[] = ['burn', 'rain', 'sing'];
export interface Zone {
  id: number; kind: ZoneKind; x: number; z: number; r: number; life: number; tick: number; dmg: number; owner: number; pd: number;
  /** deck height under the zone (roads can be raised). Burning ground does not reach through a bridge deck. */
  y: number;
}
/** A wall of fire between two linked Firewall Pylons (a, b = tower ids). `on`: both pylons are online. `hot`: an Inferno is running on it. */
export interface Wall { a: number; b: number; ax: number; az: number; bx: number; bz: number; on: boolean; hot: boolean }
export interface Player {
  energy: number; heroActive: boolean; heroTower: number; yaw: number; pitch: number;
  heroTime: number; heroDur: number; stats: HeroStats; pending: string[][];
  fireCd: number; cds: number[]; stacks: Record<string, number>; kills: number;
  /** The bow: `drawing` mirrors the fire button, `draw` is the tension 0..1 (see heroAim). */
  draw: number; drawing: boolean;
}
/** What the next startWave() will release, per lane (index = lane index). */
export interface WavePreview { wave: number; lanes: { type: EnemyType; n: number }[][] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ev = { k: string; [key: string]: any };

/** World scale: combat towers are about 3 to 4.5 units tall, Uplink Spires ~7.5; Kestrel is ~0.9 and stands on top of a Spire. */
export const TOWER_SCALE = 1.15;
export const TOWER_H: Record<TowerType, number> = { pulse: 2.76, cryo: 2.78, arc: 3.7, mortar: 2.4, rail: 3.23, beacon: 3.92, flame: 2.6, lance: 3.6, missile: 3.0, gravity: 3.3, spire: 7.475 };
/** @deprecated Kestrel now stands directly on a Spire (see standY); kept so older view code compiles. */
export const DECK = 0.55;
export const HERO_SCALE = 0.5;
export const SKILL_CD = [4, 11, 18]; // rail shot, arrow rain, singularity
/** Seconds from the key press to the visible release of each skill (the view winds the pose up first; the sim applies the effect at once). */
export const SKILL_CAST = [0.1, 0.26, 0.18];
/** Seconds a skill occupies the bow: no arrows can be loosed until its pose has let go of the string. */
export const SKILL_LOCK = [0.62, 0.86, 0.62];
/** Radius of a tower's power node (see nodePos). */
export const NODE_R = 0.6;
/** Extra radius an arrow gets against an enemy body. There is no other aim assistance. */
export const ARROW_PAD = 0.3;
/** Speed of an arrow loosed at full draw. */
export const ARROW_SPEED = 85;
/** Damage of an arrow loosed at draw d (0..1), as a share of a full draw. Clearly worse than proportional: half a draw is worth about a third. */
export const drawPower = (d: number) => Math.pow(Math.max(0, Math.min(1, d)), 1.5);
/** Speed of an arrow loosed at draw d. */
export const arrowSpeed = (d: number) => ARROW_SPEED * (0.55 + 0.45 * Math.max(0, Math.min(1, d)));
/** From this draw on an arrow counts as fully drawn and pierces one more target. */
export const FULL_DRAW = 0.9;
/** Radius of the jump target above an Uplink Spire (see spireTarget). */
export const SPIRE_R = 0.75;
/** Blasts and burning ground only reach enemies whose road is within this height of the blast (a bridge deck shields what is under or over it). */
export const DECK_GAP = 1.2;
/** Snapshot event budget: one-shot state events are always sent, cosmetic ones fill what is left of SNAP_EVENTS. */
export const SNAP_EVENTS = 90;
export const SNAP_EVENTS_MAX = 120;
/** Events a co-op guest must never miss (everything else is cosmetic and may be dropped under load). */
export const MUST_EVENTS: ReadonlySet<string> = new Set(['heroOn', 'heroOff', 'tele', 'special', 'down', 'up', 'wave', 'boss', 'clear', 'levelup', 'card', 'win', 'lose', 'leak', 'build', 'sell', 'incoming']);

interface P3 { x: number; y: number; z: number }
/** Height Kestrel's feet are at when she stands on this tower. */
export function standY(t: Tower): number { return t.h; }
/** The power node the player shoots to fire a tower's special. */
export function nodePos<T extends P3>(t: Tower, out: T): T { out.x = t.x; out.y = t.h + 0.55; out.z = t.z; return out; }
/** The jump target above an Uplink Spire: an arrow or a Rail Shot from another Spire that passes through it carries Kestrel over. */
export function spireTarget<T extends P3>(t: Tower, out: T): T { out.x = t.x; out.y = t.h + 1.7; out.z = t.z; return out; }
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
    const on = p.a.down <= 0 && p.b.down <= 0;
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
/** World position of an enemy's i-th weak point, or null if it has none. */
export function weakPos<T extends P3>(e: Enemy, i: number, out: T): T | null {
  const list = ENEMIES[e.type].weak, w = list && list[i];
  if (!w) return null;
  const s = ENEMY_SCALE[e.type], sn = Math.sin(e.yaw), cs = Math.cos(e.yaw);
  out.x = e.x + (w.x * cs + w.z * sn) * s;
  out.z = e.z + (-w.x * sn + w.z * cs) * s;
  out.y = e.gy + w.y * s;
  return out;
}
/** Distance along a unit ray to where it enters a sphere (0 if it starts inside), or -1 if it misses. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number) {
  const mx = cx - ox, my = cy - oy, mz = cz - oz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0;
  const b = mx * dx + my * dy + mz * dz;
  if (b <= 0) return -1;
  const disc = b * b - c;
  return disc < 0 ? -1 : b - Math.sqrt(disc);
}

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
export interface SimOpts { mode: Mode; players: number; seed: number; pauseOnCards: boolean; map: MapDef; diff: string; survival: boolean }

const xpNeed = (lvl: number) => Math.round(12 + lvl * 7 + lvl * lvl * 0.55);
const GAPS: Record<EnemyType, number> = { grunt: 0.55, runner: 0.33, drone: 0.5, shield: 0.95, brute: 1.3, boss: 3 };
const tmp: PathOut = { x: 0, z: 0, dx: 0, dz: 0, y: 0 };
const W3 = { x: 0, y: 0, z: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Most shots one tower can fire in a single step (60 steps a second: up to 240 shots a second). */
const MAX_SHOTS = 4;
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
  return { id, type, cx, cz, x: cellX(cx, cz), z: cellZ(cz), lvl: 1, cd: 0.3, yaw: 0, buff: 0, spent, h: TOWER_H[type], charge: 0, spec: 0, down: 0, heat: 0, tgt: 0, aux: 0, fxT: 0 };
}

export class Sim {
  opts: SimOpts;
  time = 0; wave = 0; lives = 20; maxLives = 20; gold = 220; level = 1; xp = 0; xpNext = xpNeed(1);
  mods: Mods = baseMods();
  unlocked = new Set<TowerType>(['pulse', 'cryo', 'spire']);
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
  kills = 0; leaked = 0; sent = 0; beacons = 0; spires = 0;
  /** The campaign's final wave (from the difficulty). Survival and Versus ignore it. */
  winWave = WIN_WAVE;
  /** Enemy health multiplier from the map's shape: short roads give the towers less time, so the machines are weaker there and tougher on long roads. Keeps any map (pre-made, edited or generated) at a similar difficulty. */
  mapMul = 1;
  /** The wave the next startWave() releases, per lane. */
  preview: WavePreview = { wave: 0, lanes: [] };
  private next: { wave: number; items: { t: number; type: EnemyType; lane: number }[] } | null = null;
  private nid = 1;
  private snapN = 0; private modsSig = '';
  private wallTw: [Tower, Tower][] = [];
  private nospecAt = new Map<number, number>();
  private rand: () => number;

  constructor(opts: Partial<SimOpts> = {}) {
    this.opts = { mode: 'solo', players: 1, seed: (Math.random() * 1e9) | 0, pauseOnCards: true, map: DEFAULT_MAP, diff: 'normal', survival: false, ...opts };
    if (this.opts.seed === undefined) this.opts.seed = (Math.random() * 1e9) | 0;
    this.rand = mulberry(this.opts.seed);
    this.map = new GameMap(this.opts.map || DEFAULT_MAP);
    this.diff = diffById(this.opts.diff);
    this.grid = new Uint8Array(this.map.grid);
    this.gold = this.map.def.gold;
    this.lives = this.maxLives = Math.max(1, Math.round(this.map.def.lives * this.diff.lives));
    this.endless = this.opts.survival;
    this.winWave = this.diff.waves;
    this.mapMul = mapEase(this.map);
    for (const t of this.map.def.towers) {
      if (!Object.hasOwn(TOWERS, t.t) || !(t.cx >= 0 && t.cz >= 0 && t.cx < GW && t.cz < GH) || this.grid[t.cz * GW + t.cx] !== 0) continue;
      this.grid[t.cz * GW + t.cx] = 2;
      this.unlocked.add(t.t);
      this.towers.push(newTower(this.nid++, t.t, t.cx, t.cz, 0));
    }
    this.ensureSpire();
    this.recomputeBuffs();
    for (let i = 0; i < this.opts.players; i++) {
      this.players.push({
        energy: 0, heroActive: false, heroTower: 0, yaw: 0, pitch: -0.25, heroTime: 0, heroDur: HERO_DUR,
        stats: baseHero(), pending: [], fireCd: 0, cds: [0, 0, 0], stacks: {}, kills: 0, draw: 0, drawing: false,
      });
    }
    this.planWave(1);
  }

  get paused() { return this.opts.pauseOnCards && this.players.some((p) => p.pending.length > 0); }
  get tier() { return bowTier(this.wave); }
  /** True while the run ends at winWave (not Versus, not Survival / endless). */
  get campaign() { return this.opts.mode !== 'versus' && !this.endless; }
  cost(t: TowerType) { return Math.round(TOWERS[t].cost * this.mods.cheap); }
  upCost(t: Tower) { return Math.round(upgradeCost(t.type, t.lvl) * this.mods.cheap); }
  sellValue(t: Tower) { return Math.round(t.spent * 0.6); }
  towerById(id: number) { return this.towers.find((t) => t.id === id); }
  /** A tower's reach. For a Firewall Pylon this is how far away it links to another pylon (whole tiles, see linkRange). */
  range(t: Tower) {
    if (t.type === 'flame') return linkRange(t, this.mods.flameLink) * CELL;
    return TOWERS[t.type].range * LVL_RANGE[t.lvl - 1] * this.mods.tw[t.type].range * (t.type === 'beacon' ? 1 : this.mods.tRange);
  }
  /** Half the thickness of a wall of fire (wider while an Inferno runs on it, and with Slag Curtain). */
  wallHalf(w: Wall) { return WALL_HALF * (1 + 0.3 * this.mods.flameMelt) * (w.hot ? INFERNO_WIDE : 1); }
  towerDmg(t: Tower) { return TOWERS[t.type].dmg * LVL_DMG[t.lvl - 1] * this.mods.tDmg * this.mods.tw[t.type].dmg * (1 + t.buff); }
  towerRate(t: Tower) { return TOWERS[t.type].rate * LVL_RATE[t.lvl - 1] * this.mods.tRate * this.mods.tw[t.type].rate * (1 + t.buff * 0.6); }
  /** Arrow damage. An upgraded Spire amplifies the arrows fired from it (+15% per level). */
  arrowDmg(p: Player) {
    const t = p.heroActive ? this.towerById(p.heroTower) : undefined;
    return TUNE.arrow * BOW_TIERS[this.tier].mul * p.stats.dmg * (1 + 0.15 * ((t ? t.lvl : 1) - 1));
  }
  /** True if the tower's special can be fired right now. */
  specialReady(t: Tower) { return !!TOWERS[t.type].special && t.charge >= 1 && t.down <= 0 && t.spec <= 0; }

  // ---------- building ----------
  canBuild(type: TowerType, cx: number, cz: number) {
    return cx >= 0 && cz >= 0 && cx < GW && cz < GH && this.grid[cz * GW + cx] === 0 &&
      this.unlocked.has(type) && this.gold >= this.cost(type);
  }
  build(type: TowerType, cx: number, cz: number) {
    if (this.over || !Object.hasOwn(TOWERS, type) || !this.canBuild(type, cx, cz)) return null;
    const c = this.cost(type);
    this.gold -= c;
    this.grid[cz * GW + cx] = 2;
    const t = newTower(this.nid++, type, cx, cz, c);
    this.towers.push(t);
    this.recomputeBuffs();
    this.events.push({ k: 'build', x: t.x, z: t.z, c: TOWERS[type].color });
    return t;
  }
  upgrade(id: number) {
    const t = this.towerById(id);
    if (!t || t.lvl >= 3 || this.over) return false;
    const c = this.upCost(t);
    if (this.gold < c) return false;
    this.gold -= c; t.spent += c; t.lvl++;
    this.recomputeBuffs();
    this.events.push({ k: 'build', x: t.x, z: t.z, c: TOWERS[t.type].color });
    return true;
  }
  /** Why a tower cannot be sold right now ('' if it can). */
  sellBlock(t: Tower): '' | 'hero' | 'last' {
    if (this.players.some((p) => p.heroActive && p.heroTower === t.id)) return 'hero';
    if (t.type === 'spire' && this.spires <= 1) return 'last';
    return '';
  }
  sell(id: number) {
    const i = this.towers.findIndex((t) => t.id === id);
    if (i < 0 || this.over) return false;
    const t = this.towers[i];
    if (this.sellBlock(t)) return false;
    this.gold += this.sellValue(t);
    this.grid[t.cz * GW + t.cx] = 0;
    this.towers.splice(i, 1);
    this.recomputeBuffs();
    this.events.push({ k: 'sell', x: t.x, z: t.z });
    return true;
  }
  /** A beacon's current boost (0 while it reboots; tripled during Surge). */
  beaconBoost(b: Tower) { return b.down > 0 ? 0 : (0.25 + 0.1 * (b.lvl - 1) + this.mods.beacon) * (b.spec > 0 ? 3 : 1); }
  recomputeBuffs() {
    this.beacons = 0; this.spires = 0;
    for (const t of this.towers) { if (t.type === 'beacon') this.beacons++; else if (t.type === 'spire') this.spires++; }
    for (const t of this.towers) {
      t.buff = 0;
      if (t.type === 'beacon' || t.type === 'spire') continue;
      for (const b of this.towers) {
        if (b.type !== 'beacon' || b.down > 0) continue;
        if (Math.hypot(b.x - t.x, b.z - t.z) <= this.range(b)) t.buff = Math.max(t.buff, this.beaconBoost(b));
      }
    }
    this.rebuildWalls();
  }
  private rebuildWalls() {
    this.walls = computeWalls(this.towers, this.mods.flameLink);
    this.wallTw = this.walls.map((w) => [this.towerById(w.a)!, this.towerById(w.b)!]);
  }
  /** Every map has at least one Uplink Spire: if the map defines none, one is placed for free on a good cell. */
  private ensureSpire() {
    if (this.towers.some((t) => t.type === 'spire')) return;
    const core = this.map.def.core, L = this.map.lanes.length;
    let best = -1, bs = -Infinity, any = -1;
    for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
      if (this.grid[cz * GW + cx] !== 0) continue;
      if (any < 0) any = cz * GW + cx;
      if (Math.max(Math.abs(cx - core[0]), Math.abs(cz - core[1])) <= 2) continue; // not adjacent to the core
      const x = cellX(cx, cz), z = cellZ(cz);
      let s = 0, near = 1e9;
      for (let l = 0; l < L; l++) {
        const len = this.map.lanes[l].len;
        let ls = 0;
        for (let d = 0; d < len; d += 2) {
          this.map.pos(l, d, tmp);
          const dd = Math.hypot(tmp.x - x, tmp.z - z);
          if (dd < near) near = dd;
          if (dd <= 16) ls += (0.6 + 0.8 * (d / len)) * (dd < 5 ? 0.7 : 1);
        }
        s += ls / L;
      }
      if (near < 3) s *= 0.8; // leave the tiles right beside the road for turrets
      if (cx === 0 || cz === 0 || cx === GW - 1 || cz === GH - 1) s *= 0.9;
      if (s > bs) { bs = s; best = cz * GW + cx; }
    }
    if (best < 0) best = any;
    if (best < 0) return;
    this.grid[best] = 2;
    this.towers.push(newTower(this.nid++, 'spire', best % GW, Math.floor(best / GW), 0));
  }
  /** The Spire nearest to a tower (or to the middle of the map when the id is unknown). */
  nearestSpire(towerId: number): Tower | undefined {
    const t = this.towerById(towerId);
    if (t && t.type === 'spire') return t;
    const x = t ? t.x : 0, z = t ? t.z : 0;
    let best: Tower | undefined, bd = Infinity;
    for (const s of this.towers) {
      if (s.type !== 'spire') continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---------- waves ----------
  /** Generate wave w one wave ahead, so the HUD can show what is coming and where. */
  private planWave(w: number) {
    const r = this.rand;
    const items: { t: number; type: EnemyType; lane: number }[] = [];
    let budget = waveBudget(w) * this.diff.count * (this.opts.mode === 'coop' ? coopScale(TUNE.coopCount, w) : 1);
    const L = this.map.lanes.length, lane = () => Math.floor(r() * L * 0.999);
    let t = 0.5;
    const gapMul = Math.max(0.35, 0.8 - w * 0.02);
    if (w % 5 === 0) {
      const n = 1 + Math.floor(w / 15);
      for (let i = 0; i < n; i++) items.push({ t: t + 3 + i * 14, type: 'boss', lane: lane() });
      budget *= 0.55;
    }
    const avail = ENEMY_TYPES.filter((e) => e !== 'boss' && ENEMIES[e].from <= w);
    while (budget > 0.5 && items.length < 500) {
      // biased toward the newest enemy types, with grunts always in the mix
      const type = avail[avail.length - 1 - Math.floor(r() * r() * avail.length * 0.999)];
      const pick: EnemyType = r() < 0.35 ? 'grunt' : type;
      const def = ENEMIES[pick];
      const n = Math.max(1, Math.min(14, Math.round((3 + r() * 6) / Math.pow(def.cost, 0.7))));
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
    if (this.queue.length || this.over || this.nextWaveIn <= 0.5 || (this.campaign && this.wave >= this.winWave)) return 0;
    return Math.round(Math.min(NEXT_WAVE_IN, this.nextWaveIn) * 2);
  }
  startWave() {
    if (this.queue.length || this.over || this.replica) return;
    if (this.wave >= this.winWave && this.campaign) return; // the final wave must be cleared, not skipped
    this.planAhead();
    if (!this.next) return;
    this.gold += this.callBonus(); // early-call bonus
    this.wave++;
    this.waveActive = true; this.cleared = false; this.nextWaveIn = NEXT_WAVE_IN;
    const w = this.wave, mul = waveHpMul(w);
    for (const q of this.next.items) this.queue.push({ t: this.time + q.t, type: q.type, mul, lane: q.lane });
    if (w % 5 === 0) this.events.push({ k: 'boss' });
    this.next = null;
    this.planAhead();
    this.events.push({ k: 'wave', n: w });
  }
  /** Versus: enemies sent by the rival. */
  injectSquad(type: EnemyType, n: number) {
    if (!Object.hasOwn(ENEMIES, type) || type === 'boss' || this.over) return;
    if (this.queue.length + this.enemies.length > 400) return;
    const mul = waveHpMul(Math.max(1, this.wave));
    for (let i = 0; i < Math.min(n, 20); i++) this.queue.push({ t: this.time + 1 + i * GAPS[type] * 0.7, type, mul, lane: Math.floor(this.rand() * this.map.lanes.length * 0.999) });
    this.queue.sort((a, b) => a.t - b.t);
    this.events.push({ k: 'incoming', type, n });
  }
  private spawn(type: EnemyType, mul: number, lane: number) {
    const d = ENEMIES[type];
    const hp = d.hp * mul * this.diff.hp * this.mapMul * (this.opts.mode === 'coop' ? coopScale(TUNE.coopHp, Math.max(1, this.wave)) : 1) * (type === 'boss' ? TUNE.boss : 1);
    const e: Enemy = {
      id: this.nid++, type, x: 0, z: 0, y: d.y, yaw: 0, dist: 0, lane, off: type === 'boss' ? 0 : (this.rand() - 0.5) * 1.3,
      hp, maxHp: hp, shield: d.shield * mul * this.mapMul, maxShield: d.shield * mul * this.mapMul, shieldCd: 0,
      speed: d.speed * (0.94 + this.rand() * 0.12), slowT: 0, slowF: 0, sing: 0, alive: true, r: d.r, armor: d.armor * (1 + this.wave * 0.04),
      gy: 0, frz: 0, burnT: 0, burnD: 0, burnAcc: 0, vulnT: 0, pull: 0, pullCd: 0, burn2T: 0, burn2D: 0, breach: 0, crackT: 0,
    };
    this.place(e);
    this.enemies.push(e);
  }
  private place(e: Enemy) {
    this.map.pos(e.lane, e.dist, tmp);
    e.x = tmp.x - tmp.dz * e.off; e.z = tmp.z + tmp.dx * e.off;
    e.yaw = Math.atan2(tmp.dx, tmp.dz);
    e.gy = tmp.y || 0;
    e.y = e.gy + ENEMIES[e.type].y;
  }

  // ---------- damage ----------
  /** Returns the damage that got through to the hull. */
  damage(e: Enemy, amt: number, owner: number, raw = false): number {
    if (!e.alive) return 0;
    if ((e.slowT > 0 || e.frz > 0) && this.mods.shatter) amt *= 1 + this.mods.shatter;
    if (e.vulnT > 0) amt *= 1 + this.mods.gravVuln;
    if (e.type === 'boss' && owner < 0) amt *= e.crackT > 0 ? TUNE.cracked : TUNE.plate; // plated: towers are blunted until Kestrel cracks a weak point open
    if (!raw && e.armor) {
      const armor = e.burnT > 0 && this.mods.flameMelt ? e.armor * Math.max(0.2, 1 - 0.4 * this.mods.flameMelt) : e.armor;
      amt = Math.max(amt * 0.35, amt - armor);
    }
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
  /** A weak-point hit cracks a Colossus's plating open for TUNE.crack seconds. */
  private crack(e: Enemy, x: number, y: number, z: number) {
    if (e.type !== 'boss' || !e.alive) return;
    if (e.crackT <= 0) this.events.push({ k: 'crack', id: e.id, x, y, z });
    e.crackT = TUNE.crack;
  }
  private kill(e: Enemy, owner: number) {
    e.alive = false;
    const d = ENEMIES[e.type];
    this.kills++;
    this.gold += d.bounty * TUNE.bounty * this.mods.gold * this.diff.gold;
    this.xp += d.xp * this.mods.xp;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.heroActive) { if (i === owner) { p.heroTime = Math.min(p.heroDur, p.heroTime + 0.12); p.kills++; } }
      else p.energy = Math.min(MAX_ENERGY, p.energy + d.energy * TUNE.energy * p.stats.charge);
    }
    this.events.push({ k: 'die', x: e.x, y: e.y, z: e.z, t: e.type, h: owner >= 0 ? 1 : 0 });
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext; this.level++; this.xpNext = xpNeed(this.level);
      // co-op: one player per level (taking turns) is offered the shared tower / economy cards; the others get hero cards only
      const np = this.players.length;
      for (let i = 0; i < np; i++) { const o = this.rollCards(i, np > 1 && i !== this.level % np); if (o.length) this.players[i].pending.push(o); }
      this.events.push({ k: 'levelup', n: this.level });
    }
  }
  /** Area damage. With `gy` (ground height of the blast) enemies on a road more than DECK_GAP above or below are shielded by the deck. */
  private aoe(x: number, z: number, r: number, dmg: number, owner: number, ground = false, gy?: number) {
    for (const e of this.enemies) {
      if (!e.alive || (ground && ENEMIES[e.type].fly)) continue;
      if (gy !== undefined && Math.abs(e.gy - gy) > DECK_GAP) continue;
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
  private cardOk(pi: number, c: Card) {
    const p = this.players[pi];
    const stack = (c.kind === 'hero' ? p.stacks[c.id] : this.stacks[c.id]) || 0;
    return stack < c.max && (!c.needs || this.unlocked.has(c.needs)) && !(c.kind === 'blueprint' && this.unlocked.has(c.id.slice(3) as TowerType));
  }
  /** Roll an offer of up to three cards. `heroOnly` restricts it to that player's own hero cards (co-op, see kill()); it may then be empty. */
  rollCards(pi: number, heroOnly = false): string[] {
    const pool = CARDS.filter((c) => (!heroOnly || c.kind === 'hero') && this.cardOk(pi, c));
    const out: string[] = [];
    const bps = pool.filter((c) => c.kind === 'blueprint');
    if (bps.length && [2, 3, 5, 7, 9, 11, 13].includes(this.level)) out.push(bps[Math.floor(this.rand() * bps.length)].id);
    const W = [10, 5, 2];
    // dedicated upgrades are only useful once that tower is on the field, so they are offered less often until it is
    const built = new Set(this.towers.map((t) => t.type));
    const wt = (c: Card) => (c.kind === 'blueprint' ? 5 : W[c.rar] * (c.needs && !built.has(c.needs) ? 0.3 : 1));
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
    const st = card.kind === 'hero' ? p.stacks : this.stacks;
    if ((st[card.id] || 0) >= card.max) { this.gold += 100; return; }
    st[card.id] = (st[card.id] || 0) + 1;
    card.apply({
      mods: this.mods, hero: p.stats, unlocked: this.unlocked,
      addGold: (n) => { this.gold += n; }, addLives: (n) => { this.lives = Math.min(30, this.lives + n); },
    });
    this.recomputeBuffs();
    // offers rolled earlier may now contain a card that is maxed or a blueprint that is already unlocked
    const multi = this.players.length > 1;
    this.players.forEach((q, i) => {
      q.pending = q.pending.map((offer2) => (offer2.some((c) => !this.cardOk(i, CARD_BY_ID[c])) ? this.rollCards(i, multi && offer2.every((c) => CARD_BY_ID[c].kind === 'hero')) : offer2)).filter((o) => o.length > 0);
    });
    this.events.push({ k: 'card', id: card.id, p: pi });
  }

  // ---------- hero ----------
  /** Uplink. Kestrel can only stand on an Uplink Spire: any other tower id resolves to the Spire nearest to it. */
  activateHero(pi: number, towerId: number) {
    const p = this.players[pi];
    if (!p || p.heroActive || p.energy < MAX_ENERGY || this.over) return false;
    const t = this.nearestSpire(towerId);
    if (!t) return false;
    p.heroActive = true; p.heroTower = t.id; p.energy = 0;
    p.heroDur = HERO_DUR + p.stats.dur + p.stats.relay * Math.min(3, this.spires); p.heroTime = p.heroDur; p.fireCd = 0.4;
    p.draw = 0; p.drawing = false;
    this.events.push({ k: 'heroOn', p: pi, x: t.x, y: standY(t), z: t.z });
    return true;
  }
  exitHero(pi: number) {
    const p = this.players[pi];
    if (!p || !p.heroActive) return;
    p.heroActive = false; p.draw = 0; p.drawing = false;
    p.energy = Math.max(0, Math.min(80, (p.heroTime / p.heroDur) * 80));
    p.heroTime = 0;
    const t = this.towerById(p.heroTower);
    this.events.push({ k: 'heroOff', p: pi, x: t ? t.x : 0, y: t ? standY(t) : 0, z: t ? t.z : 0 });
  }
  heroOrigin(pi: number) {
    const p = this.players[pi], t = p ? this.towerById(p.heroTower) : undefined;
    return t ? { x: t.x, y: standY(t) + 0.62, z: t.z } : null;
  }
  /** Jump to another Uplink Spire (only Spires are accepted). */
  heroTeleport(pi: number, towerId: number) {
    const p = this.players[pi], t = this.towerById(towerId);
    if (!p || !p.heroActive || !t || t.type !== 'spire' || t.id === p.heroTower || this.over) return false;
    const o = this.towerById(p.heroTower);
    p.heroTower = t.id;
    this.events.push({ k: 'tele', p: pi, x: t.x, y: standY(t), z: t.z, fx: o ? o.x : t.x, fy: o ? standY(o) : standY(t), fz: o ? o.z : t.z });
    return true;
  }
  /**
   * The bow. Called every frame during the Uplink with whether the fire button is held and the current aim point.
   * While it is held the draw rises from 0 to 1 over DRAW_TIME seconds (in step(); Quick Draw shortens it) and may be held at full.
   * Letting go looses the arrow at that point if the draw reached MIN_DRAW; a shorter pull is cancelled. Nothing fires on its own.
   */
  heroAim(pi: number, drawing: boolean, tx: number, ty: number, tz: number) {
    const p = this.players[pi];
    if (!p) return;
    if (!p.heroActive || this.over) { p.drawing = false; p.draw = 0; return; }
    const held = drawing === true;
    if (!held && p.drawing) {
      const d = p.draw;
      p.draw = 0;
      if (d >= MIN_DRAW && p.fireCd <= 0) this.loose(pi, d, tx, ty, tz);
    }
    p.drawing = held;
    if (!held) p.draw = 0;
  }
  /** An instant full-power loose at a world point (tests and scripted shots). The bow then needs its nock and draw time again, so it is never faster than a real full draw. */
  heroFire(pi: number, tx: number, ty: number, tz: number) {
    const p = this.players[pi];
    if (!p || !p.heroActive || p.fireCd > 0 || this.over) return;
    p.draw = 0;
    if (this.loose(pi, 1, tx, ty, tz)) p.fireCd = NOCK_TIME + DRAW_TIME / Math.max(0.2, p.stats.rate);
  }
  /** Loose a volley at a world point with the given draw. No aim assistance: the first arrow flies exactly at the point given. */
  private loose(pi: number, draw: number, tx: number, ty: number, tz: number): boolean {
    const p = this.players[pi];
    if (!p || !p.heroActive || this.over || this.replica) return false;
    const o = this.heroOrigin(pi);
    if (!o || ![tx, ty, tz].every(Number.isFinite)) return false;
    let dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const tier = this.tier, s = p.stats, pw = clamp(draw, 0, 1);
    const n = Math.min(9, s.arrows + (tier >= 2 ? 1 : 0));
    // a full draw is worth FULL_DRAW_MUL of the old stream arrows and pierces one more target; a weak draw is worth much less than its share
    const dmg = this.arrowDmg(p) * FULL_DRAW_MUL * drawPower(pw), SP = arrowSpeed(pw);
    const yaw = Math.atan2(dx, dz), hl = Math.hypot(dx, dz);
    for (let i = 0; i < n; i++) {
      // arrow 0 is dead centre; extra arrows fan out alternately right and left
      const a = yaw + (i % 2 ? (i + 1) / 2 : -i / 2) * 0.055;
      this.projs.push({
        id: this.nid++, kind: 'arrow', x: o.x + dx * 0.8, y: o.y + dy * 0.8, z: o.z + dz * 0.8,
        vx: Math.sin(a) * hl * SP, vy: dy * SP, vz: Math.cos(a) * hl * SP,
        dmg, owner: pi, target: 0, life: 1.6, pierce: s.pierce + (tier >= 1 ? 1 : 0) + (pw >= FULL_DRAW ? 1 : 0), hit: [], tier,
        aoe: s.explode * 1.5 + (tier >= 3 ? 1.6 : 0), chain: s.chain + (tier >= 4 ? 2 : 0), sx: 0, sz: 0, tx: 0, ty: 0, tz: 0, t: 0, T: 0,
      });
    }
    p.fireCd = NOCK_TIME;
    this.events.push({ k: 'arrow', p: pi, x: o.x, y: o.y, z: o.z, pw });
    return true;
  }
  /** Height of the road deck under a point: of the roads passing within 2.5 of it, the one closest to height y (0 when there is none). */
  private deckAt(x: number, y: number, z: number): number {
    let best = 0, bd = Infinity;
    for (const L of this.map.lanes) for (let i = 1; i < L.pts.length; i++) {
      const a = L.pts[i - 1], b = L.pts[i];
      if (segDist(x, z, a[0], a[1], b[0], b[1]) > 2.5) continue;
      const u = clamp(((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1), 0, 1);
      const h = L.ys[i - 1] + (L.ys[i] - L.ys[i - 1]) * u, d = Math.abs(h - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  heroSkill(pi: number, skill: number, tx: number, ty: number, tz: number) {
    const p = this.players[pi];
    if (!p || !p.heroActive || !(skill >= 0 && skill < 3) || p.cds[skill] > 0 || this.over) return;
    const o = this.heroOrigin(pi);
    if (!o || ![tx, ty, tz].every(Number.isFinite)) return;
    const dmg = this.arrowDmg(p), c = BOW_TIERS[this.tier].color;
    p.cds[skill] = SKILL_CD[skill] * p.stats.cdr;
    p.fireCd = Math.max(p.fireCd, SKILL_LOCK[skill]); p.draw = 0; // the skill takes the string: a draw in progress starts over
    if (skill === 0) {
      let dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      dx /= L; dy /= L; dz /= L;
      const R = 70;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const ex = e.x - o.x, ey = e.y - o.y, ez = e.z - o.z;
        const u = ex * dx + ey * dy + ez * dz;
        if (u < 0 || u > R) continue;
        if (Math.hypot(ex - dx * u, ey - dy * u, ez - dz * u) >= e.r + 1.0) continue;
        // the ray pierces, so any weak point it passes through counts
        let mul = 1, wi = -1;
        const wk = ENEMIES[e.type].weak;
        if (wk) for (let i = 0; i < wk.length; i++) {
          weakPos(e, i, W3);
          const wx = W3.x - o.x, wy = W3.y - o.y, wz = W3.z - o.z, wu = wx * dx + wy * dy + wz * dz;
          if (wu >= 0 && wu <= R && Math.hypot(wx - dx * wu, wy - dy * wu, wz - dz * wu) <= wk[i].r * ENEMY_SCALE[e.type] + 0.25 && wk[i].mul > mul) { mul = wk[i].mul; wi = i; }
        }
        if (wi >= 0) {
          weakPos(e, wi, W3);
          const cx = W3.x, cy = W3.y, cz = W3.z;
          const n = this.damage(e, dmg * 8 * mul * p.stats.weak, pi);
          this.events.push({ k: 'crit', x: cx, y: cy, z: cz, n: Math.round(n) });
          this.crack(e, cx, cy, cz);
        } else this.damage(e, dmg * 8, pi);
      }
      // charged power nodes on the ray fire their specials
      for (const t of this.towers) {
        if (!this.specialReady(t)) continue;
        nodePos(t, W3);
        const wx = W3.x - o.x, wy = W3.y - o.y, wz = W3.z - o.z, wu = wx * dx + wy * dy + wz * dz;
        if (wu >= 0 && wu <= R && Math.hypot(wx - dx * wu, wy - dy * wu, wz - dz * wu) <= NODE_R + 0.25) this.triggerSpecial(t.id, pi);
      }
      this.events.push({ k: 'rail', x: o.x, y: o.y, z: o.z, tx: o.x + dx * R, ty: Math.max(0, o.y + dy * R), tz: o.z + dz * R, c, big: 1, p: pi });
      // a ray through the jump target of another Spire carries Kestrel over (the nearest one on the ray)
      let jump: Tower | null = null, ju = R;
      for (const t of this.towers) {
        if (t.type !== 'spire' || t.id === p.heroTower) continue;
        spireTarget(t, W3);
        const wx = W3.x - o.x, wy = W3.y - o.y, wz = W3.z - o.z, wu = wx * dx + wy * dy + wz * dz;
        if (wu >= 0 && wu <= ju && Math.hypot(wx - dx * wu, wy - dy * wu, wz - dz * wu) <= SPIRE_R + 0.25) { ju = wu; jump = t; }
      }
      if (jump) this.heroTeleport(pi, jump.id);
    } else {
      const d = Math.hypot(tx - o.x, tz - o.z);
      if (d > 48) { tx = o.x + ((tx - o.x) / d) * 48; tz = o.z + ((tz - o.z) / d) * 48; }
      const y = this.deckAt(tx, ty, tz); // on a bridge or viaduct the zone sits on the deck that was aimed at
      if (skill === 1) {
        this.zones.push({ id: this.nid++, kind: 'rain', x: tx, z: tz, r: 4.5 * Math.sqrt(p.stats.rain), life: 3.5, tick: 0, dmg: dmg * 0.75 * p.stats.rain, owner: pi, pd: 0, y });
      } else {
        this.zones.push({ id: this.nid++, kind: 'sing', x: tx, z: tz, r: 5.5 * Math.sqrt(p.stats.sing), life: 2.6, tick: 0, dmg: dmg * p.stats.sing, owner: pi, pd: 0, y });
      }
      this.events.push({ k: 'skill', s: skill, p: pi, x: tx, y, z: tz, c });
    }
  }

  // ---------- tower specials ----------
  private anyIn(t: Tower, range: number, ground = false) {
    for (const e of this.enemies) if (e.alive && !(ground && ENEMIES[e.type].fly) && Math.hypot(e.x - t.x, e.z - t.z) <= range + e.r) return true;
    return false;
  }
  /**
   * Fire a tower's special (normally by an arrow through its power node). Needs a full charge and an online tower,
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
          if (u >= 0 && u <= R && Math.abs(ex * dz - ez * dx) < o.r + 0.8) this.damage(o, dmg * 8 * pow * (1 + RAIL_CAP * this.mods.railCap), -1, true);
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
    this.waveActive = this.queue.length > 0 || this.enemies.length > 0;
    if (!this.queue.length) {
      const last = this.campaign && this.wave >= this.winWave;
      if (!this.cleared && !this.enemies.length) {
        this.cleared = true;
        this.nextWaveIn = Math.min(this.nextWaveIn, 5);
        const bonus = TUNE.clear0 + this.wave * TUNE.clear1 + Math.min(60, this.gold * this.mods.interest);
        this.gold += bonus;
        this.events.push({ k: 'clear', n: this.wave, g: Math.round(bonus) });
        if (last) { this.won = true; this.over = true; this.events.push({ k: 'win' }); return; }
      }
      if (!last) { this.nextWaveIn -= dt; if (this.nextWaveIn <= 0) this.startWave(); }
    }

    // zones
    for (const z of this.zones) {
      z.life -= dt; z.tick -= dt;
      if (z.kind === 'sing') {
        for (const e of this.enemies) {
          if (!e.alive || Math.hypot(e.x - z.x, e.z - z.z) > z.r) continue;
          const boss = e.type === 'boss';
          e.sing = 0.2; // held by the singularity (tracked apart from cryo/arc slows)
          if (!boss && e.breach <= 0) {
            const len = this.map.lanes[e.lane].len, pd = Math.min(this.map.nearest(e.lane, z.x, z.z), len - 4);
            // only ever backward: enemies behind the centre are held (e.sing), never hurried along the road
            e.dist = Math.min(len - 0.5, e.dist + Math.max(-1, Math.min(0, pd - e.dist)) * 5 * dt);
            e.off *= 1 - 3 * dt;
          }
        }
      }
      if (z.tick <= 0) {
        z.tick = 0.25;
        if (z.kind === 'burn') this.aoe(z.x, z.z, z.r, z.dmg * 0.25, -1, true, z.y);
        else if (z.kind === 'rain') { this.aoe(z.x, z.z, z.r, z.dmg, z.owner); }
        else this.aoe(z.x, z.z, z.r, z.dmg * 0.3, z.owner);
      }
      if (z.life <= 0 && z.kind === 'sing') {
        this.aoe(z.x, z.z, z.r, z.dmg * 7, z.owner);
        this.events.push({ k: 'boom', x: z.x, y: z.y + 1, z: z.z, r: z.r, c: SING_COLOR });
      }
    }
    if (this.zones.length) this.zones = this.zones.filter((z) => z.life > 0);

    // enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      let v = e.speed;
      let slow = 0;
      if (e.slowT > 0) { e.slowT -= dt; slow = e.slowF; if (e.slowT <= 0) e.slowF = 0; }
      if (e.sing > 0) { e.sing -= dt; slow = Math.max(slow, e.type === 'boss' ? 0.4 : 0.9); }
      if (e.frz > 0) { e.frz -= dt; slow = Math.max(slow, e.type === 'boss' ? 0.6 : 1); }
      v *= 1 - slow;
      if (e.vulnT > 0) e.vulnT -= dt;
      if (e.crackT > 0) e.crackT -= dt;
      if (e.pullCd > 0) e.pullCd -= dt;
      if (e.burnT > 0) {
        e.burnT -= dt; e.burnAcc += dt;
        if (e.burnAcc >= 0.5) { e.burnAcc -= 0.5; this.damage(e, e.burnD * 0.5, -1, true); if (!e.alive) continue; }
        if (e.burn2T > 0) e.burn2T -= dt;
        if (e.burnT <= 0) {
          if (e.burn2T > 0) { e.burnD = e.burn2D; e.burnT = e.burn2T; } else { e.burnD = 0; e.burnAcc = 0; }
          e.burn2T = 0; e.burn2D = 0;
        }
      }
      if (e.maxShield > 0 && e.shield < e.maxShield) { e.shieldCd -= dt; if (e.shieldCd <= 0) e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.25 * dt); }
      if (e.breach > 0) { // at the core: its attack lands when the timer runs out (slows and freezes delay it) unless it is destroyed first
        e.breach -= dt * (1 - slow);
        if (e.breach <= 0) this.breachHit(e);
        continue;
      }
      e.dist += v * dt;
      if (e.pull > 0) { const d = Math.min(e.pull, 6 * dt); e.pull -= d; e.dist = Math.max(0, e.dist - d); }
      const len = this.map.lanes[e.lane].len;
      // enemies pull up at the edge of the core's plinth (the view draws them there too), not at its centre
      const stand = Math.max(0, len - (CORE_STAND + 0.6 * e.r));
      if (e.dist >= stand) { e.dist = stand; e.pull = 0; e.breach = e.type === 'boss' ? BREACH_TIME_BOSS : BREACH_TIME; }
      this.place(e);
    }

    // walls of fire follow their pylons: off while one of them reboots, hot while an Inferno runs
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i], tw = this.wallTw[i];
      w.on = tw[0].down <= 0 && tw[1].down <= 0; w.hot = w.on && (tw[0].spec > 0 || tw[1].spec > 0);
    }

    // towers
    for (const t of this.towers) this.stepTower(t, dt);

    // projectiles
    for (const p of this.projs) this.stepProj(p, dt);
    if (this.projs.length) this.projs = this.projs.filter((p) => p.life > 0);
    this.enemies = this.enemies.filter((e) => e.alive);

    // players
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      p.fireCd -= dt;
      if (!p.heroActive || !p.drawing) p.draw = 0;
      else if (p.fireCd <= 0) p.draw = Math.min(1, p.draw + (dt * Math.max(0.2, p.stats.rate)) / DRAW_TIME);
      for (let s = 0; s < 3; s++) if (p.cds[s] > 0) p.cds[s] -= dt;
      if (p.heroActive) {
        p.heroTime -= dt;
        if (p.heroTime <= 0 || !this.towerById(p.heroTower)) { p.heroTime = 0; this.exitHero(i); p.energy = 0; }
      } else if (this.waveActive) p.energy = Math.min(MAX_ENERGY, p.energy + (TUNE.energyT + 0.3 * this.mods.beaconFeed * Math.min(4, this.beacons)) * p.stats.charge * dt);
    }
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

  private turn(t: Tower, x: number, z: number, dt: number) {
    let d = Math.atan2(x - t.x, z - t.z) - t.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    t.yaw += d * Math.min(1, dt * 12);
  }

  private stepTower(t: Tower, dt: number) {
    const def = TOWERS[t.type], sp = def.special;
    if (t.down > 0) { // rebooting after a special: does nothing and does not charge
      t.down -= dt;
      if (t.down <= 0) {
        t.down = 0; t.charge = 0; t.cd = 0.3;
        this.events.push({ k: 'up', id: t.id, x: t.x, z: t.z });
        if (t.type === 'beacon') this.recomputeBuffs();
      }
      return;
    }
    if (sp) {
      if (t.spec > 0) { t.spec -= dt; if (t.spec <= 0) { this.endSpecial(t); return; } }
      else if (t.charge < 1) t.charge = Math.min(1, t.charge + (dt * this.mods.specCharge) / sp.charge);
    }
    if (t.type === 'beacon' || t.type === 'spire') return;
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
        for (let n = 0; n < shots && e.alive; n++) this.damage(e, dmg * 0.5 * f, -1);
        if (e.alive) this.burn(e, bD * f, bT);
      }
    }
    if (linked) return;
    const inferno = t.spec > 0, R = FIRE_RING * (inferno ? 1.5 : 1);
    for (const e of this.enemies) {
      if (!e.alive || Math.hypot(e.x - t.x, e.z - t.z) > R + e.r) continue;
      const f = RING_SHARE * (inferno ? hot : 1) * (ENEMIES[e.type].fly ? 0.5 : 1);
      for (let n = 0; n < shots && e.alive; n++) this.damage(e, dmg * f, -1);
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
    const dmg = this.towerDmg(t) * (1 + (TUNE.lanceHeat + LANCE_FOCUS * this.mods.lanceHeat) * t.heat) * (over ? OVERLOAD * this.mods.specPow : 1) * this.shots(t);
    const y = t.h * 0.85;
    let tx = e.x, tz = e.z;
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
    this.events.push({ k: 'lance', id: t.id, x: t.x, y, z: t.z, tx, ty: e.y, tz, heat: t.heat, o: over ? 1 : 0 });
  }

  /** Graviton Well: no damage; each pulse slows enemies in range and drags them back along their lane. */
  private stepGravity(t: Tower, dt: number, range: number) {
    t.cd -= dt;
    if (t.cd > 0 || !this.anyIn(t, range)) return;
    t.cd = 1 / this.towerRate(t);
    // the drag is a share of the ground the enemy would cover until it can be dragged again, so nothing is ever held in place for good
    // (every Deep Well stack and every level adds drag; the cap is only a safety net. A Beacon makes the well pulse faster, not drag further.)
    const k = Math.min(0.72, (0.3 + 0.07 * (t.lvl - 1)) * (1 + 0.25 * this.mods.gravPull));
    const f = 0.3 + 0.06 * (t.lvl - 1);
    for (const e of this.enemies) {
      if (!e.alive || Math.hypot(e.x - t.x, e.z - t.z) > range + e.r) continue;
      const boss = e.type === 'boss', ff = boss ? f * 0.5 : f;
      if (ff >= e.slowF || e.slowT <= 0) { e.slowF = ff; e.slowT = Math.max(e.slowT, 1.6); }
      if (e.pullCd <= 0) {
        const slow = Math.max(e.slowT > 0 ? e.slowF : 0, e.sing > 0 ? (boss ? 0.4 : 0.9) : 0, e.frz > 0 ? (boss ? 0.6 : 1) : 0);
        e.pull += e.speed * (1 - slow) * 1.8 * k * (boss ? 0.3 : 1); e.pullCd = 1.8;
      }
      if (this.mods.gravVuln) e.vulnT = 2.4;
    }
    this.events.push({ k: 'gravity', id: t.id, x: t.x, z: t.z, r: range });
  }

  private pickTarget(t: Tower, range: number, minRange: number): Enemy | null {
    let best: Enemy | null = null, bv = -Infinity;
    const strongest = t.type === 'rail' || t.type === 'lance', ground = t.type === 'mortar';
    for (const e of this.enemies) {
      if (!e.alive || (ground && ENEMIES[e.type].fly)) continue;
      const d = Math.hypot(e.x - t.x, e.z - t.z);
      if (d > range || d < minRange) continue;
      const prog = e.dist - this.map.lanes[e.lane].len; // 0 = at the core
      const v = strongest ? e.hp + e.shield + prog * 0.01 : prog;
      if (v > bv) { bv = v; best = e; }
    }
    return best;
  }

  private shell(t: Tower, tx: number, ty: number, tz: number, dmg: number, T: number) {
    this.projs.push({ id: this.nid++, kind: 'shell', owner: -1, hit: [], tier: 0, chain: 0, pierce: 0, x: t.x, y: t.h * 0.8, z: t.z, vx: 0, vy: 0, vz: 0, dmg, target: 0, life: T + 0.1, aoe: TOWERS.mortar.aoe! * (1 + 0.1 * (t.lvl - 1)) * (1 + 0.25 * this.mods.mortarAoe), sx: t.x, sz: t.z, tx, ty, tz, t: 0, T });
    this.events.push({ k: 'shot', t: 'mortar', id: t.id, d: Math.hypot(tx - t.x, tz - t.z), x: t.x, y: t.h * 0.8, z: t.z });
  }
  private barrageShell(t: Tower, range: number) {
    const dmg = this.towerDmg(t) * 2 * this.mods.specPow;
    const list: Enemy[] = [];
    for (const e of this.enemies) if (e.alive && !ENEMIES[e.type].fly && Math.hypot(e.x - t.x, e.z - t.z) <= range + e.r) list.push(e);
    const T = 0.85;
    if (list.length) {
      const e = list[(t.aux * 3) % list.length];
      this.map.pos(e.lane, e.dist + e.speed * (e.slowT > 0 ? 1 - e.slowF : 1) * (e.frz > 0 ? 0 : 1) * T, tmp);
    } else {
      let ok = false;
      for (let i = 0; i < 8 && !ok; i++) {
        const l = Math.floor(this.rand() * this.map.lanes.length * 0.999);
        this.map.pos(l, this.rand() * this.map.lanes[l].len, tmp);
        ok = Math.hypot(tmp.x - t.x, tmp.z - t.z) <= range;
      }
      if (!ok) return;
    }
    this.shell(t, tmp.x, tmp.y || 0, tmp.z, dmg, T);
  }
  private missile(t: Tower, e: Enemy, dmg: number, i: number) {
    const a = t.yaw + (i % 2 ? 1 : -1) * (0.45 + 0.3 * ((i >> 1) % 4)) + (this.rand() - 0.5) * 0.2;
    this.projs.push({
      id: this.nid++, kind: 'missile', owner: -1, hit: [], tier: 0, chain: 0, pierce: 0,
      x: t.x, y: t.h * 0.9, z: t.z, vx: Math.sin(a) * 5, vy: 9 + (i % 3), vz: Math.cos(a) * 5,
      dmg, target: e.id, life: 5, aoe: TOWERS.missile.aoe! * (1 + 0.3 * this.mods.missileAoe), sx: t.x, sz: t.z, tx: e.x, ty: e.y, tz: e.z, t: 0, T: 0,
    });
  }
  private swarmMissile(t: Tower) {
    const list = this.enemies.filter((e) => e.alive);
    if (!list.length) return;
    list.sort((a, b) => (b.dist - this.map.lanes[b.lane].len) - (a.dist - this.map.lanes[a.lane].len));
    this.missile(t, list[t.aux % list.length], this.towerDmg(t) * 1.5 * this.mods.specPow, t.aux);
    if (t.aux % 4 === 0) this.events.push({ k: 'shot', t: 'missile', id: t.id, x: t.x, y: t.h * 0.9, z: t.z });
  }

  private fire(t: Tower, e: Enemy, dmg: number, range: number) {
    const c = TOWERS[t.type].color, y = t.h * 0.8;
    const blank = { owner: -1, hit: [], tier: 0, chain: 0, pierce: 0 };
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
        const sp = e.speed * (e.slowT > 0 ? 1 - e.slowF : 1);
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
        for (let i = 0; i < list.length && i < max; i++) { const o = list[i].e, heavy = o.type === 'brute' || o.type === 'boss'; this.damage(o, dmg * (1 + RAIL_CAP * cap) * (heavy ? 1 + 0.3 * brk : 1), -1, brk > 0); }
        this.events.push({ k: 'rail', x: t.x + dx, y, z: t.z + dz, tx: t.x + dx * (range + 2), ty: 0.8, tz: t.z + dz * (range + 2), c });
        this.events.push({ k: 'shot', t: 'rail', id: t.id, x: t.x, y, z: t.z });
        break;
      }
      case 'missile': {
        // up to three different targets, flyers first, then whoever is closest to the core
        const list: Enemy[] = [];
        for (const o of this.enemies) if (o.alive && Math.hypot(o.x - t.x, o.z - t.z) <= range) list.push(o);
        const val = (o: Enemy) => (ENEMIES[o.type].fly ? 1000 : 0) + o.dist - this.map.lanes[o.lane].len;
        list.sort((a, b) => val(b) - val(a));
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
        if (e) { this.damage(e, p.dmg, -1); this.events.push({ k: 'hit', x: e.x, y: e.y, z: e.z, c: TOWERS.pulse.color }); }
        p.life = 0;
      } else { p.vx = (dx / L) * 34; p.vy = (dy / L) * 34; p.vz = (dz / L) * 34; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
    } else if (p.kind === 'shell') {
      p.t += dt;
      const u = Math.min(1, p.t / p.T);
      const nx = p.sx + (p.tx - p.sx) * u, nz = p.sz + (p.tz - p.sz) * u, ny = 1.6 + 7 * 4 * u * (1 - u) - 1.4 * u + p.ty * u;
      p.vx = (nx - p.x) / dt; p.vy = (ny - p.y) / dt; p.vz = (nz - p.z) / dt;
      p.x = nx; p.y = ny; p.z = nz;
      if (u >= 1) {
        this.aoe(p.tx, p.tz, p.aoe, p.dmg, -1, true, p.ty);
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
        const near = Math.hypot(p.tx - p.x, p.tz - p.z) < 3;
        if (e && near) this.damage(e, p.dmg, -1);
        if (near) for (const o of this.enemies) if (o.alive && o !== e && Math.hypot(o.x - p.x, o.z - p.z) <= p.aoe + o.r && Math.abs(o.y - p.y) < 3) this.damage(o, p.dmg * 0.5, -1);
        this.events.push({ k: 'boom', x: p.x, y: p.y, z: p.z, r: p.aoe, c: TOWERS.missile.color, s: 1 });
        p.life = 0;
      }
    } else {
      const ox = p.x, oy = p.y, oz = p.z;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const sx = p.x - ox, sy = p.y - oy, sz = p.z - oz, L = Math.hypot(sx, sy, sz) || 1e-6;
      const dx = sx / L, dy = sy / L, dz = sz / L;
      // weak points are tested before the body: a weak point counts if the arrow reaches it before (or as) it enters the hull
      const hits: { e: Enemy; u: number; w: number }[] = [];
      for (const e of this.enemies) {
        if (!e.alive || p.hit.includes(e.id)) continue;
        const ub = raySphere(ox, oy, oz, dx, dy, dz, e.x, e.y, e.z, e.r + ARROW_PAD);
        const body = ub >= 0 && ub <= L;
        let uw = -1, wi = -1;
        const wk = ENEMIES[e.type].weak;
        if (wk) for (let i = 0; i < wk.length; i++) {
          weakPos(e, i, W3);
          const u = raySphere(ox, oy, oz, dx, dy, dz, W3.x, W3.y, W3.z, wk[i].r * ENEMY_SCALE[e.type] + 0.1);
          if (u >= 0 && u <= L + 0.35 && (wi < 0 || u < uw)) { uw = u; wi = i; }
        }
        if (wi >= 0 && (body ? uw <= ub + 0.35 : uw <= L)) hits.push({ e, u: uw, w: wi });
        else if (body) hits.push({ e, u: ub, w: -1 });
      }
      // a charged power node in the flight path fires that tower's special and swallows the arrow
      let node: Tower | null = null, nu = Infinity;
      for (const t of this.towers) {
        if (!this.specialReady(t)) continue;
        nodePos(t, W3);
        const u = raySphere(ox, oy, oz, dx, dy, dz, W3.x, W3.y, W3.z, NODE_R);
        if (u >= 0 && u <= L && u < nu) { nu = u; node = t; }
      }
      // the jump target of another Spire in the flight path carries Kestrel over and swallows the arrow
      let jump: Tower | null = null, ju = Infinity;
      const pl = this.players[p.owner];
      if (pl && pl.heroActive && this.spires > 1) for (const t of this.towers) {
        if (t.type !== 'spire' || t.id === pl.heroTower) continue;
        spireTarget(t, W3);
        const u = raySphere(ox, oy, oz, dx, dy, dz, W3.x, W3.y, W3.z, SPIRE_R);
        if (u >= 0 && u <= L && u < ju) { ju = u; jump = t; }
      }
      // the node and the jump target that lie before distance u, nearest first; true if one of them swallowed the arrow
      const swallowed = (u: number): boolean => {
        for (let k = 0; k < 2; k++) {
          if (node && (!jump || nu <= ju)) { if (nu >= u) return false; const t: Tower = node; node = null; if (this.triggerSpecial(t.id, p.owner)) return true; }
          else if (jump) { if (ju >= u) return false; const t: Tower = jump; jump = null; if (this.heroTeleport(p.owner, t.id)) return true; }
          else return false;
        }
        return false;
      };
      hits.sort((a, b) => a.u - b.u); // nearest along the flight path first
      for (const h of hits) {
        const e = h.e;
        if (!e.alive) continue;
        if (swallowed(h.u)) { p.life = 0; break; }
        p.hit.push(e.id);
        if (h.w >= 0 && weakPos(e, h.w, W3)) this.arrowHit(p, W3.x, W3.y, W3.z, e, ENEMIES[e.type].weak![h.w].mul);
        else this.arrowHit(p, e.x, e.y, e.z, e, 1);
        if (p.pierce-- <= 0) { p.life = 0; break; }
      }
      if (p.life > 0 && swallowed(Infinity)) p.life = 0;
      if (p.life > 0 && p.y <= 0.05) {
        if (p.aoe > 0) this.arrowHit(p, p.x, 0.2, p.z, null, 1);
        else this.events.push({ k: 'hit', x: p.x, y: 0.1, z: p.z, c: BOW_TIERS[p.tier].color });
        p.life = 0;
      }
    }
  }
  private arrowHit(p: Proj, x: number, y: number, z: number, e: Enemy | null, mul: number) {
    const c = BOW_TIERS[p.tier].color;
    if (e) {
      if (mul > 1) {
        const pl = this.players[p.owner];
        const n = this.damage(e, p.dmg * mul * (pl ? pl.stats.weak : 1), p.owner);
        this.events.push({ k: 'crit', x, y, z, n: Math.round(n) });
        this.crack(e, x, y, z);
      } else this.damage(e, p.dmg, p.owner);
    }
    if (p.aoe > 0) {
      const gy = e ? e.gy : 0; // the blast stays on its own deck
      for (const o of this.enemies) if (o.alive && o !== e && Math.abs(o.gy - gy) <= DECK_GAP && Math.hypot(o.x - x, o.z - z) <= p.aoe + o.r) this.damage(o, p.dmg * 0.5, p.owner);
      this.events.push({ k: 'boom', x, y, z, r: p.aoe, c, s: 1 });
    } else this.events.push({ k: 'hit', x, y, z, c });
    if (e && p.chain > 0) this.chainFrom(e, p.chain, p.dmg * 0.5, p.owner, c);
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
      a: [r(this.time), this.wave, this.lives, Math.floor(this.gold), this.level, Math.floor(this.xp), this.xpNext, this.waveActive ? 1 : 0, r(this.queue.length ? -1 : this.nextWaveIn), this.over ? 1 : 0, this.won ? 1 : 0, this.kills, this.mods.cheap, this.winWave, this.endless ? 1 : 0, this.maxLives],
      u: [...this.unlocked].map((t) => TOWER_TYPES.indexOf(t)),
      e: this.enemies.map((e) => [e.id, ENEMY_TYPES.indexOf(e.type), r(e.x), r(e.z), r(e.yaw), Math.ceil(e.hp), Math.ceil(e.maxHp), Math.ceil(e.shield), e.slowT > 0 ? 1 : 0, r(e.gy), (e.burnT > 0 ? 1 : 0) | (e.frz > 0 ? 2 : 0) | (e.vulnT > 0 ? 4 : 0) | (e.crackT > 0 ? 16 : 0), r(e.breach)]),
      t: this.towers.map((t) => [t.id, TOWER_TYPES.indexOf(t.type), t.cx, t.cz, t.lvl, r(t.yaw), r(t.buff), t.spent, r(t.charge), r(t.down), r(t.spec), r(t.heat)]),
      p: this.projs.map((p) => [p.id, PROJ_KINDS.indexOf(p.kind), r(p.x), r(p.y), r(p.z), r(p.vx), r(p.vy), r(p.vz), p.tier]),
      z: this.zones.map((z) => [z.id, ZONE_KINDS.indexOf(z.kind), r(z.x), r(z.z), r(z.r), r(z.life), r(z.y)]),
      pl: this.players.map((p) => [r(p.energy), p.heroActive ? 1 : 0, p.heroTower, r(p.yaw), r(p.pitch), r(p.heroTime), r(p.heroDur), p.cds.map(r), p.pending[0] || [], p.pending.length, p.stats.cdr, r(p.draw), p.drawing ? 1 : 0]),
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
      if (!e || e.type !== type) e = { id: num(v[0]), type, x: 0, z: 0, y: d.y, yaw: 0, dist: 0, lane: 0, off: 0, hp: 1, maxHp: 1, shield: 0, maxShield: d.shield ? 1 : 0, shieldCd: 0, speed: d.speed, slowT: 0, slowF: 0, sing: 0, alive: true, r: d.r, armor: 0, gy: 0, frz: 0, burnT: 0, burnD: 0, burnAcc: 0, vulnT: 0, pull: 0, pullCd: 0, burn2T: 0, burn2D: 0, breach: 0, crackT: 0 };
      e.x = clamp(num(v[2]), -200, 200); e.z = clamp(num(v[3]), -200, 200); e.yaw = num(v[4]); e.hp = num(v[5]); e.maxHp = num(v[6], 1) || 1; e.shield = num(v[7]); e.slowT = v[8] ? 1 : 0;
      e.gy = clamp(num(v[9]), 0, 20); e.y = e.gy + d.y;
      const fl = num(v[10]) | 0;
      e.burnT = fl & 1 ? 1 : 0; e.frz = fl & 2 ? 1 : 0; e.vulnT = fl & 4 ? 1 : 0; e.crackT = fl & 16 ? 1 : 0;
      e.breach = clamp(num(v[11]), 0, 10);
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
      this.grid[cz * GW + cx] = 2;
      this.towers.push(t);
    }
    this.beacons = 0; this.spires = 0;
    for (const t of this.towers) { if (t.type === 'beacon') this.beacons++; else if (t.type === 'spire') this.spires++; }
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
      p.energy = clamp(num(v[0]), 0, MAX_ENERGY); p.heroActive = !!v[1]; p.heroTower = num(v[2]); p.yaw = num(v[3]); p.pitch = num(v[4]);
      p.heroTime = num(v[5]); p.heroDur = num(v[6], HERO_DUR) || HERO_DUR;
      if (Array.isArray(v[7])) p.cds = [num(v[7][0]), num(v[7][1]), num(v[7][2])];
      const offer = Array.isArray(v[8]) ? v[8].slice(0, 8).filter((id: unknown) => typeof id === 'string' && Object.hasOwn(CARD_BY_ID, id as string)).slice(0, 3) : [];
      const n = Math.max(0, Math.min(50, num(v[9]) | 0));
      p.pending = offer.length && n ? [offer, ...Array(n - 1).fill(offer)] : [];
      p.stats.cdr = clamp(num(v[10], 1) || 1, 0.05, 1);
      p.draw = clamp(num(v[11]), 0, 1); p.drawing = !!v[12] && p.heroActive;
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
