// Rebuild a run from a bug report and run it forward (Node, no browser):
//   node tools/repro.ts <file | -> [--steps N] [--wave] [--pick K] [--watch fac:<id> | tower:<id>]... [--quiet]
// The input is a state block (BSR1:...), a whole issue body pasted from GitHub, or a downloaded report file; '-' reads stdin.
// Prints what the state holds (map, wave, credits, counts), the supply diagnosis of every building and tower with the
// Transfer Arms' and mines' own state, then runs the sim N steps of 1/60 s (default 600: ten seconds) and reports what
// changed. --wave calls the next wave first when the run is in its build phase (the factory stands still until then).
// --pick K picks card K (1..3) of every offer as it comes; without it offers stay open and the run goes on regardless.
// --watch prints a building or tower once a second, and every event about it. Exit code 2: the block is missing, corrupt or
// from a format version this checkout cannot read; 1: bad arguments.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { decodeSnapshot, restoreSim, SnapError, SNAP_V, extractBlock } from '../src/game/snapshot.ts';
import type { Snap } from '../src/game/snapshot.ts';
import type { Sim, Ev, Tower } from '../src/game/sim.ts';
import type { Fac, Diag } from '../src/game/factory.ts';
import { facKey, towerKey } from '../src/game/factory.ts';

const USAGE = 'usage: node tools/repro.ts <file | -> [--steps N] [--wave] [--pick K] [--watch fac:<id>|tower:<id>]... [--quiet]';
const args = process.argv.slice(2);
const opt = { file: '', steps: 600, wave: false, pick: 0, quiet: false, watch: [] as { k: 'f' | 't'; id: number }[] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--steps') { opt.steps = Math.max(0, Math.floor(Number(args[++i]))); if (!Number.isFinite(opt.steps)) bad('--steps needs a number'); }
  else if (a === '--wave') opt.wave = true;
  else if (a === '--quiet') opt.quiet = true;
  else if (a === '--pick') { opt.pick = Math.floor(Number(args[++i])); if (!(opt.pick >= 1 && opt.pick <= 3)) bad('--pick needs 1, 2 or 3'); }
  else if (a === '--watch') {
    const m = /^(fac|tower|f|t):?(\d+)$/.exec(args[++i] || '');
    if (!m) bad('--watch takes fac:<id> or tower:<id>');
    opt.watch.push({ k: m![1][0] as 'f' | 't', id: +m![2] });
  } else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  else if (!opt.file) opt.file = a;
  else bad('unexpected argument ' + a);
}
if (!opt.file) bad('no input');
function bad(msg: string): never { console.error(msg + '\n' + USAGE); process.exit(1); }

