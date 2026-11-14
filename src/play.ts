// VOLTSPIRE — game controller: input, HUD, menus, multiplayer glue.
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import './style.css';
import * as THREE from 'three';
import { GW, GH, TOWERS, TOWER_TYPES, ENEMIES, CARD_BY_ID, RARITY, BOW_TIERS, MAX_ENERGY, WIN_WAVE, SQUADS, worldToCell } from './game/data.ts';
import type { TowerType } from './game/data.ts';
import { Sim, SKILL_CD } from './game/sim.ts';
import type { Ev, Mode } from './game/sim.ts';
import { Bot } from './game/bot.ts';
import { View } from './game/render.ts';
import { Sound } from './game/audio.ts';
import { Net, cleanCode } from './game/net.ts';
import { DIFFS, diffById, sanitizeMap } from './game/map.ts';
import type { MapDef } from './game/map.ts';
import { MAPS, mapById } from './game/maps.ts';
import { drawMap } from './game/mapdraw.ts';
import { openEditor, loadCustomMaps } from './editor.ts';
import type { Msg } from './game/net.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const show = (id: string, on = true) => $(id).classList.toggle('hidden', !on);
const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const STEP = 1 / 60;

// ---------- settings (local only) ----------
const settings = { vol: 70, mus: 50, sens: 100, q: 'high' as 'high' | 'low', best: 0, bestSurv: 0, map: 'switchback', diff: 'normal' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('voltspire') || '{}')); } catch { /* storage unavailable */ }
const save = () => { try { localStorage.setItem('voltspire', JSON.stringify(settings)); } catch { /* ignore */ } };

const canvas = $<HTMLCanvasElement>('c');
const view = new View(canvas);
const sound = new Sound();
sound.volume = settings.vol / 100; sound.musicVol = settings.mus / 100;

type GameMode = 'attract' | Mode;
let mode: GameMode = 'attract';
let sim = new Sim({ pauseOnCards: false });
let bot: Bot | null = null;
let me = 0;
let net: Net | null = null;
let isClient = false;
let paused = false, speed = 1, acc = 0;
let buildType: TowerType | null = null, selected = 0;
let firing = false, dragging = false;
let snapT = 0, lookT = 0, vsT = 0;
let netEvs: Ev[] = [];
let cardKey = '', ended = false, readyShown = false, lastTier = 0;
let lobbyMode: 'coop' | 'versus' = 'coop';
const choice: { map: MapDef; diff: string; survival: boolean } = { map: MAPS[0], diff: 'normal', survival: false };
let setupFor: 'solo' | 'lobby' = 'solo';
let rival = { l: 20, w: 0, k: 0 };
const hover = { cx: -1, cz: -1 };
const keys = new Set<string>();
const aim = new THREE.Vector3(), gp = new THREE.Vector3();

