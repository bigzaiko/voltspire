// BEATSPIRE - game controller: input, HUD, menus, saved progress, multiplayer glue.
// The fonts, style.css, editor.css, touch.css and music.css are linked from play.html, so the page never shows unstyled.
import * as THREE from 'three';
import { GW, GH, TOWERS, TOWER_TYPES, ENEMIES, ENEMY_TYPES, CARD_BY_ID, RARITY, BOW_TIERS, MAX_ENERGY, SQUADS, worldToCell } from './game/data.ts';
import type { TowerType, EnemyType } from './game/data.ts';
import { Sim, SKILL_CD, nodePos, raySphere, TITAN_STUN } from './game/sim.ts';
import * as simMod from './game/sim.ts';
import type { Ev, Mode, Tower } from './game/sim.ts';
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
interface Rec { wave: number; wins: number; time: number; surv: number }
interface Store {
  v: 2;
  settings: { vol: number; mus: number; sens: number; q: 'high' | 'low'; friction: boolean };
  fx: { impact: boolean; beat: boolean; borders: boolean; env: boolean; towers: boolean; intensity: number; color: FxColor; custom: string };
  /** filter: which layouts the map picker shows (0 all, 1 to 3 one tier) */
  setup: { survival: boolean; source: 'premade' | 'generated'; map: string; mapName: string; seed: number; tier: number; tierAuto: boolean; diff: string; filter: number };
  /** per map and difficulty, keyed "<map id>|<difficulty id>" */
  records: Record<string, Rec>;
  tips: { node: boolean; boss: boolean; mite: boolean; titan: boolean };
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
    settings: { vol: int(s.vol, 0, 100, 70), mus: int(s.mus, 0, 100, 50), sens: int(s.sens, 20, 200, 100), q: s.q === 'low' ? 'low' : 'high', friction: bool(s.friction, true) },
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
    tips: { node: bool(t.node, false), boss: bool(t.boss, false), mite: bool(t.mite, false), titan: bool(t.titan, false) },
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
  frameMap?(bottom?: number): unknown; camera?: { position: { x: number; y: number; z: number } };
};
/** The bird camera. rot turns it around the point it looks at; the view works out the tilt from dist. */
const bird = () => view.cam as { x: number; z: number; dist: number; rot?: number };
// Parts of the sim that are being added separately (the bow draw, the wave call bonus). Optional until they land.
const simX = simMod as unknown as { DRAW_TIME?: unknown; MIN_DRAW?: unknown };
const DRAW_TIME = typeof simX.DRAW_TIME === 'number' && simX.DRAW_TIME > 0 ? simX.DRAW_TIME : 0.6;
const MIN_DRAW = typeof simX.MIN_DRAW === 'number' ? simX.MIN_DRAW : 0.2;
type SimX = {
  heroAim?(pi: number, drawing: boolean, tx: number, ty: number, tz: number): void;
  heroFire?(pi: number, tx: number, ty: number, tz: number): void;
  callBonus?(): number;
};
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
/** speed is the one the player chose. The Uplink always runs at 1x and the choice comes back afterwards. */
let paused = false, speed = 1, acc = 0;
let buildType: TowerType | null = null, selected = 0;
let dragging = false, rotating = false;
/** The bow is being drawn: left mouse button held, or a finger on the touch Draw button. Letting go looses the arrow. */
let mouseFire = false, touchFire = false;
/** mouse buttons that are down right now (the bit mask of MouseEvent.buttons) */
let mouseBtns = 0;
/** the run was started with "Test play" in the map editor */
let editorRun = false;
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
// Damage numbers come from a fixed pool of elements that are only moved and re-animated, never created or
// removed during a fight, and only a few plain numbers start per frame. A burst of hits costs no layout work.
const DMG_POOL = 28, DMG_PER_FRAME = 5;
const dmgPool: { el: HTMLElement; anim: Animation | null }[] = [];
let dmgFrame = 0, dmgSteal = 0;
const DMG_PLAIN = [{ transform: 'translateY(0) scale(1.3)', opacity: 1 }, { transform: 'translateY(-46px) scale(0.9)', opacity: 0 }];
const DMG_CRIT = [{ transform: 'translateY(0) scale(1.7)', opacity: 1 }, { transform: 'translateY(-22px) scale(1.25)', opacity: 1, offset: 0.25 }, { transform: 'translateY(-70px) scale(1.05)', opacity: 0 }];
/** Show a number at the hit. Returns its pool slot, or -1 when it was skipped. */
function dmgNumber(e: Ev, crit = false): number {
  if (!crit && dmgFrame >= DMG_PER_FRAME) return -1;
  if (typeof e.n !== 'number' || !Number.isFinite(e.n)) return -1;
  const [x, y, ok] = view.project(e.x, e.y + 0.4, e.z);
  if (!ok) return -1;
  let i = dmgPool.findIndex((q) => !q.anim);
  if (i < 0) {
    if (dmgPool.length < DMG_POOL) { const span = el('span'); $('dmg').appendChild(span); i = dmgPool.push({ el: span, anim: null }) - 1; }
    else if (crit) { i = dmgSteal = (dmgSteal + 1) % DMG_POOL; dmgPool[i].anim?.cancel(); }
    else return -1;
  }
  const q = dmgPool[i];
  q.el.textContent = String(Math.round(e.n));
  q.el.className = crit ? 'crit' : '';
  q.el.style.translate = `${(x + (Math.random() - 0.5) * 24).toFixed(0)}px ${y.toFixed(0)}px`;
  const an = q.el.animate(crit ? DMG_CRIT : DMG_PLAIN, { duration: crit ? 950 : 650, easing: 'ease-out' });
  q.anim = an;
  an.onfinish = an.oncancel = () => { if (q.anim === an) q.anim = null; };
  if (!crit) dmgFrame++;
  return i;
}

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
function towerTip(t: TowerType) {
  const d = TOWERS[t], tip = $('tip');
  tip.textContent = '';
  const stats = d.dmg > 0 ? ` Damage ${d.dmg}, ${d.rate} per second, range ${d.range}.` : d.range > 0 ? ` Range ${d.range}.` : '';
  tip.append(el('b', '', d.name), el('span', '', d.desc + stats));
  if (d.special) tip.append(el('i', '', `Special: ${d.special.name}. ${d.special.desc}`));
  if (!sim.unlocked.has(t)) tip.append(el('i', 'lock', 'Locked. Find its blueprint card to build it.'));
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
  // A tooltip opens when the mouse moves over the button, not when a button appears under a resting pointer.
  // Fingers have no hover: the tooltip of the tower picked for building is shown instead.
  b.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch' && (e.movementX || e.movementY)) tipHover = t; });
  b.addEventListener('pointerleave', () => { if (tipHover === t) tipHover = null; });
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
// A fresh offer cannot be taken for a moment (the bar under the heading drains), and not before the mouse button
// and the keys 1 to 3 have been let go once. A click or key press meant for the fight never picks a card unread.
const CARD_GUARD_MS = 900;
let cardAt = 0, cardFree = false, cardArmed = false, guardAnim: Animation | null = null;
function armCards() {
  if (cardArmed) return;
  if (!cardFree && !mouseBtns && !touchFire && !keys.has('1') && !keys.has('2') && !keys.has('3')) cardFree = true;
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
    d.append(el('kbd', '', String(i + 1)), el('div', 'ci', c.icon), el('div', 'rar', RARITY[c.rar]), el('h4', '', c.name), el('p', '', c.desc), el('div', 'kind', c.needs ? TOWERS[c.needs].name : c.kind === 'eco' ? 'economy' : c.kind === 'tower' ? 'all towers' : c.kind === 'hero' ? 'Kestrel' : c.kind));
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
  unlockPointer();
}
function pickCard(i: number) {
  const p = sim.players[me];
  if (!cardArmed || !cardKey || cardKey.startsWith('sent:') || !p.pending.length || i >= p.pending[0].length) return;
  cardKey = 'sent:' + cardKey;
  const more = p.pending.length > 1;
  show('cards', false);
  act.card(i);
  sound.play('card');
  if (heroOn() && !more) lockPointer(); // with another offer waiting the mouse stays free for it
}

// ---------- events ----------
const SHOT_SOUND: Record<string, string> = { pulse: 'shot', arc: 'arcshot', mortar: 'mortar', rail: 'rail', missile: 'missile' };
/**
 * Play an effect where it happens. In the bird view things near the middle of the picture are at full level and it
 * falls off toward the edge of what the camera sees (and a little when zoomed far out); in the Uplink the distance
 * from Kestrel counts. Left and right follow the screen.
 */
function playAt(name: string, e: Ev) {
  let g = 1, pan = 0;
  if (fin(e.x) && fin(e.z)) {
    if (heroOn()) { const o = sim.heroOrigin(me); if (o) g = clamp(1.25 - Math.hypot(e.x - o.x, e.z - o.z) / 46, 0.35, 1); }
    else { const c = bird(), d = Math.hypot(e.x - c.x, e.z - c.z); g = clamp(1.2 - d / (c.dist * 1.1), 0.4, 1) * (1 - 0.25 * clamp((c.dist - 40) / 44, 0, 1)); }
    const [sx, , ok] = view.project(e.x, fin(e.y) ? e.y : 0, e.z);
    if (ok) pan = clamp((sx / Math.max(1, innerWidth)) * 2 - 1, -1, 1) * 0.6;
  }
  sound.play(name, g, pan);
}
/** seconds until the Overlink fanfare plays (it follows the Titan's impact) */
let overlinkCue = 0;
function handleEvents(evs: Ev[]) {
  view.handle(evs);
  const quiet = mode === 'attract';
  if (quiet) return;
  let lastDmg: { slot: number; n: number } | null = null;
  dmgFrame = 0;
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
      case 'arrow': sound.play('arrow'); break;
      case 'rail': if (e.big) sound.play('bigshot'); break;
      case 'skill': sound.play(e.s === 1 ? 'rain' : 'sing'); break;
      case 'shieldbreak': playAt('shield', e); break;
      case 'build': playAt('build', e); break;
      case 'sell': playAt('sell', e); break;
      case 'tele': sound.play('tele'); if (e.p === me) { flash(); faceEnemies(); } break;
      case 'dmg': if (e.p === me && heroOn()) lastDmg = { slot: dmgNumber(e), n: e.n }; break;
      case 'crit': {
        // A weak-point hit. The sim also reports the same damage as a plain 'dmg' just before: show the crit instead.
        if (!heroOn()) break;
        const mine = !!lastDmg && Math.abs(lastDmg.n - e.n) <= 1;
        if (mine) { if (lastDmg!.slot >= 0) dmgPool[lastDmg!.slot].anim?.cancel(); lastDmg = null; }
        if (mine || mode !== 'coop' || isClient) { dmgNumber(e, true); sound.play('crit'); }
        break;
      }
      case 'special': {
        playAt('special', e);
        const d = typeof e.t === 'string' && Object.hasOwn(TOWERS, e.t) ? TOWERS[e.t as TowerType] : null;
        if (d?.special && e.p === me) toast(`${d.special.name} fired. ${d.name} reboots afterwards.`);
        break;
      }
      case 'down': playAt('down', e); break;
      case 'up': playAt('up', e); break;
      case 'heroOn':
        sound.play('heroOn');
        if (e.p === me) { flash(); document.body.classList.add('hero'); show('herohud'); setText('btn-speed', '1x'); buildType = null; selected = 0; rotating = false; dragging = false; edgeArmed = false; heroSince = performance.now(); zoomS.on = false; keyV.x = keyV.y = keyV.r = 0; view.setGhost(null); view.setSelected(null); view.setHover(0, 0, false); faceEnemies(); }
        else toast('Your partner uplinked.');
        break;
      case 'heroOff':
        sound.play('heroOff');
        // the chosen game speed comes back, and the next full charge announces itself again
        if (e.p === me) { flash(); document.body.classList.remove('hero'); show('herohud', false); mouseFire = false; aimSentDraw = false; localDraw = 0; readyShown = false; setText('btn-speed', speed + 'x'); view.setTele(null); unlockPointer(); }
        break;
      case 'wave': {
        const tier = sim.tier, last = sim.campaign && e.n >= sim.winWave, newBow = tier !== lastTier;
        if (newBow) { lastTier = tier; toast(`${BOW_TIERS[tier].name}: ${BOW_TIERS[tier].perk}`); }
        // the Titan's wave is announced by its landing
        if (sim.titan && sim.titan.wave === e.n && sim.titan.phase !== 'dead' && sim.titan.phase !== 'none' && sim.titan.phase !== 'far') break;
        sound.play('wave');
        const sub = last ? 'Final wave' : e.n % 5 === 0 ? 'Colossus inbound' : e.n >= 8 && e.n % 5 === 3 ? 'Gyre inbound' : newBow ? `New bow: ${BOW_TIERS[tier].name}` : '';
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
      case 'leak': { sound.play('leak'); coreHurt(); break; }
      case 'breach': playAt('breach', e); break;
      case 'nospec':
        // a charged node was shot with nothing for its special to hit: say so once per run, then only the dull click
        sound.play('nospec');
        if (!nospecTold && heroOn()) { nospecTold = true; toast('Nothing in range for that special. The tower keeps its charge.'); }
        break;
      case 'incoming': sound.play('boss'); toast(`Incoming from your rival: ${int(e.n)} x ${typeof e.type === 'string' && Object.hasOwn(ENEMIES, e.type) ? ENEMIES[e.type as EnemyType].name : 'enemies'}`); break;
      // the Gyre: arrows glancing off its rim, the rim stalling and spinning up again
      case 'deflect': playAt('deflect', e); break;
      case 'spindown': playAt('spindown', e); break;
      case 'spinup': playAt('spinup', e); break;
      // Broodcarrier and mites
      case 'brood': playAt('brood', e); break;
      case 'jam':
        playAt('jam', e);
        if (!bot && !store.tips.mite) { store.tips.mite = true; save(); tutor('Shoot the mites off the tower'); }
        break;
      case 'unjam': playAt('unjam', e); break;
      // the Titan
      case 'titanSmash': sound.play('titanSmash', 0.55); break;
      case 'titanLand':
        sound.play('titanLand');
        announce(`Wave ${sim.wave}: ${TITAN_NAME()}`, 'It lands at the gate and stuns every tower');
        break;
      case 'titanImpact':
        sound.play('titanImpact'); flash();
        overlinkCue = 1.5;
        break;
      case 'titanStrike': sound.play('boom'); break; // the blow itself; the 'leak' event beside it carries the alarm
      case 'titanDie':
        sound.play('titanDie'); flash();
        announce(`${TITAN_NAME()} destroyed`, 'The Uplink runs on its charge again');
        break;
    }
  }
}
const TITAN_NAME = () => ENEMIES.titan?.name || 'Titan';
function coreHurt() { const s = $('lives').parentElement!; s.classList.add('hurt'); setTimeout(() => s.classList.remove('hurt'), 500); }
/** The Titan has landed and the Uplink is held open: say so once the dust of the impact has settled. */
function overlinkSay() {
  if (!sim.overlink || ended) return;
  sound.play('overlink');
  announce('Overlink', 'The Uplink stays open while the Titan stands');
  toast('Overlink: the Uplink stays open while the Titan stands.');
  if (!bot && !store.tips.titan) { store.tips.titan = true; save(); tutor('Only its weak points and tower specials hurt it'); }
}
let nospecTold = false;
/**
 * Where Kestrel looks when an Uplink starts or she lands on another Spire: at the Titan or a Colossus if one is on the field,
 * else at the enemy with the least road left to the core, else up the road toward the nearest spawn gate.
 * This only sets the starting direction. Nothing turns the view afterwards but the player.
 */
