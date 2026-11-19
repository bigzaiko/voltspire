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
import { icon, iconLabel, chip as icChip, chainOf as icChain, recipes } from './icons.ts';
import type { IconName, ChainNode as IcNode } from './icons.ts';

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

/** A price as icon chips: credits, and building materials when it takes some. */
const priceChips = (cr: number, mat: number) => [icChip('credits', cr, { title: 'Credits', size: 14 }), mat ? icChip('mats', mat, { title: 'Building materials', size: 14 }) : null];
/** The numbers of a tower as small chips: how long an item lasts it, its range, what Mk2 and Mk3 cost. */
function statsOf(t: TowerType, n: TowerNeeds): HTMLElement {
  const row = h('div', 'unit-stats');
  const per = perItem(t, n);
  if (n.item && per) row.append(icChip(n.item, per.split(' per ')[0], { title: cap(per), size: 14 }));
  row.append(h('span', 'stat', h('i', 'stat-rng'), num(TOWERS[t].range / CELL) + ' tiles'));
  for (const lv of [1, 2]) row.append(h('span', 'stat stat-mk', h('b', '', 'Mk' + (lv + 1)), ...priceChips(upgradeCost(t, lv), upgradeMat(t, lv))));
  row.setAttribute('aria-label', cap([per, `range ${num(TOWERS[t].range / CELL)} tiles`, `Mk2 ${price(upgradeCost(t, 1), upgradeMat(t, 1))}`, `Mk3 ${price(upgradeCost(t, 2), upgradeMat(t, 2))}`].filter(Boolean).join(', ')));
  row.setAttribute('role', 'group');
  return row;
}

