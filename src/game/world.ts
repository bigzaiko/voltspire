// Static environment: hex armour deck, raised roads, hex-built district, sky, atmosphere, lights.
// Everything is procedural (2D canvases + small shaders): no external assets.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GW, GH, CELL, HEX_SIZE, ROW_H, BOARD_W, BOARD_D, HEX_CORNERS, cellX, cellZ, neighbor, hexDist, disc } from './hex.ts';
import { GameMap, DEFAULT_MAP } from './map.ts';
import { rng, canvas, noiseCanvas, cloudCanvas, normalFromHeight, packRM, lightPool, glowTexture, hexPath } from './tex.ts';

const grey = (v: number) => { const k = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${k},${k},${k})`; };
type Ctx = CanvasRenderingContext2D;

/** Layer that is skipped by the ambient-occlusion pre-pass (transparent / unlit things). */
export const FX_LAYER = 1;
export function noAO<T extends THREE.Object3D>(o: T): T { o.traverse((c) => c.layers.set(FX_LAYER)); return o; }

// Ember palette
const SAND = 0xe3dc92, APRICOT = 0xf68b56, RUST = 0xce6b44, STATIC = 0x8fd0ff;

// ---------- tile layout ----------
const PLATE = 0, ROAD = 1, BLOCKED = 2, PAD = 3, SKIRT = 4, UNDER = 5;
// lookup grid that also covers the tiles outside the board (gate aprons, skirt)
const KW = 64, KH = 48, KO = 8;
const key = (cx: number, cz: number) => (cz + KO) * KW + cx + KO;
const inKey = (cx: number, cz: number) => cx >= -KO && cx < KW - KO && cz >= -KO && cz < KH - KO;
const ROAD_DROP = 0.06;      // road tiles sit this far below the plates
const TILE_DEPTH = 0.62;
const ROAD_HALF = 0.72;      // half width of a raised road (narrow enough that towers on the next tile clear the railing)
const KERB_W = 0.12;         // width of its steel kerb
const KERB_DECK = 0.73;      // lateral offset of the LED kerb strips on the deck
const KERB_UP = 0.67;        // and on a raised road, inside the steel kerb
/** Surface height of a road whose path height is y: the recess blends out as the road leaves the deck. */
const surf = (y: number) => y - ROAD_DROP * Math.max(0, 1 - y / 0.5);

interface Tile { cx: number; cz: number; x: number; z: number; kind: number; seed: number }
interface Layout { tiles: Tile[]; lut: Int16Array; roadMin: Map<number, number>; x0: number; z0: number; w: number; d: number }

// worldToCell without the array (revealAt runs every frame for every tower)
let CX = 0, CZ = 0;
function cellOf(x: number, z: number) {
  const rf = z / ROW_H + (GH - 1) / 2, qf = x / CELL + GW / 2 - 0.25 - rf / 2, sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf), dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
  CX = q + (r - (r & 1)) / 2; CZ = r;
}

function layout(map: GameMap): Layout {
  const tiles: Tile[] = [], lut = new Int16Array(KW * KH).fill(-1), roadMin = new Map<number, number>();
  for (const lane of map.lanes) for (let i = 1; i < lane.pts.length; i++) {
    const a = lane.pts[i - 1], b = lane.pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
    for (let s = 0; s <= n; s++) {
      const u = s / n;
      cellOf(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
      if (!inKey(CX, CZ)) continue;
      const k = key(CX, CZ), y = lane.ys[i - 1] + (lane.ys[i] - lane.ys[i - 1]) * u, m = roadMin.get(k);
      if (m === undefined || y < m) roadMin.set(k, y);
    }
  }
  const add = (cx: number, cz: number, kind: number) => {
    if (!inKey(cx, cz)) return;
    const k = key(cx, cz);
    if (lut[k] >= 0) return;
    lut[k] = tiles.length;
    const h = Math.sin(cx * 127.1 + cz * 311.7) * 43758.5453;
    tiles.push({ cx, cz, x: cellX(cx, cz), z: cellZ(cz), kind, seed: h - Math.floor(h) });
  };
  const roadKind = (k: number) => (roadMin.get(k)! < 0.35 ? ROAD : UNDER);
  const kx = Math.round(map.def.core[0]), kz = Math.round(map.def.core[1]);
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const k = key(cx, cz);
    add(cx, cz, hexDist(cx, cz, kx, kz) <= 1 ? PAD : roadMin.has(k) ? roadKind(k) : map.grid[cz * GW + cx] === 3 ? BLOCKED : PLATE);
  }
  // road tiles outside the board, and an apron of plates under each gate
  for (const k of roadMin.keys()) add((k % KW) - KO, Math.floor(k / KW) - KO, roadKind(k));
  for (const lane of map.lanes) {
    const a = lane.pts[0], b = lane.pts[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    cellOf(a[0], a[1]);
    const c0 = disc(CX, CZ, 1);
    cellOf(a[0] - ((b[0] - a[0]) / L) * CELL, a[1] - ((b[1] - a[1]) / L) * CELL);
    for (const [cx, cz] of c0.concat(disc(CX, CZ, 1))) add(cx, cz, PLATE);
  }
  const n = tiles.length;
  for (let i = 0; i < n; i++) for (let d = 0; d < 6; d++) { const c = neighbor(tiles[i].cx, tiles[i].cz, d); add(c[0], c[1], SKIRT); }
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const t of tiles) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z); }
  x0 -= 1.2; z0 -= 1.3; x1 += 1.2; z1 += 1.3;
  return { tiles, lut, roadMin, x0, z0, w: x1 - x0, d: z1 - z0 };
}

// ---------- deck textures ----------
function hazard(g: Ctx, x: number, y: number, w: number, h: number, alpha: number) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = `rgba(14,13,11,${alpha})`; g.fillRect(x, y, w, h);
  g.strokeStyle = `rgba(206,150,60,${alpha})`; g.lineWidth = 3.4;
  g.beginPath();
  for (let i = -h; i < w + h; i += 9) { g.moveTo(x + i, y + h + 2); g.lineTo(x + i + h + 4, y - 2); }
  g.stroke();
  g.restore();
}

function deckTextures(map: GameMap, lay: Layout) {
  const P = Math.max(24, Math.min(44, Math.floor(2900 / lay.w))), W = Math.ceil(lay.w * P), H = Math.ceil(lay.d * P), r = rng(1337);
  const [col, a] = canvas(W, H), [hgt, hh] = canvas(W, H), [rgh, rr] = canvas(W, H), [met, mm] = canvas(W, H);
  a.fillStyle = '#0a0908'; a.fillRect(0, 0, W, H);
  hh.fillStyle = grey(0.3); hh.fillRect(0, 0, W, H);
  rr.fillStyle = grey(0.85); rr.fillRect(0, 0, W, H);
  mm.fillStyle = grey(0.3); mm.fillRect(0, 0, W, H);
  const R = HEX_SIZE * P, S = P / 40; // tile circumradius in pixels; detail scale
  const fillHex = (g: Ctx, x: number, y: number, rad: number, s: string) => { g.fillStyle = s; hexPath(g, x, y, rad); g.fill(); };
  const strokeHex = (g: Ctx, x: number, y: number, rad: number, w: number, s: string) => { g.strokeStyle = s; g.lineWidth = w; hexPath(g, x, y, rad); g.stroke(); };
  const bolt = (x: number, y: number, rad: number) => {
    a.fillStyle = '#0b0a09'; a.beginPath(); a.arc(x, y, rad, 0, 7); a.fill();
    a.fillStyle = 'rgba(190,184,170,0.4)'; a.beginPath(); a.arc(x - rad * 0.25, y - rad * 0.25, rad * 0.42, 0, 7); a.fill();
    hh.fillStyle = grey(0.92); hh.beginPath(); hh.arc(x, y, rad * 1.1, 0, 7); hh.fill();
    rr.fillStyle = grey(0.25); rr.beginPath(); rr.arc(x, y, rad * 1.1, 0, 7); rr.fill();
  };
  const ring = (x: number, y: number, rad: number, n: number, size: number, turn = 0) => {
    for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2 - Math.PI / 2 + turn; bolt(x + Math.cos(t) * rad, y + Math.sin(t) * rad, size); }
  };

  for (const t of lay.tiles) {
    const x = (t.x - lay.x0) * P, y = (t.z - lay.z0) * P, v = 0.92 + r() * 0.15, kind = r(), d = r();
    if (t.kind === ROAD) {
      const k = 0.85 + r() * 0.25;
      fillHex(a, x, y, R + 1, `rgb(${(27 * k) | 0},${(25 * k) | 0},${(23 * k) | 0})`);
      fillHex(hh, x, y, R + 1, grey(0.4)); fillHex(rr, x, y, R + 1, grey(0.74 + r() * 0.1)); fillHex(mm, x, y, R + 1, grey(0.3));
      strokeHex(a, x, y, R * 0.9, 1.2 * S, 'rgba(0,0,0,0.35)'); strokeHex(hh, x, y, R * 0.9, 2 * S, grey(0.3));
      continue;
    }
    if (t.kind === SKIRT) {
      fillHex(a, x, y, R + 1, `rgb(${(30 * v) | 0},${(28 * v) | 0},${(26 * v) | 0})`);
      fillHex(hh, x, y, R + 1, grey(0.5)); fillHex(hh, x, y, R * 0.86, grey(0.42));
      fillHex(rr, x, y, R + 1, grey(0.64 + r() * 0.2)); fillHex(mm, x, y, R + 1, grey(0.6));
      strokeHex(a, x, y, R * 0.86, 1.5 * S, 'rgba(0,0,0,0.5)');
      if (d < 0.3) for (let i = -2; i <= 2; i++) { a.fillStyle = '#050505'; a.fillRect(x - R * 0.4, y + i * 6 * S - 1.5 * S, R * 0.8, 3 * S); hh.fillStyle = grey(0.15); hh.fillRect(x - R * 0.4, y + i * 6 * S - 1.5 * S, R * 0.8, 3 * S); }
      continue;
    }
    let cr = 66, cg = 64, cb = 63, metal = 0.5;
    if (kind < 0.09) { cr = 57; cg = 56; cb = 58; } else if (kind < 0.17) { cr = 76; cg = 67; cb = 57; metal = 0.45; } else if (kind < 0.23) { cr = 58; cg = 62; cb = 63; }
    if (t.kind === PAD) { cr = 84; cg = 79; cb = 72; metal = 0.85; }
    if (t.kind === BLOCKED) { cr = 27; cg = 24; cb = 22; metal = 0.3; }
    if (t.kind === UNDER) { cr = 44; cg = 43; cb = 43; }
    fillHex(a, x, y, R + 1, `rgb(${(cr * v) | 0},${(cg * v) | 0},${(cb * v) | 0})`);
    // machined edge: lit on the faces that look toward the moon, dark on the others
    a.lineWidth = 1.4 * S;
    for (let i = 0; i < 6; i++) {
      const c0 = HEX_CORNERS[i], c1 = HEX_CORNERS[(i + 1) % 6], k = 0.925 * P;
      a.strokeStyle = i >= 3 ? 'rgba(255,250,240,0.1)' : 'rgba(0,0,0,0.42)';
      a.beginPath(); a.moveTo(x + c0[0] * k, y + c0[1] * k); a.lineTo(x + c1[0] * k, y + c1[1] * k); a.stroke();
    }
    fillHex(hh, x, y, R + 1, grey(0.5)); fillHex(hh, x, y, R * 0.925, grey(t.kind === PAD ? 0.74 : 0.64 + r() * 0.06));
    fillHex(rr, x, y, R + 1, grey(0.6 + r() * 0.2)); strokeHex(rr, x, y, R * 0.925, 2.2 * S, grey(0.38));
    fillHex(mm, x, y, R + 1, grey(metal));
    if (t.kind === PAD) {
      strokeHex(a, x, y, R * 0.7, 1.6 * S, 'rgba(0,0,0,0.5)'); strokeHex(hh, x, y, R * 0.7, 2.4 * S, grey(0.4));
      ring(x, y, R * 0.82, 12, 1.5 * S, Math.PI / 12);
      continue;
    }
    if (t.kind === BLOCKED) {
      // scorched and cracked: a burn, a sunken fragment, jagged cracks to the edge
      // a hazard-hatched collar round a dead, sunken plate: reads as no-build even with nothing standing on it
      a.save(); hexPath(a, x, y, R * 0.9); a.clip(); hazard(a, x - R, y - R, R * 2, R * 2, 0.62); a.restore();
      fillHex(a, x, y, R * 0.7, 'rgb(22,20,18)'); fillHex(hh, x, y, R * 0.7, grey(0.5)); fillHex(rr, x, y, R * 0.925, grey(0.9));
      strokeHex(a, x, y, R * 0.7, 1.6 * S, 'rgba(0,0,0,0.7)'); strokeHex(hh, x, y, R * 0.7, 2.4 * S, grey(0.3));
      const t0 = r() * 6.28;
      for (const [g, s] of [[a, 'rgba(24,21,20,0.9)'], [hh, grey(0.42)], [rr, grey(0.9)]] as [Ctx, string][]) {
        g.fillStyle = s; g.beginPath(); g.moveTo(x, y);
        g.lineTo(x + Math.cos(t0) * R * 0.86, y + Math.sin(t0) * R * 0.86); g.lineTo(x + Math.cos(t0 + 0.6) * R * 0.8, y + Math.sin(t0 + 0.6) * R * 0.8); g.lineTo(x + Math.cos(t0 + 1.2) * R * 0.86, y + Math.sin(t0 + 1.2) * R * 0.86);
        g.closePath(); g.fill();
      }
      for (let c = 0; c < 5; c++) {
        let px = x + (r() - 0.5) * R * 0.3, py = y + (r() - 0.5) * R * 0.3, ang = t0 + c * 1.26 + r() * 0.5;
        a.strokeStyle = '#050404'; a.lineWidth = (1 + r() * 1.6) * S; hh.strokeStyle = grey(0.1); hh.lineWidth = (2 + r() * 2) * S; rr.strokeStyle = grey(0.95); rr.lineWidth = 2 * S;
        a.beginPath(); hh.beginPath(); rr.beginPath(); a.moveTo(px, py); hh.moveTo(px, py); rr.moveTo(px, py);
        for (let k = 0; k < 6; k++) { ang += (r() - 0.5) * 1.1; px += Math.cos(ang) * R * 0.17; py += Math.sin(ang) * R * 0.17; a.lineTo(px, py); hh.lineTo(px, py); rr.lineTo(px, py); }
        a.stroke(); hh.stroke(); rr.stroke();
      }
      continue;
    }
    if (t.kind === UNDER) { // no-build plate under a raised road: hazard collar
      a.save(); hexPath(a, x, y, R * 0.86); a.lineWidth = 5 * S; a.strokeStyle = 'rgba(12,11,10,0.8)'; a.stroke(); a.setLineDash([6 * S, 6 * S]); a.strokeStyle = 'rgba(206,150,60,0.42)'; a.stroke(); a.restore();
      continue;
    }
    ring(x, y, R * 0.8, 6, 1.6 * S);
    if (d < 0.1) { // inset access hatch
      strokeHex(a, x, y, R * 0.46, 1.8 * S, 'rgba(0,0,0,0.6)'); strokeHex(hh, x, y, R * 0.46, 2.6 * S, grey(0.3));
      a.fillStyle = 'rgba(0,0,0,0.5)'; a.fillRect(x - 5 * S, y + R * 0.2, 10 * S, 2.5 * S);
    } else if (d < 0.18) { // vent slots
      for (let i = -2; i <= 2; i++) {
        const w = R * (0.56 - Math.abs(i) * 0.07);
        a.fillStyle = '#060505'; a.fillRect(x - w, y + i * 6.5 * S - 1.5 * S, w * 2, 3 * S);
        hh.fillStyle = grey(0.15); hh.fillRect(x - w, y + i * 6.5 * S - 1.5 * S, w * 2, 3 * S);
        rr.fillStyle = grey(0.9); rr.fillRect(x - w, y + i * 6.5 * S - 1.5 * S, w * 2, 3 * S);
      }
    } else if (d < 0.27) { // stencilled plate id
      a.fillStyle = 'rgba(222,214,190,0.26)'; a.font = `600 ${Math.round(10 * S)}px monospace`; a.textAlign = 'center';
      a.fillText(String.fromCharCode(65 + (((t.cz % 26) + 26) % 26)) + '-' + String(t.cx + 1).padStart(2, '0'), x, y + R * 0.5);
    } else if (d < 0.32) { // worn hazard edging along the lower edge
      a.save(); hexPath(a, x, y, R * 0.9); a.clip(); hazard(a, x - R, y + R * 0.52, R * 2, 6 * S, 0.5); a.restore();
    } else if (d < 0.38) { // weld / repair seam
      a.strokeStyle = 'rgba(0,0,0,0.35)'; a.lineWidth = 1.8 * S; hh.strokeStyle = grey(0.8); hh.lineWidth = 2 * S;
      const y0 = y + (r() - 0.5) * R * 0.8, y1 = y + (r() - 0.5) * R * 0.8;
      a.beginPath(); a.moveTo(x - R * 0.7, y0); a.lineTo(x + R * 0.7, y1); a.stroke(); hh.beginPath(); hh.moveTo(x - R * 0.7, y0); hh.lineTo(x + R * 0.7, y1); hh.stroke();
    } else if (d < 0.5) { // inner panel line
      strokeHex(a, x, y, R * 0.66, 1.1 * S, 'rgba(0,0,0,0.3)'); strokeHex(hh, x, y, R * 0.66, 1.8 * S, grey(0.45));
    }
  }

  // ---- roadway on the deck (raised stretches are real geometry) ----
  const runs: number[][][] = [];
  for (const lane of map.lanes) {
    let run: number[][] | null = null;
    for (let i = 1; i < lane.pts.length; i++) {
      if (lane.ys[i - 1] > 0.01 || lane.ys[i] > 0.01) { run = null; continue; }
      if (!run) { run = [[(lane.pts[i - 1][0] - lay.x0) * P, (lane.pts[i - 1][1] - lay.z0) * P]]; runs.push(run); }
      run.push([(lane.pts[i][0] - lay.x0) * P, (lane.pts[i][1] - lay.z0) * P]);
    }
  }
  const stroke = (g: Ctx, w: number, style: string, dash: number[] = []) => {
    g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = w; g.strokeStyle = style; g.setLineDash(dash);
    for (const pts of runs) {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    }
    g.setLineDash([]);
  };
  const RW = 1.5 * P;
  stroke(a, RW + 7 * S, '#4a4640'); stroke(hh, RW + 7 * S, grey(0.62)); stroke(rr, RW + 7 * S, grey(0.3)); stroke(mm, RW + 7 * S, grey(0.9)); // steel kerb
  stroke(a, RW, '#1d1b19'); stroke(hh, RW, grey(0.3)); stroke(rr, RW, grey(0.8)); stroke(mm, RW, grey(0.05));
  stroke(a, RW - 9 * S, '#232120');
  stroke(a, P * 0.8, 'rgba(255,255,255,0.035)'); stroke(rr, P * 0.8, 'rgba(110,110,110,0.55)'); // worn centre track
  a.lineCap = 'butt'; stroke(a, 2 * S, 'rgba(227,220,146,0.2)', [10 * S, 17 * S]);
  // direction chevrons on the long stretches
  a.lineWidth = 3.2 * S; a.strokeStyle = 'rgba(206,107,68,0.42)'; a.lineJoin = 'miter'; a.lineCap = 'butt';
  for (const pts of runs) for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay);
    if (L < P * 5.5) continue;
    const dx = (bx - ax) / L, dy = (by - ay) / L, mx = (ax + bx) / 2, my = (ay + by) / 2;
    for (let k = -1; k <= 1; k++) {
      const px = mx + dx * k * 9 * S, py = my + dy * k * 9 * S;
      a.beginPath(); a.moveTo(px - dx * 6 * S - dy * 11 * S, py - dy * 6 * S + dx * 11 * S); a.lineTo(px + dx * 6 * S, py + dy * 6 * S); a.lineTo(px - dx * 6 * S + dy * 11 * S, py - dy * 6 * S - dx * 11 * S); a.stroke();
    }
  }

  // ---- core pad markings across the seven tiles ----
  const kx = (map.core.x - lay.x0) * P, ky = (map.core.z - lay.z0) * P;
  const circ = (g: Ctx, rad: number, w: number, s: string, dash: number[] = []) => { g.strokeStyle = s; g.lineWidth = w; g.setLineDash(dash); g.beginPath(); g.arc(kx, ky, rad, 0, 7); g.stroke(); g.setLineDash([]); };
  circ(a, P * 2.25, 7 * S, 'rgba(14,13,11,0.7)'); circ(a, P * 2.25, 7 * S, 'rgba(206,150,60,0.5)', [9 * S, 9 * S]);
  circ(a, P * 1.5, 2 * S, '#060505'); circ(hh, P * 1.5, 3 * S, grey(0.3));
  circ(a, P * 1.32, 1.6 * S, 'rgba(227,220,146,0.3)');

  // ---- weathering over everything ----
  const blot = (g: Ctx, x: number, y: number, rad: number, rgb: string, al: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${rgb},${al})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  for (let i = 0; i < 150; i++) blot(a, r() * W, r() * H, (30 + r() * r() * 240) * S, '0,0,0', 0.03 + r() * 0.05);
  for (let i = 0; i < 70; i++) blot(a, r() * W, r() * H, (20 + r() * 90) * S, '112,78,52', 0.05 + r() * 0.08);   // rust / dust bloom
  for (let i = 0; i < 80; i++) { // oil / damp patches: darker and much smoother, they pick up the rim light
    const x = r() * W, y = r() * H, rad = (26 + r() * r() * 150) * S;
    blot(rr, x, y, rad, '70,70,70', 0.6); blot(a, x, y, rad, '0,0,0', 0.06);
  }
  for (let i = 0; i < 90; i++) blot(rr, r() * W, r() * H, (40 + r() * 160) * S, '235,235,235', 0.35);            // dusty, rough
  for (let i = 0; i < 650; i++) {
    const x = r() * W, y = r() * H, t = r() * 7, L = (8 + r() * r() * 110) * S, al = 0.04 + r() * 0.09;
    a.strokeStyle = `rgba(214,208,196,${al})`; a.lineWidth = 0.6 + r();
    a.beginPath(); a.moveTo(x, y); a.lineTo(x + Math.cos(t) * L, y + Math.sin(t) * L); a.stroke();
    rr.strokeStyle = 'rgba(60,60,60,0.5)'; rr.lineWidth = 1;
    rr.beginPath(); rr.moveTo(x, y); rr.lineTo(x + Math.cos(t) * L, y + Math.sin(t) * L); rr.stroke();
  }
  const grit = noiseCanvas(256, 11), cloud = cloudCanvas(256, 5);
  for (const [g, al, cl] of [[a, 0.4, 0.16], [rr, 0.35, 0.4], [hh, 0.1, 0]] as [Ctx, number, number][]) {
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = al; g.fillStyle = g.createPattern(grit, 'repeat')!; g.fillRect(0, 0, W, H);
    if (cl) { g.globalAlpha = cl; g.imageSmoothingEnabled = true; g.drawImage(cloud, 0, 0, W, H); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  const tex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const rm = tex(packRM(rgh, met), false);
  return { map: tex(col, true), normalMap: tex(normalFromHeight(hgt, 3.0 * S), false), roughnessMap: rm, metalnessMap: rm };
}

// ---------- geometry helpers ----------
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
/** Flat-shaded triangle soup with a colour per vertex. */
class Soup {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; uv: number[] = [];
  tri(a: number[], b: number[], c: number[], shade: number, up?: number[]) {
    V1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); V2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); V3.crossVectors(V1, V2).normalize();
    if (up && V3.x * up[0] + V3.y * up[1] + V3.z * up[2] < 0) { const t = b; b = c; c = t; V3.negate(); }
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(V3.x, V3.y, V3.z); this.col.push(shade, shade, shade); this.uv.push(p[3] || 0, p[4] || 0); }
  }
  quad(a: number[], b: number[], c: number[], d: number[], shade: number, up?: number[]) { this.tri(a, b, c, shade, up); this.tri(a, c, d, shade, up); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}
const TMP_C = new THREE.Color();
/** Give a stock geometry a flat vertex colour and make it mergeable with the others. */
function paint(g: THREE.BufferGeometry, color: number, k = 1): THREE.BufferGeometry {
  const o = g.index ? g.toNonIndexed() : g, n = o.attributes.position.count, ca = new Float32Array(n * 3);
  TMP_C.set(color).multiplyScalar(k);
  for (let i = 0; i < n; i++) { ca[i * 3] = TMP_C.r; ca[i * 3 + 1] = TMP_C.g; ca[i * 3 + 2] = TMP_C.b; }
  o.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  return o;
}
/** Upright hex prism aligned with the tiles (corners toward +z and -z), base at y0. */
const hexPrism = (rTop: number, rBot: number, h: number, x: number, y0: number, z: number) => new THREE.CylinderGeometry(rTop, rBot, h, 6).translate(x, y0 + h / 2, z);

/** One deck tile: top face, bevel, wall, and a dark flange that closes the gap to the neighbours. */
function tileGeometry() {
  const s = new Soup(), UP = [0, 1, 0];
  const rt = 0.955, rb = 0.985, rf = 1.02, yb = -0.035, yf = -0.13;
  for (let i = 0; i < 6; i++) {
    const c0 = HEX_CORNERS[i], c1 = HEX_CORNERS[(i + 1) % 6], out = [c0[0] + c1[0], 0.4, c0[1] + c1[1]];
    s.tri([0, 0, 0], [c0[0] * rt, 0, c0[1] * rt], [c1[0] * rt, 0, c1[1] * rt], 1, UP);
    s.quad([c0[0] * rt, 0, c0[1] * rt], [c1[0] * rt, 0, c1[1] * rt], [c1[0] * rb, yb, c1[1] * rb], [c0[0] * rb, yb, c0[1] * rb], 0.9, out);
    s.quad([c0[0] * rb, yb, c0[1] * rb], [c1[0] * rb, yb, c1[1] * rb], [c1[0] * rb, -TILE_DEPTH, c1[1] * rb], [c0[0] * rb, -TILE_DEPTH, c0[1] * rb], 0.34, out);
    s.quad([c0[0] * rb, yf, c0[1] * rb], [c1[0] * rb, yf, c1[1] * rb], [c1[0] * rf, yf, c1[1] * rf], [c0[0] * rf, yf, c0[1] * rf], 0.1, UP);
  }
  return s.geo();
}

// ---------- raised roads: ramps, bridge decks, pillars ----------
function roadTexture() {
  const S = 256, r = rng(77), [c, a] = canvas(S, S);
  a.fillStyle = '#211f1d'; a.fillRect(0, 0, S, S);
  a.fillStyle = 'rgba(255,255,255,0.03)'; a.fillRect(S * 0.25, 0, S * 0.5, S);
  for (let i = 0; i < 4; i++) { a.fillStyle = 'rgba(0,0,0,0.5)'; a.fillRect(0, i * 64, S, 2); a.fillStyle = 'rgba(255,255,255,0.05)'; a.fillRect(0, i * 64 + 2, S, 1); } // plate joints
  a.fillStyle = 'rgba(227,220,146,0.22)'; for (let i = 0; i < 4; i++) a.fillRect(S / 2 - 1.5, i * 64 + 16, 3, 26);
  for (let i = 0; i < 160; i++) { const x = r() * S, y = r() * S, L = 6 + r() * 50; a.strokeStyle = `rgba(210,205,195,${0.03 + r() * 0.07})`; a.lineWidth = 0.6 + r(); a.beginPath(); a.moveTo(x, y); a.lineTo(x + (r() - 0.5) * 8, y + L); a.stroke(); }
  a.globalCompositeOperation = 'overlay'; a.globalAlpha = 0.45; a.fillStyle = a.createPattern(noiseCanvas(128, 31), 'repeat')!; a.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function buildStructures(map: GameMap, lay: Layout) {
  const top = new Soup(), st = new Soup(), parts: THREE.BufferGeometry[] = [];
  const UP = [0, 1, 0], DOWN = [0, -1, 0];
  const STEEL = 0x5e5a55, DARK = 0x3a3734;
  const q = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), dv = new THREE.Vector3();
  const beam = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number, h: number, color: number) => {
    dv.set(x1 - x0, y1 - y0, z1 - z0); const L = dv.length(); if (L < 1e-3) return;
    q.setFromUnitVectors(X, dv.normalize());
    parts.push(paint(new THREE.BoxGeometry(L, h, w).applyQuaternion(q).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color));
  };
  const pillars = new Set<number>();
  const pillar = (x: number, z: number, y: number) => {
    cellOf(x, z);
    const k = key(CX, CZ), low = lay.roadMin.get(k);
    if (y < 0.9 || pillars.has(k) || (low !== undefined && low < y - 1)) return; // never stand a pillar on a road passing underneath
    pillars.add(k);
    const b = surf(y) - 0.3;
    parts.push(paint(hexPrism(0.4, 0.46, b - 0.16, x, 0, z), STEEL), paint(hexPrism(0.82, 0.46, 0.18, x, b - 0.18, z), STEEL, 0.9), paint(hexPrism(0.6, 0.72, 0.14, x, 0, z), DARK));
  };
  for (const lane of map.lanes) {
    let along = 0;
    for (let i = 1; i < lane.pts.length; i++) {
      const a = lane.pts[i - 1], b = lane.pts[i], ya = lane.ys[i - 1], yb = lane.ys[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-3) continue;
      const v0 = along / (ROAD_HALF * 2); along += L; const v1 = along / (ROAD_HALF * 2);
      if (ya < 0.01 && yb < 0.01) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, nx = -dz, nz = dx;
      const sa = surf(ya), sb = surf(yb), ba = Math.max(-0.1, sa - 0.3), bb = Math.max(-0.1, sb - 0.3);
      const P = (end: number, l: number, y: number, u = 0, v = 0) => (end ? [b[0] + nx * l, y, b[1] + nz * l, u, v] : [a[0] + nx * l, y, a[1] + nz * l, u, v]);
      top.quad(P(0, -ROAD_HALF, sa, 0, v0), P(0, ROAD_HALF, sa, 1, v0), P(1, ROAD_HALF, sb, 1, v1), P(1, -ROAD_HALF, sb, 0, v1), 1, UP);
      for (const s of [-1, 1]) {
        const li = ROAD_HALF * s, lo = (ROAD_HALF + KERB_W) * s, side = [nx * s, 0, nz * s];
        st.quad(P(0, li, sa + 0.1), P(0, lo, sa + 0.1), P(1, lo, sb + 0.1), P(1, li, sb + 0.1), 0.4, UP);        // kerb top
        st.quad(P(0, li, sa), P(0, li, sa + 0.1), P(1, li, sb + 0.1), P(1, li, sb), 0.3, [-side[0], 0, -side[2]]); // kerb inner face
        st.quad(P(0, lo, sa + 0.1), P(0, lo, ba), P(1, lo, bb), P(1, lo, sb + 0.1), 0.33, side);                   // outer side
      }
      st.quad(P(0, -ROAD_HALF - KERB_W, ba), P(0, ROAD_HALF + KERB_W, ba), P(1, ROAD_HALF + KERB_W, bb), P(1, -ROAD_HALF - KERB_W, bb), 0.2, DOWN);
      // railing and girders where the road is high enough to fall from
      const yAt = (u: number) => ya + (yb - ya) * u;
      let u0 = 0, u1 = 1;
      if (ya < 0.7 && yb < 0.7) u1 = -1;
      else if (ya < 0.7) u0 = (0.7 - ya) / (yb - ya);
      else if (yb < 0.7) u1 = (0.7 - ya) / (yb - ya);
      if (u1 > u0) {
        const X0 = a[0] + (b[0] - a[0]) * u0, Z0 = a[1] + (b[1] - a[1]) * u0, X1 = a[0] + (b[0] - a[0]) * u1, Z1 = a[1] + (b[1] - a[1]) * u1, s0 = surf(yAt(u0)), s1 = surf(yAt(u1));
        for (const s of [-1, 1]) {
          const l = (ROAD_HALF + KERB_W * 0.5) * s;
          beam(X0 + nx * l, s0 + 0.62, Z0 + nz * l, X1 + nx * l, s1 + 0.62, Z1 + nz * l, 0.06, 0.05, STEEL);
          beam(X0 + nx * l, s0 + 0.36, Z0 + nz * l, X1 + nx * l, s1 + 0.36, Z1 + nz * l, 0.03, 0.03, DARK);
          beam(X0 + nx * s * 0.5, s0 - 0.4, Z0 + nz * s * 0.5, X1 + nx * s * 0.5, s1 - 0.4, Z1 + nz * s * 0.5, 0.14, 0.2, DARK);
          const n = Math.max(1, Math.round(((u1 - u0) * L) / 1)), tl = (u1 - u0) / n;
          for (let k = 0; k <= n; k++) {
            const u = u0 + tl * k, x = a[0] + (b[0] - a[0]) * u + nx * l, z = a[1] + (b[1] - a[1]) * u + nz * l, y = surf(yAt(u));
            parts.push(paint(new THREE.BoxGeometry(0.05, 0.56, 0.05).translate(x, y + 0.36, z), STEEL));
          }
        }
      }
      const steps = Math.round(L / CELL);
      for (let k = 0; k <= steps; k++) { const u = steps ? k / steps : 0; pillar(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, yAt(u)); }
    }
    // hex landings where a raised road turns
    for (let i = 0; i < lane.pts.length; i++) {
      const y = lane.ys[i];
      if (y < 0.05 || i === lane.pts.length - 1) continue;
      const g = paint(hexPrism(HEX_SIZE * 0.98, HEX_SIZE * 0.9, 0.3, lane.pts[i][0], surf(y) - 0.312, lane.pts[i][1]), 0x211f1d);
      parts.push(g);
      if (i > 0) parts.push(paint(new THREE.TorusGeometry(HEX_SIZE * 0.93, 0.05, 4, 6).rotateX(Math.PI / 2).rotateY(Math.PI / 6).translate(lane.pts[i][0], surf(y) + 0.62, lane.pts[i][1]), STEEL));
    }
  }
  if (!top.pos.length) return null;
  if (st.pos.length) { const g = st.geo(); const c = g.attributes.color as THREE.BufferAttribute; for (let i = 0; i < c.array.length; i++) (c.array as Float32Array)[i] *= 0.9; parts.push(g); }
  for (const g of parts) if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return { top: top.geo(), steel: mergeGeometries(parts) };
}

/** LED kerb strips along every road (deck level and raised), plus the outline of the core pad. aD = 0 at the gate, 1 at the core. */
function buildLeds(map: GameMap, lay: Layout) {
  const pos: number[] = [], aD: number[] = [], aS: number[] = [];
  const W = 0.03;
  const quad = (p0: number[], p1: number[], q0: number[], q1: number[], d0: number, d1: number, s0: number, s1: number) => {
    // p = inner edge, q = outer edge of the strip at the two ends
    pos.push(p0[0], p0[1], p0[2], q0[0], q0[1], q0[2], q1[0], q1[1], q1[2], p0[0], p0[1], p0[2], q1[0], q1[1], q1[2], p1[0], p1[1], p1[2]);
    aD.push(d0, d0, d1, d0, d1, d1); aS.push(s0, s0, s1, s0, s1, s1);
  };
  for (const lane of map.lanes) {
    const n = lane.pts.length;
    for (const s of [-1, 1]) {
      // offset path: [x, y, z, dist]; inner corners are mitred, outer corners rounded like the painted road
      const path: number[][] = [];
      for (let i = 0; i < n; i++) {
        const p = lane.pts[i], y = surf(lane.ys[i]) + 0.012, d = lane.cum[i];
        const up = lane.ys[i] > 0.01 || (i > 0 && lane.ys[i - 1] > 0.01) || (i < n - 1 && lane.ys[i + 1] > 0.01), KERB = up ? KERB_UP : KERB_DECK;
        const dirIn = i > 0 ? Math.atan2(p[1] - lane.pts[i - 1][1], p[0] - lane.pts[i - 1][0]) : NaN;
        const dirOut = i < n - 1 ? Math.atan2(lane.pts[i + 1][1] - p[1], lane.pts[i + 1][0] - p[0]) : NaN;
        const a0 = Number.isNaN(dirIn) ? dirOut : dirIn, a1 = Number.isNaN(dirOut) ? dirIn : dirOut;
        let turn = a1 - a0; while (turn > Math.PI) turn -= Math.PI * 2; while (turn < -Math.PI) turn += Math.PI * 2;
        const na = a0 + (s * Math.PI) / 2;
        if (Math.abs(turn) < 1e-3) path.push([p[0] + Math.cos(na) * KERB, y, p[1] + Math.sin(na) * KERB, d]);
        else if (turn * s > 0) { // inner side
          const m = na + turn / 2, k = KERB / Math.cos(turn / 2);
          path.push([p[0] + Math.cos(m) * k, y, p[1] + Math.sin(m) * k, d]);
        } else for (let k = 0; k <= 5; k++) { const t = na + (turn * k) / 5; path.push([p[0] + Math.cos(t) * KERB, y, p[1] + Math.sin(t) * KERB, d]); }
      }
      for (let i = 1; i < path.length; i++) {
        const p0 = path[i - 1], p1 = path[i], L = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) || 1, ox = (-(p1[2] - p0[2]) / L) * W * s, oz = ((p1[0] - p0[0]) / L) * W * s;
        quad([p0[0] - ox, p0[1], p0[2] - oz], [p1[0] - ox, p1[1], p1[2] - oz], [p0[0] + ox, p0[1], p0[2] + oz], [p1[0] + ox, p1[1], p1[2] + oz], p0[3] / lane.len, p1[3] / lane.len, p0[3], p1[3]);
      }
    }
  }
  // outline of the seven-tile core pad
  for (const t of lay.tiles) if (t.kind === PAD) for (let i = 0; i < 6; i++) {
    const nb = neighbor(t.cx, t.cz, (i + 5) % 6), j = inKey(nb[0], nb[1]) ? lay.lut[key(nb[0], nb[1])] : -1;
    if (j >= 0 && lay.tiles[j].kind === PAD) continue;
    const c0 = HEX_CORNERS[i], c1 = HEX_CORNERS[(i + 1) % 6];
    quad([t.x + c0[0] * 0.84, 0.012, t.z + c0[1] * 0.84], [t.x + c1[0] * 0.84, 0.012, t.z + c1[1] * 0.84], [t.x + c0[0] * 0.89, 0.012, t.z + c0[1] * 0.89], [t.x + c1[0] * 0.89, 0.012, t.z + c1[1] * 0.89], 1, 1, 0.5, 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aD', new THREE.Float32BufferAttribute(aD, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  return g;
}

/** Thin light line under the lip of the platform, following the hex outline. */
function buildEdge(lay: Layout) {
  const pos: number[] = [];
  for (const t of lay.tiles) {
    if (t.kind === SKIRT) continue;
    for (let i = 0; i < 6; i++) {
      const nb = neighbor(t.cx, t.cz, (i + 5) % 6), j = inKey(nb[0], nb[1]) ? lay.lut[key(nb[0], nb[1])] : -1;
      if (j >= 0 && lay.tiles[j].kind !== SKIRT) continue;
      const c0 = HEX_CORNERS[i], c1 = HEX_CORNERS[(i + 1) % 6], k = 0.992, x0 = t.x + c0[0] * k, z0 = t.z + c0[1] * k, x1 = t.x + c1[0] * k, z1 = t.z + c1[1] * k;
      pos.push(x0, -0.2, z0, x1, -0.2, z1, x1, -0.15, z1, x0, -0.2, z0, x1, -0.15, z1, x0, -0.15, z0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ---------- district ----------
const hash2 = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Distance from the platform footprint (0 inside). */
const HX = BOARD_W / 2 + 2, HZ = BOARD_D / 2 + 2;
const dBox = (x: number, z: number) => Math.hypot(Math.max(Math.abs(x) - HX, 0), Math.max(Math.abs(z) - HZ, 0));

/** Hex paving that repeats seamlessly (two columns by two rows of slabs). */
function pavingTextures(world: number) {
  const W = 512, r = rng(99);
  const size = W / 2 / Math.sqrt(3), PH = size * 3; // slab circumradius; vertical period
  const HH = Math.round(PH);
  const [col, a] = canvas(W, HH), [hgt, hh] = canvas(W, HH), [rgh, rr] = canvas(W, HH), [met, mm] = canvas(W, HH);
  a.fillStyle = '#0b0a09'; a.fillRect(0, 0, W, HH);
  hh.fillStyle = grey(0.1); hh.fillRect(0, 0, W, HH);
  rr.fillStyle = grey(0.95); rr.fillRect(0, 0, W, HH);
  mm.fillStyle = grey(0.1); mm.fillRect(0, 0, W, HH);
  const tones = [0.8 + r() * 0.3, 0.8 + r() * 0.3, 0.8 + r() * 0.3, 0.8 + r() * 0.3];
  for (let row = 0; row <= 2; row++) for (let c = 0; c <= 2; c++) {
    const x = c * (W / 2) + (row & 1 ? W / 4 : 0), y = row * PH / 2, k = tones[(row & 1) * 2 + (c & 1)];
    a.fillStyle = `rgb(${(30 * k) | 0},${(27 * k) | 0},${(25 * k) | 0})`; hexPath(a, x, y, size - 3); a.fill();
    hh.fillStyle = grey(0.55 + k * 0.1); hexPath(hh, x, y, size - 3); hh.fill();
    hh.fillStyle = grey(0.62 + k * 0.1); hexPath(hh, x, y, size - 9); hh.fill();
    rr.fillStyle = grey(0.86); hexPath(rr, x, y, size - 3); rr.fill();
  }
  for (let i = 0; i < 7; i++) { // damp patches, kept off the border so the repeat stays seamless
    const x = 110 + r() * 292, y = 90 + r() * (HH - 180), rad = 40 + r() * 50;
    const gr = rr.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(50,50,50,0.7)'); gr.addColorStop(1, 'rgba(50,50,50,0)');
    rr.fillStyle = gr; rr.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const grit = noiseCanvas(256, 23);
  for (const [g, al] of [[a, 0.5], [rr, 0.45], [hh, 0.2]] as [Ctx, number][]) { g.globalCompositeOperation = 'overlay'; g.globalAlpha = al; g.fillStyle = g.createPattern(grit, 'repeat')!; g.fillRect(0, 0, W, HH); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(900 / (2 * world), 900 / (Math.sqrt(3) * world)); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const rm = tex(packRM(rgh, met), false);
  return { map: tex(col, true), normalMap: tex(normalFromHeight(hgt, 2.6, true), false), roughnessMap: rm, metalnessMap: rm };
}

/** Top of a basalt column: one slab, darker toward the rim, a few cracks. */
function slabTextures() {
  const S = 256, r = rng(51), [col, a] = canvas(S, S), [hgt, hh] = canvas(S, S);
  a.fillStyle = '#6a645e'; a.fillRect(0, 0, S, S);
  hh.fillStyle = grey(0.6); hh.fillRect(0, 0, S, S);
  const gr = a.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.52); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  a.fillStyle = gr; a.fillRect(0, 0, S, S);
  for (let i = 0; i < 7; i++) {
    let x = 40 + r() * 176, y = 40 + r() * 176, t = r() * 7;
    a.strokeStyle = 'rgba(0,0,0,0.5)'; a.lineWidth = 1.2; hh.strokeStyle = grey(0.25); hh.lineWidth = 2;
    a.beginPath(); hh.beginPath(); a.moveTo(x, y); hh.moveTo(x, y);
    for (let k = 0; k < 7; k++) { t += (r() - 0.5) * 1.3; x += Math.cos(t) * 16; y += Math.sin(t) * 16; a.lineTo(x, y); hh.lineTo(x, y); }
    a.stroke(); hh.stroke();
  }
  a.globalCompositeOperation = 'overlay'; a.globalAlpha = 0.55; a.fillStyle = a.createPattern(noiseCanvas(128, 61), 'repeat')!; a.fillRect(0, 0, S, S);
  const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return { map, normalMap: new THREE.CanvasTexture(normalFromHeight(hgt, 2.2)) };
}

/** Basalt-like hex columns stepping down from the platform and up again toward the city. */
function terrain(tileW: number) {
  const rowH = tileW * Math.sqrt(3) / 2, R = tileW / Math.sqrt(3), list: number[] = [];
  for (let row = -26; row <= 26; row++) for (let c = -30; c <= 30; c++) {
    const x = (c + (row & 1 ? 0.5 : 0)) * tileW, z = row * rowH, d = dBox(x, z);
    if (d > 46 || (Math.abs(x) < HX - 6 && Math.abs(z) < HZ - 6)) continue;
    const h = hash2(c * 1.7 + 11, row * 2.3 + 5), n = vnoise(x * 0.035 + 3, z * 0.035 + 7);
    let y: number;
    if (d < 7) y = -1.5 - 0.3 * Math.floor(h * 3);
    else if (d < 15) y = -2.0 - (d - 7) * 0.08 - 0.3 * Math.floor(h * 3);
    else { const t = (d - 15) / 30; y = -2.8 + Math.round((t * (0.3 + n * n * 11) + (h > 0.9 ? 1.6 : 0)) / 0.7) * 0.7; }
    list.push(x, y, z, (0.5 + h * 0.4 + Math.max(0, y + 2) * 0.03) * (0.55 + 0.45 * Math.min(1, d / 14)));
  }
  const g = new THREE.CylinderGeometry(R * 0.985, R * 0.985, 1, 6).translate(0, -0.5, 0);
  const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ ...slabTextures(), color: 0x2e2a27, roughness: 0.93, metalness: 0.05, envMapIntensity: 0.35 }), list.length / 4);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < list.length / 4; i++) {
    m.makeScale(1, 40, 1).setPosition(list[i * 4], list[i * 4 + 1], list[i * 4 + 2]);
    mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.setScalar(list[i * 4 + 3]));
  }
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}

const FACADE = 32; // window cells per atlas side
const MOON = new THREE.Vector3(-30, 40, 20).normalize();
const WARM = new THREE.Vector3(0.62, 0, -0.78).normalize();
function facadeTextures() {
  const S = 512, P = S / FACADE, r = rng(4242);
  const [c, a] = canvas(S, S), [e, b] = canvas(S, S);
  a.fillStyle = '#8f867c'; a.fillRect(0, 0, S, S);
  b.fillStyle = '#000'; b.fillRect(0, 0, S, S);
  // concrete / glass bands, mullions
  for (let y = 0; y < FACADE; y++) {
    a.fillStyle = `rgba(0,0,0,${0.12 + r() * 0.2})`; a.fillRect(0, y * P, S, P);
    a.fillStyle = 'rgba(0,0,0,0.3)'; a.fillRect(0, y * P, S, 2);
    a.fillStyle = 'rgba(255,255,255,0.05)'; a.fillRect(0, y * P + 2, S, 1);
  }
  for (let x = 0; x < FACADE; x++) { a.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.2})`; a.fillRect(x * P, 0, r() < 0.2 ? 4 : 2, S); }
  for (let y = 0; y < FACADE; y++) for (let x = 0; x < FACADE; x++) { a.fillStyle = `rgba(14,11,9,${0.12 + r() * 0.3})`; a.fillRect(x * P + 3, y * P + 5, P - 5, P - 8); }
  // sparse lit windows: mostly dark towers, a few lonely rooms and short lit floor runs, all sodium warm
  const tones = ['#ffd9a8', '#ffc98a', '#ffb872', '#f6a868', '#ffe6c4', '#e3dc92'];
  const light = (x: number, y: number, tone: string, al: number) => {
    if (x === 0 && y === FACADE - 1) return; // the (0,0) uv corner must stay dark: roofs sample it
    b.globalAlpha = al; b.fillStyle = tone; b.fillRect(x * P + 5, y * P + 7, P - 10, P - 12); b.globalAlpha = 1;
    a.globalAlpha = al; a.fillStyle = tone; a.fillRect(x * P + 5, y * P + 7, P - 10, P - 12); a.globalAlpha = 1;
  };
  for (let y = 0; y < FACADE; y++) for (let x = 0; x < FACADE; x++) if (r() < 0.02) light(x, y, tones[Math.floor(r() * tones.length)], 0.35 + r() * 0.65);
  for (let i = 0; i < 22; i++) {
    const y = Math.floor(r() * FACADE), x0 = Math.floor(r() * FACADE), n = 2 + Math.floor(r() * 5), tone = tones[Math.floor(r() * 4)], al = 0.3 + r() * 0.5;
    for (let k = 0; k < n; k++) if (r() < 0.8) light((x0 + k) % FACADE, y, tone, al * (0.6 + r() * 0.4));
  }
  const mk = (cv: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { map: mk(c), emissiveMap: mk(e) };
}

