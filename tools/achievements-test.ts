// Achievements, the run archive and the career glue, without a DOM: node tools/achievements-test.ts
// Every achievement has to unlock from a synthetic stream of frames (a fake Sim and its events, fed through the same
// RunTracker the game uses), an empty run must unlock nothing, unlocks happen once and survive a reload, the archive keeps
// its bests and totals and at most RUNS_MAX runs, and a real run goes through Career (save, continue, archive).
import { existsSync } from 'node:fs';
import { ACHIEVEMENTS, ACH_BY_ID, Achievements, earned, achProgress, achImage, ACH_KEY } from '../src/game/achievements.ts';
import type { AchCtx } from '../src/game/achievements.ts';
import { RunTracker, Records, RUNS_MAX, PLANTS, longestBelt, hasArmLine, addRunToTotals } from '../src/game/records.ts';
import type { SimView, EvView, RunResult, Totals, RunRecord } from '../src/game/records.ts';
import { Career } from '../src/game/career.ts';
import { memoryPlatform, MemoryStorage } from '../src/platform/core.ts';
import { platformAchId } from '../src/platform/ids.ts';
import { ICON_NAMES } from '../src/icons.ts';
import { TOWER_TYPES } from '../src/game/data.ts';
import { neighbor, inBoard } from '../src/game/hex.ts';
import { Sim } from '../src/game/sim.ts';
import { Bot } from '../src/game/bot.ts';
import { MAPS } from '../src/game/maps.ts';
import { stateHash } from '../src/game/snapshot.ts';

let fail = 0;
const ok = (c: unknown, m: string) => { if (!c) { fail++; console.log('FAIL', m); } };

// ---------- the table ----------
ok(ACHIEVEMENTS.length >= 30 && ACHIEVEMENTS.length <= 40, `30 to 40 achievements (${ACHIEVEMENTS.length})`);
ok(new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length && ACHIEVEMENTS.every((a) => /^[a-z][a-z0-9_]{2,40}$/.test(a.id)), 'ids are unique snake_case');
for (const a of ACHIEVEMENTS) {
  ok(existsSync('public/' + achImage(a)) && existsSync('public/' + achImage(a, false)), `${a.id}: picture ${a.img} exists small and large`);
  ok(!a.icon || ICON_NAMES.includes(a.icon), `${a.id}: icon ${a.icon} is an icon of icons.ts`);
  ok(a.name.length <= 24 && a.desc.length <= 60, `${a.id}: name and line are short`);
  ok(platformAchId('steam', a.id) === a.id, `${a.id}: Steam API name defaults to the id`);
}
const tiers = ACHIEVEMENTS.reduce((o, a) => { o[a.tier] = (o[a.tier] || 0) + 1; return o; }, {} as Record<string, number>);

