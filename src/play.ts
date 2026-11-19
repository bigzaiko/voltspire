// BEATSPIRE - game controller: input, HUD, menus, saved progress, multiplayer glue.
// The fonts, style.css, editor.css, touch.css, music.css and icons.css are linked from play.html, so the page never shows unstyled.
import * as THREE from 'three';
import {
  GW, GH, TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, CARD_BY_ID, RARITY, SQUADS, worldToCell, cellX, cellZ, FACS, FAC_TYPES, ITEMS, FLUIDS, ORES, MAKES,
  TOWER_SUPPLY, TOWER_CHAIN, TOWER_NEEDS_L3, TOWER_CHAIN_L3, TOWER_SUPPLY_L3, FAC_LVL_SPEED, FAC_UPGRADABLE, needsOf, ITEM_SHOTS,
  ORE_TYPES, TOWER_TIER, TARGET_MODES, TARGET_INFO, TARGETABLE, ITEM_TYPES, FLUID_TYPES, FAC_CARD, PROD_CARDS, AMMO2_CARD, CARDS, NEXT_WAVE_IN,
} from './game/data.ts';
import type { TowerType, EnemyType, FacType, ItemType, TowerNeeds, OreType, TargetMode, FluidType, Card } from './game/data.ts';
import { Sim, TITAN_STUN, towerOff } from './game/sim.ts';
import type { Ev, Mode, Tower, Enemy } from './game/sim.ts';
import {
  TOWER_STOCK, TANK, TOWER_TANK, SUPPLY, POLE_REACH, OUT_CAP, TUNNEL_REACH, GEN_POWER, MINE_TIME, PUMP_RATE, SMELT_TIME, REFINE_TIME, REFINE_OUT, turns, facKey, ARM_TIME, conveyor, armBack, armFront,
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
import { icon as ic, chip, recipeDiagram, iconLabel, recipes, chainOf } from './icons.ts';
import type { IconName, ChainTarget } from './icons.ts';
import { initReport, openReport, openLoad, reportOpen, loadOpen, closeForms, logEvents, logAction, showBanner, reportHooks } from './report.ts';
import { Career } from './game/career.ts';
import type { AchDef } from './game/achievements.ts';
import type { SaveMeta } from './game/saves.ts';
import type { MapBest } from './game/records.ts';
import { memoryPlatform } from './platform/index.ts';
import { initRecordsUi } from './records-ui.ts';

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
  v: 3;
  /** rings: the supply rings stay on everything between waves (the HUD's ring button; V shows them while held) */
  settings: { vol: number; mus: number; q: 'high' | 'low'; auto: boolean; rings: boolean };
  fx: { impact: boolean; beat: boolean; borders: boolean; env: boolean; towers: boolean; intensity: number; color: FxColor; custom: string };
  /** filter: which layouts the map picker shows (0 all, 1 to 3 one tier) */
  setup: { survival: boolean; source: 'premade' | 'generated'; map: string; mapName: string; seed: number; tier: number; tierAuto: boolean; diff: string; filter: number };
  /** per map and difficulty, keyed "<map id>|<difficulty id>" */
  records: Record<string, Rec>;
  tips: { node: boolean; boss: boolean; mite: boolean; titan: boolean; factory: boolean; dry: boolean; tutorial: boolean };
  /** the targeting mode new towers of a type start with (set by "Set all" in the tower panel); a type not listed starts on the game's default */
  aim: Partial<Record<TowerType, TargetMode>>;
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
  const old = r.v === 2 || r.v === 3 ? null : r;
  // version 3 turned every 'Shown on' effect on and the colour back to Auto, for everyone once (the owner's new defaults)
  const pre3 = r.v !== 3;
  const s = old || o(r.settings), f = o(r.fx), u = o(r.setup), t = o(r.tips), ds = defaultSetup();
  const colors: FxColor[] = ['auto', 'sand', 'apricot', 'verdigris', 'custom'];
  const store: Store = {
    v: 3,
    settings: { vol: int(s.vol, 0, 100, 70), mus: int(s.mus, 0, 100, 50), q: s.q === 'low' ? 'low' : 'high', auto: bool(s.auto, false), rings: bool(s.rings, false) },
    fx: {
      impact: bool(f.impact, true), beat: bool(f.beat, true), borders: pre3 || bool(f.borders, true), env: pre3 || bool(f.env, true), towers: pre3 || bool(f.towers, true),
      intensity: int(f.intensity, 0, 100, 30), color: pre3 ? 'auto' : colors.find((c) => c === f.color) || 'auto',
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
    aim: {},
  };
  const am = o(r.aim);
  for (const ty of TOWER_TYPES) { const md = TARGET_MODES.find((x) => x === am[ty]); if (md && TARGETABLE[ty]) store.aim[ty] = md; }
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
/** saves, the run archive and achievements (career.ts); null until it has loaded at boot */
let career: Career | null = null;
let bot: Bot | null = null;
let me = 0;
let net: Net | null = null;
let isClient = false;
let paused = false, speed = 1, acc = 0;
/** What the next click builds (a tower or a factory building), and what is selected on the board (a tower id, or a factory building id in selFac). */
let buildType: TowerType | null = null, buildFac: FacType | null = null, selected = 0, selFac = 0;
/** The direction the next belt (or other building) faces, and the bar the number keys pick from. */
let facDir = 0, barTab: 'towers' | 'factory' = 'towers';
/** The targeting mode new towers of a type start with in this run: the last one the player chose for the type (from the saved defaults at the start). */
let aimPref: Partial<Record<TowerType, TargetMode>> = {};
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
/**
 * Touch build: the ghost of what is picked stands where a tap (or a held finger) put it. A second tap on that same tile
 * builds; a tap anywhere else only moves it there, so no single tap, twist or pinch can build by accident (issue #1).
 */
let touchPend = false;
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
const OVERLAYS = ['pause', 'help', 'settings', 'music', 'report', 'loadrep'];
const menuOpen = () => OVERLAYS.some(shown);
const hover = { cx: -1, cz: -1 };
const keys = new Set<string>();
const gp = new THREE.Vector3();
/** true once the touch module has switched the on-screen controls on */
const touchUi = () => shown('touch');

// ---------- actions (local sim, or sent to the co-op host) ----------
const act = {
  build(type: TowerType, cx: number, cz: number) {
    if (isClient) { if (sim.canBuild(type, cx, cz)) net?.send({ t: 'in', a: 'build', ty: TOWER_TYPES.indexOf(type), cx, cz, m: aimPref[type] ? TARGET_MODES.indexOf(aimPref[type]!) : -1 }); else return false; return true; }
    const t = sim.build(type, cx, cz), md = t ? aimPref[type] : undefined;
    // a new tower starts on the mode the player last chose for its kind
    if (t && md && md !== t.aim) sim.setAim(t.id, md);
    return !!t;
  },
  /** set a tower's targeting mode (a co-op guest asks the host, and reads the mode back from the next snapshot) */
  aim(id: number, mode: TargetMode) {
    if (isClient) { net?.send({ t: 'in', a: 'aim', id, m: TARGET_MODES.indexOf(mode) }); return true; }
    if (!sim.setAim(id, mode)) { sound.play('error'); return false; }
    return true;
  },
  upgrade(id: number) {
    if (isClient) { net?.send({ t: 'in', a: 'up', id }); return; }
    // (an upgrade never changes what a tower eats: its second ammunition is a switch in its panel, see act.ammo2)
    if (!sim.upgrade(id)) sound.play('error');
  },
  /** switch a Mk3 tower to its second ammunition, or back (solo: the factory is not replicated) */
  ammo2(id: number, on: boolean) {
    if (isClient || !sim.setAmmo2(id, on)) { sound.play('error'); const why = sim.ammo2Block(id); if (why) note(`Cannot switch: ${why}.`); return false; }
    return true;
  },
  /** a Transfer Arm's filter: one kind of item, or null for anything its target takes */
  armFilter(id: number, it: ItemType | null) { if (!sim.setArmFilter(id, it)) { sound.play('error'); return false; } sound.play('click'); return true; },
  /** upgrade a mine, pumpjack, plant or generator (solo only, like the rest of the factory) */
  upFac(id: number) { if (!sim.upgradeFac(id)) sound.play('error'); },
  sell(id: number) {
    if (!sim.towerById(id)) return false;
    if (isClient) net?.send({ t: 'in', a: 'sell', id }); else sim.sell(id);
    return true;
  },
  card(i: number) { if (isClient) net?.send({ t: 'in', a: 'card', i }); else sim.pickCard(me, i); },
  wave() { if (isClient) net?.send({ t: 'in', a: 'wave' }); else { career?.beforeWave(sim); sim.startWave(); } },
  /** fire a charged tower's special */
  special(id: number) {
    const t = sim.towerById(id);
    if (!t || !sim.specialReady(t)) { sound.play('error'); return false; }
    if (isClient) { net?.send({ t: 'in', a: 'spec', id }); return true; }
    if (!sim.triggerSpecial(id, me)) { sound.play('nospec'); note('Nothing in range for that special. The tower keeps its charge.'); return false; }
    return true;
  },
  // the factory (solo only for now)
  fac(type: FacType, cx: number, cz: number, dir: number) { return sim.buildFac(type, cx, cz, dir); },
  sellFac(id: number) { return sim.sellFac(id); },
  turnFac(id: number, dir: number) { sim.rotateFac(id, dir); },
};
// every player action goes into the bug report's event log (report.ts)
for (const k of Object.keys(act) as (keyof typeof act)[]) {
  const f = act[k] as (...a: unknown[]) => unknown;
  (act as Record<string, unknown>)[k] = (...a: unknown[]) => { if (mode !== 'attract') logAction(k, a, sim.time); return f(...a); };
}

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
/** Phones (upright, or on their side): one toast at a time, top centre, the rest wait their turn. */
const toastMq = matchMedia('(max-width: 600px) and (orientation: portrait), (max-height: 480px)');
const toastQ: string[] = [];
/** A short message. In a match it goes to the HUD; over a menu sheet it goes to a layer above the sheets. */
function toast(text: string) {
  const notes = mode === 'attract' || menuOpen() || shown('end'), box = $(notes ? 'notes' : 'toasts');
  if (!notes && toastMq.matches) {
    // one at a time: a line already up or waiting is not queued again; the queue keeps the newest three
    if (box.firstChild) { if (box.firstChild.textContent !== text && !toastQ.includes(text)) { toastQ.push(text); if (toastQ.length > 3) toastQ.shift(); } return; }
    const t = el('div', 'toast', text), ms = Math.min(3300, 1700 + text.length * 22);
    t.style.setProperty('animation-duration', ms + 'ms');
    box.appendChild(t);
    setTimeout(() => { t.remove(); const n = toastQ.shift(); if (n) toast(n); }, ms);
    return;
  }
  const t = el('div', 'toast', text);
  box.appendChild(t);
  // (a line queued while the phone layout was up waits for this one to go: the screen may have turned since)
  setTimeout(() => { t.remove(); if (!box.firstChild) { const n = toastQ.shift(); if (n) toast(n); } }, 3300);
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
void import('./help.ts').then((m) => m.initLegend({ enemyIcon: (t) => icon(ENEMY_ICON[t]) })); // the legend (HUD ?, L, pause screen; help.ts)
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

// ---------- resource icons and the recipe tooltip ----------
// Every resource, building and tower the HUD names is drawn as its icon (icons.ts). An icon that carries a tip key
// (data-rt, or data-lp for something that is a button of its own: long-press and keyboard focus only) explains itself:
// the pointer resting on it, the keyboard focus, a tap or a long press opens one tooltip with the diagram of how it is
// made, from the deposits on. The tooltip never takes the pointer (pointer-events: none) and goes on Escape, on a press
// anywhere else, and while the board is dragged or a belt is laid.
const plural = (name: string) => (name.endsWith('y') ? name.slice(0, -1) + 'ies' : name + 's');
const andList = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
/** What goes on a deposit: a Pumpjack on oil, a Mine on the rest. */
const oreFac = (o: OreType): FacType => (o === 'oil' ? 'pump' : 'mine');
/** What a deposit gives. */
const oreRaw = (o: OreType): ItemType | FluidType => (o === 'oil' ? 'crude' : o);
/** The tip key of what an icon shows ('' for one that has no recipe to show). */
function rtOf(n: IconName): string {
  if (Object.hasOwn(ITEMS, n)) return 'item:' + n;
  if (Object.hasOwn(FLUIDS, n)) return 'fluid:' + n;
  if (n === 'power' || n === 'mats') return 'res:' + n;
  const i = n.indexOf('_'), kind = n.slice(0, i), id = n.slice(i + 1);
  return kind === 'dep' ? 'ore:' + id : kind === 'fac' ? 'fac:' + id : kind === 'tw' ? 'tower:' + id : '';
}
/** The towers and buildings that take a resource, from the tower and recipe tables. */
function takers(r: string): { tw: TowerType[]; tw3: TowerType[]; fac: FacType[] } {
  const tw = TOWER_TYPES.filter((t) => TOWERS[t].needs.item === r || TOWERS[t].needs.fluid === r);
  const tw3 = TOWER_TYPES.filter((t) => { const n = TOWER_NEEDS_L3[t]; return !!n && (n.item === r || n.fluid === r); });
  const fac: FacType[] = [];
  for (const st of recipes()) if ((st.inp.some((i) => i.res === r) || st.fuel?.res === r) && !fac.includes(st.fac)) fac.push(st.fac);
  return { tw, tw3, fac };
}
function takersText(r: string): string {
  const u = takers(r), all = [...u.tw.map((t) => TOWERS[t].name), ...u.tw3.map((t) => `${TOWERS[t].name} Mk3 (with the ${CARD_BY_ID[AMMO2_CARD[t]!]?.name || 'ammo'} card)`), ...u.fac.map((f) => FACS[f].name)];
  return all.length ? `Goes into: ${andList(all)}.` : '';
}
interface RtInfo { icon: IconName; name: string; kind: string; target: ChainTarget; lvl: number; line: string; /** a locked building: the row that names its card */ lock?: FacType }
/** What a tip key shows: "item:shell", "fluid:crude", "res:power", "ore:coal", "fac:press", "tower:missile" (":3" for its Mk3 supply). */
function rtInfo(key: string): RtInfo | null {
  const [k, id, lv] = key.split(':'), lvl = lv === '3' ? 3 : 1;
  if (k === 'item' && Object.hasOwn(ITEMS, id)) return { icon: id as ItemType, name: ITEMS[id as ItemType].name, kind: 'Item', target: { item: id as ItemType }, lvl, line: takersText(id) };
  if (k === 'fluid' && Object.hasOwn(FLUIDS, id)) return { icon: id as FluidType, name: FLUIDS[id as FluidType].name, kind: 'Fluid', target: { fluid: id as FluidType }, lvl, line: takersText(id) };
  if (k === 'res' && id === 'power') return { icon: 'power', name: 'Power', kind: 'Grid', target: { res: 'power' }, lvl, line: `A Generator or Power Pole powers everything within ${SUPPLY} tiles. The gauge shows what the grids need against what they have.` };
  if (k === 'res' && id === 'mats') return { icon: 'mats', name: 'Building materials', kind: 'Stock', target: { res: 'mats' }, lvl, line: 'Not ammunition: the heavier towers and their upgrades cost them on top of credits.' };
  if (k === 'ore' && Object.hasOwn(ORES, id)) {
    const o = id as OreType, raw = oreRaw(o);
    return { icon: `dep_${o}`, name: ORES[o].name, kind: 'Deposit', target: o === 'oil' ? { fluid: 'crude' } : { item: raw as ItemType }, lvl, line: takersText(raw) };
  }
  if (k === 'fac' && Object.hasOwn(FACS, id)) {
    const f = id as FacType, d = FACS[f];
    const locked = mode !== 'attract' && !sim.facs.has(f);
    return { icon: `fac_${f}`, name: d.name, kind: locked ? 'Building / locked' : 'Building', target: { fac: f }, lvl, line: d.desc.split('. ')[0].replace(/\.$/, '') + '.' + (locked ? ` Locked: it ${unlockText(f)}.` : ''), lock: locked ? f : undefined };
  }
  if (k === 'tower' && Object.hasOwn(TOWERS, id)) {
    const t = id as TowerType, n = needsOf({ type: t, lvl, ammo2: lvl === 3 });
    return { icon: `tw_${t}`, name: TOWERS[t].name + (lvl === 3 ? ' Mk3' : ''), kind: 'Tower', target: { tower: t }, lvl, line: (n.item ? ((q: number) => `One ${ITEMS[n.item!].short} lasts ${q} shot${q === 1 ? '' : 's'}.`)(Math.round((n.shots || ITEM_SHOTS[n.item] || 1) * sim.mods.ammo)) : '') + (mode !== 'attract' && !sim.unlocked.has(t) ? ` Locked: its blueprint card ${sim.bpOpen().includes(t) ? 'can come up at the next level' : 'comes after the towers before it'}.` : '') };
  }
  return null;
}
const rt = { key: '', line: '', a: null as HTMLElement | null, by: '' as '' | 'hover' | 'focus' | 'tap', vw: 0, x: -1, y: -1 };
const rtKey = (a: HTMLElement) => a.dataset.rt || a.dataset.lp || '';
function rtClose() {
  if (!rt.a) return;
  rt.a = null; rt.by = '';
  show('rtip', false);
}
/** Put the tooltip beside its anchor: over it where there is room, else under it, else beside it; always inside the window. */
function rtPlace() {
  const a = rt.a, tip = $('rtip');
  if (!a) return;
  const r = a.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, W = innerWidth, H = innerHeight, g = 10;
  let x = r.left + r.width / 2 - w / 2, y = r.top - h - g;
  // no room over it: beside the panel it sits in (so the panel stays readable), else under it, else beside the icon itself
  const box = y < 8 ? a.closest('.panel, #guide, .card, #tip')?.getBoundingClientRect() : undefined;
  const side = (q: DOMRect) => (q.right + g + w <= W - 8 ? q.right + g : q.left - g - w >= 8 ? q.left - g - w : NaN);
  if (box && !Number.isNaN(side(box))) { x = side(box); y = clamp(r.top + r.height / 2 - h / 2, 8, Math.max(8, H - h - 8)); }
  else {
    if (y < 8) y = r.bottom + g;
    if (y + h > H - 8) { y = clamp(r.top + r.height / 2 - h / 2, 8, Math.max(8, H - h - 8)); const sx = side(r); x = Number.isNaN(sx) ? x : sx; }
  }
  x = Math.round(clamp(x, 8, Math.max(8, W - w - 8))); y = Math.round(y);
  if (x !== rt.x || y !== rt.y) { rt.x = x; rt.y = y; tip.style.transform = `translate(${x}px, ${y}px)`; }
}
function rtOpen(a: HTMLElement, by: 'hover' | 'focus' | 'tap') {
  const key = rtKey(a), info = rtInfo(key), tip = $('rtip');
  if (!info) return;
  // (the line can change under the same key: "lasts N shots" follows the run's ammunition cards)
  if (rt.key !== key || rt.line !== info.line || rt.vw !== innerWidth || !tip.firstChild) {
    rt.key = key; rt.line = info.line; rt.vw = innerWidth;
    const fill = (layout: 'auto' | 'row') => {
      tip.textContent = '';
      const head = el('div', 'rt-head');
      head.append(ic(info.icon, { size: 22 }), el('b', '', info.name), el('span', '', info.kind));
      tip.append(head);
      const dia = recipeDiagram(info.target, { width: Math.min(620, innerWidth - 44), layout, lvl: info.lvl, ammo2: info.lvl === 3 });
      if (!dia.classList.contains('ic-d-none')) tip.append(dia);
      const lock = info.lock ? unlockRow(info.lock) : null;
      if (lock) tip.append(lock);
      if (info.line) tip.append(el('p', '', info.line));
    };
    fill('auto');
    show('rtip');
    // a chain stacked top to bottom that is taller than the window is laid out left to right instead (it shrinks to the width)
    if (tip.offsetHeight > innerHeight - 16) fill('row');
  }
  rt.a = a; rt.by = by; rt.x = rt.y = -1;
  show('rtip');
  rtPlace();
}
/** Once a frame: the tooltip follows its anchor; when the anchor was rebuilt under a resting pointer, the new one takes over. */
function rtFrame() {
  if (!rt.a) return;
  if (painting || dragging || rotating) { rtClose(); return; }
  if (!rt.a.isConnected || rt.a.closest('.hidden')) {
    const under = rt.by === 'hover' ? (document.elementFromPoint(lastMouse.x, lastMouse.y)?.closest('[data-rt]') as HTMLElement | null) : null;
    if (under && rtKey(under) === rt.key) rt.a = under; else { rtClose(); return; }
  }
  rtPlace();
}
const rtAnchor = (t: EventTarget | null, lp = false) => (t instanceof Element ? (t.closest(lp ? '[data-rt],[data-lp]' : '[data-rt]') as HTMLElement | null) : null);
document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch' || painting || dragging || rotating) return;
  const a = rtAnchor(e.target);
  if (a && a !== rt.a) rtOpen(a, 'hover');
});
document.addEventListener('pointerout', (e) => {
  if (rt.by !== 'hover' || !rt.a) return;
  const to = e.relatedTarget;
  if (!(to instanceof Node) || !rt.a.contains(to)) { const a = rtAnchor(to); if (a) rtOpen(a, 'hover'); else rtClose(); }
});
document.addEventListener('focusin', (e) => { const a = rtAnchor(e.target, true); if (a && a.matches(':focus-visible')) rtOpen(a, 'focus'); });
document.addEventListener('focusout', () => { if (rt.by === 'focus') rtClose(); });
// fingers: a tap on an icon that is not a button of its own opens its tooltip (a second tap, or one anywhere else, shuts
// it); a long press opens it on anything, buttons and cards too, and that press then does not count as a tap on them
const rtHold = { timer: 0, x: 0, y: 0, ate: 0 };
document.addEventListener('pointerdown', (e) => {
  clearTimeout(rtHold.timer);
  const a = rtAnchor(e.target, true);
  if (rt.a && (e.pointerType !== 'touch' || a !== rt.a)) rtClose();
  if (e.pointerType !== 'touch' || !a) return;
  rtHold.x = e.clientX; rtHold.y = e.clientY;
  rtHold.timer = window.setTimeout(() => { rtHold.ate = performance.now(); rtOpen(a, 'tap'); }, 420);
}, { capture: true, passive: true });
document.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' && Math.hypot(e.clientX - rtHold.x, e.clientY - rtHold.y) > 10) clearTimeout(rtHold.timer); }, { capture: true, passive: true });
for (const ev of ['pointerup', 'pointercancel'] as const) document.addEventListener(ev, () => clearTimeout(rtHold.timer), { capture: true, passive: true });
document.addEventListener('click', (e) => {
  // (the click that ends a long press belongs to the tooltip, not to the button under the finger)
  if (performance.now() - rtHold.ate < 700) { rtHold.ate = 0; e.stopPropagation(); e.preventDefault(); return; }
  if (!byTouch) return;
  const a = rtAnchor(e.target);
  if (!a || a.closest('button, a, .card')) return;
  if (rt.a === a) rtClose(); else rtOpen(a, 'tap');
}, { capture: true });
document.addEventListener('contextmenu', (e) => { if (byTouch && rtAnchor(e.target, true)) e.preventDefault(); });
addEventListener('resize', rtClose);
addEventListener('scroll', rtClose, { capture: true, passive: true });

interface RChip { state?: 'ok' | 'missing' | 'dim' | 'plain'; label?: string; rt?: string; tab?: boolean; size?: number }
/**
 * A chip that explains itself: an icon, a short count beside it, and the recipe tooltip of what it shows. `tab: false`
 * for one inside a button or a tooltip (not a stop of its own). `label`: what a screen reader says instead of the icon's name.
 */
function rchip(name: IconName, text?: string | number, o: RChip = {}): HTMLElement {
  const c = chip(name, text, { state: o.state, size: o.size }), key = o.rt ?? rtOf(name), t = text === undefined || text === '' ? '' : ' ' + text;
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', o.label ?? iconLabel(name) + t);
  if (key) { c.dataset.rt = key; if (o.tab !== false) { c.tabIndex = 0; c.setAttribute('aria-describedby', 'rtip'); } }
  else c.title = o.label ?? iconLabel(name);
  return c;
}
/** What a tower runs on as chips: its ammunition, its fluid, the power it draws. */
function needChips(n: TowerNeeds, o: RChip = {}): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (n.item) out.push(rchip(n.item, '', o));
  if (n.fluid) out.push(rchip(n.fluid, '', o));
  if (n.power) out.push(rchip('power', n.power, o));
  return out;
}
/** A row of the HUD: a small label and what follows it. */
function rrow(label: string, ...kids: (Node | string)[]): HTMLElement {
  const r = el('div', 'rr');
  if (label) r.append(rgrp(label, ...kids)); else r.append(...kids);
  return r;
}
const arrow = () => el('span', 'ra', '›');
/** A label and the chips it belongs to, kept together when the row wraps. */
function rgrp(label: string, ...kids: (Node | string)[]): HTMLElement {
  const g = el('span', 'rg');
  if (label) g.append(el('span', 'rl', label));
  g.append(...kids);
  return g;
}
/** The icons of what a diagnosis says is missing ("power", "a taker for its output", an item's short name ...); none for a line only words can say. */
function missIcons(m: string): IconName[] {
  const it = ITEM_TYPES.find((i) => ITEMS[i].short === m);
  if (it) return [it];
  const fl = FLUID_TYPES.find((f) => FLUIDS[f].name.toLowerCase() === m);
  if (fl) return [fl];
  if (m === 'power') return ['power'];
  if (m.startsWith('a Generator')) return ['fac_generator'];
  if (m.startsWith('coal for')) return ['coal'];
  if (m === 'an oil field') return ['dep_oil'];
  if (m === 'an ore deposit') return ['dep_iron_ore', 'dep_copper_ore', 'dep_coal'];
  if (m === 'iron or copper ore') return ['iron_ore', 'copper_ore'];
  if (m.startsWith('a taker')) return ['st_notaker'];
  if (m === 'a target' || m === 'something to take' || m === 'an arm at its end') return ['fac_arm'];
  if (m.startsWith('a second pipe')) return ['fac_ptunnel'];
  if (m.startsWith('a second')) return ['fac_tunnel'];
  return [];
}
/** The building a "Supplied by" entry names ("Mine", "Smelter (by belt)"). */
function fromIcon(n: string): IconName | null {
  const base = n.replace(/ \(.*\)$/, ''), f = (Object.keys(FACS) as FacType[]).find((k) => FACS[k].name === base);
  return f ? `fac_${f}` : null;
}
// the gauges that count a resource carry its icon; Materials and Power open their recipe like any other icon
$('st-gold').insertBefore(ic('credits', { size: 20 }), $('gold'));
$('st-mats').insertBefore(ic('mats', { size: 20 }), $('mats'));
$('st-power').insertBefore(ic('power', { size: 18 }), $('power'));

