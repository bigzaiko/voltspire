// VOLTSPIRE: static game data: map, towers, enemies, cards.

// The board is a hex grid: all grid geometry lives in hex.ts.
export { CELL, GW, GH, cellX, cellZ, worldToCell } from './hex.ts';
export const MAX_ENERGY = 100;
export const WIN_WAVE = 20;

export type TowerType = 'pulse' | 'cryo' | 'arc' | 'mortar' | 'rail' | 'beacon' | 'flame' | 'lance' | 'missile' | 'gravity' | 'spire';
export const TOWER_TYPES: TowerType[] = ['pulse', 'cryo', 'arc', 'mortar', 'rail', 'beacon', 'flame', 'lance', 'missile', 'gravity', 'spire'];

/** A tower's special: charged over `charge` seconds, fired by shooting the tower's power node during the Uplink, then the tower reboots for `down` seconds. */
export interface TowerSpecial { name: string; desc: string; charge: number; down: number }
export interface TowerDef {
  name: string;
  cost: number;
  dmg: number;
  rate: number; // shots per second
  range: number;
  minRange?: number;
  aoe?: number;
  color: number;
  desc: string;
  key: string;
  special?: TowerSpecial;
}

// Colours follow the "Ember" palette: warm sand / apricot / rust for the defenders, cold blue-white for the Static.
export const TOWERS: Record<TowerType, TowerDef> = {
  pulse: { name: 'Pulse Turret', cost: 50, dmg: 7, rate: 3.2, range: 7.5, color: 0xe3dc92, desc: 'Rapid homing bolts. Cheap and reliable.', key: '1', special: { name: 'Bullet Storm', desc: 'Fires five times as fast for 5 seconds.', charge: 35, down: 5 } },
  cryo: { name: 'Cryo Emitter', cost: 70, dmg: 4, rate: 1.0, range: 6.5, aoe: 2.4, color: 0xbfe3ea, desc: 'Chills a group, slowing them.', key: '2', special: { name: 'Flash Freeze', desc: 'Freezes everything in range solid for 3 seconds.', charge: 40, down: 5 } },
  arc: { name: 'Arc Pylon', cost: 110, dmg: 15, rate: 1.15, range: 7, color: 0xb48cff, desc: 'Lightning that chains between enemies.', key: '3', special: { name: 'Thunderhead', desc: 'One massive bolt that chains through a dozen enemies.', charge: 40, down: 7 } },
  mortar: { name: 'Plasma Mortar', cost: 140, dmg: 42, rate: 0.42, range: 12, minRange: 3, aoe: 2.8, color: 0xf68b56, desc: 'Long-range blast. Cannot hit flyers.', key: '4', special: { name: 'Barrage', desc: 'Drops eight heavy shells on the road in range.', charge: 45, down: 8 } },
  rail: { name: 'Railgun', cost: 190, dmg: 130, rate: 0.3, range: 17, color: 0xff5a3c, desc: 'Piercing beam. Targets the toughest.', key: '5', special: { name: 'Overcharge', desc: 'A map-long slug that pierces everything for eight times the damage.', charge: 50, down: 8 } },
  beacon: { name: 'Signal Beacon', cost: 120, dmg: 0, rate: 0, range: 5.5, color: 0x9ccf6a, desc: 'Boosts damage and speed of nearby towers.', key: '6', special: { name: 'Surge', desc: 'Triples its boost for 8 seconds.', charge: 45, down: 6 } },
  // Firewall Pylon: dmg x rate is what a wall deals per second to everything inside it; range is the link reach (4 tiles) in world units
  flame: { name: 'Firewall Pylon', cost: 90, dmg: 15, rate: 2, range: 8, color: 0xffb02e, desc: 'Build two within 4 tiles of each other and a wall of fire burns between them. On its own it only burns a small ring.', key: '7', special: { name: 'Inferno', desc: 'Its walls burn 2.5 times as hard and wider for 5 seconds.', charge: 40, down: 6 } },
  lance: { name: 'Lance Emitter', cost: 160, dmg: 9, rate: 4, range: 9, color: 0xff8fa8, desc: 'A continuous beam that burns hotter the longer it holds a target.', key: '8', special: { name: 'Overload', desc: 'Instantly at full heat, far hotter and piercing for 5 seconds. Comes back online still hot.', charge: 45, down: 6 } },
  missile: { name: 'Missile Battery', cost: 170, dmg: 22, rate: 0.55, range: 13, aoe: 1.5, color: 0xd9a05b, desc: 'Salvos of homing missiles. Prefers flyers.', key: '9', special: { name: 'Swarm', desc: 'Launches two dozen missiles at targets anywhere on the map.', charge: 50, down: 7 } },
  gravity: { name: 'Graviton Well', cost: 120, dmg: 0, rate: 0.5, range: 5.5, color: 0x7a8cff, desc: 'Deals no damage. Drags enemies back and slows them.', key: '0', special: { name: 'Collapse', desc: 'Opens a singularity on the toughest enemy in range.', charge: 55, down: 9 } },
  spire: { name: 'Uplink Spire', cost: 180, dmg: 0, rate: 0, range: 0, color: 0x6fe0c8, desc: 'A tall relay tower. Kestrel can only uplink to Spires, and teleports between them. Upgrades amplify her arrows.', key: 't' },
};

