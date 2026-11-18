// Spotify for the Music sheet: sign-in (PKCE, see spotify-auth.ts), the few Web API calls the
// playlist browser needs, and the Web Playback SDK device "BEATSPIRE" that plays full tracks (Premium).
// Requests go to accounts.spotify.com and api.spotify.com only, and the SDK script is loaded from
// sdk.scdn.co only after the player pressed Connect. Tokens are never logged and never put in a URL.

import {
  SP_ACCOUNTS, SP_API, isClientId, randomVerifier, randomState, challengeFor, redirectUriFor, authorizeUrl,
  parseRedirect, stripAuthParams, tokenBody, readTokenResponse, refreshDelay, needsRefresh, retryAfterMs,
  TokenStore, savePending, takePending, TOK,
} from './spotify-auth.ts';
import type { Tokens } from './spotify-auth.ts';

export interface SpTrack { id: string | null; uri: string; name: string; artists: string; album: string; art: string; durationMs: number; playable: boolean }
export interface SpList { id: string; uri: string; name: string; owner: string; art: string; total: number; kind: 'playlist' | 'album' | 'liked'; mine: boolean }
export interface SpPage<T> { items: T[]; total: number; next: boolean }
export interface SpState {
  track: SpTrack | null; paused: boolean; positionMs: number; at: number; durationMs: number;
  shuffle: boolean; repeat: 0 | 1 | 2; contextUri: string; next: SpTrack[];
}
export class SpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const SP_ID = /^[0-9A-Za-z]{22}$/;
const SP_URI = /^spotify:(track|album|playlist|episode):[0-9A-Za-z]{22}$/;
// i. and mosaic.scdn.co for most covers; dailymix-images., lineup-images. and the like also live on scdn.co
const ART_HOST = /^([a-z0-9-]+\.scdn\.co|[a-z0-9-]+\.spotifycdn\.com)$/;
const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';
const OWN_ID_KEY = 'beatspire-sp-client';
const MAX_TEXT = 200;
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

function str(v: unknown, max = MAX_TEXT): string { return typeof v === 'string' ? Array.from(v.replace(BAD_CHARS, ' ')).slice(0, max).join('') : ''; }
function rec(v: unknown): Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
/** Cover art only from Spotify's image hosts, https only. Shown as delivered (never cropped or covered). */
export function artUrl(images: unknown, want = 300): string {
  const list = arr(images).map(rec).filter((i) => typeof i.url === 'string');
  if (!list.length) return '';
  list.sort((a, b) => Math.abs((Number(a.width) || want) - want) - Math.abs((Number(b.width) || want) - want));
  try {
    const u = new URL(String(list[0].url));
    return u.protocol === 'https:' && ART_HOST.test(u.hostname) ? u.href : '';
  } catch { return ''; }
}
export function readTrack(t: unknown): SpTrack | null {
  const o = rec(t);
  const uri = str(o.uri, 64);
  if (!SP_URI.test(uri)) return null;
  const id = typeof o.id === 'string' && SP_ID.test(o.id) ? o.id : null;
  const album = rec(o.album);
  return {
    id, uri,
    name: str(o.name) || 'Untitled',
    artists: arr(o.artists).map((a) => str(rec(a).name, 80)).filter(Boolean).join(', '),
    album: str(album.name),
    art: artUrl(album.images),
    durationMs: typeof o.duration_ms === 'number' ? o.duration_ms : 0,
    playable: o.is_playable !== false && o.is_local !== true,
  };
}
export function readList(p: unknown, meId: string): SpList | null {
  const o = rec(p);
  const id = typeof o.id === 'string' && SP_ID.test(o.id) ? o.id : '';
  if (!id) return null;
  const kind = o.type === 'album' ? 'album' : 'playlist';
  const owner = rec(o.owner);
  const count = rec(o.items ?? o.tracks); // the February 2026 API renamed `tracks` to `items`
  return {
    id, uri: 'spotify:' + kind + ':' + id, kind,
    name: str(o.name) || 'Untitled',
    owner: kind === 'album' ? arr(o.artists).map((a) => str(rec(a).name, 80)).join(', ') : str(owner.display_name) || str(owner.id),
    art: artUrl(o.images),
    total: typeof count.total === 'number' ? count.total : typeof o.total_tracks === 'number' ? o.total_tracks : 0,
    mine: kind === 'playlist' && (owner.id === meId || o.collaborative === true),
  };
}
export function readState(s: unknown, at: number): SpState | null {
  const o = rec(s);
  if (!Object.keys(o).length) return null;
  const tw = rec(o.track_window);
  const rm = o.repeat_mode;
  return {
    track: readTrack(tw.current_track),
    paused: o.paused !== false,
    positionMs: typeof o.position === 'number' && o.position >= 0 ? o.position : 0,
    at,
    durationMs: typeof o.duration === 'number' ? o.duration : 0,
    shuffle: o.shuffle === true,
    repeat: rm === 1 ? 1 : rm === 2 ? 2 : 0,
    contextUri: str(rec(o.context).uri, 80),
    next: arr(tw.next_tracks).slice(0, 5).map(readTrack).filter((t): t is SpTrack => !!t),
  };
}

