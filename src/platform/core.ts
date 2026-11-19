// The platform interface and the in-memory adapter (see index.ts). Kept apart so web.ts and index.ts can both import it.

export type PlatformId = 'web' | 'android' | 'steam' | 'memory';

/** Key/value text storage. Values are strings (JSON); an adapter may refuse a value that is too big (StorageFullError). */
export interface PlatformStorage {
  get(key: string): Promise<string | null>;
  /** Rejects with StorageFullError when the value cannot be stored even after the adapter freed what it may (old archive entries). */
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every key that starts with `prefix`, in plain string order. */
  keys(prefix: string): Promise<string[]>;
}

/**
 * The platform's own achievement service (Steam, Google Play Games), a mirror of the game's own record: the game decides
 * what is unlocked (src/game/achievements.ts) and keeps that in storage; this only tells the platform. Ids are the game's
 * stable snake_case ids; an adapter maps them with ids.ts where its service wants other names.
 */
export interface PlatformAchievements {
  unlock(id: string): Promise<void>;
  /** Progress toward a counted achievement (Steam: IndicateAchievementProgress / a stat; Play: incremental achievements). */
  progress?(id: string, cur: number, max: number): Promise<void>;
  /** What the platform has unlocked already (to unlock there what was earned offline, or on another device). */
  list?(): Promise<string[]>;
}

export interface PlatformCaps {
  /** saves follow the player to other devices (Steam Cloud, Play Games saved games) */
  cloudSave: boolean;
  /** the platform shows achievements itself (overlay, Play Games UI); the web shows only the game's own screen */
  nativeAchievements: boolean;
  /** the platform draws its own pop-up on an unlock: the game may skip its own toast */
  overlay: boolean;
  /** the app can quit itself (a desktop or mobile app; not a browser tab) */
  quit: boolean;
}

export interface Platform {
  id: PlatformId;
  storage: PlatformStorage;
  achievements: PlatformAchievements;
  overlay?: { notify?(text: string): void };
  caps: PlatformCaps;
}

/** A value that does not fit: over the adapter's size limit, or the storage is full even after it dropped old archive entries. */
export class StorageFullError extends Error {
  constructor(msg: string) { super(msg); this.name = 'StorageFullError'; }
}

/** Storage in memory (Node tests, and the fallback when the browser blocks storage). `limit`: total characters it holds, for quota tests. */
export class MemoryStorage implements PlatformStorage {
  readonly data = new Map<string, string>();
  limit: number;
  constructor(limit = Infinity) { this.limit = limit; }
  async get(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  async set(key: string, value: string) {
    const used = [...this.data].reduce((n, [k, v]) => n + (k === key ? 0 : k.length + v.length), 0);
    if (used + key.length + value.length > this.limit) throw new StorageFullError('memory storage full');
    this.data.set(key, value);
  }
  async remove(key: string) { this.data.delete(key); }
  async keys(prefix: string) { return [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort(); }
}

/** A platform with no outside world: storage in memory, achievements only recorded (`unlocked`). */
export function memoryPlatform(storage: PlatformStorage = new MemoryStorage()): Platform & { unlocked: string[] } {
  const unlocked: string[] = [];
  return {
    id: 'memory', storage, unlocked,
    achievements: { async unlock(id) { if (!unlocked.includes(id)) unlocked.push(id); }, async list() { return [...unlocked]; } },
    caps: { cloudSave: false, nativeAchievements: false, overlay: false, quit: false },
  };
}