// ---------- cards as things the HUD can name: what opens what ----------
/** What a card is about, as icons: the buildings a production card opens, a blueprint's tower, an ammo card's tower and its new ammunition. */
function cardIcons(c: Card): IconName[] {
  if (c.unlocks) return c.unlocks.map((f) => `fac_${f}` as IconName);
  if (c.kind === 'blueprint' && Object.hasOwn(TOWERS, c.id.slice(3))) return [`tw_${c.id.slice(3) as TowerType}`];
  if (c.ammo) { const n = TOWER_NEEDS_L3[c.ammo]; return [`tw_${c.ammo}`, ...(n?.item ? [n.item] : n?.fluid ? [n.fluid] : [])] as IconName[]; }
  return CARD_ICONS[c.id] || [];
}
type CardState = 'have' | 'open' | 'locked';
/** Where the run stands with a card: taken (or a blueprint's tower unlocked), on offer now (its preconditions hold), or still locked behind something. */
function cardState(c: Card): CardState {
  if (c.kind === 'blueprint' ? sim.unlocked.has(c.id.slice(3) as TowerType) : sim.taken(c.id)) return 'have';
  return sim.cardOk(me, c) ? 'open' : 'locked';
}
/** What a card still waits for, in words: the cards it requires, the level it comes from, its tower. Empty when nothing. */
function cardWaits(c: Card): string[] {
  const out: string[] = [];
  for (const r of c.requires || []) if (!sim.taken(r) && Object.hasOwn(CARD_BY_ID, r)) out.push(`the ${CARD_BY_ID[r].name} card`);
  if (c.minLevel !== undefined && sim.level < c.minLevel) out.push(`level ${c.minLevel}`);
  if (c.minWave !== undefined && sim.wave < c.minWave) out.push(`wave ${c.minWave}`);
  if (c.needs && !sim.unlocked.has(c.needs)) out.push(`the ${TOWERS[c.needs].name} blueprint`);
  if (c.kind === 'blueprint' && !sim.unlocked.has(c.id.slice(3) as TowerType) && !sim.bpOpen().includes(c.id.slice(3) as TowerType)) out.push('the towers before it');
  return out;
}
const CARD_STATE_WORD: Record<CardState, string> = { have: 'you have it', open: 'can be offered now', locked: 'not yet' };
/** A card as a small plate: its icons and its name, toned by where the run stands with it. */
function cardChip(id: string, o: { state?: CardState; name?: boolean; note?: string } = {}): HTMLElement {
  const c = CARD_BY_ID[id], st = o.state ?? cardState(c), e = el('span', 'cchip ' + st);
  for (const n of cardIcons(c).slice(0, 2)) e.append(ic(n, { size: 15 }));
  if (o.name !== false) e.append(el('span', '', c.name.replace(/^Blueprint: /, '')));
  if (o.note) e.append(el('small', '', o.note));
  const waits = st === 'locked' ? cardWaits(c) : [];
  e.setAttribute('role', 'img');
  e.setAttribute('aria-label', `${c.name} card: ${st === 'locked' && waits.length ? 'needs ' + andList(waits) : CARD_STATE_WORD[st]}`);
  e.title = `${c.name}: ${c.desc}${waits.length ? ` Needs ${andList(waits)}.` : ''}`;
  return e;
}
/** The factory buildings it takes to make a resource from the deposits on (power: a Generator and its coal). */
function facsFor(r: ItemType | FluidType | 'power'): FacType[] {
  const tg: ChainTarget = r === 'power' ? { res: 'power' } : Object.hasOwn(ITEMS, r) ? { item: r as ItemType } : { fluid: r as FluidType };
  return (chainOf(tg)?.facs || []).filter((f) => Object.hasOwn(FAC_CARD, f) && f !== 'belt' && f !== 'splitter' && f !== 'tunnel' && f !== 'ptunnel');
}
/** The production cards the player still lacks to make a resource (empty: it can be made with what is unlocked). */
function cardsFor(r: ItemType | FluidType | 'power'): string[] {
  const out: string[] = [];
  for (const f of facsFor(r)) { const id = FAC_CARD[f]; if (id && !sim.facs.has(f) && !out.includes(id)) out.push(id); }
  return out;
}
/** What a tower runs on as chips that say whether the player can make each yet (a tick or a broken ring), and the cards that are missing for it. */
function needsMakeable(n: TowerNeeds): { chips: HTMLElement[]; cards: string[] } {
  const chips: HTMLElement[] = [], cards: string[] = [];
  const one = (r: ItemType | FluidType | 'power', text: string | number) => {
    const miss = sim.opts.free ? [] : cardsFor(r), nm = iconLabel(r as IconName);
    chips.push(rchip(r as IconName, text, { tab: false, state: miss.length ? 'missing' : 'ok', label: `${nm}: ${miss.length ? 'you cannot make it yet (needs ' + andList(miss.map((id) => CARD_BY_ID[id].name)) + ')' : 'you can make it'}` }));
    for (const id of miss) if (!cards.includes(id)) cards.push(id);
  };
  if (n.item) one(n.item, '');
  if (n.fluid) one(n.fluid, '');
  if (n.power) one('power', n.power);
  // (in the order a run takes them)
  return { chips, cards: PROD_CARDS.filter((c) => cards.includes(c.id)).map((c) => c.id) };
}
/** "Unlocks with the X card", and what that card waits for in turn, as a row for a tooltip or a panel. */
function unlockRow(f: FacType): HTMLElement | null {
  const id = FAC_CARD[f];
  if (!id || sim.facs.has(f)) return null;
  const c = CARD_BY_ID[id], row = rrow('Unlocks with', cardChip(id)), pre = (c.requires || []).filter((r) => Object.hasOwn(CARD_BY_ID, r));
  row.classList.add('wrap', 'unlock');
  if (pre.length) row.append(rgrp('after', ...pre.map((r) => cardChip(r))));
  if (c.minLevel !== undefined && sim.level < c.minLevel) row.append(rgrp('from', el('span', 'cchip locked', `level ${c.minLevel}`)));
  return row;
}
/** The same in words. */
function unlockText(f: FacType): string {
  const id = FAC_CARD[f];
  if (!id) return 'not unlocked yet';
  const c = CARD_BY_ID[id], w = cardWaits(c);
  return `comes with the ${c.name} card${w.length ? ` (offered after ${andList(w)})` : ''}`;
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
/** The width the docked tooltip's diagram may take. */
const tipWidth = () => Math.min(600, innerWidth - 60);
/** A price as chips: credits, and building materials where it costs them. */
function priceChips(credits: number, mats = 0): HTMLElement[] {
  const out = [rchip('credits', credits, { tab: false })];
  if (mats) out.push(rchip('mats', mats, { tab: false }));
  return out;
}
/** The glyphs of the stat chips: damage (a burst), fire rate (two chevrons), range (a ring round a dot), a boost (an arrow up). */
const STAT_GLYPH: Record<'dmg' | 'rate' | 'range' | 'boost', [string, boolean][]> = {
  dmg: [['M10 1.5l2 5.3 5.6.3-4.4 3.5 1.5 5.5L10 13l-4.7 3.1 1.5-5.5L2.4 7.1 8 6.8z', true]],
  rate: [['M3.5 4.5l5.5 5.5-5.5 5.5M10.5 4.5l5.5 5.5-5.5 5.5', false]],
  range: [['M10 2.6a7.4 7.4 0 1 1 0 14.8a7.4 7.4 0 1 1 0-14.8z', false], ['M10 8.2a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6z', true]],
  boost: [['M10 3l6 7h-4v7H8v-7H4z', true]],
};
const STAT_NAME = { dmg: 'Damage', rate: 'Fire rate', range: 'Range', boost: 'Damage boost' };
/** A number with its glyph: damage, fire rate or range (the word is its tooltip and what a screen reader says). */
function statChip(kind: keyof typeof STAT_GLYPH, value: string, name: string = STAT_NAME[kind]): HTMLElement {
  const c = el('span', 'stat-c s-' + kind), svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true');
  for (const [d, fill] of STAT_GLYPH[kind]) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); p.setAttribute('class', fill ? 'f' : 's'); svg.append(p); }
  c.append(svg, el('b', '', value));
  c.title = name; c.setAttribute('role', 'img'); c.setAttribute('aria-label', `${name} ${value}`);
  return c;
}
/** A tower's numbers as stat chips. */
function statRow(dmg: number, rate: number, range: number, pulse = false): HTMLElement {
  const row = el('div', 'stat-row');
  if (dmg > 0) row.append(statChip('dmg', dmg.toFixed(0)));
  if (rate > 0) row.append(statChip('rate', rate.toFixed(rate < 10 ? 1 : 0) + '/s', pulse ? 'Pulse rate' : 'Fire rate'));
  if (range > 0) row.append(statChip('range', range.toFixed(1)));
  return row;
}
/** The rendered still of a tower or building (public/media/sm), as a small square picture. */
function thumb(name: string, cls = 'thumb'): HTMLImageElement {
  const img = el('img', cls) as HTMLImageElement;
  img.alt = ''; img.width = 48; img.height = 48; img.decoding = 'async';
  img.src = `./media/sm/${name}.jpg`;
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}
function towerTip(t: TowerType) {
  const d = TOWERS[t], tip = $('tip'), l3 = TOWER_NEEDS_L3[t];
  tip.textContent = '';
  // the render of the tower, its name and one line; its numbers as chips
  const head = el('b'); head.append(ic(`tw_${t}`, { size: 22 }), d.name);
  const top = el('div', 'tip-top'), words = el('div', 'tip-words');
  words.append(head, el('span', '', d.desc));
  if (d.dmg > 0 || d.range > 0) words.append(statRow(d.dmg, d.rate, d.range, t === 'beacon'));
  top.append(thumb('tower_' + t), words);
  tip.append(top);
  // what it runs on: the chips, the whole chain as a diagram (left out where there is no room for it: a long press shows it)
  const mk = needsMakeable(d.needs), row = rrow('Needs', ...mk.chips);
  // (its second ammunition is a choice, not a consequence of Mk3: the card that opens it, then a switch on each tower)
  const a2 = AMMO2_CARD[t];
  if (l3 && a2) row.append(rgrp('or, Mk3', ...needChips(l3, { tab: false }), cardChip(a2, { name: false })));
  row.append(rgrp('Costs', ...priceChips(sim.cost(t), sim.matCost(t))));
  tip.append(row);
  if (mk.cards.length) { const r = rrow('Supply needs', ...mk.cards.map((id) => cardChip(id))); r.classList.add('wrap', 'unlock'); tip.append(r); }
  const dia = recipeDiagram({ tower: t }, { width: tipWidth() });
  dia.classList.add('tip-dia');
  tip.append(dia);
  // the special: its name (what it does is its tooltip; the tower's panel says it in full)
  if (d.special) { const sp = el('i', 'tip-spec'); sp.append(statChip('dmg', d.special.name, 'Special'), el('small', '', touchUi() ? 'hold the tower' : 'right-click the tower')); sp.title = d.special.desc; tip.append(sp); }
  if (!sim.unlocked.has(t)) tip.append(el('i', 'lock', sim.bpOpen().includes(t) ? 'Locked. Its blueprint card can come up at the next blueprint level.' : 'Locked. Its blueprint card comes after the towers before it.'));
  show('tip');
}
function facTip(t: FacType) {
  const d = FACS[t], tip = $('tip');
  tip.textContent = '';
  const head = el('b'); head.append(ic(`fac_${t}`, { size: 22 }), d.name);
  const top = el('div', 'tip-top'), words = el('div', 'tip-words');
  words.append(head, el('span', '', d.desc));
  top.append(thumb('fac_' + t), words);
  tip.append(top);
  const row = rrow('Costs', ...priceChips(sim.facCost(t)));
  if (d.power) row.append(rgrp('Draws', rchip('power', d.power, { tab: false })));
  tip.append(row);
  const lock = unlockRow(t);
  if (lock) tip.append(lock);
  const dia = recipeDiagram({ fac: t }, { width: tipWidth() });
  dia.classList.add('tip-dia');
  if (!dia.classList.contains('ic-d-none')) tip.append(dia);
  if (lock) tip.append(el('i', 'lock', `Locked: it ${unlockText(t)}.`));
  else if (t === 'arm') tip.append(el('i', '', `One item a swing, ${(60 / ARM_TIME).toFixed(0)} a minute at Mk1: plenty for one mine. Upgrade it twice for credits (${FAC_LVL_SPEED[1]}x, ${FAC_LVL_SPEED[2]}x).`));
  else if (FAC_UPGRADABLE.has(t)) tip.append(el('i', '', `Upgrade it twice for credits: Mk2 works ${FAC_LVL_SPEED[1]}x, Mk3 ${FAC_LVL_SPEED[2]}x as fast${t === 'generator' ? ' (gives that much more power, burning coal as much faster)' : ''}.`));
  show('tip');
}
/** What a building puts out, for its button on the bar. */
function facMakes(t: FacType): IconName[] {
  const out: IconName[] = [];
  for (const st of recipes()) if (st.fac === t && !out.includes(st.out)) out.push(st.out);
  return out;
}
/** The power a tower or building draws, on its bar button: a small bolt and the number. */
function drawMark(n: number, cls = 'pw'): HTMLElement {
  const s = el('span', cls);
  s.append(ic('power', { size: 13 }), String(n));
  return s;
}
/** The key of a building on the Factory bar ('' past the tenth). */
const facKeyOf = (t: FacType) => { const i = FAC_TYPES.indexOf(t); return i < 0 || i > 9 ? '' : String((i + 1) % 10); };
const buildBtns = {} as Record<TowerType, HTMLButtonElement>;
const facBtns = {} as Record<FacType, HTMLButtonElement>;
/** the price chip of each bar card (the last thing written to it is kept in btnState) */
const btnCost = new Map<HTMLElement, HTMLElement>();
let tipHover: TowerType | FacType | null = null;
/** A padlock (the corner of a locked bar card). */
const LOCK_PATH = 'M5 7V5a3 3 0 0 1 6 0v2h1.2c.4 0 .8.4.8.8v6.4c0 .4-.4.8-.8.8H3.8c-.4 0-.8-.4-.8-.8V7.8c0-.4.4-.8.8-.8zm1.6 0h2.8V5a1.4 1.4 0 0 0-2.8 0zM8 9.2a1.1 1.1 0 0 0-.6 2v1.4h1.2v-1.4a1.1 1.1 0 0 0-.6-2z';
/** The face of a bar card: the render of the tower or building (public/media/sm), its icon large where no still loads. */
function barFace(still: string, fallback: IconName): HTMLElement {
  const f = el('span', 'face'), img = el('img') as HTMLImageElement;
  img.alt = ''; img.width = 160; img.height = 160; img.decoding = 'async'; img.draggable = false;
  img.src = `./media/sm/${still}.jpg`;
  img.addEventListener('error', () => { img.remove(); f.classList.add('noimg'); f.append(ic(fallback, { size: 40 })); }, { once: true });
  f.append(img);
  return f;
}
/** One card of the build bar: the face, the key in a corner badge, what it runs on (or makes) as a tiny row, the name as a caption, the price as a chip, a padlock. */
function barCard(kind: 'tower' | 'fac', id: string, color: number, key: string, name: string, need: HTMLElement): HTMLButtonElement {
  const b = el('button', kind === 'tower' ? 'tw' : 'tw fac') as HTMLButtonElement;
  b.type = 'button';
  b.style.setProperty('--c', hex(color));
  b.dataset.k = id;
  b.dataset.lp = kind + ':' + id;
  const cost = el('div', 'cost');
  need.classList.add('need');
  b.append(barFace((kind === 'tower' ? 'tower_' : 'fac_') + id, `${kind === 'tower' ? 'tw' : 'fac'}_${id}` as IconName), el('kbd', '', key), need, icon(LOCK_PATH, 'lk'), el('div', 'nm', name), cost);
  btnCost.set(b, cost);
  // A tooltip opens when the mouse moves over the card, not when a card appears under a resting pointer.
  // Fingers have no hover: the tooltip of the tower picked for building is shown instead (a long press shows any card's).
  b.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch' && (e.movementX || e.movementY)) tipHover = id as TowerType | FacType; });
  b.addEventListener('pointerleave', () => { if (tipHover === id) tipHover = null; });
  return b;
}
for (const t of TOWER_TYPES) {
  const d = TOWERS[t], need = el('div');
  // the final resources it has to be fed, as icons (how each is made: the tooltip's diagram)
  if (d.needs.item) need.append(ic(d.needs.item, { size: 14 }));
  if (d.needs.fluid) need.append(ic(d.needs.fluid, { size: 14 }));
  if (d.needs.power) need.append(drawMark(d.needs.power));
  const b = barCard('tower', t, d.color, d.key, d.name, need);
  b.setAttribute('aria-label', `${d.name}, key ${d.key.toUpperCase()}. Runs on ${needsText(t)}.`);
  b.addEventListener('click', () => { sound.init(); pickBuild(t); });
  buildBtns[t] = b;
  $('build').appendChild(b);
}
for (const t of FAC_TYPES) {
  const d = FACS[t], makes = facMakes(t), need = el('div');
  // what it makes, and the power it draws
  for (const m of makes.slice(0, 2)) need.append(ic(m, { size: 14 }));
  if (t === 'generator') need.append(el('span', 'pw', String(GEN_POWER)));
  if (d.power) need.append(drawMark(d.power, 'pw draw'));
  const b = barCard('fac', t, d.color, facKeyOf(t), d.name, need);
  b.setAttribute('aria-label', d.name + (makes.length ? `. Makes ${andList(makes.map(iconLabel))}` : '') + (d.power ? `. Draws ${d.power} power` : '') + '.');
  b.addEventListener('click', () => { sound.init(); pickFac(t); });
  facBtns[t] = b;
  $('fbuild').appendChild(b);
}
// the tabs: the icon of a turret and of a smelter (the word stays for screen readers and as the tooltip)
for (const [id, n] of [['tab-towers', 'tw_pulse'], ['tab-factory', 'fac_smelter']] as const) {
  const b = $(id), word = (b.textContent || '').trim();
  b.replaceChildren(ic(n, { size: 22 }), el('span', 'tl', word));
  b.setAttribute('aria-label', word);
}
// a mouse wheel turned over a bar that does not fit scrolls it sideways
for (const id of ['build', 'fbuild']) {
  const bar = $(id);
  bar.addEventListener('wheel', (e) => {
    if (bar.scrollWidth <= bar.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    bar.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 32 : 1);
  }, { passive: false });
  // (one that does not fit fades its right edge, so a card cut off there reads as "more this way")
  const fit = () => { const over = bar.classList.contains('over'); bar.classList.toggle('over', bar.scrollWidth - (over ? 19 : 0) > bar.clientWidth + 2); };
  new ResizeObserver(fit).observe(bar);
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
/** The factory bar shows every building from the start (the locked ones hatched): the number keys go by place, so a key never moves. */
const facList = () => FAC_TYPES;
function pickFac(t: FacType | null) {
  if (t && !sim.facs.has(t)) { sound.play('error'); note(`${FACS[t].name} is locked: it ${unlockText(t)}.`); return; }
  buildFac = buildFac === t ? null : t;
  buildType = null; selected = 0; selFac = 0;
  touchUnpend();
  sound.play('click');
  view.setGhost(null);
  if (!buildFac) view.setFacGhost(null);
  refreshGhost();
  if ((buildFac === 'belt' || buildFac === 'pipe') && !bot && !store.tips.factory && !guideOn()) { store.tips.factory = true; save(); tutor(touchUi() ? 'Tap a hex, then hold the ghost and drag to lay a line.' : 'Drag to lay a line of belts. Arms put items on and take them off.'); }
  // (once a run: the ghost's arrow shows it from then on)
  if (buildFac === 'arm' && !bot && !guideOn() && !told.arm) { told.arm = true; note(touchUi() ? 'Arm: takes from behind its arrow, delivers in front. Turn turns it.' : 'Arm: takes from behind its arrow, delivers in front. R turns it.'); }
  touchHowTo();
  if (buildFac === 'tunnel') note(`Build the entrance, then the exit facing the same way up to ${TUNNEL_REACH} tiles ahead. ${touchUi() ? 'Turn' : 'R'} turns it.`);
  if (buildFac === 'ptunnel') note(`Build two in a straight line, up to ${TUNNEL_REACH} tiles apart: their pipes join under whatever stands between.`);
}
/** What was already said once this run. */
const told = { arm: false, tap: false };
/** Touch, the first tool picked in a run: how placing works now (a tap shows the ghost, a second tap builds). */
function touchHowTo() { if (byTouch && (buildType || buildFac) && !told.tap && !guideOn()) { told.tap = true; note('Tap a hex to place the ghost, tap it again to build.'); } }
function pickBuild(t: TowerType | null) {
  if (t && !sim.unlocked.has(t)) { sound.play('error'); note(TOWERS[t].name + ' is locked. Its blueprint card comes at a later level.'); return; }
  buildType = buildType === t ? null : t;
  buildFac = null; selected = 0; selFac = 0;
  touchUnpend();
  view.setFacGhost(null);
  sound.play('click');
  if (!buildType) view.setGhost(null);
  refreshGhost();
  touchHowTo();
}
/** A tool picked by touch shows no ghost until a tap puts it on a tile (the last tile tapped means nothing to the new tool). */
function touchUnpend() { touchPend = false; if (byTouch) { hover.cx = -1; hover.cz = -1; } }
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
/** What a factory or economy card is about, as icons under its text. */
const CARD_ICONS: Record<string, IconName[]> = {
  f_drill: ['fac_mine', 'fac_pump'], f_belt: ['fac_belt', 'fac_splitter', 'fac_tunnel'], f_craft: ['fac_smelter', 'fac_press', 'fac_cells', 'fac_refinery', 'fac_missiles', 'fac_works'],
  f_gen: ['fac_generator', 'power'], f_ammo: ['iron_ore', 'copper', 'shell', 'cell', 'missile'], f_stock: ['mats'],
  salvage: ['credits'], drop: ['credits'], interest: ['credits'], fab: ['credits', 'mats'],
};
let cardAt = 0, cardFree = false, cardArmed = false, guardAnim: Animation | null = null;
function armCards() {
  if (cardArmed) return;
  if (!cardFree && !mouseBtns && !keys.has('1') && !keys.has('2') && !keys.has('3')) cardFree = true;
  if (cardFree && performance.now() - cardAt >= CARD_GUARD_MS) { cardArmed = true; $('cards').classList.add('armed'); }
}
/** The first sentence of a card's text (the whole text is on the card's info side). */
const firstLine = (t: string) => { const one = (t.match(/^.*?[.!?](?=\s|$)/)?.[0] || t).trim(), c = one.indexOf(': '); return c > 12 ? one.slice(0, c) + '.' : one; };
/** The picture of a level-up card: a blueprint's tower render, the building renders a production card opens, an ammo card's tower with its new ammunition, else its glyph large on a tinted panel. */
function cardVisual(c: Card, bt: TowerType | null): HTMLElement {
  const v = el('div', 'cv');
  const pic = (still: string, fb: IconName) => { const f = barFace(still, fb); f.className = 'cimg'; return f; };
  if (bt) { v.classList.add('cv-tw'); v.append(pic('tower_' + bt, `tw_${bt}`)); }
  else if (c.unlocks) { v.classList.add('cv-fac'); v.dataset.n = String(Math.min(3, c.unlocks.length)); for (const f of c.unlocks.slice(0, 3)) v.append(pic('fac_' + f, `fac_${f}`)); }
  else if (c.ammo) {
    v.classList.add('cv-tw', 'cv-ammo'); v.append(pic('tower_' + c.ammo, `tw_${c.ammo}`));
    const n = TOWER_NEEDS_L3[c.ammo], a = n?.item || n?.fluid;
    if (a) { const b = el('span', 'cv-badge'); b.append(ic(a, { size: 34 })); v.append(b); }
  } else {
    v.classList.add('cv-ic');
    if (c.needs) { const bg = pic('tower_' + c.needs, `tw_${c.needs}`); bg.classList.add('ghost'); v.append(bg); }
    const g = el('span', 'cv-glyph', c.icon), about = CARD_ICONS[c.id];
    v.append(g);
    if (about) { const r = el('span', 'cv-about'); for (const n of about.slice(0, 4)) r.append(ic(n, { size: 26 })); v.append(r); }
    else if (c.needs) { const r = el('span', 'cv-about'); r.append(ic(`tw_${c.needs}`, { size: 26 })); v.append(r); }
  }
  return v;
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
  setText('cards-sub', p.pending.length > 1 ? `Choose one (${p.pending.length} waiting)` : 'Choose one');
  p.pending[0].forEach((id, i) => {
    // a co-op guest gets its offer from the host: skip anything that is not a known card
    if (typeof id !== 'string' || !Object.hasOwn(CARD_BY_ID, id)) return;
    const c = CARD_BY_ID[id];
    // The card: a big picture, its name, one line and its icon chips. The whole text and every detail row are on its
    // info side (the i button, or a moment's hover with a mouse), laid over the card.
    const w = el('div', 'cw'), d = el('button', 'card') as HTMLButtonElement, info = el('button', 'cinfo') as HTMLButtonElement, full = el('div', 'cfull');
    d.type = 'button'; info.type = 'button';
    w.style.setProperty('--rc', ['#e3dc92', '#f68b56', '#6fe0c8'][c.rar]);
    w.classList.add('r' + c.rar);
    const bt = c.kind === 'blueprint' && c.id.startsWith('bp_') && Object.hasOwn(TOWERS, c.id.slice(3)) ? (c.id.slice(3) as TowerType) : null;
    const tint = bt || c.ammo || c.needs;
    if (tint) w.style.setProperty('--tc', hex(TOWERS[tint].color));
    const offer = p.pending[0], chips = el('div', 'cchips'), more = el('div', 'cmore');
    const kindWord = bt ? 'Blueprint' : c.unlocks ? 'Production' : c.ammo ? 'Mk3 ammo' : c.kind === 'eco' ? 'Economy' : c.kind === 'factory' ? 'Factory' : c.needs ? TOWERS[c.needs].name : 'All towers';
    const desc = bt ? TOWERS[bt].desc : c.desc;
    more.append(el('p', '', bt ? `${TOWERS[bt].desc} Supply: ${needsText(bt)}.` : c.desc));
    if (bt) {
      const td = TOWERS[bt], mk = needsMakeable(td.needs), wait = sim.supplyCards(bt);
      chips.append(...mk.chips);
      if (td.mat) chips.append(rchip('mats', td.mat, { tab: false, state: sim.facs.has('works') ? 'ok' : 'missing', label: `${td.mat} building materials: ${sim.facs.has('works') ? 'you can make them' : 'you start with a few; more need the Frame Works card'}` }));
      if (wait.length) {
        chips.append(arrow());
        for (const wc of wait.slice(0, 3)) { const cc = cardChip(wc, { name: false }); if (offer.includes(wc)) cc.classList.add('onoffer'); chips.append(cc); }
        if (wait.length > 3) chips.append(el('span', 'more', `+${wait.length - 3}`));
      } else chips.append(el('span', 'cchip have ready', '✓'));
      const sup = rrow(wait.length ? 'Supply needs' : 'Supply');
      sup.classList.add('wrap', 'unlock');
      if (wait.length) sup.append(...wait.map((wc) => cardChip(wc, { note: offer.includes(wc) ? 'on offer' : '' })));
      else sup.append(el('span', 'cchip have', 'you can build it now'));
      more.append(rrow('Needs', ...needsMakeable(td.needs).chips), sup);
      d.dataset.lp = 'tower:' + bt;
      d.setAttribute('aria-label', `${c.name}. ${td.desc} Runs on ${needsText(bt)}. ${wait.length ? `Its supply still needs the ${andList(wait.map((x) => CARD_BY_ID[x].name))} card${wait.length > 1 ? 's' : ''}.` : 'You can build its supply line now.'}`);
    } else if (c.unlocks) {
      for (const f of c.unlocks) { const mk = facMakes(f); chips.append(rgrp('', rchip(`fac_${f}`, '', { tab: false }), ...(mk.length ? [arrow(), ...mk.slice(0, 2).map((m) => rchip(m, '', { tab: false }))] : []))); }
      // the towers whose supply line runs through these buildings: the ones the player has first, then the blueprints still to come
      const serves = TOWER_TYPES.filter((t) => TOWER_CHAIN[t].some((f) => c.unlocks!.includes(f)) || (TOWER_CHAIN_L3[t] || []).some((f) => c.unlocks!.includes(f) && sim.taken(AMMO2_CARD[t] || '')));
      const mine = serves.filter((t) => sim.unlocked.has(t)), later = serves.filter((t) => !sim.unlocked.has(t));
      if (serves.length) {
        const r = rrow('Serves');
        r.classList.add('wrap');
        for (const t of mine) r.append(rchip(`tw_${t}`, '', { tab: false, state: 'ok', label: `${TOWERS[t].name}: unlocked` }));
        for (const t of later.slice(0, 6)) r.append(rchip(`tw_${t}`, '', { tab: false, state: 'dim', label: `${TOWERS[t].name}: blueprint still to come` }));
        if (later.length > 6) r.append(el('span', 'more', `+${later.length - 6}`));
        more.append(r);
        // (on the card itself: the towers it serves that the player already has)
        if (mine.length) { const g = rgrp('', ...mine.slice(0, 4).map((t) => rchip(`tw_${t}`, '', { tab: false, state: 'ok', label: `Serves your ${TOWERS[t].name}` }))); g.classList.add('serves'); chips.append(g); }
      }
      const leads = CARDS.filter((o) => (o.requires || []).includes(c.id) && cardState(o) !== 'have');
      if (leads.length) {
        const r = rrow('Leads to');
        r.classList.add('wrap', 'unlock');
        // (what it would be once this card is taken: on offer if nothing else holds it back)
        for (const o of leads) r.append(cardChip(o.id, { state: cardWaits(o).length > 1 ? 'locked' : 'open' }));
        more.append(r);
      }
      d.dataset.lp = 'fac:' + c.unlocks[0];
      d.setAttribute('aria-label', `${c.name}. ${c.desc}${mine.length ? ` Serves your ${andList(mine.map((t) => TOWERS[t].name))}.` : ''}${leads.length ? ` Leads to ${andList(leads.map((o) => o.name))}.` : ''}`);
    } else if (c.ammo && TOWER_NEEDS_L3[c.ammo]) {
      const l3 = TOWER_NEEDS_L3[c.ammo]!, mk = needsMakeable(l3);
      chips.append(...needChips(TOWERS[c.ammo].needs, { tab: false }), arrow(), ...mk.chips);
      if (mk.cards.length) { const r = rrow('Supply needs', ...mk.cards.map((x) => cardChip(x))); r.classList.add('wrap', 'unlock'); more.append(r); }
      d.setAttribute('aria-label', `${c.name}. ${c.desc}`);
    } else {
      const about = CARD_ICONS[c.id];
      if (about) chips.append(...about.map((n) => rchip(n, '', { tab: false })));
      else if (c.needs) chips.append(rchip(`tw_${c.needs}`, '', { tab: false, label: TOWERS[c.needs].name }));
      d.setAttribute('aria-label', `${c.name}. ${c.desc}`);
    }
    // (the stack track: how many of this card the run holds and which rank this one would be, one pip per rank)
    const own = Math.min(c.max, sim.stacks[c.id] || 0);
    let stk: HTMLElement | null = null;
    if (c.max > 1 && c.max < 20) {
      stk = el('div', 'pips');
      stk.title = own ? `Rank ${own + 1} of ${c.max} (you hold ${own})` : `Rank 1 of ${c.max}`;
      for (let k = 0; k < c.max; k++) stk.append(el('i', k < own ? 'on' : k === own ? 'nx' : ''));
    }
    const head = el('div', 'ckick');
    head.append(el('span', 'rar', RARITY[c.rar]), el('span', 'kind', kindWord));
    const name = el('h4', '', bt ? TOWERS[bt].name : c.name);
    const body = el('div', 'cb');
    body.append(head, name, el('p', 'cl', firstLine(desc)), chips);
    if (stk) body.append(stk);
    const v = cardVisual(c, bt);
    v.append(el('kbd', '', String(i + 1)));
    d.append(v, body);
    // the info side: every word and row of the card (the i button, or a mouse resting on the card)
    const fh = el('b', '', c.name);
    full.append(fh, more);
    full.setAttribute('aria-hidden', 'true');
    info.append(el('span', '', 'i'));
    info.setAttribute('aria-label', `More about ${c.name}`);
    info.setAttribute('aria-expanded', 'false');
    info.addEventListener('click', (e) => {
      e.stopPropagation(); sound.init(); sound.play('click');
      const on = !w.classList.contains('full');
      for (const o of row.querySelectorAll('.cw.full')) if (o !== w) { o.classList.remove('full'); o.querySelector('.cinfo')?.setAttribute('aria-expanded', 'false'); o.querySelector('.cfull')?.setAttribute('aria-hidden', 'true'); }
      w.classList.toggle('full', on); info.setAttribute('aria-expanded', String(on)); full.setAttribute('aria-hidden', String(!on));
    });
    w.append(d, info, full);
    d.addEventListener('click', () => pickCard(i));
    d.addEventListener('mouseenter', () => sound.play('hover'));
    row.appendChild(w);
  });
  cardAt = performance.now(); cardFree = false; cardArmed = false;
  setPaths(false);
  $('cards').classList.remove('armed');
  guardAnim?.cancel();
  guardAnim = ($('card-guard').firstElementChild as HTMLElement).animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: CARD_GUARD_MS, easing: 'linear', fill: 'forwards' });
  show('cards');
}
function pickCard(i: number) {
  const p = sim.players[me];
  if (!cardArmed || !cardKey || cardKey.startsWith('sent:') || !p.pending.length || i >= p.pending[0].length || shown('paths')) return;
  cardKey = 'sent:' + cardKey;
  show('cards', false);
  act.card(i);
  sound.play('card');
}

