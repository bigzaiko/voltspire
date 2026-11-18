// Spotify sign-in for a static site: Authorization Code with PKCE, no client secret.
// Everything in this file is plain logic without the DOM, so tools/music-test.ts can run it in Node.
// Tokens never go into a URL and are never logged.

export const SP_ACCOUNTS = 'https://accounts.spotify.com';
export const SP_API = 'https://api.spotify.com/v1';
/** What the game asks for. `streaming` plays full tracks in the browser (Premium only). */
export const SP_SCOPES = [
  'streaming', 'user-read-email', 'user-read-private',
  'user-read-playback-state', 'user-modify-playback-state',
  'playlist-read-private', 'playlist-read-collaborative', 'user-library-read',
];
const CLIENT_ID = /^[0-9a-f]{32}$/;
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CODE_RE = /^[A-Za-z0-9_.~-]{10,2048}$/;

export function isClientId(v: unknown): v is string { return typeof v === 'string' && CLIENT_ID.test(v); }

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A PKCE code verifier: 64 characters from the unreserved set (RFC 7636 allows 43 to 128). */
export function randomVerifier(len = 64): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const out: string[] = [];
  // Rejection sampling keeps every character equally likely (256 is not a multiple of 66).
  while (out.length < len) {
    const buf = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of buf) { if (b < 198 && out.length < len) out.push(abc[b % 66]); }
  }
  return out.join('');
}
export function randomState(): string { return base64url(crypto.getRandomValues(new Uint8Array(24))); }

/** S256 challenge for a verifier: base64url(sha256(ascii(verifier))). */
export async function challengeFor(verifier: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(d));
}

/**
 * The redirect URI is the page itself, without query or hash. It must be registered in the
 * Spotify dashboard character for character, so it is built the same way every time.
 */
export function redirectUriFor(loc: { origin: string; pathname: string }): string {
  // GitHub Pages also serves play.html as /play: both must send the one registered address
  const path = /\/play$/.test(loc.pathname) ? loc.pathname + '.html' : loc.pathname;
  return loc.origin + path;
}

export function authorizeUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string; scopes?: string[] }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    response_type: 'code',
    redirect_uri: o.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: o.challenge,
    state: o.state,
    scope: (o.scopes || SP_SCOPES).join(' '),
  });
  return SP_ACCOUNTS + '/authorize?' + q.toString();
}

export type Redirect =
  | { kind: 'none' }
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string }
  | { kind: 'bad-state' };

/**
 * Read the query string Spotify sends the player back with. Only a page that started a sign-in
 * (and so has a stored state) accepts a code, and only when the state matches exactly.
 */
export function parseRedirect(search: string, expectedState: string | null): Redirect {
  const q = new URLSearchParams(search);
  const code = q.get('code'), err = q.get('error'), state = q.get('state');
  if (code === null && err === null) return { kind: 'none' };
  if (!expectedState || !STATE_RE.test(expectedState) || state !== expectedState) return { kind: 'bad-state' };
  if (err !== null) return { kind: 'error', error: /^[a-z_]{1,40}$/.test(err) ? err : 'unknown_error' };
  if (!code || !CODE_RE.test(code)) return { kind: 'error', error: 'bad_code' };
  return { kind: 'code', code };
}

/** The address without the sign-in parameters, for history.replaceState. Other parameters stay. */
export function stripAuthParams(href: string): string {
  const u = new URL(href);
  for (const k of ['code', 'state', 'error', 'error_description']) u.searchParams.delete(k);
  return u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash;
}

export function tokenBody(p: Record<string, string>): string { return new URLSearchParams(p).toString(); }

export interface Tokens { access: string; refresh: string; expiresAt: number; scope: string }

