// Small 2D preview of a map (used on the map-select cards and the editor's saved list).
// Drawn like a chart-room plot: soot ground, ruled grid, roads as inked lines,
// spawn gates in the enemy's cold blue, the core as a bone-white bullseye.
import { GW, GH, TOWERS } from './data.ts';
import type { MapDef } from './map.ts';

export const MAP_INK = {
  ground: '#12100d', board: '#1f1a17', grid: 'rgba(227,220,146,0.07)', edge: 'rgba(227,220,146,0.3)',
  scenery: '#3a3029', bed: '#0c0a09', lanes: ['#e3dc92', '#f68b56', '#7fb8ad'], spawn: '#8fd0ff', core: '#efe9d6',
};

export function drawMap(cv: HTMLCanvasElement, def: MapDef) {
  const g = cv.getContext('2d');
  if (!g) return;
  const s = Math.min(cv.width / GW, cv.height / GH), ox = (cv.width - GW * s) / 2, oz = (cv.height - GH * s) / 2;
  const X = (c: number) => ox + (c + 0.5) * s, Z = (c: number) => oz + (c + 0.5) * s;
  g.shadowBlur = 0;
  g.fillStyle = MAP_INK.ground; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = MAP_INK.board; g.fillRect(ox, oz, GW * s, GH * s);
  // ruled grid every four cells
  g.strokeStyle = MAP_INK.grid; g.lineWidth = 1;
  g.beginPath();
  for (let x = 4; x < GW; x += 4) { g.moveTo(Math.round(ox + x * s) + 0.5, oz); g.lineTo(Math.round(ox + x * s) + 0.5, oz + GH * s); }
  for (let z = 4; z < GH; z += 4) { g.moveTo(ox, Math.round(oz + z * s) + 0.5); g.lineTo(ox + GW * s, Math.round(oz + z * s) + 0.5); }
  g.stroke();
  g.fillStyle = MAP_INK.scenery;
  for (const [cx, cz] of def.blocked) g.fillRect(ox + cx * s + 1, oz + cz * s + 1, s - 2, s - 2);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const trace = (l: MapDef['lanes'][number]) => {
    g.beginPath(); g.moveTo(X(l[0][0]), Z(l[0][1]));
    for (const p of l.slice(1)) g.lineTo(X(p[0]), Z(p[1]));
    g.stroke();
  };
  g.lineWidth = s * 0.95; g.strokeStyle = MAP_INK.bed;
  for (const l of def.lanes) trace(l);
  def.lanes.forEach((l, i) => { g.lineWidth = Math.max(1.5, s * 0.26); g.strokeStyle = MAP_INK.lanes[i % 3]; trace(l); });
  for (const l of def.lanes) {
    const x = Math.max(ox + s * 0.55, Math.min(ox + GW * s - s * 0.55, X(l[0][0]))), z = Math.max(oz + s * 0.55, Math.min(oz + GH * s - s * 0.55, Z(l[0][1])));
    g.fillStyle = MAP_INK.bed; g.beginPath(); g.arc(x, z, s * 0.62, 0, 7); g.fill();
    g.fillStyle = MAP_INK.spawn; g.beginPath(); g.arc(x, z, s * 0.42, 0, 7); g.fill();
  }
  for (const t of def.towers) { g.fillStyle = '#' + TOWERS[t.t].color.toString(16).padStart(6, '0'); g.fillRect(ox + t.cx * s + 2, oz + t.cz * s + 2, s - 4, s - 4); }
  // core: bullseye
  const cx = X(def.core[0]), cz = Z(def.core[1]);
  g.fillStyle = MAP_INK.bed; g.beginPath(); g.arc(cx, cz, s * 1.35, 0, 7); g.fill();
  g.strokeStyle = MAP_INK.core; g.lineWidth = Math.max(1.5, s * 0.22); g.beginPath(); g.arc(cx, cz, s * 1.0, 0, 7); g.stroke();
  g.fillStyle = MAP_INK.core; g.beginPath(); g.arc(cx, cz, s * 0.42, 0, 7); g.fill();
  // frame
  g.strokeStyle = MAP_INK.edge; g.lineWidth = 1; g.strokeRect(Math.round(ox) + 0.5, Math.round(oz) + 0.5, Math.round(GW * s) - 1, Math.round(GH * s) - 1);
}
