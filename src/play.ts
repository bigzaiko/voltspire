// VOLTSPIRE - game controller: input, HUD, menus, saved progress, multiplayer glue.
import '@fontsource/saira-stencil-one/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';
import * as THREE from 'three';
import { GW, GH, TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, CARD_BY_ID, RARITY, BOW_TIERS, MAX_ENERGY, SQUADS, worldToCell } from './game/data.ts';
import type { TowerType, EnemyType } from './game/data.ts';
import { Sim, SKILL_CD, nodePos } from './game/sim.ts';
import type { Ev, Mode, Tower } from './game/sim.ts';
import { Bot } from './game/bot.ts';
import { View } from './game/render.ts';
import { Sound } from './game/audio.ts';
import { Net, cleanCode } from './game/net.ts';
import { DIFFS, diffById, sanitizeMap } from './game/map.ts';
import type { MapDef } from './game/map.ts';
import { MAPS, mapById } from './game/maps.ts';
import { generateMap } from './game/mapgen.ts';
import { drawMap } from './game/mapdraw.ts';
import { openEditor, loadCustomMaps } from './editor.ts';
import { initTouch } from './touch.ts';
import { initMusic } from './music.ts';
import type { Msg } from './game/net.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const show = (id: string, on = true) => $(id).classList.toggle('hidden', !on);
const shown = (id: string) => !$(id).classList.contains('hidden');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const STEP = 1 / 60;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** A one-path icon. Built node by node, so nothing here needs innerHTML. */
function icon(d: string, cls = ''): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill-rule', 'evenodd');
  s.appendChild(p);
  return s;
}

// ---------- saved progress (one versioned object in localStorage) ----------
// Whatever comes back from storage is treated like any other outside input: every field is checked and clamped.
const STORE_KEY = 'voltspire';
type FxColor = 'auto' | 'sand' | 'apricot' | 'verdigris' | 'custom';
interface Rec { wave: number; wins: number; time: number; surv: number }
interface Store {
  v: 2;
  settings: { vol: number; mus: number; sens: number; q: 'high' | 'low' };
  fx: { impact: boolean; beat: boolean; borders: boolean; env: boolean; towers: boolean; intensity: number; color: FxColor; custom: string };
  setup: { survival: boolean; source: 'premade' | 'generated'; map: string; mapName: string; seed: number; tier: number; tierAuto: boolean; diff: string };
  /** per map and difficulty, keyed "<map id>|<difficulty id>" */
  records: Record<string, Rec>;
  tips: { node: boolean; boss: boolean };
}
const REC_KEY = /^[A-Za-z0-9 _.:\-]{1,64}\|(easy|normal|hard)$/;
const MAX_RECORDS = 300;
const GEN_ID = /^gen-[1-3]-\d{1,9}$/;
function hash8(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
/**
 * The record key of a map, without the difficulty. Premade and generated maps use their id.
 * Any other map gets its name cut down to plain characters plus a hash of the name and the roads,
 * so names with accents or punctuation still get a record and two maps with one name do not share it.
 */
function mapKeyOf(m: MapDef): string {
  if (MAPS.includes(m) || GEN_ID.test(m.id)) return m.id;
  const slug = m.name.normalize('NFKD').replace(/[^A-Za-z0-9 _-]/g, '').replace(/ +/g, ' ').trim().slice(0, 40);
  const roads = m.lanes.map((l) => l.map((q) => `${q[0]},${q[1]},${q[2] || 0}`).join(';')).join('/');
  return `custom:${slug || 'map'}.${hash8(m.name + '|' + roads + '|' + m.core.join(','))}`;
}
const newSeed = () => 1 + Math.floor(Math.random() * 999998);
const defaultSetup = (): Store['setup'] => ({ survival: false, source: 'premade', map: MAPS[0].id, mapName: MAPS[0].name, seed: newSeed(), tier: 2, tierAuto: true, diff: 'normal' });

function readStore(raw: unknown): Store {
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
  const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const str = (v: unknown, max: number, d: string) => (typeof v === 'string' && v.length <= max ? v : d);
  const r = o(raw);
  // version 1 kept the settings flat in the top-level object
  const old = r.v === 2 ? null : r;
  const s = old || o(r.settings), f = o(r.fx), u = o(r.setup), t = o(r.tips), ds = defaultSetup();
  const colors: FxColor[] = ['auto', 'sand', 'apricot', 'verdigris', 'custom'];
  const store: Store = {
    v: 2,
    settings: { vol: int(s.vol, 0, 100, 70), mus: int(s.mus, 0, 100, 50), sens: int(s.sens, 20, 200, 100), q: s.q === 'low' ? 'low' : 'high' },
    fx: {
      impact: bool(f.impact, true), beat: bool(f.beat, true), borders: bool(f.borders, true), env: bool(f.env, false), towers: bool(f.towers, false),
      intensity: int(f.intensity, 0, 100, 30), color: colors.find((c) => c === f.color) || 'auto',
      custom: typeof f.custom === 'string' && /^#[0-9a-f]{6}$/i.test(f.custom) ? f.custom.toLowerCase() : '#e3dc92',
    },
    setup: {
      survival: bool(u.survival, ds.survival), source: u.source === 'generated' ? 'generated' : 'premade',
      map: str(old ? old.map : u.map, 32, ds.map), mapName: str(u.mapName, 40, ''),
      seed: int(u.seed, 0, 999999999, ds.seed), tier: int(u.tier, 1, 3, 2), tierAuto: bool(u.tierAuto, true),
      diff: diffById(old ? old.diff : u.diff).id,
    },
    records: {},
    tips: { node: bool(t.node, false), boss: bool(t.boss, false) },
  };
  let n = 0;
  for (const [k, v] of Object.entries(o(r.records))) {
    if (n >= MAX_RECORDS || !REC_KEY.test(k)) continue;
    const q = o(v);
    // a campaign best can never be past the last wave of its difficulty
    store.records[k] = { wave: int(q.wave, 0, diffById(k.slice(k.lastIndexOf('|') + 1)).waves, 0), wins: int(q.wins, 0, 99999, 0), time: num(q.time, 0, 360000, 0), surv: int(q.surv, 0, 9999, 0) };
    n++;
  }
  if (old) {
    // carry the two old global bests over as records of the first map
    const best = int(old.best, 0, 9999, 0), surv = int(old.bestSurv, 0, 9999, 0);
    if (best || surv) store.records[`${MAPS[0].id}|normal`] = { wave: Math.min(best, diffById('normal').waves), wins: 0, time: 0, surv };
  }
  return store;
}
let store: Store;
try { store = readStore(JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch { store = readStore(null); }
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage unavailable */ } };
const settings = store.settings;
const recOf = (mapId: string, diff: string): Rec | undefined => (Object.hasOwn(store.records, `${mapId}|${diff}`) ? store.records[`${mapId}|${diff}`] : undefined);

const canvas = $<HTMLCanvasElement>('c');
const view = new View(canvas);
const sound = new Sound();
sound.volume = settings.vol / 100; sound.musicVol = settings.mus / 100;

// Parts of the view that are being added separately. Everything here is optional until they land.
interface FxOptions { impact: boolean; beat: boolean; borders: boolean; env: boolean; towers: boolean; intensity: number; color: number | null }
const vx = view as unknown as { fxOptions?: Partial<FxOptions>; beat?(level: number): void; skipIntro?(): void; introActive?(): boolean };
const FX_COLORS = { sand: 0xe3dc92, apricot: 0xf68b56, verdigris: 0x6fe0c8 };
function applyFx() {
  const o = vx.fxOptions, f = store.fx;
  if (!o) return;
  o.impact = f.impact; o.beat = f.beat; o.borders = f.borders; o.env = f.env; o.towers = f.towers;
  o.intensity = f.intensity / 100;
  o.color = f.color === 'auto' ? null : f.color === 'custom' ? parseInt(f.custom.slice(1), 16) : FX_COLORS[f.color];
}

type GameMode = 'attract' | Mode;
let mode: GameMode = 'attract';
let sim = new Sim({ pauseOnCards: false });
let bot: Bot | null = null;
let me = 0;
let net: Net | null = null;
let isClient = false;
let paused = false, speed = 1, acc = 0;
let buildType: TowerType | null = null, selected = 0;
let dragging = false;
/** Fire is held: left mouse button, and a finger on the touch Fire button. Whether arrows fly is decided each frame. */
let mouseFire = false, touchFire = false;
/** the last press came from a finger, not from the mouse or the keyboard */
let byTouch = false;
let snapT = 0, lookT = 0, vsT = 0;
let netEvs: Ev[] = [];
let cardKey = '', ended = false, readyShown = false, lastTier = 0;
let lobbyMode: 'coop' | 'versus' = 'coop';
const choice: { map: MapDef; diff: string; survival: boolean; source: 'premade' | 'generated'; seed: number; tier: number; tierAuto: boolean } =
  { map: MAPS[0], diff: 'normal', survival: false, source: 'premade', seed: 1, tier: 2, tierAuto: true };
let setupFor: 'solo' | 'lobby' = 'solo';
let rival = { l: 20, w: 0, k: 0 };
let lastRx = 0, squadTokens = 3, squadT = 0, endTimer = 0;
/** records are kept for solo runs only: the key of the run in progress, and whether its win was already counted */
let runKey = '', runWon = false;
/** set when progress was reset during a run: the saved setup is read again on the way back to the menu */
let setupStale = false;
const OVERLAYS = ['pause', 'help', 'settings', 'music'];
const menuOpen = () => OVERLAYS.some(shown);
const hover = { cx: -1, cz: -1 };
const keys = new Set<string>();
const aim = new THREE.Vector3(), gp = new THREE.Vector3();
const P3 = { x: 0, y: 0, z: 0 };
/** true once the touch module has switched the on-screen controls on */
const touchUi = () => shown('touch');
const heroOn = () => !!sim.players[me]?.heroActive;

// ---------- actions (local sim, or sent to the co-op host) ----------
/** Why a tower cannot be sold. Worked out here as well so a co-op guest gets the reason without a round trip. */
function sellReason(t: Tower): string {
  const why = sim.sellBlock(t);
  return why === 'hero' ? 'Kestrel is standing on this Spire.' : why === 'last' ? 'This is the last Uplink Spire. It cannot be sold.' : '';
}
const act = {
  build(type: TowerType, cx: number, cz: number) {
    if (isClient) { if (sim.canBuild(type, cx, cz)) net?.send({ t: 'in', a: 'build', ty: TOWER_TYPES.indexOf(type), cx, cz }); else return false; return true; }
    return !!sim.build(type, cx, cz);
  },
  upgrade(id: number) { if (isClient) net?.send({ t: 'in', a: 'up', id }); else if (!sim.upgrade(id)) sound.play('error'); },
  sell(id: number) {
    const t = sim.towerById(id);
    if (!t) return false;
    const why = sellReason(t);
    if (why) { sound.play('error'); note(why); return false; }
    if (isClient) net?.send({ t: 'in', a: 'sell', id }); else sim.sell(id);
    return true;
  },
  card(i: number) { if (isClient) net?.send({ t: 'in', a: 'card', i }); else sim.pickCard(me, i); },
  hero(id: number) { if (isClient) net?.send({ t: 'in', a: 'hero', id }); else sim.activateHero(me, id); },
  exit() { if (isClient) net?.send({ t: 'in', a: 'exit' }); else sim.exitHero(me); },
  tele(id: number) { if (isClient) net?.send({ t: 'in', a: 'tele', id }); else sim.heroTeleport(me, id); },
  fire(p: THREE.Vector3) { if (isClient) net?.send({ t: 'in', a: 'fire', x: p.x, y: p.y, z: p.z }); else sim.heroFire(me, p.x, p.y, p.z); },
  skill(s: number, p: THREE.Vector3) { if (isClient) net?.send({ t: 'in', a: 'skill', s, x: p.x, y: p.y, z: p.z }); else sim.heroSkill(me, s, p.x, p.y, p.z); },
  wave() { if (isClient) net?.send({ t: 'in', a: 'wave' }); else sim.startWave(); },
};

// ---------- HUD helpers ----------
const cache: Record<string, string> = {};
const setText = (id: string, v: string) => { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } };
const setW = (id: string, f: number) => { const v = (clamp(f, 0, 1) * 100).toFixed(1) + '%'; if (cache[id] !== v) { cache[id] = v; $(id).style.width = v; } };

