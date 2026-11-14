// Headless balance run: node tools/balance.ts [runs] [skill]
import { Sim } from '../src/game/sim.ts';
import { Bot } from '../src/game/bot.ts';
const runs = +(process.argv[2] || 5), skill = +(process.argv[3] || 1), noHero = process.argv[4] === 'nohero';
for (let r = 0; r < runs; r++) {
  const sim = new Sim({ seed: 1000 + r, pauseOnCards: false });
  const bot = new Bot(sim, 0, skill);
  const log: string[] = [];
  let lastWave = 0, ults = 0;
  for (let i = 0; i < 60 * 60 * 40 && !sim.over; i++) {
    if (noHero) sim.players[0].energy = 0;
    bot.step(1 / 60); sim.step(1 / 60);
    for (const e of sim.events) if (e.k === 'heroOn') ults++;
    sim.events.length = 0;
    if (sim.wave !== lastWave) { lastWave = sim.wave; if (sim.wave % 5 === 0) log.push(`w${sim.wave}@${Math.round(sim.time)}s L${sim.lives} lv${sim.level} tw${sim.towers.length}`); }
  }
  console.log(`run ${r}: ${sim.won ? 'WON ' : 'lost'} wave ${sim.wave} t=${Math.round(sim.time)}s lives=${sim.lives} lvl=${sim.level} towers=${sim.towers.length} kills=${sim.kills} ults=${ults} | ${log.join(' ')}`);
}
