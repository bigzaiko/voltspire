// The player's own music: a small playlist of YouTube and Spotify links next to the built-in soundtrack.
// Only a service kind and an id are ever kept from a pasted link. The embed address is always
// rebuilt from those two, and an embed is only created when the player presses play on an entry.
import './music.css';

export interface MusicHost {
  /** container element the music sheet builds its UI in */
  root: HTMLElement;
  /** mute or unmute the built-in soundtrack while external music plays */
  setScoreMuted(muted: boolean): void;
  toast(text: string): void;
  click(): void;
}
export interface MusicApi {
  /** (re)build the sheet UI; called when the player opens it */
  open(): void;
  isExternalPlaying(): boolean;
  /** beats per minute the player set or tapped for external music, or null */
  bpm(): number | null;
  /** false while the external player is known to be silent (paused, loading, blocked). Unknown counts as playing. */
  beatOn(): boolean;
  /** time of the last tap for the entry that plays, on the performance.now() clock, or 0 when it was never tapped */
  beatOrigin(): number;
}

export type SpType = 'track' | 'album' | 'playlist' | 'episode' | 'show';
export interface MusicEntry { kind: 'yt' | 'ytlist' | 'sp'; spType?: SpType; id: string; label?: string; bpm?: number }

const KEY = 'voltspire-music';
const MAX_ENTRIES = 100;
const MAX_LABEL = 60;
const MAX_LINK = 2048;
const MAX_JSON = 200000;
const BPM_MIN = 40, BPM_MAX = 220;

const YT_ORIGIN = 'https://www.youtube-nocookie.com';
const SP_ORIGIN = 'https://open.spotify.com';
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{13,64}$/;
const SP_ID = /^[0-9A-Za-z]{22}$/;
const SP_URI = /^spotify:(track|album|playlist|episode|show):([0-9A-Za-z]{22})$/;
const SP_PATH = /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(track|album|playlist|episode|show)\/([0-9A-Za-z]{22})\/?$/;
const YT_PATH = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})\/?$/;
const YT_SHORT = /^\/([A-Za-z0-9_-]{11})\/?$/;
const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com'];
const SP_TYPES: readonly string[] = ['track', 'album', 'playlist', 'episode', 'show'];
// Control characters and the invisible direction overrides have no place in a label.
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** Read a pasted link. Returns only a kind and an id, or null when the text is not one of the known forms. */
export function parseMusicLink(text: unknown): MusicEntry | null {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (!s || s.length > MAX_LINK) return null;
  if (/[\s\\\u0000-\u001f\u007f]/.test(s)) return null;
  const uri = SP_URI.exec(s);
  if (uri) return { kind: 'sp', spType: uri[1] as SpType, id: uri[2] };
  if (!/^https?:\/\//i.test(s)) {
    if (s[0] === '/' || /^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
    s = 'https://' + s;
  }
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || u.port) return null;
  const host = u.hostname, path = u.pathname;
  if (host === 'open.spotify.com') {
    const m = SP_PATH.exec(path);
    return m ? { kind: 'sp', spType: m[1] as SpType, id: m[2] } : null;
  }
  const list = u.searchParams.get('list') || '';
  if (host === 'youtu.be') {
    const m = YT_SHORT.exec(path);
    return m ? { kind: 'yt', id: m[1] } : null;
  }
  if (YT_HOSTS.indexOf(host) < 0) return null;
  if (path === '/watch' || path === '/watch/') {
    const v = u.searchParams.get('v') || '';
    if (YT_ID.test(v)) return { kind: 'yt', id: v };
    return YT_LIST.test(list) ? { kind: 'ytlist', id: list } : null;
  }
  if (path === '/playlist' || path === '/playlist/' || path === '/embed/videoseries') {
    return YT_LIST.test(list) ? { kind: 'ytlist', id: list } : null;
  }
  const m = YT_PATH.exec(path);
  return m ? { kind: 'yt', id: m[1] } : null;
}