// ---------- a fake Sim, driven frame by frame ----------
type Fake = SimView & {
  towers: { id: number; type: string; lvl: number; cx: number; cz: number }[];
  enemies: { type: string; frz: number; alive: boolean }[];
  unlocked: Set<string>;
  factory: { facs: { id: number; type: string; cx: number; cz: number; dir: number; pair?: number; exit?: boolean }[]; delivered: number };
};
const emptyLife = (): Totals => ({ runs: 0, wins: 0, losses: 0, quits: 0, kills: 0, bossKills: 0, titanKills: 0, playtime: 0, items: 0, specials: 0, waves: 0, towers: 0, buildings: 0, cards: 0, bestSurvival: 0, mapsWon: [], tiersWon: [], diffsWon: [], aimModes: [], flags: [] });
function fake(o: { tier?: number; diff?: string; endless?: boolean; maxLives?: number } = {}): Fake {
  return {
    wave: 0, lives: o.maxLives ?? 20, maxLives: o.maxLives ?? 20, kills: 0, time: 0, won: false, over: false, endless: !!o.endless, winWave: 25,
    towers: [], enemies: [], unlocked: new Set(['pulse']), factory: { facs: [], delivered: 0 },
    map: { def: { id: 'testmap', name: 'Test', tier: o.tier ?? 1 } }, opts: { seed: 7, diff: o.diff ?? 'normal' },
  };
}
let nid = 1000;
const tower = (s: Fake, type: string, cx: number, cz: number, lvl = 1) => { s.towers.push({ id: nid++, type, lvl, cx, cz }); return { k: 'build', x: 0, z: 0 } as EvView; };
const fac = (s: Fake, type: string, cx: number, cz: number, dir = 0) => { s.factory.facs.push({ id: nid++, type, cx, cz, dir }); return { k: 'build', fac: 1 } as EvView; };
/** Play a scenario: `frames` mutate the fake and return that frame's events; the run ends with `result` (none: still going). */
function play(frames: ((s: Fake) => EvView[])[], o: Parameters<typeof fake>[0] & { result?: RunResult; life?: Partial<Totals> } = {}): AchCtx {
  const s = fake(o), t = new RunTracker(s);
  for (const f of frames) { const ev = f(s); s.time += 1 / 60; t.observe(s, ev); }
  const life = { ...emptyLife(), ...(o.life || {}) };
  if (!o.result) return { run: t.stats, life };
  if (o.result === 'win') { s.won = true; s.over = true; }
  return { run: t.stats, end: t.finish(s, o.result, 1e12), life };
}
const win = (s: Fake): EvView[] => { s.wave = 25; return [{ k: 'clear', n: 25 }, { k: 'win' }]; };
/** a line of belts `n` long, snaking across the board */
function snake(s: Fake, n: number): EvView[] {
  const path: [number, number][] = [[0, 0]], seen = new Set(['0,0']);
  while (path.length < n + 1) {
    const [x, z] = path[path.length - 1];
    const dirs = [z % 2 ? 3 : 0, 1, 2];
    const d = dirs.find((d0) => { const [a, b] = neighbor(x, z, d0); return inBoard(a, b) && !seen.has(a + ',' + b); });
    if (d === undefined) break;
    const nx = neighbor(x, z, d);
    s.factory.facs.push({ id: nid++, type: 'belt', cx: x, cz: z, dir: d });
    path.push(nx); seen.add(nx.join(','));
  }
  return [{ k: 'build', fac: 1 }];
}
/** mine > arm > tower along direction d from (cx, cz) */
function armLine(s: Fake, cx: number, cz: number, d: number, arms = 1): EvView[] {
  fac(s, 'mine', cx, cz);
  let [x, z] = [cx, cz];
  for (let i = 0; i < arms; i++) { [x, z] = neighbor(x, z, d); fac(s, 'arm', x, z, d); }
  [x, z] = neighbor(x, z, d);
  tower(s, 'pulse', x, z);
  return [{ k: 'build' }, { k: 'build', fac: 1 }];
}