function faceEnemies() {
  const o = sim.heroOrigin(me);
  if (!o) return;
  const core = sim.map.core;
  let tx = 0, ty = 0, tz = 0, found = false, best = Infinity;
  for (const e of sim.enemies) {
    if (!e.alive) continue;
    const L = sim.map.lanes[e.lane];
    // a guest only knows where enemies are, not how far along the road: the straight distance to the core stands in
    const left = (!isClient && L && Number.isFinite(e.dist) ? L.len - e.dist : Math.hypot(e.x - core.x, e.z - core.z)) - (e.type === 'titan' ? 2e6 : e.type === 'boss' ? 1e6 : 0);
    if (left < best) { best = left; tx = e.x; ty = e.y; tz = e.z; found = true; }
  }
  if (!found) {
    let gd = Infinity, lane = sim.map.lanes[0];
    for (const L of sim.map.lanes) { const d = Math.hypot(L.pts[0][0] - o.x, L.pts[0][1] - o.z); if (d < gd) { gd = d; lane = L; } }
    if (!lane) return;
    // the road point nearest the Spire, then a stretch up the road from there
    let at = 0, nd = Infinity;
    for (let i = 1; i < lane.pts.length; i++) {
      const a = lane.pts[i - 1], b = lane.pts[i], vx = b[0] - a[0], vz = b[1] - a[1], ll = vx * vx + vz * vz || 1;
      const u = clamp(((o.x - a[0]) * vx + (o.z - a[1]) * vz) / ll, 0, 1), d = Math.hypot(a[0] + vx * u - o.x, a[1] + vz * u - o.z);
      if (d < nd) { nd = d; at = lane.cum[i - 1] + Math.sqrt(ll) * u; }
    }
    const want = Math.max(0, at - 14);
    let i = 1;
    while (i < lane.pts.length - 1 && lane.cum[i] < want) i++;
    const a = lane.pts[i - 1], b = lane.pts[i], span = lane.cum[i] - lane.cum[i - 1] || 1, u = clamp((want - lane.cum[i - 1]) / span, 0, 1);
    tx = a[0] + (b[0] - a[0]) * u; tz = a[1] + (b[1] - a[1]) * u;
    ty = (lane.ys[i - 1] || 0) + ((lane.ys[i] || 0) - (lane.ys[i - 1] || 0)) * u + 0.5;
  }
  // The camera sits about 3 behind, 0.85 to the right of and 0.9 above the bow, so the angles from the bow are
  // corrected a little. It only has to put the target near the crosshair, not on it.
  const flat = Math.max(0.5, Math.hypot(tx - o.x, tz - o.z));
  view.yaw = Math.atan2(tx - o.x, tz - o.z) + Math.atan2(0.85, flat + 3);
  let pitch = Math.atan2(ty - o.y, flat);
  for (let i = 0; i < 2; i++) pitch = Math.atan2(ty - (o.y + 0.88 - 3 * Math.sin(pitch)), flat + 3 * Math.cos(pitch));
  view.pitch = clamp(pitch, -1.1, 0.1);
}

