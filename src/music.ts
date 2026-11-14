// Player's own music: playlist of YouTube / Spotify links (stub, replaced by the full implementation).
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
}
export function initMusic(_host: MusicHost): MusicApi {
  return { open() {}, isExternalPlaying: () => false, bpm: () => null };
}
