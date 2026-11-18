// BEATSPIRE: static game data: map, towers, enemies, cards.

// The board is a hex grid: all grid geometry lives in hex.ts.
export { CELL, GW, GH, cellX, cellZ, worldToCell } from './hex.ts';
export const WIN_WAVE = 20;

export type TowerType = 'pulse' | 'cryo' | 'arc' | 'mortar' | 'rail' | 'beacon' | 'flame' | 'lance' | 'missile' | 'gravity';
export const TOWER_TYPES: TowerType[] = ['pulse', 'cryo', 'arc', 'mortar', 'rail', 'beacon', 'flame', 'lance', 'missile', 'gravity'];

/** A tower's special: charged over `charge` seconds, fired when the player presses Fire on the charged tower, then the tower reboots for `down` seconds. */
export interface TowerSpecial { name: string; desc: string; charge: number; down: number }
/**
 * What a tower has to be supplied with by the factory (see factory.ts). `item`: the ammunition a Transfer Arm hands it (or a
 * supply crate right beside it), `fluid`: what it draws from a pipe, `power`: units it draws from the grid while it works.
 * `shots`: shots one item is worth in this tower (else ITEM_SHOTS), `dmg`: damage multiplier this supply gives (a better
 * ammunition at level 3, see TOWER_NEEDS_L3). Use needsOf() for a tower on the field: its level can change what it needs.
 */
export interface TowerNeeds { item?: ItemType; fluid?: FluidType; power?: number; shots?: number; dmg?: number }
export interface TowerDef {
  name: string;
  cost: number;
  /** building materials (made by a Frame Works) it costs on top of the credits; 0 for the early towers */
  mat: number;
  needs: TowerNeeds;
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
  pulse: { name: 'Pulse Turret', cost: 50, mat: 0, needs: { item: 'iron_ore' }, dmg: 7, rate: 3.2, range: 7.5, color: 0xe3dc92, desc: 'Rapid homing bolts. Cheap and reliable.', key: '1', special: { name: 'Bullet Storm', desc: 'Fires five times as fast for 5 seconds.', charge: 35, down: 5 } },
  cryo: { name: 'Cryo Emitter', cost: 70, mat: 0, needs: { power: 2 }, dmg: 4, rate: 1.0, range: 6.5, aoe: 2.4, color: 0xbfe3ea, desc: 'Chills a group, slowing them.', key: '2', special: { name: 'Flash Freeze', desc: 'Freezes everything in range solid for 3 seconds.', charge: 40, down: 5 } },
  arc: { name: 'Arc Pylon', cost: 110, mat: 0, needs: { power: 3 }, dmg: 15, rate: 1.15, range: 7, color: 0xb48cff, desc: 'Lightning that chains between enemies.', key: '3', special: { name: 'Thunderhead', desc: 'One massive bolt that chains through a dozen enemies.', charge: 40, down: 7 } },
  mortar: { name: 'Plasma Mortar', cost: 140, mat: 4, needs: { item: 'shell', power: 2 }, dmg: 42, rate: 0.42, range: 12, minRange: 3, aoe: 2.8, color: 0xf68b56, desc: 'Long-range blast. Cannot hit flyers.', key: '4', special: { name: 'Barrage', desc: 'Drops eight heavy shells on the road in range.', charge: 45, down: 8 } },
  rail: { name: 'Railgun', cost: 190, mat: 3, needs: { item: 'copper', power: 4 }, dmg: 130, rate: 0.3, range: 17, color: 0xff5a3c, desc: 'Piercing beam. Targets the toughest.', key: '5', special: { name: 'Overcharge', desc: 'A map-long slug that pierces everything for eight times the damage.', charge: 50, down: 8 } },
  beacon: { name: 'Signal Beacon', cost: 120, mat: 0, needs: { power: 2 }, dmg: 0, rate: 0, range: 5.5, color: 0x9ccf6a, desc: 'Boosts damage and speed of nearby towers.', key: '6', special: { name: 'Surge', desc: 'Triples its boost for 8 seconds.', charge: 45, down: 6 } },
  // Firewall Pylon: dmg x rate is what a wall deals per second to everything inside it; range is the link reach (4 tiles) in world units
  flame: { name: 'Firewall Pylon', cost: 90, mat: 0, needs: { fluid: 'crude' }, dmg: 15, rate: 2, range: 8, color: 0xffb02e, desc: 'Build two within 4 tiles of each other and a wall of fire burns between them. On its own it only burns a small ring.', key: '7', special: { name: 'Inferno', desc: 'Its walls burn 2.5 times as hard and wider for 5 seconds.', charge: 40, down: 6 } },
  lance: { name: 'Lance Emitter', cost: 160, mat: 5, needs: { item: 'cell', power: 4 }, dmg: 9, rate: 4, range: 9, color: 0xff8fa8, desc: 'A continuous beam that burns hotter the longer it holds a target.', key: '8', special: { name: 'Overload', desc: 'Instantly at full heat, far hotter and piercing for 5 seconds. Comes back online still hot.', charge: 45, down: 6 } },
  missile: { name: 'Missile Battery', cost: 170, mat: 6, needs: { item: 'missile', power: 2 }, dmg: 22, rate: 0.55, range: 13, aoe: 1.5, color: 0xd9a05b, desc: 'Salvos of homing missiles. Prefers flyers.', key: '9', special: { name: 'Swarm', desc: 'Launches two dozen missiles at targets anywhere on the map.', charge: 50, down: 7 } },
  gravity: { name: 'Graviton Well', cost: 120, mat: 4, needs: { item: 'cell', power: 3, shots: 10 }, dmg: 0, rate: 0.5, range: 5.5, color: 0x7a8cff, desc: 'Deals no damage. Drags enemies back and slows them.', key: '0', special: { name: 'Collapse', desc: 'Opens a singularity on the toughest enemy in range.', charge: 55, down: 9 } },
};