// ---------- card paths: what needs what ----------
// The production cards and the two ammunition cards as a small tree, left to right: a card stands to the right of the cards
// it requires, a line joins them. Each plate is toned by where the run stands (held / can be offered now / waiting), and the
// towers underneath say which cards their supply still waits for. Shown on the level-up screen (the Paths button, key 4)
// and in How to play, so the next few picks can be planned. Built from the card table: nothing here is written by hand.
const PATH_IDS = [...PROD_CARDS.map((c) => c.id), ...Object.values(AMMO2_CARD).filter((id): id is string => !!id && Object.hasOwn(CARD_BY_ID, id))];
function pathDepth(id: string, seen = 0): number {
  const c = CARD_BY_ID[id];
  return !c || seen > 8 ? 0 : (c.requires || []).reduce((m, r) => Math.max(m, pathDepth(r, seen + 1) + 1), 0);
}
/** Fill a box with the card tree. `live`: tone the plates by the run in progress (off in the menu, where no run is on). */
function buildPaths(box: HTMLElement, live: boolean) {
  box.textContent = '';
  const NW = 168, NH = 48, GX = 46, GY = 10;
  const cols: string[][] = [];
  for (const id of PATH_IDS) { const d = pathDepth(id); (cols[d] ||= []).push(id); }
  // a card sits near the row of the cards it requires, so the lines cross as little as they can
  const row = new Map<string, number>();
  cols.forEach((col, d) => {
    if (d) col.sort((a, b) => avg(a) - avg(b));
    col.forEach((id, i) => row.set(id, i));
  });
  function avg(id: string) { const r = CARD_BY_ID[id].requires || []; return r.reduce((n, q) => n + (row.get(q) ?? 0), 0) / Math.max(1, r.length); }
  const rows = Math.max(...cols.map((c) => c.length)), W = cols.length * NW + (cols.length - 1) * GX, H = rows * NH + (rows - 1) * GY;
  const tree = el('div', 'ptree');
  tree.style.width = W + 'px'; tree.style.height = H + 'px';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H)); svg.setAttribute('aria-hidden', 'true');
  tree.append(svg);
  const at = (id: string): [number, number] => { const d = pathDepth(id), col = cols[d], i = row.get(id) || 0; return [d * (NW + GX), i * (NH + GY) + (H - (col.length * NH + (col.length - 1) * GY)) / 2]; };
  const st = (id: string): CardState => (live ? cardState(CARD_BY_ID[id]) : 'open');
  for (const id of PATH_IDS) {
    const c = CARD_BY_ID[id], [x, y] = at(id), s = st(id), n = el('div', 'pnode ' + (live ? s : 'plain'));
    n.style.transform = `translate(${x}px, ${y}px)`;
    const ics = el('span', 'pi');
    for (const k of cardIcons(c).slice(0, c.ammo ? 1 : 2)) ics.append(ic(k, { size: 18 }));
    const cond = [c.minLevel ? `lvl ${c.minLevel}+` : '', c.guaranteeBy ? (c.guaranteeBy <= 2 ? 'offered first' : `by ${c.guaranteeBy} for sure`) : '', c.ammo ? 'Mk3 switch' : ''].filter(Boolean).join(' · ');
    n.append(ics, el('b', '', c.name), el('small', '', live && s === 'have' ? 'you have it' : live && s === 'open' ? 'can be offered now' : cond || (live ? 'waiting' : '')));
    const waits = live ? cardWaits(c) : [];
    n.title = c.desc + (waits.length ? ` Needs ${andList(waits)}.` : '');
    n.setAttribute('role', 'img');
    n.setAttribute('aria-label', `${c.name}${(c.requires || []).length ? ', after ' + andList((c.requires || []).map((r) => CARD_BY_ID[r].name)) : ''}${live ? ': ' + (s === 'locked' && waits.length ? 'needs ' + andList(waits) : CARD_STATE_WORD[s]) : ''}`);
    if (c.unlocks) n.dataset.rt = 'fac:' + c.unlocks[0];
    tree.append(n);
    for (const r of c.requires || []) {
      if (!PATH_IDS.includes(r)) continue;
      const [px, py] = at(r), x0 = px + NW, y0 = py + NH / 2, x1 = x, y1 = y + NH / 2, mx = (x0 + x1) / 2;
      const ln = document.createElementNS(SVG_NS, 'path');
      ln.setAttribute('d', `M${x0} ${y0}C${mx} ${y0} ${mx} ${y1} ${x1 - 5} ${y1}`);
      ln.setAttribute('class', 'pl ' + (live ? (st(r) === 'have' ? (s === 'have' ? 'have' : 'open') : 'locked') : 'plain'));
      svg.append(ln);
    }
  }
  const scroll = el('div', 'pscroll');
  scroll.append(tree);
  box.append(scroll);
  if (live) {
    const lg = el('div', 'plegend');
    lg.append(el('span', 'cchip have', 'you have it'), el('span', 'cchip open', 'can be offered now'), el('span', 'cchip locked', 'needs the card to its left, or a level'));
    box.append(lg);
  }
  // the towers: in blueprint order, what each runs on and the cards its supply waits for
  const tw = el('div', 'ptowers');
  for (const t of [...TOWER_TYPES].sort((a, b) => TOWER_TIER[a] - TOWER_TIER[b])) {
    const have = live && sim.unlocked.has(t), r = el('div', 'ptw' + (have ? ' have' : '')), nm = el('b');
    nm.append(ic(`tw_${t}`, { size: 18 }), TOWERS[t].name);
    const wait = live ? sim.supplyCards(t) : PROD_CARDS.filter((c) => (c.unlocks || []).some((f) => TOWER_CHAIN[t].includes(f))).map((c) => c.id);
    const cs = el('span', 'pc');
    if (wait.length) cs.append(...wait.map((w) => cardChip(w, live ? {} : { state: 'open' })));
    else cs.append(el('span', 'cchip have', 'supply can be built'));
    r.append(nm, el('small', '', have ? 'unlocked' : TOWER_TIER[t] === 0 ? 'from the start' : `blueprint, round ${TOWER_TIER[t]}`), cs);
    r.dataset.rt = 'tower:' + t;
    tw.append(r);
  }
  box.append(el('h4', 'ph', live ? 'Your towers and the cards their supply still needs' : 'What each tower\'s supply needs'), tw);
}
/** The Paths view of the level-up screen: it takes the place of the three cards until it is shut again. */
function setPaths(on: boolean) {
  const b = $<HTMLButtonElement>('cards-paths');
  if (shown('paths') === on && cache.pathsBtn === String(on)) return;
  cache.pathsBtn = String(on);
  if (on) buildPaths($('paths'), true);
  show('paths', on); show('card-row', !on);
  b.setAttribute('aria-expanded', String(on));
  b.textContent = '';
  b.append(el('span', '', on ? 'Back to the cards' : 'Paths: what unlocks what'), el('kbd', '', '4'));
}
$('cards-paths').addEventListener('click', () => { sound.init(); sound.play('click'); setPaths(!shown('paths')); });

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
        if (t && !store.tips.dry && !guideOn()) { store.tips.dry = true; save(); tutor('A tower fires only what it is fed, and only a Transfer Arm (or a crate beside it) feeds it. Click it to see what is missing.'); }
        break;
      }
      case 'fed': playAt('up', e); break;
      // a Transfer Arm picked an item up (or a crate handed one to the tower beside it): a soft tick, only close to the camera (the sound table rate-limits it)
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
        if (d?.special && e.p === me && !bot) toast(`${d.special.name}!`);
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
        if (!bot && !store.tips.boss) { store.tips.boss = true; save(); tutor(touchUi() ? 'Save your tower specials for the Colossus: hold or double-tap a charged tower.' : 'Save your tower specials for the Colossus: right-click a charged tower.'); }
        break;
      case 'clear': {
        sound.play('clear');
        const last = sim.campaign && e.n >= sim.winWave;
        // (the wave button says what comes next: call it, or the countdown)
        toast(`Wave ${e.n} cleared · +${e.g} credits`);
        break;
      }
      case 'levelup': sound.play('levelup'); break;
      case 'card': {
        if (typeof e.id !== 'string' || !Object.hasOwn(CARD_BY_ID, e.id)) break;
        if (e.p !== me) { toast('Partner took ' + CARD_BY_ID[e.id].name); break; }
        if (bot) break;
        // a blueprint: say what the new tower runs on, and which production cards its supply still waits for
        const c = CARD_BY_ID[e.id], t = e.id.startsWith('bp_') ? (e.id.slice(3) as TowerType) : null;
        if (t && Object.hasOwn(TOWERS, t)) {
          const wait = sim.supplyCards(t);
          tutor(`${TOWERS[t].name}: ${TOWER_SUPPLY[t]}`);
          toast(wait.length ? `Unlocked: ${TOWERS[t].name} · its supply needs ${andList(wait.map((w) => CARD_BY_ID[w].name))}` : `Unlocked: ${TOWERS[t].name}`);
        } else if (c.unlocks) {
          // a production card: the buildings are on the Factory bar now, and the towers that were waiting for them
          const serves = [...sim.unlocked].filter((u) => TOWER_CHAIN[u].some((f) => c.unlocks!.includes(f)));
          toast(`Unlocked: ${andList(c.unlocks.map((f) => FACS[f].name))}${serves.length ? ` · for ${andList(serves.map((u) => TOWERS[u].name))}` : ''}`);
          if (c.id === 'belts' && !guideOn()) tutor('Belts only carry. Put items on a belt with a Transfer Arm and take them off with another.');
        } else if (c.ammo) toast(`${TOWERS[c.ammo].name} Mk3: the ammunition switch is in each tower's panel now.`);
        break;
      }
      // a tower was switched to its other ammunition: what it held is gone, it waits for the new kind
      case 'ammo': {
        const tw = sim.towerById(int(e.id));
        playAt('build', e);
        if (tw && !bot) toast(`${TOWERS[tw.type].name} now runs on ${needsText(needsOf(tw))}. It dropped what it held.`);
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
  told.arm = false; told.tap = false;
  for (const id of ['cards', 'menu', 'lobby', 'help', 'settings', 'music', 'pause', 'end', 'rp-banner', 'tower', 'fpanel', 'opanel', 'oretip', 'vs', 'tip', 'setup', 'editor', 'tutor', 'guide']) show(id, false);
  guide.on = false;
  clearTimeout(endTimer); clearTimeout(tutorTimer);
  for (const id of ['prep', 'p-editor', 'e-editor']) show(id, false);
  $('toasts').textContent = ''; $('notes').textContent = ''; toastQ.length = 0; // (nothing of the last run is said in the next)
  recUi?.clearPopups(); show('end-badges', false); show('cont', false);
  lastRx = performance.now(); squadTokens = 3;
  buildType = null; buildFac = null; selected = 0; selFac = 0; painting = false; facDir = 0; dragging = false; rotating = false; paused = false; speed = 1; acc = 0; cardKey = ''; ended = false;
  runKey = ''; runWon = false; tipHover = null; editorRun = false; selOre = null; overBoard = false; oreLit = '';
  if (cue.k) facBtns[cue.k].classList.remove('cue');
  cue.k = '';
  setTab('towers'); view.setFacGhost(null);
  // what these keys stood for was just hidden or reset behind the cache's back
  for (const k of ['prep', 'lack', 'wavemax', 'wavecls', 'tdock', 'fdock', 'odock', 'otip', 'opanel', 'tip', 'titan', 'titancls', 'farm', 'tnext', 'tsup', 'fmake']) delete cache[k];
  btnState.clear();
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
  leaveRun();
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
  refreshContinue();
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
/** `restore`: a saved run (career.continueRun) to go on with instead of a new Sim; it is already tracked. */
function startGame(m: Mode, opts: { client?: boolean; seed?: number; demo?: boolean; map?: MapDef; diff?: string; survival?: boolean; editor?: boolean; restore?: Sim } = {}) {
  if (!opts.restore) leaveRun();
  resetUi();
  editorRun = !!opts.editor && m === 'solo';
  mode = m; isClient = !!opts.client; me = isClient ? 1 : 0;
  aimPref = opts.demo ? {} : { ...store.aim };
  sim = opts.restore ?? new Sim({
    mode: m, players: m === 'coop' ? 2 : 1, pauseOnCards: m === 'solo' && !opts.demo, seed: opts.seed ?? ((Math.random() * 2 ** 31) | 0),
    map: opts.map ?? choice.map, diff: opts.diff ?? choice.diff, survival: m === 'versus' ? false : opts.survival ?? choice.survival,
    // the scripted demo is played by the bot, which builds no factory
    free: !!opts.demo,
  });
  // the player calls the waves: the first one always, the later ones unless Auto waves is switched on
  if (!opts.demo) { sim.holdFirst = true; sim.autoWaves = m !== 'solo' || settings.auto; }
  // a continued run gets a full build-phase countdown before an automatic wave
  if (opts.restore && sim.autoWaves) sim.nextWaveIn = Math.max(sim.nextWaveIn, NEXT_WAVE_IN);
  sim.replica = isClient;
  bot = opts.demo ? new Bot(sim, 0, 1.5) : null;
  runAchs = [];
  // a fresh run is tracked from here (career.ts leaves out the demo, co-op, versus and the editor's test plays)
  if (!opts.restore && career) {
    const def = opts.map ?? choice.map;
    career.startRun(sim, { map: mapKeyOf(def), mapName: def.name, tier: def.tier || 0, ctx: { bot: !!bot, attract: editorRun } });
  }
  saveSig = sigOf(sim);
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
    if (opts.restore) announce('Run resumed', `${sim.map.def.name} / wave ${sim.wave + 1} next`);
    else announce('Defend the Heart', m === 'coop' ? 'Co-op link is up' : m === 'versus' ? 'Outlast your rival'
      : `${sim.map.def.name} / ${sim.endless ? 'Survival' : `${sim.diff.name}, ${sim.winWave} waves`}`);
    if (opts.restore) { /* (a continued run never restarts the tutorial) */ }
    else if (m === 'solo' && !editorRun && !store.tips.tutorial) startGuide();
    else setTimeout(() => {
      if (sim.wave === 0 && mode === m && !ended) toast('Towers start empty: build one beside a supply crate.');
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
const LOGISTICS: ReadonlySet<FacType> = new Set<FacType>(['arm', 'belt', 'splitter', 'tunnel', 'pipe', 'ptunnel', 'pole']);
function endGame(win: boolean, title?: string, sub?: string) {
  if (ended) return;
  ended = true;
  show('cards', false); show('tutor', false); show('prep', false);
  sound.play(win ? 'win' : 'lose'); sound.intense = 0;
  const saved = recordRun(win);
  careerEnd(win);
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
      case 'build': { const ty = TOWER_TYPES[int(m.ty)], cx = int(m.cx), cz = int(m.cz); if (ty && cx >= 0 && cz >= 0 && cx < GW && cz < GH) { const t = sim.build(ty, cx, cz), md = TARGET_MODES[int(m.m)]; if (t && md) sim.setAim(t.id, md); } break; } // (m: the guest's mode for its kind, -1 none)
      case 'up': if (int(m.id) > 0) sim.upgrade(int(m.id)); break;
      case 'sell': if (int(m.id) > 0) sim.sell(int(m.id)); break;
      case 'card': { const i = int(m.i); if (i >= 0 && i < 3) sim.pickCard(1, i); break; }
      case 'spec': if (int(m.id) > 0) sim.triggerSpecial(int(m.id), 1); break;
      case 'wave': sim.startWave(); break;
      case 'aim': { const md = TARGET_MODES[int(m.m)]; if (int(m.id) > 0 && md) sim.setAim(int(m.id), md); break; }
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
  markSaves();
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
  if (career && target === 'solo') { const c = career; void c.saves.list().then((l) => { saveIdx = new Map(l.map((m) => [m.key, m])); markSaves(); }); }
  else saveIdx = new Map();
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

// ---------- saves, the run archive and achievements (career.ts holds them; records-ui.ts draws the screens) ----------
// Only solo runs count (career.ts leaves out the demo, co-op, versus and the editor's test plays). A run saves itself between
// waves (when one is cleared, right before the next starts, and while things get built in the build phase), never during
// one. Leaving to the menu or reloading keeps the save; the menu then offers Continue. A win or a loss archives the run.
const careerP: Promise<Career> = Career.open().catch(() => Career.open(memoryPlatform()));
let recUi: ReturnType<typeof initRecordsUi> | null = null;
/** achievements unlocked during the run going on (the end screen shows them) */
let runAchs: AchDef[] = [];
/** the save key the menu's Continue resumes ('' when there is no save) */
let contKey = '';
/** what the last save held, roughly: the build phase saves again when it changes */
let saveSig = '', saveCheck = 0;
const sigOf = (s: Sim) => `${s.wave}|${Math.floor(s.gold)}|${Math.floor(s.mats)}|${s.towers.length}|${s.towers.reduce((a, t) => a + t.id * 3 + t.lvl, 0)}|${s.factory.facs.reduce((a, f) => a + f.id * 7 + f.dir, 0)}|${s.level}`;
/** The map a record or save key names: pre-made, generated ('gen-<tier>-<seed>') or one of the player's own. */
function mapOfKey(k: string): MapDef | null {
  const m = MAPS.find((d) => d.id === k);
  if (m) return m;
  const g = /^gen-([1-3])-(\d{1,9})$/.exec(k);
  if (g) { try { return generateMap(+g[2], +g[1]); } catch { return null; } }
  if (!k.startsWith('custom:')) return null;
  return loadCustomMaps().find((d) => mapKeyOf(d) === k) || null;
}
async function initCareer() {
  try { career = await careerP; } catch { career = null; return; }
  const c = career;
  // every save goes through here: the HUD shows a small tick when one is written
  const put = c.saves.put.bind(c.saves);
  c.saves.put = (s, o) => {
    const p = put(s, o);
    if (s === sim) saveSig = sigOf(s);
    void p.then((m) => { if (m && s === sim && mode === 'solo' && !ended) recUi?.savedTick(); });
    return p;
  };
  recUi = initRecordsUi({
    career: c, mapOf: mapOfKey,
    cardIcons: (id) => (Object.hasOwn(CARD_BY_ID, id) ? cardIcons(CARD_BY_ID[id]) : []),
    sound: (name, g) => sound.play(name, g),
  });
  c.onUnlock((a) => {
    if (mode === 'attract') return;
    if (!runAchs.includes(a)) runAchs.push(a);
    if (!ended) recUi?.popup(a);
  });
}
/** After the run's steps each frame: feed the run's counters, and save the build phase again when something was built. */
function careerFrame(evs: Ev[]) {
  if (!career?.run) return;
  career.frame(sim, evs);
  const now = performance.now();
  if (ended || paused || now - saveCheck < 2500) return;
  saveCheck = now;
  if (sim.planning && !sim.waveActive && sigOf(sim) !== saveSig) void career.save(sim);
}
/** Stop tracking the run going on without ending it (back to the menu, a new run): its save stays for Continue. */
function leaveRun() {
  const c = career;
  if (!c?.run) return;
  if (!ended) void c.save(sim);
  c.run = null; c.key = '';
}
/** The run has ended (endGame): archive it, then put what it set and earned on the end screen. */
function careerEnd(win: boolean) {
  recUi?.clearPopups();
  show('end-badges', false);
  const c = career, t = c?.run;
  if (!c || !t) { if (runAchs.length) recUi?.endBadges($('end-badges'), { rec: null, achs: runAchs }); return; }
  const b = c.records.best(t.stats.map, t.stats.diff, t.stats.mode), prev: MapBest | undefined = b ? { ...b } : undefined;
  void c.endRun(sim, win ? 'win' : 'loss').then((rec) => { if (ended) recUi?.endBadges($('end-badges'), { rec, prev, achs: runAchs }); });
}
/** The menu's Continue: the newest save, if there is one. */
function refreshContinue() {
  const c = career;
  if (!c || !recUi) return;
  void c.saves.flush().then(() => c.saves.last()).then((m) => {
    if (c.saves.dropped.length) { note(c.saves.dropped.join(' ')); c.saves.dropped.length = 0; }
    contKey = m && mode === 'attract' ? m.key : '';
    recUi?.fillContinue($('m-continue'), contKey ? m : null);
  });
}
/** Saves by key, for the marks on the setup screen's map cards (filled when the setup opens). */
let saveIdx = new Map<string, SaveMeta>();
function markSaves() {
  for (const c of mapCards) {
    c.btn.querySelector('.savemark')?.remove();
    const m = career && saveIdx.get(career.keyFor(mapKeyOf(c.def), choice.diff, choice.survival));
    if (m && recUi) c.btn.append(recUi.saveMark(m));
  }
}
/**
 * Start a solo run on a map, difficulty and mode, unless it has a save: then ask first (continue it, or start over, which
 * archives the old run as given up). `from` is the sheet the question opens over; `fresh` starts the new run.
 */
function launchSolo(o: { map: MapDef; diff: string; survival: boolean }, from: string, fresh: () => void) {
  const c = career;
  if (!c || !recUi) { fresh(); return; }
  const key = c.keyFor(mapKeyOf(o.map), o.diff, o.survival), ui = recUi;
  void c.saves.flush().then(() => c.saves.get(key)).then((m) => {
    if (!m || mode !== 'attract') { fresh(); return; }
    ui.askContinue(m, {
      resume: () => { show(from, false); void resumeSave(key); },
      fresh: () => { void c.startOver(key).then(() => { show(from, false); fresh(); }); },
      back: () => show(from),
    });
  });
}
/** Go on with a saved run. */
async function resumeSave(key: string) {
  const c = career;
  if (!c) return;
  leaveRun();
  const r = await c.continueRun(key);
  if ('error' in r) { note(`That save could not be loaded: ${r.error}.`); refreshContinue(); return; }
  for (const id of ['menu', 'setup', 'cont', 'records', 'achs']) show(id, false);
  const def = mapOfKey(r.meta.map) ?? r.sim.map.def;
  // Play again after it plays the same map
  choice.map = def; choice.diff = diffById(r.meta.diff).id; choice.survival = r.meta.mode === 'survival';
  startGame('solo', { restore: r.sim, map: def, diff: choice.diff, survival: choice.survival });
}
document.addEventListener('visibilitychange', () => { if (document.hidden && career?.run && !ended && mode === 'solo') void career.save(sim); });

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
click('m-tutorial', () => launchSolo({ map: MAPS[0], diff: 'easy', survival: false }, 'menu', () => { store.tips.tutorial = false; save(); show('menu', false); startGame('solo', { map: MAPS[0], diff: 'easy', survival: false }); }));
click('m-records', () => { if (!recUi) return; show('menu', false); recUi.openRecords(() => show('menu')); });
click('m-achs', () => { if (!recUi) return; show('menu', false); recUi.openAchievements(() => show('menu')); });
click('m-continue', () => { if (contKey) void resumeSave(contKey); });
click('m-editor', () => openEditorScreen());
click('l-change', () => openSetup('lobby'));
click('setup-back', () => { show('setup', false); show(setupFor === 'solo' ? 'menu' : 'lobby'); });
click('setup-editor', () => openEditorScreen());
click('setup-go', () => {
  saveSetup();
  if (setupFor === 'solo') launchSolo({ map: choice.map, diff: choice.diff, survival: choice.survival }, 'setup', () => { show('setup', false); startGame('solo'); });
  else { show('setup', false); show('lobby'); lobbyChoice(); }
});
click('m-coop', () => openLobby('coop'));
click('m-versus', () => openLobby('versus'));
click('m-help', () => { helpFrom = 'menu'; show('menu', false); buildHelp(); show('help'); });
click('m-settings', () => { setFrom = 'menu'; show('menu', false); openSettings(); });
click('m-music', () => openMusic('menu'));
click('h-back', () => { show('help', false); show(helpFrom); });
click('s-back', () => { show('settings', false); show(setFrom); save(); });
click('mu-back', () => { show('music', false); show(musicFrom); });
click('p-resume', () => togglePause(false));
click('p-help', () => { helpFrom = 'pause'; show('pause', false); buildHelp(); show('help'); });
click('p-settings', () => { setFrom = 'pause'; show('pause', false); openSettings(); });
click('p-music', () => openMusic('pause'));
click('p-quit', () => { sound.stopMusic(); startAttract(); });
click('p-report', () => reportFrom('pause'));
click('m-report', () => reportFrom('menu'));
click('h-report', () => reportFrom('help'));
click('p-load', () => loadFrom('pause'));
click('m-load', () => loadFrom('menu'));
// A test play goes straight back to the editor. The draft is still there: the editor keeps it between visits.
/** The How to play sheet's tables: the six targeting modes, what each tower runs on, and how each resource is made. Built from the game's tables each time the sheet opens (the diagrams follow the window's width). */
function buildHelp() {
  void import('./help.ts').then((m) => m.buildGuide()); // the guide's pictures (help.ts, loaded on first open)
  const aim = $('help-aim'); aim.textContent = '';
  buildPaths($('help-paths'), mode !== 'attract');
  for (const m of TARGET_MODES) { const r = el('div', 'ha'); r.append(ic(`aim_${m}`, { size: 20 }), el('b', '', TARGET_INFO[m].name), el('span', '', TARGET_INFO[m].desc)); aim.append(r); }
  const tw = $('help-towers'); tw.textContent = '';
  for (const t of TOWER_TYPES) {
    const d = TOWERS[t], l3 = TOWER_NEEDS_L3[t], r = el('div', 'ht'), nm = el('b');
    nm.append(ic(`tw_${t}`, { size: 20 }), d.name);
    const needs = el('span', 'hn');
    needs.append(...needChips(d.needs));
    if (d.mat) needs.append(rgrp('costs', rchip('mats', d.mat)));
    if (l3 && AMMO2_CARD[t]) needs.append(rgrp('or, Mk3 with a card', ...needChips(l3)));
    r.dataset.rt = 'tower:' + t; r.tabIndex = 0; r.setAttribute('aria-describedby', 'rtip');
    r.append(nm, needs);
    tw.append(r);
  }
  const rc = $('help-recipes'); rc.textContent = '';
  const narrow = innerWidth < 720, list: ChainTarget[] = [{ item: 'iron' }, { item: 'copper' }, { res: 'power' }, { res: 'mats' }, { item: 'shell' }, { item: 'cell' }, { fluid: 'petrol' }, { item: 'missile' }];
  for (const tg of list) {
    const name = (tg.item ?? tg.fluid ?? tg.res) as IconName, fig = el('figure', 'hr'), cap = el('figcaption');
    cap.append(ic(name, { size: 20 }), iconLabel(name));
    const dia = recipeDiagram(tg, { width: narrow ? Math.min(360, innerWidth - 80) : 520, layout: narrow ? 'auto' : 'row', bare: name !== 'power' });
    let w = 0;
    for (const sv of dia.querySelectorAll('svg.ic-d-svg')) w = Math.max(w, +(sv.getAttribute('width') || 0));
    if (w > 330 && !narrow) fig.classList.add('wide');
    fig.append(cap, dia);
    rc.append(fig);
  }
  // the buildings the diagrams show over their arrows, by name
  const leg = el('figure', 'hr legend'), lc = el('figcaption', '', 'Buildings in these chains'), lr = el('div', 'rr');
  for (const f of ['arm', 'mine', 'pump', 'generator', 'smelter', 'works', 'press', 'cells', 'refinery', 'missiles'] as FacType[]) lr.append(rchip(`fac_${f}`, FACS[f].name));
  leg.append(lc, lr);
  rc.append(leg);
}
const backToEditor = () => { sound.stopMusic(); startAttract(); openEditorScreen(); };
click('p-editor', backToEditor);
click('e-editor', backToEditor);
click('e-again', () => { if (mode === 'solo') startGame('solo', { editor: editorRun }); else { const m = mode === 'versus' ? 'versus' : 'coop'; sound.stopMusic(); startAttract(); openLobby(m); } });
click('e-menu', () => { sound.stopMusic(); startAttract(); });
click('e-endless', () => { runAchs = []; sim.over = false; sim.won = false; sim.endless = true; sim.nextWaveIn = 5; ended = false; show('end', false); toast('No last wave from here on. How far can you go?'); });
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
// On a phone the tower, building and deposit panels are bottom sheets that open small (what it is, its numbers, why it
// lacks something, Upgrade and Sell). The grip on top grows them to everything (targeting, the special in full, the Mk3
// option) and back: a tap, or a drag up or down. Dragged well down from small, the sheet closes. The size is kept.
let sheetBig = false;
function setSheetBig(on: boolean) {
  sheetBig = on;
  for (const id of ['tower', 'fpanel', 'opanel']) {
    const p = $(id), g = p.querySelector('.grip');
    p.classList.toggle('big', on);
    g?.setAttribute('aria-expanded', String(on)); g?.setAttribute('aria-label', on ? 'Show less' : 'Show more');
  }
}
for (const id of ['tower', 'fpanel', 'opanel']) {
  const g = $(id).querySelector('.grip') as HTMLElement | null;
  if (!g) continue;
  const drag = { id: -1, y: 0, moved: false };
  g.addEventListener('pointerdown', (e) => { drag.id = e.pointerId; drag.y = e.clientY; drag.moved = false; try { g.setPointerCapture(e.pointerId); } catch { /* gone */ } e.preventDefault(); });
  g.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) < 24) return;
    drag.moved = true; drag.id = -1;
    sound.init(); sound.play('click');
    if (dy < 0) setSheetBig(true);
    else if (sheetBig) setSheetBig(false);
    else { selected = 0; selFac = 0; selOre = null; }
  });
  g.addEventListener('pointerup', (e) => { if (e.pointerId !== drag.id) return; drag.id = -1; if (!drag.moved) { sound.init(); sound.play('click'); setSheetBig(!sheetBig); } });
  g.addEventListener('pointercancel', () => { drag.id = -1; });
  // (the keyboard: Enter or Space on the grip)
  g.addEventListener('click', (e) => { if (e.detail === 0) setSheetBig(!sheetBig); });
}
click('t-up', () => { if (selected) act.upgrade(selected); });
click('t-sell', () => { if (selected && act.sell(selected)) selected = 0; });
$('t-special').addEventListener('click', () => { sound.init(); if (selected) act.special(selected); });
click('f-sell', () => { if (selFac && act.sellFac(selFac)) selFac = 0; });
click('f-turn', () => turnSelected());
click('f-flip', () => { const f = selFac ? sim.factory.facById(selFac) : undefined; if (f && f.type === 'arm') act.turnFac(f.id, f.dir + 3); });
click('f-up', () => { if (selFac) act.upFac(selFac); });
// the deposit panel's apricot line looks like a button: it picks the building it names (a locked one stays a note)
$('o-pick').addEventListener('click', () => { sound.init(); const o = selOre && freeOre(selOre.cx, selOre.cz); if (o && !oreBuildLine(o).locked) { if (barTab !== 'factory') setTab('factory'); pickFac(oreFac(o)); } });
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
// ---------- bug reports (report.ts) ----------
/** Sheets a report or a load can be opened over: hidden while the form is up, shown again after. */
const REPORT_FROM = ['menu', 'pause', 'help', 'settings', 'music', 'setup', 'lobby', 'end'];
const DEBUG = import.meta.env.DEV || params.get('debug') === '1';
let repFrom = '', repPaused = false;
function holdFor(from: string) {
  repFrom = from; repPaused = paused;
  if (from) show(from, false);
  if (playing() && mode === 'solo') paused = true; // the form pauses a solo run (a co-op host keeps going)
  rotating = false; dragging = false; painting = false;
}
function reportFrom(from: string) { if (reportOpen() || loadOpen()) return; sound.init(); holdFor(from); openReport(); }
function loadFrom(from: string) { if (!DEBUG || reportOpen() || loadOpen()) return; holdFor(from); openLoad(); }
function gpuName(): string {
  try {
    const gl = view.renderer.getContext();
    // (Firefox gives the real renderer as RENDERER and warns about the debug extension)
    const ext = /Firefox/.test(navigator.userAgent) ? null : gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch { return ''; }
}
/** A report's state continues as a solo run here, paused, with nothing recorded. */
function loadRun(s: Sim, note: string) {
  leaveRun();
  resetUi();
  runAchs = []; // (a loaded report is not tracked: the end screen must not show the last run's medals)
  net?.close(); net = null; isClient = false; me = 0; bot = null;
  mode = 'solo';
  aimPref = { ...store.aim };
  sim = s; sim.replica = false;
  view.setSim(sim, 0); view.orbit = false;
  frameBoard();
  show('hud'); show('vs', false); show('btn-speed', true); show('btn-pause', true);
  rival = { l: 20, w: 0, k: 0 };
  sound.init();
  repFrom = ''; repPaused = true;
  togglePause(true);
  showBanner(note);
}
initReport({
  sim: () => (mode === 'attract' ? null : sim),
  context: () => {
    const fx = (['impact', 'beat', 'borders', 'env', 'towers'] as const).filter((k) => store.fx[k]).join(', ') || 'none';
    return {
      run: mode === 'attract' ? 'none (main menu)' : `${mode}${sim.opts.free ? ' (free towers)' : ''}, map ${sim.map.def.name} (${sim.map.def.id}), ${sim.endless ? 'Survival' : sim.diff.name}, wave ${sim.wave}${sim.campaign ? ' of ' + sim.winWave : ''}, ${clock(sim.time)} in, ${sim.over ? 'over' : sim.planning ? 'build phase' : 'wave on'}, ${sim.towers.length} towers, ${sim.factory.facs.length} buildings, ${sim.enemies.length} enemies`,
      quality: `${settings.q}; effects ${fx} at ${store.fx.intensity}; speed ${speed}x`,
      gpu: gpuName(), touch: touchUi(),
    };
  },
  canvas, render: () => view.render(0),
  closed: () => { paused = repPaused; if (repFrom) show(repFrom); repFrom = ''; },
  load: loadRun,
}, DEBUG);
if (DEBUG) (window as unknown as Record<string, unknown>).__report = reportHooks;
/** Escape on a sheet that has a way back: take it. Returns false when no such sheet is open. */
function escBack(): boolean {
  // (the dialog over the setup first: it is the sheet on top)
  const open = ([['cont', 'cont-back'], ['achs', 'ach-back'], ['records', 'rec-back'], ['help', 'h-back'], ['settings', 's-back'], ['music', 'mu-back'], ['setup', 'setup-back'], ['lobby', 'l-back']] as const).find(([id]) => shown(id));
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
const RESET_IDLE = 'Records, saved runs, achievements, last run setup, targeting defaults and tips are saved in this browser.';
function resetStep(asking: boolean, text = RESET_IDLE) {
  show('s-reset', !asking); show('s-reset-yes', asking); show('s-reset-no', asking);
  $('reset-text').textContent = text;
}
click('s-reset', () => resetStep(true, 'Delete all records, saved runs, the run archive, achievements, the last run setup, the targeting defaults and the tips? Sound and effects settings stay.'));
click('s-reset-no', () => resetStep(false));
click('s-reset-yes', () => {
  store.records = {}; store.tips = { node: false, boss: false, mite: false, titan: false, factory: false, dry: false, tutorial: false }; store.setup = defaultSetup(); store.aim = {};
  save();
  // a run in progress keeps its own choice; the defaults are loaded when it goes back to the menu
  if (mode === 'attract') loadSetup(); else setupStale = true;
  setText('best', bestLine());
  if (career) {
    const c = career;
    // (the run going on, if any, keeps going untracked)
    c.run = null; c.key = '';
    void Promise.all([c.saves.clearAll(), c.records.clear(), c.achievements.reset()]).then(() => refreshContinue());
  }
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
/** a press of the right button: where it went down, whether it has become a drag, and the tower it went down on (0 none) */
const rclick = { on: false, x: 0, y: 0, moved: false, tower: 0 };
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
  // a Transfer Arm about to be placed turns by itself to where it would do something: from a source behind it to a taker in front
  else if (moved && buildFac === 'arm' && inBoard(cx, cz)) facDir = armAim(cx, cz, facDir);
  refreshGhost();
}
/**
 * What stands on a tile, seen from an arm beside it (`d`: the direction from the arm to that tile): something an arm can
 * take from (bit 1), something it can deliver to (bit 2). A rough reading of the rules, only to aim the ghost.
 */
function armEnd(cx: number, cz: number, d: number): number {
  if (!inBoard(cx, cz)) return 0;
  if (sim.towers.some((t) => t.cx === cx && t.cz === cz)) return 2;
  const q = sim.factory.facAt(cx, cz);
  if (!q) return 0;
  switch (q.type) {
    case 'mine': case 'crate': return 1;
    case 'smelter': case 'press': case 'cells': case 'missiles': case 'belt': case 'splitter': return 3;
    case 'works': case 'generator': return 2;
    case 'tunnel': return q.pair ? (q.exit ? 1 : 2) : 0;
    case 'arm': return q.dir === d ? 2 : q.dir === (d + 3) % 6 ? 1 : 0;
  }
  return 0;
}
/** How much an arm on a tile would do facing `d`: 2 with a source behind and a taker in front (a little more for a tower or a producer), 1 with one of them. */
function armScore(cx: number, cz: number, d: number): number {
  const [bx, bz] = neighbor(cx, cz, (d + 3) % 6), [fx, fz] = neighbor(cx, cz, d);
  const b = armEnd(bx, bz, (d + 3) % 6), f = armEnd(fx, fz, d);
  return (b & 1 ? 1 : 0) + (f & 2 ? 1 : 0) + (b === 1 ? 0.2 : 0) + (f === 2 ? 0.2 : 0);
}
/** The direction an arm on (cx, cz) should face: the one it has if that is as good as any, else the best one. */
function armAim(cx: number, cz: number, cur: number): number {
  let best = cur, bs = armScore(cx, cz, cur);
  for (let d = 0; d < 6; d++) { const v = armScore(cx, cz, d); if (v > bs + 1e-6) { bs = v; best = d; } }
  return best;
}
/**
 * The tower under a point of the screen: the one whose drawn body (from its foot to the node on its top) the point is
 * nearest to, else the one on the tile the point lies on. A tower is tall: a press on its upper half lands on the tile
 * behind it, so the body comes first (with two towers in a row away from the camera, the head of the front one is
 * the front one, not the one standing on the tile behind).
 */
function towerAtScreen(x: number, y: number, slack = 1): Tower | undefined {
  view.groundPoint(x, y, ga);
  const [cx, cz] = worldToCell(ga.x, ga.z), on = sim.towers.find((t) => t.cx === cx && t.cz === cz);
  let best: Tower | undefined, bd = Infinity;
  for (const t of sim.towers) {
    const [ax, ay, ok] = view.project(t.x, 0.2, t.z), [bx, by, ok2] = view.project(t.x, t.h + 0.55, t.z);
    if (!ok || !ok2) continue;
    const len = Math.hypot(bx - ax, by - ay), u = len > 0 ? clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len), 0, 1) : 0;
    const d = Math.hypot(x - (ax + (bx - ax) * u), y - (ay + (by - ay) * u));
    if (d < Math.max(9, len * 0.24) * slack && d < bd) { bd = d; best = t; }
  }
  return best || on;
}
/**
 * Fire a tower's special straight from the board (a right-click, a long press or a double tap on it), without selecting it.
 * A special that is not ready answers on the tower itself: its node fizzles (the view's cue for a special that cannot fire),
 * the error blip sounds, and a line says what it is waiting for.
 */
function quickSpecial(id: number) {
  const t = sim.towerById(id);
  if (!t) return;
  const d = TOWERS[t.type], sp = d.special;
  if (!sp) { sound.play('error'); note(`${d.name} has no special.`); return; }
  if (sim.specialReady(t)) { act.special(id); return; }
  sound.play('error');
  view.handle([{ k: 'nospec', id: t.id, x: t.x, y: t.h + 0.55, z: t.z }]);
  note(`${sp.name} is not ready: ${t.stun > 0 ? `the ${d.name} is stunned` : t.jam > 0 ? `mites jam the ${d.name}` : t.down > 0 ? `rebooting, ${Math.ceil(t.down)}s` : t.spec > 0 ? 'it is running' : t.dry || towerOff(t) ? `the ${d.name} is out of supply` : `charged ${Math.floor(clamp(t.charge, 0, 1) * 100)}%`}.`);
}
const inBoard = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < GW && cz < GH;
/** The tile under a point of the screen (it may lie off the board). */
function cellAtScreen(x: number, y: number): [number, number] { view.groundPoint(x, y, ga); return worldToCell(ga.x, ga.z); }
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
    // (a line of Transfer Arms is laid the same way: each points along the drag and hands on to the next. Dragging on
    // from an arm into a tower or building turns it to face that.)
    if ((buildFac === 'belt' || buildFac === 'arm') && d >= 0) {
      facDir = d;
      if (prev && prev.type === buildFac) act.turnFac(prev.id, d);
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
  let t = sim.towers.find((x) => x.cx === hover.cx && x.cz === hover.cz);
  const f = t ? undefined : sim.factory.facAt(hover.cx, hover.cz);
  // a free deposit tile: what lies there and what to build on it
  // (a press on the upper part of a tower lands on the tile behind it, bare or a deposit: it means the tower)
  if (!t && !f) t = towerAtScreen(clientX, clientY);
  const o = t || f ? null : freeOre(hover.cx, hover.cz);
  selected = t ? t.id : 0; selFac = f ? f.id : 0;
  selOre = o ? { cx: hover.cx, cz: hover.cz } : null;
  if (t || f || o) sound.play('click');
}
/** Any press skips the opening camera move, if the view has one running. */
function skipIntro() { if (vx.introActive?.()) { vx.skipIntro?.(); return true; } return false; }
/** Drop whatever is chosen for building. */
function dropBuild() { buildType = null; buildFac = null; painting = false; touchPend = false; view.setGhost(null); view.setFacGhost(null); }

addEventListener('keydown', (e) => {
  if (cine) cine = null; // any key or click hands the camera back during the Titan's entrance
  // Typing into a field is not a hotkey. A focused slider or checkbox does not type, so Escape and P still work there.
  const typing = e.target instanceof HTMLInputElement ? !['range', 'checkbox', 'color'].includes(e.target.type) : e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  if (typing) return;
  const k = e.key.toLowerCase();
  if (k === 'f3') { e.preventDefault(); if (!e.repeat) toggleDiag(); return; }
  if (reportOpen() || loadOpen()) { if (k === 'escape') closeForms(); return; } // (the forms take their own keys)
  if (k === 'f8') { e.preventDefault(); if (!e.repeat && !shown('editor')) reportFrom(REPORT_FROM.find(shown) || ''); return; }
  keys.add(k);
  byTouch = false;
  // Escape is "back" on any sheet that has a way back, in a run and from the main menu alike
  if (k === 'escape' && rt.a) { rtClose(); return; }
  if (k === 'escape' && !e.repeat && !shown('cards') && escBack()) return;
  if (!playing()) return;
  skipIntro();
  // a card takes a fresh key press: a held key or a repeat never picks one
  if (shown('cards')) { if (!e.repeat && k >= '1' && k <= '3') pickCard(+k - 1); else if (!e.repeat && (k === '4' || (k === 'escape' && shown('paths')))) { sound.play('click'); setPaths(!shown('paths')); } return; }
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
  if (k === 't' && !e.repeat) { if (selected) stepAim(e.shiftKey ? -1 : 1); return; }
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
addEventListener('blur', () => { keys.clear(); dragging = false; rotating = false; painting = false; mouseBtns = 0; rclick.on = false; });

// Mouse movement is read from the whole page, not only the canvas: a HUD element under the cursor must never stop a drag.
document.addEventListener('mousemove', (e) => {
  if (byTouch) return; // (a finger's emulated mouse events: the touch module has handled the finger already)
  lastMouse.x = e.clientX; lastMouse.y = e.clientY;
  overBoard = e.target === canvas;
  if (!playing()) return;
  if (painting && !(e.buttons & 1)) painting = false;
  if (rclick.on && !rclick.moved && Math.hypot(e.clientX - rclick.x, e.clientY - rclick.y) > 6) rclick.moved = true;
  if (rotating) rotateCam(-e.movementX * 0.006); // dragging right turns the board counter-clockwise: its near side follows the mouse
  else if (dragging) panBy(e.clientX - e.movementX, e.clientY - e.movementY, e.clientX, e.clientY);
  if (e.target === canvas || dragging || rotating || painting) hoverAt(e.clientX, e.clientY);
});
canvas.addEventListener('mousedown', (e) => {
  if (byTouch) return; // (an emulated mouse press after a tap: building from it again would build twice)
  if (cine) cine = null; // any key or click hands the camera back during the Titan's entrance
  sound.init();
  if (!active() || skipIntro()) return;
  if (e.button === 1) { e.preventDefault(); rotating = true; return; } // middle-drag turns the view
  if (e.button === 2) {
    // The right button: a drag pans; with something chosen for building a click drops it (wherever it lands, a tower
    // included, as it always did); otherwise a click on a tower fires its special (nothing is selected or dropped) and a
    // click anywhere else drops the selection.
    const tw = buildType || buildFac ? undefined : towerAtScreen(e.clientX, e.clientY);
    rclick.on = true; rclick.x = e.clientX; rclick.y = e.clientY; rclick.moved = false; rclick.tower = tw ? tw.id : 0;
    if (!tw) { if (buildType || buildFac) dropBuild(); else { selected = 0; selFac = 0; selOre = null; } }
    dragging = true;
    return;
  }
  if (e.button !== 0) return;
  boardTap(e.clientX, e.clientY, e.shiftKey);
  // belts, pipes and arms: keep the button down and drag to lay a line
  if (buildFac === 'belt' || buildFac === 'pipe' || buildFac === 'arm') { painting = true; paintAt.cx = hover.cx; paintAt.cz = hover.cz; }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) { painting = false; paintAt.cx = paintAt.cz = -1; }
  if (e.button === 2) {
    dragging = false;
    if (rclick.on && !rclick.moved && rclick.tower && active()) quickSpecial(rclick.tower);
    rclick.on = false;
  }
  if (e.button === 1) rotating = false;
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
/** The selection before the last tap (a double tap on a tower puts it back: see special()). */
const preTap: { sel: number; fac: number; ore: { cx: number; cz: number } | null; t: number } = { sel: 0, fac: 0, ore: null, t: -1e9 };
const touchApi = {
  canvas,
  // a tap that lands on a tower waits a moment for a second tap (double tap fires its special without selecting it)
  onTower(x: number, y: number) { return active() && !buildType && !buildFac && !vx.introActive?.() && !!towerAtScreen(x, y, 1.5); },
  turn() { sound.init(); if (active()) turnSelected(); },
  // a finger held on the ghost of a belt, pipe or arm and dragged lays a line, like a held mouse button
  hoverEnd() { painting = false; paintAt.cx = paintAt.cz = -1; },
  // two fingers: a line being laid stops; nothing is built
  gesture() { painting = false; paintAt.cx = paintAt.cz = -1; },
  // a finger down only moves the hover highlight; with a tool picked the ghost stays where the last tap put it
  press(clientX: number, clientY: number) { if (active() && !buildType && !buildFac) hoverAt(clientX, clientY); },
  hold(clientX: number, clientY: number) {
    if (!active()) return false;
    if (buildType || buildFac) {
      const [cx, cz] = cellAtScreen(clientX, clientY), onGhost = touchPend && cx === hover.cx && cz === hover.cz;
      hoverAt(clientX, clientY);
      touchPend = true;
      // held on its own ghost: a belt, pipe or arm line starts there and follows the finger
      if (onGhost && (buildFac === 'belt' || buildFac === 'pipe' || buildFac === 'arm')) {
        painting = true; paintAt.cx = hover.cx; paintAt.cz = hover.cz; placeFac(hover.cx, hover.cz, true);
        try { navigator.vibrate?.(10); } catch { /* no vibration here */ }
      }
      return true;
    }
    hoverAt(clientX, clientY);
    return true;
  },
  tap(clientX: number, clientY: number, held = false) {
    sound.init();
    if (!active() || skipIntro()) return;
    if (buildType || buildFac) {
      // the finger dragged the ghost (or a line): it stays where the finger lifted
      if (held) { if (!painting) { hoverAt(clientX, clientY); touchPend = true; } return; }
      const [cx, cz] = cellAtScreen(clientX, clientY);
      // a tap off the board puts the tool away
      if (!inBoard(cx, cz)) { dropBuild(); sound.play('click'); return; }
      // the second tap on the ghost builds (the tool stays picked to place more); a tap elsewhere moves the ghost there
      if (touchPend && cx === hover.cx && cz === hover.cz) { boardTap(clientX, clientY, true); return; }
      hoverAt(clientX, clientY); touchPend = true; sound.play('hover');
      return;
    }
    preTap.sel = selected; preTap.fac = selFac; preTap.ore = selOre; preTap.t = performance.now();
    boardTap(clientX, clientY, false);
  },
  hoverAt(clientX: number, clientY: number) {
    if (!active()) return;
    hoverAt(clientX, clientY);
    if (buildType || buildFac) touchPend = true;
  },
  /** the cancel chip: put the picked tool away */
  cancel() { if (buildType || buildFac) { dropBuild(); sound.play('click'); } },
  // a long press or a double tap on a tower fires its special (not while something is chosen for building: there a held
  // finger moves the ghost and lays belts and arms). True when the press was taken. The first tap of a double tap went
  // through as a tap and selected the tower: the selection goes back to what it was before it, so the tower is not selected.
  special(clientX: number, clientY: number, double = false) {
    if (!active() || buildType || buildFac || vx.introActive?.()) return false;
    const t = towerAtScreen(clientX, clientY, 1.5);
    if (!t) return false;
    sound.init();
    if (double && performance.now() - preTap.t < 1000) { selected = preTap.sel; selFac = preTap.fac; selOre = preTap.ore; }
    quickSpecial(t.id);
    try { navigator.vibrate?.(12); } catch { /* no vibration here */ }
    return true;
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
// A handful of steps, each ticked off by doing it: a turret beside a crate, the first wave, a mine, a Transfer Arm from the
// mine to the turret, two more such lines, the Conveyor Belts card, a belt between two arms, upgrades, power.
// Time stands still between waves, so a step about supply is ticked off by the static diagnosis, not by items arriving.
// Each step can point at tiles on the board. It runs on the first solo run and can be replayed from How to play.
/** A tutorial marker: an arrow over a tile ('here'), or a chevron on a tile of a belt to lay or of an arm to place ('path', `i` along the line, heading toward the tile at nx, nz). */
interface GuideMark { x: number; y: number; z: number; kind: 'here' | 'path'; i?: number; nx?: number; nz?: number }
interface GuideStep {
  title: string;
  /** the step as one short order (about 60 characters): what the card says; `text` (the why) waits behind its Why? toggle */
  line: () => string;
  /** its icons form a chain (an arrow between each): mine > arm > turret */
  chain?: boolean;
  text: () => string; done: () => boolean; ready?: () => boolean; points?: () => GuideMark[]; ok?: boolean; tab?: 'towers' | 'factory'; /** what the step names, as labelled icons under its text */ ics?: IconName[] }
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
 * The supply lines the tutorial points at. A line is the whole opening in one row: an iron Mine, one or two Transfer Arms
 * and a Pulse Turret, straight through the hexes (an arm takes from the tile behind it and delivers to the tile in front,
 * so a chain of arms cannot bend). Every tile of a line is checked on the board as it stands: the mine tile is a free iron
 * deposit or carries an iron mine, the arm tiles are free or carry arms, the turret tile is free or carries a Pulse Turret.
 * So nothing that is marked is ever impossible to build. The first line prefers a turret tile beside a crate of iron ore
 * (the turret of the first step then gets its mine), the later ones the tiles that cover the most road. A line that was
 * shown stays while it still holds, so the marks do not move when the player builds its first piece.
 */
type Cell = [number, number];
interface Line { mine: Cell; arms: Cell[]; dir: number; tur: Cell }
/** How many Pulse Turrets with a mine line the tutorial asks for. */
const GUIDE_LINES = 3;
const planMemo = { sim: null as Sim | null, key: '', lines: [] as Line[], bkey: '', belt: null as BeltPlan | null };
const IRON = () => oreIdx('iron_ore');
const freeCell = (c: Cell) => inBoard(c[0], c[1]) && sim.grid[c[1] * GW + c[0]] === 0 && !sim.factory.at[c[1] * GW + c[0]];
const idx = (c: Cell) => c[1] * GW + c[0];
const pulseAt = (c: Cell) => sim.towers.find((t) => t.cx === c[0] && t.cz === c[1] && t.type === 'pulse');
const ironMineAt = (c: Cell) => { const f = inBoard(c[0], c[1]) ? sim.factory.facAt(c[0], c[1]) : undefined; return f && f.type === 'mine' && f.ore === 'iron_ore' ? f : undefined; };
const facTypeAt = (c: Cell) => (inBoard(c[0], c[1]) ? sim.factory.facAt(c[0], c[1])?.type : undefined);
/** A turret a mine already feeds (by the static diagnosis: between waves nothing is delivered). */
const mineFed = (t: Tower) => !!sim.diag().get('t' + t.id)?.from.some((w) => w.startsWith('Mine'));
let roadMemo: { map: unknown; tiles: Cell[] } | null = null;
/** Road tiles within a Pulse Turret's reach of a tile: how much a turret there would cover. */
function roadCover(c: Cell): number {
  if (!roadMemo || roadMemo.map !== sim.map) { const tiles: Cell[] = []; for (let i = 0; i < GW * GH; i++) if (sim.map.grid[i] === 1) tiles.push([i % GW, Math.floor(i / GW)]); roadMemo = { map: sim.map, tiles }; }
  let n = 0;
  for (const r of roadMemo.tiles) if (hexDist(c[0], c[1], r[0], r[1]) <= 3) n++;
  return n;
}
const byIronCrate = (c: Cell) => sim.factory.facs.some((f) => f.type === 'crate' && f.hold === 'iron_ore' && f.left > 0 && hexDist(f.cx, f.cz, c[0], c[1]) === 1);
/** Does a line still hold on the board as it stands? */
function lineHolds(l: Line): boolean {
  if (!ironMineAt(l.mine) && !(freeCell(l.mine) && sim.factory.ore[idx(l.mine)] === IRON())) return false;
  if (!l.arms.every((a) => freeCell(a) || facTypeAt(a) === 'arm')) return false;
  return !!pulseAt(l.tur) || freeCell(l.tur);
}
/** The arm on a tile of a line stands and points on down the line. */
const armSet = (l: Line, i: number) => { const f = sim.factory.facAt(l.arms[i][0], l.arms[i][1]); return !!f && f.type === 'arm' && f.dir === l.dir; };
const lineDone = (l: Line) => !!ironMineAt(l.mine) && l.arms.every((_, i) => armSet(l, i)) && !!pulseAt(l.tur);
function guideLines(): Line[] {
  const F = sim.factory, key = `${F.rev}:${sim.towers.map((t) => t.id).join()}`;
  if (planMemo.sim === sim && planMemo.key === key) return planMemo.lines;
  const lines = planMemo.sim === sim ? planMemo.lines.filter(lineHolds) : [];
  const used = new Set<number>(), mines = new Set<number>();
  for (const l of lines) { mines.add(idx(l.mine)); for (const c of [...l.arms, l.tur]) used.add(idx(c)); }
  const iron = IRON(), spots: Cell[] = [];
  for (let i = 0; i < GW * GH; i++) { const c: Cell = [i % GW, Math.floor(i / GW)]; if (F.ore[i] === iron && (ironMineAt(c) || freeCell(c))) spots.push(c); }
  const first = !sim.towers.some((t) => t.type === 'pulse');
  while (lines.length < GUIDE_LINES) {
    let best: Line | null = null, bs = Infinity;
    // (two passes: a mine of its own for every line if the board has room for it, else a mine shared with another line)
    for (let pass = 0; pass < 2 && !best; pass++) for (const m of spots) {
      if (used.has(idx(m)) || (pass === 0 && mines.has(idx(m)))) continue;
      for (let d = 0; d < 6; d++) {
        const arms: Cell[] = [];
        let c = m;
        for (let k = 1; k <= 2; k++) {
          c = neighbor(c[0], c[1], d);
          if (used.has(idx(c)) || mines.has(idx(c)) || !(freeCell(c) || facTypeAt(c) === 'arm')) break; // (not on another line's mine)
          arms.push(c);
          const t = neighbor(c[0], c[1], d);
          if (!inBoard(t[0], t[1]) || used.has(idx(t)) || mines.has(idx(t))) continue;
          const tw = pulseAt(t);
          if (!tw && !freeCell(t)) continue;
          if (tw && mineFed(tw)) continue; // (it has a line already)
          const cover = roadCover(t);
          if (!tw && !cover) continue; // (a turret that reaches no road)
          let s = k * 4 - (tw ? 40 : Math.min(cover, 16) * 0.5) + (F.ore[idx(t)] && !tw ? 15 : 0) + arms.reduce((n, a) => n + (F.ore[idx(a)] ? 4 : 0), 0) - (ironMineAt(m) ? 20 : 0);
          // the very first line ends beside a crate if it can: the turret of step one then gets this mine
          if (!tw && byIronCrate(t)) s -= first && !lines.length ? 30 : 3;
          if (s < bs) { bs = s; best = { mine: m, arms: [...arms], dir: d, tur: t }; }
        }
      }
    }
    if (!best) break;
    lines.push(best);
    mines.add(idx(best.mine));
    for (const q of [...best.arms, best.tur]) used.add(idx(q));
  }
  planMemo.sim = sim; planMemo.key = key; planMemo.lines = lines;
  return lines;
}
/** The markers of a line: the deposit and the turret hex while they are still to build ('here'), each arm tile with a chevron down the line until an arm stands there pointing that way. */
function lineMarks(l: Line, parts: { mine?: boolean; arms?: boolean; tur?: boolean } = { mine: true, arms: true, tur: true }): GuideMark[] {
  const out: GuideMark[] = [];
  if (parts.mine && !ironMineAt(l.mine)) out.push(tileMark(l.mine[0], l.mine[1]));
  if (parts.arms) l.arms.forEach((a, i) => {
    if (armSet(l, i)) return;
    const [nx, nz] = l.arms[i + 1] || l.tur;
    out.push({ ...tileMark(a[0], a[1], 'path', i), nx: cellX(nx, nz), nz: cellZ(nz) });
  });
  if (parts.tur && !pulseAt(l.tur)) out.push(tileMark(l.tur[0], l.tur[1]));
  return out;
}
/** Where the first turret goes: the turret end of the first line when that lies beside a crate of iron ore, else the free hex beside such a crate that covers the most road. */
function firstTurret(): Cell | null {
  const l = guideLines()[0];
  if (l && !pulseAt(l.tur) && byIronCrate(l.tur)) return l.tur;
  let best: Cell | null = null, bs = -1;
  for (const f of sim.factory.facs) if (f.type === 'crate' && f.hold === 'iron_ore' && f.left > 0) for (let d = 0; d < 6; d++) {
    const c = neighbor(f.cx, f.cz, d);
    if (!freeCell(c)) continue;
    const s = roadCover(c) - (sim.factory.ore[idx(c)] ? 100 : 0);
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}
/**
 * The belt line the tutorial points at once the Conveyor Belts card is taken: a Mine, an arm that puts its ore on a belt,
 * the belt (2 to 6 tiles, found by a flood fill over the free deck), and a second arm that takes the ore off the belt's
 * last tile into a Pulse Turret: one that stands without a mine of its own if there is one (the turret by the crate), else
 * a free hex that covers road. Checked tile by tile like the arm lines, and kept while it still holds.
 */
interface BeltPlan { mine: Cell; a1: Cell; d1: number; belts: Cell[]; a2: Cell; d2: number; tur: Cell }
function beltHolds(b: BeltPlan): boolean {
  if (!ironMineAt(b.mine) && !(freeCell(b.mine) && sim.factory.ore[idx(b.mine)] === IRON())) return false;
  if (![b.a1, b.a2].every((a) => freeCell(a) || facTypeAt(a) === 'arm')) return false;
  if (!b.belts.every((c) => freeCell(c) || facTypeAt(c) === 'belt')) return false;
  return !!pulseAt(b.tur) || freeCell(b.tur);
}
function beltPlan(): BeltPlan | null {
  const F = sim.factory, key = `${F.rev}:${sim.towers.map((t) => t.id).join()}`;
  if (planMemo.sim === sim && planMemo.bkey === key) return planMemo.belt;
  planMemo.bkey = key;
  if (planMemo.sim === sim && planMemo.belt && beltHolds(planMemo.belt)) return planMemo.belt;
  const used = new Set<number>(), mines = new Set<number>();
  for (const l of guideLines()) { mines.add(idx(l.mine)); for (const c of [...l.arms, l.tur]) used.add(idx(c)); }
  // (a turret of a line that is not built yet is no target; one that stands without a mine is the best there is)
  const iron = IRON(), ok = (c: Cell) => freeCell(c) && !used.has(idx(c)) && !mines.has(idx(c));
  let best: BeltPlan | null = null, bs = Infinity;
  const dist = new Int16Array(GW * GH), from = new Int32Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) {
    const m: Cell = [i % GW, Math.floor(i / GW)];
    if (F.ore[i] !== iron || mines.has(i) || used.has(i) || !(ironMineAt(m) || freeCell(m))) continue;
    if (ironMineAt(m) && F.facs.some((a) => a.type === 'arm' && armBack(a) === i)) continue; // (that mine feeds a line already)
    for (let d1 = 0; d1 < 6; d1++) {
      const a1 = neighbor(m[0], m[1], d1), s0 = neighbor(a1[0], a1[1], d1);
      if (!ok(a1) || !ok(s0) || F.ore[idx(a1)] === iron) continue;
      // flood fill from the first belt tile, at most 5 steps
      dist.fill(-1);
      const q = [idx(s0)];
      dist[q[0]] = 0; from[q[0]] = -1;
      for (let h = 0; h < q.length; h++) {
        const j = q[h];
        if (dist[j] >= 5) continue;
        for (let d = 0; d < 6; d++) {
          const n = neighbor(j % GW, Math.floor(j / GW), d), k = idx(n);
          if (!ok(n) || k === idx(a1) || dist[k] >= 0) continue;
          dist[k] = dist[j] + 1; from[k] = j; q.push(k);
        }
      }
      for (const e of q) {
        if (dist[e] < 1) continue;
        const path: Cell[] = [];
        for (let j = e; j >= 0; j = from[j]) path.unshift([j % GW, Math.floor(j / GW)]);
        const on = new Set(path.map(idx));
        const ec: Cell = [e % GW, Math.floor(e / GW)];
        for (let d2 = 0; d2 < 6; d2++) {
          const a2 = neighbor(ec[0], ec[1], d2), t = neighbor(a2[0], a2[1], d2);
          if (!ok(a2) || on.has(idx(a2)) || idx(a2) === idx(a1) || !inBoard(t[0], t[1]) || on.has(idx(t)) || idx(t) === idx(a1) || idx(t) === idx(m)) continue;
          const tw = pulseAt(t);
          if (tw ? mineFed(tw) : !ok(t) || !roadCover(t)) continue;
          // short and straight reads best: every belt tile costs, a bend and a tile laid over a deposit cost more
          let bends = 0;
          for (let k = 2; k < path.length; k++) if (lineDir(path[k - 2][0], path[k - 2][1], path[k - 1][0], path[k - 1][1]) !== lineDir(path[k - 1][0], path[k - 1][1], path[k][0], path[k][1])) bends++;
          const s = dist[e] * 3 + bends * 3 - (tw ? 12 : Math.min(roadCover(t), 16) * 0.5) + (F.ore[idx(t)] && !tw ? 15 : 0) + path.reduce((n, c) => n + (F.ore[idx(c)] ? 6 : 0), 0) + (F.ore[idx(a2)] ? 4 : 0) - (ironMineAt(m) ? 6 : 0);
          if (s < bs) { bs = s; best = { mine: m, a1, d1, belts: path, a2, d2, tur: t }; }
        }
      }
    }
  }
  planMemo.belt = best;
  return best;
}
const armFacing = (c: Cell, d: number) => { const f = sim.factory.facAt(c[0], c[1]); return !!f && f.type === 'arm' && f.dir === d; };
function beltMarks(): GuideMark[] {
  const b = beltPlan(), out: GuideMark[] = [];
  if (!b) return out;
  const chev = (c: Cell, to: Cell, i: number) => out.push({ ...tileMark(c[0], c[1], 'path', i), nx: cellX(to[0], to[1]), nz: cellZ(to[1]) });
  if (!ironMineAt(b.mine)) out.push(tileMark(b.mine[0], b.mine[1]));
  if (!armFacing(b.a1, b.d1)) chev(b.a1, b.belts[0], 0);
  b.belts.forEach((c, i) => {
    // (the last belt tile keeps the heading of the one before it: where it points does not matter, the arm takes from the tile)
    const to: Cell = b.belts[i + 1] || (i > 0 ? neighbor(c[0], c[1], lineDir(b.belts[i - 1][0], b.belts[i - 1][1], c[0], c[1])) : b.a2);
    const f = sim.factory.facAt(c[0], c[1]);
    if (f && f.type === 'belt' && (i === b.belts.length - 1 || tileOfCell(...neighbor(c[0], c[1], f.dir)) === idx(b.belts[i + 1]))) return;
    chev(c, to, i + 1);
  });
  if (!armFacing(b.a2, b.d2)) chev(b.a2, b.tur, b.belts.length + 1);
  if (!pulseAt(b.tur)) out.push(tileMark(b.tur[0], b.tur[1]));
  return out;
}
/** A belt line stands: an arm takes off a belt into a tower and the diagnosis says it will carry. */
const beltLineDone = () => sim.factory.facs.some((a) => {
  if (a.type !== 'arm') return false;
  const b = armBack(a), f = armFront(a), q = b >= 0 ? sim.factory.facAt(b % GW, Math.floor(b / GW)) : undefined;
  return !!q && conveyor(q.type) && f >= 0 && sim.towers.some((t) => tileOfCell(t.cx, t.cz) === f) && !!sim.diag().get('f' + a.id)?.ok;
});
/** What the upgrade step still points at: the Pulse Turrets of the lines (up to GUIDE_LINES) and their iron mines while at Mk1. */
function upgradeMarks(): GuideMark[] {
  const out: GuideMark[] = [];
  for (const t of sim.towers.filter((t) => t.type === 'pulse').slice(0, GUIDE_LINES)) if (t.lvl < 2) out.push({ x: t.x, y: 1.2, z: t.z, kind: 'here' });
  const m = sim.factory.facs.find((f) => f.type === 'mine' && f.ore === 'iron_ore');
  if (m && m.lvl < 2) out.push({ x: m.x, y: 1.2, z: m.z, kind: 'here' });
  return out;
}
const fedTurrets = () => sim.towers.filter((t) => t.type === 'pulse' && mineFed(t)).length;
const facBar = () => (barTab === 'factory' ? '' : kb() ? 'press F for the Factory bar, ' : 'tap Factory, ');
const towerBar = () => (barTab === 'towers' ? '' : kb() ? 'press F for the Towers bar, ' : 'tap Towers, ');
const GUIDE: GuideStep[] = [
  {
    title: 'Build a Pulse Turret beside a crate',
    line: () => kb() ? 'Press 1, then click the marked hex beside a crate' : 'Pick the Pulse Turret, tap the marked hex twice',
    ics: ['fac_crate', 'iron_ore', 'tw_pulse'], chain: true,
    text: () => `Time stands still until you call a wave, so build first. Towers start empty. The sand-coloured supply crates beside the road hold iron ore, the Pulse Turret's ammunition, and a crate feeds any tower right next to it. ${kb() ? 'Pick the Pulse Turret (key 1)' : 'Tap the Pulse Turret'} and build it on the marked hex beside a crate: a green ring closes round its base when it will be fed.`,
    done: () => sim.towers.some((t) => t.type === 'pulse' && (t.stock > 0 || t.ammo > 0 || !!sim.diag().get('t' + t.id)?.ok)),
    points: () => { const c = firstTurret(); return c ? [tileMark(c[0], c[1])] : sim.factory.facs.filter((f) => f.type === 'crate' && f.hold === 'iron_ore' && f.left > 0).map((f) => ({ x: f.x, y: 1.2, z: f.z, kind: 'here' as const })); },
    tab: 'towers',
  },
  {
    title: 'Call the first wave',
    line: () => kb() ? 'Call the first wave: press N' : 'Tap Call wave when you are ready',
    text: () => `Nothing moves until you call: no wave, no factory. When the wave runs, the crate hands its ore to the turret one piece at a time. ${kb() ? 'Press N or the Call first wave button.' : 'Tap Call first wave.'}`,
    done: () => sim.wave >= 1,
  },
  {
    title: 'Build a Mine',
    line: () => `${barTab === 'factory' ? 'A' : kb() ? 'F, then a' : 'Factory tab, then a'} Mine on the marked iron deposit`,
    ics: ['dep_iron_ore', 'fac_mine', 'iron_ore'], chain: true,
    text: () => `A crate runs out (click it to see what is left). Give the turret a supply of its own: ${facBar()}pick the Mine${kb() ? ' (key 5)' : ''} and build it on ${guideLines().length ? 'the marked iron deposit' : 'an iron deposit'}, the blue-grey tiles with ore chunks. A mine digs slowly, about one ore every 3 seconds: one mine keeps one turret firing.`,
    done: () => sim.factory.facs.some((f) => f.type === 'mine' && f.ore === 'iron_ore'),
    // (the mine end of a line that fits on the board as it stands: no line, nothing marked rather than a deposit that leads nowhere)
    points: () => { const l = guideLines()[0]; return l ? lineMarks(l, { mine: true }) : []; },
    tab: 'factory',
  },
  {
    title: 'Place a Transfer Arm',
    line: () => {
      const l = guideLines().find((x) => !lineDone(x)) || guideLines()[0];
      if (l && !ironMineAt(l.mine)) return 'First a Mine on the marked deposit';
      if (l && l.arms.length > 1) return `${kb() ? 'Drag' : 'Hold and drag'} Transfer Arms over the two marked hexes`;
      if (l && !pulseAt(l.tur) && fedTurrets() < 1 && sim.factory.facs.some((f) => f.type === 'arm')) return 'Now a Pulse Turret on the marked hex';
      return 'A Transfer Arm on the marked hex, mine to turret';
    },
    ics: ['fac_mine', 'fac_arm', 'tw_pulse'], chain: true,
    text: () => {
      const l = guideLines().find((x) => !lineDone(x)) || guideLines()[0];
      const two = !!l && l.arms.length > 1, needTur = !!l && !pulseAt(l.tur), needMine = !!l && !ironMineAt(l.mine);
      return `A mine hands nothing over by itself: every hand-off is carried by a Transfer Arm. ${needMine ? 'Build the Mine on the marked deposit first. ' : ''}${facBar() ? facBar()[0].toUpperCase() + facBar().slice(1) : ''}${facBar() ? 'pick' : 'Pick'} the Transfer Arm${kb() ? ' (key 1)' : ''} and ${!l ? 'put it beside the mine, pointing away from it, with a Pulse Turret right in front of it' : two ? `${kb() ? 'drag' : 'hold and drag'} it over the two marked hexes, from the mine toward the turret hex` : 'put it on the marked hex'}. The arm takes from the tile behind its arrow and delivers to the tile in front; the preview turns by itself where that is clear, and ${kb() ? 'R' : 'Turn'} turns it by hand.${needTur ? ` Then build a Pulse Turret on the marked hex at the arm's end${byIronCrate(l!.tur) ? '' : ': this line has no room beside the crate'}.` : ''} A green ring on the turret says the mine will feed it.`;
    },
    points: () => { const l = guideLines().find((x) => !lineDone(x)); return l ? lineMarks(l) : []; },
    // (between waves nothing is delivered: a turret that the diagnosis says a mine will feed counts)
    done: () => fedTurrets() >= 1,
    tab: 'factory',
  },
  {
    title: 'Two more lines',
    line: () => { const n = Math.max(1, GUIDE_LINES - fedTurrets()); return `${n} more line${n > 1 ? 's' : ''} on the marks: mine, arm, turret`; },
    ics: ['fac_mine', 'fac_arm', 'tw_pulse'], chain: true,
    text: () => `One turret will not hold the road for long. Build ${Math.max(1, GUIDE_LINES - fedTurrets())} more ${GUIDE_LINES - fedTurrets() > 1 ? 'lines' : 'line'} the same way on the marked hexes: a Mine on the deposit, a Transfer Arm on each chevron (they show which way it has to point), a Pulse Turret (${kb() ? 'F for the Towers bar, key 1' : 'Towers bar'}) on the hex at the end. Where a line has to take a mine that is in use, the two turrets share its ore. The crates help while they last.`,
    done: () => fedTurrets() >= GUIDE_LINES || guideLines().every(lineDone),
    points: () => guideLines().filter((l) => !lineDone(l)).flatMap((l) => lineMarks(l)),
  },
  {
    title: 'Take the Conveyor Belts card',
    line: () => (sim.planning && !sim.queue.length ? 'Call waves; at level up take Conveyor Belts' : 'At level up, take Conveyor Belts'),
    ics: ['fac_belt'],
    text: () => `Kills give experience${sim.queue.length || !sim.planning ? '' : `; call the next wave${kb() ? ' (N)' : ''}`}. Every level you choose one of three cards. Tower blueprints unlock towers; production cards unlock the buildings that make their supply, and a card only comes up once what it builds on is there. Take Conveyor Belts when it is offered: it always is, among the first. The level-up screen has a Paths view that shows what unlocks what.`,
    done: () => sim.facs.has('belt'),
  },
  {
    title: 'A belt between two arms',
    line: () => `Arm onto the belt, ${kb() ? 'drag' : 'hold-drag'} belt along the chevrons, arm off`,
    ics: ['fac_arm', 'fac_belt', 'fac_arm', 'tw_pulse'], chain: true,
    text: () => {
      const b = beltPlan(), needMine = !!b && !ironMineAt(b.mine), needTur = !!b && !pulseAt(b.tur);
      const first = [needMine ? 'a Mine on the marked deposit' : '', needTur ? 'a Pulse Turret on the marked hex at the far end' : ''].filter(Boolean).join(' and ');
      return `A belt only carries: it takes nothing from what it runs past and feeds nothing it ends at. ${first ? `Build ${first} first. Then, on` : 'On'} the marked line, put a Transfer Arm${kb() ? ' (key 1)' : ''} beside the mine so it points onto the first belt hex, pick the Belt${kb() ? ' (key 2)' : ''} and ${kb() ? 'drag' : 'hold and drag'} along the chevrons, and put a second arm on the last chevron: it takes the ore off the belt into the turret. More arms along a belt serve more towers, and each arm can be told which item to take.`;
    },
    ready: () => sim.facs.has('belt'),
    points: () => beltMarks(),
    done: () => beltLineDone() || !beltPlan(),
    tab: 'factory',
  },
  {
    title: 'Upgrade for the Colossus',
    line: () => `Upgrade the marked turrets and their Mine${kb() ? ' (U)' : ''}`,
    ics: ['tw_pulse', 'fac_mine', 'credits'],
    text: () => `Every fifth wave brings a Colossus. Get ready early: click each turret and ${kb() ? 'press U (Upgrade)' : 'tap Upgrade'}, and its Mine too, so the ore keeps up with the faster guns. When the Colossus walks past, fire the turrets' specials at it: ${kb() ? 'right-click a charged turret, it does not have to be selected' : 'hold a charged turret, or double-tap it'}.`,
    done: () => !upgradeMarks().length,
    points: () => upgradeMarks(),
  },
  {
    title: 'Power',
    line: () => 'Mine on coal, arm, Generator: power for 2 tiles',
    ics: ['dep_coal', 'fac_mine', 'fac_arm', 'fac_generator', 'power'], chain: true,
    text: () => `The Power Grid card unlocked the Generator. Build a Mine on coal (the dark tiles with black lumps), a Generator one hex away and a Transfer Arm between them, from the mine into the Generator. It powers everything within 2 tiles; Power Poles carry it further, also across a road. The Power gauge at the top shows what the grid will give against what it needs.`,
    ready: () => sim.facs.has('generator'),
    done: () => sim.factory.powerNets.some((n) => n.cap > 0) || sim.factory.facs.some((f) => f.type === 'generator' && !!sim.diag().get('f' + f.id)?.ok),
    points: () => oreTiles(oreIdx('coal'), 3),
  },
  {
    title: 'That is the pattern',
    line: () => 'Every later tower adds one step, and each step is a card',
    ics: ['fac_pump', 'fac_pipe', 'fac_smelter', 'fac_press', 'aim_first'],
    text: () => `Every later tower adds one more step, and each step is a card: Smelting for plates, the Shell Press, the Oil Field with its pipes. A blueprint card says which production cards its tower still waits for. Between waves, a broken red ring round a tower or building says it will lack something, and the hologram over it shows what; click it for the hand-off that is missing. Arms, mines, plants and generators upgrade (${kb() ? 'U' : 'Upgrade'}) to work faster. A selected tower's panel also sets which enemy it targets${kb() ? ' (T)' : ''}.`,
    done: () => guide.acked,
    ok: true,
  },
];
function startGuide() {
  guide.on = true; guide.i = 0; guide.t = 0; guide.acked = false;
  delete cache.guide; delete cache.guideic;
}
function endGuide(skipped: boolean) {
  guide.on = false;
  show('guide', false);
  store.tips.tutorial = true; save();
  if (!skipped) void career?.flag('tutorial');
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
      // (a step about towers brings the tower bar back: with the factory bar open, key 1 would pick the Transfer Arm)
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
  // (on a phone the strip is the default: the short order fits it; a tap opens the icons and the Why?)
  const fold = smallUi() && guideFold.manual !== 'open';
  if (guideWhy.step !== guide.i) { guideWhy.step = guide.i; setWhy(false); }
  const key = guide.i + ':' + waiting + ':' + touchUi() + ':' + fold + ':' + st.text() + ':' + st.line(); // (a step's text can follow the board: what is built of its chain)
  if (cache.guide === key) return;
  cache.guide = key;
  $('guide').classList.toggle('fold', fold);
  show('guide', !waiting);
  setText('guide-step', `${fold ? '' : 'Tutorial '}${guide.i + 1} / ${GUIDE.length}`); // (the folded strip keeps its room for the order)
  setText('guide-title', st.line());
  setText('guide-text', st.text());
  $('guide').title = st.title;
  const gk = guide.i + ':' + (st.ics || []).join();
  if (cache.guideic !== gk) {
    cache.guideic = gk;
    const box = $('guide-ic'); box.textContent = '';
    // icons only (each names itself on hover or a long press), an arrow between the links of a chain
    (st.ics || []).forEach((n, i) => { if (i && st.chain) box.append(arrow()); box.append(rchip(n, '', { label: iconLabel(n) })); });
  }
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
/** The tutorial's explanation is folded away behind Why? (per step; the short order stays). */
const guideWhy = { step: -1 };
function setWhy(on: boolean) {
  show('guide-text', on);
  const b = $('guide-why');
  b.classList.toggle('on', on); b.setAttribute('aria-expanded', String(on));
}
$('guide-why').addEventListener('click', (e) => { e.stopPropagation(); sound.init(); sound.play('click'); setWhy($('guide-text').classList.contains('hidden')); if (smallUi()) guideFold.manual = 'open'; delete cache.guide; });
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
const bpoOf: { sim: Sim | null; n: number; list: TowerType[] } = { sim: null, n: -1, list: [] };
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
  if (cache.plan !== String(plan)) { cache.plan = String(plan); document.body.classList.toggle('planning', plan); show('prep', false); }
  setText('level', String(sim.level));
  setW('xpbar', sim.xp / sim.xpNext);
  const waiting = isClient ? sim.nextWaveIn >= 0 : !sim.queue.length;
  const canCall = waiting && !sim.over && !(sim.wave >= sim.winWave && sim.campaign);
  // The slot of the button stays reserved (see #btn-wave.off), so the bar next to it never moves.
  // The wave button carries what the old build phase banner said. Build phase: "Call wave N" (a clock: time stands still,
  // or the countdown with Auto waves); during a wave: its progress, the enemies left; the rust ring beside it counts what
  // will lack supply and steps the camera through them. (The slot stays reserved, so the bar next to it never moves.)
  const first = sim.wave === 0, wb = $<HTMLButtonElement>('btn-wave');
  const alive = sim.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0), foes = alive + sim.queue.length;
  const live = !canCall && !sim.over && !ended && sim.wave > 0 && foes > 0;
  const wk = `${canCall}:${first}:${live}:${plan}`;
  if (cache.wavecls !== wk) {
    cache.wavecls = wk;
    wb.classList.toggle('off', !canCall && !live); wb.classList.toggle('first', canCall && first); wb.classList.toggle('live', live); wb.classList.toggle('still', canCall && plan);
    wb.disabled = !canCall;
    if (live) cache.wavemax = '0';
  }
  if (canCall) {
    const left = Math.max(0, Math.ceil(sim.nextWaveIn)), raw = sim.callBonus();
    const bonus = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    // the wave waits for the call, unless Auto waves is on (then it also pays for calling early)
    const timed = sim.autoWaves && !(sim.holdFirst && first);
    setText('wave-label', `Call wave ${sim.wave + 1}`);
    setText('wave-timer', !timed ? (plan ? (touchUi() ? 'time stands still' : 'time stands still · N') : touchUi() ? 'early' : 'early · N') : bonus > 0 ? `${left}s · +${bonus} cr` : `in ${left}s`);
    setW('wave-prog', timed && Number.isFinite(sim.nextWaveIn) ? clamp(1 - sim.nextWaveIn / 30, 0, 1) : 0);
  } else if (live) {
    // (the bar fills as the wave is cleared: measured against the most enemies seen in this wave)
    const mx = Math.max(foes, +(cache.wavemax || 0)); cache.wavemax = String(mx);
    setText('wave-label', `Wave ${sim.wave}`);
    setText('wave-timer', `${foes} left`);
    setW('wave-prog', mx > 0 ? 1 - foes / mx : 0);
  }
  // what will lack supply when the wave starts (the old banner's line), as a rust ring and a count
  const lack = canCall && plan ? lackList() : [];
  const lk = String(lack.length);
  if (cache.lack !== lk) { cache.lack = lk; show('wave-warn', lack.length > 0); setText('wave-warn-n', lk); $('wave-warn').setAttribute('aria-label', `${lk} will lack supply: show ${lack.length === 1 ? 'it' : 'the next'}`); }
  const ak = String(settings.auto);
  const rk = String(settings.rings);
  if (cache.rings !== rk) { cache.rings = rk; const rb = $('btn-rings'); rb.classList.toggle('on', settings.rings); rb.setAttribute('aria-pressed', rk); }
  if (cache.auto !== ak) { cache.auto = ak; const ab = $('btn-auto'); ab.textContent = settings.auto ? 'Auto waves: on' : 'Auto waves: off'; ab.setAttribute('aria-pressed', ak); }
  // (the buttons are only touched when their state or price changes: nothing is written to the DOM on a frame where none did)
  // (the blueprints that can come up next change only with the unlocks: worked out again only then, not every frame)
  if (bpoOf.sim !== sim || bpoOf.n !== sim.unlocked.size) { bpoOf.sim = sim; bpoOf.n = sim.unlocked.size; bpoOf.list = bpoOf.n < TOWER_TYPES.length ? sim.bpOpen() : []; }
  const bpo = bpoOf.list;
  for (const t of TOWER_TYPES) {
    const b = buildBtns[t], locked = !sim.unlocked.has(t), cost = sim.cost(t), mt = sim.matCost(t);
    const poor = !locked && (sim.gold < cost || sim.mats < mt), soon = locked && bpo.includes(t), st = (locked ? 1 : 0) | (poor ? 2 : 0) | (buildType === t ? 4 : 0) | (soon ? 8 : 0);
    const was = btnState.get(b);
    if (!was || was.st !== st) { b.classList.toggle('locked', locked); b.classList.toggle('poor', poor); b.classList.toggle('sel', buildType === t); b.classList.toggle('soon', soon); }
    if (!was || was.cost !== cost || was.mt !== mt) { const c = btnCost.get(b)!; const cr = el('span', 'cr'); cr.append(ic('credits', { size: 12 }), el('b', '', String(cost))); c.replaceChildren(cr); if (mt) { const m = el('span', 'm'); m.append(ic('mats', { size: 12 }), el('b', '', String(mt))); c.append(m); } }
    if (!was) btnState.set(b, { st, cost, mt }); else { was.st = st; was.cost = cost; was.mt = mt; }
  }
  // the factory bar shows every building from the start: a locked one is hatched like a locked tower and names its card
  for (const t of FAC_TYPES) {
    const b = facBtns[t], cost = sim.facCost(t), locked = !sim.facs.has(t), poor = !locked && sim.gold < cost, st = (locked ? 1 : 0) | (poor ? 2 : 0) | (buildFac === t ? 4 : 0);
    const was = btnState.get(b);
    if (!was || was.st !== st) {
      b.classList.toggle('locked', locked); b.classList.toggle('poor', poor); b.classList.toggle('sel', buildFac === t);
      if (!was || (was.st & 1) !== (st & 1)) { const lk = FAC_CARD[t]; b.title = locked && lk ? `Locked: ${CARD_BY_ID[lk].name} card` : ''; }
    }
    if (!was || was.cost !== cost) { const cr = el('span', 'cr'); cr.append(ic('credits', { size: 12 }), el('b', '', String(cost))); btnCost.get(b)!.replaceChildren(cr); }
    if (!was) btnState.set(b, { st, cost, mt: 0 }); else { was.st = st; was.cost = cost; }
  }
  // tooltip: the building under the pointer, else the one picked for building (touch has no hover). While the mouse
  // places it on the board (or drags a belt) the picked one's tooltip steps aside: it would cover a third of the board.
  const tipFor = tipHover || (!byTouch && (overBoard || painting) ? null : buildType || buildFac), tipKey = tipFor ? tipFor + (Object.hasOwn(TOWERS, tipFor) ? (sim.unlocked.has(tipFor as TowerType) ? ':' : ':locked:') + sim.cost(tipFor as TowerType) : ':' + sim.facCost(tipFor as FacType)) + ':' + innerWidth + ':' + sim.facs.size + ':' + sim.level + ':' + sim.unlocked.size : '';
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
  // touch: the picked tool's render and an X (the cancel chip), shown while something is picked for building
  const tool = buildType ? 'tower_' + buildType : buildFac ? 'fac_' + buildFac : '';
  if (cache.tool !== tool) {
    cache.tool = tool;
    document.body.classList.toggle('tool', !!tool);
    if (tool) {
      $<HTMLImageElement>('t-cancel-img').src = `./media/sm/${tool}.jpg`;
      $('t-cancel-ic').replaceChildren(ic(buildType ? `tw_${buildType}` : `fac_${buildFac!}`, { size: 14 }));
      $('t-cancel').setAttribute('aria-label', `Stop building the ${buildType ? TOWERS[buildType].name : FACS[buildFac!].name}`);
    }
  }
  updateGuide();
  updateOre();
  updateFacPanel(); // (first: clearing the factory selection must not hide the ring the tower panel then puts up)
  updateTowerPanel();
  updateTitan();
  updateMarks();
  updateIntel();
  if (mode === 'versus') setText('vs-status', `Core ${rival.l} / Wave ${rival.w} / ${rival.k} kills`);
}

/** What will lack supply when the wave starts (the broken rust rings): diagnosis keys, towers first. */
function lackList(): string[] {
  const dg = sim.diag(), out: string[] = [];
  for (const k of dg.keys()) { const d = diagOf(k, dg)!; if (diagBad(k, d) && !onlyTaker(d)) out.push(k); }
  return out.sort((a, b) => (a[0] === b[0] ? 0 : a[0] === 't' ? -1 : 1));
}
/** The rust ring beside the wave button: the camera steps to the next thing that will lack supply, and selects it (its panel says why). */
let lackAt = -1;
click('wave-warn', () => {
  const l = lackList();
  if (!l.length || !active()) return;
  lackAt = (lackAt + 1) % l.length;
  const k = l[lackAt], id = +k.slice(1), t = k[0] === 't' ? sim.towerById(id) : undefined, f = t ? undefined : sim.factory.facById(id);
  const at = t || f;
  if (!at) return;
  dropBuild();
  selected = t ? t.id : 0; selFac = f ? f.id : 0; selOre = null;
  const c = bird(); c.x = at.x; c.z = at.z; clampCam();
});

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
/** The building that makes a tower's ammunition or fluid. */
const MAKER: Partial<Record<ItemType | 'crude' | 'petrol', FacType>> = { iron_ore: 'mine', copper: 'smelter', shell: 'press', cell: 'cells', missile: 'missiles', crude: 'pump', petrol: 'refinery' };
const tileOfCell = (cx: number, cz: number) => (inBoard(cx, cz) ? cz * GW + cx : -1);
/** What is brought onto a tile: by the arms that point at it and by the belts, splitters and tunnels that run into it. */
function arriving(tile: number, seen: Set<number>): ItemType[] {
  const F = sim.factory, out = new Set<ItemType>(), q = F.facAt(tile % GW, Math.floor(tile / GW));
  for (const a of F.facs) {
    if (a === q) continue;
    const at = tileOfCell(a.cx, a.cz);
    if (a.type === 'arm') { if (armFront(a) === tile) { if (a.hand) out.add(a.hand); for (const it of a.only ? [a.only] : offered(armBack(a), seen)) out.add(it); } continue; }
    if (!conveyor(a.type) || !q || !conveyor(q.type)) continue;
    const [nx, nz] = neighbor(a.cx, a.cz, a.dir), ahead = tileOfCell(nx, nz) === tile;
    const into = a.type === 'belt' ? ahead : a.type === 'tunnel' ? (a.exit ? ahead : a.pair === q.id) : hexDist(a.cx, a.cz, q.cx, q.cz) === 1 && q.type === 'belt' && tileOfCell(...neighbor(q.cx, q.cz, q.dir)) !== at;
    if (into) for (const it of offered(at, seen)) out.add(it);
  }
  return [...out];
}
/**
 * The kinds of item an arm could find on a tile: what the building there makes, or what belts and arms bring to it (followed
 * back to the mines, plants and crates they start at). A static reading of the layout, for the arm's filter and the ammo switch.
 */
function offered(tile: number, seen = new Set<number>()): ItemType[] {
  if (tile < 0 || seen.has(tile)) return [];
  seen.add(tile);
  const q = sim.factory.facAt(tile % GW, Math.floor(tile / GW)), out = new Set<ItemType>();
  if (!q) return [];
  switch (q.type) {
    case 'mine': if (q.ore && q.ore !== 'oil') out.add(q.ore as ItemType); break;
    case 'crate': if (q.hold && q.left > 0) out.add(q.hold); break;
    case 'smelter': {
      const inp = arriving(tile, seen), any = !inp.includes('iron_ore') && !inp.includes('copper_ore');
      if (any || inp.includes('iron_ore')) out.add('iron');
      if (any || inp.includes('copper_ore')) out.add('copper');
      break;
    }
    case 'press': case 'cells': case 'missiles': { const o = MAKES[q.type]?.out; if (o) out.add(o); break; }
    // (what is brought to it, not what happens to lie on it this instant: the list must hold still while a wave runs)
    case 'belt': case 'splitter': case 'tunnel': for (const it of arriving(tile, seen)) out.add(it); break;
  }
  return ITEM_TYPES.filter((it) => out.has(it));
}
/** True if something stands ready to deliver a tower's second ammunition: an arm pointing at it whose source carries the item, or a petrol pipe beside it. */
function canDeliver(t: Tower, n: TowerNeeds): boolean {
  const F = sim.factory, tile = tileOfCell(t.cx, t.cz);
  if (n.item && !F.facs.some((a) => a.type === 'arm' && armFront(a) === tile && (a.only ? a.only === n.item : offered(armBack(a)).includes(n.item!)))) return false;
  if (n.fluid) {
    const maker = MAKER[n.fluid];
    let ok = false;
    for (let d = 0; d < 6 && !ok; d++) {
      const [x, z] = neighbor(t.cx, t.cz, d), q = inBoard(x, z) ? F.facAt(x, z) : undefined;
      if (!q) continue;
      ok = q.type === maker || ((q.type === 'pipe' || q.type === 'ptunnel') && !!F.pipeNets[q.net]?.prod.some((pr) => pr.type === maker));
    }
    if (!ok) return false;
  }
  return true;
}
/**
 * The "Supplied by" and "Missing" lines of a panel, from the factory's diagnosis (empty in a free run): the buildings that
 * feed it and what it lacks as icons, each with the diagnosis' own words as its label.
 */
function diagLines(id: string, key: string) {
  const d = diagOf(key), box = $(id);
  const k = d ? `${key}|${d.from.join(',')}|${d.missing.join(',')}|${(d.why || []).join(',')}` : '';
  if (cache[id] === k) return;
  cache[id] = k;
  box.textContent = '';
  if (!d) return;
  if (d.from.length) {
    const b = el('b');
    for (const n of d.from) { const f = fromIcon(n); if (f) b.append(rchip(f, n.endsWith('(by belt)') ? 'belt' : n.endsWith('(by arm)') ? 'arm' : '', { label: n, state: 'ok' })); else b.append(el('em', '', n)); }
    box.append(el('span', '', 'Supplied by'), b);
  }
  // (only "a taker for its output" missing: the softer tone of the status line, not the red of a missing input)
  const soft = onlyTaker(d);
  if (d.missing.length) {
    const b = el('b', soft ? 'warn' : 'bad');
    for (const m of d.missing) {
      const icons = missIcons(m);
      if (!icons.length) b.append(el('em', '', m));
      for (const n of icons) b.append(rchip(n, '', { label: 'Missing: ' + m, state: soft ? undefined : 'missing' }));
    }
    b.setAttribute('aria-label', 'Missing: ' + d.missing.join(', '));
    box.append(el('span', soft ? 'warn' : 'bad', soft ? 'Unused' : 'Missing'), b);
    // the diagnosis in its own words: which hand-off is not there ("no Transfer Arm brings it iron ore")
    const why = (d.why || []).filter(Boolean);
    if (why.length) { const w = el('p', 'why' + (soft ? ' warn' : ''), why.map((x) => x[0].toUpperCase() + x.slice(1)).join('. ') + '.'); box.append(w); }
  }
}

// ---------- targeting ----------
const AIM_NONE: Partial<Record<TowerType, string>> = {
  beacon: 'Boosts towers in range: no target.', flame: 'Burns whatever crosses its fire: no target.', gravity: 'Pulls on everything in range: no target.',
};
/** the mode whose name and description the panel shows instead of the tower's own: the button under the pointer, with the focus or held by a finger */
let aimPeek: TargetMode | null = null;
const aimBtns = {} as Record<TargetMode, HTMLButtonElement>;
/** Set the selected tower's mode, or every tower's of its kind (`all`). The kind remembers it for the towers built next. */
function setAim(mode: TargetMode, all: boolean) {
  const t = selected ? sim.towerById(selected) : undefined;
  if (!t || !TARGETABLE[t.type] || !active()) return;
  const list = all ? sim.towers.filter((o) => o.type === t.type) : [t];
  let ok = true;
  for (const o of list) ok = act.aim(o.id, mode) && ok;
  if (!ok) return;
  aimPref[t.type] = mode;
  sound.play('click');
  if (all) {
    // "all of them" is a standing order: it is kept for later runs too
    store.aim[t.type] = mode; save();
    toast(`${list.length === 1 ? `The ${TOWERS[t.type].name}` : `All ${list.length} ${plural(TOWERS[t.type].name)}`} now target${list.length === 1 ? 's' : ''} ${TARGET_INFO[mode].name.toLowerCase()}. New ones will too.`);
  }
}
/** T / Shift+T: the selected tower's next or previous mode. */
function stepAim(d: number) {
  const t = selected ? sim.towerById(selected) : undefined;
  if (!t) return;
  if (!TARGETABLE[t.type]) { sound.play('error'); note(`${TOWERS[t.type].name}: ${(AIM_NONE[t.type] || 'no target.').toLowerCase()}`); return; }
  const n = TARGET_MODES.length;
  setAim(TARGET_MODES[(TARGET_MODES.indexOf(t.aim) + d + n) % n], false);
}
{
  const seg = $('t-aim-seg');
  let held = 0, heldAt = 0;
  for (const m of TARGET_MODES) {
    const b = el('button', 'aim-b') as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `${TARGET_INFO[m].name}: ${TARGET_INFO[m].desc}`);
    b.append(ic(`aim_${m}`, { size: 22 }));
    b.addEventListener('click', (e) => {
      // (a finger that held the button to read about the mode did not choose it)
      if (performance.now() - heldAt < 600) { heldAt = 0; return; }
      sound.init(); setAim(m, e.shiftKey);
    });
    b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') aimPeek = m; });
    b.addEventListener('pointerleave', () => { if (aimPeek === m) aimPeek = null; });
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) aimPeek = m; });
    b.addEventListener('blur', () => { if (aimPeek === m) aimPeek = null; });
    b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; clearTimeout(held); held = window.setTimeout(() => { aimPeek = m; heldAt = performance.now(); }, 380); });
    for (const ev of ['pointerup', 'pointercancel'] as const) b.addEventListener(ev, (e) => { if (e.pointerType !== 'touch') return; clearTimeout(held); if (aimPeek === m) { heldAt = performance.now(); setTimeout(() => { if (aimPeek === m) aimPeek = null; }, 1600); } });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    aimBtns[m] = b;
    seg.appendChild(b);
  }
  // the arrow keys walk the six modes (and do not pan the board while they do)
  seg.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0, i = TARGET_MODES.findIndex((m) => aimBtns[m] === document.activeElement);
    if (!d || i < 0) return;
    e.preventDefault(); e.stopPropagation();
    aimBtns[TARGET_MODES[(i + d + TARGET_MODES.length) % TARGET_MODES.length]].focus();
  });
  $('t-aim-all').addEventListener('click', () => { sound.init(); const t = selected ? sim.towerById(selected) : undefined; if (t) setAim(aimPeek || t.aim, true); });
}
/**
 * The enemy a tower is aiming at right now, by the sim's own rule (its private target pick, read here and changed nowhere),
 * or null: nothing in range, the tower is off, or it is a kind that takes no single target.
 */
