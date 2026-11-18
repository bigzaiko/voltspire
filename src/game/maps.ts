// Pre-made maps, ordered from simple to complex. Deposits for the factory are laid out by factory.ts from each map's free deck.
import { DEFAULT_MAP } from './map.ts';
import type { MapDef, LanePoint } from './map.ts';
import { route } from './hex.ts';
import { generateMap, WORDS } from './mapgen.ts';

// Directions: east, south-east, south-west, west, north-west, north-east.
const E = 0, SE = 1, SW = 2, W = 3, NW = 4, NE = 5;
/** A road from a gate tile and a list of [direction, steps, level at the end of the stretch] moves. */
function road(start: [number, number], moves: [number, number, number?][], level = 0): LanePoint[] {
  const pts = route(start, moves.map(([d, n]) => [d, n]));
  const lv = [level, ...moves.map((m) => m[2] || 0)];
  return pts.map(([cx, cz], i): LanePoint => (lv[i] && i < pts.length - 1 ? [cx, cz, lv[i]] : [cx, cz]));
}
const B = (...cells: number[]): [number, number][] => { const o: [number, number][] = []; for (let i = 0; i < cells.length; i += 2) o.push([cells[i], cells[i + 1]]); return o; };

export const MAPS: MapDef[] = [
  { ...DEFAULT_MAP, towers: [], blocked: B(1, 9, 1, 10, 2, 10, 17, 18, 18, 18, 18, 17, 23, 2, 24, 2, 24, 3) },
  {
    id: 'spiral', name: 'Coil', desc: 'A long spiral into the heart of the grid. Plenty of time to shoot, and to overreach.', tier: 1,
    lanes: [road([-2, 1], [[E, 19], [SE, 8], [SW, 8], [W, 8], [NW, 8], [NE, 5], [E, 8], [SE, 5], [SW, 5], [W, 5], [NW, 5], [E, 3]])],
    core: [13, 9], gold: 190, lives: 20, towers: [], blocked: B(1, 15, 2, 15, 2, 16, 23, 15, 24, 15, 23, 16, 23, 3, 24, 3),
  },
  {
    id: 'crossfire', name: 'Crossfire', desc: 'Two roads from the west that close on the core side by side.', tier: 2,
    lanes: [
      road([-2, 3], [[E, 9], [SE, 4], [E, 6], [NE, 3], [E, 3], [SE, 4]]),
      road([-2, 16], [[E, 9], [NE, 4], [E, 6], [SE, 3], [E, 3], [NE, 3]]),
    ],
    core: [22, 10], gold: 320, lives: 20, towers: [], blocked: B(3, 9, 3, 10, 4, 10, 12, 2, 13, 2, 12, 17, 13, 17),
  },
  {
    id: 'gauntlet', name: 'Gauntlet', desc: 'A short road through wreckage. Few tiles, no room for mistakes.', tier: 2,
    lanes: [road([-2, 10], [[E, 6], [NE, 5], [E, 5], [SE, 8], [E, 4], [NE, 3]])],
    core: [23, 10], gold: 300, lives: 18, towers: [{ t: 'pulse', cx: 8, cz: 7 }],
    blocked: B(
      2, 7, 3, 7, 2, 8, 2, 12, 3, 12, 3, 13, 9, 3, 10, 3, 9, 2, 7, 9, 8, 9, 8, 10, 13, 4, 14, 4, 14, 5, 15, 5, 16, 8, 17, 8, 17, 9, 16, 9,
      16, 15, 17, 15, 17, 16, 10, 12, 11, 12, 10, 13, 20, 7, 21, 7, 21, 6, 22, 14, 23, 14, 23, 15, 18, 10, 18, 11,
    ),
  },
  {
    id: 'overpass', name: 'Overpass', desc: 'One road that climbs, doubles back and bridges over its own first stretch.', tier: 2,
    lanes: [road([-2, 10], [[E, 16], [NE, 6], [W, 3, 1], [W, 3, 1], [SW, 8, 1], [SW, 3], [E, 10], [NE, 3], [E, 3]])],
    core: [22, 12], gold: 230, lives: 20, towers: [], blocked: B(2, 5, 3, 5, 3, 6, 21, 4, 22, 4, 22, 5, 11, 17, 12, 17),
  },
  {
    id: 'pincer', name: 'Pincer', desc: 'The core sits in the middle and the Static comes from both sides at once.', tier: 3,
    lanes: [
      road([-2, 4], [[E, 8], [SE, 5], [SW, 5], [E, 7], [NE, 4]]),
      road([27, 15], [[W, 8], [NW, 5], [NE, 5], [W, 6], [SW, 4]]),
    ],
    core: [13, 10], gold: 340, lives: 20, towers: [], blocked: B(12, 2, 13, 2, 13, 3, 12, 16, 13, 16, 12, 17),
  },
  {
    id: 'trident', name: 'Trident', desc: 'Three roads, one core. Decide which flank you can afford to lose.', tier: 3,
    lanes: [
      road([-2, 2], [[E, 12], [SE, 4], [E, 8], [SE, 2]]),
      road([-2, 10], [[E, 5], [NE, 3], [E, 4], [SE, 3], [E, 10]]),
      road([-2, 17], [[E, 12], [NE, 4], [E, 8], [NE, 1]]),
    ],
    core: [22, 10], gold: 400, lives: 22, towers: [], blocked: B(3, 5, 3, 6, 4, 6, 3, 13, 3, 14, 4, 14),
  },
  {
    id: 'highline', name: 'Highline', desc: 'Two roads. The northern one rides a viaduct over the other and ramps down at the core.', tier: 3,
    lanes: [
      road([-2, 15], [[E, 5], [NE, 10], [E, 13], [SE, 5], [SW, 2]]),
      road([9, -2], [[SE, 12, 2], [SE, 3, 1], [E, 3]], 2),
    ],
    core: [21, 13], gold: 360, lives: 20, towers: [], blocked: B(1, 7, 2, 7, 2, 8, 23, 3, 24, 3, 24, 4, 9, 17, 10, 17),
  },
];

