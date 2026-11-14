// Touch controls (stub, replaced by the full implementation).
export interface TouchApi {
  canvas: HTMLCanvasElement;
  isHero(): boolean;
  /** hero look, in pixels of finger travel */
  look(dx: number, dy: number): void;
  fire(on: boolean): void;
  skill(i: number): void;
  teleport(): void;
  ult(): void;
  exitHero(): void;
  /** bird view: a tap at client coordinates (build / select) */
  tap(clientX: number, clientY: number): void;
  /** bird view: finger moved over the board without lifting (hover / ghost preview) */
  hoverAt(clientX: number, clientY: number): void;
  pan(dx: number, dy: number): void;
  zoom(factor: number): void;
}
export function initTouch(_api: TouchApi): void { /* stub */ }
