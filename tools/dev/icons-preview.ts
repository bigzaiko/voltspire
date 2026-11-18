// Dev preview of the icon set: /tools/dev/icons.html on the dev server (not built, not published).
//   ?v=sheet (default) every icon at 14 / 18 / 24 / 40 px, ?labels=0 without names
//   ?v=chips           chips and tones
//   ?v=diagrams        the recipe diagram of every item, fluid, tower (and Mk3) and building; &w=328 for a narrow tooltip, &only=tower|item|fac
import { icon, chip, recipeDiagram, iconLabel, ICON_GROUPS, ICON_NAMES, chainOf } from '../../src/icons.ts';
import type { IconName, ChainTarget } from '../../src/icons.ts';
import { ITEM_TYPES, FLUID_TYPES, TOWER_TYPES, FAC_TYPES, TOWER_NEEDS_L3, ITEMS, FLUIDS, TOWERS, FACS } from '../../src/game/data.ts';
import type { TowerType } from '../../src/game/data.ts';

const q = new URLSearchParams(location.search), view = q.get('v') || 'sheet', labels = q.get('labels') !== '0';
const root = document.getElementById('icp')!;
const el = (tag: string, cls = '', parent: Element = root, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; parent.appendChild(e); return e; };

if (view === 'sheet') {
  for (const g of ICON_GROUPS) {
    const box = el('section', 'icp-group');
    if (labels) el('h3', '', box, g.name);
    const grid = el('div', 'icp-grid', box);
    grid.style.setProperty('--cols', String(Math.min(g.icons.length, q.get('cols') ? +q.get('cols')! : 8)));
    for (const n of g.icons) {
      const cell = el('div', 'icp-cell', grid), sizes = el('div', 'icp-sizes', cell);
      for (const s of [14, 18, 24, 40]) sizes.appendChild(icon(n, { size: s, title: iconLabel(n) }));
      if (labels) el('small', '', cell, n);
    }
  }
  (window as unknown as { __icons: number }).__icons = ICON_NAMES.length;
} else if (view === 'chips') {
  const box = el('section', 'icp-group');
  el('h3', '', box, 'Chips');
  const row = el('div', 'icp-row', box);
  row.append(chip('iron', '×2', { title: 'Iron plate' }), chip('shell', '4/s'), chip('power', 4, { state: 'ok' }), chip('cell', '0/1', { state: 'missing' }), chip('crude', '', { state: 'dim' }),
    chip('credits', 140), chip('mats', 4), chip('time', '5 s'), chip('petrol', '10', { state: 'plain' }), chip('missile', '×1', { tag: 'button', title: 'Missile pack' }), chip('st_locked'));
  const tones = el('section', 'icp-group');
  el('h3', '', tones, 'Tones: full, mono, dim; mono on a pressed (sand) chip');
  for (const tone of ['full', 'mono', 'dim'] as const) {
    const r = el('div', 'icp-row', tones);
    for (const n of ['iron_ore', 'copper', 'coal', 'cell', 'missile', 'crude', 'power', 'fac_smelter', 'fac_pump', 'tw_rail', 'tw_gravity', 'aim_first', 'aim_weak', 'st_missing'] as IconName[]) r.appendChild(icon(n, { size: 24, tone }));
  }
  const light = el('div', 'icp-light', tones);
  for (const n of ['aim_first', 'aim_last', 'aim_strong', 'aim_weak', 'aim_fast', 'aim_slow', 'cell', 'fac_belt', 'fac_generator'] as IconName[]) light.appendChild(icon(n, { size: 24, tone: 'mono' }));
  for (const n of ['aim_first', 'aim_slow', 'cell', 'coal', 'fac_cells'] as IconName[]) light.appendChild(icon(n, { size: 24 }));
} else {
  const w = +(q.get('w') || 420), only = q.get('only');
  if (w < 400) document.body.classList.add('icp-narrow');
  const tips = el('div', 'icp-tips');
  tips.style.setProperty('--cols', q.get('cols') || '3');
  const inner = w < 400 ? w - 26 : 390;
  const add = (name: string, t: ChainTarget, lvl = 1) => {
    if (!chainOf(t, lvl)) return;
    const tip = el('div', 'icp-tip', tips);
    el('b', '', tip, name);
    tip.appendChild(recipeDiagram(t, { width: inner, lvl }));
  };
  if (!only || only === 'item') {
    for (const i of ITEM_TYPES) add(ITEMS[i].name, { item: i });
    add('Building materials', { res: 'mats' });
    for (const f of FLUID_TYPES) add(FLUIDS[f].name, { fluid: f });
    add('Power', { res: 'power' });
  }
  if (!only || only === 'tower') {
    for (const t of TOWER_TYPES) add(TOWERS[t].name, { tower: t });
    for (const t of Object.keys(TOWER_NEEDS_L3) as TowerType[]) add(TOWERS[t].name + ' Mk3', { tower: t }, 3);
  }
  if (only === 'fac') for (const f of FAC_TYPES) add(FACS[f].name, { fac: f });
}
(window as unknown as { __ready: boolean }).__ready = true;
