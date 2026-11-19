// The web adapter: storage in the browser's localStorage under the 'beatspire:' namespace, no platform achievement service
// (the game's own record is the only one; the achievements screen shows it). Every access is wrapped: a private window,
// blocked site data or a full quota never throws into the game.
//
// Quota: a value over MAX_VALUE characters is refused (StorageFullError). When the browser says the storage is full, the
// oldest run archive entries ('run:' keys, which sort oldest first) are dropped one by one, then the write is tried again;
// saves, achievements and totals are never dropped to make room. If it still does not fit, set() rejects with StorageFullError.
import { StorageFullError } from './core.ts';
import type { Platform, PlatformStorage } from './core.ts';

/** The namespace before every key this adapter writes (the older keys of the game, like 'beatspire', have no colon). */
export const NS = 'beatspire:';
/** The longest value it stores, in characters (a mid-run save of a full board is well under this). */
export const MAX_VALUE = 1_000_000;
/** The archive entries it may drop when the storage is full, oldest (lowest key) first. */
export const EVICT_PREFIX = 'run:';

const isQuota = (e: unknown) => {
  const x = e as { name?: string; code?: number } | null;
  return !!x && (x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED' || x.code === 22 || x.code === 1014);
};

export class WebStorage implements PlatformStorage {
  private ls: Storage; private ns: string;
  constructor(ls: Storage, ns = NS) { this.ls = ls; this.ns = ns; }
  async get(key: string): Promise<string | null> {
    try { return this.ls.getItem(this.ns + key); } catch { return null; }
  }
  async set(key: string, value: string): Promise<void> {
    if (value.length > MAX_VALUE) throw new StorageFullError(`value for ${key.slice(0, 40)} is ${value.length} characters (most ${MAX_VALUE})`);
    for (let tries = 0; ; tries++) {
      try { this.ls.setItem(this.ns + key, value); return; } catch (e) {
        if (!isQuota(e)) throw new StorageFullError('storage unavailable: ' + (e instanceof Error ? e.message : String(e)).slice(0, 80));
        // drop the oldest archive entry (never the key being written) and try again
        const old = (await this.keys(EVICT_PREFIX)).find((k) => k !== key);
        if (!old || tries > 500) throw new StorageFullError('storage full');
        await this.remove(old);
      }
    }
  }
  async remove(key: string): Promise<void> {
    try { this.ls.removeItem(this.ns + key); } catch { /* storage unavailable */ }
  }
  async keys(prefix: string): Promise<string[]> {
    const out: string[] = [], p = this.ns + prefix;
    try {
      for (let i = 0; i < this.ls.length; i++) { const k = this.ls.key(i); if (k !== null && k.startsWith(p)) out.push(k.slice(this.ns.length)); }
    } catch { return []; }
    return out.sort();
  }
}

/** The web platform, or null when this page cannot use localStorage at all (then getPlatform() falls back to memory). */
export function webPlatform(): Platform | null {
  let ls: Storage | null = null;
  try {
    ls = (globalThis as { localStorage?: Storage }).localStorage ?? null;
    if (ls) void ls.getItem(NS + '__probe'); // (throws where site data is blocked; a full quota is handled in set())
  } catch { ls = null; }
  if (!ls) return null;
  return {
    id: 'web',
    storage: new WebStorage(ls),
    // (nothing to mirror to on the web: the game's own record in storage is the whole truth)
    achievements: { async unlock() { /* none */ }, async progress() { /* none */ }, async list() { return []; } },
    caps: { cloudSave: false, nativeAchievements: false, overlay: false, quit: false },
  };
}