// ---------- actions (local sim, or sent to the co-op host) ----------
const act = {
  build(type: TowerType, cx: number, cz: number) {
    if (isClient) { if (sim.canBuild(type, cx, cz)) net?.send({ t: 'in', a: 'build', ty: TOWER_TYPES.indexOf(type), cx, cz }); else return false; return true; }
    return !!sim.build(type, cx, cz);
  },
  upgrade(id: number) { if (isClient) net?.send({ t: 'in', a: 'up', id }); else if (!sim.upgrade(id)) sound.play('error'); },
  sell(id: number) { if (isClient) net?.send({ t: 'in', a: 'sell', id }); else sim.sell(id); },
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
const setW = (id: string, f: number) => { const v = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; if (cache[id] !== v) { cache[id] = v; $(id).style.width = v; } };

function announce(text: string, sub = '') {
  const a = $('announce');
  a.textContent = text;
  if (sub) a.appendChild(el('small', '', sub));
  a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
}
function toast(text: string) {
  const t = el('div', 'toast', text);
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3300);
  while ($('toasts').children.length > 5) $('toasts').firstChild!.remove();
}
function flash() { const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
function dmgNumber(e: Ev) {
  const box = $('dmg');
  if (box.children.length > 26) return;
  const [x, y, ok] = view.project(e.x, e.y + 0.4, e.z);
  if (!ok) return;
  const s = el('span', '', String(e.n));
  s.style.left = x + (Math.random() - 0.5) * 24 + 'px'; s.style.top = y + 'px';
  box.appendChild(s);
  s.animate([{ transform: 'translateY(0) scale(1.3)', opacity: 1 }, { transform: 'translateY(-46px) scale(0.9)', opacity: 0 }], { duration: 650, easing: 'ease-out' }).onfinish = () => s.remove();
}

// build bar
const buildBtns = {} as Record<TowerType, HTMLButtonElement>;
for (const t of TOWER_TYPES) {
  const d = TOWERS[t];
  const b = el('button', 'tw') as HTMLButtonElement;
  b.style.setProperty('--c', '#' + d.color.toString(16).padStart(6, '0'));
  b.append(el('kbd', '', d.key), el('div', 'ico'), el('div', 'nm', d.name), el('div', 'cost'));
  b.addEventListener('click', () => pickBuild(t));
  b.addEventListener('mouseenter', () => {
    const tip = $('tip'); tip.textContent = '';
    tip.append(el('b', '', d.name), el('span', '', d.desc + (t === 'beacon' ? '' : ` Damage ${d.dmg} · ${d.rate}/s · range ${d.range}.`)));
    show('tip');
  });
  b.addEventListener('mouseleave', () => show('tip', false));
  buildBtns[t] = b;
  $('build').appendChild(b);
}
function pickBuild(t: TowerType | null) {
  if (t && !sim.unlocked.has(t)) { sound.play('error'); toast(TOWERS[t].name + ' is locked — find its blueprint card.'); return; }
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
const heroOn = () => !!sim.players[me]?.heroActive;

// versus squads
SQUADS.forEach((s, i) => {
  const b = el('button', 'btn small ghost', `${s.name} · ${s.cost}`);
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
    const c = CARD_BY_ID[id];
    const d = el('button', 'card');
    d.style.setProperty('--rc', ['#19e3ff', '#a35bff', '#ffd23f'][c.rar]);
    d.append(el('kbd', '', String(i + 1)), el('div', 'ci', c.icon), el('div', 'rar', RARITY[c.rar]), el('h4', '', c.name), el('p', '', c.desc), el('div', 'kind', c.needs ? TOWERS[c.needs].name : c.kind === 'eco' ? 'economy' : c.kind === 'tower' ? 'all towers' : c.kind === 'hero' ? 'Kestrel' : c.kind));
    if (c.needs) d.style.setProperty('--tc', '#' + TOWERS[c.needs].color.toString(16).padStart(6, '0'));
    d.addEventListener('click', () => pickCard(i));
    d.addEventListener('mouseenter', () => sound.play('hover'));
    row.appendChild(d);
  });
  show('cards');
  if (document.pointerLockElement) document.exitPointerLock();
  firing = false;
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
function handleEvents(evs: Ev[]) {
  view.handle(evs);
  const quiet = mode === 'attract';
  for (const e of evs) {
    switch (e.k) {
      case 'shot': if (!quiet) sound.play(e.t === 'pulse' ? 'shot' : e.t === 'arc' ? 'arcshot' : e.t === 'mortar' ? 'mortar' : 'rail'); break;
      case 'cryo': if (!quiet) sound.play('cryo'); break;
      case 'boom': if (!quiet) sound.play('boom'); break;
      case 'die': if (!quiet) sound.play(e.t === 'boss' ? 'bossdie' : 'die'); if (e.t === 'boss' && !quiet) toast('Colossus destroyed!'); break;
      case 'arrow': if (!quiet) sound.play('arrow'); break;
      case 'rail': if (e.big && !quiet) sound.play('bigshot'); break;
      case 'skill': if (!quiet) sound.play(e.s === 1 ? 'rain' : 'sing'); break;
      case 'shieldbreak': if (!quiet) sound.play('shield'); break;
      case 'build': if (!quiet) sound.play('build'); break;
      case 'sell': if (!quiet) sound.play('sell'); break;
      case 'tele': if (!quiet) sound.play('tele'); if (e.p === me) flash(); break;
      case 'dmg': if (e.p === me && !quiet && heroOn()) dmgNumber(e); break;
      case 'heroOn':
        if (quiet) break;
        sound.play('heroOn');
        if (e.p === me) { flash(); document.body.classList.add('hero'); show('herohud'); sound.intense = 1; buildType = null; selected = 0; view.setGhost(null); view.setSelected(null); faceEnemies(); }
        else toast('Your partner uplinked!');
        break;
      case 'heroOff':
        if (quiet) break;
        sound.play('heroOff');
        if (e.p === me) { flash(); document.body.classList.remove('hero'); show('herohud', false); sound.intense = 0; firing = false; view.setTele(null); if (document.pointerLockElement) document.exitPointerLock(); }
        break;
      case 'wave': {
        if (quiet) break;
        sound.play('wave');
        const tier = sim.tier;
        const sub = e.n % 5 === 0 ? 'Colossus inbound' : tier !== lastTier ? `Bow evolved: ${BOW_TIERS[tier].name}` : e.n === WIN_WAVE && mode !== 'versus' ? 'Final wave' : '';
        if (tier !== lastTier) { lastTier = tier; toast(`${BOW_TIERS[tier].name}: ${BOW_TIERS[tier].perk}`); }
        announce('Wave ' + e.n, sub);
        break;
      }
      case 'boss': if (!quiet) sound.play('boss'); break;
      case 'clear': if (!quiet) { sound.play('clear'); toast(`Wave ${e.n} cleared · +${e.g} credits`); } break;
      case 'levelup': if (!quiet) sound.play('levelup'); break;
      case 'card': if (!quiet && e.p !== me && CARD_BY_ID[e.id]) toast('Partner took ' + CARD_BY_ID[e.id].name); break;
      case 'leak': if (!quiet) { sound.play('leak'); const s = $('lives').parentElement!; s.classList.add('hurt'); setTimeout(() => s.classList.remove('hurt'), 500); } break;
      case 'incoming': if (!quiet) { sound.play('boss'); toast('Incoming from rival: ' + e.n + ' × ' + (ENEMIES[e.type as keyof typeof ENEMIES]?.name || 'enemies')); } break;
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
  for (const id of ['cards', 'menu', 'lobby', 'help', 'settings', 'pause', 'end', 'herohud', 'tower', 'vs', 'tip', 'setup', 'editor']) show(id, false);
  document.body.classList.remove('hero');
  $('toasts').textContent = ''; $('dmg').textContent = '';
  if (document.pointerLockElement) document.exitPointerLock();
  buildType = null; selected = 0; firing = false; paused = false; speed = 1; acc = 0; cardKey = ''; ended = false; readyShown = false; lastTier = 0;
  sound.intense = 0;
  setText('btn-speed', '1×');
}
function startAttract() {
  resetUi();
  net?.close(); net = null; isClient = false;
  mode = 'attract'; me = 0;
  sim = new Sim({ pauseOnCards: false });
  bot = new Bot(sim, 0, 1);
  fastForward(150);
  view.setSim(sim, 0); view.orbit = true;
  show('hud', false); show('menu');
  setText('best', [settings.best ? `Best campaign: wave ${settings.best}` : '', settings.bestSurv ? `Best survival: wave ${settings.bestSurv}` : ''].filter(Boolean).join(' · '));
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
  if (!opts.demo) {
    announce('Defend the Heart', m === 'coop' ? 'Co-op uplink established' : m === 'versus' ? 'Outlast your rival' : `${sim.map.def.name} · ${sim.endless ? 'Survival' : sim.diff.name}`);
    setTimeout(() => { if (sim.wave === 0 && mode === m) toast('Pick a tower below (or press 1), then click a tile beside the road.'); }, 1500);
  }
}
function endGame(win: boolean, title?: string, sub?: string) {
  if (ended) return;
  ended = true;
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.remove('hero'); show('herohud', false); show('cards', false);
  sound.play(win ? 'win' : 'lose'); sound.intense = 0;
  if (mode === 'solo' && !sim.endless && sim.wave > settings.best) { settings.best = sim.wave; save(); }
  if (mode === 'solo' && sim.endless && sim.wave > settings.bestSurv) { settings.bestSurv = sim.wave; save(); }
  if (!win && sim.endless && !title) { title = 'Overrun'; sub = `You held the line for ${Math.max(0, sim.wave - 1)} waves.`; }
  const e = $('end');
  e.classList.toggle('win', win); e.classList.toggle('lose', !win);
  setText('end-title', title || (win ? 'Grid secured' : 'Core breached'));
  setText('end-sub', sub || (win ? 'The Static is broken. Nyx-9 lives another night.' : `The Heart fell on wave ${sim.wave}.`));
  const st = $('end-stats'); st.textContent = '';
  const row = (k: string, v: string | number) => st.append(el('span', '', k), el('b', '', String(v)));
  row('Wave reached', sim.wave); row('Machines destroyed', sim.kills); row('Level', sim.level);
  row('Towers standing', sim.towers.length); row('Time', `${Math.floor(sim.time / 60)}:${String(Math.floor(sim.time % 60)).padStart(2, '0')}`);
  if (mode === 'versus') row('Enemies sent', sim.sent);
  show('e-endless', win && mode === 'solo');
  setText('e-again', mode === 'solo' ? 'Play again' : 'Back to lobby');
  setTimeout(() => show('end'), win ? 1200 : 1800);
}

// ---------- multiplayer ----------
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown) => (fin(v) ? Math.trunc(v) : -1);

function onNet(m: Msg) {
  if (!net) return;
  if (m.t === 'start' && !net.isHost && mode === 'attract') {
    const map = sanitizeMap(m.map);
    if (m.v !== 2 || (m.m !== 'coop' && m.m !== 'versus') || !map) { lobbyStatus('l-join-status', 'Version mismatch — both players should reload.'); return; }
    startGame(m.m, { client: m.m === 'coop', seed: int(m.seed) >>> 0, map, diff: diffById(m.diff).id, survival: m.surv === true });
    return;
  }
  if (mode === 'coop' && isClient && m.t === 'snap') { sim.applySnapshot(m.s); return; }
  if (mode === 'coop' && !isClient && m.t === 'in') {
    const p = sim.players[1];
    if (!p || typeof m.a !== 'string') return;
    switch (m.a) {
      case 'build': { const ty = TOWER_TYPES[int(m.ty)]; if (ty) sim.build(ty, int(m.cx), int(m.cz)); break; }
      case 'up': sim.upgrade(int(m.id)); break;
      case 'sell': sim.sell(int(m.id)); break;
      case 'card': sim.pickCard(1, int(m.i)); break;
      case 'hero': sim.activateHero(1, int(m.id)); break;
      case 'exit': sim.exitHero(1); break;
      case 'tele': sim.heroTeleport(1, int(m.id)); break;
      case 'fire': if (fin(m.x) && fin(m.y) && fin(m.z)) sim.heroFire(1, m.x, m.y, m.z); break;
      case 'skill': if (fin(m.x) && fin(m.y) && fin(m.z)) sim.heroSkill(1, int(m.s), m.x, m.y, m.z); break;
      case 'look': if (fin(m.y) && fin(m.p)) { p.yaw = m.y % (Math.PI * 2); p.pitch = Math.max(-1.4, Math.min(1.4, m.p)); } break;
      case 'wave': sim.startWave(); break;
    }
    return;
  }
  if (mode === 'versus') {
    if (m.t === 'vs' && fin(m.l) && fin(m.w) && fin(m.k)) rival = { l: int(m.l), w: int(m.w), k: int(m.k) };
    else if (m.t === 'squad') { const s = SQUADS[int(m.i)]; if (s) sim.injectSquad(s.type, s.n); }
    else if (m.t === 'dead' && !sim.over) { sim.over = true; endGame(true, 'Victory', 'Your rival’s core has fallen.'); }
  }
}
function onNetClose(why: string) {
  if (mode === 'attract') { lobbyStatus('l-host-status', why); lobbyStatus('l-join-status', why); return; }
  if (ended) return;
  if (mode === 'coop' && !isClient) { toast('Your partner disconnected — you fight on alone.'); net?.close(); net = null; return; }
  if (mode === 'versus') { sim.over = true; endGame(true, 'Victory', 'Your rival disconnected.'); return; }
  sim.over = true; endGame(false, 'Link lost', 'The host disconnected.');
}
const lobbyStatus = (id: string, s: string) => { $(id).textContent = s; };
function openLobby(m: 'coop' | 'versus') {
  lobbyMode = m;
  setText('lobby-title', m === 'coop' ? 'Co-op online' : '1 v 1 online');
  setText('lobby-sub', m === 'coop' ? 'Defend one grid together — two archers, shared credits. No account needed.' : 'Each of you defends your own grid. Spend credits to send squads at your rival. Last core standing wins.');
  show('menu', false); show('lobby'); show('l-code', false);
  lobbyStatus('l-host-status', ''); lobbyStatus('l-join-status', '');
  ($('l-host') as HTMLButtonElement).disabled = false; ($('l-join') as HTMLButtonElement).disabled = false;
  setText('l-choice', `${choice.map.name} · ${diffById(choice.diff).name}${m === 'coop' && choice.survival ? ' · Survival' : ''}`);
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
  lobbyStatus('l-host-status', 'Opening room…');
  const n = newNet(), m = lobbyMode;
  n.onOpen = () => {
    const seed = (Math.random() * 2 ** 31) | 0;
    n.send({ t: 'start', v: 2, m, seed, map: choice.map, diff: choice.diff, surv: choice.survival });
    startGame(m, { seed });
  };
  try {
    const code = await n.host();
    $('l-code').textContent = code; show('l-code');
    lobbyStatus('l-host-status', 'Share this code. Waiting for the other player…');
  } catch { lobbyStatus('l-host-status', 'Could not open a room. Check your connection and try again.'); ($('l-host') as HTMLButtonElement).disabled = false; }
});
$('l-join').addEventListener('click', async () => {
  sound.init(); sound.play('click');
  const code = cleanCode($<HTMLInputElement>('l-input').value);
  if (code.length !== 6) { lobbyStatus('l-join-status', 'Enter the 6-character room code.'); return; }
  ($('l-join') as HTMLButtonElement).disabled = true;
  lobbyStatus('l-join-status', 'Connecting…');
  try { await newNet().join(code); lobbyStatus('l-join-status', 'Connected — waiting for the host…'); }
  catch { lobbyStatus('l-join-status', 'Room not found. Check the code.'); ($('l-join') as HTMLButtonElement).disabled = false; net?.close(); net = null; }
});
$<HTMLInputElement>('l-input').addEventListener('input', (e) => { const i = e.target as HTMLInputElement; i.value = cleanCode(i.value); });
$('l-back').addEventListener('click', () => { net?.close(); net = null; show('lobby', false); show('menu'); });

// ---------- run setup: mode, map, difficulty ----------
function openSetup(target: 'solo' | 'lobby') {
  setupFor = target;
  for (const id of ['menu', 'lobby', 'editor']) show(id, false);
  const all = [...MAPS, ...loadCustomMaps()];
  if (!all.some((m) => m === choice.map || m.id === choice.map.id)) all.push(choice.map);
  const row = $('map-row');
  row.textContent = '';
  const refresh = () => {
    [...row.children].forEach((c, i) => c.classList.toggle('on', all[i].id === choice.map.id && all[i].name === choice.map.name));
    [...$('setup-diff').children].forEach((c) => c.classList.toggle('on', (c as HTMLElement).dataset.v === choice.diff));
    [...$('setup-mode').children].forEach((c) => c.classList.toggle('on', ((c as HTMLElement).dataset.v === 'survival') === choice.survival));
    setText('setup-desc', `${choice.map.desc || 'A custom map.'} ${diffById(choice.diff).desc}`);
  };
  for (const m of all) {
    const b = el('button', 'mapcard');
    const cv = document.createElement('canvas'); cv.width = 208; cv.height = 144;
    drawMap(cv, m);
    b.append(cv, el('b', '', m.name), el('span', '', `${'◆'.repeat(m.tier)}${'◇'.repeat(3 - m.tier)} · ${m.lanes.length} road${m.lanes.length > 1 ? 's' : ''}`));
    b.addEventListener('click', () => { choice.map = m; sound.play('click'); refresh(); });
    row.appendChild(b);
  }
  const df = $('setup-diff');
  df.textContent = '';
  for (const d of DIFFS) {
    const b = el('button', 'chip', d.name);
    b.dataset.v = d.id;
    b.addEventListener('click', () => { choice.diff = d.id; sound.play('click'); refresh(); });
    df.appendChild(b);
  }
  show('setup-mode', lobbyMode !== 'versus' || target === 'solo');
  setText('setup-go', target === 'solo' ? 'Start' : 'Use this map');
  refresh();
  show('setup');
}
for (const b of $('setup-mode').children) b.addEventListener('click', () => { choice.survival = (b as HTMLElement).dataset.v === 'survival'; sound.play('click'); [...$('setup-mode').children].forEach((c) => c.classList.toggle('on', ((c as HTMLElement).dataset.v === 'survival') === choice.survival)); });
function openEditorScreen() {
  for (const id of ['menu', 'setup', 'lobby']) show(id, false);
  show('editor');
  openEditor($('editor'), {
    play(def) { choice.map = def; choice.survival = false; show('editor', false); startGame('solo'); },
    close() { show('editor', false); show('menu'); },
    sound(name) { sound.play(name); },
  }, MAPS.includes(choice.map) ? undefined : choice.map);
}
{ const m = mapById(settings.map); if (m) choice.map = m; choice.diff = diffById(settings.diff).id; }

// ---------- menus ----------
const click = (id: string, fn: () => void) => $(id).addEventListener('click', () => { sound.init(); sound.play('click'); fn(); });
let helpFrom = 'menu', setFrom = 'menu';
click('m-solo', () => openSetup('solo'));
click('m-editor', () => openEditorScreen());
click('l-change', () => openSetup('lobby'));
click('setup-back', () => { show('setup', false); show(setupFor === 'solo' ? 'menu' : 'lobby'); });
click('setup-editor', () => openEditorScreen());
click('setup-go', () => { settings.map = choice.map.id; settings.diff = choice.diff; save(); if (setupFor === 'solo') startGame('solo'); else openLobby(lobbyMode); show('setup', false); });
click('m-coop', () => openLobby('coop'));
click('m-versus', () => openLobby('versus'));
click('m-help', () => { helpFrom = 'menu'; show('menu', false); show('help'); });
click('m-settings', () => { setFrom = 'menu'; show('menu', false); show('settings'); });
click('h-back', () => { show('help', false); show(helpFrom); });
click('s-back', () => { show('settings', false); show(setFrom); save(); });
click('p-resume', () => togglePause(false));
click('p-help', () => { helpFrom = 'pause'; show('pause', false); show('help'); });
click('p-settings', () => { setFrom = 'pause'; show('pause', false); show('settings'); });
click('p-quit', () => { sound.stopMusic(); startAttract(); });
click('e-again', () => { if (mode === 'solo') startGame('solo'); else { const m = mode === 'versus' ? 'versus' : 'coop'; startAttract(); openLobby(m); } });
click('e-menu', () => { sound.stopMusic(); startAttract(); });
click('e-endless', () => { sim.over = false; sim.won = false; sim.endless = true; sim.nextWaveIn = 5; ended = false; show('end', false); toast('Endless mode — how far can you go?'); });
click('btn-pause', () => togglePause());
click('btn-speed', () => { speed = speed === 1 ? 2 : 1; setText('btn-speed', speed + '×'); });
click('btn-wave', () => act.wave());
click('t-up', () => { if (selected) act.upgrade(selected); });
click('t-sell', () => { if (selected) { act.sell(selected); selected = 0; } });
function togglePause(on = !$('pause').classList.contains('hidden') ? false : true) {
  if (mode === 'attract' || ended) return;
  paused = on && mode === 'solo';
  show('pause', on);
  if (on && document.pointerLockElement) document.exitPointerLock();
}
const bind = (id: string, key: 'vol' | 'mus' | 'sens', fn: (v: number) => void) => {
  const i = $<HTMLInputElement>(id);
  i.value = String(settings[key]);
  i.addEventListener('input', () => { settings[key] = +i.value; fn(+i.value); });
};
bind('set-vol', 'vol', (v) => sound.setVolume(v / 100));
bind('set-mus', 'mus', (v) => sound.setMusic(v / 100));
bind('set-sens', 'sens', () => {});
const qsel = $<HTMLSelectElement>('set-q');
qsel.value = settings.q;
qsel.addEventListener('change', () => { settings.q = qsel.value === 'low' ? 'low' : 'high'; view.setQuality(settings.q); });

// ---------- input ----------
function lockPointer() { try { const r = canvas.requestPointerLock() as unknown; if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {}); } catch { /* not allowed */ } }
function tryUlt() {
  const p = sim.players[me];
  if (p.heroActive) { act.exit(); return; }
  if (p.energy < MAX_ENERGY) { sound.play('error'); toast('Uplink is still charging.'); return; }
  if (!sim.towers.length) { sound.play('error'); toast('Build a tower first — Kestrel needs one to stand on.'); return; }
  let id = selected;
  if (!sim.towerById(id)) {
    view.groundPoint(lastMouse.x, lastMouse.y, gp);
    let bd = 1e9;
    for (const t of sim.towers) { const d = Math.hypot(t.x - gp.x, t.z - gp.z); if (d < bd) { bd = d; id = t.id; } }
  }
  act.hero(id);
  lockPointer();
}
const lastMouse = { x: innerWidth / 2, y: innerHeight / 2 };
const playing = () => mode !== 'attract' && !ended && !bot;

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (!playing()) return;
  if (!$('cards').classList.contains('hidden')) { if (k >= '1' && k <= '3') pickCard(+k - 1); return; }
  if (k === 'escape') {
    if (heroOn() || document.pointerLockElement) return; // Esc releases the mouse; Space leaves the uplink
    if (buildType || selected) { buildType = null; selected = 0; view.setGhost(null); } else togglePause();
    return;
  }
  if (k === 'p') { togglePause(); return; }
  if (paused) return;
  if (k === ' ') { e.preventDefault(); tryUlt(); return; }
  if (heroOn()) {
    if (k === 'q' || k === 'e') { view.aimPoint(aim); act.skill(k === 'q' ? 1 : 2, aim); }
    else if (k === 'f') { const id = view.aimTower(); if (id) act.tele(id); else sound.play('error'); }
    return;
  }
  const t = TOWER_TYPES.find((x) => TOWERS[x].key === k);
  if (t) pickBuild(t);
  else if (k === 'u' && selected) act.upgrade(selected);
  else if (k === 'x' && selected) { act.sell(selected); selected = 0; }
  else if (k === 'n') act.wave();
  else if (k === 'g' && mode === 'solo') $('btn-speed').click();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); firing = false; });

