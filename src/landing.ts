// Landing page. The copy lives in index.html; everything that states a number or a name of the game (tower, machine and
// factory cards, the supply-chain diagram, the stats in the hero) is built here from the game's own data, so the page
// cannot drift from what the game does.
import {
  CELL, TOWERS, TOWER_TYPES, TOWER_TIER, TOWER_CHAIN, TOWER_SUPPLY, TOWER_NEEDS_L3, TOWER_SUPPLY_L3, TOWER_CHAIN_L3,
  ITEMS, FLUIDS, ORES, FACS, FAC_TYPES, MAKES, FAC_UPGRADABLE, FAC_LVL_SPEED, ITEM_SHOTS, CRATE_STOCK,
  ENEMIES, CARDS, WHEEL_GUARD, GYRE_FIRST, GYRE_EVERY, GYRE_PAIR, BROOD_SIZE, BROOD_EVERY, MITE_HOLD,
  TITAN_STUN, TITAN_STRIKE, TITAN_LEAD, TUNE, BREACH_SHARE, LINK_RANGE, upgradeCost, upgradeMat, START_FACS, FAC_CARD, CARD_BY_ID, AMMO2_CARD,
} from './game/data.ts';
import type { TowerType, EnemyType, FacType, ItemType, FluidType, OreType, TowerNeeds } from './game/data.ts';
import {
  MINE_TIME, PUMP_RATE, SMELT_TIME, COAL_SMELTS, REFINE_IN, REFINE_OUT, REFINE_TIME, GEN_POWER, COAL_SECONDS,
  POLE_REACH, SUPPLY, TUNNEL_REACH, ARM_TIME,
} from './game/factory.ts';
import { DIFFS } from './game/map.ts';
import { icon } from './icons.ts';

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const MEDIA = './media/';

// ---------- small DOM helpers ----------
type Kid = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]): SVGElement {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const num = (n: number) => String(Math.round(n * 100) / 100);
const list = (a: string[], and = 'and') => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' ' + and + ' ' + a[a.length - 1]);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** A still at two sizes: the small one (media/sm, 320 px for the square renders) and the full one. */
function still(name: string, full: number, alt: string, sizes: string): HTMLImageElement {
  const img = h('img');
  img.width = full; img.height = full; img.loading = 'lazy'; img.decoding = 'async'; img.alt = alt;
  img.sizes = sizes;
  img.srcset = `${MEDIA}sm/${name}.jpg 320w, ${MEDIA}${name}.jpg ${full}w`;
  img.src = `${MEDIA}${name}.jpg`;
  return img;
}

// ---------- what things are made of, in the page's ink ----------
type Res = ItemType | FluidType | 'power' | 'mats';
// (coal and crude oil are near black in the game: on the page's soot they get a lighter ink)
const INK: Partial<Record<Res, string>> = { coal: '#a39a8d', crude: '#a488dd', power: '#6fe0c8', mats: '#e3dc92', iron_ore: '#9fb0c8' };
const inkOf = (r: Res) => INK[r] || (r in ITEMS ? hex(ITEMS[r as ItemType].color) : r in FLUIDS ? hex(FLUIDS[r as FluidType].color) : '#e3dc92');
const resName = (r: Res) => (r === 'power' ? 'Power' : r === 'mats' ? 'Building materials' : r in ITEMS ? ITEMS[r as ItemType].name : FLUIDS[r as FluidType].name);
const plural = (r: ItemType, n: number) => (n === 1 || r === 'coal' || r.endsWith('_ore') ? ITEMS[r].short : ITEMS[r].short + 's');
function chip(r: Res, text?: string): HTMLLIElement {
  // (the game's own icon of the resource: the same one its HUD shows)
  const li = h('li', 'chip', icon(r, { size: 16 }), text || resName(r));
  li.style.setProperty('--k', inkOf(r));
  return li;
}
const needChips = (n: TowerNeeds): HTMLLIElement[] => [
  n.item ? chip(n.item) : null, n.fluid ? chip(n.fluid) : null, n.power ? chip('power', n.power + ' power') : null,
].filter((c): c is HTMLLIElement => !!c);
const price = (cr: number, mat: number) => cr + ' cr' + (mat ? ' + ' + mat + ' mat' : '');

// ---------- hover previews: a short clip of the tower or machine in action, loaded only when asked for ----------
function preview(card: HTMLElement, img: HTMLImageElement, name: string, label: string) {
  const btn = h('button', 'pv-btn');
  btn.type = 'button';
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', 'Play a clip of the ' + label);
  btn.append(h('span', 'pv-ico'));
  img.after(btn);
  let video: HTMLVideoElement | null = null, dead = false, wanted = false;
  const start = () => {
    if (dead) return;
    wanted = true;
    btn.setAttribute('aria-pressed', 'true');
    if (!video) {
      const v = document.createElement('video');
      v.className = 'pv';
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
      v.addEventListener('playing', () => { if (wanted) card.classList.add('playing'); });
      v.addEventListener('error', () => { dead = true; wanted = false; card.classList.remove('playing'); btn.setAttribute('aria-pressed', 'false'); btn.hidden = true; v.remove(); video = null; });
      v.src = MEDIA + 'prev/' + name + '.mp4';
      img.after(v);
      video = v;
    }
    void video.play().catch(() => { /* not allowed or not loaded yet */ });
  };
  const stop = () => {
    wanted = false;
    btn.setAttribute('aria-pressed', 'false');
    card.classList.remove('playing');
    if (video) { video.pause(); try { video.currentTime = 0; } catch { /* not seekable yet */ } }
  };
  // mouse: play while the pointer is over the card. Touch, keyboard and reduced motion: the button (or a tap on the card) toggles it.
  card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !reduced.matches) start(); });
  card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') stop(); });
  card.addEventListener('click', () => { if (wanted) stop(); else start(); });
}

