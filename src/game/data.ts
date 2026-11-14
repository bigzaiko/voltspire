// VOLTSPIRE — static game data: map, towers, enemies, cards.

export const CELL = 2;
export const GW = 26;
export const GH = 18;
export const MAX_ENERGY = 100;
export const WIN_WAVE = 20;

export const cellX = (cx: number) => (cx - GW / 2 + 0.5) * CELL;
export const cellZ = (cz: number) => (cz - GH / 2 + 0.5) * CELL;
export const worldToCell = (x: number, z: number): [number, number] => [
  Math.floor(x / CELL + GW / 2),
  Math.floor(z / CELL + GH / 2),
];

/** Path waypoints in cell coordinates (enemies enter on the left, core on the right). */
export const PATH_CELLS: [number, number][] = [
  [-2, 3], [5, 3], [5, 13], [11, 13], [11, 5], [17, 5], [17, 13], [21, 13], [21, 8], [22.4, 8],
];
export const CORE_CELL: [number, number] = [24, 8];

export type TowerType = 'pulse' | 'cryo' | 'arc' | 'mortar' | 'rail' | 'beacon';
export const TOWER_TYPES: TowerType[] = ['pulse', 'cryo', 'arc', 'mortar', 'rail', 'beacon'];

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
}

export const TOWERS: Record<TowerType, TowerDef> = {
  pulse: { name: 'Pulse Turret', cost: 50, dmg: 7, rate: 3.2, range: 7.5, color: 0x19e3ff, desc: 'Rapid homing bolts. Cheap and reliable.', key: '1' },
  cryo: { name: 'Cryo Emitter', cost: 70, dmg: 4, rate: 1.0, range: 6.5, aoe: 2.4, color: 0x9fd8ff, desc: 'Chills a group, slowing them.', key: '2' },
  arc: { name: 'Arc Pylon', cost: 110, dmg: 15, rate: 1.15, range: 7, color: 0xa35bff, desc: 'Lightning that chains between enemies.', key: '3' },
  mortar: { name: 'Plasma Mortar', cost: 140, dmg: 42, rate: 0.42, range: 12, minRange: 3, aoe: 2.8, color: 0xff8a1f, desc: 'Long-range blast. Cannot hit flyers.', key: '4' },
  rail: { name: 'Railgun', cost: 190, dmg: 130, rate: 0.3, range: 17, color: 0xff2bd6, desc: 'Piercing beam. Targets the toughest.', key: '5' },
  beacon: { name: 'Signal Beacon', cost: 120, dmg: 0, rate: 0, range: 5.5, color: 0x5dff8f, desc: 'Boosts damage and speed of nearby towers.', key: '6' },
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
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  grunt: { name: 'Grunt', hp: 30, speed: 3.0, bounty: 5, xp: 2, energy: 1.5, r: 0.55, y: 0.6, armor: 0, shield: 0, leak: 1, cost: 1, from: 1, scale: 1 },
  runner: { name: 'Runner', hp: 15, speed: 5.0, bounty: 2, xp: 1, energy: 0.9, r: 0.5, y: 0.4, armor: 0, shield: 0, leak: 1, cost: 0.6, from: 2, scale: 1 },
  drone: { name: 'Drone', hp: 24, speed: 3.8, bounty: 4, xp: 2, energy: 1.4, r: 0.55, y: 2.4, armor: 0, shield: 0, leak: 1, cost: 1.2, from: 4, fly: true, scale: 1 },
  shield: { name: 'Aegis', hp: 60, speed: 2.5, bounty: 9, xp: 5, energy: 3, r: 0.7, y: 0.8, armor: 0, shield: 60, leak: 2, cost: 3, from: 6, scale: 1 },
  brute: { name: 'Brute', hp: 190, speed: 1.9, bounty: 13, xp: 8, energy: 5, r: 0.95, y: 1.1, armor: 3, shield: 0, leak: 3, cost: 5, from: 8, scale: 1 },
  boss: { name: 'Colossus', hp: 1300, speed: 1.3, bounty: 160, xp: 50, energy: 30, r: 2.0, y: 1.8, armor: 4, shield: 0, leak: 10, cost: 30, from: 5, scale: 1 },
};

