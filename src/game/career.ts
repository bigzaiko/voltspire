// BEATSPIRE career: the one object the game talks to for saves, the run archive and achievements (no DOM).
//
//   const career = await Career.open();                  // getPlatform(): web in the browser, memory in Node
//   career.onUnlock((a) => toast(a));                     // achievements as they unlock
//   career.startRun(sim, { map: mapKeyOf(def) });          // a fresh run (or career.continueRun(key) for a saved one)
//   each frame: career.beforeStep(sim, dt); sim.step(dt); ...; career.frame(sim, sim.events) before the events are cleared
//   right before the player calls a wave: career.beforeWave(sim); sim.startWave();
//   at the end: await career.endRun(sim, 'win' | 'loss' | 'quit')
//
// It saves by itself (saves.ts: when a wave is cleared, and right before a wave starts, never during one), feeds the run's
// counters (records.ts RunTracker), checks the achievements on every frame where a counter moved, and at the end of the
// run stores it in the archive, updates bests and totals, clears the save and checks the end-of-run achievements.
// Runs that do not count (bot, attract demo, free, co-op, versus) are not tracked at all: no save, no record, no achievement.
import { getPlatform } from '../platform/index.ts';
import type { Platform } from '../platform/core.ts';
import { Saves, canSave, saveKey, modeOf, autoStartsIn } from './saves.ts';
import type { SaveCtx, SaveMeta, LoadOpts } from './saves.ts';
import { Records, RunTracker } from './records.ts';
import type { RunInfo, RunRecord, RunResult, EvView } from './records.ts';
import { Achievements } from './achievements.ts';
import type { AchDef } from './achievements.ts';
import type { Sim } from './sim.ts';

export interface RunOpts extends RunInfo { ctx?: SaveCtx }

export class Career {
  run: RunTracker | null = null;
  /** the save key of the run going on ('' when it does not save) */
  key = '';
  private runOpts: RunOpts = {};
  /** the game time of the last achievement check (frame) */
  private evalAt = -1;
  readonly platform: Platform; readonly saves: Saves; readonly records: Records; readonly achievements: Achievements;
  private constructor(platform: Platform, saves: Saves, records: Records, achievements: Achievements) {
    this.platform = platform; this.saves = saves; this.records = records; this.achievements = achievements;
  }

  static async open(platform: Platform = getPlatform()): Promise<Career> {
    const [records, achievements] = await Promise.all([Records.load(platform.storage), Achievements.load(platform)]);
    return new Career(platform, new Saves(platform.storage), records, achievements);
  }
  onUnlock(cb: (a: AchDef) => void): () => void { return this.achievements.onUnlock(cb); }

  /** True if this run counts (tracked, saved, archived): solo, not free, not a bot or the attract demo. */
  counts(sim: Sim, ctx: SaveCtx = {}): boolean { return canSave(sim, ctx); }
  /** The save key a run would use (to ask "continue or start over?" before starting it): saves.get(key). */
  keyFor(map: string, diff: string, survival: boolean): string { return saveKey(map, diff, survival ? 'survival' : 'campaign'); }

  /** Begin tracking a new run (call right after the Sim is made). Returns the tracker, or null when the run does not count. */
  startRun(sim: Sim, o: RunOpts = {}): RunTracker | null {
    this.runOpts = o;
    if (!this.counts(sim, o.ctx)) { this.run = null; this.key = ''; return null; }
    this.run = new RunTracker(sim, o);
    this.key = saveKey(this.run.stats.map, sim.opts.diff, modeOf(sim));
    return this.run;
  }
  /** Continue a saved run: the restored Sim (in its build phase) with its counters, or { error } (an unreadable save is dropped). */
  async continueRun(key: string, o: RunOpts & LoadOpts = {}): Promise<{ sim: Sim; meta: SaveMeta } | { error: string }> {
    const r = await this.saves.load(key, o);
    if ('error' in r) return r;
    this.runOpts = { ...o, map: r.entry.map, mapName: r.entry.mapName, mode: r.entry.mode };
    this.run = RunTracker.fromJSON(r.sim, r.entry.acc);
    this.run.stats.map = r.entry.map; this.run.stats.mapName = r.entry.mapName;
    this.key = key;
    const { block: _b, acc: _a, ...meta } = r.entry;
    return { sim: r.sim, meta };
  }
  /**
   * Start a map over although it has a save: the saved run is archived as quit (when it was past wave 1 and can be read)
   * and the save removed.
   */
  async startOver(key: string): Promise<void> {
    const r = await this.saves.load(key, { hold: false });
    if (!('error' in r) && r.sim.wave >= 1) {
      const t = RunTracker.fromJSON(r.sim, r.entry.acc);
      t.stats.map = r.entry.map; t.stats.mapName = r.entry.mapName;
      await this.archive(t, r.sim, 'quit');
    }
    await this.saves.clear(key);
  }

