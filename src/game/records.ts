// BEATSPIRE run archive and stats (no DOM: runs in the browser and in Node, tools/achievements-test.ts).
//
// RunTracker is the accumulator: it watches one run, frame by frame, through the Sim's state and the events of that frame
// (observe), and keeps the counters the archive and the achievements need (kills, bosses, the Titan and how fast it fell,
// towers and buildings built by type, Mk3s, specials, targeting changes, cards, frozen enemies at once, arms standing,
// the longest belt line, mine > arm > tower lines, plants standing...). It reads the Sim only through SimView, so tests feed
// it plain objects. It is plain data (toJSON / fromJSON), saved with every mid-run save so a run that is continued after a
// reload keeps its counters.
//
// Records is the archive in platform storage: the last RUNS_MAX finished runs (one key each, 'run:<endedAt>-<id>', so the
// oldest sort first and the web adapter can drop them when the storage is full), the bests per map, difficulty and mode
// ('records:best') and lifetime totals ('records:totals'). Everything read back from storage is checked and clamped.
import { neighbor, inBoard } from './hex.ts';
import { GW } from './data.ts';
import type { PlatformStorage } from '../platform/core.ts';

/** How many finished runs the archive keeps (the oldest go first). */
export const RUNS_MAX = 200;
/** Building types that count as plants for "every plant in one run". */
export const PLANTS = ['smelter', 'works', 'press', 'cells', 'refinery', 'missiles'] as const;

export type RunMode = 'campaign' | 'survival';
export type RunResult = 'win' | 'loss' | 'quit';

/** What the tracker reads of a Sim (a Sim fits as it is; tests pass plain objects). */
export interface SimView {
  wave: number; lives: number; maxLives: number; kills: number; time: number; won: boolean; over: boolean; endless: boolean; winWave: number;
  towers: readonly { id: number; type: string; lvl: number; cx: number; cz: number }[];
  enemies: readonly { type: string; frz: number; alive: boolean }[];
  unlocked: ReadonlySet<string>;
  factory: { facs: readonly { id: number; type: string; cx: number; cz: number; dir: number; pair?: number; exit?: boolean }[]; delivered: number };
  map: { def: { id: string; name: string; tier: number } };
  opts: { seed: number; diff: string };
}
/** An event of a frame (Sim.events): only `k` and a few fields are read. */
export interface EvView { k: string; [key: string]: unknown }

/** The counters of one run (plain JSON). */
export interface RunStats {
  v: 1;
  map: string; mapName: string; tier: number; diff: string; mode: RunMode; seed: number; waves: number; maxLives: number;
  wave: number; cleared: number; lives: number; minLives: number; time: number;
  kills: number; bossKills: number; titanKills: number;
  /** seconds from the Titan's leap to its fall, the fastest this run (0: none fell) */
  titanFast: number;
  towersBuilt: Record<string, number>; buildingsBuilt: Record<string, number>;
  /** tower types that stood on the field at any time (the map's own included) */
  towerTypes: string[];
  maxLvl: number; mk3: number;
  specials: number; specialsBy: Record<string, number>;
  aim: number; aimModes: string[];
  cards: string[];
  maxFrozen: number; maxArms: number; armLine: boolean; maxBelt: number; plants: string[];
  items: number; unlocked: number;
  /** internal: the highest tower and building ids seen (newer ones were built this run), the time of the Titan's leap */
  lastT: number; lastF: number; titanAt: number;
}
/** One finished run in the archive. */
export interface RunRecord {
  id: string; endedAt: number;
  map: string; mapName: string; tier: number; diff: string; mode: RunMode; result: RunResult;
  wave: number; waves: number; lives: number; maxLives: number; time: number;
  kills: number; bossKills: number; titanKilled: boolean; titanKills: number;
  towersBuilt: Record<string, number>; buildingsBuilt: Record<string, number>;
  itemsDelivered: number; cardsTaken: string[]; seed: number;
  specials: number; maxBelt: number;
}
/** The bests of one map at one difficulty and mode. */
export interface MapBest { runs: number; wins: number; bestWave: number; bestLivesWin: number; fastestWin: number }
/** Lifetime totals (over the archived runs, also those the archive has since dropped). */
export interface Totals {
  runs: number; wins: number; losses: number; quits: number;
  kills: number; bossKills: number; titanKills: number; playtime: number; items: number; specials: number;
  waves: number; towers: number; buildings: number; cards: number; bestSurvival: number;
  mapsWon: string[]; tiersWon: number[]; diffsWon: string[]; aimModes: string[];
  /** things done outside a run ('tutorial': the tutorial finished) */
  flags: string[];
}

