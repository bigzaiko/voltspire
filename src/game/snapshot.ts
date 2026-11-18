// BEATSPIRE save state for bug reports (no DOM: runs in the browser and in Node).
//
// A snapshot is the FULL state of a Sim and its Factory, enough for restoreSim() to build a Sim that continues exactly like
// the original, step for step (tools/smoke.ts proves it: snapshot, restore, step both, compare the whole state). Written as
// text: 'BSR1:' + base64url(deflate-raw(JSON)) + '.' (the dot ends the block, so a block that a mail client or the issue
// editor wrapped over several lines still reads back; whitespace inside is ignored).
//
// What is in it (JSON, short keys, version SNAP_V):
//  - o: the Sim's options (mode, players, seed, difficulty, survival, free, pause on cards); m: the map, by id when it is a
//    pre-made map or a generated 'gen-<tier>-<seed>' one that regenerates to the same thing, else the whole map definition;
//  - s: every other field the Sim keeps, taken generically (all own fields, private ones included: time, wave, credits,
//    materials, lives, level, xp, the card stacks, unlocks, modifiers, card offers, the planned next wave, the Titan, ids...),
//    so a field added later is saved without touching this file; x: the positions of its two random streams;
//  - T, E, P, Z, Q: towers, enemies, projectiles, zones and the spawn queue as column tables (see Table: the values of one
//    field side by side, a field with one value everywhere stored once, whole numbers as differences, tile positions dropped);
//  - W: the walls of fire's on / hot flags (the walls themselves are linked again from the towers);
//  - g: grid tiles that differ from what the map, the towers and the buildings give (normally none);
//  - F: the factory: its scalars (next id, items delivered), every building as a column table (inventories, output queues,
//    belt items with their positions, hands, filters, swings, tanks...), the deposit tiles that differ from the map's own,
//    and the fluid in every pipe network and the last power balance of every grid (the networks are worked out again).
// Numbers are kept exactly (JSON numbers round-trip doubles; -0, NaN and infinities are written as '#-0', '#NaN', ...):
// everything in the sim feeds what happens next, so nothing is rounded. Columns put like values side by side, so runs of
// belts with the same items compress to little; deflate does the rest.
import { Sim } from './sim.ts';
import type { Tower, Enemy, Proj, Zone, SimOpts } from './sim.ts';
import type { Fac } from './factory.ts';
import { GW, GH, cellX, cellZ, TOWERS, ENEMIES, FACS, ITEMS, CARD_BY_ID } from './data.ts';
import { GameMap, sanitizeMap } from './map.ts';
import type { MapDef } from './map.ts';
import { mapById } from './maps.ts';
import { generateMap } from './mapgen.ts';
import { mapResources } from './deposits.ts';

/** The format version inside the JSON, and the text header of a block. */
export const SNAP_V = 1;
export const SNAP_HEAD = 'BSR' + SNAP_V + ':';
/** The largest state a block may unpack to (a full board is well under 1 MB). */
export const SNAP_MAX_BYTES = 32 * 1024 * 1024;

/** A block that cannot be read: corrupt, truncated, or from a format version this build does not read. */
export class SnapError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SnapError'; }
}

type J = null | boolean | number | string | J[] | { [k: string]: J };
/** Keys never written onto an object from a block. */
const BAD_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

