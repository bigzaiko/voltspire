// Static environment: armoured deck, megacity skyline, sky, atmosphere, lights.
// Everything is procedural (2D canvases + small shaders): no external assets.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, GW, GH } from './data.ts';
import { GameMap, DEFAULT_MAP } from './map.ts';
import { rng, canvas, noiseCanvas, cloudCanvas, normalFromHeight, packRM, lightPool, glowTexture } from './tex.ts';

const PX = 80;
const grey = (v: number) => { const k = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${k},${k},${k})`; };
type Ctx = CanvasRenderingContext2D;

/** Layer that is skipped by the ambient-occlusion pre-pass (transparent / unlit things). */
export const FX_LAYER = 1;
export function noAO<T extends THREE.Object3D>(o: T): T { o.traverse((c) => c.layers.set(FX_LAYER)); return o; }

function hazard(g: Ctx, x: number, y: number, w: number, h: number, alpha: number) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = `rgba(14,14,12,${alpha})`; g.fillRect(x, y, w, h);
  g.strokeStyle = `rgba(190,142,44,${alpha})`; g.lineWidth = 5;
  g.beginPath();
  for (let i = -h; i < w + h; i += 13) { g.moveTo(x + i, y + h + 2); g.lineTo(x + i + h + 4, y - 2); }
  g.stroke();
  g.restore();
}

function boardTextures(map: GameMap) {
  const BASE_GRID = map.grid;
  const W = GW * PX, H = GH * PX, r = rng(1337);
  const [col, a] = canvas(W, H), [emi, e] = canvas(W, H), [hgt, hh] = canvas(W, H), [rgh, rr] = canvas(W, H), [met, mm] = canvas(W, H);
  a.fillStyle = '#0a0b0d'; a.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  hh.fillStyle = grey(0.22); hh.fillRect(0, 0, W, H);
  rr.fillStyle = grey(0.88); rr.fillRect(0, 0, W, H);
  mm.fillStyle = grey(0.25); mm.fillRect(0, 0, W, H);

  // ---- armour plates (one per buildable cell) ----
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    if (BASE_GRID[cz * GW + cx]) continue;
    const x = cx * PX, y = cz * PX, v = 0.84 + r() * 0.28, kind = r(), d = r();
    let R = 70, G = 72, B = 75;
    if (kind < 0.08) { R = 48; G = 51; B = 56; } else if (kind < 0.15) { R = 78; G = 71; B = 63; } else if (kind < 0.2) { R = 60; G = 67; B = 70; }
    a.fillStyle = `rgb(${(R * v) | 0},${(G * v) | 0},${(B * v) | 0})`;
    a.fillRect(x + 2, y + 2, PX - 4, PX - 4);
    a.lineWidth = 1.5;
    a.strokeStyle = 'rgba(255,255,255,0.09)'; a.beginPath(); a.moveTo(x + 3, y + PX - 3); a.lineTo(x + 3, y + 3); a.lineTo(x + PX - 3, y + 3); a.stroke();
    a.strokeStyle = 'rgba(0,0,0,0.4)'; a.beginPath(); a.moveTo(x + PX - 3, y + 3); a.lineTo(x + PX - 3, y + PX - 3); a.lineTo(x + 3, y + PX - 3); a.stroke();
    hh.fillStyle = grey(0.52); hh.fillRect(x + 2, y + 2, PX - 4, PX - 4);
    hh.fillStyle = grey(0.66 + r() * 0.06); hh.fillRect(x + 5, y + 5, PX - 10, PX - 10);
    rr.fillStyle = grey(0.5 + r() * 0.22); rr.fillRect(x + 2, y + 2, PX - 4, PX - 4);
    rr.strokeStyle = grey(0.3); rr.lineWidth = 2.5; rr.strokeRect(x + 4, y + 4, PX - 8, PX - 8); // worn, polished edges
    mm.fillStyle = grey(kind < 0.15 && kind >= 0.08 ? 0.45 : 0.72); mm.fillRect(x + 2, y + 2, PX - 4, PX - 4);
    // bolts
    for (const [bx, by] of [[10, 10], [PX - 10, 10], [10, PX - 10], [PX - 10, PX - 10]]) {
      a.fillStyle = '#0b0c0e'; a.beginPath(); a.arc(x + bx, y + by, 2.4, 0, 7); a.fill();
      a.fillStyle = 'rgba(160,170,180,0.35)'; a.beginPath(); a.arc(x + bx - 0.6, y + by - 0.6, 1, 0, 7); a.fill();
      hh.fillStyle = grey(0.9); hh.beginPath(); hh.arc(x + bx, y + by, 2.6, 0, 7); hh.fill();
      rr.fillStyle = grey(0.25); rr.beginPath(); rr.arc(x + bx, y + by, 2.6, 0, 7); rr.fill();
    }
    if (d < 0.1) { // inset access hatch
      a.strokeStyle = 'rgba(0,0,0,0.55)'; a.lineWidth = 2; a.strokeRect(x + 19, y + 19, PX - 38, PX - 38);
      hh.strokeStyle = grey(0.3); hh.lineWidth = 3; hh.strokeRect(x + 19, y + 19, PX - 38, PX - 38);
      a.fillStyle = 'rgba(0,0,0,0.5)'; a.fillRect(x + PX / 2 - 6, y + PX - 26, 12, 3);
    } else if (d < 0.17) { // vent slots
      for (let i = 0; i < 5; i++) {
        a.fillStyle = '#060708'; a.fillRect(x + 20, y + 21 + i * 8, PX - 40, 3.5);
        hh.fillStyle = grey(0.15); hh.fillRect(x + 20, y + 21 + i * 8, PX - 40, 3.5);
        rr.fillStyle = grey(0.9); rr.fillRect(x + 20, y + 21 + i * 8, PX - 40, 3.5);
      }
    } else if (d < 0.22) { // stencilled plate id
      a.fillStyle = 'rgba(205,210,214,0.2)'; a.font = '600 11px monospace';
      a.fillText(String.fromCharCode(65 + (cz % 26)) + '-' + String(cx + 1).padStart(2, '0'), x + 16, y + PX - 14);
    } else if (d < 0.255) { // worn hazard strip
      hazard(a, x + 6, y + PX - 15, PX - 12, 8, 0.5);
    } else if (d < 0.3) { // diagonal weld / repair seam
      a.strokeStyle = 'rgba(0,0,0,0.35)'; a.lineWidth = 2; a.beginPath(); a.moveTo(x + 8, y + 14 + r() * 40); a.lineTo(x + PX - 8, y + 14 + r() * 40); a.stroke();
    }
  }
  // heavier structural seams every 4 plates
  for (let cx = 0; cx <= GW; cx += 4) for (const [g, s] of [[a, '#050607'], [hh, grey(0.1)], [rr, grey(0.92)], [mm, grey(0.2)]] as [Ctx, string][]) { g.fillStyle = s; g.fillRect(cx * PX - 3, 0, 6, H); }
  for (let cz = 0; cz <= GH; cz += 3) for (const [g, s] of [[a, '#050607'], [hh, grey(0.1)], [rr, grey(0.92)], [mm, grey(0.2)]] as [Ctx, string][]) { g.fillStyle = s; g.fillRect(0, cz * PX - 3, W, 6); }
  // dim survey markers on plate corners: keeps the build grid countable in the dark
  const free = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < GW && cz < GH && !BASE_GRID[cz * GW + cx];
  for (let cz = 0; cz <= GH; cz++) for (let cx = 0; cx <= GW; cx++) {
    if (!(free(cx, cz) && free(cx - 1, cz) && free(cx, cz - 1) && free(cx - 1, cz - 1))) continue;
    for (const [g, s] of [[a, 'rgba(130,160,168,0.42)'], [e, '#0c2a2e']] as [Ctx, string][]) {
      g.strokeStyle = s; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx * PX - 6, cz * PX); g.lineTo(cx * PX + 6, cz * PX); g.moveTo(cx * PX, cz * PX - 6); g.lineTo(cx * PX, cz * PX + 6); g.stroke();
    }
  }

  // ---- enemy roadway ----
  const lanesPx = map.def.lanes.map((l) => l.map(([cx, cz]) => [(cx + 0.5) * PX, (cz + 0.5) * PX]));
  const stroke = (g: Ctx, w: number, style: string, dash: number[] = []) => {
    g.lineJoin = 'round'; g.lineCap = 'butt'; g.lineWidth = w; g.strokeStyle = style; g.setLineDash(dash);
    for (const pts of lanesPx) {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    }
    g.setLineDash([]);
  };
  const RW = PX * 0.9;
  stroke(a, PX, '#08090a'); stroke(hh, PX, grey(0.78)); stroke(rr, PX, grey(0.32)); stroke(mm, PX, grey(0.9)); // steel kerb
  stroke(hh, RW, grey(0.36)); stroke(rr, RW, grey(0.8)); stroke(mm, RW, grey(0.04));
  stroke(a, RW, '#7fd0d4', [116, 4]); stroke(e, RW, '#2aa9b3', [116, 4]);                 // thin LED edge strips
  stroke(a, RW - 5, '#1b1c1f'); stroke(e, RW - 5, '#000');
  stroke(a, RW - 12, '#202124');
  stroke(a, PX * 0.5, 'rgba(255,255,255,0.03)'); stroke(rr, PX * 0.5, 'rgba(120,120,120,0.55)'); // worn centre track
  stroke(a, 2.5, 'rgba(214,204,176,0.2)', [20, 34]);
  // direction chevrons + entry hazard
  a.lineWidth = 4; a.strokeStyle = 'rgba(204,160,64,0.3)'; a.lineJoin = 'miter';
  for (const pts of lanesPx) for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay);
    if (L < PX * 3.5) continue;
    const dx = (bx - ax) / L, dy = (by - ay) / L, mx = (Math.max(ax, 0) + bx) / 2, my = (ay + by) / 2;
    for (let k = -1; k <= 1; k++) {
      const px = mx + dx * k * 13, py = my + dy * k * 13;
      a.beginPath(); a.moveTo(px - dx * 8 - dy * 15, py - dy * 8 + dx * 15); a.lineTo(px + dx * 8, py + dy * 8); a.lineTo(px - dx * 8 + dy * 15, py - dy * 8 - dx * 15); a.stroke();
    }
  }
  for (const pts of lanesPx) if (pts[0][0] < 0) hazard(a, 4, pts[0][1] - RW / 2 + 9, 30, RW - 18, 0.55);

  // ---- core pad ----
  const kx = (map.def.core[0] + 0.5) * PX, ky = (map.def.core[1] + 0.5) * PX;
  const disc = (g: Ctx, rad: number, s: string) => { g.fillStyle = s; g.beginPath(); g.arc(kx, ky, rad, 0, 7); g.fill(); };
  const circ = (g: Ctx, rad: number, w: number, s: string, dash: number[] = []) => { g.strokeStyle = s; g.lineWidth = w; g.setLineDash(dash); g.beginPath(); g.arc(kx, ky, rad, 0, 7); g.stroke(); g.setLineDash([]); };
  disc(a, PX * 1.5, '#1c1e21'); disc(hh, PX * 1.5, grey(0.62)); disc(rr, PX * 1.5, grey(0.42)); disc(mm, PX * 1.5, grey(0.85)); disc(e, PX * 1.5, '#000');
  circ(a, PX * 1.5, 4, '#050607'); circ(hh, PX * 1.5, 5, grey(0.2));
  circ(a, PX * 1.34, 9, 'rgba(190,142,44,0.55)', [15, 15]);
  circ(a, PX * 1.14, 2.5, '#7fd0d4'); circ(e, PX * 1.14, 2.5, '#2aa9b3');
  circ(a, PX * 0.8, 2, '#050607'); circ(hh, PX * 0.8, 3, grey(0.3));
  a.strokeStyle = 'rgba(0,0,0,0.5)'; a.lineWidth = 2;
  for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2 + 0.39; a.beginPath(); a.moveTo(kx + Math.cos(t) * PX * 0.8, ky + Math.sin(t) * PX * 0.8); a.lineTo(kx + Math.cos(t) * PX * 1.1, ky + Math.sin(t) * PX * 1.1); a.stroke(); }

  // ---- weathering over everything ----
  const blot = (g: Ctx, x: number, y: number, rad: number, rgb: string, al: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${rgb},${al})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  for (let i = 0; i < 240; i++) blot(a, r() * W, r() * H, 30 + r() * r() * 260, '0,0,0', 0.1 + r() * 0.16);
  for (let i = 0; i < 60; i++) blot(a, r() * W, r() * H, 20 + r() * 90, '96,78,58', 0.05 + r() * 0.07);   // rust / dust bloom
  for (let i = 0; i < 80; i++) { // oil / damp patches: darker and much smoother, they pick up the rim light
    const x = r() * W, y = r() * H, rad = 26 + r() * r() * 150;
    blot(rr, x, y, rad, '26,26,26', 0.85); blot(a, x, y, rad, '0,0,0', 0.2);
  }
  for (let i = 0; i < 90; i++) blot(rr, r() * W, r() * H, 40 + r() * 160, '235,235,235', 0.35);            // dusty, rough
  for (let i = 0; i < 650; i++) {
    const x = r() * W, y = r() * H, t = r() * 7, L = 8 + r() * r() * 110, al = 0.04 + r() * 0.09;
    a.strokeStyle = `rgba(196,204,212,${al})`; a.lineWidth = 0.6 + r();
    a.beginPath(); a.moveTo(x, y); a.lineTo(x + Math.cos(t) * L, y + Math.sin(t) * L); a.stroke();
    rr.strokeStyle = 'rgba(60,60,60,0.5)'; rr.lineWidth = 1;
    rr.beginPath(); rr.moveTo(x, y); rr.lineTo(x + Math.cos(t) * L, y + Math.sin(t) * L); rr.stroke();
  }
  const grit = noiseCanvas(256, 11), cloud = cloudCanvas(256, 5);
  for (const [g, al, cl] of [[a, 0.4, 0.55], [rr, 0.35, 0.5], [hh, 0.1, 0]] as [Ctx, number, number][]) {
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = al; g.fillStyle = g.createPattern(grit, 'repeat')!; g.fillRect(0, 0, W, H);
    if (cl) { g.globalAlpha = cl; g.imageSmoothingEnabled = true; g.drawImage(cloud, 0, 0, W, H); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  const tex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const rm = tex(packRM(rgh, met), false);
  return { map: tex(col, true), emissiveMap: tex(emi, true), normalMap: tex(normalFromHeight(hgt, 3.2), false), roughnessMap: rm, metalnessMap: rm };
}

function groundTextures() {
  const S = 512, r = rng(99);
  const [col, a] = canvas(S, S), [hgt, hh] = canvas(S, S), [rgh, rr] = canvas(S, S), [met, mm] = canvas(S, S);
  a.fillStyle = '#25272b'; a.fillRect(0, 0, S, S);
  hh.fillStyle = grey(0.6); hh.fillRect(0, 0, S, S);
  rr.fillStyle = grey(0.72); rr.fillRect(0, 0, S, S);
  mm.fillStyle = grey(0.12); mm.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) { // four slabs with slightly different tone
    const x = (i % 2) * 256, y = (i >> 1) * 256, v = 0.85 + r() * 0.3;
    a.fillStyle = `rgba(${i % 3 === 0 ? '70,66,60' : '50,56,64'},${0.25 * v})`; a.fillRect(x, y, 256, 256);
  }
  for (const [g, s, w] of [[a, '#08090a', 4], [hh, grey(0.1), 5], [rr, grey(0.95), 5]] as [Ctx, string, number][]) {
    g.fillStyle = s;
    g.fillRect(0, 0, S, w / 2); g.fillRect(0, S - w / 2, S, w / 2); g.fillRect(0, 256 - w / 2, S, w);
    g.fillRect(0, 0, w / 2, S); g.fillRect(S - w / 2, 0, w / 2, S); g.fillRect(256 - w / 2, 0, w, S);
  }
  // drain channel + a few cracks (kept away from the tile border so the repeat stays seamless)
  a.fillStyle = '#0b0c0d'; a.fillRect(40, 122, 180, 7); hh.fillStyle = grey(0.2); hh.fillRect(40, 122, 180, 7);
  for (let i = 0; i < 9; i++) {
    let x = 30 + r() * 450, y = 30 + r() * 450, t = r() * 7;
    a.strokeStyle = 'rgba(0,0,0,0.5)'; a.lineWidth = 1.2; hh.strokeStyle = grey(0.3); hh.lineWidth = 1.5;
    a.beginPath(); hh.beginPath(); a.moveTo(x, y); hh.moveTo(x, y);
    for (let k = 0; k < 7; k++) { t += (r() - 0.5) * 1.3; x = Math.max(8, Math.min(S - 8, x + Math.cos(t) * 14)); y = Math.max(8, Math.min(S - 8, y + Math.sin(t) * 14)); a.lineTo(x, y); hh.lineTo(x, y); }
    a.stroke(); hh.stroke();
  }
  for (let i = 0; i < 7; i++) { // damp patches
    const x = 110 + r() * 292, y = 110 + r() * 292, rad = 50 + r() * 50;
    const gr = rr.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(60,60,60,0.6)'); gr.addColorStop(1, 'rgba(60,60,60,0)');
    rr.fillStyle = gr; rr.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    const g2 = a.createRadialGradient(x, y, 0, x, y, rad); g2.addColorStop(0, 'rgba(0,0,0,0.16)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = g2; a.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const grit = noiseCanvas(256, 23);
  for (const [g, al] of [[a, 0.5], [rr, 0.45], [hh, 0.22]] as [Ctx, number][]) { g.globalCompositeOperation = 'overlay'; g.globalAlpha = al; g.fillStyle = g.createPattern(grit, 'repeat')!; g.fillRect(0, 0, S, S); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(56, 56); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const rm = tex(packRM(rgh, met), false);
  return { map: tex(col, true), normalMap: tex(normalFromHeight(hgt, 2.4, true), false), roughnessMap: rm, metalnessMap: rm };
}

const FACADE = 32; // window cells per atlas side
const MOON = new THREE.Vector3(-30, 40, 20).normalize();
const WARM = new THREE.Vector3(0.62, 0, -0.78).normalize();
function facadeTextures() {
  const S = 512, P = S / FACADE, r = rng(4242);
  const [c, a] = canvas(S, S), [e, b] = canvas(S, S);
  a.fillStyle = '#5a6068'; a.fillRect(0, 0, S, S);
  b.fillStyle = '#000'; b.fillRect(0, 0, S, S);
  // concrete / glass bands, mullions
  for (let y = 0; y < FACADE; y++) {
    a.fillStyle = `rgba(0,0,0,${0.12 + r() * 0.2})`; a.fillRect(0, y * P, S, P);
    a.fillStyle = 'rgba(0,0,0,0.3)'; a.fillRect(0, y * P, S, 2);
    a.fillStyle = 'rgba(255,255,255,0.05)'; a.fillRect(0, y * P + 2, S, 1);
  }
  for (let x = 0; x < FACADE; x++) { a.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.2})`; a.fillRect(x * P, 0, r() < 0.2 ? 4 : 2, S); }
  for (let y = 0; y < FACADE; y++) for (let x = 0; x < FACADE; x++) { a.fillStyle = `rgba(8,12,18,${0.12 + r() * 0.3})`; a.fillRect(x * P + 3, y * P + 5, P - 5, P - 8); }
  // sparse lit windows: mostly dark towers, a few lonely offices and short lit floor runs
  const tones = ['#ffd9a8', '#ffcf8f', '#cfe2ff', '#a8c8f0', '#ffe9cf', '#8fd6d8'];
  const light = (x: number, y: number, tone: string, al: number) => {
    if (x === 0 && y === FACADE - 1) return; // the (0,0) uv corner must stay dark: roofs sample it
    b.globalAlpha = al; b.fillStyle = tone; b.fillRect(x * P + 5, y * P + 7, P - 10, P - 12); b.globalAlpha = 1;
    a.globalAlpha = al; a.fillStyle = tone; a.fillRect(x * P + 5, y * P + 7, P - 10, P - 12); a.globalAlpha = 1;
  };
  for (let y = 0; y < FACADE; y++) for (let x = 0; x < FACADE; x++) if (r() < 0.022) light(x, y, tones[Math.floor(r() * tones.length)], 0.35 + r() * 0.65);
  for (let i = 0; i < 26; i++) {
    const y = Math.floor(r() * FACADE), x0 = Math.floor(r() * FACADE), n = 2 + Math.floor(r() * 5), tone = tones[Math.floor(r() * 3)], al = 0.3 + r() * 0.5;
    for (let k = 0; k < n; k++) if (r() < 0.8) light((x0 + k) % FACADE, y, tone, al * (0.6 + r() * 0.4));
  }
  const mk = (cv: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { map: mk(c), emissiveMap: mk(e) };
}