// ---------- game flow ----------
function fastForward(seconds: number) {
  for (let i = 0; i < seconds * 60 && !sim.over; i++) { bot?.step(STEP); sim.step(STEP); sim.events.length = 0; }
}
function resetUi() {
  for (const id of ['cards', 'menu', 'lobby', 'help', 'settings', 'music', 'pause', 'end', 'herohud', 'tower', 'vs', 'tip', 'setup', 'editor', 'tutor']) show(id, false);
  document.body.classList.remove('hero');
  clearTimeout(endTimer); clearTimeout(tutorTimer);
  for (const id of ['prep', 'p-editor', 'e-editor']) show(id, false);
  $('toasts').textContent = ''; $('notes').textContent = '';
  for (const q of dmgPool) q.anim?.cancel();
  lastRx = performance.now(); squadTokens = 3;
  unlockPointer();
  buildType = null; selected = 0; mouseFire = false; dragging = false; rotating = false; paused = false; speed = 1; acc = 0; cardKey = ''; ended = false; readyShown = false; lastTier = 0;
  runKey = ''; runWon = false; tipHover = null; nospecTold = false; editorRun = false;
  aimSentDraw = false; localDraw = 0; guestAim.d = false;
  // what these keys stood for was just hidden or reset behind the cache's back
  for (const k of ['prep', 'wavecls', 'tdock', 'tele', 'tip', 'titan', 'titancls', 'ultheld']) delete cache[k];
  show('titan', false); $('ult').classList.remove('held'); $('hero-time').classList.remove('held');
  overlinkCue = 0; zoomS.on = false; keyV.x = keyV.y = keyV.r = 0;
  // skill cooldown marks belong to the run that just ended
  for (let i = 0; i < 3; i++) { delete cache['cd' + i]; for (const id of ['sk-' + i, 't-s' + i]) { const box = $(id); box.classList.remove('cd'); (box.lastElementChild as HTMLElement).style.height = '0'; } }
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
  sim = new Sim({ pauseOnCards: false });
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
  });
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
  unlockPointer();
  document.body.classList.remove('hero'); show('herohud', false); show('cards', false); show('tutor', false); show('prep', false);
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
const NET_V = 4;
/** The co-op guest's bow as last reported: drawing or not, and the point aimed at. The host feeds it to the sim every frame. */
const guestAim = { d: false, x: 0, y: 0, z: 0 };
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
      case 'aim': if (pt(m) && (m.d === 0 || m.d === 1)) { guestAim.d = m.d === 1; guestAim.x = m.x; guestAim.y = m.y; guestAim.z = m.z; } break;
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
  choice.survival = (b as HTMLElement).dataset.v === 'survival';
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
click('e-endless', () => { sim.exitHero(me); sim.over = false; sim.won = false; sim.endless = true; sim.nextWaveIn = 5; ended = false; show('end', false); toast('No last wave from here on. How far can you go?'); });
// A HUD button must not keep the keyboard focus, or Space (the Uplink key) would press it again.
$('hud').addEventListener('click', () => { const a = document.activeElement; if (a instanceof HTMLButtonElement) a.blur(); });
// The pause and speed chips act on press (wired up by the touch module), so a second finger reaches them too.
function pressPause() { sound.init(); sound.play('click'); togglePause(); }
function pressSpeed() {
  if (mode !== 'solo' || !playing()) return;
  sound.init(); sound.play('click');
  if (heroOn()) { note('The Uplink always runs at 1x. Your speed comes back afterwards.'); return; }
  speed = speed === 1 ? 2 : 1; setText('btn-speed', speed + 'x');
}
click('btn-wave', () => act.wave());
click('ult', () => tryUlt());
click('t-up', () => { if (selected) act.upgrade(selected); });
click('t-sell', () => { if (selected && act.sell(selected)) selected = 0; });
function togglePause(on = !menuOpen()) {
  if (mode === 'attract' || ended) return;
  paused = on && mode === 'solo';
  for (const id of OVERLAYS) show(id, false);
  show('pause', on);
  if (on) { unlockPointer(); rotating = false; dragging = false; }
  if (!on && heroOn()) lockPointer();
}
/** Escape on a sheet that has a way back: take it. Returns false when no such sheet is open. */
function escBack(): boolean {
  const open = ([['help', 'h-back'], ['settings', 's-back'], ['music', 'mu-back'], ['setup', 'setup-back'], ['lobby', 'l-back']] as const).find(([id]) => shown(id));
  if (open) $(open[1]).click();
  return !!open;
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
{
  const box = $<HTMLInputElement>('set-friction');
  box.checked = settings.friction;
  box.addEventListener('change', () => { settings.friction = box.checked; sound.play('click'); save(); });
}
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
  store.records = {}; store.tips = { node: false, boss: false, mite: false, titan: false }; store.setup = defaultSetup();
  save();
  // a run in progress keeps its own choice; the defaults are loaded when it goes back to the menu
  if (mode === 'attract') loadSetup(); else setupStale = true;
  setText('best', bestLine());
  resetStep(false, 'Progress deleted.');
});
/** What the browser said when the mouse was asked for without pointer acceleration. */
function rawLine() {
  setText('raw-state', rawMouse === 'granted' ? 'Granted by the browser.'
    : rawMouse === 'refused' ? "Refused by the browser. The system's pointer acceleration applies to the look."
    : 'Not asked yet. It is asked for when the Uplink captures the mouse.');
}
function openSettings() { syncFxUi(); resetStep(false); rawLine(); show('settings'); }

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

