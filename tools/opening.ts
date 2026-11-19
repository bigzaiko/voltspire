// The opening under the real rules, played by a script that uses Transfer Arms only: node tools/opening.ts [waves=5] [seeds=3]
// Per map: a Pulse Turret beside each iron ore crate (the crate feeds it by itself), then mine > arm > turret lines from the
// map's arm lines (deposits.ts, rule f) as far as the credits go, more lines and Mk2 upgrades between waves, cards picked
// for belts and the Pulse Turret. Waves are called as soon as the build is done. Prints, per map and seed, the core
// integrity left after each wave and what was built, so the start budget and the arm costs can be tuned.
import { Sim } from '../src/game/sim.ts';
import { MAPS, mapById } from '../src/game/maps.ts';
import { FACS, TOWERS, GW, CARD_BY_ID } from '../src/game/data.ts';
import { armLines } from '../src/game/deposits.ts';
import type { ArmLine } from '../src/game/deposits.ts';
import type { MapDef } from '../src/game/map.ts';
import { neighbor, inBoard } from '../src/game/hex.ts';

const WAVES = +(process.argv[2] || 5) || 5, SEEDS = +(process.argv[3] || 3) || 3;
const PREFER = ['belts', 'p_dmg', 'hollow', 'p_servo', 'overclock', 'twin', 'p_crit', 'salvage', 'drop', 'optics'];

export interface OpeningResult { map: string; seed: number; lives: number[]; maxLives: number; lines: number; turrets: number; mk2: number; delivered: number; gold: number; over: boolean; waves: number; first: string; start: number }
/** Play the opening of one run (see the header). `after` is called in the build phase after each wave and may hand back a Sim to go on with (a restored save). */
export function playOpening(def: MapDef, seed: number, waves = WAVES, diff = 'normal', after?: (s: Sim, wave: number) => Sim | void): OpeningResult {
  let s = new Sim({ seed, map: def, pauseOnCards: false, diff });
  s.autoWaves = false; // (each wave is called once the build is done)
  const al = armLines(def), used = new Set<number>(), lines: ArmLine[] = [];
  const key = (c: [number, number]) => c[1] * GW + c[0];
  const free = (c: [number, number]) => !used.has(key(c)) && s.grid[key(c)] === 0;
  const lineCost = (l: ArmLine) => FACS.mine.cost * (s.factory.facAt(...l.mine)?.type === 'mine' ? 0 : 1) + FACS.arm.cost * l.arms.length + s.cost('pulse');
  const tryLine = (l: ArmLine) => {
    const mine = s.factory.facAt(...l.mine), shared = mine && mine.type === 'mine';
    if (!(shared || free(l.mine)) || !l.arms.every(free) || !free(l.turret) || s.gold < lineCost(l)) return false;
    if (!shared && !s.buildFac('mine', ...l.mine)) return false;
    for (const a of l.arms) s.buildFac('arm', a[0], a[1], l.dir);
    s.build('pulse', ...l.turret);
    for (const c of [l.mine, ...l.arms, l.turret]) used.add(key(c));
    lines.push(l);
    return true;
  };
  const build = () => {
    // a turret beside every iron ore crate first (the crate feeds it by itself)
    for (const c of s.factory.facs.filter((f) => f.type === 'crate' && f.hold === 'iron_ore' && f.left > 0)) {
      const nbs = [0, 1, 2, 3, 4, 5].map((d) => neighbor(c.cx, c.cz, d)).filter(([x, z]) => inBoard(x, z) && s.grid[z * GW + x] === 0 && !used.has(z * GW + x));
      if (s.towers.some((t) => Math.abs(t.cx - c.cx) + Math.abs(t.cz - c.cz) <= 2 && nbs.length < 6)) { /* (one is enough) */ }
      if (s.towers.some((t) => [0, 1, 2, 3, 4, 5].some((d) => { const [x, z] = neighbor(c.cx, c.cz, d); return x === t.cx && z === t.cz; }))) continue;
      const road = nbs.find(([x, z]) => [0, 1, 2, 3, 4, 5].some((d) => { const [u, v] = neighbor(x, z, d); return inBoard(u, v) && s.map.grid[v * GW + u] === 1; }));
      if (road && s.gold >= s.cost('pulse')) { s.build('pulse', ...road); used.add(key(road)); }
    }
    // arm lines: each crate's own first, then any
    for (let pass = 0; pass < 3; pass++) for (const ls of al.crates) { const l = ls.find((x) => !lines.includes(x) && tryLine(x)); if (l) break; }
    for (const l of al.all) if (lines.length < 2 + s.wave) tryLine(l);
    // Mk2 for the turrets once the lines stand
    if (s.wave >= 2) for (const t of s.towers) if (t.type === 'pulse' && t.lvl === 1 && s.gold >= s.upCost(t) + 30) s.upgrade(t.id);
  };
  const cards = () => {
    for (const p of s.players) while (p.pending.length) {
      const o = p.pending[0];
      let i = o.findIndex((id) => PREFER.includes(id));
      for (const id of PREFER) { const k = o.indexOf(id); if (k >= 0) { i = k; break; } }
      s.pickCard(0, Math.max(0, i));
    }
  };
  const lives: number[] = [], start = Math.round(s.gold);
  let first = '';
  for (let w = 1; w <= waves && !s.over; w++) {
    cards(); build();
    if (w === 1) first = `${s.towers.filter((t) => t.type === 'pulse').length} turrets, ${lines.length} arm lines, ${Math.round(s.gold)} left`;
    s.startWave();
    for (let i = 0; i < 60 * 240 && !s.over && !s.planning; i++) { s.step(1 / 60); s.events.length = 0; cards(); }
    lives.push(s.lives);
    // (tools/smoke.ts: a save taken here and restored carries on in place of the original)
    if (after) s = after(s, w) || s;
  }
  return {
    map: def.id, seed, lives, maxLives: s.maxLives, lines: lines.length, turrets: s.towers.filter((t) => t.type === 'pulse').length,
    mk2: s.towers.filter((t) => t.lvl >= 2).length, delivered: s.factory.delivered, gold: Math.round(s.gold), over: s.over, waves: s.wave, first, start,
  };
}

if (import.meta.main) {
  const maps = ['switchback', 'spiral', 'crossfire'].map((id) => mapById(id) || MAPS[0]);
  console.log(`opening, ${WAVES} waves, normal, start credits = map credits x 1.5; Transfer Arm ${FACS.arm.cost}, Mine ${FACS.mine.cost}, Pulse Turret ${TOWERS.pulse.cost}; cards preferred: ${PREFER.slice(0, 3).map((id) => CARD_BY_ID[id]?.name).join(', ')}`);
  for (const m of maps) for (let k = 0; k < SEEDS; k++) {
    const r = playOpening(m, 100 + k);
    console.log(`${r.map.padEnd(11)} seed ${r.seed}: start ${r.start} cr, wave 1 with ${r.first}; core ${r.lives.join(' > ')} of ${r.maxLives}${r.over ? ' LOST' : ''}; ${r.lines} arm lines, ${r.turrets} turrets (${r.mk2} Mk2), ${r.delivered} ore delivered by arms, ${r.gold} credits left`);
  }
}
