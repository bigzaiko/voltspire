// Touch controls. Tap, drag with one finger to pan, hold then drag to move the build ghost (a belt or a line of arms laid
// that way follows the finger). A long press (about 450 ms without moving) or a double tap on a tower fires its special
// (a single tap on a tower waits a moment for the second one, so a double tap leaves the tower unselected). Two fingers
// either pinch (zoom) or twist (turn): whichever passes its threshold first, and it stays that
// until a finger lifts. A round button turns the belt that is about to be placed.
// Mouse and keyboard handlers in play.ts stay active; everything here only reacts to touch pointers,
// except the on-screen buttons, which also take a mouse press or a keyboard activation.
// The styles (touch.css) are linked from play.html.

export interface TouchApi {
  canvas: HTMLCanvasElement;
  /** turn the belt (or other building) that is about to be placed */
  turn(): void;
  /** the finger that moved the build ghost was lifted (a belt line ends there) */
  hoverEnd(): void;
  /** bird view: a tap at client coordinates (build / select) */
  tap(clientX: number, clientY: number): void;
  /** bird view: finger moved over the board without lifting (hover / ghost preview) */
  hoverAt(clientX: number, clientY: number): void;
  /** drag by (dx, dy) pixels; (x, y) is where the finger, or the middle of two fingers, is now */
  pan(dx: number, dy: number, x: number, y: number): void;
  /** factor above 1 zooms in; (x, y) is the point between the fingers, which stays where it is */
  zoom(factor: number, x?: number, y?: number): void;
  /** two fingers twisted by this many radians, clockwise on screen */
  rotate(angle: number): void;
  pause(): void;
  speed(): void;
  /**
   * A long press or a double tap at client coordinates: fire the special of the tower there. True when the press was taken
   * (a tower is there and nothing is chosen for building); false leaves it to be the tap or the ghost drag it would have been.
   */
  special?(clientX: number, clientY: number, double?: boolean): boolean;
  /**
   * True if a tap at client coordinates would land on a tower whose special a double tap fires. Such a tap is held back for
   * TAP_DEFER ms: a second tap in that time fires the special and the tower never gets selected. Without it every tap goes
   * through at once (and special(x, y, true) has to undo the first tap's selection).
   */
  onTower?(clientX: number, clientY: number): boolean;
}

const FREE = 0, BIRD = 1;
/** finger travel in px before a press counts as a drag */
const DEAD = 12;
/** press this long without moving and the drag moves the build ghost instead of the camera */
const HOLD_MS = 240;
/** press this long without moving on a tower and its special fires (the press then is no tap) */
const LONG_MS = 450;
/** two taps this close in time (ms) and place (px) are a double tap */
const DOUBLE_MS = 340, DOUBLE_PX = 30;
/** a single tap on a tower waits this long (ms) for a second one before it selects the tower (see TouchApi.onTower) */
const TAP_DEFER = 250;
// Two fingers: the spread has to change by this much (px, or this share of the spread) to become a pinch,
// or the line between the fingers has to turn by this much (radians, with the fingers at least APART px apart) to become a twist.
const PINCH_PX = 18, PINCH_PART = 0.07, TWIST = 0.14, APART = 70;

interface Slot { id: number; role: number; x: number; y: number; sx: number; sy: number; moved: boolean; pan: boolean; hover: boolean; fired: boolean; el: Element | null; t: number; v: number }
/** What two fingers on the board are doing: 0 undecided, 1 pinch, 2 twist. d and a are the spread and angle last used. */
interface Pair { mode: 0 | 1 | 2; d0: number; a0: number; d: number; a: number }
const turn = (a: number): number => (a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a);

