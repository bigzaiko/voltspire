// BEATSPIRE: the pictures of the How to play sheet (play.html, #help). The sheet is short illustrated cards under a sticky
// section bar; this module fills each card's picture ([data-fig]) from the game's own tables (data.ts) and the icon set
// (icons.ts), so names, costs and needs never go stale. The four id="help-*" boxes behind "More" are play.ts's (buildHelp).
// Loaded the first time the sheet opens; nothing here sets an inline style attribute (CSP): custom properties go through setProperty.
import {
  TOWERS, TOWER_TYPES, TOWER_TIER, FACS, FAC_TYPES, FAC_CARD, CARDS, CARD_BY_ID, ENEMIES, ENEMY_TYPES, WAVE_POOL, ORES,
  TOWER_NEEDS_L3, AMMO2_CARD, RARITY, upgradeCost, upgradeMat, ITEM_TYPES, FLUID_TYPES, ORE_TYPES, TARGET_MODES, TARGET_INFO,
  type TowerType, type FacType, type TowerNeeds, type EnemyType, type Card, type ItemType, type FluidType, type TargetMode,
} from './game/data.ts';
import { icon, chip, towerIcon, facIcon, stateIcon, aimIcon, recipeDiagram, iconLabel, type IconName } from './icons.ts';

const SVG = 'http://www.w3.org/2000/svg';
const $ = (id: string) => document.getElementById(id) as HTMLElement;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function sv<K extends keyof SVGElementTagNameMap>(tag: K, at: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const k in at) e.setAttribute(k, String(at[k]));
  parent?.append(e);
  return e;
}
/** A drawing of `w` x `h` view units, shown at that size in CSS pixels unless the stylesheet scales it. */
function drawing(w: number, h: number, cls = 'g-svg') {
  return sv('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: cls, 'aria-hidden': 'true', focusable: 'false' });
}
/** One of the game's square renders (public/media/sm, 320 px), lazy, at `size` CSS pixels. */
function still(name: string, size: number, alt = '', cls = 'g-img'): HTMLImageElement {
  const im = el('img', cls);
  im.alt = alt; im.width = size; im.height = size; im.loading = 'lazy'; im.decoding = 'async';
  im.src = `./media/sm/${name}.jpg`;
  im.addEventListener('error', () => im.classList.add('gone'), { once: true });
  return im;
}
/** A wide still (960 x 540). */
function shot(name: string, alt: string) {
  const im = still(name, 960, alt, 'g-shot');
  im.height = 540;
  return im;
}
const kbd = (k: string) => el('kbd', '', k);
const arrow = (cls = 'g-arr') => el('span', cls, '›');
/** Something with a recipe tooltip (play.ts opens it on hover, focus or tap for any [data-rt]). */
function rtip<T extends HTMLElement>(e: T, key: string, label: string): T {
  e.dataset.rt = key; e.tabIndex = 0; e.setAttribute('aria-describedby', 'rtip'); e.setAttribute('aria-label', label);
  return e;
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const credits = (n: number) => chip('credits', n, { size: 14, title: 'Credits' });
const mats = (n: number) => chip('mats', n, { size: 14, title: 'Building materials' });
/** What a tower runs on, as chips. */
function needChips(n: TowerNeeds, size = 14): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (n.item) out.push(chip(n.item, '', { size, title: iconLabel(n.item) }));
  if (n.fluid) out.push(chip(n.fluid, '', { size, title: iconLabel(n.fluid) }));
  if (n.power) out.push(chip('power', n.power, { size, title: 'Power' }));
  return out;
}
const towersByTier = () => [...TOWER_TYPES].sort((a, b) => TOWER_TIER[a] - TOWER_TIER[b]);
/** The icon a card is best shown by: its tower, its first building, or the tower its ammunition is for. */
function cardIcon(c: Card): IconName | null {
  if (c.kind === 'blueprint' && c.id.startsWith('bp_')) return `tw_${c.id.slice(3) as TowerType}`;
  if (c.unlocks) return `fac_${c.unlocks[0]}`;
  if (c.ammo) return `tw_${c.ammo}`;
  return null;
}
function plate(c: Card, cls = 'g-plate') {
  const p = el('span', cls), k = cardIcon(c);
  if (k) p.append(icon(k, { size: 20 })); else p.append(el('i', 'g-glyph', c.icon));
  p.append(el('b', '', c.name.replace(/^Blueprint: /, '')));
  return p;
}

// ---------------------------------------------------------------- small drawings

/** The core: a hex with a lit heart. */
function coreGlyph(size = 64) {
  const s = drawing(64, 64, 'g-core');
  s.setAttribute('width', String(size)); s.setAttribute('height', String(size));
  const hex = (r: number) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 2; return `${32 + r * Math.cos(a)},${32 + r * Math.sin(a)}`; }).join(' ');
  sv('polygon', { points: hex(29), class: 'g-core-o' }, s);
  sv('polygon', { points: hex(20), class: 'g-core-m' }, s);
  sv('circle', { cx: 32, cy: 32, r: 8, class: 'g-core-h' }, s);
  return s;
}
/** A playing card, for the tab bar. */
function cardGlyph() {
  const s = drawing(24, 24, 'ic');
  s.setAttribute('width', '20'); s.setAttribute('height', '20');
  sv('rect', { x: 8, y: 3, width: 12, height: 16, rx: 1.5, class: 'g-gl-b' }, s);
  sv('rect', { x: 4, y: 5, width: 12, height: 16, rx: 1.5, class: 'g-gl-a' }, s);
  sv('path', { d: 'M7 8h6', class: 'g-gl-l' }, s);
  return s;
}
/** A key cap, for the tab bar. */
function keyGlyph() {
  const s = drawing(24, 24, 'ic');
  s.setAttribute('width', '20'); s.setAttribute('height', '20');
  sv('rect', { x: 2.5, y: 6, width: 19, height: 13, rx: 2, class: 'g-gl-b' }, s);
  sv('path', { d: 'M6 10h2M11 10h2M16 10h2M7 15h10', class: 'g-gl-l' }, s);
  return s;
}
/** A heart, for the tab bar. */
function goalGlyph() {
  const s = coreGlyph(20);
  s.setAttribute('class', 'ic g-core');
  return s;
}
/** The mouse, with one part lit: left, right, middle (wheel) or none. */
function mouseGlyph(lit: 'l' | 'r' | 'm' | '') {
  const s = drawing(26, 36, 'g-mouse');
  sv('rect', { x: 2, y: 2, width: 22, height: 32, rx: 11, class: 'g-m-body' }, s);
  if (lit === 'l') sv('path', { d: 'M13 2.5A10.5 10.5 0 0 0 2.5 13V15H13Z', class: 'g-m-lit' }, s);
  if (lit === 'r') sv('path', { d: 'M13 2.5A10.5 10.5 0 0 1 23.5 13V15H13Z', class: 'g-m-lit' }, s);
  sv('path', { d: 'M2.5 15H23.5M13 2.5V15', class: 'g-m-line' }, s);
  sv('rect', { x: 11, y: 6, width: 4, height: 6, rx: 2, class: lit === 'm' ? 'g-m-lit' : 'g-m-wheel' }, s);
  return s;
}
type Gesture = 'tap' | 'tap2' | 'hold' | 'drag' | 'pinch' | 'twist' | 'line';
/** A finger gesture: fingertips (filled dots), their ripples and their paths. */
function gestureGlyph(g: Gesture) {
  const s = drawing(48, 48, 'g-gest');
  const dot = (x: number, y: number) => sv('circle', { cx: x, cy: y, r: 5, class: 'g-g-dot' }, s);
  const ring = (x: number, y: number, r: number, cls = 'g-g-ring') => sv('circle', { cx: x, cy: y, r, class: cls }, s);
  const line = (d: string, cls = 'g-g-path') => sv('path', { d, class: cls }, s);
  if (g === 'tap') { ring(24, 24, 11); ring(24, 24, 17, 'g-g-ring2'); dot(24, 24); }
  if (g === 'tap2') { ring(18, 24, 10); ring(30, 24, 10); dot(18, 24); dot(30, 24); }
  if (g === 'hold') { ring(24, 24, 14, 'g-g-ring2'); line('M24 10A14 14 0 1 1 10 24', 'g-g-arc'); dot(24, 24); }
  if (g === 'drag') { line('M10 34C18 34 26 16 38 14', 'g-g-trail'); line('M33 10L38.5 14L34 19', 'g-g-path'); dot(10, 34); }
  if (g === 'line') { for (let i = 0; i < 4; i++) sv('polygon', { points: hexPts(9 + i * 10, 30, 5.6), class: 'g-g-hex' }, s); line('M9 30H39', 'g-g-trail'); dot(39, 30); }
  if (g === 'pinch') { line('M20 28L9 39M28 20L39 9', 'g-g-path'); line('M9 33V39H15M39 15V9H33', 'g-g-path'); dot(20, 28); dot(28, 20); }
  if (g === 'twist') { line('M12 18A14 14 0 0 1 30 10', 'g-g-path'); line('M36 30A14 14 0 0 1 18 38', 'g-g-path'); line('M26 7L30.5 10L27 14M22 41L17.5 38L21 34', 'g-g-path'); dot(14, 26); dot(34, 22); }
  return s;
}
/** The corners of a pointy-top hex round (x, y). */
function hexPts(x: number, y: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 2; return `${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`; }).join(' ');
}
/** An icon placed inside a drawing, centred on (x, y). */
function iconAt(parent: SVGElement, name: IconName, x: number, y: number, size: number, cls = '') {
  const i = icon(name, { size });
  i.setAttribute('x', String(x - size / 2)); i.setAttribute('y', String(y - size / 2));
  if (cls) i.classList.add(cls);
  parent.append(i);
  return i;
}
/** A row of hex tiles holding icons, with arrows between them: the language of the arm and belt pictures. */
function hexRow(cells: { ic: IconName; cls?: string; label?: string }[], badge?: 'ok' | 'missing', badgeLabel = '') {
  const r = el('div', 'g-hexrow');
  cells.forEach((c, i) => {
    if (i) r.append(el('span', 'g-hexarr' + (c.cls?.includes('blocked') ? ' blocked' : '')));
    const h = el('span', 'g-hex' + (c.cls ? ' ' + c.cls : ''));
    h.append(icon(c.ic, { size: 26 }));
    if (c.label) h.title = c.label;
    r.append(h);
  });
  if (badge) {
    const b = el('span', 'g-badge ' + badge);
    b.append(stateIcon(badge, { size: 22, title: badgeLabel }));
    r.append(b);
  }
  return r;
}