// ---------- values: JSON plus Set, Map, undefined and the numbers JSON cannot hold ----------
function pj(v: unknown, path: string): J {
  if (v === null) return null;
  switch (typeof v) {
    case 'number': return Number.isFinite(v) ? (Object.is(v, -0) ? '#-0' : v) : '#' + String(v);
    case 'boolean': return v;
    case 'string': return v[0] === '#' ? '#' + v : v;
    case 'undefined': return '#u';
    case 'object': {
      if (Array.isArray(v)) return v.map((x, i) => pj(x, path + '[' + i + ']'));
      if (v instanceof Set) return { '#s': [...v].map((x) => pj(x, path)) };
      if (v instanceof Map) return { '#m': [...v].map(([a, b]) => [pj(a, path), pj(b, path)]) };
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error(`snapshot: cannot save ${path} (a ${proto?.constructor?.name || 'object'})`);
      const o: Record<string, J> = {};
      for (const k of Object.keys(v)) o[k[0] === '#' ? '#' + k : k] = pj((v as Record<string, unknown>)[k], path + '.' + k);
      return o;
    }
  }
  throw new Error(`snapshot: cannot save ${path} (a ${typeof v})`);
}
function uj(v: unknown): unknown {
  if (typeof v === 'string') {
    if (v[0] !== '#') return v;
    if (v[1] === '#') return v.slice(1);
    switch (v) {
      case '#u': return undefined;
      case '#-0': return -0;
      case '#NaN': return NaN;
      case '#Infinity': return Infinity;
      case '#-Infinity': return -Infinity;
    }
    throw new SnapError(`corrupt state block: unknown value ${v.slice(0, 16)}`);
  }
  if (Array.isArray(v)) return v.map(uj);
  if (v && typeof v === 'object') {
    const ks = Object.keys(v), o = v as Record<string, unknown>;
    if (ks.length === 1 && (ks[0] === '#s' || ks[0] === '#m')) {
      const a = o[ks[0]];
      if (!Array.isArray(a)) throw new SnapError('corrupt state block: a set or map is not a list');
      if (ks[0] === '#s') return new Set(a.map(uj));
      return new Map(a.map((p) => { if (!Array.isArray(p) || p.length !== 2) throw new SnapError('corrupt state block: bad map entry'); return [uj(p[0]), uj(p[1])] as [unknown, unknown]; }));
    }
    const out: Record<string, unknown> = {};
    for (const k of ks) { const kk = k.startsWith('##') ? k.slice(1) : k; if (!BAD_KEYS.has(kk)) out[kk] = uj(o[k]); }
    return out;
  }
  return v;
}

// ---------- column tables ----------
/**
 * Objects as columns: `c` every column in order; `k` the columns with one value in every row; `d` the columns worked out
 * again on restore (the world position x, z of something on tile cx, cz, when every row has exactly that); `v` the rest,
 * one list per column ('#x': the object has no such key). A column of whole numbers is stored as differences ({'#d': [...]}:
 * ids and tiles that count up compress to almost nothing).
 */
interface Table { c: string[]; k: Record<string, J>; d?: string[]; n: number; v: Record<string, J[] | { '#d': number[] }> }
const ABSENT = '#x';
const posOf = (col: string, o: Record<string, unknown>) => (col === 'x' ? cellX(o.cx as number, o.cz as number) : cellZ(o.cz as number));
function table(rows: readonly object[], path: string): Table {
  const cols: string[] = [], seen = new Set<string>();
  for (const o of rows) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const R = rows as readonly Record<string, unknown>[];
  const t: Table = { c: cols, k: {}, n: rows.length, v: {} };
  const d: string[] = [];
  for (const c of cols) {
    if ((c === 'x' || c === 'z') && rows.length && R.every((o) => Number.isInteger(o.cx) && Number.isInteger(o.cz) && o[c] === posOf(c, o))) { d.push(c); continue; }
    const col = R.map((o, i) => (Object.hasOwn(o, c) ? pj(o[c], `${path}[${i}].${c}`) : ABSENT));
    const first = JSON.stringify(col[0]);
    if (rows.length > 1 && col.every((x) => JSON.stringify(x) === first)) { t.k[c] = col[0]; continue; }
    if (rows.length > 2 && col.every((x) => Number.isSafeInteger(x))) {
      const n = col as number[];
      t.v[c] = { '#d': n.map((x, i) => (i ? x - n[i - 1] : x)) };
    } else t.v[c] = col;
  }
  if (d.length) t.d = d;
  return t;
}
function untable<T>(t: unknown, what: string, max = 1e6): T[] {
  const bad = (why: string) => new SnapError(`corrupt state block: ${what} ${why}`);
  if (!t || typeof t !== 'object') throw bad('missing');
  const { c, k, d = [], n, v } = t as Table;
  if (!Array.isArray(c) || !c.every((x) => typeof x === 'string') || !k || typeof k !== 'object' || !Array.isArray(d) || !Number.isInteger(n) || n < 0 || n > max || !v || typeof v !== 'object') throw bad('malformed');
  const cols = new Map<string, unknown[]>();
  for (const col of c) {
    if (Object.hasOwn(k, col) || d.includes(col)) continue;
    let a: unknown = Object.hasOwn(v, col) ? v[col] : undefined;
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      const dd = (a as { '#d'?: unknown })['#d'];
      if (!Array.isArray(dd) || !dd.every((x) => Number.isSafeInteger(x))) throw bad('has a bad column');
      let acc = 0;
      a = dd.map((x: number, i: number) => (acc = i ? acc + x : x));
    }
    if (!Array.isArray(a) || a.length !== n) throw bad('has a bad column');
    cols.set(col, a);
  }
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const o: Record<string, unknown> = {};
    for (const col of c) {
      if (BAD_KEYS.has(col)) continue;
      if (d.includes(col)) { o[col] = 0; continue; } // (worked out below, once cx and cz are in; the key keeps its place)
      const x = Object.hasOwn(k, col) ? k[col] : cols.get(col)![i];
      if (x !== ABSENT) o[col] = uj(x);
    }
    for (const col of d) { if (col !== 'x' && col !== 'z') throw bad('derives an unknown column'); if (!Number.isInteger(o.cx) || !Number.isInteger(o.cz)) throw bad('has no tile'); o[col] = posOf(col, o); }
    out.push(o as T);
  }
  return out;
}