const emptyTotals = (): Totals => ({
  runs: 0, wins: 0, losses: 0, quits: 0, kills: 0, bossKills: 0, titanKills: 0, playtime: 0, items: 0, specials: 0,
  waves: 0, towers: 0, buildings: 0, cards: 0, bestSurvival: 0, mapsWon: [], tiersWon: [], diffsWon: [], aimModes: [], flags: [],
});
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const inc = (r: Record<string, number>, k: string, n = 1) => { r[k] = (r[k] || 0) + n; };
const addTo = <T>(a: T[], v: T) => { if (!a.includes(v)) a.push(v); };

// ---------- the factory shapes the tracker looks for ----------
type FacV = SimView['factory']['facs'][number];
const tileKey = (cx: number, cz: number) => cz * GW + cx;
/** The longest line of belts (belt tunnels count with the tiles they pass under), in tiles. */
export function longestBelt(facs: readonly FacV[]): number {
  const at = new Map<number, FacV>(), byId = new Map<number, FacV>();
  for (const f of facs) if (f.type === 'belt' || f.type === 'tunnel') { at.set(tileKey(f.cx, f.cz), f); byId.set(f.id, f); }
  // next[f] = [the piece the line goes on to, tiles covered on the way]
  const next = (f: FacV): [FacV | undefined, number] => {
    if (f.type === 'tunnel' && !f.exit && f.pair) {
      const o = byId.get(f.pair);
      if (o) return [o, Math.max(1, Math.round(Math.hypot(o.cx - f.cx, o.cz - f.cz)))];
    }
    const [x, z] = neighbor(f.cx, f.cz, f.dir);
    return [inBoard(x, z) ? at.get(tileKey(x, z)) : undefined, 1];
  };
  const len = new Map<FacV, number>();
  let best = 0;
  for (const start of at.values()) {
    if (len.has(start)) continue;
    // walk forward until a known piece, the end or a loop, then fill the lengths in backwards
    const path: [FacV, number][] = [], on = new Set<FacV>();
    let f: FacV | undefined = start, tail = 0;
    while (f && !len.has(f) && !on.has(f)) { const [n, d] = next(f); path.push([f, d]); on.add(f); f = n; }
    if (f && len.has(f)) tail = len.get(f)!;
    for (let i = path.length - 1; i >= 0; i--) { const [p, d] = path[i]; tail = i === path.length - 1 && !(f && len.has(f)) ? 1 : tail + d; len.set(p, tail); }
  }
  for (const v of len.values()) best = Math.max(best, v);
  return best;
}
/** True if a Mine feeds a tower through one to four Transfer Arms in a row (mine > arm > ... > tower). */
export function hasArmLine(facs: readonly FacV[], towers: SimView['towers']): boolean {
  const at = new Map<number, FacV>();
  for (const f of facs) at.set(tileKey(f.cx, f.cz), f);
  const tw = new Set(towers.map((t) => tileKey(t.cx, t.cz)));
  for (const f of facs) {
    if (f.type !== 'arm') continue;
    const [fx, fz] = neighbor(f.cx, f.cz, f.dir);
    if (!inBoard(fx, fz) || !tw.has(tileKey(fx, fz))) continue;
    let a: FacV | undefined = f;
    for (let n = 0; a && a.type === 'arm' && n < 4; n++) {
      const [bx, bz] = neighbor(a.cx, a.cz, (a.dir + 3) % 6);
      const b = inBoard(bx, bz) ? at.get(tileKey(bx, bz)) : undefined;
      if (b && b.type === 'mine') return true;
      a = b && b.type === 'arm' && b.dir === a.dir ? b : undefined;
    }
  }
  return false;
}

// ---------- the accumulator ----------
export interface RunInfo { map?: string; mapName?: string; tier?: number; mode?: RunMode }

