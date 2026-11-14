// Headless balance run: node tools/balance.ts [runs] [skill] [nohero|hero] [mapId|all] [diff]
import { Sim } from '../src/game/sim.ts';
import { Bot } from '../src/game/bot.ts';
import { MAPS } from '../src/game/maps.ts';
import { validateMap } from '../src/game/map.ts';
const runs = +(process.argv[2] || 5), skill = +(process.argv[3] || 1), noHero = process.argv[4] === 'nohero';
const which = process.argv[5] || 'switchback', diff = process.argv[6] || 'normal';
for (const map of MAPS.filter((m) => which === 'all' || m.id === which)) {
  const bad = validateMap(map);
  if (bad) { console.log(map.id, 'INVALID:', bad); continue; }
  for (let r = 0; r < runs; r++) {
    const sim = new Sim({ seed: 1000 + r, pauseOnCards: false, map, diff });
    const bot = new Bot(sim, 0, skill);
    let ults = 0;
    for (let i = 0; i < 60 * 60 * 40 && !sim.over; i++) {
      if (noHero) sim.players[0].energy = 0;
      bot.step(1 / 60); sim.step(1 / 60);
      for (const e of sim.events) if (e.k === 'heroOn') ults++;
      sim.events.length = 0;
    }
    console.log(`${map.id.padEnd(11)} ${diff.padEnd(6)} run ${r}: ${sim.won ? 'WON ' : 'lost'} wave ${String(sim.wave).padStart(2)} t=${Math.round(sim.time)}s lives=${sim.lives} lvl=${sim.level} towers=${sim.towers.length} kills=${sim.kills} ults=${ults}`);
  }
}
