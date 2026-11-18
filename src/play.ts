// BEATSPIRE - game controller: input, HUD, menus, saved progress, multiplayer glue.
// The fonts, style.css, editor.css, touch.css and music.css are linked from play.html, so the page never shows unstyled.
import * as THREE from 'three';
import {
  GW, GH, TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, CARD_BY_ID, RARITY, SQUADS, worldToCell, cellX, cellZ, FACS, FAC_TYPES, ITEMS, FLUIDS, ORES, MAKES,
  TOWER_SUPPLY, TOWER_CHAIN, TOWER_NEEDS_L3, TOWER_CHAIN_L3, TOWER_SUPPLY_L3, FAC_LVL_SPEED, FAC_UPGRADABLE, needsOf, ITEM_SHOTS,
  ORE_TYPES, TOWER_TIER,
} from './game/data.ts';
import type { TowerType, EnemyType, FacType, ItemType, TowerNeeds, OreType } from './game/data.ts';
import { Sim, TITAN_STUN } from './game/sim.ts';
import type { Ev, Mode, Tower } from './game/sim.ts';
import {
  TOWER_STOCK, TANK, TOWER_TANK, SUPPLY, POLE_REACH, OUT_CAP, TUNNEL_REACH, GEN_POWER, MINE_TIME, PUMP_RATE, SMELT_TIME, REFINE_TIME, REFINE_OUT, turns, facKey,
} from './game/factory.ts';
import type { Fac, Diag } from './game/factory.ts';
import { neighbor, lineDir, hexDist } from './game/hex.ts';
import { Bot } from './game/bot.ts';
import { View } from './game/render.ts';
import { Sound, TRACKS } from './game/audio.ts';
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
const STORE_KEY = 'beatspire';
/** the game's earlier name: progress saved under it is read once and carried over */
const OLD_STORE_KEY = 'voltspire';
type FxColor = 'auto' | 'sand' | 'apricot' | 'verdigris' | 'custom';
/** A map's record: the campaign (wave, wins, time) and Survival (surv), kept apart. */
interface Rec { wave: number; wins: number; time: number; surv: number }
interface Store {
  v: 2;
  /** rings: the supply rings stay on everything between waves (the HUD's ring button; V shows them while held) */
  settings: { vol: number; mus: number; q: 'high' | 'low'; auto: boolean; rings: boolean };
  fx: { impact: boolean; beat: boolean; borders: boolean; env: boolean; towers: boolean; intensity: number; color: FxColor; custom: string };
  /** filter: which layouts the map picker shows (0 all, 1 to 3 one tier) */
  setup: { survival: boolean; source: 'premade' | 'generated'; map: string; mapName: string; seed: number; tier: number; tierAuto: boolean; diff: string; filter: number };
  /** per map and difficulty, keyed "<map id>|<difficulty id>" */
  records: Record<string, Rec>;
  tips: { node: boolean; boss: boolean; mite: boolean; titan: boolean; factory: boolean; dry: boolean; tutorial: boolean };
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
const defaultSetup = (): Store['setup'] => ({ survival: false, source: 'premade', map: MAPS[0].id, mapName: MAPS[0].name, seed: newSeed(), tier: 2, tierAuto: true, diff: 'normal', filter: 0 });

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
    settings: { vol: int(s.vol, 0, 100, 70), mus: int(s.mus, 0, 100, 50), q: s.q === 'low' ? 'low' : 'high', auto: bool(s.auto, false), rings: bool(s.rings, false) },
    fx: {
      impact: bool(f.impact, true), beat: bool(f.beat, true), borders: bool(f.borders, true), env: bool(f.env, false), towers: bool(f.towers, false),
      intensity: int(f.intensity, 0, 100, 30), color: colors.find((c) => c === f.color) || 'auto',
      custom: typeof f.custom === 'string' && /^#[0-9a-f]{6}$/i.test(f.custom) ? f.custom.toLowerCase() : '#e3dc92',
    },
    setup: {
      survival: bool(u.survival, ds.survival), source: u.source === 'generated' ? 'generated' : 'premade',
      map: str(old ? old.map : u.map, 32, ds.map), mapName: str(u.mapName, 40, ''),
      seed: int(u.seed, 0, 999999999, ds.seed), tier: int(u.tier, 1, 3, 2), tierAuto: bool(u.tierAuto, true),
      diff: diffById(old ? old.diff : u.diff).id, filter: int(u.filter, 0, 3, 0),
    },
    records: {},
    tips: { node: bool(t.node, false), boss: bool(t.boss, false), mite: bool(t.mite, false), titan: bool(t.titan, false), factory: bool(t.factory, false), dry: bool(t.dry, false), tutorial: bool(t.tutorial, false) },
  };
  let n = 0;
  for (const [k, v] of Object.entries(o(r.records))) {
    if (n >= MAX_RECORDS || !REC_KEY.test(k)) continue;
    const q = o(v), waves = diffById(k.slice(k.lastIndexOf('|') + 1)).waves;
    // a campaign best can never be past the last wave of its difficulty
    store.records[k] = { wave: int(q.wave, 0, waves, 0), wins: int(q.wins, 0, 99999, 0), time: num(q.time, 0, 360000, 0), surv: int(q.surv, 0, 9999, 0) };
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
try {
  const cur = localStorage.getItem(STORE_KEY), old = cur === null ? localStorage.getItem(OLD_STORE_KEY) : null;
  store = readStore(JSON.parse(cur ?? old ?? '{}'));
  // carried over once: from now on the progress lives under the new key and the old one is not read again
  if (old !== null) localStorage.setItem(STORE_KEY, JSON.stringify(store));
} catch { store = readStore(null); }
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage unavailable */ } };
const settings = store.settings;
const recOf = (mapId: string, diff: string): Rec | undefined => (Object.hasOwn(store.records, `${mapId}|${diff}`) ? store.records[`${mapId}|${diff}`] : undefined);

const canvas = $<HTMLCanvasElement>('c');
const view = new View(canvas);
const sound = new Sound();
sound.volume = settings.vol / 100; sound.musicVol = settings.mus / 100;

// Parts of the view that are being added separately. Everything here is optional until they land.
interface FxOptions { impact: boolean; beat: boolean; borders: boolean; env: boolean; towers: boolean; intensity: number; color: number | null }
const vx = view as unknown as {
  fxOptions?: Partial<FxOptions>; beat?(level: number): void; skipIntro?(): void; introActive?(): boolean;
  frameMap?(bottom?: number): unknown;
  /** soft highlight of the deposit patch under (cx, cz); on = false clears it */
  setOreHover?(cx: number, cz: number, on: boolean): void;
  /** how far the tile at (x, z) has arrived in the opening build-up, 0..1 */
  revealOf?(x: number, z: number): number;
};
/** The bird camera. rot turns it around the point it looks at; the view works out the tilt from dist. */
const bird = () => view.cam as { x: number; z: number; dist: number; rot?: number };
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
/** What the next click builds (a tower or a factory building), and what is selected on the board (a tower id, or a factory building id in selFac). */
let buildType: TowerType | null = null, buildFac: FacType | null = null, selected = 0, selFac = 0;
/** The direction the next belt (or other building) faces, and the bar the number keys pick from. */
let facDir = 0, barTab: 'towers' | 'factory' = 'towers';
/** the Factory bar button the deposit cue points at, the tab it switched away from ('' when none or a panel opened), seconds without a deposit */
const cue = { k: '' as FacType | '', was: '' as '' | 'towers', off: 0, at: 0 };
/** the free deposit tile whose info panel is open */
let selOre: { cx: number; cz: number } | null = null;
/** the mouse rests over the board (not over a HUD element) */
let overBoard = false;
/** the cell the view highlights as a deposit patch ('' for none) */
let oreLit = '';
/** A line of belts or pipes being laid with the button held: the last tile placed. */
let painting = false;
const paintAt = { cx: -1, cz: -1, id: 0 };
let dragging = false, rotating = false;
/** mouse buttons that are down right now (the bit mask of MouseEvent.buttons) */
let mouseBtns = 0;
/** the run was started with "Test play" in the map editor */
let editorRun = false;
/** the last press came from a finger, not from the mouse or the keyboard */
let byTouch = false;
let snapT = 0, vsT = 0;
let netEvs: Ev[] = [];
let cardKey = '', ended = false;
let lobbyMode: 'coop' | 'versus' = 'coop';
/** The run the setup sheet starts. */
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
const gp = new THREE.Vector3();
/** true once the touch module has switched the on-screen controls on */
const touchUi = () => shown('touch');

// ---------- actions (local sim, or sent to the co-op host) ----------
const act = {
  build(type: TowerType, cx: number, cz: number) {
    if (isClient) { if (sim.canBuild(type, cx, cz)) net?.send({ t: 'in', a: 'build', ty: TOWER_TYPES.indexOf(type), cx, cz }); else return false; return true; }
    return !!sim.build(type, cx, cz);
  },
  upgrade(id: number) {
    if (isClient) { net?.send({ t: 'in', a: 'up', id }); return; }
    const t = sim.towerById(id);
    if (!t || !sim.upgrade(id)) { sound.play('error'); return; }
    // a Mk3 that runs on a new ammunition drops the old one: say what it needs now and what came unlocked with it
    const l3 = t.lvl === 3 && TOWER_NEEDS_L3[t.type];
    if (l3 && !bot) toast(`${TOWERS[t.type].name} Mk3 now runs on ${needsText(l3)}. Unlocked: ${(TOWER_CHAIN_L3[t.type] || []).map((f) => FACS[f].name).join(', ')}.`);
  },
  /** upgrade a mine, pumpjack, plant or generator (solo only, like the rest of the factory) */
  upFac(id: number) { if (!sim.upgradeFac(id)) sound.play('error'); },
  sell(id: number) {
    if (!sim.towerById(id)) return false;
    if (isClient) net?.send({ t: 'in', a: 'sell', id }); else sim.sell(id);
    return true;
  },
  card(i: number) { if (isClient) net?.send({ t: 'in', a: 'card', i }); else sim.pickCard(me, i); },
  wave() { if (isClient) net?.send({ t: 'in', a: 'wave' }); else sim.startWave(); },
  /** fire a charged tower's special */
  special(id: number) {
    const t = sim.towerById(id);
    if (!t || !sim.specialReady(t)) { sound.play('error'); return; }
    if (!sim.triggerSpecial(id, me)) { sound.play('nospec'); note('Nothing in range for that special. The tower keeps its charge.'); }
  },
  // the factory (solo only for now)
  fac(type: FacType, cx: number, cz: number, dir: number) { return sim.buildFac(type, cx, cz, dir); },
  sellFac(id: number) { return sim.sellFac(id); },
  turnFac(id: number, dir: number) { sim.rotateFac(id, dir); },
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

// ---------- enemy icons (wave intel) ----------
const MITE_PATH = 'M8 4.8a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 0 0 0-6.4zM0.8 3.6l4 1.7-0.5 1.3-4-1.7zM15.2 3.6l-4 1.7 0.5 1.3 4-1.7zM0.3 7.3h4v1.4h-4zM11.7 7.3h4v1.4h-4zM0.8 12.4l4-1.7-0.5-1.3-4 1.7zM15.2 12.4l-4-1.7 0.5-1.3 4 1.7z';
// Silhouettes on a 16 x 16 grid: walker, dart, flyer, shield, heavy, the Colossus as a plated hexagon, the Gyre as a ring wheel
// with its hub, the Broodcarrier as a dome over three pods, the mite as a small spider and the Titan as a giant on two legs.
const ENEMY_ICON: Record<EnemyType, string> = {
  grunt: 'M8 1.5a2 2 0 1 1 0 4a2 2 0 0 1 0-4zM4.5 6.5h7l-1 4.5 1 3.5H9.3L8 11.5 6.7 14.5H4.5l1-3.5z',
  runner: 'M1.5 3.5l6 4.5-6 4.5zM8 3.5l6.5 4.5L8 12.5z',
  drone: 'M8 4.5L11.5 8 8 11.5 4.5 8zM0.5 5.5L4.5 8l-4 2.5zM15.5 5.5L11.5 8l4 2.5z',
  shield: 'M8 1.5l5.5 2V8c0 3.3-2.4 5.6-5.5 6.5C4.9 13.6 2.5 11.3 2.5 8V3.5z',
  brute: 'M1.5 5h4V2.5h5V5h4v6.5H12v3H9.2v-3H6.8v3H4v-3H1.5z',
  boss: 'M8 0.8l6.2 3.6v7.2L8 15.2l-6.2-3.6V4.4zM8 5.4a2.6 2.6 0 1 0 0 5.2a2.6 2.6 0 0 0 0-5.2z',
  wheel: 'M8 1a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM8 3.4a4.6 4.6 0 1 1 0 9.2a4.6 4.6 0 0 1 0-9.2zM8 6a2 2 0 1 0 0 4a2 2 0 0 0 0-4z',
  brood: 'M8 1.5c3.6 0 6.5 2.5 6.5 5.6V9h-13V7.1C1.5 4 4.4 1.5 8 1.5zM2.4 10.4h3.1v3.4a1.55 1.55 0 0 1-3.1 0zM6.45 10.4h3.1v3.4a1.55 1.55 0 0 1-3.1 0zM10.5 10.4h3.1v3.4a1.55 1.55 0 0 1-3.1 0z',
  mite: MITE_PATH,
  titan: 'M6.4 0.5h3.2v2.6H6.4zM2.8 3.6h10.4v5.2h-2.1V6h-0.7v3.8H5.6V6H4.9v2.8H2.8zM5.6 10.4h2v5.1H4.3zM8.4 10.4h2l1.3 5.1H8.4z',
};
/** enemies that get the violet plate in a wave tag: the ones a wave is built around */
const bigOne = (t: EnemyType) => t === 'boss' || t === 'titan';
type Group = { type: EnemyType; n: number };
/** Fill a box with icon + count chips, Colossus first. Anything that is not a known enemy type is dropped. */
function enemyChips(box: HTMLElement, list: Group[]) {
  box.textContent = '';
  const ok = list.filter((o) => o && Object.hasOwn(ENEMIES, o.type) && Number.isFinite(o.n) && o.n > 0);
  const rank = (t: EnemyType) => (t === 'titan' ? -2 : t === 'boss' ? -1 : ENEMY_TYPES.indexOf(t));
  ok.sort((a, b) => rank(a.type) - rank(b.type));
  for (const o of ok) {
    const s = el('span', bigOne(o.type) ? 'en boss' : 'en');
    s.title = ENEMIES[o.type].name;
    s.append(icon(ENEMY_ICON[o.type] || ENEMY_ICON.grunt), el('b', '', String(Math.min(999, Math.round(o.n)))));
    box.appendChild(s);
  }
  return ok;
}

// ---------- build bar ----------
/** What a tower runs on, in words (its level-1 supply for a tower type, else the supply given). */
function needsText(t: TowerType | TowerNeeds): string {
  const n = typeof t === 'string' ? TOWERS[t].needs : t, parts: string[] = [];
  if (n.item) parts.push(n.item === 'iron_ore' ? 'iron ore' : ITEMS[n.item].short + 's');
  if (n.fluid) parts.push(FLUIDS[n.fluid].name.toLowerCase());
  if (n.power) parts.push(`${n.power} power`);
  return parts.join(' and ');
}
function towerTip(t: TowerType) {
  const d = TOWERS[t], tip = $('tip');
  tip.textContent = '';
  const stats = d.dmg > 0 ? ` Damage ${d.dmg}, ${d.rate} per second, range ${d.range}.` : d.range > 0 ? ` Range ${d.range}.` : '';
  tip.append(el('b', '', d.name), el('span', '', d.desc + stats));
  tip.append(el('i', 'needs', `Runs on ${needsText(t)}. ${TOWER_SUPPLY[t]}`));
  if (TOWER_SUPPLY_L3[t]) tip.append(el('i', 'needs', TOWER_SUPPLY_L3[t]!));
  tip.append(el('i', '', sim.matCost(t) ? `Costs ${sim.cost(t)} credits and ${sim.matCost(t)} materials (from a Frame Works).` : `Costs ${sim.cost(t)} credits.`));
  if (d.special) tip.append(el('i', '', `Special: ${d.special.name}. ${d.special.desc}`));
  if (!sim.unlocked.has(t)) tip.append(el('i', 'lock', 'Locked. Find its blueprint card to build it.'));
  show('tip');
}
function facTip(t: FacType) {
  const d = FACS[t], tip = $('tip');
  tip.textContent = '';
  tip.append(el('b', '', d.name), el('span', '', d.desc), el('i', 'needs', `Costs ${sim.facCost(t)} credits.`));
  if (FAC_UPGRADABLE.has(t)) tip.append(el('i', '', `Upgrade it twice for credits: Mk2 works ${FAC_LVL_SPEED[1]}x, Mk3 ${FAC_LVL_SPEED[2]}x as fast${t === 'generator' ? ' (gives that much more power, burning coal as much faster)' : ''}.`));
  show('tip');
}
const buildBtns = {} as Record<TowerType, HTMLButtonElement>;
const facBtns = {} as Record<FacType, HTMLButtonElement>;
let tipHover: TowerType | FacType | null = null;
for (const t of TOWER_TYPES) {
  const d = TOWERS[t];
  const b = el('button', 'tw') as HTMLButtonElement;
  b.type = 'button';
  b.style.setProperty('--c', hex(d.color));
  b.setAttribute('aria-label', `${d.name}, key ${d.key.toUpperCase()}`);
  b.append(el('kbd', '', d.key), el('div', 'ico'), el('div', 'nm', d.name), el('div', 'cost'));
  b.addEventListener('click', () => { sound.init(); pickBuild(t); });
  // A tooltip opens when the mouse moves over the button, not when a button appears under a resting pointer.
  // Fingers have no hover: the tooltip of the tower picked for building is shown instead.
  b.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch' && (e.movementX || e.movementY)) tipHover = t; });
  b.addEventListener('pointerleave', () => { if (tipHover === t) tipHover = null; });
  buildBtns[t] = b;
  $('build').appendChild(b);
}
for (const t of FAC_TYPES) {
  const d = FACS[t];
  const b = el('button', 'tw fac') as HTMLButtonElement;
  b.type = 'button';
  b.style.setProperty('--c', hex(d.color));
  b.setAttribute('aria-label', d.name);
  b.append(el('kbd', '', ''), el('div', 'ico'), el('div', 'nm', d.name), el('div', 'cost'));
  b.addEventListener('click', () => { sound.init(); pickFac(t); });
  b.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch' && (e.movementX || e.movementY)) tipHover = t; });
  b.addEventListener('pointerleave', () => { if (tipHover === t) tipHover = null; });
  facBtns[t] = b;
  $('fbuild').appendChild(b);
}
/** Show the tower bar or the factory bar. */
function setTab(tab: 'towers' | 'factory') {
  barTab = tab; cue.was = ''; // (a tab picked by hand or by the game stays; the deposit cue sets its own memory after this)
  show('build', tab === 'towers'); show('fbuild', tab === 'factory');
  $('tab-towers').classList.toggle('on', tab === 'towers'); $('tab-factory').classList.toggle('on', tab === 'factory');
}
$('tab-towers').addEventListener('click', () => { sound.init(); sound.play('click'); setTab('towers'); });
$('tab-factory').addEventListener('click', () => { sound.init(); sound.play('click'); setTab('factory'); });
// the console grows past --console-h (the bar tabs sit over the bar): the panels docked above it read its real height
new ResizeObserver(() => document.documentElement.style.setProperty('--bottom-h', `${Math.ceil($('bottom').getBoundingClientRect().height)}px`)).observe($('bottom'));
/** The factory buildings on the bar right now (the unlocked ones), in bar order: the number keys pick them by place. */
const facList = () => FAC_TYPES.filter((t) => sim.facs.has(t));
function pickFac(t: FacType | null) {
  if (t && !sim.facs.has(t)) { sound.play('error'); return; }
  buildFac = buildFac === t ? null : t;
  buildType = null; selected = 0; selFac = 0;
  sound.play('click');
  view.setGhost(null);
  if (!buildFac) view.setFacGhost(null);
  refreshGhost();
  if ((buildFac === 'belt' || buildFac === 'pipe') && !bot && !store.tips.factory && !guideOn()) { store.tips.factory = true; save(); tutor(touchUi() ? 'Hold and drag to lay a line of belts. Turn changes their direction.' : 'Drag to lay a line of belts. R turns the next one.'); }
  if (buildFac === 'tunnel') note(`Build the entrance, then the exit facing the same way up to ${TUNNEL_REACH} tiles ahead. ${touchUi() ? 'Turn' : 'R'} turns it.`);
  if (buildFac === 'ptunnel') note(`Build two in a straight line, up to ${TUNNEL_REACH} tiles apart: their pipes join under whatever stands between.`);
}
function pickBuild(t: TowerType | null) {
  if (t && !sim.unlocked.has(t)) { sound.play('error'); note(TOWERS[t].name + ' is locked. Find its blueprint card first.'); return; }
  buildType = buildType === t ? null : t;
  buildFac = null; selected = 0; selFac = 0;
  view.setFacGhost(null);
  sound.play('click');
  if (!buildType) view.setGhost(null);
  refreshGhost();
}
function refreshGhost() {
  const inb = hover.cx >= 0 && hover.cz >= 0 && hover.cx < GW && hover.cz < GH;
  if (buildFac) {
    view.setGhost(null); view.setHover(0, 0, false);
    if (inb) view.setFacGhost(buildFac, hover.cx, hover.cz, facDir, !sim.facBlock(buildFac, hover.cx, hover.cz));
    else view.setFacGhost(null);
    return;
  }
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
// A fresh offer cannot be taken for a moment (the bar under the heading drains), and not before the mouse button
// and the keys 1 to 3 have been let go once. A click or key press meant for the fight never picks a card unread.
const CARD_GUARD_MS = 900;
let cardAt = 0, cardFree = false, cardArmed = false, guardAnim: Animation | null = null;
function armCards() {
  if (cardArmed) return;
  if (!cardFree && !mouseBtns && !keys.has('1') && !keys.has('2') && !keys.has('3')) cardFree = true;
  if (cardFree && performance.now() - cardAt >= CARD_GUARD_MS) { cardArmed = true; $('cards').classList.add('armed'); }
}
function showCards() {
  const p = sim.players[me];
  if (!p || !p.pending.length || mode === 'attract' || bot) { if (cardKey) { cardKey = ''; show('cards', false); } return; }
  const key = p.pending.length + ':' + p.pending[0].join(',');
  if (cardKey === 'sent:' + key) return;
  if (cardKey === key) { armCards(); return; }
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
    // (the stack track: how many of this card the run holds and which rank this one would be, one pip per rank)
    const own = Math.min(c.max, sim.stacks[c.id] || 0), stk = el('div', 'stk');
    if (c.max > 1) {
      stk.append(el('span', '', own ? `Rank ${own + 1} of ${c.max} · you hold ${own}` : `Rank 1 of ${c.max}`));
      const pips = el('div', 'pips');
      for (let k = 0; k < c.max; k++) pips.append(el('i', k < own ? 'on' : k === own ? 'nx' : ''));
      stk.append(pips);
    } else stk.append(el('span', '', c.kind === 'blueprint' ? 'Unlocks the tower and its supply' : 'Once per run'));
    d.append(el('kbd', '', String(i + 1)), el('div', 'ci', c.icon), el('div', 'rar', RARITY[c.rar]), el('h4', '', c.name), el('p', '', c.desc), stk, el('div', 'kind', c.needs ? TOWERS[c.needs].name : c.kind === 'eco' ? 'economy' : c.kind === 'tower' ? 'all towers' : c.kind));
    if (c.needs) d.style.setProperty('--tc', hex(TOWERS[c.needs].color));
    d.addEventListener('click', () => pickCard(i));
    d.addEventListener('mouseenter', () => sound.play('hover'));
    row.appendChild(d);
  });
  cardAt = performance.now(); cardFree = false; cardArmed = false;
  $('cards').classList.remove('armed');
  guardAnim?.cancel();
  guardAnim = ($('card-guard').firstElementChild as HTMLElement).animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: CARD_GUARD_MS, easing: 'linear', fill: 'forwards' });
  show('cards');
}
function pickCard(i: number) {
  const p = sim.players[me];
  if (!cardArmed || !cardKey || cardKey.startsWith('sent:') || !p.pending.length || i >= p.pending[0].length) return;
  cardKey = 'sent:' + cardKey;
  show('cards', false);
  act.card(i);
  sound.play('card');
}

