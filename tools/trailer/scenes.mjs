// Scripted scenes shared by tools/shot.mjs and tools/trailer.mjs. Each function runs inside the capture page
// (page.evaluate) after installHelpers() and installLayout() from lib.mjs, and builds its scene with the real game rules.

/**
 * The showcase base on Switchback (the default map, seed 3): a working factory between the two chevrons of the road.
 * Iron mines feed Pulse Turrets by a curved belt with a splitter; a belt tunnel takes ore under the north road to two more
 * turrets; coal mines fuel a Generator whose poles power Cryo, Arc, a Beacon and the Pumpjack; crude runs by pipe (and a
 * pipe tunnel under the road) to two pairs of Firewall Pylons; a Smelter and a Frame Works turn ore into materials; a
 * Railgun and a Mortar stand on supply crates. `stage` (0..1) builds only that share of it, in build order (for the
 * trailer's growing factory; o.lazy keeps the rest for buildNext()). Returns a report of anything that did not go up or is not supplied.
 */
export function base(stage = 1, o = {}) {
  const C = window.__cap, s = C.real(o.seed ?? 3, 'switchback');
  s.lives = s.maxLives = 999;
  const steps = [];
  const T = (type, cx, cz, lvl = 1) => steps.push(() => C.tower(type, cx, cz, lvl));
  const F = (type, cx, cz, dir = 0, lvl = 1) => steps.push(() => C.fac(type, cx, cz, dir, lvl));
  const B = (cells, last) => steps.push(() => C.belt(cells, last));
  const P = (cells) => steps.push(() => C.pipe(cells));
  const X = (fn) => steps.push(fn);

  // --- iron: three mines round one belt that runs down past the turrets of the middle road into a splitter
  F('mine', 16, 7, 0, 2); F('mine', 17, 7, 0, 2); F('mine', 18, 8, 0, 2);
  B([[17, 8], [16, 9]], [16, 10]);
  F('splitter', 16, 10);
  T('pulse', 16, 8, 2); T('pulse', 15, 9, 2);
  B([[15, 11], [15, 12], [15, 13], [15, 14]], [15, 15]);
  T('pulse', 16, 12, 2); T('pulse', 14, 13, 2); T('pulse', 14, 14);
  // --- coal: two generators, and a Smelter fed ore from the splitter's other side, its plates to a Frame Works
  F('mine', 17, 11, 0, 2); F('mine', 18, 11, 0, 2); F('mine', 18, 12, 0, 2); F('mine', 17, 12, 0, 2);
  F('generator', 18, 13, 0, 2); F('generator', 17, 13, 0, 2);
  B([[17, 10]], [18, 10]);
  F('smelter', 18, 10, 0, 2);
  F('works', 19, 10);
  // --- power poles and the powered towers along the east road
  F('pole', 19, 11); F('pole', 19, 9);
  T('cryo', 20, 12, 2); T('cryo', 19, 14); T('arc', 21, 10, 2); T('beacon', 20, 8);
  X(() => { s.factory.placeCrate(19, 6, 'copper', 20); });
  T('rail', 19, 7, 2);
  // --- a belt tunnel under the north road: ore from the mine on (17,6) to two turrets beyond it
  F('mine', 17, 6, 0, 2);
  F('tunnel', 17, 5, 5); F('tunnel', 18, 3, 5);
  B([[19, 2]], 0);
  T('pulse', 19, 3); T('pulse', 20, 2);
  // --- oil: a pumpjack, pipes to Firewall Pylons on both sides of the west road, a pipe tunnel under it
  F('pole', 14, 10); F('pole', 10, 8); F('pole', 11, 5);
  F('pump', 10, 6, 0, 3); F('pump', 9, 5, 0, 3);
  P([[9, 7], [9, 8]]);
  F('ptunnel', 8, 7); F('ptunnel', 5, 7);
  T('flame', 8, 8); T('flame', 5, 8); T('flame', 9, 6); T('flame', 5, 6);
  // --- the heavy guns of the west pocket on crates
  X(() => { s.factory.placeCrate(12, 11, 'shell', 16); });
  T('mortar', 12, 10, 2);
  X(() => { s.factory.placeCrate(10, 11, 'missile', 24); });
  T('missile', 10, 10, 2);

  const n = Math.round(steps.length * stage), errs = [];
  for (let i = 0; i < n; i++) { try { steps[i](); } catch (e) { errs.push(String(e.message || e)); } }
  s.events.length = 0;
  // o.lazy: the rest of the build is left in window.__rest for the caller to put down one step at a time (with its pulse and sound)
  if (o.lazy) { window.__rest = steps.slice(n); return { steps: steps.length, built: n, errs }; }
  const dg = s.diag(), bad = [];
  for (const t of s.towers) { const d = dg.get('t' + t.id); if (d && !d.ok) bad.push(`${t.type}@${t.cx},${t.cz}: ${d.missing.join(', ')}`); }
  for (const f of s.factory.facs) { const d = dg.get('f' + f.id); if (d && !d.ok) bad.push(`${f.type}@${f.cx},${f.cz}: ${d.missing.join(', ')}`); }
  return { steps: steps.length, built: n, errs, bad };
}

