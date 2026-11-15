// Headless balance run: node tools/balance.ts [runs] [skill] [nohero|hero|uplink|mono:<mix>|focus:<mix>] [mapId|all] [easy|normal|hard] [quiet|survival] [solo|coop]
// uplink plays Uplink mode: the bot stands on a Spire for the whole run and builds from there.
// focus:<mix> is the same focused build with the Uplink (e.g. focus:rail).
// mono:<mix> is a focused build without the Uplink: one tower family plus its cards, e.g. mono:pulse (= pulse:0.8,cryo:0.2), mono:lance, mono:arc:0.7,cryo:0.3
// coop runs two bots on one co-op simulation.
// mapId can also be a generated map: gen-<tier>-<seed> (e.g. gen-2-1234), 'gen' for six generated maps per tier,
// 'gen1' / 'gen2' / 'gen3' for six of one tier, or a comma list of ids.
//
// The whole grid at once, one process per cell, as a table:
//   node tools/balance.ts matrix [runs] [maps] [diffs] [styles] [survival]
//   e.g. node tools/balance.ts matrix 6 all,gen easy,normal,hard hero,nohero
//   or, campaign and Uplink mode side by side: node tools/balance.ts matrix 6 all,gen easy,normal,hard hero,uplink
// Each cell reads: wins/runs, average wave reached (lowest wave), core integrity left in percent. The last columns are, for the
// first style on the middle difficulty listed: the game time, the waves per Uplink between waves 8 and 18, the core integrity left
// when wave 20 begins (runs that got there), and the Titan: how often it was destroyed, after how many seconds, and how far down its road it got.
// The closing lines give the same Titan figures for every style and difficulty, summed over the maps.
//
// Variants side by side (ablations and sweeps), each summed over the maps given:
//   node tools/balance.ts sweep [runs] [maps] <variant> <variant> ...
//   a variant is 'base' or environment switches joined by ';', e.g. 'BAN=arc' 'TUNE=energy=0.7;HP=0.9' 'GIVE=hollow:2'
//   e.g. node tools/balance.ts sweep 8 all base BAN=arc BAN=cards:arc BAN=kind:hero BAN=specials
// Each row reads, for hero runs on normal and hard and no-hero runs on normal: wins/runs, average wave, core integrity left;
// then, for the first column, the game time, the waves per Uplink (waves 8 to 18) and the wave of the first Uplink; the core integrity
// left after wave 5 without the hero; the tower specials fired per run; and, for the first column again, the core integrity left when
// wave 20 begins and how many of the Titans were destroyed. COLS='hard:hero,easy:nohero' picks other columns (styles hero, nohero, uplink).
//
// Environment switches (they carry over into matrix cells):
// BAN='arc,missile' locks tower types (never unlocked, their blueprint is never offered); BAN='card:hollow,kind:hero' removes cards by id or kind;
// BAN='cards:arc' removes the dedicated cards of one tower type but keeps the tower. BAN='specials' makes the bot never fire tower specials.
// GIVE='hollow:2,chain' hands out cards at the start of a run (what is one card worth when it comes for free?). SEED0=<n> shifts the run seeds (default 1000).
// HP=<n> scales every enemy's health and shield, TDMG=<n> every tower's damage (sweeps).
// TUNE='hp2=0.07,arrow=14' overrides TUNE knobs, TOWER='lance.dmg=7.5' tower stats, ENEMY='brute.hp=190' enemy stats,
// MAP='gold=1.2,lives=0.8' scales the starting credits and core integrity of every map.
// MAPMUL=<n> forces the map's enemy health multiplier (what mapEase() would return), to calibrate the mapLen / mapCov knobs.
// Prints one line per run and a summary per map (wins, average and lowest wave reached, core integrity left, game time, Uplinks and tower specials per run).
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { Sim } from '../src/game/sim.ts';
import { Bot } from '../src/game/bot.ts';
import { MAPS } from '../src/game/maps.ts';
import { validateMap } from '../src/game/map.ts';
import { TUNE, TOWERS, CARDS, CARD_BY_ID, ENEMIES, TOWER_TYPES } from '../src/game/data.ts';
import { generateMap } from '../src/game/mapgen.ts';
import type { MapDef } from '../src/game/map.ts';
import type { TowerType, EnemyType } from '../src/game/data.ts';

/** Seeds of the generated maps the 'gen' groups stand for. */
const GEN_SEEDS = [1234, 2087, 3391, 4410, 5566, 6072];
const DIFF_IDS = ['easy', 'normal', 'hard'];