// ---------- towers ----------
const TOWER_COPY: Record<TowerType, { text: string; alt: string }> = {
  pulse: { text: 'Rapid homing bolts. Cheap, reliable, and the backbone of every opening: one Mine keeps one turret firing.', alt: 'A Pulse Turret on its tile beside the road.' },
  cryo: { text: 'Chills a whole group and slows it, holding the column in everyone else\'s range.', alt: 'A Cryo Emitter on its tile beside the road.' },
  arc: { text: 'Lightning that jumps from machine to machine. The tighter the pack, the better it pays.', alt: 'An Arc Pylon on its tile beside the road.' },
  mortar: { text: 'Long-range area blasts over the rooftops. Cannot hit flyers or anything at its feet.', alt: 'A Plasma Mortar on its tile beside the road.' },
  rail: { text: 'A slow, piercing beam with the longest reach on the grid. It picks the toughest target.', alt: 'A Railgun on its tile beside the road.' },
  beacon: { text: 'Fires nothing. Boosts the damage and speed of every tower standing near it.', alt: 'A Signal Beacon between the two Pulse Turrets it boosts.' },
  flame: { text: `Build two within ${LINK_RANGE} tiles of each other and a wall of fire burns between them, setting alight whatever crosses it.`, alt: 'A Firewall Pylon with its wall of fire across the road.' },
  lance: { text: 'A continuous beam that burns hotter the longer it holds one target. Made for Brutes and Colossi.', alt: 'A Lance Emitter on its tile beside the road.' },
  missile: { text: 'Salvos of homing missiles, one salvo per pack. It picks flyers first.', alt: 'A Missile Battery on its tile beside the road.' },
  gravity: { text: 'Deals no damage. Drags machines back along the road and slows them inside its field.', alt: 'A Graviton Well on its tile beside the road.' },
};
const tierLabel = (t: TowerType) => (TOWER_TIER[t] === 0 ? 'From the start' : 'Tier ' + TOWER_TIER[t] + ' blueprint');
/** How long one ammunition item lasts a tower, in its own words ("9 shots an ore"). */
function perItem(t: TowerType, n: TowerNeeds): string {
  if (!n.item) return '';
  const shots = n.shots || ITEM_SHOTS[n.item] || 1;
  const what = t === 'lance' ? 'beam ticks' : t === 'gravity' ? 'pulses' : t === 'missile' ? (shots === 1 ? 'salvo' : 'salvos') : 'shots';
  return `${shots} ${what} per ${ITEMS[n.item].short}`;
}

function buildRoster(host: HTMLElement) {
  host.textContent = '';
  for (const t of TOWER_TYPES) {
    const d = TOWERS[t], copy = TOWER_COPY[t];
    const img = still('tower_' + t, 640, copy.alt, '(max-width: 640px) 92vw, (max-width: 1080px) 46vw, 380px');
    const frame = h('div', 'unit-img', img);
    const txt = h('div', 'unit-txt');
    txt.append(
      h('p', 'unit-tag', h('span', '', tierLabel(t)), h('span', '', price(d.cost, d.mat))),
      h('h3', '', d.name),
      h('p', 'unit-desc', copy.text),
    );
    const needs = h('ul', 'chips', ...needChips(d.needs));
    needs.setAttribute('aria-label', 'What it needs from the factory');
    const facts = [perItem(t, d.needs), `range ${num(d.range / CELL)} tiles`, `Mk2 ${price(upgradeCost(t, 1), upgradeMat(t, 1))}`, `Mk3 ${price(upgradeCost(t, 2), upgradeMat(t, 2))}`].filter(Boolean);
    txt.append(h('div', 'unit-row', h('span', 'unit-k', 'Needs'), needs), h('p', 'unit-facts', cap(facts.join(' / '))));
    const l3 = TOWER_NEEDS_L3[t];
    if (l3) {
      const c3 = h('ul', 'chips', ...needChips(l3));
      c3.setAttribute('aria-label', 'Its second ammunition, a switch on each Mk3 once its card is taken');
      const gain = l3.dmg ? `hits ${Math.round((l3.dmg - 1) * 100)}% harder` : '';
      const card = AMMO2_CARD[t] ? CARD_BY_ID[AMMO2_CARD[t]!]?.name : '';
      const more = [gain, perItem(t, l3), card ? `with the ${card} card` : ''].filter(Boolean).join(', ');
      txt.append(h('div', 'unit-row unit-mk3', h('span', 'unit-k', 'Mk3 option'), c3, more ? h('span', 'unit-more', more) : null));
    }
    if (d.special) txt.append(h('p', 'unit-spec', h('b', '', d.special.name), ' ' + d.special.desc + ' ', h('span', '', `Charges in ${d.special.charge} s`)));
    const li = h('li', 'unit', frame, txt);
    li.style.setProperty('--c', hex(d.color));
    preview(li, img, 'tower_' + t, d.name);
    host.append(li);
  }
}

