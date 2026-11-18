// BEATSPIRE icon set: the materials, fluids, buildings, towers, targeting modes and supply states as small inline SVG, the
// HUD chip that carries one, and the recipe diagram that lays a production chain out as icons joined by arrows.
//
// Everything is built node by node (createElementNS, attributes only): no innerHTML, no inline style, no external file, so
// it runs under the site's Content-Security-Policy. The module holds no game state and touches the DOM only inside the
// functions that return elements, so the chain derivation (recipes / chainOf / chainText) also runs in Node (tools/icons-test.ts).
//
// One family: a 24 unit grid, solids with one light and one shaded facet (the light comes from the upper left), chamfered
// corners, 1.7 unit lines with square ends, round only where the thing itself is round. Each icon is told apart by its
// outline first; the colour (the item colours of data.ts) only confirms it. Materials are solid lumps, buildings stand on a
// ground line in neutral hull tones with one accent, towers stand on a chamfered plinth, targeting modes are sand ink
// with one apricot mark, supply states use the colours of the in-world cues (cues.ts).
import {
  ITEMS, ITEM_TYPES, FLUIDS, FLUID_TYPES, ORES, ORE_TYPES, FACS, FAC_TYPES, MAKES, TOWERS, ITEM_SHOTS, FUEL_PER_TICK, needsOf, TARGET_INFO,
} from './game/data.ts';
import type { ItemType, FluidType, OreType, FacType, TowerType, TargetMode, TowerNeeds } from './game/data.ts';
import { MINE_TIME, PUMP_RATE, SMELT_TIME, COAL_SMELTS, REFINE_IN, REFINE_OUT, REFINE_TIME, GEN_POWER, COAL_SECONDS } from './game/factory.ts';

// ---------------------------------------------------------------- names

export type StateName = 'ok' | 'missing' | 'notaker' | 'locked';
export type IconName =
  | ItemType | FluidType | 'mats' | 'power' | 'credits' | 'time'
  | `dep_${OreType}` | `fac_${FacType}` | `tw_${TowerType}` | `aim_${TargetMode}` | `st_${StateName}`;

// ---------------------------------------------------------------- paint

const mix = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

// the colours of the in-world cues (cues.ts) and of the console (style.css)
const POWER = 0xa6e070, GREEN = 0x6fe0c8, RUST = 0xff6a3a, AMBER = 0xf2a54a, SAND = 0xe3dc92, SAND_DIM = 0xa9a373, APRICOT = 0xf68b56, BRASS = 0xb38b4d;
// hull tones every building and tower shares
const HULL = 0xa89c88, HULL_HI = 0xded3bb, HULL_LO = 0x6c6154, SOOT = 0x14110e;

/**
 * An icon: its accent `c` (with `l` / `s`, its light and shaded facet, mixed from it unless given), a second accent `b`,
 * an optional turn of the whole drawing, and its shapes in drawing order. A shape is "paint|path": the paint is a role letter
 *   a accent, l its light, s its shade, b second accent, h hull, H hull light, d hull dark, D soot (cut-outs), k ink (sand), K ink dim
 * followed by "+" (a soot keyline round the fill, to part it from what lies behind), "~w" (a line of width w instead of a
 * fill), ":dash gap" (dashed) and "*o" (opacity).
 */
interface Def { c: number; l?: number; s?: number; b?: number; rot?: number; p: string[] }

const n2 = (v: number) => +v.toFixed(2);
/** Closed polygon through the points x0, y0, x1, y1, ... */
const P = (...v: number[]) => { let d = ''; for (let i = 0; i < v.length; i += 2) d += (i ? 'L' : 'M') + n2(v[i]) + ' ' + n2(v[i + 1]); return d + 'Z'; };
/** Circle. */
const C = (x: number, y: number, r: number) => `M${n2(x - r)} ${n2(y)}a${r} ${r} 0 1 0 ${n2(2 * r)} 0a${r} ${r} 0 1 0 ${n2(-2 * r)} 0Z`;
/** Rectangle with chamfered corners (c = 0: square). */
const R = (x: number, y: number, w: number, h: number, c = 0) =>
  c ? P(x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c) : P(x, y, x + w, y, x + w, y + h, x, y + h);
/** One teardrop: tip at (x, y), w wide, h tall. */
const DROP = (x: number, y: number, w: number, h: number) => {
  const r = w / 2, cy = y + h - r;
  return `M${n2(x)} ${n2(y)}C${n2(x)} ${n2(y)} ${n2(x - r)} ${n2(cy - r * 1.25)} ${n2(x - r)} ${n2(cy)}a${n2(r)} ${n2(r)} 0 0 0 ${n2(w)} 0C${n2(x + r)} ${n2(cy - r * 1.25)} ${n2(x)} ${n2(y)} ${n2(x)} ${n2(y)}Z`;
};
/** The chevron of the targeting glyphs, pointing right, its back at x. */
const CHEV = (x: number, y0 = 5, y1 = 19, t = 2.8, w = 4.6) => P(x, y0, x + t, y0, x + t + w, (y0 + y1) / 2, x + t, y1, x, y1, x + w, (y0 + y1) / 2);
/** The plinth every tower glyph stands on. */
const PLINTH = ['d|' + P(4.5, 22, 6.5, 18.6, 17.5, 18.6, 19.5, 22), 'a|' + R(7.4, 19.6, 9.2, 0.9)];
/** The ground line every building stands on. */
const GROUND = 'd|' + R(2, 20.6, 20, 1.6);
/** A deposit: the deck tile it lies under. */
const TILE = ['#241e1a|' + P(6.5, 2.5, 17.5, 2.5, 23, 12, 17.5, 21.5, 6.5, 21.5, 1, 12), 'd~1.2|' + P(6.5, 2.5, 17.5, 2.5, 23, 12, 17.5, 21.5, 6.5, 21.5, 1, 12)];

const coalBody = mix(ORES.coal.color, 0xefe9d6, 0.16);
const crudeBody = mix(FLUIDS.crude.color, ORES.oil.color, 0.35), crudeRim = mix(ORES.oil.color, 0xffffff, 0.38);