// ---------- what is saved generically, and what is not ----------
/** Sim fields saved on their own (or worked out again, or not state at all: the event queue is drained every frame). */
const SIM_SKIP: ReadonlySet<string> = new Set(['opts', 'map', 'diff', 'grid', 'factory', 'events', 'rand', 'trand', 'wallTw', 'walls', 'enemies', 'towers', 'projs', 'zones', 'queue', 'offerPushed']);
/** Factory fields saved on their own, worked out again (networks, lookups) or caches. */
const FAC_SKIP: ReadonlySet<string> = new Set(['host', 'facs', 'at', 'ore', 'wires', 'pipeNets', 'powerNets', 'byId', 'towerAt', 'pipeOf', 'powerBy', 'diagRev', 'diagCrates', 'diagMap', 'linkRev', 'linkList', 'dirty', 'rev']);

/** The decoded content of a block (see the header for the keys). */
export interface Snap {
  v: number;
  o: J; m: J; s: Record<string, J>; x: [number, number];
  T: Table; E: Table; P: Table; Z: Table; Q: Table;
  W: [number, number, boolean, boolean][];
  /** the Sim's notes on the card offers waiting (offerPushed, keyed by the offer itself): [player, offer index, value] */
  op?: [number, number, J][];
  g: [number, number][];
  F: { s: Record<string, J>; f: Table; ore: [number, number][]; pn: [J, J][]; wn: [number, number, number, number, number][] };
  /** not part of the state: the build that wrote it and when */
  meta?: { build?: string; date?: string };
}

/** The map field: a pre-made or generated map by id when its id gives back exactly this map, else the whole definition. */
function mapRef(def: MapDef): J {
  const s = JSON.stringify(def), pre = mapById(def.id);
  if (pre && JSON.stringify(pre) === s) return def.id;
  const g = /^gen-([1-3])-(\d{1,9})$/.exec(def.id);
  if (g && JSON.stringify(generateMap(+g[2], +g[1])) === s) return def.id;
  return pj(def, 'map');
}
function mapOf(m: unknown): MapDef {
  if (typeof m === 'string') {
    const pre = mapById(m);
    if (pre) return pre;
    const g = /^gen-([1-3])-(\d{1,9})$/.exec(m);
    if (g) return generateMap(+g[2], +g[1]);
    throw new SnapError(`state block names a map this build does not have: ${m.slice(0, 40)}`);
  }
  const def = sanitizeMap(uj(m));
  if (!def) throw new SnapError('corrupt state block: its map does not pass the map checks');
  return def;
}
/** The grid the map, the towers and the buildings give (what the Sim keeps in sim.grid). */
function gridOf(sim: Sim): Uint8Array {
  const g = new Uint8Array(sim.map.grid);
  for (const t of sim.towers) g[t.cz * GW + t.cx] = 2;
  for (const f of sim.factory.facs) g[f.cz * GW + f.cx] = 2;
  return g;
}
const diffs = (a: ArrayLike<number>, b: ArrayLike<number>) => { const d: [number, number][] = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push([i, a[i]]); return d; };