/** Expand a map argument (ids, 'all', 'gen', 'gen2', 'gen-2-1234', comma lists) into map definitions. */
function mapsFor(which: string): MapDef[] {
  const out: MapDef[] = [];
  for (const id of which.split(',')) {
    const g = /^gen-([123])-(\d{1,9})$/.exec(id);
    if (id === 'all') out.push(...MAPS);
    else if (g) out.push({ ...generateMap(+g[2], +g[1]), id });
    else if (/^gen[123]?$/.test(id)) { for (const t of id.length > 3 ? [+id[3]] : [1, 2, 3]) for (const sd of GEN_SEEDS) out.push({ ...generateMap(sd, t), id: `gen-${t}-${sd}` }); }
    else { const m = MAPS.find((x) => x.id === id); if (m) out.push(m); else console.log(id, 'UNKNOWN MAP'); }
  }
  return out;
}

interface Cell { map: string; tier: number; mul: number; diff: string; style: string; runs: number; wins: number; wave: number; minWave: number; lives: number; start: number; time: number; winTime: number; ults: number; specials: number; perUlt: number; ult1: number; lives6: number; lives20: number; titans: number; titanKills: number; titanTime: number; titanProg: number; towers: Record<string, number> }

if (process.argv[2] === 'matrix') await matrix();
else if (process.argv[2] === 'sweep') await sweep();
else single();

