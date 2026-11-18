// Simulation benchmark (Node, no DOM): node tools/bench.ts [--hash] [--secs N]
// Builds a large factory deterministically under the real rules (12 mines, Transfer Arms onto and off 150+ belts carrying items,
// a power grid with poles, pipes from the pumpjacks, 12 or more supplied towers), calls waves and runs the sim at 60 steps a second.
// Default: prints ms per sim step (mean, p50, p99) and heap / allocation deltas, so regressions show up later.
// --hash: runs a fixed recording (same seed, 3 waves) and prints a hash of the whole end state. The hash must not change
// when the sim or factory code is only made faster.
import { Sim } from '../src/game/sim.ts';
import { GW, GH, FAC_TYPES, TOWER_TYPES } from '../src/game/data.ts';
import type { TowerType } from '../src/game/data.ts';
import { neighbor, hexDist } from '../src/game/hex.ts';
import { MAPS, mapById } from '../src/game/maps.ts';
import { Bot } from '../src/game/bot.ts';

const args = typeof process === 'undefined' ? [] : process.argv.slice(2);
const HASH = args.includes('--hash');
const secs = Number(args[args.indexOf('--secs') + 1]) || 60;

/** The large factory (on Trident, which has room for the merged line): an arm puts every mine's ore on a belt line, an arm at its end feeds its own tower; generators and poles power the rest; pumps fill pipes. */
export function bigFactory(seed = 7): Sim { return buildBig(new Sim({ seed, map: mapById('trident') || MAPS[0], pauseOnCards: false })); }
/** Lay the large factory out on a sim's board (also used by the browser profiling scripts on the game's own sim). */
export function buildBig(sim: Sim): Sim {
  sim.gold = 1e7; sim.mats = 1e5; sim.lives = sim.maxLives = 1e6;
  for (const t of TOWER_TYPES) sim.unlocked.add(t);
  for (const f of FAC_TYPES) sim.facs.add(f);
  const F = sim.factory;
  const free = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < GW && cz < GH && sim.grid[cz * GW + cx] === 0;
  const nearRoad = (cx: number, cz: number) => { for (let d = 0; d < 6; d++) { const [x, z] = neighbor(cx, cz, d); if (x >= 0 && z >= 0 && x < GW && z < GH && sim.map.grid[z * GW + x] === 1) return true; } return false; };
  const deps: { cx: number; cz: number; o: string }[] = [];
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) { const o = F.oreAt(cx, cz); if (o && free(cx, cz)) deps.push({ cx, cz, o }); }
  // a merged line: arms put the ore of iron, copper and coal mines on one belt that runs past a pulse turret, a railgun, a
  // generator and a smelter, each fed by an arm off the line (filters by what its target takes), through a splitter
  // (deposits laid down by hand on a free row, so the mixed-belt, side pick and splitter paths all run)
  let merged = 0;
  for (const dU of [4, 2, 5, 1]) for (let cz = 2; cz < GH - 2 && !merged; cz++) for (let x0 = 0; x0 + 11 <= GW && !merged; x0++) {
    const dD = (dU + 3) % 6 === 1 ? 2 : (dU + 3) % 6 === 5 ? 4 : (dU + 3) % 6; // (the other side of the row)
    const row: [number, number][] = [];
    let c: [number, number] = [x0, cz];
    for (let k = 0; k < 11; k++) { row.push(c); c = neighbor(c[0], c[1], 0); }
    const sides = (l: [number, number][], d: number) => l.map(([x, z]) => neighbor(x, z, d));
    const up = sides(row, dU), down = sides(row, dD), up2 = sides(up, dU), down2 = sides(down, dD);
    const need = [...[0, 1, 2, 3, 5, 6, 9, 10].flatMap((k) => [up[k], up2[k]]), ...[4, 6, 9].flatMap((k) => [down[k], down2[k]])];
    if (!row.every(([x, z]) => free(x, z) && !F.oreAt(x, z)) || !need.every(([x, z]) => free(x, z))) continue;
    const ores: [number, string][] = [[0, 'iron_ore'], [1, 'copper_ore'], [2, 'coal'], [3, 'iron_ore']];
    for (const [k, o] of ores) { const [x, z] = up2[k]; F.ore[z * GW + x] = 1 + ['iron_ore', 'copper_ore', 'coal', 'oil'].indexOf(o); sim.buildFac('mine', x, z); sim.buildFac('arm', up[k][0], up[k][1], (dU + 3) % 6); }
    for (let k = 0; k < 11; k++) { const [x, z] = row[k]; if (k === 8) sim.buildFac('splitter', x, z); else sim.buildFac('belt', x, z, 0); }
    sim.buildFac('arm', down[4][0], down[4][1], dD); sim.build('pulse', down2[4][0], down2[4][1]);
    sim.buildFac('arm', up[5][0], up[5][1], dU); sim.buildFac('generator', up2[5][0], up2[5][1]); const g = F.facAt(up2[5][0], up2[5][1])!; g.fuel = 1e5;
    sim.buildFac('pole', up2[6][0], up2[6][1]);
    sim.buildFac('arm', down[6][0], down[6][1], dD); sim.build('rail', down2[6][0], down2[6][1]);
    sim.buildFac('arm', down[9][0], down[9][1], dD); sim.buildFac('smelter', down2[9][0], down2[9][1]);
    sim.buildFac('works', up2[10][0], up2[10][1]);
    merged = 1;
  }
  // mines: iron first (pulse turrets take iron ore), spread out over the deposits
  const mines: { cx: number; cz: number }[] = [];
  for (const o of ['iron_ore', 'copper_ore', 'coal']) for (const gap of [4, 3]) for (const d of deps) {
    if (mines.length >= 12 || d.o !== o || mines.some((m) => hexDist(m.cx, m.cz, d.cx, d.cz) < gap)) continue;
    if (sim.buildFac('mine', d.cx, d.cz)) mines.push(d);
  }
  let lines = 0, belts = 0, arms = 0;
  const dirOf = (a: number, b: number) => { for (let d = 0; d < 6; d++) { const [x, z] = neighbor(a % GW, (a / GW) | 0, d); if (z * GW + x === b) return d; } return -1; };
  // each mine: an arm out of it onto a belt line (breadth-first over free tiles) to a free tile beside a road 12..22 tiles
  // away, where a last arm (in a straight line with the belt's end) feeds a pulse turret
  for (const m of [...mines, ...mines]) { // (a second line off every mine: both arms take from it in turn)
    if (belts >= 170) break;
    let d0 = -1;
    for (let d = 0; d < 6 && d0 < 0; d++) { const [x, z] = neighbor(m.cx, m.cz, d), [x2, z2] = neighbor(x, z, d); if (free(x, z) && free(x2, z2)) d0 = d; }
    if (d0 < 0) continue;
    const A0 = neighbor(m.cx, m.cz, d0), S0 = neighbor(A0[0], A0[1], d0), a0 = A0[1] * GW + A0[0], s0 = S0[1] * GW + S0[0];
    const prev = new Map<number, number>([[a0, -1], [s0, a0]]), start: number[] = [s0];
    let goal = -1, alt = -1;
    for (let k = 0; k < start.length && goal < 0; k++) {
      const j = start[k], cx = j % GW, cz = (j / GW) | 0, dist = hexDist(m.cx, m.cz, cx, cz);
      // (the last two steps in a straight line: the arm before the turret takes from the belt behind it)
      const p = prev.get(j)!, pp = p >= 0 ? prev.get(p)! : -1, straight = pp >= 0 && p !== s0 && dirOf(pp, p) === dirOf(p, j);
      if (straight && dist >= 12 && dist <= 22 && nearRoad(cx, cz)) { goal = j; break; }
      if (straight && dist >= 5 && nearRoad(cx, cz)) alt = j;
      if (dist > 22) continue;
      for (let d = 0; d < 6; d++) { const [x, z] = neighbor(cx, cz, d); const i = z * GW + x; if (free(x, z) && !prev.has(i)) { prev.set(i, j); start.push(i); } }
    }
    if (goal < 0) goal = alt;
    if (goal < 0) { continue; }
    const path: number[] = [];
    for (let j = goal; j !== a0; j = prev.get(j)!) path.unshift(j);
    const tw = path.pop()!, last = path.pop()!; // the turret stands at the end, an arm before it, the belt leads up to that
    const o = F.oreAt(m.cx, m.cz), tx = tw % GW, tz = (tw / GW) | 0;
    const ok = o === 'iron_ore' ? sim.build('pulse', tx, tz) : o === 'copper_ore' ? sim.build('rail', tx, tz) : sim.buildFac('generator', tx, tz);
    if (!ok) { continue; }
    if (sim.buildFac('arm', A0[0], A0[1], d0)) arms++;
    if (sim.buildFac('arm', last % GW, (last / GW) | 0, dirOf(last, tw))) arms++;
    for (let i = 0; i < path.length; i++) {
      const j = path[i], cx = j % GW, cz = (j / GW) | 0, nx = i + 1 < path.length ? path[i + 1] : last;
      if (sim.buildFac('belt', cx, cz, dirOf(j, nx))) belts++;
    }
    lines++;
  }
  // power: generators by coal mines get the coal by hand (a crate), poles in a chain across the board, cryo / arc towers on it
  const spots: [number, number][] = [];
  for (let cz = 1; cz < GH - 1; cz++) for (let cx = 1; cx < GW - 1; cx++) if (free(cx, cz) && !F.oreAt(cx, cz)) spots.push([cx, cz]);
  const gens: [number, number][] = [];
  for (const [cx, cz] of spots) {
    if (gens.length >= 3 || gens.some(([x, z]) => hexDist(x, z, cx, cz) < 8)) continue;
    if (sim.buildFac('generator', cx, cz)) { gens.push([cx, cz]); const f = F.facAt(cx, cz)!; f.inv.coal = 2; f.fuel = 1e5; }
  }
  let poles = 0, powered = 0;
  for (const [cx, cz] of spots) {
    if (poles >= 30 || !free(cx, cz) || (cx + cz * 3) % 4) continue;
    if (sim.buildFac('pole', cx, cz)) poles++;
  }
  for (const [cx, cz] of spots) {
    if (powered >= 8 || !free(cx, cz) || !nearRoad(cx, cz) || sim.factory.powerAt(cx, cz) < 0) continue;
    if (sim.build((powered % 2 ? 'arc' : 'cryo') as TowerType, cx, cz)) powered++;
  }
  // pipes: a pumpjack on every oil field, a pipe run off it, a firewall pylon at its end
  let pipes = 0;
  for (const d of deps) {
    if (d.o !== 'oil' || !free(d.cx, d.cz) || !sim.buildFac('pump', d.cx, d.cz)) continue;
    let cx = d.cx, cz = d.cz;
    for (let k = 0; k < 8; k++) {
      let moved = false;
      for (let dd = 0; dd < 6 && !moved; dd++) { const [x, z] = neighbor(cx, cz, (dd + k) % 6); if (free(x, z) && !F.oreAt(x, z) && sim.buildFac('pipe', x, z)) { cx = x; cz = z; pipes++; moved = true; } }
      if (!moved) break;
    }
    for (let dd = 0; dd < 6; dd++) { const [x, z] = neighbor(cx, cz, dd); if (free(x, z) && sim.build('flame', x, z)) break; }
  }
  return Object.assign(sim, { benchInfo: { mines: mines.length, lines, belts, arms, poles, powered, pipes, gens: gens.length, merged } });
}