const SCEN: Record<string, () => AchCtx> = {
  first_win: () => play([win], { result: 'win' }),
  first_mk3: () => play([(s) => [tower(s, 'pulse', 3, 3, 3)]]),
  first_arm_line: () => play([(s) => armLine(s, 5, 5, 0)]),
  first_belt: () => play([(s) => [fac(s, 'belt', 4, 4)]]),
  first_oil: () => play([(s) => [fac(s, 'pump', 4, 4)]]),
  first_power: () => play([(s) => [fac(s, 'generator', 4, 4)]]),
  first_blueprint: () => play([(s) => { s.unlocked.add('cryo'); return [{ k: 'card', id: 'bp_cryo' }]; }]),
  first_special: () => play([() => [{ k: 'special', id: 1, t: 'pulse' }]]),
  first_targeting: () => play([() => [{ k: 'aim', id: 1, t: 'pulse', m: 'strong' }]]),
  tutorial_done: () => ({ life: { ...emptyLife(), flags: ['tutorial'] } }),
  win_tier1: () => play([win], { result: 'win', tier: 1 }),
  win_tier2: () => play([win], { result: 'win', tier: 2 }),
  win_tier3: () => play([win], { result: 'win', tier: 3 }),
  maps_5: () => play([win], { result: 'win', life: { mapsWon: ['a', 'b', 'c', 'd'] } }),
  maps_15: () => play([win], { result: 'win', life: { mapsWon: 'abcdefghijklmn'.split('') } }),
  win_recruit: () => play([win], { result: 'win', diff: 'easy' }),
  win_veteran: () => play([win], { result: 'win', diff: 'normal' }),
  win_nightmare: () => play([win], { result: 'win', diff: 'hard' }),
  flawless: () => play([win], { result: 'win' }),
  flawless_nightmare: () => play([win], { result: 'win', diff: 'hard' }),
  colossus_slayer: () => play([() => [{ k: 'die', t: 'boss', h: 1 }]]),
  colossus_25: () => play([() => [{ k: 'die', t: 'boss', h: 1 }]], { life: { bossKills: 24 } }),
  titan_slayer: () => play([() => [{ k: 'titanLand' }], () => [{ k: 'titanDie' }]]),
  titan_fast: () => play([() => [{ k: 'titanLand' }], (s) => { s.time += 20; return []; }, () => [{ k: 'titanDie' }]]),
  items_1k: () => play([(s) => { s.factory.delivered = 1000; return []; }]),
  items_10k: () => play([(s) => { s.factory.delivered = 1000; return []; }], { life: { items: 9000 } }),
  arms_20: () => play([(s) => { for (let i = 0; i < 20; i++) fac(s, 'arm', i, 10); return [{ k: 'build', fac: 1 }]; }]),
  all_plants: () => play(PLANTS.map((p, i) => (s: Fake) => [fac(s, p, i, 12)])),
  pulse_purist: () => play([(s) => [tower(s, 'pulse', 2, 2), tower(s, 'pulse', 3, 2)], win], { result: 'win' }),
  full_arsenal: () => play(TOWER_TYPES.map((t, i) => (s: Fake) => [tower(s, t, i, 1)])),
  mk3_5: () => play([(s) => [0, 1, 2, 3, 4].map((i) => tower(s, 'pulse', i, 3, 3))]),
  specials_100: () => play([() => Array.from({ length: 40 }, () => ({ k: 'special', t: 'arc' }))], { life: { specials: 60 } }),
  all_targeting: () => play([() => ['first', 'last', 'strong', 'weak', 'fast', 'slow'].map((m) => ({ k: 'aim', m }))]),
  kills_10k: () => play([(s) => { s.kills = 4000; return []; }], { life: { kills: 6000 } }),
  survive_30: () => play([() => [{ k: 'clear', n: 30 }]], { endless: true }),
  survive_40: () => play([() => [{ k: 'clear', n: 40 }]], { endless: true }),
  survive_50: () => play([() => [{ k: 'clear', n: 50 }]], { endless: true }),
  long_belt: () => play([(s) => snake(s, 70), win], { result: 'win' }),
  deep_freeze: () => play([(s) => { for (let i = 0; i < 50; i++) s.enemies.push({ type: 'grunt', frz: 2, alive: true }); return [{ k: 'special', t: 'cryo' }]; }]),
};
for (const a of ACHIEVEMENTS) {
  const sc = SCEN[a.id];
  ok(!!sc, `${a.id}: has a synthetic scenario`);
  if (!sc) continue;
  const c = sc();
  ok(earned(c).some((x) => x.id === a.id), `${a.id}: unlocks from its stream (progress ${achProgress(a, c).join('/')})`);
}
ok(Object.keys(SCEN).every((id) => ACH_BY_ID[id]), 'every scenario names an achievement');
// near misses: the counted ones stop one short, the conditions hold their edges
const short: [string, AchCtx][] = [
  ['arms_20', play([(s) => { for (let i = 0; i < 19; i++) fac(s, 'arm', i, 10); return [{ k: 'build', fac: 1 }]; }])],
  ['deep_freeze', play([(s) => { for (let i = 0; i < 49; i++) s.enemies.push({ type: 'grunt', frz: 2, alive: true }); s.enemies.push({ type: 'grunt', frz: 0, alive: true }); return []; }])],
  ['titan_fast', play([() => [{ k: 'titanLand' }], (s) => { s.time += 31; return []; }, () => [{ k: 'titanDie' }]])],
  ['long_belt', play([(s) => snake(s, 55), win], { result: 'win' })],
  ['pulse_purist', play([(s) => [tower(s, 'pulse', 2, 2), tower(s, 'cryo', 3, 2)], win], { result: 'win' })],
  ['flawless', play([(s) => { s.lives = 19; return [{ k: 'leak', n: 1 }]; }, (s) => { s.lives = 20; return []; }, win], { result: 'win' })],
  ['first_win', play([win], { result: 'win', endless: true })],
  ['colossus_slayer', play([() => [{ k: 'die', t: 'boss', h: 0 }, { k: 'titanImpact' }]])],
  ['first_arm_line', play([(s) => { fac(s, 'mine', 5, 5); const [x, z] = neighbor(5, 5, 0); fac(s, 'arm', x, z, 3); const [tx, tz] = neighbor(x, z, 0); tower(s, 'pulse', tx, tz); return [{ k: 'build' }]; }])],
  ['survive_30', play([() => [{ k: 'clear', n: 30 }]])],
];
for (const [id, c] of short) ok(!earned(c).some((x) => x.id === id), `${id}: not unlocked just short of it`);
ok(!hasArmLine([], []), 'arm line: nothing without buildings');
{ const s = fake(); armLine(s, 8, 8, 2, 3); ok(hasArmLine(s.factory.facs, s.towers), 'arm line: mine > 3 arms > tower counts'); }
{ const s = fake(); snake(s, 40); ok(longestBelt(s.factory.facs) === 40, `belt line: 40 belts measure ${longestBelt(s.factory.facs)}`); s.factory.facs.push({ id: 1, type: 'belt', cx: 25, cz: 19, dir: 3 }); const [x, z] = neighbor(25, 19, 3); s.factory.facs.push({ id: 2, type: 'belt', cx: x, cz: z, dir: 0 }); ok(longestBelt(s.factory.facs) === 40, 'belt line: a loop of two does not run forever'); }