canvas.addEventListener('mousemove', (e) => {
  lastMouse.x = e.clientX; lastMouse.y = e.clientY;
  if (!playing()) return;
  if (heroOn()) {
    const s = 0.0022 * (settings.sens / 100);
    view.yaw -= e.movementX * s;
    view.pitch = Math.max(-1.25, Math.min(0.6, view.pitch - e.movementY * s));
    return;
  }
  if (dragging) { const k = view.cam.dist * 0.0016; view.cam.x -= e.movementX * k; view.cam.z -= e.movementY * k * 1.3; clampCam(); }
  view.groundPoint(e.clientX, e.clientY, gp);
  const [cx, cz] = worldToCell(gp.x, gp.z);
  hover.cx = cx; hover.cz = cz;
  refreshGhost();
});
canvas.addEventListener('mousedown', (e) => {
  sound.init();
  if (!playing() || paused) return;
  if (!heroOn()) { view.groundPoint(e.clientX, e.clientY, gp); [hover.cx, hover.cz] = worldToCell(gp.x, gp.z); }
  if (heroOn()) {
    if (!document.pointerLockElement) lockPointer();
    if (e.button === 0) firing = true;
    else if (e.button === 2) { view.aimPoint(aim); act.skill(0, aim); }
    else if (e.button === 1) { const id = view.aimTower(); if (id) act.tele(id); }
    return;
  }
  if (e.button === 2) { if (buildType) { buildType = null; view.setGhost(null); } else selected = 0; dragging = true; return; }
  if (e.button !== 0) return;
  if (buildType) {
    if (act.build(buildType, hover.cx, hover.cz)) { if (!e.shiftKey) { buildType = null; view.setGhost(null); } }
    else { sound.play('error'); if (sim.gold < sim.cost(buildType)) toast('Not enough credits.'); }
    refreshGhost();
    return;
  }
  const t = sim.towers.find((x) => x.cx === hover.cx && x.cz === hover.cz);
  selected = t ? t.id : 0;
  if (t) sound.play('click');
});
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; if (e.button === 2) dragging = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!heroOn()) view.cam.dist = Math.max(20, Math.min(84, view.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
addEventListener('resize', () => view.resize());
function clampCam() { view.cam.x = Math.max(-30, Math.min(30, view.cam.x)); view.cam.z = Math.max(-22, Math.min(24, view.cam.z)); }

// ---------- frame ----------
function updateHud() {
  const p = sim.players[me];
  setText('wave', String(sim.wave));
  setText('wave-sub', mode === 'versus' || sim.endless ? '' : '/ ' + WIN_WAVE);
  setText('lives', String(Math.max(0, sim.lives)));
  setText('gold', String(Math.floor(sim.gold)));
  setText('level', String(sim.level));
  setW('xpbar', sim.xp / sim.xpNext);
  setText('bow', BOW_TIERS[sim.tier].name);
  const hero = p.heroActive;
  setW('ultbar', p.energy / MAX_ENERGY);
  const ready = p.energy >= MAX_ENERGY && !hero;
  $('ult').classList.toggle('ready', ready);
  setText('ult-label', ready ? 'UPLINK READY — PRESS SPACE' : `UPLINK ${Math.floor((p.energy / MAX_ENERGY) * 100)}%`);
  if (ready && !readyShown && !bot) { readyShown = true; sound.play('ready'); announce('Uplink ready', 'Press SPACE to take the field'); }
  if (!ready && !hero) readyShown = readyShown && p.energy > 50;
  const waiting = isClient ? sim.nextWaveIn >= 0 : !sim.queue.length;
  const canCall = waiting && !sim.over && !(sim.wave === WIN_WAVE && mode !== 'versus' && !sim.endless);
  show('btn-wave', canCall && !hero);
  if (canCall) setText('wave-timer', `${Math.max(0, Math.ceil(sim.nextWaveIn))}s · +${Math.round(Math.max(0, sim.nextWaveIn) * 2)}`);
  for (const t of TOWER_TYPES) {
    const b = buildBtns[t], locked = !sim.unlocked.has(t), cost = sim.cost(t);
    b.classList.toggle('locked', locked);
    b.classList.toggle('poor', !locked && sim.gold < cost);
    b.classList.toggle('sel', buildType === t);
    const c = b.lastElementChild as HTMLElement, s = String(cost);
    if (c.textContent !== s) c.textContent = s;
  }
  // selected tower panel
  const t = selected ? sim.towerById(selected) : undefined;
  if (!t) { selected = 0; if (!buildType) view.setSelected(null); }
  show('tower', !!t && !hero);
  if (t) {
    view.setSelected(t, sim.range(t));
    const d = TOWERS[t.type];
    setText('t-name', `${d.name} · Mk ${t.lvl}`);
    const key = `${t.id}:${t.lvl}:${t.buff}:${sim.level}:${sim.towerDmg(t)}:${sim.towerRate(t)}:${sim.range(t)}`;
    if (cache.tstats !== key) {
      cache.tstats = key;
      const st = $('t-stats'); st.textContent = '';
      const line = (k: string, v: string) => { st.append(k + ' ', el('b', '', v), el('br')); };
      if (t.type === 'beacon') line('Boost', `+${Math.round((0.25 + 0.1 * (t.lvl - 1) + sim.mods.beacon) * 100)}% damage`);
      else { line('Damage', sim.towerDmg(t).toFixed(0)); line('Fire rate', sim.towerRate(t).toFixed(2) + '/s'); }
      line('Range', sim.range(t).toFixed(1));
      if (t.buff > 0) line('Beacon', 'boosted');
    }
    const up = $<HTMLButtonElement>('t-up');
    setText('t-up', t.lvl >= 3 ? 'Max level' : `Upgrade (U) · ${sim.upCost(t)}`);
    up.disabled = t.lvl >= 3 || sim.gold < sim.upCost(t);
    setText('t-sell', `Sell (X) · +${sim.sellValue(t)}`);
  }
  if (hero) {
    setW('herobar', p.heroTime / p.heroDur);
    setText('hero-label', `UPLINK ACTIVE · ${Math.max(0, p.heroTime).toFixed(1)}s`);
    for (let s = 0; s < 3; s++) {
      const box = $('sk-' + s), f = Math.max(0, p.cds[s]) / (SKILL_CD[s] * p.stats.cdr);
      (box.lastElementChild as HTMLElement).style.height = (Math.min(1, f) * 100).toFixed(0) + '%';
      box.classList.toggle('cd', f > 0);
    }
  }
  updateMarks(hero);
  if (mode === 'versus') setText('vs-status', `Core ${rival.l} · Wave ${rival.w} · ${rival.k} kills`);
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
      if (!m) { m = marks[n] = el('i', 'mark', '▲'); $('marks').appendChild(m); }
      m.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      m.style.display = 'block';
      n++;
    }
  }
  for (let i = n; i < marks.length; i++) marks[i].style.display = 'none';
}

