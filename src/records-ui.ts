// BEATSPIRE records UI: the Records and Achievements screens, the "continue or start over?" dialog, the main menu's Continue
// card, the in-game unlock slide-in, the HUD's "saved" tick and the end screen's badges. Built node by node (no innerHTML;
// style values only through classes and setProperty, for the page's CSP). The data comes from career.ts (no DOM there);
// play.ts wires it to the run. Styles: records-ui.css.
import type { Career } from './game/career.ts';
import type { AchDef, AchView, AchTier } from './game/achievements.ts';
import { achImage, ACHIEVEMENTS } from './game/achievements.ts';
import type { RunRecord, MapBest, RunMode } from './game/records.ts';
import type { SaveMeta } from './game/saves.ts';
import type { MapDef } from './game/map.ts';
import { diffById } from './game/map.ts';
import { drawMap } from './game/mapdraw.ts';
import { TOWERS, TOWER_TYPES, FACS, CARD_BY_ID } from './game/data.ts';
import type { TowerType, FacType } from './game/data.ts';
import { icon as ic } from './icons.ts';
import type { IconName } from './icons.ts';

export interface RecordsDeps {
  career: Career;
  /** the map a record or save key names (premade, generated or custom), or null when it is gone */
  mapOf(key: string): MapDef | null;
  /** what a card is about, as icons (play.ts cardIcons) */
  cardIcons(id: string): IconName[];
  sound(name: string, gain?: number): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
};
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, at: Record<string, string | number>, parent?: Element): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(at)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}
/** A one-path glyph (16 x 16), drawn in currentColor. */
function glyph(d: string, cls = 'gl'): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 16 16', class: cls, 'aria-hidden': 'true' }) as SVGSVGElement;
  svg('path', { d, 'fill-rule': 'evenodd' }, s);
  return s;
}
const G = {
  heart: 'M8 14.2 2.2 8.6A3.4 3.4 0 0 1 8 4a3.4 3.4 0 0 1 5.8 4.6z',
  wave: 'M1 9.5c2-3 3.5-3 5 0s3 3 5 0 3-3 4-1.5V11c-1-1.5-2-1.5-4 1.5s-3.5 3-5 0-3-3-5 0z',
  clock: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 2a5 5 0 1 0 0 10A5 5 0 0 0 8 3zm-.9 1.6h1.8v3l2.2 1.8-1.1 1.4-2.9-2.3z',
  skull: 'M8 1.5c3.4 0 6 2.4 6 5.6 0 1.9-.9 3.2-2.2 4V14H4.2v-2.9C2.9 10.3 2 9 2 7.1 2 3.9 4.6 1.5 8 1.5zM5.4 6.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5.2 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  play: 'M4 2.2 13.5 8 4 13.8z',
  tick: 'M2 8.6 3.6 7l2.9 2.9L12.4 4 14 5.6l-7.5 7.5z',
  back: 'M10.6 2 12 3.4 7.4 8l4.6 4.6-1.4 1.4-6-6z',
  medal: 'M8 1.2l2 4.3 4.7.6-3.4 3.2.9 4.7L8 11.7 3.8 14l.9-4.7L1.3 6.1 6 5.5z',
  cup: 'M3 1.5h10v1.8h2V6a3 3 0 0 1-2.6 3A4.5 4.5 0 0 1 9 11.7V13h2.5v1.8h-7V13H7v-1.3A4.5 4.5 0 0 1 3.6 9 3 3 0 0 1 1 6V3.3h2zM2.6 4.9V6c0 .6.3 1 .7 1.2V4.9zm10.1 0v2.3c.4-.2.7-.6.7-1.2V4.9z',
  flag: 'M3 1h1.8v1H13l-2 3.5L13 9H4.8v6H3z',
  lock: 'M5 6.5V5a3 3 0 0 1 6 0v1.5h1.5V15h-9V6.5zm1.8 0h2.4V5a1.2 1.2 0 0 0-2.4 0z',
};