// Mouse look. With the pointer captured the view turns by the raw mouse travel. Where capture is not available
// (an embedded browser pane, a refused request) the mouse still turns the view from anywhere on the page, and
// holding the cursor at a screen edge keeps it turning. The mouse gets no aim assistance of any kind.
let selfUnlock = false, lockFailed = false, autoPauseAt = -1e9, mouseIn = false, edgeArmed = false, heroSince = 0, lockIdle = 0;
/** Raw (unadjusted) mouse input: not asked for yet, granted, or refused by the browser. */
let rawMouse: 'unasked' | 'granted' | 'refused' = 'unasked';
/** when the pointer was last captured or the window last got its focus back (see the mouse look) */
let lockAt = -1e9;
function unlockPointer() { if (document.pointerLockElement) { selfUnlock = true; document.exitPointerLock(); } }
function lockPointer() {
  if (byTouch || document.pointerLockElement) return; // a finger aims by dragging, there is no pointer to lock
  const c = canvas as unknown as { requestPointerLock(o?: { unadjustedMovement: boolean }): unknown };
  const plain = () => { try { const r = c.requestPointerLock(); if (r instanceof Promise) r.catch(() => {}); } catch { /* not allowed */ } };
  try {
    // ask for the mouse without the system's pointer acceleration first; where that is not on offer, the plain lock
    const r = c.requestPointerLock({ unadjustedMovement: true });
    if (r instanceof Promise) r.then(() => { rawMouse = 'granted'; rawLine(); }, (err: unknown) => { if ((err as { name?: string } | null)?.name === 'NotSupportedError') { rawMouse = 'refused'; rawLine(); plain(); } });
    else { rawMouse = 'refused'; rawLine(); } // an older browser: it took the plain capture and ignored the option
  } catch { rawMouse = 'refused'; rawLine(); plain(); }
}
document.addEventListener('pointerlockerror', () => { lockFailed = true; });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) {
    lockFailed = false; selfUnlock = false; lockAt = performance.now();
    // the capture is granted a moment after it is asked for: by then a sheet or the card picker may be up
    if (!active()) unlockPointer();
    return;
  }
  // The browser took the pointer back (Escape, or the window lost focus). In the Uplink that opens the pause sheet.
  if (!selfUnlock && heroOn() && active()) { autoPauseAt = performance.now(); togglePause(true); }
  selfUnlock = false;
});
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
  if (p.energy < MAX_ENERGY && !sim.overlink) { sound.play('error'); note(`Uplink is still charging: ${Math.floor((p.energy / MAX_ENERGY) * 100)}%.`); return; }
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
/** Without a captured pointer: the cursor held at a screen edge keeps the view turning. */
function edgeLook(dt: number) {
  if (document.pointerLockElement || byTouch || !edgeArmed) return;
  const m = 40, W = innerWidth, H = innerHeight, x = lastMouse.x, y = lastMouse.y;
  const ex = x < m ? (x - m) / m : x > W - m ? (x - (W - m)) / m : 0;
  const ey = y < m ? (y - m) / m : y > H - m ? (y - (H - m)) / m : 0;
  if (ex || ey) look(clamp(ex, -1, 1) * 760 * dt, clamp(ey, -1, 1) * 420 * dt);
}
const TAU = Math.PI * 2;
/** A growing cam.rot turns the board counter-clockwise on screen (the camera circles clockwise, seen from above). */
const ROT_SIGN = -1;
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
  zoomS.target = clamp((zoomS.on ? zoomS.target : c.dist) / factor, 20, 84);
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
    // the browser may just have released the mouse for this same press, which already opened the pause sheet
    if (performance.now() - autoPauseAt < 400) return;
    if (!heroOn() && (buildType || selected)) { buildType = null; selected = 0; view.setGhost(null); } else togglePause();
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
  else if (k === 'g' && mode === 'solo') pressSpeed();
  else if (k === 'r' && !e.repeat) { const c = bird(), turn = Math.round((c.rot || 0) / TAU) * TAU; frameBoard(); if (typeof c.rot === 'number') c.rot = turn; }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); mouseFire = false; dragging = false; rotating = false; mouseBtns = 0; });
