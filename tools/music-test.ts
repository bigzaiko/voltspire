// node tools/music-test.ts
// Music and streaming logic without a browser or network: PKCE, the sign-in round trip, token timing,
// link parsing, tempo normalisation and caching, the BPM provider chain (fetch is mocked), beat-phase
// maths, and the beat detector on synthetic click tracks.
import {
  base64url, randomVerifier, challengeFor, authorizeUrl, parseRedirect, stripAuthParams, readTokenResponse,
  refreshDelay, needsRefresh, retryAfterMs, TokenStore, savePending, takePending, isClientId, redirectUriFor, SP_SCOPES,
} from '../src/spotify-auth.ts';
import { readTrack, readList, readState, artUrl, SpotifyClient } from '../src/spotify.ts';
import { normalizeBpm, cleanManual, cleanVideoTitle, TempoBook, TempoResolver, CACHE_MAX } from '../src/tempo.ts';
import type { Fetch } from '../src/tempo.ts';
import { beatPhase, trackStart, tapOffset, TempoTracker, TempoHold, onsetEnvelope, logSpectrum, spectralFlux } from '../src/beat.ts';
import { parseMusicLink, sanitizeMusicList, embedSrc } from '../src/music.ts';

let fail = 0, pass = 0;
const ok = (c: unknown, m: string): void => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const eq = (a: unknown, b: unknown, m: string): void => ok(JSON.stringify(a) === JSON.stringify(b), m + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; } setItem(k: string, v: string) { this.m.set(k, String(v)); } removeItem(k: string) { this.m.delete(k); } }