function single() {
  for (const kv of (process.env.TUNE || '').split(',')) { const [k, v] = kv.split('='); if (k && v && Object.hasOwn(TUNE, k) && Number.isFinite(+v)) (TUNE as Record<string, number>)[k] = +v; }
  for (const kv of (process.env.TOWER || '').split(',')) { const [k, v] = kv.split('='), [t, f] = (k || '').split('.'); if (t && v && Object.hasOwn(TOWERS, t) && ['dmg', 'rate', 'range', 'cost', 'aoe'].includes(f) && Number.isFinite(+v)) (TOWERS[t as TowerType] as unknown as Record<string, number>)[f] = +v; }
  for (const kv of (process.env.ENEMY || '').split(',')) { const [k, v] = kv.split('='), [t, f] = (k || '').split('.'); if (t && v && Object.hasOwn(ENEMIES, t) && ['hp', 'speed', 'bounty', 'xp', 'energy', 'armor', 'shield', 'leak', 'cost'].includes(f) && Number.isFinite(+v)) (ENEMIES[t as EnemyType] as unknown as Record<string, number>)[f] = +v; }
  const mapScale = { gold: 1, lives: 1 };
  for (const kv of (process.env.MAP || '').split(',')) { const [k, v] = kv.split('='); if ((k === 'gold' || k === 'lives') && +v > 0) mapScale[k] = +v; }
  const runs = +(process.argv[2] || 5), skill = +(process.argv[3] || 1);
  const style = process.argv[4] || 'hero', focus = style.startsWith('focus:'), mono = style.startsWith('mono:') ? style.slice(5) : focus ? style.slice(6) : '', noHero = style === 'nohero' || (!!mono && !focus);
  const uplink = style === 'uplink';
  const coop = process.argv[8] === 'coop';
  let mix: Record<string, number> | null = null;
  if (mono) {
    mix = {};
    if (!mono.includes(',') && !/:\d/.test(mono)) { mix[mono] = mono === 'cryo' ? 1 : 0.8; if (mono !== 'cryo') mix.cryo = 0.2; }
    else for (const part of mono.split(',')) { const [t, n] = part.split(':'); if (Object.hasOwn(TOWERS, t) && Number.isFinite(+n)) mix[t] = +n; }
  }
  const which = process.argv[5] || 'switchback', diff = process.argv[6] || 'normal';
  const quiet = process.argv[7] === 'quiet', survival = process.argv[7] === 'survival';
  const json = process.env.JSON === '1';
  const banned = (process.env.BAN || '').split(',').map((x) => x.trim()).filter(Boolean);
  const banTowers = banned.filter((b) => Object.hasOwn(TOWERS, b)) as TowerType[];
  const noSpecials = banned.includes('specials');
  for (const c of CARDS) {
    if (banned.includes('card:' + c.id) || banned.includes('kind:' + c.kind) || (c.needs && (banTowers.includes(c.needs) || banned.includes('cards:' + c.needs))) || (c.kind === 'blueprint' && banTowers.includes(c.id.slice(3) as TowerType))) c.max = 0;
  }
  const give: [string, number][] = [];
  for (const part of (process.env.GIVE || '').split(',')) { const [id, n] = part.trim().split(':'); if (id && Object.hasOwn(CARD_BY_ID, id)) give.push([id, Math.max(1, Math.min(CARD_BY_ID[id].max, +(n || 1) | 0))]); }
  const seed0 = Number.isFinite(+(process.env.SEED0 || NaN)) ? +process.env.SEED0! : 1000;
  const hpScale = +(process.env.HP || 1) || 1, dmgScale = +(process.env.TDMG || 1) || 1;
  for (const e of Object.values(ENEMIES)) { e.hp *= hpScale; e.shield *= hpScale; }
  for (const t of Object.values(TOWERS)) t.dmg *= dmgScale;
  const forceMul = +(process.env.MAPMUL || 0) || 0;
  for (const def of mapsFor(which)) {
    const map: MapDef = { ...def, gold: Math.round(def.gold * mapScale.gold), lives: Math.max(1, Math.round(def.lives * mapScale.lives)) };
    const bad = validateMap(map);
    if (bad) { console.log(map.id, 'INVALID:', bad); continue; }
    let wins = 0, waves = 0, lives = 0, time = 0, winTime = 0, start = 0, minWave = 1e9, ultSum = 0, specSum = 0, midUlts = 0, midWaves = 0, mul = 1, ult1 = 0, ult1N = 0, lives6 = 0, lives6N = 0, lives20 = 0, lives20N = 0, titans = 0, titanKills = 0, titanTime = 0, titanProg = 0;
    const built: Record<string, number> = {};
    for (let r = 0; r < runs; r++) {
      const sim = new Sim({ seed: seed0 + r, pauseOnCards: false, map, diff, survival, uplink, mode: coop ? 'coop' : 'solo', players: coop ? 2 : 1 });
      const bots = sim.players.map((_, i) => new Bot(sim, i, skill));
      if (mix) for (const b of bots) { b.mix = mix; b.mixHero = focus; for (const t in mix) sim.unlocked.add(t as TowerType); }
      if (forceMul > 0) sim.mapMul = forceMul;
      mul = sim.mapMul;
      for (const t of banTowers) sim.unlocked.delete(t);
      if (noHero) for (const b of bots) b.useHero = false;
      if (noSpecials) for (const b of bots) b.useSpecials = false;
      for (const [id, n] of give) {
        const card = CARD_BY_ID[id];
        if (card.needs) sim.unlocked.add(card.needs);
        for (const p of sim.players) {
          const st = card.kind === 'hero' ? p.stacks : sim.stacks;
          for (let k = st[id] || 0; k < n; k++) { st[id] = k + 1; card.apply({ mods: sim.mods, hero: p.stats, unlocked: sim.unlocked, addGold: (g) => { sim.gold += g; }, addLives: (l) => { sim.lives = Math.min(30, sim.lives + l); } }); }
          if (card.kind !== 'hero') break;
        }
      }
      let ults = 0, specials = 0, crits = 0, mark = 0, mid = 0, seen = 0, first = 0, landed = 0, prog = 0;
      const trail: number[] = [];
      start = sim.lives;
      for (let i = 0; i < 60 * 60 * 90 && !sim.over; i++) {
        if (noHero) for (const p of sim.players) p.energy = 0;
        for (const b of bots) b.step(1 / 60);
        sim.step(1 / 60);
        for (const e of sim.events) {
          if (e.k === 'heroOn') { ults++; if (!first) first = sim.wave; if (sim.wave >= 8 && sim.wave <= 18) mid++; } else if (e.k === 'special') specials++; else if (e.k === 'crit') crits++;
          else if (e.k === 'titanImpact') { titans++; landed = sim.time; }
          else if (e.k === 'titanDie') { titanKills++; titanTime += sim.time - landed; titanProg += prog; }
        }
        sim.events.length = 0;
        if (sim.titan.phase === 'walk') { const ti = sim.enemies.find((e) => e.type === 'titan'); if (ti) prog = ti.dist / sim.map.lanes[ti.lane].len; }
        if (sim.wave >= mark + 5) { mark += 5; trail.push(sim.lives); }
        if (sim.wave > seen) { seen = sim.wave; if (seen === 6) { lives6 += sim.lives; lives6N++; } if (seen === 20) { lives20 += sim.lives; lives20N++; } }
      }
      if (sim.won) { wins++; winTime += sim.time; }
      waves += sim.wave; lives += sim.lives; time += sim.time; minWave = Math.min(minWave, sim.wave); ultSum += ults; specSum += specials;
      // Uplinks per wave over the middle of the run (waves 8 to 18, as far as the run got)
      if (seen >= 8) { midUlts += mid; midWaves += Math.min(18, seen) - 7; }
      if (first) { ult1 += first; ult1N++; }
      for (const t of sim.towers) built[t.type] = (built[t.type] || 0) + 1 / runs;
      if (!quiet && !json) console.log(`${map.id.padEnd(11)} ${diff.padEnd(6)} run ${r}: ${sim.won ? 'WON ' : 'lost'} wave ${String(sim.wave).padStart(2)}/${sim.winWave} t=${Math.round(sim.time)}s lives=${sim.lives} lvl=${sim.level} towers=${sim.towers.length} spires=${sim.spires} kills=${sim.kills} ults=${ults} specials=${specials} crits=${crits} lives@5,10,..=${trail.join(',')}`);
    }
    const label = (coop ? 'coop ' : '') + (mono ? style : noHero ? 'nohero' : uplink ? 'uplink' : 'hero  ');
    if (json) {
      const cell: Cell = { map: map.id, tier: map.tier || 0, mul, diff, style: label.trim(), runs, wins, wave: waves / runs, minWave, lives: lives / runs, start, time: time / runs / 60, winTime: wins ? winTime / wins / 60 : 0, ults: ultSum / runs, specials: specSum / runs, perUlt: midUlts ? midWaves / midUlts : 0, ult1: ult1N ? ult1 / ult1N : 0, lives6: lives6N ? lives6 / lives6N : 0, lives20: lives20N ? lives20 / lives20N : 0, titans, titanKills, titanTime: titanKills ? titanTime / titanKills : 0, titanProg: titanKills ? titanProg / titanKills : 0, towers: built };
      console.log('JSON ' + JSON.stringify(cell));
    } else {
      console.log(`== ${map.id.padEnd(11)} ${diff.padEnd(6)} ${label} skill ${skill}: won ${wins}/${runs}  avg wave ${(waves / runs).toFixed(1)}  avg lives ${(lives / runs).toFixed(1)}/${start}  avg time ${(time / runs / 60).toFixed(1)} min  min wave ${minWave}  ults ${(ultSum / runs).toFixed(1)}  waves/ult ${midUlts ? (midWaves / midUlts).toFixed(2) : '-'}  first ult wave ${ult1N ? (ult1 / ult1N).toFixed(1) : '-'}  lives after wave 5 ${lives6N ? (lives6 / lives6N).toFixed(1) : '-'}  lives at wave 20 ${lives20N ? (lives20 / lives20N).toFixed(1) : '-'}  specials ${(specSum / runs).toFixed(0)}  Titan destroyed ${titanKills}/${titans}${titanKills ? ` in ${(titanTime / titanKills).toFixed(0)} s at ${Math.round((100 * titanProg) / titanKills)}% of its road` : ''}  mapMul ${mul.toFixed(2)}`);
      if (!quiet) console.log('   towers at the end: ' + TOWER_TYPES.filter((t) => built[t]).map((t) => `${t} ${built[t].toFixed(1)}`).join(', '));
    }
  }
}

