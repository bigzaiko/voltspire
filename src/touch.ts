// Touch controls. Bird view: tap, drag with one finger to pan, hold then drag to move the build ghost. Two fingers
// either pinch (zoom) or twist (turn): whichever passes its threshold first, and it stays that until a finger lifts.
// Uplink: drag to aim (slow drags aim finely, quick swipes turn far), hold Draw and let go to loose, and the thumb
// that holds Draw can keep aiming. Round buttons for the skills. In Uplink mode Build opens build mode: the tower bar
// can be tapped, Draw becomes Place, and Sell shows while the crosshair is on a tower.
// Mouse and keyboard handlers in play.ts stay active; everything here only reacts to touch pointers,
// except the on-screen buttons, which also take a mouse press or a keyboard activation.
// The styles (touch.css) are linked from play.html.

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
  /** Uplink mode: open or close build mode (while it is open, fire() places the tower instead of drawing) */
  build(): void;
  /** Uplink mode, build mode: sell the tower under the crosshair */
  sell(): void;
  /** Uplink mode, build mode: upgrade the tower under the crosshair, or the player's own Spire */
  upgrade(): void;
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
}

const FREE = 0, BIRD = 1, LOOK = 2, FIRE = 3;
/** finger travel in px before a press counts as a drag */
const DEAD = 12;
/** press this long without moving and the drag moves the build ghost instead of the camera */
const HOLD_MS = 240;
// Look deltas are scaled for the controller's mouse factor of 0.0022 rad per px, and then by the speed of the
// finger: below SLOW px per ms the gain is LOOK_FINE (100 px turn about 20 degrees, for aiming), above FAST it is
// LOOK_SWIPE (a quick 300 px swipe turns more than half a circle). Vertical is a little calmer.
const LOOK_X = 3.2, LOOK_Y = 2.2;
const LOOK_FINE = 0.5, LOOK_SWIPE = 1.9, SLOW = 0.08, FAST = 1.1;
/** the thumb that holds Draw aims a little finer than the free finger */
const FIRE_AIM = 0.8;
// Two fingers: the spread has to change by this much (px, or this share of the spread) to become a pinch,
// or the line between the fingers has to turn by this much (radians, with the fingers at least APART px apart) to become a twist.
const PINCH_PX = 18, PINCH_PART = 0.07, TWIST = 0.14, APART = 70;

interface Slot { id: number; role: number; x: number; y: number; sx: number; sy: number; moved: boolean; pan: boolean; hover: boolean; el: Element | null; t: number; v: number }
/** What two fingers on the board are doing: 0 undecided, 1 pinch, 2 twist. d and a are the spread and angle last used. */
interface Pair { mode: 0 | 1 | 2; d0: number; a0: number; d: number; a: number }
const turn = (a: number): number => (a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a);