function aimedAt(t: Tower): Enemy | null {
  // (not on a co-op guest: its replica has no road progress or lock-on to pick by, so it would mark the wrong enemy;
  // not on a tower out of supply: it holds its fire)
  if (!TARGETABLE[t.type] || isClient || towerOff(t) || sim.over) return null;
  const S = sim as unknown as { pickTarget?(t: Tower, range: number, min: number): Enemy | null; aimCmp?(m: TargetMode, a: Enemy, b: Enemy): number };
  const range = sim.range(t);
  if (t.type === 'lance' && t.tgt) { const e = sim.enemies.find((o) => o.id === t.tgt && o.alive); if (e) return e; }
  if (t.type === 'missile') {
    // (a Missile Battery fires at up to three: the first of them, flyers first while it is set to First)
    let best: Enemy | null = null;
    const val = (o: Enemy) => (ENEMIES[o.type].fly ? 1000 : 0) + o.dist - sim.map.lanes[o.lane].len;
    for (const o of sim.enemies) {
      if (!o.alive || o.type === 'mite' || Math.hypot(o.x - t.x, o.z - t.z) > range) continue;
      if (!best || (t.aim === 'first' ? val(o) > val(best) : S.aimCmp ? S.aimCmp.call(sim, t.aim, o, best) < 0 : false)) best = o;
    }
    return best;
  }
  return S.pickTarget ? S.pickTarget.call(sim, t, range, TOWERS[t.type].minRange || 0) : null;
}
/** The mode's icon on a small dark token, for the view to stand on the range ring (drawn once per mode from the icon's own paths). */
const aimTokens = new Map<TargetMode, HTMLCanvasElement>();
function aimToken(m: TargetMode): HTMLCanvasElement {
  let c = aimTokens.get(m);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // (a slim token: a dark glass disc with a hairline ring and tick marks, like the range ring it sits on)
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fillStyle = 'rgba(16, 14, 12, 0.6)'; g.fill();
  g.lineWidth = 1.6; g.strokeStyle = 'rgba(227, 220, 146, 0.7)'; g.stroke();
  g.lineWidth = 2; g.strokeStyle = 'rgba(227, 220, 146, 0.9)';
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; g.beginPath(); g.moveTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52); g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); g.stroke(); }
  g.translate(64 - 12 * 2.6, 64 - 12 * 2.6); g.scale(2.6, 2.6);
  for (const p of ic(`aim_${m}`).querySelectorAll('path')) {
    const d = new Path2D(p.getAttribute('d') || ''), fill = p.getAttribute('fill'), stroke = p.getAttribute('stroke');
    if (p.classList.contains('ic-key') || p.classList.contains('ic-cut') || p.classList.contains('ic-cut-line')) continue;
    if (fill && fill !== 'none') { g.globalAlpha = +(p.getAttribute('fill-opacity') || 1); g.fillStyle = fill; g.fill(d, 'evenodd'); }
    if (stroke) { g.globalAlpha = +(p.getAttribute('stroke-opacity') || 1); g.strokeStyle = stroke; g.lineWidth = +(p.getAttribute('stroke-width') || 1); g.setLineDash((p.getAttribute('stroke-dasharray') || '').split(' ').filter(Boolean).map(Number)); g.stroke(d); }
  }
  aimTokens.set(m, c);
  return c;
}
/** what the view's targeting marks were last told (the hook it reads them through is optional until it lands) */
const vAim = view as unknown as { setAimMark?(t: Tower | null, range?: number, glyph?: HTMLCanvasElement | null, e?: { x: number; y: number; z: number; r: number } | null): void };
/** The targeting block of the tower panel, and the marks in the world: the mode's token by the range ring, the bracket on the enemy aimed at. */
function updateAim(t: Tower | undefined) {
  if (!t || !TARGETABLE[t.type]) {
    vAim.setAimMark?.(null);
    if (t) { const k = 'none:' + t.type; if (cache.taim !== k) { cache.taim = k; show('t-aim', false); show('t-aim-none'); setText('t-aim-none', AIM_NONE[t.type] || 'No target.'); $('t-aim-now').textContent = ''; } }
    else cache.taim = '';
    return;
  }
  const e = sim.planning ? null : aimedAt(t);
  vAim.setAimMark?.(t, sim.range(t), aimToken(t.aim), e);
  const same = sim.towers.reduce((n, o) => n + (o.type === t.type ? 1 : 0), 0), peek = aimPeek || t.aim;
  const k = `${t.id}:${t.aim}:${peek}:${same}:${touchUi()}`;
  if (cache.taim === k) return;
  cache.taim = k;
  show('t-aim'); show('t-aim-none', false);
  const now = $('t-aim-now'); now.textContent = '';
  now.append(ic(`aim_${t.aim}`, { size: 16 }), el('span', '', TARGET_INFO[t.aim].name));
  now.setAttribute('aria-label', `Targets: ${TARGET_INFO[t.aim].name}`);
  for (const m of TARGET_MODES) { const b = aimBtns[m], on = m === t.aim; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  setText('t-aim-name', TARGET_INFO[peek].name);
  setText('t-aim-desc', TARGET_INFO[peek].desc);
  $('t-aim').classList.toggle('peek', peek !== t.aim);
  const all = $<HTMLButtonElement>('t-aim-all'), names = plural(TOWERS[t.type].name);
  all.setAttribute('aria-label', `Set every ${TOWERS[t.type].name} to ${TARGET_INFO[peek].name}`);
  all.title = `All ${same} ${same === 1 ? TOWERS[t.type].name : names} target ${TARGET_INFO[t.aim].name.toLowerCase()}, and the ones you build later${touchUi() ? '' : ' (or Shift+click a mode)'}`;
}
function updateTowerPanel() {
  const t = selected ? sim.towerById(selected) : undefined;
  if (!t) { selected = 0; if (!selFac) view.setSelected(null); cache.tdock = ''; }
  show('tower', !!t);
  updateAim(t);
  if (!t) return;
  dockPanel(String(t.id), 'tdock', t.x, t.h * 0.5, t.z);
  view.setSelected(t, sim.range(t));
  const d = TOWERS[t.type], sp = d.special;
  setText('t-name', `${d.name} / Mk ${t.lvl}`);
  const key = `${t.id}:${t.lvl}:${t.buff}:${sim.level}:${sim.towerDmg(t)}:${sim.towerRate(t)}:${sim.range(t)}:${t.spec > 0}:${t.down > 0}`;
  if (cache.tstats !== key) {
    cache.tstats = key;
    // the render of the tower beside its numbers as chips (each word is the chip's tooltip)
    const st = $('t-stats'); st.textContent = '';
    const row = t.type === 'beacon' ? el('div', 'stat-row') : statRow(d.dmg > 0 ? sim.towerDmg(t) : 0, sim.towerRate(t), 0, d.dmg <= 0);
    if (t.type === 'beacon') row.append(statChip('boost', `+${Math.round(sim.beaconBoost(t) * 100)}%`));
    if (d.range > 0) row.append(statChip('range', sim.range(t).toFixed(1)));
    if (t.buff > 0) row.append(statChip('boost', 'Beacon', 'Boosted by a Signal Beacon'));
    st.append(thumb('tower_' + t.type, 'thumb sm'), row);
  }
  // supply: what it runs on and how much it has (one item in hand plus the shots left of the one in use: an arm hands it the next)
  const n = needsOf(t), sup = $('t-sup');
  // (the rows are built once per tower and level; after that only their numbers change, so an icon under the pointer keeps its tooltip)
  const sk = sim.opts.free ? 'free' : `${t.id}|${t.lvl}|${t.ammo2}`;
  if (cache.tsup !== sk) {
    cache.tsup = sk; cache.tsupv = '';
    sup.textContent = '';
    if (sim.opts.free) sup.append(el('span', '', 'Supply'), el('b', '', 'not needed'));
    else for (const r of ['item', 'fluid', 'power'] as const) {
      if (!n[r]) continue;
      const name: IconName = r === 'power' ? 'power' : (n[r] as ItemType | FluidType), c = rchip(name, '', { label: iconLabel(name) });
      c.classList.add('s-' + r);
      sup.append(c, el('b', 's-' + r));
    }
  }
  if (!sim.opts.free) {
    // (between waves an empty tower is normal: the diagnosis below says whether it will be fed)
    const rows: [string, string, boolean][] = [];
    if (n.item) rows.push(['item', `${t.stock} in hand · ${Math.ceil(t.ammo)} shot${Math.ceil(t.ammo) === 1 ? '' : 's'}`, !sim.planning && t.stock <= 0 && t.ammo <= 0]);
    if (n.fluid) rows.push(['fluid', `${Math.round(t.tank)}/${TOWER_TANK}`, !sim.planning && t.tank < 1]);
    if (n.power) rows.push(['power', t.pwr <= 0 ? (sim.planning ? `needs ${n.power}` : `none of ${n.power}`) : `${Math.round(t.pwr * 100)}% of ${n.power}`, !sim.planning && t.pwr < 0.05]);
    const vk = rows.map((r) => r.join(':')).join('|');
    if (cache.tsupv !== vk) {
      cache.tsupv = vk;
      for (const [r, txt, bad] of rows) {
        const b = sup.querySelector('b.s-' + r), c = sup.querySelector('.ic-chip.s-' + r);
        if (b) { if (b.textContent !== txt) b.textContent = txt; b.classList.toggle('bad', bad); }
        if (c) c.classList.toggle('is-missing', bad);
      }
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
    $('t-special').title = touchUi() ? 'Or hold, or double-tap, the tower itself' : 'Or right-click the tower itself, selected or not';
  }
  // the second ammunition (Pulse Turret: plasma shells, Firewall: petrol): opened by its card, then a switch on each Mk3
  // tower. Reaching Mk3 changes nothing by itself, so a tower is converted when its new supply line stands.
  const l3 = sim.opts.free ? undefined : TOWER_NEEDS_L3[t.type], a2 = AMMO2_CARD[t.type], own = !!a2 && sim.taken(a2);
  const warn = l3 && own && t.lvl >= 3 && !t.ammo2 && !canDeliver(t, l3);
  const nk = l3 && a2 ? `${t.id}:${t.lvl}:${t.ammo2}:${own}:${warn}:${touchUi()}` : '';
  if (cache.tnext !== nk) {
    cache.tnext = nk;
    const box = $('t-next'), back = refocus(box); box.textContent = '';
    if (l3 && a2) {
      const first = TOWERS[t.type].needs, bonus = l3.dmg ? `+${Math.round((l3.dmg - 1) * 100)}% damage` : '';
      const what = l3.item ? ITEMS[l3.item].name.toLowerCase() : l3.fluid ? FLUIDS[l3.fluid].name.toLowerCase() : 'it';
      if (!own) {
        const r = rrow('Mk3 option', ...needChips(l3), cardChip(a2));
        r.classList.add('wrap', 'unlock');
        box.append(r, el('p', 'muted', `The ${CARD_BY_ID[a2].name} card lets a Mk3 switch to ${what}${bonus ? ` (${bonus})` : ''}. Upgrading alone never changes its supply.`));
      } else if (t.lvl < 3) {
        box.append(rrow('At Mk3', ...needChips({ item: first.item, fluid: first.fluid }), el('span', 'rl', 'or'), ...needChips(l3)), el('p', 'muted', `${CARD_BY_ID[a2].name}: at Mk3 a switch appears here. The upgrade itself keeps it on ${needsText({ item: first.item, fluid: first.fluid })}.`));
      } else {
        // the switch: what it runs on now is lit; the other side says what it would need
        const sw = el('div', 'ammo-sw');
        sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Ammunition of this tower');
        const side = (on: boolean, n: TowerNeeds, label: string) => {
          const b = el('button', 'ammo-b' + (t.ammo2 === on ? ' on' : '')) as HTMLButtonElement;
          b.type = 'button'; b.setAttribute('aria-pressed', String(t.ammo2 === on)); b.dataset.k = on ? 'a2' : 'a1';
          b.setAttribute('aria-label', `${label}${t.ammo2 === on ? ' (in use)' : ''}`);
          b.append(...needChips({ item: n.item, fluid: n.fluid }, { tab: false }), el('span', '', label));
          b.addEventListener('click', () => { sound.init(); if (t.ammo2 !== on && selected === t.id && act.ammo2(t.id, on)) sound.play('click'); });
          return b;
        };
        const cap1 = (x: string) => x[0].toUpperCase() + x.slice(1), short = (n: TowerNeeds) => cap1(needsText({ item: n.item, fluid: n.fluid }));
        sw.append(side(false, first, short(first)), side(true, l3, short(l3) + (l3.dmg ? ` +${Math.round((l3.dmg - 1) * 100)}%` : '')));
        box.append(sw);
        if (warn) box.append(el('p', '', l3.item ? `No Transfer Arm brings ${what}s here yet: switched now, it stands empty.` : `No ${what} pipe reaches it yet: switched now, it stands empty.`));
        else box.append(el('p', 'muted', t.ammo2 ? 'Switching back drops what it holds.' : 'Switching drops what it holds.'));
      }
    }
    back();
  }
  const up = $<HTMLButtonElement>('t-up');
  setText('t-up', t.lvl >= 3 ? 'Max level' : `Upgrade${touchUi() ? '' : ' (U)'} - ${sim.upCost(t)}${sim.upMat(t) ? ` +${sim.upMat(t)}m` : ''}`);
  up.disabled = t.lvl >= 3 || sim.gold < sim.upCost(t) || sim.mats < sim.upMat(t);
  setText('t-sell', `Sell${touchUi() ? '' : ' (X)'} +${sim.sellValue(t)}${sim.sellMats(t) ? ` +${sim.sellMats(t)}m` : ''}`);
  setText('t-note', '');
}

const FAC_STATE: Record<string, string> = {
  ok: 'Working', idle: 'Idle', nopower: 'No power: build a Pole or Generator within 2 tiles', noinput: 'Waiting for input', nofuel: 'No fuel: it needs coal', full: 'Output full: no Transfer Arm takes it', empty: 'Empty', nodeposit: 'Not on a deposit',
};
/** Inventory line: item counts. */
const invText = (inv: Partial<Record<ItemType, number>>) => Object.entries(inv).filter(([, n]) => n && n > 0).map(([k, n]) => `${n} ${ITEMS[k as ItemType].short}`).join(', ') || 'empty';
/** The same as icons with counts (nothing for an empty store: the words say "empty"). */
type Counted = [IconName, number | string][];
const invIcons = (inv: Partial<Record<ItemType, number>>): Counted => Object.entries(inv).filter(([, n]) => n && n > 0).map(([k, n]) => [k as ItemType, n as number]);
/** What a belt, splitter or tunnel carries: each item once, with how many. */
function carried(items: { it: ItemType }[]): Counted {
  const m = new Map<ItemType, number>();
  for (const i of items) m.set(i.it, (m.get(i.it) || 0) + 1);
  return [...m];
}
/** The recipe of a building as one row of chips per product: what goes in, an arrow, what comes out, the power it draws. */
function recipeRows(f: Fac): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const st of recipes()) {
    if (st.fac !== f.type || (st.on && f.ore && st.on !== f.ore)) continue;
    const r = rrow('');
    if (st.on) r.append(rchip(`dep_${st.on}`));
    for (const i of st.inp) r.append(rchip(i.res, i.n > 1 ? i.n : ''));
    if (st.fuel) r.append(rchip(st.fuel.res, '1/' + st.fuel.per, { label: `${ITEMS[st.fuel.res].name}: one for every ${st.fuel.per}` }));
    r.append(arrow(), rchip(st.out, st.rate ? st.n + '/s' : st.n > 1 ? st.n : ''));
    if (st.power) r.append(rgrp('draws', rchip('power', st.power)));
    rows.push(r);
  }
  return rows;
}
const per = (sec: number, what: string) => `${what} every ${sec.toFixed(1)}s`;
/** How fast a building works at a level (with the factory cards), in words. '' for what has no speed. */
function workRate(f: Fac, lvl: number): string {
  const k = FAC_LVL_SPEED[clamp(lvl - 1, 0, FAC_LVL_SPEED.length - 1)], m = sim.mods;
  switch (f.type) {
    case 'mine': return per(MINE_TIME / (m.mine * k), f.ore && f.ore !== 'oil' ? ITEMS[f.ore as ItemType].short : 'ore');
    case 'arm': return `${Math.round((60 * k) / ARM_TIME)} items a minute`;
    case 'pump': return `${(PUMP_RATE * m.mine * k).toFixed(1)} crude/s`;
    case 'smelter': return per(SMELT_TIME / (m.craft * k), 'a plate');
    case 'refinery': return `${REFINE_OUT} petrol every ${(REFINE_TIME / (m.craft * k)).toFixed(1)}s`;
    case 'generator': return `${Math.round(GEN_POWER * m.gen * k)} power`;
    case 'works': case 'press': case 'cells': case 'missiles': { const r = MAKES[f.type]!; return per(r.time / (m.craft * k), r.out ? `a ${ITEMS[r.out].short}` : 'a material'); }
  }
  return '';
}
/** The grid lines of a pole's or generator's panel: generators and their fuel, consumers, need at full load, and a warning when short. */
function gridLines(f: Fac, lines: [string, string, Counted?][]) {
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
/** What a deposit is good for, in words (the label of the icon row that shows it). */
function oreUse(o: OreType): string {
  const raw = oreRaw(o), name = o === 'oil' ? FLUIDS.crude.name : ITEMS[o].name;
  return `${name}: a ${FACS[oreFac(o)].name} brings it up. ${takersText(raw)}`;
}
/** A deposit's use as icons: the building that goes on it, what that gives, and the towers and buildings that take it. */
function oreUseRow(o: OreType, tab: boolean): HTMLElement[] {
  const raw = oreRaw(o), u = takers(raw), opt = { tab };
  const first = rrow('', rchip(`fac_${oreFac(o)}`, '', opt), arrow(), rchip(raw, '', opt));
  const feeds = rrow('Feeds');
  for (const t of u.tw) feeds.append(rchip(`tw_${t}`, '', opt));
  // (a Mk3 runs on it only with its ammo card: the label says which)
  for (const t of u.tw3) { const c = AMMO2_CARD[t]; feeds.append(rchip(`tw_${t}`, 'Mk3', { ...opt, rt: `tower:${t}:3`, label: `${TOWERS[t].name} Mk3${c ? `, with the ${CARD_BY_ID[c].name} card` : ''}` })); }
  for (const f of u.fac) feeds.append(rchip(`fac_${f}`, '', opt));
  first.setAttribute('aria-label', oreUse(o));
  return [first, feeds];
}
/** Where the building for a deposit is ("Pick the Mine in the Factory bar."), or why it cannot be built yet. `why` is the short reason alone. */
function oreBuildLine(o: OreType): { text: string; locked: boolean; why: string } {
  const k = oreFac(o), locked = !sim.facs.has(k);
  if (!locked) return { text: `Pick the ${FACS[k].name} in the Factory bar.`, locked, why: '' };
  const why = unlockText(k);
  return { text: `The ${FACS[k].name} is locked: it ${why}.`, locked, why };
}
// The building that goes on the deposit under the pointer or in the panel is pointed out on the Factory bar: its button
// takes an animated apricot frame (a locked one shows, hatched; the panel and the tooltip say why it is locked). The bar
// never switches by itself: with the Towers tab open the Factory TAB pulses instead, and a press on it (or on the deposit
// panel's pick line) opens it.
function facCue(k: FacType | null, _panel: boolean, _dt: number) {
  const tabCue = !!k && barTab !== 'factory';
  if (cache.tabcue !== String(tabCue)) { cache.tabcue = String(tabCue); $('tab-factory').classList.toggle('cue', tabCue); }
  if (!k) {
    if (cue.k) { facBtns[cue.k].classList.remove('cue'); cue.k = ''; }
    return;
  }
  const b = facBtns[k];
  if (cue.k !== k) {
    if (cue.k) facBtns[cue.k].classList.remove('cue');
    cue.k = k; b.classList.add('cue');
    // bring it into view on a bar that scrolls
    const bar = $('fbuild'), l = b.offsetLeft - bar.offsetLeft, r = l + b.offsetWidth;
    if (l < bar.scrollLeft) bar.scrollLeft = l - 8; else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 8;
  }
}
/** The name line: the deposit's icon and its name. */
function oreHead(box: HTMLElement, o: OreType, tag = 'b') {
  const h = el(tag, 'ore-name');
  h.append(ic(`dep_${o}`, { size: 20 }), ORES[o].name);
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
      tip.append(...oreUseRow(ho, false), el('i', bl.locked ? 'lock' : 'needs', bl.text), el('i', '', `Patch: ${tiles.length} tile${tiles.length === 1 ? '' : 's'}.`));
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
      $<HTMLImageElement>('o-thumb').src = `./media/sm/dep_${so.replace('_ore', '')}.jpg`;
      const use = $('o-use'); use.textContent = ''; use.append(...oreUseRow(so, true));
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
  { const src = `./media/sm/fac_${f.type}.jpg`; if (cache.fthumb !== src) { cache.fthumb = src; $<HTMLImageElement>('f-thumb').src = src; } }
  setText('f-name', d.name + (upg ? ` / Mk ${f.lvl}` : '') + (f.ore && (f.type === 'mine' || f.type === 'pump') ? ` / ${ORES[f.ore].name}` : ''));
  // between waves nothing runs: the state is what the diagnosis expects, not what the last step left behind
  const dg = diagOf('f' + f.id), arm = f.type === 'arm', armWhy = arm ? sim.factory.armNote(f) : '';
  const up1 = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);
  const [stTxt, stCls] = plan && f.type !== 'crate'
    ? dg ? (dg.ok ? [arm ? 'Build phase: will carry when the wave starts' : 'Build phase: will work when the wave starts', 'ok'] : arm ? ['Build phase: ' + (dg.why?.[0] || 'will have nothing to do'), 'bad'] : onlyTaker(dg) ? ['Build phase: no Transfer Arm takes its output', 'warn'] : ['Build phase: will lack an input', 'bad']) : ['Build phase: time stands still', 'warn']
    : arm ? [f.hand && f.state !== 'full' ? `Carrying ${ITEMS[f.hand].short}` : armWhy ? up1(armWhy) : f.state === 'ok' ? 'Working' : 'Waiting', f.state === 'ok' ? 'ok' : dg && !dg.ok ? 'bad' : 'warn']
    : [f.type === 'crate' && f.state === 'ok' ? 'Feeding the towers beside it' : FAC_STATE[f.state] || f.state, f.state === 'ok' ? 'ok' : f.state === 'idle' || f.state === 'full' || f.state === 'noinput' ? 'warn' : 'bad'];
  setText('f-state', stTxt);
  if ($('f-state').className !== stCls) $('f-state').className = stCls;
  const mk = `${f.id}:${f.ore || ''}`;
  if (cache.fmake !== mk) { cache.fmake = mk; const box = $('f-make'); box.textContent = ''; box.append(...recipeRows(f)); }
  updateArmBlock(arm ? f : null);
  const st = $('f-stats');
  const lines: [string, string, Counted?][] = [];
  const rate = workRate(f, f.lvl), uc = sim.facUpCost(f);
  if (rate) lines.push(['Speed', rate]);
  if (rate && uc) lines.push([`Mk ${f.lvl + 1}`, workRate(f, f.lvl + 1)]);
  switch (f.type) {
    case 'belt': case 'splitter': lines.push(['Carrying', f.items.map((i) => ITEMS[i.it].short).join(', ') || 'nothing', carried(f.items)]); break;
    case 'tunnel': {
      const o = f.pair ? sim.factory.facById(f.pair) : undefined;
      lines.push(['End', o ? `${f.exit ? 'exit' : 'entrance'}, ${hexDist(f.cx, f.cz, o.cx, o.cz)} tiles from its ${f.exit ? 'entrance' : 'exit'}` : `unpaired: build its partner facing the same way within ${TUNNEL_REACH} tiles`]);
      if (o && !f.exit) lines.push(['Underground', f.items.map((i) => ITEMS[i.it].short).join(', ') || 'nothing', carried(f.items)]);
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
      if (f.type === 'generator') lines.push(['Fuel', `${invText(f.inv)}, ${Math.max(0, f.fuel).toFixed(0)}s burning`, [...invIcons(f.inv), ['time', Math.max(0, f.fuel).toFixed(0) + 's']]]);
      lines.push(['Reach', `wires to poles within ${POLE_REACH} tiles, powers what is within ${SUPPLY}`]);
      break;
    }
    case 'arm': lines.push(['In hand', f.hand ? ITEMS[f.hand].short : 'nothing', f.hand ? [[f.hand, '']] : []]); break;
    case 'mine': lines.push(['Output', f.out.length ? `${f.out.length}/${OUT_CAP} waiting` : 'none waiting']); break;
    case 'pump': lines.push(['Crude', `${Math.round(f.tout)}/${TANK}`], ['Power', `${Math.round(f.pwr * 100)}%`]); break;
    case 'smelter': lines.push(['Input', invText(f.inv), invIcons(f.inv)], ['Output', f.out.length ? `${f.out.length}/${OUT_CAP} plates waiting` : 'none waiting']); break;
    case 'works': case 'press': case 'cells': case 'missiles': {
      const r = MAKES[f.type]!;
      lines.push(['Input', invText(f.inv) + (r.fluid ? `, ${Math.round(f.tin)} ${FLUIDS[r.fluid[0]].name.toLowerCase()}` : ''), [...invIcons(f.inv), ...(r.fluid ? [[r.fluid[0], Math.round(f.tin)] as [IconName, number]] : [])]]);
      if (r.out) lines.push(['Output', f.out.length ? `${f.out.length}/${OUT_CAP} waiting` : 'none waiting']);
      else lines.push(['Materials', `${Math.floor(sim.mats)} in store`]);
      lines.push(['Power', `${Math.round(f.pwr * 100)}%`]);
      break;
    }
    case 'crate': lines.push(['Holds', f.hold ? `${f.left} ${ITEMS[f.hold].short}` : 'nothing', f.hold ? [[f.hold, f.left]] : []]); break;
    case 'refinery': lines.push(['Crude', `${Math.round(f.tin)}/${TANK}`], ['Petrol', `${Math.round(f.tout)}/${TANK}`], ['Power', `${Math.round(f.pwr * 100)}%`]); break;
  }
  const lk = lines.map((l) => l[0] + ':' + l[1]).join('|');
  if (cache.fstats !== lk) {
    cache.fstats = lk; st.textContent = '';
    // (a line that counts items shows them as icons with their numbers; its words stay as the label)
    for (const [k, v, cs] of lines) {
      const b = el('b', k === 'Short' ? 'bad' : '', cs && cs.length ? '' : v);
      if (cs && cs.length) { b.setAttribute('aria-label', v); for (const [n, q] of cs) b.append(rchip(n, q, { tab: false, state: 'plain' })); }
      st.append(k + ' ', b, el('br'));
    }
  }
  diagLines('f-diag', 'f' + f.id);
  // levels: what the next one costs and how fast it would work
  show('f-up', upg);
  if (upg) {
    setText('f-up', uc ? `Upgrade${touchUi() ? '' : ' (U)'} - ${uc}` : 'Max level');
    $<HTMLButtonElement>('f-up').disabled = !uc || sim.gold < uc;
  }
  show('f-turn', turns(f.type));
  show('f-flip', arm);
  setText('f-turn', touchUi() ? 'Turn' : 'Turn (R)');
  setText('f-sell', `Remove${touchUi() ? '' : ' (X)'}${sim.facSellValue(f.id) ? ` +${sim.facSellValue(f.id)}` : ''}`);
  $<HTMLButtonElement>('f-sell').disabled = f.type === 'crate' && f.left > 0;
  setText('f-desc', d.desc);
}