// ---------- the Static ----------
const speedOf = (t: EnemyType) => `${num(ENEMIES[t].speed / CELL)} tiles/s`;
const core = (n: number) => `costs ${n} core`;
const base = (t: EnemyType) => {
  const e = ENEMIES[t];
  return [`Hull ${e.hp}`, e.shield ? `shield ${e.shield}` : '', e.armor ? `armour ${e.armor}` : '', speedOf(t), core(e.leak)].filter(Boolean).join(' / ');
};
interface Foe { t: EnemyType; tag: string; text: string; alt: string; nums: string; boss?: boolean }
const FOES: Foe[] = [
  { t: 'grunt', tag: `From wave ${ENEMIES.grunt.from}`, text: 'The line infantry of the swarm. Weak alone, never alone.', alt: 'Three Grunts walking down the road.', nums: base('grunt') },
  { t: 'runner', tag: `From wave ${ENEMIES.runner.from}`, text: 'Fragile and very fast. Slips past slow guns in packs.', alt: 'A pack of Runners on the road.', nums: base('runner') },
  { t: 'drone', tag: `From wave ${ENEMIES.drone.from} / Flying`, text: 'Flies over the road, out of reach of mortars. Missile Batteries pick it first.', alt: 'A wing of Drones over the road.', nums: base('drone') },
  { t: 'shield', tag: `From wave ${ENEMIES.shield.from} / Shielded`, text: 'Carries an energy shield you must break before the hull.', alt: 'An Aegis walking inside its shield bubble.', nums: base('shield') },
  { t: 'brood', tag: `From wave ${ENEMIES.brood.from} / Jams towers`, text: `Looses swarms of ${BROOD_SIZE} mites that climb the nearest tower and jam it for up to ${num(MITE_HOLD)} seconds. Any hit knocks a mite off: let your towers cover each other, or kill the carrier first.`, alt: 'A Broodcarrier coming up to a Railgun.', nums: `${base('brood')} / a swarm every ${BROOD_EVERY} s` },
  { t: 'brute', tag: `From wave ${ENEMIES.brute.from} / Armoured`, text: 'Slow and plated. Railguns with Armour Breaker and a hot Lance cut through it.', alt: 'A Brute walking down the road.', nums: base('brute') },
  { t: 'wheel', tag: 'Mini-boss / Spin guard', text: `A machine riding inside one armoured wheel. At full spin only ${Math.round((1 - WHEEL_GUARD) * 100)}% of a hit gets through; slow it, freeze it or focus your fire and the guard drops.`, alt: 'A Gyre rolling past a turret, its rim glowing.', nums: `Wave ${GYRE_FIRST}, then every ${GYRE_EVERY} waves, two from wave ${GYRE_PAIR} / ${base('wheel')}` },
  { t: 'boss', tag: `Every ${ENEMIES.boss.from}th wave / Boss`, text: `A walking siege engine. Let one reach the Heart and it takes up to ${Math.round(BREACH_SHARE * 100)}% of the core you started with. Save your specials for it.`, alt: 'A Colossus on the road.', nums: base('boss'), boss: true },
  { t: 'titan', tag: 'Once, near the end / Finale', text: `Towers over the whole district. Warned ${TITAN_LEAD} waves ahead, it leaps from the city onto the gate, wrecks what stands on its road and stuns every tower for ${TITAN_STUN} seconds. Its hull turns most tower fire; tower specials hit it at full strength.`, alt: 'The Titan walking the road, the city skyline behind it.', nums: `${Math.round(TUNE.titanTower * 100)}% of tower fire gets through / each blow takes ${Math.round(TITAN_STRIKE * 100)}% of the core`, boss: true },
];
function buildFoes(host: HTMLElement) {
  host.textContent = '';
  for (const f of FOES) {
    const img = still('enemy_' + f.t, 480, f.alt, '(max-width: 640px) 104px, 132px');
    const li = h('li', 'foe' + (f.boss ? ' foe-boss' : ''), img,
      h('div', '', h('h3', '', ENEMIES[f.t].name), h('p', 'foe-tag', f.tag), h('p', '', f.text), h('p', 'foe-num', f.nums)));
    preview(li, img, 'enemy_' + f.t, ENEMIES[f.t].name);
    host.append(li);
  }
}

