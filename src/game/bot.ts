// Autoplayer: drives the menu attract mode, the trailer, and headless balance tests. It builds and upgrades towers,
// picks cards and fires tower specials. It does not lay out a factory: the runs it plays have towers that need no supply (SimOpts.free).
import { GW, GH, TOWERS, ENEMIES, CARD_BY_ID, LINK_RANGE, WALL_HALF, FIRE_RING, cellX, cellZ } from './data.ts';
import type { TowerType, TargetMode } from './data.ts';
import { Sim, linkRange, segDist } from './sim.ts';
import type { Tower } from './sim.ts';
import { hexDist } from './hex.ts';

const P = { x: 0, z: 0, dx: 0, dz: 0, y: 0 };

/** Buildable cells ranked by how much road they cover. On maps with several roads, the road with the thinnest defence so far counts for more. */
function rankSpots(sim: Sim, range: number, spread = 4.5) {
  const out: { cx: number; cz: number; s: number }[] = [];
  const L = sim.map.lanes.length;
  // how well each road is already covered: metres of it inside the reach of the combat towers
  const need: number[] = [];
  if (L > 1) {
    let top = 0;
    for (let l = 0; l < L; l++) {
      const len = sim.map.lanes[l].len;
      let c = 0;
      for (let d = Math.min(8, len * 0.2); d < len; d += 1.5) { sim.map.pos(l, d, P); for (const t of sim.towers) if (t.type !== 'beacon' && Math.hypot(P.x - t.x, P.z - t.z) <= 7.5) c++; }
      need.push(c); top = Math.max(top, c);
    }
    for (let l = 0; l < L; l++) need[l] = (top + 12) / (need[l] + 12);
  }
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (sim.grid[cz * GW + cx] !== 0) continue;
    const x = cellX(cx, cz), z = cellZ(cz);
    let s = 0;
    for (let l = 0; l < L; l++) { const len = sim.map.lanes[l].len, w = (L > 1 ? need[l] : 1) / L; for (let d = Math.min(8, len * 0.2); d < len; d += 1.5) { sim.map.pos(l, d, P); if (Math.hypot(P.x - x, P.z - z) <= range) s += (1 + d / len) * w; } }
    if (s > 0) { for (const t of sim.towers) if (Math.hypot(t.x - x, t.z - z) < spread) s -= 2.2; out.push({ cx, cz, s }); }
  }
  return out.sort((a, b) => b.s - a.s);
}

/** Share of the defence each tower type should make up once it is unlocked. */
const SHARE: Partial<Record<TowerType, number>> = { pulse: 0.3, cryo: 0.1, arc: 0.15, mortar: 0.1, rail: 0.1, beacon: 0.06, flame: 0.1, lance: 0.1, missile: 0.1, gravity: 0.06 };

export class Bot {
  sim: Sim; pi: number;
  private think = 0;
  private seed: number;
  skill = 1;
  /** Focused build (balance tests): only these tower types, in these shares, and only the cards that feed them. */
  mix: Partial<Record<TowerType, number>> | null = null;
  /** Fire tower specials (balance tests switch this off to measure what the specials are worth). */
  useSpecials = true;
  /** Targeting modes the bot sets on the towers it builds (types left out keep their TARGET_DEFAULT). A Cryo Tower on 'fast' slows the
   *  runners first: a little better than 'first' in tools/balance.ts sweeps (the other modes tried were no better or worse). */
  aims: Partial<Record<TowerType, TargetMode>> = { cryo: 'fast' };
  constructor(sim: Sim, pi = 0, skill = 1) { this.sim = sim; this.pi = pi; this.skill = skill; this.seed = ((sim.opts.seed | 0) ^ (0x9e3779b9 * (pi + 1))) >>> 0; }