// The parts of the SDK this file uses.
interface SdkPlayer {
  connect(): Promise<boolean>; disconnect(): void;
  addListener(ev: string, cb: (d: unknown) => void): boolean;
  getCurrentState(): Promise<unknown>;
  togglePlay(): Promise<void>; nextTrack(): Promise<void>; previousTrack(): Promise<void>;
  pause(): Promise<void>; seek(ms: number): Promise<void>; setVolume(v: number): Promise<void>; activateElement?(): Promise<void>;
}
type SdkWindow = Window & { Spotify?: { Player: new (o: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume: number }) => SdkPlayer }; onSpotifyWebPlaybackSDKReady?: () => void };

export type SpStatus = 'off' | 'busy' | 'on';

export class SpotifyClient {
  status: SpStatus = 'off';
  /** a sentence for the sheet: why something did not work, or what to do next */
  message = '';
  user: { id: string; name: string } | null = null;
  /** the SDK device: '' until it is ready */
  deviceId = '';
  /** false once the SDK reported a Premium or browser problem: the sheet then falls back to the embed */
  canStream = true;
  persist = false;
  onChange: () => void = () => {};
  onState: (s: SpState | null) => void = () => {};

  private tokens: Tokens | null = null;
  private store: TokenStore;
  private timer = 0;
  private until = 0; // global back-off after a 429
  private player: SdkPlayer | null = null;
  private sdk: Promise<boolean> | null = null;
  private starting: Promise<string> | null = null;
  private envId: string;
  private fetcher: typeof fetch;

  constructor(envId: string, fetcher: typeof fetch = (...a) => fetch(...a)) {
    this.envId = isClientId(envId) ? envId : '';
    this.fetcher = fetcher;
    this.store = new TokenStore(safe(() => localStorage), safe(() => sessionStorage));
    // "Disconnect" in another tab of a kept session ends it here too; otherwise this tab's next refresh would store it again
    if (typeof window !== 'undefined') window.addEventListener('storage', (ev) => {
      if (ev.key === TOK && ev.newValue === null && ev.storageArea === safe(() => localStorage) && this.persist && this.tokens) this.drop('Disconnected from Spotify in another tab.');
    });
  }

  /** The Client ID: the site's own (from the build) or the one the player entered under Advanced. */
  clientId(): string {
    if (this.envId) return this.envId;
    const own = safe(() => localStorage.getItem(OWN_ID_KEY));
    return isClientId(own) ? own : '';
  }
  hasSiteId(): boolean { return !!this.envId; }
  ownClientId(): string { const v = safe(() => localStorage.getItem(OWN_ID_KEY)); return isClientId(v) ? v : ''; }
  setOwnClientId(v: string): boolean {
    const t = v.trim().toLowerCase();
    if (t && !isClientId(t)) return false;
    safe(() => (t ? localStorage.setItem(OWN_ID_KEY, t) : localStorage.removeItem(OWN_ID_KEY)));
    return true;
  }
  redirectUri(): string { return redirectUriFor(location); }
  connected(): boolean { return this.status === 'on' && !!this.tokens; }

  private set(status: SpStatus, message = this.message): void { this.status = status; this.message = message; this.onChange(); }