interface Job { key: string; map: string; diff: string; style: string; runs: number; mode: string; env: Record<string, string> }
/** Run each job in a process of its own (as many at once as there are spare cores) and collect the cells by job key. */
async function runJobs(jobs: Job[]): Promise<Map<string, Cell>> {
  const cells = new Map<string, Cell>();
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const out = await new Promise<string>((res) => {
        const p = spawn(process.execPath, [process.argv[1], String(j.runs), '1', j.style, j.map, j.diff, j.mode], { env: { ...process.env, ...j.env, JSON: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        p.stdout.on('data', (d) => { buf += d; });
        p.on('close', () => res(buf));
      });
      const line = out.split('\n').find((l) => l.startsWith('JSON '));
      if (line) cells.set(j.key, JSON.parse(line.slice(5)) as Cell);
      else console.log(`${j.key}: no result (${out.trim().slice(0, 80)})`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs.length, availableParallelism() - 2)) }, worker));
  return cells;
}

/** Run every map x difficulty x style cell in its own process and print one table. */
async function matrix() {
  const runs = Math.max(1, +(process.argv[3] || 6) | 0);
  const maps = mapsFor(process.argv[4] || 'all,gen');
  const diffs = (process.argv[5] || 'easy,normal,hard').split(',').filter((d) => DIFF_IDS.includes(d));
  const styles = (process.argv[6] || 'hero,nohero').split(',').filter((s) => /^(hero|nohero|uplink|(mono|focus):[a-z0-9:.,]+)$/.test(s));
  const survival = process.argv[7] === 'survival';
  const jobs: Job[] = [];
  for (const m of maps) for (const d of diffs) for (const s of styles) jobs.push({ key: `${m.id}|${d}|${s}`, map: m.id, diff: d, style: s, runs, mode: survival ? 'survival' : 'quiet', env: {} });
  const cells = await runJobs(jobs);
  const cols: string[] = [];
  for (const d of diffs) for (const s of styles) cols.push(`${d} ${s}`);
  const W = 19;
  const fmt = (c?: Cell) => (c ? `${c.wins}/${c.runs} ${c.wave.toFixed(1).padStart(4)}(${String(c.minWave).padStart(2)}) ${String(Math.round((100 * c.lives) / Math.max(1, c.start))).padStart(3)}%` : '-').padEnd(W);
  const ref = diffs.includes('normal') ? 'normal' : diffs[Math.floor(diffs.length / 2)];
  console.log(`${'map'.padEnd(12)} T  mul  | ${cols.map((c) => c.padEnd(W)).join(' | ')} | min   w/ult  core@20  Titan`);
  let l20 = 0, l20N = 0, tk = 0, tn = 0, tt = 0, tp = 0, mins = 0, minsN = 0;
  const tot = new Map<string, { w: number; n: number; wave: number; k: number }>();
  for (const m of maps) {
    const row = cols.map((c) => cells.get(`${m.id}|${c.replace(' ', '|')}`));
    const any = row.find((c) => c);
    const h = cells.get(`${m.id}|${ref}|${styles[0]}`);
    const titan = h && h.titans ? `${h.titanKills}/${h.titans}${h.titanKills ? ` ${h.titanTime.toFixed(0)}s ${Math.round(100 * h.titanProg)}%` : ''}` : '-';
    console.log(`${m.id.padEnd(12)} ${m.tier || '-'} ${(any ? any.mul : 0).toFixed(2)} | ${row.map(fmt).join(' | ')} | ${(h ? h.time : 0).toFixed(1).padStart(4)}  ${(h && h.perUlt ? h.perUlt.toFixed(2) : '-').padEnd(5)}  ${(h && h.lives20 ? Math.round((100 * h.lives20) / Math.max(1, h.start)) + '%' : '-').padEnd(7)}  ${titan}`);
    if (h) { if (h.lives20) { l20 += h.lives20 / Math.max(1, h.start); l20N++; } tk += h.titanKills; tn += h.titans; tt += h.titanTime * h.titanKills; tp += h.titanProg * h.titanKills; if (h.winTime) { mins += h.winTime; minsN++; } }
    cols.forEach((c, i) => {
      const cell = row[i];
      if (!cell) return;
      for (const key of [`T${m.tier || 0} ${m.id.startsWith('gen-') ? 'generated' : 'pre-made'}`, 'all maps']) {
        const t = tot.get(key + '|' + c) || { w: 0, n: 0, wave: 0, k: 0 };
        t.w += cell.wins; t.n += cell.runs; t.wave += cell.wave; t.k++;
        tot.set(key + '|' + c, t);
      }
    });
  }
  const groups = [...new Set([...tot.keys()].map((k) => k.split('|')[0]))].sort();
  for (const g of groups) console.log(`${g.padEnd(21)} | ${cols.map((c) => { const t = tot.get(g + '|' + c); return (t ? `${t.w}/${t.n} ${(t.wave / t.k).toFixed(1).padStart(4)}` : '-').padEnd(W); }).join(' | ')} |`);
  console.log(`${ref} ${styles[0]}: a won run takes ${minsN ? (mins / minsN).toFixed(1) : '-'} min, core left when wave 20 begins ${l20N ? Math.round((100 * l20) / l20N) + '%' : '-'}, Titan destroyed ${tk}/${tn}${tk ? ` after ${(tt / tk).toFixed(0)} s at ${Math.round((100 * tp) / tk)}% of its road` : ''}`);
  // the Titan for every column, so styles can be compared (e.g. the campaign against Uplink mode)
  for (const c of cols) {
    let k = 0, n = 0, t = 0, p = 0;
    for (const m of maps) { const cell = cells.get(`${m.id}|${c.replace(' ', '|')}`); if (cell) { k += cell.titanKills; n += cell.titans; t += cell.titanTime * cell.titanKills; p += cell.titanProg * cell.titanKills; } }
    console.log(`Titan ${c.padEnd(W)} destroyed ${k}/${n}${k ? ` after ${(t / k).toFixed(0)} s at ${Math.round((100 * p) / k)}% of its road` : ''}`);
  }
}

