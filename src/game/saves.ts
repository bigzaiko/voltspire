// BEATSPIRE mid-run saves (no DOM: runs in the browser and in Node, tools/smoke.ts proves a save continues exactly).
//
// One save per map, difficulty and mode ('save:<map>|<diff>|<campaign|survival>'), in platform storage, as
// { v, savedAt, key, map, mapName, diff, mode, wave, lives, maxLives, credits, seed, block, acc }: `block` is the whole
// Sim (snapshot.ts encodeSnapshot), `acc` the run's counters (records.ts RunTracker) so the archive and the achievements go
// on where they were.
//
// When: only between waves, in the build phase (Sim.planning). The game saves when a wave is cleared (the build phase
// begins) and again right before the next wave starts (the build phase ends, with everything built in it). Never during a
// wave. So a reload in the middle of a wave puts the player back at the end of that wave's build phase: the wave is played
// again from its start, with the towers and buildings as they stood when it was called. That is the fair and simple rule:
// nothing earned during a wave is kept, nothing built before it is lost.
//
// Which runs: solo runs that are not free (no bot, attract demo, co-op or versus run ever saves; see canSave). A won or lost
// run clears its save, and so does starting the map over.
//
// A save that cannot be read (corrupt, or written by a build whose save or snapshot format differs) is dropped with a
// message (load() resolves { error }); it never throws into the game.
import { encodeSnapshot, decodeSnapshot, restoreSim, SnapError, SNAP_V } from './snapshot.ts';
import { NEXT_WAVE_IN } from './data.ts';
import type { Sim } from './sim.ts';
import type { PlatformStorage } from '../platform/core.ts';
import type { RunMode, RunStats } from './records.ts';

/** The save format version (the block inside has its own, SNAP_V). */
export const SAVE_V = 1;
/** How many saves are kept at most (one per map, difficulty and mode); the oldest go first. */
export const SAVES_MAX = 24;
export const SAVE_PREFIX = 'save:';

export interface SaveEntry {
  v: number; savedAt: number; key: string;
  map: string; mapName: string; diff: string; mode: RunMode;
  /** the wave last called (the save stands in the build phase after it: `wave` waves are behind the player) */
  wave: number; lives: number; maxLives: number; credits: number; seed: number;
  /** the snapshot format of the block (a different one cannot be read by this build) */
  snap: number;
  block: string;
  acc?: RunStats;
}
/** A save without its block (what a menu lists). */
export type SaveMeta = Omit<SaveEntry, 'block' | 'acc'>;

/** The storage key of the save of a map at a difficulty and mode. `map`: the map id (play.ts: its record key, mapKeyOf). */
export const saveKey = (map: string, diff: string, mode: RunMode) => `${SAVE_PREFIX}${map}|${diff}|${mode}`;
/** The run's mode as saves and records name it. */
export const modeOf = (sim: Pick<Sim, 'endless'>): RunMode => (sim.endless ? 'survival' : 'campaign');

/** Flags of the game around the Sim that rule a save out. */
export interface SaveCtx { bot?: boolean; attract?: boolean }
/** True if this run may be saved at all: solo, not free, not a co-op replica, not over or won, not a bot or the attract demo. */
export function canSave(sim: Sim, ctx: SaveCtx = {}): boolean {
  return sim.opts.mode === 'solo' && !sim.opts.free && !sim.replica && !sim.over && !sim.won && !ctx.bot && !ctx.attract;
}
/** True if a save now would stand in the build phase (between waves, see the header). */
export const atBuildPhase = (sim: Sim) => sim.planning && !sim.waveActive && !sim.queue.length;
/**
 * True if the next step(dt) will start the next wave by itself (auto waves): the game saves right before such a step,
 * as it does before a wave the player calls.
 */
export function autoStartsIn(sim: Sim, dt: number): boolean {
  return atBuildPhase(sim) && !sim.paused && sim.autoWaves && !(sim.holdFirst && sim.wave === 0) && !(sim.campaign && sim.wave >= sim.winWave) && sim.nextWaveIn - dt <= 0;
}