export const waveHpMul = (w: number) => 1 + 0.3 * (w - 1) + 0.09 * (w - 1) * (w - 1);

/** Bow tiers — the bow evolves as the run progresses. */
export const BOW_TIERS = [
  { name: 'Carbon Bow', color: 0x35f0ff, mul: 1, perk: 'Standard carbon arrows.' },
  { name: 'Pulse Bow', color: 0x5dff8f, mul: 1.8, perk: 'Arrows pierce one extra target.' },
  { name: 'Tempest Bow', color: 0xffd23f, mul: 3.0, perk: 'Fires one extra arrow.' },
  { name: 'Nova Bow', color: 0xff8a1f, mul: 4.8, perk: 'Arrows explode on impact.' },
  { name: 'Singularity Bow', color: 0xff2bd6, mul: 7.5, perk: 'Arrows chain lightning.' },
];
export const bowTier = (wave: number) => Math.min(BOW_TIERS.length - 1, Math.floor(Math.max(0, wave - 1) / 4));

export interface Mods {
  tDmg: number; tRate: number; tRange: number;
  arcChain: number; shatter: number; napalm: number; twin: number; railCap: number;
  gold: number; xp: number; interest: number; beacon: number; cheap: number;
  /** per-tower-type multipliers */
  tw: Record<TowerType, { dmg: number; rate: number; range: number }>;
  pulseCrit: number; cryoSlow: number; cryoAoe: number; arcSlow: number; mortarAoe: number; railBreak: number; beaconFeed: number;
}
export const baseMods = (): Mods => ({
  tDmg: 1, tRate: 1, tRange: 1, arcChain: 0, shatter: 0, napalm: 0, twin: 0, railCap: 0,
  gold: 1, xp: 1, interest: 0, beacon: 0, cheap: 1,
  tw: Object.fromEntries(TOWER_TYPES.map((t) => [t, { dmg: 1, rate: 1, range: 1 }])) as Mods['tw'],
  pulseCrit: 0, cryoSlow: 0, cryoAoe: 0, arcSlow: 0, mortarAoe: 0, railBreak: 0, beaconFeed: 0,
});