function announce(text: string, sub = '') {
  const a = $('announce');
  a.textContent = text;
  if (sub) a.appendChild(el('small', '', sub));
  a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
}
/** A short message. In a match it goes to the HUD; over a menu sheet it goes to a layer above the sheets. */
function toast(text: string) {
  const box = $(mode === 'attract' || menuOpen() || shown('end') ? 'notes' : 'toasts');
  const t = el('div', 'toast', text);
  box.appendChild(t);
  setTimeout(() => t.remove(), 3300);
  while (box.children.length > 5) box.firstChild!.remove();
}
/** Like toast, but the same line is not repeated while it is still fresh. */
const noteAt: Record<string, number> = {};
function note(text: string) {
  const now = performance.now();
  if (now - (noteAt[text] || -1e9) < 3000) return;
  noteAt[text] = now;
  toast(text);
}
let tutorTimer = 0;
/** One line of tutorial text, shown once and left up long enough to read. */
function tutor(text: string) {
  setText('tutor-text', text);
  show('tutor');
  clearTimeout(tutorTimer);
  tutorTimer = window.setTimeout(() => show('tutor', false), 8000);
}
function flash() { const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
function dmgNumber(e: Ev, crit = false): HTMLElement | null {
  const box = $('dmg');
  if (box.children.length > 26 && !crit) return null;
  const [x, y, ok] = view.project(e.x, e.y + 0.4, e.z);
  if (!ok) return null;
  const s = el('span', crit ? 'crit' : '', String(e.n));
  s.style.left = x + (Math.random() - 0.5) * 24 + 'px'; s.style.top = y + 'px';
  box.appendChild(s);
  const frames = crit
    ? [{ transform: 'translateY(0) scale(1.7)', opacity: 1 }, { transform: 'translateY(-22px) scale(1.25)', opacity: 1, offset: 0.25 }, { transform: 'translateY(-70px) scale(1.05)', opacity: 0 }]
    : [{ transform: 'translateY(0) scale(1.3)', opacity: 1 }, { transform: 'translateY(-46px) scale(0.9)', opacity: 0 }];
  s.animate(frames, { duration: crit ? 950 : 650, easing: 'ease-out' }).onfinish = () => s.remove();
  return s;
}

// ---------- enemy icons (wave intel) ----------
// Six silhouettes on a 16 x 16 grid: walker, dart, flyer, shield, heavy, and the Colossus as a plated hexagon.
const ENEMY_ICON: Record<EnemyType, string> = {
  grunt: 'M8 1.5a2 2 0 1 1 0 4a2 2 0 0 1 0-4zM4.5 6.5h7l-1 4.5 1 3.5H9.3L8 11.5 6.7 14.5H4.5l1-3.5z',
  runner: 'M1.5 3.5l6 4.5-6 4.5zM8 3.5l6.5 4.5L8 12.5z',
  drone: 'M8 4.5L11.5 8 8 11.5 4.5 8zM0.5 5.5L4.5 8l-4 2.5zM15.5 5.5L11.5 8l4 2.5z',
  shield: 'M8 1.5l5.5 2V8c0 3.3-2.4 5.6-5.5 6.5C4.9 13.6 2.5 11.3 2.5 8V3.5z',
  brute: 'M1.5 5h4V2.5h5V5h4v6.5H12v3H9.2v-3H6.8v3H4v-3H1.5z',
  boss: 'M8 0.8l6.2 3.6v7.2L8 15.2l-6.2-3.6V4.4zM8 5.4a2.6 2.6 0 1 0 0 5.2a2.6 2.6 0 0 0 0-5.2z',
};
type Group = { type: EnemyType; n: number };
/** Fill a box with icon + count chips, Colossus first. Anything that is not a known enemy type is dropped. */
function enemyChips(box: HTMLElement, list: Group[]) {
  box.textContent = '';
  const ok = list.filter((o) => o && Object.hasOwn(ENEMIES, o.type) && Number.isFinite(o.n) && o.n > 0);
  ok.sort((a, b) => (a.type === 'boss' ? -1 : b.type === 'boss' ? 1 : ENEMY_TYPES.indexOf(a.type) - ENEMY_TYPES.indexOf(b.type)));
  for (const o of ok) {
    const s = el('span', o.type === 'boss' ? 'en boss' : 'en');
    s.title = ENEMIES[o.type].name;
    s.append(icon(ENEMY_ICON[o.type]), el('b', '', String(Math.min(999, Math.round(o.n)))));
    box.appendChild(s);
  }
  return ok;
}

// ---------- build bar ----------
function towerTip(t: TowerType) {
  const d = TOWERS[t], tip = $('tip');
  tip.textContent = '';
  const stats = d.dmg > 0 ? ` Damage ${d.dmg}, ${d.rate} per second, range ${d.range}.` : d.range > 0 ? ` Range ${d.range}.` : '';
  tip.append(el('b', '', d.name), el('span', '', d.desc + stats));
  if (d.special) tip.append(el('i', '', `Special: ${d.special.name}. ${d.special.desc}`));
  show('tip');
}
const buildBtns = {} as Record<TowerType, HTMLButtonElement>;
let tipHover: TowerType | null = null;
for (const t of TOWER_TYPES) {
  const d = TOWERS[t];
  const b = el('button', 'tw') as HTMLButtonElement;
  b.type = 'button';
  b.style.setProperty('--c', hex(d.color));
  b.setAttribute('aria-label', `${d.name}, key ${d.key.toUpperCase()}`);
  b.append(el('kbd', '', d.key), el('div', 'ico'), el('div', 'nm', d.name), el('div', 'cost'));
  b.addEventListener('click', () => { sound.init(); pickBuild(t); });
  b.addEventListener('mouseenter', () => { tipHover = t; });
  b.addEventListener('mouseleave', () => { tipHover = null; });
  buildBtns[t] = b;
  $('build').appendChild(b);
}
function pickBuild(t: TowerType | null) {
  if (t && !sim.unlocked.has(t)) { sound.play('error'); note(TOWERS[t].name + ' is locked. Find its blueprint card first.'); return; }
  buildType = buildType === t ? null : t;
  selected = 0;
  sound.play('click');
  if (!buildType) view.setGhost(null);
  refreshGhost();
}
function refreshGhost() {
  if (heroOn()) { view.setGhost(null); view.setHover(0, 0, false); return; }
  const inb = hover.cx >= 0 && hover.cz >= 0 && hover.cx < GW && hover.cz < GH;
  if (buildType && inb) {
    const fake = { type: buildType, lvl: 1 } as Parameters<Sim['range']>[0];
    view.setGhost(buildType, hover.cx, hover.cz, sim.canBuild(buildType, hover.cx, hover.cz), sim.range(fake));
    view.setHover(0, 0, false);
  } else {
    if (buildType) view.setGhost(null);
    view.setHover(hover.cx, hover.cz, inb && mode !== 'attract' && sim.grid[hover.cz * GW + hover.cx] === 0);
  }
}

// versus squads
SQUADS.forEach((s, i) => {
  const b = el('button', 'btn small ghost') as HTMLButtonElement;
  b.type = 'button';
  b.append(el('span', '', s.name), el('small', '', String(s.cost)));
  b.addEventListener('click', () => {
    if (mode !== 'versus' || sim.over) return;
    if (sim.gold < s.cost) { sound.play('error'); return; }
    sim.gold -= s.cost; sim.sent += s.n;
    net?.send({ t: 'squad', i });
    sound.play('wave'); toast(`Sent ${s.name} at your rival.`);
  });
  $('vs-squads').appendChild(b);
});

// ---------- cards ----------
function showCards() {
  const p = sim.players[me];
  if (!p || !p.pending.length || mode === 'attract' || bot) { if (cardKey) { cardKey = ''; show('cards', false); } return; }
  const key = p.pending.length + ':' + p.pending[0].join(',');
  if (cardKey === key || cardKey === 'sent:' + key) return;
  cardKey = key;
  const row = $('card-row');
  row.textContent = '';
  setText('cards-sub', p.pending.length > 1 ? `Choose one upgrade (${p.pending.length} waiting)` : 'Choose one upgrade');
  p.pending[0].forEach((id, i) => {
    // a co-op guest gets its offer from the host: skip anything that is not a known card
    if (typeof id !== 'string' || !Object.hasOwn(CARD_BY_ID, id)) return;
    const c = CARD_BY_ID[id];
    const d = el('button', 'card') as HTMLButtonElement;
    d.type = 'button';
    d.style.setProperty('--rc', ['#e3dc92', '#f68b56', '#6fe0c8'][c.rar]);
    d.append(el('kbd', '', String(i + 1)), el('div', 'ci', c.icon), el('div', 'rar', RARITY[c.rar]), el('h4', '', c.name), el('p', '', c.desc), el('div', 'kind', c.needs ? TOWERS[c.needs].name : c.kind === 'eco' ? 'economy' : c.kind === 'tower' ? 'all towers' : c.kind === 'hero' ? 'Kestrel' : c.kind));
    if (c.needs) d.style.setProperty('--tc', hex(TOWERS[c.needs].color));
    d.addEventListener('click', () => pickCard(i));
    d.addEventListener('mouseenter', () => sound.play('hover'));
    row.appendChild(d);
  });
  show('cards');
  if (document.pointerLockElement) document.exitPointerLock();
}
function pickCard(i: number) {
  const p = sim.players[me];
  if (!cardKey || cardKey.startsWith('sent:') || !p.pending.length || i >= p.pending[0].length) return;
  cardKey = 'sent:' + cardKey;
  show('cards', false);
  act.card(i);
  sound.play('card');
  if (heroOn()) lockPointer();
}

// ---------- events ----------
const SHOT_SOUND: Record<string, string> = { pulse: 'shot', arc: 'arcshot', mortar: 'mortar', rail: 'rail', missile: 'missile' };
function handleEvents(evs: Ev[]) {
  view.handle(evs);
  const quiet = mode === 'attract';
  if (quiet) return;
  let lastDmg: { el: HTMLElement | null; n: number } | null = null;
  for (const e of evs) {
    switch (e.k) {
      case 'shot': sound.play((typeof e.t === 'string' && Object.hasOwn(SHOT_SOUND, e.t) && SHOT_SOUND[e.t]) || 'shot'); break;
      case 'cryo': sound.play('cryo'); break;
      case 'flame': sound.play('flame'); break;
      case 'lance': sound.play('lance'); break;
      case 'gravity': sound.play('gravity'); break;
      case 'boom': sound.play('boom'); break;
      case 'die': sound.play(e.t === 'boss' ? 'bossdie' : 'die'); if (e.t === 'boss') toast('Colossus destroyed.'); break;
      case 'arrow': sound.play('arrow'); break;
      case 'rail': if (e.big) sound.play('bigshot'); break;
      case 'skill': sound.play(e.s === 1 ? 'rain' : 'sing'); break;
      case 'shieldbreak': sound.play('shield'); break;
      case 'build': sound.play('build'); break;
      case 'sell': sound.play('sell'); break;
      case 'tele': sound.play('tele'); if (e.p === me) flash(); break;
      case 'dmg': if (e.p === me && heroOn()) lastDmg = { el: dmgNumber(e), n: e.n }; break;
      case 'crit': {
        // A weak-point hit. The sim also reports the same damage as a plain 'dmg' just before: show the crit instead.
        if (!heroOn()) break;
        const mine = !!lastDmg && Math.abs(lastDmg.n - e.n) <= 1;
        if (mine) { lastDmg!.el?.remove(); lastDmg = null; }
        if (mine || mode !== 'coop' || isClient) { dmgNumber(e, true); sound.play('crit'); }
        break;
      }
      case 'special': {
        sound.play('special');
        const d = typeof e.t === 'string' && Object.hasOwn(TOWERS, e.t) ? TOWERS[e.t as TowerType] : null;
        if (d?.special && e.p === me) toast(`${d.special.name} fired. ${d.name} reboots afterwards.`);
        break;
      }
      case 'down': sound.play('down'); break;
      case 'up': sound.play('up'); break;
      case 'heroOn':
        sound.play('heroOn');
        if (e.p === me) { flash(); document.body.classList.add('hero'); show('herohud'); sound.intense = 1; speed = 1; setText('btn-speed', '1x'); buildType = null; selected = 0; view.setGhost(null); view.setSelected(null); view.setHover(0, 0, false); faceEnemies(); }
        else toast('Your partner uplinked.');
        break;
      case 'heroOff':
        sound.play('heroOff');
        if (e.p === me) { flash(); document.body.classList.remove('hero'); show('herohud', false); sound.intense = 0; mouseFire = false; view.setTele(null); if (document.pointerLockElement) document.exitPointerLock(); }
        break;
      case 'wave': {
        sound.play('wave');
        const tier = sim.tier, last = sim.campaign && e.n >= sim.winWave;
        const sub = last ? 'Final wave' : e.n % 5 === 0 ? 'Colossus inbound' : tier !== lastTier ? `New bow: ${BOW_TIERS[tier].name}` : '';
        if (tier !== lastTier) { lastTier = tier; toast(`${BOW_TIERS[tier].name}: ${BOW_TIERS[tier].perk}`); }
        announce('Wave ' + e.n, sub);
        break;
      }
      case 'boss':
        sound.play('boss');
        if (!bot && !store.tips.boss) { store.tips.boss = true; save(); tutor('Aim for the exposed core'); }
        break;
      case 'clear': sound.play('clear'); toast(`Wave ${e.n} cleared, +${e.g} credits`); break;
      case 'levelup': sound.play('levelup'); break;
      case 'card': if (e.p !== me && typeof e.id === 'string' && Object.hasOwn(CARD_BY_ID, e.id)) toast('Partner took ' + CARD_BY_ID[e.id].name); break;
      case 'leak': { sound.play('leak'); const s = $('lives').parentElement!; s.classList.add('hurt'); setTimeout(() => s.classList.remove('hurt'), 500); break; }
      case 'incoming': sound.play('boss'); toast(`Incoming from your rival: ${int(e.n)} x ${typeof e.type === 'string' && Object.hasOwn(ENEMIES, e.type) ? ENEMIES[e.type as EnemyType].name : 'enemies'}`); break;
    }
  }
}
function faceEnemies() {
  const o = sim.heroOrigin(me);
  if (!o) return;
  let best = null as null | { x: number; z: number }, bd = 1e9;
  for (const e of sim.enemies) { const d = Math.hypot(e.x - o.x, e.z - o.z); if (d < bd) { bd = d; best = e; } }
  view.yaw = best ? Math.atan2(best.x - o.x, best.z - o.z) : Math.PI / 2;
  view.pitch = -0.22;
}

// ---------- game flow ----------
function fastForward(seconds: number) {
  for (let i = 0; i < seconds * 60 && !sim.over; i++) { bot?.step(STEP); sim.step(STEP); sim.events.length = 0; }
}
function resetUi() {
  for (const id of ['cards', 'menu', 'lobby', 'help', 'settings', 'music', 'pause', 'end', 'herohud', 'tower', 'vs', 'tip', 'setup', 'editor', 'tutor']) show(id, false);
  document.body.classList.remove('hero');
  clearTimeout(endTimer); clearTimeout(tutorTimer);
  $('toasts').textContent = ''; $('dmg').textContent = ''; $('notes').textContent = '';
  lastRx = performance.now(); squadTokens = 3;
  if (document.pointerLockElement) document.exitPointerLock();
  buildType = null; selected = 0; mouseFire = false; dragging = false; paused = false; speed = 1; acc = 0; cardKey = ''; ended = false; readyShown = false; lastTier = 0;
  runKey = ''; runWon = false; tipHover = null;
  sound.intense = 0;
  setText('btn-speed', '1x');
}
function bestLine() {
  let wave = 0, surv = 0, wins = 0;
  for (const r of Object.values(store.records)) { wave = Math.max(wave, r.wave); surv = Math.max(surv, r.surv); wins += r.wins; }
  return [wave ? `Best campaign: wave ${wave}` : '', wins ? `${wins} ${wins === 1 ? 'win' : 'wins'}` : '', surv ? `Best survival: wave ${surv}` : ''].filter(Boolean).join(' / ');
}
function startAttract() {
  resetUi();
  if (setupStale) { setupStale = false; loadSetup(); }
  net?.close(); net = null; isClient = false;
  mode = 'attract'; me = 0;
  sim = new Sim({ pauseOnCards: false });
  bot = new Bot(sim, 0, 1);
  fastForward(150);
  view.setSim(sim, 0); view.orbit = true;
  show('hud', false); show('menu');
  setText('best', bestLine());
}
function startGame(m: Mode, opts: { client?: boolean; seed?: number; demo?: boolean; map?: MapDef; diff?: string; survival?: boolean } = {}) {
  resetUi();
  mode = m; isClient = !!opts.client; me = isClient ? 1 : 0;
  sim = new Sim({
    mode: m, players: m === 'coop' ? 2 : 1, pauseOnCards: m === 'solo' && !opts.demo, seed: opts.seed ?? ((Math.random() * 2 ** 31) | 0),
    map: opts.map ?? choice.map, diff: opts.diff ?? choice.diff, survival: m === 'versus' ? false : opts.survival ?? choice.survival,
  });
  sim.replica = isClient;
  bot = opts.demo ? new Bot(sim, 0, 1.5) : null;
  view.setSim(sim, me); view.orbit = false;
  view.cam.x = 0; view.cam.z = 1.5; view.cam.dist = 48;
  show('hud'); show('vs', m === 'versus');
  show('btn-speed', m === 'solo'); show('btn-pause', true);
  rival = { l: 20, w: 0, k: 0 };
  sound.init(); sound.startMusic();
  if (m === 'solo' && !opts.demo) {
    const key = `${mapKeyOf(opts.map ?? choice.map)}|${sim.diff.id}`;
    runKey = REC_KEY.test(key) ? key : '';
  }
  if (!opts.demo) {
    announce('Defend the Heart', m === 'coop' ? 'Co-op link is up' : m === 'versus' ? 'Outlast your rival' : `${sim.map.def.name} / ${sim.endless ? 'Survival' : `${sim.diff.name}, ${sim.winWave} waves`}`);
    setTimeout(() => {
      if (sim.wave === 0 && mode === m && !ended) toast(touchUi() ? 'Tap a tower below, then tap a hex beside the road.' : 'Pick a tower below (or press 1), then click a hex beside the road.');
    }, 1500);
  }
}
/** Update the saved record of the run that just ended. Returns what to show on the end screen. */
function recordRun(win: boolean): { rec: Rec; newBest: boolean } | null {
  if (!runKey || bot) return null;
  if (!Object.hasOwn(store.records, runKey) && Object.keys(store.records).length >= MAX_RECORDS) {
    // The table is full. Make room by dropping the record that was played longest ago,
    // generated maps first (every seed has its own), then custom maps. Premade maps are never dropped.
    const all = Object.keys(store.records);
    const old = all.find((k) => k.startsWith('gen-')) || all.find((k) => k.startsWith('custom:'));
    if (!old) return null;
    delete store.records[old];
  }
  const rec: Rec = (Object.hasOwn(store.records, runKey) && store.records[runKey]) || { wave: 0, wins: 0, time: 0, surv: 0 };
  const survival = sim.opts.survival;
  // Waves held: the wave you died on does not count. A campaign that was continued with
  // "Keep going" still counts as that campaign, so its best stops at the last wave.
  const held = win ? sim.wave : Math.max(0, sim.wave - 1);
  let newBest = false;
  if (survival) { if (held > rec.surv) { rec.surv = held; newBest = true; } }
  else {
    const camp = Math.min(held, sim.winWave);
    if (camp > rec.wave) { rec.wave = camp; newBest = true; }
    if (win && !runWon) { runWon = true; rec.wins++; if (!rec.time || sim.time < rec.time) rec.time = sim.time; }
  }
  // written last again, so the keys stay ordered by when a map was last played
  delete store.records[runKey];
  store.records[runKey] = rec;
  save();
  return { rec, newBest };
}
function endGame(win: boolean, title?: string, sub?: string) {
  if (ended) return;
  ended = true;
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.remove('hero'); show('herohud', false); show('cards', false); show('tutor', false);
  sound.play(win ? 'win' : 'lose'); sound.intense = 0;
  const saved = recordRun(win);
  if (!win && sim.endless && !title) { title = 'Overrun'; sub = `You held the line for ${Math.max(0, sim.wave - 1)} waves.`; }
  const e = $('end');
  e.classList.toggle('win', win); e.classList.toggle('lose', !win);
  setText('end-title', title || (win ? 'Grid secured' : 'Core breached'));
  setText('end-sub', sub || (win ? `All ${sim.winWave} waves held. Nyx-9 lives another night.` : `The Heart fell on wave ${sim.wave} of ${sim.winWave}.`));
  const st = $('end-stats'); st.textContent = '';
  const row = (k: string, v: string | number, hot = false) => st.append(el('span', '', k), el('b', hot ? 'hot' : '', String(v)));
  row('Wave reached', sim.campaign ? `${sim.wave} / ${sim.winWave}` : sim.wave);
  row('Machines destroyed', sim.kills); row('Level', sim.level);
  row('Towers standing', sim.towers.length); row('Time', clock(sim.time));
  if (mode === 'versus') row('Enemies sent', sim.sent);
  if (saved) {
    const r = saved.rec;
    if (sim.opts.survival) row('Best survival on this map', `wave ${r.surv}${saved.newBest ? ' (new)' : ''}`, saved.newBest);
    else {
      row('Best on this map', `wave ${r.wave}${saved.newBest ? ' (new)' : ''}`, saved.newBest);
      if (r.wins) row('Wins / fastest', `${r.wins} / ${clock(r.time)}`);
    }
  }
  show('e-endless', win && mode === 'solo');
  setText('e-again', mode === 'solo' ? 'Play again' : 'Back to lobby');
  for (const id of OVERLAYS) show(id, false);
  endTimer = window.setTimeout(() => show('end'), win ? 1200 : 1800);
}

// ---------- multiplayer ----------
const NET_V = 3;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown) => (fin(v) ? Math.trunc(v) : -1);
/** a world coordinate from a peer: finite and somewhere near the board */
const pt = (m: Msg): m is Msg & { x: number; y: number; z: number } => fin(m.x) && fin(m.y) && fin(m.z) && Math.abs(m.x) < 500 && Math.abs(m.y) < 500 && Math.abs(m.z) < 500;