export const LVL_DMG = [1, 1.65, 2.6];
export const LVL_RANGE = [1, 1.08, 1.16];
export const LVL_RATE = [1, 1.1, 1.25];
export const upgradeCost = (t: TowerType, lvl: number) => Math.round(TOWERS[t].cost * (lvl === 1 ? 0.9 : 1.6));

export type EnemyType = 'grunt' | 'runner' | 'drone' | 'shield' | 'brute' | 'boss';
export const ENEMY_TYPES: EnemyType[] = ['grunt', 'runner', 'drone', 'shield', 'brute', 'boss'];

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  bounty: number;
  xp: number;
  energy: number;
  r: number; // hit radius
  y: number; // centre height
  armor: number;
  shield: number;
  leak: number; // lives lost
  cost: number; // wave budget
  from: number; // first wave
  fly?: boolean;
  scale: number;
  /** Weak points in the model's local space (x = right, y = up, z = forward, unscaled). Only Kestrel's arrows and Rail Shot can hit them. */
  weak?: { x: number; y: number; z: number; r: number; mul: number }[];
}

/** Model scale per enemy type (weak points and the view use it). */
export const ENEMY_SCALE: Record<EnemyType, number> = { grunt: 1, runner: 1, drone: 1, shield: 1, brute: 1, boss: 0.95 };

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  grunt: { name: 'Grunt', hp: 28, speed: 3.0, bounty: 5, xp: 2, energy: 1.5, r: 0.55, y: 0.6, armor: 0, shield: 0, leak: 1, cost: 1, from: 1, scale: 1 },
  runner: { name: 'Runner', hp: 14, speed: 5.0, bounty: 2, xp: 1, energy: 0.9, r: 0.5, y: 0.4, armor: 0, shield: 0, leak: 1, cost: 0.6, from: 2, scale: 1 },
  drone: { name: 'Drone', hp: 22, speed: 3.8, bounty: 4, xp: 2, energy: 1.4, r: 0.55, y: 2.4, armor: 0, shield: 0, leak: 1, cost: 1.2, from: 4, fly: true, scale: 1 },
  shield: { name: 'Aegis', hp: 55, speed: 2.5, bounty: 9, xp: 5, energy: 3, r: 0.7, y: 0.8, armor: 0, shield: 55, leak: 2, cost: 3, from: 6, scale: 1 },
  brute: { name: 'Brute', hp: 175, speed: 1.9, bounty: 13, xp: 8, energy: 5, r: 0.95, y: 1.1, armor: 3, shield: 0, leak: 3, cost: 5, from: 8, scale: 1, weak: [{ x: 0, y: 1.3, z: -0.55, r: 0.4, mul: 2.5 }] },
  boss: { name: 'Colossus', hp: 1200, speed: 1.3, bounty: 160, xp: 50, energy: 30, r: 1.6, y: 1.4, armor: 4, shield: 0, leak: 6, cost: 30, from: 5, scale: 1, weak: [{ x: 0, y: 2.1, z: -1.6, r: 0.6, mul: 3 }, { x: 0, y: 2.9, z: 1.5, r: 0.45, mul: 2.5 }] },
};