/** A save written by a newer build than this one (an old tab left open after an update): left alone, never dropped. */
const NEWER = 'newer';
function readEntry(j: unknown, key: string): SaveEntry | string {
  const o = (j && typeof j === 'object' && !Array.isArray(j) ? j : {}) as Record<string, unknown>;
  if ((typeof o.v === 'number' && o.v > SAVE_V) || (o.v === SAVE_V && typeof o.snap === 'number' && o.snap > SNAP_V)) return NEWER;
  if (o.v !== SAVE_V) return `the save is format ${String(o.v).slice(0, 8)}; this build reads ${SAVE_V}`;
  if (o.snap !== SNAP_V) return `the save was made by another version of the game (state format ${String(o.snap).slice(0, 8)})`;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const s = (v: unknown) => (typeof v === 'string' && v.length <= 120 ? v : '');
  const e: SaveEntry = {
    v: SAVE_V, savedAt: n(o.savedAt), key, map: s(o.map), mapName: s(o.mapName), diff: s(o.diff), mode: o.mode === 'survival' ? 'survival' : 'campaign',
    wave: n(o.wave), lives: n(o.lives), maxLives: n(o.maxLives), credits: n(o.credits), seed: n(o.seed), snap: SNAP_V,
    block: typeof o.block === 'string' ? o.block : '',
  };
  if (o.acc && typeof o.acc === 'object') e.acc = o.acc as RunStats;
  if (!e.block || !e.map || ![e.savedAt, e.wave, e.lives, e.maxLives, e.credits].every(Number.isFinite)) return 'the save is incomplete';
  return e;
}
const metaOf = (e: SaveEntry): SaveMeta => { const { block: _b, acc: _a, ...m } = e; return m; };

export interface LoadedSave { sim: Sim; entry: SaveEntry }
export interface LoadOpts {
  /** give the player a full build-phase countdown again when auto waves are on (default true; off for exact replays) */
  hold?: boolean;
}