// ---------------------------------------------------------------- the pictures, by card

const FIGS: Record<string, (box: HTMLElement) => void> = {
  heart(box) {
    const row = el('div', 'g-march');
    const pack = el('div', 'g-pack');
    for (const e of ['runner', 'grunt', 'brute'] as EnemyType[]) pack.append(still(`enemy_${e}`, 64, ENEMIES[e].name));
    const road = el('div', 'g-road');
    for (let i = 0; i < 3; i++) road.append(el('i'));
    const core = el('div', 'g-heart');
    core.append(coreGlyph(72), el('span', 'g-cap', 'Heart'));
    row.append(pack, road, core);
    box.append(row);
  },
  roster(box) {
    const g = el('div', 'g-roster');
    const list = ENEMY_TYPES.filter((e) => e !== 'mite').sort((a, b) => ENEMIES[a].from - ENEMIES[b].from);
    for (const e of list) {
      const d = ENEMIES[e], t = el('figure', 'g-en' + (e === 'boss' || e === 'titan' || e === 'wheel' ? ' big' : ''));
      t.append(still(`enemy_${e}`, 64, ''), el('figcaption', '', d.name), el('small', '', d.from > 999 ? 'finale' : `wave ${d.from}`));
      t.setAttribute('role', 'img'); t.setAttribute('aria-label', `${d.name}: ${d.from > 999 ? 'the finale' : 'from wave ' + d.from}`);
      g.append(t);
    }
    box.append(g);
  },
  jam(box) {
    const g = el('div', 'g-pair');
    const one = (enemy: EnemyType, tower: TowerType, ring: 'mite' | 'stun', cap: string) => {
      const f = el('figure', 'g-ringed ' + ring);
      const st = el('div', 'g-stage');
      st.append(still(`tower_${tower}`, 96, ''));
      const s = drawing(96, 36, 'g-ringsvg');
      sv('ellipse', { cx: 48, cy: 18, rx: 40, ry: 13, class: 'g-r' }, s);
      sv('ellipse', { cx: 48, cy: 18, rx: 40, ry: 13, class: 'g-r2' }, s);
      st.append(s);
      const by = still(`enemy_${enemy}`, 40, ENEMIES[enemy].name, 'g-img g-by');
      st.append(by, el('span', 'g-over ' + ring));
      f.append(st, el('figcaption', '', cap));
      return f;
    };
    g.append(one('brood', 'pulse', 'mite', ENEMIES.mite.name + 's'), one('titan', 'arc', 'stun', ENEMIES.titan.name));
    box.append(g);
  },
  build(box) {
    const f = el('div', 'g-shotbox');
    f.append(shot('shot-build', 'The build phase: towers, factory and the supply rings before the wave is called'));
    const b = el('span', 'g-stamp');
    b.append(icon('time', { size: 16 }), el('span', '', 'Build phase'));
    const call = el('span', 'g-call');
    call.append(el('span', 'kbd-only', ''), el('b', '', 'Call wave'));
    (call.firstElementChild as HTMLElement).append(kbd('N'));
    f.append(b, call);
    box.append(f);
  },
  gates(box) {
    const g = el('div', 'g-gates');
    const pool = WAVE_POOL.slice(0, 3);
    [[pool[0], 8], [pool[1], 5], [pool[2], 3]].forEach(([e, n], i) => {
      const gate = el('div', 'g-gate');
      const tag = el('div', 'g-tag');
      tag.append(still(`enemy_${e}`, 32, ''), el('b', '', `×${n}`));
      tag.setAttribute('role', 'img'); tag.setAttribute('aria-label', `${n} ${ENEMIES[e as EnemyType].name}`);
      const arch = drawing(56, 40, 'g-arch');
      sv('path', { d: 'M6 40V14L28 3L50 14V40H40V20H16V40Z', class: 'g-arch-a' }, arch);
      gate.append(tag, arch, el('span', 'g-lane'));
      if (i === 1) gate.classList.add('mid');
      g.append(gate);
    });
    box.append(g);
  },
  upgrade(box) {
    const t: TowerType = 'rail', r = el('div', 'g-mk');
    for (let l = 1; l <= 3; l++) {
      if (l > 1) {
        const c = el('div', 'g-mkcost');
        c.append(credits(upgradeCost(t, l - 1)));
        const m = upgradeMat(t, l - 1);
        if (m) c.append(mats(m));
        r.append(c);
      }
      const f = el('figure', 'g-mkt l' + l);
      f.append(still(`tower_${t}`, 40 + l * 14, `${TOWERS[t].name} Mk${l}`), el('figcaption', '', `Mk${l}`));
      r.append(f);
    }
    box.append(r);
  },
  towers(box) {
    const g = el('div', 'g-towers');
    for (const t of towersByTier()) {
      const d = TOWERS[t], tile = rtip(el('div', 'g-tw'), `tower:${t}`, `${d.name}. ${d.desc}`);
      tile.style.setProperty('--tc', '#' + d.color.toString(16).padStart(6, '0'));
      const top = el('div', 'g-twimg');
      top.append(still(`tower_${t}`, 88, ''));
      const k = kbd(d.key); k.classList.add('kbd-only', 'g-key');
      top.append(k);
      const cost = el('div', 'g-cost');
      cost.append(credits(d.cost));
      if (d.mat) cost.append(mats(d.mat));
      const needs = el('div', 'g-needs');
      needs.append(...needChips(d.needs));
      tile.append(top, el('b', '', d.name), el('small', 'g-tier', TOWER_TIER[t] ? `round ${TOWER_TIER[t]} blueprint` : 'from the start'), needs, cost);
      g.append(tile);
    }
    box.append(g);
  },
  specials(box) {
    const g = el('div', 'g-specs');
    for (const t of towersByTier()) {
      const sp = TOWERS[t].special;
      if (!sp) continue;
      const f = el('figure', 'g-sp');
      f.append(still(`tower_${t}`, 48, ''), el('figcaption', '', sp.name));
      f.title = `${TOWERS[t].name}: ${sp.desc}`;
      f.setAttribute('role', 'img'); f.setAttribute('aria-label', `${TOWERS[t].name}, ${sp.name}: ${sp.desc}`);
      g.append(f);
    }
    box.append(g);
  },
  mk3(box) {
    const g = el('div', 'g-ammo');
    for (const t of TOWER_TYPES) {
      const l3 = TOWER_NEEDS_L3[t], cid = AMMO2_CARD[t];
      if (!l3 || !cid || !CARD_BY_ID[cid]) continue;
      const r = el('div', 'g-am');
      const tw = el('figure', 'g-amt');
      tw.append(still(`tower_${t}`, 56, ''), el('figcaption', '', TOWERS[t].name + ' Mk3'));
      const sw = el('div', 'g-amsw');
      const from = el('span', 'g-amfrom'), to = el('span', 'g-amto');
      from.append(...needChips({ item: TOWERS[t].needs.item, fluid: TOWERS[t].needs.fluid }, 18));
      to.append(...needChips({ item: l3.item, fluid: l3.fluid }, 18));
      if (l3.dmg) to.append(el('b', 'g-plus', `+${Math.round((l3.dmg - 1) * 100)}%`));
      sw.append(from, arrow(), to);
      const c = plate(CARD_BY_ID[cid], 'g-plate small');
      r.append(tw, el('div', 'g-amr'));
      (r.lastElementChild as HTMLElement).append(sw, c);
      g.append(r);
    }
    box.append(g);
  },
  chain(box) {
    const r = el('div', 'g-chain');
    const step = (img: string, name: string, rt: string, cost?: number, cap = '') => {
      const f = rtip(el('figure', 'g-step'), rt, name);
      f.append(still(img, 96, ''), el('figcaption', '', name));
      if (cost !== undefined) { const c = el('div', 'g-cost'); c.append(credits(cost)); f.append(c); } else f.append(el('small', 'g-free', cap));
      return f;
    };
    const flow = () => { const a = el('span', 'g-flow'); a.append(icon('iron_ore', { size: 18 })); return a; };
    r.append(
      step('dep_iron', ORES.iron_ore.name, 'ore:iron_ore', undefined, 'on the map'), flow(),
      step('fac_mine', FACS.mine.name, 'fac:mine', FACS.mine.cost), flow(),
      step('fac_arm', FACS.arm.name, 'fac:arm', FACS.arm.cost), flow(),
      step('tower_pulse', TOWERS.pulse.name, 'tower:pulse', TOWERS.pulse.cost),
    );
    box.append(r);
  },
  arm(box) {
    // three pointy-top hexes side by side: what stands behind the arm, the arm, what stands in front
    const R = 30, W = Math.sqrt(3) * R, s = drawing(Math.round(3 * W + 20), 2 * R + 34, 'g-armsvg');
    const cx = (i: number) => 10 + W / 2 + i * W, cy = R + 4;
    for (let i = 0; i < 3; i++) sv('polygon', { points: hexPts(cx(i), cy, R), class: 'g-hx' + (i === 1 ? ' arm' : '') }, s);
    // the arm's back edge and front edge
    const ex = (i: number, side: -1 | 1) => cx(i) + side * W / 2;
    sv('line', { x1: ex(1, -1), y1: cy - R / 2, x2: ex(1, -1), y2: cy + R / 2, class: 'g-edge back' }, s);
    sv('line', { x1: ex(1, 1), y1: cy - R / 2, x2: ex(1, 1), y2: cy + R / 2, class: 'g-edge front' }, s);
    iconAt(s, 'fac_mine', cx(0), cy, 30);
    iconAt(s, 'fac_arm', cx(1), cy, 30);
    iconAt(s, 'tw_pulse', cx(2), cy, 30);
    sv('path', { d: `M${cx(0) + 14} ${cy + 16}H${cx(2) - 14}`, class: 'g-armpath' }, s);
    sv('path', { d: `M${cx(2) - 20} ${cy + 11}L${cx(2) - 14} ${cy + 16}L${cx(2) - 20} ${cy + 21}`, class: 'g-armhead' }, s);
    const dotG = sv('g', { class: 'g-carry' }, s);
    iconAt(dotG, 'iron_ore', cx(0) + 14, cy + 16, 14);
    const lab = (x: number, t: string, cls: string) => { const e = sv('text', { x, y: 2 * R + 28, class: 'g-lab ' + cls, 'text-anchor': 'middle' }, s); e.textContent = t; };
    lab(ex(1, -1), 'takes', 'back'); lab(ex(1, 1), 'gives', 'front');
    s.setAttribute('role', 'img'); s.removeAttribute('aria-hidden');
    s.setAttribute('aria-label', 'A Transfer Arm takes from the Mine behind it and gives to the Pulse Turret in front of it');
    box.append(s);
  },
  belt(box) {
    const g = el('div', 'g-belts');
    g.append(
      hexRow([{ ic: 'fac_belt' }, { ic: 'fac_belt' }, { ic: 'tw_pulse', cls: 'blocked' }], 'missing', 'A belt alone does not feed the tower'),
      hexRow([{ ic: 'fac_belt' }, { ic: 'fac_arm', cls: 'lit' }, { ic: 'tw_pulse' }], 'ok', 'An arm between the belt and the tower feeds it'),
    );
    box.append(g);
  },
  grid(box) {
    const g = el('div', 'g-pair g-gridpair');
    // a pipe touching the pylon
    const pipe = el('figure', 'g-mini');
    pipe.append(hexRow([{ ic: 'fac_pump' }, { ic: 'fac_pipe' }, { ic: 'tw_flame' }]), el('figcaption', '', 'pipe'));
    // power: a generator and its reach of 2 tiles
    const pw = el('figure', 'g-mini');
    const s = drawing(132, 92, 'g-reach');
    const R = 9, W = Math.sqrt(3) * R;
    for (let q = -3; q <= 3; q++) for (let r = -2; r <= 2; r++) {
      const d = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
      if (d > 3 || Math.abs(r) > 2) continue;
      const x = 66 + W * (q + r / 2), y = 46 + 1.5 * R * r;
      sv('polygon', { points: hexPts(x, y, R - 0.6), class: 'g-rh' + (d <= 2 ? ' in' : '') }, s);
    }
    iconAt(s, 'fac_generator', 66, 46, 18);
    iconAt(s, 'tw_cryo', 66 + W * 1.5, 46 - 13.5, 16);
    iconAt(s, 'tw_arc', 66 - W * 3, 46, 16, 'dark');
    pw.append(s, el('figcaption', '', 'power: 2 tiles'));
    g.append(pipe, pw);
    box.append(g);
  },
  cues(box) {
    const g = el('div', 'g-cues');
    const cue = (kind: 'ok' | 'missing' | 'route', cap: string) => {
      const f = el('figure', 'g-cue ' + kind), s = drawing(84, 74, 'g-cuesvg');
      if (kind === 'route') {
        iconAt(s, 'fac_arm', 16, 50, 22);
        sv('path', { d: 'M24 50C40 50 44 44 54 44', class: 'g-route' }, s);
        for (const [x, y, dx, dy] of [[52, 30, 1, 1], [80, 30, -1, 1], [52, 62, 1, -1], [80, 62, -1, -1]]) sv('path', { d: `M${x} ${y + dy * 7}V${y}H${x + dx * 7}`, class: 'g-brk' }, s);
        iconAt(s, 'tw_pulse', 66, 46, 26);
      } else {
        sv('ellipse', { cx: 42, cy: 58, rx: 28, ry: 9, class: 'g-cring ' + kind }, s);
        iconAt(s, 'tw_pulse', 42, 46, 30);
        if (kind === 'missing') iconAt(s, 'iron_ore', 42, 13, 18, 'g-holo');
      }
      f.append(s, el('figcaption', '', cap));
      return f;
    };
    g.append(cue('ok', iconLabel('st_ok')), cue('missing', 'Missing'), cue('route', 'Route'));
    box.append(g);
  },
  recipe(box) {
    const w = Math.max(220, Math.min(340, box.clientWidth - 28 || 300));
    const d = recipeDiagram({ tower: 'rail' }, { width: w, layout: 'auto', bare: true });
    const cap = el('div', 'g-reccap');
    cap.append(towerIcon('rail', { size: 18 }), el('span', '', TOWERS.rail.name));
    box.append(cap, d);
  },
  facs(box) {
    const g = el('div', 'g-facs');
    for (const f of FAC_TYPES) {
      const d = FACS[f], cid = FAC_CARD[f], locked = !!cid;
      const t = rtip(el('div', 'g-fac' + (locked ? ' locked' : '')), `fac:${f}`, `${d.name}. ${locked ? 'Unlocked by the ' + CARD_BY_ID[cid!].name + ' card.' : 'Open from the start.'}`);
      const im = el('div', 'g-facimg');
      im.append(still(`fac_${f}`, 64, ''));
      t.append(im, el('b', '', d.name));
      const c = el('div', 'g-cost');
      c.append(credits(d.cost));
      if (d.power) c.append(chip('power', d.power, { size: 14, title: 'Power' }));
      t.append(c, el('small', 'g-unl', locked ? CARD_BY_ID[cid!].name : 'start'));
      g.append(t);
    }
    box.append(g);
  },
  offer(box) {
    const g = el('div', 'g-offer');
    const pick = (c: Card | undefined, kind: string) => {
      if (!c) return;
      const m = el('div', 'g-mcard');
      m.style.setProperty('--rc', ['#e3dc92', '#f68b56', '#6fe0c8'][c.rar]);
      const k = cardIcon(c), ci = el('div', 'g-mci');
      if (k) ci.append(icon(k, { size: 30 })); else ci.append(el('i', 'g-glyph', c.icon));
      m.append(ci, el('small', 'g-mrar', RARITY[c.rar]), el('b', '', c.name.replace(/^Blueprint: /, '')), el('span', 'g-mkind', kind));
      m.setAttribute('role', 'img'); m.setAttribute('aria-label', `${kind} card: ${c.name}`);
      g.append(m);
    };
    pick(CARD_BY_ID.bp_cryo, 'Blueprint');
    pick(CARD_BY_ID.power, 'Production');
    pick(CARD_BY_ID.overclock, 'Upgrade');
    box.append(g);
  },
  needs(box) {
    // one card from the middle of the tree: the cards it needs, it, and the cards that need it
    const mid = CARD_BY_ID.press ?? CARDS.find((c) => (c.requires || []).length > 1);
    if (!mid) return;
    const before = (mid.requires || []).map((id) => CARD_BY_ID[id]).filter(Boolean);
    const after = CARDS.filter((c) => (c.requires || []).includes(mid.id));
    const r = el('div', 'g-tree');
    const col = (cs: Card[], cls = '') => { const c = el('div', 'g-tcol' + cls); for (const x of cs) c.append(plate(x)); return c; };
    r.append(col(before), el('span', 'g-join'), col([mid], ' mid'));
    if (after.length) r.append(el('span', 'g-join one'), col(after));
    r.setAttribute('role', 'img');
    r.setAttribute('aria-label', `${mid.name} needs ${before.map((c) => c.name).join(' and ')}${after.length ? `; ${after.map((c) => c.name).join(' and ')} needs ${mid.name}` : ''}`);
    box.append(r);
  },
  plan(box) {
    const f = el('div', 'g-shotbox');
    f.append(shot('shot-cards', 'The level-up screen with three cards'));
    const b = el('span', 'g-stamp');
    b.append(el('span', '', 'Paths'), kbd('4'));
    (b.lastElementChild as HTMLElement).classList.add('kbd-only');
    f.append(b);
    box.append(f);
  },
  keys(box) {
    const g = el('div', 'g-keys');
    const first = TOWERS[TOWER_TYPES[0]].key, last = TOWERS[TOWER_TYPES[TOWER_TYPES.length - 1]].key;
    type K = (string | ['mouse', 'l' | 'r' | 'm' | ''])[];
    const rows: [K, string][] = [
      [[['mouse', 'l']], 'Build, select'],
      [['Shift', ['mouse', 'l']], 'Keep building'],
      [[`${first}–${last}`, 'F'], 'Pick, Towers / Factory'],
      [['R'], 'Turn arm or belt'],
      [['U', 'X'], 'Upgrade, sell'],
      [['T'], 'Targeting mode'],
      [[['mouse', 'r'], 'Space'], 'Fire special'],
      [['W', 'A', 'S', 'D', ['mouse', 'r']], 'Pan (or right-drag)'],
      [[['mouse', 'm']], 'Wheel zooms'],
      [['Q', 'E', 'Home'], 'Turn view, reset'],
      [['V'], 'Show supply rings'],
      [['N'], 'Call the wave'],
      [['G'], 'Game speed'],
      [['P', 'Esc'], 'Pause'],
    ];
    for (const [ks, label] of rows) {
      const t = el('div', 'g-k'), caps = el('div', 'g-caps');
      for (const k of ks) caps.append(typeof k === 'string' ? kbd(k) : mouseGlyph(k[1]));
      t.append(caps, el('span', '', label));
      g.append(t);
    }
    box.append(g);
  },
  touch(box) {
    const g = el('div', 'g-keys g-touch');
    const rows: [Gesture, string, string][] = [
      ['tap2', 'Tap a hex, tap again', 'Build what the bar picked'],
      ['line', 'Hold the preview, drag', 'Lay belts, pipes, arms'],
      ['tap', 'Tap something built', 'Upgrade, sell, turn'],
      ['hold', 'Hold or double-tap', 'Fire a charged special'],
      ['drag', 'One finger', 'Pan'],
      ['pinch', 'Pinch', 'Zoom'],
      ['twist', 'Twist', 'Turn the view'],
    ];
    for (const [ge, how, what] of rows) {
      const t = el('div', 'g-k g-t');
      t.append(gestureGlyph(ge), el('span', '', what), el('small', '', how));
      g.append(t);
    }
    const n = el('p', 'g-note', 'Two fingers never build. The X chip, or a tap off the board, puts a picked building away.');
    box.append(g, n);
  },
};