function onNet(m: Msg) {
  if (!net) return;
  if (m.t === 'start' && !net.isHost && mode === 'attract') {
    const map = sanitizeMap(m.map);
    if (m.v !== NET_V || (m.m !== 'coop' && m.m !== 'versus') || !map) { lobbyStatus('l-join-status', 'Version mismatch. Both players should reload the page.'); return; }
    startGame(m.m, { client: m.m === 'coop', seed: int(m.seed) >>> 0, map, diff: diffById(m.diff).id, survival: m.surv === true });
    return;
  }
  if (mode === 'coop' && isClient && m.t === 'snap') { lastRx = performance.now(); sim.applySnapshot(m.s); return; }
  if (mode === 'coop' && !isClient && m.t === 'in') {
    // Everything a guest can do arrives here. The sim checks the rules (credits, unlocks, Spires only,
    // sell blocks); this only makes sure the arguments have the right shape before they get there.
    const p = sim.players[1];
    if (!p || typeof m.a !== 'string') return;
    lastRx = performance.now();
    switch (m.a) {
      case 'build': { const ty = TOWER_TYPES[int(m.ty)], cx = int(m.cx), cz = int(m.cz); if (ty && cx >= 0 && cz >= 0 && cx < GW && cz < GH) sim.build(ty, cx, cz); break; }
      case 'up': if (int(m.id) > 0) sim.upgrade(int(m.id)); break;
      case 'sell': if (int(m.id) > 0) sim.sell(int(m.id)); break;
      case 'card': { const i = int(m.i); if (i >= 0 && i < 3) sim.pickCard(1, i); break; }
      case 'hero': sim.activateHero(1, Math.max(0, int(m.id))); break;
      case 'exit': sim.exitHero(1); break;
      case 'tele': if (int(m.id) > 0) sim.heroTeleport(1, int(m.id)); break;
      case 'fire': if (pt(m)) sim.heroFire(1, m.x, m.y, m.z); break;
      case 'skill': { const s = int(m.s); if (s >= 0 && s < 3 && pt(m)) sim.heroSkill(1, s, m.x, m.y, m.z); break; }
      case 'look': if (fin(m.y) && fin(m.p)) { p.yaw = m.y % (Math.PI * 2); p.pitch = clamp(m.p, -1.4, 1.4); } break;
      case 'wave': sim.startWave(); break;
    }
    return;
  }
  if (mode === 'versus') {
    if (m.t === 'vs' && fin(m.l) && fin(m.w) && fin(m.k)) { lastRx = performance.now(); rival = { l: int(m.l), w: int(m.w), k: int(m.k) }; }
    // squads are rate-limited on the receiving side too: the sender's own cost check cannot be trusted
    else if (m.t === 'squad') { const s = SQUADS[int(m.i)]; if (s && squadTokens >= 1) { squadTokens -= 1; sim.injectSquad(s.type, s.n); } }
    else if (m.t === 'dead' && !sim.over) { sim.over = true; endGame(true, 'Victory', "Your rival's core has fallen."); }
  }
}
function onNetClose(why: string) {
  if (mode === 'attract') {
    lobbyStatus('l-host-status', why); lobbyStatus('l-join-status', why);
    net?.close(); net = null; show('l-code', false);
    ($('l-host') as HTMLButtonElement).disabled = false; ($('l-join') as HTMLButtonElement).disabled = false;
    return;
  }
  if (ended) return;
  if (mode === 'coop' && !isClient) { toast('Your partner disconnected. You fight on alone.'); net?.close(); net = null; return; }
  if (mode === 'versus') { sim.over = true; endGame(true, 'Victory', 'Your rival disconnected.'); return; }
  sim.over = true; endGame(false, 'Link lost', 'The host disconnected.');
}
const lobbyStatus = (id: string, s: string) => { $(id).textContent = s; };
function openLobby(m: 'coop' | 'versus') {
  lobbyMode = m;
  setText('lobby-title', m === 'coop' ? 'Co-op online' : '1 v 1 online');
  setText('lobby-sub', m === 'coop' ? 'Defend one grid together: two archers, shared credits. No account needed.' : 'Each of you defends your own grid. Spend credits to send squads at your rival. Last core standing wins.');
  show('menu', false); show('lobby'); show('l-code', false);
  lobbyStatus('l-host-status', ''); lobbyStatus('l-join-status', '');
  ($('l-host') as HTMLButtonElement).disabled = false; ($('l-join') as HTMLButtonElement).disabled = false;
  lobbyChoice();
}
/** The line that says which map and difficulty the host will start. An open room is left alone. */
function lobbyChoice() {
  const d = diffById(choice.diff), m = lobbyMode;
  setText('l-choice', `${choice.map.name} / ${d.name}${m === 'coop' && choice.survival ? ' / Survival' : m === 'coop' ? ` / ${d.waves} waves` : ''}`);
}
function newNet() {
  net?.close();
  net = new Net();
  net.onMsg = onNet; net.onClose = onNetClose;
  return net;
}
$('l-host').addEventListener('click', async () => {
  sound.init(); sound.play('click');
  ($('l-host') as HTMLButtonElement).disabled = true;
  lobbyStatus('l-host-status', 'Opening room...');
  const n = newNet(), m = lobbyMode;
  n.onOpen = () => {
    if (net !== n || mode !== 'attract') return;
    const seed = (Math.random() * 2 ** 31) | 0;
    // the guest runs this map through sanitizeMap before using it
    n.send({ t: 'start', v: NET_V, m, seed, map: choice.map, diff: choice.diff, surv: choice.survival });
    startGame(m, { seed });
  };
  try {
    const code = await n.host();
    if (net !== n) return;
    $('l-code').textContent = code; show('l-code');
    lobbyStatus('l-host-status', 'Share this code. Waiting for the other player...');
  } catch { if (net !== n) return; n.close(); net = null; lobbyStatus('l-host-status', 'Could not open a room. Check your connection and try again.'); ($('l-host') as HTMLButtonElement).disabled = false; }
});
$('l-join').addEventListener('click', async () => {
  sound.init(); sound.play('click');
  const code = cleanCode($<HTMLInputElement>('l-input').value);
  if (code.length !== 6) { lobbyStatus('l-join-status', 'Enter the 6-character room code.'); return; }
  ($('l-join') as HTMLButtonElement).disabled = true;
  lobbyStatus('l-join-status', 'Connecting...');
  const n = newNet();
  try { await n.join(code); if (net === n && mode === 'attract') lobbyStatus('l-join-status', 'Connected. Waiting for the host...'); }
  catch { if (net !== n) return; n.close(); net = null; lobbyStatus('l-join-status', 'Room not found. Check the code.'); ($('l-join') as HTMLButtonElement).disabled = false; }
});
$<HTMLInputElement>('l-input').addEventListener('input', (e) => { const i = e.target as HTMLInputElement; i.value = cleanCode(i.value); });
$('l-back').addEventListener('click', () => { net?.close(); net = null; show('lobby', false); show('menu'); });

