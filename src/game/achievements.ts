// BEATSPIRE achievements (no DOM: runs in the browser and in Node, tools/achievements-test.ts).
//
// ACHIEVEMENTS is the data table. Each one has a stable snake_case id (also its Steam API name, see src/platform/ids.ts;
// never rename a shipped id), a name and one short line, a picture (`img`: a file under public/media/sm/, the real tower,
// building or machine art) and, where one fits, an icon of src/icons.ts (`icon`) for small chips, a tier, an optional
// `goal` (counted ones show progress cur / goal), `hidden` ones show as "???" until earned, and `check`, which says from
// the context how far it is: a boolean, or a number held against `goal`.
//
// The context (AchCtx) is the same data the run archive uses: the live run's counters (records.ts RunStats, fed frame by
// frame by RunTracker), the finished run (RunRecord) once it ends, and the lifetime totals before this run. Evaluation is a
// pure function of that context, so it is deterministic; an achievement unlocks once (unlocking it again does nothing),
// is kept in platform storage ('ach:state') and is mirrored to the platform's own service (platform.achievements.unlock).
import type { IconName } from '../icons.ts';
import type { RunStats, RunRecord, Totals } from './records.ts';
import { PLANTS } from './records.ts';
import { TOWER_TYPES } from './data.ts';
import type { Platform } from '../platform/core.ts';

export type AchTier = 'bronze' | 'silver' | 'gold';
/** What an achievement looks at. `run`: the run going on (or just ended); `end`: set only when the run has ended; `life`: lifetime totals before this run. */
export interface AchCtx { run?: RunStats; end?: RunRecord; life: Totals }
export interface AchDef {
  id: string; name: string; desc: string;
  /** a picture under media/sm/ (and media/ at full size): tower_*, fac_*, enemy_*, dep_* */
  img: string;
  /** a small glyph of src/icons.ts, where one fits */
  icon?: IconName;
  tier: AchTier; hidden?: boolean;
  /** counted achievements: the number to reach (check returns the count so far) */
  goal?: number;
  check: (c: AchCtx) => boolean | number;
}

const won = (c: AchCtx) => c.end?.result === 'win' && c.end.mode === 'campaign';
const run = (c: AchCtx) => c.run;
const runN = (c: AchCtx, f: (r: RunStats) => number) => (c.run ? f(c.run) : 0);
const built = (r: RunStats | undefined, t: string) => (r ? r.buildingsBuilt[t] || 0 : 0);
const survived = (c: AchCtx) => (c.run && c.run.mode === 'survival' ? c.run.cleared : 0);
const mapsWon = (c: AchCtx) => c.life.mapsWon.length + (won(c) && !c.life.mapsWon.includes(c.end!.map) ? 1 : 0);