// ---------- events ----------
const SHOT_SOUND: Record<string, string> = { pulse: 'shot', arc: 'arcshot', mortar: 'mortar', rail: 'rail', missile: 'missile' };
/**
 * Play an effect where it happens. Things near the middle of the picture are at full level and it falls off toward the
 * edge of what the camera sees (and a little when zoomed far out). Left and right follow the screen.
 */
function playAt(name: string, e: Ev) {
  let g = 1, pan = 0;
  if (fin(e.x) && fin(e.z)) {
    const c = bird(), d = Math.hypot(e.x - c.x, e.z - c.z); g = clamp(1.2 - d / (c.dist * 1.1), 0.4, 1) * (1 - 0.25 * clamp((c.dist - 40) / 44, 0, 1));
    const [sx, , ok] = view.project(e.x, fin(e.y) ? e.y : 0, e.z);
    if (ok) pan = clamp((sx / Math.max(1, innerWidth)) * 2 - 1, -1, 1) * 0.6;
  }
  sound.play(name, g, pan);
}
/** seconds until the tip about the Titan shows (it follows its impact) */
let titanCue = 0;
function handleEvents(evs: Ev[]) {
  view.handle(evs);
  const quiet = mode === 'attract';
  if (quiet) return;
  for (const e of evs) {
    switch (e.k) {
      case 'shot': playAt((typeof e.t === 'string' && Object.hasOwn(SHOT_SOUND, e.t) && SHOT_SOUND[e.t]) || 'shot', e); break;
      case 'cryo': playAt('cryo', e); break;
      case 'lance': playAt('lance', e); break;
      case 'gravity': playAt('gravity', e); break;
      case 'boom': playAt('boom', e); break;
      case 'die':
        if (e.t === 'mite') playAt('mitedie', e);
        else if (e.t === 'boss') { sound.play('bossdie'); toast('Colossus destroyed.'); }
        else playAt('die', e);
        break;
      case 'rail': if (e.big) sound.play('bigshot'); break;
      case 'shieldbreak': playAt('shield', e); break;
      case 'build': playAt('build', e); break;
      case 'sell': playAt('sell', e); break;
      case 'dmg': break;
      case 'dry': {
        // a tower ran out of supply: say once what it needs, then only the cue
        if (bot || mode !== 'solo') break;
        playAt('down', e);
        const t = typeof e.t === 'string' && Object.hasOwn(TOWERS, e.t) ? e.t as TowerType : null, tw = sim.towerById(int(e.id));
        if (t) note(`${TOWERS[t].name} is out of supply: it needs ${needsText(tw ? needsOf(tw) : t)}.`);
        if (t && !store.tips.dry && !guideOn()) { store.tips.dry = true; save(); tutor('A tower fires only what it is fed. Click it to see what it runs on.'); }
        break;
      }
      case 'fed': playAt('up', e); break;
      // a tower or building pulled an item off its belt: a soft tick, only close to the camera (the sound table rate-limits it)
      case 'take': {
        if (!fin(e.x) || !fin(e.z)) break;
        const c = bird();
        if (Math.hypot(e.x - c.x, e.z - c.z) < c.dist * 0.45) playAt('take', e);
        break;
      }
      case 'mats': if (!bot) playAt('card', e); break;
      case 'special': {
        playAt('special', e);
        const d = typeof e.t === 'string' && Object.hasOwn(TOWERS, e.t) ? TOWERS[e.t as TowerType] : null;
        if (d?.special && e.p === me && !bot) toast(`${d.special.name} fired. ${d.name} reboots afterwards.`);
        break;
      }
      case 'down': playAt('down', e); break;
      case 'up': playAt('up', e); break;
      case 'wave': {
        const last = sim.campaign && e.n >= sim.winWave;
        // the Titan's wave is announced by its landing
        if (sim.titan && sim.titan.wave === e.n && sim.titan.phase !== 'dead' && sim.titan.phase !== 'none' && sim.titan.phase !== 'far') break;
        sound.play('wave');
        const sub = last ? 'Final wave' : e.n % 5 === 0 ? 'Colossus inbound' : e.n >= 8 && e.n % 5 === 3 ? 'Gyre inbound' : '';
        announce('Wave ' + e.n, sub);
        break;
      }
      case 'boss':
        sound.play('boss');
        if (!bot && !store.tips.boss) { store.tips.boss = true; save(); tutor('Save your tower specials for the Colossus'); }
        break;
      case 'clear': {
        sound.play('clear');
        const last = sim.campaign && e.n >= sim.winWave;
        toast(`Wave ${e.n} cleared, +${e.g} credits.${last ? '' : sim.autoWaves ? ' Build phase: the factory rests until the next wave.' : ' Build phase: time stands still until you call the next wave.'}`);
        break;
      }
      case 'levelup': sound.play('levelup'); break;
      case 'card': {
        if (typeof e.id !== 'string' || !Object.hasOwn(CARD_BY_ID, e.id)) break;
        if (e.p !== me) { toast('Partner took ' + CARD_BY_ID[e.id].name); break; }
        // a blueprint: say what the new tower runs on and which buildings came with it
        const t = e.id.startsWith('bp_') ? (e.id.slice(3) as TowerType) : null;
        if (t && Object.hasOwn(TOWERS, t) && !bot) {
          tutor(`${TOWERS[t].name}: ${TOWER_SUPPLY[t]}`);
          toast(`Unlocked: ${TOWERS[t].name}. Factory: ${TOWER_CHAIN[t].map((f) => FACS[f].name).join(', ')}.`);
        }
        break;
      }
      case 'leak': { sound.play('leak'); coreHurt(); break; }
      case 'breach': playAt('breach', e); break;
      case 'nospec': break; // (act.special says so)
      case 'incoming': sound.play('boss'); toast(`Incoming from your rival: ${int(e.n)} x ${typeof e.type === 'string' && Object.hasOwn(ENEMIES, e.type) ? ENEMIES[e.type as EnemyType].name : 'enemies'}`); break;
      // the Gyre: hits glancing off its rim, the rim stalling and spinning up again
      case 'deflect': playAt('deflect', e); break;
      case 'spindown': playAt('spindown', e); break;
      case 'spinup': playAt('spinup', e); break;
      // Broodcarrier and mites
      case 'brood': playAt('brood', e); break;
      case 'jam':
        playAt('jam', e);
        if (!bot && !store.tips.mite) { store.tips.mite = true; save(); tutor('Mites jam a tower. Any hit knocks them off: cover your towers with each other.'); }
        break;
      case 'unjam': playAt('unjam', e); break;
      // the Titan
      case 'titanSmash': sound.play('titanSmash', 0.55); break;
      case 'titanLand':
        sound.play('titanLand');
        titanEntrance(e.x, e.z);
        announce(`Wave ${sim.wave}: ${TITAN_NAME()}`, 'It lands at the gate and stuns every tower');
        break;
      case 'titanImpact':
        sound.play('titanImpact'); flash();
        titanCue = 1.5;
        break;
      case 'titanStrike': sound.play('boom'); break; // the blow itself; the 'leak' event beside it carries the alarm
      case 'titanDie':
        sound.play('titanDie'); flash();
        announce(`${TITAN_NAME()} destroyed`);
        break;
    }
  }
}
const TITAN_NAME = () => ENEMIES.titan?.name || 'Titan';
function coreHurt() { const s = $('lives').parentElement!; s.classList.add('hurt'); setTimeout(() => s.classList.remove('hurt'), 500); }
/** The Titan has landed: a tip on how to bring it down, once. */
function titanSay() {
  if (ended || bot || store.tips.titan) return;
  store.tips.titan = true; save();
  tutor('Its hull turns most tower fire. Tower specials hit it at full strength.');
}