  /** Start the sign-in: off to Spotify, back to this page with ?code. */
  async login(persist: boolean): Promise<void> {
    const id = this.clientId();
    if (!id) { this.set('off', 'No Spotify Client ID is set up. See Advanced.'); return; }
    if (location.hostname === 'localhost') { this.set('off', 'Spotify does not accept "localhost" as an address. Open the game at http://127.0.0.1:' + (location.port || '80') + location.pathname + ' (start the dev server with --host 127.0.0.1) or http://[::1]:' + (location.port || '80') + location.pathname + ', and connect from there.'); return; }
    const verifier = randomVerifier(), state = randomState();
    const challenge = await challengeFor(verifier);
    savePending(safe(() => sessionStorage), { state, verifier, persist, clientId: id });
    location.assign(authorizeUrl({ clientId: id, redirectUri: this.redirectUri(), challenge, state }));
  }

  /**
   * On page load: finish a sign-in that came back (the code leaves the address bar at once),
   * or pick up a stored session. Returns true when the page came back from Spotify.
   */
  async boot(): Promise<boolean> {
    const pend = takePending(safe(() => sessionStorage));
    const r = parseRedirect(location.search, pend ? pend.state : null);
    if (r.kind !== 'none') history.replaceState(history.state, '', stripAuthParams(location.href));
    if (r.kind === 'bad-state') { this.set('off', 'The Spotify sign-in could not be checked (it did not start on this page). Try Connect again.'); return true; }
    if (r.kind === 'error') { this.set('off', r.error === 'access_denied' ? 'Spotify access was not granted.' : 'Spotify sign-in failed (' + r.error + ').'); return true; }
    if (r.kind === 'code' && pend) {
      this.persist = pend.persist;
      this.set('busy', 'Connecting to Spotify…');
      const ok = await this.tokenRequest({ grant_type: 'authorization_code', code: r.code, redirect_uri: this.redirectUri(), client_id: pend.clientId, code_verifier: pend.verifier });
      if (ok) await this.afterLogin();
      return true;
    }
    const saved = this.store.load();
    if (saved && this.clientId()) {
      this.persist = saved.persist;
      this.set('busy', 'Reconnecting to Spotify…');
      if (await this.refresh(saved.refresh)) await this.afterLogin();
    }
    return false;
  }

  private async afterLogin(): Promise<void> {
    try {
      const me = rec(await this.api('GET', '/me'));
      this.user = { id: str(me.id, 64), name: str(me.display_name, 60) || str(me.id, 60) };
      this.set('on', '');
    } catch (e) {
      const st = e instanceof SpError ? e.status : 0;
      this.drop(st === 403
        ? 'Spotify signed you in, but this app may only be used by accounts its owner listed (development mode allows 5). Ask the owner to add your Spotify account.'
        : e instanceof Error ? e.message : 'Spotify did not answer.');
    }
  }