  private rnd() { let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  private count(type: TowerType) { let n = 0; for (const t of this.sim.towers) if (t.type === type) n++; return n; }

  /** The combat tower type the defence is shortest of. */
  private wanted(): TowerType {
    const s = this.sim;
    const total = s.towers.length;
    if (this.mix) {
      let best: TowerType = 'pulse', bv = -Infinity;
      for (const k in this.mix) { const t = k as TowerType; if (!s.unlocked.has(t)) continue; const v = this.mix[t]! * (total + 1) - this.count(t); if (v > bv) { bv = v; best = t; } }
      return best;
    }
    if (total < 2) return 'pulse';
    if (total === 2 && s.unlocked.has('cryo') && !this.count('cryo')) return 'cryo';
    let best: TowerType = 'pulse', bv = -Infinity, sum = 0;
    for (const t in SHARE) if (s.unlocked.has(t as TowerType)) sum += SHARE[t as TowerType]!;
    for (const k in SHARE) {
      const t = k as TowerType;
      if (!s.unlocked.has(t)) continue;
      const n = this.count(t);
      if (t === 'beacon' && (total < 6 || n >= Math.floor(total / 7))) continue;
      if (t === 'gravity' && n >= 1 + Math.floor(total / 12)) continue;
      if (t === 'cryo' && n >= 1 + Math.floor(total / 7)) continue;
      const v = (SHARE[t]! / sum) * (total + 1) - n;
      if (v > bv) { bv = v; best = t; }
    }
    return best;
  }

  private place(type: TowerType) {
    const s = this.sim;
    if (type === 'beacon') { // where it boosts the most towers
      let best = -1, bs = 0;
      const r = TOWERS.beacon.range;
      for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
        if (s.grid[cz * GW + cx] !== 0) continue;
        const x = cellX(cx, cz), z = cellZ(cz);
        let n = 0;
        for (const t of s.towers) { const d = Math.hypot(t.x - x, t.z - z); if (d <= r) n += t.type === 'beacon' ? -3 : t.buff > 0 ? 0.2 : 1; }
        if (n > bs) { bs = n; best = cz * GW + cx; }
      }
      if (best >= 0 && bs >= 3) return !!s.build('beacon', best % GW, Math.floor(best / GW));
      type = 'pulse';
    }
    if (type === 'flame') { if (this.placePylon()) return true; type = 'pulse'; }
    const short = type === 'gravity';
    const spots = rankSpots(s, Math.min(TOWERS[type].range * (short ? 0.85 : 1), 9), short ? 3.2 : 4.5);
    const pick = spots[Math.min(spots.length - 1, Math.floor(this.rnd() * 3))];
    return !!pick && !!s.build(type, pick.cx, pick.cz);
  }