export const ACHIEVEMENTS: readonly AchDef[] = [
  // ---- firsts
  { id: 'first_win', name: 'Grid Holds', desc: 'Win a campaign.', img: 'tower_pulse', tier: 'bronze', check: won },
  { id: 'first_mk3', name: 'Mk3', desc: 'Raise a tower to Mk3.', img: 'tower_rail', tier: 'bronze', check: (c) => runN(c, (r) => r.maxLvl) >= 3 },
  { id: 'first_arm_line', name: 'Hand to Hand', desc: 'Mine, Transfer Arm, tower: a supply line.', img: 'fac_arm', icon: 'fac_arm', tier: 'bronze', check: (c) => !!run(c)?.armLine },
  { id: 'first_belt', name: 'Conveyor', desc: 'Lay a Conveyor Belt.', img: 'fac_belt', icon: 'fac_belt', tier: 'bronze', check: (c) => built(run(c), 'belt') > 0 },
  { id: 'first_oil', name: 'Black Gold', desc: 'Build a Pumpjack on an oil field.', img: 'fac_pump', icon: 'dep_oil', tier: 'bronze', check: (c) => built(run(c), 'pump') > 0 },
  { id: 'first_power', name: 'Live Wire', desc: 'Build a Generator.', img: 'fac_generator', icon: 'power', tier: 'bronze', check: (c) => built(run(c), 'generator') > 0 },
  { id: 'first_blueprint', name: 'Blueprint', desc: 'Unlock a second tower type.', img: 'tower_cryo', tier: 'bronze', check: (c) => runN(c, (r) => r.unlocked) >= 2 },
  { id: 'first_special', name: 'Overdrive', desc: 'Fire a tower special.', img: 'tower_arc', icon: 'power', tier: 'bronze', check: (c) => runN(c, (r) => r.specials) > 0 },
  { id: 'first_targeting', name: 'Pick Your Target', desc: 'Change a tower\'s targeting.', img: 'tower_lance', icon: 'aim_strong', tier: 'bronze', check: (c) => runN(c, (r) => r.aim) > 0 },
  { id: 'tutorial_done', name: 'Briefed', desc: 'Finish the tutorial.', img: 'fac_mine', icon: 'iron_ore', tier: 'bronze', check: (c) => c.life.flags.includes('tutorial') },
  // ---- maps and difficulties
  { id: 'win_tier1', name: 'One Road', desc: 'Win on a tier 1 map.', img: 'tower_pulse', tier: 'bronze', check: (c) => won(c) && c.end!.tier === 1 },
  { id: 'win_tier2', name: 'Two Fronts', desc: 'Win on a tier 2 map.', img: 'tower_mortar', tier: 'silver', check: (c) => won(c) && c.end!.tier === 2 },
  { id: 'win_tier3', name: 'Three Gates', desc: 'Win on a tier 3 map.', img: 'tower_missile', tier: 'gold', check: (c) => won(c) && c.end!.tier === 3 },
  { id: 'maps_5', name: 'Cartographer', desc: 'Win on 5 different maps.', img: 'tower_beacon', tier: 'silver', goal: 5, check: mapsWon },
  { id: 'maps_15', name: 'Atlas', desc: 'Win on 15 different maps.', img: 'tower_gravity', tier: 'gold', goal: 15, check: mapsWon },
  { id: 'win_recruit', name: 'Recruit', desc: 'Win on Recruit.', img: 'enemy_grunt', tier: 'bronze', check: (c) => won(c) && c.end!.diff === 'easy' },
  { id: 'win_veteran', name: 'Veteran', desc: 'Win on Veteran.', img: 'enemy_brute', tier: 'silver', check: (c) => won(c) && c.end!.diff === 'normal' },
  { id: 'win_nightmare', name: 'Nightmare', desc: 'Win on Nightmare.', img: 'enemy_wheel', tier: 'gold', check: (c) => won(c) && c.end!.diff === 'hard' },
  { id: 'flawless', name: 'Untouched', desc: 'Win without losing core integrity.', img: 'tower_beacon', tier: 'gold', check: (c) => won(c) && c.end!.lives >= c.end!.maxLives && (c.run ? c.run.minLives >= c.run.maxLives : true) },
  { id: 'flawless_nightmare', name: 'Ghost in the Grid', desc: 'Win on Nightmare without losing core integrity.', img: 'enemy_titan', tier: 'gold', hidden: true, check: (c) => won(c) && c.end!.diff === 'hard' && c.end!.lives >= c.end!.maxLives && (c.run ? c.run.minLives >= c.run.maxLives : true) },
  // ---- bosses
  { id: 'colossus_slayer', name: 'Colossus Down', desc: 'Destroy a Colossus.', img: 'enemy_boss', tier: 'bronze', check: (c) => runN(c, (r) => r.bossKills) > 0 },
  { id: 'colossus_25', name: 'Giant Killer', desc: 'Destroy 25 Colossi.', img: 'enemy_boss', tier: 'silver', goal: 25, check: (c) => c.life.bossKills + runN(c, (r) => r.bossKills) },
  { id: 'titan_slayer', name: 'Titanfall', desc: 'Destroy the Titan.', img: 'enemy_titan', tier: 'silver', check: (c) => runN(c, (r) => r.titanKills) > 0 },
  { id: 'titan_fast', name: 'Blitz', desc: 'Destroy the Titan within 30 seconds of its leap.', img: 'enemy_titan', icon: 'time', tier: 'gold', hidden: true, check: (c) => { const t = runN(c, (r) => r.titanFast); return t > 0 && t < 30; } },
  // ---- factory
  { id: 'items_1k', name: 'Supply Chain', desc: 'Deliver 1,000 items to towers.', img: 'fac_smelter', icon: 'iron', tier: 'bronze', goal: 1000, check: (c) => c.life.items + runN(c, (r) => r.items) },
  { id: 'items_10k', name: 'Logistics', desc: 'Deliver 10,000 items to towers.', img: 'fac_splitter', icon: 'shell', tier: 'silver', goal: 10000, check: (c) => c.life.items + runN(c, (r) => r.items) },
  { id: 'arms_20', name: 'Many Hands', desc: '20 Transfer Arms standing at once.', img: 'fac_arm', icon: 'fac_arm', tier: 'silver', goal: 20, check: (c) => runN(c, (r) => r.maxArms) },
  { id: 'all_plants', name: 'Industrialist', desc: 'Every plant in one run.', img: 'fac_missiles', icon: 'fac_missiles', tier: 'gold', goal: PLANTS.length, check: (c) => runN(c, (r) => r.plants.length) },
  // ---- towers
  { id: 'pulse_purist', name: 'Purist', desc: 'Win with Pulse Turrets only.', img: 'tower_pulse', icon: 'tw_pulse', tier: 'gold', check: (c) => won(c) && !!c.run && c.run.towerTypes.length > 0 && c.run.towerTypes.every((t) => t === 'pulse') },
  { id: 'full_arsenal', name: 'Full Arsenal', desc: 'Build every tower type in one run.', img: 'tower_missile', tier: 'gold', goal: TOWER_TYPES.length, check: (c) => runN(c, (r) => TOWER_TYPES.filter((t) => (r.towersBuilt[t] || 0) > 0).length) },
  { id: 'mk3_5', name: 'Heavy Battery', desc: 'Five Mk3 towers at once.', img: 'tower_mortar', tier: 'silver', goal: 5, check: (c) => runN(c, (r) => r.mk3) },
  { id: 'specials_100', name: 'Overcharged', desc: 'Fire 100 tower specials.', img: 'tower_gravity', icon: 'power', tier: 'silver', goal: 100, check: (c) => c.life.specials + runN(c, (r) => r.specials) },
  { id: 'all_targeting', name: 'Fire Control', desc: 'Use every targeting mode.', img: 'tower_rail', icon: 'aim_first', tier: 'silver', goal: 6, check: (c) => new Set([...c.life.aimModes, ...(c.run?.aimModes || [])]).size },
  { id: 'kills_10k', name: 'Static Purge', desc: 'Destroy 10,000 machines.', img: 'enemy_runner', tier: 'silver', goal: 10000, check: (c) => c.life.kills + runN(c, (r) => r.kills) },
  // ---- survival
  { id: 'survive_30', name: 'Holdout', desc: 'Clear wave 30 in Survival.', img: 'enemy_drone', tier: 'bronze', goal: 30, check: survived },
  { id: 'survive_40', name: 'Siege Breaker', desc: 'Clear wave 40 in Survival.', img: 'enemy_shield', tier: 'silver', goal: 40, check: survived },
  { id: 'survive_50', name: 'Last Light', desc: 'Clear wave 50 in Survival.', img: 'enemy_brood', tier: 'gold', goal: 50, check: survived },
  // ---- hidden
  { id: 'long_belt', name: 'The Long Haul', desc: 'Win with a belt line over 60 tiles long.', img: 'fac_belt', icon: 'fac_belt', tier: 'silver', hidden: true, check: (c) => won(c) && runN(c, (r) => r.maxBelt) > 60 },
  { id: 'deep_freeze', name: 'Deep Freeze', desc: '50 machines frozen at once.', img: 'tower_cryo', icon: 'tw_cryo', tier: 'silver', hidden: true, goal: 50, check: (c) => runN(c, (r) => r.maxFrozen) },
];
export const ACH_BY_ID: Readonly<Record<string, AchDef>> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
/** The picture of an achievement, small (the list) or full size (the unlock card). */
export const achImage = (a: AchDef, small = true) => `media/${small ? 'sm/' : ''}${a.img}.jpg`;