/** The saves in platform storage (see the header). */
export class Saves {
  /** messages about saves that were dropped (corrupt, other version), newest last; the UI may show and clear them */
  dropped: string[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private store: PlatformStorage;
  constructor(store: PlatformStorage) { this.store = store; }

  /** Every readable save, newest first (without their blocks). Unreadable ones are dropped. */
  async list(): Promise<SaveMeta[]> {
    const out: SaveMeta[] = [];
    for (const k of await this.store.keys(SAVE_PREFIX)) { const e = await this.get(k); if (e) out.push(metaOf(e)); }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }
  /** The most recent save (a main-menu Continue), or null. */
  async last(): Promise<SaveMeta | null> { return (await this.list())[0] || null; }
  /** The save under this key (saveKey), or null. A save that cannot be read is dropped and noted in `dropped`. */
  async get(key: string): Promise<SaveEntry | null> { const e = await this.read(key); return e === NEWER ? null : e; }
  private async read(key: string): Promise<SaveEntry | null | typeof NEWER> {
    let raw: string | null;
    try { raw = await this.store.get(key); } catch { return null; }
    if (raw === null) return null;
    let j: unknown;
    try { j = JSON.parse(raw); } catch { j = null; }
    const e = readEntry(j, key);
    if (e === NEWER) return NEWER;
    if (typeof e === 'string') { await this.drop(key, e); return null; }
    return e;
  }
  /** True if a save exists for this map, difficulty and mode (the map picker asks "continue or start over?"). */
  async has(map: string, diff: string, mode: RunMode): Promise<boolean> { return (await this.get(saveKey(map, diff, mode))) !== null; }

  /**
   * Save the run now. Only in the build phase (atBuildPhase) of a run that canSave; else it resolves null and saves nothing.
   * The state is taken synchronously when this is called (the Sim may step on while the block is packed and written).
   * Resolves the metadata written, or null when there was nothing to save or the storage refused it.
   */
  put(sim: Sim, o: { map?: string; mapName?: string; acc?: RunStats; ctx?: SaveCtx; now?: number } = {}): Promise<SaveMeta | null> {
    if (!canSave(sim, o.ctx) || !atBuildPhase(sim)) return Promise.resolve(null);
    const map = o.map || sim.map.def.id, mode = modeOf(sim), key = saveKey(map, sim.opts.diff, mode);
    const head = {
      v: SAVE_V, savedAt: o.now ?? Date.now(), key, map, mapName: o.mapName || sim.map.def.name, diff: sim.opts.diff, mode,
      wave: sim.wave, lives: sim.lives, maxLives: sim.maxLives, credits: Math.floor(sim.gold), seed: sim.opts.seed, snap: SNAP_V,
    };
    const acc = o.acc ? (JSON.parse(JSON.stringify(o.acc)) as RunStats) : undefined;
    const packing = encodeSnapshot(sim, { date: new Date(head.savedAt).toISOString() }); // (takes the state now)
    const job = this.chain.then(async () => {
      try {
        const e: SaveEntry = { ...head, block: await packing, ...(acc ? { acc } : {}) };
        await this.store.set(key, JSON.stringify(e));
        await this.trim(key);
        return metaOf(e);
      } catch { return null; }
    });
    this.chain = job;
    return job;
  }
  /** Wait for the writes started so far. */
  flush(): Promise<unknown> { return this.chain; }

  /**
   * The saved run as a Sim in its build phase, ready to continue; { error } when the save is missing or cannot be read
   * (an unreadable one is dropped). With hold (default) and auto waves on, the next wave waits a full countdown again.
   */
  async load(key: string, o: LoadOpts = {}): Promise<LoadedSave | { error: string }> {
    await this.chain;
    const n = this.dropped.length, e = await this.read(key);
    if (e === NEWER) return { error: 'the save was made by a newer version of the game: reload the page to update it' };
    if (!e) return { error: this.dropped.length > n ? this.dropped[this.dropped.length - 1] : 'no save' };
    try {
      const sim = restoreSim(await decodeSnapshot(e.block));
      // (the block must be the run the key names: a solo run that counts, at that difficulty and mode, in its build phase)
      if (sim.opts.diff !== e.diff || modeOf(sim) !== e.mode || !canSave(sim) || !atBuildPhase(sim)) throw new SnapError('the save does not match its map, difficulty or mode');
      if (o.hold !== false && sim.autoWaves) sim.nextWaveIn = Math.max(sim.nextWaveIn, NEXT_WAVE_IN);
      return { sim, entry: e };
    } catch (err) {
      const why = err instanceof SnapError ? err.message : 'the save does not load (' + (err instanceof Error ? err.message : String(err)).slice(0, 80) + ')';
      await this.drop(key, why);
      return { error: this.dropped[this.dropped.length - 1] };
    }
  }
  /** Remove a save (won, lost, started over). */
  async clear(key: string): Promise<void> { await this.chain; await this.store.remove(key); }
  /** Remove every save. */
  async clearAll(): Promise<void> { await this.chain; for (const k of await this.store.keys(SAVE_PREFIX)) await this.store.remove(k); }

  private async drop(key: string, why: string) {
    this.dropped.push(`Save for ${key.slice(SAVE_PREFIX.length, SAVE_PREFIX.length + 60)} dropped: ${why}`);
    if (this.dropped.length > 20) this.dropped.shift();
    await this.store.remove(key);
  }
  /** Keep at most SAVES_MAX saves: the oldest others go. */
  private async trim(keep: string) {
    const keys = await this.store.keys(SAVE_PREFIX);
    if (keys.length <= SAVES_MAX) return;
    const ages: [string, number][] = [];
    for (const k of keys) {
      if (k === keep) continue;
      let t = 0;
      try { t = Number((JSON.parse((await this.store.get(k)) || '{}') as { savedAt?: number }).savedAt) || 0; } catch { /* unreadable: oldest */ }
      ages.push([k, t]);
    }
    ages.sort((a, b) => a[1] - b[1]);
    for (const [k] of ages.slice(0, keys.length - SAVES_MAX)) await this.store.remove(k);
  }
}