/** What the Sim notes per card offer still waiting (a WeakMap keyed by the offer arrays in players[].pending). */
function offerNotes(sim: Sim): [number, number, J][] {
  const wm = (sim as unknown as Record<string, unknown>).offerPushed, out: [number, number, J][] = [];
  if (!(wm instanceof WeakMap)) return out;
  sim.players.forEach((p, i) => p.pending.forEach((o, j) => { if (wm.has(o)) out.push([i, j, pj(wm.get(o), 'offerPushed')]); }));
  return out;
}
/**
 * The whole state of a Sim as plain JSON (see the header). Works the factory's networks out first if its layout changed
 * (what its next step would do anyway), so the saved pipe and power figures belong to the layout as it stands.
 */
export function snapshotOf(sim: Sim, meta?: Snap['meta']): Snap {
  const F = sim.factory, S = sim as unknown as Record<string, unknown>, FS = F as unknown as Record<string, unknown>;
  F.sync();
  const s: Record<string, J> = {};
  for (const k of Object.keys(S)) if (!SIM_SKIP.has(k)) s[k] = pj(S[k], 'sim.' + k);
  const fs: Record<string, J> = {};
  for (const k of Object.keys(FS)) if (!FAC_SKIP.has(k)) fs[k] = pj(FS[k], 'factory.' + k);
  const o: Record<string, unknown> = { ...sim.opts };
  delete o.map;
  const snap: Snap = {
    v: SNAP_V, o: pj(o, 'opts'), m: mapRef(sim.map.def), s, x: sim.rngState(),
    T: table(sim.towers, 'towers'), E: table(sim.enemies, 'enemies'), P: table(sim.projs, 'projs'), Z: table(sim.zones, 'zones'), Q: table(sim.queue, 'queue'),
    W: sim.walls.map((w) => [w.a, w.b, w.on, w.hot]),
    op: offerNotes(sim),
    g: diffs(sim.grid, gridOf(sim)),
    F: {
      s: fs, f: table(F.facs, 'facs'), ore: diffs(F.ore, mapResources(new GameMap(sim.map.def)).ore),
      pn: F.pipeNets.map((n) => [pj(n.fluid, 'pipe'), pj(n.amt, 'pipe')]),
      wn: F.powerNets.map((n) => [n.cap, n.demand, n.sat, n.potential, n.full]),
    },
  };
  if (meta) snap.meta = meta;
  return snap;
}

// ---------- checks on what a block holds (it is untrusted input: an issue body anyone can write) ----------
const kindOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : v instanceof Set ? 'set' : v instanceof Map ? 'map' : typeof v);
/**
 * True if `v`, read from a block, can stand where a fresh Sim keeps `fresh`: the same kind of value (a number a finite
 * number unless the fresh one is not), and for a plain object every field the fresh one has, for a list every entry like
 * the fresh list's first, a few levels deep. A field that is null or undefined on a fresh Sim takes any data.
 */
