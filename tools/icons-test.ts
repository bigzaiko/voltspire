// The chain derivation behind the recipe diagrams (src/icons.ts: recipes, chainOf, chainText), without a DOM: node tools/icons-test.ts
// Every item, fluid and tower (also at Mk3) has to come out as a tree from deposits to the product that agrees with data.ts,
// and a recipe changed in MAKES has to show up without a change to icons.ts.
import { recipes, chainOf, chainText, ICON_NAMES, iconLabel } from '../src/icons.ts';
import type { ChainNode, Chain, Res } from '../src/icons.ts';
import {
  ITEM_TYPES, FLUID_TYPES, TOWER_TYPES, FAC_TYPES, ORE_TYPES, TARGET_MODES, MAKES, FACS, TOWERS, TOWER_CHAIN, TOWER_CHAIN_L3, TOWER_NEEDS_L3, needsOf, ITEM_SHOTS,
} from '../src/game/data.ts';
import type { FacType, Recipe } from '../src/game/data.ts';
import { MINE_TIME, SMELT_TIME, COAL_SMELTS, REFINE_IN, REFINE_OUT, REFINE_TIME, GEN_POWER, COAL_SECONDS, PUMP_RATE } from '../src/game/factory.ts';

let fail = 0, n = 0;
const ok = (c: unknown, m: string) => { n++; if (!c) { fail++; console.log('FAIL', m); } };
const walk = (r: ChainNode, f: (x: ChainNode, parent?: ChainNode) => void, parent?: ChainNode) => { f(r, parent); for (const k of r.kids) walk(k, f, r); };
const find = (c: Chain, id: string) => { let hit: ChainNode | undefined; for (const r of [...c.roots, ...(c.power ? [c.power] : []), ...c.fuel]) walk(r, (x) => { if (!hit && x.id === id && x.kind !== 'ore') hit = x; }); return hit; };

// an icon for every name the data knows (the types make a missing one a compile error; this guards the lists)
for (const k of [...ITEM_TYPES, ...FLUID_TYPES, ...ORE_TYPES.map((o) => 'dep_' + o), ...FAC_TYPES.map((f) => 'fac_' + f), 'fac_crate', ...TOWER_TYPES.map((t) => 'tw_' + t), ...TARGET_MODES.map((m) => 'aim_' + m), 'mats', 'power', 'credits', 'time', 'st_ok', 'st_missing', 'st_notaker', 'st_locked'])
  ok((ICON_NAMES as string[]).includes(k), 'icon ' + k);
for (const k of ICON_NAMES) ok(iconLabel(k), 'label ' + k);

// the steps: one per MAKES recipe, as written there, and the five buildings with rules of their own
const steps = recipes();
for (const f of Object.keys(MAKES) as FacType[]) {
  const r = MAKES[f]!, s = steps.find((x) => x.fac === f)!;
  ok(s, 'step ' + f);
  ok(s.time === r.time && s.power === (FACS[f].power ?? 0), 'time and power ' + f);
  ok(s.out === (r.out ?? 'mats') && s.n === (r.out ? 1 : r.mats), 'output ' + f);
  for (const it of ITEM_TYPES) ok((s.inp.find((i) => i.res === it)?.n ?? 0) === (r.inp[it] ?? 0), `input ${it} of ${f}`);
  ok(r.fluid ? s.inp.find((i) => i.res === r.fluid![0])?.n === r.fluid[1] : !s.inp.some((i) => (FLUID_TYPES as string[]).includes(i.res)), 'fluid ' + f);
}
ok(steps.filter((s) => s.fac === 'mine').length === 3 && steps.every((s) => s.fac !== 'mine' || (s.time === MINE_TIME && s.on === s.out)), 'mines');
ok(steps.filter((s) => s.fac === 'smelter').every((s) => s.time === SMELT_TIME && s.fuel?.res === 'coal' && s.fuel.per === COAL_SMELTS && !s.power), 'smelter');
{ const s = steps.find((x) => x.fac === 'refinery')!; ok(s.inp[0].n === REFINE_IN && s.n === REFINE_OUT && s.time === REFINE_TIME && s.power === FACS.refinery.power, 'refinery'); }
{ const s = steps.find((x) => x.fac === 'generator')!; ok(s.out === 'power' && s.n === GEN_POWER && s.time === COAL_SECONDS && s.inp[0].res === 'coal', 'generator'); }
{ const s = steps.find((x) => x.fac === 'pump')!; ok(s.out === 'crude' && s.rate && s.n === PUMP_RATE && s.on === 'oil' && s.power === FACS.pump.power, 'pumpjack'); }