const ICONS: Record<IconName, Def> = {
  // ---- materials: solid lumps, each with its own outline
  // iron ore: two angular boulders leaning on each other (the belt's 'ore' shape)
  iron_ore: { c: ITEMS.iron_ore.color, p: [
    'a|' + P(2.5, 16.5, 5.5, 8, 11.5, 4.5, 16.5, 8.5, 16, 18, 7, 20.5),
    'l|' + P(5.5, 8, 11.5, 4.5, 16.5, 8.5, 10.5, 11.5),
    's|' + P(10.5, 11.5, 16.5, 8.5, 16, 18, 7, 20.5),
    'a+|' + P(13.5, 21.5, 15, 15.5, 19, 13.5, 22, 16.5, 21, 21.5),
    'l|' + P(15, 15.5, 19, 13.5, 22, 16.5, 18.2, 17.4),
    's|' + P(18.2, 17.4, 22, 16.5, 21, 21.5, 16.5, 21.5),
  ] },
  // copper ore: a rounded lump studded with nodules
  copper_ore: { c: ITEMS.copper_ore.color, l: mix(ITEMS.copper.color, 0xffffff, 0.3), p: [
    'a|M4 14.5Q4 9 9.5 7.5Q15.5 6 19 10.5Q21.5 14 19.5 17.5Q16 21.5 9.5 20.5Q4 19.5 4 14.5Z',
    's|M4 14.5Q4 19.5 9.5 20.5Q16 21.5 19.5 17.5Q20.8 15.3 20.3 13Q18 17.5 12 17.8Q7 18 4 14.5Z',
    'a+|' + C(6.2, 8.6, 2.9), 'l|' + C(5.6, 8, 1.5),
    'a+|' + C(18.3, 7.6, 2.5), 'l|' + C(17.8, 7.1, 1.25),
    'l|' + C(12, 12.2, 2.2), 'l|' + C(16.2, 15.2, 1.4), 'l|' + C(8, 15.6, 1.3),
  ] },
  // coal: three sharp glossy shards
  coal: { c: coalBody, l: 0xefe9d6, s: ITEMS.coal.color, p: [
    'a|' + P(3, 20.5, 5.5, 10, 10.5, 3, 14.5, 9.5, 14, 20.5),
    's|' + P(9.3, 11, 14.5, 9.5, 14, 20.5, 7.5, 20.5),
    'l|' + P(5.5, 10, 10.5, 3, 9.3, 11, 7, 12.6),
    'a+|' + P(12, 21.5, 14.2, 13.5, 18.5, 9.5, 21.8, 15, 20.5, 21.5),
    's|' + P(17.5, 14.6, 21.8, 15, 20.5, 21.5, 16, 21.5),
    'l|' + P(14.2, 13.5, 18.5, 9.5, 17.5, 14.6, 15.6, 15.6),
  ] },
  // iron plate: two wide ingots stacked flat
  iron: { c: ITEMS.iron.color, l: 0xffffff, p: [
    'a|' + P(2, 21, 4.5, 15.5, 19.5, 15.5, 22, 21), 'l|' + P(4.5, 15.5, 6.5, 13.5, 17.5, 13.5, 19.5, 15.5), 's|' + P(16.5, 15.5, 19.5, 15.5, 22, 21, 18.5, 21),
    'a+|' + P(5, 13.5, 7, 8, 17, 8, 19, 13.5), 'l|' + P(7, 8, 8.8, 6, 15.2, 6, 17, 8), 's|' + P(14.4, 8, 17, 8, 19, 13.5, 16, 13.5),
  ] },
  // copper plate: three ingots piled end on
  copper: { c: ITEMS.copper.color, p: [
    'a|' + P(1.5, 21.5, 3.5, 15, 9.5, 15, 11.5, 21.5), 'l|' + P(3.5, 15, 4.6, 13.4, 10.6, 13.4, 9.5, 15), 's|' + P(9.5, 15, 10.6, 13.4, 12.6, 19.9, 11.5, 21.5),
    'a+|' + P(11.5, 21.5, 13.5, 15, 19.5, 15, 21.5, 21.5), 'l|' + P(13.5, 15, 14.6, 13.4, 20.6, 13.4, 19.5, 15), 's|' + P(19.5, 15, 20.6, 13.4, 22.6, 19.9, 21.5, 21.5),
    'a+|' + P(6.5, 13.5, 8.5, 7, 14.5, 7, 16.5, 13.5), 'l|' + P(8.5, 7, 9.6, 5.4, 15.6, 5.4, 14.5, 7), 's|' + P(14.5, 7, 15.6, 5.4, 17.6, 11.9, 16.5, 13.5),
  ] },
  // building material: a braced girder cube (the belt's 'frame')
  mats: { c: FACS.works.color, p: [
    's~1.5|M4.5 9l4.5-5h10.5v10.5l-4.5 5M15 9l4.5-5',
    'a~2.3|M4.5 9h10.5v10.5h-10.5z',
    'a~1.7|M5.5 18.5L14 10',
    'l|' + R(2.9, 7.4, 3.2, 3.2), 'l|' + R(13.4, 7.4, 3.2, 3.2), 'l|' + R(2.9, 17.9, 3.2, 3.2), 'l|' + R(13.4, 17.9, 3.2, 3.2),
  ] },
  // plasma shell: brass casing with a rim, glowing ogive head
  shell: { c: ITEMS.shell.color, b: BRASS, rot: 38, p: [
    'a|M7.8 10.5Q7.8 3.8 12 1.2Q16.2 3.8 16.2 10.5Z', 'l|M9.2 9.3Q9.4 5 12 3.2Q10.8 6 10.9 9.3Z',
    'b|' + R(7.8, 11.6, 8.4, 8.2), '#e2c27c|' + R(8.8, 11.6, 1.7, 8.2), '#7a5c2e|' + R(13.9, 11.6, 2.3, 8.2),
    'b|' + R(6.6, 20.4, 10.8, 2.4, 0.6), '#7a5c2e|' + R(13.4, 20.4, 4, 2.4, 0.6),
  ] },
  // energy cell: an upright battery, steel caps, glowing core, terminal
  cell: { c: ITEMS.cell.color, p: [
    'h|' + R(9.8, 1.5, 4.4, 3),
    'a|' + R(6.6, 7.5, 10.8, 10), 'l|' + R(8.6, 8.6, 2.4, 7.8), 's|' + R(14.6, 7.5, 2.8, 10),
    'H|' + R(5.2, 4, 13.6, 4.2, 1), 'd|' + R(13.8, 4, 5, 4.2, 1),
    'H|' + R(5.2, 16.6, 13.6, 5, 1), 'd|' + R(13.8, 16.6, 5, 5, 1),
    'D|' + R(11.4, 9.4, 1.2, 6.2),
  ] },
  // missile pack: two finned missiles
  missile: { c: ITEMS.missile.color, rot: -38, p: [
    'a|M15 5.4Q19.5 5.4 22 7.6Q19.5 9.8 15 9.8Z', 'H|' + R(5.5, 5.4, 9.5, 4.4), 'h|' + R(5.5, 7.8, 9.5, 2),
    's|' + P(3, 2.6, 6.4, 2.6, 8.6, 5.4, 4.6, 5.4), 's|' + P(3, 12.6, 6.4, 12.6, 8.6, 9.8, 4.6, 9.8), 'd|' + R(3.6, 6.2, 1.9, 2.8),
    'a|M13 14.6Q17.5 14.6 20 16.8Q17.5 19 13 19Z', 'H|' + R(3.5, 14.6, 9.5, 4.4), 'h|' + R(3.5, 17, 9.5, 2),
    's|' + P(1, 11.8, 4.4, 11.8, 6.6, 14.6, 2.6, 14.6), 's|' + P(1, 21.8, 4.4, 21.8, 6.6, 19, 2.6, 19), 'd|' + R(1.6, 15.4, 1.9, 2.8),
  ] },
  // ---- fluids
  // crude oil: one heavy drop over its puddle
  crude: { c: crudeBody, l: crudeRim, s: FLUIDS.crude.color, p: [
    'l|M2.5 20.6a9.5 1.9 0 1 0 19 0a9.5 1.9 0 1 0 -19 0Z',
    'a+|' + DROP(12, 1.2, 13.6, 17.6), 'l~1.3|' + DROP(12, 1.2, 13.6, 17.6),
    'l|M8 12.5Q7.6 9.5 10 6.6Q9.6 9.8 10.4 12.8Q9 13.6 8 12.5Z',
  ] },
  // petrol: two slim bright drops
  petrol: { c: FLUIDS.petrol.color, l: 0xffe6a0, p: [
    'a|' + DROP(9.5, 1.5, 10.5, 20.5), 's|M9.5 22a5.25 5.25 0 0 0 5.25 -5.25Q14.6 14.5 13.4 11.8Q13.6 19 7 21.3Q8.2 22 9.5 22Z',
    'l|M6.7 16.6Q6.3 13 8.6 9.4Q8.2 13 9 16.6Q7.6 17.6 6.7 16.6Z',
    'a|' + DROP(18.7, 9.5, 5.6, 9.6), 'l|' + C(17.9, 16, 0.9),
  ] },
  // ---- the console's counters
  power: { c: POWER, p: [
    'l|' + P(14.6, 1.5, 4.5, 14, 10.8, 14, 12.6, 10),
    'a|' + P(14.6, 1.5, 12.6, 10, 19.5, 10, 9.2, 22.5, 10.8, 14, 12.6, 10),
    's|' + P(12.6, 10, 19.5, 10, 9.2, 22.5, 12.2, 12.6),
  ] },
  // credits: a hex chit stamped with the spire
  credits: { c: SAND, p: [
    's|' + P(7, 5.2, 17, 5.2, 22, 13, 17, 21.8, 7, 21.8, 2, 13),
    'a|' + P(7, 2.4, 17, 2.4, 22, 11, 17, 19.6, 7, 19.6, 2, 11),
    'l|' + P(7, 2.4, 17, 2.4, 18.2, 4.4, 8.2, 4.4, 4.4, 11, 2, 11),
    's|' + P(12, 5.4, 15.6, 15.4, 12, 13.6, 8.4, 15.4),
  ] },
  // time: a stopwatch with a quarter run
  time: { c: APRICOT, p: [
    'k|' + R(10.3, 1.2, 3.4, 3), 'k~1.7|M17.6 6.4l1.8-1.8',
    'k~2|' + C(12, 13.4, 7.6),
    'a|M12 13.4V7.6A5.8 5.8 0 0 1 17.8 13.4Z',
    'k~1.6|M12 13.4V8.4',
  ] },
  // ---- deposits: the ore under a deck tile
  dep_iron_ore: { c: ORES.iron_ore.color, l: mix(ITEMS.iron_ore.color, 0xffffff, 0.35), p: [...TILE,
    'a|' + P(5.5, 15.5, 7.5, 9.5, 12, 7.5, 14.5, 11, 13.5, 16.5), 'l|' + P(7.5, 9.5, 12, 7.5, 14.5, 11, 10.5, 12),
    'a|' + P(14, 17.5, 15.5, 13.5, 18.5, 12.5, 20, 15.5, 18.5, 17.5), 'l|' + P(15.5, 13.5, 18.5, 12.5, 20, 15.5, 17.5, 15.2),
  ] },
  dep_copper_ore: { c: ORES.copper_ore.color, l: ITEMS.copper.color, p: [...TILE,
    'a|M5 13.5Q5 9 10 8.5Q15 8.5 16 12.5Q16.5 16.5 11 17Q5.5 17.5 5 13.5Z', 'l|' + C(8.5, 11.5, 1.6), 'l|' + C(12.8, 13.6, 1.3),
    'a|' + C(17.8, 15.8, 2.4), 'l|' + C(17.4, 15.3, 1.1), 'a|' + C(15.8, 7.6, 1.8),
  ] },
  dep_coal: { c: coalBody, l: 0xefe9d6, p: [...TILE,
    'a|' + P(5.5, 17.5, 7, 11.5, 10, 6.5, 12.5, 11.5, 12, 17.5), 'l|' + P(7, 11.5, 10, 6.5, 9.4, 12),
    'a|' + P(12.5, 17.5, 14, 13, 17, 10.5, 19.5, 14, 18.5, 17.5), 'l|' + P(14, 13, 17, 10.5, 16.4, 14),
  ] },
  dep_oil: { c: crudeBody, l: crudeRim, p: [...TILE,
    'a|M4.5 13a7.5 4.4 0 1 0 15 0a7.5 4.4 0 1 0 -15 0Z', 'l~1.2|M4.5 13a7.5 4.4 0 1 0 15 0a7.5 4.4 0 1 0 -15 0Z',
    'l|' + DROP(12, 5.4, 4.6, 7.4), 'l|M7.5 14.2q3 1.6 6.4 0.6q-3 2.6 -6.4 -0.6Z',
  ] },
  // ---- buildings: hull tones on a ground line, one accent
  // transfer arm: a jointed arm on a turntable, reaching over with an item in its gripper (the item is the accent)
  fac_arm: { c: FACS.arm.color, p: [
    GROUND,
    'h|' + P(5, 20.6, 6.2, 17.2, 13.8, 17.2, 15, 20.6), 'd|' + P(11.4, 17.2, 13.8, 17.2, 15, 20.6, 12.2, 20.6),
    'h~3.4|M10 15.6L6.6 7.2', 'd~1.2|M11.2 15.2L7.8 6.8',
    'H~2.6|M6.6 7.2L17.2 4.6',
    'd+|' + C(10, 15.8, 2.3), 'H|' + C(10, 15.8, 0.9),
    'H+|' + C(6.6, 7.2, 2.3), 'd|' + C(6.6, 7.2, 0.9),
    'h~1.5|M15.2 4.2V8.2M20.4 3.4V7.4', 'd+|' + C(17.6, 4.5, 1.6),
    'a+|' + R(14.6, 8, 6.6, 5.4, 1), 'l|' + R(14.6, 8, 6.6, 1.7, 0.8), 's|' + R(18.6, 9.7, 2.6, 3.7, 0.6),
  ] },
  // belt: a band over three rollers on two legs, carrying a crate
  fac_belt: { c: AMBER, p: [
    'd~1.7|M6.5 16.5V21M17.5 16.5V21',
    'h|M5.5 9.4H18.5A3.9 3.9 0 0 1 18.5 17.2H5.5A3.9 3.9 0 0 1 5.5 9.4Z', 'D|M5.6 11.2H18.4A2.1 2.1 0 0 1 18.4 15.4H5.6A2.1 2.1 0 0 1 5.6 11.2Z',
    'H|' + C(5.7, 13.3, 1.5), 'H|' + C(12, 13.3, 1.5), 'H|' + C(18.3, 13.3, 1.5),
    'a|' + R(8.8, 3.8, 5.6, 5, 1), 'l|' + R(8.8, 3.8, 5.6, 1.6, 1),
    'a|' + P(16.6, 4.4, 18.4, 4.4, 20.6, 6.3, 18.4, 8.2, 16.6, 8.2, 18.8, 6.3),
  ] },
  // splitter: one line in, dealt out to two
  fac_splitter: { c: AMBER, p: [
    'H~2.2|M1.5 12H9', 'H~2.2|M9 12L14 5.5H19', 'H~2.2|M9 12L14 18.5H19',
    'H|' + P(18.4, 2.4, 22.8, 5.5, 18.4, 8.6), 'H|' + P(18.4, 15.4, 22.8, 18.5, 18.4, 21.6),
    'a+|' + P(6.4, 9, 11.6, 9, 14.2, 12, 11.6, 15, 6.4, 15, 3.8, 12), 'D|' + C(9, 12, 1.3),
  ] },
  // belt tunnel: two hooded portals, the belt running dashed under what stands between
  fac_tunnel: { c: AMBER, p: [
    'd|' + R(1, 11.6, 22, 1.6),
    'H|' + P(1.5, 11.6, 3, 4.6, 8.6, 4.6, 10.1, 11.6), 'D|' + P(3.8, 11.6, 4.6, 7.2, 7, 7.2, 7.8, 11.6),
    'H|' + P(13.9, 11.6, 15.4, 4.6, 21, 4.6, 22.5, 11.6), 'D|' + P(16.2, 11.6, 17, 7.2, 19.4, 7.2, 20.2, 11.6),
    'a~1.9:2.2 1.5|M5.8 13.4V18.6H18.2V13.4',
    'a|' + P(3.6, 14.2, 5.8, 17, 8, 14.2, 8, 16, 5.8, 18.8, 3.6, 16) + P(16, 16.6, 18.2, 13.8, 20.4, 16.6, 20.4, 18.4, 18.2, 15.6, 16, 18.4),
  ] },
  // mine: a headframe over its drill
  fac_mine: { c: SAND, p: [
    GROUND,
    'd~1.3|M7.4 16.2L15.6 10.2M16.6 16.2L8.4 10.2',
    'h~2|M5.5 20.6L9.4 5.2M18.5 20.6L14.6 5.2',
    'H|' + R(7.2, 2.6, 9.6, 3, 0.8),
    'a~1.5|M12 5.6V12.6', 'a|' + P(9.6, 12.4, 14.4, 12.4, 12, 19.4), 's|' + P(12, 12.4, 14.4, 12.4, 12, 19.4),
  ] },
  // generator: a squat drum with a glowing ring and its wire terminal
  fac_generator: { c: FACS.generator.color, p: [
    GROUND,
    'd|' + R(10.6, 3.8, 2.8, 5), 'a|' + C(12, 3.2, 1.9),
    'h|' + R(3.5, 8.6, 17, 12, 2), 'd|' + R(15, 8.6, 5.5, 12, 2),
    'H|' + R(3.5, 8.6, 17, 2.2, 1),
    'a|' + R(3.5, 12, 17, 2),
    'D|' + P(12.9, 14.6, 9.4, 18.2, 11.6, 18.2, 10.9, 20.4, 14.5, 16.8, 12.3, 16.8),
  ] },
  // power pole: a mast, a cross arm with two insulators, the wires leaving
  fac_pole: { c: FACS.pole.color, p: [
    'd|' + R(8.6, 20.4, 6.8, 1.8),
    'a~1.1|M5.3 5.4Q3.6 9 0.6 9.4M18.7 5.4Q20.4 9 23.4 9.4',
    'h|' + R(11, 5, 2, 15.6), 'H|' + R(3.6, 6.6, 16.8, 2.2), 'd|' + R(12, 6.6, 8.4, 2.2),
    'a|' + R(4.1, 2.8, 2.5, 3.8), 'a|' + R(17.4, 2.8, 2.5, 3.8), 'l|' + C(12, 3.4, 1.7),
  ] },
  // pumpjack: the nodding beam with its horse head and counterweight
  fac_pump: { c: mix(FACS.pump.color, 0xffffff, 0.18), p: [
    GROUND,
    'a~1.5|M4.6 11.6V19', 'd|' + R(2.8, 18.4, 3.6, 2.4),
    'h~2|M9.2 20.6L12.4 8.6L15.6 20.6',
    'H|' + P(3.2, 5.8, 20.2, 9.6, 19.8, 11.8, 2.8, 8),
    'H|' + P(2.2, 3.6, 6.4, 4.2, 6.6, 11.8, 2.8, 12.2, 1.8, 8),
    'a+|' + R(17.2, 9.8, 5, 6.2, 1), 'd|' + C(12.4, 8.9, 1.5),
  ] },
  // pipe: a tube with two flanges
  fac_pipe: { c: FACS.pipe.color, p: [
    'a|' + R(0.8, 8.4, 22.4, 7.2), 'l|' + R(0.8, 9.4, 22.4, 1.7), 's|' + R(0.8, 13, 22.4, 2.6),
    'H+|' + R(5.2, 5.6, 3.4, 12.8, 0.8), 'H+|' + R(15.4, 5.6, 3.4, 12.8, 0.8),
    'd|' + R(5.2, 13.4, 3.4, 5, 0.8), 'd|' + R(15.4, 13.4, 3.4, 5, 0.8),
  ] },
  // pipe tunnel: two domed caps, the tube bending round under what stands between
  fac_ptunnel: { c: mix(FACS.pipe.color, 0xffffff, 0.2), p: [
    'd|' + R(1, 11.6, 22, 1.6),
    'H|M1.8 11.6A4 4.6 0 0 1 9.8 11.6Z', 'D|' + C(5.8, 9.2, 1.4),
    'H|M14.2 11.6A4 4.6 0 0 1 22.2 11.6Z', 'D|' + C(18.2, 9.2, 1.4),
    'a~3.4|M5.8 13.2V16Q5.8 19 8.8 19H15.2Q18.2 19 18.2 16V13.2',
    'l~1|M5 13.2V16Q5 19.8 8.8 19.8',
  ] },
  // smelter: a furnace with a glowing mouth and a tall stack
  fac_smelter: { c: FACS.smelter.color, l: 0xffb45a, p: [
    GROUND,
    'd|' + R(16.4, 4.4, 3.8, 16.2), 'h|' + R(15.6, 2.4, 5.4, 2.6, 0.6),
    'a|' + P(2.5, 20.6, 2.5, 11, 5, 8.2, 13, 8.2, 15.5, 11, 15.5, 20.6), 's|' + P(11.5, 8.2, 13, 8.2, 15.5, 11, 15.5, 20.6, 12.5, 20.6),
    'D|M5.2 20.6V16.2A3.8 3.8 0 0 1 12.8 16.2V20.6Z', 'l|M6.6 20.6V16.6A2.4 2.4 0 0 1 11.4 16.6V20.6Z',
    'H|' + R(4, 10.4, 10, 1.3),
  ] },
  // frame works: a saw-tooth workshop with a girder frame in its window
  fac_works: { c: FACS.works.color, p: [
    GROUND,
    'h|M2.5 20.6V10.4L8.6 5V10.4L14.7 5V10.4L20.8 5V20.6Z', 'd|' + P(17.4, 8, 20.8, 5, 20.8, 20.6, 17.4, 20.6),
    'D|' + R(5.4, 12.2, 9.8, 6.6), 'a~1.5|M6.8 13.4h7v4.2h-7zM6.8 17.6l7-4.2',
  ] },
  // shell press: a gate frame, the ram coming down on the bed
  fac_press: { c: FACS.press.color, p: [
    GROUND,
    'h|' + R(3.4, 5.4, 3.2, 15.2), 'd|' + R(17.4, 5.4, 3.2, 15.2),
    'H|' + R(2.4, 2.4, 19.2, 3.6, 1),
    'd|' + R(10.4, 6, 3.2, 5), 'a|' + R(7.6, 10.6, 8.8, 2.8, 0.8), 'l|' + R(7.6, 10.6, 8.8, 1, 0.5),
    'l|' + R(9.4, 16, 5.2, 2.2), 'h|' + R(6.6, 18.2, 10.8, 2.4),
  ] },
  // cell plant: a domed vat with a glowing sight glass and a pipe stub
  fac_cells: { c: FACS.cells.color, p: [
    GROUND,
    'd|' + R(1.2, 14, 5, 2.8), 'd|' + R(10.8, 1.4, 2.4, 3),
    'h|M5.4 20.6V9.6A6.6 6 0 0 1 18.6 9.6V20.6Z', 'd|M15 4.3A6.6 6 0 0 1 18.6 9.6V20.6H15Z',
    'D|' + R(8, 9.2, 5.4, 9, 1), 'a|' + R(8.9, 10.2, 3.6, 7, 0.6), 'l|' + R(8.9, 10.2, 1.4, 7, 0.4),
    'H|' + R(5.4, 18.4, 13.2, 1.2),
  ] },
  // refinery: two columns and a flare stack burning
  fac_refinery: { c: FACS.refinery.color, l: 0xffe6a0, p: [
    GROUND,
    'd~1.5|M20.4 20.6V7.4', 'a|M20.4 0.8Q23.4 4.2 20.4 7.6Q17.4 4.2 20.4 0.8Z', 'l|M20.4 3.6Q21.6 5.2 20.4 6.8Q19.2 5.2 20.4 3.6Z',
    'd~1.5|M9 12.6H13',
    'h|M3 20.6V6.2A3.1 3.1 0 0 1 9.2 6.2V20.6Z', 'd|M6.8 3.4A3.1 3.1 0 0 1 9.2 6.2V20.6H6.8Z', 'a|' + R(3, 7.8, 6.2, 1.8),
    'H|M11.4 20.6V12.4A2.9 2.9 0 0 1 17.2 12.4V20.6Z', 'd|M15 9.8A2.9 2.9 0 0 1 17.2 12.4V20.6H15Z',
  ] },
  // missile works: a missile on the pad beside its gantry
  fac_missiles: { c: FACS.missiles.color, p: [
    GROUND,
    'd~1.3|M16.4 20.6V5.2H20.4V20.6M16.4 9.2L20.4 13M20.4 13L16.4 16.8M16.4 9.2H20.4M16.4 13H20.4M16.4 16.8H20.4', 'h~1.5|M16.4 7.4H11.4',
    'H|' + R(6.4, 8, 5, 10.4), 'h|' + R(9.2, 8, 2.2, 10.4),
    'a|M6.4 8Q6.4 3.2 8.9 1.2Q11.4 3.2 11.4 8Z',
    'a|' + P(6.4, 14.4, 3.2, 20.6, 6.4, 18.8), 's|' + P(11.4, 14.4, 14.6, 20.6, 11.4, 18.8), 'a|' + R(6.4, 10, 5, 1.4),
  ] },
  // supply crate: a banded box with a lid and a handle
  fac_crate: { c: FACS.crate.color, b: 0x8b8a5c, p: [
    'h~1.5|M9.4 5V3h5.2V5',
    'b|' + R(3.4, 8.4, 17.2, 13, 1), '#5c5b3a|' + R(15.6, 8.4, 5, 13, 1),
    'a|' + R(3.4, 12.6, 17.2, 2.6), 's|' + R(15.6, 12.6, 5, 2.6),
    'H|' + R(2.2, 5.2, 19.6, 3.6, 0.8), 'h|' + R(15.6, 5.2, 6.2, 3.6, 0.8),
  ] },
  // ---- towers: a head in the tower's colour on the shared plinth
  // pulse turret: a round-backed gun head with one barrel
  tw_pulse: { c: TOWERS.pulse.color, p: [...PLINTH,
    'h|' + R(10.4, 13, 3.2, 5.8),
    'H|' + R(14, 8, 7.4, 2.6), 'H|' + R(20, 7, 2.4, 4.6),
    'a|M3.6 14V9.4A5 5 0 0 1 8.6 4.4H14.8V14Z', 's|' + R(11.6, 4.4, 3.2, 9.6), 'l|M5 12.4V9.6A3.8 3.8 0 0 1 8.4 5.8V12.4Z',
  ] },
  // cryo emitter: an ice crystal
  tw_cryo: { c: TOWERS.cryo.color, p: [...PLINTH,
    'h|' + R(11, 14, 2, 4.8),
    'a~1.8|M12 1.4V16M5.7 5.05L18.3 12.35M18.3 5.05L5.7 12.35',
    'a~1.4|M9.8 2.6L12 4.6L14.2 2.6M9.8 14.8L12 12.8L14.2 14.8',
    'l|' + P(12, 6.2, 14.2, 7.45, 14.2, 9.95, 12, 11.2, 9.8, 9.95, 9.8, 7.45),
  ] },
  // arc pylon: a coil narrowing to a ball, a spark leaving it
  tw_arc: { c: TOWERS.arc.color, p: [...PLINTH,
    'h|' + R(11, 6, 2, 12.8),
    'a|' + R(7, 15, 10, 2.2, 0.8), 'a|' + R(8.2, 11.6, 7.6, 2.2, 0.8), 'a|' + R(9.4, 8.2, 5.2, 2.2, 0.8),
    'l|' + C(12, 4.2, 3), 'l~1.3|M15.6 3.4L18.6 5.2L17 7L20.6 9.4',
  ] },
  // plasma mortar: a short fat tube pointing up
  tw_mortar: { c: TOWERS.mortar.color, p: [...PLINTH,
    'h|' + P(8.6, 18.6, 10.4, 13, 15, 13, 16.2, 18.6),
    'a|' + P(4.4, 12.6, 11.4, 2, 18.2, 6.4, 11.2, 17), 's|' + P(14.8, 4.2, 18.2, 6.4, 11.2, 17, 7.8, 14.8),
    'l|' + P(10.4, 0.8, 19.6, 6.8, 18.4, 8.6, 9.2, 2.6),
  ] },
  // railgun: two long rails out of a breech
  tw_rail: { c: TOWERS.rail.color, p: [...PLINTH,
    'h|' + P(9.6, 18.6, 11, 12, 14, 12, 15.4, 18.6),
    'a|' + R(6, 4.6, 17, 2), 'a|' + R(6, 9.6, 17, 2), 's|' + R(13, 4, 1.8, 8.2), 's|' + R(18.4, 4, 1.8, 8.2),
    'H|' + R(1, 3.4, 6.6, 9.4, 1.2), 'd|' + R(4.4, 3.4, 3.2, 9.4, 1.2),
  ] },
  // signal beacon: a mast sending rings out
  tw_beacon: { c: TOWERS.beacon.color, p: [...PLINTH,
    'h|' + R(11.1, 9, 1.8, 9.8),
    'a~1.6|M7.9 3.2A5.6 5.6 0 0 0 7.9 11.2M16.1 3.2A5.6 5.6 0 0 1 16.1 11.2',
    's~1.6|M4.6 0.8A9.4 9.4 0 0 0 4.6 13.6M19.4 0.8A9.4 9.4 0 0 1 19.4 13.6',
    'l|' + C(12, 7.2, 2.5),
  ] },
  // firewall pylon: a flame over its burner
  tw_flame: { c: TOWERS.flame.color, l: 0xffe6a0, p: [...PLINTH,
    'h|' + R(8.6, 14.4, 6.8, 4.4, 1), 'D|' + R(10.2, 15.8, 3.6, 1.1),
    'a|M12 0.8C14.6 4.2 17.4 6.2 17.4 9.4A5.4 5.4 0 0 1 6.6 9.4C6.6 7.6 8 6.6 8.8 4.6C9.8 5.8 10.6 6.2 12 0.8Z',
    'l|M12 6.8C13.4 8.4 14.4 9.2 14.4 10.8A2.4 2.4 0 0 1 9.6 10.8C9.6 9.6 11.2 9.2 12 6.8Z',
  ] },
  // lance emitter: a needle with two focus rings
  tw_lance: { c: TOWERS.lance.color, p: [...PLINTH,
    'h|' + P(8, 18.6, 9.4, 14.4, 13, 14.4, 14.4, 18.6),
    'a|' + P(5.6, 13.6, 22, 1.4, 9.2, 17.2), 's|' + P(7.4, 15.4, 22, 1.4, 9.2, 17.2),
    'H~1.8|M9.4 8.6L14 14.6', 'H~1.8|M13.8 5.4L17.2 9.8',
  ] },
  // missile battery: two launch boxes on a yoke
  tw_missile: { c: TOWERS.missile.color, p: [...PLINTH,
    'h|' + R(11, 9, 2, 9.8), 'h|' + R(8, 8, 8, 2.4),
    'a|' + R(2, 2.6, 8, 10.4, 1.2), 's|' + R(7.4, 2.6, 2.6, 10.4, 1.2), 'D|' + C(4.4, 5.4, 1.15) + C(4.4, 8.6, 1.15) + C(7.2, 5.4, 1.15) + C(7.2, 8.6, 1.15),
    'a|' + R(14, 2.6, 8, 10.4, 1.2), 's|' + R(19.4, 2.6, 2.6, 10.4, 1.2), 'D|' + C(16.4, 5.4, 1.15) + C(16.4, 8.6, 1.15) + C(19.2, 5.4, 1.15) + C(19.2, 8.6, 1.15),
  ] },
  // graviton well: a mass with two orbits round it
  tw_gravity: { c: TOWERS.gravity.color, p: [...PLINTH,
    'h|' + R(11, 14.6, 2, 4.2),
    's~1.5|M3.4 12.2a9.4 3.4 -28 1 0 17.2 -7.4a9.4 3.4 -28 1 0 -17.2 7.4Z',
    'a~1.5|M3.4 4.8a9.4 3.4 28 1 0 17.2 7.4a9.4 3.4 28 1 0 -17.2 -7.4Z',
    'l|' + C(12, 8.5, 3.1),
  ] },
  // ---- targeting modes: sand ink, one apricot mark; the bar on the right is the core the enemies walk to
  // (the queue is drawn hollow and the one aimed at solid, so First and Last differ by their outline, not only by colour)
  aim_first: { c: APRICOT, p: ['K~1.3|' + CHEV(1.2, 6.5, 17.5, 2.2, 3.8), 'K~1.3|' + CHEV(6.6, 6.5, 17.5, 2.2, 3.8), 'a|' + CHEV(11.8, 3.4, 20.6, 3.4, 5.4), 'k|' + R(21.6, 3, 1.9, 18)] },
  aim_last: { c: APRICOT, p: ['a|' + CHEV(0.6, 3.4, 20.6, 3.4, 5.4), 'K~1.3|' + CHEV(9.6, 6.5, 17.5, 2.2, 3.8), 'K~1.3|' + CHEV(15, 6.5, 17.5, 2.2, 3.8), 'k|' + R(21.6, 3, 1.9, 18)] },
  // strongest: a whole shield over a full hull bar; weakest: a cracked one over a bar nearly gone
  aim_strong: { c: APRICOT, p: [
    'a|M12 1.2L19.6 4V8.6Q19.6 13.6 12 17.2Q4.4 13.6 4.4 8.6V4Z', 's|M12 1.2L19.6 4V8.6Q19.6 13.6 12 17.2Z',
    'k|' + R(3, 19.4, 18, 3),
  ] },
  aim_weak: { c: APRICOT, p: [
    'K~1.7|M10.4 2.4L4.9 4.4V8.6Q4.9 13.2 12 16.6Q19.1 13.2 19.1 8.6V4.4L15.2 3',
    'a~1.7|M12.6 1.4L10.2 6.4L13.6 8.6L11 13.6',
    'K~1.2|M3.6 20h16.8v1.8H3.6z', 'a|' + R(3, 19.4, 5, 3),
  ] },
  // fastest: a dart with its speed lines; slowest: a snail
  aim_fast: { c: APRICOT, p: [
    'k~1.8|M1.2 6.6H10.4M4.6 12H12M1.2 17.4H10.4',
    'a|' + P(11.4, 3.6, 23, 12, 11.4, 20.4, 14.8, 12),
  ] },
  aim_slow: { c: APRICOT, p: [
    'k|M1.2 20.8H19.4Q22.6 20.8 22.6 17.4V13.4H19.6V16.6Q19.6 17.8 18.4 17.8H1.2Z',
    'k~1.5|M20.2 13.4L18.6 9.6M22 13.4L23 9.6',
    'a|' + C(10.2, 10.8, 7.2), 'D~1.7|M10.2 10.8h2.4a2.4 2.4 0 1 1 -2.4 -2.4a4.6 4.6 0 0 1 4.6 4.6',
  ] },
  // ---- supply states, in the colours of the in-world cues
  // supplied: the calm closed ring
  st_ok: { c: GREEN, p: ['a~2.2|' + C(12, 12, 8.6), 'a~2.2|M7.8 12.2L10.8 15.2L16.4 8.8'] },
  // missing an input: the broken ring
  st_missing: { c: RUST, p: [
    'a~2.2|M5.9 5.9A8.6 8.6 0 0 1 16.3 4.55M19.45 7.7A8.6 8.6 0 0 1 18.1 18.1M14.4 20.25A8.6 8.6 0 0 1 4.3 15.8M3.45 11.2A8.6 8.6 0 0 1 4.1 8.6',
    'a|' + R(10.8, 6.4, 2.4, 6.6), 'a|' + R(10.8, 14.6, 2.4, 2.6),
  ] },
  // nobody takes what it makes: arrows running off to an empty place
  st_notaker: { c: AMBER, p: [
    'k|' + R(1.2, 7, 6.6, 10, 1),
    'a|' + CHEV(9, 7.4, 16.6, 2.2, 3.2), 'a|' + CHEV(13, 7.4, 16.6, 2.2, 3.2),
    'K~1.4:2.1 1.9|M18.4 7.4h4.4v9.2h-4.4z',
  ] },
  // not unlocked yet
  st_locked: { c: SAND_DIM, l: SAND, p: [
    'l~2.2|M7.6 10.6V7.6A4.4 4.4 0 0 1 16.4 7.6V10.6',
    'a|' + R(4.4, 10.4, 15.2, 11.2, 1.4), 's|' + R(14, 10.4, 5.6, 11.2, 1.4),
    'D|' + C(12, 14.8, 1.7) + R(11.2, 15.2, 1.6, 3.6),
  ] },
};

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const ORE_SHORT: Record<OreType, string> = { iron_ore: 'Iron deposit', copper_ore: 'Copper deposit', coal: 'Coal seam', oil: 'Oil field' };
const STATE_LABEL: Record<StateName, string> = { ok: 'Supplied', missing: 'Missing an input', notaker: 'Nothing takes its output', locked: 'Locked' };
/** The plain name of what an icon shows (for titles and labels). */
export function iconLabel(name: IconName): string {
  if (name in ITEMS) return ITEMS[name as ItemType].name;
  if (name in FLUIDS) return FLUIDS[name as FluidType].name;
  if (name === 'mats') return 'Building materials';
  if (name === 'power') return 'Power';
  if (name === 'credits') return 'Credits';
  if (name === 'time') return 'Seconds';
  const i = name.indexOf('_'), kind = name.slice(0, i), id = name.slice(i + 1);
  if (kind === 'dep') return ORES[id as OreType]?.name ?? ORE_SHORT[id as OreType];
  if (kind === 'fac') return FACS[id as FacType].name;
  if (kind === 'tw') return TOWERS[id as TowerType].name;
  if (kind === 'aim') return TARGET_INFO[id as TargetMode].name;
  return STATE_LABEL[id as StateName];
}