// ---------- the factory ----------
const DEPOSITS: { ore: OreType; img: string; gives: string; on: string }[] = [
  { ore: 'iron_ore', img: 'dep_iron', gives: 'Iron ore: Pulse Turret ammunition as it is, iron plates once smelted.', on: FACS.mine.name },
  { ore: 'copper_ore', img: 'dep_copper', gives: 'Copper ore: smelted into the plates Railguns fire and cells are made of.', on: FACS.mine.name },
  { ore: 'coal', img: 'dep_coal', gives: 'Coal: fuel for Generators and Smelters, and half of every plasma shell.', on: FACS.mine.name },
  { ore: 'oil', img: 'dep_oil', gives: 'Crude oil: burnt by Firewall Pylons, charged into cells, cracked into petrol.', on: FACS.pump.name },
];
function buildDeposits(host: HTMLElement) {
  host.textContent = '';
  for (const d of DEPOSITS) {
    const li = h('li', 'fac dep', still(d.img, 640, `A patch of ${ORES[d.ore].name.toLowerCase()} tiles on the deck.`, '(max-width: 640px) 104px, 280px'),
      h('div', '', h('p', 'fac-tag', h('span', '', 'Build a ' + d.on + ' on it')), h('h4', '', ORES[d.ore].name), h('p', 'fac-text', d.gives)));
    li.style.setProperty('--c', inkOf(d.ore === 'oil' ? 'crude' : d.ore));
    host.append(li);
  }
}

/** How a building is unlocked: from the start, or the production card that opens it, with the cards and the level that card waits for. */
function unlock(f: FacType): string {
  if (f === 'crate') return 'On the deck when the run starts';
  if (START_FACS.includes(f)) return 'From the start';
  const id = FAC_CARD[f], c = id ? CARD_BY_ID[id] : undefined;
  if (!c) return 'From the start';
  const pre = (c.requires || []).map((r) => CARD_BY_ID[r]?.name).filter(Boolean);
  const when = [pre.length ? 'after ' + list(pre) : '', c.guaranteeBy !== undefined && c.guaranteeBy <= 2 ? 'always among the first offers' : c.minLevel ? `from level ${c.minLevel}` + (c.guaranteeBy ? `, sure by level ${c.guaranteeBy}` : '') : ''].filter(Boolean);
  return `The ${c.name} card` + (when.length ? ` (${when.join(', ')})` : '');
}
function recipe(f: FacType): { makes: string; needs: string } {
  const r = MAKES[f];
  if (r) {
    const inp = (Object.entries(r.inp) as [ItemType, number][]).map(([it, n]) => `${n} ${plural(it, n)}`);
    if (r.fluid) inp.push(`${r.fluid[1]} ${FLUIDS[r.fluid[0]].name.toLowerCase()} by pipe`);
    return { makes: `${r.mats ? r.mats + ' building material' : '1 ' + ITEMS[r.out!].short} every ${r.time} s`, needs: cap(list(inp)) };
  }
  switch (f) {
    case 'mine': return { makes: `1 ore or coal every ${MINE_TIME} s, about what one Pulse Turret burns`, needs: 'An iron, copper or coal deposit under it' };
    case 'arm': return { makes: `Takes one item at a time from the hex behind it and puts it into the hex in front: ${Math.round(60 / ARM_TIME)} a minute at Mk1. It picks up only what its target will take, and can be told to take one kind only`, needs: 'Something to take from behind it and something that takes it in front. R turns it' };
    case 'pump': return { makes: `${PUMP_RATE} crude oil a second, into pipes or the building beside it`, needs: 'An oil field under it' };
    case 'generator': return { makes: `${GEN_POWER} power for everything within ${SUPPLY} tiles`, needs: `1 coal every ${COAL_SECONDS} s at full load` };
    case 'pole': return { makes: `Carries power ${POLE_REACH} tiles to the next pole, across roads too, and powers everything within ${SUPPLY} tiles`, needs: 'A Generator on its line' };
    case 'smelter': return { makes: `1 iron or copper plate every ${SMELT_TIME} s`, needs: `Ore, and 1 coal for every ${COAL_SMELTS} plates` };
    case 'refinery': return { makes: `${REFINE_OUT} petrol every ${REFINE_TIME} s, out by pipe`, needs: `${REFINE_IN} crude oil by pipe` };
    case 'belt': return { makes: 'Carries items the way its arrow points, and nothing else: it feeds nothing it runs past or ends at. Belts merge where one points into another', needs: 'A Transfer Arm to put items on it and one to take them off. Drag to lay a line' };
    case 'splitter': return { makes: 'Deals what comes in out in turn to every belt leading away', needs: 'Belts in and out' };
    case 'tunnel': return { makes: `Items go in at one and come out of the other, up to ${TUNNEL_REACH} tiles on, under roads, towers and buildings`, needs: 'Two, facing the same way' };
    case 'pipe': return { makes: 'Carries crude oil or petrol to whatever stands beside it. Pipes join up by themselves', needs: 'A Pumpjack or Refinery on the line' };
    case 'ptunnel': return { makes: `Joins two pipe runs up to ${TUNNEL_REACH} tiles apart under whatever stands between`, needs: 'Two, in a straight line' };
    default: {
      const stock = (Object.entries(CRATE_STOCK) as [ItemType, number][]).map(([it, n]) => `${n} ${plural(it, n)}`);
      return { makes: `Feeds the towers built right next to it until it is empty, and a Transfer Arm can take from it: ${list(stock, 'or')}`, needs: 'Nothing. It cannot be built or refilled' };
    }
  }
}
const FAC_ALT: Partial<Record<FacType, string>> = {
  arm: 'A Transfer Arm between a Mine and a Pulse Turret.', mine: 'A Mine on an iron deposit.', pump: 'A Pumpjack on an oil field.', pipe: 'A bent run of pipe.', belt: 'A curved conveyor belt carrying ore.',
  splitter: 'A Belt Splitter with belts in and out, carrying ore.', tunnel: 'A pair of Belt Tunnels under the road.', ptunnel: 'A pair of Pipe Tunnels under the road.',
};
function buildFacs(host: HTMLElement) {
  const types = (host.dataset.facs || '').split(',').filter((t): t is FacType => t in FACS);
  host.textContent = '';
  for (const f of types) {
    const d = FACS[f], r = recipe(f);
    const tags = [d.cost ? d.cost + ' cr' : 'Free', d.power ? d.power + ' power' : 'No power', FAC_UPGRADABLE.has(f) ? 'Mk1-3' : ''].filter(Boolean);
    const dl = h('dl', 'fac-dl',
      h('div', '', h('dt', '', MAKES[f] || ['mine', 'pump', 'generator', 'smelter', 'refinery'].includes(f) ? 'Makes' : 'Does'), h('dd', '', r.makes)),
      h('div', '', h('dt', '', 'Needs'), h('dd', '', r.needs + (d.power ? '. Power' : ''))),
      h('div', '', h('dt', '', 'Unlock'), h('dd', '', unlock(f))),
    );
    const li = h('li', 'fac', still('fac_' + f, 640, FAC_ALT[f] || `A ${d.name} on its tile.`, '(max-width: 640px) 104px, (max-width: 1080px) 46vw, 380px'),
      h('div', '', h('p', 'fac-tag', ...tags.map((t) => h('span', '', t))), h('h4', '', d.name), dl));
    li.style.setProperty('--c', hex(d.color));
    host.append(li);
  }
}