/** Abstract holographic signage: invented glyphs, bars and a frame. White on black, tinted by the material. */
function signTexture(seed: number, w: number, h: number) {
  const r = rng(seed), [c, g] = canvas(w, h);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const vertical = h > w, cell = Math.min(w, h) * 0.62, n = Math.max(2, Math.floor((Math.max(w, h) - cell * 0.5) / (cell * 1.12)));
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(8, 8, w - 16, h - 16);
  g.lineCap = 'square'; g.strokeStyle = '#fff';
  for (let i = 0; i < n; i++) {
    const ox = vertical ? (w - cell) / 2 : 26 + i * cell * 1.12, oy = vertical ? 26 + i * cell * 1.12 : (h - cell) / 2 - (vertical ? 0 : 8);
    const P = (k: number): [number, number] => [ox + ((k % 3) / 2) * cell * 0.8 + cell * 0.1, oy + (Math.floor(k / 3) / 2) * cell * 0.8 + cell * 0.1];
    g.lineWidth = cell * 0.085;
    const strokes = 3 + Math.floor(r() * 3);
    for (let s = 0; s < strokes; s++) {
      const p0 = Math.floor(r() * 9); let p1 = Math.floor(r() * 9); if (p1 === p0) p1 = (p0 + 3) % 9;
      const [x0, y0] = P(p0), [x1, y1] = P(p1);
      g.beginPath(); g.moveTo(x0, y0);
      if (r() < 0.5) g.lineTo(x1, y0); // orthogonal elbow reads as lettering rather than scribble
      g.lineTo(x1, y1); g.stroke();
    }
    if (r() < 0.4) { const [x0, y0] = P(Math.floor(r() * 9)); g.beginPath(); g.arc(x0, y0, cell * 0.11, 0, 7); g.stroke(); }
  }
  // small print
  g.fillStyle = 'rgba(255,255,255,0.7)';
  const bars = vertical ? 5 : 8;
  for (let i = 0; i < bars; i++) { const bw = 10 + r() * 40; g.fillRect(vertical ? 22 : 26 + i * ((w - 52) / bars), vertical ? h - 30 - i * 9 : h - 30, vertical ? bw : bw * 0.7, 4); }
  // scanlines + soft fade toward the edges
  g.fillStyle = 'rgba(0,0,0,0.42)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function skyline() {
  const rnd = rng(7);
  const geos: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [];
  const hx = (GW * CELL) / 2, hz = (GH * CELL) / 2;
  const tint = new THREE.Color();
  const box = (w: number, h: number, d: number, x: number, y0: number, z: number, rot: number, shade: number, warm: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const ou = Math.floor(rnd() * FACADE) / FACADE, ov = Math.floor(rnd() * FACADE) / FACADE;
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      if (f === 2 || f === 3) { uv.setXY(k, 0.004, 0.004); continue; }
      const fw = f < 2 ? d : w;
      uv.setXY(k, ou + (uv.getX(k) * Math.max(1, Math.round(fw / 1.4))) / FACADE, ov + (uv.getY(k) * Math.max(1, Math.round(h / 1.9))) / FACADE);
    }
    g.rotateY(rot);
    // Lighting is painted into vertex colours (the city is unlit): cool moon side, warm glow side,
    // everything else falls to a dark silhouette.
    tint.setRGB(shade * (1 + warm * 0.1), shade, shade * (1 - warm * 0.12));
    const ca = new Float32Array(g.attributes.position.count * 3), nrm = g.attributes.normal as THREE.BufferAttribute;
    for (let k = 0, v = 0; k < ca.length; k += 3, v++) {
      const nx = nrm.getX(v), ny = nrm.getY(v), nz = nrm.getZ(v);
      const moon = Math.max(0, nx * MOON.x + ny * MOON.y + nz * MOON.z), glow = Math.max(0, nx * WARM.x + nz * WARM.z);
      const top = ny > 0.5 ? 0.55 : 1;
      ca[k] = tint.r * top * (0.42 + moon * 0.5 + glow * 0.5); ca[k + 1] = tint.g * top * (0.46 + moon * 0.62 + glow * 0.24); ca[k + 2] = tint.b * top * (0.54 + moon * 0.85 + glow * 0.08);
    }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    g.translate(x, y0 + h / 2, z);
    geos.push(g);
  };
  const lamp = (w: number, h: number, d: number, x: number, y: number, z: number, rot: number, cr: number, cg: number, cb: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const ca = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < ca.length; k += 3) { ca[k] = cr; ca[k + 1] = cg; ca[k + 2] = cb; }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g.rotateY(rot); g.translate(x, y, z);
    lights.push(g);
  };
  const tower = (x: number, z: number, w: number, d: number, h: number, rot: number) => {
    const shade = 0.24 + rnd() * 0.3, warm = (rnd() * 2 - 1) * 0.6;
    box(w, h, d, x, -1, z, rot, shade, warm);
    let top = h - 1, tw = w, td = d;
    const steps = rnd() < 0.55 ? (rnd() < 0.35 ? 2 : 1) : 0;
    for (let s = 0; s < steps; s++) {
      const k = 0.55 + rnd() * 0.25, sh = h * (0.12 + rnd() * 0.3);
      tw *= k; td *= k;
      box(tw, sh, td, x, top, z, rot, shade * 0.92, warm);
      top += sh;
    }
    if (rnd() < 0.3) { // roof plant / water tanks
      box(tw * 0.35, 1.6 + rnd() * 2, td * 0.4, x + tw * 0.15, top, z - td * 0.1, rot, shade * 0.7, warm);
    }
    if (top > 46 && rnd() < 0.5) { // mast with an aircraft warning light
      const mh = 6 + rnd() * 16;
      box(0.5, mh, 0.5, x, top, z, rot, 0.5, 0);
      lamp(0.9, 0.9, 0.9, x, top + mh + 0.4, z, rot, 2.6, 0.22, 0.12);
      top += mh;
    }
    if (rnd() < 0.09) { // a single restrained light band under the crown
      const warmBand = rnd() < 0.6;
      lamp(w + 0.3, 0.35, d + 0.3, x, h * (0.72 + rnd() * 0.2), z, rot, warmBand ? 1.5 : 0.35, warmBand ? 0.85 : 1.1, warmBand ? 0.4 : 1.25);
    }
    return top;
  };
  for (let i = 0; i < 250; i++) {
    const ang = rnd() * Math.PI * 2, far = rnd() * rnd(), rad = 47 + far * 185;
    const x = Math.cos(ang) * (hx + rad), z = Math.sin(ang) * (hz + rad);
    const slab = rnd() < 0.22 && rad < 90; // long low industrial block
    const w = slab ? 22 + rnd() * 26 : 9 + rnd() * 15, d = slab ? 12 + rnd() * 10 : 9 + rnd() * 15;
    const h = slab ? 7 + rnd() * 9 : rad < 72 ? 14 + rnd() * 30 : 26 + rnd() * rnd() * 90 + (rad - 72) * 0.3;
    tower(x, z, w, d, h, slab ? Math.atan2(-x, -z) + (rnd() - 0.5) * 0.3 : (rnd() - 0.5) * 0.7);
  }

  const g = new THREE.Group();
  // big holographic signs, each on its own carrier tower so they never float
  const signs: { mat: THREE.MeshBasicMaterial; base: THREE.Color; phase: number }[] = [];
  const defs: [number, number, number, number, number, number, number][] = [
    // angle, extra distance, centre height, width, height, colour, seed
    [-1.95, 37, 27, 12, 26, 0x4fd2dc, 3], [-1.1, 39, 31, 30, 13, 0xffa24a, 5], [-0.3, 37, 25, 11, 24, 0xcfe0ff, 9],
    [0.75, 38, 27, 26, 12, 0x4fd2dc, 13], [2.2, 37, 28, 12, 27, 0xff8a3c, 17], [3.05, 39, 30, 28, 12, 0xd6557c, 21], [-2.7, 38, 34, 13, 30, 0xffb468, 25],
  ];
  for (const [ang, rad, y, w, h, colr, seed] of defs) {
    const x = Math.cos(ang) * (hx + rad), z = Math.sin(ang) * (hz + rad), L = Math.hypot(x, z), nx = -x / L, nz = -z / L, rot = Math.atan2(nx, nz);
    const bw = w + 8, bd = 15;
    tower(x - nx * (bd / 2 + 0.6), z - nz * (bd / 2 + 0.6), bw, bd, y + h / 2 + 6 + rnd() * 26, rot);
    const base = new THREE.Color(colr).multiplyScalar(1.55);
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(seed, w > h ? 512 : 224, w > h ? 224 : 512), color: base.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.y = rot;
    g.add(noAO(m));
    // faint spill on the facade behind the sign
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.9, h * 1.7), new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(colr).multiplyScalar(0.22), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    spill.position.set(x - nx * 0.3, y, z - nz * 0.3); spill.rotation.y = rot;
    g.add(noAO(spill));
    signs.push({ mat, base, phase: seed * 1.7 });
  }

  const ft = facadeTextures();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: ft.map }, emissiveMap: { value: ft.emissiveMap }, glow: { value: 1.5 } },
    vertexColors: true, fog: true,
    vertexShader: `varying vec2 vUv; varying vec3 vC;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vC = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; uniform sampler2D emissiveMap; uniform float glow; varying vec2 vUv; varying vec3 vC;
      #include <fog_pars_fragment>
      void main(){ vec3 c = texture2D(map, vUv).rgb * vC + texture2D(emissiveMap, vUv).rgb * glow;
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const city = new THREE.Mesh(mergeGeometries(geos), mat);
  g.add(city);
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
      vec3 c = mix(vec3(0.085, 0.105, 0.15), vec3(0.012, 0.016, 0.03), smoothstep(0.0, 0.7, h));
      float az = max(0.0, dot(normalize(d.xz + 1e-5), normalize(warmDir.xz)));
      c += vec3(0.75, 0.36, 0.14) * exp(-abs(h) * 5.0) * (0.12 + az * az * 0.9);
      c = mix(c, vec3(0.02, 0.022, 0.026), smoothstep(-0.02, -0.3, h));
      gl_FragColor = vec4(c, 1.0); }`,
  }));
  env.add(dome);
  const panel = (dir: THREE.Vector3, dist: number, w: number, h: number, c: THREE.Color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.copy(dir).normalize().multiplyScalar(dist); m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(moonDir, 30, 16, 16, new THREE.Color().setRGB(5.5, 7.2, 10.5));                              // moon softbox
  panel(warmDir.clone().setY(0.16), 30, 34, 5, new THREE.Color().setRGB(9, 4.2, 1.5));               // sodium horizon strip
  panel(new THREE.Vector3(-warmDir.x, 0.1, -warmDir.z), 30, 22, 3, new THREE.Color().setRGB(0.9, 2.6, 3.0)); // teal counter strip
  panel(new THREE.Vector3(0.3, 1, -0.2), 34, 26, 26, new THREE.Color().setRGB(0.16, 0.2, 0.3));      // overcast top
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.035);
  pm.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return rt.texture;
}