  private async tokenRequest(p: Record<string, string>, oldRefresh = ''): Promise<boolean> {
    let res: Response;
    try {
      res = await this.fetcher(SP_ACCOUNTS + '/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody(p), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch { this.set(this.tokens ? this.status : 'off', 'Spotify cannot be reached. Check the connection.'); return false; }
    let data: unknown = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = str(rec(data).error, 40);
      // Spotify busy or slowing us down (5xx, 429): keep the session and try again later, never throw the refresh token away
      if (res.status >= 500 || res.status === 429) {
        const ms = res.status === 429 ? retryAfterMs(res.headers.get('Retry-After'), Date.now()) : 30000;
        if (this.tokens || p.grant_type === 'refresh_token') {
          if (this.timer) clearTimeout(this.timer);
          this.timer = window.setTimeout(() => { void this.refresh().then((ok) => { if (ok && !this.user) void this.afterLogin(); }); }, ms);
        }
        this.set(this.tokens ? this.status : 'off', 'Spotify is busy right now (' + res.status + '). Trying again shortly.');
        return false;
      }
      // a refresh token that was revoked, expired (6 months) or already used: sign in again, never retry it
      this.drop(err === 'invalid_grant' ? 'The Spotify session has ended. Connect again.' : err === 'invalid_client' ? 'Spotify does not know this Client ID, or this page address is not registered as a Redirect URI for it.' : 'Spotify sign-in failed (' + (err || res.status) + ').');
      return false;
    }
    const t = readTokenResponse(data, Date.now(), oldRefresh);
    if (!t) { this.drop('Spotify sent an unexpected answer.'); return false; }
    this.tokens = t;
    this.store.save(t.refresh, this.persist);
    this.schedule();
    return true;
  }

  private refresh(refreshToken?: string): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      // another tab may have rotated the token in the meantime: take the newest one
      const latest = this.store.load();
      const rt = (latest && latest.refresh) || refreshToken || (this.tokens && this.tokens.refresh) || '';
      if (!rt) { this.drop('The Spotify session has ended. Connect again.'); return false; }
      return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: rt, client_id: this.clientId() }, rt);
    };
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    return locks ? locks.request('beatspire-sp-refresh', run) as Promise<boolean> : run();
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.tokens) return;
    this.timer = window.setTimeout(() => { void this.refresh(); }, refreshDelay(this.tokens.expiresAt, Date.now()));
  }

  /** Forget everything: tokens, the device, the session. */
  logout(message = ''): void { this.drop(message); }
  private drop(message: string): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
    this.tokens = null; this.user = null; this.deviceId = ''; this.canStream = true;
    this.store.clear();
    if (this.player) { try { this.player.disconnect(); } catch { /* gone */ } this.player = null; }
    this.onState(null);
    this.set('off', message);
  }

  /** One Web API request with the rules: refresh once on 401, plain words for 403, wait on 429. */
  async api(method: string, path: string, body?: unknown, retried = false): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new SpError(0, 'bad path');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SpError(0, 'You are offline.');
    const wait = this.until - Date.now();
    if (wait > 0) throw new SpError(429, 'Spotify asked to slow down. Try again in ' + Math.ceil(wait / 1000) + ' s.');
    if (needsRefresh(this.tokens, Date.now()) && !(await this.refresh())) throw new SpError(401, this.message || 'Not connected to Spotify.');
    let res: Response;
    try {
      res = await this.fetcher(SP_API + path, {
        method,
        headers: { Authorization: 'Bearer ' + this.tokens!.access, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
    } catch { throw new SpError(0, 'Spotify cannot be reached. Check the connection.'); }
    if (res.status === 401 && !retried) {
      if (await this.refresh()) return this.api(method, path, body, true);
      throw new SpError(401, 'The Spotify session has ended. Connect again.');
    }
    if (res.status === 429) {
      const ms = retryAfterMs(res.headers.get('Retry-After'), Date.now());
      this.until = Date.now() + ms;
      throw new SpError(429, 'Spotify asked to slow down. Try again in ' + Math.ceil(ms / 1000) + ' s.');
    }
    if (res.status === 204 || res.status === 202) return null;
    let data: unknown = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = rec(rec(data).error), reason = str(err.reason, 40);
      let msg = str(err.message) || 'Spotify said no (' + res.status + ').';
      if (res.status === 403 && reason === 'PREMIUM_REQUIRED') this.canStream = false;
      if (res.status === 403) msg = reason === 'PREMIUM_REQUIRED' ? 'Full tracks need Spotify Premium.' : 'Spotify refused this (' + (str(err.message, 80) || 'forbidden') + '). In development mode only the accounts the app owner listed may use it.';
      if (res.status === 404 && path.startsWith('/me/player')) msg = 'The BEATSPIRE player is not ready on Spotify yet. Try again in a moment.';
      throw new SpError(res.status, msg);
    }
    return data;
  }

  // ---------- library ----------
  async playlists(offset: number): Promise<SpPage<SpList>> {
    const d = rec(await this.api('GET', '/me/playlists?limit=50&offset=' + Math.max(0, offset | 0)));
    const me = this.user ? this.user.id : '';
    return { items: arr(d.items).map((p) => readList(p, me)).filter((p): p is SpList => !!p), total: Number(d.total) || 0, next: !!d.next };
  }
  async list(kind: 'playlist' | 'album', id: string): Promise<SpList | null> {
    if (!SP_ID.test(id)) return null;
    const d = await this.api('GET', '/' + kind + 's/' + id );
    return readList(d, this.user ? this.user.id : '');
  }
  /** Tracks of a playlist, an album or the liked songs, 50 at a time. */
  async tracks(l: SpList, offset: number): Promise<SpPage<SpTrack>> {
    const o = Math.max(0, offset | 0);
    if (l.kind === 'album') {
      const d = rec(await this.api('GET', '/albums/' + l.id + '/tracks?limit=50&offset=' + o));
      // album tracks come without album art: give them the album's
      return { items: arr(d.items).map(readTrack).filter((t): t is SpTrack => !!t).map((t) => ({ ...t, art: t.art || l.art, album: t.album || l.name })), total: Number(d.total) || 0, next: !!d.next };
    }
    const path = l.kind === 'liked' ? '/me/tracks?limit=50&offset=' + o : '/playlists/' + l.id + '/items?limit=50&offset=' + o;
    const d = rec(await this.api('GET', path));
    return { items: arr(d.items).map((it) => readTrack(rec(it).item ?? rec(it).track)).filter((t): t is SpTrack => !!t), total: Number(d.total) || 0, next: !!d.next };
  }
  /** A Spotify track id for artist and title (used to find the BPM of a YouTube video). */
  async searchTrack(artist: string, title: string): Promise<string | null> {
    const q = (title ? 'track:' + title.slice(0, 100) : '') + (artist ? ' artist:' + artist.slice(0, 80) : '');
    const d = rec(await this.api('GET', '/search?type=track&limit=1&q=' + encodeURIComponent(q.trim())));
    const t = readTrack(arr(rec(d.tracks).items)[0]);
    return t ? t.id : null;
  }
  /** Spotify's own audio features. Closed to new apps since November 2024: then this throws 'forbidden'. */
  async audioFeatures(ids: string[]): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    const ok = ids.filter((i) => SP_ID.test(i)).slice(0, 100);
    if (!ok.length) return m;
    try {
      const d = rec(await this.api('GET', '/audio-features?ids=' + ok.join(',')));
      for (const f of arr(d.audio_features)) { const r = rec(f); if (typeof r.id === 'string' && typeof r.tempo === 'number') m.set(r.id, r.tempo); }
    } catch (e) {
      if (e instanceof SpError && (e.status === 403 || e.status === 404)) throw new Error('forbidden');
      throw e;
    }
    return m;
  }

  // ---------- the player ----------
  private loadSdk(): Promise<boolean> {
    if (this.sdk) return this.sdk;
    const w = window as SdkWindow;
    this.sdk = new Promise<boolean>((resolve) => {
      if (w.Spotify) { resolve(true); return; }
      const t = setTimeout(() => resolve(false), 20000);
      w.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(t); resolve(true); };
      const s = document.createElement('script');
      s.src = SDK_SRC; s.async = true;
      s.addEventListener('error', () => { clearTimeout(t); resolve(false); });
      document.head.append(s);
    });
    this.sdk.then((ok) => { if (!ok) this.sdk = null; });
    return this.sdk;
  }

  /** Create the device "BEATSPIRE" (loads the SDK on first use). Returns an error sentence, or '' when ready. */
  async startPlayer(volume: number): Promise<string> {
    if (!this.connected()) return 'Not connected to Spotify.';
    if (this.player && this.deviceId) return '';
    if (!this.canStream) return this.message || 'This browser or account cannot play full tracks.';
    // a second click while the first is still starting waits for it instead of creating a second device
    if (this.starting) return this.starting;
    this.starting = this.createPlayer(volume).finally(() => { this.starting = null; });
    return this.starting;
  }
  private async createPlayer(volume: number): Promise<string> {
    if (this.player) { try { this.player.disconnect(); } catch { /* gone */ } this.player = null; this.deviceId = ''; }
    if (!(await this.loadSdk())) return 'The Spotify player could not be loaded.';
    const w = window as SdkWindow;
    if (!w.Spotify) return 'The Spotify player could not be loaded.';
    const p = new w.Spotify.Player({
      name: 'BEATSPIRE',
      getOAuthToken: (cb) => {
        const t = this.tokens;
        if (t && !needsRefresh(t, Date.now())) { cb(t.access); return; }
        void this.refresh().then((ok) => { if (ok && this.tokens) cb(this.tokens.access); });
      },
      volume: Math.max(0, Math.min(1, volume)),
    });
    this.player = p;
    const fail = (msg: string): void => { this.canStream = false; this.deviceId = ''; this.message = msg; this.onChange(); };
    const ready = new Promise<string>((resolve) => {
      const t = setTimeout(() => resolve('The Spotify player did not start. This browser may not support it.'), 15000);
      p.addListener('ready', (d) => { clearTimeout(t); this.deviceId = str(rec(d).device_id, 80); resolve(''); this.onChange(); });
      p.addListener('initialization_error', () => { clearTimeout(t); fail('This browser cannot play Spotify tracks here (it needs encrypted media support). The Spotify embed is used instead.'); resolve(this.message); });
      p.addListener('account_error', () => { clearTimeout(t); fail('Full tracks need Spotify Premium. The Spotify embed (previews) is used instead.'); resolve(this.message); });
      p.addListener('authentication_error', () => { clearTimeout(t); resolve('Spotify did not accept the session. Connect again.'); this.drop('Spotify did not accept the session. Connect again.'); });
    });
    p.addListener('not_ready', () => { this.deviceId = ''; this.onChange(); });
    p.addListener('playback_error', () => { this.message = 'Spotify could not play that track.'; this.onChange(); });
    p.addListener('autoplay_failed', () => { this.message = 'The browser blocked playback. Press play.'; this.onChange(); });
    p.addListener('player_state_changed', (s) => this.onState(readState(s, performance.now())));
    const ok = await p.connect();
    if (!ok) return 'The Spotify player could not connect.';
    return ready;
  }
  /** Call inside the click that starts playback (mobile browsers need it). */
  activate(): void { try { void this.player?.activateElement?.(); } catch { /* not needed here */ } }
  async state(): Promise<SpState | null> { return this.player ? readState(await this.player.getCurrentState(), performance.now()) : null; }

  /** Play a context (playlist or album uri) from a track, or a list of track uris, on the BEATSPIRE device. */
  async play(o: { context?: string; uris?: string[]; offsetUri?: string; offsetPos?: number }): Promise<void> {
    if (!this.deviceId) throw new SpError(0, 'The BEATSPIRE player is not ready.');
    const body: Record<string, unknown> = {};
    if (o.context && /^spotify:(playlist|album):[0-9A-Za-z]{22}$/.test(o.context)) body.context_uri = o.context;
    else if (o.uris) body.uris = o.uris.filter((u) => SP_URI.test(u)).slice(0, 100);
    if (o.offsetUri && SP_URI.test(o.offsetUri)) body.offset = { uri: o.offsetUri };
    else if (typeof o.offsetPos === 'number' && o.offsetPos > 0) body.offset = { position: o.offsetPos | 0 };
    await this.api('PUT', '/me/player/play?device_id=' + encodeURIComponent(this.deviceId), body);
  }
  async toggle(): Promise<void> { await this.player?.togglePlay(); }
  pause(): void { void this.player?.pause().catch(() => {}); }
  async next(): Promise<void> { await this.player?.nextTrack(); }
  async prev(): Promise<void> { await this.player?.previousTrack(); }
  async seek(ms: number): Promise<void> { await this.player?.seek(Math.max(0, Math.round(ms))); }
  async volume(v: number): Promise<void> { await this.player?.setVolume(Math.max(0, Math.min(1, v))); }
  async shuffle(on: boolean): Promise<void> { await this.api('PUT', '/me/player/shuffle?state=' + (on ? 'true' : 'false') + '&device_id=' + encodeURIComponent(this.deviceId)); }
  async repeat(m: 'off' | 'context' | 'track'): Promise<void> { await this.api('PUT', '/me/player/repeat?state=' + m + '&device_id=' + encodeURIComponent(this.deviceId)); }
  /** Stop playing on this device without signing out. */
  stopPlayer(): void {
    if (this.player) { try { this.player.disconnect(); } catch { /* gone */ } }
    this.player = null; this.deviceId = '';
    this.onState(null);
  }
}

function safe<T>(f: () => T): T | null { try { return f(); } catch { return null; } }
