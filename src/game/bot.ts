// Autoplayer: drives the menu attract mode, the trailer, and headless balance tests.
import { GW, GH, TOWERS, MAX_ENERGY, CARD_BY_ID, cellX, cellZ } from './data.ts';
import type { TowerType } from './data.ts';
import { Sim, PATH_POINTS, PATH_LEN, pathPos } from './sim.ts';

/** Buildable cells ranked by how much path they cover. */
function rankSpots(sim: Sim, range: number) {
  const out: { cx: number; cz: number; s: number }[] = [];
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (sim.grid[cz * GW + cx] !== 0) continue;
    const x = cellX(cx), z = cellZ(cz);
    let s = 0;
    for (let d = 8; d < PATH_LEN; d += 1.5) { pathPos(d, p); if (Math.hypot(p.x - x, p.z - z) <= range) s += 1 + d / PATH_LEN; }
    if (s > 0) { for (const t of sim.towers) if (Math.hypot(t.x - x, t.z - z) < 4.5) s -= 2.2; out.push({ cx, cz, s }); }
  }
  return out.sort((a, b) => b.s - a.s);
}

export class Bot {
  sim: Sim; pi: number;
  private think = 0;
  aim = { x: 0, y: 0.8, z: 0 };
  skill = 1;
  constructor(sim: Sim, pi = 0, skill = 1) { this.sim = sim; this.pi = pi; this.skill = skill; }

  private wanted(): TowerType {
    const s = this.sim, n = (t: TowerType) => s.towers.filter((x) => x.type === t).length;
    const has = (t: TowerType) => s.unlocked.has(t);
    const total = s.towers.length;
    if (has('cryo') && n('cryo') < 1 + Math.floor(total / 7) && total >= 2) return 'cryo';
    if (has('beacon') && n('beacon') < Math.floor(total / 8)) return 'beacon';
    if (has('rail') && n('rail') < Math.floor(total / 5)) return 'rail';
    if (has('mortar') && n('mortar') < Math.floor(total / 4)) return 'mortar';
    if (has('arc') && n('arc') < Math.floor(total / 3) + 1) return 'arc';
    return 'pulse';
  }

  step(dt: number) {
    const s = this.sim, p = s.players[this.pi];
    if (s.over) return;
    while (p.pending.length) {
      const o = p.pending[0];
      let best = 0, bv = -1;
      o.forEach((id, i) => { const c = CARD_BY_ID[id]; const v = (c.kind === 'blueprint' ? 10 : c.rar * 2 + (c.kind === 'tower' ? 2 : c.kind === 'hero' ? 1.5 : id === 'repair' && s.lives < 12 ? 6 : 0.5)) + Math.random(); if (v > bv) { bv = v; best = i; } });
      s.pickCard(this.pi, best);
    }
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.5 / this.skill;
      // upgrade or build
      const type = this.wanted();
      const up = s.towers.filter((t) => t.lvl < 3 && t.type !== 'beacon').sort((a, b) => s.upCost(a) - s.upCost(b))[0];
      if (up && s.towers.length >= 6 && s.gold >= s.upCost(up) && (s.upCost(up) < s.cost(type) * 1.4 || s.towers.length > 26)) s.upgrade(up.id);
      else if (s.gold >= s.cost(type) && s.towers.length < 40) {
        const spots = rankSpots(s, Math.min(TOWERS[type].range, 9));
        const pick = spots[Math.min(spots.length - 1, Math.floor(Math.random() * 3))];
        if (pick) s.build(type, pick.cx, pick.cz);
      }
      // ultimate
      if (!p.heroActive && p.energy >= MAX_ENERGY && s.enemies.length > 5 && s.towers.length) {
        const lead = s.enemies.reduce((a, b) => (b.dist > a.dist ? b : a));
        const t = s.towers.reduce((a, b) => (Math.hypot(b.x - lead.x, b.z - lead.z) < Math.hypot(a.x - lead.x, a.z - lead.z) ? b : a));
        s.activateHero(this.pi, t.id);
      }
    }
    if (p.heroActive) {
      const o = s.heroOrigin(this.pi);
      if (!o) return;
      let tgt = null as null | (typeof s.enemies)[number], bd = 1e9;
      for (const e of s.enemies) { const d = Math.hypot(e.x - o.x, e.z - o.z) - e.dist * 0.15; if (d < bd) { bd = d; tgt = e; } }
      if (tgt) {
        const k = Math.min(1, dt * 9);
        this.aim.x += (tgt.x - this.aim.x) * k; this.aim.y += (tgt.y - this.aim.y) * k; this.aim.z += (tgt.z - this.aim.z) * k;
        p.yaw = Math.atan2(this.aim.x - o.x, this.aim.z - o.z);
        p.pitch = Math.atan2(this.aim.y - o.y, Math.hypot(this.aim.x - o.x, this.aim.z - o.z));
        const dist = Math.hypot(tgt.x - o.x, tgt.z - o.z);
        if (dist < 45) {
          s.heroFire(this.pi, this.aim.x, this.aim.y, this.aim.z);
          if (s.enemies.length > 6) { s.heroSkill(this.pi, 1, tgt.x, 0, tgt.z); s.heroSkill(this.pi, 2, tgt.x, 0, tgt.z); }
          s.heroSkill(this.pi, 0, tgt.x, tgt.y, tgt.z);
        } else {
          const t = s.towers.reduce((a, b) => (Math.hypot(b.x - tgt!.x, b.z - tgt!.z) < Math.hypot(a.x - tgt!.x, a.z - tgt!.z) ? b : a));
          s.heroTeleport(this.pi, t.id);
        }
      }
    }
  }
}

export { PATH_POINTS };