// ---------- run setup: mode, difficulty, map ----------
const DIFF_TIER: Record<string, number> = { easy: 1, normal: 2, hard: 3 };
const TIER_NAME = ['', 'Simple', 'Tricky', 'Complex'];
let premade: MapDef = MAPS[0];
let srcPicked = false, genTimer = 0;
let mapCards: { def: MapDef; btn: HTMLElement; rec: HTMLElement }[] = [];

function regen() {
  let def: MapDef | null = null;
  try { def = generateMap(choice.seed, choice.tier); } catch { /* keep the map we had */ }
  if (!def) return;
  choice.map = def;
  drawMap($<HTMLCanvasElement>('gen-cv'), def);
}
function recText(m: MapDef): string {
  const r = recOf(mapKeyOf(m), choice.diff);
  if (!r) return '';
  if (choice.survival) return r.surv ? `Best: wave ${r.surv}` : '';
  return [r.wave ? `Best: wave ${r.wave}` : '', r.wins ? `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}, ${clock(r.time)}` : ''].filter(Boolean).join(' / ');
}
function refreshSetup() {
  const d = diffById(choice.diff), gen = choice.source === 'generated';
  const seg = (id: string, v: string) => { for (const c of $(id).children) c.classList.toggle('on', (c as HTMLElement).dataset.v === v); };
  seg('setup-mode', choice.survival ? 'survival' : 'campaign');
  seg('setup-diff', choice.diff);
  seg('setup-src', choice.source);
  seg('gen-tier', String(choice.tier));
  show('map-row', !gen); show('gen', gen);
  for (const c of mapCards) {
    c.btn.classList.toggle('on', !gen && c.def === choice.map);
    const t = recText(c.def);
    c.rec.textContent = t; c.rec.classList.toggle('hidden', !t);
  }
  if (gen) {
    const lanes = choice.map.lanes.length, sp = choice.map.towers.filter((x) => x.t === 'spire').length || 1, t = recText(choice.map);
    setText('gen-info', `${choice.map.name}. ${lanes} ${lanes === 1 ? 'road' : 'roads'}, ${sp} ${sp === 1 ? 'Spire' : 'Spires'} to start.${t ? ' ' + t + '.' : ''} The same seed and layout always give the same map.`);
  }
  const waves = setupFor === 'lobby' && lobbyMode === 'versus' ? 'No last wave: the last core standing wins.' : choice.survival ? 'Survival has no last wave.' : `${d.waves} waves to win.`;
  setText('setup-desc', `${choice.map.desc || 'A custom map.'} ${d.name}: ${d.desc} ${waves}`);
}
function setSource(src: 'premade' | 'generated') {
  choice.source = src;
  if (src === 'generated') regen(); else choice.map = premade;
}
function setTierAuto() { if (choice.tierAuto) choice.tier = DIFF_TIER[choice.diff] || 2; }
function openSetup(target: 'solo' | 'lobby') {
  setupFor = target;
  srcPicked = false;
  for (const id of ['menu', 'lobby', 'editor']) show(id, false);
  const all = [...MAPS, ...loadCustomMaps()];
  if (choice.source === 'premade') {
    const same = all.find((m) => m === choice.map || (m.id === choice.map.id && m.name === choice.map.name));
    if (same) choice.map = same; else all.push(choice.map);
    premade = choice.map;
  }
  const row = $('map-row');
  row.textContent = '';
  mapCards = [];
  for (const m of all) {
    const b = el('button', 'mapcard') as HTMLButtonElement;
    b.type = 'button';
    const cv = document.createElement('canvas'); cv.width = 208; cv.height = 144;
    drawMap(cv, m);
    const rec = el('span', 'rec');
    b.append(cv, el('b', '', m.name), el('span', '', `${TIER_NAME[m.tier] || 'Custom'} / ${m.lanes.length} ${m.lanes.length > 1 ? 'roads' : 'road'}`), rec);
    b.addEventListener('click', () => { premade = m; choice.map = m; choice.source = 'premade'; sound.play('click'); refreshSetup(); });
    row.appendChild(b);
    mapCards.push({ def: m, btn: b, rec });
  }
  const df = $('setup-diff');
  df.textContent = '';
  for (const d of DIFFS) {
    const b = el('button', 'chip') as HTMLButtonElement;
    b.type = 'button';
    b.dataset.v = d.id;
    b.append(el('span', '', d.name), el('small', '', `${d.waves} waves`));
    b.addEventListener('click', () => {
      choice.diff = d.id; sound.play('click');
      if (choice.tierAuto && choice.tier !== DIFF_TIER[d.id]) { setTierAuto(); if (choice.source === 'generated') regen(); }
      refreshSetup();
    });
    df.appendChild(b);
  }
  $<HTMLInputElement>('gen-seed').value = String(choice.seed);
  if (choice.source === 'generated') regen();
  show('setup-mode', lobbyMode !== 'versus' || target === 'solo');
  setText('setup-go', target === 'solo' ? 'Start' : 'Use this map');
  refreshSetup();
  show('setup');
}
for (const b of $('setup-mode').children) b.addEventListener('click', () => {
  choice.survival = (b as HTMLElement).dataset.v === 'survival';
  sound.play('click');
  // Survival starts from a generated map unless the player has already chosen a source on this screen
  if (choice.survival && !srcPicked) setSource('generated');
  refreshSetup();
});
for (const b of $('setup-src').children) b.addEventListener('click', () => {
  srcPicked = true; sound.play('click');
  setSource((b as HTMLElement).dataset.v === 'generated' ? 'generated' : 'premade');
  refreshSetup();
});
for (const b of $('gen-tier').children) b.addEventListener('click', () => {
  choice.tier = clamp(+((b as HTMLElement).dataset.v || 2) | 0, 1, 3); choice.tierAuto = false;
  sound.play('click'); regen(); refreshSetup();
});
$('gen-dice').appendChild(icon('M2.5 1h11A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11A1.5 1.5 0 0 1 2.5 1zM5 3.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 0 0 0-2.8zM11 3.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 0 0 0-2.8zM8 6.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 0 0 0-2.8zM5 9.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 0 0 0-2.8zM11 9.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 0 0 0-2.8z'));
$('gen-dice').addEventListener('click', () => {
  sound.init(); sound.play('click');
  choice.seed = newSeed();
  $<HTMLInputElement>('gen-seed').value = String(choice.seed);
  regen(); refreshSetup();
});
$<HTMLInputElement>('gen-seed').addEventListener('input', (e) => {
  const i = e.target as HTMLInputElement;
  i.value = i.value.replace(/\D/g, '').slice(0, 9);
  choice.seed = clamp(parseInt(i.value || '0', 10) || 0, 0, 999999999);
  clearTimeout(genTimer);
  genTimer = window.setTimeout(() => { regen(); refreshSetup(); }, 120);
});
function saveSetup() {
  clearTimeout(genTimer);
  if (choice.source === 'generated') regen();
  store.setup = { survival: choice.survival, source: choice.source, map: premade.id, mapName: premade.name, seed: choice.seed, tier: choice.tier, tierAuto: choice.tierAuto, diff: choice.diff };
  save();
}
/** Bring the saved setup back. Called at boot and after a progress reset. */
function loadSetup() {
  const u = store.setup;
  choice.diff = diffById(u.diff).id; choice.survival = u.survival; choice.source = u.source;
  choice.seed = u.seed; choice.tier = u.tier; choice.tierAuto = u.tierAuto;
  setTierAuto();
  premade = mapById(u.map) || loadCustomMaps().find((m) => m.id === u.map && m.name === u.mapName) || MAPS[0];
  choice.map = premade;
  if (choice.source === 'generated') { try { choice.map = generateMap(choice.seed, choice.tier); } catch { choice.source = 'premade'; } }
}
function openEditorScreen() {
  for (const id of ['menu', 'setup', 'lobby']) show(id, false);
  show('editor');
  openEditor($('editor'), {
    play(def) { choice.map = def; premade = def; choice.source = 'premade'; choice.survival = false; show('editor', false); startGame('solo'); },
    close() { show('editor', false); show('menu'); },
    sound(name) { sound.play(name); },
  }, choice.source === 'generated' || MAPS.includes(choice.map) ? undefined : choice.map);
}
loadSetup();