// ---------------------------------------------------------------- DOM: one icon

const NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number>;
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs, parent?: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
};
const htmlEl = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Element, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

export type IconTone = 'full' | 'mono' | 'dim';
export interface IconOpts {
  /** edge length in CSS pixels (default 18) */
  size?: number;
  /** with a title the icon is announced (role img, aria-label, a native tooltip); without one it is decorative */
  title?: string;
  /** full: its colours; mono: one colour (currentColor) with its shading kept as opacity; dim: its colours, muted (locked, not available) */
  tone?: IconTone;
}

// what each role is in one colour: the opacity of currentColor
const MONO: Record<string, number> = { a: 1, l: 1, s: 0.55, b: 0.8, h: 0.78, H: 1, d: 0.5, k: 1, K: 0.55 };
const SHAPE = /^(#[0-9a-f]{6}|[a-zA-Z])(\+)?(?:~([\d.]+))?(?::([\d. ]+))?(?:\*([\d.]+))?\|(.+)$/;

/** One icon as an inline SVG element. */
export function icon(name: IconName, opts: IconOpts = {}): SVGSVGElement {
  const def = ICONS[name], size = opts.size ?? 18, tone = opts.tone ?? 'full', mono = tone === 'mono';
  const svg = svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, class: `ic ic-${tone}`, 'data-ic': name, focusable: 'false' });
  if (opts.title) {
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', opts.title);
    svgEl('title', {}, svg).textContent = opts.title;
  } else svg.setAttribute('aria-hidden', 'true');
  const paint: Record<string, number> = {
    a: def.c, l: def.l ?? mix(def.c, 0xfff6e0, 0.45), s: def.s ?? mix(def.c, SOOT, 0.48), b: def.b ?? def.c,
    h: HULL, H: HULL_HI, d: HULL_LO, D: SOOT, k: SAND, K: SAND_DIM,
  };
  const root = def.rot ? svgEl('g', { transform: `rotate(${def.rot} 12 12)` }, svg) : svg;
  for (const sh of def.p) {
    const m = SHAPE.exec(sh);
    if (!m) throw new Error(`icon ${name}: bad shape ${sh.slice(0, 24)}`);
    const [, role, key, width, dash, alpha, d] = m;
    const line = width !== undefined, at: Attrs = { d };
    const cut = role === 'D';
    // (a cut-out takes the colour of what the icon lies on: the stylesheet's --ic-bg, so it also holds on a light chip)
    const col = role[0] === '#' ? role : hex(paint[role]);
    const set = (prop: 'fill' | 'stroke') => {
      if (cut) at.class = prop === 'fill' ? 'ic-cut' : 'ic-cut-line';
      else if (mono) { at[prop] = 'currentColor'; const o = (role[0] === '#' ? 0.85 : MONO[role] ?? 1) * (alpha ? +alpha : 1); if (o < 1) at[prop + '-opacity'] = n2(o); }
      else { at[prop] = col; if (alpha) at[prop + '-opacity'] = alpha; }
    };
    if (line) {
      set('stroke'); if (!cut) at.fill = 'none';
      at['stroke-width'] = width; at['stroke-linecap'] = 'butt'; at['stroke-linejoin'] = 'miter';
      if (dash) at['stroke-dasharray'] = dash;
    } else {
      set('fill'); at['fill-rule'] = 'evenodd';
      if (key) { svgEl('path', { d, class: 'ic-key', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, root); }
    }
    svgEl('path', at, root);
  }
  return svg;
}

