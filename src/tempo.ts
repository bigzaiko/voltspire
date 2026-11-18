// Where the BPM of a song comes from. In order: what the player set or tapped, the local cache,
// Spotify's own audio features (only apps that still have access), ReccoBeats by Spotify track id,
// and GetSongBPM by artist and title (only when the site owner configured a key).
// Lookups at third parties run only after the player opted in. No DOM in here: tools/music-test.ts runs it in Node.

export const LOOKUP_MIN = 70, LOOKUP_MAX = 180;
export const MANUAL_MIN = 40, MANUAL_MAX = 220;

/** Fold a looked-up tempo into 70..180 by halving or doubling; half and double time are the usual mistakes. */
export function normalizeBpm(v: unknown, lo = LOOKUP_MIN, hi = LOOKUP_MAX): number | null {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0) return null;
  let b = v;
  for (let i = 0; i < 8 && b > hi; i++) b /= 2;
  for (let i = 0; i < 8 && b < lo; i++) b *= 2;
  if (b < lo || b > hi) return null;
  return Math.round(b * 10) / 10;
}
export function cleanManual(v: unknown): number | null {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const n = Math.round(v * 10) / 10;
  return n >= MANUAL_MIN && n <= MANUAL_MAX ? n : null;
}

/** Guess artist and title from a YouTube video title and its channel. */
export function cleanVideoTitle(raw: string, author = ''): { artist: string; title: string } {
  let t = String(raw || '').slice(0, 300);
  t = t.replace(/[([{【][^)\]}】]*[)\]}】]/g, ' ');
  t = t.replace(/\b(official|music|lyric|lyrics|video|audio|visualizer|visualiser|hd|hq|4k|remastered|full album|mv)\b/gi, ' ');
  t = t.replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim();
  const parts = t.split(/\s+[-–—]\s+/);
  let artist = '', title = t;
  if (parts.length >= 2) { artist = parts[0]; title = parts.slice(1).join(' - '); }
  else artist = String(author || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  title = title.replace(/\b(ft|feat)\.?\s.*$/i, '').replace(/["'“”]/g, '').trim();
  artist = artist.replace(/["'“”]/g, '').trim();
  return { artist: artist.slice(0, 100), title: title.slice(0, 120) };
}

export interface TempoHit { bpm: number; source: string; conf: number }
export interface TrackRef { key: string; spotifyId?: string; artist?: string; title?: string }

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }
type CacheRow = { b: number; s: string; c: number; t: number };
type OwnRow = { b: number; o?: number };

const CACHE_KEY = 'beatspire-tempo';
const OWN_KEY = 'beatspire-tempo-own';
const KEY_RE = /^(sp:[0-9A-Za-z]{22}|yt:[A-Za-z0-9_-]{11})$/;
export const CACHE_MAX = 600, OWN_MAX = 1000;
const HIT_TTL = 180 * 86400000, MISS_TTL = 3 * 86400000;

export function isTempoKey(k: unknown): k is string { return typeof k === 'string' && KEY_RE.test(k); }

/**
 * Looked-up tempos (a bounded cache, oldest dropped first, misses remembered for 3 days)
 * and the player's own values (kept until the player changes them).
 */
export class TempoBook {
  private store: Store | null;
  private now: () => number;
  private cache = new Map<string, CacheRow>();
  private own = new Map<string, OwnRow>();
  constructor(store: Store | null, now: () => number = Date.now) {
    this.store = store; this.now = now;
    this.cache = this.read(CACHE_KEY, (r) => {
      const o = r as CacheRow;
      return typeof o.b === 'number' && (o.b === 0 || normalizeBpm(o.b) !== null) && typeof o.s === 'string' && o.s.length < 20 && typeof o.c === 'number' && typeof o.t === 'number';
    }) as Map<string, CacheRow>;
    this.own = this.read(OWN_KEY, (r) => {
      const o = r as OwnRow;
      return cleanManual(o.b) !== null && (o.o === undefined || (typeof o.o === 'number' && isFinite(o.o) && o.o >= 0 && o.o < 4000));
    }) as Map<string, OwnRow>;
  }
  private read(key: string, ok: (r: object) => boolean): Map<string, object> {
    const m = new Map<string, object>();
    let text: string | null = null;
    try { text = this.store ? this.store.getItem(key) : null; } catch { text = null; }
    if (!text || text.length > 400000) return m;
    try {
      const d = JSON.parse(text) as unknown;
      if (!Array.isArray(d)) return m;
      for (const it of d.slice(0, 2000)) {
        if (!Array.isArray(it) || !isTempoKey(it[0]) || typeof it[1] !== 'object' || it[1] === null) continue;
        if (ok(it[1])) m.set(it[0], it[1]);
      }
    } catch { /* ignore */ }
    return m;
  }
  private write(key: string, m: Map<string, object>): void {
    try { this.store?.setItem(key, JSON.stringify([...m])); } catch { /* full or blocked */ }
  }
  get(key: string): TempoHit | null | undefined {
    const r = this.cache.get(key);
    if (!r) return undefined;
    if (this.now() - r.t > (r.b ? HIT_TTL : MISS_TTL)) { this.cache.delete(key); return undefined; }
    return r.b ? { bpm: r.b, source: r.s, conf: r.c } : null;
  }
  /** Remember a lookup. A batch passes write=false and calls flush() once, so 50 tracks are not 50 full rewrites of the cache. */
  put(key: string, hit: TempoHit | null, write = true): void {
    if (!isTempoKey(key)) return;
    this.cache.delete(key);
    this.cache.set(key, hit ? { b: hit.bpm, s: hit.source, c: hit.conf, t: this.now() } : { b: 0, s: '', c: 0, t: this.now() });
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    if (write) this.write(CACHE_KEY, this.cache);
  }
  flush(): void { this.write(CACHE_KEY, this.cache); }
  cacheSize(): number { return this.cache.size; }
  ownGet(key: string): OwnRow | undefined { return this.own.get(key); }
  ownSet(key: string, bpm: number | null, offsetMs?: number): void {
    if (!isTempoKey(key)) return;
    const b = cleanManual(bpm);
    this.own.delete(key);
    if (b !== null) {
      const row: OwnRow = { b };
      if (offsetMs !== undefined && isFinite(offsetMs)) row.o = Math.max(0, Math.min(3999, Math.round(offsetMs)));
      this.own.set(key, row);
    }
    while (this.own.size > OWN_MAX) this.own.delete(this.own.keys().next().value as string);
    this.write(OWN_KEY, this.own);
  }
}

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; headers: { get(k: string): string | null }; json(): Promise<unknown> }>;

export interface ResolverOpts {
  book: TempoBook;
  fetch: Fetch;
  /** the player agreed to third-party lookups */
  online: () => boolean;
  /** Spotify's own audio features with the player's token; throws 'forbidden' when the app has no access */
  spotifyFeatures?: (ids: string[]) => Promise<Map<string, number>>;
  /** find a Spotify track id for artist and title (for YouTube videos), through the player's Spotify connection */
  spotifySearch?: (artist: string, title: string) => Promise<string | null>;
  getSongBpmKey?: string;
  now?: () => number;
}

const RB = 'https://api.reccobeats.com/v1/audio-features?ids=';
const GSB = 'https://api.getsong.co/search/?';
const SP_ID = /^[0-9A-Za-z]{22}$/;

/** Runs the chain. Requests for the same key share one promise; a 429 pauses that provider for Retry-After. */
export class TempoResolver {
  private o: ResolverOpts;
  private now: () => number;
  private spDenied = false;
  private pause = new Map<string, number>();
  private pending = new Map<string, Promise<TempoHit | null>>();
  constructor(o: ResolverOpts) { this.o = o; this.now = o.now || Date.now; }

  /** What is known right now without a network request: own value first, then the cache. */
  known(key: string): (TempoHit & { offsetMs?: number }) | null | undefined {
    const own = this.o.book.ownGet(key);
    if (own) return { bpm: own.b, source: 'manual', conf: 1, offsetMs: own.o };
    return this.o.book.get(key);
  }
  private paused(p: string): boolean { return (this.pause.get(p) || 0) > this.now(); }
  private backoff(p: string, retryAfter: string | null): void {
    const n = Number(retryAfter);
    this.pause.set(p, this.now() + Math.max(1000, Math.min(600000, isFinite(n) && n > 0 ? n * 1000 : 30000)));
  }

  /** Resolve a batch (a playlist page, the next tracks). Returns what is known afterwards, by key. */
  async resolveMany(refs: TrackRef[]): Promise<Map<string, TempoHit | null>> {
    const out = new Map<string, TempoHit | null>();
    const todo: TrackRef[] = [];
    for (const r of refs) {
      if (!isTempoKey(r.key)) continue;
      const k = this.known(r.key);
      if (k !== undefined) out.set(r.key, k);
      else if (this.pending.has(r.key)) out.set(r.key, await this.pending.get(r.key)!);
      else todo.push(r);
    }
    if (!todo.length) return out;
    const job = this.run(todo);
    for (const r of todo) this.pending.set(r.key, job.then((m) => m.get(r.key) ?? null));
    try {
      const got = await job;
      for (const r of todo) out.set(r.key, got.get(r.key) ?? null);
    } finally { for (const r of todo) this.pending.delete(r.key); }
    return out;
  }
  async resolve(ref: TrackRef): Promise<TempoHit | null> { return (await this.resolveMany([ref])).get(ref.key) ?? null; }

  private async run(refs: TrackRef[]): Promise<Map<string, TempoHit | null>> {
    const got = new Map<string, TempoHit | null>();
    let failed = false; // a provider was unreachable: do not remember the misses
    const left = (): TrackRef[] => refs.filter((r) => !got.has(r.key));
    const sp = (): TrackRef[] => left().filter((r) => r.spotifyId && SP_ID.test(r.spotifyId));

    // 1. Spotify's own audio features (closed to new apps since November 2024, kept for apps that still have it)
    if (this.o.spotifyFeatures && !this.spDenied && sp().length) {
      try {
        const m = await this.o.spotifyFeatures(sp().map((r) => r.spotifyId!));
        for (const r of sp()) { const b = normalizeBpm(m.get(r.spotifyId!)); if (b) got.set(r.key, { bpm: b, source: 'Spotify', conf: 0.9 }); }
      } catch (e) { if (String(e).includes('forbidden')) this.spDenied = true; else failed = true; }
    }
    if (!this.o.online()) {
      for (const [k, v] of got) this.o.book.put(k, v, false);
      if (got.size) this.o.book.flush();
      return got; // nothing else may leave the browser; misses are not remembered either
    }
    // 2. YouTube videos: find the song on Spotify first, then treat it like a Spotify track
    const viaSearch = new Map<string, string>(); // spotify id -> original key
    if (this.o.spotifySearch) {
      for (const r of left()) {
        if (r.spotifyId || !r.title) continue;
        try {
          const id = await this.o.spotifySearch(r.artist || '', r.title);
          if (id && SP_ID.test(id)) { viaSearch.set(id, r.key); r.spotifyId = id; }
        } catch { failed = true; }
      }
    }
    // 3. ReccoBeats by Spotify track id, 40 per request
    if (!this.paused('rb')) {
      const ids = [...new Set(sp().map((r) => r.spotifyId!))];
      for (let i = 0; i < ids.length && !this.paused('rb'); i += 40) {
        const part = ids.slice(i, i + 40);
        try {
          const res = await this.o.fetch(RB + part.join(','));
          if (res.status === 429) { this.backoff('rb', res.headers.get('retry-after')); failed = true; break; }
          if (!res.ok) { failed = true; continue; }
          const d = await res.json() as { content?: unknown };
          const rows = d && Array.isArray(d.content) ? d.content : [];
          const tempo = new Map<string, number>();
          for (const row of rows.slice(0, 80)) {
            if (typeof row !== 'object' || row === null) continue;
            const href = (row as Record<string, unknown>).href, t = (row as Record<string, unknown>).tempo;
            const m = typeof href === 'string' ? /\/track\/([0-9A-Za-z]{22})$/.exec(href) : null;
            if (m && typeof t === 'number') tempo.set(m[1], t);
          }
          for (const r of sp()) {
            if (part.indexOf(r.spotifyId!) < 0) continue;
            const b = normalizeBpm(tempo.get(r.spotifyId!));
            if (b) got.set(r.key, { bpm: b, source: 'ReccoBeats', conf: viaSearch.has(r.spotifyId!) ? 0.6 : 0.8 });
          }
        } catch { failed = true; }
      }
    } else failed = true;
    // 4. GetSongBPM by artist and title, only with the owner's key (and its required backlink on the page)
    const key = this.o.getSongBpmKey;
    if (key && !this.paused('gsb')) {
      for (const r of left().slice(0, 10)) {
        if (!r.title || this.paused('gsb')) continue;
        const lookup = 'song:' + r.title + (r.artist ? ' artist:' + r.artist : '');
        try {
          const res = await this.o.fetch(GSB + new URLSearchParams({ api_key: key, type: 'both', lookup }).toString());
          if (res.status === 429) { this.backoff('gsb', res.headers.get('retry-after')); failed = true; break; }
          if (!res.ok) { failed = true; continue; }
          const d = await res.json() as { search?: unknown };
          const first = Array.isArray(d && d.search) ? (d.search as unknown[])[0] : null;
          const t = first && typeof first === 'object' ? Number((first as Record<string, unknown>).tempo) : NaN;
          const b = normalizeBpm(t);
          if (b) got.set(r.key, { bpm: b, source: 'GetSongBPM', conf: 0.5 });
        } catch { failed = true; }
      }
    }
    for (const [k, v] of got) this.o.book.put(k, v, false);
    if (!failed) for (const r of left()) { got.set(r.key, null); this.o.book.put(r.key, null, false); }
    this.o.book.flush();
    return got;
  }
}
