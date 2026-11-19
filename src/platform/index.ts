// BEATSPIRE platform layer: where the game keeps its data and where its achievements go, behind one small interface so the
// same game runs in the browser (web.ts), and later as an Android app or on Steam with an adapter of its own (README.md in
// this folder says how). Everything here is DOM-free: Node tests use memoryPlatform().
//
// What goes through it: the NEW data (mid-run saves, the run archive and per-map bests, lifetime totals, achievements; see
// src/game/saves.ts, records.ts, achievements.ts, career.ts). The older settings, tips, map records, music list and editor
// drafts still sit in localStorage under their own keys ('beatspire', 'beatspire-music', ...) and are left as they are.
//
// Storage is async on purpose: Steam Cloud (a file per key), Capacitor Preferences and IndexedDB all are. Keys are plain
// strings like 'save:switchback|normal|campaign', 'run:0001763561234567-k3x9', 'ach:state'; an adapter adds its own
// namespace (web: 'beatspire:') and must keep keys(prefix) sorted the same way on every platform (plain string order).

export * from './core.ts';
export { webPlatform, WebStorage, NS } from './web.ts';
import { memoryPlatform } from './core.ts';
import type { Platform } from './core.ts';
import { webPlatform } from './web.ts';

let current: Platform | null = null;
/** Use this platform from now on (an Android or Steam build calls this first thing with its adapter; tests with memoryPlatform()). */
export function setPlatform(p: Platform): void { current = p; }
/**
 * The platform the game runs on: the one set with setPlatform, else the web adapter when the page can reach localStorage,
 * else memory (nothing survives a reload, but nothing breaks).
 */
export function getPlatform(): Platform {
  if (!current) current = webPlatform() || memoryPlatform();
  return current;
}