// ---------- the factory ----------
/** Items travel on belts and through Transfer Arms (nothing passes between neighbours by itself). Ores and coal come out of mines, plates out of smelters, the rest out of their own plants. */
export type ItemType = 'iron_ore' | 'copper_ore' | 'coal' | 'iron' | 'copper' | 'shell' | 'cell' | 'missile';
export const ITEM_TYPES: ItemType[] = ['iron_ore', 'copper_ore', 'coal', 'iron', 'copper', 'shell', 'cell', 'missile'];
export const ITEMS: Record<ItemType, { name: string; color: number; short: string }> = {
  iron_ore: { name: 'Iron ore', color: 0x7f8fa6, short: 'iron ore' },
  copper_ore: { name: 'Copper ore', color: 0xc8733a, short: 'copper ore' },
  coal: { name: 'Coal', color: 0x2b2826, short: 'coal' },
  iron: { name: 'Iron plate', color: 0xc9d3de, short: 'iron plate' },
  copper: { name: 'Copper plate', color: 0xf09a55, short: 'copper plate' },
  shell: { name: 'Plasma shell', color: 0xf68b56, short: 'shell' },
  cell: { name: 'Energy cell', color: 0x7af0d8, short: 'cell' },
  missile: { name: 'Missile pack', color: 0xd9a05b, short: 'missile pack' },
};
/** Fluids run through pipes: crude oil out of pumpjacks, petrol out of refineries. */
export type FluidType = 'crude' | 'petrol';
export const FLUID_TYPES: FluidType[] = ['crude', 'petrol'];
export const FLUIDS: Record<FluidType, { name: string; color: number }> = {
  crude: { name: 'Crude oil', color: 0x3a2f45 },
  petrol: { name: 'Petrol', color: 0xffb02e },
};
/** Deposits under the deck. 0 = none. Mines sit on ore and coal, pumpjacks on oil. */
export type OreType = 'iron_ore' | 'copper_ore' | 'coal' | 'oil';
export const ORE_TYPES: OreType[] = ['iron_ore', 'copper_ore', 'coal', 'oil'];
export const ORES: Record<OreType, { name: string; color: number }> = {
  iron_ore: { name: 'Iron deposit', color: 0x6d7d94 },
  copper_ore: { name: 'Copper deposit', color: 0xb5652f },
  coal: { name: 'Coal seam', color: 0x5c5650 },
  oil: { name: 'Oil field', color: 0x6a4a9c },
};
/**
 * Shots (or for a Lance, beam ticks; for a Graviton Well, pulses) one ammunition item is worth in a tower (TowerNeeds.shots
 * overrides it per tower). Towers keep only one item waiting, so these set the flow its Transfer Arm must bring at full rate:
 * a Pulse Turret burns an ore every 2.8 s, about what one level-1 mine digs; a Missile Battery fires one salvo per pack, so
 * it fires as fast as its Missile Works builds them (its fire rate is only a cap); Lances and Wells live on their Cell Plant.
 */
export const ITEM_SHOTS: Partial<Record<ItemType, number>> = { iron_ore: 9, copper: 3, shell: 4, cell: 24, missile: 1 };
/**
 * The second ammunition some towers can be switched to at Mk3 (the "ammo upgrade"): the Pulse Turret fires plasma shells from
 * a Shell Press (harder hitting), the Firewall Pylon burns petrol from a Refinery (hotter). Reaching level 3 changes nothing
 * by itself: the switch opens with the tower's ammo card (AMMO2_CARD), and then each Mk3 tower is switched on its own
 * (Sim.setAmmo2, Tower.ammo2), so a player converts towers when the new supply line is ready. Switching drops the old ammunition.
 */
export const TOWER_NEEDS_L3: Partial<Record<TowerType, TowerNeeds>> = {
  pulse: { item: 'shell', shots: 20, dmg: 1.3 },
  flame: { fluid: 'petrol', dmg: 1.35 },
};
/** The card that opens a tower type's second ammunition (see TOWER_NEEDS_L3). */
export const AMMO2_CARD: Partial<Record<TowerType, string>> = { pulse: 'pulse_shells', flame: 'flame_petrol' };
/** The buildings the second ammunition needs (data for the cards and the panel; nothing unlocks with an upgrade any more). */
export const TOWER_CHAIN_L3: Partial<Record<TowerType, FacType[]>> = {
  pulse: ['generator', 'pole', 'smelter', 'press'],
  flame: ['generator', 'pole', 'pump', 'pipe', 'refinery'],
};
/** The second ammunition's supply line in a few words (for the ammo card, the switch and the tower panel). */
export const TOWER_SUPPLY_L3: Partial<Record<TowerType, string>> = {
  pulse: 'Plasma shells instead of ore: iron plates and coal into a Shell Press, shells by Transfer Arm to the turret. Power for the press.',
  flame: 'Petrol instead of crude: crude oil through a Refinery, petrol by pipe to the pylon.',
};
/**
 * What a tower needs right now: its second ammunition (TOWER_NEEDS_L3) when it is Mk3 and switched to it (ammo2), else
 * TOWERS[type].needs. Without `ammo2` (a preview of a tower type) it is always the first ammunition.
 */
export const needsOf = (t: { type: TowerType; lvl: number; ammo2?: boolean }): TowerNeeds => (t.ammo2 && t.lvl >= 3 && TOWER_NEEDS_L3[t.type]) || TOWERS[t.type].needs;
/**
 * Targeting modes a tower can be set to (Sim.setAim). Each picks one enemy among those the tower can hit right now (in range,
 * outside its minimum range, flyers only for a tower that can reach them); exact ties go to the enemy that came first (lower id).
 * first / last: least / most road left to the core (each enemy measured along its own road, flyers too).
 * strong / weak: most / least health plus shield, with road progress as a small tie-break (0.01 per metre); strong takes a boss or the Titan on an exact tie.
 * fast / slow: highest / lowest pace right now, after slows, singularities and freezes (a frozen enemy has pace 0, the slowest);
 * on an exact tie the one further along.
 */
