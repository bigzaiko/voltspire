// What a Linux desktop does to the mouse before a browser sees it, and how to take it back out.
//
// A browser on Linux cannot hand a page the raw mouse (Chrome refuses unadjustedMovement there, Firefox never
// offered it), so a captured mouse arrives with the desktop's pointer curve already applied. That curve is
// libinput's default "adaptive" profile. It was made for a cursor: below 0.07 units/ms it slows the pointer down,
// to as little as 30 %, and above 0.4 units/ms it speeds it up, to as much as 200 %. For a crosshair this is the
// wrong way round: the small, careful movements are the ones that get eaten.
//
// The numbers below are the profile's own, and they match what a test mouse measured in Chrome on KDE Wayland:
// 10 counts/s arrive as 40 %, 40 counts/s as 70 %, 300 counts/s as 100 %, 800 counts/s as 144 %.

/** How the game treats that curve: leave it, undo the slow-down only, or undo all of it. */
export type MouseCurve = 'system' | 'even' | 'linear';

const SLOW = 0.07;      // units/ms: below this the profile slows the pointer down
const FAST = 0.4;       // units/ms: above this it speeds the pointer up
const INCLINE = 1.1, TOP = 2;

/** The profile itself: the factor it puts on a mouse moving at v units/ms. */
export function curve(v: number): number {
  if (v < SLOW) return 10 * v + 0.3;
  if (v < FAST) return 1;
  return Math.min(TOP, INCLINE * (v - FAST) + 1);
}

/** The mouse speed (units/ms) that the profile turns into a pointer speed of s px/ms. */
export function uncurve(s: number, mode: MouseCurve): number {
  if (mode === 'system' || s <= 0) return s;
  // below the slow-down limit: s = v * (10 v + 0.3)
  if (s < SLOW) return (-0.3 + Math.sqrt(0.09 + 40 * s)) / 20;
  if (mode === 'even' || s < FAST) return s;
  // in the speed-up: s = v * (1.1 (v - 0.4) + 1), until the factor reaches its top
  const vTop = FAST + (TOP - 1) / INCLINE;
  if (s < vTop * TOP) return (-(1 - INCLINE * FAST) + Math.sqrt((1 - INCLINE * FAST) ** 2 + 4 * INCLINE * s)) / (2 * INCLINE);
  return s / TOP;
}

const WINDOW = 64;  // ms of recent movement the speed is read from
const REST = 250;   // ms: a longer gap counts as starting from rest
const FRAME = 16;   // ms: a browser hands out mouse samples once per frame, so one sample spans at most about this

/**
 * Reads the pointer speed from the stream of mouse samples and answers with the factor that takes the curve back
 * out of each one. A browser only reports whole pixels, so a slow hand shows up as single steps far apart: there the
 * speed is one step over the time since the step before.
 */
export class CurveUndo {
  private ts: number[] = [];
  private ds: number[] = [];
  private last = -1e9;
  /** the pointer speed (px/ms) and the factor of the latest sample, for the diagnostics overlay */
  speed = 0;
  factor = 1;

  /** Factor for a sample of (dx, dy) pixels that arrived at time t (ms). */
  gain(dx: number, dy: number, t: number, mode: MouseCurve): number {
    const d = Math.hypot(dx, dy);
    if (!d || mode === 'system') return 1;
    while (this.ts.length && t - this.ts[0] > WINDOW) { this.ts.shift(); this.ds.shift(); }
    let s: number;
    if (this.ts.length) {
      // the oldest sample only marks where the stretch began: its own distance was covered before it
      let sum = d;
      for (let i = 1; i < this.ds.length; i++) sum += this.ds[i];
      s = sum / Math.max(4, t - this.ts[0]);
    } else s = d / Math.min(REST, Math.max(4, t - this.last));
    // a sample of several pixels covered all but the first of them within one frame, however long the gap before it
    s = Math.max(s, (d - 1) / FRAME);
    this.ts.push(t); this.ds.push(d);
    this.last = t;
    this.speed = s;
    this.factor = uncurve(s, mode) / s;
    return this.factor;
  }

  reset() { this.ts.length = 0; this.ds.length = 0; this.last = -1e9; this.speed = 0; this.factor = 1; }
}