/** What stands on a tile, as an icon and a name (a tower, a building), or null for an empty one. */
/**
 * Before a panel box is rebuilt: returns a function that, called after, puts the keyboard focus back on the button with
 * the same data-k if one in the box had it (a click on a switch rebuilds the box; the focus must not fall to the page).
 */
function refocus(box: HTMLElement): () => void {
  const a = document.activeElement;
  const k = a instanceof HTMLElement && box.contains(a) ? a.dataset.k : undefined;
  return () => { if (!k) return; for (const b of box.querySelectorAll<HTMLElement>('[data-k]')) if (b.dataset.k === k) { b.focus(); return; } };
}
function thingAt(tile: number): { icon: IconName; name: string } | null {
  if (tile < 0) return null;
  const cx = tile % GW, cz = Math.floor(tile / GW), t = sim.towers.find((o) => o.cx === cx && o.cz === cz);
  if (t) return { icon: `tw_${t.type}`, name: TOWERS[t.type].name };
  const q = sim.factory.facAt(cx, cz);
  return q ? { icon: `fac_${q.type}` as IconName, name: FACS[q.type].name } : null;
}
/**
 * The Transfer Arm's part of the building panel: what stands behind it and in front of it (so its direction reads without
 * a compass), the kinds of item its source can bring, and the filter: any of them, or one kind only.
 */
