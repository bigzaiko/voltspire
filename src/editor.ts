// Map editor on the hex board: draw roads along the hex lines, set their height levels, place the core,
// scenery and starting towers, set starting conditions, then save / share / test-play the result.
// DOM is built with createElement + textContent only; anything read from storage or a share code goes
// through sanitizeMap / decodeMap. The styles (editor.css) are linked from play.html.
import { GW, GH, TOWERS, TOWER_TYPES, ORES, ORE_TYPES, ITEMS } from './game/data.ts';
import type { TowerType, OreType } from './game/data.ts';
import { CELL, HEX_SIZE, cellX, cellZ, worldToCell, neighbor, hexDist, lineDir, lineCells, disc, inBoard } from './game/hex.ts';
import { GameMap, validateMap, sanitizeMap, encodeMap, decodeMap, MAX_ORE } from './game/map.ts';
import type { MapDef, LanePoint, OreLayout } from './game/map.ts';
import { checkResources, autoOre } from './game/deposits.ts';
import type { ResourceCheck } from './game/deposits.ts';
import { MAPS } from './game/maps.ts';
import { generateMap } from './game/mapgen.ts';
import { drawMap, drawRoads, drawDeposits, hexPath, outlinePath, boardCells, ORE_INK } from './game/mapdraw.ts';
import type { Proj } from './game/mapdraw.ts';

export interface EditorHost { play(def: MapDef): void; close(): void; sound(name: string): void }
const KEY = 'beatspire-maps';
const OLD_KEY = 'voltspire-maps'; // the game's earlier name; still read so saved maps carry over
const MAX_SAVED = 24;

export function loadCustomMaps(): MapDef[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.slice(0, MAX_SAVED).map(sanitizeMap).filter((m): m is MapDef => !!m) : [];
  } catch { return []; }
}
export function saveCustomMaps(maps: MapDef[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(maps.slice(0, MAX_SAVED))); } catch { /* storage unavailable */ }
}

// ---------- draft model ----------
type Pt = [number, number];
/** A road corner: column, row, height level 0..3. */
type RP = [number, number, number];
interface Draft {
  name: string; tier: number; gold: number; lives: number; core: Pt;
  lanes: RP[][]; // always 3 entries, possibly empty
  blocked: Set<number>; towers: Map<number, TowerType>;
  /** the map's own deposits by tile, or null: laid out by the rules when the run starts (see deposits.ts) */
  ore: Map<number, OreType> | null;
}
type Tool = 'r0' | 'r1' | 'r2' | 'level' | 'core' | 'block' | 'erase' | 'tower' | 'ore';
/** What the Resources tool paints: a deposit kind, or nothing (the eraser). */
type Brush = OreType | 'none';

const M = 2; // tiles of spawn margin drawn around the board
const PAD = 0.5; // world units of air around the margin
const MAX_PTS = 48, MAX_BLOCKED = 240, MAX_TOWERS = 30, MAX_LEVEL = 3, END_R = 2;
const LANE_COL = ['#e3dc92', '#f68b56', '#7fb8ad'];
const BRIDGE_RULE = 'Roads can only cross as a bridge: raise one of them at the crossing';
// The part of the world the canvas shows.
const MIN_X = cellX(-M, 0) - CELL / 2 - PAD, MAX_X = cellX(GW + M - 1, 1) + CELL / 2 + PAD;
const MIN_Z = cellZ(-M) - HEX_SIZE - PAD, MAX_Z = cellZ(GH + M - 1) + HEX_SIZE + PAD;
const VW = MAX_X - MIN_X, VH = MAX_Z - MIN_Z;
const MARGIN_CELLS: Pt[] = [];
for (let cz = -M; cz < GH + M; cz++) for (let cx = -M; cx < GW + M; cx++) if (!inBoard(cx, cz)) MARGIN_CELLS.push([cx, cz]);

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const idx = (cx: number, cz: number) => cz * GW + cx;
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] === b[0] && a[1] === b[1];
const cellKey = (cx: number, cz: number) => (cz + 16) * 128 + cx + 16;
const neighbors6 = (cx: number, cz: number): Pt[] => [0, 1, 2, 3, 4, 5].map((dd) => neighbor(cx, cz, dd));

function blankDraft(): Draft {
  return { name: 'Untitled sector', tier: 2, gold: 220, lives: 20, core: [22, 10], lanes: [[], [], []], blocked: new Set(), towers: new Map(), ore: null };
}
function draftFrom(def: MapDef): Draft {
  const d = blankDraft();
  d.name = def.name.slice(0, 28); d.tier = clamp(Math.round(def.tier) || 2, 1, 3);
  d.gold = clamp(Math.round(def.gold) || 220, 50, 3000); d.lives = clamp(Math.round(def.lives) || 20, 1, 60);
  d.core = [clamp(Math.round(def.core[0]), 1, GW - 2), clamp(Math.round(def.core[1]), 1, GH - 2)];
  def.lanes.slice(0, 3).forEach((l, i) => {
    const out: RP[] = [];
    for (const p of l.slice(0, MAX_PTS)) {
      const q: RP = [clamp(Math.round(p[0]), -3, GW + 2), clamp(Math.round(p[1]), -3, GH + 2), clamp(Math.round(p[2] || 0), 0, MAX_LEVEL)];
      if (!out.length || !same(out[out.length - 1], q)) out.push(q);
    }
    d.lanes[i] = out;
  });
  for (const [cx, cz] of def.blocked) if (inBoard(cx, cz) && d.blocked.size < MAX_BLOCKED) d.blocked.add(idx(cx, cz));
  for (const t of def.towers) {
    if (!inBoard(t.cx, t.cz) || d.towers.size >= MAX_TOWERS || !TOWER_TYPES.includes(t.t)) continue;
    const k = idx(t.cx, t.cz);
    if (!d.blocked.has(k) && !d.towers.has(k)) d.towers.set(k, t.t); // the game skips towers on scenery and duplicate cells
  }
  if (def.ore) {
    d.ore = new Map();
    for (const o of ORE_TYPES) for (const p of def.ore[o] || []) {
      if (!Array.isArray(p) || !Number.isInteger(p[0]) || !Number.isInteger(p[1]) || !inBoard(p[0], p[1]) || d.ore.size >= MAX_ORE) continue;
      const k = idx(p[0], p[1]);
      if (!d.ore.has(k)) d.ore.set(k, o);
    }
  }
  return d;
}
const hasContent = (d: Draft) => d.lanes.some((l) => l.length > 0) || d.blocked.size > 0 || d.towers.size > 0 || !!d.ore?.size;
// Same character set sanitizeMap keeps in names, so the name on screen is always the name that gets stored.
const NAME_BAD = /[^\p{L}\p{M}\p{N} .,'!?·:()\-]/gu;
const filterName = (v: string) => v.replace(NAME_BAD, '').slice(0, 28);
const sigOf = (m?: MapDef | null) => { try { return m ? encodeMap(m) : ''; } catch { return ''; } };
function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 17).replace(/-+$/, '') || 'map';
}
// The draft being worked on is also written to storage, so a reload or a closed tab does not throw it away.
const DRAFT_KEY = 'beatspire-draft';
let draftTimer = 0;
function storeDraft(d: Draft): void {
  clearTimeout(draftTimer); draftTimer = 0;
  try {
    if (!hasContent(d)) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: d.name, tier: d.tier, gold: d.gold, lives: d.lives, core: d.core, lanes: d.lanes, blocked: [...d.blocked], towers: [...d.towers], ore: d.ore ? [...d.ore] : null }));
  } catch { /* storage unavailable: the draft still lives for this visit */ }
}
/** The stored draft, or null. Storage is outside input like any other: shapes are checked here, values are clamped by draftFrom. */
function readDraft(): Draft | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const tile = (v: unknown): v is number => num(v) && Number.isInteger(v) && v >= 0 && v < GW * GH;
    const point = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 2 && v.length <= 3 && v.every(num);
    if (!point(o.core) || !Array.isArray(o.lanes)) return null;
    const lanes = o.lanes.slice(0, 3).map((l: unknown) => (Array.isArray(l) ? l.slice(0, MAX_PTS).filter(point).map((q): LanePoint => [q[0], q[1], q[2] || 0]) : []));
    const blocked = (Array.isArray(o.blocked) ? o.blocked : []).slice(0, MAX_BLOCKED).filter(tile).map((k): [number, number] => [k % GW, Math.floor(k / GW)]);
    const towers: MapDef['towers'] = [];
    for (const t of (Array.isArray(o.towers) ? o.towers : []).slice(0, MAX_TOWERS)) {
      if (Array.isArray(t) && tile(t[0]) && typeof t[1] === 'string' && (TOWER_TYPES as readonly string[]).includes(t[1])) towers.push({ t: t[1] as TowerType, cx: t[0] % GW, cz: Math.floor(t[0] / GW) });
    }
    let ore: OreLayout | undefined;
    if (Array.isArray(o.ore)) {
      ore = {};
      for (const e of o.ore.slice(0, MAX_ORE)) {
        if (!Array.isArray(e) || !tile(e[0]) || !(ORE_TYPES as readonly unknown[]).includes(e[1])) continue;
        (ore[e[1] as OreType] || (ore[e[1] as OreType] = [])).push([e[0] % GW, Math.floor(e[0] / GW)]);
      }
    }
    const d = draftFrom({
      id: 'draft', name: typeof o.name === 'string' ? filterName(o.name) : '', desc: '', tier: num(o.tier) ? o.tier : 2,
      lanes, core: [o.core[0], o.core[1]], gold: num(o.gold) ? o.gold : 220, lives: num(o.lives) ? o.lives : 20, towers, blocked, ...(ore ? { ore } : {}),
    });
    if (!d.name.trim()) d.name = 'Untitled sector';
    return hasContent(d) ? d : null;
  } catch { return null; }
}
const linked = (l: RP[], core: Pt) => l.length > 1 && hexDist(l[l.length - 1][0], l[l.length - 1][1], core[0], core[1]) <= END_R;
/** Levels as the game will see them: a road that reaches the core arrives on deck level. */
function shown(l: RP[], core: Pt): RP[] {
  if (!linked(l, core) || !l[l.length - 1][2]) return l;
  return l.map((p, k) => (k === l.length - 1 ? [p[0], p[1], 0] : p));
}
/** The draft's own deposits as an ore field (tiles under a road, the core, scenery or a tower left out), or undefined. */
function oreOf(d: Draft, occ?: Uint8Array): OreLayout | undefined {
  if (!d.ore) return undefined;
  const out: OreLayout = {};
  for (const o of ORE_TYPES) {
    const list = [...d.ore].filter(([k, v]) => v === o && (!occ || !occ[k]) && !d.blocked.has(k) && !d.towers.has(k)).map(([k]) => k).sort((a, b) => a - b);
    if (list.length) out[o] = list.map((k) => [k % GW, Math.floor(k / GW)] as Pt);
  }
  return out;
}
/** `occ` (road/core tiles) hides scenery, towers and deposits that are currently covered; they stay in the draft. */
function draftToDef(d: Draft, lanes: RP[][], occ?: Uint8Array): MapDef {
  const ore = oreOf(d, occ);
  return {
    id: 'custom-' + slug(d.name), name: d.name.trim() || 'Custom map', desc: 'Custom map', tier: d.tier,
    lanes: lanes.map((l) => l.map((p, k) => (p[2] && k < l.length - 1 ? [p[0], p[1], p[2]] : [p[0], p[1]]) as LanePoint)),
    core: [d.core[0], d.core[1]], gold: d.gold, lives: d.lives,
    towers: [...d.towers].filter(([k]) => !occ || !occ[k]).map(([k, t]) => ({ t, cx: k % GW, cz: Math.floor(k / GW) })),
    blocked: [...d.blocked].filter((k) => !occ || !occ[k]).map((k) => [k % GW, Math.floor(k / GW)] as Pt),
    ...(ore ? { ore } : {}),
  };
}
/** Every tile a stretch passes over, both ends included. Falls back to sampling when it leaves the hex lines. */
function stretchCells(a: ArrayLike<number>, b: ArrayLike<number>): Pt[] {
  if (lineDir(a[0], a[1], b[0], b[1]) >= 0) return lineCells(a[0], a[1], b[0], b[1]);
  const out: Pt[] = [[a[0], a[1]]];
  const ax = cellX(a[0], a[1]), az = cellZ(a[1]), bx = cellX(b[0], b[1]), bz = cellZ(b[1]);
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
  for (let s = 1; s <= n; s++) { const c = worldToCell(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n); if (!same(out[out.length - 1], c)) out.push(c); }
  return out;
}
/** The tiles of a whole road in order, with the height at each. */
function roadCells(l: RP[]): { cx: number; cz: number; h: number }[] {
  const out: { cx: number; cz: number; h: number }[] = [];
  for (let i = 1; i < l.length; i++) {
    const cells = stretchCells(l[i - 1], l[i]), n = cells.length - 1;
    for (let k = out.length ? 1 : 0; k <= n; k++) out.push({ cx: cells[k][0], cz: cells[k][1], h: n ? l[i - 1][2] + ((l[i][2] - l[i - 1][2]) * k) / n : l[i][2] });
  }
  return out;
}