export class RunTracker {
  stats: RunStats;
  /** set by observe when something an achievement looks at may have changed */
  dirty = true;
  constructor(sim: SimView, info: RunInfo = {}) {
    const d = sim.map.def;
    this.stats = {
      v: 1, map: info.map || d.id, mapName: info.mapName || d.name, tier: info.tier || d.tier || 1, diff: sim.opts.diff,
      mode: info.mode || (sim.endless ? 'survival' : 'campaign'), seed: sim.opts.seed, waves: sim.endless ? 0 : sim.winWave, maxLives: sim.maxLives,
      wave: sim.wave, cleared: 0, lives: sim.lives, minLives: sim.lives, time: sim.time,
      kills: 0, bossKills: 0, titanKills: 0, titanFast: 0, towersBuilt: {}, buildingsBuilt: {}, towerTypes: [], maxLvl: 0, mk3: 0,
      specials: 0, specialsBy: {}, aim: 0, aimModes: [], cards: [], maxFrozen: 0, maxArms: 0, armLine: false, maxBelt: 0, plants: [],
      items: sim.factory.delivered, unlocked: sim.unlocked.size,
      lastT: sim.towers.reduce((m, t) => Math.max(m, t.id), 0), lastF: sim.factory.facs.reduce((m, f) => Math.max(m, f.id), 0), titanAt: -1,
    };
    this.kills0 = sim.kills;
    this.scanTowers(sim); this.scanFacs(sim);
  }
  /** sim.kills when tracking began (a restored run's counters already hold the kills before) */
  private kills0: number;

  /** A tracker that carries on from saved counters (a continued save) on the restored Sim. */
  static fromJSON(sim: SimView, j: unknown): RunTracker {
    const t = new RunTracker(sim);
    const s = readStats(j);
    if (s) { t.stats = s; t.kills0 = sim.kills - s.kills; }
    return t;
  }
  toJSON(): RunStats { return JSON.parse(JSON.stringify(this.stats)) as RunStats; }

  /** Feed one frame: the Sim after its step(s) and the events those steps pushed (before they are cleared). */
  observe(sim: SimView, events: readonly EvView[]): void {
    const s = this.stats;
    let towers = false, facs = false;
    // (the enemies a Titan's impact wipes out die without a kill: those boss deaths come before the impact event)
    const impact = events.findIndex((e) => e.k === 'titanImpact');
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.k) {
        case 'die': if (e.t === 'boss' && i > impact) { s.bossKills++; this.dirty = true; } break;
        case 'build': if (e.fac) facs = true; else towers = true; break;
        case 'sell': if (e.fac) facs = true; else towers = true; break;
        case 'special': s.specials++; inc(s.specialsBy, String(e.t)); this.dirty = true; break;
        case 'aim': s.aim++; addTo(s.aimModes, String(e.m)); this.dirty = true; break;
        case 'card': if (typeof e.id === 'string') s.cards.push(e.id); this.dirty = true; break;
        case 'titanLand': s.titanAt = sim.time; break;
        case 'titanDie': {
          s.titanKills++;
          const t = s.titanAt >= 0 ? sim.time - s.titanAt : 0;
          if (t > 0 && (!s.titanFast || t < s.titanFast)) s.titanFast = t;
          s.titanAt = -1; this.dirty = true; break;
        }
        case 'clear': if (typeof e.n === 'number') s.cleared = Math.max(s.cleared, e.n); this.dirty = true; break;
        case 'titanImpact': case 'up': towers = true; break;
      }
    }
    if (towers) this.scanTowers(sim);
    if (facs) this.scanFacs(sim);
    let frozen = 0;
    for (const e of sim.enemies) if (e.alive && e.frz > 0) frozen++;
    if (frozen > s.maxFrozen) { s.maxFrozen = frozen; this.dirty = true; }
    const kills = sim.kills - this.kills0;
    if (kills !== s.kills || sim.factory.delivered !== s.items || sim.unlocked.size !== s.unlocked || sim.wave !== s.wave || sim.lives !== s.lives) this.dirty = true;
    s.kills = kills; s.items = sim.factory.delivered; s.unlocked = Math.max(s.unlocked, sim.unlocked.size);
    s.wave = sim.wave; s.lives = sim.lives; s.minLives = Math.min(s.minLives, sim.lives); s.time = sim.time;
  }
  private scanTowers(sim: SimView) {
    const s = this.stats;
    let mk3 = 0, last = s.lastT;
    for (const t of sim.towers) {
      if (t.id > s.lastT) inc(s.towersBuilt, t.type);
      last = Math.max(last, t.id);
      addTo(s.towerTypes, t.type);
      s.maxLvl = Math.max(s.maxLvl, t.lvl);
      if (t.lvl >= 3) mk3++;
    }
    s.lastT = last; s.mk3 = Math.max(s.mk3, mk3);
    if (sim.towers.length) this.scanLines(sim);
    this.dirty = true;
  }
  private scanFacs(sim: SimView) {
    const s = this.stats, facs = sim.factory.facs;
    let arms = 0, last = s.lastF;
    for (const f of facs) {
      if (f.id > s.lastF && f.type !== 'crate') inc(s.buildingsBuilt, f.type);
      last = Math.max(last, f.id);
      if (f.type === 'arm') arms++;
      if ((PLANTS as readonly string[]).includes(f.type)) addTo(s.plants, f.type);
    }
    s.lastF = last; s.maxArms = Math.max(s.maxArms, arms);
    s.maxBelt = Math.max(s.maxBelt, longestBelt(facs));
    this.scanLines(sim);
    this.dirty = true;
  }
  private scanLines(sim: SimView) { if (!this.stats.armLine && hasArmLine(sim.factory.facs, sim.towers)) this.stats.armLine = true; }

  /** The archive entry for this run as it ends now (observe the last frame first). */
  finish(sim: SimView, result: RunResult, endedAt = Date.now()): RunRecord {
    const s = this.stats;
    this.scanTowers(sim); this.scanFacs(sim);
    return {
      id: endedAt.toString(36) + '-' + (s.seed >>> 0).toString(36), endedAt,
      map: s.map, mapName: s.mapName, tier: s.tier, diff: s.diff, mode: s.mode, result,
      wave: sim.wave, waves: s.waves, lives: sim.lives, maxLives: s.maxLives, time: Math.round(sim.time * 10) / 10,
      kills: s.kills, bossKills: s.bossKills, titanKilled: s.titanKills > 0, titanKills: s.titanKills,
      towersBuilt: { ...s.towersBuilt }, buildingsBuilt: { ...s.buildingsBuilt },
      itemsDelivered: s.items, cardsTaken: [...s.cards], seed: s.seed, specials: s.specials, maxBelt: s.maxBelt,
    };
  }
}

