// 2D map drawing shared by the map-select cards, the editor's saved list and the editor canvas.
// Drawn like a chart-room plot: soot ground, a hex board, roads as inked lines along the hex rows,
// spawn gates in the enemy's cold blue, the core as a bone-white bullseye on its seven tiles.
import { GW, GH, TOWERS } from './data.ts';
import { CELL, HEX_SIZE, BOARD_W, BOARD_D, HEX_CORNERS, cellX, cellZ, lineDir, lineCells, disc, inBoard, neighbor } from './hex.ts';
import type { MapDef, LanePoint } from './map.ts';

export const MAP_INK = {
  ground: '#12100d', board: '#1f1a17', grid: 'rgba(227,220,146,0.07)', edge: 'rgba(227,220,146,0.3)',
  scenery: '#3a3029', bed: '#0c0a09', lanes: ['#e3dc92', '#f68b56', '#7fb8ad'], spawn: '#8fd0ff', core: '#efe9d6',
  bad: '#ce6b44',
};

/** World to canvas: px = x0 + worldX * u, py = z0 + worldZ * u. */
export interface Proj { u: number; x0: number; z0: number }

/** Adds a pointy-top hexagon to the current path (r = centre to corner). */
export function hexPath(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const k = r / HEX_SIZE;
  g.moveTo(x + HEX_CORNERS[0][0] * k, y + HEX_CORNERS[0][1] * k);
  for (let i = 1; i < 6; i++) g.lineTo(x + HEX_CORNERS[i][0] * k, y + HEX_CORNERS[i][1] * k);
  g.closePath();
}

/** Adds the outline of a group of tiles to the current path: every tile edge whose neighbour is not in the group. */
export function outlinePath(g: CanvasRenderingContext2D, p: Proj, cells: [number, number][], has: (cx: number, cz: number) => boolean) {
  for (const [cx, cz] of cells) {
    const x = p.x0 + cellX(cx, cz) * p.u, y = p.z0 + cellZ(cz) * p.u;
    for (let i = 0; i < 6; i++) {
      // the edge from corner i to corner i + 1 faces hex direction i + 5
      const n = neighbor(cx, cz, i + 5);
      if (has(n[0], n[1])) continue;
      const a = HEX_CORNERS[i], b = HEX_CORNERS[(i + 1) % 6];
      g.moveTo(x + a[0] * p.u, y + a[1] * p.u); g.lineTo(x + b[0] * p.u, y + b[1] * p.u);
    }
  }
}

/** A piece of road on one height layer, as world x, z pairs. `ok` is false for a stretch that leaves the hex lines. */
export interface RoadRun { lane: number; layer: number; pts: number[]; ok: boolean }

/** Cuts roads into tile-to-tile steps and joins the steps of one layer back into runs, lowest layer first. */
export function roadRuns(lanes: LanePoint[][]): RoadRun[] {
  const runs: RoadRun[] = [];
  lanes.forEach((l, lane) => {
    let cur: RoadRun | null = null;
    const step = (ax: number, az: number, bx: number, bz: number, h: number, ok: boolean) => {
      const layer = Math.round(h);
      if (!cur || cur.layer !== layer || cur.ok !== ok) { cur = { lane, layer, pts: [cellX(ax, az), cellZ(az)], ok }; runs.push(cur); }
      cur.pts.push(cellX(bx, bz), cellZ(bz));
    };
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i], ha = a[2] || 0, hb = b[2] || 0;
      if (a[0] === b[0] && a[1] === b[1]) continue;
      if (lineDir(a[0], a[1], b[0], b[1]) < 0) { step(a[0], a[1], b[0], b[1], (ha + hb) / 2, false); continue; }
      const cells = lineCells(a[0], a[1], b[0], b[1]), n = cells.length - 1;
      for (let k = 1; k <= n; k++) step(cells[k - 1][0], cells[k - 1][1], cells[k][0], cells[k][1], ha + ((hb - ha) * (k - 0.5)) / n, true);
    }
  });
  return runs.map((r, i) => ({ r, i })).sort((a, b) => a.r.layer - b.r.layer || a.i - b.i).map((x) => x.r);
}

/**
 * Strokes roads, `w` pixels wide. Deck-level road is a plain line. Raised road gets a drop shadow, a dark casing
 * and a centre line, and is drawn after everything below it, so a bridge reads as passing over the road beneath.
 */
