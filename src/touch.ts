// Touch controls. Bird view: tap, drag to pan, pinch to zoom, twist to turn, hold then drag to move the build ghost.
// Uplink: drag to aim, hold Draw and let go to loose, round buttons for the skills.
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
  /** bird view: a tap at client coordinates (build / select) */
  tap(clientX: number, clientY: number): void;
  /** bird view: finger moved over the board without lifting (hover / ghost preview) */
  hoverAt(clientX: number, clientY: number): void;
  /** drag by (dx, dy) pixels; (x, y) is where the finger, or the middle of two fingers, is now */
  pan(dx: number, dy: number, x: number, y: number): void;
  zoom(factor: number): void;
  /** two fingers twisted by this many radians, clockwise on screen */
  rotate(angle: number): void;
  pause(): void;
  speed(): void;
}

const FREE = 0, BIRD = 1, LOOK = 2, FIRE = 3;
/** finger travel in px before a press counts as a drag */
const DEAD = 10;
/** press this long without moving and the drag moves the build ghost instead of the camera */
const HOLD_MS = 240;
// Look deltas are scaled so that a thumb sweep of about 300 px turns 120 degrees when the
// controller applies its mouse factor of 0.0022 rad per px. Vertical is a little calmer.
const LOOK_X = 3.2, LOOK_Y = 2.2;

interface Slot { id: number; role: number; x: number; y: number; sx: number; sy: number; moved: boolean; hover: boolean; el: Element | null }

export function initTouch(api: TouchApi): void {
  const canvas = api.canvas;
  const root = document.getElementById('touch');
  const byId = (id: string): HTMLElement | null => document.getElementById(id);
  const lookPad = byId('t-look'), fireBtn = byId('t-fire');

  const slots: Slot[] = [];
  for (let i = 0; i < 4; i++) slots.push({ id: -1, role: FREE, x: 0, y: 0, sx: 0, sy: 0, moved: false, hover: false, el: null });
  let active = false;
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
  function take(e: PointerEvent, role: number, el: Element): Slot | null {
    let s = find(e.pointerId);
    if (!s) for (let i = 0; i < slots.length; i++) if (slots[i].role === FREE) { s = slots[i]; break; }
    if (!s) return null;
    s.id = e.pointerId; s.role = role; s.el = el;
    s.x = s.sx = e.clientX; s.y = s.sy = e.clientY;
    s.moved = false; s.hover = false;
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
    s.role = FREE; s.id = -1; s.el = null;
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
      // A second finger makes it a pinch. Neither finger may end as a tap.
      clearHold();
      for (let i = 0; i < slots.length; i++) if (slots[i].role === BIRD) { slots[i].moved = true; slots[i].hover = false; }
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
      if (e.pointerType === 'touch' && api.isHero() && (dx !== 0 || dy !== 0)) api.look(dx * LOOK_X, dy * LOOK_Y);
      return;
    }
    if (s.role !== BIRD) return;
    const o = other(s);
    if (o) {
      const d0 = Math.hypot(s.x - o.x, s.y - o.y), a0 = Math.atan2(s.y - o.y, s.x - o.x);
      s.x = e.clientX; s.y = e.clientY;
      const d1 = Math.hypot(s.x - o.x, s.y - o.y);
      if (d0 > 8 && d1 > 8) api.zoom(d1 / d0);
      // A twist only counts with the fingers well apart: close together the angle is all jitter.
      if (d0 > 60 && d1 > 60) {
        let da = Math.atan2(s.y - o.y, s.x - o.x) - a0;
        if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) < 0.5) api.rotate(da);
      }
      // The midpoint moves half as far as the one finger that moved.
      api.pan(dx * 0.5, dy * 0.5, (s.x + o.x) / 2, (s.y + o.y) / 2);
      return;
    }
    if (s.hover) { s.x = e.clientX; s.y = e.clientY; api.hoverAt(s.x, s.y); return; }
    if (!s.moved) {
      const tx = e.clientX - s.sx, ty = e.clientY - s.sy;
      if (tx * tx + ty * ty < DEAD * DEAD) return;
      // Leaving the dead zone starts the drag from here, so the camera does not jump.
      s.moved = true;
      if (holdSlot === s) clearHold();
      s.x = e.clientX; s.y = e.clientY;
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