/** Turn a token response into Tokens. A refresh may omit the refresh token: then the old one stays. */
export function readTokenResponse(data: unknown, now: number, oldRefresh = ''): Tokens | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const access = d.access_token, exp = d.expires_in, refresh = d.refresh_token;
  if (typeof access !== 'string' || !access || access.length > 4096) return null;
  const secs = typeof exp === 'number' && isFinite(exp) && exp > 0 ? Math.min(exp, 86400) : 3600;
  const r = typeof refresh === 'string' && refresh && refresh.length <= 4096 ? refresh : oldRefresh;
  return { access, refresh: r, expiresAt: now + secs * 1000, scope: typeof d.scope === 'string' ? d.scope : '' };
}

/** How long to wait before refreshing: 60 s before expiry (a tenth of the lifetime for short ones), never below 5 s. */
export function refreshDelay(expiresAt: number, now: number, lifetimeMs = 3600000): number {
  const lead = Math.min(60000, lifetimeMs / 10);
  return Math.max(5000, expiresAt - now - lead);
}
/** True when a request should refresh first: the token is gone or ends within 30 s. */
export function needsRefresh(t: Tokens | null, now: number): boolean { return !t || t.expiresAt - now < 30000; }

/** Retry-After in ms (seconds or an HTTP date), clamped to 1 s .. 10 min. */
export function retryAfterMs(h: string | null, now: number): number {
  if (!h) return 5000;
  const n = Number(h);
  let ms = isFinite(n) ? n * 1000 : Date.parse(h) - now;
  if (!isFinite(ms)) ms = 5000;
  return Math.max(1000, Math.min(600000, ms));
}

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const TOK = 'beatspire-sp-auth';

/**
 * Where tokens live. With "stay connected" only the refresh token goes to localStorage; otherwise
 * it stays in sessionStorage and ends with the tab. The access token is only ever kept in memory.
 */
export class TokenStore {
  private local: Store | null;
  private session: Store | null;
  constructor(local: Store | null, session: Store | null) { this.local = local; this.session = session; }
  load(): { refresh: string; persist: boolean } | null {
    for (const [s, persist] of [[this.session, false], [this.local, true]] as const) {
      let t: string | null = null;
      try { t = s ? s.getItem(TOK) : null; } catch { t = null; }
      if (!t) continue;
      try {
        const d = JSON.parse(t) as Record<string, unknown>;
        if (typeof d.r === 'string' && d.r.length > 0 && d.r.length <= 4096) return { refresh: d.r, persist };
      } catch { /* broken entry */ }
    }
    return null;
  }
  save(refresh: string, persist: boolean): void {
    // only the other store is cleared: removing the entry first would tell other tabs (storage event) the session ended
    const s = persist ? this.local : this.session, other = persist ? this.session : this.local;
    try { other?.removeItem(TOK); } catch { /* blocked */ }
    if (!refresh) { try { s?.removeItem(TOK); } catch { /* blocked */ } return; }
    try { s?.setItem(TOK, JSON.stringify({ r: refresh })); } catch { /* blocked */ }
  }
  clear(): void {
    for (const s of [this.local, this.session]) { try { s?.removeItem(TOK); } catch { /* blocked */ } }
  }
}

/** The sign-in round trip: state and verifier wait in sessionStorage while the player is at Spotify. */
const PEND = 'beatspire-sp-pkce';
export function savePending(s: Store | null, p: { state: string; verifier: string; persist: boolean; clientId: string }): void {
  try { s?.setItem(PEND, JSON.stringify(p)); } catch { /* blocked */ }
}
export function takePending(s: Store | null): { state: string; verifier: string; persist: boolean; clientId: string } | null {
  let t: string | null = null;
  try { t = s ? s.getItem(PEND) : null; s?.removeItem(PEND); } catch { return null; }
  if (!t) return null;
  try {
    const d = JSON.parse(t) as Record<string, unknown>;
    if (typeof d.state === 'string' && typeof d.verifier === 'string' && isClientId(d.clientId))
      return { state: d.state, verifier: d.verifier, persist: d.persist === true, clientId: d.clientId };
  } catch { /* broken */ }
  return null;
}
