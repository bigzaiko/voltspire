// Headless balance run: node tools/balance.ts [runs] [skill] [nohero|hero|mono:<mix>|focus:<mix>] [mapId|all] [easy|normal|hard] [quiet|survival] [solo|coop]
// focus:<mix> is the same focused build with the Uplink (e.g. focus:rail).
// mono:<mix> is a focused build without the Uplink: one tower family plus its cards, e.g. mono:pulse (= pulse:0.8,cryo:0.2), mono:lance, mono:arc:0.7,cryo:0.3
// coop runs two bots on one co-op simulation.
// Prints one line per run and a summary per map (wins, average wave reached, core integrity left, game time).
import { Sim } from '../src/game/sim.ts';
import { Bot } from '../src/game/bot.ts';
import { MAPS } from '../src/game/maps.ts';
import { validateMap } from '../src/game/map.ts';
import { TUNE, TOWERS } from '../src/game/data.ts';
import type { TowerType } from '../src/game/data.ts';
// e.g. TUNE='hp2=0.07,arrow=14' node tools/balance.ts 5 1 hero all normal
for (const kv of (process.env.TUNE || '').split(',')) { const [k, v] = kv.split('='); if (k && v && Object.hasOwn(TUNE, k) && Number.isFinite(+v)) (TUNE as Record<string, number>)[k] = +v; }
// e.g. TOWER='lance.dmg=7.5,pulse.rate=3' overrides tower stats for a sweep
for (const kv of (process.env.TOWER || '').split(',')) { const [k, v] = kv.split('='), [t, f] = (k || '').split('.'); if (t && v && Object.hasOwn(TOWERS, t) && ['dmg', 'rate', 'range', 'cost'].includes(f) && Number.isFinite(+v)) (TOWERS[t as TowerType] as unknown as Record<string, number>)[f] = +v; }
const runs = +(process.argv[2] || 5), skill = +(process.argv[3] || 1);
const style = process.argv[4] || 'hero', focus = style.startsWith('focus:'), mono = style.startsWith('mono:') ? style.slice(5) : focus ? style.slice(6) : '', noHero = style === 'nohero' || (!!mono && !focus);
const coop = process.argv[8] === 'coop';
let mix: Record<string, number> | null = null;
if (mono) {
  mix = {};
  if (!mono.includes(',') && !/:\d/.test(mono)) { mix[mono] = mono === 'cryo' ? 1 : 0.8; if (mono !== 'cryo') mix.cryo = 0.2; }
  else for (const part of mono.split(',')) { const [t, n] = part.split(':'); if (Object.hasOwn(TOWERS, t) && Number.isFinite(+n)) mix[t] = +n; }
}
const which = process.argv[5] || 'switchback', diff = process.argv[6] || 'normal';
const quiet = process.argv[7] === 'quiet', survival = process.argv[7] === 'survival';
for (const map of MAPS.filter((m) => which === 'all' || m.id === which)) {
  const bad = validateMap(map);
  if (bad) { console.log(map.id, 'INVALID:', bad); continue; }
  let wins = 0, waves = 0, lives = 0, time = 0, start = 0;
  for (let r = 0; r < runs; r++) {
    const sim = new Sim({ seed: 1000 + r, pauseOnCards: false, map, diff, survival, mode: coop ? 'coop' : 'solo', players: coop ? 2 : 1 });
    const bots = sim.players.map((_, i) => new Bot(sim, i, skill));
    if (mix) for (const b of bots) { b.mix = mix; b.mixHero = focus; for (const t in mix) sim.unlocked.add(t as TowerType); }
    let ults = 0, specials = 0, crits = 0, mark = 0;
    const trail: number[] = [];
    start = sim.lives;
    for (let i = 0; i < 60 * 60 * 60 && !sim.over; i++) {
      if (noHero) for (const p of sim.players) p.energy = 0;
      for (const b of bots) b.step(1 / 60);
      sim.step(1 / 60);
      for (const e of sim.events) { if (e.k === 'heroOn') ults++; else if (e.k === 'special') specials++; else if (e.k === 'crit') crits++; }
      sim.events.length = 0;
      if (sim.wave >= mark + 5) { mark += 5; trail.push(sim.lives); }
    }
    if (sim.won) wins++;
    waves += sim.wave; lives += sim.lives; time += sim.time;
    if (!quiet) console.log(`${map.id.padEnd(11)} ${diff.padEnd(6)} run ${r}: ${sim.won ? 'WON ' : 'lost'} wave ${String(sim.wave).padStart(2)}/${sim.winWave} t=${Math.round(sim.time)}s lives=${sim.lives} lvl=${sim.level} towers=${sim.towers.length} spires=${sim.spires} kills=${sim.kills} ults=${ults} specials=${specials} crits=${crits} lives@5,10,..=${trail.join(',')}`);
  }
  console.log(`== ${map.id.padEnd(11)} ${diff.padEnd(6)} ${(coop ? 'coop ' : '') + (mono ? style : noHero ? 'nohero' : 'hero  ')} skill ${skill}: won ${wins}/${runs}  avg wave ${(waves / runs).toFixed(1)}  avg lives ${(lives / runs).toFixed(1)}/${start}  avg time ${(time / runs / 60).toFixed(1)} min`);
}