function fits(v: unknown, fresh: unknown, depth = 0): boolean {
  if (fresh === null || fresh === undefined) return typeof v !== 'function';
  const k = kindOf(fresh);
  if (kindOf(v) !== k) return false;
  if (k === 'number') return Number.isFinite(v) || !Number.isFinite(fresh);
  if (depth >= 4) return true;
  if (k === 'array') return !(fresh as unknown[]).length || (v as unknown[]).every((x) => fits(x, (fresh as unknown[])[0], depth + 1));
  if (k === 'object') return Object.keys(fresh as object).every((key) => fits((v as Record<string, unknown>)[key], (fresh as Record<string, unknown>)[key], depth + 1));
  return true;
}
const MODES: ReadonlySet<string> = new Set(['solo', 'coop', 'versus']);
const DIFF_IDS: ReadonlySet<string> = new Set(['easy', 'normal', 'hard']);
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const inGrid = (o: { cx: unknown; cz: unknown }) => isInt(o.cx, 0, GW - 1) && isInt(o.cz, 0, GH - 1);
const finiteRow = (o: object) => Object.values(o).every((x) => typeof x !== 'number' || Number.isFinite(x));
/** The Sim's options from a block: only the known ones, each checked (a bad one is refused, not guessed). */
function optsOf(o: Record<string, unknown>): Partial<SimOpts> {
  const bad = (k: string) => new SnapError(`corrupt state block: option ${k} is not valid`);
  if (!MODES.has(o.mode as string)) throw bad('mode');
  if (!isInt(o.players, 1, 4)) throw bad('players');
  if (!isInt(o.seed, -0x80000000, 0xffffffff)) throw bad('seed');
  if (!DIFF_IDS.has(o.diff as string)) throw bad('diff');
  for (const k of ['pauseOnCards', 'survival', 'free']) if (typeof o[k] !== 'boolean') throw bad(k);
  return { mode: o.mode as SimOpts['mode'], players: o.players, seed: o.seed, diff: o.diff as string, pauseOnCards: o.pauseOnCards as boolean, survival: o.survival as boolean, free: o.free as boolean };
}
/** Most rows a table may hold (well above anything a run reaches; a block can not make the game allocate without end). */
const ROWS_MAX = { towers: GW * GH, buildings: GW * GH, enemies: 5000, projectiles: 20000, zones: 5000, queue: 20000 };
/** The discriminating fields of every restored row: types the game knows, tiles on the board, ids, levels, lanes, lists. */
function checkRows(sim: Sim) {
  const bad = (what: string, i: number, why: string) => new SnapError(`corrupt state block: ${what} ${i} ${why}`);
  const lanes = sim.map.lanes.length;
  const ids = (rows: readonly { id: unknown }[], what: string) => { const s = new Set<unknown>(); rows.forEach((r, i) => { if (!isInt(r.id, 0, Number.MAX_SAFE_INTEGER) || s.has(r.id)) throw bad(what, i, 'has a bad or repeated id'); s.add(r.id); }); };
  const cells = (rows: readonly { cx: unknown; cz: unknown }[], what: string, used: Set<number>) => rows.forEach((r, i) => {
    if (!inGrid(r)) throw bad(what, i, 'is off the board');
    const c = (r.cz as number) * GW + (r.cx as number);
    if (used.has(c)) throw bad(what, i, 'shares its tile');
    used.add(c);
  });
  const used = new Set<number>();
  sim.towers.forEach((t, i) => { if (!Object.hasOwn(TOWERS, t.type) || !isInt(t.lvl, 1, 3) || !finiteRow(t)) throw bad('tower', i, 'is not valid'); });
  ids(sim.towers, 'tower'); cells(sim.towers, 'tower', used);
  sim.enemies.forEach((e, i) => { if (!Object.hasOwn(ENEMIES, e.type) || !isInt(e.lane, 0, lanes - 1) || !finiteRow(e)) throw bad('enemy', i, 'is not valid'); });
  ids(sim.enemies, 'enemy');
  sim.projs.forEach((p, i) => { if (!['bolt', 'shell', 'missile'].includes(p.kind) || !Array.isArray(p.hit) || !finiteRow(p)) throw bad('projectile', i, 'is not valid'); });
  sim.zones.forEach((z, i) => { if (!['burn', 'sing'].includes(z.kind) || !finiteRow(z)) throw bad('zone', i, 'is not valid'); });
  sim.queue.forEach((q, i) => { if (!Object.hasOwn(ENEMIES, q.type) || !isInt(q.lane, 0, lanes - 1) || !finiteRow(q)) throw bad('queued enemy', i, 'is not valid'); });
}
function checkFacs(facs: readonly Fac[], towers: readonly Tower[]) {
  const bad = (i: number, why: string) => new SnapError(`corrupt state block: building ${i} ${why}`);
  const item = (x: unknown) => typeof x === 'string' && Object.hasOwn(ITEMS, x);
  const used = new Set(towers.map((t) => t.cz * GW + t.cx)), ids = new Set<number>();
  facs.forEach((f, i) => {
    if (!Object.hasOwn(FACS, f.type) || !inGrid(f) || !isInt(f.lvl, 1, 3) || !isInt(f.dir, 0, 5) || !finiteRow(f)) throw bad(i, 'is not valid');
    if (!isInt(f.id, 1, Number.MAX_SAFE_INTEGER) || ids.has(f.id)) throw bad(i, 'has a bad or repeated id');
    ids.add(f.id);
    const c = f.cz * GW + f.cx;
    if (used.has(c)) throw bad(i, 'shares its tile');
    used.add(c);
    if (!f.inv || kindOf(f.inv) !== 'object' || !Object.entries(f.inv).every(([k, n]) => item(k) && Number.isFinite(n))) throw bad(i, 'holds bad items');
    if (!Array.isArray(f.out) || !f.out.every(item)) throw bad(i, 'has a bad output queue');
    if (!Array.isArray(f.items) || !f.items.every((b) => b && kindOf(b) === 'object' && item(b.it) && Number.isFinite(b.p))) throw bad(i, 'carries bad items');
  });
}
/** The Sim's generic fields from a block, each checked against what a fresh Sim keeps there (see fits). */
function putSimFields(sim: Sim, s: Record<string, J>) {
  const S = sim as unknown as Record<string, unknown>;
  const fresh = new Map(Object.keys(S).map((k) => [k, S[k]]));
  for (const k of Object.keys(s)) {
    // (never a method, getter or anything else the class itself has; a field a fresh Sim does not have, such as a tool's
    // own note on it, is kept as plain data)
    if (BAD_KEYS.has(k) || SIM_SKIP.has(k) || (!fresh.has(k) && k in sim) || typeof fresh.get(k) === 'function') continue;
    const v = uj(s[k]);
    if (fresh.has(k) && !fits(v, fresh.get(k))) throw new SnapError(`corrupt state block: sim.${k.slice(0, 24)} is not valid`);
    S[k] = v;
  }
  const bad = (what: string) => new SnapError(`corrupt state block: ${what} is not valid`);
  if (sim.players.length !== sim.opts.players) throw bad('the players');
  for (const p of sim.players) if (!Array.isArray(p.pending) || p.pending.length > 64 || !p.pending.every((o) => Array.isArray(o) && o.length <= 3 && o.every((id) => typeof id === 'string' && Object.hasOwn(CARD_BY_ID, id)))) throw bad('a card offer');
  if (![...sim.unlocked].every((t) => typeof t === 'string' && Object.hasOwn(TOWERS, t))) throw bad('the unlocked towers');
  if (![...sim.facs].every((t) => typeof t === 'string' && Object.hasOwn(FACS, t))) throw bad('the unlocked buildings');
  if (!Object.entries(sim.stacks).every(([id, n]) => Object.hasOwn(CARD_BY_ID, id) && isInt(n, 0, 1000))) throw bad('the cards taken');
}