/** Believable HUD numbers for a shot that shows the HUD (the scripts build with plenty of credits and a core that cannot fall). */
export function hudNice() {
  const s = window.__volt.sim;
  s.gold = 1240; s.mats = 36; s.lives = 17; s.maxLives = 20;
}

/** Put down the next k steps of a lazy base() (see base); returns how many are left. */
export function buildNext(k = 1) {
  const r = window.__rest || [];
  for (let i = 0; i < k && r.length; i++) { try { r.shift()(); } catch { /* (reported by base() in a full build) */ } }
  return r.length;
}

/** World position of a cell (the deck is flat at 0 on Switchback). */
const cellXZ = (cx, cz) => [(cx + 0.5 * (cz & 1) - 13 + 0.25) * 2, (cz - 9.5) * 1.7320508];

/** Run the field on (drawn frames, at the game's 30 fps), keeping every tower awake. */
export function settle(seconds = 2) {
  const V = window.__volt;
  for (let i = 0; i < seconds * 30; i++) V.frame(1 / 30);
}

/** The base in a wave: wave n called, `run` seconds of it simulated, then drawn for a moment. */
export function battle(n = 9, run = 14) {
  const C = window.__cap, V = window.__volt;
  const r = base();
  C.wave(n); C.run(run); V.resync();
  return r;
}

/** The first enemy of a type on the field (after running the wave on until one is past `minDist` on its road). */
export function waitFor(type, minDist = 0, maxSeconds = 120) {
  const V = window.__volt;
  for (let i = 0; i < maxSeconds * 2; i++) {
    const e = V.sim.enemies.find((q) => q.type === type && q.alive && q.dist >= minDist);
    if (e) return { id: e.id, x: e.x, z: e.z, dist: e.dist };
    V.skip(0.5);
  }
  return null;
}

/** The Titan's whole entrance, drawn: the leap onto the gate of Switchback, the impact, and `walk` seconds down the road. */
export function titan(walk = 6) {
  const V = window.__volt, s = V.sim;
  s.titanLeap(0);
  let n = 0;
  for (; n < 1200 && s.titan.phase !== 'walk'; n++) V.frame(1 / 30);
  for (let i = 0; i < walk * 30; i++) V.frame(1 / 30);
  const e = s.enemies.find((q) => q.type === 'titan');
  return e ? { x: e.x, z: e.z, dist: e.dist, frames: n } : null;
}

/** Fire the special of the first tower of a type (charged for it); all = every tower of that type. */
export function special(type, all = false) {
  const s = window.__volt.sim;
  let n = 0;
  for (const t of s.towers) {
    if (t.type !== type) continue;
    t.charge = 1; t.spec = 0; t.down = 0;
    if (s.triggerSpecial(t.id, 0)) n++;
    if (!all) break;
  }
  return n;
}

export { cellXZ };