// ---------------------------------------------------------------- the sheet

let built = false, spy: IntersectionObserver | null = null;
const TAB_ICONS: Record<string, () => SVGElement> = {
  goal: goalGlyph, waves: () => icon('time', { size: 20 }), towers: () => towerIcon('pulse', { size: 20 }),
  supply: () => facIcon('arm', { size: 20 }), cards: cardGlyph, controls: keyGlyph, icons: () => stateIcon('ok', { size: 20 }),
};
function setControls(which: 'keys' | 'touch') {
  const root = $('help');
  for (const b of root.querySelectorAll<HTMLButtonElement>('.g-segb')) b.setAttribute('aria-pressed', String(b.dataset.ctl === which));
  root.querySelector('[data-fig="keys"]')?.classList.toggle('hidden', which !== 'keys');
  root.querySelector('[data-fig="touch"]')?.classList.toggle('hidden', which !== 'touch');
}
function setTab(id: string) {
  for (const a of $('help').querySelectorAll<HTMLAnchorElement>('.g-tab')) {
    if (a.hash === '#' + id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  }
}
function build() {
  const root = $('help');
  for (const box of root.querySelectorAll<HTMLElement>('[data-fig]')) {
    const f = FIGS[box.dataset.fig || ''];
    if (f && !box.dataset.done) { box.dataset.done = '1'; f(box); }
  }
  const lg = root.querySelector<HTMLElement>('[data-legend]');
  if (lg) lg.append(buildLegend({ open: ['res'] }));
  for (const a of root.querySelectorAll<HTMLAnchorElement>('.g-tab')) {
    const mk = TAB_ICONS[a.dataset.ic || ''];
    if (mk) a.prepend(mk());
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const sec = document.getElementById(a.hash.slice(1));
      if (!sec) return;
      sec.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      setTab(sec.id);
      const h = sec.querySelector<HTMLElement>('.g-h');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    });
  }
  const x = $('h-close');
  const xs = drawing(24, 24, 'ic');
  xs.setAttribute('width', '18'); xs.setAttribute('height', '18');
  sv('path', { d: 'M5 5L19 19M19 5L5 19', class: 'g-gl-x' }, xs);
  x.append(xs);
  x.addEventListener('click', () => $('h-back').click());
  for (const b of root.querySelectorAll<HTMLButtonElement>('.g-segb')) b.addEventListener('click', () => setControls(b.dataset.ctl === 'touch' ? 'touch' : 'keys'));
  // the tab of the section that fills the upper part of the sheet is lit
  spy = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) setTab(e.target.id);
  }, { root, rootMargin: '-20% 0px -70% 0px' });
  for (const s of root.querySelectorAll('.g-sec')) spy.observe(s);
}
/** Called each time the sheet opens (play.ts, buildHelp). */
export function buildGuide() {
  if (!built) { built = true; build(); }
  $('help').scrollTop = 0;
  setTab('g-goal');
  setControls(document.body.classList.contains('touch') ? 'touch' : 'keys');
}