addEventListener('focus', () => { lockAt = performance.now(); });

document.documentElement.addEventListener('mouseleave', () => { mouseIn = false; });
// Mouse movement is read from the whole page, not only the canvas: a HUD element under the cursor must never stop the view.
document.addEventListener('mousemove', (e) => {
  const first = !mouseIn;
  mouseIn = true;
  lastMouse.x = e.clientX; lastMouse.y = e.clientY;
  if (!playing()) return;
  if (heroOn()) {
    if (byTouch || !active()) return;
    const locked = !!document.pointerLockElement;
    if (!locked) {
      // edge turning starts once the cursor has been away from the edges, so a cursor resting on the Uplink bar does nothing
      if (e.clientX > 60 && e.clientX < innerWidth - 60 && e.clientY > 60 && e.clientY < innerHeight - 60) edgeArmed = true;
      if (first) return; // the jump from where the cursor left the window to where it came back is not a turn
    }
    // Some systems send one wild sample when the pointer is captured or the window gets its focus back. Only that
    // moment is filtered. Anything else passes: a fast turn with a high-resolution mouse is many hundreds of counts
    // in one frame, and dropping those would make the view stick exactly when the hand moves fastest.
    const big = Math.max(Math.abs(e.movementX), Math.abs(e.movementY));
    if (big > 5000 || (big > 300 && performance.now() - lockAt < 250)) { diag.dropped++; return; }
    diag.mx += e.movementX; diag.my += e.movementY; diag.mn++;
    look(e.movementX, e.movementY);
    return;
  }
  if (rotating) rotateCam(-e.movementX * 0.006); // the near side of the board follows the mouse
  else if (dragging) panBy(e.clientX - e.movementX, e.clientY - e.movementY, e.clientX, e.clientY);
  if (e.target === canvas || dragging || rotating) hoverAt(e.clientX, e.clientY);
});
/** A mouse press during the Uplink: grab the pointer again if it got away, then draw the bow. */
function heroMouse(e: MouseEvent) {
  if (!document.pointerLockElement) lockPointer();
  if (e.button === 0) mouseFire = true;
  else if (e.button === 2) castSkill(0);
  else if (e.button === 1) { e.preventDefault(); tryTele(); }
}
// During the Uplink a press anywhere on the page belongs to the bow, unless it lands on a real control.
document.addEventListener('mousedown', (e) => {
  if (!heroOn() || byTouch) return;
  sound.init();
  if (!active()) return;
  if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea, .mu-dock')) return;
  if (skipIntro()) return;
  heroMouse(e);
});
canvas.addEventListener('mousedown', (e) => {
  sound.init();
  if (!active() || heroOn()) return;
  if (skipIntro()) return;
  if (e.button === 1) { e.preventDefault(); rotating = true; return; } // middle-drag turns the view
  if (e.button === 2) { if (buildType) { buildType = null; view.setGhost(null); } else selected = 0; dragging = true; return; }
  if (e.button !== 0) return;
  boardTap(e.clientX, e.clientY, e.shiftKey);
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseFire = false; if (e.button === 2) dragging = false; if (e.button === 1) rotating = false; });
document.addEventListener('contextmenu', (e) => { if (e.target === canvas || heroOn()) e.preventDefault(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (heroOn() || !active()) return;
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
  isHero: heroOn,
  // Touch only: the look slows by a quarter while the crosshair is on an enemy. It never moves the view by itself.
  look(dx: number, dy: number) { if (active() && heroOn()) { const k = settings.friction && aimHot ? 0.75 : 1; look(dx * k, dy * k); } },
  fire(on: boolean) { if (on) sound.init(); touchFire = on; },
  skill(i: number) { if (i >= 0 && i < 3) castSkill(i); },
  teleport: tryTele,
  ult() { sound.init(); tryUlt(); },
  exitHero() { if (active() && heroOn()) act.exit(); },
  tap(clientX: number, clientY: number) { sound.init(); if (!active() || heroOn() || skipIntro()) return; boardTap(clientX, clientY, false); },
  hoverAt(clientX: number, clientY: number) { if (active() && !heroOn()) hoverAt(clientX, clientY); },
  pan(dx: number, dy: number, x: number, y: number) { if (active() && !heroOn()) pan(dx, dy, x, y); },
  zoom(factor: number, x = innerWidth / 2, y = innerHeight / 2) { if (active() && !heroOn()) zoomAt(factor, x, y, false); },
  rotate(angle: number) { if (active() && !heroOn()) rotateCam(angle); },
  pause: pressPause,
  speed: pressSpeed,
};
initTouch(touchApi);

// ---------- phones held upright ----------
{
  const mq = matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 600px)');
  let dismissed = false;
  const sync = () => {
    const on = mq.matches && !dismissed;
    show('rotate', on);
    if (on && playing() && !paused && !menuOpen() && !shown('cards')) togglePause(true);
  };
  mq.addEventListener('change', sync);
  click('rot-go', () => { dismissed = true; sync(); });
  sync();
}

// ---------- the bow ----------
// Hold to draw, let go to loose. The sim owns the draw; this passes on whether the button is held and where the
// crosshair points, every frame. A co-op guest sends the same to the host: on every change, and at most 20 times
// a second while drawing so the aim point stays fresh.
let aimT = 0, aimSentDraw = false, localDraw = 0, aimHot = false;
function aimBow(drawing: boolean, dt: number) {
  if (isClient) {
    aimT += dt;
    if (drawing !== aimSentDraw || (drawing && aimT >= 0.05)) { aimT = 0; aimSentDraw = drawing; net?.send({ t: 'in', a: 'aim', d: drawing ? 1 : 0, x: aim.x, y: aim.y, z: aim.z }); }
  } else {
    const s = sim as unknown as SimX;
    if (s.heroAim) s.heroAim(me, drawing, aim.x, aim.y, aim.z);
    else if (drawing) s.heroFire?.(me, aim.x, aim.y, aim.z); // a sim without the draw yet
  }
  // the gauge: the sim's own value, or a local estimate for a guest (snapshots are too coarse to animate from)
  localDraw = drawing ? Math.min(1, localDraw + dt / DRAW_TIME) : 0;
  const pd = (sim.players[me] as unknown as { draw?: unknown }).draw;
  const g = !isClient && typeof pd === 'number' && Number.isFinite(pd) ? clamp(pd, 0, 1) : localDraw;
  const cls = g <= 0.01 ? '' : g >= 0.995 ? 'on full' : g < MIN_DRAW ? 'on weak' : 'on';
  if (cache.drawcls !== cls) { cache.drawcls = cls; $('draw').setAttribute('class', cls); if (cls === 'on full') sound.play('drawfull'); }
  const off = (100 - g * 100).toFixed(0);
  if (cache.drawoff !== off) { cache.drawoff = off; $('draw-arc').style.strokeDashoffset = off; }
}

// ---------- diagnostics (F3) ----------
// A small readout for hunting down a sluggish view: frame times, whether the mouse is captured and raw, what the
// mouse sent in the last frame and how far the view turned for it. It costs nothing while it is off.
const diag = { on: false, last: 0, t: 0, n: 0, sum: 0, worst: 0, fps: 0, avg: 0, max: 0, mx: 0, my: 0, mn: 0, yaw: 0, pitch: 0, dropped: 0, slow: '', fast: '' };
function toggleDiag() {
  diag.on = !diag.on;
  diag.last = 0; diag.t = 0; diag.n = 0; diag.sum = 0; diag.worst = 0; diag.slow = ''; diag.fast = '';
  diag.yaw = view.yaw; diag.pitch = view.pitch;
  show('diag', diag.on);
}
/** Called once a frame. The game caps its own step at 100 ms, so the time is read from the clock here: a long stall shows at its real length. */
function diagFrame(dt: number) {
  if (!diag.on) { diag.mx = diag.my = diag.mn = 0; return; }
  const now = performance.now(), ms = diag.last ? now - diag.last : dt * 1000, deg = 180 / Math.PI;
  diag.last = now;
  diag.n++; diag.sum += ms; diag.t += ms; if (ms > diag.worst) diag.worst = ms;
  // frame times: the average and the worst frame of the last second
  if (diag.t >= 1000 || !diag.slow) {
    if (diag.n) { diag.avg = diag.sum / diag.n; diag.fps = 1000 / Math.max(0.01, diag.avg); diag.max = diag.worst; }
    diag.t = 0; diag.n = 0; diag.sum = 0; diag.worst = 0;
    const c = canvas, post = (view as unknown as { post?: { ao?: { enabled?: boolean } | null } }).post;
    const ao = view.quality === 'high' && !!post?.ao?.enabled;
    diag.slow = `F3 diagnostics\nfps ${diag.fps.toFixed(0)}   frame ${diag.avg.toFixed(1)} ms avg, ${diag.max.toFixed(1)} ms worst (1 s)\n`
      + `pointer ${document.pointerLockElement ? 'locked' : 'free'}   raw input ${rawMouse === 'unasked' ? 'not asked yet' : rawMouse}\n`
      + `dpr ${(window.devicePixelRatio || 1).toFixed(2)}   canvas ${c.width} x ${c.height}\n`
      + `quality ${view.quality}   ambient occlusion ${ao ? 'on' : 'off'}\n`
      + `sensitivity ${settings.sens}%   dropped samples ${diag.dropped}`;
  }
  // the mouse: what arrived since the last frame, and the turn it produced
  const dy = (view.yaw - diag.yaw) * deg, dp = (view.pitch - diag.pitch) * deg;
  diag.yaw = view.yaw; diag.pitch = view.pitch;
  const fast = `mouse dx ${diag.mx.toFixed(0).padStart(5)} dy ${diag.my.toFixed(0).padStart(5)}  (${diag.mn} events)\nlook  ${dy.toFixed(2).padStart(7)} deg ${dp.toFixed(2).padStart(7)} deg`;
  diag.mx = diag.my = diag.mn = 0;
  if (fast !== diag.fast || diag.t === 0) { diag.fast = fast; $('diag').textContent = diag.slow + '\n' + fast; }
}

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
  // Overlink: while the Titan stands the Uplink is held open. The meter stays full and the timer does not run.
  const held = !!sim.overlink;
  if (cache.ultheld !== String(held)) { cache.ultheld = String(held); $('ult').classList.toggle('held', held); $('hero-time').classList.toggle('held', held); }
  setW('ultbar', held ? 1 : p.energy / MAX_ENERGY);
  const ready = (held || p.energy >= MAX_ENERGY) && !hero;
  $('ult').classList.toggle('ready', ready);
  setText('ult-label', held ? (hero ? 'OVERLINK - UPLINK HELD OPEN' : touchUi() ? 'OVERLINK - UPLINK HELD OPEN' : 'OVERLINK - HELD OPEN - PRESS SPACE')
    : ready ? (touchUi() ? 'UPLINK READY' : 'UPLINK READY - PRESS SPACE') : `UPLINK ${Math.floor((p.energy / MAX_ENERGY) * 100)}%`);
  if (held) readyShown = true; // the Overlink has its own announcement
  if (ready && !readyShown && !bot) { readyShown = true; sound.play('ready'); announce('Uplink ready', touchUi() ? 'Tap Uplink to stand on a Spire' : 'Press Space to stand on a Spire'); }
  if (!ready && !hero) readyShown = readyShown && p.energy > 50;
  const waiting = isClient ? sim.nextWaveIn >= 0 : !sim.queue.length;
  const canCall = waiting && !sim.over && !(sim.wave >= sim.winWave && sim.campaign);
  // The slot of the button stays reserved (see #btn-wave.off), so the Uplink bar next to it never moves.
  const first = sim.wave === 0, wb = $<HTMLButtonElement>('btn-wave'), wk = `${canCall}:${first}`;
  if (cache.wavecls !== wk) { cache.wavecls = wk; wb.classList.toggle('off', !canCall); wb.classList.toggle('first', canCall && first); wb.disabled = !canCall; }
  const prep = canCall && first && !hero && !ended;
  if (canCall) {
    const left = Math.max(0, Math.ceil(sim.nextWaveIn)), sx = sim as unknown as SimX;
    // what calling now pays, straight from the sim; an older sim pays two credits a second, and nothing before wave 1
    const raw = sx.callBonus ? sx.callBonus() : first ? 0 : Math.max(0, sim.nextWaveIn) * 2;
    const bonus = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    setText('wave-label', first ? 'Call first wave' : 'Call wave');
    setText('wave-timer', bonus > 0 ? `${left}s, +${bonus} cr` : `starts in ${left}s`);
    if (prep) setText('prep-sub', touchUi() ? `It starts by itself in ${left}s. Tap Call first wave when you are ready.` : `It starts by itself in ${left}s. Press N or the button when you are ready.`);
  }
  if (cache.prep !== String(prep)) { cache.prep = String(prep); show('prep', prep); }
  for (const t of TOWER_TYPES) {
    const b = buildBtns[t], locked = !sim.unlocked.has(t), cost = sim.cost(t);
    b.classList.toggle('locked', locked);
    b.classList.toggle('poor', !locked && sim.gold < cost);
    b.classList.toggle('sel', buildType === t);
    const c = b.lastElementChild as HTMLElement, s = String(cost);
    if (c.textContent !== s) c.textContent = s;
  }
  // tooltip: the tower under the pointer, else the one picked for building (touch has no hover)
  const tipFor = hero ? null : tipHover || buildType, tipKey = tipFor ? tipFor + (sim.unlocked.has(tipFor) ? '' : ':locked') : '';
  if (cache.tip !== tipKey) { cache.tip = tipKey; if (tipFor) towerTip(tipFor); else show('tip', false); }

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
    setW('herobar', held ? 1 : p.heroTime / p.heroDur);
    setText('hero-label', held ? 'OVERLINK - HELD OPEN WHILE THE TITAN STANDS' : `UPLINK ACTIVE - ${Math.max(0, p.heroTime).toFixed(1)}s`);
    for (let s = 0; s < 3; s++) {
      const f = clamp(Math.max(0, p.cds[s]) / (SKILL_CD[s] * p.stats.cdr), 0, 1), h = (f * 100).toFixed(0) + '%';
      // "0%" is reached a moment before the cooldown is over: the key also holds whether it still runs
      const ck = h + (f > 0 ? ':cd' : '');
      if (cache['cd' + s] === ck) continue;
      cache['cd' + s] = ck;
      // the keyboard skill row and the touch buttons show the same cooldown
      for (const id of ['sk-' + s, 't-s' + s]) { const box = $(id); (box.lastElementChild as HTMLElement).style.height = h; box.classList.toggle('cd', f > 0); }
    }
    if (!store.tips.node && !bot && sim.towers.some((t) => sim.specialReady(t))) { store.tips.node = true; save(); tutor('Shoot the glowing node on a tower to fire its special'); }
  }
  updateTitan();
  updateMarks(hero);
  updateIntel(hero);
  updateHints(hero);
  if (mode === 'versus') setText('vs-status', `Core ${rival.l} / Wave ${rival.w} / ${rival.k} kills`);
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