export interface HeroStats {
  dmg: number; rate: number; arrows: number; pierce: number; explode: number; chain: number;
  dur: number; charge: number; cdr: number; rain: number; sing: number;
}
export const baseHero = (): HeroStats => ({
  dmg: 1, rate: 1, arrows: 1, pierce: 0, explode: 0, chain: 0, dur: 0, charge: 1, cdr: 1, rain: 1, sing: 1,
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
  bp('arc', '↯'), bp('mortar', '◉'), bp('rail', '⟫'), bp('beacon', '✶'),
  // tower buffs
  { id: 'overclock', name: 'Overclock', desc: 'All towers fire 15% faster.', rar: 0, kind: 'tower', max: 6, icon: '»', apply: (c) => { c.mods.tRate *= 1.15; } },
  { id: 'hollow', name: 'Hot Rounds', desc: 'All towers deal 20% more damage.', rar: 0, kind: 'tower', max: 8, icon: '▲', apply: (c) => { c.mods.tDmg *= 1.2; } },
  { id: 'optics', name: 'Long Optics', desc: 'All towers gain 10% range.', rar: 0, kind: 'tower', max: 4, icon: '◎', apply: (c) => { c.mods.tRange *= 1.1; } },
  { id: 'twin', name: 'Twin Barrels', desc: 'Pulse Turrets fire an extra bolt.', rar: 1, kind: 'tower', max: 2, icon: '⫴', apply: (c) => { c.mods.twin += 1; } },
  { id: 'shatter', name: 'Cryo Shatter', desc: 'Slowed enemies take 30% more damage.', rar: 1, kind: 'tower', max: 3, icon: '❄', apply: (c) => { c.mods.shatter += 0.3; } },
  { id: 'chain', name: 'Chain Reaction', desc: 'Arc Pylons jump to 2 more enemies.', rar: 1, kind: 'tower', max: 3, icon: '↯', needs: 'arc', apply: (c) => { c.mods.arcChain += 2; } },
  { id: 'napalm', name: 'Plasma Pools', desc: 'Mortar blasts leave burning ground.', rar: 1, kind: 'tower', max: 3, icon: '♨', needs: 'mortar', apply: (c) => { c.mods.napalm += 1; } },
  { id: 'railcap', name: 'Rail Capacitor', desc: 'Railguns deal 50% more and pierce everything.', rar: 2, kind: 'tower', max: 2, icon: '⟫', needs: 'rail', apply: (c) => { c.mods.railCap += 1; } },
  { id: 'relay', name: 'Signal Relay', desc: 'Beacons boost 15% harder.', rar: 1, kind: 'tower', max: 3, icon: '✶', needs: 'beacon', apply: (c) => { c.mods.beacon += 0.15; } },
  // dedicated upgrades for each tower type (offered once that tower is unlocked)
  { id: 'p_servo', name: 'Tracking Servos', desc: 'Pulse Turrets fire 25% faster.', rar: 0, kind: 'tower', max: 4, icon: '»', needs: 'pulse', apply: (c) => { c.mods.tw.pulse.rate *= 1.25; } },
  { id: 'p_crit', name: 'Overpressure Rounds', desc: 'Pulse bolts gain a 15% chance to deal triple damage.', rar: 1, kind: 'tower', max: 3, icon: '✸', needs: 'pulse', apply: (c) => { c.mods.pulseCrit += 0.15; } },
  { id: 'p_dmg', name: 'Dense Cores', desc: 'Pulse Turrets deal 30% more damage.', rar: 0, kind: 'tower', max: 4, icon: '▲', needs: 'pulse', apply: (c) => { c.mods.tw.pulse.dmg *= 1.3; } },
  { id: 'c_deep', name: 'Deep Freeze', desc: 'Cryo slows harder and for 1 second longer.', rar: 0, kind: 'tower', max: 3, icon: '❄', needs: 'cryo', apply: (c) => { c.mods.cryoSlow += 1; } },
  { id: 'c_wide', name: 'Wide Nozzle', desc: 'Cryo blasts cover a 35% larger area.', rar: 0, kind: 'tower', max: 3, icon: '◌', needs: 'cryo', apply: (c) => { c.mods.cryoAoe += 1; } },
  { id: 'c_brittle', name: 'Brittle Frost', desc: 'Cryo Emitters deal 80% more damage.', rar: 1, kind: 'tower', max: 3, icon: '✧', needs: 'cryo', apply: (c) => { c.mods.tw.cryo.dmg *= 1.8; } },
  { id: 'a_volt', name: 'Overvolt', desc: 'Arc Pylons deal 30% more damage.', rar: 0, kind: 'tower', max: 4, icon: '▲', needs: 'arc', apply: (c) => { c.mods.tw.arc.dmg *= 1.3; } },
  { id: 'a_static', name: 'Static Field', desc: 'Arc lightning briefly slows everything it hits.', rar: 1, kind: 'tower', max: 2, icon: '≋', needs: 'arc', apply: (c) => { c.mods.arcSlow += 1; } },
  { id: 'a_reach', name: 'Tall Coils', desc: 'Arc Pylons gain 20% range.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'arc', apply: (c) => { c.mods.tw.arc.range *= 1.2; } },
  { id: 'm_cluster', name: 'Cluster Shells', desc: 'Mortar blasts are 25% larger.', rar: 0, kind: 'tower', max: 3, icon: '❂', needs: 'mortar', apply: (c) => { c.mods.mortarAoe += 1; } },
  { id: 'm_heavy', name: 'Heavy Payload', desc: 'Plasma Mortars deal 35% more damage.', rar: 0, kind: 'tower', max: 4, icon: '▲', needs: 'mortar', apply: (c) => { c.mods.tw.mortar.dmg *= 1.35; } },
  { id: 'm_auto', name: 'Autoloader', desc: 'Plasma Mortars fire 30% faster.', rar: 1, kind: 'tower', max: 3, icon: '»', needs: 'mortar', apply: (c) => { c.mods.tw.mortar.rate *= 1.3; } },
  { id: 'r_quick', name: 'Quick Capacitors', desc: 'Railguns fire 30% faster.', rar: 0, kind: 'tower', max: 3, icon: '»', needs: 'rail', apply: (c) => { c.mods.tw.rail.rate *= 1.3; } },
  { id: 'r_break', name: 'Armour Breaker', desc: 'Rail slugs ignore armour and hit Brutes and Colossi 30% harder.', rar: 1, kind: 'tower', max: 2, icon: '⛏', needs: 'rail', apply: (c) => { c.mods.railBreak += 1; } },
  { id: 'r_scope', name: 'Horizon Scope', desc: 'Railguns gain 25% range.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'rail', apply: (c) => { c.mods.tw.rail.range *= 1.25; } },
  { id: 'b_wide', name: 'Wide Band', desc: 'Beacons reach 30% further.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'beacon', apply: (c) => { c.mods.tw.beacon.range *= 1.3; } },
  { id: 'b_feed', name: 'Uplink Feed', desc: 'Each Beacon slowly charges your ultimate.', rar: 1, kind: 'tower', max: 2, icon: '⚡', needs: 'beacon', apply: (c) => { c.mods.beaconFeed += 1; } },
  { id: 'fab', name: 'Nano Fabricator', desc: 'Towers and upgrades cost 10% less.', rar: 1, kind: 'eco', max: 3, icon: '⬡', apply: (c) => { c.mods.cheap *= 0.9; } },
  // hero
  { id: 'split', name: 'Split Shot', desc: 'Kestrel fires 2 more arrows per shot.', rar: 1, kind: 'hero', max: 3, icon: '⋔', apply: (c) => { c.hero.arrows += 2; } },
  { id: 'pierce', name: 'Phase Tips', desc: 'Arrows pierce 2 more enemies.', rar: 0, kind: 'hero', max: 3, icon: '➶', apply: (c) => { c.hero.pierce += 2; } },
  { id: 'volatile', name: 'Volatile Tips', desc: 'Arrows explode in a small blast.', rar: 1, kind: 'hero', max: 3, icon: '✹', apply: (c) => { c.hero.explode += 1; } },
  { id: 'quick', name: 'Quick Draw', desc: 'Kestrel shoots 25% faster.', rar: 0, kind: 'hero', max: 4, icon: '≫', apply: (c) => { c.hero.rate *= 1.25; } },
  { id: 'overcharge', name: 'Overcharge', desc: 'Arrows and skills deal 30% more damage.', rar: 0, kind: 'hero', max: 6, icon: '✦', apply: (c) => { c.hero.dmg *= 1.3; } },
  { id: 'uplink', name: 'Extended Uplink', desc: 'Ultimate lasts 4 seconds longer.', rar: 1, kind: 'hero', max: 3, icon: '◷', apply: (c) => { c.hero.dur += 4; } },
  { id: 'charge', name: 'Fast Charge', desc: 'Ultimate charges 25% faster.', rar: 0, kind: 'hero', max: 4, icon: '⚡', apply: (c) => { c.hero.charge *= 1.25; } },
  { id: 'arcarrow', name: 'Storm Fletching', desc: 'Arrows chain lightning to 2 enemies.', rar: 2, kind: 'hero', max: 2, icon: '⌁', apply: (c) => { c.hero.chain += 2; } },
  { id: 'rain', name: 'Monsoon Protocol', desc: 'Arrow Rain is larger and hits harder.', rar: 1, kind: 'hero', max: 3, icon: '☂', apply: (c) => { c.hero.rain += 0.5; } },
  { id: 'sing', name: 'Event Horizon', desc: 'Singularity is larger and hits harder.', rar: 1, kind: 'hero', max: 3, icon: '◍', apply: (c) => { c.hero.sing += 0.5; } },
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