/** Variants side by side: each is a set of environment switches, summed over the maps. */
async function sweep() {
  const runs = Math.max(1, +(process.argv[3] || 6) | 0);
  const maps = mapsFor(process.argv[4] || 'all');
  const variants = process.argv.slice(5).filter((v) => v === 'base' || /^[A-Z0-9]+=/.test(v));
  if (!variants.length) variants.push('base');
  let cols: [string, string][] = [['normal', 'hero'], ['hard', 'hero'], ['normal', 'nohero']];
  // COLS='hard:hero,easy:nohero' picks other columns
  const pick = (process.env.COLS || '').split(',').map((c) => c.split(':')).filter((c) => DIFF_IDS.includes(c[0]) && (c[1] === 'hero' || c[1] === 'nohero' || c[1] === 'uplink')) as [string, string][];
  if (pick.length) cols = pick;
  const jobs: Job[] = [];
  for (const v of variants) {
    const env: Record<string, string> = {};
    if (v !== 'base') for (const part of v.split(';')) { const i = part.indexOf('='); if (i > 0 && /^[A-Z0-9]+$/.test(part.slice(0, i))) env[part.slice(0, i)] = part.slice(i + 1); }
    for (const m of maps) for (const [d, s] of cols) jobs.push({ key: `${v}|${m.id}|${d}|${s}`, map: m.id, diff: d, style: s, runs, mode: 'quiet', env });
  }
  const cells = await runJobs(jobs);
  const wide = Math.max(8, ...variants.map((v) => v.length));
  console.log(`${'variant'.padEnd(wide)} | ${cols.map(([d, s]) => `${d} ${s}`.padEnd(20)).join(' | ')} | min   w/ult  ult1  l@6  specials  core@20  Titan`);
  for (const v of variants) {
    const parts: string[] = [];
    let time = 0, pu = 0, puN = 0, spec = 0, k = 0, u1 = 0, l6 = 0, l6N = 0, l20 = 0, l20N = 0, tk = 0, tn = 0;
    for (const [d, s] of cols) {
      let w = 0, n = 0, wave = 0, lives = 0, c = 0;
      for (const m of maps) {
        const cell = cells.get(`${v}|${m.id}|${d}|${s}`);
        if (!cell) continue;
        w += cell.wins; n += cell.runs; wave += cell.wave; lives += cell.lives / Math.max(1, cell.start); c++;
        if (d === cols[0][0] && s === cols[0][1]) { time += cell.time; spec += cell.specials; u1 += cell.ult1; k++; if (cell.perUlt) { pu += cell.perUlt; puN++; } if (cell.lives20) { l20 += cell.lives20 / Math.max(1, cell.start); l20N++; } tk += cell.titanKills; tn += cell.titans; }
        if (s === 'nohero' || cols.every((c) => c[1] === 'hero')) { l6 += cell.lives6 / Math.max(1, cell.start); l6N++; }
      }
      parts.push((c ? `${String(w).padStart(3)}/${n} ${(wave / c).toFixed(1).padStart(4)} ${String(Math.round((100 * lives) / c)).padStart(3)}%` : '-').padEnd(20));
    }
    console.log(`${v.padEnd(wide)} | ${parts.join(' | ')} | ${(k ? time / k : 0).toFixed(1).padStart(4)}  ${puN ? (pu / puN).toFixed(2) : '-'}  ${(k ? u1 / k : 0).toFixed(1).padStart(4)}  ${l6N ? String(Math.round((100 * l6) / l6N)).padStart(3) + '%' : '-'}  ${(k ? spec / k : 0).toFixed(0).padEnd(8)}  ${(l20N ? Math.round((100 * l20) / l20N) + '%' : '-').padEnd(7)}  ${tk}/${tn}`);
  }
}
