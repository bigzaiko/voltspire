# Platform adapters

The game keeps its saves, run archive, totals and achievements through `Platform` (`core.ts`, re-exported by `index.ts`).
The web build uses `web.ts`. Another platform needs one file that builds a `Platform` and one call before the game starts:

```ts
import { setPlatform } from './platform/index.ts';
setPlatform(await androidPlatform()); // or steamPlatform()
```

An adapter must:

- **storage**: `get / set / remove / keys(prefix)`, all async, values are JSON text. `keys` returns plain string order (the
  archive keys `run:<16-digit ms>-<id>` then sort oldest first). On a full disk or quota, drop the oldest `run:` keys
  first and try again (as `web.ts` does); never drop `save:`, `ach:state` or `records:*`. Reject with `StorageFullError`
  if it still does not fit.
- **achievements**: `unlock(id)` (and optionally `progress(id, cur, max)` and `list()`). The game's own record in storage
  is the truth; the adapter only mirrors it. Ids are the game's stable ids (`src/game/achievements.ts`); map them to the
  service's names with `ids.ts` (`platformAchId`). On load the game unlocks on the platform whatever it has and the
  platform does not (offline unlocks), and takes over what the platform has (another device).
- **caps**: `cloudSave`, `nativeAchievements`, `overlay` (the platform draws its own unlock pop-up, so the game may skip
  its toast), `quit`.

## Android (Capacitor)

- Storage: `@capacitor/preferences` (`Preferences.get / set / remove / keys`), namespaced like the web (`beatspire:`).
  Preferences keeps everything in SharedPreferences; for big saves, `@capacitor/filesystem` with one file per key works
  the same way.
- Achievements: a Google Play Games Services plugin (e.g. a Capacitor community plugin for Play Games). `unlock(id)` ->
  `unlockAchievement(PLAY_IDS[id])`; counted ones as incremental achievements (`progress`). Fill `PLAY_IDS` in `ids.ts`
  with the ids the Play Console generates.
- Cloud: Play Games saved games (snapshots) can carry the `save:*` keys if wanted; set `caps.cloudSave`.

## Steam (Electron or Tauri + Steamworks)

- Storage: Steam Cloud remote storage (`ISteamRemoteStorage::FileWrite / FileRead / FileDelete`, one file per key; list
  with `GetFileCount / GetFileNameAndSize`). In Electron, `steamworks.js` exposes these; in Tauri, a Rust command over
  `steamworks-rs`. Enable Steam Cloud for the app id and set a byte quota in the partner site.
- Achievements: `SetAchievement(STEAM_IDS[id] ?? id)` then `StoreStats()`; progress with `IndicateAchievementProgress`
  (or a stat bound to the achievement). Create the achievements in the partner site with the game's ids as API names.
- `caps`: `{ cloudSave: true, nativeAchievements: true, overlay: true, quit: true }`.