  /** Before each sim.step(dt): saves when that step is about to start the next wave by itself (auto waves). */
  beforeStep(sim: Sim, dt: number): void { if (this.run && autoStartsIn(sim, dt)) void this.save(sim); }
  /** Right before the game calls sim.startWave() for the player: saves the build phase with everything built in it. */
  beforeWave(sim: Sim): void { if (this.run) void this.save(sim); }
  /** After the step(s) of a frame, with the events they pushed (before they are cleared or sent on). */
  frame(sim: Sim, events: readonly EvView[]): AchDef[] {
    const t = this.run;
    if (!t) return [];
    t.observe(sim, events);
    if (events.some((e) => e.k === 'clear') && !sim.over) void this.save(sim);
    if (!t.dirty) return [];
    // (kills move the counters on most frames of a wave: look at the achievements at most every quarter second of game
    // time there, at once in the build phase, and at the run's end in any case, see archive)
    if (!sim.planning && !sim.over && Math.abs(sim.time - this.evalAt) < 0.25) return [];
    this.evalAt = sim.time;
    t.dirty = false;
    return this.achievements.evaluate({ run: t.stats, life: this.records.totals });
  }
  /** Save the run now if it is in its build phase (normally automatic). */
  save(sim: Sim): Promise<SaveMeta | null> {
    if (!this.run) return Promise.resolve(null);
    return this.saves.put(sim, { map: this.run.stats.map, mapName: this.run.stats.mapName, acc: this.run.stats, ctx: this.runOpts.ctx });
  }

  /**
   * The run is over: 'win', 'loss', or 'quit' (abandoned: the player gave it up, e.g. Restart). Archives it (a quit only
   * once wave 1 was called), checks the end-of-run achievements and clears the save. Resolves the record, or null when
   * nothing was archived. A win that plays on (Survival after the campaign) calls this once, at the win.
   * Going back to the menu is not the end of a run: call leave() for that, and the save stays for a later Continue.
   */
  async endRun(sim: Sim, result: RunResult, now = Date.now()): Promise<RunRecord | null> {
    const t = this.run, key = this.key;
    this.run = null; this.key = '';
    if (!t) return null;
    await this.saves.flush(); await this.saves.clear(key);
    if (result === 'quit' && sim.wave < 1) return null;
    return this.archive(t, sim, result, now);
  }
  /**
   * Leave the run to the menu without ending it (like a reload): saves it if it stands in a build phase, otherwise the
   * save from the last build phase stays. Stops tracking; continueRun(key) picks it up again.
   */
  async leave(sim: Sim): Promise<void> {
    if (this.run) await this.save(sim);
    await this.saves.flush();
    this.run = null; this.key = '';
  }
  /** Note something done outside a run ('tutorial' when the tutorial is finished) and check the achievements on it. */
  async flag(name: string): Promise<AchDef[]> {
    await this.records.flag(name);
    return this.achievements.evaluate({ life: this.records.totals });
  }

  private async archive(t: RunTracker, sim: Sim, result: RunResult, now = Date.now()): Promise<RunRecord> {
    t.observe(sim, []);
    const rec = t.finish(sim, result, now);
    const before = this.records.totals;
    this.achievements.evaluate({ run: t.stats, end: rec, life: before }, now);
    await this.records.add(rec, t.stats.aimModes);
    // (the lifetime counts now hold this run: evaluate once more so the counted ones catch up)
    this.achievements.evaluate({ life: this.records.totals }, now);
    await this.achievements.save();
    return rec;
  }
}