const armPre = { key: '', t: 0 };
function updateArmBlock(f: Fac | null) {
  const box = $('f-arm');
  if (!f) { if (cache.farm) { cache.farm = ''; armPre.key = ''; box.textContent = ''; show('f-arm', false); } return; }
  // (what arrives at its back is a walk over the graph: only when the layout changed, else twice a second for crates running out)
  const pre = `${f.id}:${f.dir}:${f.only}:${sim.factory.rev}:${sim.towers.length}`, now = performance.now();
  if (pre === armPre.key && now - armPre.t < 500) return;
  armPre.key = pre; armPre.t = now;
  const b = armBack(f), fr = armFront(f), src = thingAt(b), dst = thingAt(fr), items = offered(b);
  if (f.only && !items.includes(f.only)) items.push(f.only);
  const key = `${f.id}:${f.dir}:${f.only}:${src?.icon}:${dst?.icon}:${items.join()}`;
  if (cache.farm === key) return;
  cache.farm = key;
  const back = refocus(box);
  box.textContent = '';
  const none = (what: string) => { const e = el('span', 'cchip locked', what); return e; };
  const route = rrow('Takes from', src ? rchip(src.icon, '', { label: `Takes from the ${src.name} behind it` }) : none('empty tile'), arrow(), rchip('fac_arm', '', { label: 'This arm' }), arrow());
  route.append(rgrp('into', dst ? rchip(dst.icon, '', { label: `Delivers into the ${dst.name} in front of it` }) : none('empty tile')));
  route.classList.add('wrap');
  box.append(route);
  // the filter: what comes by at its back, as buttons; "Any" lets through whatever the target takes
  const fl = el('div', 'arm-filter');
  fl.setAttribute('role', 'group'); fl.setAttribute('aria-label', 'Which items this arm takes');
  const btn = (it: ItemType | null) => {
    const on = f.only === it, x = el('button', 'ammo-b' + (on ? ' on' : '')) as HTMLButtonElement;
    x.type = 'button'; x.setAttribute('aria-pressed', String(on)); x.dataset.k = it || 'any';
    x.setAttribute('aria-label', it ? `Only ${ITEMS[it].name}` : 'Any item its target takes');
    if (it) { x.append(ic(it, { size: 20 })); x.title = `Only ${ITEMS[it].name}`; } else x.append(el('span', '', 'Any'));
    x.addEventListener('click', () => { sound.init(); if (selFac === f.id && f.only !== it) act.armFilter(f.id, it); });
    return x;
  };
  fl.append(btn(null), ...items.map((it) => btn(it)));
  box.append(rrow('Filter'), fl);
  box.append(el('p', 'muted small', !src ? 'Nothing stands behind it: turn it, or build its source there.' : !items.length ? 'Nothing arrives at its back yet.' : f.only ? `It takes only ${ITEMS[f.only].name.toLowerCase()} and leaves the rest${src.icon === 'fac_belt' ? ' on the belt' : ''}.` : 'It takes whatever its target will accept right now, so nothing jams in its hand.'));
  show('f-arm');
  back();
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
 * Beat level for the view: the built-in score's own beats, or a clock at the BPM of the player's music.
 * The music module ties that clock to the track position (Spotify, YouTube), the listener or the last tap,
 * and switches the BPM with every track.
 */
function beatLevel(): number {
  if (!music.isExternalPlaying()) return sound.beatLevel();
  const bpm = music.bpm();
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0 || !music.beatOn()) return 0;
  const ph = music.beatPhase(performance.now());
  if (ph === null) return 0;
  return Math.exp(-ph * (60 / clamp(bpm, 30, 300)) * 5.5);
}