// ---------- game flow ----------
function fastForward(seconds: number) {
  for (let i = 0; i < seconds * 60 && !sim.over; i++) { bot?.step(STEP); sim.step(STEP); sim.events.length = 0; }
}
function resetUi() {
  for (const id of ['cards', 'menu', 'lobby', 'help', 'settings', 'music', 'pause', 'end', 'tower', 'fpanel', 'opanel', 'oretip', 'vs', 'tip', 'setup', 'editor', 'tutor', 'guide']) show(id, false);
  guide.on = false;
  clearTimeout(endTimer); clearTimeout(tutorTimer);
  for (const id of ['prep', 'p-editor', 'e-editor']) show(id, false);
  $('toasts').textContent = ''; $('notes').textContent = '';
  lastRx = performance.now(); squadTokens = 3;
  buildType = null; buildFac = null; selected = 0; selFac = 0; painting = false; facDir = 0; dragging = false; rotating = false; paused = false; speed = 1; acc = 0; cardKey = ''; ended = false;
  runKey = ''; runWon = false; tipHover = null; editorRun = false; selOre = null; overBoard = false; oreLit = '';
  if (cue.k) facBtns[cue.k].classList.remove('cue');
  cue.k = '';
  setTab('towers'); view.setFacGhost(null);
  // what these keys stood for was just hidden or reset behind the cache's back
  for (const k of ['prep', 'wavecls', 'tdock', 'fdock', 'odock', 'otip', 'opanel', 'tip', 'titan', 'titancls']) delete cache[k];
  show('titan', false);
  titanCue = 0; zoomS.on = false; keyV.x = keyV.y = keyV.r = 0;
  sound.intense = 0;
  setText('btn-speed', '1x');
}
function bestLine() {
  let wave = 0, surv = 0, wins = 0;
  for (const r of Object.values(store.records)) { wave = Math.max(wave, r.wave); surv = Math.max(surv, r.surv); wins += r.wins; }
  return [wave ? `Best campaign: ${wave} waves held` : '', wins ? `${wins} ${wins === 1 ? 'win' : 'wins'}` : '', surv ? `Best survival: ${surv} waves held` : ''].filter(Boolean).join(' / ');
}
function startAttract() {
  resetUi();
  if (setupStale) { setupStale = false; loadSetup(); }
  net?.close(); net = null; isClient = false;
  mode = 'attract'; me = 0;
  sim = new Sim({ pauseOnCards: false, free: true });
  bot = new Bot(sim, 0, 1);
  fastForward(150);
  view.setSim(sim, 0); view.orbit = true;
  show('hud', false); show('menu');
  setText('best', bestLine());
}
/** Start camera: the whole board with its gates in view, turned the standard way. */
function frameBoard() {
  const c = bird();
  zoomS.on = false;
  c.x = 0; c.z = 1.5; c.dist = 48;
  if (typeof c.rot === 'number') c.rot = 0;
  // the view may hand back the framing or apply it to its camera itself: both are fine
  const f = vx.frameMap?.((innerHeight <= 480 ? 74 : 92) / Math.max(1, innerHeight)) as { x?: unknown; z?: unknown; dist?: unknown } | undefined;
  if (f && typeof f === 'object' && f !== c) {
    if (typeof f.x === 'number' && Number.isFinite(f.x)) c.x = f.x;
    if (typeof f.z === 'number' && Number.isFinite(f.z)) c.z = f.z;
    if (typeof f.dist === 'number' && Number.isFinite(f.dist)) c.dist = clamp(f.dist, 20, 84);
  }
}
function startGame(m: Mode, opts: { client?: boolean; seed?: number; demo?: boolean; map?: MapDef; diff?: string; survival?: boolean; editor?: boolean } = {}) {
  resetUi();
  editorRun = !!opts.editor && m === 'solo';
  mode = m; isClient = !!opts.client; me = isClient ? 1 : 0;
  sim = new Sim({
    mode: m, players: m === 'coop' ? 2 : 1, pauseOnCards: m === 'solo' && !opts.demo, seed: opts.seed ?? ((Math.random() * 2 ** 31) | 0),
    map: opts.map ?? choice.map, diff: opts.diff ?? choice.diff, survival: m === 'versus' ? false : opts.survival ?? choice.survival,
    // the scripted demo is played by the bot, which builds no factory
    free: !!opts.demo,
  });
  // the player calls the waves: the first one always, the later ones unless Auto waves is switched on
  if (!opts.demo) { sim.holdFirst = true; sim.autoWaves = m !== 'solo' || settings.auto; }
  sim.replica = isClient;
  bot = opts.demo ? new Bot(sim, 0, 1.5) : null;
  view.setSim(sim, me); view.orbit = false;
  frameBoard();
  show('hud'); show('vs', m === 'versus');
  show('p-editor', editorRun);
  show('btn-speed', m === 'solo'); show('btn-pause', true);
  rival = { l: 20, w: 0, k: 0 };
  sound.init(); sound.startMusic(true); // a new run: on shuffle the score moves on to another track
  if (m === 'solo' && !opts.demo) {
    const key = `${mapKeyOf(opts.map ?? choice.map)}|${sim.diff.id}`;
    runKey = REC_KEY.test(key) ? key : '';
  }
  if (!opts.demo) {
    announce('Defend the Heart', m === 'coop' ? 'Co-op link is up' : m === 'versus' ? 'Outlast your rival'
      : `${sim.map.def.name} / ${sim.endless ? 'Survival' : `${sim.diff.name}, ${sim.winWave} waves`}`);
    if (m === 'solo' && !editorRun && !store.tips.tutorial) startGuide();
    else setTimeout(() => {
      if (sim.wave === 0 && mode === m && !ended) toast('Towers start empty. Build one next to a supply crate, or feed it from a Mine. Time stands still until you call the wave.');
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
/** Belts, pipes and the like: they do not count as factory buildings on the end screen, and stay picked after placing one. */
const LOGISTICS: ReadonlySet<FacType> = new Set<FacType>(['belt', 'splitter', 'tunnel', 'pipe', 'ptunnel', 'pole']);
function endGame(win: boolean, title?: string, sub?: string) {
  if (ended) return;
  ended = true;
  show('cards', false); show('tutor', false); show('prep', false);
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
  row('Towers standing', sim.towers.length); row('Factory buildings', sim.factory.facs.filter((f) => !LOGISTICS.has(f.type) && f.type !== 'crate').length); row('Time', clock(sim.time));
  if (mode === 'versus') row('Enemies sent', sim.sent);
  if (saved) {
    const r = saved.rec;
    // the record counts waves held, so after a loss it is one less than the wave reached
    if (sim.opts.survival) row('Most waves held here', `${r.surv}${saved.newBest ? ' (new)' : ''}`, saved.newBest);
    else {
      row('Most waves held here', `${r.wave} of ${sim.winWave}${saved.newBest ? ' (new)' : ''}`, saved.newBest);
      if (r.wins) row('Wins / fastest', `${r.wins} / ${clock(r.time)}`);
    }
  }
  show('e-endless', win && mode === 'solo');
  show('e-editor', editorRun);
  setText('e-again', mode === 'solo' ? 'Play again' : 'Back to lobby');
  for (const id of OVERLAYS) show(id, false);
  endTimer = window.setTimeout(() => show('end'), win ? 1200 : 1800);
}

// ---------- multiplayer ----------
// 6: no hero any more, and the factory (online play is switched off in the menu until the factory is replicated)
const NET_V = 7; // (7: the deposit and crate layout changed; peers on different layouts would desync)
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown) => (fin(v) ? Math.trunc(v) : -1);

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
    // Everything a guest can do arrives here. The sim checks the rules (credits, unlocks);
    // this only makes sure the arguments have the right shape before they get there.
    const p = sim.players[1];
    if (!p || typeof m.a !== 'string') return;
    lastRx = performance.now();
    switch (m.a) {
      case 'build': { const ty = TOWER_TYPES[int(m.ty)], cx = int(m.cx), cz = int(m.cz); if (ty && cx >= 0 && cz >= 0 && cx < GW && cz < GH) sim.build(ty, cx, cz); break; }
      case 'up': if (int(m.id) > 0) sim.upgrade(int(m.id)); break;
      case 'sell': if (int(m.id) > 0) sim.sell(int(m.id)); break;
      case 'card': { const i = int(m.i); if (i >= 0 && i < 3) sim.pickCard(1, i); break; }
      case 'spec': if (int(m.id) > 0) sim.triggerSpecial(int(m.id), 1); break;
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
  setText('lobby-sub', m === 'coop' ? 'Defend one grid together, with shared credits. No account needed.' : 'Each of you defends your own grid. Spend credits to send squads at your rival. Last core standing wins.');
  show('menu', false); show('lobby'); show('l-code', false);
  lobbyStatus('l-host-status', ''); lobbyStatus('l-join-status', '');
  ($('l-host') as HTMLButtonElement).disabled = false; ($('l-join') as HTMLButtonElement).disabled = false;
  lobbyChoice();
}
/** The line that says which map and difficulty the host will start. An open room is left alone. */
function lobbyChoice() {
  const d = diffById(choice.diff), m = lobbyMode;
  setText('l-choice', `${choice.map.name} / ${d.name}${m !== 'coop' ? '' : choice.survival ? ' / Survival' : ` / ${d.waves} waves`}`);
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
let genTimer = 0;
let mapCards: { def: MapDef; btn: HTMLElement; rec: HTMLElement }[] = [];
/** which layouts the map picker shows: 0 all, 1 Simple, 2 Tricky, 3 Complex */
let mapFilter = 0;
function applyMapFilter() {
  for (const c of mapCards) c.btn.classList.toggle('hidden', mapFilter !== 0 && (c.def.tier || 0) !== mapFilter);
  for (const b of $('map-tier').children) b.classList.toggle('on', (b as HTMLElement).dataset.v === String(mapFilter));
}

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
  // one short line: it has to fit a map card without wrapping
  if (choice.survival) return r.surv ? `Held ${r.surv} waves` : '';
  return r.wins ? `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}, best ${clock(r.time)}` : r.wave ? `Held ${r.wave} of ${diffById(choice.diff).waves}` : '';
}
function refreshSetup() {
  const d = diffById(choice.diff), gen = choice.source === 'generated';
  const seg = (id: string, v: string) => { for (const c of $(id).children) c.classList.toggle('on', (c as HTMLElement).dataset.v === v); };
  seg('setup-mode', choice.survival ? 'survival' : 'campaign');
  seg('setup-diff', choice.diff);
  seg('setup-src', choice.source);
  seg('gen-tier', String(choice.tier));
  show('map-row', !gen); show('gen', gen); show('map-tier', !gen);
  for (const c of mapCards) {
    c.btn.classList.toggle('on', !gen && c.def === choice.map);
    // the line is always there, so the cards keep their height whatever difficulty or mode is chosen
    const t = recText(c.def);
    c.rec.textContent = t || 'No record yet'; c.rec.classList.toggle('none', !t);
  }
  const endless = choice.survival || (setupFor === 'lobby' && lobbyMode === 'versus');
  for (const c of $('setup-diff').children) { const sm = c.querySelector('small'), df = diffById((c as HTMLElement).dataset.v); if (sm) sm.textContent = endless ? 'no end' : `${df.waves} waves`; }
  if (gen) {
    const lanes = choice.map.lanes.length, t = recText(choice.map);
    setText('gen-info', `${choice.map.name}. ${lanes} ${lanes === 1 ? 'road' : 'roads'}.${t ? ' ' + t + '.' : ''} The same seed and layout always give the same map.`);
  }
  const waves = setupFor === 'lobby' && lobbyMode === 'versus' ? 'No last wave: the last core standing wins.' : choice.survival ? 'Survival has no last wave.'
    : `${d.waves} waves to win.`;
  setText('setup-desc', `${choice.map.desc || 'A custom map.'} ${d.name}: ${d.desc} ${waves}`);
}
function setSource(src: 'premade' | 'generated') {
  choice.source = src;
  if (src === 'generated') regen(); else choice.map = premade;
}
function setTierAuto() { if (choice.tierAuto) choice.tier = DIFF_TIER[choice.diff] || 2; }
function openSetup(target: 'solo' | 'lobby') {
  setupFor = target;
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
    // generated maps are called "Sector K-17 Ashfall": the place name is the title, the sector code goes to the small line
    const sec = /^Sector ([A-Z]-\d+) (.+)$/.exec(m.name);
    b.title = m.name;
    b.append(cv, el('b', '', sec ? sec[2] : m.name), el('span', 'sub', `${sec ? sec[1] + ' · ' : ''}${TIER_NAME[m.tier] || 'Custom'} · ${m.lanes.length} ${m.lanes.length > 1 ? 'roads' : 'road'}`), rec);
    b.addEventListener('click', () => { premade = m; choice.map = m; choice.source = 'premade'; sound.play('click'); refreshSetup(); });
    row.appendChild(b);
    mapCards.push({ def: m, btn: b, rec });
  }
  // how many maps each filter holds
  for (const b of $('map-tier').children) {
    const v = +((b as HTMLElement).dataset.v || 0), sm = b.querySelector('small');
    if (sm) sm.textContent = String(v ? all.filter((m) => (m.tier || 0) === v).length : all.length);
  }
  applyMapFilter();
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
  // the chosen map is in view when the sheet opens; the grid scrolls inside its own box
  mapCards.find((c) => c.def === choice.map && !c.btn.classList.contains('hidden'))?.btn.scrollIntoView({ block: 'nearest' });
}
for (const b of $('map-tier').children) b.addEventListener('click', () => {
  mapFilter = clamp(+((b as HTMLElement).dataset.v || 0) | 0, 0, 3);
  sound.play('click');
  applyMapFilter();
  $('map-row').scrollTop = 0;
});
for (const b of $('setup-mode').children) b.addEventListener('click', () => {
  // the mode changes nothing else: the chosen map stays chosen
  const v = (b as HTMLElement).dataset.v;
  choice.survival = v === 'survival';
  sound.play('click');
  refreshSetup();
});
for (const b of $('setup-src').children) b.addEventListener('click', () => {
  sound.play('click');
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
// an emptied seed field gets a fresh seed instead of silently standing for 0
$<HTMLInputElement>('gen-seed').addEventListener('change', (e) => {
  const i = e.target as HTMLInputElement;
  if (i.value !== '') return;
  choice.seed = newSeed(); i.value = String(choice.seed);
  clearTimeout(genTimer); regen(); refreshSetup();
});
function saveSetup() {
  clearTimeout(genTimer);
  if (choice.source === 'generated') regen();
  store.setup = { survival: choice.survival, source: choice.source, map: premade.id, mapName: premade.name, seed: choice.seed, tier: choice.tier, tierAuto: choice.tierAuto, diff: choice.diff, filter: mapFilter };
  save();
}
/** Bring the saved setup back. Called at boot and after a progress reset. */
function loadSetup() {
  const u = store.setup;
  choice.diff = diffById(u.diff).id; choice.survival = u.survival; choice.source = u.source;
  choice.seed = u.seed; choice.tier = u.tier; choice.tierAuto = u.tierAuto;
  mapFilter = u.filter;
  setTierAuto();
  premade = mapById(u.map) || loadCustomMaps().find((m) => m.id === u.map && m.name === u.mapName) || MAPS[0];
  choice.map = premade;
  if (choice.source === 'generated') { try { choice.map = generateMap(choice.seed, choice.tier); } catch { choice.source = 'premade'; } }
}
function openEditorScreen() {
  for (const id of ['menu', 'setup', 'lobby']) show(id, false);
  show('editor');
  openEditor($('editor'), {
    play(def) { choice.map = def; premade = def; choice.source = 'premade'; choice.survival = false; show('editor', false); startGame('solo', { editor: true }); },
    close() { show('editor', false); show('menu'); },
    sound(name) { sound.play(name); },
  }, choice.source === 'generated' || MAPS.includes(choice.map) ? undefined : choice.map);
}
loadSetup();

// ---------- music sheet (the playlist UI itself is built by the music module) ----------
const music = initMusic({
  root: $('music-root'),
  setScoreMuted: (muted) => sound.setScoreMuted(!!muted),
  tracks: TRACKS.map((t) => ({ id: t.id, name: t.name, meta: `${t.key} / ${t.bpm} BPM` })),
  // choosing a track outside a run plays it, so the list can be listened through from the menu
  setTrack: (id) => { sound.setTrack(id); if (sound.ctx && !sound.playing && id !== 'shuffle') sound.startMusic(); },
  setPlaylist: (ids) => sound.setPlaylist(ids),
  nowPlaying: () => (sound.playing ? sound.trackId : ''),
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
// the tutorial from the menu: the first map on the easiest setting, with the guide switched back on
click('m-tutorial', () => { store.tips.tutorial = false; save(); show('menu', false); startGame('solo', { map: MAPS[0], diff: 'easy', survival: false }); });
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
// A test play goes straight back to the editor. The draft is still there: the editor keeps it between visits.
const backToEditor = () => { sound.stopMusic(); startAttract(); openEditorScreen(); };
click('p-editor', backToEditor);
click('e-editor', backToEditor);
click('e-again', () => { if (mode === 'solo') startGame('solo', { editor: editorRun }); else { const m = mode === 'versus' ? 'versus' : 'coop'; sound.stopMusic(); startAttract(); openLobby(m); } });
click('e-menu', () => { sound.stopMusic(); startAttract(); });
click('e-endless', () => { sim.over = false; sim.won = false; sim.endless = true; sim.nextWaveIn = 5; ended = false; show('end', false); toast('No last wave from here on. How far can you go?'); });
// A HUD button must not keep the keyboard focus, or Space (the special key) would press it again.
$('hud').addEventListener('click', () => { const a = document.activeElement; if (a instanceof HTMLButtonElement) a.blur(); });
// The pause and speed chips act on press (wired up by the touch module), so a second finger reaches them too.
function pressPause() { sound.init(); sound.play('click'); togglePause(); }
function pressSpeed() {
  if (mode !== 'solo' || !playing()) return;
  sound.init(); sound.play('click');
  speed = speed === 1 ? 2 : 1; setText('btn-speed', speed + 'x');
}
click('btn-wave', () => act.wave());
click('t-up', () => { if (selected) act.upgrade(selected); });
click('t-sell', () => { if (selected && act.sell(selected)) selected = 0; });
$('t-special').addEventListener('click', () => { sound.init(); if (selected) act.special(selected); });
click('f-sell', () => { if (selFac && act.sellFac(selFac)) selFac = 0; });
click('f-turn', () => turnSelected());
click('f-up', () => { if (selFac) act.upFac(selFac); });
// the deposit panel's apricot line looks like a button: it picks the building it names (a locked one stays a note)
$('o-pick').addEventListener('click', () => { sound.init(); const o = selOre && freeOre(selOre.cx, selOre.cz); if (o && !oreBuildLine(o).locked) pickFac(oreFac(o)); });
click('btn-rings', () => { settings.rings = !settings.rings; save(); sound.play('click'); note(settings.rings ? 'Supply rings on: between waves a green ring marks everything that will be supplied.' : 'Supply rings off: they show while you place something.'); });
click('btn-auto', () => { settings.auto = !settings.auto; save(); if (mode === 'solo' && !bot) sim.autoWaves = settings.auto; note(settings.auto ? 'Auto waves on: the next wave starts by itself after a pause.' : 'Auto waves off: waves start when you call them.'); });
click('h-tutorial', () => { store.tips.tutorial = false; save(); show('help', false); if (helpFrom === 'pause') { togglePause(false); if (mode === 'solo' && !bot && !ended) startGuide(); else note('The tutorial starts with your next solo run.'); } else { show(helpFrom); note('The tutorial starts with your next solo run.'); } });
function togglePause(on = !menuOpen()) {
  if (mode === 'attract' || ended) return;
  paused = on && mode === 'solo';
  for (const id of OVERLAYS) show(id, false);
  show('pause', on);
  if (on) { rotating = false; dragging = false; painting = false; }
}
/** Escape on a sheet that has a way back: take it. Returns false when no such sheet is open. */
function escBack(): boolean {
  const open = ([['help', 'h-back'], ['settings', 's-back'], ['music', 'mu-back'], ['setup', 'setup-back'], ['lobby', 'l-back']] as const).find(([id]) => shown(id));
  if (open) $(open[1]).click();
  return !!open;
}

// ---------- settings ----------
const bind = (id: string, key: 'vol' | 'mus', fn: (v: number) => void) => {
  const i = $<HTMLInputElement>(id);
  i.value = String(settings[key]);
  i.addEventListener('input', () => { settings[key] = clamp(+i.value || 0, +i.min, +i.max); fn(settings[key]); });
  i.addEventListener('change', save);
};
bind('set-vol', 'vol', (v) => sound.setVolume(v / 100));
bind('set-mus', 'mus', (v) => sound.setMusic(v / 100));
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
  store.records = {}; store.tips = { node: false, boss: false, mite: false, titan: false, factory: false, dry: false, tutorial: false }; store.setup = defaultSetup();
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
addEventListener('pointerdown', (e) => { byTouch = e.pointerType === 'touch'; if (byTouch) tipHover = null; }, { capture: true, passive: true });
addEventListener('pointermove', (e) => { if (byTouch && e.pointerType === 'mouse' && (e.movementX || e.movementY)) byTouch = false; }, { capture: true, passive: true });
// Which mouse buttons are down, wherever the press landed (the card picker waits until they are let go).
for (const ev of ['mousedown', 'mouseup'] as const) addEventListener(ev, (e) => { mouseBtns = e.buttons; }, { capture: true, passive: true });

const lastMouse = { x: innerWidth / 2, y: innerHeight / 2 };
const playing = () => mode !== 'attract' && !ended && !bot;
/** true while the player's input should reach the game: no menu sheet and no card picker in the way */
const active = () => playing() && !paused && !menuOpen() && !shown('cards');

// ---------- the Titan's entrance ----------
// When it leaps, the bird camera swings to the gate, and time slows around the impact. Any key or click hands the camera back early.
type TitanState = { phase: string; t: number } | undefined;
const titanState = () => (sim as unknown as { titan?: TitanState }).titan;
let cine: { t: number; x: number; z: number; fx: number; fz: number; fd: number } | null = null;
const TITAN_LAND_S = 2.5; // seconds from the leap to the impact (TITAN_LAND in the rules)
function titanEntrance(x: number, z: number) {
  if (mode === 'attract' || !Number.isFinite(x) || !Number.isFinite(z)) return;
  const c = bird(); cine = { t: 0, x, z, fx: c.x, fz: c.z, fd: c.dist };
}
/** Slow motion around the impact. Only where the rules run (the host in co-op), so both players see the same. */
function titanSlow() {
  const t = titanState();
  if (!t || isClient || mode === 'attract') return 1;
  if (t.phase === 'landing' && t.t > TITAN_LAND_S - 0.7) return 0.35;
  if (t.phase === 'walk' && t.t < 0.5) return 0.35;
  return 1;
}
function titanCamera(dt: number) {
  const t = titanState();
  if (!cine) return;
  cine.t += dt;
  const c = bird(), u = Math.min(1, cine.t / 1.1), k = u * u * (3 - 2 * u);
  // aim between the gate and the middle of the deck, so the leap and the road it lands on are both in frame
  c.x = cine.fx + (cine.x * 0.55 - cine.fx) * k; c.z = cine.fz + (cine.z * 0.55 - cine.fz) * k; c.dist = cine.fd + (52 - cine.fd) * k;
  if (sim.over || cine.t > 6 || !t || (t.phase !== 'landing' && t.phase !== 'walk')) cine = null;
}

const TAU = Math.PI * 2;
/** A growing cam.rot turns the board clockwise on screen (measured by projecting ground points before and after a turn). */
const ROT_SIGN = 1;
function clampCam() { const c = bird(); c.x = clamp(c.x, -30, 30); c.z = clamp(c.z, -22, 24); }
const ga = new THREE.Vector3(), gb = new THREE.Vector3();
/**
 * Drag the board: the ground point that was under (x0, y0) ends up under (x1, y1). It is worked out from the
 * camera as it stands, so the grabbed point stays under the cursor at any zoom and any rotation.
 */
function panBy(x0: number, y0: number, x1: number, y1: number) {
  const c = bird();
  view.groundPoint(x0, y0, ga); view.groundPoint(x1, y1, gb);
  let dx = ga.x - gb.x, dz = ga.z - gb.z;
  const m = Math.hypot(dx, dz), cap = c.dist * 0.25;
  if (!Number.isFinite(m) || m === 0) return;
  if (m > cap) { dx *= cap / m; dz *= cap / m; } // near the horizon one pixel is a long way
  c.x += dx; c.z += dz; clampCam();
  zoomS.anchor = false; // a drag during a zoom wins: the zoom carries on around the middle
}
function pan(dx: number, dy: number, x = lastMouse.x, y = lastMouse.y) { panBy(x - dx, y - dy, x, y); }
/** Turn the bird camera around the point it looks at. A positive angle turns the board clockwise on screen. */
function rotateCam(a: number) { if (Number.isFinite(a)) { const c = bird(); c.rot = (c.rot || 0) + a * ROT_SIGN; } }
// Zoom goes toward a point on the screen (the cursor, or the middle of a pinch): the ground under that point
// stays under it. The wheel eases to its target, a pinch follows the fingers at once.
const zoomS = { on: false, target: 48, rate: 0, anchor: false, x: 0, y: 0, gx: 0, gz: 0 };
/** factor above 1 zooms in */
function zoomAt(factor: number, x: number, y: number, eased: boolean) {
  if (!(factor > 0) || !Number.isFinite(factor)) return;
  const c = bird();
  zoomS.target = clamp((zoomS.on ? zoomS.target : c.dist) / factor, 14, 84);
  zoomS.rate = eased ? 16 : 0;
  // several steps toward the same point keep the first anchor: the camera on screen is a frame behind the numbers
  if (!zoomS.on || !zoomS.anchor || Math.abs(x - zoomS.x) > 2 || Math.abs(y - zoomS.y) > 2) {
    view.groundPoint(x, y, ga);
    zoomS.anchor = Number.isFinite(ga.x + ga.z) && Math.abs(ga.x) < 90 && Math.abs(ga.z) < 90;
    zoomS.x = x; zoomS.y = y; zoomS.gx = ga.x; zoomS.gz = ga.z;
  }
  zoomS.on = true;
}
/** Before the frame is drawn: move toward the zoom target and shift the camera so the anchor keeps its place. */
function zoomStep(dt: number) {
  if (!zoomS.on) return;
  const c = bird(), d0 = c.dist;
  let d1 = zoomS.rate ? d0 + (zoomS.target - d0) * (1 - Math.exp(-dt * zoomS.rate)) : zoomS.target;
  if (Math.abs(zoomS.target - d1) < 0.03) d1 = zoomS.target;
  if (zoomS.anchor && d0 > 0) { const k = 1 - d1 / d0; c.x += (zoomS.gx - c.x) * k; c.z += (zoomS.gz - c.z) * k; }
  c.dist = d1;
  clampCam();
}
/** After the frame is drawn: the tilt changes with the distance, so the anchor is put back exactly where it was. */
function zoomFix() {
  if (!zoomS.on) return;
  const c = bird();
  if (zoomS.anchor) {
    view.groundPoint(zoomS.x, zoomS.y, gb);
    const ex = zoomS.gx - gb.x, ez = zoomS.gz - gb.z, m = Math.hypot(ex, ez);
    if (Number.isFinite(m) && m > 1e-4 && m < c.dist * 0.2) { c.x += ex; c.z += ez; clampCam(); }
  }
  if (c.dist === zoomS.target) zoomS.on = false;
}
/** Q / E and the pan keys ease in and out: -1..1 of full speed, sideways, forward and turning. */
const keyV = { x: 0, y: 0, r: 0 };
function hoverAt(clientX: number, clientY: number) {
  lastMouse.x = clientX; lastMouse.y = clientY;
  view.groundPoint(clientX, clientY, gp);
  const [cx, cz] = worldToCell(gp.x, gp.z), moved = cx !== hover.cx || cz !== hover.cz;
  hover.cx = cx; hover.cz = cz;
  if (moved && painting) paintTo(cx, cz);
  refreshGhost();
}
const inBoard = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < GW && cz < GH;
const FAC_WHY_CREDITS = 'not enough credits';
/** Place the chosen factory building on a tile. Says why not when it cannot go there. */
function placeFac(cx: number, cz: number, quiet = false): Fac | null {
  if (!buildFac) return null;
  const why = sim.facBlock(buildFac, cx, cz);
  if (why) { if (!quiet) { sound.play('error'); note(`${FACS[buildFac].name}: ${why === FAC_WHY_CREDITS ? 'Not enough credits.' : `cannot go here (${why}).`}`); } return null; }
  const f = act.fac(buildFac, cx, cz, facDir);
  // a tunnel says at once whether it found its other end
  if (f && !quiet && (f.type === 'tunnel' || f.type === 'ptunnel')) {
    sim.factory.sync();
    const o = f.pair ? sim.factory.facById(f.pair) : undefined;
    if (o) note(`${FACS[f.type].name} linked: ${hexDist(f.cx, f.cz, o.cx, o.cz)} tiles${f.type === 'tunnel' ? ` from ${f.exit ? 'its entrance' : 'its exit'}` : ''}.`);
    else note(f.type === 'tunnel' ? `Now build the other end facing the same way, in line with its arrow and up to ${TUNNEL_REACH} tiles away.` : `Now build the other Pipe Tunnel in a straight line, up to ${TUNNEL_REACH} tiles away.`);
  }
  return f;
}
/**
 * The button is held while placing belts or pipes: each tile the cursor enters gets one. A belt laid this way points the
 * way the line goes (the one before it is turned to lead into it), so a drag lays a working conveyor.
 */
function paintTo(cx: number, cz: number) {
  if (!buildFac || !inBoard(cx, cz)) return;
  // the cursor may skip tiles on a fast drag: walk from the last tile to this one a neighbour at a time (along the hex line
  // where there is one, else always to the neighbour nearest the target), so every belt of the line leads into the next
  const path: [number, number][] = [];
  if (paintAt.cx < 0) path.push([cx, cz]);
  else {
    let c: [number, number] = [paintAt.cx, paintAt.cz];
    for (let i = 0; i < 60 && (c[0] !== cx || c[1] !== cz); i++) {
      let best = c, bd = Infinity;
      for (let d = 0; d < 6; d++) { const n = neighbor(c[0], c[1], d), dd = hexDist(n[0], n[1], cx, cz); if (dd < bd) { bd = dd; best = n; } }
      c = best; path.push(c);
    }
  }
  for (const [x, z] of path) {
    const prev = paintAt.cx >= 0 ? sim.factory.facAt(paintAt.cx, paintAt.cz) : undefined;
    const d = paintAt.cx >= 0 ? lineDir(paintAt.cx, paintAt.cz, x, z) : -1;
    if (buildFac === 'belt' && d >= 0) {
      facDir = d;
      if (prev && prev.type === 'belt') act.turnFac(prev.id, d);
    }
    const there = sim.factory.facAt(x, z);
    // an existing belt on the way joins the line: it is turned to carry on in the direction of the drag when the next tile comes
    if (!there) placeFac(x, z, true);
    paintAt.cx = x; paintAt.cz = z;
  }
}
/** R, or the Turn button: the belt or tunnel about to be placed turns, or the selected one does. */
function turnSelected() {
  const f = selFac ? sim.factory.facById(selFac) : undefined;
  if (f && turns(f.type) && !buildFac) { act.turnFac(f.id, f.dir + 1); sound.play('click'); return; }
  facDir = (facDir + 1) % 6; sound.play('click'); refreshGhost();
}
/** A click or tap on the board: build with what is chosen, else select what is there. */
function boardTap(clientX: number, clientY: number, keep: boolean) {
  hoverAt(clientX, clientY);
  if (buildFac) {
    // a tap on a belt (or tunnel) with the same chosen turns it to the direction a new one would face
    const there = sim.factory.facAt(hover.cx, hover.cz);
    if (there && there.type === buildFac && turns(buildFac)) { act.turnFac(there.id, facDir); sound.play('click'); return; }
    // logistics stay picked (a line, a tunnel pair, a row of poles); a building is placed once
    if (placeFac(hover.cx, hover.cz) && !keep && !LOGISTICS.has(buildFac)) { buildFac = null; view.setFacGhost(null); }
    refreshGhost();
    return;
  }
  if (buildType) {
    if (act.build(buildType, hover.cx, hover.cz)) { if (!keep) { buildType = null; view.setGhost(null); } }
    else {
      sound.play('error');
      const free = inBoard(hover.cx, hover.cz) && sim.grid[hover.cz * GW + hover.cx] === 0;
      note(!free ? 'You cannot build there.' : sim.gold < sim.cost(buildType) ? 'Not enough credits.' : sim.mats < sim.matCost(buildType) ? 'Not enough building materials. Deliver Frames to a Depot.' : 'You cannot build there.');
    }
    refreshGhost();
    return;
  }
  const t = sim.towers.find((x) => x.cx === hover.cx && x.cz === hover.cz);
  const f = t ? undefined : sim.factory.facAt(hover.cx, hover.cz);
  selected = t ? t.id : 0; selFac = f ? f.id : 0;
  // a free deposit tile: what lies there and what to build on it
  const o = t || f ? null : freeOre(hover.cx, hover.cz);
  selOre = o ? { cx: hover.cx, cz: hover.cz } : null;
  if (t || f || o) sound.play('click');
}
/** Any press skips the opening camera move, if the view has one running. */
function skipIntro() { if (vx.introActive?.()) { vx.skipIntro?.(); return true; } return false; }
/** Drop whatever is chosen for building. */
function dropBuild() { buildType = null; buildFac = null; painting = false; view.setGhost(null); view.setFacGhost(null); }

addEventListener('keydown', (e) => {
  if (cine) cine = null; // any key or click hands the camera back during the Titan's entrance
  // Typing into a field is not a hotkey. A focused slider or checkbox does not type, so Escape and P still work there.
  const typing = e.target instanceof HTMLInputElement ? !['range', 'checkbox', 'color'].includes(e.target.type) : e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  if (typing) return;
  const k = e.key.toLowerCase();
  if (k === 'f3') { e.preventDefault(); if (!e.repeat) toggleDiag(); return; }
  keys.add(k);
  byTouch = false;
  // Escape is "back" on any sheet that has a way back, in a run and from the main menu alike
  if (k === 'escape' && !e.repeat && !shown('cards') && escBack()) return;
  if (!playing()) return;
  skipIntro();
  // a card takes a fresh key press: a held key or a repeat never picks one
  if (shown('cards')) { if (!e.repeat && k >= '1' && k <= '3') pickCard(+k - 1); return; }
  if (k === 'escape') {
    if (e.repeat) return;
    if (buildType || buildFac || selected || selFac || selOre) { dropBuild(); selected = 0; selFac = 0; selOre = null; } else togglePause();
    return;
  }
  if (k === 'p') { togglePause(); return; }
  if (paused || menuOpen()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === ' ') { e.preventDefault(); if (!e.repeat && selected) act.special(selected); return; }
  if (k === 'f' && !e.repeat) { sound.play('click'); setTab(barTab === 'towers' ? 'factory' : 'towers'); return; }
  if (barTab === 'factory') { const f = k >= '0' && k <= '9' && k.length === 1 ? facList()[(+k + 9) % 10] : undefined; if (f) { pickFac(f); return; } }
  else { const t = TOWER_TYPES.find((x) => TOWERS[x].key === k); if (t) { pickBuild(t); return; } }
  if (k === 'r' && !e.repeat) turnSelected();
  else if (k === 'u' && selected) act.upgrade(selected);
  else if (k === 'u' && selFac) act.upFac(selFac);
  else if (k === 'x' && selected) { if (act.sell(selected)) selected = 0; }
  else if (k === 'x' && selFac) { if (act.sellFac(selFac)) selFac = 0; }
  else if (k === 'n') act.wave();
  else if (k === 'g' && mode === 'solo') pressSpeed();
  else if (k === 'home' && !e.repeat) { const c = bird(), turn = Math.round((c.rot || 0) / TAU) * TAU; frameBoard(); if (typeof c.rot === 'number') c.rot = turn; }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); dragging = false; rotating = false; painting = false; mouseBtns = 0; });

// Mouse movement is read from the whole page, not only the canvas: a HUD element under the cursor must never stop a drag.
document.addEventListener('mousemove', (e) => {
  lastMouse.x = e.clientX; lastMouse.y = e.clientY;
  overBoard = e.target === canvas;
  if (!playing()) return;
  if (painting && !(e.buttons & 1)) painting = false;
  if (rotating) rotateCam(-e.movementX * 0.006); // dragging right turns the board counter-clockwise: its near side follows the mouse
  else if (dragging) panBy(e.clientX - e.movementX, e.clientY - e.movementY, e.clientX, e.clientY);
  if (e.target === canvas || dragging || rotating || painting) hoverAt(e.clientX, e.clientY);
});
canvas.addEventListener('mousedown', (e) => {
  if (cine) cine = null; // any key or click hands the camera back during the Titan's entrance
  sound.init();
  if (!active() || skipIntro()) return;
  if (e.button === 1) { e.preventDefault(); rotating = true; return; } // middle-drag turns the view
  if (e.button === 2) { if (buildType || buildFac) dropBuild(); else { selected = 0; selFac = 0; selOre = null; } dragging = true; return; }
  if (e.button !== 0) return;
  boardTap(e.clientX, e.clientY, e.shiftKey);
  // belts, pipes and poles: keep the button down and drag to lay a line
  if (buildFac === 'belt' || buildFac === 'pipe') { painting = true; paintAt.cx = hover.cx; paintAt.cz = hover.cz; }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) { painting = false; paintAt.cx = paintAt.cz = -1; }
  if (e.button === 2) dragging = false; if (e.button === 1) rotating = false;
});
document.addEventListener('contextmenu', (e) => { if (e.target === canvas) e.preventDefault(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!active()) return;
  // One notch of a wheel is about 100 units and zooms by about 12%. A touchpad sends many small steps, which add up
  // to the same. Lines and pages are converted, and a pinch on a touchpad (it arrives with Ctrl set) is scaled up.
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1;
  const d = clamp(e.deltaY * unit * (e.ctrlKey ? 4 : 1), -300, 300);
  if (d) zoomAt(Math.exp(-d * 0.0012), e.clientX, e.clientY, true);
}, { passive: false });
addEventListener('resize', () => view.resize());

// Touch: the same actions as above, driven by the touch module.
const touchApi = {
  canvas,
  turn() { sound.init(); if (active()) turnSelected(); },
  // a finger that held and dragged the ghost lays belts on the way, like a held mouse button
  hoverEnd() { painting = false; paintAt.cx = paintAt.cz = -1; },
  tap(clientX: number, clientY: number) { sound.init(); if (!active() || skipIntro()) return; boardTap(clientX, clientY, false); },
  hoverAt(clientX: number, clientY: number) {
    if (!active()) return;
    if (!painting && (buildFac === 'belt' || buildFac === 'pipe')) { hoverAt(clientX, clientY); painting = true; paintAt.cx = hover.cx; paintAt.cz = hover.cz; placeFac(hover.cx, hover.cz, true); return; }
    hoverAt(clientX, clientY);
  },
  pan(dx: number, dy: number, x: number, y: number) { if (active()) pan(dx, dy, x, y); },
  zoom(factor: number, x = innerWidth / 2, y = innerHeight / 2) { if (active()) zoomAt(factor, x, y, false); },
  rotate(angle: number) { if (active()) rotateCam(angle); }, // the board turns with the fingers, like a paper map
  pause: pressPause,
  speed: pressSpeed,
};
initTouch(touchApi);

// ---------- phones held upright ----------
// Only over a run: the menus, setup, settings, help and the editor all lay out fine upright. The run is held (no pause sheet)
// while the prompt is up and goes on by itself once the phone is turned, or once the player chooses to play upright.
let rotSync = () => {};
{
  const mq = matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 600px)');
  let dismissed = false, held = false;
  rotSync = () => {
    const on = mq.matches && !dismissed && playing() && !menuOpen();
    if (shown('rotate') !== on) show('rotate', on);
    if (on && !paused && mode === 'solo') { paused = true; held = true; }
    else if (!on && held) { held = false; if (!menuOpen()) paused = false; }
  };
  mq.addEventListener('change', rotSync);
  click('rot-go', () => { dismissed = true; rotSync(); });
  rotSync();
}

// ---------- diagnostics (F3) ----------
// A small readout for hunting down a sluggish frame. It costs nothing while it is off.
const diag = { on: false, last: 0, t: 0, n: 0, sum: 0, worst: 0, fps: 0, avg: 0, max: 0, text: '' };
function toggleDiag() {
  diag.on = !diag.on;
  diag.last = 0; diag.t = 0; diag.n = 0; diag.sum = 0; diag.worst = 0; diag.text = '';
  show('diag', diag.on);
}
/** Called once a frame. The game caps its own step at 100 ms, so the time is read from the clock here: a long stall shows at its real length. */
function diagFrame(dt: number) {
  if (!diag.on) return;
  const now = performance.now(), ms = diag.last ? now - diag.last : dt * 1000;
  diag.last = now;
  diag.n++; diag.sum += ms; diag.t += ms; if (ms > diag.worst) diag.worst = ms;
  if (diag.t < 1000 && diag.text) return;
  if (diag.n) { diag.avg = diag.sum / diag.n; diag.fps = 1000 / Math.max(0.01, diag.avg); diag.max = diag.worst; }
  diag.t = 0; diag.n = 0; diag.sum = 0; diag.worst = 0;
  const c = canvas, post = (view as unknown as { post?: { ao?: { enabled?: boolean } | null } }).post;
  const ao = view.quality === 'high' && !!post?.ao?.enabled;
  let items = 0;
  for (const f of sim.factory.facs) items += f.items.length;
  diag.text = `F3 diagnostics\nfps ${diag.fps.toFixed(0)}   frame ${diag.avg.toFixed(1)} ms avg, ${diag.max.toFixed(1)} ms worst (1 s)\n`
    + `dpr ${(window.devicePixelRatio || 1).toFixed(2)}   canvas ${c.width} x ${c.height}\n`
    + `quality ${view.quality}   ambient occlusion ${ao ? 'on' : 'off'}\n`
    + `factory ${sim.factory.facs.length} buildings, ${items} items on belts, ${sim.factory.powerNets.length} power grids, ${sim.factory.pipeNets.length} pipe networks`;
  $('diag').textContent = diag.text;
}

// ---------- the guided first run ----------
// A handful of steps, each ticked off by doing it: a turret beside a crate, the first wave, a mine, a belt, a card, power.
// Time stands still between waves, so a step about supply is ticked off by the static diagnosis, not by items arriving.
// Each step can point at tiles on the board. It runs on the first solo run and can be replayed from How to play.
/** A tutorial marker: an arrow over a tile ('here'), or a chevron on a tile of a belt to lay ('path', `i` along it, `a` its screen heading toward the next tile). */
interface GuideMark { x: number; y: number; z: number; kind: 'here' | 'path'; i?: number; nx?: number; nz?: number }
interface GuideStep { title: string; text: () => string; done: () => boolean; ready?: () => boolean; points?: () => GuideMark[]; ok?: boolean; tab?: 'towers' | 'factory' }
const guide = { on: false, i: 0, t: 0, acked: false };
const guideOn = () => guide.on;
const oreIdx = (o: OreType) => ORE_TYPES.indexOf(o) + 1;
const oreTiles = (ore: number, max: number): GuideMark[] => {
  // the deposit tiles of one kind, the ones nearest a tower first
  const out: number[][] = [], F = sim.factory;
  for (let i = 0; i < GW * GH; i++) if (F.ore[i] === ore && !F.at[i] && sim.grid[i] === 0) out.push([i % GW, Math.floor(i / GW)]);
  const d = (c: number[]) => Math.min(99, ...sim.towers.map((t) => hexDist(t.cx, t.cz, c[0], c[1])));
  return out.sort((a, b) => d(a) - d(b)).slice(0, max).map(([cx, cz]) => tileMark(cx, cz));
};
const tileMark = (cx: number, cz: number, kind: 'here' | 'path' = 'here', i = 0): GuideMark => ({ x: cellX(cx, cz), y: 0.4, z: cellZ(cz), kind, i });
const kb = () => !touchUi();
/**
 * The chain the tutorial points at: a Pulse Turret (built, or a free hex beside a crate of iron ore), an iron deposit (a Mine
 * on it, or a free deposit tile) and a line of free deck between them for a belt (deposit tiles are fine, roads, towers and
 * buildings are not). Worked out by a flood fill over the board as it stands, so nothing marked is ever out of reach: a
 * deposit across the road is never paired with a turret on the other side. What is built already is preferred; a mine
 * right beside the turret needs no belt, so a short belt of 2 to 5 tiles is preferred over none.
 */
interface Chain { tur: [number, number]; turNew: boolean; mine: [number, number]; mineNew: boolean; path: [number, number][] }
const chainMemo = { sim: null as Sim | null, key: '', plan: null as Chain | null };
function chainPlan(): Chain | null {
  const F = sim.factory, key = `${F.rev}:${sim.towers.map((t) => t.id).join()}`;
  if (chainMemo.sim === sim && chainMemo.key === key) return chainMemo.plan;
  const free = (cx: number, cz: number) => inBoard(cx, cz) && sim.grid[cz * GW + cx] === 0;
  // the chain already shown stays while it still holds: its turret and mine built or still free (and nothing else built in their
  // place), every belt tile free or a belt. Planning afresh would route round the first belt the player lays and move the marks.
  const old = chainMemo.sim === sim ? chainMemo.plan : null;
  if (old) {
    const tw = sim.towers.find((t) => t.cx === old.tur[0] && t.cz === old.tur[1]), turBuilt = !!tw && tw.type === 'pulse';
    const mf = F.facAt(old.mine[0], old.mine[1]), mineBuilt = !!mf && mf.type === 'mine' && mf.ore === 'iron_ore';
    const turOk = turBuilt || (free(old.tur[0], old.tur[1]) && !sim.towers.some((t) => t.type === 'pulse'));
    const mineOk = mineBuilt || (free(old.mine[0], old.mine[1]) && !F.facs.some((f) => f.type === 'mine' && f.ore === 'iron_ore'));
    if (turOk && mineOk && old.path.every(([x, z]) => free(x, z) || F.facAt(x, z)?.type === 'belt')) {
      chainMemo.key = key; chainMemo.plan = { ...old, turNew: !turBuilt, mineNew: !mineBuilt };
      return chainMemo.plan;
    }
  }
  const near = (cx: number, cz: number) => [0, 1, 2, 3, 4, 5].map((d) => neighbor(cx, cz, d)).filter(([x, z]) => inBoard(x, z));
  const iron = oreIdx('iron_ore');
  // turrets: the built Pulse Turrets, else free hexes (off the deposits if there are any) beside a crate of iron ore
  const turs: { c: [number, number]; isNew: boolean }[] = sim.towers.filter((t) => t.type === 'pulse').map((t) => ({ c: [t.cx, t.cz], isNew: false }));
  const spots: [number, number][] = [];
  for (const f of F.facs) if (f.type === 'crate' && f.hold === 'iron_ore' && f.left > 0) for (const [x, z] of near(f.cx, f.cz)) if (free(x, z) && !spots.some((c) => c[0] === x && c[1] === z)) spots.push([x, z]);
  const bare = spots.filter(([x, z]) => !F.ore[z * GW + x]);
  for (const c of bare.length ? bare : spots) turs.push({ c, isNew: true });
  // mines: the iron mines built, and every free iron deposit tile
  const mines: { c: [number, number]; isNew: boolean }[] = F.facs.filter((f) => f.type === 'mine' && f.ore === 'iron_ore').map((f) => ({ c: [f.cx, f.cz], isNew: false }));
  for (let i = 0; i < GW * GH; i++) if (F.ore[i] === iron && sim.grid[i] === 0) mines.push({ c: [i % GW, Math.floor(i / GW)], isNew: true });
  const hasMine = mines.some((m) => !m.isNew);
  let best: Chain | null = null, bestCost = Infinity;
  const dist = new Int16Array(GW * GH), from = new Int32Array(GW * GH);
  for (const m of mines) {
    const [mx, mz] = m.c, mi = mz * GW + mx;
    // flood fill over free deck from the tiles beside the mine
    dist.fill(-1);
    const q: number[] = [];
    for (const [x, z] of near(mx, mz)) if (free(x, z)) { const j = z * GW + x; dist[j] = 0; from[j] = -1; q.push(j); }
    dist[mi] = -2;
    for (let h = 0; h < q.length; h++) {
      const j = q[h];
      for (const [x, z] of near(j % GW, Math.floor(j / GW))) { const n = z * GW + x; if (dist[n] === -1 && free(x, z)) { dist[n] = dist[j] + 1; from[n] = j; q.push(n); } }
    }
    for (const t of turs) {
      const [tx, tz] = t.c, ti = tz * GW + tx;
      if (ti === mi) continue;
      let len = -1, end = -1;
      if (hexDist(mx, mz, tx, tz) === 1) len = 0;
      else for (const [x, z] of near(tx, tz)) { const n = z * GW + x; if (n !== ti && dist[n] >= 0 && (len < 0 || dist[n] + 1 < len)) { len = dist[n] + 1; end = n; } }
      if (len < 0) continue;
      const cost = (len < 2 ? 4 - len : len > 5 ? len : 0) + len * 0.1 + (t.isNew ? 40 : 0) + (m.isNew && hasMine ? 20 : 0);
      if (cost >= bestCost) continue;
      const path: [number, number][] = [];
      for (let j = end; j >= 0; j = from[j]) path.unshift([j % GW, Math.floor(j / GW)]);
      // (a new turret on a tile of the path cannot be: the fill reached the turret's neighbour without crossing it, see the shortest choice above)
      if (t.isNew && path.some(([x, z]) => x === tx && z === tz)) continue;
      bestCost = cost;
      best = { tur: [tx, tz], turNew: t.isNew, mine: [mx, mz], mineNew: m.isNew, path };
    }
  }
  chainMemo.sim = sim; chainMemo.key = key; chainMemo.plan = best;
  return best;
}
/** The markers of the chain: the turret hex and the deposit while they are still to build, the belt tiles with chevrons toward the turret. */
function chainMarks(belt: boolean): GuideMark[] {
  const c = chainPlan();
  if (!c) return [];
  const out: GuideMark[] = [];
  if (c.turNew) out.push(tileMark(c.tur[0], c.tur[1]));
  if (c.mineNew) out.push(tileMark(c.mine[0], c.mine[1]));
  // (a belt already laid along the line pointing on to the next tile needs no chevron any more)
  if (belt) c.path.forEach(([x, z], i) => {
    const [nx, nz] = c.path[i + 1] || c.tur, f = sim.factory.facAt(x, z);
    if (f && f.type === 'belt') { const [ax, az] = neighbor(x, z, f.dir); if (ax === nx && az === nz) return; }
    out.push({ ...tileMark(x, z, 'path', i), nx: cellX(nx, nz), nz: cellZ(nz) });
  });
  return out;
}
/** How many Pulse Turrets the tutorial asks for before the second wave: one mine and a belt feed a row of them. */
const GUIDE_TURRETS = 3;
/**
 * Where the tutorial's extra turrets go: free hexes beside the chain's belt (or beside its mine, which feeds a turret next to
 * it), so whatever the chain can reach, they can too. Off the deposits if possible, and the ones that cover the most road
 * first. As many as are still missing toward GUIDE_TURRETS; the order only drops what gets built, so the marks hold still.
 */
function moreTurrets(): [number, number][] {
  const c = chainPlan(), want = GUIDE_TURRETS - sim.towers.filter((t) => t.type === 'pulse').length;
  if (!c || want <= 0) return [];
  const F = sim.factory, free = (x: number, z: number) => inBoard(x, z) && sim.grid[z * GW + x] === 0;
  const on = new Set([...c.path, c.mine, c.tur].map(([x, z]) => z * GW + x)), seen = new Set<number>();
  const cand: [number, number][] = [];
  for (const [px, pz] of [...c.path, c.mine]) for (let d = 0; d < 6; d++) {
    const [x, z] = neighbor(px, pz, d), i = z * GW + x;
    if (!free(x, z) || on.has(i) || seen.has(i)) continue;
    seen.add(i); cand.push([x, z]);
  }
  const road: [number, number][] = [];
  for (let i = 0; i < GW * GH; i++) if (sim.map.grid[i] === 1) road.push([i % GW, Math.floor(i / GW)]);
  const cover = ([x, z]: [number, number]) => road.filter(([rx, rz]) => hexDist(x, z, rx, rz) <= 4).length - (F.ore[z * GW + x] ? 100 : 0);
  return cand.map((q) => ({ q, v: cover(q) })).sort((a, b) => b.v - a.v).slice(0, want).map((o) => o.q);
}
/** What the upgrade step still points at: the chain's Pulse Turrets (up to GUIDE_TURRETS) and its iron mine while at Mk1. */
function upgradeMarks(): GuideMark[] {
  const out: GuideMark[] = [];
  for (const t of sim.towers.filter((t) => t.type === 'pulse').slice(0, GUIDE_TURRETS)) if (t.lvl < 2) out.push({ x: t.x, y: 1.2, z: t.z, kind: 'here' });
  const m = sim.factory.facs.find((f) => f.type === 'mine' && f.ore === 'iron_ore');
  if (m && m.lvl < 2) out.push({ x: m.x, y: 1.2, z: m.z, kind: 'here' });
  return out;
}
const GUIDE: GuideStep[] = [
  {
    title: 'Build a Pulse Turret beside a crate',
    text: () => `Time stands still until you call a wave, so build first. Towers start empty. The sand-coloured supply crates beside the road hold iron ore, the Pulse Turret's ammunition. ${kb() ? 'Pick the Pulse Turret (key 1)' : 'Tap the Pulse Turret'} and build it on the marked hex beside a crate: a pulse runs from the crate to it and a green ring closes round its base when it will be fed.`,
    done: () => sim.towers.some((t) => t.type === 'pulse' && (t.stock > 0 || t.ammo > 0 || !!sim.diag().get('t' + t.id)?.ok)),
    // (the hex is the turret end of a chain a mine and a belt can still reach; without one, any hex by a crate of iron ore)
    points: () => { const c = chainPlan(); return c && c.turNew ? [tileMark(c.tur[0], c.tur[1])] : sim.factory.facs.filter((f) => f.type === 'crate' && f.hold === 'iron_ore' && f.left > 0).map((f) => ({ x: f.x, y: 1.2, z: f.z, kind: 'here' as const })); },
  },
  {
    title: 'Call the first wave',
    text: () => `Nothing moves until you call: no wave, no factory. When the wave runs, the crate hands its ore to the turret one piece at a time. ${kb() ? 'Press N or the Call first wave button.' : 'Tap Call first wave.'}`,
    done: () => sim.wave >= 1,
  },
  {
    title: 'Build a Mine',
    text: () => `A crate runs out (click it to see what is left). Give the turret a supply of its own: ${kb() ? 'press F for the Factory bar' : 'tap Factory'}, pick the Mine and build it on ${chainPlan() ? 'the marked iron deposit' : 'an iron deposit next to the turret'}, the blue-grey tiles with ore chunks. A mine digs slowly, about one ore every 3 seconds: one keeps one turret firing.`,
    done: () => sim.factory.facs.some((f) => f.type === 'mine' && f.ore === 'iron_ore'),
    // (a deposit a belt can reach the turret from; the marked turret hex too if that turret is not built yet)
    points: () => chainMarks(false), // (no chain a belt can make: nothing marked rather than a deposit out of reach)
  },
  {
    title: 'Lay a belt to a turret',
    text: () => {
      const c = chainPlan(), more = c ? [c.mineNew ? 'a Mine on the marked deposit' : '', c.turNew ? 'a Pulse Turret on the marked hex' : ''].filter(Boolean) : [];
      return `${more.length ? `First build ${more.join(' and ')}. ` : ''}A mine feeds a turret right next to it. For one further away, pick the Belt and ${kb() ? 'drag' : 'hold and drag'} along the marked hexes from beside the mine to the turret. Towers keep only one item in hand and pull the next off the belt, so a belt that runs past a row of towers feeds them all. A rust ring with a hologram of what is missing marks anything still lacking; the ore moves while a wave runs.`;
    },
    points: () => chainMarks(true),
    // (between waves nothing is delivered: a turret that the diagnosis says a mine will feed counts too)
    done: () => sim.factory.delivered > 0 || sim.towers.some((t) => !!sim.diag().get('t' + t.id)?.from.some((w) => w.startsWith('Mine'))),
  },
  {
    title: 'Two more turrets along the belt',
    text: () => `One turret will not hold the road for long. ${barTab === 'factory' ? (kb() ? 'Press F for the Towers bar, pick the Pulse Turret (key 1)' : 'Tap Towers, then the Pulse Turret,') : kb() ? 'Pick the Pulse Turret (key 1)' : 'Tap the Pulse Turret'} and build ${GUIDE_TURRETS - 1} more on the marked hexes beside the belt: each keeps one piece of ore in hand and pulls the next off the belt as it runs past, so one belt feeds the whole row. The crates help while they last.`,
    done: () => sim.towers.filter((t) => t.type === 'pulse').length >= GUIDE_TURRETS || (!!chainPlan() && !moreTurrets().length),
    points: () => moreTurrets().map(([x, z]) => tileMark(x, z)),
    tab: 'towers',
  },
  {
    title: 'Pick a card',
    text: () => 'Kills give experience. Every level you choose one of three cards. A blueprint unlocks a new tower together with the factory buildings its supply needs, one step at a time.',
    done: () => Object.keys(sim.stacks).length > 0,
  },
  {
    title: 'Upgrade for the Colossus',
    text: () => `Every fifth wave brings a Colossus. Get ready early: click each turret on the belt and ${kb() ? 'press U (Upgrade)' : 'tap Upgrade'}, and the Mine too, so its ore keeps up with the faster guns. When the Colossus walks past, fire the turrets' specials at it (${kb() ? 'click a turret, Space' : 'tap a turret, Fire special'}).`,
    done: () => !upgradeMarks().length,
    points: () => upgradeMarks(),
  },
  {
    title: 'Power',
    text: () => `Your new tower runs on power. Build a Mine on coal (the dark tiles with black lumps) and a Generator right next to it. The Generator powers everything within 2 tiles; Power Poles carry it further, also across a road. The Power gauge at the top shows what the grid will give against what it needs.`,
    ready: () => sim.facs.has('generator'),
    done: () => sim.factory.powerNets.some((n) => n.cap > 0) || sim.factory.facs.some((f) => f.type === 'generator' && !!sim.diag().get('f' + f.id)?.ok),
    points: () => oreTiles(oreIdx('coal'), 3),
  },
  {
    title: 'That is the pattern',
    text: () => `Every later tower adds one more step: pipes for oil, a Smelter for plates, then presses and plants. Between waves, a broken red ring round a tower or building says it will lack something, and the hologram over it shows what; click it for the details. Mines, plants and generators upgrade (${kb() ? 'U' : 'Upgrade'}) to work faster.`,
    done: () => guide.acked,
    ok: true,
  },
];
function startGuide() {
  guide.on = true; guide.i = 0; guide.t = 0; guide.acked = false;
  delete cache.guide;
}
function endGuide(skipped: boolean) {
  guide.on = false;
  show('guide', false);
  store.tips.tutorial = true; save();
  if (skipped) note('Tutorial skipped. You can replay it from How to play.');
}
/** The tile markers of the current step (none while the guide is off or the step is waiting for its moment). */
function guidePoints(): GuideMark[] {
  const st = guide.on ? GUIDE[guide.i] : undefined;
  return st && st.points && (!st.ready || st.ready()) ? st.points() : [];
}
function updateGuide() {
  if (!guide.on) return;
  if (ended || bot || mode !== 'solo') { guide.on = false; show('guide', false); return; }
  let st = GUIDE[guide.i];
  // a step that is done gives way to the next (after a moment, so the tick is seen)
  if (st.done()) {
    // (guide.t: when the step was first seen done, in wall-clock seconds, so a slow phone waits 0.6 s too and not 0.6 s worth of frames)
    const nowS = performance.now() / 1000;
    if (!guide.t) guide.t = nowS;
    if (nowS - guide.t > 0.6 || st.ok) {
      guide.i++; guide.t = 0;
      if (guide.i >= GUIDE.length) { endGuide(false); return; }
      sound.play('levelup', 0.4); st = GUIDE[guide.i];
      // (a step about towers brings the tower bar back: with the factory bar open, key 1 would pick a belt)
      if (st.tab && barTab !== st.tab && !buildType && !buildFac) setTab(st.tab);
    }
  } else guide.t = 0;
  const waiting = !!st.ready && !st.ready();
  // on a phone the card folds to a one-line strip while the player acts on the board: a step that points at tiles (all but
  // the first, whose text is read before anything else), a building or tower picked to place, or a tile looked at (its panel
  // takes the bottom of the screen). A tap opens or folds it.
  const acting = !!buildType || !!buildFac || painting || !!selected || !!selFac || !!selOre;
  if (guideFold.step !== guide.i || (acting && !guideFold.acting)) guideFold.manual = '';
  guideFold.step = guide.i; guideFold.acting = acting;
  const fold = smallUi() && (guideFold.manual === 'shut' || (guideFold.manual !== 'open' && (acting || (guide.i > 0 && guidePoints().length > 0))));
  const key = guide.i + ':' + waiting + ':' + touchUi() + ':' + fold + ':' + st.text(); // (a step's text can follow the board: what is built of its chain)
  if (cache.guide === key) return;
  cache.guide = key;
  $('guide').classList.toggle('fold', fold);
  show('guide', !waiting);
  setText('guide-step', `Tutorial ${guide.i + 1} / ${GUIDE.length}`);
  setText('guide-title', st.title);
  setText('guide-text', st.text());
  show('guide-next', !!st.ok);
}
click('guide-skip', () => endGuide(true));
/** Phones, upright or on their side: the tutorial card folds and the info panels dock as a bottom sheet (style.css). */
const smallMq = matchMedia('(max-width: 600px) and (orientation: portrait), (max-height: 480px)');
const smallUi = () => smallMq.matches;
/** The tutorial card's fold on a phone: the player's own choice for this step ('open' / 'shut'), else it follows the step. */
const guideFold = { step: -1, manual: '' as '' | 'open' | 'shut', acting: false };
$('guide').addEventListener('click', (e) => {
  if (!smallUi() || (e.target as HTMLElement).closest('button')) return;
  guideFold.manual = $('guide').classList.contains('fold') ? 'open' : 'shut';
  sound.init(); sound.play('click');
});
click('guide-next', () => { guide.acked = true; });
/**
 * A step whose markers sit under the tutorial card, the console or off the screen eases the camera once, so they come
 * into the clear part of the view (left of the card, above the console). A drag or turn by the player stops it.
 */
const guideCam = { key: '', on: false, t: 0 };
function guideFrame(dt: number) {
  const pts = guide.on && playing() && !vx.introActive?.() ? guidePoints() : [];
  const key = pts.length ? guide.i + ':' + pts.filter((g) => g.kind === 'here').map((g) => g.x.toFixed(1) + ',' + g.z.toFixed(1)).join(' ') : '';
  if (key !== guideCam.key) { guideCam.key = key; guideCam.on = !!key; guideCam.t = 0; }
  if (!guideCam.on) return;
  if (dragging || rotating || painting || (guideCam.t += dt) > 2) { guideCam.on = false; return; }
  // the clear part of the screen
  const W = innerWidth, top = $('top').getBoundingClientRect().bottom, bot = $('bottom').getBoundingClientRect().top;
  const g = shown('guide') ? $('guide').getBoundingClientRect() : null;
  const x0 = 24, x1 = (g && g.left > W * 0.45 ? g.left : W) - 24, y0 = (g && g.left <= W * 0.45 ? g.bottom : top) + 24, y1 = bot - 24;
  if (x1 - x0 < 80 || y1 - y0 < 60) { guideCam.on = false; return; }
  let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity, out = false;
  for (const m of pts) {
    const [x, y, ok] = view.project(m.x, m.y, m.z);
    if (!ok) { out = true; continue; }
    ax = Math.min(ax, x); bx = Math.max(bx, x); ay = Math.min(ay, y - (m.kind === 'here' ? 30 : 0)); by = Math.max(by, y);
    if (x < x0 + 40 || x > x1 - 40 || y < y0 + 30 || y > y1 - 20) out = true; // (well inside, not just on the edge)
  }
  if (!out || !Number.isFinite(ax)) { guideCam.on = false; return; }
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, k = 1 - Math.exp(-dt * 5);
  panBy(cx, cy, cx + ((x0 + x1) / 2 - cx) * k, cy + ((y0 + y1) / 2 - cy) * k);
}

/**
 * On a phone the info panel (tower, building or deposit) docks as a bottom sheet, or at the side when it is held on its side.
 * When it, the top bar or the tutorial card would cover the tile it describes, the camera eases once so the tile comes into
 * the clear part of the view. A drag or turn by the player stops it.
 */
const sheetCam = { key: '', t: 0 };
function sheetFrame(dt: number) {
  const id = !smallUi() || !playing() ? '' : shown('tower') && selected ? 'tower' : shown('fpanel') && selFac ? 'fpanel' : shown('opanel') && selOre ? 'opanel' : '';
  let at: { x: number; y: number; z: number } | null = null;
  if (id === 'tower') { const t = sim.towerById(selected); if (t) at = { x: t.x, y: t.h * 0.5, z: t.z }; }
  else if (id === 'fpanel') { const f = sim.factory.facById(selFac); if (f) at = { x: f.x, y: 0.6, z: f.z }; }
  else if (id === 'opanel' && selOre) at = { x: cellX(selOre.cx, selOre.cz), y: 0.4, z: cellZ(selOre.cz) };
  const key = at ? `${id}:${at.x.toFixed(1)},${at.z.toFixed(1)}:${innerWidth}x${innerHeight}` : '';
  if (key !== sheetCam.key) { sheetCam.key = key; sheetCam.t = 0; }
  if (!at || sheetCam.t < 0) return;
  if (dragging || rotating || painting || (sheetCam.t += dt) > 1.6) { sheetCam.t = -1; return; }
  const W = innerWidth, p = $(id).getBoundingClientRect();
  let top = $('top').getBoundingClientRect().bottom, bot = $('bottom').getBoundingClientRect().top, x0 = 0, x1 = W;
  const g = shown('guide') ? $('guide').getBoundingClientRect() : null;
  if (g && g.width > W * 0.6) top = Math.max(top, g.bottom);
  if (p.width > W * 0.6) bot = Math.min(bot, p.top); // a bottom sheet
  else if (p.left > W / 2) x1 = p.left; else x0 = p.right; // a side panel
  const [x, y, ok] = view.project(at.x, at.y, at.z);
  const m = 28;
  if (ok && x > x0 + m && x < x1 - m && y > top + m && y < bot - m) { if (sheetCam.t > 0.05) sheetCam.t = -1; return; }
  if (x1 - x0 < 80 || bot - top < 60) { sheetCam.t = -1; return; }
  const k = 1 - Math.exp(-dt * 6), tx = (x0 + x1) / 2, ty = (top + bot) / 2;
  panBy(x, y, x + (tx - x) * k, y + (ty - y) * k);
}

// ---------- frame ----------
let nextKey = '';
let nextPv: unknown = null, nextNk = '';
/** What each build button shows (bits: 1 locked, 2 poor, 4 picked) and its price, as last written to the DOM. */
const btnState = new Map<HTMLElement, { st: number; cost: number; mt: number }>();
/** Power a generator gives at full load (its level and the Turbine cards). */
const genPower = (g: Fac) => GEN_POWER * sim.mods.gen * FAC_LVL_SPEED[clamp(g.lvl - 1, 0, FAC_LVL_SPEED.length - 1)];
/** A grid's power from the generators that will get coal (the diagnosis says so; a free run has no diagnosis: all count). */
function gridHave(n: { nodes: Fac[] }, dg: Map<string, Diag>): number {
  let have = 0;
  for (let i = 0; i < n.nodes.length; i++) { const g = n.nodes[i]; if (g.type === 'generator' && (sim.opts.free || dg.get(facKey(g.id))?.ok)) have += genPower(g); }
  return have;
}
/**
 * The power gauge. Between waves nothing runs, so it shows what the grids will need at full load against what their fuelled
 * generators will give; during a wave, what is drawn against what the burning generators give.
 */
function powerGauge(plan: boolean): { label: string; text: string; short: boolean } {
  let a = 0, b = 0;
  const dg = sim.diag();
  for (const n of sim.factory.powerNets) {
    if (plan) { a += n.full; b += gridHave(n, dg); } else { a += Math.min(n.cap, n.demand); b += n.cap; }
  }
  const short = plan ? a > b + 1e-6 : sim.factory.powerNets.some((n) => n.demand > n.cap + 1e-6);
  return { label: plan ? 'Power need / have' : 'Power used / have', text: `${Math.round(a)} / ${Math.round(b)}`, short };
}
/**
 * The diagnosis of one tower ('t' + id) or building ('f' + id). A pole's own diagnosis only asks for a Generator on its grid:
 * here it also lacks something when none of its generators will get coal (else it would get a tick over a dead grid).
 */
function diagOf(key: string, dg = sim.diag()): Diag | undefined {
  const d = dg.get(key);
  if (!d?.ok || key[0] !== 'f') return d;
  const f = sim.factory.facById(+key.slice(1)), n = f && f.type === 'pole' ? sim.factory.powerNet(f.net) : undefined;
  return n && !gridHave(n, dg) ? { ok: false, missing: ['coal for its Generator'], from: d.from } : d;
}
/** Diagnosis entries that are worth a marker: something missing, crates left out (a full crate nobody uses yet is normal). */
function diagBad(key: string, d: Diag): boolean {
  if (d.ok) return false;
  if (key[0] === 'f') { const f = sim.factory.facById(+key.slice(1)); if (!f || f.type === 'crate') return false; }
  return true;
}
/** Only "nothing takes its output": a softer marker than a missing input. */
const onlyTaker = (d: Diag) => d.missing.every((m) => m.startsWith('a taker'));
function updateHud() {
  setText('wave', String(sim.wave));
  setText('wave-sub', sim.campaign ? '/ ' + sim.winWave : '');
  setText('lives', String(Math.max(0, sim.lives)));
  setText('gold', String(Math.floor(sim.gold)));
  setText('mats', sim.opts.free ? '-' : String(Math.floor(sim.mats)));
  // between waves (time stands still): the build phase banner, the power the grids will need, the supply markers
  const plan = sim.planning && !ended && !isClient;
  const pg = powerGauge(plan);
  setText('power', pg.text); setText('power-label', pg.label);
  if (cache.pshort !== String(pg.short)) { cache.pshort = String(pg.short); $('power').parentElement!.classList.toggle('short', pg.short); }
  if (cache.plan !== String(plan)) { cache.plan = String(plan); document.body.classList.toggle('planning', plan); }
  setText('level', String(sim.level));
  setW('xpbar', sim.xp / sim.xpNext);
  const waiting = isClient ? sim.nextWaveIn >= 0 : !sim.queue.length;
  const canCall = waiting && !sim.over && !(sim.wave >= sim.winWave && sim.campaign);
  // The slot of the button stays reserved (see #btn-wave.off), so the bar next to it never moves.
  const first = sim.wave === 0, wb = $<HTMLButtonElement>('btn-wave'), wk = `${canCall}:${first}`;
  if (cache.wavecls !== wk) { cache.wavecls = wk; wb.classList.toggle('off', !canCall); wb.classList.toggle('first', canCall && first); wb.disabled = !canCall; }
  // the build phase banner: before wave 1 (unless the tutorial speaks), and between waves
  const prep = canCall && plan && !(first && guideOn());
  if (canCall) {
    const left = Math.max(0, Math.ceil(sim.nextWaveIn)), raw = sim.callBonus();
    const bonus = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    // the wave waits for the call, unless Auto waves is on (then it also pays for calling early)
    const timed = sim.autoWaves && !(sim.holdFirst && first);
    setText('wave-label', first ? 'Call first wave' : 'Call wave');
    setText('wave-timer', !timed ? (touchUi() ? 'when you are ready' : 'when you are ready (N)') : bonus > 0 ? `${left}s, +${bonus} cr` : `starts in ${left}s`);
    if (prep) {
      setText('prep-kick', first ? 'Before wave 1 / build phase' : `Wave ${sim.wave} cleared / build phase`);
      setText('prep-title', timed ? `The factory rests: the next wave comes in ${left}s.` : 'Time stands still until you call the wave.');
      setText('prep-sub', prepLine(first));
    }
  }
  if (cache.prep !== String(prep)) { cache.prep = String(prep); show('prep', prep); }
  const ak = String(settings.auto);
  const rk = String(settings.rings);
  if (cache.rings !== rk) { cache.rings = rk; const rb = $('btn-rings'); rb.classList.toggle('on', settings.rings); rb.setAttribute('aria-pressed', rk); }
  if (cache.auto !== ak) { cache.auto = ak; const ab = $('btn-auto'); ab.textContent = settings.auto ? 'Auto waves: on' : 'Auto waves: off'; ab.setAttribute('aria-pressed', ak); }
  // (the buttons are only touched when their state or price changes: nothing is written to the DOM on a frame where none did)
  for (const t of TOWER_TYPES) {
    const b = buildBtns[t], locked = !sim.unlocked.has(t), cost = sim.cost(t), mt = sim.matCost(t);
    const poor = !locked && (sim.gold < cost || sim.mats < mt), st = (locked ? 1 : 0) | (poor ? 2 : 0) | (buildType === t ? 4 : 0);
    const was = btnState.get(b);
    if (!was || was.st !== st) { b.classList.toggle('locked', locked); b.classList.toggle('poor', poor); b.classList.toggle('sel', buildType === t); }
    if (!was || was.cost !== cost || was.mt !== mt) { const c = b.lastElementChild as HTMLElement, txt = mt ? `${cost} +${mt}m` : String(cost); if (c.textContent !== txt) c.textContent = txt; }
    if (!was) btnState.set(b, { st, cost, mt }); else { was.st = st; was.cost = cost; was.mt = mt; }
  }
  // the factory bar holds what is unlocked so far; the number keys go by place on the bar
  const fl = facList(), fk = fl.join();
  if (cache.facbar !== fk) {
    cache.facbar = fk;
    for (const t of FAC_TYPES) { const i = fl.indexOf(t), b = facBtns[t]; b.classList.toggle('locked', i < 0); (b.firstElementChild as HTMLElement).textContent = i < 0 || i > 9 ? '' : String((i + 1) % 10); }
  }
  for (const t of FAC_TYPES) {
    const b = facBtns[t], cost = sim.facCost(t), st = (sim.gold < cost ? 2 : 0) | (buildFac === t ? 4 : 0);
    const was = btnState.get(b);
    if (!was || was.st !== st) { b.classList.toggle('poor', sim.gold < cost); b.classList.toggle('sel', buildFac === t); }
    if (!was || was.cost !== cost) { const c = b.lastElementChild as HTMLElement, txt = String(cost); if (c.textContent !== txt) c.textContent = txt; }
    if (!was) btnState.set(b, { st, cost, mt: 0 }); else { was.st = st; was.cost = cost; }
  }
  // tooltip: the building under the pointer, else the one picked for building (touch has no hover). While the mouse
  // places it on the board (or drags a belt) the picked one's tooltip steps aside: it would cover a third of the board.
  const tipFor = tipHover || (!byTouch && (overBoard || painting) ? null : buildType || buildFac), tipKey = tipFor ? tipFor + (Object.hasOwn(TOWERS, tipFor) && !sim.unlocked.has(tipFor as TowerType) ? ':locked' : '') : '';
  if (cache.tip !== tipKey) { cache.tip = tipKey; if (!tipFor) show('tip', false); else if (Object.hasOwn(TOWERS, tipFor)) towerTip(tipFor as TowerType); else facTip(tipFor as FacType); }

  // next wave summary in the top bar
  // (the sim replaces its preview whenever it changes: the key is only built again for a new one)
  const pv = sim.preview;
  if (pv !== nextPv) { nextPv = pv; nextNk = pv.wave + ':' + pv.lanes.map((l) => l.map((o) => o.type + o.n).join(',')).join('|'); }
  const nk = nextNk;
  if (nk !== nextKey) {
    nextKey = nk;
    const sum: Group[] = [];
    for (const l of pv.lanes) for (const o of l) { const f = sum.find((x) => x.type === o.type); if (f) f.n += o.n; else sum.push({ type: o.type, n: o.n }); }
    setText('next-label', pv.wave > 0 ? `Next: wave ${pv.wave}` : 'Next wave');
    if (!enemyChips($('next-row'), pv.wave > 0 ? sum : []).length) $('next-row').appendChild(el('span', 'none', sim.campaign && sim.wave >= sim.winWave ? 'Last wave' : 'Nothing yet'));
  }

  const sf = selFac ? sim.factory.facById(selFac) : undefined, placing = (!!buildFac && turns(buildFac)) || !!(sf && turns(sf.type));
  if (cache.placing !== String(placing)) { cache.placing = String(placing); document.body.classList.toggle('placing', placing); }
  updateGuide();
  updateOre();
  updateFacPanel(); // (first: clearing the factory selection must not hide the ring the tower panel then puts up)
  updateTowerPanel();
  updateTitan();
  updateMarks();
  updateIntel();
  if (mode === 'versus') setText('vs-status', `Core ${rival.l} / Wave ${rival.w} / ${rival.k} kills`);
}

/** The small line of the build phase banner: what will lack supply when the wave starts, and how to call it. */
function prepLine(first: boolean): string {
  const call = touchUi() ? `Tap Call ${first ? 'first ' : ''}wave when you are ready.` : 'Press N or the button when you are ready.';
  if (!sim.towers.length) return `Towers start empty: put one next to a supply crate. ${call}`;
  let tb = 0, fb = 0;
  const dg = sim.diag();
  for (const k of dg.keys()) { const d = diagOf(k, dg)!; if (diagBad(k, d) && !onlyTaker(d)) { if (k[0] === 't') tb++; else fb++; } }
  const n = (v: number, one: string) => `${v} ${one}${v === 1 ? '' : 's'}`;
  const bad = [tb ? n(tb, 'tower') : '', fb ? n(fb, 'building') : ''].filter(Boolean).join(' and ');
  return `${bad ? `${bad} will lack supply (broken red rings).` : 'Every tower will be supplied.'} Nothing is made until the wave runs. ${call}`;
}

/** The Titan's bar: its danger while it approaches, its hull once it walks. */
function updateTitan() {
  const T = sim.titan, ph = T ? T.phase : 'none';
  const on = !ended && (ph === 'warn' || ph === 'landing' || ph === 'walk');
  if (cache.titan !== String(on)) { cache.titan = String(on); show('titan', on); }
  if (!on) return;
  const walk = ph === 'walk';
  if (cache.titancls !== ph) { cache.titancls = ph; $('titan').classList.toggle('walk', walk); }
  if (walk) {
    const e = sim.enemies.find((x) => x.alive && x.type === 'titan');
    const f = e && e.maxHp > 0 ? clamp(e.hp / e.maxHp, 0, 1) : 0;
    setW('titan-bar', f);
    setText('titan-label', `${TITAN_NAME()} / hull`);
    setText('titan-sub', `${Math.ceil(f * 100)}%`);
  } else {
    const left = T.wave - sim.wave;
    setW('titan-bar', ph === 'landing' ? 1 : Number.isFinite(T.danger) ? T.danger : 0);
    setText('titan-label', ph === 'landing' ? `${TITAN_NAME()} landing` : `${TITAN_NAME()} approaching`);
    setText('titan-sub', ph === 'landing' ? 'brace' : left <= 1 ? 'lands next wave' : `lands in ${left} waves`);
  }
}

/** Put a panel on the left when it would lie over the core, unless what it describes stands there itself. Decided once per selection. */
function dockPanel(id: string, key: string, x: number, y: number, z: number) {
  if (cache[key] === id) return;
  cache[key] = id;
  const [cx, , cok] = view.project(sim.map.core.x, 1, sim.map.core.z), [tx] = view.project(x, y, z);
  $(key === 'tdock' ? 'tower' : key === 'odock' ? 'opanel' : 'fpanel').classList.toggle('left', cok && cx > innerWidth - 330 && tx > 300);
}
/** One supply line of the tower panel: label, value, and whether it is short. */
function supLine(box: HTMLElement, k: string, v: string, bad: boolean) {
  box.append(el('span', bad ? 'bad' : '', k), el('b', bad ? 'bad' : '', v));
}
/** The building that makes a tower's ammunition or fluid. */
const MAKER: Partial<Record<ItemType | 'crude' | 'petrol', FacType>> = { iron_ore: 'mine', copper: 'smelter', shell: 'press', cell: 'cells', missile: 'missiles', crude: 'pump', petrol: 'refinery' };
/** What changes at Mk3 for a tower whose level-3 supply differs, with a warning when the building that makes it is locked or not built. */
function mk3Note(type: TowerType, l3: TowerNeeds): string {
  const what = l3.item || l3.fluid, mk = what ? MAKER[what] : undefined;
  let warn = '';
  if (mk && !sim.facs.has(mk)) warn = ` Locked until then: the Mk3 cannot fire before a ${FACS[mk].name} feeds it.`;
  else if (mk && !sim.factory.facs.some((f) => f.type === mk)) warn = ` No ${FACS[mk].name} is built yet: the Mk3 cannot fire until one feeds it.`;
  return (TOWER_SUPPLY_L3[type] || `Mk3 runs on ${needsText(l3)}.`) + warn;
}
/** The "Supplied by" and "Missing" lines of a panel, from the factory's diagnosis (empty in a free run). */
function diagLines(id: string, key: string) {
  const d = diagOf(key), box = $(id);
  const k = d ? `${key}|${d.from.join(',')}|${d.missing.join(',')}` : '';
  if (cache[id] === k) return;
  cache[id] = k;
  box.textContent = '';
  if (!d) return;
  if (d.from.length) box.append(el('span', '', 'Supplied by'), el('b', '', d.from.join(', ')));
  // (only "a taker for its output" missing: the softer tone of the status line, not the red of a missing input)
  const tone = onlyTaker(d) ? 'warn' : 'bad';
  if (d.missing.length) box.append(el('span', tone, 'Missing'), el('b', tone, d.missing.join(', ')));
}
function updateTowerPanel() {
  const t = selected ? sim.towerById(selected) : undefined;
  if (!t) { selected = 0; if (!selFac) view.setSelected(null); cache.tdock = ''; }
  show('tower', !!t);
  if (!t) return;
  dockPanel(String(t.id), 'tdock', t.x, t.h * 0.5, t.z);
  view.setSelected(t, sim.range(t));
  const d = TOWERS[t.type], sp = d.special;
  setText('t-name', `${d.name} / Mk ${t.lvl}`);
  const key = `${t.id}:${t.lvl}:${t.buff}:${sim.level}:${sim.towerDmg(t)}:${sim.towerRate(t)}:${sim.range(t)}:${t.spec > 0}:${t.down > 0}`;
  if (cache.tstats !== key) {
    cache.tstats = key;
    const st = $('t-stats'); st.textContent = '';
    const line = (k: string, v: string) => { st.append(k + ' ', el('b', '', v), el('br')); };
    if (t.type === 'beacon') line('Boost', `+${Math.round(sim.beaconBoost(t) * 100)}% damage`);
    else {
      if (d.dmg > 0) line('Damage', sim.towerDmg(t).toFixed(0));
      line(d.dmg > 0 ? 'Fire rate' : 'Pulse rate', sim.towerRate(t).toFixed(2) + '/s');
    }
    if (d.range > 0) line('Range', sim.range(t).toFixed(1));
    if (t.buff > 0) line('Beacon', 'boosted');
  }
  // supply: what it runs on and how much it has (one item in hand plus the shots left of the one in use: it pulls the next off its belt)
  const n = needsOf(t), sup = $('t-sup');
  const sk = sim.opts.free ? 'free' : `${t.lvl}|${sim.planning}|${n.item ? t.stock + ':' + Math.ceil(t.ammo) : ''}|${n.fluid ? Math.round(t.tank) : ''}|${n.power ? Math.round(t.pwr * 100) : ''}`;
  if (cache.tsup !== sk) {
    cache.tsup = sk;
    sup.textContent = '';
    if (sim.opts.free) supLine(sup, 'Supply', 'not needed', false);
    else {
      // (between waves an empty tower is normal: the diagnosis below says whether it will be fed)
      if (n.item) supLine(sup, ITEMS[n.item].name, `${t.stock}/${TOWER_STOCK} + ${Math.ceil(t.ammo)} shots (${Math.round((n.shots || ITEM_SHOTS[n.item] || 1) * sim.mods.ammo)} per item)`, !sim.planning && t.stock <= 0 && t.ammo <= 0);
      if (n.fluid) supLine(sup, FLUIDS[n.fluid].name, `${Math.round(t.tank)}/${TOWER_TANK}`, !sim.planning && t.tank < 1);
      if (n.power) supLine(sup, 'Power', t.pwr <= 0 ? (sim.planning ? `needs ${n.power}` : 'none') : `${Math.round(t.pwr * 100)}% of ${n.power}`, !sim.planning && t.pwr < 0.05);
    }
  }
  diagLines('t-diag', 't' + t.id);
  // special: name, what it does, charge, and what the tower is doing right now
  const box = $('t-spec');
  if (sp) {
    const total = sp.down * sim.mods.reboot;
    setText('t-spec-name', sp.name);
    setText('t-spec-desc', sp.desc);
    // stunned by the Titan's landing or jammed by mites comes first: the tower neither fires nor charges
    const state = t.stun > 0 ? 'stun' : t.jam > 0 ? 'jam' : t.dry ? 'dry' : t.down > 0 ? 'down' : t.spec > 0 ? 'run' : t.charge >= 1 ? 'ready' : 'charge';
    if (cache.tspec !== state) { cache.tspec = state; box.className = state; }
    setW('t-spec-bar', state === 'stun' ? 1 - t.stun / TITAN_STUN : state === 'down' ? 1 - t.down / Math.max(0.1, total) : state === 'charge' || state === 'dry' ? t.charge : 1);
    setText('t-spec-state', state === 'stun' ? `Stunned - back in ${Math.ceil(t.stun)}s` : state === 'jam' ? 'Jammed by mites.' : state === 'dry' ? 'Out of supply. It does not charge.'
      : state === 'down' ? `Offline - rebooting ${Math.ceil(t.down)}s` : state === 'run' ? `Running - ${Math.ceil(t.spec)}s left`
      : state === 'ready' ? 'Ready to fire.' : `Charging ${Math.floor(t.charge * 100)}%`);
    $<HTMLButtonElement>('t-special').disabled = state !== 'ready';
    setText('t-special', touchUi() ? 'Fire special' : 'Fire special (Space)');
  }
  // a Mk3 that runs on a new ammunition: say so before the upgrade, and whether the building that makes it is there yet
  const l3 = t.lvl === 2 && !sim.opts.free ? TOWER_NEEDS_L3[t.type] : undefined;
  setText('t-next', l3 ? mk3Note(t.type, l3) : '');
  const up = $<HTMLButtonElement>('t-up');
  setText('t-up', t.lvl >= 3 ? 'Max level' : `${l3 ? `Mk3: ${needsText(l3)}` : 'Upgrade'}${touchUi() ? '' : ' (U)'} - ${sim.upCost(t)}${sim.upMat(t) ? ` +${sim.upMat(t)}m` : ''}`);
  up.disabled = t.lvl >= 3 || sim.gold < sim.upCost(t) || sim.mats < sim.upMat(t);
  setText('t-sell', `Sell${touchUi() ? '' : ' (X)'} +${sim.sellValue(t)}${sim.sellMats(t) ? ` +${sim.sellMats(t)}m` : ''}`);
  setText('t-note', '');
}

const FAC_STATE: Record<string, string> = {
  ok: 'Working', idle: 'Idle', nopower: 'No power: build a Pole or Generator within 2 tiles', noinput: 'Waiting for input', nofuel: 'No fuel: it needs coal', full: 'Output full: nothing beside it takes it', empty: 'Empty', nodeposit: 'Not on a deposit',
};
/** Inventory line: item counts. */
const invText = (inv: Partial<Record<ItemType, number>>) => Object.entries(inv).filter(([, n]) => n && n > 0).map(([k, n]) => `${n} ${ITEMS[k as ItemType].short}`).join(', ') || 'empty';
const per = (sec: number, what: string) => `${what} every ${sec.toFixed(1)}s`;
/** How fast a building works at a level (with the factory cards), in words. '' for what has no speed. */
function workRate(f: Fac, lvl: number): string {
  const k = FAC_LVL_SPEED[clamp(lvl - 1, 0, FAC_LVL_SPEED.length - 1)], m = sim.mods;
  switch (f.type) {
    case 'mine': return per(MINE_TIME / (m.mine * k), f.ore && f.ore !== 'oil' ? ITEMS[f.ore as ItemType].short : 'ore');
    case 'pump': return `${(PUMP_RATE * m.mine * k).toFixed(1)} crude/s`;
    case 'smelter': return per(SMELT_TIME / (m.craft * k), 'a plate');
    case 'refinery': return `${REFINE_OUT} petrol every ${(REFINE_TIME / (m.craft * k)).toFixed(1)}s`;
    case 'generator': return `${Math.round(GEN_POWER * m.gen * k)} power`;
    case 'works': case 'press': case 'cells': case 'missiles': { const r = MAKES[f.type]!; return per(r.time / (m.craft * k), r.out ? `a ${ITEMS[r.out].short}` : 'a material'); }
  }
  return '';
}
/** The grid lines of a pole's or generator's panel: generators and their fuel, consumers, need at full load, and a warning when short. */
function gridLines(f: Fac, lines: [string, string][]) {
  const n = sim.factory.powerNet(f.net);
  if (!n) { lines.push(['Grid', 'none']); return; }
  const dg = sim.diag(), gens = n.nodes.filter((g) => g.type === 'generator');
  const fuelled = gens.filter((g) => sim.opts.free || dg.get('f' + g.id)?.ok).length, have = gridHave(n, dg);
  lines.push(['Generators', gens.length ? `${gens.length}, ${fuelled === gens.length ? 'all get coal' : `${gens.length - fuelled} without coal`}` : 'none: build a Generator on this grid']);
  lines.push(['Consumers', `${n.cons.length + n.towers.length} (${n.towers.length} towers)`]);
  lines.push(['At full load', `${Math.round(n.full)} needed, ${Math.round(have)} available`]);
  if (!sim.planning) lines.push(['Now', `${Math.round(Math.min(n.cap, n.demand))} drawn of ${Math.round(n.cap)}`]);
  if (n.full > have + 1e-6) lines.push(['Short', `${Math.round(n.full - have)} power: add or upgrade a Generator (and its coal)`]);
}
// ---------- deposits: what lies under a free tile ----------
// The mouse shows a small tooltip over a deposit nobody has built on; a click or tap opens a panel with a Build button.
canvas.addEventListener('mouseleave', () => { overBoard = false; });
/** The deposit on a tile with nothing on it (no building, no tower, no road), else null. */
function freeOre(cx: number, cz: number): OreType | null {
  if (!inBoard(cx, cz)) return null;
  const i = cz * GW + cx, o = sim.factory.ore[i];
  return o && !sim.factory.at[i] && sim.grid[i] === 0 ? ORE_TYPES[o - 1] ?? null : null;
}
/** What goes on a deposit: a Pumpjack on oil, a Mine on the rest. */
const oreFac = (o: OreType): FacType => (o === 'oil' ? 'pump' : 'mine');
const andList = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
/** The connected tiles of one deposit kind (a patch), worked out once per map. */
const patches = new WeakMap<Uint8Array, Map<number, number[]>>();
function orePatch(cx: number, cz: number): number[] {
  const ore = sim.factory.ore;
  let m = patches.get(ore);
  if (!m) { m = new Map(); patches.set(ore, m); }
  const i0 = cz * GW + cx, hit = m.get(i0);
  if (hit) return hit;
  const k = ore[i0], tiles = [i0], seen = new Set(tiles);
  for (let q = 0; q < tiles.length; q++) {
    const j = tiles[q];
    for (let d = 0; d < 6; d++) {
      const [nx, nz] = neighbor(j % GW, Math.floor(j / GW), d), n = nz * GW + nx;
      if (inBoard(nx, nz) && ore[n] === k && !seen.has(n)) { seen.add(n); tiles.push(n); }
    }
  }
  for (const j of tiles) m.set(j, tiles);
  return tiles;
}
/** What a deposit is good for, in one line, from the tower and recipe tables. */
function oreUse(o: OreType): string {
  const name = o === 'oil' ? FLUIDS.crude.name : ITEMS[o].name, parts: string[] = [];
  const direct = TOWER_TYPES.filter((t) => (o === 'oil' ? TOWERS[t].needs.fluid === 'crude' : TOWERS[t].needs.item === o)).map((t) => TOWERS[t].name + 's');
  if (direct.length) parts.push(`feeds ${andList(direct)} directly`);
  if (o === 'iron_ore' || o === 'copper_ore') {
    const plate: ItemType = o === 'iron_ore' ? 'iron' : 'copper', by = TOWER_TYPES.filter((t) => TOWERS[t].needs.item === plate).map((t) => TOWERS[t].name + 's');
    parts.push(`a ${FACS.smelter.name} makes ${ITEMS[plate].short}s${by.length ? ` for ${andList(by)}` : ''}`);
  }
  if (o === 'coal') parts.push(`${FACS.generator.name}s burn it for power, ${FACS.smelter.name}s as fuel`);
  const users = (Object.keys(MAKES) as FacType[]).filter((f) => { const r = MAKES[f]!; return o === 'oil' ? r.fluid?.[0] === 'crude' : !!r.inp[o as ItemType]; }).map((f) => FACS[f].name);
  if (o === 'oil') users.push(FACS.refinery.name);
  if (users.length) parts.push(`the ${andList(users)} ${users.length > 1 ? 'take' : 'takes'} it`);
  return `${name}: ${parts.join('; ')}.`;
}
/** Where the building for a deposit is ("Pick the Mine in the Factory bar."), or why it cannot be built yet. `why` is the short reason alone. */
function oreBuildLine(o: OreType): { text: string; locked: boolean; why: string } {
  const k = oreFac(o), locked = !sim.facs.has(k);
  if (!locked) return { text: `Pick the ${FACS[k].name} in the Factory bar.`, locked, why: '' };
  const t = TOWER_TYPES.filter((x) => TOWER_CHAIN[x].includes(k)).sort((a, b) => TOWER_TIER[a] - TOWER_TIER[b])[0];
  const why = t ? `comes with the ${TOWERS[t].name} blueprint` : 'not unlocked yet';
  return { text: `The ${FACS[k].name} is locked: it ${why}.`, locked, why };
}
// The building that goes on the deposit under the pointer or in the panel is pointed out on the Factory bar: the bar
// switches to the Factory tab and the button takes an animated apricot frame (a locked one shows, hatched; the panel and
// the tooltip say why it is locked).
// A tab the cue switched to goes back once the pointer has left the deposits for a moment, unless a panel was opened.
function facCue(k: FacType | null, panel: boolean, dt: number) {
  if (k && panel) cue.was = '';
  if (!k) {
    if (cue.k) { facBtns[cue.k].classList.remove('cue'); cue.k = ''; }
    if (cue.was && (cue.off += dt) > 0.6) { if (barTab === 'factory' && !buildFac) setTab(cue.was); cue.was = ''; }
    return;
  }
  cue.off = 0;
  if (barTab !== 'factory') { const was = barTab; setTab('factory'); if (!panel) cue.was = was; }
  const b = facBtns[k];
  if (cue.k !== k) {
    if (cue.k) facBtns[cue.k].classList.remove('cue');
    cue.k = k; b.classList.add('cue');
    // bring it into view on a bar that scrolls
    const bar = $('fbuild'), l = b.offsetLeft - bar.offsetLeft, r = l + b.offsetWidth;
    if (l < bar.scrollLeft) bar.scrollLeft = l - 8; else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 8;
  }
}
/** The name line: a swatch in the deposit's colour and its name. */
function oreHead(box: HTMLElement, o: OreType, tag = 'b') {
  const h = el(tag, 'ore-name'), sw = el('i', 'swatch');
  sw.style.setProperty('--c', hex(ORES[o].color));
  h.append(sw, ORES[o].name);
  box.append(h);
}
/** Tiles of a patch that carry a mine or pumpjack. */
const minedTiles = (tiles: number[]) => tiles.filter((j) => { const f = sim.factory.facAt(j % GW, Math.floor(j / GW)); return !!f && (f.type === 'mine' || f.type === 'pump'); }).length;
/** Point the view's patch highlight at a cell (or nowhere). */
function litOre(cx: number, cz: number, on: boolean) {
  const k = on ? `${cx},${cz}` : '';
  if (k === oreLit) return;
  if (oreLit) { const [a, b] = oreLit.split(',').map(Number); vx.setOreHover?.(a, b, false); }
  oreLit = k;
  if (on) vx.setOreHover?.(cx, cz, true);
}
function updateOre() {
  const intro = !!vx.introActive?.();
  // the panel goes when its tile is built on, or something else is picked or selected
  if (selOre && (!playing() || intro || buildType || buildFac || selected || selFac || !freeOre(selOre.cx, selOre.cz))) selOre = null;
  // the tooltip: a mouse over a free deposit, with no build tool picked that the tooltip would get in the way of
  const toolOk = !buildType && (!buildFac || buildFac === 'mine' || buildFac === 'pump');
  const ho = !byTouch && overBoard && active() && !intro && !dragging && !rotating && !painting && toolOk && !(selOre && selOre.cx === hover.cx && selOre.cz === hover.cz) ? freeOre(hover.cx, hover.cz) : null;
  const tip = $('oretip');
  if (ho) {
    const tiles = orePatch(hover.cx, hover.cz), bl = oreBuildLine(ho), key = `${hover.cx},${hover.cz}:${bl.locked}`;
    if (cache.otip !== key) {
      cache.otip = key; tip.textContent = '';
      oreHead(tip, ho);
      tip.append(el('span', '', oreUse(ho)), el('i', bl.locked ? 'lock' : 'needs', bl.text), el('i', '', `Patch: ${tiles.length} tile${tiles.length === 1 ? '' : 's'}.`));
      show('oretip');
    }
    // beside the pointer, kept on screen
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = lastMouse.x + 18, y = lastMouse.y + 20;
    if (x + w > innerWidth - 8) x = lastMouse.x - w - 14;
    if (y + h > innerHeight - 8) y = lastMouse.y - h - 14;
    tip.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(8, y))}px)`;
  } else if (cache.otip) { cache.otip = ''; show('oretip', false); }
  // the panel
  const so = selOre ? freeOre(selOre.cx, selOre.cz) : null;
  if (!so || !selOre) {
    if (cache.opanel) { cache.opanel = ''; cache.odock = ''; show('opanel', false); }
  } else {
    const { cx, cz } = selOre, tiles = orePatch(cx, cz), k = oreFac(so), bl = oreBuildLine(so), why = sim.facBlock(k, cx, cz);
    const mined = minedTiles(tiles), cost = sim.facCost(k);
    const key = `${cx},${cz}:${bl.locked}:${why}:${mined}:${cost}:${sim.mods.mine}:${touchUi()}`;
    if (cache.opanel !== key) {
      const fresh = !cache.opanel;
      cache.opanel = key;
      const nm = $('o-name'); nm.textContent = ''; oreHead(nm, so, 'span');
      setText('o-use', oreUse(so));
      const st = $('o-stats'); st.textContent = '';
      const rate = workRate({ type: k, ore: so } as Fac, 1);
      const lines: [string, string][] = [
        ['Patch', `${tiles.length} tile${tiles.length === 1 ? '' : 's'}`],
        [`${FACS[k].name}s on it`, `${mined} of ${tiles.length} tiles`],
        ['Mk 1 output', rate + (FACS[k].power ? `, needs ${FACS[k].power} power` : '')],
      ];
      for (const [a, b] of lines) st.append(a + ' ', el('b', '', b), el('br'));
      setText('o-pick', bl.text);
      $('o-pick').classList.toggle('locked', bl.locked);
      const bad = !!why && why !== 'locked';
      setText('o-why', why === FAC_WHY_CREDITS ? `Not enough credits: it costs ${cost}.` : bad ? `Cannot build here: ${why}.` : FACS[k].desc);
      $('o-why').classList.toggle('bad', bad);
      if (fresh) { show('opanel'); dockPanel(`${cx},${cz}`, 'odock', cellX(cx, cz), 0.4, cellZ(cz)); }
    }
  }
  const lit = selOre && so ? selOre : ho ? hover : null;
  litOre(lit ? lit.cx : 0, lit ? lit.cz : 0, !!lit);
  // (no cue while a building is already picked: the bar shows it picked)
  const ck = buildFac || !playing() ? null : so ? oreFac(so) : ho ? oreFac(ho) : null;
  const now = performance.now();
  facCue(ck, !!(selOre && so), clamp((now - cue.at) / 1000, 0, 0.1));
  cue.at = now;
}

function updateFacPanel() {
  const f = selFac ? sim.factory.facById(selFac) : undefined;
  // (every deselect, not only a building that went away: its preview of what it supplies must go with it)
  if (!f) { view.setSelectedCell(0, 0, false); selFac = 0; cache.fdock = ''; }
  show('fpanel', !!f);
  if (!f) return;
  dockPanel(String(f.id), 'fdock', f.x, 1, f.z);
  view.setSelectedCell(f.cx, f.cz, true); // (a pole's or generator's reach is the cues': the tiles it powers, outlined)
  const d = FACS[f.type], upg = FAC_UPGRADABLE.has(f.type), plan = sim.planning;
  setText('f-name', d.name + (upg ? ` / Mk ${f.lvl}` : '') + (f.ore && (f.type === 'mine' || f.type === 'pump') ? ` / ${ORES[f.ore].name}` : ''));
  // between waves nothing runs: the state is what the diagnosis expects, not what the last step left behind
  const dg = diagOf('f' + f.id);
  const [stTxt, stCls] = plan && f.type !== 'crate'
    ? dg ? (dg.ok ? ['Build phase: will work when the wave starts', 'ok'] : onlyTaker(dg) ? ['Build phase: nothing takes its output', 'warn'] : ['Build phase: will lack ' + dg.missing.join(', '), 'bad']) : ['Build phase: time stands still', 'warn']
    : [f.type === 'crate' && f.state === 'ok' ? 'Feeding what stands next to it' : FAC_STATE[f.state] || f.state, f.state === 'ok' ? 'ok' : f.state === 'idle' || f.state === 'full' || f.state === 'noinput' ? 'warn' : 'bad'];
  setText('f-state', stTxt);
  if ($('f-state').className !== stCls) $('f-state').className = stCls;
  const st = $('f-stats');
  const lines: [string, string][] = [];
  const rate = workRate(f, f.lvl), uc = sim.facUpCost(f);
  if (rate) lines.push(['Speed', rate]);
  if (rate && uc) lines.push([`Mk ${f.lvl + 1}`, workRate(f, f.lvl + 1)]);
  switch (f.type) {
    case 'belt': case 'splitter': lines.push(['Carrying', f.items.map((i) => ITEMS[i.it].short).join(', ') || 'nothing']); break;
    case 'tunnel': {
      const o = f.pair ? sim.factory.facById(f.pair) : undefined;
      lines.push(['End', o ? `${f.exit ? 'exit' : 'entrance'}, ${hexDist(f.cx, f.cz, o.cx, o.cz)} tiles from its ${f.exit ? 'entrance' : 'exit'}` : `unpaired: build its partner facing the same way within ${TUNNEL_REACH} tiles`]);
      if (o && !f.exit) lines.push(['Underground', f.items.map((i) => ITEMS[i.it].short).join(', ') || 'nothing']);
      break;
    }
    case 'ptunnel': {
      const o = f.pair ? sim.factory.facById(f.pair) : undefined;
      lines.push(['Linked', o ? `${hexDist(f.cx, f.cz, o.cx, o.cz)} tiles to its partner` : `no: build a second one in a straight line within ${TUNNEL_REACH} tiles`]);
      const pf = sim.factory.pipeFluid(f); lines.push(['Network', pf.fluid ? `${FLUIDS[pf.fluid].name}, ${Math.round(pf.fill * 100)}% full` : 'empty']);
      break;
    }
    case 'pipe': { const pf = sim.factory.pipeFluid(f); lines.push(['Network', pf.fluid ? `${FLUIDS[pf.fluid].name}, ${Math.round(pf.fill * 100)}% full` : 'empty']); break; }
    case 'pole': case 'generator': {
      gridLines(f, lines);
      if (f.type === 'generator') lines.push(['Fuel', `${invText(f.inv)}, ${Math.max(0, f.fuel).toFixed(0)}s burning`]);
      lines.push(['Reach', `wires to poles within ${POLE_REACH} tiles, powers what is within ${SUPPLY}`]);
      break;
    }
    case 'mine': lines.push(['Output', f.out.length ? `${f.out.length}/${OUT_CAP} waiting` : 'none waiting']); break;
    case 'pump': lines.push(['Crude', `${Math.round(f.tout)}/${TANK}`], ['Power', `${Math.round(f.pwr * 100)}%`]); break;
    case 'smelter': lines.push(['Input', invText(f.inv)], ['Output', f.out.length ? `${f.out.length}/${OUT_CAP} plates waiting` : 'none waiting']); break;
    case 'works': case 'press': case 'cells': case 'missiles': {
      const r = MAKES[f.type]!, need = Object.entries(r.inp).map(([k, n]) => `${n} ${ITEMS[k as ItemType].short}`).concat(r.fluid ? [`${r.fluid[1]} ${FLUIDS[r.fluid[0]].name.toLowerCase()}`] : []).join(' + ');
      lines.push(['Makes', `${r.out ? ITEMS[r.out].name : `${r.mats} building material`} from ${need}`], ['Input', invText(f.inv) + (r.fluid ? `, ${Math.round(f.tin)} ${FLUIDS[r.fluid[0]].name.toLowerCase()}` : '')]);
      if (r.out) lines.push(['Output', f.out.length ? `${f.out.length}/${OUT_CAP} waiting` : 'none waiting']);
      else lines.push(['Materials', `${Math.floor(sim.mats)} in store`]);
      lines.push(['Power', `${Math.round(f.pwr * 100)}%`]);
      break;
    }
    case 'crate': lines.push(['Holds', f.hold ? `${f.left} ${ITEMS[f.hold].short}` : 'nothing']); break;
    case 'refinery': lines.push(['Crude', `${Math.round(f.tin)}/${TANK}`], ['Petrol', `${Math.round(f.tout)}/${TANK}`], ['Power', `${Math.round(f.pwr * 100)}%`]); break;
  }
  const lk = lines.map((l) => l.join(':')).join('|');
  if (cache.fstats !== lk) {
    cache.fstats = lk; st.textContent = '';
    for (const [k, v] of lines) st.append(k + ' ', el('b', k === 'Short' ? 'bad' : '', v), el('br'));
  }
  diagLines('f-diag', 'f' + f.id);
  // levels: what the next one costs and how fast it would work
  show('f-up', upg);
  if (upg) {
    setText('f-up', uc ? `Upgrade${touchUi() ? '' : ' (U)'} - ${uc}` : 'Max level');
    $<HTMLButtonElement>('f-up').disabled = !uc || sim.gold < uc;
  }
  show('f-turn', turns(f.type));
  setText('f-sell', `Remove${touchUi() ? '' : ' (X)'}${sim.facSellValue(f.id) ? ` +${sim.facSellValue(f.id)}` : ''}`);
  $<HTMLButtonElement>('f-sell').disabled = f.type === 'crate' && f.left > 0;
  setText('f-desc', d.desc);
}

// Markers over the board. All of them are drawn in the scene by the view's cues (see cues.ts): the ring of something
// supplied, the broken ring and the hologram of what is missing, the pulse down a new supply route, the chevrons of an
// upgrade that can be paid for, the crackling ring and the bolt or mite over a tower that is stunned or jammed, and the
// tutorial's pointers. (A ready special shows on the tower's own node.) This only tells them what is being asked for.
const NO_GUIDE: GuideMark[] = [];
/** A HUD tag waits until its tile has arrived in the opening build-up (it would hang in the air over nothing). */
const landed = (x: number, z: number) => (vx.revealOf ? vx.revealOf(x, z) : 1) > 0.97;
function updateMarks() {
  // the tutorial points at what its step is about (drawn on the deck: a target on the tile to build on, chevrons down a belt
  // line to lay); the ring of what is supplied shows on everything while something is being placed, V is held or the
  // HUD's ring button is on
  view.cues.setGuide(ended ? NO_GUIDE : guidePoints());
  view.cues.setShowAll(!ended && mode !== 'attract' && (!!buildType || !!buildFac || keys.has('v') || settings.rings));
  // (the chevrons beside a tower whose upgrade can be paid for are the cues' too)
  view.cues.setUpgrades(!ended);
}

// Wave intel: a tag over each spawn gate with what the next wave sends down that road.
const intel: { box: HTMLElement; n: number; cls: string; w: number; h: number; disp?: string; op?: string; tf?: string; ang?: string }[] = [];
const intelBox = { n: 0, W: 0, H: 0, top: 0, bottom: 0 };
let intelKey = '';
function updateIntel() {
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
      tag.cls = ok.some((o) => bigOne(o.type)) ? ' boss' : '';
      tag.box.append(el('span', 'iw', 'W' + pv.wave), body);
    });
  }
  const W = innerWidth, H = innerHeight, phone = H <= 480;
  // (the tags stay between the HUD row and the build bar as laid out, measured now and then: the bar is taller with its tabs)
  if (!(intelBox.n++ % 30) || intelBox.W !== W || intelBox.H !== H) {
    const tb = $('top').getBoundingClientRect(), bb = $('buildwrap').getBoundingClientRect();
    intelBox.W = W; intelBox.H = H;
    intelBox.top = (tb.height ? tb.bottom : phone ? 50 : 62) + 28;
    intelBox.bottom = (bb.height ? bb.top : H - (phone ? 74 : 92)) - 10;
  }
  const top = intelBox.top, bottom = Math.max(top + 40, intelBox.bottom);
  // full strength up close, fainter when zoomed far out
  const alpha = 1 - 0.55 * clamp((view.cam.dist - 58) / 24, 0, 1);
  // (the Titan landing at or walking off a gate: that gate's tag gives way, it would sit across the Titan's legs)
  const T = sim.titan, tiE = T && (T.phase === 'landing' || T.phase === 'walk') ? sim.enemies.find((e) => e.type === 'titan') : undefined;
  for (let i = 0; i < intel.length; i++) {
    const tag = intel[i], s = tag.box.style;
    const g = lanes[i]?.pts[0];
    if (!tag.n || i >= lanes.length || ended || !landed(g[0], g[1])) { if (tag.disp !== 'none') { tag.disp = s.display = 'none'; } continue; }
    const [x, y, ok] = view.project(g[0], (lanes[i].ys[0] || 0) + 2.6, g[1]);
    // A gate just past the edge of the view keeps its tag, pushed back inside. Further out it becomes a dot on the edge.
    const dot = !ok || x < -40 || x > W + 40 || y < top - 40 || y > H + 20;
    const cls = 'itag' + tag.cls + (dot ? ' dot' : '');
    if (tag.box.className !== cls) tag.box.className = cls;
    if (tag.disp !== '') { tag.disp = s.display = ''; }
    const titanHere = !!T && T.lane === i && (T.phase === 'landing' || (!!tiE && Math.hypot(tiE.x - g[0], tiE.z - g[1]) < 12));
    const op = (alpha * (titanHere && !dot ? 0.12 : 1)).toFixed(2);
    if (tag.op !== op) { tag.op = s.opacity = op; }
    // (an off-screen gate: a pill on the edge with the wave number and an arrow toward the gate; behind the camera the projection mirrors)
    if (dot) { const sx = ok ? x - W / 2 : W / 2 - x, sy = ok ? y - H / 2 : H / 2 - y, a = Math.atan2(sy, sx).toFixed(2) + 'rad'; if (tag.ang !== a) { tag.ang = a; s.setProperty('--a', a); } }
    if (!dot && !tag.w) { tag.w = tag.box.offsetWidth; tag.h = tag.box.offsetHeight; }
    const hw = dot ? 34 : tag.w / 2 + 8;
    // (behind the camera the projected point is mirrored: push it to the far side so the pill sits on the edge toward the gate)
    const px = ok ? x : W - x, py = ok ? y : bottom + 1e4;
    const tf = `translate(${clamp(px, hw, W - hw).toFixed(0)}px, ${clamp(py, top + (dot ? 14 : tag.h), dot ? bottom - 14 : bottom).toFixed(0)}px)`;
    if (tag.tf !== tf) { tag.tf = s.transform = tf; }
  }
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
  diagFrame(dt);
  rotSync();
  if (!paused) titanCamera(dt);
  guideFrame(dt);
  sheetFrame(dt);
  if (titanCue > 0 && !paused) { titanCue -= dt; if (titanCue <= 0) titanSay(); }
  if (!paused) {
    acc += dt * (mode === 'attract' ? 1.4 : speed) * titanSlow();
    let n = 0;
    const cap = dt > 0.2 ? 70 : 10; // a hidden tab is stepped in big chunks so a multiplayer match keeps running
    while (acc >= STEP && n < cap) { bot?.step(STEP); if (!isClient) sim.step(STEP); acc -= STEP; n++; }
    if (n === cap) acc = 0;
    squadT += dt; if (squadT > 1.5) { squadT = 0; squadTokens = Math.min(3, squadTokens + 1); }
    if (isClient) for (const p of sim.projs) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  }
  if (mode === 'attract' && sim.over) { sim = new Sim({ pauseOnCards: false, free: true }); bot = new Bot(sim, 0, 1); fastForward(150); view.setSim(sim, 0); }

  if (active()) {
    // The pan speed follows the zoom, so the board crosses the screen at the same pace at any distance.
    const c = bird(), sp = c.dist * 0.9 * dt;
    let tx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let ty = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    if (tx && ty) { tx *= Math.SQRT1_2; ty *= Math.SQRT1_2; }
    const ek = 1 - Math.exp(-dt * 14);
    keyV.x += (tx - keyV.x) * ek; keyV.y += (ty - keyV.y) * ek;
    const mx = Math.abs(keyV.x) > 0.01 ? keyV.x : 0, my = Math.abs(keyV.y) > 0.01 ? keyV.y : 0;
    if (mx || my) {
      // screen right on the ground, whichever way the camera is turned; screen up is at a right angle to it
      const cx = innerWidth / 2, cy = innerHeight / 2;
      view.groundPoint(cx, cy, ga); view.groundPoint(cx + 80, cy, gb);
      let rx = gb.x - ga.x, rz = gb.z - ga.z;
      const rl = Math.hypot(rx, rz);
      if (rl > 1e-6 && Number.isFinite(rl)) { rx /= rl; rz /= rl; } else { rx = 1; rz = 0; }
      c.x += (rx * mx - rz * my) * sp; c.z += (rz * mx + rx * my) * sp;
      clampCam();
    }
    // E swings the camera to the right, Q to the left. The turn eases in and runs out, it does not start and stop dead.
    keyV.r += ((keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0) - keyV.r) * (1 - Math.exp(-dt * 9));
    if (Math.abs(keyV.r) > 0.004) rotateCam(-keyV.r * 1.9 * dt); // E like a middle-drag to the right (counter-clockwise), Q the other way
    zoomStep(dt);
  } else { keyV.x = keyV.y = keyV.r = 0; }

  // networking
  if (net && mode === 'coop') {
    if (!isClient) {
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
  // the score's tense layer runs while the Titan is on the field
  const tp = sim.titan ? sim.titan.phase : 'none';
  sound.intense = mode !== 'attract' && !ended && (tp === 'landing' || tp === 'walk') ? 1 : 0;
  // the built-in score stays quiet for as long as the player's own music is playing
  sound.setScoreMuted(music.isExternalPlaying());
  // the beat reaches the view only while it is switched on and has somewhere to show
  vx.beat?.(store.fx.beat && (store.fx.borders || store.fx.env || store.fx.towers) ? beatLevel() : 0);
  view.render(dt);
  zoomFix();
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
        startGame('solo', { demo: true, seed, map: g ? generateMap(+g[2], +g[1]) : mapById(mapId) || MAPS[0], diff: 'normal', survival: false }); sound.stopMusic(); fastForward(ff); sim.events.length = 0; view.setSim(sim, 0); },
      attract() { startAttract(); show('menu', false); },
      menu() { startAttract(); },
      sound,
      /** hand control from the bot to the "player" so the card picker can be shown */
      takeover() { bot = null; sim.opts.pauseOnCards = true; },
      /** run the bot-played match forward without drawing; the view is reset afterwards like in demo() */
      skip(seconds: number) { fastForward(seconds); },
      resync() { sim.events.length = 0; view.setSim(sim, 0); },
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
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__dbg = {
      get sim() { return sim; }, view, act, startGame, sound, diag, zoomS, touch: touchApi,
      /** the tutorial: its step and the turret / mine / belt chain it points at */
      get guide() { return { on: guide.on, i: guide.i, title: guide.on ? GUIDE[guide.i].title : '', chain: guide.on ? chainPlan() : null, more: guide.on ? moreTurrets() : [], cam: guideCam.on, fold: $('guide').classList.contains('fold') }; },
      /** what the controller has chosen for building and selected */
      get build() { return { tower: buildType, fac: buildFac, dir: facDir, selected, selFac, tab: barTab, hover: { ...hover }, ore: selOre }; },
    };
  }
  let last = performance.now();
  const loop = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; frame(dt); requestAnimationFrame(loop); };
  // browsers stop animation frames in hidden or background tabs; whenever frames stall, keep a multiplayer match alive on a timer
  setInterval(() => { const now = performance.now(); if (now - last < 400 || !net || mode === 'attract' || ended) return; const dt = Math.min(1.1, (now - last) / 1000); last = now; frame(dt); }, 250);
  requestAnimationFrame(loop);
})();