const nf = new Intl.NumberFormat('en-US');
const big = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : nf.format(Math.round(n)));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hours = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : `${Math.floor(s / 60)}m`);
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
/** Generated maps are called "Sector K-17 Ashfall": the place name is the title. */
const shortName = (n: string) => /^Sector [A-Z]-\d+ (.+)$/.exec(n)?.[1] || n;
const diffName = (id: string) => diffById(id).name;
const TIERS: AchTier[] = ['bronze', 'silver', 'gold'];

/** The medal of a map best: a win with a full core is gold, a win silver, a run that got anywhere bronze. */
function bestMedal(b: MapBest, mode: RunMode, flawless: boolean): AchTier | '' {
  if (mode === 'survival') return b.bestWave >= 25 ? 'gold' : b.bestWave >= 12 ? 'silver' : b.bestWave > 0 ? 'bronze' : '';
  if (b.wins) return flawless ? 'gold' : 'silver';
  return b.bestWave > 0 ? 'bronze' : '';
}

export function initRecordsUi(d: RecordsDeps) {
  const career = d.career;
  // The continue dialog is modal (it stands over the setup sheet): Tab and Shift+Tab stay inside it. (Esc: play.ts escBack.)
  $('cont').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...$('cont').querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.closest('.hidden') && !b.disabled);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLButtonElement), n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i >= f.length - 1 ? 0 : i + 1);
    e.preventDefault(); f[n].focus();
  });
  // ---------- map thumbnails: drawn once per map, copied for each use ----------
  const thumbs = new Map<string, HTMLCanvasElement | null>();
  function thumb(key: string, cls = 'mthumb'): HTMLElement {
    let src = thumbs.get(key);
    if (src === undefined) {
      src = null;
      const def = d.mapOf(key);
      if (def) { src = document.createElement('canvas'); src.width = 208; src.height = 144; try { drawMap(src, def); } catch { src = null; } }
      thumbs.set(key, src);
    }
    if (!src) { const n = el('span', cls + ' none'); n.append(glyph(G.flag)); return n; }
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.className = cls;
    c.getContext('2d')?.drawImage(src, 0, 0);
    return c;
  }
  const img = (src: string, cls: string, alt = '') => { const i = el('img', cls); i.src = src; i.alt = alt; i.decoding = 'async'; i.draggable = false; return i; };
  const towerImg = (t: string) => img(`./media/sm/tower_${t}.jpg`, 'rimg', Object.hasOwn(TOWERS, t) ? TOWERS[t as TowerType].name : t);
  const back = (id: string, fn: () => void) => {
    const b = el('button', 'chip rback'); b.type = 'button'; b.id = id; b.title = 'Back (Esc)'; b.setAttribute('aria-label', 'Back');
    b.append(glyph(G.back)); b.addEventListener('click', () => { d.sound('click'); fn(); });
    return b;
  };
  const head = (kicker: string, title: string, ...right: HTMLElement[]) => {
    const h = el('header', 'sheet-head rhead');
    const t = el('div', 'rtitle'); t.append(el('span', 'kicker', kicker), el('h2', '', title));
    const r = el('div', 'rright'); r.append(...right);
    h.append(t, r);
    return h;
  };

  // ---------- medals ----------
  const HEX = '50,3 93,27.5 93,72.5 50,97 7,72.5 7,27.5';
  /** One achievement badge in its hex medal: the art, a frame in its tier, a progress ring while it is counting. */
  function medal(a: AchDef, o: { unlocked: boolean; cur?: number; goal?: number; size?: 'sm' | 'md' | 'lg' } = { unlocked: true }): HTMLElement {
    const secret = !o.unlocked && a.hidden;
    const m = el('span', `medal ${o.size || 'md'} t-${a.tier}${o.unlocked ? ' won' : ' locked'}${secret ? ' secret' : ''}`);
    const ring = svg('svg', { viewBox: '0 0 100 100', class: 'ring', 'aria-hidden': 'true' }, m);
    svg('polygon', { points: HEX, class: 'rb', pathLength: 100 }, ring);
    const goal = o.goal || 1, cur = o.cur || 0;
    if (!o.unlocked && goal > 1 && cur > 0) {
      const p = Math.max(2, Math.min(100, (cur / goal) * 100));
      svg('polygon', { points: HEX, class: 'rf', pathLength: 100, 'stroke-dasharray': `${p.toFixed(1)} 100` }, ring);
    }
    const hx = el('span', 'hx');
    if (secret) hx.append(el('b', 'q', '?'));
    else hx.append(img(achImage(a), 'ai'));
    m.append(hx);
    if (a.icon && !secret) { const c = el('span', 'mic'); c.append(ic(a.icon, { size: o.size === 'sm' ? 11 : 14 })); m.append(c); }
    if (!o.unlocked && !secret) { const l = el('span', 'mlock'); l.append(glyph(G.lock)); m.append(l); }
    return m;
  }
  const tierCounts = (list: AchView[]) => TIERS.map((t) => {
    const all = list.filter((v) => v.def.tier === t);
    const c = el('span', `tcount t-${t}`); c.title = `${t[0].toUpperCase() + t.slice(1)}: ${all.filter((v) => v.unlocked).length} of ${all.length}`;
    c.append(el('i', 'pip'), el('b', '', String(all.filter((v) => v.unlocked).length)), el('small', '', '/' + all.length));
    return c;
  });

  // ---------- Achievements screen ----------
  let achFilter: 'all' | 'won' | 'locked' = 'all';
  function openAchievements(onBack: () => void) {
    const root = $('achs'); root.textContent = '';
    const list = career.achievements.list(), got = list.filter((v) => v.unlocked).length;
    const sheet = el('div', 'sheet wide rsheet');
    const counts = el('div', 'tcounts'); counts.append(...tierCounts(list));
    const close = () => { root.classList.add('hidden'); onBack(); };
    sheet.append(head('Commendations', 'Achievements', counts, back('ach-back', close)));
    // the overall bar
    const bar = el('div', 'achbar'), fill = el('i');
    fill.style.setProperty('--p', String(got / Math.max(1, list.length)));
    bar.append(fill, el('b', '', `${got} / ${list.length}`));
    const seg = el('div', 'seg achf');
    for (const [v, label, n] of [['all', 'All', list.length], ['won', 'Unlocked', got], ['locked', 'Locked', list.length - got]] as const) {
      const b = el('button', 'chip' + (achFilter === v ? ' on' : '')); b.type = 'button'; b.dataset.v = v;
      b.append(el('span', '', label), el('small', '', String(n)));
      b.addEventListener('click', () => { d.sound('click'); achFilter = v; for (const c of seg.children) c.classList.toggle('on', (c as HTMLElement).dataset.v === v); filter(); });
      seg.append(b);
    }
    const tools = el('div', 'achtools'); tools.append(seg, bar);
    const grid = el('div', 'achgrid');
    for (const v of list) {
      const a = v.def, secret = !v.unlocked && a.hidden;
      const b = el('button', `ach t-${a.tier}${v.unlocked ? ' won' : ' locked'}`); b.type = 'button'; b.dataset.won = v.unlocked ? '1' : '0';
      b.append(medal(a, { unlocked: v.unlocked, cur: v.cur, goal: v.goal }));
      const txt = el('span', 'at');
      txt.append(el('b', '', secret ? '???' : a.name), el('small', '', secret ? 'Hidden until earned.' : a.desc));
      if (!v.unlocked && v.goal > 1 && !secret) txt.append(el('em', 'prog', `${big(v.cur)} / ${big(v.goal)}`));
      if (v.unlocked && v.at > 1) txt.append(el('em', 'when', ago(v.at)));
      b.append(txt);
      b.setAttribute('aria-label', `${secret ? 'Hidden achievement' : a.name + '. ' + a.desc} ${a.tier}. ${v.unlocked ? 'Unlocked.' : v.goal > 1 ? `${v.cur} of ${v.goal}.` : 'Locked.'}`);
      b.addEventListener('click', () => { d.sound('click'); const was = b.classList.contains('open'); for (const c of grid.children) c.classList.remove('open'); b.classList.toggle('open', !was); });
      grid.append(b);
    }
    const filter = () => { for (const c of grid.children) { const w = (c as HTMLElement).dataset.won === '1'; c.classList.toggle('hidden', achFilter === 'won' ? !w : achFilter === 'locked' ? w : false); } };
    filter();
    sheet.append(tools, grid);
    root.append(sheet);
    root.classList.remove('hidden');
    root.scrollTop = 0;
    $('ach-back').focus({ preventScroll: true }); // (the menu button that opened it is hidden now: keyboard focus comes here)
  }

  // ---------- Records screen ----------
  function tile(art: Element, n: string, label: string, sub = '', hot = false): HTMLElement {
    const t = el('div', 'tile' + (hot ? ' hot' : ''));
    const a = el('span', 'tart'); a.append(art);
    const tx = el('span', 'tx'); tx.append(el('b', '', n), el('span', '', label));
    if (sub) tx.append(el('small', '', sub));
    t.append(a, tx);
    return t;
  }
  const art = (src: string) => img(src, 'timg');
  const icArt = (n: IconName) => ic(n, { size: 30 });
  const glArt = (p: string) => glyph(p, 'gl tgl');

  function runRow(r: RunRecord): HTMLElement {
    const row = el('div', `run r-${r.result}`);
    const top = el('button', 'rtop'); top.type = 'button';
    top.setAttribute('aria-expanded', 'false');
    const res = el('span', `res ${r.result}`, r.result === 'win' ? 'Win' : r.result === 'loss' ? 'Loss' : 'Quit');
    const nm = el('span', 'rname'); nm.append(el('b', '', shortName(r.mapName)), el('small', '', `${r.mode === 'survival' ? 'Survival' : diffName(r.diff)}`));
    const wv = el('span', 'rwave'); wv.append(glyph(G.wave), el('b', '', r.mode === 'survival' ? String(r.wave) : `${r.wave}/${r.waves}`));
    const tm = el('span', 'rtime'); tm.append(glyph(G.clock), el('span', '', clock(r.time)));
    const dt = el('span', 'rdate', ago(r.endedAt));
    top.append(thumb(r.map, 'mthumb sm'), res, nm, wv, tm, dt);
    const det = el('div', 'rdet hidden');
    let built = false;
    top.addEventListener('click', () => {
      d.sound('click');
      if (!built) { built = true; fillDetail(det, r); }
      const open = det.classList.toggle('hidden') === false;
      row.classList.toggle('open', open); top.setAttribute('aria-expanded', String(open));
    });
    row.append(top, det);
    return row;
  }
  function fillDetail(det: HTMLElement, r: RunRecord) {
    const stats = el('div', 'dstats');
    const st = (g: Node, v: string, t: string) => { const s = el('span', 'dst'); s.title = t; s.append(g, el('b', '', v)); stats.append(s); };
    st(img('./media/sm/enemy_grunt.jpg', 'dimg'), big(r.kills), 'Machines destroyed');
    if (r.bossKills) st(img('./media/sm/enemy_boss.jpg', 'dimg'), String(r.bossKills), 'Colossi destroyed');
    if (r.titanKills) st(img('./media/sm/enemy_titan.jpg', 'dimg'), String(r.titanKills), 'Titan destroyed');
    st(glyph(G.heart), `${r.lives}/${r.maxLives}`, 'Core integrity at the end');
    if (r.itemsDelivered) st(ic('iron', { size: 18 }), big(r.itemsDelivered), 'Items delivered to towers');
    if (r.specials) st(ic('power', { size: 18 }), String(r.specials), 'Specials fired');
    det.append(stats);
    const towers = TOWER_TYPES.filter((t) => (r.towersBuilt[t] || 0) > 0);
    if (towers.length) {
      const g = el('div', 'dtw');
      for (const t of towers) { const c = el('span', 'tw'); c.title = `${TOWERS[t].name} x ${r.towersBuilt[t]}`; c.append(towerImg(t), el('b', '', String(r.towersBuilt[t]))); g.append(c); }
      det.append(g);
    }
    const facs = Object.entries(r.buildingsBuilt).filter(([t, n]) => n > 0 && Object.hasOwn(FACS, t));
    if (facs.length) {
      const g = el('div', 'dfac');
      for (const [t, n] of facs.sort((a, b) => b[1] - a[1])) { const c = el('span', 'fc'); c.title = `${FACS[t as FacType].name} x ${n}`; c.append(ic(`fac_${t as FacType}`, { size: 22 }), el('b', '', String(n))); g.append(c); }
      det.append(g);
    }
    if (r.cardsTaken.length) {
      const g = el('div', 'dcards');
      for (const id of r.cardsTaken) {
        const c = CARD_BY_ID[id]; if (!c) continue;
        const k = el('span', `cd rar${c.rar}`); k.title = c.name;
        const ics = d.cardIcons(id);
        if (ics.length) k.append(ic(ics[0], { size: 20 })); else k.append(el('i', '', c.icon));
        g.append(k);
      }
      det.append(g);
    }
  }

  function openRecords(onBack: () => void) {
    const root = $('records'); root.textContent = '';
    const rec = career.records, t = rec.totals, list = career.achievements.list(), got = list.filter((v) => v.unlocked).length;
    const sheet = el('div', 'sheet wide rsheet');
    const close = () => { root.classList.add('hidden'); onBack(); };
    // the achievements, one tap away: the three latest medals and the count
    const achBtn = el('button', 'achlink'); achBtn.type = 'button'; achBtn.id = 'rec-achs';
    const latest = list.filter((v) => v.unlocked).sort((a, b) => b.at - a.at).slice(0, 3);
    const stack = el('span', 'mstack');
    for (const v of latest) stack.append(medal(v.def, { unlocked: true, size: 'sm' }));
    if (!latest.length) stack.append(medal(ACHIEVEMENTS[0], { unlocked: false, size: 'sm' }));
    achBtn.append(stack, el('b', '', `${got}/${list.length}`), el('span', '', 'Achievements'));
    achBtn.addEventListener('click', () => { d.sound('click'); root.classList.add('hidden'); openAchievements(() => openRecords(onBack)); });
    sheet.append(head('Service record', 'Records', achBtn, back('rec-back', close)));

    if (!t.runs) {
      const e = el('div', 'rempty');
      e.append(img('./media/sm/tower_pulse.jpg', 'eimg'), el('b', '', 'No runs yet'), el('span', '', 'Finish or give up a run and it lands here.'));
      sheet.append(e);
    }
    // ---- lifetime totals
    if (t.runs) {
      const tiles = el('div', 'tiles');
      const wr = t.runs ? Math.round((t.wins / t.runs) * 100) : 0;
      tiles.append(
        tile(glArt(G.cup), String(t.wins), 'Wins', `${t.runs} runs · ${wr}%`, true),
        tile(glArt(G.wave), big(t.waves), 'Waves held', t.bestSurvival ? `Survival best ${t.bestSurvival}` : ''),
        tile(art('./media/sm/enemy_grunt.jpg'), big(t.kills), 'Machines'),
        tile(art('./media/sm/enemy_boss.jpg'), big(t.bossKills), 'Colossi'),
        tile(art('./media/sm/enemy_titan.jpg'), big(t.titanKills), 'Titans'),
        tile(art('./media/sm/tower_pulse.jpg'), big(t.towers), 'Towers built'),
        tile(art('./media/sm/fac_smelter.jpg'), big(t.buildings), 'Buildings'),
        tile(icArt('shell'), big(t.items), 'Delivered'),
        tile(icArt('power'), big(t.specials), 'Specials'),
        tile(glArt(G.clock), hours(t.playtime), 'Played'),
      );
      sheet.append(sec('Lifetime'), tiles);
    }
    // ---- per map bests
    const keys = Object.keys(rec.bests);
    if (keys.length) {
      const grid = el('div', 'bests');
      const items = keys.map((k) => {
        const i2 = k.lastIndexOf('|'), i1 = k.lastIndexOf('|', i2 - 1);
        return { k, map: k.slice(0, i1), diff: k.slice(i1 + 1, i2), mode: (k.slice(i2 + 1) === 'survival' ? 'survival' : 'campaign') as RunMode, b: rec.bests[k] };
      }).filter((x) => x.map);
      // most won first, then the furthest
      items.sort((a, b) => b.b.wins - a.b.wins || b.b.bestWave - a.b.bestWave);
      for (const x of items) {
        const name = rec.runs.find((r) => r.map === x.map)?.mapName || d.mapOf(x.map)?.name || x.map;
        const flawless = rec.runs.some((r) => r.map === x.map && r.diff === x.diff && r.mode === x.mode && r.result === 'win' && r.lives >= r.maxLives);
        const c = el('div', 'best'), md = bestMedal(x.b, x.mode, flawless);
        const th = el('span', 'bth'); th.append(thumb(x.map));
        if (md) { const m = el('span', `bmedal t-${md}`); m.title = md === 'gold' ? 'Won with a full core' : md === 'silver' ? 'Won' : 'Played'; m.append(glyph(G.medal)); th.append(m); }
        const tg = el('span', `btag ${x.mode}`, x.mode === 'survival' ? 'Survival' : diffName(x.diff));
        th.append(tg);
        const line = el('div', 'bline');
        const waves = x.mode === 'survival' ? String(x.b.bestWave) : `${x.b.bestWave}/${diffById(x.diff).waves}`;
        const s = (g: string, v: string, title: string, cls = '') => { const e = el('span', 'bs ' + cls); e.title = title; e.append(glyph(g), el('b', '', v)); line.append(e); };
        s(G.wave, waves, 'Best wave');
        if (x.b.wins) { s(G.heart, String(x.b.bestLivesWin), 'Most core integrity in a win', 'hp'); s(G.clock, clock(x.b.fastestWin), 'Fastest win'); }
        s(G.cup, `${x.b.wins}/${x.b.runs}`, 'Wins / runs', x.b.wins ? 'won' : '');
        c.append(th, el('b', 'bname', shortName(name)), line);
        grid.append(c);
      }
      sheet.append(sec('Best per map'), grid);
    }
    // ---- the archive
    if (rec.runs.length) {
      const arch = el('div', 'archive');
      const PAGE = 25;
      let shown = 0;
      const more = el('button', 'btn ghost small rmore'); more.type = 'button';
      const page = () => {
        for (const r of rec.runs.slice(shown, shown + PAGE)) arch.insertBefore(runRow(r), more);
        shown = Math.min(rec.runs.length, shown + PAGE);
        more.textContent = `Show more (${rec.runs.length - shown})`;
        more.classList.toggle('hidden', shown >= rec.runs.length);
      };
      more.addEventListener('click', () => { d.sound('click'); page(); });
      arch.append(more);
      page();
      sheet.append(sec(`Past runs · ${rec.runs.length}`), arch);
    }
    root.append(sheet);
    root.classList.remove('hidden');
    root.scrollTop = 0;
    $('rec-back').focus({ preventScroll: true });
  }
  const sec = (t: string) => el('h3', 'rsec', t);

  // ---------- the save of a map: continue or start over ----------
  /** The facts of a save as small chips: wave, core, credits, when. */
  function saveFacts(m: SaveMeta, withName = false): HTMLElement {
    const f = el('span', 'sfacts');
    if (withName) f.append(el('b', 'sname', shortName(m.mapName)));
    const c = (g: SVGElement, v: string, cls = '') => { const e = el('span', 'sf ' + cls); e.append(g, el('b', '', v)); f.append(e); };
    c(glyph(G.wave), `Wave ${m.wave + 1} next`);
    c(glyph(G.heart), `${m.lives}/${m.maxLives}`, 'hp');
    c(ic('credits', { size: 15 }), big(m.credits));
    f.append(el('small', 'sago', `${m.mode === 'survival' ? 'Survival' : diffName(m.diff)} · ${ago(m.savedAt)}`));
    return f;
  }
  /**
   * The dialog when the map, difficulty and mode picked has a save. Continue resumes it; Start over asks once more,
   * inline, then archives and deletes the save (play.ts: career.startOver) and starts fresh.
   */
  function askContinue(m: SaveMeta, h: { resume(): void; fresh(): void; back(): void }) {
    const root = $('cont'); root.textContent = '';
    const sheet = el('div', 'sheet contsheet');
    const close = () => { root.classList.add('hidden'); h.back(); };
    const th = el('div', 'cth'); th.append(thumb(m.map, 'mthumb lg'));
    const badge = el('span', 'cbadge'); badge.append(glyph(G.wave), el('b', '', String(m.wave + 1)));
    th.append(badge);
    const title = el('div', 'ctitle'); title.append(el('span', 'kicker', 'Run in progress'), el('h2', '', shortName(m.mapName)));
    const go = el('button', 'btn cgo'); go.type = 'button'; go.id = 'cont-go'; go.append(glyph(G.play), el('span', '', 'Continue'));
    const over = el('button', 'btn ghost cover2'); over.type = 'button'; over.id = 'cont-over'; over.textContent = 'Start over';
    const ask = el('div', 'cask hidden');
    const yes = el('button', 'btn small cyes'); yes.type = 'button'; yes.id = 'cont-yes'; yes.textContent = 'Yes, start over';
    const no = el('button', 'btn ghost small'); no.type = 'button'; no.textContent = 'Keep it';
    ask.append(el('span', '', `Your progress to wave ${m.wave + 1} is lost.`), yes, no);
    const btns = el('div', 'cbtns'); btns.append(go, over);
    go.addEventListener('click', () => { d.sound('click'); root.classList.add('hidden'); h.resume(); });
    over.addEventListener('click', () => { d.sound('click'); btns.classList.add('hidden'); ask.classList.remove('hidden'); yes.focus(); });
    no.addEventListener('click', () => { d.sound('click'); ask.classList.add('hidden'); btns.classList.remove('hidden'); over.focus(); });
    yes.addEventListener('click', () => { d.sound('click'); root.classList.add('hidden'); h.fresh(); });
    const x = back('cont-back', close); x.classList.add('cx');
    sheet.append(x, th, title, saveFacts(m), btns, ask);
    root.append(sheet);
    root.classList.remove('hidden');
    go.focus({ preventScroll: true });
  }
  /** The main menu's Continue card: the newest save, one click resumes it. */
  function fillContinue(btn: HTMLElement, m: SaveMeta | null) {
    btn.textContent = '';
    btn.classList.toggle('hidden', !m);
    if (!m) return;
    const t = el('span', 'mcth'); t.append(thumb(m.map, 'mthumb'));
    const tx = el('span', 'mctx');
    const k = el('span', 'mck'); k.append(glyph(G.play), el('span', '', 'Continue'));
    tx.append(k, saveFacts(m, true));
    btn.append(t, tx);
    btn.setAttribute('aria-label', `Continue ${m.mapName}, wave ${m.wave + 1} next`);
  }
  /** A small mark on a map card of the setup screen: this map has a run saved at this difficulty and mode. */
  function saveMark(m: SaveMeta): HTMLElement {
    const s = el('span', 'savemark'); s.title = `Saved before wave ${m.wave + 1}, ${ago(m.savedAt)}`;
    s.append(glyph(G.play), el('b', '', String(m.wave + 1)));
    return s;
  }

  // ---------- in game: the unlock slide-in and the saved tick ----------
  const queue: AchDef[] = [];
  let popOn = false, popTimer = 0;
  function popup(a: AchDef) {
    if (queue.some((q) => q.id === a.id)) return;
    queue.push(a);
    if (!popOn) nextPop();
  }
  function nextPop() {
    const host = $('ach-pop');
    const a = queue.shift();
    if (!a) { popOn = false; host.classList.add('hidden'); return; }
    popOn = true;
    host.textContent = '';
    host.className = `t-${a.tier}`;
    const tx = el('span', 'ptx');
    tx.append(el('span', 'pk', `Achievement · ${a.tier}`), el('b', '', a.name), el('small', '', a.desc));
    host.append(medal(a, { unlocked: true, size: 'sm' }), tx);
    host.setAttribute('aria-label', `Achievement unlocked: ${a.name}`);
    void host.offsetWidth; // (restart the slide-in)
    host.classList.add('in');
    d.sound('levelup', 0.45);
    clearTimeout(popTimer);
    popTimer = window.setTimeout(() => {
      host.classList.remove('in'); host.classList.add('out');
      popTimer = window.setTimeout(nextPop, 380);
    }, 3400);
  }
  function clearPopups() { queue.length = 0; clearTimeout(popTimer); popOn = false; const h = $('ach-pop'); h.className = 'hidden'; h.textContent = ''; }
  let tickTimer = 0;
  function savedTick() {
    const t = $('saved-tick');
    t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
    clearTimeout(tickTimer);
    tickTimer = window.setTimeout(() => t.classList.remove('on'), 1800);
  }

  // ---------- the end screen: what this run set and earned ----------
  function endBadges(host: HTMLElement, o: { rec: RunRecord | null; prev?: MapBest; achs: AchDef[] }) {
    host.textContent = '';
    const r = o.rec, p = o.prev;
    const items: HTMLElement[] = [];
    const rb = (g: string, label: string, v: string) => {
      const b = el('span', 'eb rec'); const m = el('span', 'eicon'); m.append(glyph(g));
      const tx = el('span', 'etx'); tx.append(el('small', '', label), el('b', '', v));
      b.append(m, tx); items.push(b);
    };
    if (r) {
      const win = r.result === 'win';
      if (win && !(p && p.wins)) rb(G.cup, 'First win here', diffName(r.diff));
      else if (win && p && p.fastestWin && r.time < p.fastestWin) rb(G.clock, 'Fastest win', clock(r.time));
      if (win && p && p.wins && r.lives > p.bestLivesWin) rb(G.heart, 'Best core', `${r.lives}/${r.maxLives}`);
      if (!win && r.wave > (p?.bestWave || 0) && (p?.runs || 0) > 0) rb(G.wave, 'Furthest yet', `Wave ${r.wave}`);
    }
    for (const a of o.achs) {
      const b = el('span', `eb ach t-${a.tier}`);
      const tx = el('span', 'etx'); tx.append(el('small', '', a.tier), el('b', '', a.name));
      b.title = a.desc;
      b.append(medal(a, { unlocked: true, size: 'sm' }), tx); items.push(b);
    }
    host.classList.toggle('hidden', !items.length);
    if (!items.length) return;
    host.append(el('span', 'kicker', 'This run'));
    const row = el('div', 'ebrow'); row.append(...items);
    host.append(row);
  }

  return { openRecords, openAchievements, askContinue, fillContinue, saveMark, popup, clearPopups, savedTick, endBadges };
}