/** Global balance knobs (tools/balance.ts can override them from the TUNE environment variable to sweep values). */
/** Strength of each extra Twin Barrels bolt, and the damage multiplier of an Overpressure crit. */
export const TWIN_BOLT = 0.45;
/** Rail Capacitor: extra damage per stack. Lance: extra damage at full heat (base, and per Focusing Lens). */
export const RAIL_CAP = 0.35;
export const LANCE_HEAT = 1.5;
export const LANCE_FOCUS = 0.5;
export const PULSE_CRIT = 2;
/** An enemy that reaches the core attacks it for this long (a Colossus for BREACH_TIME_BOSS). If it is still alive then, the core takes its `leak` and the discharge destroys it. */
export const BREACH_TIME = 0.7;
export const BREACH_TIME_BOSS = 1.6;
/** A Colossus never takes more than this share of the starting integrity in one breach (at most its `leak`). */
export const BREACH_SHARE = 0.25;
/** Seconds before the first wave arrives on its own (it can be called earlier), and between later waves. */
export const FIRST_WAVE_IN = 30;
export const NEXT_WAVE_IN = 12;
/** The bow: seconds to a full draw, the weakest draw that still looses an arrow, the pause before the next arrow can be drawn, and how many of the old stream arrows a full draw is worth. */
export const DRAW_TIME = 0.45;
export const MIN_DRAW = 0.2;
export const NOCK_TIME = 0.1;
export const FULL_DRAW_MUL = 2.2;
/** Seconds an Uplink lasts before cards. */
export const HERO_DUR = 17.5;
/** Firewall Pylons: link reach in tiles, half the thickness of a wall, the radius a lone pylon burns, and the colour of a singularity. */
export const LINK_RANGE = 4;
export const WALL_HALF = 0.75;
export const FIRE_RING = 2.2;
export const SING_COLOR = 0xa99cff;
/** Co-op: enemy health and wave budget multipliers at full strength (see TUNE.coopHp / coopCount and coopScale()). */
export const COOP_HP = 2.5;
export const COOP_COUNT = 1.2;

export const TUNE = {
  /** enemy health per wave: 1 + hp1·(w-1) + hp2·(w-1)² + hp3·(w-1)³ */
  hp1: 0.2, hp2: 0.02, hp3: 0.005,
  /** wave budget: bud0 + bud1·w + w^budP */
  bud0: 8, bud1: 5, budP: 1.5,
  /** base arrow damage, credits per kill, wave-clear bonus (base + perWave·w), kill energy */
  arrow: 10, bounty: 1, clear0: 15, clear1: 3, energy: 1, energyT: 0.8,
  /** enemy health scales with (mean road length / mapLen)^mapPow · (road in reach of the best tiles / mapCov)^mapCovPow, see mapEase() in sim.ts.
   *  starter: extra factor for the first map (Switchback), which new players learn on and which plays harder than its shape suggests */
  mapLen: 105, mapPow: 0.2, mapCov: 39.8, mapCovPow: 0.64, starter: 0.78,
  /** Colossus: share of tower damage that gets through its plating, tower damage multiplier while the plating is cracked open, seconds a weak-point hit keeps it open, health multiplier */
  plate: 0.45, cracked: 1.25, crack: 3, boss: 1,
  /** co-op: enemy health and wave budget multipliers once the run is under way. Two players start with the same credits as one, so the first coopFrom waves are the solo ones and the extra then ramps in over coopRamp waves. */
  coopHp: COOP_HP, coopCount: COOP_COUNT, coopFrom: 3, coopRamp: 12,
  /** Lance: extra damage at full heat */
  lanceHeat: LANCE_HEAT,
};
/** Co-op multiplier for wave w: `full` (e.g. TUNE.coopHp) eased in between wave coopFrom and wave coopFrom + coopRamp. */
export const coopScale = (full: number, w: number) => 1 + (full - 1) * Math.max(0, Math.min(1, (w - TUNE.coopFrom) / Math.max(1, TUNE.coopRamp)));
export const waveHpMul = (w: number) => 1 + TUNE.hp1 * (w - 1) + TUNE.hp2 * (w - 1) * (w - 1) + TUNE.hp3 * (w - 1) * (w - 1) * (w - 1);
/** Enemy budget of wave w (see ENEMIES[..].cost), before the difficulty's count multiplier. */
export const waveBudget = (w: number) => TUNE.bud0 + w * TUNE.bud1 + Math.pow(w, TUNE.budP);

