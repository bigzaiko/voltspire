// VOLTSPIRE — pure game simulation (no rendering, no DOM). Runs in the browser and in Node.
import {
  CELL, GW, GH, MAX_ENERGY, WIN_WAVE, cellX, cellZ,
  TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, CARDS, CARD_BY_ID, BOW_TIERS, bowTier,
  LVL_DMG, LVL_RANGE, LVL_RATE, upgradeCost, waveHpMul, baseMods, baseHero,
} from './data.ts';
import type { TowerType, EnemyType, Mods, HeroStats, Card } from './data.ts';
import { GameMap, DEFAULT_MAP, diffById } from './map.ts';
import type { MapDef, Difficulty } from './map.ts';

export interface Enemy {
  id: number; type: EnemyType; x: number; z: number; y: number; yaw: number;
  dist: number; lane: number; off: number; hp: number; maxHp: number; shield: number; maxShield: number; shieldCd: number;
  speed: number; slowT: number; slowF: number; sing: number; alive: boolean; r: number; armor: number;
}
export interface Tower {
  id: number; type: TowerType; cx: number; cz: number; x: number; z: number;
  lvl: number; cd: number; yaw: number; buff: number; spent: number; h: number;
}
export type ProjKind = 'bolt' | 'shell' | 'arrow';
const PROJ_KINDS: ProjKind[] = ['bolt', 'shell', 'arrow'];
export interface Proj {
  id: number; kind: ProjKind; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  dmg: number; owner: number; target: number; life: number; pierce: number; hit: number[];
  tier: number; aoe: number; chain: number; sx: number; sz: number; tx: number; tz: number; t: number; T: number;
}
export type ZoneKind = 'burn' | 'rain' | 'sing';
const ZONE_KINDS: ZoneKind[] = ['burn', 'rain', 'sing'];
export interface Zone {
  id: number; kind: ZoneKind; x: number; z: number; r: number; life: number; tick: number; dmg: number; owner: number; pd: number;
}
export interface Player {
  energy: number; heroActive: boolean; heroTower: number; yaw: number; pitch: number;
  heroTime: number; heroDur: number; stats: HeroStats; pending: string[][];
  fireCd: number; cds: number[]; stacks: Record<string, number>; kills: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ev = { k: string; [key: string]: any };

/** World scale: towers are ~3–4.5 units tall, Kestrel is ~0.9 and stands on a hovering deck above the tower. */
export const TOWER_SCALE = 1.15;
export const TOWER_H: Record<TowerType, number> = { pulse: 2.76, cryo: 2.78, arc: 3.7, mortar: 2.4, rail: 3.23, beacon: 3.92 };
export const DECK = 0.55; // height of the uplink deck above the top of its tower
export const HERO_SCALE = 0.5;
export const SKILL_CD = [4, 11, 18]; // rail shot, arrow rain, singularity

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
const tmp = { x: 0, z: 0, dx: 0, dz: 0 };

export class Sim {
  opts: SimOpts;
  time = 0; wave = 0; lives = 20; gold = 220; level = 1; xp = 0; xpNext = xpNeed(1);
  mods: Mods = baseMods();
  unlocked = new Set<TowerType>(['pulse', 'cryo']);
  stacks: Record<string, number> = {};
  enemies: Enemy[] = []; towers: Tower[] = []; projs: Proj[] = []; zones: Zone[] = [];
  players: Player[] = [];
  events: Ev[] = [];
  map: GameMap; diff: Difficulty;
  grid: Uint8Array;
  queue: { t: number; type: EnemyType; mul: number; lane: number }[] = [];
  waveActive = false; nextWaveIn = 12; cleared = true;
  over = false; won = false; endless = false; replica = false;
  kills = 0; leaked = 0; sent = 0; beacons = 0;
  private nid = 1;
  private rand: () => number;

  constructor(opts: Partial<SimOpts> = {}) {
    this.opts = { mode: 'solo', players: 1, seed: (Math.random() * 1e9) | 0, pauseOnCards: true, map: DEFAULT_MAP, diff: 'normal', survival: false, ...opts };
    if (this.opts.seed === undefined) this.opts.seed = (Math.random() * 1e9) | 0;
    this.rand = mulberry(this.opts.seed);
    this.map = new GameMap(this.opts.map || DEFAULT_MAP);
    this.diff = diffById(this.opts.diff);
    this.grid = new Uint8Array(this.map.grid);
    this.gold = this.map.def.gold;
    this.lives = Math.max(1, Math.round(this.map.def.lives * this.diff.lives));
    this.endless = this.opts.survival;
    for (const t of this.map.def.towers) {
      if (this.grid[t.cz * GW + t.cx] !== 0) continue;
      this.grid[t.cz * GW + t.cx] = 2;
      this.unlocked.add(t.t);
      this.towers.push({ id: this.nid++, type: t.t, cx: t.cx, cz: t.cz, x: cellX(t.cx), z: cellZ(t.cz), lvl: 1, cd: 0.3, yaw: 0, buff: 0, spent: 0, h: TOWER_H[t.t] });
    }
    this.recomputeBuffs();
    for (let i = 0; i < this.opts.players; i++) {
      this.players.push({
        energy: 0, heroActive: false, heroTower: 0, yaw: 0, pitch: -0.25, heroTime: 0, heroDur: 14,
        stats: baseHero(), pending: [], fireCd: 0, cds: [0, 0, 0], stacks: {}, kills: 0,
      });
    }
  }