export type TargetMode = 'first' | 'last' | 'strong' | 'weak' | 'fast' | 'slow';
/** Display order of the modes (also their index in co-op snapshots: append, never reorder). */
export const TARGET_MODES: TargetMode[] = ['first', 'last', 'strong', 'weak', 'fast', 'slow'];
export const TARGET_INFO: Record<TargetMode, { name: string; desc: string }> = {
  first: { name: 'First', desc: 'The enemy closest to the core.' },
  last: { name: 'Last', desc: 'The enemy furthest from the core.' },
  strong: { name: 'Strongest', desc: 'The most health and shield left. Bosses first.' },
  weak: { name: 'Weakest', desc: 'The least health and shield left: finishes enemies off.' },
  fast: { name: 'Fastest', desc: 'The quickest mover right now, after slows.' },
  slow: { name: 'Slowest', desc: 'The slowest mover right now: frozen and slowed enemies first.' },
};
/**
 * Which towers have a targeting setting: those that pick one enemy (or aim a shell or a volley at one).
 * Not the Beacon (it boosts towers), the Firewall Pylon (walls and rings burn whatever stands in them) or the Graviton Well
 * (its field drags everything in range; its Collapse goes for the heaviest enemy as a fixed rule of the special).
 */
export const TARGETABLE: Record<TowerType, boolean> = { pulse: true, cryo: true, arc: true, mortar: true, rail: true, beacon: false, flame: false, lance: true, missile: true, gravity: false };
/** The mode a new tower starts with. The Railgun and the Lance go for the strongest; the Missile Pod on 'first' also takes flyers before anything on the ground. */
export const TARGET_DEFAULT: Record<TowerType, TargetMode> = { pulse: 'first', cryo: 'first', arc: 'first', mortar: 'first', rail: 'strong', beacon: 'first', flame: 'first', lance: 'strong', missile: 'first', gravity: 'first' };

/** Crude oil a Firewall Pylon burns per tick of its fire. */
export const FUEL_PER_TICK = 0.5;

/**
 * Factory buildings. 'crate' is the supply crate a map starts with (it cannot be built). The order of FAC_TYPES is the order
 * of the build bar: logistics first, then the buildings in the order a run unlocks them. A run starts with the Transfer Arm
 * and the Mine (START_FACS); every other building comes with its own card (see PROD_CARDS, FAC_CARD).
 */
export type FacType = 'arm' | 'belt' | 'splitter' | 'tunnel' | 'mine' | 'generator' | 'pole' | 'pump' | 'pipe' | 'ptunnel' | 'smelter' | 'works' | 'press' | 'cells' | 'refinery' | 'missiles' | 'crate';
export const FAC_TYPES: FacType[] = ['arm', 'belt', 'splitter', 'tunnel', 'mine', 'generator', 'pole', 'pump', 'pipe', 'ptunnel', 'smelter', 'works', 'press', 'cells', 'refinery', 'missiles'];
/** The buildings a run starts with: mine > Transfer Arm > turret works from the first minute. */
export const START_FACS: FacType[] = ['arm', 'mine'];
export interface FacDef { name: string; cost: number; color: number; desc: string; power?: number }
export const FACS: Record<FacType, FacDef> = {
  arm: { name: 'Transfer Arm', cost: 8, color: 0xd9b25a, desc: 'Takes one item at a time from what stands behind it and puts it into what stands in front of it, straight through the tile; R turns it. It only picks what the front will take, so nothing jams in its hand. Every hand-off between buildings, towers and belts goes through an arm.' },
  belt: { name: 'Conveyor Belt', cost: 2, color: 0x8a8174, desc: 'Carries items in the direction of its arrow. Drag to lay a line; R turns it. A belt only carries: a Transfer Arm puts items on it and another takes them off. A belt pointing into another one merges onto it.' },
  splitter: { name: 'Belt Splitter', cost: 12, color: 0xb9a77c, desc: 'Takes items from every belt pointing into it and deals them out in turn to the belts leading away from it. A Transfer Arm can also take from it.' },
  tunnel: { name: 'Belt Tunnel', cost: 10, color: 0x7c7466, desc: 'Build two facing the same way, up to 4 tiles apart: items go in at the first and come out of the second, under whatever stands between (towers, roads, buildings). R turns it.' },
  mine: { name: 'Mine', cost: 15, color: 0x9d8a6a, desc: 'Build it on an iron, copper or coal deposit. Digs without power. A Transfer Arm takes the ore out.' },
  generator: { name: 'Generator', cost: 25, color: 0x6fe0c8, desc: 'Burns coal for 10 power. It powers everything within 2 tiles and wires to Power Poles up to 5 tiles away.' },
  pole: { name: 'Power Pole', cost: 6, color: 0x9ccf6a, desc: 'Carries power from a Generator: wires reach up to 5 tiles to the next pole, also across roads. Powers everything within 2 tiles.' },
  pump: { name: 'Pumpjack', cost: 30, color: 0x7a5fa0, desc: 'Build it on an oil field. Pumps crude oil into the pipes or the building beside it. Needs power.', power: 2 },
  pipe: { name: 'Pipe', cost: 3, color: 0x6f7b82, desc: 'Joins up with the pipes next to it. Carries crude oil from Pumpjacks, or petrol from a Refinery, to what stands beside it.' },
  ptunnel: { name: 'Pipe Tunnel', cost: 10, color: 0x5d686e, desc: 'Two in a straight line, up to 4 tiles apart, join their pipes under whatever stands between.' },
  smelter: { name: 'Smelter', cost: 20, color: 0xce6b44, desc: 'Melts iron ore into iron plates and copper ore into copper plates. Burns one coal for every four plates. No power needed.' },
  works: { name: 'Frame Works', cost: 30, color: 0xe3dc92, desc: 'Turns two iron plates into one building material. The stronger towers and their upgrades cost materials on top of credits. Needs power.', power: 2 },
  press: { name: 'Shell Press', cost: 35, color: 0xf68b56, desc: 'Presses an iron plate and a coal into a plasma shell for the Plasma Mortar. Needs power.', power: 2 },
  cells: { name: 'Cell Plant', cost: 40, color: 0x7af0d8, desc: 'Charges a copper plate with crude oil into an energy cell for the Lance Emitter and the Graviton Well. Needs power and a pipe.', power: 2 },
  refinery: { name: 'Refinery', cost: 45, color: 0xffb02e, desc: 'Cracks crude oil into petrol for the Missile Works. Needs power.', power: 3 },
  missiles: { name: 'Missile Works', cost: 50, color: 0xc9824a, desc: 'Builds a missile pack from an iron plate, a copper plate and petrol. Needs power and a pipe from a Refinery.', power: 3 },
  crate: { name: 'Supply Crate', cost: 0, color: 0xe3dc92, desc: 'A crate of ammunition left on the deck. It feeds a tower built right next to it by itself; a Transfer Arm can take from it too. When it is empty, the tower needs a supply line of its own.' },
};
/** What a building makes from what (the Smelter and the Generator have rules of their own, see factory.ts). `mats`: it yields building materials instead of an item. `time`: seconds at level 1. */
export interface Recipe { inp: Partial<Record<ItemType, number>>; fluid?: [FluidType, number]; out?: ItemType; mats?: number; time: number }
export const MAKES: Partial<Record<FacType, Recipe>> = {
  works: { inp: { iron: 2 }, mats: 1, time: 5 },
  press: { inp: { iron: 1, coal: 1 }, out: 'shell', time: 6 },
  cells: { inp: { copper: 1 }, fluid: ['crude', 10], out: 'cell', time: 7 },
  missiles: { inp: { iron: 1, copper: 1 }, fluid: ['petrol', 10], out: 'missile', time: 10 },
};
/**
 * Building levels: a mine, pumpjack, smelter, plant, refinery or generator can be upgraded twice (credits only, see facUpCost).
 * FAC_LVL_SPEED multiplies its work speed per level (a generator's power output), FAC_UP_COST the building's price per step.
 */