/** How far an achievement is in a context: [count, goal] (a yes/no one is 0 or 1 of 1). */
export function achProgress(a: AchDef, c: AchCtx): [number, number] {
  const v = a.check(c), goal = a.goal || 1;
  const n = typeof v === 'number' ? (Number.isFinite(v) ? v : 0) : v ? goal : 0;
  return [Math.max(0, Math.min(goal, n)), goal];
}
/** The achievements this context earns (pure: the same context always gives the same list, in table order). */
export function earned(c: AchCtx): AchDef[] {
  return ACHIEVEMENTS.filter((a) => { const [n, g] = achProgress(a, c); return n >= g; });
}

/** What the game keeps ('ach:state'): when each one unlocked (ms since 1970) and the best count of the counted ones. */
export interface AchState { v: 1; unlocked: Record<string, number>; progress: Record<string, number> }
export interface AchView { def: AchDef; unlocked: boolean; at: number; cur: number; goal: number }
export const ACH_KEY = 'ach:state';

/** The player's achievements: the game's own record in platform storage, mirrored to the platform's service. */
export class Achievements {
  state: AchState = { v: 1, unlocked: {}, progress: {} };
  private subs = new Set<(a: AchDef) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  /** the counts last sent to the platform (it is told every 10% or so, not every frame) */
  private sent: Record<string, number> = {};
  private platform: Platform;
  private constructor(platform: Platform) { this.platform = platform; }