export const itemIcon = (item: ItemType, opts?: IconOpts) => icon(item, opts);
export const fluidIcon = (fluid: FluidType, opts?: IconOpts) => icon(fluid, opts);
export const oreIcon = (ore: OreType, opts?: IconOpts) => icon(`dep_${ore}`, opts);
export const facIcon = (type: FacType, opts?: IconOpts) => icon(`fac_${type}`, opts);
export const towerIcon = (type: TowerType, opts?: IconOpts) => icon(`tw_${type}`, opts);
export const aimIcon = (mode: TargetMode, opts?: IconOpts) => icon(`aim_${mode}`, opts);
export const stateIcon = (state: StateName, opts?: IconOpts) => icon(`st_${state}`, opts);

// ---------------------------------------------------------------- DOM: the chip

export interface ChipOpts extends IconOpts {
  /** ok: supplied (verdigris rule), missing: lacking (rust rule, the count in rust), dim: not available, plain: no plate, icon and count only */
  state?: 'ok' | 'missing' | 'dim' | 'plain';
  /** the element to make: a span (default) or a button (for something to press or hover with the keyboard) */
  tag?: 'span' | 'button';
}
/**
 * A HUD chip: an icon and, beside it, a short count ("x2", "4/s", "120"). With a title the whole chip is labelled
 * (title + count) and the icon inside stays decorative.
 */
