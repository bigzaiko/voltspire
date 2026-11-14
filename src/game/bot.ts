// Autoplayer: drives the menu attract mode, the trailer, and headless balance tests.
import { GW, GH, TOWERS, ENEMIES, ENEMY_SCALE, MAX_ENERGY, CARD_BY_ID, cellX, cellZ } from './data.ts';
import type { TowerType } from './data.ts';
import { Sim, nodePos, weakPos, raySphere, ARROW_PAD } from './sim.ts';
import type { Enemy, Tower } from './sim.ts';

const P = { x: 0, z: 0, dx: 0, dz: 0, y: 0 };
const V = { x: 0, y: 0, z: 0 };

/** Buildable cells ranked by how much road they cover. */
function rankSpots(sim: Sim, range: number, spread = 4.5) {
  const out: { cx: number; cz: number; s: number }[] = [];
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (sim.grid[cz * GW + cx] !== 0) continue;
    const x = cellX(cx, cz), z = cellZ(cz);
    let s = 0;
    for (let l = 0; l < sim.map.lanes.length; l++) { const len = sim.map.lanes[l].len; for (let d = Math.min(8, len * 0.2); d < len; d += 1.5) { sim.map.pos(l, d, P); if (Math.hypot(P.x - x, P.z - z) <= range) s += (1 + d / len) / sim.map.lanes.length; } }
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
  /** Where the bow is pointing (eased, for the camera); arrows are loosed once it has settled on the target. */
  aim = { x: 0, y: 0.8, z: 0 };
  skill = 1;
  /** Focused build (balance tests): only these tower types, in these shares, and only the cards that feed them. The Uplink is never used. */
  mix: Partial<Record<TowerType, number>> | null = null;
  /** With a focused build: use the Uplink as well (and value hero cards). */
  mixHero = false;
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
    const short = type === 'flame' || type === 'gravity';
    const spots = rankSpots(s, Math.min(TOWERS[type].range * (short ? 0.85 : 1), 9), short ? 3.2 : 4.5);
    const pick = spots[Math.min(spots.length - 1, Math.floor(this.rnd() * 3))];
    return !!pick && !!s.build(type, pick.cx, pick.cz);
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
    const all = t.type === 'rail' || t.type === 'missile';
    for (const e of s.enemies) {
      if (!all && Math.hypot(e.x - t.x, e.z - t.z) > r) continue;
      if (t.type === 'mortar' && ENEMIES[e.type].fly) continue;
      n++;
      if (e.type === 'boss' || e.type === 'brute') heavy = true;
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
      if ((!this.mix || this.mixHero) && s.spires < wantSpires && combat >= 6 && s.unlocked.has('spire') && s.gold >= s.cost('spire') + 60) this.place('spire');
      else {
        // upgrade or build
        const type = this.wanted();
        const up = s.towers.filter((t) => t.lvl < 3 && t.type !== 'beacon' && (t.type !== 'spire' || s.wave >= 14)).sort((a, b) => s.upCost(a) - s.upCost(b))[0];
        if (up && combat >= 6 && s.gold >= s.upCost(up) && (s.upCost(up) < s.cost(type) * 1.4 || combat > 26)) s.upgrade(up.id);
        else if (s.gold >= s.cost(type) && combat < 40) this.place(type);
      }
      // ultimate: uplink to the Spire closest to the head of the attack
      // (a full charge is kept for a Colossus when the wave intel shows one coming and the field is quiet)
      const bossNow = s.enemies.some((e) => e.type === 'boss');
      const bossSoon = !bossNow && (s.queue.some((q) => q.type === 'boss') || (s.preview.lanes.some((l) => l.some((o) => o.type === 'boss')) && s.enemies.length < 12));
      if ((!this.mix || this.mixHero) && !p.heroActive && p.energy >= MAX_ENERGY && s.spires > 0 && !bossSoon && (s.enemies.length > 5 || bossNow)) {
        const sp = this.bestSpire();
        if (sp) { s.activateHero(this.pi, sp.id); const o = s.heroOrigin(this.pi); if (o) { this.aim.x = o.x; this.aim.y = 1; this.aim.z = o.z + 6; } }
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

  private fight(dt: number) {
    const s = this.sim, p = s.players[this.pi];
    const o = s.heroOrigin(this.pi);
    if (!o) return;
    // 1. a charged power node whose special is worth firing
    let want: { x: number; y: number; z: number } | null = null, tol = 0.03, node = 0;
    let tgt: Enemy | null = null;
    for (const t of s.towers) {
      if (!s.specialReady(t) || (this.nodeHold.get(t.id) || 0) > s.time || !this.specialWorth(t)) continue;
      nodePos(t, V);
      if (Math.hypot(V.x - o.x, V.z - o.z) > 60) continue;
      want = { x: V.x, y: V.y, z: V.z }; node = t.id; tol = 0.012;
      break;
    }
    // 2. otherwise the most dangerous enemy in reach
    let bd = 1e9;
    for (const e of s.enemies) {
      const d = Math.hypot(e.x - o.x, e.z - o.z) + this.progress(e) * -0.15 - (e.type === 'boss' ? 10 : e.type === 'brute' ? 3 : 0);
      if (d < bd) { bd = d; tgt = e; }
    }
    if (!want && tgt) {
      const dist = Math.hypot(tgt.x - o.x, tgt.y - o.y, tgt.z - o.z), T = dist / 85;
      const v = tgt.speed * (tgt.slowT > 0 ? 1 - tgt.slowF : 1) * (tgt.frz > 0 || tgt.sing > 0 ? 0 : 1) * T;
      const lx = Math.sin(tgt.yaw) * v, lz = Math.cos(tgt.yaw) * v;
      want = { x: tgt.x + lx, y: tgt.y, z: tgt.z + lz };
      // a weak point, when one can be reached before the hull is in the way
      const wk = ENEMIES[tgt.type].weak;
      if (wk) for (let i = 0; i < wk.length; i++) {
        if (!weakPos(tgt, i, V)) continue;
        const dx = V.x - o.x, dy = V.y - o.y, dz = V.z - o.z, L = Math.hypot(dx, dy, dz) || 1;
        const ub = raySphere(o.x, o.y, o.z, dx / L, dy / L, dz / L, tgt.x, tgt.y, tgt.z, tgt.r + ARROW_PAD);
        if (ub >= 0 && ub < L - wk[i].r * ENEMY_SCALE[tgt.type] - 0.2) continue; // the hull is in front of it from here
        want = { x: V.x + lx, y: V.y, z: V.z + lz }; tol = 0.015;
        break;
      }
    }
    if (!want) return;
    // ease the bow onto the target; loose once it has settled
    const k = Math.min(1, dt * 14);
    this.aim.x += (want.x - this.aim.x) * k; this.aim.y += (want.y - this.aim.y) * k; this.aim.z += (want.z - this.aim.z) * k;
    p.yaw = Math.atan2(this.aim.x - o.x, this.aim.z - o.z);
    p.pitch = Math.atan2(this.aim.y - o.y, Math.hypot(this.aim.x - o.x, this.aim.z - o.z));
    const wl = Math.hypot(want.x - o.x, want.y - o.y, want.z - o.z) || 1;
    const settled = Math.hypot(this.aim.x - want.x, this.aim.y - want.y, this.aim.z - want.z) / wl < tol * 3;
    if (node) {
      if (settled && p.fireCd <= 0) { s.heroFire(this.pi, want.x, want.y, want.z); this.nodeHold.set(node, s.time + 1.2); }
      return;
    }
    if (!tgt) return;
    const dist = Math.hypot(tgt.x - o.x, tgt.z - o.z);
    // follow the fight: hop to a Spire that is clearly closer
    if (this.teleCd <= 0 && s.spires > 1) {
      let best: Tower | null = null, bdist = dist - 9;
      for (const t of s.towers) { if (t.type !== 'spire' || t.id === p.heroTower) continue; const d = Math.hypot(t.x - tgt.x, t.z - tgt.z); if (d < bdist) { bdist = d; best = t; } }
      if (best && s.heroTeleport(this.pi, best.id)) { this.teleCd = 2.5; return; }
    }
    if (dist < 60 && settled) {
      s.heroFire(this.pi, want.x, want.y, want.z);
      if (s.enemies.length > 6) { s.heroSkill(this.pi, 1, tgt.x, 0, tgt.z); s.heroSkill(this.pi, 2, tgt.x, 0, tgt.z); }
      s.heroSkill(this.pi, 0, want.x, want.y, want.z);
    }
  }
}