// ---------- music sheet (the playlist UI itself is built by the music module) ----------
const music = initMusic({
  root: $('music-root'),
  setScoreMuted: (muted) => sound.setScoreMuted(!!muted),
  toast,
  click: () => { sound.init(); sound.play('click'); },
});
let musicFrom = 'menu';
function openMusic(from: string) {
  musicFrom = from;
  show(from, false); show('music');
  music.open();
}

// ---------- menus ----------
const click = (id: string, fn: () => void) => $(id).addEventListener('click', () => { sound.init(); sound.play('click'); fn(); });
let helpFrom = 'menu', setFrom = 'menu';
click('m-solo', () => openSetup('solo'));
click('m-editor', () => openEditorScreen());
click('l-change', () => openSetup('lobby'));
click('setup-back', () => { show('setup', false); show(setupFor === 'solo' ? 'menu' : 'lobby'); });
click('setup-editor', () => openEditorScreen());
click('setup-go', () => { saveSetup(); show('setup', false); if (setupFor === 'solo') startGame('solo'); else { show('lobby'); lobbyChoice(); } });
click('m-coop', () => openLobby('coop'));
click('m-versus', () => openLobby('versus'));
click('m-help', () => { helpFrom = 'menu'; show('menu', false); show('help'); });
click('m-settings', () => { setFrom = 'menu'; show('menu', false); openSettings(); });
click('m-music', () => openMusic('menu'));
click('h-back', () => { show('help', false); show(helpFrom); });
click('s-back', () => { show('settings', false); show(setFrom); save(); });
click('mu-back', () => { show('music', false); show(musicFrom); });
click('p-resume', () => togglePause(false));
click('p-help', () => { helpFrom = 'pause'; show('pause', false); show('help'); });
click('p-settings', () => { setFrom = 'pause'; show('pause', false); openSettings(); });
click('p-music', () => openMusic('pause'));
click('p-quit', () => { sound.stopMusic(); startAttract(); });
click('e-again', () => { if (mode === 'solo') startGame('solo'); else { const m = mode === 'versus' ? 'versus' : 'coop'; sound.stopMusic(); startAttract(); openLobby(m); } });
click('e-menu', () => { sound.stopMusic(); startAttract(); });
click('e-endless', () => { sim.exitHero(me); sim.over = false; sim.won = false; sim.endless = true; sim.nextWaveIn = 5; ended = false; show('end', false); toast('No last wave from here on. How far can you go?'); });
// A HUD button must not keep the keyboard focus, or Space (the Uplink key) would press it again.
$('hud').addEventListener('click', () => { const a = document.activeElement; if (a instanceof HTMLButtonElement) a.blur(); });
click('btn-pause', () => togglePause());
click('btn-speed', () => { speed = speed === 1 ? 2 : 1; setText('btn-speed', speed + 'x'); });
click('btn-wave', () => act.wave());
click('ult', () => tryUlt());
click('t-up', () => { if (selected) act.upgrade(selected); });
click('t-sell', () => { if (selected && act.sell(selected)) selected = 0; });
function togglePause(on = !menuOpen()) {
  if (mode === 'attract' || ended) return;
  paused = on && mode === 'solo';
  for (const id of OVERLAYS) show(id, false);
  show('pause', on);
  if (on && document.pointerLockElement) document.exitPointerLock();
  if (!on && heroOn()) lockPointer();
}

// ---------- settings ----------
const bind = (id: string, key: 'vol' | 'mus' | 'sens', fn: (v: number) => void) => {
  const i = $<HTMLInputElement>(id);
  i.value = String(settings[key]);
  i.addEventListener('input', () => { settings[key] = clamp(+i.value || 0, +i.min, +i.max); fn(settings[key]); });
  i.addEventListener('change', save);
};
bind('set-vol', 'vol', (v) => sound.setVolume(v / 100));
bind('set-mus', 'mus', (v) => sound.setMusic(v / 100));
bind('set-sens', 'sens', () => {});
const qsel = $<HTMLSelectElement>('set-q');
qsel.value = settings.q;
qsel.addEventListener('change', () => { settings.q = qsel.value === 'low' ? 'low' : 'high'; view.setQuality(settings.q); save(); });