  /**
   * Firewall Pylons go down in linked pairs with the wall across as much road as possible: first a partner for a pylon
   * that stands alone, otherwise whichever is worth more per pylon, extending a pylon that has a link to spare or starting a new pair.
   */
  private placePylon(): boolean {
    const s = this.sim, L = s.map.lanes.length, bonus = s.mods.flameLink, reach = WALL_HALF + 0.45;
    // the road as weighted samples, leaving out what an existing wall already covers
    const pts: { x: number; z: number; w: number }[] = [];
    for (let l = 0; l < L; l++) {
      const len = s.map.lanes[l].len;
      for (let d = Math.min(8, len * 0.2); d < len - 1; d += 1) {
        s.map.pos(l, d, P);
        if (!s.walls.some((w) => segDist(P.x, P.z, w.ax, w.az, w.bx, w.bz) <= reach)) pts.push({ x: P.x, z: P.z, w: (1 + d / len) / L });
      }
    }
    const cover = (ax: number, az: number, bx: number, bz: number) => { let v = 0; for (const q of pts) if (segDist(q.x, q.z, ax, az, bx, bz) <= reach) v += q.w; return v; };
    const free: { cx: number; cz: number; x: number; z: number }[] = [];
    for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
      if (s.grid[cz * GW + cx] !== 0) continue;
      const x = cellX(cx, cz), z = cellZ(cz);
      if (pts.some((q) => Math.hypot(q.x - x, q.z - z) <= 7)) free.push({ cx, cz, x, z });
    }
    const links = new Map<number, number>();
    for (const w of s.walls) { links.set(w.a, (links.get(w.a) || 0) + 1); links.set(w.b, (links.get(w.b) || 0) + 1); }
    let best: { cx: number; cz: number } | null = null, bv = 0.5;
    const pylons = s.towers.filter((t) => t.type === 'flame');
    const alone = pylons.filter((t) => !links.get(t.id));
    for (const t of alone.length ? alone : pylons.filter((o) => links.get(o.id)! < 2)) {
      const r = linkRange(t, bonus);
      for (const c of free) {
        const d = hexDist(t.cx, t.cz, c.cx, c.cz);
        if (d < 2 || d > r) continue;
        const v = cover(t.x, t.z, c.x, c.z);
        if (v > bv) { bv = v; best = c; }
      }
    }
    if (!(alone.length && best)) for (let i = 0; i < free.length; i++) for (let k = i + 1; k < free.length; k++) {
      const a = free[i], b = free[k], d = hexDist(a.cx, a.cz, b.cx, b.cz);
      if (d < 2 || d > LINK_RANGE + bonus) continue;
      const v = cover(a.x, a.z, b.x, b.z) * 0.55; // two pylons for one wall
      if (v > bv) { bv = v; best = a; }
    }
    return !!best && !!s.build('flame', best.cx, best.cz);
  }

  private cardValue(id: string) {
    const s = this.sim, c = CARD_BY_ID[id];
    if (!c) return -1;
    if (this.mix) {
      if (c.kind === 'blueprint') return Object.hasOwn(this.mix, id.slice(3)) ? 10 : 0.1;
      if (c.needs) return Object.hasOwn(this.mix, c.needs) ? 3.5 + c.rar : 0.05;
      return c.kind === 'eco' ? 1 : 2 + c.rar;
    }
    if (c.kind === 'blueprint') return 10;
    if (!this.useSpecials && (id === 'capbank' || id === 'reboot' || id === 'aftershock')) return 0.1;
    if (id === 'repair') return s.lives < 12 ? 7 : 0.3;
    // the factory cards only matter when the towers live on what the factory delivers
    let v = c.rar * 2 + (c.kind === 'tower' ? 2 : c.kind === 'factory' ? (s.opts.free ? 0.2 : 1.4) : 0.8);
    if (c.needs) { const n = this.count(c.needs); v = n ? v + Math.min(2, n * 0.5) : 0.6; }
    return v;
  }

  /** Enemies a tower's special would catch right now. */
  private specialWorth(t: Tower) {
    const s = this.sim, r = s.range(t);
    if (t.type === 'beacon') return s.enemies.length >= 8 && s.towers.some((o) => o !== t && o.buff > 0 && Math.hypot(o.x - t.x, o.z - t.z) <= r);
    let n = 0, heavy = false;
    if (t.type === 'flame') { // Inferno: what stands in or right before its walls (or its ring when it has no partner)
      const walls = s.walls.filter((w) => w.a === t.id || w.b === t.id);
      for (const e of s.enemies) {
        if (e.type === 'mite') continue;
        const near = walls.length ? walls.some((w) => w.on && segDist(e.x, e.z, w.ax, w.az, w.bx, w.bz) <= s.wallHalf(w) * 2 + 1 + e.r) : Math.hypot(e.x - t.x, e.z - t.z) <= FIRE_RING * 1.5 + 1 + e.r;
        if (!near) continue;
        n++;
        if (e.type === 'boss' || e.type === 'brute' || e.type === 'titan') heavy = true;
      }
      return n >= 4 || heavy;
    }
    const all = t.type === 'rail' || t.type === 'missile';
    for (const e of s.enemies) {
      if (e.type === 'mite' || (!all && Math.hypot(e.x - t.x, e.z - t.z) > r)) continue;
      if (t.type === 'mortar' && ENEMIES[e.type].fly) continue;
      n++;
      // a Gyre still spinning is worth a Flash Freeze or a Collapse on its own: both stop its rim. Every special is worth it on the Titan: its hull turns most ordinary fire.
      if (e.type === 'boss' || e.type === 'brute' || e.type === 'titan' || (e.type === 'wheel' && (e.spin > 0.5 ? t.type === 'cryo' || t.type === 'gravity' : true))) heavy = true;
    }
    return all ? n >= 8 || (heavy && n >= 1) : n >= 4 || heavy;
  }

  step(dt: number) {
    const s = this.sim, p = s.players[this.pi];
    if (s.over || !p) return;
    for (const t of s.towers) { const a = this.aims[t.type]; if (a && t.aim !== a) s.setAim(t.id, a); }
    while (p.pending.length) {
      const o = p.pending[0];
      let best = 0, bv = -Infinity;
      o.forEach((id, i) => { const v = this.cardValue(id) + this.rnd(); if (v > bv) { bv = v; best = i; } });
      s.pickCard(this.pi, best);
    }
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.5 / this.skill;
    const combat = s.towers.length;
    // upgrade or build
    const type = this.wanted();
    const up = s.towers.filter((t) => t.lvl < 3 && t.type !== 'beacon').sort((a, b) => s.upCost(a) - s.upCost(b))[0];
    if (up && combat >= 6 && s.gold >= s.upCost(up) && s.mats >= s.upMat(up) && (s.upCost(up) < s.cost(type) * 1.4 || combat > 26)) s.upgrade(up.id);
    else if (s.gold >= s.cost(type) && s.mats >= s.matCost(type) && combat < 40) this.place(type);
    // tower specials: fired when they would catch enough (or something big)
    if (this.useSpecials) for (const t of s.towers) if (s.specialReady(t) && this.specialWorth(t)) s.triggerSpecial(t.id, this.pi);
  }
}
