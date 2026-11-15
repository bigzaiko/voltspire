// Pick varied generated maps per tier: node tools/curate.ts [perTier] [candidates]
import { generateMap, mapStats } from '../src/game/mapgen.ts';
import { validateMap } from '../src/game/map.ts';
import { GW, GH } from '../src/game/hex.ts';
const per = +(process.argv[2] || 10), cand = +(process.argv[3] || 500);
for (const tier of [1, 2, 3]) {
  const pool: { seed: number; v: number[]; name: string; note: string }[] = [];
  for (let seed = 101; seed < 101 + cand; seed++) {
    const def = generateMap(seed, tier);
    if (validateMap(def)) continue;
    const st = mapStats(def);
    const roads = st.roads.length, len = st.total, cross = st.crossings.length;
    const short = Math.min(...st.roads);
    // feature vector, each term roughly 0..1
    const v = [roads / 3, len / 110, cross / 3, st.maxLevel / 3, def.core[0] / GW, def.core[1] / GH, short / 60, def.blocked.length / 24,
      ...def.lanes.slice(0, 1).map((l) => (l[0][0] < 0 ? 0 : l[0][0] >= GW ? 1 : l[0][1] < 0 ? 0.33 : 0.66))];
    pool.push({ seed, v, name: def.name, note: `${roads} road${roads > 1 ? 's' : ''}, ${Math.round(len)} tiles, ${cross} bridge${cross === 1 ? '' : 's'}, top level ${st.maxLevel}` });
  }
  // greedy farthest-point selection, never two maps with the same name
  const dist = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]));
  const picks = [pool[0]];
  while (picks.length < per) {
    let best = null as null | (typeof pool)[number], bd = -1;
    for (const c of pool) {
      if (picks.some((p) => p.seed === c.seed || p.name === c.name)) continue;
      const d = Math.min(...picks.map((p) => dist(p.v, c.v)));
      if (d > bd) { bd = d; best = c; }
    }
    if (!best) break;
    picks.push(best);
  }
  console.log(`// tier ${tier}`);
  for (const p of picks) console.log(`  [${tier}, ${p.seed}], // ${p.name}: ${p.note}`);
}