// effects
const FX_BOXES: [string, 'impact' | 'beat' | 'borders' | 'env' | 'towers'][] = [['fx-impact', 'impact'], ['fx-beat', 'beat'], ['fx-borders', 'borders'], ['fx-env', 'env'], ['fx-towers', 'towers']];
function syncFxUi() {
  const f = store.fx;
  for (const [id, key] of FX_BOXES) $<HTMLInputElement>(id).checked = f[key];
  $<HTMLInputElement>('fx-int').value = String(f.intensity);
  $<HTMLInputElement>('fx-custom').value = f.custom;
  $('fx-custom').classList.toggle('on', f.color === 'custom');
  for (const c of $('fx-color').querySelectorAll('button')) c.classList.toggle('on', c.dataset.v === f.color);
}
for (const [id, key] of FX_BOXES) $<HTMLInputElement>(id).addEventListener('change', (e) => { store.fx[key] = (e.target as HTMLInputElement).checked; sound.play('click'); applyFx(); save(); });
$<HTMLInputElement>('fx-int').addEventListener('input', (e) => { store.fx.intensity = clamp(Math.round(+(e.target as HTMLInputElement).value || 0), 0, 100); applyFx(); });
$<HTMLInputElement>('fx-int').addEventListener('change', save);
for (const c of $('fx-color').querySelectorAll('button')) {
  if (c.dataset.v && c.dataset.v !== 'auto' && Object.hasOwn(FX_COLORS, c.dataset.v)) c.style.setProperty('--sw', hex(FX_COLORS[c.dataset.v as keyof typeof FX_COLORS]));
  c.addEventListener('click', () => {
    const v = c.dataset.v;
    store.fx.color = v === 'sand' || v === 'apricot' || v === 'verdigris' ? v : 'auto';
    sound.play('click'); syncFxUi(); applyFx(); save();
  });
}
$<HTMLInputElement>('fx-custom').addEventListener('input', (e) => {
  const v = (e.target as HTMLInputElement).value;
  if (!/^#[0-9a-f]{6}$/i.test(v)) return;
  store.fx.custom = v.toLowerCase(); store.fx.color = 'custom';
  syncFxUi(); applyFx(); save();
});

// reset progress, with a second step instead of a browser dialog
const RESET_IDLE = 'Records, last run setup and tips are saved in this browser.';
function resetStep(asking: boolean, text = RESET_IDLE) {
  show('s-reset', !asking); show('s-reset-yes', asking); show('s-reset-no', asking);
  $('reset-text').textContent = text;
}
click('s-reset', () => resetStep(true, 'Delete all records, the last run setup and the tips? Sound and effects settings stay.'));
click('s-reset-no', () => resetStep(false));
click('s-reset-yes', () => {
  store.records = {}; store.tips = { node: false, boss: false }; store.setup = defaultSetup();
  save();
  // a run in progress keeps its own choice; the defaults are loaded when it goes back to the menu
  if (mode === 'attract') loadSetup(); else setupStale = true;
  setText('best', bestLine());
  resetStep(false, 'Progress deleted.');
});
function openSettings() { syncFxUi(); resetStep(false); show('settings'); }

// ---------- fullscreen (mostly for phones and tablets) ----------
{
  const ENTER = 'M1 1h5v2H3v3H1zM10 1h5v5h-2V3h-3zM1 10h2v3h3v2H1zM13 10h2v5h-5v-2h3z';
  const LEAVE = 'M4 1h2v5H1V4h3zM10 1h2v3h3v2h-5zM1 10h5v5H4v-3H1zM10 10h5v2h-3v3h-2z';
  const b = el('button', 'chip') as HTMLButtonElement;
  b.id = 'btn-full';
  b.type = 'button';
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const isFull = () => !!(document.fullscreenElement || doc.webkitFullscreenElement);
  b.addEventListener('click', async () => {
    sound.init(); sound.play('click');
    try {
      if (isFull()) { if (document.exitFullscreen) await document.exitFullscreen(); else doc.webkitExitFullscreen?.(); }
      else {
        if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' }); else root.webkitRequestFullscreen?.();
        // phones: landscape is the only comfortable way to play
        const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        so?.lock?.('landscape').catch(() => {});
      }
    } catch { toast('Fullscreen is not available in this browser.'); }
  });
  const sync = () => {
    const full = isFull(), label = full ? 'Leave fullscreen' : 'Fullscreen';
    b.textContent = '';
    b.appendChild(icon(full ? LEAVE : ENTER));
    b.title = label; b.setAttribute('aria-label', label);
    view.resize();
  };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
  // The button is fixed in the top right corner. The class makes the top bar and the sheets keep that corner free.
  if (typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function') { document.body.classList.add('has-full'); document.body.appendChild(b); }
}

// ---------- input: shared by mouse, keyboard and touch ----------
// A device can have both a touch screen and a mouse, so the input that was used last decides.
addEventListener('pointerdown', (e) => { byTouch = e.pointerType === 'touch'; }, { capture: true, passive: true });
function lockPointer() {
  if (byTouch) return; // a finger aims by dragging, there is no pointer to lock
  try { const r = canvas.requestPointerLock() as unknown; if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {}); } catch { /* not allowed */ }
}
const lastMouse = { x: innerWidth / 2, y: innerHeight / 2 };
const playing = () => mode !== 'attract' && !ended && !bot;
/** true while the player's input should reach the game: no menu sheet and no card picker in the way */
const active = () => playing() && !paused && !menuOpen() && !shown('cards');
const spires = () => sim.towers.filter((t) => t.type === 'spire');

/** Space, the Uplink bar or the touch button: uplink to the Spire nearest the selection or the cursor, or leave. */
function tryUlt() {
  if (!active()) return;
  const p = sim.players[me];
  if (p.heroActive) { act.exit(); return; }
  if (p.energy < MAX_ENERGY) { sound.play('error'); note(`Uplink is still charging: ${Math.floor((p.energy / MAX_ENERGY) * 100)}%.`); return; }
  const list = spires();
  if (!list.length) { sound.play('error'); note('There is no Uplink Spire on the grid. Build one first: Kestrel can only stand on Spires.'); return; }
  const sel = sim.towerById(selected);
  let id = sel && sel.type === 'spire' ? sel.id : 0;
  if (!id) {
    let x: number, z: number;
    if (sel) { x = sel.x; z = sel.z; } else { view.groundPoint(lastMouse.x, lastMouse.y, gp); x = gp.x; z = gp.z; }
    let bd = Infinity;
    for (const t of list) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; id = t.id; } }
  }
  act.hero(id);
  lockPointer();
}
/**
 * The Spire in the sights, or 0. Starts from the view's pick and falls back to the Spire closest to the
 * crosshair on screen, with a wider margin for thumbs.
 */
function aimSpire(): number {
  const p = sim.players[me];
  const t = sim.towerById(view.aimTower());
  if (t && t.type === 'spire' && t.id !== p.heroTower) return t.id;
  let best = 0, bd = touchUi() ? innerHeight * 0.22 : 44;
  for (const s of sim.towers) {
    if (s.type !== 'spire' || s.id === p.heroTower) continue;
    const [x, y, ok] = view.project(s.x, s.h + 0.5, s.z);
    if (!ok) continue;
    const d = Math.hypot(x - innerWidth / 2, y - innerHeight / 2);
    if (d < bd) { bd = d; best = s.id; }
  }
  return best;
}
function tryTele() {
  if (!active() || !heroOn()) return;
  const id = aimSpire();
  if (id) { act.tele(id); return; }
  sound.play('error');
  note(spires().length < 2 ? 'Kestrel can only jump between Uplink Spires. Build a second one.' : 'Aim at another Uplink Spire to jump to it.');
}
function castSkill(i: number) { if (active() && heroOn()) { view.aimPoint(aim); act.skill(i, aim); } }
function look(dx: number, dy: number) {
  const s = 0.0022 * (settings.sens / 100);
  view.yaw -= dx * s;
  view.pitch = clamp(view.pitch - dy * s, -1.25, 0.6);
}
function clampCam() { view.cam.x = clamp(view.cam.x, -30, 30); view.cam.z = clamp(view.cam.z, -22, 24); }
function pan(dx: number, dy: number) { const k = view.cam.dist * 0.0016; view.cam.x -= dx * k; view.cam.z -= dy * k * 1.3; clampCam(); }
/** factor above 1 zooms in */
function zoom(factor: number) { if (factor > 0 && Number.isFinite(factor)) view.cam.dist = clamp(view.cam.dist / factor, 20, 84); }
function hoverAt(clientX: number, clientY: number) {
  lastMouse.x = clientX; lastMouse.y = clientY;
  view.groundPoint(clientX, clientY, gp);
  [hover.cx, hover.cz] = worldToCell(gp.x, gp.z);
  refreshGhost();
}
/** A click or tap on the board in the command view: build with the chosen tower, else select what is there. */
function boardTap(clientX: number, clientY: number, keep: boolean) {
  hoverAt(clientX, clientY);
  if (buildType) {
    if (act.build(buildType, hover.cx, hover.cz)) { if (!keep) { buildType = null; view.setGhost(null); } }
    else {
      sound.play('error');
      const free = hover.cx >= 0 && hover.cz >= 0 && hover.cx < GW && hover.cz < GH && sim.grid[hover.cz * GW + hover.cx] === 0;
      note(!free ? 'You cannot build there.' : sim.gold < sim.cost(buildType) ? 'Not enough credits.' : 'You cannot build there.');
    }
    refreshGhost();
    return;
  }
  const t = sim.towers.find((x) => x.cx === hover.cx && x.cz === hover.cz);
  selected = t ? t.id : 0;
  if (t) sound.play('click');
}
/** Any press skips the opening camera move, if the view has one running. */
function skipIntro() { if (vx.introActive?.()) { vx.skipIntro?.(); return true; } return false; }

addEventListener('keydown', (e) => {
  // Typing into a field is not a hotkey. A focused slider or checkbox does not type, so Escape and P still work there.
  const typing = e.target instanceof HTMLInputElement ? !['range', 'checkbox', 'color'].includes(e.target.type) : e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  if (typing) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  byTouch = false;
  if (!playing()) return;
  skipIntro();
  if (shown('cards')) { if (k >= '1' && k <= '3') pickCard(+k - 1); return; }
  if (k === 'escape') {
    if (heroOn() || document.pointerLockElement) return; // Esc releases the mouse; Space leaves the uplink
    if (buildType || selected) { buildType = null; selected = 0; view.setGhost(null); } else togglePause();
    return;
  }
  if (k === 'p') { togglePause(); return; }
  if (paused || menuOpen()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === ' ') { e.preventDefault(); if (!e.repeat) tryUlt(); return; }
  if (heroOn()) {
    if (e.repeat) return;
    if (k === 'q') castSkill(1); else if (k === 'e') castSkill(2); else if (k === 'f') tryTele();
    return;
  }
  const t = TOWER_TYPES.find((x) => TOWERS[x].key === k);
  if (t) pickBuild(t);
  else if (k === 'u' && selected) act.upgrade(selected);
  else if (k === 'x' && selected) { if (act.sell(selected)) selected = 0; }
  else if (k === 'n') act.wave();
  else if (k === 'g' && mode === 'solo') $('btn-speed').click();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); mouseFire = false; dragging = false; });