// ---------- tiny DOM helpers (no HTML strings anywhere) ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(cls: string, text: string, onClick: () => void, label?: string) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

let dispose: (() => void) | null = null;
// These outlive a single openEditor call, so closing the editor never throws work away.
let lastDraft: Draft | null = null; // the draft being edited when the editor was last open
let lastFrom = '';                  // signature of the map that draft was opened from / last test-played as
let prevDraft: Draft | null = null; // one step of history: the draft replaced by New / template / Load / Import / Generate
let genSeed = 0;                    // last generator seed and tier, kept between visits
let genTier = 2;

export function openEditor(root: HTMLElement, host: EditorHost, initial?: MapDef): void {
  if (dispose) dispose();
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  let flashTimer = 0;
  let statusNote: { text: string; bad: boolean } | null = null; // a flash message shown in the status bar (see flash)

  // Reopening without a map, or with the map this draft came from / was test-played as, resumes the draft.
  const from = sigOf(initial);
  let d: Draft;
  let resumed = false;
  // On the first visit after a page load the draft comes back from storage, unless another map was asked for.
  const kept = lastDraft ? null : readDraft();
  if (lastDraft && (!initial || from === lastFrom)) { d = lastDraft; resumed = hasContent(d); }
  else if (kept && (!initial || kept.name === initial.name.slice(0, 28))) { d = kept; resumed = true; }
  else {
    const old = lastDraft || kept;
    if (old && hasContent(old)) prevDraft = old;
    d = initial ? draftFrom(initial) : blankDraft();
  }
  lastDraft = d; lastFrom = from;
  if (!genSeed) genSeed = 1 + Math.floor(Math.random() * 999999);
  let tool: Tool = 'r0';
  let towerType: TowerType = TOWER_TYPES[0];
  let brush: Brush = 'iron_ore';
  let res: ResourceCheck | null = null; // the deposits and crates a run would start with, and what the validator says about them
  let resDef: MapDef | null = null;     // the map those were worked out for
  let occ = new Uint8Array(GW * GH); // 1 = road or core
  let problem: string | null = 'x';
  let clean: MapDef | null = null;
  let saved = loadCustomMaps();
  let confirmSave = false;
  let confirmDelete = -1;
  let visBlocked = 0, visTowers = 0; // scenery / towers not hidden under a road or the core
  let clashes: Pt[] = []; // tiles where two stretches meet on the same level
  let bridges = 0;
  let sel: { l: number; i: number } | null = null; // corner picked with the Level tool
  let lastLane = 0;
  let hover: Pt | null = null;
  let painting = false;
  let lastPaint: Pt | null = null;
  let dpr = 1;
  const P: Proj = { u: 10, x0: 0, z0: 0 };

  const sfx = (n: string) => { try { host.sound(n); } catch { /* sound is optional */ } };

  // ---------- model operations ----------
  function recompute() {
    const lanes = d.lanes.filter((l) => l.length > 0);
    const m = new GameMap(draftToDef({ ...d, blocked: new Set(), towers: new Map() }, lanes));
    occ = m.grid;
    for (const l of lanes) if (l.length === 1 && inBoard(l[0][0], l[0][1])) occ[idx(l[0][0], l[0][1])] = 1;
    // Scenery and towers under a road or the core are only hidden (not drawn, not exported), never deleted:
    // dragging the core across the board or undoing a road point brings them back.
    visBlocked = 0; visTowers = 0;
    for (const k of d.blocked) if (!occ[k]) visBlocked++;
    for (const [k] of d.towers) if (!occ[k]) visTowers++;
    findCrossings();
    validate(lanes);
    checkRes(lanes);
  }
  /** Deposits and crates as a run on this draft would start, checked (see deposits.ts). Needs a road with a stretch. */
  function checkRes(lanes: RP[][]) {
    res = null; resDef = null;
    const roads = lanes.filter((l) => l.length > 1);
    if (!roads.length) return;
    try {
      resDef = clean || draftToDef(d, roads, occ);
      res = checkResources(resDef);
    } catch { res = null; resDef = null; }
  }
  /** The deposit shown on a tile: the draft's own, or the automatic one. */
  const oreAt = (k: number): OreType | undefined => (d.ore ? d.ore.get(k) : res ? ORE_TYPES[res.ore[k] - 1] : undefined);
  const crateAt = (k: number) => !!res && res.crates.some((c) => idx(c.cx, c.cz) === k);
  /** The draft's own deposits, starting from the automatic layout the first time a brush touches them. */
  function ownOre(): Map<number, OreType> {
    if (!d.ore) {
      d.ore = new Map();
      if (res) for (let k = 0; k < GW * GH; k++) if (res.ore[k]) d.ore.set(k, ORE_TYPES[res.ore[k] - 1]);
    }
    return d.ore;
  }
  function paintOre(k: number, b: Brush, quiet: boolean) {
    if (b === 'none' ? !oreAt(k) : oreAt(k) === b) return;
    const m = ownOre();
    if (b === 'none') m.delete(k);
    else {
      if (!m.has(k) && m.size >= MAX_ORE) { if (!quiet) flash(`At most ${MAX_ORE} deposit tiles.`, true); return; }
      m.set(k, b);
    }
    if (!quiet) sfx(b === 'none' ? 'sell' : 'build');
    changed();
  }
  /** A copy of the draft (for the changes "Restore previous draft" can undo). */
  const copyDraft = (x: Draft): Draft => ({ ...x, core: [x.core[0], x.core[1]], lanes: x.lanes.map((l) => l.map((p) => [p[0], p[1], p[2]] as RP)), blocked: new Set(x.blocked), towers: new Map(x.towers), ore: x.ore ? new Map(x.ore) : null });
  function autoPlace() {
    if (!resDef) { flash('Draw a road first: the deposits are laid out around it.', true); return; }
    const lay = autoOre({ ...resDef, ore: undefined }), nd = copyDraft(d);
    nd.ore = new Map();
    for (const o of ORE_TYPES) for (const [cx, cz] of lay[o] || []) nd.ore.set(idx(cx, cz), o);
    sfx('card'); setDraft(nd, 'Resources laid out by the rules. Paint to adjust them.');
  }
  function clearOre() {
    if (!d.ore) { flash('The resources are already automatic.'); return; }
    const nd = copyDraft(d); nd.ore = null;
    sfx('sell'); setDraft(nd, 'Resources are automatic again: the rules lay them out when the run starts.');
  }
  /** Two stretches may share a tile only with a full level between them, or next to the core where roads meet. */
  function findCrossings() {
    clashes = []; bridges = 0;
    const seen = new Map<number, { lane: number; at: number; h: number }[]>();
    const bad = new Set<number>(), over = new Set<number>();
    d.lanes.forEach((raw, lane) => {
      roadCells(shown(raw, d.core)).forEach((c, at) => {
        if (hexDist(c.cx, c.cz, d.core[0], d.core[1]) <= END_R) return;
        const k = cellKey(c.cx, c.cz), prev = seen.get(k);
        if (prev) for (const q of prev) {
          if (q.lane === lane && at - q.at < 2) continue;
          if (Math.abs(q.h - c.h) < 1) { if (!bad.has(k)) { bad.add(k); clashes.push([c.cx, c.cz]); } } else over.add(k);
        }
        if (prev) prev.push({ lane, at, h: c.h }); else seen.set(k, [{ lane, at, h: c.h }]);
      });
    });
    for (const k of over) if (!bad.has(k)) bridges++;
  }
  /** Drop hidden entries for good. Only used to make room when a limit is reached. */
  function pruneHidden() {
    for (const k of [...d.blocked]) if (occ[k]) d.blocked.delete(k);
    for (const k of [...d.towers.keys()]) if (occ[k]) d.towers.delete(k);
  }
  function validate(lanes: RP[][]) {
    clean = null;
    if (!lanes.length) { problem = 'Draw Road 1: pick a tile in the dim margin outside the board for the spawn, then work towards the core.'; return; }
    // The spawn gate is a large building. On the board it would stand on tiles the player can build on.
    for (let i = 0; i < 3; i++) {
      const l = d.lanes[i];
      if (l.length && inBoard(l[0][0], l[0][1])) { problem = `Road ${i + 1} must start in the dim margin outside the board, where its spawn gate has room.`; return; }
    }
    const bare = { ...d, blocked: new Set<number>(), towers: new Map<number, TowerType>() };
    const each = d.lanes.map((l) => (l.length ? validateMap(draftToDef(bare, [l])) : null));
    const say = (i: number, msg: string) => {
      if (msg.includes('end next to the core')) return `Road ${i + 1} must end next to the core. Finish it within two tiles of the core.`;
      return 'Road ' + (i + 1) + msg.slice(6);
    };
    // a stretch off the hex lines first, then crossings, then everything else
    for (let i = 0; i < 3; i++) { const msg = each[i]; if (msg && msg.includes('hex grid')) { problem = say(i, msg); return; } }
    if (clashes.length) { problem = BRIDGE_RULE; return; }
    for (let i = 0; i < 3; i++) { const msg = each[i]; if (msg && msg.startsWith('Road 1')) { problem = say(i, msg); return; } }
    const def = draftToDef(d, lanes, occ);
    problem = validateMap(def);
    if (problem) return;
    clean = sanitizeMap(def);
    if (!clean) problem = 'This map has values that are out of range.';
  }
  const free = (cx: number, cz: number) => inBoard(cx, cz) && !occ[idx(cx, cz)];
  const inView = (cx: number, cz: number) => cx >= -M && cx < GW + M && cz >= -M && cz < GH + M;
  /** The tile on one of the six hex lines through `prev` that is closest to the pointed tile. */
  function snap(prev: ArrayLike<number>, cx: number, cz: number): Pt {
    if (prev[0] === cx && prev[1] === cz) return [cx, cz];
    const dx = cellX(cx, cz) - cellX(prev[0], prev[1]), dz = cellZ(cz) - cellZ(prev[1]);
    const dir = ((Math.round(Math.atan2(dz, dx) / (Math.PI / 3)) % 6) + 6) % 6, a = (dir * Math.PI) / 3;
    const n = Math.max(1, Math.round((dx * Math.cos(a) + dz * Math.sin(a)) / CELL));
    let c: Pt = [prev[0], prev[1]];
    for (let i = 0; i < n; i++) { const nx = neighbor(c[0], c[1], dir); if (!inView(nx[0], nx[1])) break; c = nx; }
    return c;
  }
  const laneOf = (t: Tool) => (t === 'r0' ? 0 : t === 'r1' ? 1 : t === 'r2' ? 2 : -1);

  function addPoint(li: number, cx: number, cz: number) {
    const l = d.lanes[li];
    if (l.length >= MAX_PTS) { flash(`A road can have at most ${MAX_PTS} corners.`, true); return; }
    let p: RP = [cx, cz, 0];
    if (!l.length && inBoard(cx, cz)) { flash('Start the road in the dim margin outside the board.', true); return; }
    if (l.length) {
      const prev = l[l.length - 1], s = snap(prev, cx, cz);
      if (same(s, prev)) return;
      p = [s[0], s[1], prev[2]]; // a new corner carries on at the level of the one before
    }
    l.push(p); sfx('build'); changed();
  }
  function undoPoint(li: number) {
    if (!d.lanes[li].length) { sfx('error'); return; }
    d.lanes[li].pop(); sfx('sell'); changed();
  }
  function eraseAt(cx: number, cz: number, quiet: boolean) {
    if (!inBoard(cx, cz)) return;
    const k = idx(cx, cz);
    const a = d.blocked.delete(k), b = d.towers.delete(k), c = !!d.ore && d.ore.delete(k); // all three, never short-circuit
    if (a || b || c) { if (!quiet) sfx('sell'); changed(); }
  }
  // ---------- levels ----------
  /** The corner the level controls act on: the one picked with the Level tool, or the last corner of the road being drawn. */
  function target(): { l: number; i: number } | null {
    if (tool === 'level') return sel && d.lanes[sel.l][sel.i] ? sel : null;
    const li = laneOf(tool);
    return li >= 0 && d.lanes[li].length ? { l: li, i: d.lanes[li].length - 1 } : null;
  }
  const levelAt = (t: { l: number; i: number }) => shown(d.lanes[t.l], d.core)[t.i][2];
  function setLevel(v: number) {
    const t = target();
    if (!t) { flash(tool === 'level' ? 'Pick a road corner first.' : 'Place a corner first.', true); return; }
    const l = d.lanes[t.l];
    if (t.i === l.length - 1 && linked(l, d.core)) { flash('A road reaches the core on deck level.', true); return; }
    const nv = clamp(v, 0, MAX_LEVEL);
    if (nv === l[t.i][2]) { if (v !== nv) sfx('error'); return; }
    l[t.i][2] = nv; sfx('click'); changed();
  }
  const nudgeLevel = (by: number) => { const t = target(); setLevel((t ? levelAt(t) : 0) + by); };
  /** What the Level tool finds on a tile: an existing corner, or a stretch where a corner can be added. */
  function pickRoad(cx: number, cz: number): { l: number; i: number; insert: boolean; h: number } | null {
    const order = [lastLane, 0, 1, 2].filter((v, k, a) => a.indexOf(v) === k);
    for (const l of order) { const i = d.lanes[l].findIndex((p) => p[0] === cx && p[1] === cz); if (i >= 0) return { l, i, insert: false, h: d.lanes[l][i][2] }; }
    for (const l of order) {
      const lane = d.lanes[l];
      for (let i = 1; i < lane.length; i++) {
        if (lineDir(lane[i - 1][0], lane[i - 1][1], lane[i][0], lane[i][1]) < 0) continue;
        const cells = stretchCells(lane[i - 1], lane[i]), k = cells.findIndex((c) => c[0] === cx && c[1] === cz);
        if (k > 0) return { l, i, insert: true, h: Math.round(lane[i - 1][2] + ((lane[i][2] - lane[i - 1][2]) * k) / (cells.length - 1)) };
      }
    }
    return null;
  }
  function levelClick(cx: number, cz: number) {
    const hit = pickRoad(cx, cz);
    if (!hit) { flash('Pick a road corner, or a road tile to add a corner there.', true); return; }
    if (hit.insert) {
      if (d.lanes[hit.l].length >= MAX_PTS) { flash(`A road can have at most ${MAX_PTS} corners.`, true); return; }
      d.lanes[hit.l].splice(hit.i, 0, [cx, cz, hit.h]);
      sel = { l: hit.l, i: hit.i }; lastLane = hit.l; sfx('build'); changed(); return;
    }
    if (sel && sel.l === hit.l && sel.i === hit.i) { setLevel((levelAt(sel) + 1) % (MAX_LEVEL + 1)); return; } // a second click steps the level up
    sel = { l: hit.l, i: hit.i }; lastLane = hit.l; sfx('click'); refresh();
  }
  /** A corner in the middle of a straight run can go without bending the road. */
  function canRemove(t: { l: number; i: number } | null) {
    if (!t) return false;
    const l = d.lanes[t.l];
    return t.i > 0 && t.i < l.length - 1 && lineDir(l[t.i - 1][0], l[t.i - 1][1], l[t.i + 1][0], l[t.i + 1][1]) >= 0;
  }
  function removeCorner() {
    const t = target();
    if (!t || !canRemove(t)) { sfx('error'); return; }
    d.lanes[t.l].splice(t.i, 1); sel = null; sfx('sell'); changed();
  }
  /** Apply the active tool to a tile. `drag` is true for tiles reached by dragging. */
  function apply(cx: number, cz: number, drag: boolean) {
    const li = laneOf(tool);
    if (li >= 0) { if (!drag) addPoint(li, cx, cz); return; }
    if (tool === 'level') { if (!drag) levelClick(cx, cz); return; }
    if (tool === 'core') {
      const nx = clamp(cx, 1, GW - 2), nz = clamp(cz, 1, GH - 2);
      if (nx === d.core[0] && nz === d.core[1]) return;
      d.core = [nx, nz]; if (!drag) sfx('build'); changed(); return;
    }
    if (tool === 'erase') { eraseAt(cx, cz, drag); return; }
    if (!inBoard(cx, cz)) { if (!drag) flash('That is outside the board.', true); return; }
    const k = idx(cx, cz);
    if (occ[k]) { if (!drag) flash('Roads and the core must stay clear.', true); return; }
    if (tool === 'ore') {
      if (d.blocked.has(k) || d.towers.has(k)) { if (!drag) flash('Deposits lie on free deck: not under scenery or a tower.', true); return; }
      if (crateAt(k) && brush !== 'none') { if (!drag) flash('A supply crate stands on this tile when the run starts.', true); return; }
      paintOre(k, brush, drag); return;
    }
    if (tool === 'block') {
      if (d.blocked.has(k)) return;
      if (d.towers.has(k)) { if (!drag) flash('There is a tower on that tile. Erase it first.', true); return; }
      if (d.blocked.size >= MAX_BLOCKED) pruneHidden();
      if (d.blocked.size >= MAX_BLOCKED) { if (!drag) flash(`At most ${MAX_BLOCKED} blocked tiles.`, true); return; }
      d.blocked.add(k); if (!drag) sfx('build'); changed(); return;
    }
    if (tool === 'tower' && !drag) {
      if (d.blocked.has(k)) { flash('That tile is blocked. Erase it first.', true); return; }
      if (d.towers.get(k) === towerType) return;
      if (!d.towers.has(k) && d.towers.size >= MAX_TOWERS) pruneHidden();
      if (!d.towers.has(k) && d.towers.size >= MAX_TOWERS) { flash(`At most ${MAX_TOWERS} starting towers.`, true); return; }
      d.towers.set(k, towerType); sfx('build'); changed();
    }
  }
  /** Replace the whole draft. The one being replaced is kept so "Restore previous draft" can bring it back. */
  function setDraft(nd: Draft, note: string, keepPrev = true) {
    const old = d;
    if (keepPrev && old !== nd && hasContent(old)) prevDraft = old;
    d = nd; lastDraft = nd; confirmSave = false; hover = null; sel = null; lastLane = 0;
    nameIn.value = d.name; goldIn.value = String(d.gold); livesIn.value = String(d.lives);
    changed();
    flash(keepPrev && prevDraft === old ? note + ' "Restore previous draft" undoes this.' : note);
  }
  function restorePrev() {
    if (!prevDraft) { sfx('error'); return; }
    const back = prevDraft, cur = d;
    prevDraft = hasContent(cur) ? cur : null; // swap, so the restore itself can be undone
    sfx('click'); setDraft(back, 'Previous draft restored.', false);
    if (prevDraft) restoreBtn.focus(); else canvas.focus({ preventScroll: true });
  }

  // ---------- UI skeleton ----------
  root.replaceChildren();
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Map editor');

  // header
  const head = el('div', 'ed-head');
  head.appendChild(el('h2', 'ed-title', 'Map editor'));
  const nameWrap = el('label', 'ed-name');
  nameWrap.appendChild(el('span', 'ed-lab', 'Name'));
  const nameIn = el('input', 'ed-in');
  nameIn.type = 'text'; nameIn.maxLength = 28; nameIn.value = d.name; nameIn.spellcheck = false; nameIn.autocomplete = 'off';
  nameIn.setAttribute('aria-label', 'Map name');
  // Characters sanitizeMap would strip are removed as they are typed, so two names that look different never collide.
  nameIn.addEventListener('input', (e) => {
    if (!(e as InputEvent).isComposing) {
      const v = nameIn.value, ok = filterName(v);
      if (ok !== v) {
        const caret = filterName(v.slice(0, nameIn.selectionStart ?? v.length)).length;
        nameIn.value = ok;
        try { nameIn.setSelectionRange(caret, caret); } catch { /* caret is cosmetic */ }
        flash('Names can use letters, digits, spaces and . , \' ! ? : ( ) -', true);
      }
    }
    d.name = filterName(nameIn.value); confirmSave = false; changed();
  });
  const settleName = () => { // on blur / Enter / end of IME input: show exactly what will be stored
    const v = filterName(nameIn.value).trim() || 'Custom map';
    if (v !== nameIn.value || v !== d.name) { nameIn.value = v; d.name = v; confirmSave = false; changed(); }
  };
  nameIn.addEventListener('change', settleName);
  nameIn.addEventListener('blur', settleName);
  nameIn.addEventListener('compositionend', () => { d.name = filterName(nameIn.value); changed(); });
  nameWrap.appendChild(nameIn);
  head.appendChild(nameWrap);
  const status = el('div', 'ed-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  head.appendChild(status);
  const headBtns = el('div', 'ed-headbtns');
  const playBtn = button('btn small', 'Test play', () => { if (clean) { sfx('click'); lastFrom = sigOf(clean); host.play(clean); } });
  const saveBtn = button('btn small ghost', 'Save', () => save(false));
  const overwrite = el('span', 'ed-confirm hidden');
  overwrite.append(button('btn small', 'Overwrite', () => save(true)), button('btn small ghost', 'Cancel', () => { confirmSave = false; sfx('click'); refresh(); saveBtn.focus(); }));
  const backBtn = button('btn small ghost', 'Back to menu', () => { sfx('click'); host.close(); });
  headBtns.append(playBtn, saveBtn, overwrite, backBtn);
  head.appendChild(headBtns);

  // body
  const body = el('div', 'ed-body');

  // tools (left)
  const toolsPanel = el('div', 'panel ed-tools');
  toolsPanel.appendChild(el('h3', '', 'Tools'));
  const TOOLS: { id: Tool; name: string; key: string; col: string }[] = [
    { id: 'r0', name: 'Road 1', key: '1', col: LANE_COL[0] },
    { id: 'r1', name: 'Road 2', key: '2', col: LANE_COL[1] },
    { id: 'r2', name: 'Road 3', key: '3', col: LANE_COL[2] },
    { id: 'level', name: 'Level', key: 'L', col: '#c9b27a' },
    { id: 'core', name: 'Core', key: 'C', col: '#efe9d6' },
    { id: 'block', name: 'Block', key: 'B', col: '#8a7f70' },
    { id: 'erase', name: 'Erase', key: 'E', col: '#ce6b44' },
    { id: 'tower', name: 'Start tower', key: 'T', col: '#6fe0c8' },
    { id: 'ore', name: 'Resources', key: 'R', col: ORE_INK.iron_ore.rim },
  ];
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  const toolMeta = new Map<Tool, HTMLElement>();
  const toolList = el('div', 'ed-toollist');
  toolList.setAttribute('role', 'toolbar'); toolList.setAttribute('aria-label', 'Editing tools');
  for (const t of TOOLS) {
    const b = el('button', 'ed-tool'); b.type = 'button';
    b.style.setProperty('--c', t.col);
    b.setAttribute('aria-label', `${t.name} tool (hotkey ${t.key})`);
    b.appendChild(el('i', 'ed-sw'));
    b.appendChild(el('span', 'ed-tname', t.name));
    const meta = el('span', 'ed-tmeta', ''); b.appendChild(meta); toolMeta.set(t.id, meta);
    b.appendChild(el('kbd', '', t.key));
    b.addEventListener('click', () => setTool(t.id));
    toolBtns.set(t.id, b); toolList.appendChild(b);
  }
  toolsPanel.appendChild(toolList);
  // context: road actions
  const roadCtx = el('div', 'ed-ctx');
  const roadInfo = el('p', 'small muted', '');
  const roadBtns = el('div', 'ed-pair');
  const undoBtn = button('btn small ghost', 'Undo corner', () => { const li = laneOf(tool); if (li >= 0) undoPoint(li); }, 'Undo last road corner (Backspace)');
  const clearBtn = button('btn small ghost', 'Clear road', () => { const li = laneOf(tool); if (li >= 0 && d.lanes[li].length) { d.lanes[li] = []; sfx('sell'); changed(); } });
  roadBtns.append(undoBtn, clearBtn);
  roadCtx.append(roadInfo, roadBtns);
  // context: height level of a corner (shown for the road tools and the Level tool)
  const levelCtx = el('div', 'ed-ctx');
  const levelInfo = el('p', 'small muted', '');
  const levelRow = el('div', 'ed-level');
  levelRow.setAttribute('role', 'group'); levelRow.setAttribute('aria-label', 'Height level of the corner');
  const lowerBtn = button('chip', '-', () => nudgeLevel(-1), 'Lower the corner one level (hotkey [)');
  const raiseBtn = button('chip', '+', () => nudgeLevel(1), 'Raise the corner one level (hotkey ])');
  const levelBtns: HTMLButtonElement[] = [];
  levelRow.appendChild(lowerBtn);
  for (let v = 0; v <= MAX_LEVEL; v++) { const b = button('chip ed-lv', String(v), () => setLevel(v), `Set level ${v}`); levelBtns.push(b); levelRow.appendChild(b); }
  levelRow.appendChild(raiseBtn);
  const levelKeys = el('p', 'small muted ed-keys');
  levelKeys.append(el('kbd', '', '['), el('kbd', '', ']'), el('span', '', 'lower / raise'));
  const removeBtn = button('btn small ghost', 'Remove corner', () => removeCorner(), 'Remove the picked corner');
  levelCtx.append(levelInfo, levelRow, levelKeys, removeBtn);
  // context: tower type
  const towerCtx = el('div', 'ed-ctx');
  const towerInfo = el('p', 'small muted', '');
  const towerGrid = el('div', 'ed-towers');
  towerGrid.setAttribute('role', 'radiogroup'); towerGrid.setAttribute('aria-label', 'Starting tower type');
  const towerBtns = new Map<TowerType, HTMLButtonElement>();
  for (const t of TOWER_TYPES) {
    const b = el('button', 'ed-tw'); b.type = 'button';
    b.style.setProperty('--c', hex(TOWERS[t].color));
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', TOWERS[t].name);
    b.appendChild(el('i', 'ed-sw'));
    b.appendChild(el('span', '', TOWERS[t].name));
    b.addEventListener('click', () => { towerType = t; sfx('click'); refresh(); draw(); });
    towerBtns.set(t, b); towerGrid.appendChild(b);
  }
  towerCtx.append(towerInfo, towerGrid);
  // context: resource brush
  const oreCtx = el('div', 'ed-ctx');
  const oreInfo = el('p', 'small muted', '');
  const oreGrid = el('div', 'ed-towers ed-ores');
  oreGrid.setAttribute('role', 'radiogroup'); oreGrid.setAttribute('aria-label', 'Resource brush');
  const BRUSHES: { id: Brush; name: string; col: string }[] = [
    ...ORE_TYPES.map((o) => ({ id: o as Brush, name: ORES[o].name, col: ORE_INK[o].rim })),
    { id: 'none', name: 'Eraser', col: 'transparent' },
  ];
  const brushBtns = new Map<Brush, HTMLButtonElement>();
  for (const b of BRUSHES) {
    const btn = el('button', 'ed-tw' + (b.id === 'none' ? ' eraser' : '')); btn.type = 'button';
    btn.style.setProperty('--c', b.col);
    btn.setAttribute('role', 'radio'); btn.setAttribute('aria-label', b.id === 'none' ? 'Eraser: remove deposits' : `Paint ${b.name.toLowerCase()}`);
    btn.appendChild(el('i', 'ed-sw'));
    btn.appendChild(el('span', '', b.name));
    btn.addEventListener('click', () => { brush = b.id; sfx('click'); refresh(); draw(); });
    brushBtns.set(b.id, btn); oreGrid.appendChild(btn);
  }
  const oreKeys = el('p', 'small muted ed-keys');
  oreKeys.append(el('kbd', '', 'R'), el('span', '', 'next brush · right-click erases'));
  oreCtx.append(oreInfo, oreGrid, oreKeys);
  const otherCtx = el('div', 'ed-ctx');
  const otherInfo = el('p', 'small muted', '');
  otherCtx.appendChild(otherInfo);
  toolsPanel.append(roadCtx, levelCtx, towerCtx, oreCtx, otherCtx);

  // stage (centre)
  const centre = el('div', 'ed-centre');
  const stage = el('div', 'ed-stage');
  const canvas = el('canvas', 'ed-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Hex map. Click or use arrow keys and Enter to apply the selected tool.');
  stage.appendChild(canvas);
  const foot = el('div', 'ed-foot');
  const hint = el('span', 'ed-hint', '');
  const coord = el('span', 'ed-coord', '');
  foot.append(hint, coord);
  centre.append(stage, foot);

  // side (right)
  const side = el('div', 'ed-side');

  const props = el('div', 'panel');
  props.appendChild(el('h3', '', 'Start conditions'));
  function numField(parent: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) {
    const row = el('label', 'ed-row');
    row.appendChild(el('span', '', label));
    const inp = el('input', 'ed-in ed-num');
    inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(get());
    inp.setAttribute('aria-label', `${label} (${min} to ${max})`);
    inp.addEventListener('input', () => { const v = Number(inp.value); if (inp.value !== '' && Number.isFinite(v)) set(clamp(Math.round(v), min, max)); });
    inp.addEventListener('change', () => { inp.value = String(get()); });
    row.appendChild(inp);
    parent.appendChild(row);
    return inp;
  }
  const edited = (set: (v: number) => void) => (v: number) => { set(v); confirmSave = false; changed(); };
  const goldIn = numField(props, 'Starting credits', 50, 3000, 10, () => d.gold, edited((v) => { d.gold = v; }));
  const livesIn = numField(props, 'Core integrity', 1, 60, 1, () => d.lives, edited((v) => { d.lives = v; }));
  const TIER_NAMES = ['Simple', 'Tricky', 'Complex'];
  function tierSeg(parent: HTMLElement, label: string, aria: string, names: string[], pick: (tier: number) => void) {
    const row = el('div', 'ed-row col');
    row.appendChild(el('span', '', label));
    const seg = el('div', 'ed-seg');
    seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', aria);
    const btns = names.map((n, i) => {
      const b = button('chip', n, () => pick(i + 1));
      b.setAttribute('role', 'radio'); seg.appendChild(b);
      return b;
    });
    row.appendChild(seg); parent.appendChild(row);
    return btns;
  }
  const tierBtns = tierSeg(props, 'Complexity', 'Complexity tier', TIER_NAMES.map((n, i) => `${i + 1} ${n}`), (v) => { d.tier = v; sfx('click'); changed(); });

  // resources: automatic or hand-placed, the count per kind, and what the validator says
  const resPanel = el('div', 'panel ed-res');
  const resHead = el('h3', '', 'Resources');
  const resMode = el('p', 'small muted ed-resmode', '');
  const resCounts = el('div', 'ed-rescounts');
  const resCount = new Map<OreType, HTMLElement>();
  for (const o of ORE_TYPES) {
    const c = el('span', 'ed-rescount');
    c.style.setProperty('--c', ORE_INK[o].rim);
    c.title = ORES[o].name;
    c.appendChild(el('i', 'ed-sw'));
    const n = el('b', '', '0'); c.appendChild(n); resCount.set(o, n);
    resCounts.appendChild(c);
  }
  const resBtns = el('div', 'ed-pair');
  const autoBtn = button('btn small ghost', 'Auto-place', () => autoPlace(), 'Auto-place resources by the rules (they can then be painted)');
  const clearOreBtn = button('btn small ghost', 'Clear to automatic', () => clearOre(), 'Drop the hand-placed resources: the rules lay them out when the run starts');
  resBtns.append(autoBtn, clearOreBtn);
  const resList = el('ul', 'ed-reslist');
  resList.setAttribute('aria-live', 'polite');
  resPanel.append(resHead, resMode, resCounts, resBtns, resList);

  const start = el('div', 'panel');
  start.appendChild(el('h3', '', 'Start from'));
  const tplRow = el('div', 'ed-seg wrap');
  tplRow.appendChild(button('chip', 'New (blank)', () => { sfx('click'); setDraft(blankDraft(), 'Blank map.'); }, 'New blank map'));
  for (const m of MAPS) tplRow.appendChild(button('chip', m.name, () => { sfx('click'); const nd = draftFrom(m); nd.name = (m.name + ' remix').slice(0, 28); setDraft(nd, `Template "${m.name}" loaded.`); }, `Start from template ${m.name}`));
  start.appendChild(tplRow);
  const restoreBtn = button('btn small ghost ed-restore hidden', 'Restore previous draft', () => restorePrev(), 'Restore the draft that was replaced');
  start.appendChild(restoreBtn);

  // generator
  const gen = el('div', 'panel');
  gen.appendChild(el('h3', '', 'Generate'));
  const genTierBtns = tierSeg(gen, 'Tier', 'Tier of the generated map', TIER_NAMES.map((n, i) => `${i + 1} ${n}`), (v) => { genTier = v; sfx('click'); refresh(); });
  const seedRow = el('div', 'ed-row ed-seedrow');
  const seedLab = el('label', 'ed-seedlab');
  seedLab.appendChild(el('span', '', 'Seed'));
  const seedIn = el('input', 'ed-in ed-num');
  seedIn.type = 'number'; seedIn.min = '0'; seedIn.max = '999999'; seedIn.step = '1'; seedIn.value = String(genSeed);
  seedIn.setAttribute('aria-label', 'Generator seed (0 to 999999)');
  const readSeed = () => { const v = Number(seedIn.value); genSeed = seedIn.value !== '' && Number.isFinite(v) ? clamp(Math.round(v), 0, 999999) : genSeed; };
  seedIn.addEventListener('input', readSeed, sig);
  seedIn.addEventListener('change', () => { readSeed(); seedIn.value = String(genSeed); }, sig);
  seedIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); generate(); } }, sig);
  seedLab.appendChild(seedIn);
  const dice = button('chip ed-dice', '', () => { genSeed = 1 + Math.floor(Math.random() * 999999); seedIn.value = String(genSeed); sfx('click'); }, 'Roll a random seed');
  dice.appendChild(el('i', 'ed-die'));
  dice.title = 'Random seed';
  seedRow.append(seedLab, dice);
  gen.appendChild(seedRow);
  gen.appendChild(button('btn small ghost', 'Generate map', () => generate(), 'Generate a map from this tier and seed'));

  const savedPanel = el('div', 'panel');
  const savedTitle = el('h3', '', 'Saved maps');
  const savedList = el('div', 'ed-saved');
  savedPanel.append(savedTitle, savedList);

  const share = el('div', 'panel');
  share.appendChild(el('h3', '', 'Share'));
  const copyBtn = button('btn small ghost', 'Copy share code', () => copyCode());
  const outTa = el('textarea', 'ed-in ed-ta hidden');
  outTa.readOnly = true; outTa.rows = 2; outTa.spellcheck = false; outTa.setAttribute('aria-label', 'Share code for this map');
  const inTa = el('textarea', 'ed-in ed-ta');
  inTa.rows = 2; inTa.spellcheck = false; inTa.placeholder = 'Paste a share code...'; inTa.maxLength = 20000; inTa.setAttribute('aria-label', 'Share code to import');
  const importBtn = button('btn small ghost', 'Import from code', () => importCode());
  const shareMsg = el('p', 'small ed-sharemsg', '');
  shareMsg.setAttribute('role', 'status'); shareMsg.setAttribute('aria-live', 'polite');
  share.append(copyBtn, outTa, inTa, importBtn, shareMsg);

  side.append(props, resPanel, start, gen, savedPanel, share);
  body.append(toolsPanel, centre, side);
  root.append(head, body);

  // ---------- actions ----------
  function flash(text: string, bad = false) {
    if (bad) sfx('error');
    hint.textContent = text; hint.classList.toggle('bad', bad); hint.classList.add('flash');
    // A phone in landscape has no room for the foot line. The message borrows the status bar for as long instead.
    statusNote = foot.offsetParent === null ? { text, bad } : null;
    if (statusNote) refresh();
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      hint.classList.remove('flash', 'bad'); hint.textContent = toolHint();
      if (statusNote) { statusNote = null; refresh(); }
    }, 2600);
  }
  function toolHint() {
    const li = laneOf(tool);
    if (li >= 0) return d.lanes[li].length
      ? 'Click to add a corner. Stretches snap to the six hex directions. End within two tiles of the core. Right-click or Backspace undoes.'
      : 'Click a tile in the dim margin outside the board to place the spawn gate of this road.';
    if (tool === 'level') return 'Click a corner to pick it, click again to step its level. Click a road tile to add a corner. Right-click lowers.';
    if (tool === 'core') return 'Click or drag to move the core (seven tiles). Every road has to end within two tiles of it.';
    if (tool === 'block') return 'Click or drag to paint scenery that cannot be built on. Right-click erases.';
    if (tool === 'erase') return 'Click or drag to remove blocked tiles, starting towers and hand-placed deposits.';
    if (tool === 'ore') return brush === 'none' ? 'Click or drag to remove deposits. The first stroke turns the automatic layout into your own.'
      : `Click or drag to paint ${ORES[brush].name.toLowerCase()} on free deck. Right-click erases. R picks the next brush.`;
    return 'Click a free tile to place the selected tower. Right-click erases.';
  }
  function cancelDelete() { if (confirmDelete !== -1) { confirmDelete = -1; renderSaved(); } }
  function setTool(t: Tool) {
    cancelDelete();
    if (tool === 'tower' && t === 'tower') towerType = TOWER_TYPES[(TOWER_TYPES.indexOf(towerType) + 1) % TOWER_TYPES.length];
    if (tool === 'ore' && t === 'ore') brush = BRUSHES[(BRUSHES.findIndex((b) => b.id === brush) + 1) % BRUSHES.length].id;
    if (laneOf(t) >= 0) lastLane = laneOf(t);
    // coming from a road tool, the Level tool starts on the corner that was just placed
    if (t === 'level' && laneOf(tool) >= 0 && d.lanes[laneOf(tool)].length) sel = { l: laneOf(tool), i: d.lanes[laneOf(tool)].length - 1 };
    tool = t; sfx('click'); refresh(); draw();
  }
  function generate() {
    readSeed(); seedIn.value = String(genSeed);
    let def: MapDef | null = null;
    try { def = generateMap(genSeed, genTier); } catch { def = null; }
    if (!def) { flash('The generator could not build a map from that seed. Try another one.', true); return; }
    sfx('card');
    setDraft(draftFrom(def), `Generated a tier ${genTier} map from seed ${genSeed}.`);
  }
  function save(force: boolean) {
    if (!clean) { sfx('error'); return; }
    const at = saved.findIndex((m) => m.name.toLowerCase() === clean!.name.toLowerCase());
    if (at >= 0 && !force) { confirmSave = true; sfx('click'); refresh(); (overwrite.querySelector('button') as HTMLButtonElement | null)?.focus(); return; }
    if (at < 0 && saved.length >= MAX_SAVED) { flash(`The saved list is full (${MAX_SAVED}). Delete a map first.`, true); return; }
    if (at >= 0) saved[at] = clean; else saved.unshift(clean);
    saveCustomMaps(saved);
    // Verify by content, not by name: an overwrite that failed still leaves the old map under the same name.
    const want = JSON.stringify(clean);
    const back = loadCustomMaps();
    const ok = back.some((m) => JSON.stringify(m) === want);
    saved = ok ? back : saved;
    confirmSave = false; confirmDelete = -1;
    if (ok) { sfx('card'); flash(`Saved "${clean.name}".`); } else flash('Could not write to browser storage. The map is kept for this session only.', true);
    refresh(); renderSaved();
  }
  function setShareMsg(text: string, bad: boolean) { shareMsg.textContent = text; shareMsg.classList.toggle('bad', bad); shareMsg.classList.toggle('ok', !bad); }
  function copyCode() {
    if (!clean) { sfx('error'); return; }
    const code = encodeMap(clean);
    outTa.value = code; outTa.classList.remove('hidden');
    const fallback = () => {
      outTa.focus(); outTa.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch { done = false; }
      setShareMsg(done ? 'Share code copied.' : 'Code selected. Press Ctrl+C to copy it.', false);
    };
    sfx('click');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(() => setShareMsg('Share code copied to the clipboard.', false), fallback);
      else fallback();
    } catch { fallback(); }
  }
  function importCode() {
    const text = inTa.value.trim();
    if (!text) { sfx('error'); setShareMsg('Paste a share code first.', true); return; }
    const def = decodeMap(text);
    if (!def) { sfx('error'); setShareMsg('That code is not a valid BEATSPIRE map.', true); return; }
    inTa.value = ''; outTa.classList.add('hidden');
    sfx('card'); setDraft(draftFrom(def), `Imported "${def.name}".`);
    setShareMsg(`Imported "${def.name}".`, false);
  }

  // ---------- refresh (DOM state) ----------
  // Rebuilt only when the saved list or a pending delete changes, never from the generic refresh().
  function renderSaved(focus?: { row: number; btn: 'del' | 'keep' }) {
    let target: HTMLButtonElement | null = null;
    savedTitle.textContent = `Saved maps · ${saved.length}/${MAX_SAVED}`;
    savedList.replaceChildren();
    if (!saved.length) { savedList.appendChild(el('p', 'small muted', 'Nothing saved yet. Maps are stored in this browser.')); return; }
    saved.forEach((m, i) => {
      const row = el('div', 'ed-savedrow');
      const cv = el('canvas', 'ed-thumb'); cv.width = 180; cv.height = 136; cv.setAttribute('aria-hidden', 'true');
      drawMap(cv, m);
      const info = el('div', 'ed-savedinfo');
      info.appendChild(el('b', '', m.name));
      info.appendChild(el('span', 'small muted', `${m.lanes.length} road${m.lanes.length > 1 ? 's' : ''} · tier ${m.tier} · ${m.gold} cr`));
      const btns = el('div', 'ed-savedbtns');
      btns.appendChild(button('chip', 'Load', () => { sfx('click'); setDraft(draftFrom(m), `Loaded "${m.name}".`); }, `Load ${m.name}`));
      if (confirmDelete === i) {
        // "Keep" takes the place (and the focus) of "Delete": a double click or a second Enter never deletes.
        const keep = button('chip', 'Keep', () => { confirmDelete = -1; sfx('click'); renderSaved({ row: i, btn: 'del' }); }, `Keep ${m.name}`);
        const yes = button('chip danger', 'Really?', () => {
          saved.splice(i, 1); saveCustomMaps(saved); confirmDelete = -1; sfx('sell'); flash(`Deleted "${m.name}".`);
          renderSaved(); canvas.focus({ preventScroll: true });
        }, `Confirm deleting ${m.name}`);
        btns.append(keep, yes);
        if (focus && focus.row === i && focus.btn === 'keep') target = keep;
      } else {
        const del = button('chip', 'Delete', () => { confirmDelete = i; sfx('click'); renderSaved({ row: i, btn: 'keep' }); }, `Delete ${m.name}`);
        btns.appendChild(del);
        if (focus && focus.row === i && focus.btn === 'del') target = del;
      }
      info.appendChild(btns);
      row.append(cv, info);
      savedList.appendChild(row);
    });
    (target as HTMLButtonElement | null)?.focus(); // once, from the click that asked for it
  }
  function refresh() {
    const ok = !problem;
    if (!ok) confirmSave = false;
    const ask = confirmSave && !!clean;
    const note = false;
    status.textContent = ask ? `"${clean!.name}" is already saved. Overwrite it?`
      : ok ? 'Ready to play' : problem;
    status.classList.toggle('ok', ok && !ask && !note); status.classList.toggle('note', note); status.classList.toggle('bad', !ok || ask);
    if (statusNote && !ask) {
      status.textContent = statusNote.text;
      status.classList.remove('ok'); status.classList.toggle('note', !statusNote.bad); status.classList.toggle('bad', statusNote.bad);
    }
    playBtn.disabled = !ok; saveBtn.disabled = !ok; copyBtn.disabled = !ok;
    saveBtn.classList.toggle('hidden', confirmSave);
    overwrite.classList.toggle('hidden', !confirmSave);
    for (const [id, b] of toolBtns) { b.classList.toggle('on', id === tool); b.setAttribute('aria-pressed', String(id === tool)); }
    for (let i = 0; i < 3; i++) {
      const l = d.lanes[i], meta = toolMeta.get((['r0', 'r1', 'r2'] as Tool[])[i])!;
      const done = linked(l, d.core);
      meta.textContent = !l.length ? (i ? 'optional' : 'empty') : done ? 'linked' : `${l.length} pt${l.length > 1 ? 's' : ''}`;
      meta.classList.toggle('ok', done);
    }
    toolMeta.get('level')!.textContent = clashes.length ? 'crossing' : bridges ? `${bridges} bridge${bridges > 1 ? 's' : ''}` : '';
    toolMeta.get('level')!.classList.toggle('warn', clashes.length > 0);
    toolMeta.get('block')!.textContent = visBlocked ? String(visBlocked) : '';
    toolMeta.get('tower')!.textContent = visTowers ? String(visTowers) : '';
    const issues = res ? res.problems.length : 0;
    // (the label is long: the count alone, as "! 2", with the words in the tooltip)
    toolMeta.get('ore')!.textContent = issues ? `! ${issues}` : d.ore ? 'own' : 'auto';
    toolMeta.get('ore')!.title = issues ? `${issues} resource issue${issues > 1 ? 's' : ''}` : '';
    toolMeta.get('ore')!.classList.toggle('warn', issues > 0);
    const li = laneOf(tool);
    roadCtx.classList.toggle('hidden', li < 0);
    levelCtx.classList.toggle('hidden', li < 0 && tool !== 'level');
    towerCtx.classList.toggle('hidden', tool !== 'tower');
    oreCtx.classList.toggle('hidden', tool !== 'ore');
    otherCtx.classList.toggle('hidden', li >= 0 || tool === 'tower' || tool === 'level' || tool === 'ore');
    if (li >= 0) {
      const n = d.lanes[li].length;
      roadInfo.textContent = n ? `Road ${li + 1}: ${n} of ${MAX_PTS} corners.` : `Road ${li + 1} is empty${li ? ' (optional)' : ''}. Start outside the board.`;
      undoBtn.disabled = !n; clearBtn.disabled = !n;
    }
    const t = target(), lv = t ? levelAt(t) : -1;
    const fixed = !!t && t.i === d.lanes[t.l].length - 1 && linked(d.lanes[t.l], d.core);
    levelInfo.textContent = !t ? (tool === 'level' ? 'No corner picked. Click a corner, or a road tile to add one.' : 'Level of the next stretch: place a corner first.')
      : fixed ? `Road ${t.l + 1} ends here on deck level.`
      : tool === 'level' ? `Road ${t.l + 1}, ${t.i ? 'corner ' + t.i : 'spawn gate'}: level ${lv}.`
      : `Last corner: level ${lv}. New corners carry on at this level.`;
    levelBtns.forEach((b, v) => { b.classList.toggle('on', v === lv); b.setAttribute('aria-pressed', String(v === lv)); b.disabled = !t || fixed; });
    lowerBtn.disabled = !t || fixed || lv <= 0; raiseBtn.disabled = !t || fixed || lv >= MAX_LEVEL;
    removeBtn.classList.toggle('hidden', tool !== 'level');
    removeBtn.disabled = !canRemove(t);
    towerInfo.textContent = `Built when the run starts, fully stocked (${visTowers}/${MAX_TOWERS}). Press T to cycle.`;
    for (const [b, btn] of brushBtns) { btn.classList.toggle('on', b === brush); btn.setAttribute('aria-checked', String(b === brush)); }
    oreInfo.textContent = d.ore ? 'Your own deposits: they go into the map as painted.' : 'Automatic: the rules lay these out when the run starts. Painting makes them your own.';
    // the resources panel
    const counts = new Map<OreType, number>(ORE_TYPES.map((o) => [o, 0]));
    if (res) for (let k = 0; k < GW * GH; k++) if (res.ore[k]) { const o = ORE_TYPES[res.ore[k] - 1]; counts.set(o, counts.get(o)! + 1); }
    for (const [o, n] of resCount) n.textContent = String(counts.get(o));
    const crates = res ? res.crates.length : 0;
    resMode.textContent = !res ? 'Laid out once a road is drawn.'
      : (d.ore ? 'Hand-placed' : 'Automatic, by the rules') + ` · ${crates} supply crate${crates === 1 ? '' : 's'}`;
    resHead.classList.toggle('warn', issues > 0);
    autoBtn.disabled = !resDef; clearOreBtn.disabled = !d.ore;
    resList.replaceChildren();
    if (res && !issues) resList.appendChild(el('li', 'ok', 'Every crate has iron within a short belt, coal on its side of the road, and the map has all four kinds.'));
    if (res) res.problems.forEach((msg) => resList.appendChild(el('li', 'bad', msg)));
    for (const [tt, b] of towerBtns) { b.classList.toggle('on', tt === towerType); b.setAttribute('aria-checked', String(tt === towerType)); }
    otherInfo.textContent = tool === 'core' ? 'The core is what the machines are after. It fills seven tiles and keeps one tile from the border.'
      : tool === 'block' ? `Scenery tiles: ${visBlocked} of ${MAX_BLOCKED}.` : 'Removes scenery, starting towers and hand-placed deposits. Roads are edited with their own tool.';
    tierBtns.forEach((b, i) => { b.classList.toggle('on', d.tier === i + 1); b.setAttribute('aria-checked', String(d.tier === i + 1)); });
    genTierBtns.forEach((b, i) => { b.classList.toggle('on', genTier === i + 1); b.setAttribute('aria-checked', String(genTier === i + 1)); });
    if (!hint.classList.contains('flash')) hint.textContent = toolHint();
    restoreBtn.classList.toggle('hidden', !prevDraft);
  }
  /** The draft changed: any pending delete confirmation and any share code on screen are now stale. */
  function changed() {
    cancelDelete();
    if (sel && !d.lanes[sel.l][sel.i]) sel = null;
    if (!outTa.classList.contains('hidden') || shareMsg.textContent) { outTa.value = ''; outTa.classList.add('hidden'); setShareMsg('', false); }
    recompute(); refresh(); draw();
    clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => storeDraft(d), 400);
  }

  // ---------- canvas ----------
  const ctx = canvas.getContext('2d');
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w < 10 || h < 10) return;
    const u = Math.max(3, Math.min(w / VW, h / VH));
    const cw = Math.floor(VW * u), ch = Math.floor(VH * u);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    P.u = u; P.x0 = -MIN_X * u; P.z0 = -MIN_Z * u;
    draw();
  }
  function draw() {
    const g = ctx;
    if (!g) return;
    const u = P.u, s = CELL * u, R = HEX_SIZE * u; // s = tile width in CSS pixels
    const X = (cx: number, cz: number) => P.x0 + cellX(cx, cz) * u, Z = (cz: number) => P.z0 + cellZ(cz) * u;
    const FONT = "'Barlow Condensed', system-ui, sans-serif";
    const tile = (cx: number, cz: number, k = 1) => hexPath(g, X(cx, cz), Z(cz), R * k);
    const ring = (cx: number, cz: number, col: string, k = 0.92, w = 2) => { g.beginPath(); tile(cx, cz, k); g.strokeStyle = col; g.lineWidth = w; g.stroke(); };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.shadowBlur = 0; g.setLineDash([]); g.globalAlpha = 1; g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = '#0c0a09'; g.fillRect(0, 0, VW * u, VH * u);
    // spawn margin: faint tiles with a dot each
    g.beginPath();
    for (const [cx, cz] of MARGIN_CELLS) tile(cx, cz);
    g.strokeStyle = 'rgba(227,220,146,0.07)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = 'rgba(227,220,146,0.2)';
    for (const [cx, cz] of MARGIN_CELLS) g.fillRect(X(cx, cz) - 1, Z(cz) - 1, 2, 2);
    // board
    const bg = g.createLinearGradient(0, Z(0), 0, Z(GH - 1));
    bg.addColorStop(0, '#2a231e'); bg.addColorStop(1, '#231d19');
    g.beginPath();
    for (const [cx, cz] of boardCells()) tile(cx, cz);
    g.fillStyle = bg; g.fill();
    g.strokeStyle = 'rgba(227,220,146,0.12)'; g.lineWidth = 1; g.stroke();
    // road bed (every tile a road covers) and the core footprint
    const core = disc(d.core[0], d.core[1], 1);
    const inCore = (cx: number, cz: number) => hexDist(cx, cz, d.core[0], d.core[1]) <= 1;
    g.beginPath();
    for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) if (occ[idx(cx, cz)] && !inCore(cx, cz)) tile(cx, cz);
    g.fillStyle = '#171310'; g.fill();
    g.strokeStyle = 'rgba(227,220,146,0.06)'; g.stroke();
    // blocked scenery: a raised slab with a lit top edge
    for (const k of d.blocked) {
      if (occ[k]) continue;
      const cx = k % GW, cz = Math.floor(k / GW);
      g.beginPath(); tile(cx, cz, 0.9); g.fillStyle = '#3a3029'; g.fill();
      g.beginPath(); hexPath(g, X(cx, cz), Z(cz) - s * 0.05, R * 0.62); g.fillStyle = '#4c4037'; g.fill();
    }
    // deposits: the draft's own, or (lighter, dashed rims) what the rules lay out
    let oreGrid: Uint8Array | null = res ? res.ore : null;
    if (!oreGrid && d.ore) { oreGrid = new Uint8Array(GW * GH); for (const [k, o] of d.ore) if (!occ[k] && !d.blocked.has(k) && !d.towers.has(k)) oreGrid[k] = ORE_TYPES.indexOf(o) + 1; }
    if (oreGrid) drawDeposits(g, P, oreGrid, true, !d.ore);
    g.beginPath(); outlinePath(g, P, boardCells(), inBoard);
    g.strokeStyle = 'rgba(227,220,146,0.45)'; g.lineWidth = 1.5; g.stroke();
    // core
    const activeLane = laneOf(tool);
    g.beginPath();
    for (const [cx, cz] of core) tile(cx, cz);
    g.fillStyle = '#2b2620'; g.fill();
    g.beginPath(); outlinePath(g, P, core, inCore);
    g.strokeStyle = 'rgba(239,233,214,0.8)'; g.lineWidth = 1.5; g.stroke();
    if (activeLane >= 0) {
      // where a road may end
      const zone = disc(d.core[0], d.core[1], END_R);
      g.beginPath(); outlinePath(g, P, zone, (cx, cz) => hexDist(cx, cz, d.core[0], d.core[1]) <= END_R);
      g.strokeStyle = 'rgba(169,196,108,0.5)'; g.lineWidth = 1; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]);
    }
    // roads
    const lanes = d.lanes.map((l) => shown(l, d.core));
    drawRoads(g, lanes, P, Math.max(2.5, s * 0.26), LANE_COL);
    g.lineJoin = 'round'; g.lineCap = 'round';
    // crossings on the same level
    for (const [cx, cz] of clashes) {
      ring(cx, cz, '#0c0a09', 1.02, 5); ring(cx, cz, '#ff7a4a', 1.02, 2.5);
    }
    const tgt = target();
    lanes.forEach((l, i) => {
      if (!l.length) return;
      const col = LANE_COL[i];
      // direction arrows on the longer stretches
      for (let k = 1; k < l.length; k++) {
        const ax = X(l[k - 1][0], l[k - 1][1]), az = Z(l[k - 1][1]), bx = X(l[k][0], l[k][1]), bz = Z(l[k][1]);
        const len = Math.hypot(bx - ax, bz - az);
        if (len < s * 2.9) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, ux = (bx - ax) / len, uz = (bz - az) / len, r = s * 0.2;
        g.beginPath(); g.moveTo(mx + ux * r, mz + uz * r); g.lineTo(mx - ux * r - uz * r, mz - uz * r + ux * r); g.lineTo(mx - ux * r + uz * r, mz - uz * r - ux * r); g.closePath();
        g.fillStyle = '#0c0a09'; g.strokeStyle = col; g.lineWidth = 1; g.fill(); g.stroke();
      }
      // corners: a small dot on deck level, a numbered disc when raised (or always while the Level tool is on)
      for (let k = 1; k < l.length; k++) {
        const x = X(l[k][0], l[k][1]), z = Z(l[k][1]), lv = l[k][2];
        if (lv > 0 || tool === 'level') {
          const r = Math.max(6, s * 0.33);
          g.fillStyle = lv > 0 ? col : '#0c0a09'; g.strokeStyle = lv > 0 ? '#0c0a09' : col; g.lineWidth = 1.5;
          g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = lv > 0 ? '#1a0f08' : col; g.font = `700 ${Math.max(9, Math.round(r * 1.45))}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(lv), x, z + 0.5);
        } else {
          g.fillStyle = '#0c0a09'; g.strokeStyle = col; g.lineWidth = 1.5;
          g.beginPath(); g.arc(x, z, s * 0.17, 0, Math.PI * 2); g.fill(); g.stroke();
        }
      }
      // end marker: green when linked to the core
      if (l.length > 1) {
        const e = l[l.length - 1];
        g.strokeStyle = linked(l, d.core) ? '#a9c46c' : '#ce6b44'; g.lineWidth = 2;
        g.beginPath(); g.arc(X(e[0], e[1]), Z(e[1]), s * 0.4, 0, Math.PI * 2); g.stroke();
      }
      // spawn gate, with a level tag when the road starts raised
      const gx = X(l[0][0], l[0][1]), gz = Z(l[0][1]);
      g.fillStyle = '#0c0a09'; g.beginPath(); g.arc(gx, gz, s * 0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8fd0ff'; g.beginPath(); g.arc(gx, gz, s * 0.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0c1420'; g.font = `700 ${Math.max(9, Math.round(s * 0.52))}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), gx, gz + 0.5);
      if (l[0][2] > 0 || tool === 'level') {
        const r = Math.max(5, s * 0.24), tx = gx + s * 0.42, tz = gz - s * 0.42;
        g.fillStyle = col; g.strokeStyle = '#0c0a09'; g.lineWidth = 1.5; g.beginPath(); g.arc(tx, tz, r, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#1a0f08'; g.font = `700 ${Math.max(8, Math.round(r * 1.5))}px ${FONT}`; g.fillText(String(l[0][2]), tx, tz + 0.5);
      }
    });
    // the corner the level controls act on
    if (tgt && (tool === 'level' || tgt.i > 0)) {
      const p = d.lanes[tgt.l][tgt.i];
      ring(p[0], p[1], '#0c0a09', 0.98, 4); ring(p[0], p[1], '#efe9d6', 0.98, 1.5);
    }
    // core emblem (above the road ends)
    const kx = X(d.core[0], d.core[1]), kz = Z(d.core[1]);
    g.fillStyle = '#efe9d6'; g.beginPath(); g.arc(kx, kz, s * 0.58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#100e0c'; g.beginPath(); g.arc(kx, kz, s * 0.34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#efe9d6'; g.beginPath(); g.arc(kx, kz, s * 0.14, 0, Math.PI * 2); g.fill();
    // starting towers: a socket in the tower's colour
    const tower = (cx: number, cz: number, t: TowerType, alpha: number) => {
      const c = hex(TOWERS[t].color), x = X(cx, cz), z = Z(cz);
      g.globalAlpha = alpha;
      g.beginPath(); tile(cx, cz, 0.8); g.fillStyle = '#100e0c'; g.fill(); g.strokeStyle = c; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = c;
      g.beginPath(); g.arc(x, z, s * 0.2, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    };
    for (const [k, t] of d.towers) if (!occ[k]) tower(k % GW, Math.floor(k / GW), t, 1);
    // supply crates the run starts with: a sand-coloured box with a band in the colour of what it holds
    if (res) for (const c of res.crates) {
      const x = X(c.cx, c.cz), z = Z(c.cz), w = s * 0.6, col = hex(ITEMS[c.it].color);
      if (tool === 'ore') {
        // its turret tiles: free deck beside the road within two tiles (deposits never go there)
        for (const [tx, tz] of disc(c.cx, c.cz, 2)) {
          const k = idx(tx, tz);
          if (!free(tx, tz) || d.blocked.has(k) || d.towers.has(k) || (tx === c.cx && tz === c.cz) || !neighbors6(tx, tz).some(([nx, nz]) => inBoard(nx, nz) && occ[idx(nx, nz)])) continue;
          g.beginPath(); tile(tx, tz, 0.8); g.setLineDash([2, 3]); g.strokeStyle = 'rgba(216,195,143,0.55)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
        }
      }
      g.save(); g.translate(x, z); g.rotate(-0.12);
      g.fillStyle = 'rgba(8,7,6,0.6)'; g.fillRect(-w / 2 + 1.5, -w / 2 + 2, w, w);
      g.fillStyle = '#c9a66b'; g.fillRect(-w / 2, -w / 2, w, w);
      g.fillStyle = '#e4c88f'; g.fillRect(-w / 2, -w / 2, w, w * 0.18);
      g.fillStyle = col; g.fillRect(-w / 2, -w * 0.09, w, w * 0.2);
      g.strokeStyle = '#3b2a17'; g.lineWidth = 1.2; g.strokeRect(-w / 2, -w / 2, w, w);
      g.beginPath(); g.moveTo(-w / 2, -w / 2); g.lineTo(w / 2, w / 2); g.moveTo(w / 2, -w / 2); g.lineTo(-w / 2, w / 2);
      g.strokeStyle = 'rgba(59,42,23,0.45)'; g.lineWidth = 1; g.stroke();
      g.restore();
    }
    // what the resource check complains about
    if (res) for (const a of res.at) if (a) { ring(a[0], a[1], '#0c0a09', 1.08, 5); ring(a[0], a[1], '#ff7a4a', 1.08, 2); }
    // hover / tool preview
    if (hover) {
      const [hx, hz] = hover;
      if (activeLane >= 0) {
        const l = d.lanes[activeLane], col = LANE_COL[activeLane];
        if (l.length) {
          const prev = l[l.length - 1], p = snap(prev, hx, hz);
          if (!same(p, hover)) ring(hx, hz, 'rgba(239,233,214,0.3)', 0.9, 1); // the tile pointed at, when the snap lands elsewhere
          if (!same(p, prev)) {
            g.strokeStyle = col; g.lineWidth = Math.max(2, s * 0.14); g.setLineDash([s * 0.3, s * 0.3]); g.globalAlpha = 0.9;
            g.beginPath(); g.moveTo(X(prev[0], prev[1]), Z(prev[1])); g.lineTo(X(p[0], p[1]), Z(p[1])); g.stroke();
            g.setLineDash([]); g.globalAlpha = 1;
            const ends = hexDist(p[0], p[1], d.core[0], d.core[1]) <= END_R;
            ring(p[0], p[1], '#0c0a09', 0.92, 4); ring(p[0], p[1], ends ? '#a9c46c' : col, 0.92, 2);
            // length of the stretch, next to the target
            const n = hexDist(prev[0], prev[1], p[0], p[1]), right = X(p[0], p[1]) > VW * u - s * 2.5;
            g.font = `700 ${Math.max(10, Math.round(s * 0.5))}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = right ? 'right' : 'left';
            const tx = X(p[0], p[1]) + (right ? -s * 0.75 : s * 0.75), tz = Z(p[1]) - s * 0.55;
            g.strokeStyle = '#0c0a09'; g.lineWidth = 3; g.strokeText(String(n), tx, tz); g.fillStyle = ends ? '#a9c46c' : col; g.fillText(String(n), tx, tz);
          }
        } else {
          ring(hx, hz, col);
          g.fillStyle = col; g.font = `700 ${Math.max(9, Math.round(s * 0.46))}px ${FONT}`; g.textBaseline = 'middle';
          const right = hx > GW / 2; g.textAlign = right ? 'right' : 'left';
          g.fillText('SPAWN', X(hx, hz) + (right ? -s * 0.7 : s * 0.7), Z(hz) + 0.5);
        }
      } else if (tool === 'level') {
        const hit = pickRoad(hx, hz);
        if (hit) {
          ring(hx, hz, '#0c0a09', 0.92, 4); ring(hx, hz, LANE_COL[hit.l], 0.92, 2);
          if (hit.insert) {
            // a plus: clicking adds a corner here
            const x = X(hx, hz), z = Z(hz), r = s * 0.2;
            g.strokeStyle = '#0c0a09'; g.lineWidth = 4; g.beginPath(); g.moveTo(x - r, z); g.lineTo(x + r, z); g.moveTo(x, z - r); g.lineTo(x, z + r); g.stroke();
            g.strokeStyle = '#efe9d6'; g.lineWidth = 2; g.stroke();
          }
        } else ring(hx, hz, 'rgba(239,233,214,0.3)', 0.9, 1);
      } else if (tool === 'core') {
        const c: Pt = [clamp(hx, 1, GW - 2), clamp(hz, 1, GH - 2)];
        g.beginPath(); outlinePath(g, P, disc(c[0], c[1], 1), (cx, cz) => hexDist(cx, cz, c[0], c[1]) <= 1);
        g.strokeStyle = '#efe9d6'; g.lineWidth = 2; g.stroke();
      } else if (tool === 'erase') {
        if (inBoard(hx, hz)) ring(hx, hz, '#ce6b44');
      } else if (tool === 'ore') {
        if (inBoard(hx, hz)) {
          const k = idx(hx, hz), ok = free(hx, hz) && !d.blocked.has(k) && !d.towers.has(k) && (brush === 'none' || !crateAt(k));
          if (ok && brush !== 'none') { g.globalAlpha = 0.55; g.beginPath(); tile(hx, hz, 0.9); g.fillStyle = ORE_INK[brush].rim; g.fill(); g.globalAlpha = 1; }
          ring(hx, hz, !ok ? '#ce6b44' : brush === 'none' ? '#efe9d6' : ORE_INK[brush].hi);
        }
      } else if (inBoard(hx, hz)) {
        const k = idx(hx, hz);
        const ok = free(hx, hz) && (tool === 'block' ? !d.towers.has(k) : !d.blocked.has(k));
        if (ok && tool === 'tower' && !d.towers.has(k)) tower(hx, hz, towerType, 0.6);
        ring(hx, hz, ok ? '#a9c46c' : '#ce6b44');
      }
    }
  }

  function cellAt(ev: PointerEvent | MouseEvent): Pt {
    const r = canvas.getBoundingClientRect();
    const k = r.width > 0 ? VW / r.width : 1 / P.u;
    const c = worldToCell((ev.clientX - r.left) * k + MIN_X, (ev.clientY - r.top) * k + MIN_Z);
    return [clamp(c[0], -M, GW + M - 1), clamp(c[1], -M, GH + M - 1)];
  }
  function setHover(p: Pt | null) {
    hover = p;
    if (!p) { coord.textContent = ''; return; }
    let extra = inBoard(p[0], p[1]) ? '' : ' · spawn margin';
    const li = laneOf(tool);
    if (li >= 0 && d.lanes[li].length) { const s = snap(d.lanes[li][d.lanes[li].length - 1], p[0], p[1]); p = s; extra = inBoard(s[0], s[1]) ? '' : ' · spawn margin'; }
    coord.textContent = `col ${p[0]} · row ${p[1]}${extra}`;
  }
  /** Apply a drag to every tile between the previous painted tile and this one. */
  function paintTo(p: Pt) {
    const a = lastPaint || p;
    for (const c of stretchCells(a, p).slice(1)) apply(c[0], c[1], true);
    lastPaint = p;
  }
  function secondary(p: Pt) {
    const li = laneOf(tool);
    if (li >= 0) undoPoint(li);
    else if (tool === 'level') {
      const hit = pickRoad(p[0], p[1]);
      if (hit && !hit.insert) { sel = { l: hit.l, i: hit.i }; lastLane = hit.l; setLevel(levelAt(sel) - 1); refresh(); }
    } else if (tool === 'ore') { if (inBoard(p[0], p[1]) && !occ[idx(p[0], p[1])]) paintOre(idx(p[0], p[1]), 'none', false); }
    else eraseAt(p[0], p[1], false);
  }
  // Painting tools act as soon as the pointer goes down. Tools that place one thing (a corner, a level, a tower)
  // act when it comes up, so on a touch screen you can slide to the right tile and see the preview first.
  const paints = () => tool === 'block' || tool === 'erase' || tool === 'core' || tool === 'ore';
  let downId = -1;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), sig);
  canvas.addEventListener('pointerdown', (e) => {
    const p = cellAt(e);
    setHover(p);
    if (e.button === 2) { e.preventDefault(); secondary(p); draw(); return; }
    if (e.button !== 0) return;
    cancelDelete();
    canvas.classList.remove('kb');
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    downId = e.pointerId;
    if (paints()) { painting = true; lastPaint = p; apply(p[0], p[1], false); }
    draw();
  }, sig);
  canvas.addEventListener('pointermove', (e) => {
    if (downId !== -1 && e.pointerId !== downId) return;
    const p = cellAt(e);
    if (hover && same(hover, p)) return;
    setHover(p);
    if (painting && paints()) paintTo(p);
    draw();
  }, sig);
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerId !== downId) return;
    downId = -1;
    const was = painting;
    painting = false; lastPaint = null;
    if (!was && e.button === 0) { const p = cellAt(e); setHover(p); apply(p[0], p[1], false); }
    if (e.pointerType === 'touch') setHover(null); // no pointer left over the board
    draw();
  }, sig);
  canvas.addEventListener('pointercancel', () => { downId = -1; painting = false; lastPaint = null; setHover(null); draw(); }, sig);
  canvas.addEventListener('pointerleave', () => { if (downId === -1) { setHover(null); draw(); } }, sig);
  // keyboard cursor on the grid. Left and right follow the row; up and down step to the row above or below,
  // which is always a neighbour on a hex board.
  canvas.addEventListener('keydown', (e) => {
    const mv: Record<string, Pt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const h: Pt = hover || [d.core[0], d.core[1]];
    if (mv[e.key]) {
      e.preventDefault(); canvas.classList.add('kb');
      setHover([clamp(h[0] + mv[e.key][0], -M, GW + M - 1), clamp(h[1] + mv[e.key][1], -M, GH + M - 1)]); draw();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); setHover(h); apply(h[0], h[1], false); draw();
    } else if (e.key === 'Delete') {
      e.preventDefault(); secondary(h); draw();
    }
  }, sig);

  // global hotkeys (only while the editor is visible and the user is not typing)
  window.addEventListener('keydown', (e) => {
    if (root.classList.contains('hidden') || !root.isConnected) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'Backspace') {
      const li = laneOf(tool);
      if (li >= 0) { e.preventDefault(); undoPoint(li); }
      return;
    }
    if (e.key === '[' || e.key === ']') {
      if (laneOf(tool) >= 0 || tool === 'level') { e.preventDefault(); nudgeLevel(e.key === ']' ? 1 : -1); }
      return;
    }
    const hit = TOOLS.find((x) => x.key === e.key.toUpperCase());
    if (hit) { e.preventDefault(); setTool(hit.id); }
  }, sig);

  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);
  window.addEventListener('resize', resize, sig);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!ac.signal.aborted) draw(); }).catch(() => { /* fonts are cosmetic */ });

  dispose = () => { ac.abort(); ro.disconnect(); clearTimeout(flashTimer); if (draftTimer) storeDraft(d); dispose = null; };
  // a closed tab or a reload must not lose the last edits either
  window.addEventListener('pagehide', () => { if (draftTimer) storeDraft(d); }, sig);

  changed();
  renderSaved();
  resize();
  if (resumed) flash('Picked up your draft where you left it.');
}