export const FAC_LVL_SPEED = [1, 1.6, 2.3];
export const FAC_UP_COST = [0.6, 1.1];
export const FAC_UPGRADABLE: ReadonlySet<FacType> = new Set<FacType>(['arm', 'mine', 'pump', 'smelter', 'works', 'press', 'cells', 'refinery', 'missiles', 'generator']);
/**
 * The order towers come in: a run starts with tier 0, and blueprints are offered tier by tier, so each new tower adds one
 * step to what the player already runs. 0: ore straight from a mine. 1: power. 2: pipes, or a smelter. 3: a second machine. 4: the long chain.
 */
export const TOWER_TIER: Record<TowerType, number> = { pulse: 0, cryo: 1, arc: 1, flame: 2, beacon: 2, rail: 2, mortar: 3, lance: 3, gravity: 3, missile: 4 };
/**
 * The factory buildings a tower's supply needs (data: a blueprint unlocks only its tower; the buildings come with their
 * own cards, see FAC_CARD, and the card offers push the missing ones while a tower waits for them). Towers that cost
 * materials list the Frame Works too (the second one and every upgrade need materials).
 */
export const TOWER_CHAIN: Record<TowerType, FacType[]> = {
  pulse: ['mine', 'arm'],
  cryo: ['mine', 'arm', 'generator', 'pole'],
  arc: ['mine', 'arm', 'generator', 'pole'],
  beacon: ['mine', 'arm', 'generator', 'pole'],
  flame: ['mine', 'arm', 'generator', 'pole', 'pump', 'pipe'],
  rail: ['mine', 'arm', 'generator', 'pole', 'smelter', 'works'],
  mortar: ['mine', 'arm', 'generator', 'pole', 'smelter', 'works', 'press'],
  lance: ['mine', 'arm', 'generator', 'pole', 'smelter', 'works', 'pump', 'pipe', 'cells'],
  gravity: ['mine', 'arm', 'generator', 'pole', 'smelter', 'works', 'pump', 'pipe', 'cells'],
  missile: ['mine', 'arm', 'generator', 'pole', 'smelter', 'works', 'pump', 'pipe', 'refinery', 'missiles'],
};
/** A tower's supply line in a few words, for its tooltip, its blueprint card and the tutorial. */
export const TOWER_SUPPLY: Record<TowerType, string> = {
  pulse: 'Mine on iron ore, a Transfer Arm from the mine into the turret.',
  cryo: 'Mine on coal, an arm into a Generator. It powers what stands within 2 tiles; Power Poles carry it further.',
  arc: 'Mine on coal, an arm into a Generator. It powers what stands within 2 tiles; Power Poles carry it further.',
  beacon: 'Power from a Generator, by pole if it stands far off.',
  flame: 'Pumpjack on an oil field (it needs power), then pipes to the pylon.',
  rail: 'Copper ore and coal by arms into a Smelter, the copper plates by arm on to the Railgun. Power as well.',
  mortar: 'Iron ore and coal into a Smelter, iron plates and coal into a Shell Press, shells by arm to the Mortar. Power as well.',
  lance: 'Copper plates from a Smelter and crude oil by pipe into a Cell Plant, cells by arm to the tower. Power as well.',
  gravity: 'Copper plates from a Smelter and crude oil by pipe into a Cell Plant, cells by arm to the tower. Power as well.',
  missile: 'Crude oil through a Refinery, petrol by pipe with iron and copper plates into a Missile Works. Power as well.',
};
/** The materials a run starts with (the first tower that costs them can go up before a Frame Works runs). */
export const START_MATS = 4;
/** Credits a run starts with are the map's, times this: the factory has to be paid for too. */
export const START_GOLD_MUL = 1.5;
/** Items in a supply crate of each kind. */
export const CRATE_STOCK: Partial<Record<ItemType, number>> = { iron_ore: 45, copper: 20, shell: 16, cell: 12, missile: 24 };