canvas.addEventListener('mousemove', (e) => {
  lastMouse.x = e.clientX; lastMouse.y = e.clientY;
  if (!playing()) return;
  if (heroOn()) { look(e.movementX, e.movementY); return; }
  if (dragging) pan(e.movementX, e.movementY);
  hoverAt(e.clientX, e.clientY);
});
/** A mouse press during the Uplink: grab the pointer again if it got away, then shoot. */
function heroMouse(e: MouseEvent) {
  if (!document.pointerLockElement) lockPointer();
  if (e.button === 0) mouseFire = true;
  else if (e.button === 2) castSkill(0);
  else if (e.button === 1) { e.preventDefault(); tryTele(); }
}
canvas.addEventListener('mousedown', (e) => {
  sound.init();
  if (!active()) return;
  if (skipIntro()) return;
  if (heroOn()) { heroMouse(e); return; }
  if (e.button === 2) { if (buildType) { buildType = null; view.setGhost(null); } else selected = 0; dragging = true; return; }
  if (e.button !== 0) return;
  boardTap(e.clientX, e.clientY, e.shiftKey);
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseFire = false; if (e.button === 2) dragging = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// With the touch controls on, the look pad lies over the left half of the canvas. A mouse press there counts too.
$('t-look').addEventListener('mousedown', (e) => { if (active() && heroOn()) heroMouse(e); });
$('t-look').addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!heroOn()) zoom(e.deltaY > 0 ? 1 / 1.1 : 1 / 0.9); }, { passive: false });
addEventListener('resize', () => view.resize());

// Touch: the same actions as above, driven by the touch module.
const touchApi = {
  canvas,
  isHero: heroOn,
  look(dx: number, dy: number) { if (active() && heroOn()) look(dx, dy); },
  fire(on: boolean) { if (on) sound.init(); touchFire = on; },
  skill(i: number) { if (i >= 0 && i < 3) castSkill(i); },
  teleport: tryTele,
  ult() { sound.init(); tryUlt(); },
  exitHero() { if (active() && heroOn()) act.exit(); },
  tap(clientX: number, clientY: number) { sound.init(); if (!active() || heroOn() || skipIntro()) return; boardTap(clientX, clientY, false); },
  hoverAt(clientX: number, clientY: number) { if (active() && !heroOn()) hoverAt(clientX, clientY); },
  pan(dx: number, dy: number) { if (active() && !heroOn()) pan(dx, dy); },
  zoom(factor: number) { if (active() && !heroOn()) zoom(factor); },
};
initTouch(touchApi);

// ---------- frame ----------
let nextKey = '';
function updateHud() {
  const p = sim.players[me];
  setText('wave', String(sim.wave));
  setText('wave-sub', sim.campaign ? '/ ' + sim.winWave : '');
  setText('lives', String(Math.max(0, sim.lives)));
  setText('gold', String(Math.floor(sim.gold)));
  setText('level', String(sim.level));
  setW('xpbar', sim.xp / sim.xpNext);
  setText('bow', BOW_TIERS[sim.tier].name);
  const hero = p.heroActive;
  setW('ultbar', p.energy / MAX_ENERGY);
  const ready = p.energy >= MAX_ENERGY && !hero;
  $('ult').classList.toggle('ready', ready);
  setText('ult-label', ready ? (touchUi() ? 'UPLINK READY' : 'UPLINK READY - PRESS SPACE') : `UPLINK ${Math.floor((p.energy / MAX_ENERGY) * 100)}%`);
  if (ready && !readyShown && !bot) { readyShown = true; sound.play('ready'); announce('Uplink ready', touchUi() ? 'Tap Uplink to stand on a Spire' : 'Press Space to stand on a Spire'); }
  if (!ready && !hero) readyShown = readyShown && p.energy > 50;
  const waiting = isClient ? sim.nextWaveIn >= 0 : !sim.queue.length;
  const canCall = waiting && !sim.over && !(sim.wave >= sim.winWave && sim.campaign);
  show('btn-wave', canCall && !hero);
  if (canCall) setText('wave-timer', `${Math.max(0, Math.ceil(sim.nextWaveIn))}s, +${Math.round(Math.max(0, sim.nextWaveIn) * 2)} cr`);
  for (const t of TOWER_TYPES) {
    const b = buildBtns[t], locked = !sim.unlocked.has(t), cost = sim.cost(t);
    b.classList.toggle('locked', locked);
    b.classList.toggle('poor', !locked && sim.gold < cost);
    b.classList.toggle('sel', buildType === t);
    const c = b.lastElementChild as HTMLElement, s = String(cost);
    if (c.textContent !== s) c.textContent = s;
  }
  // tooltip: the tower under the pointer, else the one picked for building (touch has no hover)
  const tipFor = hero ? null : tipHover || buildType;
  if (cache.tip !== String(tipFor)) { cache.tip = String(tipFor); if (tipFor) towerTip(tipFor); else show('tip', false); }

  // next wave summary in the top bar
  const pv = sim.preview;
  const nk = pv.wave + ':' + pv.lanes.map((l) => l.map((o) => o.type + o.n).join(',')).join('|');
  if (nk !== nextKey) {
    nextKey = nk;
    const sum: Group[] = [];
    for (const l of pv.lanes) for (const o of l) { const f = sum.find((x) => x.type === o.type); if (f) f.n += o.n; else sum.push({ type: o.type, n: o.n }); }
    setText('next-label', pv.wave > 0 ? `Next: wave ${pv.wave}` : 'Next wave');
    if (!enemyChips($('next-row'), pv.wave > 0 ? sum : []).length) $('next-row').appendChild(el('span', 'none', sim.campaign && sim.wave >= sim.winWave ? 'Last wave' : 'Nothing yet'));
  }

  updateTowerPanel(hero);
  if (hero) {
    setW('herobar', p.heroTime / p.heroDur);
    setText('hero-label', `UPLINK ACTIVE - ${Math.max(0, p.heroTime).toFixed(1)}s`);
    for (let s = 0; s < 3; s++) {
      const f = clamp(Math.max(0, p.cds[s]) / (SKILL_CD[s] * p.stats.cdr), 0, 1), h = (f * 100).toFixed(0) + '%';
      if (cache['cd' + s] === h) continue;
      cache['cd' + s] = h;
      // the keyboard skill row and the touch buttons show the same cooldown
      for (const id of ['sk-' + s, 't-s' + s]) { const box = $(id); (box.lastElementChild as HTMLElement).style.height = h; box.classList.toggle('cd', f > 0); }
    }
    if (!store.tips.node && !bot && sim.towers.some((t) => sim.specialReady(t))) { store.tips.node = true; save(); tutor('Shoot the glowing node on a tower to fire its special'); }
  }
  updateMarks(hero);
  updateIntel(hero);
  updateHints(hero);
  if (mode === 'versus') setText('vs-status', `Core ${rival.l} / Wave ${rival.w} / ${rival.k} kills`);
}

function updateTowerPanel(hero: boolean) {
  const t = selected ? sim.towerById(selected) : undefined;
  if (!t) { selected = 0; view.setSelected(null); }
  show('tower', !!t && !hero);
  if (!t) return;
  view.setSelected(t, sim.range(t));
  const d = TOWERS[t.type], sp = d.special;
  setText('t-name', `${d.name} / Mk ${t.lvl}`);
  const key = `${t.id}:${t.lvl}:${t.buff}:${sim.level}:${sim.towerDmg(t)}:${sim.towerRate(t)}:${sim.range(t)}:${t.spec > 0}:${t.down > 0}`;
  if (cache.tstats !== key) {
    cache.tstats = key;
    const st = $('t-stats'); st.textContent = '';
    const line = (k: string, v: string) => { st.append(k + ' ', el('b', '', v), el('br')); };
    if (t.type === 'spire') line('Arrow damage', `+${Math.round(15 * (t.lvl - 1))}%`);
    else if (t.type === 'beacon') line('Boost', `+${Math.round(sim.beaconBoost(t) * 100)}% damage`);
    else {
      if (d.dmg > 0) line('Damage', sim.towerDmg(t).toFixed(0));
      line(d.dmg > 0 ? 'Fire rate' : 'Pulse rate', sim.towerRate(t).toFixed(2) + '/s');
    }
    if (d.range > 0) line('Range', sim.range(t).toFixed(1));
    if (t.buff > 0) line('Beacon', 'boosted');
  }
  // special: name, what it does, charge, and what the tower is doing right now
  const box = $('t-spec');
  if (sp) {
    const total = sp.down * sim.mods.reboot;
    setText('t-spec-name', sp.name);
    setText('t-spec-desc', sp.desc);
    show('t-spec-bar', true);
    const state = t.down > 0 ? 'down' : t.spec > 0 ? 'run' : t.charge >= 1 ? 'ready' : 'charge';
    if (cache.tspec !== state) { cache.tspec = state; box.className = state; }
    setW('t-spec-bar', state === 'down' ? 1 - t.down / Math.max(0.1, total) : state === 'charge' ? t.charge : 1);
    setText('t-spec-state', state === 'down' ? `Offline - rebooting ${Math.ceil(t.down)}s` : state === 'run' ? `Running - ${Math.ceil(t.spec)}s left`
      : state === 'ready' ? 'Ready. Shoot its node during an Uplink.' : `Charging ${Math.floor(t.charge * 100)}%`);
  } else {
    setText('t-spec-name', 'Uplink point');
    setText('t-spec-desc', 'Kestrel stands here during the Uplink and can jump to other Spires. Each upgrade adds 15% arrow damage.');
    if (cache.tspec !== 'spire') { cache.tspec = 'spire'; box.className = 'spire'; }
    setW('t-spec-bar', 0);
    setText('t-spec-state', sim.players.some((q) => q.heroActive && q.heroTower === t.id) ? 'Kestrel is here.' : '');
  }
  const up = $<HTMLButtonElement>('t-up');
  setText('t-up', t.lvl >= 3 ? 'Max level' : `Upgrade${touchUi() ? '' : ' (U)'} - ${sim.upCost(t)}`);
  up.disabled = t.lvl >= 3 || sim.gold < sim.upCost(t);
  const why = sellReason(t);
  setText('t-sell', `Sell${touchUi() ? '' : ' (X)'} +${sim.sellValue(t)}`);
  $<HTMLButtonElement>('t-sell').disabled = !!why;
  setText('t-note', why);
}

// "upgrade available" chevrons floating over towers you can afford to upgrade
const marks: HTMLElement[] = [];
function updateMarks(hero: boolean) {
  let n = 0;
  if (!hero && !ended && view.heroBlend < 0.05) {
    for (const t of sim.towers) {
      if (t.lvl >= 3 || sim.gold < sim.upCost(t) || n >= 40) continue;
      const [x, y, ok] = view.project(t.x, t.h + 0.9, t.z);
      if (!ok) continue;
      let m = marks[n];
      if (!m) { m = marks[n] = el('i', 'mark'); m.appendChild(icon('M8 3l6 8H2z')); $('marks').appendChild(m); }
      m.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      m.style.display = 'block';
      n++;
    }
  }
  for (let i = n; i < marks.length; i++) marks[i].style.display = 'none';
}