// ---------- the supply chain, tower by tower ----------
// One fixed map of the factory: deposits, what stands on them, what works the ore, the plants, and the tower. Picking a
// tower lights the part of it that tower lives on. The chains themselves are worked out from the game's data.
type NodeId = 'd_iron' | 'd_copper' | 'd_coal' | 'd_oil' | 'm_iron' | 'm_copper' | 'm_coal' | 'pump' | 's_iron' | 's_copper' | 'generator' | 'refinery' | 'works' | 'press' | 'cells' | 'missiles' | 'tower';
interface ChainNode { l: number; s: number; label: string; fac?: FacType; ink?: string }
const NODES: Record<NodeId, ChainNode> = {
  d_iron: { l: 0, s: 0, label: ORES.iron_ore.name, ink: inkOf('iron_ore') },
  d_copper: { l: 0, s: 1, label: ORES.copper_ore.name, ink: inkOf('copper_ore') },
  d_coal: { l: 0, s: 2, label: ORES.coal.name, ink: inkOf('coal') },
  d_oil: { l: 0, s: 3, label: ORES.oil.name, ink: inkOf('crude') },
  m_iron: { l: 1, s: 0, label: FACS.mine.name, fac: 'mine' },
  m_copper: { l: 1, s: 1, label: FACS.mine.name, fac: 'mine' },
  m_coal: { l: 1, s: 2, label: FACS.mine.name, fac: 'mine' },
  pump: { l: 1, s: 3, label: FACS.pump.name, fac: 'pump' },
  s_iron: { l: 2, s: 0, label: FACS.smelter.name, fac: 'smelter' },
  s_copper: { l: 2, s: 1, label: FACS.smelter.name, fac: 'smelter' },
  generator: { l: 2, s: 2, label: FACS.generator.name, fac: 'generator' },
  refinery: { l: 2, s: 3, label: FACS.refinery.name, fac: 'refinery' },
  works: { l: 3, s: 0, label: FACS.works.name, fac: 'works' },
  press: { l: 3, s: 1, label: FACS.press.name, fac: 'press' },
  cells: { l: 3, s: 2, label: FACS.cells.name, fac: 'cells' },
  missiles: { l: 3, s: 3, label: FACS.missiles.name, fac: 'missiles' },
  tower: { l: 4, s: 1.5, label: '' },
};
/** The building a thing comes out of. */
const SRC: Record<Res, NodeId> = {
  iron_ore: 'm_iron', copper_ore: 'm_copper', coal: 'm_coal', iron: 's_iron', copper: 's_copper', shell: 'press', cell: 'cells',
  missile: 'missiles', crude: 'pump', petrol: 'refinery', power: 'generator', mats: 'works',
};
const DEPOSIT_OF: Partial<Record<NodeId, NodeId>> = { m_iron: 'd_iron', m_copper: 'd_copper', m_coal: 'd_coal', pump: 'd_oil' };
/** What a node takes in (a tower: from its needs at that level). */
function inputs(n: NodeId, t: TowerType, mk3: boolean): Res[] {
  if (n === 'tower') {
    const need = (mk3 && TOWER_NEEDS_L3[t]) || TOWERS[t].needs;
    const power = TOWERS[t].needs.power || need.power;
    return [need.item, need.fluid, power ? 'power' : undefined, TOWERS[t].mat ? 'mats' : undefined].filter((r): r is Res => !!r);
  }
  const fac = NODES[n].fac;
  const out: Res[] = [];
  if (n === 's_iron') out.push('iron_ore', 'coal');
  else if (n === 's_copper') out.push('copper_ore', 'coal');
  else if (n === 'generator') out.push('coal');
  else if (n === 'refinery') out.push('crude');
  else if (fac && MAKES[fac]) { const r = MAKES[fac]!; out.push(...(Object.keys(r.inp) as ItemType[])); if (r.fluid) out.push(r.fluid[0]); }
  if (fac && FACS[fac].power) out.push('power');
  return out;
}
interface Edge { from: NodeId; to: NodeId; res: Res | 'deposit' }
interface Chain { nodes: Set<NodeId>; edges: Edge[]; powered: Set<NodeId>; res: Set<Res> }
function chainOf(t: TowerType, mk3: boolean): Chain {
  const c: Chain = { nodes: new Set(), edges: [], powered: new Set(), res: new Set() };
  const visit = (n: NodeId) => {
    if (c.nodes.has(n)) return;
    c.nodes.add(n);
    const dep = DEPOSIT_OF[n];
    if (dep) { c.nodes.add(dep); c.edges.push({ from: dep, to: n, res: 'deposit' }); }
    for (const r of inputs(n, t, mk3)) {
      c.res.add(r);
      if (r === 'power') c.powered.add(n); else c.edges.push({ from: SRC[r], to: n, res: r });
      visit(SRC[r]);
    }
  };
  visit('tower');
  return c;
}
const edgeKey = (e: Edge) => e.from + '>' + e.to;
/** Edges that pass a column of buildings on their way: the gap between two rows they take there (in rows; -1 = above the first, 4 = below the last). */
const VIA: Record<string, number[]> = {
  'm_iron>tower': [-1, -1], 'm_coal>press': [1.5], 'pump>cells': [2.5], 'pump>tower': [4, 4], 's_copper>tower': [1.5], 'refinery>tower': [4],
};