export const LVL_DMG = [1, 1.65, 2.6];
export const LVL_RANGE = [1, 1.08, 1.16];
export const LVL_RATE = [1, 1.1, 1.25];
export const upgradeCost = (t: TowerType, lvl: number) => Math.round(TOWERS[t].cost * (lvl === 1 ? 0.9 : 1.6));
/** Materials an upgrade from level lvl costs. */
export const upgradeMat = (t: TowerType, lvl: number) => Math.round(TOWERS[t].mat * (lvl === 1 ? 0.75 : 1.25));

export type EnemyType = 'grunt' | 'runner' | 'drone' | 'shield' | 'brute' | 'boss' | 'wheel' | 'brood' | 'mite' | 'titan';
// New types go at the end: co-op snapshots send the index.
export const ENEMY_TYPES: EnemyType[] = ['grunt', 'runner', 'drone', 'shield', 'brute', 'boss', 'wheel', 'brood', 'mite', 'titan'];
/** The types a normal wave is filled from, oldest first: the later a type stands here, the larger its share once it is unlocked (grunts are always mixed in). The Gyre, the Colossus, mites and the Titan come by their own rules. */
export const WAVE_POOL: EnemyType[] = ['grunt', 'runner', 'drone', 'brood', 'shield', 'brute'];

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  bounty: number;
  xp: number;
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

/** Model scale per enemy type (the view uses it). */
export const ENEMY_SCALE: Record<EnemyType, number> = { grunt: 1, runner: 1, drone: 1, shield: 1, brute: 1, boss: 0.95, wheel: 1.35, brood: 1, mite: 1, titan: 1 };

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  grunt: { name: 'Grunt', hp: 28, speed: 3.0, bounty: 5, xp: 2, r: 0.55, y: 0.6, armor: 0, shield: 0, leak: 1, cost: 1, from: 1, scale: 1 },
  runner: { name: 'Runner', hp: 14, speed: 5.0, bounty: 2, xp: 1, r: 0.5, y: 0.4, armor: 0, shield: 0, leak: 1, cost: 0.6, from: 2, scale: 1 },
  drone: { name: 'Drone', hp: 22, speed: 3.8, bounty: 4, xp: 2, r: 0.55, y: 2.4, armor: 0, shield: 0, leak: 1, cost: 1.2, from: 4, fly: true, scale: 1 },
  shield: { name: 'Aegis', hp: 55, speed: 2.5, bounty: 9, xp: 5, r: 0.7, y: 0.8, armor: 0, shield: 55, leak: 2, cost: 3, from: 6, scale: 1 },
  brute: { name: 'Brute', hp: 175, speed: 1.9, bounty: 13, xp: 8, r: 0.95, y: 1.1, armor: 3, shield: 0, leak: 3, cost: 5, from: 8, scale: 1 },
  // Colossus: armour 4 floored the starter Pulse bolts (35% got through); it lost a point of armour and kept its 1200 health, so the challenge stays.
  boss: { name: 'Colossus', hp: 1200, speed: 1.3, bounty: 160, xp: 50, r: 1.6, y: 1.4, armor: 3, shield: 0, leak: 6, cost: 30, from: 5, scale: 1 },
  // Gyre: a machine riding inside one large armoured wheel, a mini-boss that rolls in on its own (see gyreCount). `speed` is its pace at full spin (see WHEEL_GUARD below).
  wheel: { name: 'Gyre', hp: 520, speed: 4.2, bounty: 55, xp: 24, r: 1.4, y: 1.5, armor: 0, shield: 0, leak: 4, cost: 16, from: 8, scale: 1 },
  // Broodcarrier: sturdy and slow. It walks the road and lets swarms of mites loose on the towers beside it (see BROOD_* below).
  brood: { name: 'Broodcarrier', hp: 230, speed: 1.8, bounty: 15, xp: 9, r: 1.0, y: 1.0, armor: 2, shield: 0, leak: 3, cost: 9, from: 6, scale: 1 },
  // Mite: a tiny spider machine from a Broodcarrier. It runs across the deck to a tower, climbs it and jams it. Any hit destroys it; it never goes for the core.
  mite: { name: 'Mite', hp: 1, speed: 7, bounty: 0, xp: 0, r: 0.35, y: 0.25, armor: 0, shield: 0, leak: 0, cost: 0, from: 9999, scale: 1 },
  // Titan: the giant Colossus of the finale, towering over every tower. Only tower specials hurt it at full strength (see TUNE.titanTower).
  // Its health comes from Sim.titanHp() (hp here is not used) and its pace from the length of its road (see TITAN_* below).
  titan: {
    name: 'Titan', hp: 1, speed: 1.4, bounty: 0, xp: 0, r: 3.2, y: 9, armor: 0, shield: 0, leak: 0, cost: 0, from: 9999, scale: 1,
  },
};

/**
 * The Gyre's rim. Enemy.spin runs from 0 (stopped) to 1 (full speed). While it spins, only 1 - WHEEL_GUARD * spin of a hit gets
 * through, and the Gyre rolls at WHEEL_CRAWL of its speed with the rim stopped, rising to all of it at full spin.
 * WHEEL_BLEED: spin a hit takes off, per share of the Gyre's full health the hit would have dealt without the guard.
 * WHEEL_DRAG: spin lost per second while slowed. WHEEL_SINK: per second while a Graviton Well or a Singularity holds it. A freeze stops it dead.
 * WHEEL_REST: seconds without a hit before it spins back up, at WHEEL_SPINUP per second (slow: focused fire and freezes keep the rim down).
 * WHEEL_PIERCE: share of the guard that Rail shots ignore.
 */