// ---------- an empty run unlocks nothing ----------
for (const r of ['loss', 'quit', undefined] as const) {
  const c = play([() => [], () => []], { result: r });
  ok(earned(c).length === 0, `an empty run (${r || 'going on'}) unlocks nothing: ${earned(c).map((a) => a.id).join(',')}`);
}
{ const sim = new Sim({ seed: 3, map: MAPS[0] }), t = new RunTracker(sim); for (let i = 0; i < 60; i++) { sim.step(1 / 60); t.observe(sim, sim.events.splice(0)); } ok(earned({ run: t.stats, end: t.finish(sim, 'quit', 1), life: emptyLife() }).length === 0, 'a real run left untouched unlocks nothing'); }

// ---------- unlock once, persist, mirror ----------
{
  const plat = memoryPlatform(), ach = await Achievements.load(plat);
  const seen: string[] = [];
  const off = ach.onUnlock((a) => seen.push(a.id));
  const c = SCEN.first_win();
  const a1 = ach.evaluate(c, 111), a2 = ach.evaluate(c, 222);
  ok(a1.length > 0 && a2.length === 0 && seen.length === a1.length && new Set(seen).size === seen.length, `idempotent: ${a1.map((a) => a.id).join(',')} once, nothing the second time`);
  ok(ach.state.unlocked.first_win === 111, 'the unlock time is the first one');
  ach.evaluate(play([(s) => { for (let i = 0; i < 9; i++) fac(s, 'arm', i, 10); return [{ k: 'build', fac: 1 }]; }]), 300);
  await ach.save();
  await new Promise((r) => setTimeout(r, 0));
  ok(plat.unlocked.includes('first_win') && plat.unlocked.length === a1.length, 'mirrored to the platform service once each: ' + plat.unlocked.join(','));
  const again = await Achievements.load(plat);
  ok(JSON.stringify(again.state.unlocked) === JSON.stringify(ach.state.unlocked) && again.state.progress.arms_20 === 9, 'persistence round trip (unlocks and counts)');
  ok(again.evaluate(c).length === 0, 'reloaded: nothing unlocks twice');
  const v = again.list().find((x) => x.def.id === 'arms_20')!;
  ok(v.cur === 9 && v.goal === 20 && !v.unlocked && again.list().length === ACHIEVEMENTS.length, 'list() gives progress for counted ones');
  off();
  ach.evaluate(SCEN.titan_slayer());
  ok(!seen.includes('titan_slayer'), 'onUnlock: the returned function stops the callbacks');
  // unreadable state, a platform that already has some, a platform that fails
  const p2 = memoryPlatform(); await p2.storage.set(ACH_KEY, '{"unlocked":{"first_win":"x","nope":5,"__proto__":1,"first_belt":7}}'); p2.unlocked.push('titan_slayer', 'bogus');
  const a3 = await Achievements.load(p2);
  ok(a3.has('first_belt') && !a3.has('first_win') && !a3.has('nope') && a3.has('titan_slayer') && !a3.has('bogus'), 'stored state is checked; the platform\'s own unlocks count');
  const p3 = memoryPlatform(); p3.achievements.unlock = async () => { throw new Error('offline'); };
  const a4 = await Achievements.load(p3);
  let threw = false; try { a4.evaluate(SCEN.first_win()); await a4.save(); await new Promise((r) => setTimeout(r, 0)); } catch { threw = true; }
  ok(!threw && a4.has('first_win'), 'a failing platform service never breaks an unlock');
}
// determinism: the same stream twice gives the same unlocks
ok(JSON.stringify(earned(SCEN.long_belt()).map((a) => a.id)) === JSON.stringify(earned(SCEN.long_belt()).map((a) => a.id)), 'deterministic');

