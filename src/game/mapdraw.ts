// Small 2D preview of a map (used on the map-select cards).
import { GW, GH, TOWERS } from './data.ts';
import type { MapDef } from './map.ts';

export function drawMap(cv: HTMLCanvasElement, def: MapDef) {
  const g = cv.getContext('2d');
  if (!g) return;
  const s = Math.min(cv.width / GW, cv.height / GH), ox = (cv.width - GW * s) / 2, oz = (cv.height - GH * s) / 2;
  const X = (c: number) => ox + (c + 0.5) * s, Z = (c: number) => oz + (c + 0.5) * s;
  g.fillStyle = '#070b16'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#101a30'; g.fillRect(ox, oz, GW * s, GH * s);
  g.fillStyle = '#2a3348';
  for (const [cx, cz] of def.blocked) g.fillRect(ox + cx * s + 1, oz + cz * s + 1, s - 2, s - 2);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const cols = ['#19e3ff', '#ffb347', '#ff2bd6'];
  def.lanes.forEach((l, i) => {
    for (const [w, c] of [[s * 0.95, '#04060c'], [s * 0.28, cols[i % 3]]] as const) {
      g.lineWidth = w; g.strokeStyle = c;
      g.beginPath(); g.moveTo(X(l[0][0]), Z(l[0][1]));
      for (const p of l.slice(1)) g.lineTo(X(p[0]), Z(p[1]));
      g.stroke();
    }
    g.fillStyle = '#ff4a3a'; g.beginPath(); g.arc(Math.max(ox + 4, Math.min(ox + GW * s - 4, X(l[0][0]))), Z(l[0][1]), s * 0.45, 0, 7); g.fill();
  });
  for (const t of def.towers) { g.fillStyle = '#' + TOWERS[t.t].color.toString(16).padStart(6, '0'); g.fillRect(ox + t.cx * s + 2, oz + t.cz * s + 2, s - 4, s - 4); }
  g.fillStyle = '#35f0ff'; g.shadowColor = '#35f0ff'; g.shadowBlur = 10;
  g.beginPath(); g.arc(X(def.core[0]), Z(def.core[1]), s * 1.1, 0, 7); g.fill();
  g.shadowBlur = 0;
}