export function chip(name: IconName, text?: string | number, opts: ChipOpts = {}): HTMLElement {
  const el = htmlEl(opts.tag ?? 'span', 'ic-chip' + (opts.state ? ' is-' + opts.state : ''));
  if (opts.tag === 'button') (el as HTMLButtonElement).type = 'button';
  el.dataset.ic = name;
  el.appendChild(icon(name, { size: opts.size ?? 18, tone: opts.tone ?? (opts.state === 'dim' ? 'dim' : 'full') }));
  const t = text === undefined || text === '' ? '' : String(text);
  if (t) htmlEl('b', '', el, t);
  if (opts.title) { el.title = opts.title; el.setAttribute('aria-label', t ? `${opts.title} ${t}` : opts.title); if (opts.tag !== 'button') el.setAttribute('role', 'img'); }
  return el;
}

// ---------------------------------------------------------------- the production graph (pure: no DOM)

/** Something a building makes or takes: an item, a fluid, building materials, or power. */
export type Res = ItemType | FluidType | 'mats' | 'power';
/**
 * One step of production: `fac` turns `inp` (per batch) into `n` of `out` in `time` seconds at level 1. `rate`: it runs
 * continuously (n per second, time is 1). `on`: the deposit it has to stand on. `fuel`: what it burns besides, one for
 * every `per` batches. `power`: what it draws from the grid.
 */