/** A hash over everything the sim and factory keep (numbers rounded to the bit through their string form). */
function stateHash(sim: Sim): string {
  const F = sim.factory;
  const seen = new WeakSet<object>();
  const parts: unknown = {
    time: sim.time, wave: sim.wave, lives: sim.lives, gold: sim.gold, mats: sim.mats, xp: sim.xp, level: sim.level, kills: sim.kills, leaked: sim.leaked,
    enemies: sim.enemies, towers: sim.towers, projs: sim.projs, zones: sim.zones, walls: sim.walls, titan: sim.titan, queue: sim.queue,
    facs: F.facs, delivered: F.delivered, rev: F.rev, wires: F.wires,
    pipe: F.pipeNets.map((n) => [n.id, n.fluid, n.amt, n.cap]), power: F.powerNets.map((n) => [n.id, n.cap, n.demand, n.sat, n.potential, n.full]),
    diag: [...F.diagnose()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), links: F.links(),
  };
  const s = JSON.stringify(parts, (_k, v) => { if (v && typeof v === 'object') { if (seen.has(v) && !Array.isArray(v)) return '[seen]'; seen.add(v); } return v; });
  let h1 = 0x811c9dc5, h2 = 0x12345678;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2654435761) ^ (h2 >>> 13); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}

export function main() {
const sim = bigFactory();
const info = (sim as unknown as { benchInfo: Record<string, number> }).benchInfo;
const F = sim.factory;
const count = (t: string) => F.facs.filter((f) => f.type === t).length;
if (!HASH) console.log('factory', JSON.stringify(info), 'facs', F.facs.length, 'belts', count('belt'), 'arms', count('arm'), 'pipes', count('pipe'), 'poles', count('pole'), 'towers', sim.towers.length);

if (HASH) {
  // a fixed recording: three waves called one after another, every event drained each step like the view does
  const dt = 1 / 60;
  let evs = 0;
  for (let w = 0; w < 3; w++) {
    sim.startWave();
    for (let i = 0; i < 60 * 40; i++) { sim.step(dt); evs += sim.events.length; sim.events.length = 0; if (i % 30 === 0) { sim.diag(); F.links(); } }
  }
  console.log('wave', sim.wave, 'enemies', sim.enemies.length, 'kills', sim.kills, 'delivered', F.delivered, 'events', evs);
  console.log('hash', stateHash(sim));
  // and a bot-played free run until the Titan is down (the demo's kind of match: many enemies, specials, cards, the Titan wave)
  const s2 = new Sim({ seed: 11, pauseOnCards: false, free: true }), bot = new Bot(s2, 0);
  let n2 = 0;
  while (!s2.over && s2.titan.phase !== 'dead' && n2 < 60 * 60 * 60) { bot.step(dt); s2.step(dt); s2.events.length = 0; n2++; }
  console.log('bot run', n2, 'steps, wave', s2.wave, 'enemies', s2.enemies.length, 'towers', s2.towers.length, 'titan', s2.titan.phase);
  console.log('hash2', stateHash(s2));
} else {
  const dt = 1 / 60, steps = Math.round(secs * 60), ms: number[] = [];
  // warm up for 10 s of game time (belts fill, the JIT settles), then measure
  for (let i = 0; i < 600; i++) { sim.step(dt); sim.events.length = 0; }
  sim.startWave();
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const m0 = process.memoryUsage(), r0 = process.resourceUsage();
  let items = 0, alloc = 0, h = process.memoryUsage().heapUsed;
  for (let i = 0; i < steps; i++) {
    if (sim.cleared && !sim.waveActive) sim.startWave();
    const t0 = performance.now();
    sim.step(dt);
    if (i % 1 === 0) sim.diag(); // the view asks for the diagnosis every frame
    ms.push(performance.now() - t0);
    sim.events.length = 0;
    // allocation: the heap grows by what a step allocates (a step that ran a GC shrinks it and is left out)
    const h2 = process.memoryUsage().heapUsed;
    if (h2 > h) alloc += h2 - h;
    h = h2;
  }
  for (const f of F.facs) items += f.items.length;
  const m1 = process.memoryUsage(), r1 = process.resourceUsage();
  ms.sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  console.log(`sim ${secs}s: ${steps} steps, wave ${sim.wave}, enemies ${sim.enemies.length}, items on belts ${items}, delivered ${F.delivered}`);
  console.log(`ms/step mean ${mean.toFixed(4)}  p50 ${ms[ms.length >> 1].toFixed(4)}  p99 ${ms[Math.floor(ms.length * 0.99)].toFixed(4)}  max ${ms[ms.length - 1].toFixed(3)}`);
  console.log(`allocated ~${(alloc / steps / 1024).toFixed(1)} KiB/step (heap growth between steps, GC steps left out)`);
  console.log(`heapUsed delta ${((m1.heapUsed - m0.heapUsed) / 1024).toFixed(0)} KiB (includes garbage not yet collected), rss delta ${((m1.rss - m0.rss) / 1024).toFixed(0)} KiB, cpu ${((r1.userCPUTime - r0.userCPUTime) / 1000).toFixed(0)} ms`);
}
}
if (import.meta.main) main();