function buildChain(host: HTMLElement) {
  host.textContent = '';
  const narrow = matchMedia('(max-width: 720px)');
  let cur: TowerType = 'mortar', mk3 = false;

  // every edge any tower uses, drawn once
  const all = new Map<string, Edge>();
  for (const t of TOWER_TYPES) for (const lv of [false, true]) for (const e of chainOf(t, lv).edges) all.set(edgeKey(e) + ':' + e.res, e);

  const picker = h('div', 'chain-pick');
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Show the supply chain of a tower');
  const buttons = new Map<TowerType, HTMLButtonElement>();
  for (const t of TOWER_TYPES) {
    const b = h('button', 'chain-btn', TOWERS[t].name);
    b.type = 'button';
    b.style.setProperty('--c', hex(TOWERS[t].color));
    b.addEventListener('click', () => { cur = t; mk3 = false; update(); });
    buttons.set(t, b);
    picker.append(b);
  }
  const figure = h('div', 'chain-fig');
  const panel = h('div', 'chain-panel');
  panel.setAttribute('aria-live', 'polite');
  const legend = h('ul', 'chips chain-legend');
  legend.setAttribute('aria-label', 'What flows in this chain');
  host.append(picker, h('div', 'chain-body', h('div', 'chain-draw', figure, legend), panel));

  let nodeEls = new Map<NodeId, SVGElement>(), edgeEls = new Map<string, SVGElement>(), towerText: SVGElement | null = null, title: SVGElement | null = null;

  function draw() {
    const v = narrow.matches;
    // geometry: layers run left to right on a wide screen, top to bottom on a narrow one
    const G = v ? { W: 400, H: 560, l0: 34, lp: 123, s0: 56, sp: 96, nw: 86, nh: 34, tw: 176, lo: -0.53, hi: 3.53, fs: 13 }
      : { W: 1000, H: 452, l0: 70, lp: 196, s0: 92, sp: 88, nw: 132, nh: 42, tw: 190, lo: -0.8, hi: 3.8, fs: 17 };
    const slot = (x: number) => G.s0 + Math.max(G.lo, Math.min(G.hi, x)) * G.sp;
    const at = (l: number, sl: number): [number, number] => (v ? [slot(sl), G.l0 + l * G.lp] : [G.l0 + l * G.lp, slot(sl)]);
    const half = (n: NodeId) => (v ? G.nh : n === 'tower' ? G.tw : G.nw) / 2;
    const svg = s('svg', { class: 'chain-svg', viewBox: `0 0 ${G.W} ${G.H}`, role: 'img', 'aria-labelledby': 'chain-title' });
    title = s('title', { id: 'chain-title' });
    svg.append(title);
    const wires = s('g', { class: 'wires' }), boxes = s('g', { class: 'boxes' });
    edgeEls = new Map(); nodeEls = new Map();
    for (const [key, e] of all) {
      const a = NODES[e.from], b = NODES[e.to];
      const pts: [number, number][] = [at(a.l, a.s)];
      (VIA[edgeKey(e)] || []).forEach((g, i) => pts.push(at(a.l + 1 + i, g)));
      pts.push(at(b.l, b.s));
      // leave the first box on its far side, enter the last on its near side
      const ax = v ? 1 : 0;
      pts[0][ax] += half(e.from); pts[pts.length - 1][ax] -= half(e.to);
      let dpath = `M${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        dpath += v ? ` C${x0} ${(y0 + y1) / 2} ${x1} ${(y0 + y1) / 2} ${x1} ${y1}` : ` C${(x0 + x1) / 2} ${y0} ${(x0 + x1) / 2} ${y1} ${x1} ${y1}`;
      }
      const ink = e.res === 'deposit' ? NODES[e.from].ink! : inkOf(e.res);
      const g = s('g', { class: 'wire' + (e.res === 'mats' ? ' wire-mats' : ''), color: ink },
        s('path', { class: 'wire-line', d: dpath }),
        s('path', { class: 'wire-flow', d: dpath }));
      edgeEls.set(key, g);
      wires.append(g);
    }
    for (const id of Object.keys(NODES) as NodeId[]) {
      const n = NODES[id], [x, y] = at(n.l, n.s), w = id === 'tower' ? G.tw : G.nw, hgt = id === 'tower' ? G.nh + 8 : G.nh;
      const g = s('g', { class: 'node' + (id === 'tower' ? ' node-tower' : n.l === 0 ? ' node-dep' : ''), transform: `translate(${x - w / 2} ${y - hgt / 2})` });
      g.append(s('rect', { width: w, height: hgt, rx: 2 }));
      if (n.ink) g.append(s('rect', { class: 'node-ink', x: 0, y: 0, width: 5, height: hgt, fill: n.ink }));
      const text = s('text', { x: w / 2 + (n.ink ? 2 : 0), y: hgt / 2, 'font-size': id === 'tower' ? G.fs + 1 : G.fs }, n.label);
      g.append(text);
      if (id === 'tower') towerText = text;
      // the bolt of everything that needs power
      if (id === 'tower' || (n.fac && FACS[n.fac].power)) g.append(s('path', { class: 'bolt', d: 'M6 0 0 9h5l-2 7 8-10H6z', transform: `translate(${w - 15} ${-9}) scale(1.25)` }));
      nodeEls.set(id, g);
      boxes.append(g);
    }
    svg.append(wires, boxes);
    figure.textContent = '';
    figure.append(svg);
  }

  function update() {
    const d = TOWERS[cur], l3 = TOWER_NEEDS_L3[cur];
    if (!l3) mk3 = false;
    const c = chainOf(cur, mk3);
    for (const [t, b] of buttons) b.setAttribute('aria-pressed', String(t === cur));
    const lit = new Set(c.edges.map((e) => edgeKey(e) + ':' + e.res));
    for (const [k, g] of edgeEls) g.classList.toggle('on', lit.has(k));
    for (const [id, g] of nodeEls) {
      g.classList.toggle('on', c.nodes.has(id));
      g.classList.toggle('pw', c.powered.has(id));
    }
    const tn = nodeEls.get('tower');
    if (tn) tn.setAttribute('color', hex(d.color));
    if (towerText) towerText.textContent = d.name + (mk3 ? ' Mk3' : '');
    const supply = (mk3 && TOWER_SUPPLY_L3[cur]) || TOWER_SUPPLY[cur];
    if (title) title.textContent = `Supply chain of the ${d.name}${mk3 ? ' Mk3 on its second ammunition' : ''}. ${supply}`;

    // legend: what runs along the lit lines
    legend.textContent = '';
    const last = (r: Res) => (r === 'power' ? 1 : r === 'mats' ? 2 : 0);
    for (const r of [...c.res].sort((a, b) => last(a) - last(b))) legend.append(chip(r, r === 'power' ? 'Power: the bolt marks what has to stand within ' + SUPPLY + ' tiles of a Generator or Power Pole' : r === 'mats' ? 'Building materials (its price, not its ammunition)' : undefined));

    // the panel beside the diagram
    panel.textContent = '';
    const need = (mk3 && l3) || d.needs;
    const chips = h('ul', 'chips', ...needChips({ ...need, power: d.needs.power || need.power }));
    chips.setAttribute('aria-label', 'What it needs');
    const facs = [...new Set([...TOWER_CHAIN[cur], ...(mk3 ? TOWER_CHAIN_L3[cur] || [] : [])])], chainFacs = facs.map((f) => FACS[f].name);
    // the production cards those buildings come with (the Mine and the Transfer Arm are there from the start), and the ammo card of a second ammunition
    const cards = [...new Set(facs.map((f) => FAC_CARD[f]).filter((id): id is string => !!id))].map((id) => CARD_BY_ID[id].name);
    const ammoCard = mk3 && AMMO2_CARD[cur] ? CARD_BY_ID[AMMO2_CARD[cur]!]?.name : '';
    const thumb = still('tower_' + cur, 640, TOWER_COPY[cur].alt, '120px');
    thumb.loading = 'eager';
    panel.append(
      thumb,
      h('p', 'unit-tag', h('span', '', tierLabel(cur)), h('span', '', price(d.cost, d.mat))),
      h('h4', '', d.name + (mk3 ? ' Mk3' : '')),
      chips,
      h('p', 'chain-text', supply),
      h('p', 'chain-unlock', h('b', '', 'Its supply needs '), list(chainFacs) + '.'),
      h('p', 'chain-unlock', h('b', '', 'Cards '), cards.length ? `${TOWER_TIER[cur] === 0 ? '' : 'Its blueprint unlocks the tower alone. '}The buildings come with ${list(cards)}${ammoCard ? `, and ${ammoCard} opens the switch on each Mk3` : ''}.` : 'None: the Mine and the Transfer Arm are there from the start.'),
      h('p', 'chain-unlock', h('b', '', 'Hand-offs '), 'Every line of items in the picture is carried by Transfer Arms, with belts between them over a distance. Fluids run in pipes; power reaches what stands near.'),
    );
    if (d.mat) panel.append(h('p', 'chain-unlock', h('b', '', 'Price '), `${d.mat} building materials on top of ${d.cost} credits. A Frame Works makes them from iron plates; a run starts with a few in stock.`));
    if (l3) {
      const b = h('button', 'chain-mk3', mk3 ? 'Back to its first ammunition' : 'Show its second ammunition (a Mk3 switch)');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(mk3));
      b.addEventListener('click', () => { mk3 = !mk3; update(); panel.querySelector<HTMLButtonElement>('.chain-mk3')?.focus(); });
      panel.append(b);
    }
    panel.style.setProperty('--c', hex(d.color));
  }
  draw(); update();
  narrow.addEventListener('change', () => { draw(); update(); });
}

// ---------- fill the page ----------
const each = (sel: string, fn: (e: HTMLElement) => void) => document.querySelectorAll<HTMLElement>(sel).forEach((e) => { try { fn(e); } catch (err) { console.error(err); } });
each('[data-roster]', buildRoster);
each('[data-foes]', buildFoes);
each('[data-deposits]', buildDeposits);
each('[data-facs]', buildFacs);
each('[data-chain]', buildChain);
{
  const waves = DIFFS.map((d) => d.waves);
  const FACTS: Record<string, string> = {
    towers: String(TOWER_TYPES.length), facs: String(FAC_TYPES.length), cards: String(CARDS.length),
    waves: Math.min(...waves) + '-' + Math.max(...waves), machines: String(FOES.length),
    diffs: list(DIFFS.map((d, i) => `${d.waves}${i ? '' : ' waves'} on ${d.name}`), 'or'),
    speeds: FAC_LVL_SPEED.slice(1).map((x) => num(x) + ' times').join(' and '),
  };
  each('[data-fact]', (e) => { const v = FACTS[e.dataset.fact || '']; if (v) e.textContent = v; });
}

// ---------- sticky nav gets a solid backdrop once the hero has scrolled a little ----------
const nav = document.getElementById('nav');
const onScroll = () => nav?.classList.toggle('nav-solid', scrollY > 24);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------- "Watch the trailer": scroll to the player and move focus to it ----------
const trailer = document.getElementById('trailer');
const video = document.getElementById('trailer-video');
document.getElementById('watch-trailer')?.addEventListener('click', (e) => {
  if (!trailer) return;
  e.preventDefault();
  trailer.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(null, '', '#trailer');
  if (video instanceof HTMLVideoElement && !video.hidden) video.focus({ preventScroll: true });
});

// ---------- trailer: if the file is missing or unplayable, show an intentional fallback over the poster ----------
if (video instanceof HTMLVideoElement) {
  const frame = document.getElementById('trailer-frame');
  const fallback = document.getElementById('trailer-fallback');
  const fail = () => {
    if (!frame || !fallback || frame.classList.contains('frame-off')) return;
    frame.classList.add('frame-off');
    video.removeAttribute('controls');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    fallback.hidden = false;
  };
  video.querySelector('source')?.addEventListener('error', fail);
  video.addEventListener('error', fail);
}

// ---------- reveal sections as they enter the viewport ----------
if (!reduced.matches && 'IntersectionObserver' in window) {
  const targets = document.querySelectorAll<HTMLElement>('.head, .frame, .beat, .unit, .foe, .fac, .stage-head, .chain, .rules, .tut, .mode, .shots li, .lore-inner, .keys, .safe, .final .wrap');
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('in');
      io.unobserve(en.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  const vh = innerHeight;
  targets.forEach((t) => {
    // never hide what is already on screen when the script arrives
    if (t.getBoundingClientRect().top < vh * 0.9) return;
    t.classList.add('rv');
    io.observe(t);
  });
  root.classList.add('js');
}