export function initTouch(api: TouchApi): void {
  const canvas = api.canvas;
  const root = document.getElementById('touch');
  const byId = (id: string): HTMLElement | null => document.getElementById(id);
  const lookPad = byId('t-look'), fireBtn = byId('t-fire');

  const slots: Slot[] = [];
  for (let i = 0; i < 4; i++) slots.push({ id: -1, role: FREE, x: 0, y: 0, sx: 0, sy: 0, moved: false, pan: false, hover: false, el: null, t: 0, v: 0 });
  let active = false;
  let pair: Pair | null = null;
  let holdTimer = 0;
  let holdSlot: Slot | null = null;

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
    s.moved = false; s.pan = false; s.hover = false; s.t = e.timeStamp; s.v = 0;
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    return s;
  }
  function clearHold(): void {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    holdSlot = null;
  }
  function onHold(): void {
    holdTimer = 0;
    const s = holdSlot;
    holdSlot = null;
    if (!s || s.role !== BIRD || s.moved || count(BIRD) !== 1 || api.isHero()) return;
    s.hover = true;
    api.hoverAt(s.x, s.y);
  }
  function release(s: Slot): void {
    if (holdSlot === s) clearHold();
    if (s.el) { try { s.el.releasePointerCapture(s.id); } catch { /* not captured any more */ } }
    if (s.role === FIRE) {
      // Only stop firing when no other finger still holds the button.
      s.role = FREE;
      if (count(FIRE) === 0) { api.fire(false); if (fireBtn) fireBtn.classList.remove('on'); }
    }
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
    if (api.isHero()) { take(e, LOOK, el); return; }
    if (el !== canvas) return;
    const s = take(e, BIRD, el);
    if (!s) return;
    const n = count(BIRD);
    if (n === 1) {
      api.hoverAt(s.x, s.y);
      clearHold();
      holdSlot = s;
      holdTimer = window.setTimeout(onHold, HOLD_MS);
    } else {
      // A second finger starts a pinch or a twist. Neither finger may end as a tap, and the pan stops.
      clearHold();
      for (let i = 0; i < slots.length; i++) if (slots[i].role === BIRD) { slots[i].moved = true; slots[i].pan = false; slots[i].hover = false; }
      const o = other(s);
      pair = null;
      if (o && n === 2) { const d = Math.hypot(s.x - o.x, s.y - o.y), a = lineOf(s, o); pair = { mode: 0, d0: d, a0: a, d, a }; }
    }
  }

  function downFire(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') activate();
    e.preventDefault();
    if (!api.isHero()) return;
    if (!take(e, FIRE, e.currentTarget as Element)) return;
    if (fireBtn) fireBtn.classList.add('on');
    api.fire(true);
  }

  function move(e: PointerEvent): void {
    const s = find(e.pointerId);
    if (!s) return;
    e.preventDefault();
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.role === BIRD && api.isHero()) { s.role = LOOK; clearHold(); }
    if (s.role === LOOK || s.role === FIRE) {
      s.x = e.clientX; s.y = e.clientY;
      // The mouse may hold Fire too, but it aims through pointer lock, not through this drag.
      if (e.pointerType !== 'touch' || !api.isHero() || (dx === 0 && dy === 0)) return;
      const ms = Math.max(4, Math.min(60, e.timeStamp - s.t));
      s.t = e.timeStamp;
      s.v += (Math.hypot(dx, dy) / ms - s.v) * 0.5;
      const u = Math.max(0, Math.min(1, (s.v - SLOW) / (FAST - SLOW)));
      const k = (LOOK_FINE + (LOOK_SWIPE - LOOK_FINE) * u * u * (3 - 2 * u)) * (s.role === FIRE ? FIRE_AIM : 1);
      api.look(dx * LOOK_X * k, dy * LOOK_Y * k);
      return;
    }
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
        // start from here, so the camera does not jump by the distance the threshold took
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
      if (holdSlot === s) clearHold();
      return;
    }
    s.x = e.clientX; s.y = e.clientY;
    api.pan(dx, dy, s.x, s.y);
  }

  function up(e: PointerEvent): void {
    const s = find(e.pointerId);
    if (!s) return;
    e.preventDefault();
    const tap = s.role === BIRD && !api.isHero() && (s.hover || !s.moved);
    const x = s.hover ? e.clientX : s.sx, y = s.hover ? e.clientY : s.sy;
    release(s);
    if (tap) api.tap(x, y);
  }

  function cancel(e: PointerEvent): void {
    const s = find(e.pointerId);
    if (s) release(s);
  }

  function releaseAll(): void {
    clearHold();
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
  if (lookPad) lookPad.addEventListener('pointerdown', downSurface, opts);
  if (fireBtn) {
    fireBtn.addEventListener('pointerdown', downFire, opts);
    fireBtn.addEventListener('click', stop);
  }
  window.addEventListener('pointermove', move, opts);
  window.addEventListener('pointerup', up, opts);
  window.addEventListener('pointercancel', cancel, opts);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  press(byId('t-s0'), () => { if (api.isHero()) api.skill(0); });
  press(byId('t-s1'), () => { if (api.isHero()) api.skill(1); });
  press(byId('t-s2'), () => { if (api.isHero()) api.skill(2); });
  press(byId('t-tp'), () => { if (api.isHero()) api.teleport(); });
  press(byId('t-exit'), () => { if (api.isHero()) api.exitHero(); });
  press(byId('t-build'), () => { if (api.isHero()) api.build(); });
  press(byId('t-bsell'), () => { if (api.isHero()) api.sell(); });
  press(byId('t-bup'), () => { if (api.isHero()) api.upgrade(); });
  press(byId('t-ult'), () => { if (!api.isHero()) api.ult(); });
  // Pause and speed act on press as well, so a second finger reaches them while the first holds Draw or aims.
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