export interface Step {
  fac: FacType; out: Res; n: number; time: number; rate?: boolean; on?: OreType;
  inp: { res: Res; n: number }[]; fuel?: { res: ItemType; per: number }; power: number;
}
/**
 * Every production step of the game, read from the data at the time of the call: the plants of MAKES as they are (a new
 * recipe there appears here without a change), and the buildings whose rules live in factory.ts (mine, pumpjack, smelter,
 * refinery, generator) from its constants.
 */
export function recipes(): Step[] {
  const out: Step[] = [], pw = (f: FacType) => FACS[f].power ?? 0;
  for (const o of ORE_TYPES) {
    if (o === 'oil') out.push({ fac: 'pump', out: 'crude', n: PUMP_RATE, time: 1, rate: true, on: o, inp: [], power: pw('pump') });
    else out.push({ fac: 'mine', out: o, n: 1, time: MINE_TIME, on: o, inp: [], power: pw('mine') });
  }
  // (the smelter's pairs are the factory's rule: each ore melts into its plate)
  for (const [ore, plate] of [['iron_ore', 'iron'], ['copper_ore', 'copper']] as [ItemType, ItemType][])
    out.push({ fac: 'smelter', out: plate, n: 1, time: SMELT_TIME, inp: [{ res: ore, n: 1 }], fuel: { res: 'coal', per: COAL_SMELTS }, power: pw('smelter') });
  out.push({ fac: 'refinery', out: 'petrol', n: REFINE_OUT, time: REFINE_TIME, inp: [{ res: 'crude', n: REFINE_IN }], power: pw('refinery') });
  out.push({ fac: 'generator', out: 'power', n: GEN_POWER, time: COAL_SECONDS, inp: [{ res: 'coal', n: 1 }], power: 0 });
  for (const f of Object.keys(MAKES) as FacType[]) {
    const r = MAKES[f];
    if (!r) continue;
    const inp: Step['inp'] = [];
    for (const it of ITEM_TYPES) { const q = r.inp[it]; if (q) inp.push({ res: it, n: q }); }
    if (r.fluid) inp.push({ res: r.fluid[0], n: r.fluid[1] });
    if (r.out) out.push({ fac: f, out: r.out, n: 1, time: r.time, inp, power: pw(f) });
    if (r.mats) out.push({ fac: f, out: 'mats', n: r.mats, time: r.time, inp, power: pw(f) });
  }
  return out;
}

export interface ChainTarget { item?: ItemType; fluid?: FluidType; tower?: TowerType; fac?: FacType; res?: Res }
/**
 * A node of a chain: a deposit ('ore'), a resource ('res') or the tower at its end. `n`: how many of it one batch of its
 * parent takes (for the root: how many one batch gives). `by`: how it comes to be: the building, the batch size and time,
 * the power and fuel that takes; for a tower: how long one item lasts it (`time`) or what it burns per second (`rate`),
 * and `arm` when its ammunition is an item (a Transfer Arm has to hand it over: nothing feeds a tower by itself).
 */
export interface ChainNode {
  kind: 'ore' | 'res' | 'tower'; id: string; icon: IconName; name: string; n: number;
  by?: { fac?: FacType; n: number; time?: number; rate?: number; power: number; fuel?: { res: ItemType; per: number }; arm?: boolean };
  kids: ChainNode[];
}
/**
 * A production chain. `roots`: one tree per product (a Mine or a Smelter has several), each from its deposits (the
 * leaves) to the product. `power`: the tree that makes power, when anything in the chain draws it (it is drawn once,
 * beside the chain, not under every step). `fuel`: the tree of a fuel some step burns, when it is not already part of
 * the power tree. `facs` / `ores`: every building and deposit the whole thing takes (the Transfer Arms are not listed in
 * `facs`: they are no step of production). `draw`: the power one of each building and the tower draw together. `arms`:
 * the item hand-offs of the line, so the fewest Transfer Arms it takes with one of each building standing side by side
 * (an item into a building or the tower, a fuel into what burns it; fluids run in pipes and power over wires, a Mine or
 * Pumpjack stands on its deposit).
 */
export interface Chain { target: ChainTarget; roots: ChainNode[]; power: ChainNode | null; fuel: ChainNode[]; facs: FacType[]; ores: OreType[]; draw: number; arms: number }