/** A chain is sound: every leaf a deposit, every made node agrees with a step, power and fuel are covered. */
const sound = (c: Chain | null, what: string) => {
  ok(c && c.roots.length, 'chain ' + what);
  if (!c) return;
  const all = [...c.roots, ...(c.power ? [c.power] : []), ...c.fuel], steps = recipes();
  let needsPower = false; const fuels = new Set<string>(), made = new Set<string>();
  for (const r of all) walk(r, (x) => {
    if (x.kind !== 'ore') made.add(x.id);
    if (!x.kids.length) ok(x.kind === 'ore' && (ORE_TYPES as string[]).includes(x.id), `${what}: leaf ${x.id} is a deposit`);
    if (x.by?.power) needsPower = true;
    if (x.by?.fuel) fuels.add(x.by.fuel.res);
    if (x.kind === 'res') {
      const s = steps.find((q) => q.fac === x.by?.fac && q.out === x.id);
      ok(s, `${what}: ${x.id} has a maker`);
      if (!s) return;
      ok(c.facs.includes(s.fac), `${what}: lists ${s.fac}`);
      ok(x.kids.length === s.inp.length + (s.on ? 1 : 0), `${what}: ${x.id} has all its inputs`);
      for (const i of s.inp) ok(x.kids.some((k) => k.id === i.res && k.n === i.n), `${what}: ${x.id} takes ${i.n} ${i.res}`);
      ok(s.rate ? x.by!.rate === s.n : x.by!.time === s.time && x.by!.n === s.n, `${what}: ${x.id} batch`);
    }
  });
  ok(!needsPower || made.has('power'), `${what}: power is drawn`);
  for (const f of fuels) ok(made.has(f), `${what}: fuel ${f} is drawn`);
  ok(new Set(c.facs).size === c.facs.length && c.ores.length > 0, `${what}: lists`);
};