// ---------------------------------------------------------------- the legend: every icon and symbol met in play
// One component, in three places: beside the pause menu (a bottom-to-top sheet behind a Legend button on a phone), as a
// compact panel from the HUD's "?" button or the L key (it does not pause: between waves time stands still anyway, and
// during a wave a glance should not stop the fight; on a phone it is a bottom sheet over the lower part of the board),
// and as the last section of How to play. Every row is the icon as the game draws it, its name as text and a short
// meaning; a resource, building, tower or deposit row opens its recipe like any icon in the game ([data-rt], play.ts).

/** What play.ts lends the legend: the enemy silhouettes of the wave tags (drawn there). */
export interface LegendDeps { enemyIcon?: (t: EnemyType) => SVGElement }
let deps: LegendDeps = {};
type Res = ItemType | FluidType | 'mats' | 'credits' | 'power';
const RES_WHAT: Record<Res, string> = {
  iron_ore: 'Pulse ammo, smelts to plate', copper_ore: 'Smelts to copper plate', coal: 'Fuel: generator, smelter, press',
  iron: 'For shells, works, missiles', copper: 'Railgun ammo, for cells', shell: 'Mortar ammo (Pulse Mk3)',
  cell: 'Lance and Well ammo', missile: 'Missile Battery ammo', crude: 'Firewall fuel, for cells', petrol: 'For missiles (Firewall Mk3)',
  mats: 'Heavier towers and upgrades', credits: 'Pays for building', power: 'Grid power, 2 tiles round',
};
const FAC_WHAT: Record<FacType, string> = {
  arm: 'Moves items behind to front', belt: 'Carries items along', splitter: 'Deals belts out in turn', tunnel: 'Belt under 4 tiles',
  mine: 'Digs ore or coal', generator: 'Burns coal for power', pole: 'Carries power on', pump: 'Pumps crude oil',
  pipe: 'Carries oil or petrol', ptunnel: 'Pipe under 4 tiles', smelter: 'Ore into plates', works: 'Plates into materials',
  press: 'Makes plasma shells', cells: 'Makes energy cells', refinery: 'Crude into petrol', missiles: 'Makes missile packs',
  crate: 'Feeds the towers beside it',
};
const TOWER_WHAT: Record<TowerType, string> = {
  pulse: 'Fast homing bolts', cryo: 'Chills and slows a group', arc: 'Lightning that chains', mortar: 'Long-range blast, not flyers',
  rail: 'Piercing heavy shot', beacon: 'Boosts towers nearby', flame: 'Fire wall between two', lance: 'Beam that heats up',
  missile: 'Homing salvos', gravity: 'Drags enemies back',
};
const AIM_WHAT: Record<TargetMode, string> = {
  first: 'Closest to the core', last: 'Furthest from the core', strong: 'Most health left', weak: 'Least health left',
  fast: 'Quickest mover', slow: 'Slowest mover',
};
const ENEMY_WHAT: Record<EnemyType, string> = {
  grunt: 'Plain walker', runner: 'Fast and fragile', drone: 'Flies: mortars miss it', shield: 'Shield soaks hits',
  brute: 'Armoured and heavy', boss: 'Boss, every 5th wave', wheel: 'Spinning rim turns hits', brood: 'Lets mites loose',
  mite: 'Climbs and jams a tower', titan: 'Finale: stuns all towers',
};
interface Row { ic: () => Element; name: string; what: string; rt?: string }
interface Group { id: string; name: string; rows: () => Row[] }
/** A small drawing for a symbol that is not in the icon set (the in-world cues, the tutorial marks). */
function glyph(kind: 'route' | 'jam' | 'stun' | 'up' | 'here' | 'path' | 'gate' | 'heart') {
  if (kind === 'heart') { const c = coreGlyph(22); c.setAttribute('class', 'g-core lg-gl'); return c; }
  const s = drawing(24, 24, 'lg-gl lg-' + kind);
  const p = (d: string, cls = '') => sv('path', { d, class: cls }, s);
  if (kind === 'route') { p('M3 17C9 17 11 9 19 9', 'lg-dash'); p('M15.5 5.5L19.5 9L15.5 12.5', 'lg-ln'); }
  if (kind === 'jam') { sv('ellipse', { cx: 12, cy: 16, rx: 10, ry: 4.5, class: 'lg-dash' }, s); p('M12 4.5a2.5 2.5 0 1 0 0.01 0M6 4l3.5 1.6M18 4l-3.5 1.6M6 9.6l3.5-1.6M18 9.6l-3.5-1.6', 'lg-ln'); }
  if (kind === 'stun') { sv('ellipse', { cx: 12, cy: 16, rx: 10, ry: 4.5, class: 'lg-ln' }, s); p('M13 2L8.5 9.5H12L10.5 14L16 6.5H12.5Z', 'lg-fill'); }
  if (kind === 'up') { p('M6 12L12 6L18 12M6 18L12 12L18 18', 'lg-ln'); }
  if (kind === 'here') { sv('polygon', { points: hexPts(12, 17, 6.5), class: 'lg-hexo' }, s); p('M12 2V11M8 7.5L12 11.5L16 7.5', 'lg-ln'); }
  if (kind === 'path') { sv('polygon', { points: hexPts(12, 12, 10), class: 'lg-hexo' }, s); p('M8 8L13 12L8 16M12 8L17 12L12 16', 'lg-ln'); }
  if (kind === 'gate') { p('M3 22V9L12 3L21 9V22H17V12H7V22Z', 'lg-gate'); }
  return s;
}
/** A piece of the HUD as it looks there: a copy of its own drawing when it has one, else its chip text. */
function hudBit(id: string, text = '') {
  const w = el('span', 'lg-hud ' + id), src = document.querySelector(`#${id} svg`);
  if (src) w.append(src.cloneNode(true)); else w.textContent = text;
  return w;
}
const GROUPS: Group[] = [
  { id: 'res', name: 'Resources', rows: () => [
    ...ITEM_TYPES.map((t): Row => ({ ic: () => icon(t, { size: 22 }), name: iconLabel(t), what: RES_WHAT[t], rt: 'item:' + t })),
    ...FLUID_TYPES.map((t): Row => ({ ic: () => icon(t, { size: 22 }), name: iconLabel(t), what: RES_WHAT[t], rt: 'fluid:' + t })),
    { ic: () => icon('mats', { size: 22 }), name: iconLabel('mats'), what: RES_WHAT.mats, rt: 'res:mats' },
    { ic: () => icon('power', { size: 22 }), name: iconLabel('power'), what: RES_WHAT.power, rt: 'res:power' },
    { ic: () => icon('credits', { size: 22 }), name: iconLabel('credits'), what: RES_WHAT.credits },
  ] },
  { id: 'cues', name: 'Supply cues', rows: () => [
    { ic: () => stateIcon('ok', { size: 22 }), name: 'Green ring', what: 'Supplied when the wave starts' },
    { ic: () => stateIcon('missing', { size: 22 }), name: 'Broken rust ring', what: 'Missing an input (hologram: which)' },
    { ic: () => stateIcon('notaker', { size: 22 }), name: 'Amber chevrons', what: 'Nothing takes its output' },
    { ic: () => glyph('route'), name: 'Route pulse', what: 'Where a new piece hands on' },
    { ic: () => icon('power', { size: 22 }), name: 'Power bolt', what: 'Needs or has power' },
    { ic: () => stateIcon('locked', { size: 22 }), name: 'Lock, hatching', what: 'Needs its card first' },
    { ic: () => glyph('up'), name: 'Chevrons up', what: 'An upgrade you can pay' },
    { ic: () => glyph('jam'), name: 'Violet ring', what: 'Jammed by mites: hit them' },
    { ic: () => glyph('stun'), name: 'Blue ring, bolt', what: 'Stunned by the Titan' },
  ] },
  { id: 'facs', name: 'Buildings', rows: () => ([...FAC_TYPES, 'crate'] as FacType[]).map((f): Row => ({ ic: () => facIcon(f, { size: 22 }), name: FACS[f].name, what: FAC_WHAT[f], rt: 'fac:' + f })) },
  { id: 'towers', name: 'Towers', rows: () => towersByTier().map((t): Row => ({ ic: () => towerIcon(t, { size: 22 }), name: TOWERS[t].name, what: TOWER_WHAT[t], rt: 'tower:' + t })) },
  { id: 'aim', name: 'Targeting modes', rows: () => TARGET_MODES.map((m): Row => ({ ic: () => aimIcon(m, { size: 22 }), name: TARGET_INFO[m].name, what: AIM_WHAT[m] })) },
  { id: 'enemies', name: 'Wave intel', rows: () => {
    const mk = deps.enemyIcon;
    if (!mk) return [];
    const en = (t: EnemyType) => () => { const w = el('span', t === 'boss' || t === 'titan' ? 'en boss' : 'en'); w.append(mk(t)); return w; };
    return [
      ...ENEMY_TYPES.map((t): Row => ({ ic: en(t), name: ENEMIES[t].name, what: ENEMY_WHAT[t] })),
      { ic: () => { const w = el('span', 'lg-tag'); w.append(el('span', 'iw', 'W5')); return w; }, name: 'Gate tag', what: 'The next wave on this road' },
    ];
  } },
  { id: 'hud', name: 'HUD', rows: () => [
    { ic: () => icon('time', { size: 22 }), name: 'Clock', what: 'Time stands still: build' },
    { ic: () => hudBit('wave-warn'), name: 'Rust ring count', what: 'Will lack supply: show next' },
    { ic: () => hudBit('btn-rings'), name: 'Hexagon', what: 'Keep the green rings on' },
    { ic: () => hudBit('btn-speed', '2x'), name: 'Speed', what: 'Normal or double speed' },
    { ic: () => el('span', 'lg-hud chipt', 'Auto'), name: 'Auto waves', what: 'Next wave calls itself' },
    { ic: () => hudBit('btn-pause', 'II'), name: 'Pause', what: 'Hold the game' },
  ] },
  { id: 'map', name: 'On the map', rows: () => [
    ...ORE_TYPES.map((o): Row => ({ ic: () => icon(`dep_${o}`, { size: 22 }), name: ORES[o].name, what: o === 'oil' ? 'Put a Pumpjack on it' : 'Put a Mine on it', rt: 'ore:' + o })),
    { ic: () => glyph('heart'), name: 'Heart', what: 'Your core: guard it' },
    { ic: () => glyph('gate'), name: 'Spawn gate', what: 'Where machines come in' },
    { ic: () => glyph('here'), name: 'Tutorial arrow', what: 'Build on this hex' },
    { ic: () => glyph('path'), name: 'Tutorial chevron', what: 'Lay it this way' },
  ] },
];
const LG_KEY = 'beatspire.legend';
function loadOpen(): string[] | null {
  try { const v = JSON.parse(localStorage.getItem(LG_KEY) || 'null'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null; } catch { return null; }
}
function saveOpen(root: HTMLElement) {
  const ids = [...root.querySelectorAll<HTMLDetailsElement>('details.lg-g')].filter((d) => d.open).map((d) => d.dataset.g || '');
  try { localStorage.setItem(LG_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}
export interface LegendOpts {
  /** the groups open at first; 'stored': the ones the player last had open (kept in localStorage), falling back to `fallback` */
  open?: string[] | 'stored';
  fallback?: string[];
  /** remember which groups are open */
  remember?: boolean;
}
/** The legend: one collapsible group per kind of symbol, each row an icon, its name and its meaning. */
export function buildLegend(o: LegendOpts = {}): HTMLElement {
  const root = el('div', 'lg');
  const open = new Set(o.open === 'stored' ? loadOpen() ?? o.fallback ?? [] : o.open ?? []);
  for (const g of GROUPS) {
    const rows = g.rows();
    if (!rows.length) continue;
    const d = el('details', 'lg-g');
    d.dataset.g = g.id; d.open = open.has(g.id);
    const sm = el('summary'), peek = el('span', 'lg-peek');
    peek.setAttribute('aria-hidden', 'true');
    for (const r of rows.slice(0, 4)) peek.append(r.ic());
    sm.append(el('b', '', g.name), el('small', '', String(rows.length)), peek);
    const list = el('ul', 'lg-rows');
    for (const r of rows) {
      const li = el('li', 'lg-row'), i = el('span', 'lg-ic');
      i.append(r.ic());
      li.append(i, el('b', '', r.name), el('span', 'lg-what', r.what));
      if (r.rt) rtip(li, r.rt, `${r.name}: ${r.what}`);
      list.append(li);
    }
    d.append(sm, list);
    if (o.remember) d.addEventListener('toggle', () => saveOpen(root));
    root.append(d);
  }
  return root;
}

// ---- the places it is shown
const narrow = () => matchMedia('(max-width: 900px), (max-height: 480px)').matches;
let pop: HTMLElement | null = null, sheet: HTMLElement | null = null;
function closeX(label: string, fn: () => void) {
  const b = el('button', 'g-x lg-x');
  b.type = 'button'; b.setAttribute('aria-label', label);
  const xs = drawing(24, 24, 'ic');
  xs.setAttribute('width', '18'); xs.setAttribute('height', '18');
  sv('path', { d: 'M5 5L19 19M19 5L5 19', class: 'g-gl-x' }, xs);
  b.append(xs);
  b.addEventListener('click', fn);
  return b;
}
/** The HUD panel (desktop) or bottom sheet (phone): it does not pause the game. */
export function toggleLegend(on = !pop) {
  const btn = document.getElementById('btn-legend');
  if (!on) { pop?.remove(); pop = null; btn?.setAttribute('aria-expanded', 'false'); return; }
  if (pop) return;
  pop = el('div', 'lg-pop' + (narrow() ? ' sheet-b' : ''));
  pop.id = 'lg-pop';
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Legend');
  const head = el('div', 'lg-head');
  head.append(el('span', 'kicker', 'Legend'), closeX('Close the legend', () => toggleLegend(false)));
  pop.append(head, buildLegend({ open: 'stored', fallback: ['cues'], remember: true }));
  document.body.append(pop);
  btn?.setAttribute('aria-expanded', 'true');
  if (!document.body.classList.contains('touch')) (pop.querySelector('summary') as HTMLElement | null)?.focus({ preventScroll: true });
}
/** The full-height legend over the pause screen on a phone. */
function openSheet(on: boolean) {
  if (!on) { sheet?.remove(); sheet = null; document.getElementById('p-legend')?.focus(); return; }
  if (sheet) return;
  sheet = el('div', 'overlay lg-sheet');
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Legend');
  const inner = el('div', 'sheet narrow'), head = el('header', 'sheet-head lg-shead');
  const t = el('div');
  t.append(el('span', 'kicker', 'Field manual'), el('h2', '', 'Legend'));
  head.append(t, closeX('Close the legend', () => openSheet(false)));
  inner.append(head, buildLegend({ open: [] }));
  sheet.append(inner);
  document.body.append(sheet);
  if (!document.body.classList.contains('touch')) (sheet.querySelector('summary') as HTMLElement | null)?.focus({ preventScroll: true });
}
/** Once, from play.ts: wire the HUD button, the L key, the pause screen's panel and its Legend button. */
export function initLegend(d: LegendDeps) {
  deps = d;
  document.getElementById('btn-legend')?.addEventListener('click', () => toggleLegend());
  document.getElementById('p-legend')?.addEventListener('click', () => openSheet(true));
  // the pause screen: the panel beside the menu is filled when it first shows; the HUD panel goes when the game pauses
  const pause = document.getElementById('pause'), side = document.getElementById('p-legend-panel');
  if (pause) new MutationObserver(() => {
    const shown = !pause.classList.contains('hidden');
    if (shown) { toggleLegend(false); if (side && !side.firstChild) side.append(el('span', 'kicker', 'Legend'), buildLegend({ open: 'stored', fallback: ['cues', 'res'], remember: true })); }
    else openSheet(false);
  }).observe(pause, { attributes: true, attributeFilter: ['class'] });
  // L opens and shuts the HUD panel in a run; Escape shuts a legend before the game sees the key (so it does not pause)
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (e.key === 'Escape' && (sheet || pop)) { e.preventDefault(); e.stopPropagation(); if (sheet) openSheet(false); else { toggleLegend(false); document.getElementById('btn-legend')?.focus(); } return; }
    if (e.key.toLowerCase() !== 'l' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const btn = document.getElementById('btn-legend');
    if (pop) { toggleLegend(false); return; }
    if (btn && btn.offsetParent && !document.querySelector('.overlay:not(.hidden)')) toggleLegend(true);
  }, { capture: true });
  // a press outside the HUD panel shuts it (the board stays usable underneath)
  document.addEventListener('pointerdown', (e) => {
    if (!pop || !(e.target instanceof Node)) return;
    if (pop.contains(e.target) || document.getElementById('btn-legend')?.contains(e.target) || document.getElementById('rtip')?.contains(e.target)) return;
    toggleLegend(false);
  }, { capture: true });
}