export function initTouch(api: TouchApi): void {
  const canvas = api.canvas;
  const root = document.getElementById('touch');
  const byId = (id: string): HTMLElement | null => document.getElementById(id);

  const slots: Slot[] = [];
  for (let i = 0; i < 4; i++) slots.push({ id: -1, role: FREE, x: 0, y: 0, sx: 0, sy: 0, moved: false, pan: false, hover: false, fired: false, el: null, t: 0, v: 0 });
  let active = false;
  let pair: Pair | null = null;
  let holdTimer = 0, longTimer = 0;
  let holdSlot: Slot | null = null, longSlot: Slot | null = null;
  const lastTap = { t: -1e9, x: 0, y: 0 };
  /** a tap on a tower held back for TAP_DEFER ms (0: none) */
  let deferTimer = 0;
  const deferred = { x: 0, y: 0 };
  /** The held-back tap goes through now (its time is up, or another tap that is no double tap came). */
  function flushTap(): void {
    if (!deferTimer) return;
    clearTimeout(deferTimer); deferTimer = 0;
    api.tap(deferred.x, deferred.y);
  }
  function dropTap(): void { if (deferTimer) { clearTimeout(deferTimer); deferTimer = 0; } }

  function activate(): void {
    if (active) return;
    active = true;
    document.body.classList.add('touch');
    if (root) root.classList.remove('hidden');
  }

  function find(id: number): Slot | null {
    for (let i = 0; i < slots.length; i++) if (slots[i].role !== FREE && slots[i].id === id) return slots[i];
    return null;
  }
  function count(role: number): number {
    let n = 0;
    for (let i = 0; i < slots.length; i++) if (slots[i].role === role) n++;
    return n;
  }
  function other(s: Slot): Slot | null {
    for (let i = 0; i < slots.length; i++) if (slots[i] !== s && slots[i].role === BIRD) return slots[i];
    return null;
  }
  /** Direction of the line between two fingers. Always measured from the same finger, whichever of them just moved. */
  function lineOf(a: Slot, b: Slot): number {
    const first = slots.indexOf(a) < slots.indexOf(b) ? a : b, second = first === a ? b : a;
    return Math.atan2(second.y - first.y, second.x - first.x);
  }
  function take(e: PointerEvent, role: number, el: Element): Slot | null {
    let s = find(e.pointerId);
    if (!s) for (let i = 0; i < slots.length; i++) if (slots[i].role === FREE) { s = slots[i]; break; }
    if (!s) return null;
    s.id = e.pointerId; s.role = role; s.el = el;
    s.x = s.sx = e.clientX; s.y = s.sy = e.clientY;
    s.moved = false; s.pan = false; s.hover = false; s.fired = false; s.t = e.timeStamp; s.v = 0;
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    return s;
  }
  function clearHold(): void {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    holdSlot = null;
    if (longTimer) { clearTimeout(longTimer); longTimer = 0; }
    longSlot = null;
  }
  /** The finger is still down where it landed after LONG_MS: a long press. On a tower it fires the special and the press is used up. */
  function onLong(): void {
    longTimer = 0;
    const s = longSlot;
    longSlot = null;
    if (!s || s.role !== BIRD || s.moved || s.pan || count(BIRD) !== 1) return;
    if (Math.hypot(s.x - s.sx, s.y - s.sy) >= DEAD) return;
    if (api.special && api.special(s.sx, s.sy)) s.fired = true;
  }
  function onHold(): void {
    holdTimer = 0;
    const s = holdSlot;
    holdSlot = null;
    // (the long press keeps counting: the hold only hands the drag to the build ghost)
    if (!s || s.role !== BIRD || s.moved || count(BIRD) !== 1) return;
    s.hover = true;
    api.hoverAt(s.x, s.y);
  }
  function release(s: Slot): void {
    if (holdSlot === s || longSlot === s) clearHold();
    if (s.el) { try { s.el.releasePointerCapture(s.id); } catch { /* not captured any more */ } }
    const bird = s.role === BIRD;
    s.role = FREE; s.id = -1; s.el = null;
    if (bird) {
      // The gesture of two fingers ends when one lifts. The finger that stays has to leave the dead zone again
      // before it pans, so lifting two fingers one after the other never shoves the board.
      pair = null;
      for (let i = 0; i < slots.length; i++) if (slots[i].role === BIRD) { slots[i].pan = false; slots[i].sx = slots[i].x; slots[i].sy = slots[i].y; }
    }
  }

  function downSurface(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    activate();
    e.preventDefault();
    const el = e.currentTarget as Element;
    if (el !== canvas) return;
    const s = take(e, BIRD, el);
    if (!s) return;
    const n = count(BIRD);
    if (n === 1) {
      api.hoverAt(s.x, s.y);
      clearHold();
      holdSlot = s;
      holdTimer = window.setTimeout(onHold, HOLD_MS);
      longSlot = s;
      longTimer = window.setTimeout(onLong, LONG_MS);
    } else {
      // A second finger starts a pinch or a twist. Neither finger may end as a tap, and the pan stops.
      clearHold();
      for (let i = 0; i < slots.length; i++) if (slots[i].role === BIRD) { slots[i].moved = true; slots[i].pan = false; slots[i].hover = false; }
      const o = other(s);
      pair = null;
      if (o && n === 2) { const d = Math.hypot(s.x - o.x, s.y - o.y), a = lineOf(s, o); pair = { mode: 0, d0: d, a0: a, d, a }; }
    }
  }

  function move(e: PointerEvent): void {
    const s = find(e.pointerId);
    if (!s) return;
    e.preventDefault();
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.role !== BIRD) return;
    const o = other(s);
    if (o) {
      s.x = e.clientX; s.y = e.clientY;
      const g = pair;
      if (!g) return; // a third finger: nothing moves
      const d = Math.hypot(s.x - o.x, s.y - o.y), a = lineOf(s, o);
      if (g.mode === 0) {
        // how far along each gesture is toward its threshold; the first past 1 wins and the other is ignored from then on
        const pinch = Math.abs(d - g.d0) / Math.max(PINCH_PX, g.d0 * PINCH_PART);
        const twist = Math.min(d, g.d0) >= APART ? Math.abs(turn(a - g.a0)) / TWIST : 0;
        if (pinch < 1 && twist < 1) return;
        g.mode = pinch >= twist ? 1 : 2;
        // A pinch starts from here, so the camera does not jump by the distance the threshold took. A twist catches up
        // with the angle the threshold took: from now on the board follows the fingers 1:1, like a paper map.
        if (g.mode === 2) api.rotate(turn(a - g.a0));
        g.d = d; g.a = a;
        return;
      }
      if (g.mode === 1) {
        if (d > 8 && g.d > 8) api.zoom(d / g.d, (s.x + o.x) / 2, (s.y + o.y) / 2);
        g.d = d;
      } else {
        const da = turn(a - g.a);
        if (Math.abs(da) < 0.5) api.rotate(da);
        g.a = a;
      }
      return;
    }
    if (s.hover) { s.x = e.clientX; s.y = e.clientY; api.hoverAt(s.x, s.y); return; }
    if (!s.pan) {
      const tx = e.clientX - s.sx, ty = e.clientY - s.sy;
      s.x = e.clientX; s.y = e.clientY;
      if (tx * tx + ty * ty < DEAD * DEAD) return;
      // Leaving the dead zone starts the drag from here, so the camera does not jump. From now on it is no tap.
      s.moved = true; s.pan = true;
      if (holdSlot === s || longSlot === s) clearHold();
      return;
    }
    s.x = e.clientX; s.y = e.clientY;
    api.pan(dx, dy, s.x, s.y);
  }

  function up(e: PointerEvent): void {
    const s = find(e.pointerId);
    if (!s) return;
    e.preventDefault();
    const tap = s.role === BIRD && (s.hover || !s.moved) && !s.fired, held = s.hover;
    const x = s.hover ? e.clientX : s.sx, y = s.hover ? e.clientY : s.sy;
    release(s);
    if (tap) {
      // The second of two quick taps on a tower fires its special. The first was held back (onTower): it is dropped, so the
      // tower is never selected. A first tap that went through already (a slow double tap, or no onTower) selected the
      // tower, and special() undoes that selection.
      const dbl = e.timeStamp - lastTap.t < DOUBLE_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DOUBLE_PX;
      lastTap.t = dbl ? -1e9 : e.timeStamp; lastTap.x = x; lastTap.y = y;
      if (dbl && deferTimer) {
        dropTap();
        // (no `double`: there is no first tap's selection to undo. Not taken after all, say something was chosen for
        // building meanwhile: both taps go through as taps)
        if (!(api.special && api.special(x, y))) { api.tap(deferred.x, deferred.y); api.tap(x, y); }
      } else {
        flushTap();
        if (dbl && api.special && api.special(x, y, true)) { /* taken */ }
        else if (!dbl && !held && api.special && api.onTower?.(x, y)) {
          deferred.x = x; deferred.y = y;
          deferTimer = window.setTimeout(() => { deferTimer = 0; api.tap(deferred.x, deferred.y); }, TAP_DEFER);
        } else api.tap(x, y);
      }
    }
    // (a finger that was held, whether it then moved the ghost or not, ends the line it was laying: the next press starts a new one)
    if (held) api.hoverEnd();
  }

  function cancel(e: PointerEvent): void {
    const s = find(e.pointerId);
    if (s) release(s);
  }

  function releaseAll(): void {
    clearHold(); dropTap();
    for (let i = 0; i < slots.length; i++) if (slots[i].role !== FREE) release(slots[i]);
  }

  /** A button that acts on press. A click only counts when it comes from the keyboard. */
  function press(el: HTMLElement | null, run: () => void): void {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'touch') activate();
      e.preventDefault();
      run();
    }, { passive: false });
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.detail === 0) run();
    });
  }

  const stop = (e: Event): void => { if (e.cancelable) e.preventDefault(); };
  const opts: AddEventListenerOptions = { passive: false };

  canvas.addEventListener('pointerdown', downSurface, opts);
  window.addEventListener('pointermove', move, opts);
  window.addEventListener('pointerup', up, opts);
  window.addEventListener('pointercancel', cancel, opts);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  press(byId('t-turn'), () => api.turn());
  // Pause and speed act on press as well, so a second finger reaches them while another finger is on the board.
  press(byId('btn-pause'), () => api.pause());
  press(byId('btn-speed'), () => api.speed());

  // Touch events are cancelled as well: that is what stops scrolling, the long-press menu and
  // the emulated mouse events on browsers that ignore a cancelled pointerdown.
  const quiet: (EventTarget | null)[] = [canvas, root];
  for (const t of quiet) {
    if (!t) continue;
    t.addEventListener('touchstart', stop, opts);
    t.addEventListener('touchmove', stop, opts);
    t.addEventListener('touchend', stop, opts);
    t.addEventListener('contextmenu', stop);
  }
  // Safari page zoom gesture.
  document.addEventListener('gesturestart', stop, opts);

  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) activate();
  else window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') activate(); }, { capture: true, passive: true });
}
