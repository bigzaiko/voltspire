// Pre-made maps, ordered from simple to complex. Every map carries at least one Uplink Spire (the only tower Kestrel can uplink to).
import { DEFAULT_MAP } from './map.ts';
import type { MapDef } from './map.ts';

const B = (...cells: number[]): [number, number][] => { const o: [number, number][] = []; for (let i = 0; i < cells.length; i += 2) o.push([cells[i], cells[i + 1]]); return o; };
const spire = (cx: number, cz: number): MapDef['towers'][number] => ({ t: 'spire', cx, cz });

export const MAPS: MapDef[] = [
  { ...DEFAULT_MAP, towers: [spire(14, 9)] },
  {
    id: 'spiral', name: 'Coil', desc: 'A long spiral into the heart of the grid. Plenty of time to shoot — and to overreach.', tier: 1,
    lanes: [B(-2, 1, 23, 1, 23, 15, 3, 15, 3, 5, 18, 5, 18, 11, 8, 11, 8, 8, 11.4, 8)],
    core: [13, 8], gold: 190, lives: 20, towers: [spire(6, 8)], blocked: [],
  },
  {
    id: 'crossfire', name: 'Crossfire', desc: 'Two roads from the west that close on the core side by side.', tier: 2,
    lanes: [B(-2, 2, 8, 2, 8, 7, 18, 7, 18, 8, 22.4, 8), B(-2, 15, 12, 15, 12, 10, 20, 10, 20, 9, 22.4, 9)],
    core: [24, 8], gold: 320, lives: 20, towers: [spire(14, 9)], blocked: B(3, 8, 3, 9, 4, 9, 15, 3, 16, 3, 16, 14, 17, 14),
  },
  {
    id: 'gauntlet', name: 'Gauntlet', desc: 'A short road through wreckage. Few tiles, no room for mistakes.', tier: 2,
    lanes: [B(-2, 9, 7, 9, 7, 5, 13, 5, 13, 12, 19, 12, 19, 9, 22.4, 9)],
    core: [24, 9], gold: 300, lives: 18, towers: [{ t: 'pulse', cx: 8, cz: 7 }, spire(12, 8)],
    blocked: B(2, 7, 3, 7, 2, 11, 3, 11, 4, 11, 9, 3, 10, 3, 11, 3, 5, 6, 5, 5, 10, 8, 10, 9, 11, 9, 15, 7, 16, 7, 16, 8, 15, 14, 16, 14, 17, 14, 21, 6, 21, 7, 21, 11, 21, 12, 9, 13, 10, 13, 10, 14, 17, 10),
  },
  {
    id: 'overpass', name: 'Overpass', desc: 'One road that climbs, doubles back and bridges over its own first stretch.', tier: 2,
    lanes: [[[-2, 10], [16, 10], [16, 3], [14, 3], [11, 3, 1], [8, 3, 1], [8, 11, 1], [8, 14], [21.4, 14]]],
    core: [23, 14], gold: 230, lives: 20, towers: [spire(12, 7)], blocked: B(3, 5, 3, 6, 4, 6, 20, 5, 20, 6, 21, 6, 12, 16, 13, 16, 4, 13, 19, 9, 20, 9),
  },
  {
    id: 'pincer', name: 'Pincer', desc: 'The core sits in the middle and the Static comes from both sides at once.', tier: 3,
    lanes: [B(-2, 4, 6, 4, 6, 13, 10, 13, 10, 9, 11.4, 9), B(27, 13, 20, 13, 20, 4, 16, 4, 16, 9, 14.6, 9)],
    core: [13, 9], gold: 340, lives: 20, towers: [spire(8, 8), spire(18, 9)], blocked: B(12, 2, 13, 2, 14, 2, 12, 15, 13, 15, 14, 15, 1, 15, 2, 15, 24, 2, 23, 2),
  },
  {
    id: 'trident', name: 'Trident', desc: 'Three roads, one core. Decide which flank you can afford to lose.', tier: 3,
    lanes: [B(-2, 2, 14, 2, 14, 7, 22.4, 7.6), B(-2, 9, 6, 9, 6, 6, 10, 6, 10, 9, 22.4, 9), B(-2, 16, 18, 16, 18, 11, 22.4, 10.4)],
    core: [24, 9], gold: 400, lives: 22, towers: [spire(8, 7), spire(16, 12)], blocked: B(3, 4, 3, 5, 4, 5, 11, 12, 11, 13, 12, 13, 20, 3, 20, 4, 21, 14, 21, 15),
  },
  {
    id: 'highline', name: 'Highline', desc: 'Two roads. The northern one rides a high viaduct over the other and only ramps down at the core.', tier: 3,
    lanes: [B(-2, 13, 5, 13, 5, 4, 13, 4, 13, 14, 22, 14, 22, 10.6), [[10, -2, 2], [10, 9, 2], [14, 9, 2], [20.4, 9]]],
    core: [22, 9], gold: 360, lives: 20, towers: [spire(8, 8), spire(17, 11)], blocked: B(2, 7, 2, 8, 3, 8, 17, 3, 18, 3, 18, 4, 8, 16, 9, 16, 24, 4, 24, 5),
  },
];
export const mapById = (id: unknown) => MAPS.find((m) => m.id === id);
