// The Music sheet: the built-in tracks, and the player's own playlist of YouTube and Spotify links next to them.
// Only a service kind and an id are ever kept from a pasted link. The embed address is always
// rebuilt from those two, and an embed is only created when the player presses play on an entry.
// With Spotify connected (spotify.ts), playlists, albums and liked songs play as full tracks through the
// Web Playback SDK. The BPM of each track comes from tempo.ts (own value, cache, opt-in lookups) or from
// the opt-in listener in beat.ts, and the beat is tied to the track position the player reports.

import { SpotifyClient, SpError } from './spotify.ts';
import type { SpList, SpTrack, SpState } from './spotify.ts';
import { TempoBook, TempoResolver, cleanVideoTitle } from './tempo.ts';
import type { TrackRef } from './tempo.ts';
import { BeatListener, beatPhase, trackStart, tapOffset } from './beat.ts';

export interface MusicHost {
  /** container element the music sheet builds its UI in */
  root: HTMLElement;
  /** mute or unmute the built-in soundtrack while external music plays */
  setScoreMuted(muted: boolean): void;
  /** the built-in tracks: id, name and a short line about each (key and tempo) */
  tracks: { id: string; name: string; meta: string }[];
  /** choose a built-in track by id, or 'shuffle' for the playlist of built-in tracks */
  setTrack(id: string): void;
  /** which built-in tracks the playlist goes through */
  setPlaylist(ids: string[]): void;
  /** id of the built-in track that plays right now, or '' while the soundtrack is not running */
  nowPlaying(): string;
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
  /** a moment of a beat on the performance.now() clock: track start plus the beat offset, the listener's beat, or the last tap */
  beatOrigin(): number;
  /** where `now` (performance.now()) falls in the current beat, 0..1 with 0 on the beat; null without a running beat clock */
  beatPhase(now: number): number | null;
  /** resolves true when the page has just come back from the Spotify sign-in (the host then opens the sheet) */
  returnedFromSpotify(): Promise<boolean>;
}

export type SpType = 'track' | 'album' | 'playlist' | 'episode' | 'show';
export interface MusicEntry { kind: 'yt' | 'ytlist' | 'sp'; spType?: SpType; id: string; label?: string; bpm?: number }

const KEY = 'beatspire-music';
const OLD_KEY = 'voltspire-music'; // the game's earlier name; still read so saved playlists carry over
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

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
const SVG_NS = 'http://www.w3.org/2000/svg';
/** The Spotify icon (attribution next to everything that comes from Spotify). */
function spotifyIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'mu-sp-logo');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Spotify');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z');
  svg.append(p);
  return svg;
}
function extLink(href: string, text: string, cls = 'mu-link'): HTMLAnchorElement {
  const a = el('a', cls, text);
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}
function openUrl(uri: string): string {
  const m = /^spotify:(track|album|playlist|episode):([0-9A-Za-z]{22})$/.exec(uri);
  return m ? SP_ORIGIN + '/' + m[1] + '/' + m[2] : SP_ORIGIN;
}
function env(name: string): string {
  try { const e = (import.meta as unknown as { env?: Record<string, unknown> }).env; const v = e ? e[name] : ''; return typeof v === 'string' ? v.trim() : ''; } catch { return ''; }
}
function sameBeat(a: number, b: number): boolean {
  for (const m of [0.5, 1, 2]) if (Math.abs(a * m - b) / b < 0.03) return true;
  return false;
}

type Mode = 'none' | 'embed' | 'sdk';