const resIcon = (r: Res): IconName => r;
const resName = (r: Res) => iconLabel(r);
const isRes = (r: string): r is Res => r === 'mats' || r === 'power' || r in ITEMS || r in FLUIDS;

/** The chain that makes a resource, feeds a tower (`ammo2`: a Mk3 tower switched to its second ammunition, see needsOf; the
 *  level alone changes nothing) or runs through a building. Null when there is none (a belt, an arm, a pole). */
export function chainOf(target: ChainTarget, lvl = 1, ammo2 = false): Chain | null {
  const steps = recipes();
  const maker = (r: Res) => steps.find((s) => s.out === r);
  const facs = new Set<FacType>(), ores = new Set<OreType>(), fuels = new Set<ItemType>();
  let draw = 0, powered = false;
  const drawn = new Set<FacType>(), hands = new Set<string>();
  const grow = (r: Res, n: number, seen: Res[], only?: Step): ChainNode => {
    const node: ChainNode = { kind: 'res', id: r, icon: resIcon(r), name: resName(r), n, kids: [] };
    const s = only ?? maker(r);
    if (!s || seen.includes(r)) return node;
    facs.add(s.fac);
    if (s.power) { powered = true; if (!drawn.has(s.fac)) { drawn.add(s.fac); draw += s.power; } }
    if (s.fuel) { fuels.add(s.fuel.res); hands.add(s.fuel.res + '>' + s.fac); }
    for (const i of s.inp) if (i.res in ITEMS) hands.add(i.res + '>' + s.fac);
    node.by = { fac: s.fac, n: s.n, power: s.power, fuel: s.fuel, ...(s.rate ? { rate: s.n } : { time: s.time }) };
    if (s.on) { ores.add(s.on); node.kids.push({ kind: 'ore', id: s.on, icon: `dep_${s.on}`, name: ORES[s.on].name, n: 1, kids: [] }); }
    for (const i of s.inp) node.kids.push(grow(i.res, i.n, [...seen, r]));
    return node;
  };
  const roots: ChainNode[] = [];
  let tw: TowerNeeds | null = null;
  if (target.tower) {
    const t = TOWERS[target.tower];
    tw = needsOf({ type: target.tower, lvl, ammo2 });
    const node: ChainNode = { kind: 'tower', id: target.tower, icon: `tw_${target.tower}`, name: t.name, n: 1, kids: [], by: { n: 1, power: tw.power ?? 0 } };
    if (tw.item) {
      const shots = tw.shots ?? ITEM_SHOTS[tw.item] ?? 1;
      if (t.rate > 0) node.by!.time = shots / t.rate;
      node.by!.arm = true; hands.add(tw.item + '>tower');
      node.kids.push(grow(tw.item, 1, []));
    }
    if (tw.fluid) { node.by!.rate = FUEL_PER_TICK * t.rate; node.kids.push(grow(tw.fluid, 1, [])); }
    if (tw.power) { powered = true; draw += tw.power; }
    // (a tower that runs on power alone: the power tree is its chain)
    if (!node.kids.length && tw.power) node.kids.push(grow('power', tw.power, []));
    roots.push(node);
  } else if (target.fac) {
    for (const s of steps) if (s.fac === target.fac) roots.push(grow(s.out, s.n, [], s));
  } else {
    const r = target.item ?? target.fluid ?? target.res;
    if (r && isRes(r) && maker(r)) roots.push(grow(r, maker(r)!.n, []));
  }
  if (!roots.length) return null;
  const has = (n: ChainNode, r: Res): boolean => (n.kind === 'res' && n.id === r) || n.kids.some((k) => has(k, r));
  const inMain = (r: Res) => roots.some((n) => has(n, r));
  const power = powered && !inMain('power') ? grow('power', GEN_POWER, []) : null;
  const fuel: ChainNode[] = [];
  for (const f of fuels) if (!inMain(f) && !(power && has(power, f))) fuel.push(grow(f, 1, []));
  return { target, roots, power, fuel, facs: (Object.keys(FACS) as FacType[]).filter((f) => facs.has(f)), ores: ORE_TYPES.filter((o) => ores.has(o)), draw, arms: hands.size };
}

const secs = (t: number) => (Math.abs(t - Math.round(t)) < 0.05 ? String(Math.round(t)) : t.toFixed(1)) + ' s';
const qty = (v: number) => (Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : String(+v.toFixed(1)));
/** A fraction as the reader says it: 1 in 4 is "1/4". */
const frac = (per: number) => (per === 4 ? '¼' : per === 2 ? '½' : per === 3 ? '⅓' : '1/' + qty(per));

/** One step in words: "2 Iron plate + 2 power -> 1 Building materials in 5 s (Frame Works)". */
function stepText(n: ChainNode): string {
  const b = n.by!;
  if (n.kind === 'tower') {
    const eats = n.kids.map((k) => (k.id === 'power' ? `${qty(k.n)} power` : k.name));
    if (b.power && !n.kids.some((k) => k.id === 'power')) eats.push(`${qty(b.power)} power`);
    return `${n.name} runs on ${eats.join(' + ')}` + (b.time ? `, one every ${secs(b.time)}` : b.rate ? `, ${qty(b.rate)} per second` : '') + (b.arm ? `, handed over by a ${FACS.arm.name}` : '');
  }
  const ins = n.kids.map((k) => (k.kind === 'ore' ? `on a ${k.name.toLowerCase()}` : `${qty(k.n)} ${k.name}`));
  if (b.fuel) ins.push(`${frac(b.fuel.per)} ${ITEMS[b.fuel.res].name}`);
  if (b.power) ins.push(`${qty(b.power)} power`);
  const made = b.rate ? `${qty(b.rate)} ${n.name} per second` : `${qty(b.n)} ${n.name} in ${secs(b.time!)}`;
  return `${FACS[b.fac!].name}: ${ins.join(' + ')} -> ${made}`;
}
/** The whole chain in words, deposits first (for the diagram's label and for tests). */
export function chainText(target: ChainTarget, lvl = 1, ammo2 = false): string {
  const c = chainOf(target, lvl, ammo2);
  if (!c) return '';
  const lines: string[] = [];
  const walk = (n: ChainNode) => { for (const k of n.kids) walk(k); if (n.by) { const t = stepText(n); if (!lines.includes(t)) lines.push(t); } };
  for (const r of c.fuel) walk(r);
  if (c.power) walk(c.power);
  for (const r of c.roots) walk(r);
  return lines.join('. ') + '.';
}

// ---------------------------------------------------------------- DOM: the recipe diagram

export interface DiagramOpts {
  /** the width it has to fit in CSS pixels (default 420); a chain wider than this is stacked top to bottom */
  width?: number;
  /** row: left to right; stack: top to bottom; auto (default): row when it fits the width */
  layout?: 'auto' | 'row' | 'stack';
  /** tower level, and whether it is switched to its second ammunition (Mk3 only, see needsOf) */
  lvl?: number; ammo2?: boolean;
  /** leave out the power and fuel lines under the chain */
  bare?: boolean;
}

interface Lay { n: ChainNode; depth: number; lane: number; kids: Lay[] }
const IC = 24, BLD = 18, ROW_SEG = 62;

function layOut(root: ChainNode) {
  let lanes = 0, deep = 0;
  const go = (n: ChainNode, depth: number): Lay => {
    deep = Math.max(deep, depth);
    const kids = n.kids.map((k) => go(k, depth + 1));
    const lane = kids.length ? (kids[0].lane + kids[kids.length - 1].lane) / 2 : lanes++;
    return { n, depth, lane, kids };
  };
  const lay = go(root, 0);
  return { lay, lanes, deep };
}

/** The text of a count under or beside a node, an SVG text in the diagram's type. */
const label = (parent: Element, x: number, y: number, text: string, cls: string, anchor: 'start' | 'middle' | 'end' = 'middle') => {
  const t = svgEl('text', { x: n2(x), y: n2(y), class: cls, 'text-anchor': anchor }, parent);
  t.textContent = text;
  return t;
};
const place = (parent: Element, name: IconName, x: number, y: number, size: number, title?: string) => {
  const s = icon(name, { size, title });
  s.setAttribute('x', String(n2(x))); s.setAttribute('y', String(n2(y)));
  parent.appendChild(s);
  return s;
};
const CH = 6.1; // the width of one character of the diagram's mono type at 10 px