// ---------- reading untrusted JSON back ----------
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, lo = 0, hi = 1e15, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const str = (v: unknown, max = 64, d = '') => (typeof v === 'string' && v.length <= max ? v : d);
const strs = (v: unknown, max = 200) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, max) : []);
const counts = (v: unknown) => { const o: Record<string, number> = {}; for (const [k, n] of Object.entries(obj(v)).slice(0, 64)) if (/^[a-z_0-9]{1,24}$/.test(k)) o[k] = Math.round(num(n, 0, 1e9)); return o; };
const mode = (v: unknown): RunMode => (v === 'survival' ? 'survival' : 'campaign');

function readStats(j: unknown): RunStats | null {
  const o = obj(j);
  if (o.v !== 1) return null;
  return {
    v: 1, map: str(o.map, 80), mapName: str(o.mapName, 80), tier: num(o.tier, 1, 3, 1), diff: str(o.diff, 16, 'normal'), mode: mode(o.mode),
    seed: num(o.seed, -1e10, 1e10), waves: num(o.waves, 0, 999), maxLives: num(o.maxLives, 1, 1e4, 1),
    wave: num(o.wave, 0, 1e5), cleared: num(o.cleared, 0, 1e5), lives: num(o.lives, 0, 1e4), minLives: num(o.minLives, 0, 1e4), time: num(o.time),
    kills: num(o.kills), bossKills: num(o.bossKills), titanKills: num(o.titanKills), titanFast: num(o.titanFast),
    towersBuilt: counts(o.towersBuilt), buildingsBuilt: counts(o.buildingsBuilt), towerTypes: strs(o.towerTypes, 32),
    maxLvl: num(o.maxLvl, 0, 3), mk3: num(o.mk3, 0, 1e4), specials: num(o.specials), specialsBy: counts(o.specialsBy),
    aim: num(o.aim), aimModes: strs(o.aimModes, 16), cards: strs(o.cards, 500),
    maxFrozen: num(o.maxFrozen, 0, 1e5), maxArms: num(o.maxArms, 0, 1e5), armLine: o.armLine === true, maxBelt: num(o.maxBelt, 0, 1e5), plants: strs(o.plants, 16),
    items: num(o.items), unlocked: num(o.unlocked, 0, 64), lastT: num(o.lastT), lastF: num(o.lastF), titanAt: num(o.titanAt, -1, 1e9, -1),
  };
}
export function readRun(j: unknown): RunRecord | null {
  const o = obj(j);
  if (typeof o.id !== 'string' || typeof o.endedAt !== 'number' || !['win', 'loss', 'quit'].includes(o.result as string)) return null;
  return {
    id: str(o.id, 40), endedAt: num(o.endedAt), map: str(o.map, 80), mapName: str(o.mapName, 80), tier: num(o.tier, 1, 3, 1), diff: str(o.diff, 16, 'normal'),
    mode: mode(o.mode), result: o.result as RunResult, wave: num(o.wave, 0, 1e5), waves: num(o.waves, 0, 999), lives: num(o.lives, 0, 1e4),
    maxLives: num(o.maxLives, 1, 1e4, 1), time: num(o.time), kills: num(o.kills), bossKills: num(o.bossKills), titanKilled: o.titanKilled === true,
    titanKills: num(o.titanKills), towersBuilt: counts(o.towersBuilt), buildingsBuilt: counts(o.buildingsBuilt), itemsDelivered: num(o.itemsDelivered),
    cardsTaken: strs(o.cardsTaken, 500), seed: num(o.seed, -1e10, 1e10), specials: num(o.specials), maxBelt: num(o.maxBelt, 0, 1e5),
  };
}
function readTotals(j: unknown): Totals {
  const o = obj(j), t = emptyTotals();
  for (const k of ['runs', 'wins', 'losses', 'quits', 'kills', 'bossKills', 'titanKills', 'playtime', 'items', 'specials', 'waves', 'towers', 'buildings', 'cards', 'bestSurvival'] as const) t[k] = num(o[k]);
  t.mapsWon = strs(o.mapsWon, 1000); t.diffsWon = strs(o.diffsWon, 8); t.aimModes = strs(o.aimModes, 16); t.flags = strs(o.flags, 64);
  t.tiersWon = Array.isArray(o.tiersWon) ? o.tiersWon.filter((x): x is number => x === 1 || x === 2 || x === 3) : [];
  return t;
}
function readBests(j: unknown): Record<string, MapBest> {
  const out: Record<string, MapBest> = {};
  for (const [k, v] of Object.entries(obj(j)).slice(0, 2000)) {
    if (k.length > 120 || k === '__proto__') continue;
    const o = obj(v);
    out[k] = { runs: num(o.runs), wins: num(o.wins), bestWave: num(o.bestWave), bestLivesWin: num(o.bestLivesWin), fastestWin: num(o.fastestWin) };
  }
  return out;
}