// Wave intel: a tag over each spawn gate with what the next wave sends down that road.
const intel: { box: HTMLElement; n: number; cls: string; w: number; h: number }[] = [];
let intelKey = '';
function updateIntel(hero: boolean) {
  const pv = sim.preview, lanes = sim.map.lanes;
  const key = lanes.length + '/' + nextKey;
  if (key !== intelKey) {
    intelKey = key;
    while (intel.length < lanes.length) { const box = el('div', 'itag'); $('intel').appendChild(box); intel.push({ box, n: 0, cls: '', w: 0, h: 0 }); }
    intel.forEach((tag, i) => {
      tag.box.textContent = '';
      tag.n = 0; tag.cls = ''; tag.w = 0; tag.h = 0;
      const list = (pv.wave > 0 && i < lanes.length && pv.lanes[i]) || [];
      const body = el('span', 'ibody');
      const ok = enemyChips(body, list);
      tag.n = ok.length;
      if (!tag.n) return;
      tag.cls = ok.some((o) => o.type === 'boss') ? ' boss' : '';
      tag.box.append(el('span', 'iw', 'W' + pv.wave), body);
    });
  }
  const W = innerWidth, H = innerHeight, phone = H <= 480;
  const top = (phone ? 50 : 62) + 28, bottom = H - (hero ? 16 : (phone ? 74 : 92) + 16);
  const blend = view.heroBlend;
  // full strength up close, fainter when zoomed far out, and only a faint dot from the Spire
  const alpha = hero || blend > 0.3 ? 0.45 : 1 - 0.55 * clamp((view.cam.dist - 58) / 24, 0, 1);
  for (let i = 0; i < intel.length; i++) {
    const tag = intel[i], s = tag.box.style;
    if (!tag.n || i >= lanes.length || ended) { s.display = 'none'; continue; }
    const g = lanes[i].pts[0];
    const [x, y, ok] = view.project(g[0], (lanes[i].ys[0] || 0) + 2.6, g[1]);
    // from the Spire a gate can be behind the camera: then there is nothing sensible to point at
    if (!ok && (hero || blend > 0.3)) { s.display = 'none'; continue; }
    // A gate just past the edge of the view keeps its tag, pushed back inside. Further out it becomes a dot on the edge.
    const off = !ok || x < -40 || x > W + 40 || y < top - 40 || y > H + 20;
    const dot = off || hero || blend > 0.3;
    const cls = 'itag' + tag.cls + (dot ? ' dot' : '');
    if (tag.box.className !== cls) tag.box.className = cls;
    s.display = '';
    s.opacity = alpha.toFixed(2);
    if (!dot && !tag.w) { tag.w = tag.box.offsetWidth; tag.h = tag.box.offsetHeight; }
    const hw = dot ? 14 : tag.w / 2 + 8;
    s.transform = `translate(${clamp(x, hw, W - hw).toFixed(0)}px, ${clamp(y, top + (dot ? 0 : tag.h), bottom).toFixed(0)}px)`;
  }
}

// Uplink hints: a small marker over every tower whose special is ready, and over the other Spires.
const hints: { box: HTMLElement; label: HTMLElement; cls: string; text: string }[] = [];
function updateHints(hero: boolean) {
  let n = 0;
  if (hero && !ended) {
    const p = sim.players[me], cx = innerWidth / 2, cy = innerHeight / 2;
    for (const t of sim.towers) {
      if (n >= 24) break;
      const spire = t.type === 'spire';
      if (spire ? t.id === p.heroTower : !sim.specialReady(t)) continue;
      nodePos(t, P3);
      const [x, y, ok] = view.project(P3.x, spire ? t.h + 0.9 : P3.y, P3.z);
      if (!ok) continue;
      let h = hints[n];
      if (!h) { const box = el('i', 'hint'), label = el('b'); box.append(el('s'), label); $('hints').appendChild(box); h = hints[n] = { box, label, cls: '', text: '' }; }
      const near = Math.hypot(x - cx, y - cy) < 80;
      const cls = 'hint ' + (spire ? 'spire' : 'node') + (near ? ' near' : '');
      const text = spire ? 'Spire' : `${TOWERS[t.type].special?.name || 'Special'} ready`;
      if (h.cls !== cls) { h.cls = cls; h.box.className = cls; }
      if (h.text !== text) { h.text = text; h.label.textContent = text; }
      h.box.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      h.box.style.display = 'block';
      n++;
    }
  }
  for (let i = n; i < hints.length; i++) hints[i].box.style.display = 'none';
}

/**
 * Beat level for the view: the built-in score's own beats, or a clock at the BPM set for the player's music.
 * The clock counts from the last tap on the Tap button, so tapped beats land on the music.
 */
function beatLevel(): number {
  if (!music.isExternalPlaying()) return sound.beatLevel();
  const bpm = music.bpm();
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0 || !music.beatOn()) return 0;
  const spb = 60 / clamp(bpm, 30, 300);
  const t = ((performance.now() - music.beatOrigin()) / 1000) % spb;
  return Math.exp(-(t < 0 ? t + spb : t) * 5.5);
}

function frame(dt: number) {
  if (CAPTURE) sound.clock += dt;
  if (!paused) {
    acc += dt * (mode === 'attract' ? 1.4 : speed);
    let n = 0;
    const cap = dt > 0.2 ? 70 : 10; // a hidden tab is stepped in big chunks so a multiplayer match keeps running
    while (acc >= STEP && n < cap) { bot?.step(STEP); if (!isClient) sim.step(STEP); acc -= STEP; n++; }
    if (n === cap) acc = 0;
    squadT += dt; if (squadT > 1.5) { squadT = 0; squadTokens = Math.min(3, squadTokens + 1); }
    if (isClient) for (const p of sim.projs) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  }
  const p = sim.players[me];
  if (bot) { view.yaw = p.yaw; view.pitch = p.pitch; }
  if (mode === 'attract' && sim.over) { sim = new Sim({ pauseOnCards: false }); bot = new Bot(sim, 0, 1); fastForward(150); view.setSim(sim, 0); }

  if (active()) {
    if (p.heroActive) {
      if (!isClient) { p.yaw = view.yaw; p.pitch = view.pitch; }
      if (mouseFire || touchFire) { view.aimPoint(aim); act.fire(aim); }
      const tp = sim.towerById(aimSpire());
      view.setTele(tp || null);
      $('cross').classList.toggle('tp', !!tp);
      $('t-tp').classList.toggle('on', !!tp);
      setText('hero-hint', tp ? (touchUi() ? 'JUMP TO SPIRE' : 'F - JUMP TO SPIRE') : '');
    } else {
      const sp = view.cam.dist * 0.9 * dt;
      if (keys.has('w') || keys.has('arrowup')) view.cam.z -= sp;
      if (keys.has('s') || keys.has('arrowdown')) view.cam.z += sp;
      if (keys.has('a') || keys.has('arrowleft')) view.cam.x -= sp;
      if (keys.has('d') || keys.has('arrowright')) view.cam.x += sp;
      clampCam();
    }
  }

  // networking
  if (net && mode === 'coop') {
    if (isClient) { lookT += dt; if (lookT > 0.08 && p.heroActive) { lookT = 0; net.send({ t: 'in', a: 'look', y: view.yaw, p: view.pitch }); } }
    else {
      for (const e of sim.events) if (e.k !== 'dmg' || e.p === 1) netEvs.push(e);
      if (netEvs.length > 300) netEvs = netEvs.slice(-300);
      snapT += dt;
      if (snapT >= 0.075) { snapT = 0; net.send({ t: 'snap', s: sim.snapshot(netEvs) }); netEvs = []; }
    }
  } else if (net && mode === 'versus') {
    vsT += dt;
    if (vsT > 0.5) { vsT = 0; net.send({ t: 'vs', l: sim.lives, w: sim.wave, k: sim.kills }); }
  }

  // a peer that goes silent (closed laptop, hidden tab, dropped link) must not stall the match forever
  if (net && !ended && mode !== 'attract' && performance.now() - lastRx > 10000) {
    if (mode === 'versus') { sim.over = true; endGame(true, 'Victory', 'Your rival stopped responding.'); }
    else if (mode === 'coop' && isClient) { sim.over = true; endGame(false, 'Link lost', 'The host stopped responding.'); }
  }

  const evs = sim.events.splice(0);
  handleEvents(evs);
  if (mode !== 'attract') {
    updateHud();
    showCards();
    if (sim.over && !ended) {
      if (mode === 'versus') { net?.send({ t: 'dead' }); endGame(false, 'Defeat', 'Your core has fallen.'); }
      else endGame(sim.won);
    }
  }
  // the built-in score stays quiet for as long as the player's own music is playing
  sound.setScoreMuted(music.isExternalPlaying());
  vx.beat?.(beatLevel());
  view.render(dt);
}

// ---------- boot ----------
(async () => {
  view.setQuality(settings.q);
  applyFx();
  await view.loadModels((f) => { $('loadbar').style.width = (f * 100).toFixed(0) + '%'; });
  applyFx();
  show('loading', false);
  if (CAPTURE) {
    // deterministic stepping for the trailer recorder
    startAttract(); show('menu', false);
    sound.cueLog = [];
    (window as unknown as Record<string, unknown>).__volt = {
      frame, view, announce, toast, tutor, touch: touchApi,
      get sim() { return sim; },
      demo(seed: number, ff: number, mapId?: string) {
        // mapId may be a pre-made id or 'gen-<tier>-<seed>' for a generated map
        const g = /^gen-([1-3])-(\d{1,9})$/.exec(mapId || '');
        startGame('solo', { demo: true, seed, map: g ? generateMap(+g[2], +g[1]) : mapById(mapId) || MAPS[0], diff: 'normal', survival: false }); sound.stopMusic(); fastForward(ff); sim.exitHero(0); sim.events.length = 0; view.setSim(sim, 0); },
      attract() { startAttract(); show('menu', false); },
      menu() { startAttract(); },
      energy(v: number) { sim.players[0].energy = v; },
      sound,
      /** hand control from the bot to the "player" so the card picker can be shown */
      takeover() { bot = null; sim.opts.pauseOnCards = true; },
      async renderAudio(seconds: number, hot: [number, number][]) {
        const cues = sound.cueLog || [];
        sound.cueLog = null;
        const buf = await sound.renderOffline(seconds, cues, hot);
        const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1), out = new DataView(new ArrayBuffer(44 + n * 4));
        const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
        out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
        for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, clamp(L[i], -1, 1) * 32767, true); out.setInt16(46 + i * 4, clamp(R[i], -1, 1) * 32767, true); }
        const bytes = new Uint8Array(out.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(bin);
      },
    };
    return;
  }
  startAttract();
  if (params.get('mode') === 'solo') startGame('solo');
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__dbg = { get sim() { return sim; }, view, act, startGame };
  let last = performance.now();
  const loop = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; frame(dt); requestAnimationFrame(loop); };
  // browsers stop animation frames in hidden or background tabs; whenever frames stall, keep a multiplayer match alive on a timer
  setInterval(() => { const now = performance.now(); if (now - last < 400 || !net || mode === 'attract' || ended) return; const dt = Math.min(1.1, (now - last) / 1000); last = now; frame(dt); }, 250);
  requestAnimationFrame(loop);
})();