/** Abstract signage: invented glyphs, bars and a hex mark in a frame. White on black, tinted by the material. */
function signTexture(seed: number, w: number, h: number) {
  const r = rng(seed), [c, g] = canvas(w, h);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const vertical = h > w, cell = Math.min(w, h) * 0.62, n = Math.max(2, Math.floor((Math.max(w, h) - cell * 0.5) / (cell * 1.12)));
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(8, 8, w - 16, h - 16);
  g.lineCap = 'square'; g.strokeStyle = '#fff';
  for (let i = 0; i < n; i++) {
    const ox = vertical ? (w - cell) / 2 : 26 + i * cell * 1.12, oy = vertical ? 26 + i * cell * 1.12 : (h - cell) / 2 - (vertical ? 0 : 8);
    g.lineWidth = cell * 0.085;
    if (i === 0) { // hex mark
      hexPath(g, ox + cell / 2, oy + cell / 2, cell * 0.42); g.stroke();
      hexPath(g, ox + cell / 2, oy + cell / 2, cell * 0.16); g.fillStyle = '#fff'; g.fill();
      continue;
    }
    const P = (k: number): [number, number] => [ox + ((k % 3) / 2) * cell * 0.8 + cell * 0.1, oy + (Math.floor(k / 3) / 2) * cell * 0.8 + cell * 0.1];
    const strokes = 3 + Math.floor(r() * 3);
    for (let s = 0; s < strokes; s++) {
      const p0 = Math.floor(r() * 9); let p1 = Math.floor(r() * 9); if (p1 === p0) p1 = (p0 + 3) % 9;
      const [x0, y0] = P(p0), [x1, y1] = P(p1);
      g.beginPath(); g.moveTo(x0, y0);
      if (r() < 0.5) g.lineTo(x1, y0); // orthogonal elbow reads as lettering rather than scribble
      g.lineTo(x1, y1); g.stroke();
    }
  }
  // small print
  g.fillStyle = 'rgba(255,255,255,0.7)';
  const bars = vertical ? 5 : 8;
  for (let i = 0; i < bars; i++) { const bw = 10 + r() * 40; g.fillRect(vertical ? 22 : 26 + i * ((w - 52) / bars), vertical ? h - 30 - i * 9 : h - 30, vertical ? bw : bw * 0.7, 4); }
  // scanlines
  g.fillStyle = 'rgba(0,0,0,0.42)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** The district: hex-footprint towers on a honeycomb lattice, unlit, with the light painted into vertex colours. */
function skyline(haze: THREE.Color, warm: THREE.Color) {
  const rnd = rng(7);
  const pos: number[] = [], uv: number[] = [], col: number[] = [], lights: THREE.BufferGeometry[] = [];
  const BASE = -3;
  /** One hex prism. rot = angle of the first corner; face i looks toward rot + 30 + 60 i degrees. */
  const prism = (R: number, h: number, x: number, y0: number, z: number, rot: number, shade: number, warm: number) => {
    const ou = Math.floor(rnd() * FACADE) / FACADE, ov = Math.floor(rnd() * FACADE) / FACADE;
    const nu = Math.max(1, Math.round(R / 1.5)) / FACADE, nv = Math.max(1, Math.round(h / 2)) / FACADE;
    const tr = shade * (1 + warm * 0.12), tg = shade, tb = shade * (1 - warm * 0.14);
    const push = (px: number, py: number, pz: number, u: number, v: number, k: number, nx: number, ny: number, nz: number) => {
      // cool moon side, warm glow side, everything else falls to a dark silhouette
      const moon = Math.max(0, nx * MOON.x + ny * MOON.y + nz * MOON.z), glow = Math.max(0, nx * WARM.x + nz * WARM.z);
      pos.push(px, py, pz); uv.push(u, v);
      col.push(tr * k * (0.95 + moon * 1.0 + glow * 1.5), tg * k * (0.9 + moon * 1.2 + glow * 0.66), tb * k * (0.92 + moon * 1.6 + glow * 0.2));
    };
    for (let i = 0; i < 6; i++) {
      const a0 = rot + (i * Math.PI) / 3, a1 = a0 + Math.PI / 3, an = a0 + Math.PI / 6, nx = Math.cos(an), nz = Math.sin(an);
      const x0 = x + Math.cos(a0) * R, z0 = z + Math.sin(a0) * R, x1 = x + Math.cos(a1) * R, z1 = z + Math.sin(a1) * R, y1 = y0 + h;
      push(x0, y0, z0, ou, ov, 0.8, nx, 0, nz); push(x1, y1, z1, ou + nu, ov + nv, 1, nx, 0, nz); push(x1, y0, z1, ou + nu, ov, 0.8, nx, 0, nz);
      push(x0, y0, z0, ou, ov, 0.8, nx, 0, nz); push(x0, y1, z0, ou, ov + nv, 1, nx, 0, nz); push(x1, y1, z1, ou + nu, ov + nv, 1, nx, 0, nz);
      push(x, y1, z, 0.004, 0.004, 0.5, 0, 1, 0); push(x1, y1, z1, 0.004, 0.004, 0.5, 0, 1, 0); push(x0, y1, z0, 0.004, 0.004, 0.5, 0, 1, 0);
    }
  };
  const lamp = (g: THREE.BufferGeometry, cr: number, cg: number, cb: number) => {
    const o = g.index ? g.toNonIndexed() : g, ca = new Float32Array(o.attributes.position.count * 3);
    for (let k = 0; k < ca.length; k += 3) { ca[k] = cr; ca[k + 1] = cg; ca[k + 2] = cb; }
    o.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    o.deleteAttribute('uv'); o.deleteAttribute('normal');
    lights.push(o);
  };
  const tower = (x: number, z: number, R: number, h: number, rot: number) => {
    const shade = 0.3 + rnd() * 0.34, warm = (rnd() * 2 - 1) * 0.5 + 0.2;
    prism(R, h - BASE, x, BASE, z, rot, shade, warm);
    let top = h, tr = R;
    const steps = rnd() < 0.6 ? (rnd() < 0.4 ? 2 : 1) : 0;
    for (let s = 0; s < steps; s++) {
      const sh = h * (0.1 + rnd() * 0.28);
      tr *= 0.55 + rnd() * 0.25;
      prism(tr, sh, x, top, z, rot, shade * 0.92, warm);
      top += sh;
    }
    if (rnd() < 0.3) prism(tr * 0.3, 1.4 + rnd() * 2, x + tr * 0.3, top, z - tr * 0.2, rot, shade * 0.7, warm); // roof plant
    if (top > 46 && rnd() < 0.5) { // mast with an aircraft warning light
      const mh = 6 + rnd() * 16;
      prism(0.35, mh, x, top, z, rot, 0.5, 0);
      lamp(new THREE.BoxGeometry(0.9, 0.9, 0.9).translate(x, top + mh + 0.4, z), 2.6, 0.3, 0.1);
      top += mh;
    }
    if (rnd() < 0.1) { // a single restrained light band under the crown
      lamp(new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.35, 6, 1, true).rotateY(Math.PI / 2 - rot).translate(x, h * (0.72 + rnd() * 0.2), z), 1.5, 0.78, 0.36);
    }
    return top;
  };

  const g = new THREE.Group();
  // big signs, each on a face of its own carrier tower so they never float
  const signs: { mat: THREE.MeshBasicMaterial; base: THREE.Color; phase: number }[] = [];
  const carriers: number[][] = [];
  const defs: [number, number, number, number, number, number, number][] = [
    // angle, distance from the platform, centre height, width, height, colour, seed
    [-1.95, 62, 26, 9, 20, SAND, 3], [-1.1, 70, 30, 20, 9, 0xffa24a, 5], [-0.3, 60, 24, 9, 19, 0xe8dccb, 9],
    [0.75, 66, 27, 19, 9, APRICOT, 13], [2.2, 60, 27, 10, 22, 0xff8a3c, 17], [3.05, 72, 31, 21, 9.5, RUST, 21], [-2.7, 64, 33, 10, 23, 0xffb468, 25],
  ];
  for (const [ang, rad, y, w, h, colr, seed] of defs) {
    const R = w + 3, inr = R * 0.866;
    const fx = Math.cos(ang) * (HX + rad), fz = Math.sin(ang) * (HZ + rad), L = Math.hypot(fx, fz), nx = -fx / L, nz = -fz / L;
    const cx = fx - nx * inr, cz = fz - nz * inr; // tower centre: the sign face looks at the platform
    tower(cx, cz, R, y + h / 2 + 5 + rnd() * 18, Math.atan2(nz, nx) - Math.PI / 6);
    carriers.push([cx, cz, R]);
    const rot = Math.atan2(nx, nz);
    const base = new THREE.Color(colr).multiplyScalar(1.3);
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(seed, w > h ? 512 : 224, w > h ? 224 : 512), color: base.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(fx + nx * 0.6, y, fz + nz * 0.6); m.rotation.y = rot;
    g.add(noAO(m));
    // faint spill on the facade behind the sign
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.9, h * 1.7), new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(colr).multiplyScalar(0.14), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    spill.position.set(fx + nx * 0.3, y, fz + nz * 0.3); spill.rotation.y = rot;
    g.add(noAO(spill));
    signs.push({ mat, base, phase: seed * 1.7 });
  }
  // honeycomb lattice: neighbours share walls here and there, like basalt
  const TW = 13, rowH = TW * Math.sqrt(3) / 2, RC = TW / Math.sqrt(3);
  for (let row = -24; row <= 24; row++) for (let c = -26; c <= 26; c++) {
    const x = (c + (row & 1 ? 0.5 : 0)) * TW, z = row * rowH, d = dBox(x, z);
    if (d < 56 || d > 240) continue;
    const n = vnoise(x * 0.012 + 9, z * 0.012 + 4);
    if (rnd() > (d < 100 ? 0.4 + n * 0.4 : 0.2 + n * 0.4)) continue;
    let clash = false;
    for (const s of carriers) if (Math.hypot(x - s[0], z - s[1]) < s[2] + RC + 2) clash = true;
    if (clash) continue;
    const low = rnd() < 0.3 && d < 110; // wide low block: a terrace
    const R = RC * (low ? 0.99 : 0.55 + rnd() * 0.44);
    const h = low ? 4 + Math.round(rnd() * 4) * 2.5 : d < 90 ? 9 + rnd() * 18 + n * 10 + (d - 56) * 0.3 : 22 + rnd() * rnd() * 90 + (d - 90) * 0.28 + n * 22;
    tower(x + (low ? 0 : (rnd() - 0.5) * 2), z + (low ? 0 : (rnd() - 0.5) * 2), R, h, Math.PI / 2);
  }

  const ft = facadeTextures();
  // The city carries its own aerial perspective: thicker than the scene fog, with a ground mist and a warm side.
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: ft.map }, emissiveMap: { value: ft.emissiveMap }, glow: { value: 1.5 }, haze: { value: haze }, warm: { value: warm }, warmDir: { value: WARM } },
    vertexColors: true,
    vertexShader: `varying vec2 vUv; varying vec3 vC; varying vec3 vW; varying float vDepth;
      void main(){ vUv = uv; vC = color; vW = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform sampler2D emissiveMap; uniform float glow; uniform vec3 haze, warm, warmDir;
      varying vec2 vUv; varying vec3 vC; varying vec3 vW; varying float vDepth;
      void main(){
        vec3 lit = texture2D(emissiveMap, vUv).rgb * glow;
        vec3 c = texture2D(map, vUv).rgb * vC + lit;
        float f = 1.0 - exp(-vDepth * vDepth * 0.000085);
        float mist = exp(-max(vW.y + 3.0, 0.0) * 0.05) * smoothstep(40.0, 150.0, vDepth) * 0.6;
        float az = max(0.0, dot(normalize(vW.xz), normalize(warmDir.xz)));
        vec3 air = haze * 1.1 + warm * (0.1 + 0.4 * az * az) * (0.4 + mist);
        c = mix(c, air, clamp(max(f, mist), 0.0, 0.96));
        c += lit * 0.25 * f; // windows carry a little through the haze
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.add(new THREE.Mesh(cg, mat));
  g.add(noAO(new THREE.Mesh(mergeGeometries(lights), new THREE.MeshBasicMaterial({ vertexColors: true }))));
  return { group: g, signs };
}

const SKY_FRAG = `
uniform vec3 haze, zenith, warm, moonDir, warmDir;
varying vec3 vD;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vD); float h = d.y;
  vec3 c = mix(haze, zenith, pow(max(smoothstep(0.0, 0.6, h), 1e-4), 0.65));
  float az = max(0.0, dot(normalize(d.xz + 1e-5), normalize(warmDir.xz)));
  float band = exp(-max(h, 0.0) * 6.5);
  c += warm * band * (0.22 + 0.78 * az * az);
  // high broken cloud, lit from below by the city and rimmed by the moon
  vec2 p = d.xz / (abs(h) + 0.22) * 1.25;
  float n = fbm(p + vec2(3.0, 1.0));
  float cl = smoothstep(0.42, 0.78, n) * smoothstep(0.03, 0.3, h);
  float m = max(dot(d, moonDir), 0.0);
  vec3 cloudCol = haze * 1.25 + warm * 0.4 * (0.3 + az) + vec3(0.42, 0.52, 0.7) * pow(m, 6.0) * 0.5;
  c = mix(c, cloudCol, cl * 0.6);
  // moon: disc, tight halo, wide glow
  c += vec3(0.78, 0.87, 1.0) * (smoothstep(0.99935, 0.99965, m) * 3.0 * (1.0 - cl * 0.85) + pow(m, 420.0) * 0.5 + pow(m, 36.0) * 0.07);
  c = mix(c, haze, smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Small generated scene baked to a PMREM so the metal models get believable reflections. */
function buildEnvironment(renderer: THREE.WebGLRenderer, moonDir: THREE.Vector3, warmDir: THREE.Vector3): THREE.Texture {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { warmDir: { value: warmDir } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 warmDir; varying vec3 vD; void main(){ vec3 d = normalize(vD); float h = d.y;
      vec3 c = mix(vec3(0.1, 0.098, 0.11), vec3(0.014, 0.015, 0.024), smoothstep(0.0, 0.7, h));
      float az = max(0.0, dot(normalize(d.xz + 1e-5), normalize(warmDir.xz)));
      c += vec3(0.78, 0.36, 0.13) * exp(-abs(h) * 5.0) * (0.12 + az * az * 0.9);
      c = mix(c, vec3(0.024, 0.021, 0.019), smoothstep(-0.02, -0.3, h));
      gl_FragColor = vec4(c, 1.0); }`,
  }));
  env.add(dome);
  const panel = (dir: THREE.Vector3, dist: number, w: number, h: number, c: THREE.Color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.copy(dir).normalize().multiplyScalar(dist); m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(moonDir, 30, 16, 16, new THREE.Color().setRGB(5.5, 7.0, 10.0));                               // moon softbox
  panel(warmDir.clone().setY(0.16), 30, 34, 5, new THREE.Color().setRGB(9, 4.2, 1.5));               // sodium horizon strip
  panel(new THREE.Vector3(-warmDir.x, 0.1, -warmDir.z), 30, 22, 3, new THREE.Color().setRGB(1.6, 1.9, 2.4)); // pale counter strip
  panel(new THREE.Vector3(0.3, 1, -0.2), 34, 26, 26, new THREE.Color().setRGB(0.18, 0.2, 0.27));      // overcast top
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.035);
  pm.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return rt.texture;
}

const MAX_TILES = 1100, PULSES = 8, PULSE_SPEED = 11, INTRO = 2.5;
const easeOut = (p: number) => 1 - (1 - p) * (1 - p) * (1 - p);
const easeBack = (p: number) => { const q = p - 1; return 1 + 2.2 * q * q * q + 1.2 * q * q; };
const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function buildWorld(scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
  const haze = new THREE.Color().setRGB(0.125, 0.108, 0.112);
  const warm = new THREE.Color().setRGB(0.42, 0.18, 0.06);
  scene.fog = new THREE.FogExp2(haze, 0.0072);
  scene.background = haze.clone();

  const sunPos = new THREE.Vector3(-30, 40, 20);
  const moonDir = MOON, warmDir = WARM;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { haze: { value: haze }, zenith: { value: new THREE.Color().setRGB(0.005, 0.005, 0.011) }, warm: { value: warm }, moonDir: { value: moonDir }, warmDir: { value: warmDir } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SKY_FRAG,
    }),
  );
  sky.renderOrder = -20;
  scene.add(noAO(sky));

  if (renderer) { scene.environment = buildEnvironment(renderer, moonDir, warmDir); scene.environmentIntensity = 0.85; }

  // ---- lighting: cool moon key, warm low rim, faint cool fill ----
  scene.add(new THREE.HemisphereLight(0x5c6278, 0x1e1712, 1.05));
  const sun = new THREE.DirectionalLight(0xb6c8ee, 4.6);
  sun.position.copy(sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -36; sc.right = 36; sc.top = 30; sc.bottom = -30; sc.near = 5; sc.far = 130;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3.5;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff9a52, 3.4);
  rim.position.set(26, 15, -34);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x56708f, 0.8);
  fill.position.set(-10, 12, 40);
  scene.add(fill);

  // ---- far ground, basalt columns, city ----
  const TERRACE_W = 5.2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ ...pavingTextures(TERRACE_W), roughness: 1, metalness: 1, envMapIntensity: 0.3 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -3.1; ground.receiveShadow = true;
  scene.add(ground);
  scene.add(terrain(TERRACE_W));
  const city = skyline(haze, warm);
  scene.add(city.group);

  // ---- atmosphere: haze curtains between the deck and the city give the skyline depth ----
  const hazeMat = (alpha: number) => new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    uniforms: { haze: { value: haze }, warm: { value: warm }, warmDir: { value: warmDir }, alpha: { value: alpha } },
    vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 haze, warm, warmDir; uniform float alpha; varying vec2 vUv; varying vec3 vP;
      void main(){ float az = max(0.0, dot(normalize(vP.xz), normalize(warmDir.xz)));
        float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2) * alpha;
        gl_FragColor = vec4(haze * 1.15 + warm * 0.55 * az * az, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  for (const [k, hgt, al] of [[34, 22, 0.32], [84, 48, 0.42], [144, 84, 0.5]]) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, hgt, 56, 1, true), hazeMat(al));
    cyl.scale.set(HX + k, 1, HZ + k); cyl.position.y = hgt / 2 - 3.5; cyl.renderOrder = -10;
    scene.add(noAO(cyl));
  }

  // ---- deck: one instanced mesh, the seams and ripples are drawn in its shader ----
  const U = {
    uTexRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uTime: { value: 0 }, uCore: { value: new THREE.Vector2() },
    uSeam: { value: new THREE.Color(0, 0, 0) }, uBeatC: { value: new THREE.Color(0, 0, 0) }, uPulseGain: { value: 0 },
    uP: { value: new Float32Array(PULSES * 4) }, uPc: { value: new Float32Array(PULSES * 4) },
  };
  const deckMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: 0.6, normalScale: new THREE.Vector2(1, 1) });
  deckMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aCell; uniform vec4 uTexRect; varying vec3 vLoc; varying vec2 vCtr; varying float vKind;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec2 wxz = aCell.xy + position.xz;
        vec2 wuv = vec2((wxz.x - uTexRect.x) * uTexRect.z, 1.0 - (wxz.y - uTexRect.y) * uTexRect.w);
        #ifdef USE_MAP
          vMapUv = wuv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = wuv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = wuv;
        #endif
        #ifdef USE_METALNESSMAP
          vMetalnessMapUv = wuv;
        #endif
        vLoc = position; vCtr = aCell.xy; vKind = aCell.z;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uPulseGain; uniform vec3 uSeam, uBeatC; uniform vec2 uCore; uniform vec4 uP[${PULSES}]; uniform vec4 uPc[${PULSES}];
        varying vec3 vLoc; varying vec2 vCtr; varying float vKind;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // distance to the tile edge (0 on the edge), from the tile's own coordinates
          vec2 hq = abs(vLoc.xz);
          float hd = max(hq.x, hq.x * 0.5 + hq.y * 0.8660254);
          float ed = max(1.0 - hd, 0.0);
          float px = fwidth(hd);
          float sg = max(0.034, px * 0.75);
          float seam = exp(-ed * ed / (2.0 * sg * sg)) * (0.034 / sg);
          float wide = exp(-ed * ed * 55.0);
          float depth = 1.0 - smoothstep(0.14, 0.32, -vLoc.y);
          float dim = vKind > 3.5 && vKind < 4.5 ? 0.35 : 1.0;
          // lit borders belong to the plates you can build on: roads stay one dark strip, wrecked plates stay dead
          float road = 1.0 - step(0.5, abs(vKind - 1.0)), dead = 1.0 - step(0.5, abs(vKind - 2.0));
          float seamK = dim * (1.0 - 0.82 * road) * (1.0 - dead), pulseK = dim * (1.0 - 0.5 * road) * (1.0 - 0.6 * dead);
          vec2 w = vCtr + vLoc.xz;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < ${PULSES}; i++) {
            vec4 p = uP[i];
            float age = uTime - p.z, R = max(abs(p.w), 0.01), rr = age * ${PULSE_SPEED.toFixed(1)}, k = rr / R;
            // a negative radius runs the ripple inward, from the rim to the centre
            float inw = step(p.w, 0.0), at = mix(rr, R - rr, inw);
            // the ring passes each tile as a whole more than it passes each pixel: the seams light up tile by tile
            float d = mix(distance(w, p.xy), distance(vCtr, p.xy), 0.6);
            float ring = exp(-(d - at) * (d - at) * 0.7) * mix((1.0 - k) * (1.0 - k), smoothstep(0.0, 0.3, k) * (1.0 - k * k), inw) * step(0.0, age) * step(k, 1.0);
            acc += uPc[i].rgb * ring;
          }
          // the beat breathes out from the core and thins toward the rim
          float breath = 0.25 + 0.75 * exp(-dot(vCtr - uCore, vCtr - uCore) * 0.0035);
          totalEmissiveRadiance += ((uSeam + uBeatC * breath) * seam * seamK + acc * uPulseGain * (wide + 0.05) * pulseK) * depth;
        }`);
  };
  const deckGeo = tileGeometry();
  const aCell = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TILES * 4), 4);
  deckGeo.setAttribute('aCell', aCell);
  const deck = new THREE.InstancedMesh(deckGeo, deckMat, MAX_TILES);
  deck.count = 0; deck.receiveShadow = true; deck.frustumCulled = false;
  scene.add(deck);
  const rest = new Float32Array(MAX_TILES * 16), delay = new Float32Array(MAX_TILES), reveal = new Float32Array(MAX_TILES).fill(1);

  // ---- raised roads, LED strips, platform edge light ----
  const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.64, metalness: 0.75, envMapIntensity: 0.8, side: THREE.DoubleSide });
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.82, metalness: 0.1, side: THREE.DoubleSide });
  const raised = new THREE.Group();
  scene.add(raised);
  const ledU = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uSweep: { value: 2 }, uCol: { value: new THREE.Color(SAND) }, uGain: { value: 1 } };
  const ledMat = new THREE.ShaderMaterial({
    uniforms: ledU, fog: true, side: THREE.DoubleSide,
    vertexShader: `attribute float aD; attribute float aS; varying float vD; varying float vS;
      #include <fog_pars_vertex>
      void main(){ vD = aD; vS = aS; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uSweep, uGain; uniform vec3 uCol; varying float vD; varying float vS;
      #include <fog_pars_fragment>
      void main(){
        float dash = step(0.07, fract(vS * 0.5));
        float lit = smoothstep(0.0, 0.006, uSweep - vD);
        float front = exp(-abs(uSweep - vD) * 70.0) * step(uSweep, 1.2);
        gl_FragColor = vec4(uCol * (0.03 + (lit * uGain + front * 2.2) * dash), 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  let leds: THREE.Mesh | null = null, edge: THREE.Mesh | null = null;
  const edgeBase = new THREE.Color(APRICOT).multiplyScalar(0.8);
  const edgeMat = new THREE.MeshBasicMaterial({ color: edgeBase.clone(), side: THREE.DoubleSide });

  // ---- spawn gates (one per road) and core light: placed by setMap ----
  const gateSteel = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const HULL = 0x2c2a29, TRIM = 0x45423e;
    parts.push(paint(hexPrism(2.25, 2.5, 3.5, -2.6, -0.05, 0), HULL));          // bunker the machines come out of
    parts.push(paint(hexPrism(1.5, 2.25, 0.6, -2.6, 3.45, 0), TRIM, 0.8));
    parts.push(paint(hexPrism(0.5, 0.7, 1.4, -2.6, 4.05, 0), HULL));
    for (const s of [-1, 1]) {
      parts.push(paint(hexPrism(0.36, 0.46, 3.5, 0.9, 0, s * 2.05), TRIM));     // pylons carrying the frame
      parts.push(paint(hexPrism(0.5, 0.36, 0.25, 0.9, 3.5, s * 2.05), HULL));
      parts.push(paint(new THREE.BoxGeometry(2.4, 0.3, 0.3).translate(-0.3, 3.2, s * 1.9), HULL));
    }
    parts.push(paint(new THREE.BoxGeometry(0.5, 0.32, 4.5).translate(0.9, 3.55, 0), HULL));
    for (const p of parts) if (p.attributes.uv) p.deleteAttribute('uv');
    return mergeGeometries(parts);
  })();
  const ringGeo = new THREE.TorusGeometry(1.78, 0.06, 6, 6).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
  const mouthGeo = new THREE.CircleGeometry(1.55, 6).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
  const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(STATIC).multiplyScalar(1.9) });
  const veilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x1c3350), transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x020406 });
  const gates: { group: THREE.Group; arch: THREE.Mesh; base: THREE.Mesh; light: THREE.PointLight; pool: THREE.Mesh; high: boolean }[] = [];
  const makeGate = () => {
    const gate = new THREE.Group();
    const body = new THREE.Mesh(gateSteel, steelMat); body.castShadow = true; body.receiveShadow = true; gate.add(body);
    const arch = noAO(new THREE.Mesh(ringGeo, gm)); arch.position.set(0.9, 1.6, 0); gate.add(arch);
    const veil = noAO(new THREE.Mesh(mouthGeo, veilMat)); veil.position.set(0.9, 1.6, 0); gate.add(veil);
    const mouth = new THREE.Mesh(mouthGeo, mouthMat); mouth.position.set(-0.62, 1.6, 0); gate.add(mouth);
    const lip = noAO(new THREE.Mesh(ringGeo, gm)); lip.position.set(-0.6, 1.6, 0); lip.scale.setScalar(0.9); gate.add(lip);
    // tower under a gate that opens onto a raised road
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.7, 1, 6).translate(-2.6, -0.5, 0), steelMat); base.castShadow = true; gate.add(base);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(HEX_SIZE * 1.9, HEX_SIZE * 1.9, 1, 6).rotateY(Math.PI / 6).translate(0, -0.5, 0), steelMat); base.add(stand);
    scene.add(gate);
    const light = new THREE.PointLight(STATIC, 50, 15, 2);
    scene.add(light);
    const pool = noAO(lightPool(5.5, STATIC, 0.3)); scene.add(pool);
    return { group: gate, arch, base, light, pool, high: false };
  };
  const coreLight = new THREE.PointLight(0xffc98a, 70, 20, 2);
  scene.add(coreLight);
  const corePool = noAO(lightPool(8, 0xf0a060, 0.3)); scene.add(corePool);

  // ---- state ----
  const fxOptions: { impact: boolean; beat: boolean; borders: boolean; env: boolean; towers: boolean; intensity: number; color: number | null } =
    { impact: true, beat: true, borders: true, env: true, towers: true, intensity: 0.4, color: null };
  let lay: Layout | null = null, current: GameMap | null = null, currentDef: unknown = null;
  let introT = -1, now = 0, beat = 0, beatS = 0, slot = 0, gateK = 1;
  const segs: number[] = []; // road segments for roadY: ax, az, ay, bx, bz, by
  const tmpC = new THREE.Color(), M4 = new THREE.Matrix4(), EUL = new THREE.Euler(), QT = new THREE.Quaternion(), SC = new THREE.Vector3(1, 1, 1), PV = new THREE.Vector3();

  /** Pose every tile for intro time t (seconds), or at rest when t is past the end. */
  const pose = (t: number) => {
    const arr = deck.instanceMatrix.array as Float32Array, n = deck.count, done = t >= INTRO;
    for (let i = 0; i < n; i++) {
      const o = i * 16, p = done ? 1 : sat((t - delay[i]) / 0.62);
      reveal[i] = easeOut(p);
      const s = p <= 0 ? 0 : 0.5 + 0.5 * reveal[i], off = (easeBack(p) - 1) * 2.4;
      for (let k = 0; k < 11; k++) arr[o + k] = rest[o + k] * s;
      arr[o + 12] = rest[o + 12]; arr[o + 13] = rest[o + 13] + off; arr[o + 14] = rest[o + 14]; arr[o + 15] = 1;
    }
    deck.instanceMatrix.needsUpdate = true;
    const up = done ? 1 : easeOut(sat((t - 1.05) / 0.75));
    raised.scale.y = Math.max(up, 1e-4); raised.visible = up > 0;
    if (leds) { leds.scale.y = raised.scale.y; leds.visible = done || t > 1.55; ledU.uSweep.value = done ? 2 : (t - 1.55) / 0.9; }
    const gs = done ? 1 : easeBack(sat((t - 0.95) / 0.7));
    gateK = sat(gs);
    for (const g of gates) g.group.scale.setScalar(Math.max(gs, 1e-4));
  };

  /** (Re)build the deck for a map: plates, roads, ramps and bridges, gates, core pad. */
  const setMap = (map: GameMap) => {
    if (currentDef === map.def) return;
    currentDef = map.def; current = map;
    lay = layout(map);
    for (const t of [deckMat.map, deckMat.normalMap, deckMat.roughnessMap]) t?.dispose();
    Object.assign(deckMat, deckTextures(map, lay));
    deckMat.needsUpdate = true;
    U.uTexRect.value.set(lay.x0, lay.z0, 1 / lay.w, 1 / lay.d);
    U.uCore.value.set(map.core.x, map.core.z);
    const n = Math.min(lay.tiles.length, MAX_TILES), kx = Math.round(map.def.core[0]), kz = Math.round(map.def.core[1]);
    let far = 1;
    for (let i = 0; i < n; i++) far = Math.max(far, hexDist(lay.tiles[i].cx, lay.tiles[i].cz, kx, kz));
    for (let i = 0; i < n; i++) {
      const t = lay.tiles[i], blocked = t.kind === BLOCKED;
      const y = t.kind === ROAD ? -ROAD_DROP : t.kind === SKIRT ? -0.34 : blocked ? -0.07 : 0;
      EUL.set(blocked ? (t.seed - 0.5) * 0.05 : 0, 0, blocked ? (((t.seed * 7) % 1) - 0.5) * 0.05 : 0);
      M4.compose(PV.set(t.x, y, t.z), QT.setFromEuler(EUL), SC);
      M4.toArray(rest, i * 16);
      aCell.setXYZW(i, t.x, t.z, t.kind, t.seed);
      // the deck assembles from the core outward; the skirt follows last
      delay[i] = 0.04 + 1.5 * (hexDist(t.cx, t.cz, kx, kz) / far) + t.seed * 0.1 + (t.kind === SKIRT ? 0.12 : 0);
    }
    deck.count = n; aCell.needsUpdate = true;

    for (const c of [...raised.children]) { raised.remove(c); (c as THREE.Mesh).geometry.dispose(); }
    const st = buildStructures(map, lay);
    if (st) {
      const top = new THREE.Mesh(st.top, roadMat), steel = new THREE.Mesh(st.steel, steelMat);
      top.receiveShadow = steel.receiveShadow = true; top.castShadow = steel.castShadow = true;
      raised.add(top, steel);
    }
    if (leds) { scene.remove(leds); leds.geometry.dispose(); }
    leds = noAO(new THREE.Mesh(buildLeds(map, lay), ledMat)); leds.frustumCulled = false; scene.add(leds);
    if (edge) { scene.remove(edge); edge.geometry.dispose(); }
    edge = noAO(new THREE.Mesh(buildEdge(lay), edgeMat)); edge.frustumCulled = false; scene.add(edge);

    segs.length = 0;
    map.lanes.forEach((lane, i) => {
      for (let k = 1; k < lane.pts.length; k++) if (lane.ys[k - 1] > 0.01 || lane.ys[k] > 0.01) segs.push(lane.pts[k - 1][0], lane.pts[k - 1][1], lane.ys[k - 1], lane.pts[k][0], lane.pts[k][1], lane.ys[k]);
      const g = gates[i] || (gates[i] = makeGate());
      const a0 = lane.pts[0], b0 = lane.pts[1], L = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1;
      const dx = (b0[0] - a0[0]) / L, dz = (b0[1] - a0[1]) / L, y = lane.ys[0];
      // on a viaduct the pool and the lamp would sit on a strip two units wide and burn it out
      g.high = y > 0.3;
      g.group.visible = g.light.visible = true; g.pool.visible = !g.high;
      g.group.position.set(a0[0], y, a0[1]); g.group.rotation.y = Math.atan2(-dz, dx);
      g.base.visible = y > 0.3; g.base.scale.y = Math.max(y, 0.01);
      g.light.position.set(a0[0] + dx * 2.4, y + (g.high ? 2.6 : 1.8), a0[1] + dz * 2.4);
      g.pool.position.set(a0[0] + dx * 2.2, y + 0.03 - (y < 0.3 ? ROAD_DROP - 0.04 : 0), a0[1] + dz * 2.2);
    });
    for (let i = map.lanes.length; i < gates.length; i++) gates[i].group.visible = gates[i].light.visible = gates[i].pool.visible = false;
    coreLight.position.set(map.core.x, 4.2, map.core.z);
    corePool.position.set(map.core.x, 0.03, map.core.z);
    introT = -1;
    pose(INTRO);
  };

  const startIntro = () => { if (current) { introT = 0; pose(0); } };
  const skipIntro = () => { if (introT >= 0) { introT = -1; pose(INTRO); } };
  const introActive = () => introT >= 0;

  const revealAt = (x: number, z: number) => {
    if (introT < 0 || !lay) return 1;
    cellOf(x, z);
    const i = inKey(CX, CZ) ? lay.lut[key(CX, CZ)] : -1;
    return i >= 0 && i < deck.count ? reveal[i] : sat(introT / INTRO);
  };

  const roadY = (x: number, z: number) => {
    let best = 0;
    for (let i = 0; i < segs.length; i += 6) {
      const ax = segs[i], az = segs[i + 1], bx = segs[i + 3], bz = segs[i + 4], ex = bx - ax, ez = bz - az;
      const u = sat(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1));
      const dx = ax + ex * u - x, dz = az + ez * u - z;
      if (dx * dx + dz * dz > 0.9 * 0.9) continue;
      const y = segs[i + 2] + (segs[i + 5] - segs[i + 2]) * u;
      if (y > best) best = y;
    }
    return best;
  };

  const pulse = (x: number, z: number, color: number, radius: number, strength = 1) => {
    if (!fxOptions.impact || radius === 0) return;
    const p = U.uP.value, c = U.uPc.value, o = slot * 4;
    slot = (slot + 1) % PULSES;
    tmpC.set(fxOptions.color === null ? color : fxOptions.color);
    p[o] = x; p[o + 1] = z; p[o + 2] = now; p[o + 3] = radius;
    c[o] = tmpC.r * strength; c[o + 1] = tmpC.g * strength; c[o + 2] = tmpC.b * strength;
  };
  // empty slots must never light up
  for (let i = 0; i < PULSES; i++) U.uP.value[i * 4 + 2] = -1e6;
  const setBeat = (level: number) => { beat = sat(level); };

  setMap(new GameMap(DEFAULT_MAP));

  const update = (time: number, dt = 1 / 60) => {
    now = time;
    U.uTime.value = time;
    const fx = fxOptions, I = Math.max(0, Math.min(2, fx.intensity));
    beatS += (beat - beatS) * Math.min(1, dt * 20);
    const b = fx.beat ? beatS * I : 0, bs = fx.beat ? beatS * (0.1 + 0.3 * I) : 0; // the floor keeps the beat visible at a low effects setting
    tmpC.set(fx.color === null ? SAND : fx.color);
    U.uSeam.value.copy(tmpC).multiplyScalar(fx.borders ? 0.05 + 0.1 * I : 0);
    U.uBeatC.value.copy(tmpC).multiplyScalar(bs);
    U.uPulseGain.value = fx.impact ? I * 1.5 : 0;
    const env = fx.env ? b : 0;
    for (const s of city.signs) {
      const f = 0.86 + Math.sin(time * 1.3 + s.phase) * 0.08 + (Math.sin(time * 23 + s.phase * 3) > 0.985 ? -0.35 : 0);
      s.mat.color.copy(s.base).multiplyScalar(f * (1 + env * 0.45));
    }
    const fade = introT < 0 ? 1 : sat((introT - 1.7) / 0.7);
    edgeMat.color.copy(edgeBase).multiplyScalar((0.9 + env * 0.6) * fade);
    coreLight.intensity = 70 * (0.92 + Math.sin(time * 2.1) * 0.08) * fade;
    corePool.scale.setScalar(8 * Math.max(fade, 1e-3));
    for (const g of gates) { g.light.intensity = (g.high ? 20 : 50) * (0.9 + Math.sin(time * 3) * 0.1) * gateK; g.pool.scale.setScalar(5.5 * Math.max(gateK, 1e-3)); g.arch.scale.setScalar(1 + Math.sin(time * 3) * 0.02); }
    if (introT >= 0) {
      introT += dt;
      if (introT >= INTRO) { introT = -1; pose(INTRO); } else pose(introT);
    }
  };

  return { sun, setMap, startIntro, skipIntro, introActive, revealAt, roadY, pulse, setBeat, fxOptions, update };
}
