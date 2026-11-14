// Pre-made maps, ordered from simple to complex.
import { DEFAULT_MAP } from './map.ts';
import type { MapDef } from './map.ts';

const B = (...cells: number[]): [number, number][] => { const o: [number, number][] = []; for (let i = 0; i < cells.length; i += 2) o.push([cells[i], cells[i + 1]]); return o; };

export const MAPS: MapDef[] = [
  DEFAULT_MAP,
  {
    id: 'spiral', name: 'Coil', desc: 'A long spiral into the heart of the grid. Plenty of time to shoot — and to overreach.', tier: 1,
    lanes: [B(-2, 1, 23, 1, 23, 15, 3, 15, 3, 5, 18, 5, 18, 11, 8, 11, 8, 8, 11.4, 8)],
    core: [13, 8], gold: 190, lives: 20, towers: [], blocked: [],
  },
  {
    id: 'crossfire', name: 'Crossfire', desc: 'Two roads from the west that close on the core side by side.', tier: 2,
    lanes: [B(-2, 2, 8, 2, 8, 7, 18, 7, 18, 8, 22.4, 8), B(-2, 15, 12, 15, 12, 10, 20, 10, 20, 9, 22.4, 9)],
    core: [24, 8], gold: 320, lives: 20, towers: [], blocked: B(3, 8, 3, 9, 4, 9, 15, 3, 16, 3, 16, 14, 17, 14),
  },
  {
    id: 'gauntlet', name: 'Gauntlet', desc: 'A short road through wreckage. Few tiles, no room for mistakes.', tier: 2,
    lanes: [B(-2, 9, 7, 9, 7, 5, 13, 5, 13, 12, 19, 12, 19, 9, 22.4, 9)],
    core: [24, 9], gold: 300, lives: 18, towers: [{ t: 'pulse', cx: 8, cz: 7 }],
    blocked: B(2, 7, 3, 7, 2, 11, 3, 11, 4, 11, 9, 3, 10, 3, 11, 3, 5, 6, 5, 5, 10, 8, 10, 9, 11, 9, 15, 7, 16, 7, 16, 8, 15, 14, 16, 14, 17, 14, 21, 6, 21, 7, 21, 11, 21, 12, 9, 13, 10, 13, 10, 14, 17, 10),
  },
  {
    id: 'pincer', name: 'Pincer', desc: 'The core sits in the middle and the Static comes from both sides at once.', tier: 3,
    lanes: [B(-2, 4, 6, 4, 6, 13, 10, 13, 10, 9, 11.4, 9), B(27, 13, 20, 13, 20, 4, 16, 4, 16, 9, 14.6, 9)],
    core: [13, 9], gold: 340, lives: 20, towers: [], blocked: B(12, 2, 13, 2, 14, 2, 12, 15, 13, 15, 14, 15, 1, 15, 2, 15, 24, 2, 23, 2),
  },
  {
    id: 'trident', name: 'Trident', desc: 'Three roads, one core. Decide which flank you can afford to lose.', tier: 3,
    lanes: [B(-2, 2, 14, 2, 14, 7, 22.4, 7.6), B(-2, 9, 6, 9, 6, 6, 10, 6, 10, 9, 22.4, 9), B(-2, 16, 18, 16, 18, 11, 22.4, 10.4)],
    core: [24, 9], gold: 400, lives: 22, towers: [], blocked: B(3, 4, 3, 5, 4, 5, 11, 12, 11, 13, 12, 13, 20, 3, 20, 4, 21, 14, 21, 15),
  },
];
export const mapById = (id: unknown) => MAPS.find((m) => m.id === id);
