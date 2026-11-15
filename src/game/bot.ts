// Autoplayer: drives the menu attract mode, the trailer, and headless balance tests.
import { GW, GH, TOWERS, ENEMIES, ENEMY_SCALE, MAX_ENERGY, CARD_BY_ID, LINK_RANGE, WALL_HALF, FIRE_RING, TITAN_SLOW, cellX, cellZ } from './data.ts';
import type { TowerType } from './data.ts';
import { Sim, nodePos, weakPos, weakOpen, raySphere, linkRange, segDist, paceOf, ARROW_PAD, ARROW_SPEED } from './sim.ts';
import type { Enemy, Tower } from './sim.ts';
import { hexDist } from './hex.ts';

const P = { x: 0, z: 0, dx: 0, dz: 0, y: 0 };
const V = { x: 0, y: 0, z: 0 };

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
      for (let d = Math.min(8, len * 0.2); d < len; d += 1.5) { sim.map.pos(l, d, P); for (const t of sim.towers) if (t.type !== 'spire' && t.type !== 'beacon' && Math.hypot(P.x - t.x, P.z - t.z) <= 7.5) c++; }
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
  private teleCd = 0;
  private nodeHold = new Map<number, number>();
  private seed: number;
  /** Where the bow is pointing (eased, for the camera); the bot draws while it aims and looses at full draw once the aim has settled on the target. */
  aim = { x: 0, y: 0.8, z: 0 };
  skill = 1;
  /** Focused build (balance tests): only these tower types, in these shares, and only the cards that feed them. The Uplink is never used. */
  mix: Partial<Record<TowerType, number>> | null = null;
  /** With a focused build: use the Uplink as well (and value hero cards). */
  mixHero = false;
  /** Fire tower specials during the Uplink (balance tests switch this off to measure what the specials are worth). */
  useSpecials = true;
  /** Use the Uplink at all. Off: no extra Spires, no Spire upgrades, and hero and special cards are passed over (the no-hero balance runs). */
  useHero = true;
  constructor(sim: Sim, pi = 0, skill = 1) { this.sim = sim; this.pi = pi; this.skill = skill; this.seed = ((sim.opts.seed | 0) ^ (0x9e3779b9 * (pi + 1))) >>> 0; }

  private rnd() { let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  private count(type: TowerType) { let n = 0; for (const t of this.sim.towers) if (t.type === type) n++; return n; }

  /** The combat tower type the defence is shortest of. */
  private wanted(): TowerType {
    const s = this.sim;
    const total = s.towers.length - s.spires;
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
        for (const t of s.towers) { if (t.type === 'spire') continue; const d = Math.hypot(t.x - x, t.z - z); if (d <= r) n += t.type === 'beacon' ? -3 : t.buff > 0 ? 0.2 : 1; }
        if (n > bs) { bs = n; best = cz * GW + cx; }
      }
      if (best >= 0 && bs >= 3) return !!s.build('beacon', best % GW, Math.floor(best / GW));
      type = 'pulse';
    }
    if (type === 'spire') { // good view of the roads, far from the other Spires
      let best = -1, bs = -Infinity;
      for (const q of rankSpots(s, 15, 0)) {
        let near = 1e9;
        for (const t of s.towers) if (t.type === 'spire') near = Math.min(near, Math.hypot(t.x - cellX(q.cx, q.cz), t.z - cellZ(q.cz)));
        if (near < 12) continue;
        const v = q.s + Math.min(30, near) * 0.25;
        if (v > bs) { bs = v; best = q.cz * GW + q.cx; }
      }
      return best >= 0 && !!s.build('spire', best % GW, Math.floor(best / GW));
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
      if (this.mixHero ? false : c.kind === 'hero' || id === 'capbank' || id === 'reboot' || id === 'aftershock') return 0.1;
      if (c.kind === 'hero') return 1.6 + c.rar * 2;
      if (c.kind === 'blueprint') return Object.hasOwn(this.mix, id.slice(3)) ? 10 : 0.1;
      if (c.needs) return Object.hasOwn(this.mix, c.needs) ? 3.5 + c.rar : 0.05;
      return c.kind === 'eco' ? 1 : 2 + c.rar;
    }
    if (c.kind === 'blueprint') return 10;
    if (!this.useHero && (c.kind === 'hero' || id === 'capbank' || id === 'reboot' || id === 'aftershock' || id === 'b_feed')) return 0.1;
    if (id === 'repair') return s.lives < 12 ? 7 : 0.3;
    let v = c.rar * 2 + (c.kind === 'tower' ? 2 : c.kind === 'hero' ? 1.6 : 0.8);
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
      // a Gyre still spinning is worth a Flash Freeze or a Collapse on its own: both stop its rim. Every special is worth it on the Titan: nothing else the towers do hurts it.
      if (e.type === 'boss' || e.type === 'brute' || e.type === 'titan' || (e.type === 'wheel' && (e.spin > 0.5 ? t.type === 'cryo' || t.type === 'gravity' : true))) heavy = true;
    }
    return all ? n >= 8 || (heavy && n >= 1) : n >= 4 || heavy;
  }

  step(dt: number) {
    const s = this.sim, p = s.players[this.pi];
    if (s.over || !p) return;
    while (p.pending.length) {
      const o = p.pending[0];
      let best = 0, bv = -Infinity;
      o.forEach((id, i) => { const v = this.cardValue(id) + this.rnd(); if (v > bv) { bv = v; best = i; } });
      s.pickCard(this.pi, best);
    }
    this.think -= dt; this.teleCd -= dt;
    if (this.think <= 0) {
      this.think = 0.5 / this.skill;
      const combat = s.towers.length - s.spires;
      // a second Spire mid-game (a third on the big multi-lane maps), so Kestrel can follow the fight
      const wantSpires = s.wave >= 18 && s.map.lanes.length > 1 ? 3 : s.wave >= (s.map.lanes.length > 1 ? 6 : 9) ? 2 : 1;
      if (this.useHero && (!this.mix || this.mixHero) && s.spires < wantSpires && combat >= 6 && s.unlocked.has('spire') && s.gold >= s.cost('spire') + 60) this.place('spire');
      else {
        // upgrade or build
        const type = this.wanted();
        const up = s.towers.filter((t) => t.lvl < 3 && t.type !== 'beacon' && (t.type !== 'spire' || (this.useHero && s.wave >= 14))).sort((a, b) => s.upCost(a) - s.upCost(b))[0];
        if (up && combat >= 6 && s.gold >= s.upCost(up) && (s.upCost(up) < s.cost(type) * 1.4 || combat > 26)) s.upgrade(up.id);
        else if (s.gold >= s.cost(type) && combat < 40) this.place(type);
      }
      // ultimate: uplink to the Spire closest to the head of the attack
      // (a full charge is kept for a Colossus when the wave intel shows one coming and the field is quiet)
      const bossNow = s.enemies.some((e) => e.type === 'boss' || e.type === 'wheel');
      const bossSoon = !bossNow && (s.queue.some((q) => q.type === 'boss') || (s.preview.lanes.some((l) => l.some((o) => o.type === 'boss')) && s.enemies.length < 12));
      let field = 0;
      for (const e of s.enemies) if (e.type !== 'mite') field++;
      // while the Titan walks the Uplink is held open for everyone: always take it, also in the runs that otherwise play without the hero
      const titan = s.overlink && !p.heroActive && s.spires > 0;
      if (titan || (this.useHero && (!this.mix || this.mixHero) && !p.heroActive && p.energy >= MAX_ENERGY && s.spires > 0 && !bossSoon && (field > 5 || bossNow))) {
        const sp = this.bestSpire();
        if (sp && s.activateHero(this.pi, sp.id)) { const o = s.heroOrigin(this.pi); if (o) { this.aim.x = o.x; this.aim.y = 1; this.aim.z = o.z + 6; } }
      }
    }
    if (p.heroActive) this.fight(dt);
  }

  private progress(e: Enemy) { return e.dist - this.sim.map.lanes[e.lane].len; }

  /** The Spire nearest to the enemies that are furthest along. */
  private bestSpire(): Tower | null {
    const s = this.sim;
    if (!s.enemies.length) return s.towers.find((t) => t.type === 'spire') || null;
    const lead = s.enemies.reduce((a, b) => (this.progress(b) > this.progress(a) ? b : a));
    let best: Tower | null = null, bd = Infinity;
    for (const t of s.towers) {
      if (t.type !== 'spire') continue;
      let d = Math.hypot(t.x - lead.x, t.z - lead.z);
      for (const e of s.enemies) if (Math.hypot(e.x - t.x, e.z - t.z) < 22) d -= 0.4;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /** The Titan's weak point worth the most that an arrow from `o` reaches before it meets the hull (the same test the sim applies), or -1. */
  private titanWeak(e: Enemy, o: { x: number; y: number; z: number }): number {
    const wk = ENEMIES.titan.weak!;
    let best = -1, bm = 0;
    for (let i = 0; i < wk.length; i++) {
      if (wk[i].mul <= bm || !weakPos(e, i, V)) continue;
      const dx = V.x - o.x, dy = V.y - o.y, dz = V.z - o.z, L = Math.hypot(dx, dy, dz) || 1;
      if (L > 62 || !weakOpen(e, i, dx, dz)) continue;
      const ub = raySphere(o.x, o.y, o.z, dx / L, dy / L, dz / L, e.x, e.y, e.z, e.r + ARROW_PAD);
      const uw = raySphere(o.x, o.y, o.z, dx / L, dy / L, dz / L, V.x, V.y, V.z, wk[i].r * ENEMY_SCALE.titan);
      if (ub >= 0 && uw > ub + 0.2) continue; // the hull is in the way from here
      bm = wk[i].mul; best = i;
    }
    return best;
  }

  private fight(dt: number) {
    const s = this.sim, p = s.players[this.pi];
    const o = s.heroOrigin(this.pi);
    if (!o) return;
    // 1. a charged power node whose special is worth firing
    let want: { x: number; y: number; z: number } | null = null, tol = 0.03, node = 0;
    let tgt: Enemy | null = null;
    if (this.useSpecials) for (const t of s.towers) {
      if (!s.specialReady(t) || (this.nodeHold.get(t.id) || 0) > s.time || !this.specialWorth(t)) continue;
      nodePos(t, V);
      if (Math.hypot(V.x - o.x, V.z - o.z) > 60) continue;
      want = { x: V.x, y: V.y, z: V.z }; node = t.id; tol = 0.012;
      break;
    }
    // 2. otherwise the most dangerous enemy in reach (the Titan before everything, then a Colossus, a Gyre, a Brute)
    let bd = 1e9, mite: Enemy | null = null, md = 45, heavy = false;
    for (const e of s.enemies) {
      if (e.type === 'mite') { // mites sitting on a tower with time left: worth an arrow each to get the tower back
        const d = Math.hypot(e.x - o.x, e.z - o.z);
        if (e.latched && e.ttl > 2 && d < md) { md = d; mite = e; }
        continue;
      }
      if (e.type === 'boss' || e.type === 'titan') heavy = true;
      const d = Math.hypot(e.x - o.x, e.z - o.z) + this.progress(e) * -0.15 - (e.type === 'titan' ? 1000 : e.type === 'boss' ? 10 : e.type === 'wheel' ? 6 : e.type === 'brute' ? 3 : 0); // full-draw arrows cut through half of a Gyre's guard
      if (d < bd) { bd = d; tgt = e; }
    }
    const titan = tgt && tgt.type === 'titan' ? tgt : null;
    if (titan && this.teleCd <= 0 && s.spires > 1) {
      // stand where a weak point shows: the Spire with the best one in view, the nearest of those
      const here = this.titanWeak(titan, o), wk = ENEMIES.titan.weak!;
      let best: Tower | null = null, bv = here >= 0 ? wk[here].mul - Math.hypot(titan.x - o.x, titan.z - o.z) * 0.01 + 0.4 : -1;
      for (const t of s.towers) {
        if (t.type !== 'spire' || t.id === p.heroTower) continue;
        const from = { x: t.x, y: o.y - (s.towerById(p.heroTower)?.h ?? t.h) + t.h, z: t.z }, i = this.titanWeak(titan, from);
        const v = i >= 0 ? wk[i].mul - Math.hypot(titan.x - t.x, titan.z - t.z) * 0.01 : -1;
        if (v > bv) { bv = v; best = t; }
      }
      this.teleCd = 1.5;
      if (best && s.heroTeleport(this.pi, best.id)) return;
    }
    if (!want && mite && !heavy) { want = { x: mite.x, y: mite.y, z: mite.z }; tgt = mite; tol = 0.006; }
    else if (!want && tgt) {
      const dist = Math.hypot(tgt.x - o.x, tgt.y - o.y, tgt.z - o.z), T = dist / ARROW_SPEED;
      const held = tgt.breach > 0 ? 0 : titan ? 1 - TITAN_SLOW * Math.max(tgt.slowT > 0 ? tgt.slowF : 0, tgt.frz > 0 ? 1 : 0, tgt.sing > 0 ? 0.9 : 0) : (tgt.slowT > 0 ? 1 - tgt.slowF : 1) * (tgt.frz > 0 || tgt.sing > 0 ? 0 : 1);
      const v = paceOf(tgt) * held * T;
      const lx = Math.sin(tgt.yaw) * v, lz = Math.cos(tgt.yaw) * v;
      want = { x: tgt.x + lx, y: tgt.y, z: tgt.z + lz };
      // a weak point, when one can be reached before the hull is in the way
      const wk = ENEMIES[tgt.type].weak;
      if (titan) {
        const i = this.titanWeak(titan, o);
        if (i >= 0 && weakPos(titan, i, V)) { want = { x: V.x + lx, y: V.y, z: V.z + lz }; tol = 0.015; }
      } else if (wk) for (let i = 0; i < wk.length; i++) {
        if (!weakPos(tgt, i, V)) continue;
        const dx = V.x - o.x, dy = V.y - o.y, dz = V.z - o.z, L = Math.hypot(dx, dy, dz) || 1;
        const ub = raySphere(o.x, o.y, o.z, dx / L, dy / L, dz / L, tgt.x, tgt.y, tgt.z, tgt.r + ARROW_PAD);
        if (ub >= 0 && ub < L - wk[i].r * ENEMY_SCALE[tgt.type] - 0.2) continue; // the hull is in front of it from here
        want = { x: V.x + lx, y: V.y, z: V.z + lz }; tol = 0.015;
        break;
      }
    }
    // nothing to shoot at: keep whatever draw there is on the string
    if (!want) { if (p.drawing) s.heroAim(this.pi, true, this.aim.x, this.aim.y, this.aim.z); return; }
    // ease the bow onto the target while drawing; loose at full draw once the aim has settled
    const k = Math.min(1, dt * 14);
    this.aim.x += (want.x - this.aim.x) * k; this.aim.y += (want.y - this.aim.y) * k; this.aim.z += (want.z - this.aim.z) * k;
    p.yaw = Math.atan2(this.aim.x - o.x, this.aim.z - o.z);
    p.pitch = Math.atan2(this.aim.y - o.y, Math.hypot(this.aim.x - o.x, this.aim.z - o.z));
    const wl = Math.hypot(want.x - o.x, want.y - o.y, want.z - o.z) || 1;
    const settled = Math.hypot(this.aim.x - want.x, this.aim.y - want.y, this.aim.z - want.z) / wl < tol * 3;
    const ready = settled && p.drawing && p.draw >= 1;
    if (node) {
      s.heroAim(this.pi, !ready, want.x, want.y, want.z);
      if (ready) this.nodeHold.set(node, s.time + 1.2);
      return;
    }
    if (!tgt) return;
    const dist = Math.hypot(tgt.x - o.x, tgt.z - o.z);
    // follow the fight: hop to a Spire that is clearly closer
    if (this.teleCd <= 0 && s.spires > 1 && !titan && tgt.type !== 'mite') {
      let best: Tower | null = null, bdist = dist - 9;
      for (const t of s.towers) { if (t.type !== 'spire' || t.id === p.heroTower) continue; const d = Math.hypot(t.x - tgt.x, t.z - tgt.z); if (d < bdist) { bdist = d; best = t; } }
      if (best && s.heroTeleport(this.pi, best.id)) { this.teleCd = 2.5; return; }
    }
    const loose = ready && dist < 60;
    s.heroAim(this.pi, !loose, want.x, want.y, want.z);
    if (loose) {
      // skills go right after an arrow has left, so they never cost a draw in progress
      if (tgt.type === 'mite') return;
      // Arrow Rain and Singularity only slow the Titan: they are kept for its last stretch and for when it stands at the core
      if (titan ? titan.breach > 0 || this.progress(titan) > -0.3 * s.map.lanes[titan.lane].len : s.enemies.length > 6) { s.heroSkill(this.pi, 1, tgt.x, tgt.gy, tgt.z); s.heroSkill(this.pi, 2, tgt.x, tgt.gy, tgt.z); }
      s.heroSkill(this.pi, 0, want.x, want.y, want.z);
    }
  }
}