/** The key of a map's bests: '<map>|<difficulty>|<mode>' (map: the map id, or the record key play.ts gives custom maps). */
export const bestKey = (map: string, diff: string, mode: RunMode) => `${map}|${diff}|${mode}`;
/** The totals after one more run (pure: the achievements look at this before the run is stored). */
export function addRunToTotals(t0: Totals, r: RunRecord, aimModes: readonly string[] = []): Totals {
  const t: Totals = JSON.parse(JSON.stringify(t0)) as Totals;
  t.runs++;
  if (r.result === 'win') t.wins++; else if (r.result === 'loss') t.losses++; else t.quits++;
  t.kills += r.kills; t.bossKills += r.bossKills; t.titanKills += r.titanKills; t.playtime += r.time; t.items += r.itemsDelivered;
  t.specials += r.specials; t.towers += sum(r.towersBuilt); t.buildings += sum(r.buildingsBuilt); t.cards += r.cardsTaken.length;
  // waves cleared: a win cleared all of them, otherwise the wave it ended in was not
  t.waves += r.result === 'win' ? r.wave : Math.max(0, r.wave - 1);
  if (r.mode === 'survival') t.bestSurvival = Math.max(t.bestSurvival, Math.max(0, r.wave - (r.result === 'win' ? 0 : 1)));
  if (r.result === 'win' && r.mode === 'campaign') { addTo(t.mapsWon, r.map); addTo(t.tiersWon, r.tier); addTo(t.diffsWon, r.diff); }
  for (const m of aimModes) addTo(t.aimModes, m);
  return t;
}

/** The run archive, the bests and the totals in platform storage (see the header). Load it with Records.load. */
export class Records {
  /** newest first */
  runs: RunRecord[] = [];
  bests: Record<string, MapBest> = {};
  totals: Totals = emptyTotals();
  private store: PlatformStorage;
  private constructor(store: PlatformStorage) { this.store = store; }