/**
 * Build a Sim from a snapshot that continues exactly like the one it was taken from. Throws SnapError on a bad snapshot:
 * a block is untrusted input, so every field is checked (kinds, types the game knows, tiles on the board, bounded counts)
 * and anything else that goes wrong while it is put together is turned into a SnapError too.
 */
export function restoreSim(snap: Snap): Sim {
  try { return restoreUnchecked(snap); } catch (e) {
    if (e instanceof SnapError) throw e;
    throw new SnapError('corrupt state block: ' + (e instanceof Error ? e.message : String(e)).slice(0, 120));
  }
}
/**
 * Restore a snapshot twice and run the second copy `steps` steps (picking the first card of every offer) to see it does not
 * throw: what a game should do before it continues a block it was handed (Load report). Throws SnapError if it does.
 */
export function trialRun(snap: Snap, steps = 600): void {
  const t = restoreSim(snap);
  try {
    for (let i = 0; i < steps && !t.over; i++) {
      t.players.forEach((p, j) => { if (p.pending.length) t.pickCard(j, 0); });
      t.step(1 / 60); t.events.length = 0;
      if (i % 60 === 0) { t.diag(); t.factory.links(); }
    }
  } catch (e) { throw new SnapError('this state does not run in this build (' + (e instanceof Error ? e.message : String(e)).slice(0, 120) + '); node tools/repro.ts shows where it fails'); }
}
function restoreUnchecked(snap: Snap): Sim {
  if (!snap || typeof snap !== 'object') throw new SnapError('corrupt state block: not an object');
  if (snap.v !== SNAP_V) throw new SnapError(`state block is format version ${String(snap.v).slice(0, 8)}; this build reads version ${SNAP_V}`);
  const need = ['o', 's', 'x', 'T', 'E', 'P', 'Z', 'Q', 'W', 'g', 'F'] as const;
  for (const k of need) if (!snap[k] || typeof snap[k] !== 'object') throw new SnapError(`corrupt state block: ${k} missing`);
  if (!snap.F.s || !snap.F.f || !Array.isArray(snap.F.ore) || !Array.isArray(snap.F.pn) || !Array.isArray(snap.F.wn)) throw new SnapError('corrupt state block: factory part malformed');
  const o = uj(snap.o);
  if (!o || kindOf(o) !== 'object') throw new SnapError('corrupt state block: options malformed');
  const opts = optsOf(o as Record<string, unknown>);
  const def = mapOf(snap.m);
  const sim = new Sim({ ...opts, map: def });
  const S = sim as unknown as Record<string, unknown>, F = sim.factory, FS = F as unknown as Record<string, unknown>;
  sim.events.length = 0;
  putSimFields(sim, snap.s);
  sim.towers = untable<Tower>(snap.T, 'towers', ROWS_MAX.towers);
  sim.enemies = untable<Enemy>(snap.E, 'enemies', ROWS_MAX.enemies);
  sim.projs = untable<Proj>(snap.P, 'projectiles', ROWS_MAX.projectiles);
  sim.zones = untable<Zone>(snap.Z, 'zones', ROWS_MAX.zones);
  sim.queue = untable<Sim['queue'][number]>(snap.Q, 'queue', ROWS_MAX.queue);
  checkRows(sim);
  if (S.offerPushed instanceof WeakMap) {
    const wm = new WeakMap<object, unknown>();
    for (const r of Array.isArray(snap.op) ? snap.op : []) { const o = Array.isArray(r) ? sim.players[r[0]]?.pending[r[1]] : undefined; const v = o ? uj(r[2]) : null; if (o && Array.isArray(v) && v.every((id) => typeof id === 'string')) wm.set(o, v); }
    S.offerPushed = wm;
  }
  const x = snap.x;
  if (!Array.isArray(x) || x.length !== 2 || !x.every((n) => Number.isInteger(n))) throw new SnapError('corrupt state block: random streams malformed');
  sim.setRngState(x[0], x[1]);
  sim.replica = false;
  // the factory: its buildings, then the grid and deposits, then the networks worked out and their contents put back
  const facs = untable<Fac>(snap.F.f, 'buildings', ROWS_MAX.buildings);
  checkFacs(facs, sim.towers);
  F.restore(facs);
  for (const k of Object.keys(snap.F.s)) {
    if (BAD_KEYS.has(k) || FAC_SKIP.has(k) || !Object.hasOwn(FS, k) || typeof FS[k] === 'function') continue;
    const v = uj(snap.F.s[k]);
    if (!fits(v, FS[k])) throw new SnapError(`corrupt state block: factory.${k.slice(0, 24)} is not valid`);
    FS[k] = v;
  }
  const put = (a: Uint8Array, d: unknown[], what: string) => {
    for (const p of d) {
      if (!Array.isArray(p) || !Number.isInteger(p[0]) || p[0] < 0 || p[0] >= GW * GH || !Number.isInteger(p[1]) || p[1] < 0 || p[1] > 255) throw new SnapError(`corrupt state block: bad ${what} tile`);
      a[p[0]] = p[1];
    }
  };
  put(F.ore, snap.F.ore, 'deposit');
  sim.grid.set(gridOf(sim));
  put(sim.grid, snap.g, 'grid');
  F.sync();
  if (snap.F.pn.length !== F.pipeNets.length || snap.F.wn.length !== F.powerNets.length) throw new SnapError('state block does not match: its pipe or power networks differ from the layout');
  F.pipeNets.forEach((n, i) => {
    const r = snap.F.pn[i], fl = Array.isArray(r) ? uj(r[0]) : 0, amt = Array.isArray(r) ? uj(r[1]) : NaN;
    if (!(fl === null || (typeof fl === 'string' && fl.length < 24)) || typeof amt !== 'number' || !Number.isFinite(amt)) throw new SnapError('corrupt state block: bad pipe network');
    n.fluid = fl as typeof n.fluid; n.amt = amt;
  });
  F.powerNets.forEach((n, i) => {
    const r = snap.F.wn[i];
    if (!Array.isArray(r) || r.length !== 5 || !r.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new SnapError('corrupt state block: bad power grid');
    [n.cap, n.demand, n.sat, n.potential, n.full] = r;
  });
  sim.relink();
  if (!Array.isArray(snap.W) || snap.W.length !== sim.walls.length) throw new SnapError('state block does not match: its walls of fire differ from the towers');
  sim.walls.forEach((w, i) => { const r = snap.W[i]; if (!Array.isArray(r) || r[0] !== w.a || r[1] !== w.b) throw new SnapError('state block does not match: a wall of fire links other pylons'); w.on = !!r[2]; w.hot = !!r[3]; });
  return sim;
}

// ---------- text ----------
function toB64u(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new SnapError('corrupt state block: characters outside base64url');
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  let bin: string;
  try { bin = atob(t); } catch { throw new SnapError('corrupt state block: not valid base64url'); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(b: Uint8Array, ts: ReadableWritablePair<Uint8Array, BufferSource>, max: number): Promise<Uint8Array> {
  const reader = new Blob([b as BlobPart]).stream().pipeThrough(ts).getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { void reader.cancel(); throw new SnapError('state block unpacks to more than ' + (max >> 20) + ' MB'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A Sim as a text block: 'BSR1:' + base64url(deflate-raw(JSON)) + '.'. */
export async function encodeSnapshot(sim: Sim, meta?: Snap['meta']): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(snapshotOf(sim, meta)));
  const z = await pipe(json, new CompressionStream('deflate-raw'), Infinity);
  return SNAP_HEAD + toB64u(z) + '.';
}

/**
 * Find the state block in a text (a whole issue body, a downloaded report file, or the block alone): 'BSR<version>:',
 * the base64url payload (line breaks and spaces inside are dropped) up to the closing '.', a code fence or a blank line.
 * The last such block when there are several; null when there is none.
 */
export function extractBlock(text: string): string | null {
  // (the last one: the state is the issue's last section, and a player may have quoted an older block in their own text)
  let m: RegExpExecArray | null = null;
  for (const x of text.matchAll(/BSR(\d{1,4}):([A-Za-z0-9_\-\s]*?)(\.|```|\n\s*\n|$)/g)) if (x[2].trim()) m = x;
  if (!m) return null;
  return 'BSR' + m[1] + ':' + m[2].replace(/\s+/g, '') + (m[3] === '.' ? '.' : '');
}

/** Read a state block (or any text that holds one). Throws SnapError with a plain message when it is missing, corrupt or from another format version. */
export async function decodeSnapshot(text: string): Promise<Snap> {
  const block = extractBlock(String(text));
  if (!block) throw new SnapError('no BEATSPIRE state block (it starts with "' + SNAP_HEAD + '") in the input');
  const ver = /^BSR(\d+):/.exec(block)![1];
  if (+ver !== SNAP_V) throw new SnapError(`state block is format version ${ver}; this build reads version ${SNAP_V} (use the game version named in the report)`);
  const body = block.slice(SNAP_HEAD.length).replace(/\.$/, '');
  if (!body) throw new SnapError('state block is empty');
  const z = fromB64u(body);
  let raw: Uint8Array;
  try { raw = await pipe(z, new DecompressionStream('deflate-raw'), SNAP_MAX_BYTES); }
  catch (e) { throw e instanceof SnapError ? e : new SnapError('corrupt or truncated state block: it does not unpack' + (block.endsWith('.') ? '' : ' (and its closing "." is missing: was it cut off?)')); }
  let snap: Snap;
  try { snap = JSON.parse(new TextDecoder().decode(raw)) as Snap; } catch { throw new SnapError('corrupt state block: its content is not readable'); }
  if (!snap || typeof snap !== 'object') throw new SnapError('corrupt state block: not an object');
  if (snap.v !== SNAP_V) throw new SnapError(`state block is format version ${String(snap.v).slice(0, 8)}; this build reads version ${SNAP_V}`);
  return snap;
}

/** A hash over the whole saved state (two FNV-style 32-bit lanes and the length): equal hashes, equal states. */
export function stateHash(sim: Sim): string {
  const s = JSON.stringify(snapshotOf(sim));
  let h1 = 0x811c9dc5, h2 = 0x12345678;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2654435761) ^ (h2 >>> 13); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}