/** Bow tiers: the bow evolves as the run progresses. Colours stay on the Ember ramp (sand, verdigris, apricot, vermilion, white-gold). */
export const BOW_TIERS = [
  { name: 'Carbon Bow', color: 0xe3dc92, mul: 1, perk: 'Standard carbon arrows.' },
  { name: 'Pulse Bow', color: 0x6fe0c8, mul: 1.8, perk: 'Arrows pierce one extra target.' },
  { name: 'Tempest Bow', color: 0xf68b56, mul: 3.0, perk: 'Fires one extra arrow.' },
  { name: 'Nova Bow', color: 0xff5a3c, mul: 4.8, perk: 'Arrows explode on impact.' },
  { name: 'Singularity Bow', color: 0xfff2c4, mul: 7.5, perk: 'Arrows chain lightning.' },
];
export const bowTier = (wave: number) => Math.min(BOW_TIERS.length - 1, Math.floor(Math.max(0, wave - 1) / 4));

export interface Mods {
  tDmg: number; tRate: number; tRange: number;
  arcChain: number; shatter: number; napalm: number; twin: number; railCap: number;
  gold: number; xp: number; interest: number; beacon: number; cheap: number;
  /** per-tower-type multipliers */
  tw: Record<TowerType, { dmg: number; rate: number; range: number }>;
  pulseCrit: number; cryoSlow: number; cryoAoe: number; arcSlow: number; mortarAoe: number; railBreak: number; beaconFeed: number;
  /** tower specials: charge speed, reboot time multiplier, strength */
  specCharge: number; reboot: number; specPow: number;
  /** Firewall Pylons: burn stacks (Sticky Fire), Slag Curtain stacks, extra link reach in tiles */
  flameBurn: number; flameMelt: number; flameLink: number; lanceHeat: number; lanceRamp: number; missilePods: number; missileAoe: number; gravPull: number; gravVuln: number;
}
export const baseMods = (): Mods => ({
  tDmg: 1, tRate: 1, tRange: 1, arcChain: 0, shatter: 0, napalm: 0, twin: 0, railCap: 0,
  gold: 1, xp: 1, interest: 0, beacon: 0, cheap: 1,
  tw: Object.fromEntries(TOWER_TYPES.map((t) => [t, { dmg: 1, rate: 1, range: 1 }])) as Mods['tw'],
  pulseCrit: 0, cryoSlow: 0, cryoAoe: 0, arcSlow: 0, mortarAoe: 0, railBreak: 0, beaconFeed: 0,
  specCharge: 1, reboot: 1, specPow: 1,
  flameBurn: 0, flameMelt: 0, flameLink: 0, lanceHeat: 0, lanceRamp: 0, missilePods: 0, missileAoe: 0, gravPull: 0, gravVuln: 0,
});

export interface HeroStats {
  dmg: number; rate: number; arrows: number; pierce: number; explode: number; chain: number;
  dur: number; charge: number; cdr: number; rain: number; sing: number;
  /** weak-point damage multiplier, and extra ultimate seconds per Uplink Spire owned */
  weak: number; relay: number;
}
export const baseHero = (): HeroStats => ({
  dmg: 1, rate: 1, arrows: 1, pierce: 0, explode: 0, chain: 0, dur: 0, charge: 1, cdr: 1, rain: 1, sing: 1, weak: 1, relay: 0,
});

export interface CardCtx {
  mods: Mods;
  hero: HeroStats;
  unlocked: Set<TowerType>;
  addGold(n: number): void;
  addLives(n: number): void;
}