const r2 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const count = <T>(l: readonly T[], key: (x: T) => string) => { const m = new Map<string, number>(); for (const x of l) m.set(key(x), (m.get(key(x)) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'; };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const diagText = (d: Diag | undefined) => (!d ? '' : d.ok ? 'ok' + (d.from.length ? ' from ' + d.from.join(', ') : '') : 'MISSING ' + d.missing.join(', ') + (d.why?.length ? ': ' + d.why.join('; ') : ''));

function facLine(f: Fac): string {
  const bits = [`f${f.id}`.padEnd(5), f.type.padEnd(9), `@${f.cx},${f.cz}`.padEnd(7), f.state.padEnd(9)];
  if (f.lvl > 1) bits.push('Mk' + f.lvl);
  if (f.type === 'arm' || f.type === 'belt' || f.type === 'tunnel') bits.push('dir ' + f.dir);
  if (f.type === 'arm') bits.push(`hand ${f.hand || '-'}${f.handC ? ' (crate)' : ''}`, `swing ${r2(f.prog)}`, `only ${f.only || 'any'}`);
  else if (f.prog || f.busy) bits.push(`prog ${r2(f.prog)}${f.busy ? ' busy' : ''}`);
  const inv = Object.entries(f.inv).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' ');
  if (inv) bits.push('in [' + inv + ']');
  if (f.out.length) bits.push('out [' + f.out.join(' ') + ']');
  if (f.items.length) bits.push('items [' + f.items.map((b) => `${b.it}@${r2(b.p)}${b.c ? 'c' : ''}`).join(' ') + ']');
  if (f.type === 'crate') bits.push(`${f.hold} x${f.left}`);
  if (f.ore) bits.push('on ' + f.ore);
  if (f.fuel) bits.push('fuel ' + r2(f.fuel));
  if (f.tin || f.tout) bits.push(`tanks ${r2(f.tin)}/${r2(f.tout)}`);
  if (f.pair) bits.push(`pair f${f.pair}${f.exit ? ' (exit)' : ''}`);
  return bits.join(' ');
}
function towerLine(t: Tower): string {
  const off = [t.dry && 'dry', t.down > 0 && 'rebooting', t.jam > 0 && 'jammed', t.stun > 0 && 'stunned'].filter(Boolean).join(' ');
  return [`t${t.id}`.padEnd(5), t.type.padEnd(8), `Mk${t.lvl}`, `@${t.cx},${t.cz}`.padEnd(7), `stock ${t.stock} ammo ${r2(t.ammo)} tank ${r2(t.tank)} pwr ${r2(t.pwr)}`, `charge ${r2(t.charge)}`, `aim ${t.aim}${t.ammo2 ? ' ammo2' : ''}`, off].filter(Boolean).join(' ');
}
function summary(sim: Sim) {
  const F = sim.factory, items = F.facs.flatMap((f) => f.items);
  const T = sim.titan;
  console.log(`map: ${sim.map.def.name} (${sim.map.def.id}), ${sim.opts.mode}${sim.opts.players > 1 ? ' ' + sim.opts.players + ' players' : ''}, ${sim.endless ? 'Survival' : sim.diff.name}, seed ${sim.opts.seed}${sim.opts.free ? ', free towers' : ''}`);
  console.log(`wave ${sim.wave}${sim.campaign ? ' of ' + sim.winWave : ''}, ${clock(sim.time)} (${r2(sim.time)} s), ${sim.over ? (sim.won ? 'won' : 'lost') : sim.planning ? 'build phase' : 'wave on'}${sim.paused ? ', waiting for a card pick' : ''}; next wave in ${r2(sim.nextWaveIn)} s${sim.autoWaves ? '' : ' (waves on call)'}`);
  console.log(`core ${sim.lives}/${sim.maxLives}, credits ${Math.floor(sim.gold)}, materials ${Math.floor(sim.mats)}, level ${sim.level} (xp ${Math.floor(sim.xp)}/${sim.xpNext}), kills ${sim.kills}, leaked ${sim.leaked}, delivered ${F.delivered}`);
  console.log(`towers ${sim.towers.length}: ${count(sim.towers, (t) => t.type + (t.lvl > 1 ? ' Mk' + t.lvl : ''))}`);
  console.log(`buildings ${F.facs.length}: ${count(F.facs, (f) => f.type)}`);
  console.log(`enemies ${sim.enemies.length}: ${count(sim.enemies, (e) => e.type)}; queued ${sim.queue.length}; projectiles ${sim.projs.length}; zones ${sim.zones.length}`);
  console.log(`belt items ${items.length}: ${count(items, (b) => b.it)}`);
  console.log(`pipes: ${F.pipeNets.map((n) => `net ${n.id} ${n.fluid || 'empty'} ${r2(n.amt)}/${n.cap}`).join(', ') || 'none'}; power: ${F.powerNets.map((n) => `grid ${n.id} ${r2(n.cap)}/${r2(n.demand)} (${Math.round(n.sat * 100)}%)`).join(', ') || 'none'}`);
  console.log(`titan: ${T.phase}${T.phase !== 'none' ? `, wave ${T.wave}, lane ${T.lane}, danger ${r2(T.danger)}` : ''}`);
  console.log(`cards: ${Object.entries(sim.stacks).map(([k, n]) => k + (n > 1 ? ' x' + n : '')).join(', ') || 'none'}; unlocked towers ${[...sim.unlocked].join(' ')}; buildings ${[...sim.facs].join(' ')}`);
  sim.players.forEach((p, i) => { if (p.pending.length) console.log(`player ${i + 1} offers waiting: ${p.pending.map((o) => '[' + o.join(', ') + ']').join(' ')}`); });
}
function diagnosis(sim: Sim) {
  const d = sim.diag();
  console.log('\nbuildings (state and supply diagnosis):');
  for (const f of sim.factory.facs) {
    const dg = d.get(facKey(f.id));
    if (f.type === 'belt' && !dg) continue; // (a belt that is fine has nothing to say)
    console.log('  ' + facLine(f) + (dg ? '  | ' + diagText(dg) : ''));
  }
  console.log('towers:');
  for (const t of sim.towers) console.log('  ' + towerLine(t) + '  | ' + (diagText(d.get(towerKey(t.id))) || (sim.opts.free ? 'free' : '')));
}
/** What a building or tower looks like now (to tell what changed). */
const facSig = (f: Fac) => facLine(f);
function changes(a: Map<string, string>, b: Map<string, string>) {
  const out: string[] = [];
  for (const [k, v] of b) { const w = a.get(k); if (w === undefined) out.push('  + ' + v); else if (w !== v) out.push(`  ~ ${w}\n    > ${v}`); }
  for (const [k, v] of a) if (!b.has(k)) out.push('  - ' + v);
  return out;
}

async function main() {
  let text: string;
  try { text = opt.file === '-' ? readFileSync(0, 'utf8') : readFileSync(opt.file, 'utf8'); } catch (e) { console.error(`cannot read ${opt.file}: ${(e as Error).message}`); process.exit(1); }
  let snap: Snap, sim: Sim;
  try { snap = await decodeSnapshot(text); sim = restoreSim(snap); } catch (e) {
    if (e instanceof SnapError) { console.error('repro: ' + e.message); process.exit(2); }
    console.error('repro: the state block could not be rebuilt by this checkout (written by an incompatible build?): ' + (e as Error).message); process.exit(2);
  }
  let here = '';
  try { here = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }
  const block = extractBlock(text)!;
  console.log(`state block: ${block.length} characters, format ${SNAP_V}${snap.meta?.build ? `, written by build ${snap.meta.build}` : ''}${snap.meta?.date ? ' on ' + snap.meta.date : ''}${here ? `; this checkout is ${here}` : ''}`);
  if (snap.meta?.build && /^[0-9a-f]{7,40}$/.test(snap.meta.build) && here && !snap.meta.build.startsWith(here) && !here.startsWith(snap.meta.build)) console.log(`  (another build: check out ${snap.meta.build} if the run goes another way than reported)`);
  summary(sim);
  if (!opt.quiet) diagnosis(sim);

  // run it forward
  if (opt.wave && sim.planning && !sim.over) { sim.startWave(); console.log(`\ncalled wave ${sim.wave}`); }
  // (a card offer would stop the run: without --pick it stays open and the run goes on)
  const unpause = () => { if (sim.paused && !opt.pick) { sim.opts.pauseOnCards = false; console.log(`  [${r2(sim.time)}] a card offer waits: it stays open and the run goes on (--pick K picks for you)`); } };
  unpause();
  const before = new Map<string, string>(), tBefore = new Map<string, string>();
  for (const f of sim.factory.facs) before.set(facKey(f.id), facSig(f));
  for (const t of sim.towers) tBefore.set(towerKey(t.id), towerLine(t));
  const s0 = { wave: sim.wave, lives: sim.lives, gold: sim.gold, mats: sim.mats, kills: sim.kills, del: sim.factory.delivered, time: sim.time };
  const evCount = new Map<string, number>();
  const watchKey = new Set(opt.watch.map((w) => w.k + w.id));
  // an event is about a watched thing when it names it (who, id, prey) or happens on its tile (an arm's put, a source's take)
  const spots = () => opt.watch.map((w) => (w.k === 'f' ? sim.factory.facById(w.id) : sim.towerById(w.id))).filter((o): o is Fac | Tower => !!o);
  const about = (e: Ev) => (typeof e.who === 'string' && watchKey.has(e.who)) || (e.who === undefined && typeof e.id === 'number' && (watchKey.has('t' + e.id) || watchKey.has('f' + e.id)))
    || (typeof e.prey === 'number' && watchKey.has('t' + e.prey)) || spots().some((o) => Math.abs(o.x - e.x) < 1e-6 && Math.abs(o.z - e.z) < 1e-6);
  const gone = new Set<string>();
  const show = (step: number) => {
    for (const w of opt.watch) {
      const o = w.k === 'f' ? sim.factory.facById(w.id) : sim.towerById(w.id), key = w.k + w.id;
      if (!o) { if (!gone.has(key)) console.log(`  [${r2(sim.time)}] ${key} is not there`); gone.add(key); continue; }
      gone.delete(key);
      console.log(`  [${r2(sim.time)}] ${w.k === 'f' ? facLine(o as Fac) : towerLine(o as Tower)}  | ${diagText(sim.diag().get(w.k === 'f' ? facKey(w.id) : towerKey(w.id)))}`);
    }
    return step;
  };
  if (opt.steps) console.log(`\nrunning ${opt.steps} steps (${r2(opt.steps / 60)} s)...`);
  if (opt.watch.length) show(0);
  for (let i = 1; i <= opt.steps && !sim.over; i++) {
    if (opt.pick) for (const p of sim.players) while (p.pending.length) { const o = p.pending[0]; console.log(`  [${r2(sim.time)}] pick ${o[Math.min(o.length, opt.pick) - 1]} of [${o.join(', ')}]`); sim.pickCard(sim.players.indexOf(p), opt.pick - 1); }
    unpause();
    sim.step(1 / 60);
    for (const e of sim.events) {
      evCount.set(e.k, (evCount.get(e.k) || 0) + 1);
      if (watchKey.size && about(e)) console.log(`  [${r2(sim.time)}] event ${JSON.stringify(e, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v))}`);
    }
    sim.events.length = 0;
    if (opt.watch.length && i % 60 === 0) show(i);
  }
  if (!opt.steps) return;
  console.log(`\nafter ${r2(sim.time - s0.time)} s: wave ${s0.wave} > ${sim.wave}, core ${s0.lives} > ${sim.lives}, credits ${Math.floor(s0.gold)} > ${Math.floor(sim.gold)}, materials ${Math.floor(s0.mats)} > ${Math.floor(sim.mats)}, kills +${sim.kills - s0.kills}, items delivered by arms +${sim.factory.delivered - s0.del}${sim.over ? (sim.won ? ', WON' : ', LOST') : ''}`);
  console.log('events: ' + ([...evCount].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'));
  const after = new Map<string, string>(), tAfter = new Map<string, string>();
  for (const f of sim.factory.facs) after.set(facKey(f.id), facSig(f));
  for (const t of sim.towers) tAfter.set(towerKey(t.id), towerLine(t));
  const fc = changes(before, after), tc = changes(tBefore, tAfter);
  console.log(`buildings changed: ${fc.length}${fc.length && opt.quiet ? ' (--quiet: not listed)' : ''}`);
  if (!opt.quiet) for (const l of fc) console.log(l);
  console.log(`towers changed: ${tc.length}`);
  if (!opt.quiet) for (const l of tc) console.log(l);
}
void main();