  static async load(store: PlatformStorage): Promise<Records> {
    const r = new Records(store);
    const keys = await store.keys('run:');
    for (const k of keys.slice(0, Math.max(0, keys.length - RUNS_MAX))) await store.remove(k);
    for (const k of keys.slice(-RUNS_MAX)) {
      try { const v = readRun(JSON.parse((await store.get(k)) || 'null')); if (v) r.runs.push(v); else await store.remove(k); } catch { await store.remove(k); }
    }
    r.runs.sort((a, b) => b.endedAt - a.endedAt);
    try { r.bests = readBests(JSON.parse((await store.get('records:best')) || '{}')); } catch { r.bests = {}; }
    try { r.totals = readTotals(JSON.parse((await store.get('records:totals')) || '{}')); } catch { r.totals = emptyTotals(); }
    return r;
  }
  best(map: string, diff: string, mode: RunMode): MapBest | undefined { const k = bestKey(map, diff, mode); return Object.hasOwn(this.bests, k) ? this.bests[k] : undefined; }

  /** Store a finished run: archive entry, bests, totals. Resolves false when the storage refused it (the run then lives only in memory). */
  async add(r: RunRecord, aimModes: readonly string[] = []): Promise<boolean> {
    await this.catchUp();
    this.runs.unshift(r);
    this.totals = addRunToTotals(this.totals, r, aimModes);
    const k = bestKey(r.map, r.diff, r.mode), b = this.bests[k] || { runs: 0, wins: 0, bestWave: 0, bestLivesWin: 0, fastestWin: 0 };
    b.runs++;
    b.bestWave = Math.max(b.bestWave, r.wave);
    if (r.result === 'win') {
      b.wins++;
      b.bestLivesWin = Math.max(b.bestLivesWin, r.lives);
      if (!b.fastestWin || r.time < b.fastestWin) b.fastestWin = r.time;
    }
    this.bests[k] = b;
    let ok = true;
    // (the totals and bests first if anything has to give: they are small and cannot be rebuilt once runs are dropped)
    try { await this.store.set('records:totals', JSON.stringify(this.totals)); await this.store.set('records:best', JSON.stringify(this.bests)); } catch { ok = false; }
    try {
      await this.store.set('run:' + String(Math.max(0, Math.floor(r.endedAt))).padStart(16, '0') + '-' + r.id.replace(/[^a-z0-9-]/g, '').slice(-12), JSON.stringify(r));
    } catch { ok = false; }
    const keys = await this.store.keys('run:');
    for (const old of keys.slice(0, Math.max(0, keys.length - RUNS_MAX))) await this.store.remove(old);
    if (this.runs.length > RUNS_MAX) this.runs.length = RUNS_MAX;
    return ok;
  }
  /** Note something done outside a run (e.g. 'tutorial'); true if it is new. */
  async flag(name: string): Promise<boolean> {
    await this.catchUp();
    if (this.totals.flags.includes(name)) return false;
    this.totals.flags.push(name);
    try { await this.store.set('records:totals', JSON.stringify(this.totals)); } catch { /* kept in memory */ }
    return true;
  }
  /**
   * Take over what another tab of the game stored since this one loaded (it archived a run: more runs in its totals), so
   * this tab's next write adds to that instead of wiping it out. Totals with fewer runs than this tab's are older: kept out.
   */
  private async catchUp(): Promise<void> {
    try {
      const raw = await this.store.get('records:totals');
      if (!raw) return;
      const t = readTotals(JSON.parse(raw));
      if (t.runs < this.totals.runs || (t.runs === this.totals.runs && t.flags.every((f) => this.totals.flags.includes(f)))) return;
      if (t.runs === this.totals.runs) { for (const f of t.flags) addTo(this.totals.flags, f); return; }
      const mine = this.totals.flags;
      this.totals = t;
      for (const f of mine) addTo(this.totals.flags, f);
      this.bests = readBests(JSON.parse((await this.store.get('records:best')) || '{}'));
      const have = new Set(this.runs.map((x) => x.id));
      for (const k of (await this.store.keys('run:')).slice(-RUNS_MAX)) {
        const v = readRun(JSON.parse((await this.store.get(k)) || 'null'));
        if (v && !have.has(v.id)) { this.runs.push(v); have.add(v.id); }
      }
      this.runs.sort((a, b) => b.endedAt - a.endedAt);
      if (this.runs.length > RUNS_MAX) this.runs.length = RUNS_MAX;
    } catch { /* unreadable: this tab's own records stand */ }
  }
  /** Forget everything: runs, bests and totals. */
  async clear(): Promise<void> {
    for (const k of await this.store.keys('run:')) await this.store.remove(k);
    await this.store.remove('records:best'); await this.store.remove('records:totals');
    this.runs = []; this.bests = {}; this.totals = emptyTotals();
  }
}