function updateTowerPanel(hero: boolean) {
  const t = selected ? sim.towerById(selected) : undefined;
  if (!t) { selected = 0; view.setSelected(null); cache.tdock = ''; }
  show('tower', !!t && !hero);
  if (!t) return;
  if (cache.tdock !== String(t.id)) {
    // decided once per selection: the panel goes to the left when it would lie over the core, unless the tower itself is there
    cache.tdock = String(t.id);
    const [cx, , cok] = view.project(sim.map.core.x, 1, sim.map.core.z), [tx] = view.project(t.x, t.h * 0.5, t.z);
    $('tower').classList.toggle('left', cok && cx > innerWidth - 330 && tx > 300);
  }
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
    // stunned by the Titan's landing or jammed by mites comes first: the tower neither fires nor charges
    const state = t.stun > 0 ? 'stun' : t.jam > 0 ? 'jam' : t.down > 0 ? 'down' : t.spec > 0 ? 'run' : t.charge >= 1 ? 'ready' : 'charge';
    if (cache.tspec !== state) { cache.tspec = state; box.className = state; }
    setW('t-spec-bar', state === 'stun' ? 1 - t.stun / TITAN_STUN : state === 'down' ? 1 - t.down / Math.max(0.1, total) : state === 'charge' ? t.charge : 1);
    setText('t-spec-state', state === 'stun' ? `Stunned - back in ${Math.ceil(t.stun)}s` : state === 'jam' ? 'Jammed by mites. Shoot them off.'
      : state === 'down' ? `Offline - rebooting ${Math.ceil(t.down)}s` : state === 'run' ? `Running - ${Math.ceil(t.spec)}s left`
      : state === 'ready' ? 'Ready. Shoot its node during an Uplink.' : `Charging ${Math.floor(t.charge * 100)}%`);
  } else {
    setText('t-spec-name', 'Uplink point');
    setText('t-spec-desc', 'Kestrel stands here during the Uplink and can jump to other Spires. Each upgrade adds 15% arrow damage.');
    if (cache.tspec !== 'spire') { cache.tspec = 'spire'; box.className = 'spire'; }
    setW('t-spec-bar', 0);
    setText('t-spec-state', t.stun > 0 ? `Stunned - back in ${Math.ceil(t.stun)}s` : sim.players.some((q) => q.heroActive && q.heroTower === t.id) ? 'Kestrel is here.' : '');
  }
  const up = $<HTMLButtonElement>('t-up');
  setText('t-up', t.lvl >= 3 ? 'Max level' : `Upgrade${touchUi() ? '' : ' (U)'} - ${sim.upCost(t)}`);
  up.disabled = t.lvl >= 3 || sim.gold < sim.upCost(t);
  const why = sellReason(t);
  setText('t-sell', `Sell${touchUi() ? '' : ' (X)'} +${sim.sellValue(t)}`);
  $<HTMLButtonElement>('t-sell').disabled = !!why;
  setText('t-note', why);
}

