// Map editor: draw roads, place the core, scenery and starting towers, set starting conditions,
// then save / share / test-play the result. DOM is built with createElement + textContent only;
// anything read from storage or a share code goes through sanitizeMap / decodeMap.
import './editor.css';
import { GW, GH, TOWERS, TOWER_TYPES } from './game/data.ts';
import type { TowerType } from './game/data.ts';
import { GameMap, validateMap, sanitizeMap, encodeMap, decodeMap } from './game/map.ts';
import type { MapDef } from './game/map.ts';
import { MAPS } from './game/maps.ts';
import { drawMap } from './game/mapdraw.ts';

export interface EditorHost { play(def: MapDef): void; close(): void; sound(name: string): void }
const KEY = 'voltspire-maps';
const MAX_SAVED = 24;

export function loadCustomMaps(): MapDef[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(0, MAX_SAVED).map(sanitizeMap).filter((m): m is MapDef => !!m) : [];
  } catch { return []; }
}
export function saveCustomMaps(maps: MapDef[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(maps.slice(0, MAX_SAVED))); } catch { /* storage unavailable */ }
}

// ---------- draft model ----------
type Pt = [number, number];
interface Draft {
  name: string; tier: number; gold: number; lives: number; core: Pt;
  lanes: Pt[][]; // always 3 entries, possibly empty
  blocked: Set<number>; towers: Map<number, TowerType>;
}
type Tool = 'r0' | 'r1' | 'r2' | 'core' | 'block' | 'erase' | 'tower';

const M = 3; // margin cells around the board (spawn zone) — matches the lane bounds sanitizeMap accepts (-3 … GW+2)
const COLS = GW + M * 2, ROWS = GH + M * 2;
const MAX_PTS = 48, MAX_BLOCKED = 240, MAX_TOWERS = 30, END_R = 2.6;
const LANE_COL = ['#e3dc92', '#f68b56', '#7fb8ad'];
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const inBoard = (cx: number, cz: number) => cx >= 0 && cx < GW && cz >= 0 && cz < GH;
const idx = (cx: number, cz: number) => cz * GW + cx;

function blankDraft(): Draft {
  return { name: 'Untitled sector', tier: 2, gold: 220, lives: 20, core: [22, 9], lanes: [[], [], []], blocked: new Set(), towers: new Map() };
}
function draftFrom(def: MapDef): Draft {
  const d = blankDraft();
  d.name = def.name.slice(0, 28); d.tier = clamp(Math.round(def.tier) || 2, 1, 3);
  d.gold = clamp(Math.round(def.gold) || 220, 50, 3000); d.lives = clamp(Math.round(def.lives) || 20, 1, 60);
  d.core = [clamp(Math.round(def.core[0]), 1, GW - 2), clamp(Math.round(def.core[1]), 1, GH - 2)];
  def.lanes.slice(0, 3).forEach((l, i) => { d.lanes[i] = l.slice(0, MAX_PTS).map((p) => [p[0], p[1]] as Pt); });
  for (const [cx, cz] of def.blocked) if (inBoard(cx, cz) && d.blocked.size < MAX_BLOCKED) d.blocked.add(idx(cx, cz));
  for (const t of def.towers) {
    if (!inBoard(t.cx, t.cz) || d.towers.size >= MAX_TOWERS || !TOWER_TYPES.includes(t.t)) continue;
    const k = idx(t.cx, t.cz);
    if (!d.blocked.has(k) && !d.towers.has(k)) d.towers.set(k, t.t); // the game skips towers on scenery and duplicate cells
  }
  return d;
}
const hasContent = (d: Draft) => d.lanes.some((l) => l.length > 0) || d.blocked.size > 0 || d.towers.size > 0;
// Same character set sanitizeMap keeps in names, so the name on screen is always the name that gets stored.
const NAME_BAD = /[^\p{L}\p{M}\p{N} .,'!?·:()\-]/gu;
const filterName = (v: string) => v.replace(NAME_BAD, '').slice(0, 28);
const sigOf = (m?: MapDef | null) => { try { return m ? encodeMap(m) : ''; } catch { return ''; } };
function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 17).replace(/-+$/, '') || 'map';
}
/** `occ` (road/core cells) hides scenery and towers that are currently covered; they stay in the draft. */
function draftToDef(d: Draft, lanes: Pt[][], occ?: Uint8Array): MapDef {
  return {
    id: 'custom-' + slug(d.name), name: d.name.trim() || 'Custom map', desc: 'Custom map', tier: d.tier,
    lanes: lanes.map((l) => l.map((p) => [p[0], p[1]] as Pt)), core: [d.core[0], d.core[1]], gold: d.gold, lives: d.lives,
    towers: [...d.towers].filter(([k]) => !occ || !occ[k]).map(([k, t]) => ({ t, cx: k % GW, cz: Math.floor(k / GW) })),
    blocked: [...d.blocked].filter((k) => !occ || !occ[k]).map((k) => [k % GW, Math.floor(k / GW)] as Pt),
  };
}

// ---------- tiny DOM helpers (no HTML strings anywhere) ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(cls: string, text: string, onClick: () => void, label?: string) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

let dispose: (() => void) | null = null;
// These outlive a single openEditor call, so closing the editor never throws work away.
let lastDraft: Draft | null = null; // the draft being edited when the editor was last open
let lastFrom = '';                  // signature of the map that draft was opened from / last test-played as
let prevDraft: Draft | null = null; // one step of history: the draft replaced by New / template / Load / Import