  get paused() { return this.opts.pauseOnCards && this.players.some((p) => p.pending.length > 0); }
  get tier() { return bowTier(this.wave); }
  cost(t: TowerType) { return Math.round(TOWERS[t].cost * this.mods.cheap); }
  upCost(t: Tower) { return Math.round(upgradeCost(t.type, t.lvl) * this.mods.cheap); }
  sellValue(t: Tower) { return Math.round(t.spent * 0.6); }
  towerById(id: number) { return this.towers.find((t) => t.id === id); }
  range(t: Tower) { return TOWERS[t.type].range * LVL_RANGE[t.lvl - 1] * this.mods.tw[t.type].range * (t.type === 'beacon' ? 1 : this.mods.tRange); }
  towerDmg(t: Tower) { return TOWERS[t.type].dmg * LVL_DMG[t.lvl - 1] * this.mods.tDmg * this.mods.tw[t.type].dmg * (1 + t.buff); }
  towerRate(t: Tower) { return TOWERS[t.type].rate * LVL_RATE[t.lvl - 1] * this.mods.tRate * this.mods.tw[t.type].rate * (1 + t.buff * 0.6); }
  arrowDmg(p: Player) { return 20 * BOW_TIERS[this.tier].mul * p.stats.dmg; }

  // ---------- building ----------
  canBuild(type: TowerType, cx: number, cz: number) {
    return cx >= 0 && cz >= 0 && cx < GW && cz < GH && this.grid[cz * GW + cx] === 0 &&
      this.unlocked.has(type) && this.gold >= this.cost(type);
  }
  build(type: TowerType, cx: number, cz: number) {
    if (this.over || !this.canBuild(type, cx, cz)) return null;
    const c = this.cost(type);
    this.gold -= c;
    this.grid[cz * GW + cx] = 2;
    const t: Tower = { id: this.nid++, type, cx, cz, x: cellX(cx), z: cellZ(cz), lvl: 1, cd: 0.3, yaw: 0, buff: 0, spent: c, h: TOWER_H[type] };
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
  sell(id: number) {
    const i = this.towers.findIndex((t) => t.id === id);
    if (i < 0 || this.over) return false;
    const t = this.towers[i];
    if (this.players.some((p) => p.heroActive && p.heroTower === id)) return false;
    this.gold += this.sellValue(t);
    this.grid[t.cz * GW + t.cx] = 0;
    this.towers.splice(i, 1);
    this.recomputeBuffs();
    this.events.push({ k: 'sell', x: t.x, z: t.z });
    return true;
  }
  recomputeBuffs() {
    this.beacons = this.towers.filter((t) => t.type === 'beacon').length;
    for (const t of this.towers) {
      t.buff = 0;
      if (t.type === 'beacon') continue;
      for (const b of this.towers) {
        if (b.type !== 'beacon') continue;
        if (Math.hypot(b.x - t.x, b.z - t.z) <= this.range(b)) t.buff = Math.max(t.buff, 0.25 + 0.1 * (b.lvl - 1) + this.mods.beacon);
      }
    }
  }

  // ---------- waves ----------
  startWave() {
    if (this.queue.length || this.over) return;
    if (this.wave >= WIN_WAVE && this.opts.mode !== 'versus' && !this.endless) return; // the final wave must be cleared, not skipped
    if (this.nextWaveIn > 0.5 && this.wave > 0) this.gold += Math.round(this.nextWaveIn * 2); // early-call bonus
    this.wave++;
    this.waveActive = true; this.cleared = false; this.nextWaveIn = 15;
    const w = this.wave, mul = waveHpMul(w), r = this.rand;
    let budget = (8 + w * 5 + Math.pow(w, 1.5)) * this.diff.count;
    const L = this.map.lanes.length, lane = () => Math.floor(r() * L * 0.999);
    let t = this.time + 0.5;
    const gapMul = Math.max(0.35, 0.8 - w * 0.025);
    if (w % 5 === 0) {
      const n = 1 + Math.floor(w / 15);
      for (let i = 0; i < n; i++) this.queue.push({ t: t + 3 + i * 6, type: 'boss', mul, lane: lane() });
      budget *= 0.55;
      this.events.push({ k: 'boss' });
    }
    const avail = ENEMY_TYPES.filter((e) => e !== 'boss' && ENEMIES[e].from <= w);
    while (budget > 0.5) {
      // biased toward the newest enemy types, with grunts always in the mix
      const type = avail[avail.length - 1 - Math.floor(r() * r() * avail.length * 0.999)];
      const pick: EnemyType = r() < 0.35 ? 'grunt' : type;
      const def = ENEMIES[pick];
      const n = Math.max(1, Math.min(14, Math.round((3 + r() * 6) / Math.pow(def.cost, 0.7))));
      const ln = lane();
      for (let i = 0; i < n && budget > 0; i++) {
        this.queue.push({ t, type: pick, mul, lane: ln });
        t += GAPS[pick] * gapMul;
        budget -= def.cost;
      }
      t += 1.4 * gapMul;
    }
    this.queue.sort((a, b) => a.t - b.t);
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
    const hp = d.hp * mul * this.diff.hp * (this.opts.mode === 'coop' ? 1.5 : 1);
    const e: Enemy = {
      id: this.nid++, type, x: 0, z: 0, y: d.y, yaw: 0, dist: 0, lane, off: type === 'boss' ? 0 : (this.rand() - 0.5) * 1.3,
      hp, maxHp: hp, shield: d.shield * mul, maxShield: d.shield * mul, shieldCd: 0,
      speed: d.speed * (0.94 + this.rand() * 0.12), slowT: 0, slowF: 0, sing: 0, alive: true, r: d.r, armor: d.armor * (1 + this.wave * 0.04),
    };
    this.place(e);
    this.enemies.push(e);
  }
  private place(e: Enemy) {
    this.map.pos(e.lane, e.dist, tmp);
    e.x = tmp.x - tmp.dz * e.off; e.z = tmp.z + tmp.dx * e.off;
    e.yaw = Math.atan2(tmp.dx, tmp.dz);
  }

  // ---------- damage ----------
  damage(e: Enemy, amt: number, owner: number, raw = false) {
    if (!e.alive) return;
    if (e.slowT > 0 && this.mods.shatter) amt *= 1 + this.mods.shatter;
    if (!raw && e.armor) amt = Math.max(amt * 0.35, amt - e.armor);
    if (e.maxShield > 0) e.shieldCd = 3; // every hit delays the regeneration
    if (e.shield > 0) {
      const before = e.shield, s = Math.min(e.shield, amt);
      e.shield -= s; amt -= s;
      if (e.shield <= 0 && before > e.maxShield * 0.1) this.events.push({ k: 'shieldbreak', x: e.x, y: e.y, z: e.z });
    }
    e.hp -= amt;
    if (owner >= 0 && amt > 0) this.events.push({ k: 'dmg', x: e.x, y: e.y + e.r, z: e.z, n: Math.round(amt), p: owner });
    if (e.hp <= 0) this.kill(e, owner);
  }
  private kill(e: Enemy, owner: number) {
    e.alive = false;
    const d = ENEMIES[e.type];
    this.kills++;
    this.gold += d.bounty * this.mods.gold * this.diff.gold;
    this.xp += d.xp * this.mods.xp;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.heroActive) { if (i === owner) { p.heroTime = Math.min(p.heroDur, p.heroTime + 0.12); p.kills++; } }
      else p.energy = Math.min(MAX_ENERGY, p.energy + d.energy * p.stats.charge);
    }
    this.events.push({ k: 'die', x: e.x, y: e.y, z: e.z, t: e.type, h: owner >= 0 ? 1 : 0 });
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext; this.level++; this.xpNext = xpNeed(this.level);
      for (let i = 0; i < this.players.length; i++) this.players[i].pending.push(this.rollCards(i));
      this.events.push({ k: 'levelup', n: this.level });
    }
  }
  private aoe(x: number, z: number, r: number, dmg: number, owner: number, ground = false) {
    for (const e of this.enemies) {
      if (!e.alive || (ground && ENEMIES[e.type].fly)) continue;
      if (Math.hypot(e.x - x, e.z - z) <= r + e.r) this.damage(e, dmg, owner);
    }
  }
  private chainFrom(src: Enemy, n: number, dmg: number, owner: number, c: number, slow = 0) {
    const pts = [src.x, src.y, src.z];
    const hit = new Set<number>([src.id]);
    let cur = src;
    for (let i = 0; i < n; i++) {
      let best: Enemy | null = null, bd = 4.5;
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e.id)) continue;
        const d = Math.hypot(e.x - cur.x, e.z - cur.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      hit.add(best.id); pts.push(best.x, best.y, best.z);
      if (slow && best.type !== 'boss') { best.slowT = Math.max(best.slowT, 1); best.slowF = Math.max(best.slowF, slow); }
      this.damage(best, dmg, owner);
      dmg *= 0.8; cur = best;
    }
    if (pts.length > 3) this.events.push({ k: 'arc', p: pts, c });
  }

  // ---------- cards ----------
  private cardOk(pi: number, c: Card) {
    const p = this.players[pi];
    const stack = (c.kind === 'hero' ? p.stacks[c.id] : this.stacks[c.id]) || 0;
    return stack < c.max && (!c.needs || this.unlocked.has(c.needs)) && !(c.kind === 'blueprint' && this.unlocked.has(c.id.slice(3) as TowerType));
  }
  rollCards(pi: number): string[] {
    const pool = CARDS.filter((c) => this.cardOk(pi, c));
    const out: string[] = [];
    const bps = pool.filter((c) => c.kind === 'blueprint');
    if (bps.length && [2, 3, 5, 7].includes(this.level)) out.push(bps[Math.floor(this.rand() * bps.length)].id);
    const W = [10, 5, 2];
    while (out.length < 3) {
      const rest = pool.filter((c) => !out.includes(c.id));
      if (!rest.length) break;
      let tot = 0;
      for (const c of rest) tot += c.kind === 'blueprint' ? 4 : W[c.rar];
      let x = this.rand() * tot;
      for (const c of rest) { x -= c.kind === 'blueprint' ? 4 : W[c.rar]; if (x <= 0) { out.push(c.id); break; } }
    }
    return out;
  }
  pickCard(pi: number, idx: number) {
    const p = this.players[pi];
    if (!p || !p.pending.length) return;
    const offer = p.pending.shift()!;
    const card = CARD_BY_ID[offer[Math.max(0, Math.min(offer.length - 1, idx | 0))]];
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
    this.players.forEach((q, i) => q.pending.forEach((offer2, k) => { if (offer2.some((id) => !this.cardOk(i, CARD_BY_ID[id]))) q.pending[k] = this.rollCards(i); }));
    this.events.push({ k: 'card', id: card.id, p: pi });
  }

  // ---------- hero ----------
  activateHero(pi: number, towerId: number) {
    const p = this.players[pi], t = this.towerById(towerId);
    if (!p || !t || p.heroActive || p.energy < MAX_ENERGY || this.over) return false;
    p.heroActive = true; p.heroTower = t.id; p.energy = 0;
    p.heroDur = 14 + p.stats.dur; p.heroTime = p.heroDur; p.fireCd = 0.4;
    this.events.push({ k: 'heroOn', p: pi, x: t.x, y: t.h + DECK, z: t.z });
    return true;
  }
  exitHero(pi: number) {
    const p = this.players[pi];
    if (!p || !p.heroActive) return;
    p.heroActive = false;
    p.energy = Math.max(0, Math.min(80, (p.heroTime / p.heroDur) * 80));
    p.heroTime = 0;
    const t = this.towerById(p.heroTower);
    this.events.push({ k: 'heroOff', p: pi, x: t ? t.x : 0, y: t ? t.h + DECK : 0, z: t ? t.z : 0 });
  }
  heroOrigin(pi: number) {
    const t = this.towerById(this.players[pi].heroTower);
    return t ? { x: t.x, y: t.h + DECK + 0.62, z: t.z } : null;
  }
  heroTeleport(pi: number, towerId: number) {
    const p = this.players[pi], t = this.towerById(towerId);
    if (!p || !p.heroActive || !t || t.id === p.heroTower) return false;
    const o = this.towerById(p.heroTower);
    p.heroTower = t.id;
    this.events.push({ k: 'tele', p: pi, x: t.x, y: t.h + DECK, z: t.z, fx: o ? o.x : t.x, fy: (o ? o.h : t.h) + DECK, fz: o ? o.z : t.z });
    return true;
  }
  heroFire(pi: number, tx: number, ty: number, tz: number) {
    const p = this.players[pi];
    if (!p || !p.heroActive || p.fireCd > 0) return;
    const o = this.heroOrigin(pi);
    if (!o || ![tx, ty, tz].every(Number.isFinite)) return;
    let dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const tier = this.tier, s = p.stats;
    const n = Math.min(9, s.arrows + (tier >= 2 ? 1 : 0));
    const dmg = this.arrowDmg(p);
    const yaw = Math.atan2(dx, dz), hl = Math.hypot(dx, dz);
    for (let i = 0; i < n; i++) {
      const a = yaw + (i - (n - 1) / 2) * 0.055;
      const SP = 85;
      this.projs.push({
        id: this.nid++, kind: 'arrow', x: o.x + dx * 0.8, y: o.y + dy * 0.8, z: o.z + dz * 0.8,
        vx: Math.sin(a) * hl * SP, vy: dy * SP, vz: Math.cos(a) * hl * SP,
        dmg, owner: pi, target: 0, life: 1.6, pierce: s.pierce + (tier >= 1 ? 1 : 0), hit: [], tier,
        aoe: s.explode * 1.5 + (tier >= 3 ? 1.6 : 0), chain: s.chain + (tier >= 4 ? 2 : 0), sx: 0, sz: 0, tx: 0, tz: 0, t: 0, T: 0,
      });
    }
    p.fireCd = 1 / (5.5 * s.rate);
    this.events.push({ k: 'arrow', p: pi, x: o.x, y: o.y, z: o.z });
  }
  heroSkill(pi: number, skill: number, tx: number, ty: number, tz: number) {
    const p = this.players[pi];
    if (!p || !p.heroActive || !(skill >= 0 && skill < 3) || p.cds[skill] > 0) return;
    const o = this.heroOrigin(pi);
    if (!o || ![tx, ty, tz].every(Number.isFinite)) return;
    const dmg = this.arrowDmg(p), c = BOW_TIERS[this.tier].color;
    p.cds[skill] = SKILL_CD[skill] * p.stats.cdr;
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
        if (Math.hypot(ex - dx * u, ey - dy * u, ez - dz * u) < e.r + 1.0) this.damage(e, dmg * 8, pi);
      }
      this.events.push({ k: 'rail', x: o.x, y: o.y, z: o.z, tx: o.x + dx * R, ty: Math.max(0, o.y + dy * R), tz: o.z + dz * R, c, big: 1 });
    } else {
      const d = Math.hypot(tx - o.x, tz - o.z);
      if (d > 48) { tx = o.x + ((tx - o.x) / d) * 48; tz = o.z + ((tz - o.z) / d) * 48; }
      if (skill === 1) {
        this.zones.push({ id: this.nid++, kind: 'rain', x: tx, z: tz, r: 4.5 * Math.sqrt(p.stats.rain), life: 3.5, tick: 0, dmg: dmg * 0.75 * p.stats.rain, owner: pi, pd: 0 });
      } else {
        this.zones.push({ id: this.nid++, kind: 'sing', x: tx, z: tz, r: 5.5 * Math.sqrt(p.stats.sing), life: 2.6, tick: 0, dmg: dmg * p.stats.sing, owner: pi, pd: 0 });
      }
      this.events.push({ k: 'skill', s: skill, x: tx, z: tz, c });
    }
  }

  // ---------- main step ----------
  step(dt: number) {
    if (this.over || this.replica || this.paused) return;
    this.time += dt;

    // waves: the next one is called 15s after the last spawn, or sooner once the field is clear
    while (this.queue.length && this.queue[0].t <= this.time) { const q = this.queue.shift()!; this.spawn(q.type, q.mul, q.lane); }
    this.waveActive = this.queue.length > 0 || this.enemies.length > 0;
    if (!this.queue.length) {
      const last = this.wave === WIN_WAVE && this.opts.mode !== 'versus' && !this.endless;
      if (!this.cleared && !this.enemies.length) {
        this.cleared = true;
        this.nextWaveIn = Math.min(this.nextWaveIn, 6);
        const bonus = 15 + this.wave * 3 + Math.min(60, this.gold * this.mods.interest);
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
          if (!boss) {
            const len = this.map.lanes[e.lane].len, pd = Math.min(this.map.nearest(e.lane, z.x, z.z), len - 4);
            e.dist = Math.min(len - 0.5, e.dist + Math.max(-1, Math.min(1, pd - e.dist)) * 5 * dt);
            e.off *= 1 - 3 * dt;
          }
        }
      }
      if (z.tick <= 0) {
        z.tick = 0.25;
        if (z.kind === 'burn') this.aoe(z.x, z.z, z.r, z.dmg * 0.25, -1, true);
        else if (z.kind === 'rain') { this.aoe(z.x, z.z, z.r, z.dmg, z.owner); }
        else this.aoe(z.x, z.z, z.r, z.dmg * 0.3, z.owner);
      }
      if (z.life <= 0 && z.kind === 'sing') {
        this.aoe(z.x, z.z, z.r, z.dmg * 7, z.owner);
        this.events.push({ k: 'boom', x: z.x, y: 1, z: z.z, r: z.r, c: 0xff2bd6 });
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
      v *= 1 - slow;
      if (e.maxShield > 0 && e.shield < e.maxShield) { e.shieldCd -= dt; if (e.shieldCd <= 0) e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.25 * dt); }
      e.dist += v * dt;
      if (e.dist >= this.map.lanes[e.lane].len) {
        e.alive = false;
        const l = ENEMIES[e.type].leak;
        this.lives -= l; this.leaked++;
        this.events.push({ k: 'leak', n: l });
        if (this.lives <= 0) { this.lives = 0; this.over = true; this.events.push({ k: 'lose' }); }
      } else this.place(e);
    }

    // towers
    for (const t of this.towers) {
      if (t.type === 'beacon') continue;
      t.cd -= dt;
      const def = TOWERS[t.type], range = this.range(t);
      const tgt = this.pickTarget(t, range, def.minRange || 0);
      if (!tgt) continue;
      const want = Math.atan2(tgt.x - t.x, tgt.z - t.z);
      let d = want - t.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      t.yaw += d * Math.min(1, dt * 12);
      if (t.cd > 0) continue;
      t.cd = 1 / this.towerRate(t);
      const dmg = this.towerDmg(t);
      this.fire(t, tgt, dmg, range);
    }

    // projectiles
    for (const p of this.projs) this.stepProj(p, dt);
    if (this.projs.length) this.projs = this.projs.filter((p) => p.life > 0);
    this.enemies = this.enemies.filter((e) => e.alive);

    // players
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      p.fireCd -= dt;
      for (let s = 0; s < 3; s++) if (p.cds[s] > 0) p.cds[s] -= dt;
      if (p.heroActive) {
        p.heroTime -= dt;
        if (p.heroTime <= 0 || !this.towerById(p.heroTower)) { p.heroTime = 0; this.exitHero(i); p.energy = 0; }
      } else if (this.waveActive) p.energy = Math.min(MAX_ENERGY, p.energy + (0.8 + 0.3 * this.mods.beaconFeed * Math.min(4, this.beacons)) * p.stats.charge * dt);
    }
  }

  private pickTarget(t: Tower, range: number, minRange: number): Enemy | null {
    let best: Enemy | null = null, bv = -Infinity;
    const strongest = t.type === 'rail', ground = t.type === 'mortar';
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

  private fire(t: Tower, e: Enemy, dmg: number, range: number) {
    const c = TOWERS[t.type].color, y = t.h * 0.8;
    const blank = { owner: -1, hit: [], tier: 0, chain: 0, pierce: 0 };
    switch (t.type) {
      case 'pulse': {
        const n = 1 + this.mods.twin;
        for (let i = 0; i < n; i++) {
          const o = (i - (n - 1) / 2) * 0.35;
          this.projs.push({ ...blank, id: this.nid++, kind: 'bolt', x: t.x + Math.cos(t.yaw) * o + Math.sin(t.yaw) * 0.8, y, z: t.z - Math.sin(t.yaw) * o + Math.cos(t.yaw) * 0.8, vx: 0, vy: 0, vz: 0, dmg: dmg * (this.mods.pulseCrit && this.rand() < this.mods.pulseCrit ? 3 : 1), target: e.id, life: 2, aoe: 0, sx: 0, sz: 0, tx: e.x, tz: e.z, t: 0, T: 0 });
        }
        this.events.push({ k: 'shot', t: 'pulse', x: t.x, y, z: t.z });
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
        this.events.push({ k: 'cryo', x: t.x, y, z: t.z, tx: e.x, ty: e.y, tz: e.z, r });
        break;
      }
      case 'arc': {
        this.events.push({ k: 'arc', p: [t.x, t.h * 0.95, t.z, e.x, e.y, e.z], c });
        this.damage(e, dmg, -1);
        if (this.mods.arcSlow && e.type !== 'boss') { e.slowT = Math.max(e.slowT, 1); e.slowF = Math.max(e.slowF, 0.2 * this.mods.arcSlow); }
        this.chainFrom(e, 2 + this.mods.arcChain + (t.lvl - 1), dmg * 0.8, -1, c, 0.2 * this.mods.arcSlow);
        this.events.push({ k: 'shot', t: 'arc', x: t.x, y, z: t.z });
        break;
      }
      case 'mortar': {
        const T = 0.9 + Math.hypot(e.x - t.x, e.z - t.z) * 0.03;
        const sp = e.speed * (e.slowT > 0 ? 1 - e.slowF : 1);
        this.map.pos(e.lane, e.dist + sp * T, tmp);
        this.projs.push({ ...blank, id: this.nid++, kind: 'shell', x: t.x, y, z: t.z, vx: 0, vy: 0, vz: 0, dmg, target: 0, life: T + 0.1, aoe: TOWERS.mortar.aoe! * (1 + 0.1 * (t.lvl - 1)) * (1 + 0.25 * this.mods.mortarAoe), sx: t.x, sz: t.z, tx: tmp.x, tz: tmp.z, t: 0, T });
        this.events.push({ k: 'shot', t: 'mortar', x: t.x, y, z: t.z });
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
        for (let i = 0; i < list.length && i < max; i++) { const o = list[i].e, heavy = o.type === 'brute' || o.type === 'boss'; this.damage(o, dmg * (1 + 0.5 * cap) * (heavy ? 1 + 0.3 * brk : 1), -1, brk > 0); }
        this.events.push({ k: 'rail', x: t.x + dx, y, z: t.z + dz, tx: t.x + dx * (range + 2), ty: 0.8, tz: t.z + dz * (range + 2), c });
        this.events.push({ k: 'shot', t: 'rail', x: t.x, y, z: t.z });
        break;
      }
    }
  }

  private stepProj(p: Proj, dt: number) {
    p.life -= dt;
    if (p.kind === 'bolt') {
      const e = this.enemies.find((o) => o.id === p.target && o.alive);
      let ty = 0.8;
      if (e) { p.tx = e.x; p.tz = e.z; ty = e.y; }
      const dx = p.tx - p.x, dy = ty - p.y, dz = p.tz - p.z, L = Math.hypot(dx, dy, dz);
      const s = 34 * dt;
      if (L <= s + (e ? e.r : 0.2)) {
        if (e) { this.damage(e, p.dmg, -1); this.events.push({ k: 'hit', x: e.x, y: e.y, z: e.z, c: 0x19e3ff }); }
        p.life = 0;
      } else { p.vx = (dx / L) * 34; p.vy = (dy / L) * 34; p.vz = (dz / L) * 34; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
    } else if (p.kind === 'shell') {
      p.t += dt;
      const u = Math.min(1, p.t / p.T);
      const nx = p.sx + (p.tx - p.sx) * u, nz = p.sz + (p.tz - p.sz) * u, ny = 1.6 + 7 * 4 * u * (1 - u) - 1.4 * u;
      p.vx = (nx - p.x) / dt; p.vy = (ny - p.y) / dt; p.vz = (nz - p.z) / dt;
      p.x = nx; p.y = ny; p.z = nz;
      if (u >= 1) {
        this.aoe(p.tx, p.tz, p.aoe, p.dmg, -1, true);
        this.events.push({ k: 'boom', x: p.tx, y: 0.3, z: p.tz, r: p.aoe, c: 0xff8a1f });
        if (this.mods.napalm) this.zones.push({ id: this.nid++, kind: 'burn', x: p.tx, z: p.tz, r: p.aoe * 0.9, life: 2 + this.mods.napalm, tick: 0.25, dmg: p.dmg * 0.5 * this.mods.napalm, owner: -1, pd: 0 });
        p.life = 0;
      }
    } else {
      const ox = p.x, oy = p.y, oz = p.z;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const sx = p.x - ox, sy = p.y - oy, sz = p.z - oz, L2 = sx * sx + sy * sy + sz * sz || 1;
      const hits: { e: Enemy; u: number }[] = [];
      for (const e of this.enemies) {
        if (!e.alive || p.hit.includes(e.id)) continue;
        const ex = e.x - ox, ey = e.y - oy, ez = e.z - oz;
        const u = Math.max(0, Math.min(1, (ex * sx + ey * sy + ez * sz) / L2));
        if (Math.hypot(ex - sx * u, ey - sy * u, ez - sz * u) <= e.r + 0.45) hits.push({ e, u });
      }
      hits.sort((a, b) => a.u - b.u); // nearest along the flight path first
      for (const { e } of hits) {
        if (!e.alive) continue;
        p.hit.push(e.id);
        this.arrowHit(p, e.x, e.y, e.z, e);
        if (p.pierce-- <= 0) { p.life = 0; break; }
      }
      if (p.life > 0 && p.y <= 0.05) {
        if (p.aoe > 0) this.arrowHit(p, p.x, 0.2, p.z, null);
        else this.events.push({ k: 'hit', x: p.x, y: 0.1, z: p.z, c: BOW_TIERS[p.tier].color });
        p.life = 0;
      }
    }
  }
  private arrowHit(p: Proj, x: number, y: number, z: number, e: Enemy | null) {
    const c = BOW_TIERS[p.tier].color;
    if (e) this.damage(e, p.dmg, p.owner);
    if (p.aoe > 0) {
      for (const o of this.enemies) if (o.alive && o !== e && Math.hypot(o.x - x, o.z - z) <= p.aoe + o.r) this.damage(o, p.dmg * 0.5, p.owner);
      this.events.push({ k: 'boom', x, y, z, r: p.aoe, c, s: 1 });
    } else this.events.push({ k: 'hit', x, y, z, c });
    if (e && p.chain > 0) this.chainFrom(e, p.chain, p.dmg * 0.5, p.owner, c);
  }

  // ---------- co-op replication ----------
  snapshot(evs: Ev[]) {
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      a: [r(this.time), this.wave, this.lives, Math.floor(this.gold), this.level, Math.floor(this.xp), this.xpNext, this.waveActive ? 1 : 0, r(this.queue.length ? -1 : this.nextWaveIn), this.over ? 1 : 0, this.won ? 1 : 0, this.kills, this.mods.cheap],
      u: [...this.unlocked].map((t) => TOWER_TYPES.indexOf(t)),
      e: this.enemies.map((e) => [e.id, ENEMY_TYPES.indexOf(e.type), r(e.x), r(e.z), r(e.yaw), Math.ceil(e.hp), Math.ceil(e.maxHp), Math.ceil(e.shield), e.slowT > 0 ? 1 : 0]),
      t: this.towers.map((t) => [t.id, TOWER_TYPES.indexOf(t.type), t.cx, t.cz, t.lvl, r(t.yaw), r(t.buff), t.spent]),
      p: this.projs.map((p) => [p.id, PROJ_KINDS.indexOf(p.kind), r(p.x), r(p.y), r(p.z), r(p.vx), r(p.vy), r(p.vz), p.tier]),
      z: this.zones.map((z) => [z.id, ZONE_KINDS.indexOf(z.kind), r(z.x), r(z.z), r(z.r), r(z.life)]),
      pl: this.players.map((p) => [r(p.energy), p.heroActive ? 1 : 0, p.heroTower, r(p.yaw), r(p.pitch), r(p.heroTime), r(p.heroDur), p.cds.map(r), p.pending[0] || [], p.pending.length, p.stats.cdr]),
      ev: evs.slice(-90).map((e) => { const o: Ev = { k: e.k }; for (const key in e) { const v = e[key]; o[key] = typeof v === 'number' ? r(v) : Array.isArray(v) ? v.map((n: unknown) => (typeof n === 'number' ? r(n) : n)) : v; } return o; }),
    };
  }
  /** Apply a host snapshot on a co-op client. Input is validated defensively. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applySnapshot(s: any) {
    const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    if (!s || !Array.isArray(s.a) || !Array.isArray(s.e) || !Array.isArray(s.t) || !Array.isArray(s.p) || !Array.isArray(s.z) || !Array.isArray(s.pl)) return;
    const a = s.a;
    this.time = num(a[0]); this.wave = num(a[1]) | 0; this.lives = num(a[2]) | 0; this.gold = num(a[3]); this.level = num(a[4]) | 0;
    this.xp = num(a[5]); this.xpNext = num(a[6], 1) || 1; this.waveActive = !!a[7]; this.nextWaveIn = num(a[8]);
    this.over = !!a[9]; this.won = !!a[10]; this.kills = num(a[11]) | 0; this.mods.cheap = Math.max(0.3, Math.min(1, num(a[12], 1)));
    if (Array.isArray(s.u)) { this.unlocked = new Set(s.u.map((i: number) => TOWER_TYPES[i | 0]).filter(Boolean)); }
    const em = new Map(this.enemies.map((e) => [e.id, e]));
    this.enemies = [];
    for (const v of s.e.slice(0, 600)) {
      if (!Array.isArray(v)) continue;
      const type = ENEMY_TYPES[num(v[1]) | 0];
      if (!type) continue;
      const d = ENEMIES[type];
      const e = em.get(v[0]) || { id: num(v[0]), type, x: 0, z: 0, y: d.y, yaw: 0, dist: 0, lane: 0, off: 0, hp: 1, maxHp: 1, shield: 0, maxShield: d.shield ? 1 : 0, shieldCd: 0, speed: d.speed, slowT: 0, slowF: 0, sing: 0, alive: true, r: d.r, armor: 0 };
      e.x = num(v[2]); e.z = num(v[3]); e.yaw = num(v[4]); e.hp = num(v[5]); e.maxHp = num(v[6], 1) || 1; e.shield = num(v[7]); e.slowT = v[8] ? 1 : 0;
      this.enemies.push(e);
    }
    const tm = new Map(this.towers.map((t) => [t.id, t]));
    this.towers = [];
    this.grid.set(this.map.grid);
    for (const v of s.t.slice(0, 500)) {
      if (!Array.isArray(v)) continue;
      const type = TOWER_TYPES[num(v[1]) | 0];
      const cx = num(v[2]) | 0, cz = num(v[3]) | 0;
      if (!type || cx < 0 || cz < 0 || cx >= GW || cz >= GH) continue;
      const t = tm.get(v[0]) || { id: num(v[0]), type, cx, cz, x: cellX(cx), z: cellZ(cz), lvl: 1, cd: 0, yaw: 0, buff: 0, spent: 0, h: TOWER_H[type] };
      t.lvl = Math.max(1, Math.min(3, num(v[4], 1) | 0)); t.yaw = num(v[5]); t.buff = num(v[6]); t.spent = num(v[7]);
      this.grid[cz * GW + cx] = 2;
      this.towers.push(t);
    }
    this.projs = [];
    for (const v of s.p.slice(0, 800)) {
      if (!Array.isArray(v)) continue;
      const kind = PROJ_KINDS[num(v[1]) | 0];
      if (!kind) continue;
      this.projs.push({ id: num(v[0]), kind, x: num(v[2]), y: num(v[3]), z: num(v[4]), vx: num(v[5]), vy: num(v[6]), vz: num(v[7]), tier: Math.max(0, Math.min(4, num(v[8]) | 0)), dmg: 0, owner: -1, target: 0, life: 1, pierce: 0, hit: [], aoe: 0, chain: 0, sx: 0, sz: 0, tx: 0, tz: 0, t: 0, T: 0 });
    }
    this.zones = [];
    for (const v of s.z.slice(0, 100)) {
      if (!Array.isArray(v)) continue;
      const kind = ZONE_KINDS[num(v[1]) | 0];
      if (kind) this.zones.push({ id: num(v[0]), kind, x: num(v[2]), z: num(v[3]), r: Math.min(30, num(v[4])), life: num(v[5]), tick: 0, dmg: 0, owner: -1, pd: 0 });
    }
    for (let i = 0; i < this.players.length && i < s.pl.length; i++) {
      const v = s.pl[i], p = this.players[i];
      if (!Array.isArray(v)) continue;
      p.energy = num(v[0]); p.heroActive = !!v[1]; p.heroTower = num(v[2]); p.yaw = num(v[3]); p.pitch = num(v[4]);
      p.heroTime = num(v[5]); p.heroDur = num(v[6], 14) || 14;
      if (Array.isArray(v[7])) p.cds = [num(v[7][0]), num(v[7][1]), num(v[7][2])];
      const offer = Array.isArray(v[8]) ? v[8].filter((id: unknown) => typeof id === 'string' && Object.hasOwn(CARD_BY_ID, id as string)).slice(0, 3) : [];
      const n = Math.max(0, Math.min(50, num(v[9]) | 0));
      p.pending = offer.length && n ? [offer, ...Array(n - 1).fill(offer)] : [];
      p.stats.cdr = num(v[10], 1) || 1;
    }
    if (Array.isArray(s.ev) && s.ev.length < 400) for (const e of s.ev) if (e && typeof e.k === 'string') this.events.push(e);
  }
}

export { CELL };