function own(o: object, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined;
}
function isRecord(v: unknown): v is object {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function cleanLabel(v: unknown): string {
  if (typeof v !== 'string') return '';
  return Array.from(v.slice(0, 400).replace(BAD_CHARS, ' ').trim()).slice(0, MAX_LABEL).join('').trim();
}
function cleanBpm(v: unknown): number {
  if (typeof v !== 'number' || !isFinite(v)) return 0;
  const n = Math.round(v);
  return n >= BPM_MIN && n <= BPM_MAX ? n : 0;
}
function entryKey(e: MusicEntry): string { return e.kind + ':' + (e.spType || '') + ':' + e.id; }

/** Check one stored or imported entry. A fresh object is built from the known fields only. */
function cleanEntry(raw: unknown): MusicEntry | null {
  if (!isRecord(raw)) return null;
  const kind = own(raw, 'kind'), id = own(raw, 'id');
  if (typeof id !== 'string') return null;
  let e: MusicEntry;
  if (kind === 'yt' && YT_ID.test(id)) e = { kind: 'yt', id };
  else if (kind === 'ytlist' && YT_LIST.test(id)) e = { kind: 'ytlist', id };
  else if (kind === 'sp' && SP_ID.test(id)) {
    const t = own(raw, 'spType');
    if (typeof t !== 'string' || SP_TYPES.indexOf(t) < 0) return null;
    e = { kind: 'sp', spType: t as SpType, id };
  } else return null;
  const label = cleanLabel(own(raw, 'label'));
  if (label) e.label = label;
  const bpm = cleanBpm(own(raw, 'bpm'));
  if (bpm) e.bpm = bpm;
  return e;
}

/** Check a playlist that came from storage or from an import. Accepts { list: [...] } or a bare array. */
export function sanitizeMusicList(data: unknown): MusicEntry[] {
  const arr = Array.isArray(data) ? data : isRecord(data) ? own(data, 'list') : null;
  const out: MusicEntry[] = [];
  if (!Array.isArray(arr)) return out;
  const seen = new Set<string>();
  // Look at a bounded number of items so a huge array cannot stall the page.
  const n = Math.min(arr.length, MAX_ENTRIES * 20);
  for (let i = 0; i < n && out.length < MAX_ENTRIES; i++) {
    const e = cleanEntry(arr[i]);
    if (!e) continue;
    const k = entryKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/** Parse playlist JSON text. Returns null when the text is not JSON or is too long. */
export function parseMusicJson(text: unknown): MusicEntry[] | null {
  if (typeof text !== 'string' || text.length > MAX_JSON) return null;
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(data) && !isRecord(data)) return null;
  return sanitizeMusicList(data);
}

/** The only place an embed address is built. The id has passed its pattern before it gets here. */
export function embedSrc(e: MusicEntry): string | null {
  if (e.kind === 'yt' && YT_ID.test(e.id)) return YT_ORIGIN + '/embed/' + e.id + '?enablejsapi=1&playsinline=1&rel=0';
  if (e.kind === 'ytlist' && YT_LIST.test(e.id)) return YT_ORIGIN + '/embed/videoseries?list=' + e.id + '&enablejsapi=1&playsinline=1&rel=0';
  if (e.kind === 'sp' && e.spType && SP_TYPES.indexOf(e.spType) >= 0 && SP_ID.test(e.id)) return SP_ORIGIN + '/embed/' + e.spType + '/' + e.id;
  return null;
}

function kindName(e: MusicEntry): string {
  if (e.kind === 'yt') return 'YouTube video';
  if (e.kind === 'ytlist') return 'YouTube playlist';
  return 'Spotify ' + (e.spType || 'track');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(cls: string, text: string, run: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', run);
  return b;
}

export function initMusic(host: MusicHost): MusicApi {
  let list: MusicEntry[] = [];
  let sel = -1; // index into list, -1 is the built-in soundtrack
  let vol = 70;
  let min = false; // remembered preference
  let folded = false; // what the dock shows right now

  let active: MusicEntry | null = null;
  let listEl: HTMLElement | null = null;
  const taps: number[] = [];
  let tapFor: MusicEntry | null = null;
  // Where the beat starts, per entry. Kept for this session only: it is a moment in time, not a setting.
  const origins = new WeakMap<MusicEntry, number>();

  // Dock parts. They exist only while something plays.
  let dock: HTMLElement | null = null;
  let frame: HTMLIFrameElement | null = null;
  let dockTitle: HTMLElement | null = null;
  let minBtn: HTMLButtonElement | null = null;
  let pauseBtn: HTMLButtonElement | null = null;
  let ytReady = false, ytTold = false, ytState = -1, ytTimer = 0, ytTries = 0, autoMin = false;

  function load(): void {
    let text: string | null = null;
    try { text = localStorage.getItem(KEY); } catch { return; }
    if (typeof text !== 'string' || text.length > MAX_JSON) return;
    let data: unknown;
    try { data = JSON.parse(text); } catch { return; }
    if (!isRecord(data)) return;
    list = sanitizeMusicList(data);
    const s = own(data, 'sel'), v = own(data, 'vol');
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < list.length) sel = s;
    if (typeof v === 'number' && isFinite(v)) vol = Math.max(0, Math.min(100, Math.round(v)));
    min = own(data, 'min') === true;
  }
  function save(): void {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, list, sel, vol, min })); } catch { /* storage full or blocked */ }
  }

  // ---------- YouTube control, postMessage only ----------
  function ytPost(msg: object): void {
    const w = frame && frame.contentWindow;
    if (w) w.postMessage(JSON.stringify(msg), YT_ORIGIN);
  }
  function ytCmd(func: string, args: unknown[]): void { ytPost({ event: 'command', func, args }); }
  function ytHello(): void {
    if (ytReady || ++ytTries > 40) { clearInterval(ytTimer); ytTimer = 0; return; }
    ytPost({ event: 'listening', id: 'volt-yt', channel: 'widget' });
  }
  function ytStart(): void {
    // The frame has loaded the player page by now, so the target origin matches.
    if (!active || active.kind === 'sp' || ytTimer) return;
    ytTries = 0;
    ytTimer = window.setInterval(ytHello, 300);
    ytHello();
    // Commands work even when the player never reports back, so send the first ones blind.
    ytCmd('setVolume', [vol]);
    ytCmd('playVideo', []);
  }
  function ytNext(): void {
    if (!active) return;
    if (active.kind === 'ytlist') { ytCmd('nextVideo', []); return; }
    if (active.kind !== 'yt') return;
    // Step to the next video entry of the playlist inside the same player.
    const at = list.indexOf(active);
    for (let k = 1; k <= list.length; k++) {
      const e = list[(at + k) % list.length];
      if (e.kind !== 'yt' || e === active || !YT_ID.test(e.id)) continue;
      active = e; sel = list.indexOf(e);
      ytCmd('loadVideoById', [e.id]);
      if (dockTitle) dockTitle.textContent = e.label || kindName(e);
      save(); renderList();
      return;
    }
    ytCmd('seekTo', [0, true]);
    ytCmd('playVideo', []);
  }
  function onMessage(ev: MessageEvent): void {
    if (!frame || ev.origin !== YT_ORIGIN || ev.source !== frame.contentWindow) return;
    if (!active || active.kind === 'sp') return;
    if (typeof ev.data !== 'string' || ev.data.length > 200000) return;
    let d: unknown;
    try { d = JSON.parse(ev.data); } catch { return; }
    if (!isRecord(d)) return;
    if (!ytReady) {
      ytReady = true;
      ytCmd('setVolume', [vol]);
      ytCmd('playVideo', []);
    }
    const info = own(d, 'info');
    if (!isRecord(info)) return;
    const st = own(info, 'playerState');
    if (typeof st !== 'number' || st === ytState) return;
    ytState = st;
    ytTold = true;
    if (pauseBtn) pauseBtn.textContent = st === 1 || st === 3 ? 'Pause' : 'Play';
    if (st === 1 && autoMin) { autoMin = false; setMin(true); }
    if (st === 0) ytNext();
  }

  // ---------- dock ----------
  function setMin(on: boolean): void {
    folded = on;
    if (dock) dock.classList.toggle('min', on);
    if (minBtn) { minBtn.textContent = on ? 'Show' : 'Hide'; minBtn.setAttribute('aria-expanded', on ? 'false' : 'true'); }
  }
  function closeDock(): void {
    if (ytTimer) { clearInterval(ytTimer); ytTimer = 0; }
    window.removeEventListener('message', onMessage);
    if (frame) frame.src = 'about:blank';
    if (dock) dock.remove();
    dock = frame = dockTitle = null; minBtn = pauseBtn = null;
    ytReady = false; ytTold = false; ytState = -1; autoMin = false;
  }
  function stop(): void {
    const was = active !== null;
    active = null;
    closeDock();
    if (was) host.setScoreMuted(false);
    renderList();
  }
  function play(e: MusicEntry): void {
    const src = embedSrc(e);
    if (!src) { host.toast('This entry cannot be played.'); return; }
    closeDock();
    active = e; sel = list.indexOf(e);
    save();

    const d = el('div', 'mu-dock');
    d.setAttribute('role', 'region');
    d.setAttribute('aria-label', 'Music player');
    const bar = el('div', 'mu-dock-bar');
    dockTitle = el('span', 'mu-dock-title', e.label || kindName(e));
    minBtn = button('chip mu-chip', 'Hide', () => { host.click(); autoMin = false; setMin(!folded); min = folded; save(); });
    const stopBtn = button('chip mu-chip', 'Stop', () => { host.click(); stop(); });
    bar.append(dockTitle, minBtn, stopBtn);

    const body = el('div', 'mu-dock-body');
    const f = el('iframe', 'mu-frame ' + (e.kind === 'sp' ? 'sp' : 'yt'));
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
    // YouTube refuses to play without a referrer (error 153). It gets the site's origin and never the path.
    f.setAttribute('referrerpolicy', e.kind === 'sp' ? 'no-referrer' : 'strict-origin');
    f.setAttribute('loading', 'lazy');
    f.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
    f.title = e.kind === 'sp' ? 'Spotify player' : 'YouTube player';
    body.append(f);

    const ctl = el('div', 'mu-dock-ctl');
    if (e.kind === 'sp') {
      ctl.append(el('p', 'mu-hint', 'Press play inside the Spotify player. It plays previews unless you are logged in to Spotify in this browser.'));
    } else {
      pauseBtn = button('chip mu-chip', 'Play', () => {
        host.click();
        const playing = ytState === 1 || ytState === 3;
        ytCmd(playing ? 'pauseVideo' : 'playVideo', []);
        // Without state reports from the player the button keeps its own count.
        if (!ytTold) { ytState = playing ? 2 : 1; if (pauseBtn) pauseBtn.textContent = playing ? 'Play' : 'Pause'; }
      });
      const next = button('chip mu-chip', 'Next', () => { host.click(); ytNext(); });
      const range = el('input', 'mu-vol');
      range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1'; range.value = String(vol);
      range.setAttribute('aria-label', 'Music volume');
      range.addEventListener('input', () => { vol = Math.max(0, Math.min(100, Math.round(Number(range.value) || 0))); ytCmd('setVolume', [vol]); });
      range.addEventListener('change', save);
      ctl.append(pauseBtn, next, range);
      ctl.append(el('p', 'mu-hint', 'If it stays silent, press play inside the player.'));
      window.addEventListener('message', onMessage);
      f.addEventListener('load', ytStart);
    }
    body.append(ctl);
    d.append(bar, body);
    dock = d; frame = f;
    // Start open so the player can be seen and pressed. A YouTube entry folds away again
    // once it reports that it is playing, if the dock was minimised last time.
    autoMin = min && e.kind !== 'sp';
    setMin(false);
    f.src = src;
    document.body.append(d);
    host.setScoreMuted(true);
    renderList();
  }

  // ---------- sheet ----------
  function setBpm(e: MusicEntry, v: number, input: HTMLInputElement | null): void {
    const n = cleanBpm(v);
    if (n) e.bpm = n; else delete e.bpm;
    if (input) input.value = n ? String(n) : '';
    save();
  }
  function tap(e: MusicEntry, input: HTMLInputElement): void {
    const now = performance.now();
    if (tapFor !== e || (taps.length && now - taps[taps.length - 1] > 2000)) taps.length = 0;
    tapFor = e;
    origins.set(e, now);
    taps.push(now);
    if (taps.length > 9) taps.shift();
    if (taps.length < 2) return;
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(e, Math.max(BPM_MIN, Math.min(BPM_MAX, 60000 / avg)), input);
  }

  function row(e: MusicEntry | null): HTMLElement {
    const on = e ? active === e : active === null;
    const r = el('li', 'mu-row' + (on ? ' on' : '') + (e && sel === list.indexOf(e) && !on ? ' last' : ''));
    const main = el('div', 'mu-main');
    if (!e) {
      main.append(el('span', 'mu-name', 'VOLTSPIRE soundtrack'), el('span', 'mu-meta', 'Built in'));
      r.append(main);
      const b = button('btn small' + (on ? '' : ' ghost'), on ? 'Playing' : 'Play', () => { host.click(); sel = -1; save(); stop(); });
      b.disabled = on;
      r.append(b);
      return r;
    }
    main.append(el('span', 'mu-name', e.label || kindName(e)), el('span', 'mu-meta', kindName(e) + ' / ' + e.id));
    r.append(main);

    const tempo = el('label', 'mu-bpm');
    tempo.append(el('span', 'lab', 'BPM'));
    const num = el('input');
    num.type = 'number'; num.min = String(BPM_MIN); num.max = String(BPM_MAX); num.step = '1'; num.inputMode = 'numeric';
    num.placeholder = '-';
    num.value = e.bpm ? String(e.bpm) : '';
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (num.value !== '' && !cleanBpm(v)) host.toast('BPM must be between ' + BPM_MIN + ' and ' + BPM_MAX + '.');
      setBpm(e, v, num);
    });
    tempo.append(num);
    const tapBtn = el('button', 'chip mu-chip', 'Tap');
    tapBtn.type = 'button';
    tapBtn.title = 'Tap along with the beat';
    // Taps are timed on press, not on release.
    tapBtn.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.preventDefault(); tap(e, num); } });
    tapBtn.addEventListener('click', (ev) => { if (ev.detail === 0) tap(e, num); });

    const playBtn = on
      ? button('btn small', 'Stop', () => { host.click(); stop(); })
      : button('btn small ghost', 'Play', () => { host.click(); play(e); });
    const del = button('chip mu-chip mu-del', 'Remove', () => {
      host.click();
      const i = list.indexOf(e);
      if (i < 0) return;
      const selEntry = sel >= 0 ? list[sel] : null;
      list.splice(i, 1);
      sel = selEntry && selEntry !== e ? list.indexOf(selEntry) : -1;
      save();
      if (active === e) stop(); else renderList();
    });
    del.setAttribute('aria-label', 'Remove ' + (e.label || kindName(e)));
    const tools = el('div', 'mu-tools');
    tools.append(tempo, tapBtn, playBtn, del);
    r.append(tools);
    return r;
  }

  function renderList(): void {
    if (!listEl) return;
    const rows: HTMLElement[] = [row(null)];
    for (const e of list) rows.push(row(e));
    listEl.replaceChildren(...rows);
  }

  function textField(placeholder: string, maxLength: number, label: string): HTMLInputElement {
    const i = el('input', 'mu-input');
    i.type = 'text'; i.placeholder = placeholder; i.maxLength = maxLength;
    i.autocomplete = 'off'; i.spellcheck = false;
    i.setAttribute('autocapitalize', 'off');
    i.setAttribute('aria-label', label);
    return i;
  }

  function copyText(area: HTMLTextAreaElement): void {
    const done = (): void => host.toast('Playlist copied.');
    const fallback = (): void => {
      area.focus(); area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      if (ok) done(); else host.toast('Select the text and copy it by hand.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(area.value).then(done, fallback);
    else fallback();
  }

  function applyImport(text: string, replace: boolean): boolean {
    const got = parseMusicJson(text);
    if (!got) { host.toast('That is not a playlist export.'); return false; }
    if (!got.length) { host.toast('No valid entries found.'); return false; }
    const selKey = sel >= 0 && list[sel] ? entryKey(list[sel]) : '';
    const activeKey = active ? entryKey(active) : '';
    let added = 0;
    if (replace) { list = got; added = got.length; }
    else {
      const seen = new Set(list.map(entryKey));
      for (const e of got) {
        if (list.length >= MAX_ENTRIES) break;
        if (seen.has(entryKey(e))) continue;
        list.push(e); added++;
      }
    }
    sel = selKey ? list.findIndex((e) => entryKey(e) === selKey) : -1;
    const still = activeKey ? list.find((e) => entryKey(e) === activeKey) || null : null;
    save();
    if (active && !still) stop();
    else { if (still) active = still; renderList(); }
    host.toast(replace ? 'Playlist replaced: ' + added + ' entries.' : added + ' entries added.');
    return true;
  }

  function open(): void {
    const wrap = el('div', 'mu');
    // Game hotkeys must not fire while the player types here. Escape still closes the sheet.
    const guard = (ev: KeyboardEvent): void => {
      const t = ev.target as HTMLElement | null;
      if (ev.key !== 'Escape' && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) ev.stopPropagation();
    };
    wrap.addEventListener('keydown', guard);
    wrap.addEventListener('keyup', guard);

    listEl = el('ul', 'mu-list');

    const add = el('form', 'mu-add');
    add.noValidate = true;
    const link = textField('Paste a YouTube or Spotify link', MAX_LINK, 'Link');
    const name = textField('Name (optional)', MAX_LABEL, 'Name');
    name.classList.add('mu-name-in');
    const addBtn = el('button', 'btn small', 'Add');
    addBtn.type = 'submit';
    add.append(link, name, addBtn);
    add.addEventListener('submit', (ev) => {
      ev.preventDefault();
      host.click();
      const e = parseMusicLink(link.value);
      if (!e) { host.toast('That is not a YouTube or Spotify link.'); return; }
      if (list.some((x) => entryKey(x) === entryKey(e))) { host.toast('That link is already in the list.'); return; }
      if (list.length >= MAX_ENTRIES) { host.toast('The playlist is full (' + MAX_ENTRIES + ' entries).'); return; }
      const label = cleanLabel(name.value);
      if (label) e.label = label;
      list.push(e);
      save();
      link.value = ''; name.value = '';
      renderList();
    });

    const note = el('p', 'note mu-note', 'External players load from YouTube or Spotify only when you press play. Spotify plays previews unless you are logged in to Spotify in this browser. Set or tap the BPM so the beat effects can follow your music.');

    const io = el('div', 'mu-io');
    const ioBar = el('div', 'btn-pair');
    const ioBox = el('div', 'mu-io-box');
    const showExport = (): void => {
      const area = el('textarea', 'mu-area');
      area.readOnly = true; area.rows = 6; area.spellcheck = false;
      area.setAttribute('aria-label', 'Playlist as JSON');
      area.value = JSON.stringify({ 'voltspire-music': 1, list }, null, 1);
      const copy = button('btn small', 'Copy', () => { host.click(); copyText(area); });
      const acts = el('div', 'btn-pair');
      acts.append(copy);
      ioBox.replaceChildren(area, acts);
      area.focus(); area.select();
    };
    const showImport = (): void => {
      const area = el('textarea', 'mu-area');
      area.rows = 6; area.spellcheck = false; area.maxLength = MAX_JSON;
      area.placeholder = 'Paste an exported playlist here';
      area.setAttribute('aria-label', 'Playlist JSON to import');
      const done = (replace: boolean): void => { host.click(); if (applyImport(area.value, replace)) ioBox.replaceChildren(); };
      const acts = el('div', 'btn-pair');
      acts.append(button('btn small', 'Merge', () => done(false)), button('btn small ghost', 'Replace', () => done(true)));
      ioBox.replaceChildren(area, acts);
      area.focus();
    };
    ioBar.append(
      button('btn small ghost', 'Export', () => { host.click(); showExport(); }),
      button('btn small ghost', 'Import', () => { host.click(); showImport(); }),
    );
    io.append(ioBar, ioBox);

    wrap.append(listEl, add, note, io);
    host.root.replaceChildren(wrap);
    renderList();
  }

  load();
  return {
    open,
    isExternalPlaying: () => active !== null,
    bpm: () => (active && active.bpm ? active.bpm : null),
    // Spotify does not report its state, and neither does a YouTube player that never answered.
    beatOn: () => active !== null && (active.kind === 'sp' || !ytTold || ytState === 1),
    beatOrigin: () => (active && origins.get(active)) || 0,
  };
}