export type CardKind = 'blueprint' | 'tower' | 'hero' | 'eco';
export interface Card {
  id: string;
  name: string;
  desc: string;
  rar: 0 | 1 | 2; // common, rare, epic
  kind: CardKind;
  max: number;
  icon: string;
  needs?: TowerType;
  apply(c: CardCtx): void;
}

const bp = (t: TowerType, icon: string): Card => ({
  id: 'bp_' + t, name: 'Blueprint: ' + TOWERS[t].name, desc: 'Unlocks the ' + TOWERS[t].name + '. ' + TOWERS[t].desc,
  rar: 1, kind: 'blueprint', max: 1, icon, apply: (c) => { c.unlocked.add(t); },
});

export const CARDS: Card[] = [
  bp('arc', '↯'), bp('mortar', '◉'), bp('rail', '⟫'), bp('beacon', '✶'), bp('flame', '♨'), bp('lance', '╪'), bp('missile', '➹'), bp('gravity', '◍'),
  // tower buffs
  { id: 'overclock', name: 'Overclock', desc: 'All towers fire 12% faster.', rar: 0, kind: 'tower', max: 5, icon: '»', apply: (c) => { c.mods.tRate *= 1.12; } },
  { id: 'hollow', name: 'Hot Rounds', desc: 'All towers deal 15% more damage.', rar: 0, kind: 'tower', max: 6, icon: '▲', apply: (c) => { c.mods.tDmg *= 1.15; } },
  { id: 'optics', name: 'Long Optics', desc: 'All towers gain 10% range.', rar: 0, kind: 'tower', max: 4, icon: '◎', apply: (c) => { c.mods.tRange *= 1.1; } },
  { id: 'twin', name: 'Twin Barrels', desc: 'Pulse Turrets fire an extra bolt at 45% strength.', rar: 1, kind: 'tower', max: 2, needs: 'pulse', icon: '⫴', apply: (c) => { c.mods.twin += 1; } },
  { id: 'shatter', name: 'Cryo Shatter', desc: 'Slowed enemies take 30% more damage.', rar: 1, kind: 'tower', max: 3, icon: '❄', apply: (c) => { c.mods.shatter += 0.3; } },
  { id: 'chain', name: 'Chain Reaction', desc: 'Arc Pylons jump to 2 more enemies.', rar: 1, kind: 'tower', max: 3, icon: '↯', needs: 'arc', apply: (c) => { c.mods.arcChain += 2; } },
  { id: 'napalm', name: 'Plasma Pools', desc: 'Mortar blasts leave burning ground.', rar: 1, kind: 'tower', max: 3, icon: '♨', needs: 'mortar', apply: (c) => { c.mods.napalm += 1; } },
  { id: 'railcap', name: 'Rail Capacitor', desc: 'Railguns deal 35% more and pierce everything.', rar: 2, kind: 'tower', max: 2, icon: '⟫', needs: 'rail', apply: (c) => { c.mods.railCap += 1; } },
  { id: 'relay', name: 'Signal Relay', desc: 'Beacons boost 15% harder.', rar: 1, kind: 'tower', max: 3, icon: '✶', needs: 'beacon', apply: (c) => { c.mods.beacon += 0.15; } },
  // dedicated upgrades for each tower type (offered once that tower is unlocked)
  { id: 'p_servo', name: 'Tracking Servos', desc: 'Pulse Turrets fire 20% faster.', rar: 0, kind: 'tower', max: 3, icon: '»', needs: 'pulse', apply: (c) => { c.mods.tw.pulse.rate *= 1.2; } },
  { id: 'p_crit', name: 'Overpressure Rounds', desc: 'Pulse bolts gain a 15% chance to deal double damage.', rar: 1, kind: 'tower', max: 2, icon: '✸', needs: 'pulse', apply: (c) => { c.mods.pulseCrit += 0.15; } },
  { id: 'p_dmg', name: 'Dense Cores', desc: 'Pulse Turrets deal 20% more damage.', rar: 0, kind: 'tower', max: 3, icon: '▲', needs: 'pulse', apply: (c) => { c.mods.tw.pulse.dmg *= 1.2; } },
  { id: 'c_deep', name: 'Deep Freeze', desc: 'Cryo slows harder and for 1 second longer.', rar: 0, kind: 'tower', max: 3, icon: '❄', needs: 'cryo', apply: (c) => { c.mods.cryoSlow += 1; } },
  { id: 'c_wide', name: 'Wide Nozzle', desc: 'Cryo blasts cover a 35% larger area.', rar: 0, kind: 'tower', max: 3, icon: '◌', needs: 'cryo', apply: (c) => { c.mods.cryoAoe += 1; } },
  { id: 'c_brittle', name: 'Brittle Frost', desc: 'Cryo Emitters deal 80% more damage.', rar: 1, kind: 'tower', max: 3, icon: '✧', needs: 'cryo', apply: (c) => { c.mods.tw.cryo.dmg *= 1.8; } },
  { id: 'a_volt', name: 'Overvolt', desc: 'Arc Pylons deal 25% more damage.', rar: 0, kind: 'tower', max: 3, icon: '▲', needs: 'arc', apply: (c) => { c.mods.tw.arc.dmg *= 1.25; } },
  { id: 'a_static', name: 'Static Field', desc: 'Arc lightning briefly slows everything it hits.', rar: 1, kind: 'tower', max: 2, icon: '≋', needs: 'arc', apply: (c) => { c.mods.arcSlow += 1; } },
  { id: 'a_reach', name: 'Tall Coils', desc: 'Arc Pylons gain 20% range.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'arc', apply: (c) => { c.mods.tw.arc.range *= 1.2; } },
  { id: 'm_cluster', name: 'Cluster Shells', desc: 'Mortar blasts are 25% larger.', rar: 0, kind: 'tower', max: 3, icon: '❂', needs: 'mortar', apply: (c) => { c.mods.mortarAoe += 1; } },
  { id: 'm_heavy', name: 'Heavy Payload', desc: 'Plasma Mortars deal 30% more damage.', rar: 0, kind: 'tower', max: 3, icon: '▲', needs: 'mortar', apply: (c) => { c.mods.tw.mortar.dmg *= 1.3; } },
  { id: 'm_auto', name: 'Autoloader', desc: 'Plasma Mortars fire 30% faster.', rar: 1, kind: 'tower', max: 3, icon: '»', needs: 'mortar', apply: (c) => { c.mods.tw.mortar.rate *= 1.3; } },
  { id: 'r_quick', name: 'Quick Capacitors', desc: 'Railguns fire 20% faster.', rar: 0, kind: 'tower', max: 3, icon: '»', needs: 'rail', apply: (c) => { c.mods.tw.rail.rate *= 1.2; } },
  { id: 'r_break', name: 'Armour Breaker', desc: 'Rail slugs ignore armour and hit Brutes and Colossi 30% harder.', rar: 1, kind: 'tower', max: 2, icon: '⛏', needs: 'rail', apply: (c) => { c.mods.railBreak += 1; } },
  { id: 'r_scope', name: 'Horizon Scope', desc: 'Railguns gain 25% range.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'rail', apply: (c) => { c.mods.tw.rail.range *= 1.25; } },
  { id: 'b_wide', name: 'Wide Band', desc: 'Beacons reach 30% further.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'beacon', apply: (c) => { c.mods.tw.beacon.range *= 1.3; } },
  { id: 'b_feed', name: 'Uplink Feed', desc: 'Each Beacon slowly charges your ultimate.', rar: 1, kind: 'tower', max: 2, icon: '⚡', needs: 'beacon', apply: (c) => { c.mods.beaconFeed += 1; } },
  { id: 'f_fuel', name: 'Long Conduits', desc: 'Firewall Pylons link one tile further apart.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'flame', apply: (c) => { c.mods.flameLink += 1; } },
  { id: 'f_burn', name: 'Sticky Fire', desc: 'Whatever crosses a firewall burns 1.5 seconds longer and 40% hotter.', rar: 0, kind: 'tower', max: 3, icon: '♨', needs: 'flame', apply: (c) => { c.mods.flameBurn += 1; } },
  { id: 'f_melt', name: 'Slag Curtain', desc: 'Firewalls are 30% thicker, and burning enemies lose 40% of their armour.', rar: 1, kind: 'tower', max: 2, icon: '⛏', needs: 'flame', apply: (c) => { c.mods.flameMelt += 1; } },
  { id: 'l_dmg', name: 'Hard Light', desc: 'Lance Emitters deal 20% more damage.', rar: 0, kind: 'tower', max: 3, icon: '▲', needs: 'lance', apply: (c) => { c.mods.tw.lance.dmg *= 1.2; } },
  { id: 'l_focus', name: 'Focusing Lens', desc: 'Lance beams can heat up a further 50%.', rar: 1, kind: 'tower', max: 2, icon: '✧', needs: 'lance', apply: (c) => { c.mods.lanceHeat += 1; } },
  { id: 'l_hold', name: 'Thermal Memory', desc: 'Lances heat up 40% faster and keep half their heat when they switch targets.', rar: 1, kind: 'tower', max: 2, icon: '≋', needs: 'lance', apply: (c) => { c.mods.lanceRamp += 1; } },
  { id: 'ms_pod', name: 'Extra Pods', desc: 'Missile Batteries launch one more missile per salvo.', rar: 1, kind: 'tower', max: 2, icon: '⫴', needs: 'missile', apply: (c) => { c.mods.missilePods += 1; } },
  { id: 'ms_war', name: 'Shaped Warheads', desc: 'Missiles deal 20% more damage.', rar: 0, kind: 'tower', max: 3, icon: '▲', needs: 'missile', apply: (c) => { c.mods.tw.missile.dmg *= 1.2; } },
  { id: 'ms_frag', name: 'Fragmentation', desc: 'Missile blasts are 30% larger.', rar: 0, kind: 'tower', max: 2, icon: '❂', needs: 'missile', apply: (c) => { c.mods.missileAoe += 1; } },
  { id: 'g_deep', name: 'Deep Well', desc: 'Graviton Wells drag enemies 25% further back.', rar: 0, kind: 'tower', max: 2, icon: '◍', needs: 'gravity', apply: (c) => { c.mods.gravPull += 1; } },
  { id: 'g_wide', name: 'Event Lens', desc: 'Graviton Wells reach 20% further.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'gravity', apply: (c) => { c.mods.tw.gravity.range *= 1.2; } },
  { id: 'g_shear', name: 'Tidal Shear', desc: 'Enemies caught by a Graviton Well take 12% more damage.', rar: 1, kind: 'tower', max: 2, icon: '✸', needs: 'gravity', apply: (c) => { c.mods.gravVuln += 0.12; } },
  // tower specials
  { id: 'capbank', name: 'Capacitor Banks', desc: 'Tower specials charge 25% faster.', rar: 0, kind: 'tower', max: 3, icon: '⚡', apply: (c) => { c.mods.specCharge *= 1.25; } },
  { id: 'reboot', name: 'Rapid Reboot', desc: 'Towers come back online 30% faster after a special.', rar: 0, kind: 'tower', max: 2, icon: '↻', apply: (c) => { c.mods.reboot *= 0.7; } },
  { id: 'aftershock', name: 'Aftershock', desc: 'Tower specials are 25% stronger: more damage, and Surge lasts 25% longer.', rar: 1, kind: 'tower', max: 3, icon: '✹', apply: (c) => { c.mods.specPow *= 1.25; } },
  { id: 'fab', name: 'Nano Fabricator', desc: 'Towers and upgrades cost 10% less.', rar: 1, kind: 'eco', max: 3, icon: '⬡', apply: (c) => { c.mods.cheap *= 0.9; } },
  // hero
  { id: 'split', name: 'Split Shot', desc: 'Kestrel looses 2 more arrows with every shot.', rar: 1, kind: 'hero', max: 3, icon: '⋔', apply: (c) => { c.hero.arrows += 2; } },
  { id: 'pierce', name: 'Phase Tips', desc: 'Arrows pierce 2 more enemies.', rar: 0, kind: 'hero', max: 3, icon: '➶', apply: (c) => { c.hero.pierce += 2; } },
  { id: 'volatile', name: 'Volatile Tips', desc: 'Arrows explode in a small blast.', rar: 1, kind: 'hero', max: 3, icon: '✹', apply: (c) => { c.hero.explode += 1; } },
  { id: 'quick', name: 'Quick Draw', desc: 'Kestrel draws the bow 25% faster.', rar: 0, kind: 'hero', max: 4, icon: '≫', apply: (c) => { c.hero.rate *= 1.25; } },
  { id: 'overcharge', name: 'Overcharge', desc: 'Arrows and skills deal 30% more damage.', rar: 0, kind: 'hero', max: 6, icon: '✦', apply: (c) => { c.hero.dmg *= 1.3; } },
  { id: 'uplink', name: 'Extended Uplink', desc: 'Ultimate lasts 4 seconds longer.', rar: 1, kind: 'hero', max: 3, icon: '◷', apply: (c) => { c.hero.dur += 4; } },
  { id: 'charge', name: 'Fast Charge', desc: 'Ultimate charges 25% faster.', rar: 0, kind: 'hero', max: 4, icon: '⚡', apply: (c) => { c.hero.charge *= 1.25; } },
  { id: 'arcarrow', name: 'Storm Fletching', desc: 'Arrows chain lightning to 2 enemies.', rar: 2, kind: 'hero', max: 2, icon: '⌁', apply: (c) => { c.hero.chain += 2; } },
  { id: 'rain', name: 'Monsoon Protocol', desc: 'Arrow Rain is larger and hits harder.', rar: 1, kind: 'hero', max: 3, icon: '☂', apply: (c) => { c.hero.rain += 0.5; } },
  { id: 'sing', name: 'Event Horizon', desc: 'Singularity is larger and hits harder.', rar: 1, kind: 'hero', max: 3, icon: '◍', apply: (c) => { c.hero.sing += 0.5; } },
  { id: 'scanner', name: 'Weak Point Scanner', desc: 'Weak-point hits deal 30% more damage.', rar: 1, kind: 'hero', max: 3, icon: '⌖', apply: (c) => { c.hero.weak += 0.3; } },
  { id: 'relayup', name: 'Relay Uplink', desc: 'Ultimate lasts 1.5 seconds longer per Uplink Spire you own (up to 3 Spires).', rar: 1, kind: 'hero', max: 2, icon: '⟟', apply: (c) => { c.hero.relay += 1.5; } },
  { id: 'cdr', name: 'Coolant Loop', desc: 'Hero skills recharge 20% faster.', rar: 0, kind: 'hero', max: 3, icon: '↻', apply: (c) => { c.hero.cdr *= 0.8; } },
  // economy
  { id: 'salvage', name: 'Salvage Rights', desc: 'Earn 20% more credits from kills.', rar: 0, kind: 'eco', max: 4, icon: '¤', apply: (c) => { c.mods.gold *= 1.2; } },
  { id: 'drop', name: 'Supply Drop', desc: 'Gain 160 credits right now.', rar: 0, kind: 'eco', max: 99, icon: '▣', apply: (c) => { c.addGold(160); } },
  { id: 'repair', name: 'Core Repair', desc: 'Restore 5 core integrity.', rar: 0, kind: 'eco', max: 99, icon: '✚', apply: (c) => { c.addLives(5); } },
  { id: 'interest', name: 'Compound Interest', desc: 'Gain 5% of your credits after each wave (max 60).', rar: 1, kind: 'eco', max: 3, icon: '％', apply: (c) => { c.mods.interest += 0.05; } },
  { id: 'learn', name: 'Neural Boost', desc: 'Gain 20% more XP.', rar: 0, kind: 'eco', max: 3, icon: '◈', apply: (c) => { c.mods.xp *= 1.2; } },
];
export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const RARITY = ['Common', 'Rare', 'Epic'];

/** Versus: squads you can pay to send at your rival. */
export const SQUADS: { id: string; name: string; cost: number; type: EnemyType; n: number }[] = [
  { id: 'runners', name: 'Runner Pack', cost: 60, type: 'runner', n: 8 },
  { id: 'drones', name: 'Drone Wing', cost: 90, type: 'drone', n: 6 },
  { id: 'aegis', name: 'Aegis Trio', cost: 130, type: 'shield', n: 3 },
  { id: 'brutes', name: 'Brute Pair', cost: 190, type: 'brute', n: 2 },
];