export const WHEEL_GUARD = 0.8;
export const WHEEL_CRAWL = 0.45;
export const WHEEL_BLEED = 2;
export const WHEEL_DRAG = 0.4;
export const WHEEL_SINK = 1.2;
export const WHEEL_REST = 2;
export const WHEEL_SPINUP = 0.15;
export const WHEEL_PIERCE = 0.5;
/** The Gyre is a mini-boss: one rolls in on wave GYRE_FIRST and every GYRE_EVERY waves after it, two from wave GYRE_PAIR on. The rest of that wave is GYRE_WAVE of its usual size. */
export const GYRE_FIRST = 8;
export const GYRE_EVERY = 5;
export const GYRE_PAIR = 18;
export const GYRE_WAVE = 0.8;
export const gyreCount = (w: number) => (w >= GYRE_FIRST && (w - GYRE_FIRST) % GYRE_EVERY === 0 ? (w >= GYRE_PAIR ? 2 : 1) : 0);

/**
 * Broodcarrier and mites. BROOD_EVERY: seconds between swarms (the next one only leaves once the last is gone), BROOD_FIRST: seconds after
 * it appears before the first. BROOD_SIZE: mites per swarm. BROOD_REACH: how far from the carrier a tower can be to be picked.
 * MITE_HOLD: seconds a mite stays on its tower before it burns out, MITE_LIFE: the longest a mite lives in all.
 * JAM_LINGER: seconds a tower stays jammed after the last mite on it is gone.
 */
/** The most Broodcarriers one wave brings: one at first, one more every BROOD_MORE waves. */
export const BROOD_MORE = 7;
export const broodCap = (w: number) => 1 + Math.floor(Math.max(0, w - ENEMIES.brood.from) / BROOD_MORE);
export const BROOD_EVERY = 7;
export const BROOD_FIRST = 2.5;
export const BROOD_SIZE = 4;
export const BROOD_REACH = 8.5;
export const MITE_HOLD = 4.6;
export const MITE_LIFE = 9;
export const JAM_LINGER = 0.4;

/**
 * The Titan. TITAN_LAND: seconds from the leap to the impact. TITAN_STUN: seconds every tower is stunned by the impact.
 * TITAN_WINDUP: seconds at the core before its first blow, TITAN_STRIKE_EVERY: seconds between blows, TITAN_STRIKE: share of the core's maximum per blow.
 * TITAN_SLOW: strength of slowing effects on it. TITAN_WALK: seconds it aims to take for its road (its pace is kept between TITAN_PACE[0] and [1]).
 * TITAN_LEAD: waves of warning before the earliest arrival. TITAN_GOLD: credits for destroying it (it also grants a level).
 * TITAN_SURVIVAL: its first wave in Survival, TITAN_AGAIN: waves until the next one, TITAN_TOUGHER: health factor for each one after the first.
 * TITAN_SMASH: seconds between the buildings it wrecks while it roams the district (lowest, highest).
 */
export const TITAN_LAND = 2.5;
export const TITAN_STUN = 7;
export const TITAN_WINDUP = 4;
export const TITAN_STRIKE_EVERY = 5;
export const TITAN_STRIKE = 0.4;
export const TITAN_SLOW = 0.4;
export const TITAN_WALK = 70;
export const TITAN_PACE = [0.9, 1.7];
export const TITAN_LEAD = 5;
export const TITAN_GOLD = 350;
export const TITAN_SURVIVAL = 22;
export const TITAN_AGAIN = 12;
export const TITAN_TOUGHER = 1.5;
export const TITAN_SMASH = [20, 40];

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
/** Seconds before the first wave arrives on its own (it can be called earlier: there is a factory to set up first), and between later waves. */
export const FIRST_WAVE_IN = 75;
export const NEXT_WAVE_IN = 12;
/** Firewall Pylons: link reach in tiles, half the thickness of a wall, the radius a lone pylon burns, and the colour of a singularity. */
export const LINK_RANGE = 4;
export const WALL_HALF = 0.75;
export const FIRE_RING = 2.2;
export const SING_COLOR = 0xa99cff;
/** Co-op: enemy health and wave budget multipliers at full strength (see TUNE.coopHp / coopCount and coopScale()). */
export const COOP_HP = 2.5;
export const COOP_COUNT = 1.2;