for (const it of ITEM_TYPES) { const c = chainOf({ item: it }); sound(c, it); ok(c?.roots[0].id === it, 'root ' + it); ok(chainText({ item: it }).length > 10, 'text ' + it); }
for (const f of FLUID_TYPES) { const c = chainOf({ fluid: f }); sound(c, f); ok(c?.roots[0].id === f, 'root ' + f); }
for (const r of ['mats', 'power'] as Res[]) sound(chainOf({ res: r }), r);
for (const t of TOWER_TYPES) for (const lvl of [1, 2, 3]) {
  const what = `${t} L${lvl}`, c = chainOf({ tower: t }, lvl), nd = needsOf({ type: t, lvl });
  sound(c, what);
  if (!c) continue;
  const root = c.roots[0];
  ok(root.kind === 'tower' && root.id === t && c.roots.length === 1, `${what}: root`);
  ok(!nd.item || root.kids.some((k) => k.id === nd.item), `${what}: item ${nd.item}`);
  ok(!nd.fluid || root.kids.some((k) => k.id === nd.fluid), `${what}: fluid ${nd.fluid}`);
  ok((root.by?.power ?? 0) === (nd.power ?? 0), `${what}: power`);
  ok(!nd.power || !!find(c, 'power'), `${what}: power tree`);
  if (nd.item && TOWERS[t].rate > 0) ok(Math.abs(root.by!.time! - (nd.shots ?? ITEM_SHOTS[nd.item] ?? 1) / TOWERS[t].rate) < 1e-9, `${what}: item time`);
  // nothing in the chain that the tower's blueprint (and at Mk3 its upgrade) does not unlock; the Mine and the belt come with the first tower
  const unlocked = new Set<FacType>(['mine', ...TOWER_CHAIN[t], ...(lvl >= 3 ? TOWER_CHAIN_L3[t] ?? [] : [])]);
  for (const f of c.facs) ok(unlocked.has(f), `${what}: ${f} is unlocked with it`);
  // the power one of each draws: the tower and every powered building once
  ok(c.draw === (nd.power ?? 0) + c.facs.reduce((s, f) => s + (FACS[f].power ?? 0), 0), `${what}: draw ${c.draw}`);
}
// Mk3 alone no longer changes what a tower eats: its second ammunition is a switch per tower (Tower.ammo2, after its card),
// so chainOf({ tower }, 3) is the first ammunition's chain; the second one's buildings are TOWER_CHAIN_L3
ok(Object.keys(TOWER_NEEDS_L3).length > 0 && chainText({ tower: 'pulse' }, 3) === chainText({ tower: 'pulse' }, 1), 'Mk3 alone keeps the pulse chain');
for (const t of Object.keys(TOWER_NEEDS_L3) as (keyof typeof TOWER_NEEDS_L3)[]) {
  const n = TOWER_NEEDS_L3[t]!, c = chainOf(n.item ? { item: n.item } : { fluid: n.fluid! });
  const have = new Set<FacType>(['mine', ...TOWER_CHAIN[t], ...(TOWER_CHAIN_L3[t] ?? [])]);
  ok(!!c && c.facs.every((f) => have.has(f)), `${t}: the second ammunition's chain is covered by its buildings (${c?.facs.join()})`);
}
// spot checks against the rules as the game states them
{ const c = chainOf({ item: 'shell' })!; ok(c.facs.join() === 'mine,generator,smelter,press' && c.ores.join() === 'iron_ore,coal' && !c.fuel.length && !!c.power, 'shell: ' + c.facs.join() + ' / ' + c.ores.join()); }
{ const c = chainOf({ tower: 'missile' })!; ok(c.ores.join() === 'iron_ore,copper_ore,coal,oil' && c.facs.join() === 'mine,generator,pump,smelter,refinery,missiles', 'missile: ' + c.facs.join()); }
{ const c = chainOf({ item: 'iron' })!; ok(!c.power && c.fuel.length === 1 && c.fuel[0].id === 'coal', 'iron plate: coal as fuel, no power'); }
{ const c = chainOf({ tower: 'cryo' })!; ok(c.roots[0].kids[0].id === 'power' && !c.power, 'cryo: the power tree is its chain'); }
ok(chainOf({ fac: 'smelter' })!.roots.length === 2 && chainOf({ fac: 'mine' })!.roots.length === 3 && !chainOf({ fac: 'belt' }) && !chainOf({ fac: 'pole' }), 'buildings');
ok(chainText({ res: 'mats' }).includes('Frame Works: 2 Iron plate + 2 power -> 1 Building materials in 5 s'), 'frame text: ' + chainText({ res: 'mats' }));

// a recipe changed or added in MAKES shows up without a change to icons.ts
{
  const M = MAKES as Partial<Record<FacType, Recipe>>, old = M.press, oldCrate = M.crate;
  M.press = { inp: { copper: 3 }, fluid: ['petrol', 5], out: 'shell', time: 9 };
  const c = chainOf({ item: 'shell' })!, sh = c.roots[0];
  sound(c, 'changed shell');
  ok(sh.by!.time === 9 && sh.kids.some((k) => k.id === 'copper' && k.n === 3) && sh.kids.some((k) => k.id === 'petrol' && k.n === 5) && c.facs.includes('refinery') && c.ores.includes('oil'), 'changed recipe is followed');
  M.press = old;
  M.crate = { inp: { shell: 2, cell: 1 }, mats: 3, time: 4 };
  delete M.works;
  const m = chainOf({ res: 'mats' })!;
  sound(m, 'new mats');
  ok(m.roots[0].by!.fac === 'crate' && m.roots[0].n === 3 && m.facs.includes('cells') && m.facs.includes('press'), 'new recipe is followed');
  M.works = { inp: { iron: 2 }, mats: 1, time: 5 }; if (oldCrate) M.crate = oldCrate; else delete M.crate;
  // a loop in the data must not hang
  M.works = { inp: { shell: 1 }, mats: 1, time: 5 }; M.press = { inp: { iron: 1 }, fluid: undefined, out: 'shell', time: 6 };
  const sm = MAKES.missiles; M.missiles = { inp: { missile: 1 }, out: 'missile', time: 1 };
  ok(chainOf({ item: 'missile' })!.roots[0].kids.length === 1, 'a recipe that eats its own product ends');
  M.missiles = sm; M.press = old; M.works = { inp: { iron: 2 }, mats: 1, time: 5 };
}
console.log(fail ? `icons-test: ${fail} of ${n} FAILED` : `icons-test: ${n} checks ok`);
process.exit(fail ? 1 : 0);