/**
 * Thirty more maps picked from the generator for variety, ten per tier (tools/curate.ts chose the seeds:
 * road count, bridges, length and core position are spread out). Each entry is [tier, seed].
 */
const PICKS: [number, number][] = [
  [1, 101], [1, 449], [1, 457], [1, 125], [1, 491], [1, 186], [1, 202], [1, 294], [1, 183], [1, 203],
  [2, 101], [2, 355], [2, 255], [2, 408], [2, 313], [2, 282], [2, 333], [2, 435], [2, 235], [2, 230],
  [3, 101], [3, 500], [3, 466], [3, 284], [3, 327], [3, 467], [3, 460], [3, 474], [3, 113], [3, 185],
];
/** How many of MAPS are hand-made; the rest are the picked generated ones. */
export const HANDMADE = MAPS.length;
for (const [tier, seed] of PICKS) MAPS.push(generateMap(seed, tier));
// (the generator names a sector after one of WORDS, so thirty picks repeat some: a repeat takes the next place name not yet in the
// list, so every pre-made map reads differently and not only by its sector code. A map made from the same seed elsewhere keeps its own name.)
{
  const used = new Set<string>(), word = (n: string) => WORDS.find((w) => n.endsWith(' ' + w));
  for (const m of MAPS.slice(HANDMADE)) {
    const w = word(m.name);
    if (w && used.has(w)) {
      const k = WORDS.indexOf(w), next = [...WORDS.slice(k + 1), ...WORDS.slice(0, k)].find((o) => !used.has(o));
      if (next) { m.name = (m.name.slice(0, -w.length) + next).slice(0, 28); used.add(next); }
    } else if (w) used.add(w);
  }
}

export const mapById = (id: unknown) => MAPS.find((m) => m.id === id);