export const TUNE = {
  /** enemy health per wave: 1 + hp1·(w-1) + hp2·(w-1)² + hp3·(w-1)³ (the square term carries the middle of a run, the cube term the waves past 20).
   *  The balance pass moved a little health from the late waves to the early ones (hp1 0.2 to 0.22, hp3 0.0033 to 0.00325): about 3% more on wave 5, 1.5% on wave 10, the same from wave 20 on. */
  hp1: 0.22, hp2: 0.055, hp3: 0.00325,
  /** wave budget: bud0 + bud1·w + w^budP */
  bud0: 8, bud1: 5, budP: 1.5,
  /** credits per kill, wave-clear bonus (base + perWave·w) */
  bounty: 0.92, clear0: 13.8, clear1: 2.76,
  /** tower damage and xp from kills (the knobs of the balance pass), and how often rare and epic cards are offered next to common ones (weight 10) */
  tdmg: 0.92, xp: 0.92, rare: 4.25, epic: 1.7,
  /** Titan: health at the wave it arrives on, per unit of waveHpMul (see titanHp() in sim.ts), share of ordinary tower damage that gets through its hull, and how much harder tower specials hit it.
   *  The boss pass raised titan from 800 to 1050 (the finale has to out-tough a wave-20 Colossus pair). */
  titan: 1050, titanTower: 0.35, titanSpec: 1,
  /** enemy health scales with (mean road length / mapLen)^mapPow · (road in reach of the best tiles / mapCov)^mapCovPow, see mapEase() in sim.ts.
   *  starter: extra factor for the first map (Switchback), which new players learn on and which plays harder than its shape suggests */
  mapLen: 105, mapPow: 0.2, mapCov: 39.8, mapCovPow: 0.64, starter: 0.78,
  /** Colossus health multiplier */
  boss: 1,
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


export interface Mods {
  tDmg: number; tRate: number; tRange: number;
  arcChain: number; shatter: number; napalm: number; twin: number; railCap: number;
  gold: number; xp: number; interest: number; beacon: number; cheap: number;
  /** per-tower-type multipliers */
  tw: Record<TowerType, { dmg: number; rate: number; range: number }>;
  pulseCrit: number; cryoSlow: number; cryoAoe: number; arcSlow: number; mortarAoe: number; railBreak: number;
  /** factory: mine speed, belt speed, crafting speed (smelters, presses, plants, refineries), generator output, extra shots per ammunition item */
  mine: number; belt: number; craft: number; gen: number; ammo: number;
  /** tower specials: charge speed, reboot time multiplier, strength */
  specCharge: number; reboot: number; specPow: number;
  /** Firewall Pylons: burn stacks (Sticky Fire), Slag Curtain stacks, extra link reach in tiles */
  flameBurn: number; flameMelt: number; flameLink: number; lanceHeat: number; lanceRamp: number; missilePods: number; missileAoe: number; gravPull: number; gravVuln: number;
}
export const baseMods = (): Mods => ({
  tDmg: 1, tRate: 1, tRange: 1, arcChain: 0, shatter: 0, napalm: 0, twin: 0, railCap: 0,
  gold: 1, xp: 1, interest: 0, beacon: 0, cheap: 1,
  tw: Object.fromEntries(TOWER_TYPES.map((t) => [t, { dmg: 1, rate: 1, range: 1 }])) as Mods['tw'],
  pulseCrit: 0, cryoSlow: 0, cryoAoe: 0, arcSlow: 0, mortarAoe: 0, railBreak: 0,
  mine: 1, belt: 1, craft: 1, gen: 1, ammo: 1,
  specCharge: 1, reboot: 1, specPow: 1,
  flameBurn: 0, flameMelt: 0, flameLink: 0, lanceHeat: 0, lanceRamp: 0, missilePods: 0, missileAoe: 0, gravPull: 0, gravVuln: 0,
});

export interface CardCtx {
  mods: Mods;
  unlocked: Set<TowerType>;
  /** factory buildings the player may build */
  facs: Set<FacType>;
  addGold(n: number): void;
  addLives(n: number): void;
  addMats(n: number): void;
}

export type CardKind = 'blueprint' | 'tower' | 'factory' | 'eco';
/**
 * A level-up card. Preconditions (all optional, see Sim.cardOk): `requires`: card ids that must have been taken before it is
 * offered; `excludes`: card ids that, once taken, keep it out; `minLevel` / `maxLevel`: the player levels it may be offered
 * on; `minWave`: not before this wave; `guaranteeBy`: from this level on it is put into every offer while it can be offered
 * and has not been taken (a forced card the player passes over backs off for a few levels, see Sim.pushable); `guaranteeAfter`:
 * forced from this many levels after the last card it requires was taken, once a tower of its type (`needs`) on the field is
 * Mk2 or Mk3 (the ammo cards: offered within a few levels of their plant). `needs`: a tower type that must be unlocked. `unlocks`: the factory buildings it opens (the
 * production cards; a card whose buildings are all open already is not offered). `ammo`: the tower type whose second
 * ammunition it opens (see AMMO2_CARD).
 */
export interface Card {
  id: string;
  name: string;
  desc: string;
  rar: 0 | 1 | 2; // common, rare, epic
  kind: CardKind;
  max: number;
  icon: string;
  needs?: TowerType;
  requires?: string[];
  excludes?: string[];
  minLevel?: number;
  maxLevel?: number;
  minWave?: number;
  guaranteeBy?: number;
  guaranteeAfter?: number;
  unlocks?: FacType[];
  ammo?: TowerType;
  apply(c: CardCtx): void;
}

const bp = (t: TowerType, icon: string): Card => ({
  id: 'bp_' + t, name: 'Blueprint: ' + TOWERS[t].name, desc: TOWERS[t].desc + ' Supply: ' + TOWER_SUPPLY[t],
  rar: 1, kind: 'blueprint', max: 1, icon, apply: (c) => { c.unlocked.add(t); },
});
/** A production card: it opens factory buildings (once). */
const prod = (id: string, name: string, desc: string, icon: string, unlocks: FacType[], o: Partial<Card> = {}): Card => ({
  id, name, desc, rar: 0, kind: 'factory', max: 1, icon, unlocks, apply: (c) => { for (const f of unlocks) c.facs.add(f); }, ...o,
});
/**
 * The production cards, in the order a run tends to take them. Each opens its buildings; `requires` chains them so a card
 * only comes once what it builds on is there (a Shell Press needs plates and power). Belts are guaranteed from the first
 * level-up (until then the opening is Transfer Arm chains); Tunnels come once belts can use them (level 4) and are forced
 * into the offers from level 7, so a player whose supply lines are cut off by roads is not stuck behind them for long
 * (level 7 is around wave 6 to 8 on normal: after the first Colossus and before the Broodcarriers spread the towers out).
 */
export const PROD_CARDS: Card[] = [
  prod('belts', 'Conveyor Belts', 'Unlocks the Conveyor Belt: Transfer Arms put items on a belt and take them off further on, so a mine can feed towers far away.', '═', ['belt'], { guaranteeBy: 2 }),
  prod('power', 'Power Grid', 'Unlocks the Generator and the Power Pole. A Generator burns coal (brought by an arm) and powers everything within 2 tiles.', '⚡', ['generator', 'pole']),
  prod('smelter', 'Smelting', 'Unlocks the Smelter: iron ore and copper ore into plates, one coal for every four. No power needed.', '♒', ['smelter'], { minLevel: 3 }),
  prod('works', 'Frame Works', 'Unlocks the Frame Works: two iron plates into one building material, for the heavier towers and their upgrades.', '▦', ['works'], { requires: ['smelter', 'power'] }),
  prod('press', 'Shell Press', 'Unlocks the Shell Press: an iron plate and a coal into a plasma shell, the Plasma Mortar\'s ammunition (and, with Plasma Rounds, the Pulse Turret Mk3\'s).', '◉', ['press'], { requires: ['smelter', 'power'] }),
  prod('oil', 'Oil Field', 'Unlocks the Pumpjack and the Pipe: crude oil out of an oil field (with power), by pipe to what stands beside it.', '⛽', ['pump', 'pipe'], { requires: ['power'] }),
  prod('cells', 'Cell Plant', 'Unlocks the Cell Plant: a copper plate charged with crude oil into an energy cell, for the Lance Emitter and the Graviton Well.', '▣', ['cells'], { requires: ['smelter', 'oil'] }),
  prod('refinery', 'Refinery', 'Unlocks the Refinery: crude oil cracked into petrol, for the Missile Works (and, with Petrol Burners, the Firewall Mk3).', '⚗', ['refinery'], { requires: ['oil'] }),
  prod('missiles', 'Missile Works', 'Unlocks the Missile Works: an iron plate, a copper plate and petrol into a missile pack.', '➹', ['missiles'], { requires: ['refinery', 'smelter'] }),
  prod('splitter', 'Belt Splitter', 'Unlocks the Belt Splitter: it deals what belts bring into it out in turn to the belts leading away.', '⑂', ['splitter'], { requires: ['belts'], minLevel: 4 }),
  prod('tunnels', 'Tunnels', 'Unlocks Belt Tunnels and Pipe Tunnels: they carry items and fluids up to 4 tiles under roads, towers and buildings.', '⇵', ['tunnel', 'ptunnel'], { rar: 1, requires: ['belts'], minLevel: 4, guaranteeBy: 7 }),
];
/** Which production card opens each factory building (the Mine and the Transfer Arm are open from the start). */
export const FAC_CARD: Partial<Record<FacType, string>> = Object.fromEntries(PROD_CARDS.flatMap((c) => (c.unlocks || []).map((f) => [f, c.id])));

export const CARDS: Card[] = [
  bp('cryo', '❄'), bp('arc', '↯'), bp('mortar', '◉'), bp('rail', '⟫'), bp('beacon', '✶'), bp('flame', '♨'), bp('lance', '╪'), bp('missile', '➹'), bp('gravity', '◍'),
  ...PROD_CARDS,
  // ammo upgrades: a Mk3 tower may be switched to a better ammunition (per tower, in its panel) once its plant is open
  { id: 'pulse_shells', name: 'Plasma Rounds', desc: 'Pulse Turrets Mk3 can be switched to plasma shells from a Shell Press: 30% more damage, 20 shots a shell. Switch each turret in its panel when its shell line is ready.', rar: 1, kind: 'tower', max: 1, icon: '◉', needs: 'pulse', ammo: 'pulse', requires: ['press'], guaranteeAfter: 2, apply: () => {} },
  { id: 'flame_petrol', name: 'Petrol Burners', desc: 'Firewall Pylons Mk3 can be switched to petrol from a Refinery: they burn 35% hotter. Switch each pylon in its panel when its petrol pipe is ready.', rar: 1, kind: 'tower', max: 1, icon: '♨', needs: 'flame', ammo: 'flame', requires: ['refinery'], guaranteeAfter: 2, apply: () => {} },
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
  { id: 'r_break', name: 'Armour Breaker', desc: 'Rail shots ignore armour and hit Brutes and Colossi 30% harder.', rar: 1, kind: 'tower', max: 2, icon: '⛏', needs: 'rail', apply: (c) => { c.mods.railBreak += 1; } },
  { id: 'r_scope', name: 'Horizon Scope', desc: 'Railguns gain 25% range.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'rail', apply: (c) => { c.mods.tw.rail.range *= 1.25; } },
  { id: 'b_wide', name: 'Wide Band', desc: 'Beacons reach 30% further.', rar: 0, kind: 'tower', max: 2, icon: '◎', needs: 'beacon', apply: (c) => { c.mods.tw.beacon.range *= 1.3; } },
  { id: 'b_surge', name: 'Carrier Wave', desc: 'Beacons boost 10% harder and reach 15% further.', rar: 1, kind: 'tower', max: 2, icon: '⚡', needs: 'beacon', apply: (c) => { c.mods.beacon += 0.1; c.mods.tw.beacon.range *= 1.15; } },
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
  // factory
  { id: 'f_drill', name: 'Diamond Drills', desc: 'Mines and pumpjacks work 25% faster.', rar: 0, kind: 'factory', max: 4, icon: '⛏', apply: (c) => { c.mods.mine *= 1.25; } },
  { id: 'f_belt', name: 'Express Belts', desc: 'Conveyor belts, splitters and tunnels move items 40% faster.', rar: 0, kind: 'factory', max: 3, icon: '»', requires: ['belts'], apply: (c) => { c.mods.belt *= 1.4; } },
  { id: 'f_craft', name: 'Assembly Line', desc: 'Smelters, presses, plants and refineries work 20% faster.', rar: 0, kind: 'factory', max: 4, icon: '⚙', requires: ['smelter'], apply: (c) => { c.mods.craft *= 1.2; } },
  { id: 'f_gen', name: 'Turbine Upgrade', desc: 'Generators give 30% more power from the same fuel.', rar: 1, kind: 'factory', max: 3, icon: '⚡', requires: ['power'], apply: (c) => { c.mods.gen *= 1.3; } },
  { id: 'f_ammo', name: 'Dense Packing', desc: 'Every ammunition item lasts 30% longer.', rar: 1, kind: 'factory', max: 3, icon: '▤', apply: (c) => { c.mods.ammo *= 1.3; } },
  { id: 'f_stock', name: 'Material Cache', desc: 'Gain 6 building materials right now.', rar: 0, kind: 'factory', max: 99, icon: '▦', apply: (c) => { c.addMats(6); } },
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