function buildRoster(host: HTMLElement) {
  host.textContent = '';
  for (const t of TOWER_TYPES) {
    const d = TOWERS[t], copy = TOWER_COPY[t];
    const img = still('tower_' + t, 640, copy.alt, '(max-width: 640px) 92vw, (max-width: 1080px) 46vw, 380px');
    const frame = h('div', 'unit-img', img);
    const txt = h('div', 'unit-txt');
    txt.append(
      h('p', 'unit-tag', h('span', '', tierLabel(t)), h('span', 'unit-price', ...priceChips(d.cost, d.mat))),
      h('h3', '', d.name),
      h('p', 'unit-desc', copy.text),
    );
    const needs = h('ul', 'chips', ...needChips(d.needs));
    needs.setAttribute('aria-label', 'What it needs from the factory');
    txt.append(h('div', 'unit-row', h('span', 'unit-k', 'Needs'), needs), statsOf(t, d.needs));
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
/** An icon in a row of them, named for the reader. */
const ico = (n: IconName, size = 22) => icon(n, { size, title: iconLabel(n) });
const arrow = () => h('i', 'fl-arr');
function buildDeposits(host: HTMLElement) {
  host.textContent = '';
  for (const d of DEPOSITS) {
    const res: ItemType | FluidType = d.ore === 'oil' ? 'crude' : d.ore;
    const fac: FacType = d.ore === 'oil' ? 'pump' : 'mine';
    const plate: ItemType | null = d.ore === 'iron_ore' ? 'iron' : d.ore === 'copper_ore' ? 'copper' : null;
    // what it becomes: deposit, what stands on it, what comes out (and the plate a Smelter makes of it)
    const flow = h('p', 'fl', ico(`dep_${d.ore}`), arrow(), ico(`fac_${fac}`), arrow(), ico(res), ...(plate ? [arrow(), ico('fac_smelter'), arrow(), ico(plate)] : []));
    // which towers live on it, somewhere down their chain
    const feeds = TOWER_TYPES.filter((t) => chainOf(t, false).res.has(res) || (!!TOWER_NEEDS_L3[t] && chainOf(t, true).res.has(res)));
    const fed = h('p', 'fl fl-feeds', h('span', 'unit-k', 'Feeds'), ...feeds.map((t) => ico(`tw_${t}`, 20)));
    const li = h('li', 'fac dep', still(d.img, 640, `A patch of ${ORES[d.ore].name.toLowerCase()} tiles on the deck.`, '(max-width: 640px) 104px, 280px'),
      h('div', '', h('h4', '', ORES[d.ore].name), flow, fed, h('p', 'sr', d.gives)));
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
/** What a building takes and makes, as icons: deposits and inputs (with their counts), an arrow, the products, the time. */
function recipeRow(f: FacType): HTMLElement | null {
  const steps = recipes().filter((st) => st.fac === f);
  if (!steps.length) return null;
  const ins = new Map<IconName, number>(), outs = new Map<IconName, number>(), fuel = new Set<IconName>();
  for (const st of steps) {
    if (st.on) ins.set(`dep_${st.on}`, 0);
    for (const i of st.inp) ins.set(i.res, i.n);
    if (st.fuel) fuel.add(st.fuel.res);
    outs.set(st.out, st.n);
  }
  const q = (n: IconName, c: number) => h('span', 'rq', ico(n, 24), c > 1 ? h('b', '', String(+c.toFixed(1))) : null);
  const st = steps[0];
  // (several recipes: their inputs are alternatives; one recipe: it takes them all)
  const sep = (a: HTMLElement[]) => a.flatMap((e, i) => (i ? [h('i', 'rq-or', steps.length > 1 ? '/' : '+'), e] : [e]));
  return h('p', 'fl fac-rec',
    ...sep([...ins].map(([n, c]) => q(n, c))),
    ...[...fuel].map((n) => h('span', 'rq rq-fuel', h('i', 'rq-plus', '+'), ico(n, 18))),
    arrow(),
    ...sep([...outs].map(([n, c]) => q(n, c))),
    h('span', 'stat', icon('time', { size: 13 }), st.rate ? 'per s' : st.time + ' s'));
}
function buildFacs(host: HTMLElement) {
  const types = (host.dataset.facs || '').split(',').filter((t): t is FacType => t in FACS);
  host.textContent = '';
  for (const f of types) {
    const d = FACS[f], r = recipe(f);
    const tags = h('p', 'fac-tag',
      d.cost ? icChip('credits', d.cost, { title: 'Credits', size: 14 }) : h('span', 'stat', 'Free'),
      d.power ? icChip('power', d.power, { title: 'Power it draws', size: 14 }) : null,
      FAC_UPGRADABLE.has(f) ? h('span', 'stat', 'Mk1-3') : null);
    // a plant shows what goes in and what comes out as icons; a piece of logistics says in a line what it does
    const rec = recipeRow(f);
    const body = rec ? [rec, h('p', 'sr', `${r.makes}. Needs ${r.needs.toLowerCase()}${d.power ? ', and power' : ''}.`)]
      : [h('p', 'fac-text', r.makes + '.'), h('p', 'fac-need', r.needs + (d.power ? '. Power' : '') + '.')];
    const li = h('li', 'fac', still('fac_' + f, 640, FAC_ALT[f] || `A ${d.name} on its tile.`, '(max-width: 640px) 104px, (max-width: 1080px) 46vw, 380px'),
      h('div', '', h('h4', '', d.name), tags, ...body, h('p', 'fac-unlock', icon('st_locked', { size: 14 }), h('span', '', unlock(f)))));
    li.style.setProperty('--c', hex(d.color));
    host.append(li);
  }
}

// ---------- the supply chain, tower by tower ----------
// One fixed map of the factory: deposits, what stands on them, what works the ore, the plants, and the tower. Picking a
// tower lights the part of it that tower lives on. The chains themselves are worked out from the game's data. Every node
// is a tile with the game's own render of it and its icon; the wires under them carry the items' icons.
type NodeId = 'd_iron' | 'd_copper' | 'd_coal' | 'd_oil' | 'm_iron' | 'm_copper' | 'm_coal' | 'pump' | 's_iron' | 's_copper' | 'generator' | 'refinery' | 'works' | 'press' | 'cells' | 'missiles' | 'tower';
interface ChainNode { l: number; s: number; label: string; short: string; img: string; ic: IconName; fac?: FacType; ore?: OreType; ink?: string }
const depNode = (ore: OreType, s: number, img: string, short: string, ink: string): ChainNode => ({ l: 0, s, label: ORES[ore].name, short, img, ic: `dep_${ore}`, ore, ink });
const facNode = (fac: FacType, l: number, s: number, short = FACS[fac].name): ChainNode => ({ l, s, label: FACS[fac].name, short, img: 'fac_' + fac, ic: `fac_${fac}`, fac });
const NODES: Record<NodeId, ChainNode> = {
  d_iron: depNode('iron_ore', 0, 'dep_iron', 'Iron', inkOf('iron_ore')),
  d_copper: depNode('copper_ore', 1, 'dep_copper', 'Copper', inkOf('copper_ore')),
  d_coal: depNode('coal', 2, 'dep_coal', 'Coal', inkOf('coal')),
  d_oil: depNode('oil', 3, 'dep_oil', 'Oil', inkOf('crude')),
  m_iron: facNode('mine', 1, 0), m_copper: facNode('mine', 1, 1), m_coal: facNode('mine', 1, 2), pump: facNode('pump', 1, 3),
  s_iron: facNode('smelter', 2, 0), s_copper: facNode('smelter', 2, 1), generator: facNode('generator', 2, 2), refinery: facNode('refinery', 2, 3),
  works: facNode('works', 3, 0), press: facNode('press', 3, 1), cells: facNode('cells', 3, 2), missiles: facNode('missiles', 3, 3),
  tower: { l: 4, s: 1.5, label: '', short: '', img: '', ic: 'tw_pulse' },
};
/** The building a thing comes out of. */
const SRC: Record<Res, NodeId> = {
  iron_ore: 'm_iron', copper_ore: 'm_copper', coal: 'm_coal', iron: 's_iron', copper: 's_copper', shell: 'press', cell: 'cells',
  missile: 'missiles', crude: 'pump', petrol: 'refinery', power: 'generator', mats: 'works',
};
const DEPOSIT_OF: Partial<Record<NodeId, NodeId>> = { m_iron: 'd_iron', m_copper: 'd_copper', m_coal: 'd_coal', pump: 'd_oil' };
/** What comes out of a deposit (the icon its wire carries). */
const DUG: Partial<Record<NodeId, Res>> = { d_iron: 'iron_ore', d_copper: 'copper_ore', d_coal: 'coal', d_oil: 'crude' };
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

/** The way a tower is fed, as a few icon steps: deposit, what works it (with what else it takes), the hand-off, the tower. */
interface StepV { ic: IconName; by?: IconName; plus: IconName[]; label: string }
function chainSteps(t: TowerType, mk3: boolean): StepV[] {
  const c = icChain({ tower: t }, mk3 ? 3 : 1, mk3);
  const root = c?.roots[0], main = root?.kids[0], out: StepV[] = [];
  if (!main) return out;
  const walk = (n: IcNode) => {
    if (n.kind === 'ore') { out.push({ ic: n.icon, plus: [], label: n.name }); return; }
    // (the line to follow is the main ingredient: not the coal a plant also takes)
    const first = n.kids.find((k) => k.id !== 'coal') || n.kids[0], rest = n.kids.filter((k) => k !== first);
    if (first) walk(first);
    const fac = n.by?.fac;
    if (!fac) { out.push({ ic: n.icon, plus: [], label: n.name }); return; }
    const plus: IconName[] = rest.map((k) => k.icon);
    if (n.by?.fuel) plus.push(n.by.fuel.res);
    out.push({ ic: n.icon, by: `fac_${fac}`, plus, label: `${n.name} from a ${FACS[fac].name}` + (plus.length ? ', with ' + list(plus.map(iconLabel)).toLowerCase() : '') });
  };
  walk(main);
  const via: FacType = main.id === 'power' ? 'pole' : main.id in FLUIDS ? 'pipe' : 'arm';
  out.push({ ic: `fac_${via}`, plus: [], label: 'carried by ' + (via === 'arm' ? 'a ' : '') + FACS[via].name + (via === 'pole' ? 's' : via === 'pipe' ? 's' : '') });
  out.push({ ic: `tw_${t}`, plus: [], label: 'into the ' + TOWERS[t].name + (mk3 ? ' Mk3' : '') });
  return out;
}
function stepsEl(steps: StepV[]): HTMLOListElement {
  const ol = h('ol', 'cp-steps');
  ol.setAttribute('aria-label', 'How it is fed');
  for (const st of steps) {
    const li = h('li', 'cp-step');
    li.setAttribute('aria-label', cap(st.label));
    li.title = cap(st.label);
    if (st.plus.length) li.append(h('span', 'cp-plus', ...st.plus.map((p) => icon(p, { size: 14 }))));
    li.append(h('span', 'cp-ic', icon(st.ic, { size: 28 }), st.by ? h('span', 'cp-by', icon(st.by, { size: 15 })) : null));
    ol.append(li);
  }
  return ol;
}
/** A small square render (media/sm, 320 px), shown much smaller. */
function thumb(name: string, alt = ''): HTMLImageElement {
  const img = h('img');
  img.width = 320; img.height = 320; img.loading = 'lazy'; img.decoding = 'async'; img.alt = alt;
  img.src = `${MEDIA}sm/${name}.jpg`;
  return img;
}

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
    const b = h('button', 'chain-btn', h('span', 'chain-btn-img', thumb('tower_' + t)), h('span', 'chain-btn-name', TOWERS[t].name));
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

  let nodeEls = new Map<NodeId, HTMLLIElement>(), edgeEls = new Map<string, SVGElement>(), title: SVGElement | null = null;
  let carriers: SVGElement | null = null;
  let towerImg: HTMLImageElement | null = null, towerBadge: HTMLElement | null = null, towerCap: HTMLElement | null = null;
  const flowPath = new Map<string, SVGPathElement>();
  let G = { W: 1000, H: 500, ic: 18 };

  function draw() {
    const v = narrow.matches;
    // geometry: layers run left to right on a wide screen, top to bottom on a narrow one (nd: a tile, td: the tower, cap: room for a caption under a tile)
    const g = v ? { W: 400, H: 662, l0: 44, lp: 132, s0: 56, sp: 96, nd: 58, td: 118, cap: 17, lo: -0.53, hi: 3.53, ic: 15 }
      : { W: 1000, H: 500, l0: 66, lp: 188, s0: 70, sp: 112, nd: 74, td: 150, cap: 0, lo: -0.56, hi: 3.56, ic: 18 };
    G = g;
    const slot = (x: number) => g.s0 + Math.max(g.lo, Math.min(g.hi, x)) * g.sp;
    const at = (l: number, sl: number): [number, number] => (v ? [slot(sl), g.l0 + l * g.lp] : [g.l0 + l * g.lp, slot(sl)]);
    const half = (n: NodeId) => (n === 'tower' ? g.td : g.nd) / 2;
    const svg = s('svg', { class: 'chain-svg', viewBox: `0 0 ${g.W} ${g.H}`, role: 'img', 'aria-labelledby': 'chain-title' });
    title = s('title', { id: 'chain-title' });
    svg.append(title);
    const wires = s('g', { class: 'wires' });
    carriers = s('g', { class: 'carriers', 'aria-hidden': 'true' });
    edgeEls = new Map(); nodeEls = new Map(); flowPath.clear();
    let i = 0;
    for (const [key, e] of all) {
      const a = NODES[e.from], b = NODES[e.to];
      const pts: [number, number][] = [at(a.l, a.s)];
      (VIA[edgeKey(e)] || []).forEach((gap, k) => pts.push(at(a.l + 1 + k, gap)));
      pts.push(at(b.l, b.s));
      // leave the first tile on its far side (below its caption on a narrow screen), enter the last on its near side
      const ax = v ? 1 : 0;
      pts[0][ax] += half(e.from) + 2 + g.cap; pts[pts.length - 1][ax] -= half(e.to) + 2;
      let dpath = `M${pts[0][0]} ${pts[0][1]}`;
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
        dpath += v ? ` C${x0} ${(y0 + y1) / 2} ${x1} ${(y0 + y1) / 2} ${x1} ${y1}` : ` C${(x0 + x1) / 2} ${y0} ${(x0 + x1) / 2} ${y1} ${x1} ${y1}`;
      }
      const ink = e.res === 'deposit' ? NODES[e.from].ink! : inkOf(e.res);
      const flow = s('path', { class: 'wire-flow', d: dpath, id: 'cw' + i++ }) as SVGPathElement;
      const wg = s('g', { class: 'wire' + (e.res === 'mats' ? ' wire-mats' : ''), color: ink }, s('path', { class: 'wire-line', d: dpath }), flow);
      edgeEls.set(key, wg);
      flowPath.set(key, flow);
      wires.append(wg);
    }
    svg.append(wires, carriers);

    // the tiles, over the drawing: placed in percent of it, so they scale with it
    const tiles = h('ul', 'chain-nodes' + (v ? ' chain-v' : ''));
    tiles.setAttribute('aria-label', 'Deposits and buildings');
    for (const id of Object.keys(NODES) as NodeId[]) {
      const n = NODES[id], [x, y] = at(n.l, n.s), d = id === 'tower' ? g.td : g.nd;
      const li = h('li', 'cn' + (id === 'tower' ? ' cn-tower' : n.ore ? ' cn-dep' : ''));
      li.tabIndex = 0;
      li.style.setProperty('--x', String((x / g.W) * 100));
      li.style.setProperty('--y', String((y / g.H) * 100));
      li.style.setProperty('--d', String((d / g.W) * 100));
      if (n.ink) li.style.setProperty('--k', n.ink);
      const img = id === 'tower' ? thumb('tower_' + cur) : thumb(n.img);
      const badge = h('span', 'cn-badge', icon(n.ic, { size: 18 }));
      const capEl = h('span', 'cn-cap', n.short);
      li.append(h('span', 'cn-img', img), badge, capEl);
      if (id === 'tower') { towerImg = img; towerBadge = badge; towerCap = capEl; }
      if (id === 'tower' || (n.fac && FACS[n.fac].power)) li.append(h('span', 'cn-pw', icon('power', { size: 14 })));
      nodeEls.set(id, li);
      tiles.append(li);
    }
    figure.textContent = '';
    figure.append(svg, tiles);
  }

  /** The items' icons along the lit wires: two on each, moving (or one, still, in the middle when motion is reduced). */
  function carry(lit: Edge[]) {
    if (!carriers) return;
    carriers.textContent = '';
    const sz = G.ic;
    for (const e of lit) {
      const r = e.res === 'deposit' ? DUG[e.from] : e.res;
      const path = flowPath.get(edgeKey(e) + ':' + e.res);
      if (!r || r === 'power' || !path) continue;
      const len = path.getTotalLength();
      const dur = Math.max(1.6, len / 55);
      const n = reduced.matches ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const ic = icon(r, { size: sz });
        ic.setAttribute('x', String(-sz / 2)); ic.setAttribute('y', String(-sz / 2));
        const grp = s('g', { class: 'carrier' }, s('circle', { r: sz / 2 + 2, class: 'carrier-bg' }), ic);
        if (reduced.matches) {
          const p = path.getPointAtLength(len / 2);
          grp.setAttribute('transform', `translate(${p.x} ${p.y})`);
        } else {
          grp.append(s('animateMotion', { dur: dur.toFixed(2) + 's', begin: (-(dur * k) / n).toFixed(2) + 's', repeatCount: 'indefinite' }, s('mpath', { href: '#' + path.id })));
        }
        carriers.append(grp);
      }
    }
  }

  function update() {
    const d = TOWERS[cur], l3 = TOWER_NEEDS_L3[cur], col = hex(d.color);
    if (!l3) mk3 = false;
    const c = chainOf(cur, mk3);
    for (const [t, b] of buttons) b.setAttribute('aria-pressed', String(t === cur));
    const lit = new Set(c.edges.map((e) => edgeKey(e) + ':' + e.res));
    for (const [k, g] of edgeEls) g.classList.toggle('on', lit.has(k));
    for (const [id, li] of nodeEls) {
      const on = c.nodes.has(id), pw = c.powered.has(id), n = NODES[id];
      li.classList.toggle('on', on);
      li.classList.toggle('pw', pw);
      if (id !== 'tower') li.setAttribute('aria-label', `${n.label}: ${on ? 'part of this chain' : 'not used'}${on && pw ? ', needs power' : ''}`);
    }
    const tn = nodeEls.get('tower');
    if (tn) {
      tn.style.setProperty('--c', col);
      tn.setAttribute('aria-label', `${d.name}${mk3 ? ' Mk3' : ''}, the tower this chain feeds${c.powered.has('tower') ? ', needs power' : ''}`);
    }
    if (towerImg) { towerImg.src = `${MEDIA}sm/tower_${cur}.jpg`; towerImg.alt = ''; }
    if (towerBadge) towerBadge.replaceChildren(icon(`tw_${cur}`, { size: 22 }));
    if (towerCap) towerCap.textContent = d.name + (mk3 ? ' Mk3' : '');
    const supply = (mk3 && TOWER_SUPPLY_L3[cur]) || TOWER_SUPPLY[cur];
    if (title) title.textContent = `Supply chain of the ${d.name}${mk3 ? ' Mk3 on its second ammunition' : ''}. ${supply}`;
    carry(c.edges);

    // legend: what runs along the lit lines, as the icons that move on them
    legend.textContent = '';
    const last = (r: Res) => (r === 'power' ? 1 : r === 'mats' ? 2 : 0);
    for (const r of [...c.res].sort((a, b) => last(a) - last(b))) legend.append(chip(r, r === 'mats' ? 'Materials' : undefined));

    // the card beside the diagram
    panel.textContent = '';
    const need = (mk3 && l3) || d.needs;
    const facs = [...new Set([...TOWER_CHAIN[cur], ...(mk3 ? TOWER_CHAIN_L3[cur] || [] : [])])], chainFacs = facs.map((f) => FACS[f].name);
    // the production cards those buildings come with (the Mine and the Transfer Arm are there from the start), and the ammo card of a second ammunition
    const cards = [...new Set(facs.map((f) => FAC_CARD[f]).filter((id): id is string => !!id))].map((id) => CARD_BY_ID[id].name);
    const ammoCard = mk3 && AMMO2_CARD[cur] ? CARD_BY_ID[AMMO2_CARD[cur]!]?.name : '';
    const hero = still('tower_' + cur, 640, TOWER_COPY[cur].alt, '(max-width: 640px) 112px, (max-width: 1080px) 200px, 280px');
    hero.loading = 'eager';
    const tier = TOWER_TIER[cur];
    const meta = h('div', 'cp-meta',
      icChip('credits', d.cost, { title: 'Price in credits', size: 16 }),
      d.mat ? icChip('mats', d.mat, { title: 'Building materials', size: 16 }) : null,
      ...[need.item, need.fluid].filter((r): r is ItemType | FluidType => !!r).map((r) => icChip(r, '', { title: 'Fires ' + iconLabel(r), size: 16 })),
      (d.needs.power || need.power) ? icChip('power', d.needs.power || need.power || 0, { title: 'Power it draws', size: 16 }) : null,
    );
    const head = h('div', 'cp-head',
      h('p', 'cp-tier', tier === 0 ? 'Starter' : 'Tier ' + tier),
      h('h4', '', d.name + (mk3 ? ' Mk3' : '')),
      meta);
    panel.append(h('div', 'cp-hero', hero), head, stepsEl(chainSteps(cur, mk3)));
    if (l3) {
      const alt = mk3 ? d.needs : l3;
      const b = h('button', 'chain-mk3', ...[alt.item, alt.fluid].filter((r): r is ItemType | FluidType => !!r).map((r) => icon(r, { size: 18 })), h('span', '', mk3 ? 'First ammo' : 'Mk3 ammo'));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(mk3));
      b.setAttribute('aria-label', mk3 ? 'Back to its first ammunition' : 'Show its second ammunition (a Mk3 switch)');
      b.addEventListener('click', () => { mk3 = !mk3; update(); panel.querySelector<HTMLButtonElement>('.chain-mk3')?.focus(); });
      panel.append(b);
    }
    const more = h('details', 'cp-more');
    more.append(...[h('summary', '', 'Details'),
      h('p', 'chain-text', supply),
      h('p', 'chain-unlock', h('b', '', 'Its supply needs '), list(chainFacs) + '.'),
      h('p', 'chain-unlock', h('b', '', 'Cards '), cards.length ? `${tier === 0 ? '' : 'Its blueprint unlocks the tower alone. '}The buildings come with ${list(cards)}${ammoCard ? `, and ${ammoCard} opens the switch on each Mk3` : ''}.` : 'None: the Mine and the Transfer Arm are there from the start.'),
      h('p', 'chain-unlock', h('b', '', 'Hand-offs '), 'Every line of items in the picture is carried by Transfer Arms, with belts between them over a distance. Fluids run in pipes; power reaches what stands near.'),
      c.res.has('power') ? h('p', 'chain-unlock', h('b', '', 'Power '), `The bolt marks what has to stand within ${SUPPLY} tiles of a Generator or Power Pole.`) : null,
      d.mat ? h('p', 'chain-unlock', h('b', '', 'Price '), `${d.mat} building materials on top of ${d.cost} credits. A Frame Works makes them from iron plates; a run starts with a few in stock.`) : null,
    ].filter((e): e is HTMLElement => !!e));
    panel.append(more);
    panel.style.setProperty('--c', col);
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