export function drawRoads(g: CanvasRenderingContext2D, lanes: LanePoint[][], p: Proj, w: number, colours: string[] = MAP_INK.lanes) {
  const trace = (r: RoadRun, dx: number, dy: number) => {
    g.beginPath(); g.moveTo(p.x0 + r.pts[0] * p.u + dx, p.z0 + r.pts[1] * p.u + dy);
    for (let i = 2; i < r.pts.length; i += 2) g.lineTo(p.x0 + r.pts[i] * p.u + dx, p.z0 + r.pts[i + 1] * p.u + dy);
    g.stroke();
  };
  const runs = roadRuns(lanes);
  g.save();
  g.lineJoin = 'round'; g.setLineDash([]);
  let layer = -1;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.layer !== layer) {
      layer = r.layer;
      if (layer > 0) {
        // all shadows and casings of a layer go down before its colour, so runs of one layer never notch each other
        const off = w * 0.55 * layer;
        g.lineCap = 'butt';
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = w * 1.5;
        for (let k = i; k < runs.length && runs[k].layer === layer; k++) trace(runs[k], off * 0.6, off);
        g.strokeStyle = MAP_INK.bed; g.lineWidth = w + Math.max(2, w * 0.9);
        for (let k = i; k < runs.length && runs[k].layer === layer; k++) trace(runs[k], 0, 0);
      }
    }
    const col = colours[r.lane % colours.length];
    g.lineCap = 'round';
    if (!r.ok) {
      g.strokeStyle = MAP_INK.bad; g.lineWidth = Math.max(1.5, w * 0.6); g.setLineDash([w, w]);
      trace(r, 0, 0); g.setLineDash([]);
      continue;
    }
    g.strokeStyle = col; g.lineWidth = w;
    trace(r, 0, 0);
    if (r.layer > 0 && w >= 3) {
      g.lineCap = 'butt'; g.strokeStyle = MAP_INK.bed; g.lineWidth = Math.max(1, w * 0.26);
      trace(r, 0, 0);
    }
  }
  g.restore();
}

const BOARD_CELLS: [number, number][] = [];
for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) BOARD_CELLS.push([cx, cz]);
export const boardCells = (): [number, number][] => BOARD_CELLS;

export function drawMap(cv: HTMLCanvasElement, def: MapDef) {
  const g = cv.getContext('2d');
  if (!g) return;
  const pad = CELL * 0.9; // room for the spawn gates just outside the board
  const u = Math.min(cv.width / (BOARD_W + pad * 2), cv.height / (BOARD_D + pad * 2));
  const p: Proj = { u, x0: cv.width / 2, z0: cv.height / 2 };
  const X = (cx: number, cz: number) => p.x0 + cellX(cx, cz) * u, Z = (cz: number) => p.z0 + cellZ(cz) * u;
  const t = CELL * u, R = HEX_SIZE * u;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.shadowBlur = 0; g.globalAlpha = 1; g.setLineDash([]);
  g.fillStyle = MAP_INK.ground; g.fillRect(0, 0, cv.width, cv.height);
  // board: every tile in one path, so there are no seams
  g.beginPath();
  for (const [cx, cz] of BOARD_CELLS) hexPath(g, X(cx, cz), Z(cz), R);
  g.fillStyle = MAP_INK.board; g.fill();
  if (t >= 7) { g.strokeStyle = MAP_INK.grid; g.lineWidth = 1; g.stroke(); }
  // scenery
  g.beginPath();
  for (const [cx, cz] of def.blocked) if (inBoard(cx, cz)) hexPath(g, X(cx, cz), Z(cz), R * 0.86);
  g.fillStyle = MAP_INK.scenery; g.fill();
  // road bed, then the roads
  g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = MAP_INK.bed; g.lineWidth = t * 0.9;
  for (const l of def.lanes) {
    if (l.length < 2) continue;
    g.beginPath(); g.moveTo(X(l[0][0], l[0][1]), Z(l[0][1]));
    for (const q of l.slice(1)) g.lineTo(X(q[0], q[1]), Z(q[1]));
    g.stroke();
  }
  drawRoads(g, def.lanes, p, Math.max(2, t * 0.46));
  // spawn gates, kept inside the picture
  const m = t * 0.6;
  for (const l of def.lanes) {
    if (!l.length) continue;
    const x = Math.max(m, Math.min(cv.width - m, X(l[0][0], l[0][1]))), z = Math.max(m, Math.min(cv.height - m, Z(l[0][1])));
    g.fillStyle = MAP_INK.bed; g.beginPath(); g.arc(x, z, t * 0.6, 0, 7); g.fill();
    g.fillStyle = MAP_INK.spawn; g.beginPath(); g.arc(x, z, t * 0.4, 0, 7); g.fill();
  }
  // starting towers: a dot each
  for (const tw of def.towers) {
    if (!inBoard(tw.cx, tw.cz)) continue;
    const x = X(tw.cx, tw.cz), z = Z(tw.cz);
    {
      g.fillStyle = MAP_INK.bed; g.beginPath(); g.arc(x, z, Math.max(2, t * 0.44), 0, 7); g.fill();
      g.fillStyle = '#' + TOWERS[tw.t].color.toString(16).padStart(6, '0'); g.beginPath(); g.arc(x, z, Math.max(1.4, t * 0.3), 0, 7); g.fill();
    }
  }
  // core: its seven tiles, outlined, with a bullseye
  const core = disc(def.core[0], def.core[1], 1);
  const inCore = (cx: number, cz: number) => core.some((c) => c[0] === cx && c[1] === cz);
  g.beginPath();
  for (const [cx, cz] of core) hexPath(g, X(cx, cz), Z(cz), R);
  g.fillStyle = MAP_INK.bed; g.fill();
  g.beginPath(); outlinePath(g, p, core, inCore);
  g.strokeStyle = MAP_INK.core; g.lineWidth = Math.max(1, t * 0.16); g.lineCap = 'round'; g.stroke();
  g.fillStyle = MAP_INK.core; g.beginPath(); g.arc(X(def.core[0], def.core[1]), Z(def.core[1]), t * 0.46, 0, 7); g.fill();
  // board edge
  g.beginPath(); outlinePath(g, p, BOARD_CELLS, inBoard);
  g.strokeStyle = MAP_INK.edge; g.lineWidth = 1; g.stroke();
}