  static async load(platform: Platform): Promise<Achievements> {
    const a = new Achievements(platform);
    try {
      const o = JSON.parse((await platform.storage.get(ACH_KEY)) || '{}') as Record<string, unknown>;
      for (const [k, v] of Object.entries((o.unlocked && typeof o.unlocked === 'object' ? o.unlocked : {}) as Record<string, unknown>))
        if (Object.hasOwn(ACH_BY_ID, k) && typeof v === 'number' && Number.isFinite(v)) a.state.unlocked[k] = v;
      for (const [k, v] of Object.entries((o.progress && typeof o.progress === 'object' ? o.progress : {}) as Record<string, unknown>))
        if (Object.hasOwn(ACH_BY_ID, k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) a.state.progress[k] = v;
    } catch { /* unreadable: start empty (the platform's own list below still counts) */ }
    // what the platform has (another device, a cloud save) counts here too, and what we have is unlocked there
    try {
      const theirs = (await platform.achievements.list?.()) || [];
      for (const id of theirs) if (Object.hasOwn(ACH_BY_ID, id) && !a.state.unlocked[id]) a.state.unlocked[id] = 1;
      for (const id of Object.keys(a.state.unlocked)) if (!theirs.includes(id)) void platform.achievements.unlock(id).catch(() => {});
    } catch { /* the platform service is not there */ }
    return a;
  }

  has(id: string): boolean { return Object.hasOwn(this.state.unlocked, id); }
  /** Every achievement with its state, in table order (the UI shows hidden ones that are not unlocked as "???"). */
  list(): AchView[] {
    return ACHIEVEMENTS.map((def) => {
      const goal = def.goal || 1, at = this.state.unlocked[def.id] || 0;
      return { def, unlocked: !!at, at, cur: at ? goal : Math.min(goal, this.state.progress[def.id] || 0), goal };
    });
  }
  /** Call cb with each achievement as it unlocks. Returns the function that stops it. */
  onUnlock(cb: (a: AchDef) => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }

  /**
   * Look at a context and unlock what it earns (once each). Returns the newly unlocked ones (and calls onUnlock for each).
   * Counted ones keep their best count in memory; it is stored with the next unlock or save() (the run's end).
   */
  evaluate(c: AchCtx, now = Date.now()): AchDef[] {
    const fresh: AchDef[] = [];
    for (const a of ACHIEVEMENTS) {
      if (this.has(a.id)) continue;
      const [n, g] = achProgress(a, c);
      if (a.goal && n > (this.state.progress[a.id] || 0)) {
        this.state.progress[a.id] = n;
        const p = this.platform.achievements.progress;
        if (p && n < g && n - (this.sent[a.id] || 0) >= g / 10) { this.sent[a.id] = n; void p.call(this.platform.achievements, a.id, n, g).catch(() => {}); }
      }
      if (n >= g) { this.state.unlocked[a.id] = now; delete this.state.progress[a.id]; fresh.push(a); }
    }
    if (fresh.length) {
      void this.save();
      for (const a of fresh) {
        void this.platform.achievements.unlock(a.id).catch(() => {});
        for (const cb of this.subs) { try { cb(a); } catch { /* a listener's own error */ } }
      }
    }
    return fresh;
  }
  /** Store the state now (resolves when written; a storage error is swallowed: the state stays in memory). */
  save(): Promise<unknown> {
    // Another tab of the game may have written since this one loaded: merge what is stored (unlocks kept, the earlier time;
    // the higher count) so one tab never wipes out what the other earned. reset() writes without merging.
    this.chain = this.chain.then(async () => {
      if (!this.resetting) {
        try {
          const o = JSON.parse((await this.platform.storage.get(ACH_KEY)) || '{}') as Record<string, unknown>;
          const un = (o.unlocked && typeof o.unlocked === 'object' ? o.unlocked : {}) as Record<string, unknown>;
          const pr = (o.progress && typeof o.progress === 'object' ? o.progress : {}) as Record<string, unknown>;
          for (const [k, v] of Object.entries(un)) {
            if (!Object.hasOwn(ACH_BY_ID, k) || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
            const mine = this.state.unlocked[k];
            if (!mine || v < mine) { this.state.unlocked[k] = v; delete this.state.progress[k]; }
          }
          for (const [k, v] of Object.entries(pr)) {
            if (!Object.hasOwn(ACH_BY_ID, k) || this.has(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
            this.state.progress[k] = Math.min(ACH_BY_ID[k].goal || 1, Math.max(this.state.progress[k] || 0, v));
          }
        } catch { /* unreadable: this tab's state stands */ }
      }
      this.resetting = false;
      await this.platform.storage.set(ACH_KEY, JSON.stringify(this.state));
    }).catch(() => {});
    return this.chain;
  }
  private resetting = false;
  /** Forget every achievement (the platform's own service keeps its unlocks: they cannot be taken back there). */
  async reset(): Promise<void> { this.state = { v: 1, unlocked: {}, progress: {} }; this.sent = {}; this.resetting = true; await this.save(); }
}