// ---------- the archive ----------
{
  const st = new MemoryStorage(), rec = await Records.load(st);
  const mk = (i: number, result: RunResult, o: Partial<RunRecord> = {}): RunRecord => ({
    id: 'r' + i, endedAt: 1e12 + i, map: 'switchback', mapName: 'Switchback', tier: 1, diff: 'normal', mode: 'campaign', result, wave: result === 'win' ? 25 : 10, waves: 25,
    lives: result === 'win' ? 12 + (i % 5) : 0, maxLives: 20, time: 1000 - i, kills: 100, bossKills: 1, titanKilled: false, titanKills: 0, towersBuilt: { pulse: 3 }, buildingsBuilt: { arm: 4, mine: 2 },
    itemsDelivered: 50, cardsTaken: ['belts'], seed: i, specials: 2, maxBelt: 0, ...o,
  });
  for (let i = 0; i < RUNS_MAX + 5; i++) await rec.add(mk(i, i % 3 === 0 ? 'win' : 'loss'));
  await rec.add(mk(999, 'loss', { mode: 'survival', wave: 33, map: 'spiral' }));
  const back = await Records.load(st);
  ok(back.runs.length === RUNS_MAX && (await st.keys('run:')).length === RUNS_MAX && back.runs[0].id === 'r999', `archive: the last ${RUNS_MAX} runs kept, newest first`);
  const b = back.best('switchback', 'normal', 'campaign')!;
  ok(b && b.runs === RUNS_MAX + 5 && b.wins === 69 && b.bestWave === 25 && b.bestLivesWin === 16 && b.fastestWin === 1000 - 204, 'archive: bests per map ' + JSON.stringify(b));
  ok(back.totals.runs === RUNS_MAX + 6 && back.totals.kills === 100 * (RUNS_MAX + 6) && back.totals.bestSurvival === 32 && back.totals.mapsWon.join() === 'switchback' && back.totals.diffsWon.join() === 'normal', 'archive: lifetime totals ' + JSON.stringify({ runs: back.totals.runs, surv: back.totals.bestSurvival }));
  ok(addRunToTotals(emptyLife(), mk(1, 'win')).waves === 25 && addRunToTotals(emptyLife(), mk(1, 'loss')).waves === 9, 'totals: waves cleared');
  await st.set('run:0000000000000001-bad', '{oops'); await st.set('records:totals', '{"runs":"lots","kills":-5,"mapsWon":[1,"a"]}');
  const odd = await Records.load(st);
  ok(odd.totals.runs === 0 && odd.totals.kills === 0 && odd.totals.mapsWon.join() === 'a' && !(await st.keys('run:')).includes('run:0000000000000001-bad'), 'archive: unreadable entries are dropped, totals clamped');
  ok(await odd.flag('tutorial') && !(await odd.flag('tutorial')) && (await Records.load(st)).totals.flags.includes('tutorial'), 'archive: flags');
}