function frame(dt: number) {
  if (CAPTURE) sound.clock += dt;
  diagFrame(dt);
  rtFrame();
  rotSync();
  if (!paused) titanCamera(dt);
  guideFrame(dt);
  sheetFrame(dt);
  if (titanCue > 0 && !paused) { titanCue -= dt; if (titanCue <= 0) titanSay(); }
  if (!paused) {
    acc += dt * (mode === 'attract' ? 1.4 : speed) * titanSlow();
    let n = 0;
    const cap = dt > 0.2 ? 70 : 10; // a hidden tab is stepped in big chunks so a multiplayer match keeps running
    while (acc >= STEP && n < cap) { bot?.step(STEP); if (!isClient) { career?.beforeStep(sim, STEP); sim.step(STEP); } acc -= STEP; n++; }
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
  if (mode !== 'attract') { logEvents(evs, sim.time); careerFrame(evs); }
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
  // and drops to its calm arrangement while time stands still between waves (the planning phase)
  sound.calm = mode !== 'attract' && !ended && sim.planning;
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
  await initCareer();
  startAttract();
  if (params.get('mode') === 'solo') startGame('solo');
  // back from the Spotify sign-in: show the Music sheet again, where the connection is
  void music.returnedFromSpotify().then((back) => { if (back && mode === 'attract' && shown('menu')) openMusic('menu'); });
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__dbg = {
      get sim() { return sim; }, view, act, startGame, sound, diag, zoomS, touch: touchApi, music,
      /** saves, the run archive and achievements */
      get career() { return career; },
      /** the tutorial: its step and the turret / mine / belt chain it points at */
      get guide() { return { on: guide.on, i: guide.i, n: GUIDE.length, title: guide.on ? GUIDE[guide.i].title : '', text: guide.on ? GUIDE[guide.i].text() : '', lines: guide.on ? guideLines() : [], first: guide.on ? firstTurret() : null, belt: guide.on && sim.facs.has('belt') ? beltPlan() : null, marks: guidePoints(), cam: guideCam.on, fold: $('guide').classList.contains('fold') }; },
      /** fire a tower's special as a right-click on it does */
      quickSpecial, towerAtScreen,
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