export function initMusic(host: MusicHost): MusicApi {
  let list: MusicEntry[] = [];
  let sel = -1; // index into list, -1 is the built-in soundtrack
  let builtin = 'shuffle'; // a built-in track id, or 'shuffle' for the playlist
  let mine: string[] = host.tracks.map((t) => t.id); // the built-in tracks on the player's playlist
  let vol = 70;
  let min = false; // remembered preference
  let folded = false; // what the dock shows right now
  let online = false; // the player agreed to tempo lookups at third parties
  let stay = false; // keep the Spotify session on this device

  let mode: Mode = 'none';
  let active: MusicEntry | null = null; // the embed entry that plays
  let listEl: HTMLElement | null = null;
  let spEl: HTMLElement | null = null;
  const taps: number[] = [];
  let tapFor = '';
  // Where the beat starts, per embed entry without a known position. Session only: a moment in time, not a setting.
  const origins = new WeakMap<MusicEntry, number>();

  // ---------- what plays right now, for the beat ----------
  // key: 'sp:<track id>' or 'yt:<video id>' ('' when unknown); start: performance.now() at track position 0 (0 = unknown)
  const cur = { key: '', name: '', artists: '', art: '', uri: '', bpm: null as number | null, src: '', conf: 0, start: 0, playing: false, told: false, durationMs: 0, positionMs: 0, at: 0, shuffle: false, repeat: 0 as 0 | 1 | 2 };
  let sdkContext = '';

  // ---------- services ----------
  // Spotify Connect (sign-in, full tracks, playlists) is switched off unless the build sets VITE_SPOTIFY_CONNECT=1:
  // Spotify's Developer Policy does not allow games to use its Web API or to sync visuals to its recordings.
  // Pasted Spotify links still play in Spotify's own embed.
  const SP_ON = env('VITE_SPOTIFY_CONNECT') === '1';
  const sp = new SpotifyClient(env('VITE_SPOTIFY_CLIENT_ID'));
  const gsbKey = env('VITE_GETSONGBPM_KEY');
  const book = new TempoBook((() => { try { return localStorage; } catch { return null; } })());
  const tempo = new TempoResolver({
    book,
    fetch: (url, init) => fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'default' }),
    online: () => online,
    spotifyFeatures: (ids) => (sp.connected() ? sp.audioFeatures(ids) : Promise.reject(new Error('not connected'))),
    spotifySearch: (artist, title) => (sp.connected() ? sp.searchTrack(artist, title) : Promise.resolve(null)),
    getSongBpmKey: /^[A-Za-z0-9]{8,64}$/.test(gsbKey) ? gsbKey : undefined,
  });
  const listener = new BeatListener();
  listener.onChange = () => renderDock();
  let listenMsg = '';

  // Dock parts. They exist only while something plays.
  let dock: HTMLElement | null = null;
  let frame: HTMLIFrameElement | null = null;
  let dockTitle: HTMLElement | null = null;
  let minBtn: HTMLButtonElement | null = null;
  let dockParts: { [k: string]: HTMLElement } = {};
  let dockTimer = 0;
  let ytReady = false, ytTold = false, ytState = -1, ytTimer = 0, ytTries = 0, autoMin = false;
  let ytList: string[] = [], ytIndex = -1, ytShuffle = false, ytLoop = false;
  const ytTitles = new Map<string, { title: string; author: string }>();

  function load(): void {
    let text: string | null = null;
    try { text = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY); } catch { return; }
    if (typeof text !== 'string' || text.length > MAX_JSON) return;
    let data: unknown;
    try { data = JSON.parse(text); } catch { return; }
    if (!isRecord(data)) return;
    list = sanitizeMusicList(data);
    const s = own(data, 'sel'), v = own(data, 'vol');
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < list.length) sel = s;
    if (typeof v === 'number' && isFinite(v)) vol = Math.max(0, Math.min(100, Math.round(v)));
    min = own(data, 'min') === true;
    online = own(data, 'online') === true;
    stay = own(data, 'stay') === true;
    const b = own(data, 'builtin');
    if (typeof b === 'string' && host.tracks.some((t) => t.id === b)) builtin = b;
    const m = own(data, 'mine');
    if (Array.isArray(m)) { const keep = host.tracks.filter((t) => m.includes(t.id)).map((t) => t.id); if (keep.length) mine = keep; }
  }
  function save(): void {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, list, sel, vol, min, builtin, mine, online, stay })); } catch { /* storage full or blocked */ }
  }

  // ---------- the beat ----------
  /** The tempo and the moment of a beat for what plays now. Own values win, then lookups, then the listener. */
  function beat(): { bpm: number | null; origin: number; src: string } {
    let bpm: number | null = null, origin = 0, src = '';
    if (mode === 'embed' && active && active.kind === 'sp') {
      bpm = active.bpm || null; origin = origins.get(active) || 0; src = bpm ? 'yours' : '';
    } else if (mode !== 'none') {
      const ownRow = cur.key ? book.ownGet(cur.key) : undefined;
      if (ownRow) { bpm = ownRow.b; origin = cur.start ? cur.start + (ownRow.o || 0) : (active && origins.get(active)) || 0; src = 'yours'; }
      else if (active && active.bpm && active.kind !== 'sp') { bpm = active.bpm; origin = (active && origins.get(active)) || cur.start; src = 'yours'; }
      else if (cur.bpm) { bpm = cur.bpm; origin = cur.start; src = cur.src; }
    }
    const L = listener.state;
    if (L.on && L.bpm && L.conf >= 0.3) {
      if (!bpm) { bpm = L.bpm; origin = L.origin; src = 'heard'; }
      else if (sameBeat(bpm, L.bpm)) origin = L.origin; // the listener knows where the beat really falls
    }
    return { bpm, origin, src };
  }
  function playingNow(): boolean {
    if (mode === 'none') return false;
    if (mode === 'sdk') return cur.playing;
    if (active && active.kind === 'sp') return true; // the Spotify embed does not report its state
    return !ytTold || ytState === 1;
  }

  /** Track change: switch the BPM at once (own value or cache), then look it up if allowed. */
  function trackChanged(key: string, ref: TrackRef | null): void {
    cur.key = key; cur.bpm = null; cur.src = ''; cur.conf = 0;
    taps.length = 0;
    if (!key) { renderDock(); return; }
    // the looked-up value only: the player's own value is applied on top by beat(), so "Auto" can fall back to this
    const k = book.get(key);
    if (k) { cur.bpm = k.bpm; cur.src = k.source; cur.conf = k.conf; }
    renderDock();
    if (k !== undefined || !ref) return;
    void tempo.resolve(ref).then((hit) => {
      if (cur.key !== key) return;
      if (hit) { cur.bpm = hit.bpm; cur.src = hit.source; cur.conf = hit.conf; }
      renderDock(); renderTrackBpms();
    });
  }

  // ---------- YouTube control, postMessage only ----------
  function ytPost(msg: object): void {
    const w = frame && frame.contentWindow;
    if (w) w.postMessage(JSON.stringify(msg), YT_ORIGIN);
  }
  function ytCmd(func: string, args: unknown[]): void { ytPost({ event: 'command', func, args }); }
  function ytHello(): void {
    if (ytReady || ++ytTries > 40) { clearInterval(ytTimer); ytTimer = 0; return; }
    ytPost({ event: 'listening', id: 'beat-yt', channel: 'widget' });
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
  function ytNext(back = false): void {
    if (!active) return;
    if (active.kind === 'ytlist') { ytCmd(back ? 'previousVideo' : 'nextVideo', []); return; }
    if (active.kind !== 'yt') return;
    // Step to the next (or previous) video entry of the playlist inside the same player.
    const at = list.indexOf(active), n = list.length;
    for (let k = 1; k <= n; k++) {
      const e = list[(((at + (back ? -k : k)) % n) + n) % n];
      if (e.kind !== 'yt' || e === active || !YT_ID.test(e.id)) continue;
      active = e; sel = list.indexOf(e);
      ytCmd('loadVideoById', [e.id]);
      if (dockTitle) dockTitle.textContent = e.label || kindName(e);
      trackChanged('yt:' + e.id, null);
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
    const now = performance.now();
    let redraw = false;
    // the playlist the player goes through (video ids only; titles arrive as each one plays)
    const pl = own(info, 'playlist');
    if (Array.isArray(pl)) {
      const ids = pl.slice(0, 500).filter((x): x is string => typeof x === 'string' && YT_ID.test(x));
      if (ids.join() !== ytList.join()) { ytList = ids; redraw = true; }
    }
    const pi = own(info, 'playlistIndex');
    if (typeof pi === 'number' && Number.isInteger(pi) && pi !== ytIndex) { ytIndex = pi; redraw = true; }
    const vd = own(info, 'videoData');
    if (isRecord(vd)) {
      const id = own(vd, 'video_id');
      if (typeof id === 'string' && YT_ID.test(id)) {
        const title = cleanLabel(own(vd, 'title')), author = cleanLabel(own(vd, 'author'));
        if (title) ytTitles.set(id, { title, author });
        if ('yt:' + id !== cur.key) {
          cur.name = title; cur.artists = author; cur.start = 0;
          const guess = title ? cleanVideoTitle(title, author) : null;
          trackChanged('yt:' + id, guess && guess.title ? { key: 'yt:' + id, artist: guess.artist, title: guess.title } : null);
          redraw = true;
        } else if (title && cur.name !== title) { cur.name = title; cur.artists = author; redraw = true; }
      }
    }
    const dur = own(info, 'duration');
    if (typeof dur === 'number' && isFinite(dur) && dur > 0) cur.durationMs = dur * 1000;
    const st = own(info, 'playerState');
    if (typeof st === 'number' && st !== ytState) {
      ytState = st;
      ytTold = true;
      cur.playing = st === 1;
      if (st === 1 && autoMin) { autoMin = false; setMin(true); }
      if (st === 0 && active.kind === 'yt') ytNext();
      redraw = true;
    }
    const ct = own(info, 'currentTime');
    if (typeof ct === 'number' && isFinite(ct) && ct >= 0) {
      cur.positionMs = ct * 1000; cur.at = now;
      // keep the beat tied to the video position: follow small drift softly, jump after a seek
      const cand = trackStart(ct * 1000, now);
      if (!cur.start || Math.abs(cand - cur.start) > 250) cur.start = cand;
      else if (ytState === 1) cur.start += (cand - cur.start) * 0.1;
    }
    if (redraw) renderDock();
  }

  // ---------- Spotify player ----------
  sp.onChange = () => { renderSp(); renderDock(); };
  sp.onState = (s: SpState | null) => {
    if (!s) {
      if (mode === 'sdk') { mode = 'none'; closeDock(); host.setScoreMuted(false); renderList(); }
      return;
    }
    if (mode !== 'sdk') return;
    const t = s.track;
    cur.playing = !s.paused;
    cur.positionMs = s.positionMs; cur.at = s.at; cur.durationMs = s.durationMs;
    cur.shuffle = s.shuffle; cur.repeat = s.repeat;
    // every state report re-anchors the beat to the track position, so it stays right after seek, pause and resume
    cur.start = trackStart(s.positionMs, s.at);
    sdkContext = s.contextUri;
    if (t) {
      cur.name = t.name; cur.artists = t.artists; cur.art = t.art; cur.uri = t.uri;
      const key = t.id ? 'sp:' + t.id : '';
      if (key !== cur.key) trackChanged(key, t.id ? { key, spotifyId: t.id } : null);
      // look ahead so the next track switches tempo without a wait
      const ahead = s.next.filter((n) => n.id).map((n) => ({ key: 'sp:' + n.id, spotifyId: n.id! }));
      if (ahead.length) void tempo.resolveMany(ahead);
    }
    renderDock(); renderTrackHighlight();
  };
  async function sdkPlay(o: { context?: string; uris?: string[]; offsetUri?: string; offsetPos?: number }, fallback: MusicEntry | null): Promise<void> {
    sp.activate(); // inside the click: mobile browsers need it before the first sound
    const err = await sp.startPlayer(vol / 100);
    if (err) {
      host.toast(err);
      if (fallback && !sp.canStream) play(fallback);
      return;
    }
    if (mode !== 'sdk') {
      closeDock();
      active = null;
      mode = 'sdk';
      cur.key = ''; cur.playing = false; cur.start = 0; cur.name = 'Spotify'; cur.artists = ''; cur.art = ''; cur.uri = '';
      buildDock();
      host.setScoreMuted(true);
    }
    try { await sp.play(o); }
    catch (e) {
      host.toast(e instanceof Error ? e.message : 'Spotify could not play that.');
      // nothing plays: do not leave the score muted under an empty player (no Premium: the embed takes over)
      if (mode === 'sdk' && !cur.playing && !cur.key) { stop(); if (fallback && !sp.canStream) play(fallback); return; }
    }
    renderList();
  }

  // ---------- dock ----------
  function setMin(on: boolean): void {
    folded = on;
    if (dock) dock.classList.toggle('min', on);
    if (minBtn) { minBtn.textContent = on ? 'Show' : 'Hide'; minBtn.setAttribute('aria-expanded', on ? 'false' : 'true'); }
  }
  function closeDock(): void {
    if (ytTimer) { clearInterval(ytTimer); ytTimer = 0; }
    if (dockTimer) { clearInterval(dockTimer); dockTimer = 0; }
    window.removeEventListener('message', onMessage);
    if (frame) frame.src = 'about:blank';
    if (dock) dock.remove();
    dock = frame = dockTitle = null; minBtn = null; dockParts = {};
    ytReady = false; ytTold = false; ytState = -1; autoMin = false;
    ytList = []; ytIndex = -1;
  }
  function stop(): void {
    const was = mode !== 'none';
    if (mode === 'sdk') sp.pause();
    mode = 'none';
    active = null;
    closeDock();
    listener.stop();
    cur.key = ''; cur.start = 0; cur.playing = false;
    if (was) host.setScoreMuted(false);
    renderList(); renderTrackHighlight();
  }

  /** The dock frame for both kinds of player. The parts that change are refreshed by renderDock(). */
  function buildDock(e: MusicEntry | null = null): void {
    const d = el('div', 'mu-dock' + (mode === 'sdk' ? ' sdk' : e && e.kind === 'sp' ? ' spe' : ' yt'));
    d.setAttribute('role', 'region');
    d.setAttribute('aria-label', 'Music player');
    const bar = el('div', 'mu-dock-bar');
    const art = el('img', 'mu-dock-art');
    art.alt = ''; art.decoding = 'async'; art.referrerPolicy = 'no-referrer';
    dockTitle = el('span', 'mu-dock-title', e ? e.label || kindName(e) : 'Spotify');
    minBtn = button('chip mu-chip', 'Hide', () => { host.click(); autoMin = false; setMin(!folded); min = folded; save(); });
    const stopBtn = button('chip mu-chip', 'Stop', () => { host.click(); stop(); });
    // Spotify's attribution stays in view when the dock is folded to its bar
    if (mode === 'sdk') bar.append(spotifyIcon());
    bar.append(art, dockTitle, minBtn, stopBtn);
    const body = el('div', 'mu-dock-body');
    dockParts = { art };

    if (mode === 'sdk') {
      // now playing: cover art as delivered, the metadata as delivered, and the way back to Spotify
      const card = el('div', 'mu-now');
      const big = el('img', 'mu-now-art');
      big.alt = ''; big.decoding = 'async'; big.referrerPolicy = 'no-referrer';
      const meta = el('div', 'mu-now-meta');
      const name = el('span', 'mu-now-name'), who = el('span', 'mu-now-who');
      const brand = el('div', 'mu-now-brand');
      const link = extLink(SP_ORIGIN, 'PLAY ON SPOTIFY', 'mu-link mu-sp-link');
      brand.append(spotifyIcon(), link);
      meta.append(name, who, brand);
      card.append(big, meta);
      body.append(card);
      dockParts.big = big; dockParts.name = name; dockParts.who = who; dockParts.link = link;
    } else if (e) {
      const f = el('iframe', 'mu-frame ' + (e.kind === 'sp' ? 'sp' : 'yt'));
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
      // YouTube refuses to play without a referrer (error 153). It gets the site's origin and never the path.
      f.setAttribute('referrerpolicy', e.kind === 'sp' ? 'no-referrer' : 'strict-origin');
      f.setAttribute('loading', 'lazy');
      f.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
      f.title = e.kind === 'sp' ? 'Spotify player' : 'YouTube player';
      body.append(f);
      frame = f;
    }

    const ctl = el('div', 'mu-dock-ctl');
    if (e && e.kind === 'sp') {
      ctl.append(el('p', 'mu-hint', sp.connected() && !sp.canStream
        ? sp.message || 'Full tracks are not available here, so the Spotify embed plays.'
        : 'Press play inside the Spotify player. It plays previews unless you are logged in to Spotify in this browser.'));
    } else {
      const prev = button('chip mu-chip', 'Prev', () => { host.click(); if (mode === 'sdk') void sp.prev(); else ytNext(true); });
      prev.setAttribute('aria-label', 'Previous track');
      const pp = button('chip mu-chip', 'Play', () => {
        host.click();
        if (mode === 'sdk') { void sp.toggle(); return; }
        const playing = ytState === 1 || ytState === 3;
        ytCmd(playing ? 'pauseVideo' : 'playVideo', []);
        // Without state reports from the player the button keeps its own count.
        if (!ytTold) { ytState = playing ? 2 : 1; renderDock(); }
      });
      const next = button('chip mu-chip', 'Next', () => { host.click(); if (mode === 'sdk') void sp.next(); else ytNext(); });
      next.setAttribute('aria-label', 'Next track');
      const shuf = button('chip mu-chip mu-toggle', 'Shuffle', () => {
        host.click();
        if (mode === 'sdk') { void sp.shuffle(!cur.shuffle).then(() => { cur.shuffle = !cur.shuffle; renderDock(); }, (er) => host.toast(er instanceof Error ? er.message : 'Spotify said no.')); return; }
        ytShuffle = !ytShuffle; ytCmd('setShuffle', [ytShuffle]); renderDock();
      });
      const rep = button('chip mu-chip mu-toggle', 'Repeat', () => {
        host.click();
        if (mode === 'sdk') {
          const nextMode = cur.repeat === 0 ? 'context' : cur.repeat === 1 ? 'track' : 'off';
          void sp.repeat(nextMode).then(() => { cur.repeat = nextMode === 'off' ? 0 : nextMode === 'context' ? 1 : 2; renderDock(); }, (er) => host.toast(er instanceof Error ? er.message : 'Spotify said no.'));
          return;
        }
        ytLoop = !ytLoop; ytCmd('setLoop', [ytLoop]); renderDock();
      });
      const range = el('input', 'mu-vol');
      range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1'; range.value = String(vol);
      range.setAttribute('aria-label', 'Music volume');
      range.addEventListener('input', () => {
        vol = Math.max(0, Math.min(100, Math.round(Number(range.value) || 0)));
        if (mode === 'sdk') void sp.volume(vol / 100); else ytCmd('setVolume', [vol]);
      });
      range.addEventListener('change', save);
      ctl.append(prev, pp, next, shuf, rep, range);
      dockParts.pp = pp; dockParts.shuf = shuf; dockParts.rep = rep;
      if (e && e.kind === 'yt' && !list.some((x) => x !== e && x.kind === 'yt')) { prev.disabled = true; shuf.hidden = true; }
      if (e && e.kind === 'yt') shuf.hidden = true;

      // progress, seekable
      const prog = el('div', 'mu-prog');
      const posL = el('span', 'mu-time', '0:00'), durL = el('span', 'mu-time', '0:00');
      const seek = el('input', 'mu-seek');
      seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.step = '1'; seek.value = '0';
      seek.setAttribute('aria-label', 'Position in the track');
      let dragging = false;
      seek.addEventListener('input', () => { dragging = true; });
      seek.addEventListener('change', () => {
        dragging = false;
        const ms = (Number(seek.value) / 1000) * (cur.durationMs || 0);
        if (mode === 'sdk') void sp.seek(ms); else ytCmd('seekTo', [ms / 1000, true]);
      });
      (seek as HTMLInputElement & { busy?: () => boolean }).busy = () => dragging;
      prog.append(posL, seek, durL);
      ctl.append(prog);
      dockParts.posL = posL; dockParts.durL = durL; dockParts.seek = seek;
      if (e) {
        window.addEventListener('message', onMessage);
        frame!.addEventListener('load', ytStart);
      }
    }

    // the beat: BPM and where it comes from, half/double, tap, own value, and the listener
    {
      const bt = el('div', 'mu-beat');
      const val = el('span', 'mu-beat-val');
      val.setAttribute('aria-live', 'polite');
      const half = button('chip mu-chip', '÷2', () => { host.click(); scaleBpm(0.5); });
      half.setAttribute('aria-label', 'Half the BPM');
      const dbl = button('chip mu-chip', '×2', () => { host.click(); scaleBpm(2); });
      dbl.setAttribute('aria-label', 'Double the BPM');
      const tapB = el('button', 'chip mu-chip', 'Tap');
      tapB.type = 'button'; tapB.title = 'Tap along with the beat';
      tapB.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.preventDefault(); tapNow(); } });
      tapB.addEventListener('click', (ev) => { if (ev.detail === 0) tapNow(); });
      const num = el('input', 'mu-beat-in');
      num.type = 'number'; num.min = String(BPM_MIN); num.max = String(BPM_MAX); num.step = '1'; num.inputMode = 'numeric';
      num.placeholder = 'BPM'; num.setAttribute('aria-label', 'Your BPM for this track');
      num.addEventListener('change', () => {
        const v = Number(num.value);
        if (num.value === '') { setOwnBpm(null); return; }
        if (!cleanBpm(v)) { host.toast('BPM must be between ' + BPM_MIN + ' and ' + BPM_MAX + '.'); return; }
        setOwnBpm(v);
      });
      const clear = button('chip mu-chip', 'Auto', () => { host.click(); setOwnBpm(null); });
      clear.title = 'Forget your own BPM for this track';
      const listen = button('chip mu-chip mu-toggle', 'Listen', () => { host.click(); void toggleListen(); });
      listen.title = 'Find the beat by listening to the sound of this tab';
      bt.append(val, half, dbl, tapB, num, clear, listen);
      const note = el('p', 'mu-hint mu-beat-note');
      ctl.append(bt, note);
      dockParts.val = val; dockParts.num = num; dockParts.clear = clear; dockParts.listen = listen; dockParts.note = note; dockParts.half = half; dockParts.dbl = dbl;
    }
    if (e && e.kind === 'ytlist') {
      const ul = el('ol', 'mu-ytlist');
      ul.setAttribute('aria-label', 'Videos in this playlist');
      ctl.append(ul);
      dockParts.ytlist = ul;
    }
    if (e && e.kind !== 'sp') ctl.append(el('p', 'mu-hint', 'If it stays silent, press play inside the player. YouTube must stay in view while it plays, so the player only shrinks when hidden.'));
    body.append(ctl);
    d.append(bar, body);
    dock = d;
    // Start open so the player can be seen and pressed. A YouTube entry folds to its small size again
    // once it reports that it is playing, if the dock was minimised last time or the screen is small.
    autoMin = (min || window.innerWidth < 700 || window.innerHeight < 520) && !!e && e.kind !== 'sp';
    setMin(mode === 'sdk' && (min || window.innerWidth < 700));
    document.body.append(d);
    dockTimer = window.setInterval(renderTick, 250);
    renderDock();
  }

  function renderTick(): void {
    if (!dock || !dockParts.seek) return;
    const seek = dockParts.seek as HTMLInputElement & { busy?: () => boolean };
    let pos = cur.positionMs;
    if (cur.playing && cur.at) pos += performance.now() - cur.at;
    if (cur.durationMs) pos = Math.min(pos, cur.durationMs);
    dockParts.posL.textContent = fmtTime(pos);
    dockParts.durL.textContent = cur.durationMs ? fmtTime(cur.durationMs) : '-:--';
    if (!(seek.busy && seek.busy())) seek.value = String(cur.durationMs ? Math.round((pos / cur.durationMs) * 1000) : 0);
    seek.disabled = !cur.durationMs;
  }

  function renderDock(): void {
    if (!dock) return;
    const p = dockParts;
    const art = p.art as HTMLImageElement;
    if (mode === 'sdk') {
      if (dockTitle) dockTitle.textContent = cur.name ? cur.name + (cur.artists ? ' / ' + cur.artists : '') : sp.deviceId ? 'Spotify' : 'Starting Spotify…';
      for (const img of [art, p.big as HTMLImageElement]) {
        if (!img) continue;
        if (cur.art && img.getAttribute('src') !== cur.art) img.src = cur.art;
        img.hidden = !cur.art;
      }
      if (p.name) p.name.textContent = cur.name || '';
      if (p.who) p.who.textContent = cur.artists || '';
      if (p.link) (p.link as HTMLAnchorElement).href = openUrl(cur.uri || sdkContext);
    } else {
      art.hidden = true;
      if (dockTitle && active && active.kind !== 'sp') {
        const t = cur.key ? ytTitles.get(cur.key.slice(3)) : undefined;
        dockTitle.textContent = t ? t.title : active.label || kindName(active);
      }
    }
    if (p.pp) p.pp.textContent = (mode === 'sdk' ? cur.playing : ytState === 1 || ytState === 3) ? 'Pause' : 'Play';
    if (p.shuf) { const on = mode === 'sdk' ? cur.shuffle : ytShuffle; p.shuf.classList.toggle('on', on); p.shuf.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (p.rep) {
      const r = mode === 'sdk' ? cur.repeat : ytLoop ? 1 : 0;
      p.rep.textContent = r === 2 ? 'Repeat 1' : 'Repeat';
      p.rep.classList.toggle('on', r > 0); p.rep.setAttribute('aria-pressed', r > 0 ? 'true' : 'false');
    }
    if (p.val) {
      const b = beat();
      const L = listener.state;
      p.val.textContent = b.bpm ? Math.round(b.bpm * 10) / 10 + ' BPM' : 'BPM ?';
      const ownRow = cur.key ? book.ownGet(cur.key) : undefined;
      (p.clear as HTMLButtonElement).hidden = !ownRow;
      const num = p.num as HTMLInputElement;
      if (document.activeElement !== num) num.value = ownRow ? String(ownRow.b) : '';
      (p.half as HTMLButtonElement).disabled = (p.dbl as HTMLButtonElement).disabled = !b.bpm;
      p.listen.classList.toggle('on', L.on);
      p.listen.setAttribute('aria-pressed', L.on ? 'true' : 'false');
      p.listen.textContent = L.on ? 'Stop listening' : 'Listen';
      let note = '';
      if (b.src === 'yours') note = 'Your own BPM for this track.';
      else if (b.src === 'heard') note = 'Heard: ' + L.bpm + ' BPM, ' + Math.round(L.conf * 100) + '% sure.';
      else if (b.src) note = 'BPM from ' + b.src + (cur.conf && cur.conf < 0.7 ? ' (a guess from the title)' : '') + '.' + (b.src === 'GetSongBPM' ? ' ' : '');
      else if (mode === 'embed' && active && active.kind === 'sp') note = 'Set or tap the BPM; the Spotify embed does not say which track plays.';
      else if (!online && cur.key) note = 'BPM unknown. Tap it, type it, press Listen, or allow online BPM lookup in the Music sheet.';
      else if (cur.key) note = 'BPM unknown for this track. Tap it, type it or press Listen.';
      if (L.on && b.src !== 'heard') note += ' Listening' + (L.bpm ? ': ' + L.bpm + ' BPM, ' + Math.round(L.conf * 100) + '% sure.' : '…');
      if (listenMsg) note += ' ' + listenMsg;
      p.note.textContent = note.trim();
      if (b.src === 'GetSongBPM') p.note.append(' ', extLink('https://getsongbpm.com', 'GetSongBPM.com'));
    }
    if (p.ytlist) renderYtList();
  }

  function renderYtList(): void {
    const ul = dockParts.ytlist;
    if (!ul) return;
    if (!ytList.length) { ul.replaceChildren(el('li', 'mu-hint', 'The list of videos appears once the player answers.')); return; }
    const rows = ytList.map((id, i) => {
      const li = el('li', 'mu-yt-row' + (i === ytIndex ? ' on' : ''));
      const t = ytTitles.get(id);
      const own = book.ownGet('yt:' + id), known = tempo.known('yt:' + id);
      const bpm = own ? own.b : known ? known.bpm : 0;
      const b = button('mu-yt-item', (i + 1) + '. ' + (t ? t.title : 'Video ' + id), () => { host.click(); ytCmd('playVideoAt', [i]); });
      if (i === ytIndex) b.setAttribute('aria-current', 'true');
      li.append(b, el('span', 'mu-yt-bpm', bpm ? String(Math.round(bpm)) : ''));
      return li;
    });
    ul.replaceChildren(...rows);
    const on = ul.querySelector('.on');
    if (on && !folded) (on as HTMLElement).scrollIntoView({ block: 'nearest' });
  }

  // ---------- beat controls ----------
  function setOwnBpm(v: number | null, offset?: number): void {
    if (mode === 'embed' && active && (active.kind === 'sp' || !cur.key)) {
      // no track id known (Spotify embed, or a video that did not report yet): the value belongs to the entry
      const n = v === null ? 0 : cleanBpm(v);
      if (n) active.bpm = n; else delete active.bpm;
      save(); renderList(); renderDock();
      return;
    }
    if (!cur.key) return;
    const prevOwn = book.ownGet(cur.key);
    book.ownSet(cur.key, v, offset !== undefined ? offset : prevOwn ? prevOwn.o : undefined);
    if (active && active.kind === 'yt' && cur.key === 'yt:' + active.id) {
      const n = v === null ? 0 : cleanBpm(v);
      if (n) active.bpm = n; else delete active.bpm;
      save(); renderList();
    }
    renderDock(); renderTrackBpms();
  }
  function scaleBpm(f: number): void {
    const b = beat().bpm;
    if (!b) return;
    const n = Math.round(b * f * 10) / 10;
    if (n < BPM_MIN || n > BPM_MAX) { host.toast('That would leave ' + BPM_MIN + ' to ' + BPM_MAX + ' BPM.'); return; }
    setOwnBpm(n);
  }
  function tapNow(): void {
    const now = performance.now();
    const key = cur.key || (active ? entryKey(active) : '');
    if (tapFor !== key || (taps.length && now - taps[taps.length - 1] > 2000)) taps.length = 0;
    tapFor = key;
    taps.push(now);
    if (taps.length > 9) taps.shift();
    if (active) origins.set(active, now);
    if (taps.length < 2) {
      // a single tap only moves the beat onto the music
      const b = beat().bpm;
      if (b && cur.key && cur.start) { const ownRow = book.ownGet(cur.key); book.ownSet(cur.key, ownRow ? ownRow.b : b, tapOffset(now, cur.start, b)); }
      renderDock();
      return;
    }
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    const bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(60000 / avg)));
    setOwnBpm(bpm, cur.start ? tapOffset(now, cur.start, bpm) : undefined);
  }
  let listenBusy = false;
  async function toggleListen(): Promise<void> {
    if (listener.state.on) { listener.stop(); listenMsg = ''; renderDock(); return; }
    if (listenBusy) return; // the browser prompt is still open
    listenBusy = true;
    try { await startListen(); } finally { listenBusy = false; }
  }
  async function startListen(): Promise<void> {
    const tab = BeatListener.canTab() && !/Android|iPhone|iPad/i.test(navigator.userAgent);
    if (!tab && !BeatListener.canMic()) { listenMsg = 'This browser cannot listen.'; renderDock(); return; }
    listenMsg = tab ? 'Pick "This tab" and tick "Share tab audio" in the browser prompt.' : 'Allow the microphone; it hears the music from your speakers (not with headphones).';
    renderDock();
    const err = await listener.start(tab ? 'tab' : 'mic');
    listenMsg = err || (tab ? 'Listening to this tab. Nothing is recorded or sent anywhere.' : 'Listening through the microphone. Nothing is recorded or sent anywhere.');
    renderDock();
  }

  function play(e: MusicEntry): void {
    const src = embedSrc(e);
    if (!src) { host.toast('This entry cannot be played.'); return; }
    if (mode === 'sdk') sp.pause();
    closeDock();
    mode = 'embed';
    active = e; sel = list.indexOf(e);
    cur.key = ''; cur.start = 0; cur.playing = false; cur.name = ''; cur.artists = ''; cur.durationMs = 0; cur.positionMs = 0; cur.at = 0;
    if (e.kind === 'yt') trackChanged('yt:' + e.id, null);
    save();
    buildDock(e);
    frame!.src = src;
    host.setScoreMuted(true);
    renderList();
  }
  /** Play an entry of the player's own list: through Spotify itself when connected, in the embed otherwise. */
  function playEntry(e: MusicEntry): void {
    if (e.kind === 'sp' && sp.connected() && sp.canStream && (e.spType === 'playlist' || e.spType === 'album' || e.spType === 'track')) {
      active = null; sel = list.indexOf(e); save();
      void sdkPlay(e.spType === 'track' ? { uris: ['spotify:track:' + e.id] } : { context: 'spotify:' + e.spType + ':' + e.id }, e);
      return;
    }
    play(e);
  }

  // ---------- sheet ----------
  function setBpm(e: MusicEntry, v: number, input: HTMLInputElement | null): void {
    const n = cleanBpm(v);
    if (n) e.bpm = n; else delete e.bpm;
    if (input) input.value = n ? String(n) : '';
    if (e.kind === 'yt') book.ownSet('yt:' + e.id, n || null);
    save();
    if (active === e) renderDock();
  }
  function tap(e: MusicEntry, input: HTMLInputElement): void {
    const now = performance.now();
    const k = entryKey(e);
    if (tapFor !== k || (taps.length && now - taps[taps.length - 1] > 2000)) taps.length = 0;
    tapFor = k;
    origins.set(e, now);
    taps.push(now);
    if (taps.length > 9) taps.shift();
    if (taps.length < 2) return;
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(e, Math.max(BPM_MIN, Math.min(BPM_MAX, 60000 / avg)), input);
  }

  /** A row for the built-in soundtrack: the playlist entry (id 'shuffle') or one track. */
  function builtRow(id: string, name: string, meta: string): HTMLElement {
    const chosen = builtin === id, on = mode === 'none' && chosen, now = mode === 'none' ? host.nowPlaying() : '';
    const r = el('li', 'mu-row' + (on ? ' on' : now === id ? ' last' : ''));
    const main = el('div', 'mu-main');
    main.append(el('span', 'mu-name', name), el('span', 'mu-meta', meta + (now === id && !chosen ? ' / playing now' : '')));
    r.append(main);
    if (id !== 'shuffle') {
      // on the playlist or not
      const tick = el('label', 'mu-tick');
      const box = el('input');
      box.type = 'checkbox'; box.checked = mine.includes(id);
      box.addEventListener('change', () => {
        host.click();
        const next = host.tracks.map((t) => t.id).filter((t) => (t === id ? box.checked : mine.includes(t)));
        if (!next.length) { box.checked = true; host.toast('The playlist needs at least one track.'); return; }
        mine = next;
        save();
        host.setPlaylist(mine);
        renderList();
      });
      tick.append(box, el('span', 'lab', 'Playlist'));
      r.append(tick);
    }
    const b = button('btn small' + (on ? '' : ' ghost'), on ? (id === 'shuffle' ? 'On' : 'Chosen') : 'Play', () => {
      host.click();
      builtin = id; sel = -1;
      save();
      host.setTrack(id);
      stop();
    });
    b.disabled = on;
    r.append(b);
    return r;
  }

  function entryPlaying(e: MusicEntry): boolean {
    if (mode === 'embed') return active === e;
    if (mode === 'sdk' && e.kind === 'sp') return sdkContext === 'spotify:' + e.spType + ':' + e.id || cur.uri === 'spotify:' + e.spType + ':' + e.id;
    return false;
  }

  function row(e: MusicEntry): HTMLElement {
    const on = entryPlaying(e);
    const r = el('li', 'mu-row' + (on ? ' on' : '') + (sel === list.indexOf(e) && !on ? ' last' : ''));
    const main = el('div', 'mu-main');
    main.append(el('span', 'mu-name', e.label || kindName(e)), el('span', 'mu-meta', kindName(e) + ' / ' + e.id));
    r.append(main);

    const tempoL = el('label', 'mu-bpm');
    tempoL.append(el('span', 'lab', 'BPM'));
    const num = el('input');
    num.type = 'number'; num.min = String(BPM_MIN); num.max = String(BPM_MAX); num.step = '1'; num.inputMode = 'numeric';
    num.placeholder = '-';
    const ownRow = e.kind === 'yt' ? book.ownGet('yt:' + e.id) : undefined;
    num.value = e.bpm ? String(e.bpm) : ownRow ? String(Math.round(ownRow.b)) : '';
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (num.value !== '' && !cleanBpm(v)) host.toast('BPM must be between ' + BPM_MIN + ' and ' + BPM_MAX + '.');
      setBpm(e, v, num);
    });
    tempoL.append(num);
    const tapBtn = el('button', 'chip mu-chip', 'Tap');
    tapBtn.type = 'button';
    tapBtn.title = 'Tap along with the beat';
    // Taps are timed on press, not on release.
    tapBtn.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { ev.preventDefault(); tap(e, num); } });
    tapBtn.addEventListener('click', (ev) => { if (ev.detail === 0) tap(e, num); });

    const playBtn = on
      ? button('btn small', 'Stop', () => { host.click(); stop(); })
      : button('btn small ghost', 'Play', () => { host.click(); playEntry(e); });
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
    // with Spotify connected, a pasted playlist or album opens as a real track list
    if (e.kind === 'sp' && (e.spType === 'playlist' || e.spType === 'album') && sp.connected()) {
      const open = button('chip mu-chip', 'Tracks', () => { host.click(); void openPasted(e); });
      open.setAttribute('aria-label', 'Show the tracks of ' + (e.label || kindName(e)));
      tools.append(open);
    }
    // a whole Spotify playlist has more than one tempo: its tracks get theirs once connected
    if (!(e.kind === 'sp' && sp.connected() && sp.canStream && e.spType !== 'track')) tools.append(tempoL, tapBtn);
    tools.append(playBtn, del);
    r.append(tools);
    return r;
  }

  function renderList(): void {
    if (!listEl) return;
    const n = mine.length, all = host.tracks.length;
    const rows: HTMLElement[] = [builtRow('shuffle', 'My playlist', n === 1 ? 'Built in / 1 track, on repeat' : `Built in / ${n === all ? 'all ' + all : n + ' of ' + all} tracks, one after another`)];
    for (const t of host.tracks) rows.push(builtRow(t.id, t.name, 'Built in / ' + t.meta));
    for (const e of list) rows.push(row(e));
    listEl.replaceChildren(...rows);
  }

  // ---------- Spotify panel: connect, playlists, tracks ----------
  const spv = {
    tab: 'playlists' as 'playlists' | 'liked',
    lists: [] as SpList[], listsNext: true, listsBusy: false, listsErr: '',
    filter: '',
    open: null as SpList | null,
    tracks: [] as SpTrack[], tracksTotal: 0, tracksNext: true, tracksBusy: false, tracksErr: '',
  };
  const ROW_H = 48;
  let trackBox: HTMLElement | null = null;
  let trackInner: HTMLElement | null = null;
  let filterIn: HTMLInputElement | null = null;

  async function loadLists(): Promise<void> {
    if (spv.listsBusy || !spv.listsNext || !sp.connected()) return;
    spv.listsBusy = true; spv.listsErr = '';
    renderSp();
    try {
      const page = await sp.playlists(spv.lists.length);
      spv.lists.push(...page.items);
      spv.listsNext = page.next && page.items.length > 0 && spv.lists.length < 1000;
    } catch (e) { spv.listsErr = e instanceof Error ? e.message : 'Spotify did not answer.'; }
    spv.listsBusy = false;
    renderSp();
  }
  async function loadTracks(): Promise<void> {
    const l = spv.open;
    if (!l || spv.tracksBusy || !spv.tracksNext || !sp.connected()) return;
    spv.tracksBusy = true; spv.tracksErr = '';
    renderSp();
    try {
      const page = await sp.tracks(l, spv.tracks.length);
      if (spv.open !== l) return;
      spv.tracks.push(...page.items);
      spv.tracksTotal = page.total;
      spv.tracksNext = page.next && page.items.length > 0 && spv.tracks.length < 2000;
      const refs = page.items.filter((t) => t.id).map((t) => ({ key: 'sp:' + t.id, spotifyId: t.id! }));
      void tempo.resolveMany(refs).then(() => renderTrackBpms());
    } catch (e) {
      const st = e instanceof SpError ? e.status : 0;
      spv.tracksNext = false;
      spv.tracksErr = st === 403 || st === 404
        ? 'Spotify only shares the track list of playlists you own or collaborate on. You can still play this one.'
        : e instanceof Error ? e.message : 'Spotify did not answer.';
    } finally { spv.tracksBusy = false; }
    renderSp();
  }
  function openList(l: SpList): void {
    spv.open = l; spv.tracks = []; spv.tracksNext = true; spv.tracksTotal = l.total; spv.tracksErr = '';
    renderSp();
    void loadTracks();
  }
  async function openPasted(e: MusicEntry): Promise<void> {
    if (e.kind !== 'sp' || (e.spType !== 'playlist' && e.spType !== 'album')) return;
    try {
      const l = await sp.list(e.spType, e.id);
      if (!l) { host.toast('Spotify does not know that ' + e.spType + '.'); return; }
      openList(l);
      spEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (er) { host.toast(er instanceof Error ? er.message : 'Spotify did not answer.'); }
  }
  function playFrom(l: SpList, i: number): void {
    const t = spv.tracks[i];
    const fallback: MusicEntry | null = l.kind === 'liked' ? (t && t.id ? { kind: 'sp', spType: 'track', id: t.id } : null) : { kind: 'sp', spType: l.kind, id: l.id };
    if (l.kind === 'liked') {
      // liked songs have no context to play: hand over the loaded tracks from this one on
      const uris = spv.tracks.slice(i, i + 100).filter((x) => x.playable).map((x) => x.uri);
      void sdkPlay({ uris }, fallback);
    } else void sdkPlay(t ? { context: l.uri, offsetUri: t.uri } : { context: l.uri }, fallback);
  }

  function trackRow(l: SpList, t: SpTrack, i: number): HTMLElement {
    const b = el('button', 'mu-trk' + (cur.uri === t.uri && mode === 'sdk' ? ' on' : ''));
    b.type = 'button';
    b.disabled = !t.playable;
    b.dataset.i = String(i);
    const n = el('span', 'mu-trk-n', String(i + 1));
    const meta = el('span', 'mu-trk-meta');
    meta.append(el('span', 'mu-trk-name', t.name), el('span', 'mu-trk-who', t.artists));
    const key = t.id ? 'sp:' + t.id : '';
    const k = key ? tempo.known(key) : null;
    const bpm = el('span', 'mu-trk-bpm', k ? String(Math.round(k.bpm)) : '');
    bpm.title = k ? k.bpm + ' BPM (' + k.source + ')' : 'BPM unknown';
    const dur = el('span', 'mu-trk-dur', t.durationMs ? fmtTime(t.durationMs) : '');
    b.append(n, meta, bpm, dur);
    b.setAttribute('aria-label', 'Play ' + t.name + (t.artists ? ' by ' + t.artists : '') + (k ? ', ' + Math.round(k.bpm) + ' BPM' : ''));
    b.addEventListener('click', () => { host.click(); playFrom(l, i); });
    return b;
  }
  /** Only the rows in view are in the page; long playlists scroll smoothly that way. */
  function renderTracksWindow(): void {
    if (!trackBox || !trackInner || !spv.open) return;
    const n = spv.tracks.length;
    const top = trackBox.scrollTop, h = trackBox.clientHeight || 320;
    const from = Math.max(0, Math.floor(top / ROW_H) - 8), to = Math.min(n, Math.ceil((top + h) / ROW_H) + 8);
    trackInner.style.height = n * ROW_H + 'px';
    // the rows are rebuilt on every state report: keep the keyboard focus on the same track
    const fa = document.activeElement;
    const focusI = fa instanceof HTMLElement && fa.classList.contains('mu-trk') && trackInner.contains(fa) ? fa.dataset.i : undefined;
    const rows: HTMLElement[] = [];
    for (let i = from; i < to; i++) {
      const r = trackRow(spv.open, spv.tracks[i], i);
      r.style.top = i * ROW_H + 'px';
      rows.push(r);
    }
    trackInner.replaceChildren(...rows);
    if (focusI !== undefined) (trackInner.querySelector('.mu-trk[data-i="' + focusI + '"]') as HTMLElement | null)?.focus({ preventScroll: true });
    if (to >= n - 10 && spv.tracksNext && !spv.tracksBusy) void loadTracks();
  }
  function renderTrackBpms(): void { if (trackBox) renderTracksWindow(); if (dockParts.ytlist) renderYtList(); }
  function renderTrackHighlight(): void { if (trackBox) renderTracksWindow(); }

  function renderSp(): void {
    if (!spEl) return;
    if (!SP_ON) { spEl.hidden = true; spEl.replaceChildren(); return; }
    // a redraw keeps where the player had scrolled to (the panel is rebuilt while pages load)
    const keepOpen = spv.open, keepTracks = trackBox ? trackBox.scrollTop : 0, keepLists = listsEl ? listsEl.scrollTop : 0;
    const box = el('div', 'mu-sp');
    const head = el('div', 'mu-sp-head');
    head.append(spotifyIcon(), el('h3', 'mu-sp-title', 'Spotify'));
    box.append(head);
    const msg = sp.message ? el('p', 'mu-sp-msg', sp.message) : null;

    if (sp.status === 'busy') {
      box.append(el('p', 'note', sp.message || 'Connecting…'));
    } else if (!sp.connected()) {
      const id = sp.clientId();
      if (msg) box.append(msg);
      if (id) {
        const row1 = el('div', 'mu-sp-row');
        const connect = button('btn small', 'Connect Spotify', () => { host.click(); save(); void sp.login(stay); });
        const keep = el('label', 'mu-tick');
        const box2 = el('input');
        box2.type = 'checkbox'; box2.checked = stay;
        box2.addEventListener('change', () => { stay = box2.checked; save(); });
        keep.append(box2, el('span', 'lab', 'Stay connected on this device'));
        row1.append(connect, keep);
        box.append(row1);
        box.append(el('p', 'note mu-note', 'Plays full tracks of your playlists in the game (Spotify Premium). This Spotify app is in development mode: only accounts its owner added (up to 5) can connect. Without Premium, pasted Spotify links still play in the embed. Sign-in happens on spotify.com; the game keeps only a session token in this browser.'));
      } else {
        box.append(el('p', 'note mu-note', 'Spotify sign-in is not set up for this site. Pasted Spotify links play in the embed (previews unless you are logged in to Spotify in this browser). To play full tracks, set up your own Client ID below.'));
      }
      box.append(advanced());
    } else {
      const u = sp.user;
      const row1 = el('div', 'mu-sp-row');
      row1.append(el('span', 'mu-sp-user', 'Connected' + (u && u.name ? ' as ' + u.name : '')));
      const dis = button('btn small ghost', 'Disconnect', () => {
        host.click();
        if (mode === 'sdk') stop();
        listener.stop();
        spv.lists = []; spv.listsNext = true; spv.open = null; spv.tracks = [];
        sp.logout('Disconnected. To remove the game\'s access completely, visit your Spotify account\'s Apps page.');
        renderList();
      });
      row1.append(dis, extLink('https://www.spotify.com/account/apps/', 'Manage access'));
      box.append(row1);
      if (msg) box.append(msg);
      if (!sp.canStream) box.append(el('p', 'note mu-note', 'Full tracks are not available (Premium needed, or this browser lacks encrypted media support). Playlists still open, and playing falls back to the embed.'));

      if (spv.open) {
        const l = spv.open;
        const bar = el('div', 'mu-sp-row');
        bar.append(button('chip mu-chip', '← Back', () => { host.click(); spv.open = null; trackBox = trackInner = null; renderSp(); }));
        if (l.art) { const img = el('img', 'mu-sp-cover'); img.src = l.art; img.alt = ''; img.referrerPolicy = 'no-referrer'; bar.append(img); }
        const t = el('div', 'mu-sp-ltitle');
        t.append(el('span', 'mu-name', l.name), el('span', 'mu-meta', (l.kind === 'liked' ? 'Liked songs' : l.kind === 'album' ? 'Album' : 'Playlist') + (l.owner ? ' / ' + l.owner : '') + ' / ' + (spv.tracksTotal || l.total) + ' tracks'));
        bar.append(t);
        bar.append(button('btn small', 'Play', () => { host.click(); playFrom(l, 0); }));
        if (l.kind !== 'liked') bar.append(extLink(openUrl(l.uri), 'OPEN SPOTIFY'));
        box.append(bar);
        if (spv.tracksErr) box.append(el('p', 'note mu-note', spv.tracksErr));
        const sc = el('div', 'mu-tracks');
        sc.setAttribute('role', 'group'); // a list role would require listitem children; the rows are plain buttons
        sc.setAttribute('aria-label', 'Tracks of ' + l.name);
        const inner = el('div', 'mu-tracks-in');
        sc.append(inner);
        sc.addEventListener('scroll', () => renderTracksWindow(), { passive: true });
        trackBox = sc; trackInner = inner;
        box.append(sc);
        if (spv.tracksBusy) box.append(el('p', 'note', 'Loading tracks…'));
        if (!online) box.append(onlineNote());
      } else {
        trackBox = trackInner = null;
        const tabs = el('div', 'mu-sp-row');
        const tPl = button('chip mu-chip mu-toggle' + (spv.tab === 'playlists' ? ' on' : ''), 'Playlists', () => { host.click(); spv.tab = 'playlists'; renderSp(); });
        tPl.setAttribute('aria-pressed', spv.tab === 'playlists' ? 'true' : 'false');
        const tLk = button('chip mu-chip', 'Liked songs', () => { host.click(); openList({ id: 'liked', uri: '', name: 'Liked songs', owner: '', art: '', total: 0, kind: 'liked', mine: true }); });
        const f = el('input', 'mu-input mu-filter');
        f.type = 'search'; f.placeholder = 'Find a playlist by name'; f.maxLength = 80; f.value = spv.filter;
        f.setAttribute('aria-label', 'Find a playlist by name');
        f.addEventListener('input', () => { spv.filter = f.value; renderLists(); });
        filterIn = f;
        tabs.append(tPl, tLk, f);
        box.append(tabs);
        const ul = el('ul', 'mu-list mu-pls');
        ul.setAttribute('aria-label', 'Your playlists');
        box.append(ul);
        if (spv.listsErr) box.append(el('p', 'note mu-note', spv.listsErr));
        if (spv.listsNext) box.append(button('btn small ghost', spv.listsBusy ? 'Loading…' : 'Load more', () => { host.click(); void loadLists(); }));
        box.append(el('p', 'note mu-note', 'Paste a Spotify playlist or album link above to keep it on your list; its Tracks button opens it here.'));
        listsEl = ul;
        renderLists();
        if (!spv.lists.length && spv.listsNext && !spv.listsBusy && !spv.listsErr) void loadLists();
      }
    }
    // keep the focus in the filter field while the list redraws under it
    const hadFilter = document.activeElement === filterIn;
    const hadTrack = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('mu-trk') ? document.activeElement.dataset.i : undefined;
    spEl.replaceChildren(box);
    if (hadFilter && filterIn) { filterIn.focus(); }
    if (trackBox) {
      if (spv.open === keepOpen && trackInner) { trackInner.style.height = spv.tracks.length * ROW_H + 'px'; trackBox.scrollTop = keepTracks; }
      renderTracksWindow();
      if (hadTrack !== undefined) (trackBox.querySelector('.mu-trk[data-i="' + hadTrack + '"]') as HTMLElement | null)?.focus();
    } else if (listsEl && !spv.open && !keepOpen) listsEl.scrollTop = keepLists;
  }
  let listsEl: HTMLElement | null = null;
  function renderLists(): void {
    if (!listsEl) return;
    const f = spv.filter.trim().toLowerCase();
    const shown = spv.lists.filter((l) => !f || l.name.toLowerCase().includes(f));
    const rows = shown.map((l) => {
      const r = el('li', 'mu-row mu-pl');
      if (l.art) { const img = el('img', 'mu-sp-cover'); img.src = l.art; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; r.append(img); }
      const main = el('div', 'mu-main');
      main.append(el('span', 'mu-name', l.name), el('span', 'mu-meta', (l.owner ? l.owner + ' / ' : '') + l.total + ' tracks'));
      const tools = el('div', 'mu-tools');
      const op = button('chip mu-chip', 'Open', () => { host.click(); openList(l); });
      op.setAttribute('aria-label', 'Open ' + l.name);
      const pl = button('btn small ghost', 'Play', () => { host.click(); void sdkPlay({ context: l.uri }, { kind: 'sp', spType: 'playlist', id: l.id }); });
      pl.setAttribute('aria-label', 'Play ' + l.name);
      tools.append(op, pl);
      r.append(main, tools);
      return r;
    });
    if (!rows.length) rows.push(el('li', 'mu-row mu-empty', spv.listsBusy ? 'Loading playlists…' : f ? 'No playlist with that name loaded.' : 'No playlists.'));
    listsEl.replaceChildren(...rows);
  }
  function onlineNote(): HTMLElement { return el('p', 'note mu-note', 'BPM of tracks stays empty until you allow online BPM lookup below, or set it yourself while a track plays.'); }

  function advanced(): HTMLElement {
    const det = el('details', 'mu-adv');
    det.append(el('summary', '', 'Advanced: use your own Spotify Client ID'));
    const uri = sp.redirectUri();
    const steps = el('ol', 'mu-steps');
    const li = (t: string | Node[]): HTMLElement => { const x = el('li'); if (typeof t === 'string') x.textContent = t; else x.append(...t); return x; };
    const code = el('code', 'mu-code', uri);
    steps.append(
      li([document.createTextNode('Create an app at '), extLink('https://developer.spotify.com/dashboard', 'developer.spotify.com/dashboard'), document.createTextNode(' with "Web API" and "Web Playback SDK" ticked. The app owner needs Spotify Premium.')]),
      li([document.createTextNode('Add this Redirect URI exactly: '), code]),
      li('Under User Management, add the Spotify accounts that will connect (development mode allows 5).'),
      li('Paste the app\'s Client ID here. It stays in this browser. No secret is needed or wanted.'),
    );
    if (location.hostname === 'localhost') steps.append(li('Spotify refuses "localhost": open this page at 127.0.0.1 or [::1] instead, and register that address.'));
    const form = el('form', 'mu-add');
    form.noValidate = true;
    const inp = textField('32-character Client ID', 40, 'Spotify Client ID');
    inp.value = sp.ownClientId();
    const saveB = el('button', 'btn small', 'Save');
    saveB.type = 'submit';
    form.append(inp, saveB);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault(); host.click();
      if (!sp.setOwnClientId(inp.value)) { host.toast('A Client ID is 32 characters, 0-9 and a-f.'); return; }
      host.toast(inp.value.trim() ? 'Client ID saved.' : 'Client ID removed.');
      renderSp();
    });
    det.append(steps, form);
    if (sp.hasSiteId()) det.append(el('p', 'note mu-note', 'This site already has its own Client ID, which is used instead.'));
    return det;
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
    const word = added === 1 ? ' entry' : ' entries';
    host.toast(replace ? 'Playlist replaced: ' + added + word + '.' : added + word + ' added.');
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

    const note = el('p', 'note mu-note', 'External players load from YouTube or Spotify only when you press play. YouTube playlists show their videos in the player, with a BPM per video. Set, tap or look up the BPM so the beat effects follow your music.');

    spEl = el('section', 'mu-sec');
    spEl.setAttribute('aria-label', 'Spotify');

    // the opt-in for tempo lookups, in plain words
    const bpmSec = el('section', 'mu-sec mu-sp');
    bpmSec.append(el('h3', 'mu-sp-title', 'Beat'));
    const lk = el('label', 'mu-tick');
    const lkBox = el('input');
    lkBox.type = 'checkbox'; lkBox.checked = online;
    lkBox.addEventListener('change', () => { host.click(); online = lkBox.checked; save(); renderSp(); });
    lk.append(lkBox, el('span', 'lab', 'Look up the BPM of songs online'));
    const sent = gsbKey ? 'Spotify track ids go to ReccoBeats, and song titles and artists to GetSongBPM' : 'Spotify track ids go to ReccoBeats';
    const lkNote = el('p', 'note mu-note', 'When ticked: ' + sent + ', to find their tempo.' + (SP_ON ? ' YouTube titles are matched through your Spotify connection, if you have one.' : '') + ' No account data is sent. Off: only your own, tapped or heard BPM is used.');
    if (gsbKey) lkNote.append(' Tempo data partly by ', extLink('https://getsongbpm.com', 'GetSongBPM.com'), '.');
    const lsNote = el('p', 'note mu-note', 'Listen (in the player) finds the beat from the sound of this tab; Chrome and Edge on a computer ask you to share this tab with its audio, other browsers use the microphone. It only starts when you press it, and nothing is recorded or sent.');
    bpmSec.append(lk, lkNote, lsNote);

    const io = el('div', 'mu-io');
    const ioBar = el('div', 'btn-pair');
    const ioBox = el('div', 'mu-io-box');
    const showExport = (): void => {
      const area = el('textarea', 'mu-area');
      area.readOnly = true; area.rows = 6; area.spellcheck = false;
      area.setAttribute('aria-label', 'Playlist as JSON');
      area.value = JSON.stringify({ 'beatspire-music': 1, list }, null, 1);
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

    wrap.append(listEl, add, note, spEl, bpmSec, io);
    host.root.replaceChildren(wrap);
    renderList();
    renderSp();
  }

  load();
  host.setPlaylist(mine);
  host.setTrack(builtin);
  window.addEventListener('pagehide', () => listener.stop());
  const back = SP_ON ? sp.boot().catch(() => false) : Promise.resolve(false);
  return {
    open,
    isExternalPlaying: () => mode !== 'none',
    bpm: () => (mode === 'none' ? null : beat().bpm),
    beatOn: () => playingNow(),
    beatOrigin: () => (mode === 'none' ? 0 : beat().origin),
    beatPhase: (now: number) => {
      if (mode === 'none' || !playingNow()) return null;
      const b = beat();
      return beatPhase(now, b.origin, b.bpm);
    },
    returnedFromSpotify: () => back,
  };
}