function frame(dt: number) {
  if (CAPTURE) sound.clock += dt;
  if (!paused) {
    acc += dt * (mode === 'attract' ? 1.4 : speed);
    let n = 0;
    while (acc >= STEP && n < 10) { bot?.step(STEP); if (!isClient) sim.step(STEP); acc -= STEP; n++; }
    if (n === 10) acc = 0;
    if (isClient) for (const p of sim.projs) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  }
  const p = sim.players[me];
  if (bot) { view.yaw = p.yaw; view.pitch = p.pitch; }
  if (mode === 'attract' && sim.over) { sim = new Sim({ pauseOnCards: false }); bot = new Bot(sim, 0, 1); fastForward(150); view.setSim(sim, 0); }

  if (playing() && !paused) {
    if (p.heroActive) {
      if (!isClient) { p.yaw = view.yaw; p.pitch = view.pitch; }
      if (firing) { view.aimPoint(aim); act.fire(aim); }
      const tp = sim.towerById(view.aimTower());
      view.setTele(tp || null);
      $('cross').classList.toggle('tp', !!tp);
      setText('hero-hint', tp ? 'F — TELEPORT' : '');
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
  view.render(dt);
}

// ---------- boot ----------
(async () => {
  view.setQuality(settings.q);
  await view.loadModels((f) => { $('loadbar').style.width = (f * 100).toFixed(0) + '%'; });
  show('loading', false);
  if (CAPTURE) {
    // deterministic stepping for the trailer recorder
    startAttract(); show('menu', false);
    sound.cueLog = [];
    (window as unknown as Record<string, unknown>).__volt = {
      frame, view, announce, toast,
      get sim() { return sim; },
      demo(seed: number, ff: number, mapId?: string) { startGame('solo', { demo: true, seed, map: mapById(mapId) || MAPS[0], diff: 'normal', survival: false }); sound.stopMusic(); fastForward(ff); view.setSim(sim, 0); },
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
        for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
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
  requestAnimationFrame(loop);
})();