export function openEditor(root: HTMLElement, host: EditorHost, initial?: MapDef): void {
  if (dispose) dispose();
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  let flashTimer = 0;

  // Reopening without a map, or with the map this draft came from / was test-played as, resumes the draft.
  const from = sigOf(initial);
  let d: Draft;
  let resumed = false;
  if (lastDraft && (!initial || from === lastFrom)) { d = lastDraft; resumed = hasContent(d); }
  else {
    if (lastDraft && hasContent(lastDraft)) prevDraft = lastDraft;
    d = initial ? draftFrom(initial) : blankDraft();
  }
  lastDraft = d; lastFrom = from;
  let tool: Tool = 'r0';
  let towerType: TowerType = TOWER_TYPES[0];
  let occ = new Uint8Array(GW * GH); // 1 = road or core
  let problem: string | null = 'x';
  let clean: MapDef | null = null;
  let saved = loadCustomMaps();
  let confirmSave = false;
  let confirmDelete = -1;
  let visBlocked = 0, visTowers = 0; // scenery / towers not hidden under a road or the core
  let hover: Pt | null = null;
  let painting = false;
  let lastPaint: Pt | null = null;
  let cell = 20, dpr = 1;

  const sfx = (n: string) => { try { host.sound(n); } catch { /* sound is optional */ } };

  // ---------- model operations ----------
  function recompute() {
    const lanes = d.lanes.filter((l) => l.length > 0);
    const m = new GameMap(draftToDef({ ...d, blocked: new Set(), towers: new Map() }, lanes));
    occ = m.grid;
    for (const l of lanes) if (l.length === 1) { const cx = Math.round(l[0][0]), cz = Math.round(l[0][1]); if (inBoard(cx, cz)) occ[idx(cx, cz)] = 1; }
    // Scenery and towers under a road or the core are only hidden (not drawn, not exported), never deleted:
    // dragging the core across the board or undoing a road point brings them back.
    visBlocked = 0; visTowers = 0;
    for (const k of d.blocked) if (!occ[k]) visBlocked++;
    for (const k of d.towers.keys()) if (!occ[k]) visTowers++;
    validate(lanes);
  }
  /** Drop hidden entries for good — only used to make room when a limit is reached. */
  function pruneHidden() {
    for (const k of [...d.blocked]) if (occ[k]) d.blocked.delete(k);
    for (const k of [...d.towers.keys()]) if (occ[k]) d.towers.delete(k);
  }
  function validate(lanes: Pt[][]) {
    clean = null;
    if (!lanes.length) { problem = 'Draw Road 1: click just outside the board for the spawn, then click towards the core.'; return; }
    for (let i = 0; i < 3; i++) {
      const l = d.lanes[i];
      if (!l.length) continue;
      const msg = validateMap(draftToDef({ ...d, blocked: new Set(), towers: new Map() }, [l]));
      if (msg && msg.startsWith('Road 1')) {
        let out = 'Road ' + (i + 1) + msg.slice(6);
        if (msg.includes('end next to the core')) out = `Road ${i + 1} must end next to the core — finish it on or beside the core.`;
        problem = out; return;
      }
    }
    const def = draftToDef(d, lanes, occ);
    problem = validateMap(def);
    if (problem) return;
    clean = sanitizeMap(def);
    if (!clean) problem = 'This map has values that are out of range.';
  }
  const free = (cx: number, cz: number) => inBoard(cx, cz) && !occ[idx(cx, cz)];
  function snap(prev: Pt, cx: number, cz: number): Pt {
    return Math.abs(cx - prev[0]) >= Math.abs(cz - prev[1]) ? [cx, prev[1]] : [prev[0], cz];
  }
  const laneOf = (t: Tool) => (t === 'r0' ? 0 : t === 'r1' ? 1 : t === 'r2' ? 2 : -1);

  function addPoint(li: number, cx: number, cz: number) {
    const l = d.lanes[li];
    if (l.length >= MAX_PTS) { flash(`A road can have at most ${MAX_PTS} points.`, true); return; }
    let p: Pt = [cx, cz];
    if (l.length) {
      const prev = l[l.length - 1];
      p = snap(prev, cx, cz);
      if (p[0] === prev[0] && p[1] === prev[1]) return;
    }
    l.push(p); sfx('build'); changed();
  }
  function undoPoint(li: number) {
    if (!d.lanes[li].length) { sfx('error'); return; }
    d.lanes[li].pop(); sfx('sell'); changed();
  }
  function eraseAt(cx: number, cz: number, quiet: boolean) {
    if (!inBoard(cx, cz)) return;
    const k = idx(cx, cz);
    const a = d.blocked.delete(k), b = d.towers.delete(k); // both, never short-circuit
    if (a || b) { if (!quiet) sfx('sell'); changed(); }
  }
  /** Apply the active tool to a cell. `drag` is true for cells reached by dragging. */
  function apply(cx: number, cz: number, drag: boolean) {
    const li = laneOf(tool);
    if (li >= 0) { if (!drag) addPoint(li, cx, cz); return; }
    if (tool === 'core') {
      const nx = clamp(cx, 1, GW - 2), nz = clamp(cz, 1, GH - 2);
      if (nx === d.core[0] && nz === d.core[1]) return;
      d.core = [nx, nz]; if (!drag) sfx('build'); changed(); return;
    }
    if (tool === 'erase') { eraseAt(cx, cz, drag); return; }
    if (!inBoard(cx, cz)) { if (!drag) flash('That is outside the board.', true); return; }
    const k = idx(cx, cz);
    if (occ[k]) { if (!drag) flash('Roads and the core must stay clear.', true); return; }
    if (tool === 'block') {
      if (d.blocked.has(k)) return;
      if (d.towers.has(k)) { if (!drag) flash('There is a tower on that tile — erase it first.', true); return; }
      if (d.blocked.size >= MAX_BLOCKED) pruneHidden();
      if (d.blocked.size >= MAX_BLOCKED) { if (!drag) flash(`At most ${MAX_BLOCKED} blocked tiles.`, true); return; }
      d.blocked.add(k); if (!drag) sfx('build'); changed(); return;
    }
    if (tool === 'tower' && !drag) {
      if (d.blocked.has(k)) { flash('That tile is blocked — erase it first.', true); return; }
      if (d.towers.get(k) === towerType) return;
      if (!d.towers.has(k) && d.towers.size >= MAX_TOWERS) pruneHidden();
      if (!d.towers.has(k) && d.towers.size >= MAX_TOWERS) { flash(`At most ${MAX_TOWERS} starting towers.`, true); return; }
      d.towers.set(k, towerType); sfx('build'); changed();
    }
  }
  /** Replace the whole draft. The one being replaced is kept so "Restore previous draft" can bring it back. */
  function setDraft(nd: Draft, note: string, keepPrev = true) {
    const old = d;
    if (keepPrev && old !== nd && hasContent(old)) prevDraft = old;
    d = nd; lastDraft = nd; confirmSave = false; hover = null;
    nameIn.value = d.name; goldIn.value = String(d.gold); livesIn.value = String(d.lives);
    changed();
    flash(keepPrev && prevDraft === old ? note + ' “Restore previous draft” undoes this.' : note);
  }
  function restorePrev() {
    if (!prevDraft) { sfx('error'); return; }
    const back = prevDraft, cur = d;
    prevDraft = hasContent(cur) ? cur : null; // swap, so the restore itself can be undone
    sfx('click'); setDraft(back, 'Previous draft restored.', false);
    if (prevDraft) restoreBtn.focus(); else canvas.focus({ preventScroll: true });
  }

  // ---------- UI skeleton ----------
  root.replaceChildren();
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Map editor');

  // header
  const head = el('div', 'ed-head');
  head.appendChild(el('h2', 'ed-title', 'Map editor'));
  const nameWrap = el('label', 'ed-name');
  nameWrap.appendChild(el('span', 'ed-lab', 'Name'));
  const nameIn = el('input', 'ed-in');
  nameIn.type = 'text'; nameIn.maxLength = 28; nameIn.value = d.name; nameIn.spellcheck = false; nameIn.autocomplete = 'off';
  nameIn.setAttribute('aria-label', 'Map name');
  // Characters sanitizeMap would strip are removed as they are typed, so two names that look different never collide.
  nameIn.addEventListener('input', (e) => {
    if (!(e as InputEvent).isComposing) {
      const v = nameIn.value, ok = filterName(v);
      if (ok !== v) {
        const caret = filterName(v.slice(0, nameIn.selectionStart ?? v.length)).length;
        nameIn.value = ok;
        try { nameIn.setSelectionRange(caret, caret); } catch { /* caret is cosmetic */ }
        flash('Names can use letters, digits, spaces and . , \' ! ? : ( ) -', true);
      }
    }
    d.name = filterName(nameIn.value); confirmSave = false; changed();
  });
  const settleName = () => { // on blur / Enter / end of IME input: show exactly what will be stored
    const v = filterName(nameIn.value).trim() || 'Custom map';
    if (v !== nameIn.value || v !== d.name) { nameIn.value = v; d.name = v; confirmSave = false; changed(); }
  };
  nameIn.addEventListener('change', settleName);
  nameIn.addEventListener('blur', settleName);
  nameIn.addEventListener('compositionend', () => { d.name = filterName(nameIn.value); changed(); });
  nameWrap.appendChild(nameIn);
  head.appendChild(nameWrap);
  const status = el('div', 'ed-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  head.appendChild(status);
  const headBtns = el('div', 'ed-headbtns');
  const playBtn = button('btn small', 'Test play', () => { if (clean) { sfx('click'); lastFrom = sigOf(clean); host.play(clean); } });
  const saveBtn = button('btn small ghost', 'Save', () => save(false));
  const overwrite = el('span', 'ed-confirm hidden');
  overwrite.append(button('btn small', 'Overwrite', () => save(true)), button('btn small ghost', 'Cancel', () => { confirmSave = false; sfx('click'); refresh(); saveBtn.focus(); }));
  const backBtn = button('btn small ghost', 'Back to menu', () => { sfx('click'); host.close(); });
  headBtns.append(playBtn, saveBtn, overwrite, backBtn);
  head.appendChild(headBtns);

  // body
  const body = el('div', 'ed-body');

  // tools (left)
  const toolsPanel = el('div', 'panel ed-tools');
  toolsPanel.appendChild(el('h3', '', 'Tools'));
  const TOOLS: { id: Tool; name: string; key: string; col: string }[] = [
    { id: 'r0', name: 'Road 1', key: '1', col: LANE_COL[0] },
    { id: 'r1', name: 'Road 2', key: '2', col: LANE_COL[1] },
    { id: 'r2', name: 'Road 3', key: '3', col: LANE_COL[2] },
    { id: 'core', name: 'Core', key: 'C', col: '#efe9d6' },
    { id: 'block', name: 'Block', key: 'B', col: '#8a7f70' },
    { id: 'erase', name: 'Erase', key: 'E', col: '#ce6b44' },
    { id: 'tower', name: 'Start tower', key: 'T', col: '#a9c46c' },
  ];
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  const toolMeta = new Map<Tool, HTMLElement>();
  const toolList = el('div', 'ed-toollist');
  toolList.setAttribute('role', 'toolbar'); toolList.setAttribute('aria-label', 'Editing tools');
  for (const t of TOOLS) {
    const b = el('button', 'ed-tool'); b.type = 'button';
    b.style.setProperty('--c', t.col);
    b.setAttribute('aria-label', `${t.name} tool (hotkey ${t.key})`);
    b.appendChild(el('i', 'ed-sw'));
    b.appendChild(el('span', 'ed-tname', t.name));
    const meta = el('span', 'ed-tmeta', ''); b.appendChild(meta); toolMeta.set(t.id, meta);
    b.appendChild(el('kbd', '', t.key));
    b.addEventListener('click', () => setTool(t.id));
    toolBtns.set(t.id, b); toolList.appendChild(b);
  }
  toolsPanel.appendChild(toolList);
  // context: road actions
  const roadCtx = el('div', 'ed-ctx');
  const roadInfo = el('p', 'small muted', '');
  const undoBtn = button('btn small ghost', 'Undo point', () => { const li = laneOf(tool); if (li >= 0) undoPoint(li); }, 'Undo last road point (Backspace)');
  const clearBtn = button('btn small ghost', 'Clear road', () => { const li = laneOf(tool); if (li >= 0 && d.lanes[li].length) { d.lanes[li] = []; sfx('sell'); changed(); } });
  roadCtx.append(roadInfo, undoBtn, clearBtn);
  // context: tower type
  const towerCtx = el('div', 'ed-ctx');
  const towerInfo = el('p', 'small muted', '');
  const towerGrid = el('div', 'ed-towers');
  towerGrid.setAttribute('role', 'radiogroup'); towerGrid.setAttribute('aria-label', 'Starting tower type');
  const towerBtns = new Map<TowerType, HTMLButtonElement>();
  for (const t of TOWER_TYPES) {
    const b = el('button', 'ed-tw'); b.type = 'button';
    b.style.setProperty('--c', hex(TOWERS[t].color));
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', TOWERS[t].name);
    b.appendChild(el('i', 'ed-sw'));
    b.appendChild(el('span', '', TOWERS[t].name));
    b.addEventListener('click', () => { towerType = t; sfx('click'); refresh(); draw(); });
    towerBtns.set(t, b); towerGrid.appendChild(b);
  }
  towerCtx.append(towerInfo, towerGrid);
  const otherCtx = el('div', 'ed-ctx');
  const otherInfo = el('p', 'small muted', '');
  otherCtx.appendChild(otherInfo);
  toolsPanel.append(roadCtx, towerCtx, otherCtx);

  // stage (centre)
  const centre = el('div', 'ed-centre');
  const stage = el('div', 'ed-stage');
  const canvas = el('canvas', 'ed-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Map grid. Click or use arrow keys and Enter to apply the selected tool.');
  stage.appendChild(canvas);
  const foot = el('div', 'ed-foot');
  const hint = el('span', 'ed-hint', '');
  const coord = el('span', 'ed-coord', '');
  foot.append(hint, coord);
  centre.append(stage, foot);

  // side (right)
  const side = el('div', 'ed-side');

  const props = el('div', 'panel');
  props.appendChild(el('h3', '', 'Start conditions'));
  function numField(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) {
    const row = el('label', 'ed-row');
    row.appendChild(el('span', '', label));
    const inp = el('input', 'ed-in ed-num');
    inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(get());
    inp.setAttribute('aria-label', `${label} (${min} to ${max})`);
    inp.addEventListener('input', () => { const v = Number(inp.value); if (inp.value !== '' && Number.isFinite(v)) { set(clamp(Math.round(v), min, max)); confirmSave = false; changed(); } });
    inp.addEventListener('change', () => { inp.value = String(get()); });
    row.appendChild(inp);
    props.appendChild(row);
    return inp;
  }
  const goldIn = numField('Starting credits', 50, 3000, 10, () => d.gold, (v) => { d.gold = v; });
  const livesIn = numField('Core integrity', 1, 60, 1, () => d.lives, (v) => { d.lives = v; });
  const tierRow = el('div', 'ed-row col');
  tierRow.appendChild(el('span', '', 'Complexity'));
  const tierSeg = el('div', 'ed-seg');
  tierSeg.setAttribute('role', 'radiogroup'); tierSeg.setAttribute('aria-label', 'Complexity tier');
  const tierBtns: HTMLButtonElement[] = [];
  ['Simple', 'Tricky', 'Complex'].forEach((n, i) => {
    const b = button('chip', `${i + 1} ${n}`, () => { d.tier = i + 1; sfx('click'); changed(); });
    b.setAttribute('role', 'radio');
    tierBtns.push(b); tierSeg.appendChild(b);
  });
  tierRow.appendChild(tierSeg);
  props.appendChild(tierRow);

  const start = el('div', 'panel');
  start.appendChild(el('h3', '', 'Start from'));
  const tplRow = el('div', 'ed-seg wrap');
  tplRow.appendChild(button('chip', 'New (blank)', () => { sfx('click'); setDraft(blankDraft(), 'Blank map.'); }, 'New blank map'));
  for (const m of MAPS) tplRow.appendChild(button('chip', m.name, () => { sfx('click'); const nd = draftFrom(m); nd.name = (m.name + ' remix').slice(0, 28); setDraft(nd, `Template “${m.name}” loaded.`); }, `Start from template ${m.name}`));
  start.appendChild(tplRow);
  const restoreBtn = button('btn small ghost ed-restore hidden', 'Restore previous draft', () => restorePrev(), 'Restore the draft that was replaced');
  start.appendChild(restoreBtn);

  const savedPanel = el('div', 'panel');
  const savedTitle = el('h3', '', 'Saved maps');
  const savedList = el('div', 'ed-saved');
  savedPanel.append(savedTitle, savedList);

  const share = el('div', 'panel');
  share.appendChild(el('h3', '', 'Share'));
  const copyBtn = button('btn small ghost', 'Copy share code', () => copyCode());
  const outTa = el('textarea', 'ed-in ed-ta hidden');
  outTa.readOnly = true; outTa.rows = 2; outTa.spellcheck = false; outTa.setAttribute('aria-label', 'Share code for this map');
  const inTa = el('textarea', 'ed-in ed-ta');
  inTa.rows = 2; inTa.spellcheck = false; inTa.placeholder = 'Paste a share code…'; inTa.maxLength = 20000; inTa.setAttribute('aria-label', 'Share code to import');
  const importBtn = button('btn small ghost', 'Import from code', () => importCode());
  const shareMsg = el('p', 'small ed-sharemsg', '');
  shareMsg.setAttribute('role', 'status'); shareMsg.setAttribute('aria-live', 'polite');
  share.append(copyBtn, outTa, inTa, importBtn, shareMsg);

  side.append(props, start, savedPanel, share);
  body.append(toolsPanel, centre, side);
  root.append(head, body);

  // ---------- actions ----------
  function flash(text: string, bad = false) {
    if (bad) sfx('error');
    hint.textContent = text; hint.classList.toggle('bad', bad); hint.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { hint.classList.remove('flash', 'bad'); hint.textContent = toolHint(); }, 2600);
  }
  function toolHint() {
    const li = laneOf(tool);
    if (li >= 0) return d.lanes[li].length
      ? 'Click to add a corner (segments snap straight). Finish on or beside the core. Right-click or Backspace undoes.'
      : 'Click in the dim margin just outside the board to place this road’s spawn gate.';
    if (tool === 'core') return 'Click or drag to move the core (3×3). Every road has to end beside it.';
    if (tool === 'block') return 'Click or drag to paint scenery that cannot be built on. Right-click erases.';
    if (tool === 'erase') return 'Click or drag to remove blocked tiles and starting towers.';
    return 'Click a free tile to place the selected tower. Right-click erases.';
  }
  function cancelDelete() { if (confirmDelete !== -1) { confirmDelete = -1; renderSaved(); } }
  function setTool(t: Tool) {
    cancelDelete();
    if (tool === 'tower' && t === 'tower') towerType = TOWER_TYPES[(TOWER_TYPES.indexOf(towerType) + 1) % TOWER_TYPES.length];
    tool = t; sfx('click'); refresh(); draw();
  }
  function save(force: boolean) {
    if (!clean) { sfx('error'); return; }
    const at = saved.findIndex((m) => m.name.toLowerCase() === clean!.name.toLowerCase());
    if (at >= 0 && !force) { confirmSave = true; sfx('click'); refresh(); (overwrite.querySelector('button') as HTMLButtonElement | null)?.focus(); return; }
    if (at < 0 && saved.length >= MAX_SAVED) { flash(`The saved list is full (${MAX_SAVED}). Delete a map first.`, true); return; }
    if (at >= 0) saved[at] = clean; else saved.unshift(clean);
    saveCustomMaps(saved);
    // Verify by content, not by name: an overwrite that failed still leaves the old map under the same name.
    const want = JSON.stringify(clean);
    const back = loadCustomMaps();
    const ok = back.some((m) => JSON.stringify(m) === want);
    saved = ok ? back : saved;
    confirmSave = false; confirmDelete = -1;
    if (ok) { sfx('card'); flash(`Saved “${clean.name}”.`); } else flash('Could not write to browser storage — the map is kept for this session only.', true);
    refresh(); renderSaved();
  }
  function setShareMsg(text: string, bad: boolean) { shareMsg.textContent = text; shareMsg.classList.toggle('bad', bad); shareMsg.classList.toggle('ok', !bad); }
  function copyCode() {
    if (!clean) { sfx('error'); return; }
    const code = encodeMap(clean);
    outTa.value = code; outTa.classList.remove('hidden');
    const fallback = () => {
      outTa.focus(); outTa.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch { done = false; }
      setShareMsg(done ? 'Share code copied.' : 'Code selected — press Ctrl+C to copy it.', false);
    };
    sfx('click');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(() => setShareMsg('Share code copied to the clipboard.', false), fallback);
      else fallback();
    } catch { fallback(); }
  }
  function importCode() {
    const text = inTa.value.trim();
    if (!text) { sfx('error'); setShareMsg('Paste a share code first.', true); return; }
    const def = decodeMap(text);
    if (!def) { sfx('error'); setShareMsg('That code is not a valid VOLTSPIRE map.', true); return; }
    inTa.value = ''; outTa.classList.add('hidden');
    sfx('card'); setDraft(draftFrom(def), `Imported “${def.name}”.`);
    setShareMsg(`Imported “${def.name}”.`, false);
  }

  // ---------- refresh (DOM state) ----------
  // Rebuilt only when the saved list or a pending delete changes — never from the generic refresh().
  function renderSaved(focus?: { row: number; btn: 'del' | 'keep' }) {
    let target: HTMLButtonElement | null = null;
    savedTitle.textContent = `Saved maps · ${saved.length}/${MAX_SAVED}`;
    savedList.replaceChildren();
    if (!saved.length) { savedList.appendChild(el('p', 'small muted', 'Nothing saved yet. Maps are stored in this browser.')); return; }
    saved.forEach((m, i) => {
      const row = el('div', 'ed-savedrow');
      const cv = el('canvas', 'ed-thumb'); cv.width = 104; cv.height = 72; cv.setAttribute('aria-hidden', 'true');
      drawMap(cv, m);
      const info = el('div', 'ed-savedinfo');
      info.appendChild(el('b', '', m.name));
      info.appendChild(el('span', 'small muted', `${m.lanes.length} road${m.lanes.length > 1 ? 's' : ''} · tier ${m.tier} · ${m.gold} cr`));
      const btns = el('div', 'ed-savedbtns');
      btns.appendChild(button('chip', 'Load', () => { sfx('click'); setDraft(draftFrom(m), `Loaded “${m.name}”.`); }, `Load ${m.name}`));
      if (confirmDelete === i) {
        // "Keep" takes the place (and the focus) of "Delete": a double click or a second Enter never deletes.
        const keep = button('chip', 'Keep', () => { confirmDelete = -1; sfx('click'); renderSaved({ row: i, btn: 'del' }); }, `Keep ${m.name}`);
        const yes = button('chip danger', 'Really?', () => {
          saved.splice(i, 1); saveCustomMaps(saved); confirmDelete = -1; sfx('sell'); flash(`Deleted “${m.name}”.`);
          renderSaved(); canvas.focus({ preventScroll: true });
        }, `Confirm deleting ${m.name}`);
        btns.append(keep, yes);
        if (focus && focus.row === i && focus.btn === 'keep') target = keep;
      } else {
        const del = button('chip', 'Delete', () => { confirmDelete = i; sfx('click'); renderSaved({ row: i, btn: 'keep' }); }, `Delete ${m.name}`);
        btns.appendChild(del);
        if (focus && focus.row === i && focus.btn === 'del') target = del;
      }
      info.appendChild(btns);
      row.append(cv, info);
      savedList.appendChild(row);
    });
    (target as HTMLButtonElement | null)?.focus(); // once, from the click that asked for it
  }
  function refresh() {
    const ok = !problem;
    if (!ok) confirmSave = false;
    const ask = confirmSave && !!clean;
    status.textContent = ask ? `“${clean!.name}” is already saved — overwrite it?` : ok ? 'Ready to play' : problem;
    status.classList.toggle('ok', ok && !ask); status.classList.toggle('bad', !ok || ask);
    playBtn.disabled = !ok; saveBtn.disabled = !ok; copyBtn.disabled = !ok;
    saveBtn.classList.toggle('hidden', confirmSave);
    overwrite.classList.toggle('hidden', !confirmSave);
    for (const [id, b] of toolBtns) { b.classList.toggle('on', id === tool); b.setAttribute('aria-pressed', String(id === tool)); }
    for (let i = 0; i < 3; i++) {
      const l = d.lanes[i], meta = toolMeta.get((['r0', 'r1', 'r2'] as Tool[])[i])!;
      const done = l.length > 1 && Math.hypot(l[l.length - 1][0] - d.core[0], l[l.length - 1][1] - d.core[1]) <= END_R;
      meta.textContent = !l.length ? (i ? 'optional' : 'empty') : done ? 'linked' : `${l.length} pt${l.length > 1 ? 's' : ''}`;
      meta.classList.toggle('ok', done);
    }
    toolMeta.get('block')!.textContent = visBlocked ? String(visBlocked) : '';
    toolMeta.get('tower')!.textContent = visTowers ? `${visTowers}/${MAX_TOWERS}` : '';
    const li = laneOf(tool);
    roadCtx.classList.toggle('hidden', li < 0);
    towerCtx.classList.toggle('hidden', tool !== 'tower');
    otherCtx.classList.toggle('hidden', li >= 0 || tool === 'tower');
    if (li >= 0) {
      const n = d.lanes[li].length;
      roadInfo.textContent = n ? `Road ${li + 1}: ${n} of ${MAX_PTS} points.` : `Road ${li + 1} is empty${li ? ' (optional)' : ''}. Start at a board edge.`;
      undoBtn.disabled = !n; clearBtn.disabled = !n;
    }
    towerInfo.textContent = `Pre-built when the run starts (${visTowers}/${MAX_TOWERS}). Press T to cycle.`;
    for (const [t, b] of towerBtns) { b.classList.toggle('on', t === towerType); b.setAttribute('aria-checked', String(t === towerType)); }
    otherInfo.textContent = tool === 'core' ? 'The core is what the machines are after. It keeps one tile from the border.'
      : tool === 'block' ? `Scenery tiles: ${visBlocked} of ${MAX_BLOCKED}.` : 'Removes scenery and starting towers. Roads are edited with their own tool.';
    tierBtns.forEach((b, i) => { b.classList.toggle('on', d.tier === i + 1); b.setAttribute('aria-checked', String(d.tier === i + 1)); });
    if (!hint.classList.contains('flash')) hint.textContent = toolHint();
    restoreBtn.classList.toggle('hidden', !prevDraft);
  }
  /** The draft changed: any pending delete confirmation and any share code on screen are now stale. */
  function changed() {
    cancelDelete();
    if (!outTa.classList.contains('hidden') || shareMsg.textContent) { outTa.value = ''; outTa.classList.add('hidden'); setShareMsg('', false); }
    recompute(); refresh(); draw();
  }

  // ---------- canvas ----------
  const ctx = canvas.getContext('2d');
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w < 10 || h < 10) return;
    cell = Math.max(6, Math.floor(Math.min(w / COLS, h / ROWS) * 2) / 2);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.width = COLS * cell + 'px'; canvas.style.height = ROWS * cell + 'px';
    const pw = Math.round(COLS * cell * dpr), ph = Math.round(ROWS * cell * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    draw();
  }
  function draw() {
    const g = ctx;
    if (!g) return;
    const s = cell;
    const X = (c: number) => (c + M + 0.5) * s, Z = (c: number) => (c + M + 0.5) * s; // cell centre
    const L = (c: number) => (c + M) * s; // cell left/top edge
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.shadowBlur = 0; g.setLineDash([]); g.globalAlpha = 1;
    g.fillStyle = '#0c0a09'; g.fillRect(0, 0, COLS * s, ROWS * s);
    // spawn margin: faint dots at cell centres
    g.fillStyle = 'rgba(227,220,146,0.2)';
    for (let cz = -M; cz < GH + M; cz++) for (let cx = -M; cx < GW + M; cx++) if (!inBoard(cx, cz)) g.fillRect(X(cx) - 1, Z(cz) - 1, 2, 2);
    // board
    const bg = g.createLinearGradient(0, L(0), 0, L(GH));
    bg.addColorStop(0, '#231d19'); bg.addColorStop(1, '#1c1714');
    g.fillStyle = bg; g.fillRect(L(0), L(0), GW * s, GH * s);
    g.strokeStyle = 'rgba(227,220,146,0.07)'; g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < GW; x++) { g.moveTo(Math.round(L(x)) + 0.5, L(0)); g.lineTo(Math.round(L(x)) + 0.5, L(GH)); }
    for (let z = 1; z < GH; z++) { g.moveTo(L(0), Math.round(L(z)) + 0.5); g.lineTo(L(GW), Math.round(L(z)) + 0.5); }
    g.stroke();
    // road bed + core footprint
    const inCore = (cx: number, cz: number) => Math.abs(cx - d.core[0]) <= 1 && Math.abs(cz - d.core[1]) <= 1;
    g.fillStyle = '#0c0a09';
    for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) if (occ[idx(cx, cz)] && !inCore(cx, cz)) g.fillRect(L(cx), L(cz), s, s);
    // blocked scenery
    for (const k of d.blocked) {
      if (occ[k]) continue;
      const x = L(k % GW), z = L(Math.floor(k / GW));
      g.fillStyle = '#3a3029'; g.fillRect(x + 1, z + 1, s - 2, s - 2);
      g.fillStyle = '#4c4037'; g.fillRect(x + 1, z + 1, s - 2, Math.max(2, s * 0.16));
      g.strokeStyle = 'rgba(16,14,12,0.7)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + s * 0.3, z + s * 0.42); g.lineTo(x + s * 0.7, z + s * 0.78); g.moveTo(x + s * 0.7, z + s * 0.42); g.lineTo(x + s * 0.3, z + s * 0.78); g.stroke();
    }
    g.strokeStyle = 'rgba(227,220,146,0.45)'; g.lineWidth = 1.5; g.strokeRect(L(0), L(0), GW * s, GH * s);
    // core
    const activeLane = laneOf(tool);
    g.fillStyle = 'rgba(239,233,214,0.08)'; g.fillRect(L(d.core[0] - 1), L(d.core[1] - 1), s * 3, s * 3);
    g.strokeStyle = 'rgba(239,233,214,0.75)'; g.lineWidth = 1.5; g.strokeRect(L(d.core[0] - 1) + 1, L(d.core[1] - 1) + 1, s * 3 - 2, s * 3 - 2);
    if (activeLane >= 0) {
      g.strokeStyle = 'rgba(239,233,214,0.35)'; g.lineWidth = 1; g.setLineDash([4, 5]);
      g.beginPath(); g.arc(X(d.core[0]), Z(d.core[1]), END_R * s, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    // roads
    g.lineJoin = 'round'; g.lineCap = 'round';
    d.lanes.forEach((l, i) => {
      if (!l.length) return;
      const col = LANE_COL[i], dim = activeLane >= 0 && activeLane !== i;
      g.globalAlpha = dim ? 0.55 : 1;
      if (l.length > 1) {
        g.strokeStyle = col; g.lineWidth = Math.max(2, s * 0.22);
        g.shadowColor = 'transparent'; g.shadowBlur = dim ? 0 : 8;
        g.beginPath(); g.moveTo(X(l[0][0]), Z(l[0][1]));
        for (const p of l.slice(1)) g.lineTo(X(p[0]), Z(p[1]));
        g.stroke(); g.shadowBlur = 0;
        // direction arrows
        g.fillStyle = '#0c0a09';
        for (let k = 1; k < l.length; k++) {
          const a = l[k - 1], b = l[k], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 3) continue;
          const mx = X((a[0] + b[0]) / 2), mz = Z((a[1] + b[1]) / 2), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, r = s * 0.2;
          g.beginPath(); g.moveTo(mx + ux * r, mz + uz * r); g.lineTo(mx - ux * r - uz * r, mz - uz * r + ux * r); g.lineTo(mx - ux * r + uz * r, mz - uz * r - ux * r); g.closePath();
          g.strokeStyle = col; g.lineWidth = 1; g.fill(); g.stroke();
        }
      }
      // corner points
      for (let k = 1; k < l.length; k++) {
        g.fillStyle = '#0c0a09'; g.strokeStyle = col; g.lineWidth = 1.5;
        g.beginPath(); g.arc(X(l[k][0]), Z(l[k][1]), s * 0.17, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      // end marker: green when linked to the core
      if (l.length > 1) {
        const e = l[l.length - 1], linked = Math.hypot(e[0] - d.core[0], e[1] - d.core[1]) <= END_R;
        g.strokeStyle = linked ? '#a9c46c' : '#ce6b44'; g.lineWidth = 2;
        g.beginPath(); g.arc(X(e[0]), Z(e[1]), s * 0.34, 0, Math.PI * 2); g.stroke();
      }
      // spawn gate
      g.fillStyle = '#8fd0ff'; g.shadowColor = 'transparent'; g.shadowBlur = dim ? 0 : 10;
      g.beginPath(); g.arc(X(l[0][0]), Z(l[0][1]), s * 0.42, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      g.fillStyle = '#0c1420'; g.font = `700 ${Math.max(8, Math.round(s * 0.5))}px 'Barlow Condensed', system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), X(l[0][0]), Z(l[0][1]) + 0.5);
      g.globalAlpha = 1;
    });
    // core emblem (above the road ends)
    g.fillStyle = '#efe9d6'; g.shadowColor = 'transparent'; g.shadowBlur = 14;
    g.beginPath(); g.arc(X(d.core[0]), Z(d.core[1]), s * 0.62, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    g.fillStyle = '#100e0c'; g.beginPath(); g.arc(X(d.core[0]), Z(d.core[1]), s * 0.26, 0, Math.PI * 2); g.fill();
    // starting towers
    const tower = (cx: number, cz: number, t: TowerType, alpha: number) => {
      const c = hex(TOWERS[t].color);
      g.globalAlpha = alpha;
      g.fillStyle = '#100e0c'; g.strokeStyle = c; g.lineWidth = 1.5;
      g.beginPath(); g.rect(L(cx) + 2, L(cz) + 2, s - 4, s - 4); g.fill(); g.stroke();
      g.fillStyle = c; g.shadowColor = 'transparent'; g.shadowBlur = 6;
      g.beginPath(); g.arc(X(cx), Z(cz), s * 0.22, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0; g.globalAlpha = 1;
    };
    for (const [k, t] of d.towers) if (!occ[k]) tower(k % GW, Math.floor(k / GW), t, 1);
    // hover / tool preview
    if (hover) {
      const [hx, hz] = hover;
      const outline = (cx: number, cz: number, w: number, col: string) => { g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(L(cx) + 1, L(cz) + 1, s * w - 2, s * w - 2); };
      if (activeLane >= 0) {
        const l = d.lanes[activeLane], col = LANE_COL[activeLane];
        if (l.length) {
          const prev = l[l.length - 1], p = snap(prev, hx, hz);
          g.strokeStyle = col; g.lineWidth = Math.max(2, s * 0.14); g.setLineDash([s * 0.3, s * 0.3]); g.globalAlpha = 0.85;
          g.beginPath(); g.moveTo(X(prev[0]), Z(prev[1])); g.lineTo(X(p[0]), Z(p[1])); g.stroke();
          g.setLineDash([]); g.globalAlpha = 1;
          const linked = Math.hypot(p[0] - d.core[0], p[1] - d.core[1]) <= END_R;
          g.strokeStyle = linked ? '#a9c46c' : col; g.lineWidth = 2;
          g.beginPath(); g.arc(X(p[0]), Z(p[1]), s * 0.36, 0, Math.PI * 2); g.stroke();
        } else {
          outline(hx, hz, 1, col);
          g.fillStyle = col; g.font = `700 ${Math.max(8, Math.round(s * 0.42))}px 'Barlow Condensed', system-ui, sans-serif`; g.textBaseline = 'middle';
          const right = hx > GW / 2; g.textAlign = right ? 'right' : 'left';
          g.fillText('SPAWN', right ? L(hx) - 4 : L(hx + 1) + 4, Z(hz) + 0.5);
        }
      } else if (tool === 'core') {
        outline(clamp(hx, 1, GW - 2) - 1, clamp(hz, 1, GH - 2) - 1, 3, '#efe9d6');
      } else if (tool === 'erase') {
        if (inBoard(hx, hz)) outline(hx, hz, 1, '#ce6b44');
      } else if (inBoard(hx, hz)) {
        const k = idx(hx, hz);
        const ok = free(hx, hz) && (tool === 'block' ? !d.towers.has(k) : !d.blocked.has(k));
        if (ok && tool === 'tower' && !d.towers.has(k)) tower(hx, hz, towerType, 0.6);
        outline(hx, hz, 1, ok ? '#a9c46c' : '#ce6b44');
      }
    }
  }

  function cellAt(ev: PointerEvent | MouseEvent): Pt {
    const r = canvas.getBoundingClientRect();
    const sx = r.width / COLS || cell;
    return [clamp(Math.floor((ev.clientX - r.left) / sx) - M, -M, GW + M - 1), clamp(Math.floor((ev.clientY - r.top) / sx) - M, -M, GH + M - 1)];
  }
  function setHover(p: Pt | null) {
    hover = p;
    coord.textContent = p ? `x ${p[0]} · z ${p[1]}${inBoard(p[0], p[1]) ? '' : ' · spawn margin'}` : '';
  }
  /** Apply a drag across every cell between the previous painted cell and this one. */
  function paintTo(p: Pt) {
    const a = lastPaint || p;
    const n = Math.max(Math.abs(p[0] - a[0]), Math.abs(p[1] - a[1]));
    for (let i = 1; i <= n; i++) apply(Math.round(a[0] + ((p[0] - a[0]) * i) / n), Math.round(a[1] + ((p[1] - a[1]) * i) / n), true);
    lastPaint = p;
  }
  function secondary(p: Pt) {
    const li = laneOf(tool);
    if (li >= 0) undoPoint(li); else eraseAt(p[0], p[1], false);
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), sig);
  canvas.addEventListener('pointerdown', (e) => {
    const p = cellAt(e);
    setHover(p);
    if (e.button === 2) { e.preventDefault(); secondary(p); draw(); return; }
    if (e.button !== 0) return;
    cancelDelete();
    canvas.classList.remove('kb');
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    painting = true; lastPaint = p;
    apply(p[0], p[1], false); draw();
  }, sig);
  canvas.addEventListener('pointermove', (e) => {
    const p = cellAt(e);
    if (hover && hover[0] === p[0] && hover[1] === p[1]) return;
    setHover(p);
    if (painting && (tool === 'block' || tool === 'erase' || tool === 'core')) paintTo(p);
    draw();
  }, sig);
  const endPaint = () => { painting = false; lastPaint = null; };
  canvas.addEventListener('pointerup', endPaint, sig);
  canvas.addEventListener('pointercancel', endPaint, sig);
  canvas.addEventListener('pointerleave', () => { if (!painting) { setHover(null); draw(); } }, sig);
  // keyboard cursor on the grid
  canvas.addEventListener('keydown', (e) => {
    const mv: Record<string, Pt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const h: Pt = hover || [d.core[0], d.core[1]];
    if (mv[e.key]) {
      e.preventDefault(); canvas.classList.add('kb');
      setHover([clamp(h[0] + mv[e.key][0], -M, GW + M - 1), clamp(h[1] + mv[e.key][1], -M, GH + M - 1)]); draw();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); setHover(h); apply(h[0], h[1], false); draw();
    } else if (e.key === 'Delete') {
      e.preventDefault(); secondary(h); draw();
    }
  }, sig);

  // global hotkeys (only while the editor is visible and the user is not typing)
  window.addEventListener('keydown', (e) => {
    if (root.classList.contains('hidden') || !root.isConnected) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'Backspace') {
      const li = laneOf(tool);
      if (li >= 0) { e.preventDefault(); undoPoint(li); }
      return;
    }
    const hit = TOOLS.find((x) => x.key === e.key.toUpperCase());
    if (hit) { e.preventDefault(); setTool(hit.id); }
  }, sig);

  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);
  window.addEventListener('resize', resize, sig);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!ac.signal.aborted) draw(); }).catch(() => { /* fonts are cosmetic */ });

  dispose = () => { ac.abort(); ro.disconnect(); clearTimeout(flashTimer); dispose = null; };

  changed();
  renderSaved();
  resize();
  if (resumed) flash('Picked up your draft where you left it.');
}