/** One tree drawn as an SVG, left to right (row) or top to bottom (stack). */
function drawTree(root: ChainNode, row: boolean): { svg: SVGSVGElement; w: number; h: number } {
  const { lay, lanes, deep } = layOut(root);
  // main axis: the way production runs; cross axis: the lanes of the branches
  const SEG = row ? ROW_SEG : 46, PITCH = row ? 50 : 86, HEAD = row ? 24 : 34, TAIL = row ? 14 : 30;
  const mainLen = deep * (IC + SEG) + IC, crossLen = HEAD + (lanes - 1) * PITCH + IC + TAIL;
  const w = row ? mainLen : crossLen, h = row ? crossLen : mainLen + 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'ic-d-svg' });
  const lines = svgEl('g', { class: 'ic-d-lines' }, svg);
  const mainOf = (l: Lay) => (deep - l.depth) * (IC + SEG), crossOf = (l: Lay) => HEAD + l.lane * PITCH;
  const xy = (m: number, c: number): [number, number] => (row ? [m, c] : [c, m]);
  const pt = (m: number, c: number) => { const [x, y] = xy(m, c); return n2(x) + ' ' + n2(y); };
  const draw = (l: Lay) => {
    const m0 = mainOf(l), c0 = crossOf(l), b = l.n.by;
    const [nx, ny] = xy(m0, c0);
    place(svg, l.n.icon, nx, ny, IC, l.n.name);
    // what one batch gives, when it is not one
    if (b && l.n.kind === 'res' && !b.rate && b.n !== 1) {
      if (row) label(svg, nx + IC / 2, ny + IC + 10, '×' + qty(b.n), 'ic-d-q');
      else label(svg, nx - 3, ny + IC - 1, '×' + qty(b.n), 'ic-d-q', 'end');
    }
    if (!l.kids.length) return;
    // the kids' lines run to a bus, one arrow goes on from there into this node
    const cc = c0 + IC / 2, tip = m0 - 3, bus = m0 - SEG + 12, from = m0 - SEG;
    let crowded = false; // a count stands under the arrow's own line: the time moves to the arrow's end
    for (const k of l.kids) {
      const kc = crossOf(k) + IC / 2;
      svgEl('path', { d: `M${pt(from + 2, kc)}L${pt(bus, kc)}L${pt(bus, cc)}`, class: 'ic-d-line' }, lines);
      // how many of it a batch takes, when it is not one
      if (k.n.n !== 1 && l.n.kind !== 'tower') {
        const t = '×' + qty(k.n.n);
        if (kc === cc) crowded = true;
        if (row) label(svg, from + 3, kc + 11, t, 'ic-d-q', 'start');
        else label(svg, kc + 4, from + 10, t, 'ic-d-q', 'start');
      }
    }
    svgEl('path', { d: `M${pt(bus, cc)}L${pt(tip - 4, cc)}`, class: 'ic-d-line' }, lines);
    const [ax, ay] = xy(tip, cc);
    svgEl('path', { d: row ? P(ax, ay, ax - 5.5, ay - 3.6, ax - 5.5, ay + 3.6) : P(ax, ay, ax - 3.6, ay - 5.5, ax + 3.6, ay - 5.5), class: 'ic-d-head' }, lines);
    if (!b) { for (const k of l.kids) draw(k); return; }
    // the step's marks: the building (into a tower: the Transfer Arm that hands the item over), the power and fuel it takes, its time
    const mid = (bus + tip) / 2;
    const bic: IconName | null = b.fac ? `fac_${b.fac}` : b.arm ? 'fac_arm' : null, bname = b.fac ? FACS[b.fac].name : `${FACS.arm.name}: nothing feeds a tower by itself`;
    const marks: { ic: IconName; size: number; text: string; cls: string; title: string }[] = [];
    if (b.power) marks.push({ ic: 'power', size: 11, text: qty(b.power), cls: 'ic-d-pw', title: `Draws ${qty(b.power)} power` });
    if (b.fuel) marks.push({ ic: b.fuel.res, size: 12, text: frac(b.fuel.per), cls: 'ic-d-q', title: `Burns one ${ITEMS[b.fuel.res].short} for every ${qty(b.fuel.per)}` });
    const time = b.rate ? qty(b.rate) + '/s' : b.time ? secs(b.time) : '';
    const markW = (k: (typeof marks)[number]) => k.size + 1 + k.text.length * CH;
    if (row) {
      // above the arrow: building, then power and fuel; below it: the time
      let wsum = (bic ? BLD : 0) + marks.reduce((s, k) => s + 3 + markW(k), 0) - (bic ? 0 : 3);
      let x = Math.max(from + 1, Math.min(mid - wsum / 2, m0 - 1 - wsum));
      const base = cc - 5;
      if (bic) { place(svg, bic, x, base - BLD, BLD, bname); x += BLD + 3; }
      for (const k of marks) {
        const g = svgEl('g', {}, svg); svgEl('title', {}, g).textContent = k.title;
        place(g, k.ic, x, base - k.size - 1, k.size); label(g, x + k.size + 1, base - 2.5, k.text, k.cls, 'start'); x += markW(k) + 3;
      }
      if (time) { if (crowded) label(svg, tip - 5, cc + 12, time, 'ic-d-t', 'end'); else label(svg, mid + 1, cc + 12, time, 'ic-d-t'); }
    } else {
      // left of the arrow: the building; right of it: time, then power and fuel
      const midY = mid + 1;
      if (bic) place(svg, bic, cc - 6 - BLD, midY - BLD / 2, BLD, bname);
      let y = midY + 3 - (marks.length ? 6 : 0) - (marks.length > 1 ? 6 : 0);
      if (time) { label(svg, cc + 7, y, time, 'ic-d-t', 'start'); y += 13; } else y += 3;
      for (const k of marks) {
        const g = svgEl('g', {}, svg); svgEl('title', {}, g).textContent = k.title;
        place(g, k.ic, cc + 6, y - k.size + 2, k.size); label(g, cc + 7 + k.size, y, k.text, k.cls, 'start'); y += 13;
      }
    }
    for (const k of l.kids) draw(k);
  };
  draw(lay);
  return { svg, w, h };
}

/** How wide a chain is drawn left to right (the widest of its trees). */
function rowWidth(c: Chain, bare: boolean) {
  const all = bare ? c.roots : [...c.roots, ...(c.power ? [c.power] : []), ...c.fuel];
  return Math.max(...all.map((r) => layOut(r).deep * (IC + ROW_SEG) + IC));
}

/**
 * The production chain of an item, a fluid, a tower or a building as a diagram: icons joined by arrows from the raw
 * deposits to the product, the building of each step over its arrow with the power and fuel it takes, the time under
 * it, counts where a batch takes or gives more than one. Power and fuel are drawn once, on a line of their own under
 * the chain. A Transfer Arm is drawn only where no building marks the arrow (the hand-off into a tower); how many arms the
 * whole line takes at least is said once, on a last line. Everything comes out of chainOf(), so out of data.ts. With nothing to show (a belt, a pole) the element is
 * empty and carries the class ic-d-none.
 */
export function recipeDiagram(target: ChainTarget, opts: DiagramOpts = {}): HTMLElement {
  const box = htmlEl('div', 'ic-diagram');
  const c = chainOf(target, opts.lvl ?? 1, !!opts.ammo2);
  if (!c) { box.classList.add('ic-d-none'); return box; }
  const width = opts.width ?? 420, need = rowWidth(c, !!opts.bare);
  const row = opts.layout === 'row' || (opts.layout !== 'stack' && need <= width);
  box.classList.add(row ? 'ic-d-row' : 'ic-d-stack');
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', chainText(target, opts.lvl ?? 1, !!opts.ammo2));
  const part = (root: ChainNode, cap?: string, note?: string) => {
    const sec = htmlEl('div', 'ic-d-part' + (cap ? ' ic-d-aux' : ''), box);
    if (cap) { const hd = htmlEl('div', 'ic-d-cap', sec); htmlEl('span', '', hd, cap); if (note) htmlEl('i', '', hd, note); }
    // (the short power and fuel lines stay left to right when they fit, also under a stacked chain)
    sec.appendChild(drawTree(root, row || (!!cap && layOut(root).deep * (IC + ROW_SEG) + IC <= width)).svg);
  };
  for (const r of c.roots) part(r);
  if (!opts.bare) {
    for (const f of c.fuel) part(f, 'Fuel', ITEMS[f.id as ItemType]?.name);
    if (c.power) part(c.power, 'Power', c.draw ? `this line draws ${qty(c.draw)}` : undefined);
    // the hand-offs: said once under the chain (an arm on every arrow would bury the recipe)
    if (c.arms) {
      const hd = htmlEl('div', 'ic-d-cap', htmlEl('div', 'ic-d-part ic-d-aux ic-d-arms', box));
      hd.appendChild(icon('fac_arm', { size: 14 }));
      htmlEl('span', '', hd, `${c.arms} ${FACS.arm.name}${c.arms > 1 ? 's' : ''}`);
      htmlEl('i', '', hd, c.arms > 1 ? 'at least: one for every item handed from one building to the next' : 'hands the item over');
    }
  }
  return box;
}

// (kept for callers that want to list every icon by group)
export const ICON_GROUPS: { name: string; icons: IconName[] }[] = [
  { name: 'Materials', icons: [...ITEM_TYPES, 'mats'] },
  { name: 'Fluids', icons: [...FLUID_TYPES] },
  { name: 'Counters', icons: ['power', 'credits', 'mats', 'time'] },
  { name: 'Deposits', icons: ORE_TYPES.map((o): IconName => `dep_${o}`) },
  { name: 'Buildings', icons: [...FAC_TYPES, 'crate' as FacType].map((f): IconName => `fac_${f}`) },
  { name: 'Towers', icons: (Object.keys(TOWERS) as TowerType[]).map((t): IconName => `tw_${t}`) },
  { name: 'Targeting', icons: (Object.keys(TARGET_INFO) as TargetMode[]).map((m): IconName => `aim_${m}`) },
  { name: 'Supply', icons: ['st_ok', 'st_missing', 'st_notaker', 'st_locked'] },
];
