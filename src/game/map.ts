// Maps are data: lanes (roads) of cell waypoints, a core, blocked tiles and starting conditions.
import { GW, GH, TOWER_TYPES, cellX, cellZ } from './data.ts';
import type { TowerType } from './data.ts';

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  /** 1 = straightforward, 2 = tricky, 3 = complex */
  tier: number;
  /** One or more roads; each is a list of [cellX, cellZ] waypoints from the spawn gate to the core. */
  lanes: [number, number][][];
  core: [number, number];
  gold: number;
  lives: number;
  towers: { t: TowerType; cx: number; cz: number }[];
  blocked: [number, number][];
}

export interface Difficulty { id: string; name: string; desc: string; hp: number; count: number; gold: number; lives: number }
export const DIFFS: Difficulty[] = [
  { id: 'easy', name: 'Recruit', desc: 'Weaker machines, more credits, a sturdier core.', hp: 0.72, count: 0.9, gold: 1.15, lives: 1.25 },
  { id: 'normal', name: 'Veteran', desc: 'The intended experience.', hp: 1, count: 1, gold: 1, lives: 1 },
  { id: 'hard', name: 'Nightmare', desc: 'Tougher, more numerous machines and a fragile core.', hp: 1.3, count: 1.15, gold: 0.92, lives: 0.6 },
];
export const diffById = (id: unknown) => DIFFS.find((d) => d.id === id) || DIFFS[1];

export interface Lane { pts: number[][]; cum: number[]; len: number }
export interface PathOut { x: number; z: number; dx: number; dz: number }

export class GameMap {
  def: MapDef;
  lanes: Lane[];
  /** 0 = free, 1 = road/core, 3 = blocked scenery. (2 is used by the sim for towers.) */
  grid = new Uint8Array(GW * GH);
  core: { x: number; z: number };

  constructor(def: MapDef) {
    this.def = def;
    this.core = { x: cellX(def.core[0]), z: cellZ(def.core[1]) };
    this.lanes = def.lanes.map((cells) => {
      const pts = cells.map(([cx, cz]) => [cellX(cx), cellZ(cz)]);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum, len: cum[cum.length - 1] };
    });
    const mark = (cx: number, cz: number, v: number) => { if (cx >= 0 && cx < GW && cz >= 0 && cz < GH) this.grid[cz * GW + cx] = v; };
    for (const [cx, cz] of def.blocked) mark(cx, cz, 3);
    for (const cells of def.lanes) for (let i = 1; i < cells.length; i++) {
      const [ax, az] = cells[i - 1], [bx, bz] = cells[i];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2));
      for (let s = 0; s <= n; s++) mark(Math.round(ax + ((bx - ax) * s) / n), Math.round(az + ((bz - az) * s) / n), 1);
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) mark(def.core[0] + dx, def.core[1] + dz, 1);
  }

  /** Position and heading at distance d along a lane. */
  pos(lane: number, d: number, out: PathOut) {
    const L = this.lanes[lane] || this.lanes[0];
    d = Math.max(0, Math.min(L.len, d));
    let i = 1;
    while (i < L.cum.length - 1 && L.cum[i] < d) i++;
    const a = L.pts[i - 1], b = L.pts[i], seg = L.cum[i] - L.cum[i - 1] || 1;
    const u = (d - L.cum[i - 1]) / seg;
    out.x = a[0] + (b[0] - a[0]) * u; out.z = a[1] + (b[1] - a[1]) * u;
    out.dx = (b[0] - a[0]) / seg; out.dz = (b[1] - a[1]) / seg;
    return out;
  }
  /** Distance along a lane nearest to a world point. */
  nearest(lane: number, x: number, z: number) {
    const L = this.lanes[lane] || this.lanes[0];
    let best = 0, bd = 1e9;
    for (let i = 1; i < L.pts.length; i++) {
      const a = L.pts[i - 1], b = L.pts[i], seg = L.cum[i] - L.cum[i - 1] || 1;
      let u = ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / (seg * seg);
      u = Math.max(0, Math.min(1, u));
      const d = Math.hypot(a[0] + (b[0] - a[0]) * u - x, a[1] + (b[1] - a[1]) * u - z);
      if (d < bd) { bd = d; best = L.cum[i - 1] + u * seg; }
    }
    return best;
  }
}