// Small markers over towers: a chevron where an upgrade is affordable (command view only), and in both views a
// spider over a tower that mites have jammed and a bolt over one the Titan has stunned.
const MARK_ICON: Record<string, string> = { up: 'M8 3l6 8H2z', jam: MITE_PATH, stun: 'M9.6 0.6L3 9h3.7l-1.2 6.4L12.8 7H8.9z' };
const marks: { el: HTMLElement; kind: string }[] = [];
function mark(n: number, kind: string, x: number, y: number) {
  let m = marks[n];
  if (!m) { m = marks[n] = { el: el('i', 'mark'), kind: '' }; $('marks').appendChild(m.el); }
  if (m.kind !== kind) { m.kind = kind; m.el.className = 'mark ' + kind; m.el.replaceChildren(icon(MARK_ICON[kind])); }
  m.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  m.el.style.display = 'block';
}
function updateMarks(hero: boolean) {
  let n = 0;
  if (!ended) {
    // Upgrade chevrons: not before the first wave. The starting credits are for towers, not for the one upgrade they happen to cover.
    const ups = !hero && sim.wave > 0 && view.heroBlend < 0.05;
    for (const t of sim.towers) {
      if (n >= 48) break;
      const off = t.stun > 0 ? 'stun' : t.jam > 0 ? 'jam' : '';
      if (off) {
        const [x, y, ok] = view.project(t.x, t.h + 0.7, t.z);
        if (ok) mark(n++, off, x, y);
        continue;
      }
      if (!ups || t.lvl >= 3 || sim.gold < sim.upCost(t)) continue;
      // beside the model, not on top of it
      const [x, y, ok] = view.project(t.x, t.h * 0.8, t.z);
      if (ok) mark(n++, 'up', x + 15, y);
    }
  }
  for (let i = n; i < marks.length; i++) marks[i].el.style.display = 'none';
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
      tag.cls = ok.some((o) => bigOne(o.type)) ? ' boss' : '';
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

// Uplink hints: a small marker over every tower whose special is ready, and on the beacon of the other Spires.
// Only the marker nearest the crosshair carries a label. Markers fade next to anything with weak points, so the
// Colossus is never buried under them, and a marker behind Kestrel's own platform is not drawn at all.
const hints: { box: HTMLElement; label: HTMLElement; cls: string; text: string; want: string }[] = [];
const BIG = new Float32Array(8 * 3);
function updateHints(hero: boolean) {
  let n = 0, nearI = -1;
  if (hero && !ended) {
    const p = sim.players[me], cx = innerWidth / 2, cy = innerHeight / 2;
    let nb = 0;
    for (const e of sim.enemies) {
      if (nb >= 8) break;
      if (!e.alive || !ENEMIES[e.type].weak) continue;
      const [x, y, ok] = view.project(e.x, e.y, e.z);
      if (!ok) continue;
      const [, y2] = view.project(e.x, e.y + e.r, e.z);
      BIG[nb * 3] = x; BIG[nb * 3 + 1] = y; BIG[nb * 3 + 2] = Math.max(34, Math.abs(y - y2) * 1.5 + 14); nb++;
    }
    const o = sim.heroOrigin(me), cp = vx.camera?.position;
    let nearD = 90;
    for (const t of sim.towers) {
      if (n >= 24) break;
      const spire = t.type === 'spire';
      if (spire ? t.id === p.heroTower : !sim.specialReady(t)) continue;
      nodePos(t, P3);
      const hy = spire ? t.h + 1.7 : P3.y;
      if (o && cp) {
        const dx = P3.x - cp.x, dy = hy - cp.y, dz = P3.z - cp.z, L = Math.hypot(dx, dy, dz) || 1;
        const u = raySphere(cp.x, cp.y, cp.z, dx / L, dy / L, dz / L, o.x, o.y - 0.5, o.z, 1.2);
        if (u >= 0 && u < L) continue;
      }
      const [x, y, ok] = view.project(P3.x, hy, P3.z);
      if (!ok) continue;
      let h = hints[n];
      if (!h) { const box = el('i', 'hint'), label = el('b'); box.append(el('s'), label); $('hints').appendChild(box); h = hints[n] = { box, label, cls: '', text: '', want: '' }; }
      const dc = Math.hypot(x - cx, y - cy);
      if (dc < nearD) { nearD = dc; nearI = n; }
      let faint = false;
      for (let k = 0; k < nb && !faint; k++) faint = Math.hypot(x - BIG[k * 3], y - BIG[k * 3 + 1]) < BIG[k * 3 + 2];
      h.want = 'hint ' + (spire ? 'spire' : 'node') + (faint ? ' faint' : '');
      const text = spire ? 'Spire beacon' : `${TOWERS[t.type].special?.name || 'Special'} ready`;
      if (h.text !== text) { h.text = text; h.label.textContent = text; }
      h.box.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      h.box.style.display = 'block';
      n++;
    }
    for (let i = 0; i < n; i++) { const h = hints[i], cls = h.want + (i === nearI ? ' near' : ''); if (h.cls !== cls) { h.cls = cls; h.box.className = cls; } }
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
  diagFrame(dt);
  if (overlinkCue > 0 && !paused) { overlinkCue -= dt; if (overlinkCue <= 0) overlinkSay(); }
  if (!paused) {
    acc += dt * (mode === 'attract' ? 1.4 : sim.players[me]?.heroActive ? 1 : speed);
    let n = 0;
    const cap = dt > 0.2 ? 70 : 10; // a hidden tab is stepped in big chunks so a multiplayer match keeps running
    while (acc >= STEP && n < cap) { bot?.step(STEP); if (!isClient) sim.step(STEP); acc -= STEP; n++; }
    if (n === cap) acc = 0;
    squadT += dt; if (squadT > 1.5) { squadT = 0; squadTokens = Math.min(3, squadTokens + 1); }
    if (isClient) for (const p of sim.projs) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  }
  const p = sim.players[me];
  if (bot) { view.yaw = p.yaw; view.pitch = p.pitch; }
  // A captured pointer belongs to the Uplink. If none followed (a guest's request the host turned down), give it back.
  if (document.pointerLockElement && !p?.heroActive) { lockIdle += dt; if (lockIdle > 1) unlockPointer(); } else lockIdle = 0;
  if (mode === 'attract' && sim.over) { sim = new Sim({ pauseOnCards: false }); bot = new Bot(sim, 0, 1); fastForward(150); view.setSim(sim, 0); }

  if (active()) {
    if (p.heroActive) {
      edgeLook(dt);
      if (!isClient) { p.yaw = view.yaw; p.pitch = view.pitch; }
      view.aimPoint(aim);
      aimBow(mouseFire || touchFire, dt);
      // touch aim friction needs to know whether the crosshair rests on an enemy; the mouse never asks
      aimHot = false;
      if (byTouch && settings.friction) for (const e of sim.enemies) if (e.alive && Math.hypot(e.x - aim.x, e.y - aim.y, e.z - aim.z) <= e.r + 0.2) { aimHot = true; break; }
      const tp = sim.towerById(aimSpire());
      view.setTele(tp || null);
      const tk = tp ? 'tp' : '';
      if (cache.tele !== tk) { cache.tele = tk; $('cross').classList.toggle('tp', !!tp); $('t-tp').classList.toggle('on', !!tp); }
      setText('hero-hint', tp ? (byTouch ? 'TAP JUMP OR SHOOT THE BEACON' : 'F OR SHOOT THE BEACON TO JUMP') : '');
      // no captured pointer after the first moment: say how to get one, or how to turn without
      const free = !byTouch && !document.pointerLockElement && performance.now() - heroSince > 500;
      setText('lock-hint', !free ? '' : lockFailed ? 'The mouse cannot be captured here. Hold the cursor at a screen edge to keep turning.' : 'Click to capture the mouse');
    } else {
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
      if (Math.abs(keyV.r) > 0.004) rotateCam(-keyV.r * 1.9 * dt);
      zoomStep(dt);
    }
  } else { keyV.x = keyV.y = keyV.r = 0; }

  // networking
  if (net && mode === 'coop') {
    if (isClient) { lookT += dt; if (lookT > 0.08 && p.heroActive) { lookT = 0; net.send({ t: 'in', a: 'look', y: view.yaw, p: view.pitch }); } }
    else {
      // the guest's bow, as last reported; the sim decides what a draw is worth and when an arrow may fly
      const g = sim.players[1];
      if (g?.heroActive && !sim.over) (sim as unknown as SimX).heroAim?.(1, guestAim.d, guestAim.x, guestAim.y, guestAim.z); else guestAim.d = false;
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
  // the score's tense layer runs while the player stands on a Spire and while the Titan is on the field
  const tp = sim.titan ? sim.titan.phase : 'none';
  sound.intense = mode !== 'attract' && !ended && (!!p?.heroActive || tp === 'landing' || tp === 'walk') ? 1 : 0;
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
        startGame('solo', { demo: true, seed, map: g ? generateMap(+g[2], +g[1]) : mapById(mapId) || MAPS[0], diff: 'normal', survival: false }); sound.stopMusic(); fastForward(ff); sim.exitHero(0); sim.events.length = 0; view.setSim(sim, 0); },
      attract() { startAttract(); show('menu', false); },
      menu() { startAttract(); },
      energy(v: number) { sim.players[0].energy = v; },
      sound,
      /** hand control from the bot to the "player" so the card picker can be shown */
      takeover() { bot = null; sim.opts.pauseOnCards = true; },
      /** run the bot-played match forward without drawing; the view is reset afterwards like in demo() */
      skip(seconds: number) { fastForward(seconds); },
      resync() { sim.exitHero(0); sim.events.length = 0; view.setSim(sim, 0); },
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
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__dbg = { get sim() { return sim; }, view, act, startGame, sound, diag, zoomS, touch: touchApi };
  let last = performance.now();
  const loop = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; frame(dt); requestAnimationFrame(loop); };
  // browsers stop animation frames in hidden or background tabs; whenever frames stall, keep a multiplayer match alive on a timer
  setInterval(() => { const now = performance.now(); if (now - last < 400 || !net || mode === 'attract' || ended) return; const dt = Math.min(1.1, (now - last) / 1000); last = now; frame(dt); }, 250);
  requestAnimationFrame(loop);
})();