// ---------- a real run through Career: tracked, saved between waves, continued, archived ----------
{
  const plat = memoryPlatform(), career = await Career.open(plat), dt = 1 / 60;
  const unlocked: string[] = []; career.onUnlock((a) => unlocked.push(a.id));
  ok(career.startRun(new Sim({ seed: 1, map: MAPS[0], free: true })) === null && career.startRun(new Sim({ seed: 1, map: MAPS[0] }), { ctx: { bot: true } }) === null, 'career: free and bot runs are not tracked');
  const sim = new Sim({ seed: 21, map: MAPS[0], pauseOnCards: false });
  sim.autoWaves = false;
  career.startRun(sim);
  // a turret beside each crate (fed by it), then two waves
  for (const c of sim.factory.facs.filter((f) => f.type === 'crate')) {
    for (let d = 0; d < 6; d++) { const [x, z] = neighbor(c.cx, c.cz, d); if (sim.build('pulse', x, z)) break; }
  }
  career.frame(sim, sim.events.splice(0));
  let hashAtSave = '';
  for (let w = 0; w < 2; w++) {
    career.beforeWave(sim); sim.startWave();
    for (let i = 0; i < 60 * 240 && !sim.over && !sim.planning; i++) { career.beforeStep(sim, dt); sim.step(dt); for (const p of sim.players) while (p.pending.length) sim.pickCard(0, 0); career.frame(sim, sim.events.splice(0)); }
    hashAtSave = stateHash(sim);
  }
  await career.saves.flush();
  const saved = await career.saves.list();
  ok(saved.length === 1 && saved[0].wave === 2 && saved[0].map === MAPS[0].id, 'career: saved in the build phase after the wave: ' + JSON.stringify(saved.map((x) => x.wave)));
  ok(career.run!.stats.kills === sim.kills && sim.kills > 0 && career.run!.stats.towersBuilt.pulse > 0 && career.run!.stats.cleared === 2, `career: counters follow the run (${sim.kills} kills, ${career.run!.stats.towersBuilt.pulse} turrets)`);
  const key = career.key;
  await career.leave(sim);
  // a reload: a new Career on the same storage continues the run
  const c2 = await Career.open(plat);
  const r = await c2.continueRun(key, { hold: false });
  ok(!('error' in r) && stateHash(r.sim) === hashAtSave && c2.run!.stats.kills === sim.kills && c2.run!.stats.cleared === 2, 'career: continueRun restores the state and the counters');
  if (!('error' in r)) {
    const s2 = r.sim;
    c2.beforeWave(s2); s2.startWave();
    for (let i = 0; i < 60 * 240 && !s2.over && !s2.planning; i++) { s2.step(dt); for (const p of s2.players) while (p.pending.length) s2.pickCard(0, 0); c2.frame(s2, s2.events.splice(0)); }
    ok(c2.run!.stats.kills === s2.kills, 'career: kills keep counting after a continue');
    const rec = await c2.endRun(s2, 'loss', 5e12);
    ok(!!rec && rec.result === 'loss' && rec.wave === 3 && rec.kills === s2.kills && (await c2.saves.list()).length === 0, 'career: the end of the run archives it and clears the save');
    ok(c2.records.runs.length === 1 && (await Records.load(plat.storage)).totals.runs === 1, 'career: the run is in the archive after a reload');
  }
  // start over: the abandoned save is archived as a quit and removed
  const s3 = new Sim({ seed: 5, map: MAPS[1], pauseOnCards: false }); s3.autoWaves = false;
  const c3 = await Career.open(plat); c3.startRun(s3);
  c3.beforeWave(s3); s3.startWave(); for (let i = 0; i < 60 * 240 && !s3.over && !s3.planning; i++) { s3.step(dt); c3.frame(s3, s3.events.splice(0)); }
  await c3.leave(s3);
  const k3 = c3.keyFor(MAPS[1].id, 'normal', false);
  ok((await c3.saves.get(k3)) !== null, 'career: leave() keeps the save');
  await c3.startOver(k3);
  ok((await c3.saves.get(k3)) === null && c3.records.runs[0].result === 'quit', 'career: startOver archives a quit and clears the save');
  // the tutorial flag
  const fl = await c3.flag('tutorial');
  ok(fl.some((a) => a.id === 'tutorial_done') && (await c3.flag('tutorial')).length === 0, 'career: flag(tutorial) unlocks Briefed once');
  console.log(`career: real run on ${MAPS[0].name}: saved after wave 2, continued after a reload, ended at wave 3 and archived; unlocked on the way: ${unlocked.join(', ') || 'none'}`);
}
// ---------- the tracker on real events (a bot run with free towers) ----------
{
  const sim = new Sim({ seed: 8, map: MAPS[2], pauseOnCards: false, free: true }), bot = new Bot(sim, 0), t = new RunTracker(sim);
  for (let i = 0; i < 60 * 400 && !sim.over; i++) { bot.step(1 / 60); sim.step(1 / 60); t.observe(sim, sim.events.splice(0)); }
  const s = t.stats, built = Object.values(s.towersBuilt).reduce((a, b) => a + b, 0);
  console.log(`tracker on a bot run (${MAPS[2].name}, free towers): ${s.kills} kills, ${built} towers built, ${s.specials} specials, ${s.cleared} waves cleared, ${s.bossKills} Colossi, best Mk${s.maxLvl}`);
  ok(s.kills === sim.kills && built >= sim.towers.length && s.cleared >= 3 && s.specials > 0, `tracker on a bot run: ${s.kills} kills, ${built} towers built, ${s.specials} specials, wave ${s.cleared} cleared, ${s.bossKills} Colossi, Mk${s.maxLvl}`);
}
// ---------- two tabs on one storage: neither wipes out what the other stored ----------
{
  const st = new MemoryStorage(), pa = memoryPlatform(st), pb = memoryPlatform(st);
  const A = await Achievements.load(pa), B = await Achievements.load(pb); // (both loaded before either wrote)
  const ctx = (f: (r: Record<string, unknown>) => void): AchCtx => { const life = { runs: 0, wins: 0, losses: 0, quits: 0, kills: 0, bossKills: 0, titanKills: 0, playtime: 0, items: 0, specials: 0, waves: 0, towers: 0, buildings: 0, cards: 0, bestSurvival: 0, mapsWon: [], tiersWon: [], diffsWon: [], aimModes: [], flags: [] } as Totals; f(life as unknown as Record<string, unknown>); return { life }; };
  A.evaluate(ctx((l) => { l.flags = ['tutorial']; })); await A.save();
  B.evaluate(ctx((l) => { l.kills = 4000; })); B.evaluate(ctx((l) => { l.specials = 100; })); await B.save();
  const C = await Achievements.load(memoryPlatform(st));
  ok(C.has('tutorial_done') && C.has('specials_100') && C.state.progress.kills_10k === 4000, 'two tabs: achievements of both kept, progress kept: ' + Object.keys(C.state.unlocked).join(','));
  await C.reset();
  ok(Object.keys((await Achievements.load(memoryPlatform(st))).state.unlocked).length === 0, 'two tabs: reset() is not merged back');
  // records: tab B archives a run after tab A did; the totals hold both
  const RA = await Records.load(st), RB = await Records.load(st);
  const rec = (id: string, t: number): RunRecord => ({ id, endedAt: t, map: 'switchback', mapName: 'Switchback', tier: 1, diff: 'normal', mode: 'campaign', result: 'loss', wave: 3, waves: 25, lives: 0, maxLives: 20, time: 60, kills: 10, bossKills: 0, titanKilled: false, titanKills: 0, towersBuilt: {}, buildingsBuilt: {}, itemsDelivered: 0, cardsTaken: [], seed: 1, specials: 0, maxBelt: 0 });
  await RA.add(rec('a1', 1000)); await RB.add(rec('b1', 2000)); await RA.flag('tutorial');
  const RC = await Records.load(st);
  ok(RC.totals.runs === 2 && RC.totals.kills === 20 && RC.best('switchback', 'normal', 'campaign')?.runs === 2 && RC.runs.length === 2 && RC.totals.flags.includes('tutorial'), `two tabs: records of both runs kept (runs ${RC.totals.runs}, best.runs ${RC.best('switchback', 'normal', 'campaign')?.runs}, archive ${RC.runs.length})`);
}

console.log(`achievements: ${ACHIEVEMENTS.length} (${tiers.bronze} bronze, ${tiers.silver} silver, ${tiers.gold} gold, ${ACHIEVEMENTS.filter((a) => a.hidden).length} hidden), each unlocked by its own synthetic stream, none by an empty run`);
console.log(fail ? `${fail} FAILED` : 'all achievement checks passed');
process.exit(fail ? 1 : 0);