export function buildWorld(scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
  const haze = new THREE.Color().setRGB(0.082, 0.112, 0.16);
  const warm = new THREE.Color().setRGB(0.34, 0.15, 0.055);
  scene.fog = new THREE.FogExp2(haze, 0.0072);
  scene.background = haze.clone();

  const sunPos = new THREE.Vector3(-30, 40, 20);
  const moonDir = MOON, warmDir = WARM;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { haze: { value: haze }, zenith: { value: new THREE.Color().setRGB(0.004, 0.006, 0.014) }, warm: { value: warm }, moonDir: { value: moonDir }, warmDir: { value: warmDir } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SKY_FRAG,
    }),
  );
  sky.renderOrder = -20;
  scene.add(noAO(sky));

  if (renderer) { scene.environment = buildEnvironment(renderer, moonDir, warmDir); scene.environmentIntensity = 0.85; }

  // ---- lighting: cool moon key, warm low rim, faint cool fill ----
  scene.add(new THREE.HemisphereLight(0x56647c, 0x1c1612, 1.05));
  const sun = new THREE.DirectionalLight(0xb2c8f2, 4.6);
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
  const fill = new THREE.DirectionalLight(0x3f78a8, 0.9);
  fill.position.set(-10, 12, 40);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ ...groundTextures(), roughness: 1, metalness: 1, envMapIntensity: 0.7 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.42; ground.receiveShadow = true;
  scene.add(ground);

  const bw = GW * CELL, bh = GH * CELL;
  const steel = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.42, metalness: 0.85 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(bw + 1.3, 0.42, bh + 1.3), steel);
  slab.position.y = -0.215; slab.receiveShadow = true; slab.castShadow = true;
  scene.add(slab);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(bw + 2.6, 0.18, bh + 2.6), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.7 }));
  skirt.position.y = -0.34; skirt.receiveShadow = true;
  scene.add(skirt);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(bw + 1.36, 0.035, bh + 1.36), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa55c).multiplyScalar(0.75) }));
  edge.position.y = -0.2;
  scene.add(noAO(edge));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshStandardMaterial({ ...boardTextures(new GameMap(DEFAULT_MAP)), emissive: 0xffffff, emissiveIntensity: 2.4, roughness: 1, metalness: 1, normalScale: new THREE.Vector2(1, 1), envMapIntensity: 0.9 }));
  board.rotation.x = -Math.PI / 2; board.receiveShadow = true;
  scene.add(board);

  const city = skyline();
  scene.add(city.group);

  // ---- atmosphere: two haze curtains between the deck and the city give the skyline depth ----
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
  for (const [k, hgt, al] of [[30, 22, 0.38], [80, 48, 0.5], [140, 84, 0.55]]) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, hgt, 56, 1, true), hazeMat(al));
    cyl.scale.set(bw / 2 + k, 1, bh / 2 + k); cyl.position.y = hgt / 2 - 1.5; cyl.renderOrder = -10;
    scene.add(noAO(cyl));
  }

  // ---- spawn gates (one per road) and core light: placed by setMap ----
  const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a1c).multiplyScalar(2.0) });
  const gates: { group: THREE.Group; arch: THREE.Mesh; light: THREE.PointLight; pool: THREE.Mesh }[] = [];
  const makeGate = () => {
    const gate = new THREE.Group();
    const arch = noAO(new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.07, 8, 48), gm));
    arch.rotation.y = Math.PI / 2; arch.position.y = 1.3;
    gate.add(arch);
    const veil = noAO(new THREE.Mesh(new THREE.CircleGeometry(1.65, 32), new THREE.MeshBasicMaterial({ color: 0x3a0c06, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })));
    veil.rotation.y = Math.PI / 2; veil.position.y = 1.3;
    gate.add(veil);
    for (const sgn of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.6, 0.8), steel); p.position.set(0, 1.6, sgn * 2.05); p.castShadow = true; gate.add(p);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 1.0), steel); cap.position.set(0, 3.5, sgn * 2.05); cap.castShadow = true; gate.add(cap);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 4.9), steel); lintel.position.y = 3.8; lintel.castShadow = true; gate.add(lintel);
    scene.add(gate);
    const light = new THREE.PointLight(0xff5a28, 55, 15, 2);
    scene.add(light);
    const pool = noAO(lightPool(5.5, 0xff5020, 0.5)); scene.add(pool);
    return { group: gate, arch, light, pool };
  };
  const coreLight = new THREE.PointLight(0x58dbe6, 80, 20, 2);
  scene.add(coreLight);
  const corePool = noAO(lightPool(8, 0x2fb6c4, 0.42)); scene.add(corePool);

  let current: unknown = null;
  /** Re-dress the deck for a map: road and plate textures, gates, core light. */
  const setMap = (map: GameMap) => {
    if (current === map.def) return;
    if (current !== null) {
      const m = board.material as THREE.MeshStandardMaterial;
      for (const t of [m.map, m.emissiveMap, m.normalMap, m.roughnessMap]) t?.dispose();
      Object.assign(m, boardTextures(map));
      m.needsUpdate = true;
    }
    current = map.def;
    map.lanes.forEach((lane, i) => {
      const g = gates[i] || (gates[i] = makeGate());
      const a0 = lane.pts[0], b0 = lane.pts[1], L = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1;
      const dx = (b0[0] - a0[0]) / L, dz = (b0[1] - a0[1]) / L, x = a0[0] + dx * 2.8, z = a0[1] + dz * 2.8;
      g.group.visible = g.light.visible = g.pool.visible = true;
      g.group.position.set(x, 0, z); g.group.rotation.y = Math.atan2(-dz, dx);
      g.light.position.set(x + dx * 1.6, 1.8, z + dz * 1.6);
      g.pool.position.set(x + dx * 1.8, 0.03, z + dz * 1.8);
    });
    for (let i = map.lanes.length; i < gates.length; i++) gates[i].group.visible = gates[i].light.visible = gates[i].pool.visible = false;
    coreLight.position.set(map.core.x, 4.2, map.core.z);
    corePool.position.set(map.core.x, 0.03, map.core.z);
  };
  setMap(new GameMap(DEFAULT_MAP));

  const update = (time: number) => {
    for (const s of city.signs) {
      const f = 0.86 + Math.sin(time * 1.3 + s.phase) * 0.08 + (Math.sin(time * 23 + s.phase * 3) > 0.985 ? -0.35 : 0);
      s.mat.color.copy(s.base).multiplyScalar(f);
    }
    coreLight.intensity = 80 * (0.92 + Math.sin(time * 2.1) * 0.08);
    for (const g of gates) { g.light.intensity = 55 * (0.9 + Math.sin(time * 3) * 0.1); g.arch.scale.setScalar(1 + Math.sin(time * 3) * 0.03); }
  };
  return { sun, update, setMap };
}