/** Why a map cannot be played, or null if it is fine. */
export function validateMap(def: MapDef): string | null {
  if (!def.lanes.length) return 'Draw at least one road.';
  for (let i = 0; i < def.lanes.length; i++) {
    const l = def.lanes[i], n = i + 1;
    if (l.length < 2) return `Road ${n} needs at least two points.`;
    let len = 0;
    for (let k = 1; k < l.length; k++) len += Math.hypot(l[k][0] - l[k - 1][0], l[k][1] - l[k - 1][1]);
    if (len < 12) return `Road ${n} is too short — make it at least 12 tiles long.`;
    const end = l[l.length - 1];
    if (Math.hypot(end[0] - def.core[0], end[1] - def.core[1]) > 2.6) return `Road ${n} must end next to the core.`;
    const s = l[0];
    if (Math.hypot(s[0] - def.core[0], s[1] - def.core[1]) < 6) return `Road ${n} starts too close to the core.`;
  }
  const m = new GameMap(def);
  let free = 0;
  for (let i = 0; i < m.grid.length; i++) if (m.grid[i] === 0) free++;
  if (free < 20) return 'Leave at least 20 free tiles to build on.';
  return null;
}

/** Turn untrusted data (a shared code, storage, or a multiplayer message) into a safe MapDef, or null. */
export function sanitizeMap(raw: unknown): MapDef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const text = (v: unknown, max: number, d: string) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} .,'!?·:()\-]/gu, '').trim().slice(0, max) : '') || d;
  const pair = (v: unknown, lo: number, hiX: number, hiZ: number, step: number): [number, number] | null => {
    if (!Array.isArray(v) || v.length < 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number' || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null;
    const inv = Math.round(1 / step);
    const q = (n: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n * inv) / inv));
    return [q(v[0], hiX), q(v[1], hiZ)];
  };
  if (!Array.isArray(r.lanes) || r.lanes.length < 1 || r.lanes.length > 3) return null;
  const lanes: [number, number][][] = [];
  for (const l of r.lanes) {
    if (!Array.isArray(l) || l.length < 2 || l.length > 48) return null;
    const pts: [number, number][] = [];
    for (const p of l) { const q = pair(p, -3, GW + 2, GH + 2, 0.1); if (!q) return null; pts.push(q); }
    lanes.push(pts);
  }
  const core = pair(r.core, 1, GW - 2, GH - 2, 1);
  if (!core) return null;
  const towers: MapDef['towers'] = [];
  if (Array.isArray(r.towers)) for (const t of r.towers.slice(0, 30)) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    const type = TOWER_TYPES.find((x) => x === o.t);
    const c = pair([o.cx, o.cz], 0, GW - 1, GH - 1, 1);
    if (type && c) towers.push({ t: type, cx: c[0], cz: c[1] });
  }
  const blocked: [number, number][] = [];
  if (Array.isArray(r.blocked)) for (const b of r.blocked.slice(0, 240)) { const c = pair(b, 0, GW - 1, GH - 1, 1); if (c) blocked.push(c); }
  const def: MapDef = {
    id: text(r.id, 24, 'custom').replace(/[^A-Za-z0-9\-]/g, '') || 'custom',
    name: text(r.name, 28, 'Custom map'), desc: text(r.desc, 90, ''),
    tier: Math.round(num(r.tier, 1, 3, 2)), lanes, core,
    gold: Math.round(num(r.gold, 50, 3000, 220)), lives: Math.round(num(r.lives, 1, 60, 20)), towers, blocked,
  };
  return validateMap(def) ? null : def;
}

export const DEFAULT_MAP: MapDef = {
  id: 'switchback', name: 'Switchback', desc: 'One long winding road. A clean place to learn the grid.', tier: 1,
  lanes: [[[-2, 3], [5, 3], [5, 13], [11, 13], [11, 5], [17, 5], [17, 13], [21, 13], [21, 8], [22.4, 8]]],
  core: [24, 8], gold: 220, lives: 20, towers: [], blocked: [],
};

/** Compact share code for a map (plain data — always passed through sanitizeMap when read). */
export function encodeMap(def: MapDef): string {
  const json = JSON.stringify({ name: def.name, lanes: def.lanes, core: def.core, gold: def.gold, lives: def.lives, towers: def.towers, blocked: def.blocked, tier: def.tier });
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeMap(code: string): MapDef | null {
  try {
    const s = code.trim().replace(/-/g, '+').replace(/_/g, '/');
    if (s.length > 20000) return null;
    return sanitizeMap(JSON.parse(decodeURIComponent(escape(atob(s)))));
  } catch { return null; }
}