// ---------- PKCE (RFC 7636 appendix B) ----------
{
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  eq(await challengeFor(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'RFC 7636 S256 challenge');
  eq(base64url(new Uint8Array([3, 236, 255, 224, 193])), 'A-z_4ME', 'RFC 7636 base64url example');
  const v = randomVerifier();
  ok(v.length === 64 && /^[A-Za-z0-9._~-]+$/.test(v), 'verifier length and charset');
  ok(randomVerifier() !== v, 'verifiers differ');
  ok(randomVerifier(43).length === 43 && randomVerifier(128).length === 128, 'verifier bounds');
  ok(isClientId('0123456789abcdef0123456789abcdef') && !isClientId('0123456789ABCDEF0123456789abcdeg') && !isClientId(''), 'client id check');
  eq(redirectUriFor({ origin: 'https://bigzaiko.github.io', pathname: '/beatspire/play.html' }), 'https://bigzaiko.github.io/beatspire/play.html', 'redirect uri');
  const u = new URL(authorizeUrl({ clientId: '0123456789abcdef0123456789abcdef', redirectUri: 'http://127.0.0.1:5183/play.html', challenge: 'abc', state: 'st' }));
  ok(u.origin === 'https://accounts.spotify.com' && u.pathname === '/authorize', 'authorize endpoint');
  eq([u.searchParams.get('response_type'), u.searchParams.get('code_challenge_method'), u.searchParams.get('redirect_uri')], ['code', 'S256', 'http://127.0.0.1:5183/play.html'], 'authorize params');
  eq(u.searchParams.get('scope')!.split(' '), SP_SCOPES, 'scopes');
  ok(SP_SCOPES.includes('streaming') && SP_SCOPES.includes('playlist-read-private') && SP_SCOPES.includes('user-library-read'), 'needed scopes');
}

// ---------- state and redirect ----------
{
  const st = 'AbCdEfGhIjKlMnOpQrStUvWx';
  eq(parseRedirect('', st), { kind: 'none' }, 'no params');
  eq(parseRedirect('?mode=solo', st), { kind: 'none' }, 'other params');
  eq(parseRedirect('?code=AQBcode_123-xyz&state=' + st, st), { kind: 'code', code: 'AQBcode_123-xyz' }, 'good code');
  eq(parseRedirect('?code=AQBcode_123-xyz&state=wrongstate000000', st).kind, 'bad-state', 'state mismatch');
  eq(parseRedirect('?code=AQBcode_123-xyz', st).kind, 'bad-state', 'state missing');
  eq(parseRedirect('?code=AQBcode_123-xyz&state=' + st, null).kind, 'bad-state', 'no pending sign-in');
  eq(parseRedirect('?code=AQBcode_123-xyz&state=short', 'short').kind, 'bad-state', 'too-short stored state');
  eq(parseRedirect('?error=access_denied&state=' + st, st), { kind: 'error', error: 'access_denied' }, 'denied');
  eq(parseRedirect('?error=<script>&state=' + st, st), { kind: 'error', error: 'unknown_error' }, 'odd error text');
  eq(parseRedirect('?code=a%20b%3Cc%3Edddddddd&state=' + st, st).kind, 'error', 'bad code chars');
  eq(stripAuthParams('https://x.io/beatspire/play.html?code=abc&state=def&mode=solo#h'), '/beatspire/play.html?mode=solo#h', 'strip keeps others');
  eq(stripAuthParams('http://127.0.0.1:5183/play.html?error=access_denied&state=x'), '/play.html', 'strip all');
  const ss = new Mem();
  savePending(ss, { state: st, verifier: 'v'.repeat(64), persist: true, clientId: '0123456789abcdef0123456789abcdef' });
  const p = takePending(ss);
  ok(p && p.state === st && p.persist === true, 'pending round trip');
  ok(takePending(ss) === null, 'pending is used once');
  ss.setItem('beatspire-sp-pkce', '{"state":"x","verifier":"y","clientId":"nope"}');
  ok(takePending(ss) === null, 'pending with a bad client id is refused');
}

// ---------- tokens ----------
{
  const t0 = 1_000_000;
  const t = readTokenResponse({ access_token: 'A', token_type: 'Bearer', expires_in: 3600, refresh_token: 'R1', scope: 'streaming' }, t0)!;
  eq([t.access, t.refresh, t.expiresAt], ['A', 'R1', t0 + 3600000], 'token response');
  eq(readTokenResponse({ access_token: 'B', expires_in: 3600 }, t0, 'R1')!.refresh, 'R1', 'refresh keeps the old token when none comes back');
  eq(readTokenResponse({ access_token: 'B', expires_in: 3600, refresh_token: 'R2' }, t0, 'R1')!.refresh, 'R2', 'rotated refresh token wins');
  ok(readTokenResponse({ error: 'invalid_grant' }, t0) === null && readTokenResponse(null, t0) === null, 'bad token response');
  eq(readTokenResponse({ access_token: 'C', expires_in: -5 }, t0)!.expiresAt, t0 + 3600000, 'bad expiry falls back to an hour');
  eq(refreshDelay(t0 + 3600000, t0), 3540000, 'refresh 60 s before an hour token ends');
  eq(refreshDelay(t0 + 3000, t0), 5000, 'never sooner than 5 s');
  eq(refreshDelay(t0 + 300000, t0, 300000), 270000, 'short tokens: a tenth early');
  ok(needsRefresh(null, t0) && needsRefresh(t, t.expiresAt - 10000) && !needsRefresh(t, t0), 'needsRefresh');
  eq(retryAfterMs('7', 0), 7000, 'Retry-After seconds');
  eq(retryAfterMs(null, 0), 5000, 'Retry-After missing');
  eq(retryAfterMs('99999', 0), 600000, 'Retry-After clamped');
  eq(retryAfterMs('Thu, 01 Jan 1970 00:00:30 GMT', 0), 30000, 'Retry-After date');
  const L = new Mem(), S = new Mem(), store = new TokenStore(L, S);
  store.save('R1', false);
  ok(S.getItem('beatspire-sp-auth') && !L.getItem('beatspire-sp-auth'), 'session-only storage');
  eq(store.load(), { refresh: 'R1', persist: false }, 'load session');
  store.save('R2', true);
  ok(!S.getItem('beatspire-sp-auth') && L.getItem('beatspire-sp-auth'), 'stay connected moves it to localStorage');
  ok(!L.getItem('beatspire-sp-auth')!.includes('access'), 'the access token is never stored');
  store.clear();
  ok(store.load() === null, 'clear');
  // a rotation must never remove the entry first: other tabs read a removal as "Disconnect"
  class Watch extends Mem { removed = 0; removeItem(k: string) { if (this.m.has(k)) this.removed++; super.removeItem(k); } }
  const WL = new Watch(), ws = new TokenStore(WL, new Mem());
  ws.save('A', true); ws.save('B', true);
  ok(WL.removed === 0 && ws.load()!.refresh === 'B', 'token rotation overwrites without a removal');
  eq(redirectUriFor({ origin: 'https://bigzaiko.github.io', pathname: '/beatspire/play' }), 'https://bigzaiko.github.io/beatspire/play.html', 'pretty /play address sends the registered redirect uri');
}

// ---------- links (the existing cases plus new ones) ----------
{
  eq(parseMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { kind: 'yt', id: 'dQw4w9WgXcQ' }, 'yt watch');
  eq(parseMusicLink('youtu.be/dQw4w9WgXcQ'), { kind: 'yt', id: 'dQw4w9WgXcQ' }, 'yt short host');
  eq(parseMusicLink('https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'), { kind: 'ytlist', id: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' }, 'yt music playlist');
  eq(parseMusicLink('https://www.youtube.com/watch?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'), { kind: 'ytlist', id: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' }, 'yt watch with only a list');
  eq(parseMusicLink('https://www.youtube.com/shorts/dQw4w9WgXcQ'), { kind: 'yt', id: 'dQw4w9WgXcQ' }, 'yt shorts');
  eq(parseMusicLink('https://open.spotify.com/playlist/37i9dQZF1DXdLEN7aqioXM?si=abc'), { kind: 'sp', spType: 'playlist', id: '37i9dQZF1DXdLEN7aqioXM' }, 'sp playlist with si');
  eq(parseMusicLink('https://open.spotify.com/intl-de/album/4m2880jivSbbyEGAKfITCa'), { kind: 'sp', spType: 'album', id: '4m2880jivSbbyEGAKfITCa' }, 'sp intl album');
  eq(parseMusicLink('spotify:track:0U0ldCRmgCqhVvD6ksG63j'), { kind: 'sp', spType: 'track', id: '0U0ldCRmgCqhVvD6ksG63j' }, 'sp uri');
  eq(parseMusicLink('https://open.spotify.com/embed/playlist/37i9dQZF1DXdLEN7aqioXM'), { kind: 'sp', spType: 'playlist', id: '37i9dQZF1DXdLEN7aqioXM' }, 'sp embed link');
  for (const bad of ['', 'javascript:alert(1)', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com:8080/watch?v=dQw4w9WgXcQ', 'https://open.spotify.com/user/abc', 'spotify:playlist:short', 'https://www.youtube.com/watch?v=dQw4w9WgXc', 'data:text/html,hi', 'https://open.spotify.com.evil.io/track/0U0ldCRmgCqhVvD6ksG63j', ' https://youtu.be/dQw4w9WgXcQ x'])
    ok(parseMusicLink(bad) === null, 'refused link ' + bad);
  ok(parseMusicLink(42) === null, 'non-string');
  eq(embedSrc({ kind: 'ytlist', id: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' }), 'https://www.youtube-nocookie.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&enablejsapi=1&playsinline=1&rel=0', 'yt list embed');
  eq(sanitizeMusicList([{ kind: 'sp', spType: 'playlist', id: '37i9dQZF1DXdLEN7aqioXM', bpm: 999, label: 'a\u202eb' }, { kind: 'x', id: 'y' }]), [{ kind: 'sp', spType: 'playlist', id: '37i9dQZF1DXdLEN7aqioXM', label: 'a b' }], 'sanitize');
}

// ---------- Spotify objects ----------
{
  const tr = readTrack({ id: '0U0ldCRmgCqhVvD6ksG63j', uri: 'spotify:track:0U0ldCRmgCqhVvD6ksG63j', name: 'Nightcall', artists: [{ name: 'Kavinsky' }], duration_ms: 258000, album: { name: 'OutRun', images: [{ url: 'https://i.scdn.co/image/abc', width: 640 }, { url: 'https://i.scdn.co/image/small', width: 300 }] } })!;
  eq([tr.name, tr.artists, tr.art, tr.playable], ['Nightcall', 'Kavinsky', 'https://i.scdn.co/image/small', true], 'track');
  ok(readTrack({ uri: 'javascript:x', name: 'x' }) === null, 'bad uri refused');
  eq(artUrl([{ url: 'https://evil.example/x.jpg' }]), '', 'art from other hosts refused');
  eq(artUrl([{ url: 'http://i.scdn.co/x' }]), '', 'art over http refused');
  ok(artUrl([{ url: 'https://image-cdn-ak.spotifycdn.com/image/x' }]).startsWith('https://image-cdn-ak'), 'spotifycdn art');
  ok(artUrl([{ url: 'https://dailymix-images.scdn.co/v2/img/x' }]).startsWith('https://dailymix-images.scdn.co'), 'daily mix covers (scdn.co subdomain)');
  eq(artUrl([{ url: 'https://scdn.co.evil.example/x' }]), '', 'look-alike host refused');
  const pl = readList({ id: '37i9dQZF1DXdLEN7aqioXM', type: 'playlist', name: 'Synth', owner: { id: 'me', display_name: 'Me' }, items: { total: 12 } }, 'me')!;
  eq([pl.uri, pl.total, pl.mine], ['spotify:playlist:37i9dQZF1DXdLEN7aqioXM', 12, true], 'playlist (2026 shape)');
  eq(readList({ id: '37i9dQZF1DXdLEN7aqioXM', type: 'playlist', name: 'X', owner: { id: 'other' }, tracks: { total: 3 } }, 'me')!.total, 3, 'playlist (old shape)');
  const s = readState({ paused: false, position: 61000, duration: 200000, shuffle: true, repeat_mode: 2, context: { uri: 'spotify:playlist:37i9dQZF1DXdLEN7aqioXM' }, track_window: { current_track: { id: '0U0ldCRmgCqhVvD6ksG63j', uri: 'spotify:track:0U0ldCRmgCqhVvD6ksG63j', name: 'Nightcall', artists: [] }, next_tracks: [{ id: '5W3cjX2J3tjhG8zb6u0qHn', uri: 'spotify:track:5W3cjX2J3tjhG8zb6u0qHn', name: 'N' }] } }, 5000)!;
  eq([s.paused, s.positionMs, s.repeat, s.shuffle, s.next.length, s.track!.id], [false, 61000, 2, true, 1, '0U0ldCRmgCqhVvD6ksG63j'], 'player state');
  ok(readState(null, 0) === null, 'empty player state');
}

// ---------- token endpoint errors: only a real refusal ends the session ----------
{
  const g = globalThis as Record<string, unknown>;
  const hadWin = 'window' in g;
  const timers: unknown[] = [];
  if (!hadWin) g.window = { setTimeout: (f: () => void, ms: number) => { timers.push([f, ms]); return 1; }, addEventListener: () => {} };
  const answers: { status: number; body: unknown; ra?: string }[] = [];
  const fake = (async () => {
    const a = answers.shift()!;
    return { ok: a.status < 300, status: a.status, headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? a.ra ?? null : null) }, json: async () => a.body } as unknown as Response;
  }) as typeof fetch;
  const c = new SpotifyClient('0123456789abcdef0123456789abcdef', fake) as unknown as { tokenRequest(p: Record<string, string>, old?: string): Promise<boolean>; status: string; message: string; store: TokenStore; persist: boolean };
  c.persist = false;
  (c.store as unknown as { session: Mem; local: Mem }).session = new Mem();
  (c.store as unknown as { session: Mem; local: Mem }).local = new Mem();
  c.store.save('KEEP', false);
  answers.push({ status: 503, body: { error: 'server_error' } });
  ok(!(await c.tokenRequest({ grant_type: 'refresh_token', refresh_token: 'KEEP', client_id: 'x' }, 'KEEP')), '503 refresh fails');
  eq(c.store.load(), { refresh: 'KEEP', persist: false }, '503 keeps the stored refresh token');
  answers.push({ status: 429, body: null, ra: '3' });
  await c.tokenRequest({ grant_type: 'refresh_token', refresh_token: 'KEEP', client_id: 'x' }, 'KEEP');
  eq(c.store.load(), { refresh: 'KEEP', persist: false }, '429 keeps the stored refresh token');
  ok(timers.length === 2 && (timers[1] as [unknown, number])[1] === 3000, 'retry scheduled after Retry-After');
  answers.push({ status: 400, body: { error: 'invalid_grant' } });
  await c.tokenRequest({ grant_type: 'refresh_token', refresh_token: 'KEEP', client_id: 'x' }, 'KEEP');
  ok(c.store.load() === null && c.status === 'off', 'invalid_grant ends the session');
  if (!hadWin) delete g.window;
}

// ---------- tempo ----------
{
  eq([normalizeBpm(91.038), normalizeBpm(45), normalizeBpm(240), normalizeBpm(174), normalizeBpm(360), normalizeBpm(0), normalizeBpm(NaN), normalizeBpm('120')], [91, 90, 120, 174, 180, null, null, null], 'normalise into 70..180');
  eq([normalizeBpm(69.9), normalizeBpm(180.2)], [139.8, 90.1], 'edges fold');
  eq([cleanManual(39), cleanManual(40), cleanManual(220), cleanManual(221)], [null, 40, 220, null], 'manual range');
  eq(cleanVideoTitle('Kavinsky - Nightcall (Official Video) [HD]', 'KavinskyVEVO'), { artist: 'Kavinsky', title: 'Nightcall' }, 'title with artist');
  eq(cleanVideoTitle('Nightcall', 'Kavinsky - Topic'), { artist: 'Kavinsky', title: 'Nightcall' }, 'topic channel');
  eq(cleanVideoTitle('Carpenter Brut – Turbo Killer | Official Music Video', 'Carpenter Brut'), { artist: 'Carpenter Brut', title: 'Turbo Killer' }, 'en dash and bar');
  eq(cleanVideoTitle('Muse - Pressure ft. Someone (Lyrics)', 'x'), { artist: 'Muse', title: 'Pressure' }, 'feat removed');

  let clock = 1_000_000;
  const store = new Mem();
  const book = new TempoBook(store, () => clock);
  for (let i = 0; i < CACHE_MAX + 50; i++) book.put('sp:' + String(i).padStart(22, 'a'), { bpm: 100, source: 'x', conf: 0.5 });
  eq(book.cacheSize(), CACHE_MAX, 'cache is bounded');
  ok(book.get('sp:' + '0'.padStart(22, 'a')) === undefined, 'oldest dropped first');
  book.put('yt:dQw4w9WgXcQ', null);
  ok(book.get('yt:dQw4w9WgXcQ') === null, 'negative cache');
  clock += 4 * 86400000;
  ok(book.get('yt:dQw4w9WgXcQ') === undefined, 'misses expire');
  book.put('bad key', { bpm: 100, source: 'x', conf: 1 });
  ok(book.get('bad key') === undefined, 'bad keys refused');
  book.ownSet('sp:0U0ldCRmgCqhVvD6ksG63j', 91, 120);
  const reread = new TempoBook(store, () => clock);
  eq(reread.ownGet('sp:0U0ldCRmgCqhVvD6ksG63j'), { b: 91, o: 120 }, 'own value persisted with its offset');
  ok(reread.cacheSize() === CACHE_MAX, 'cache persisted');
  store.setItem('beatspire-tempo', '[["sp:0U0ldCRmgCqhVvD6ksG63j",{"b":"x"}],5,"q"]');
  ok(new TempoBook(store).cacheSize() === 0, 'broken cache rows ignored');

  // provider chain with mocked fetch
  const calls: string[] = [];
  const rbData: Record<string, number> = { '0U0ldCRmgCqhVvD6ksG63j': 91.038, '5W3cjX2J3tjhG8zb6u0qHn': 246.9 };
  const fetchMock: Fetch = async (url) => {
    calls.push(url);
    const res = (status: number, body: unknown, h: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k: string) => h[k.toLowerCase()] ?? null }, json: async () => body });
    if (url.startsWith('https://api.reccobeats.com/v1/audio-features?ids=')) {
      const ids = url.split('=')[1].split(',');
      if (ids.length > 40) return res(400, {});
      if (ids.includes('RATELIMITEDxxxxxxxxxxx')) return res(429, {}, { 'retry-after': '30' });
      return res(200, { content: ids.filter((i) => rbData[i]).map((i) => ({ href: 'https://open.spotify.com/track/' + i, tempo: rbData[i] })) });
    }
    if (url.startsWith('https://api.getsong.co/search/?')) return res(200, { search: [{ title: 'x', tempo: '128' }] });
    return res(404, {});
  };
  let online = false;
  const order: string[] = [];
  const book2 = new TempoBook(new Mem(), () => clock);
  const r = new TempoResolver({
    book: book2, fetch: async (u, i) => { order.push(u.includes('reccobeats') ? 'rb' : u.includes('getsong') ? 'gsb' : '?'); return fetchMock(u, i); },
    online: () => online,
    spotifyFeatures: async () => { order.push('spotify'); throw new Error('forbidden'); },
    spotifySearch: async (a, t) => { order.push('search'); return t === 'Nightcall' ? '0U0ldCRmgCqhVvD6ksG63j' : null; },
    getSongBpmKey: 'abcdefgh12',
    now: () => clock,
  });
  const nc = { key: 'sp:0U0ldCRmgCqhVvD6ksG63j', spotifyId: '0U0ldCRmgCqhVvD6ksG63j' };
  ok((await r.resolve(nc)) === null, 'offline: no third-party lookups');
  eq(order, ['spotify'], 'offline: only Spotify itself was asked');
  ok(book2.get(nc.key) === undefined, 'offline misses are not remembered');
  online = true; order.length = 0;
  eq(await r.resolve(nc), { bpm: 91, source: 'ReccoBeats', conf: 0.8 }, 'ReccoBeats by id');
  eq(order, ['rb'], 'Spotify audio features not asked again after a 403');
  order.length = 0;
  eq(await r.resolve(nc), { bpm: 91, source: 'ReccoBeats', conf: 0.8 }, 'cached');
  eq(order, [], 'cache hit asks nobody');
  book2.ownSet(nc.key, 182, 0);
  eq(r.known(nc.key)!.bpm, 182, 'own value wins over the cache');
  const many = Array.from({ length: 85 }, (_, i) => ({ key: 'sp:' + String(i).padStart(22, 'b'), spotifyId: String(i).padStart(22, 'b') }));
  calls.length = 0;
  await r.resolveMany(many);
  ok(calls.filter((c) => c.includes('reccobeats')).length === 3, 'batches of 40: ' + calls.length);
  eq((await r.resolve({ key: 'sp:5W3cjX2J3tjhG8zb6u0qHn', spotifyId: '5W3cjX2J3tjhG8zb6u0qHn' }))!.bpm, 123.5, 'double time folded');
  order.length = 0;
  eq(await r.resolve({ key: 'yt:dQw4w9WgXcQ', artist: 'Kavinsky', title: 'Nightcall' }), { bpm: 91, source: 'ReccoBeats', conf: 0.6 }, 'YouTube title via Spotify search, then ReccoBeats');
  eq(order, ['search', 'rb'], 'YouTube chain order');
  order.length = 0;
  eq(await r.resolve({ key: 'yt:aaaaaaaaaaa', artist: 'Nobody', title: 'Unknown' }), { bpm: 128, source: 'GetSongBPM', conf: 0.5 }, 'GetSongBPM last');
  eq(order, ['search', 'gsb'], 'chain falls through to GetSongBPM');
  // 429: provider pauses, misses are not remembered
  const rl = { key: 'sp:RATELIMITEDxxxxxxxxxxx', spotifyId: 'RATELIMITEDxxxxxxxxxxx' };
  const r2 = new TempoResolver({ book: new TempoBook(new Mem(), () => clock), fetch: fetchMock, online: () => true, now: () => clock });
  ok((await r2.resolve(rl)) === null, '429 gives nothing');
  calls.length = 0;
  ok((await r2.resolve(rl)) === null && calls.length === 0, 'during Retry-After nothing is asked');
  clock += 31000;
  await r2.resolve(rl);
  ok(calls.length === 1, 'after Retry-After it asks again');
  // two callers for the same track share one request
  calls.length = 0;
  const r3 = new TempoResolver({ book: new TempoBook(new Mem(), () => clock), fetch: fetchMock, online: () => true, now: () => clock });
  await Promise.all([r3.resolve(nc), r3.resolve(nc)]);
  ok(calls.length === 1, 'shared in-flight request');
  ok(r3.known('sp:' + 'z'.repeat(22)) === undefined, 'unknown');
  await r3.resolve({ key: 'sp:' + 'z'.repeat(22), spotifyId: 'z'.repeat(22) });
  ok(r3.known('sp:' + 'z'.repeat(22)) === null, 'a miss is remembered');
}

// ---------- beat phase ----------
{
  eq(beatPhase(1500, 1000, 120), 0, 'on the beat');
  eq(beatPhase(1750, 1000, 120), 0.5, 'half a beat');
  eq(beatPhase(500, 1000, 120), 0, 'before the origin');
  eq(beatPhase(750, 1000, 120), 0.5, 'before the origin, half');
  ok(beatPhase(1000, 0, null) === null && beatPhase(1000, 0, 0) === null, 'no clock');
  eq(trackStart(30000, 100000), 70000, 'track start from position');
  // after a seek the start moves with it and a beat still lands on track position 0 + k * beat
  const st = trackStart(61000, 200000), bpm = 90;
  const ph7 = beatPhase(st + 60000 * 7 / bpm, st, bpm)!;
  ok(Math.min(ph7, 1 - ph7) < 1e-6, 'beats tied to the track position');
  eq(Math.round(tapOffset(st + 2 * 60000 / bpm + 120, st, bpm)), 120, 'tap offset');
  eq(Math.round(tapOffset(st - 100, st, bpm)), Math.round(60000 / bpm - 100), 'tap before the start');
  const h = new TempoHold(3000);
  eq(h.feed(120, 0), 120, 'hold takes the first');
  eq(h.feed(90, 1000), 120, 'hold keeps the old tempo for a moment');
  eq(h.feed(90.5, 2500), 120, 'still holding');
  eq(h.feed(90.4, 4200), 90.4, 'switches after 3 s');
}

// ---------- beat detector on synthetic click tracks ----------
{
  const rng = (seed: number) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; };
  const sr = 22050;
  function render(bpm: number, secs: number, noise: number, music: boolean, seed: number): { x: Float32Array; first: number } {
    const rnd = rng(seed), x = new Float32Array(sr * secs), spb = 60 / bpm, first = 0.137;
    for (let i = 0; i < x.length; i++) x[i] = rnd() * 2 * noise;
    const hit = (t: number, amp: number, decay: number, freq: number, nz: number) => {
      const p = Math.floor(t * sr);
      for (let k = 0; k < 2000 && p + k < x.length; k++) x[p + k] += amp * Math.exp(-k / decay) * (Math.sin(k * freq) * (1 - nz) + rnd() * 2 * nz);
    };
    for (let t = first, n = 0; t < secs; t += spb, n++) {
      hit(t, 0.8, 60, 0.6, 0.1); // the click (or a kick)
      if (music) { if (n % 2 === 1) hit(t, 0.5, 200, 0.3, 0.9); hit(t + spb / 2, 0.15, 40, 2.4, 0.95); } // snare on 2 and 4, off-beat hats
    }
    return { x, first };
  }
  const rows: string[] = [];
  for (const bpm of [90, 120, 174]) for (const [noise, music] of [[0.05, false], [0.3, false], [0.2, true]] as [number, boolean][]) {
    const { x, first } = render(bpm, 10, noise, music, bpm * 7 + (music ? 1 : 0));
    const env = onsetEnvelope(x, sr, 100, 512);
    const tr = new TempoTracker(100, 8);
    for (const v of env) tr.push(v);
    const e = tr.estimate()!;
    const spb = 60 / bpm, beatAt = (env.length - 1) / 100 - e.lastBeat / 100 + 512 / sr / 2;
    let ph = ((beatAt - first) / spb) % 1; if (ph > 0.5) ph -= 1; if (ph < -0.5) ph += 1;
    rows.push(`${bpm} BPM ${music ? 'drums' : 'clicks'} noise ${noise}: heard ${e.bpm} BPM, ${Math.round(e.conf * 100)}% sure, phase off by ${(ph * spb * 1000).toFixed(0)} ms`);
    ok(e && Math.abs(e.bpm - bpm) / bpm < 0.02, `detector ${bpm} BPM (${music ? 'drums' : 'clicks'}, noise ${noise}) got ${e && e.bpm}`);
    ok(Math.abs(ph) < 0.1, `detector phase ${bpm} BPM within a tenth of a beat (off ${ph.toFixed(3)})`);
  }
  // loud off-beat hats: half or double time may win, which the x2 / /2 buttons fix; the beat must still land
  {
    const { x } = render(96, 10, 0.1, false, 3);
    const hats = render(192, 10, 0, false, 4).x; // a click on every eighth
    for (let i = 0; i < x.length; i++) x[i] += 0.45 * hats[Math.max(0, i - Math.round(sr * 60 / 192))];
    const tr = new TempoTracker(100, 8);
    for (const v of onsetEnvelope(x, sr, 100, 512)) tr.push(v);
    const e = tr.estimate()!;
    rows.push(`96 BPM with loud eighth hats: heard ${e.bpm} BPM (octave errors allowed here)`);
    ok([96, 192].some((b) => Math.abs(e.bpm - b) / b < 0.02), 'loud hats: right tempo or its double, got ' + e.bpm);
  }
  // silence and pure noise: no tempo, or one it is not sure about
  const quiet = new TempoTracker(100, 8);
  for (let i = 0; i < 800; i++) quiet.push(0);
  ok(quiet.estimate() === null, 'silence gives no tempo');
  const noisy = new TempoTracker(100, 8), rnd = rng(5);
  for (const v of onsetEnvelope(Float32Array.from({ length: sr * 9 }, () => rnd()), sr, 100, 512)) noisy.push(v);
  const ne = noisy.estimate();
  ok(!ne || ne.conf < 0.3, 'noise: low confidence (' + (ne ? ne.conf : 'none') + ')');
  ok(new TempoTracker(100, 8).estimate() === null, 'too short');
  const sp = logSpectrum(new Float32Array(1024).map((_, i) => Math.sin((2 * Math.PI * 64 * i) / 1024)));
  ok(sp.indexOf(Math.max(...sp)) === 64, 'FFT bin of a pure tone');
  eq(spectralFlux(null, sp), 0, 'flux needs a previous frame');
  console.log(rows.join('\n'));
}

console.log(`music-test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
