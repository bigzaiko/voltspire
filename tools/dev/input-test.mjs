// One scripted run through both input paths: mouse and keyboard on a desktop window, then fingers on a phone-sized
// touch screen (CDP touch emulation). It checks what the camera and the look angles do, not pictures.
//   node tools/dev/input-test.mjs [baseUrl]
import puppeteer from 'puppeteer-core';

const base = process.argv[2] || 'http://localhost:5183';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true, protocolTimeout: 120000,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
});
const errors = [];
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (vp) => {
  const p = await browser.newPage();
  await p.setViewport(vp);
  // the dev server reloads the page when a source file changes: a socket that never connects keeps the run in one piece
  await p.evaluateOnNewDocument(() => { window.WebSocket = class { constructor() { this.readyState = 0; } addEventListener() {} removeEventListener() {} send() {} close() {} }; });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/play.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden') && window.__dbg, { timeout: 60000 });
  await p.evaluate(() => { window.__dbg.startGame('solo'); window.__dbg.view.skipIntro?.(); });
  await wait(1200);
  return p;
};
const cam = (p) => p.evaluate(() => { const c = window.__dbg.view.cam; return { x: c.x, z: c.z, dist: c.dist, rot: c.rot }; });
const ground = (p, x, y) => p.evaluate((x, y) => { const g = window.__dbg.view.groundPoint(x, y); return { x: g.x, z: g.z }; }, x, y);
const far = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const look = (p) => p.evaluate(() => ({ yaw: window.__dbg.view.yaw, pitch: window.__dbg.view.pitch }));
const f = (v) => v.toFixed(3);

// ---------- mouse and keyboard ----------
{
  const p = await open({ width: 1600, height: 900 });
  const start = await cam(p);

  // a click is not a pan
  await p.mouse.click(700, 520);
  await wait(200);
  ok(far(await cam(p), start) < 1e-6, 'mouse: a click leaves the camera where it was');

  // the wheel zooms toward the cursor: the ground under it stays under it
  await p.mouse.move(1120, 300);
  await wait(100);
  const g0 = await ground(p, 1120, 300);
  for (let i = 0; i < 3; i++) await p.mouse.wheel({ deltaY: -100 });
  await wait(700);
  const zin = await cam(p), g1 = await ground(p, 1120, 300);
  ok(zin.dist < start.dist * 0.75 && far(g0, g1) < 0.25, `mouse: three notches in, ${f(start.dist)} to ${f(zin.dist)}; the hex under the cursor moved ${f(far(g0, g1))} units`);
  ok(Math.abs(zin.rot - start.rot) < 1e-9, 'mouse: zooming does not turn the view');

  // pan by right-drag: the grabbed ground follows the cursor, zoomed in and zoomed out
  const drag = async (label) => {
    const a = await ground(p, 800, 450);
    await p.mouse.move(800, 450); await p.mouse.down({ button: 'right' });
    for (let i = 1; i <= 10; i++) { await p.mouse.move(800 + i * 12, 450 + i * 6); await wait(16); }
    await p.mouse.up({ button: 'right' });
    await wait(120);
    const b = await ground(p, 920, 510);
    ok(far(a, b) < 0.3, `mouse: right-drag ${label}, the grabbed point is ${f(far(a, b))} units off the cursor`);
  };
  await drag('zoomed in');
  await p.mouse.move(800, 450);
  for (let i = 0; i < 8; i++) await p.mouse.wheel({ deltaY: 100 });
  await wait(900);
  const zout = await cam(p);
  ok(zout.dist > zin.dist * 1.8, `mouse: eight notches out, distance ${f(zout.dist)}`);
  await drag('zoomed out');

  // middle-drag turns by the same angle per pixel at any zoom
  const before = await cam(p);
  await p.mouse.move(800, 450); await p.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 10; i++) { await p.mouse.move(800 + i * 10, 450); await wait(16); }
  await p.mouse.up({ button: 'middle' });
  await wait(100);
  const turned = await cam(p);
  ok(Math.abs(Math.abs(turned.rot - before.rot) - 0.6) < 0.02 && Math.abs(turned.dist - before.dist) < 1e-6, `mouse: middle-drag of 100 px turns ${f(Math.abs(turned.rot - before.rot))} rad and does not zoom`);

  // Q / E ease in and run out
  const r0 = (await cam(p)).rot;
  await p.keyboard.down('e');
  await wait(70);
  const r1 = (await cam(p)).rot;
  await wait(330);
  const r2 = (await cam(p)).rot;
  await wait(100);
  const r3 = (await cam(p)).rot;
  await p.keyboard.up('e');
  await wait(60);
  const r4 = (await cam(p)).rot;
  await wait(600);
  const r5 = (await cam(p)).rot;
  await wait(200);
  const r6 = (await cam(p)).rot;
  const early = Math.abs(r1 - r0) / 0.07, cruise = Math.abs(r3 - r2) / 0.1, tail = Math.abs(r5 - r4);
  ok(early < cruise * 0.75 && tail > 0.01 && Math.abs(r6 - r5) < 1e-4, `keys: E starts at ${f(early)} rad/s, cruises at ${f(cruise)} rad/s, runs out over ${f(tail)} rad and stops`);

  // WASD: the same pace on screen at both zoom levels (world speed in step with the distance)
  const pace = async () => {
    const a = await cam(p);
    await p.keyboard.down('d'); await wait(500); await p.keyboard.up('d'); await wait(500);
    const b = await cam(p);
    await p.keyboard.down('a'); await wait(500); await p.keyboard.up('a'); await wait(500);
    return far(a, b) / a.dist;
  };
  await p.keyboard.press('r'); // back to the middle of the board, so the pan does not run into its limits
  await wait(300);
  const slow = await pace();
  await p.mouse.move(800, 450);
  for (let i = 0; i < 5; i++) await p.mouse.wheel({ deltaY: -100 });
  await wait(900);
  const fast = await pace();
  ok(slow > 0.2 && Math.abs(slow / fast - 1) < 0.2, `keys: half a second of D moves ${f(slow)} of the camera distance at the start zoom and ${f(fast)} zoomed in`);

  // F3 opens the diagnostics
  await p.keyboard.press('F3');
  await wait(300);
  const diag = await p.evaluate(() => (document.getElementById('diag').classList.contains('hidden') ? '' : document.getElementById('diag').textContent));
  ok(/fps \d+/.test(diag) && /raw input/.test(diag) && /canvas \d+ x \d+/.test(diag) && /ambient occlusion (on|off)/.test(diag), 'keys: F3 shows the diagnostics: ' + diag.split('\n').slice(1, 3).join(' | '));

  // Uplink with the mouse: the view turns by exactly the mouse travel times the sensitivity, slow or fast, with nothing left over
  await p.evaluate(() => { const s = window.__dbg.sim; s.players[0].energy = 100; window.__dbg.act.hero(s.towers.find((x) => x.type === 'spire').id); });
  await wait(1200);
  await p.mouse.move(600, 450);
  await wait(100);
  const turn = async (steps, px, pause) => {
    const a = await look(p);
    for (let i = 1; i <= steps; i++) { await p.mouse.move(600 + i * px, 450 + i * px * 0.25); if (pause) await wait(pause); }
    const b = await look(p);
    await wait(300);
    const c = await look(p);
    await p.mouse.move(600, 450);
    await wait(100);
    return { yaw: Math.abs(b.yaw - a.yaw), pitch: Math.abs(b.pitch - a.pitch), late: Math.abs(c.yaw - b.yaw) + Math.abs(c.pitch - b.pitch) };
  };
  const slowTurn = await turn(40, 5, 16), fastTurn = await turn(4, 50, 0);
  ok(Math.abs(slowTurn.yaw - 0.44) < 0.002 && Math.abs(fastTurn.yaw - 0.44) < 0.002 && Math.abs(slowTurn.pitch - 0.11) < 0.002 && slowTurn.late < 1e-9 && fastTurn.late < 1e-9,
    `mouse look: 200 px turns ${f(slowTurn.yaw)} rad slowly and ${f(fastTurn.yaw)} rad fast (0.440 expected), and the view does not move afterwards`);
  await p.close();
}

// ---------- touch ----------
{
  const p = await open({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const T = p.touchscreen;
  const start = await cam(p);

  // a tap, and a finger that wobbles a few pixels, never pan
  let t = await T.touchStart(300, 200); await wait(60); await t.end();
  await wait(150);
  t = await T.touchStart(420, 180); await wait(30); await t.move(425, 184); await wait(30); await t.move(427, 186); await wait(30); await t.end();
  await wait(150);
  ok(far(await cam(p), start) < 1e-6, 'touch: a tap and a 9 px wobble leave the camera where it was');
  await p.evaluate(() => { document.getElementById('tower').classList.contains('hidden') || window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });

  // one finger pans: the ground under the finger follows it (after the dead zone)
  t = await T.touchStart(400, 200);
  for (let i = 1; i <= 3; i++) { await t.move(400 + i * 10, 200 + i * 3); await wait(16); }
  await wait(60);
  const ga = await ground(p, 430, 209); // the drag is live once the finger has left the dead zone: from here the board follows it
  for (let i = 4; i <= 12; i++) { await t.move(400 + i * 10, 200 + i * 3); await wait(16); }
  await wait(60);
  const gb = await ground(p, 520, 236);
  await t.end();
  await wait(120);
  const panned = await cam(p);
  ok(far(start, panned) > 2 && far(ga, gb) < 0.3, `touch: one finger drags the board, ${f(far(start, panned))} units; the grabbed point ends ${f(far(ga, gb))} units from the finger`);
  ok(Math.abs(panned.dist - start.dist) < 1e-6 && Math.abs(panned.rot - start.rot) < 1e-9, 'touch: a one-finger drag neither zooms nor turns');

  // two fingers. Each run: fingers start on a horizontal line around (422, 200), then follow the given spread and angle.
  const two = async (steps) => {
    const cx = 422, cy = 200;
    const at = (spread, ang) => [cx - Math.cos(ang) * spread / 2, cy - Math.sin(ang) * spread / 2, cx + Math.cos(ang) * spread / 2, cy + Math.sin(ang) * spread / 2];
    const s0 = at(steps[0][0], steps[0][1]);
    const a = await T.touchStart(s0[0], s0[1]); await wait(30);
    const b = await T.touchStart(s0[2], s0[3]); await wait(30);
    for (const [spread, ang] of steps.slice(1)) { const q = at(spread, ang); await a.move(q[0], q[1]); await b.move(q[2], q[3]); await wait(16); }
    return { a, b };
  };
  const ramp = (n, s0, s1, a0, a1) => Array.from({ length: n + 1 }, (_, i) => [s0 + (s1 - s0) * i / n, a0 + (a1 - a0) * i / n]);
  const lift = async (h) => { await h.a.end(); await wait(20); await h.b.end(); await wait(150); };

  // a clean pinch: zoom only, toward the point between the fingers
  let c0 = await cam(p);
  const mid0 = await ground(p, 422, 200);
  let h = await two(ramp(16, 160, 300, 0, 0));
  await wait(80);
  const mid1 = await ground(p, 422, 200);
  await lift(h);
  let c1 = await cam(p);
  ok(c1.dist < c0.dist * 0.72 && Math.abs(c1.rot - c0.rot) < 1e-9, `touch: pinch out zooms in (${f(c0.dist)} to ${f(c1.dist)}) and does not turn`);
  ok(far(mid0, mid1) < 0.6, `touch: the point between the fingers stays put while pinching (${f(far(mid0, mid1))} units)`);

  // a pinch with a sloppy hand (the line between the fingers drifts 7 degrees) is still only a zoom
  c0 = await cam(p);
  h = await two(ramp(16, 300, 170, 0, 0.12));
  await lift(h);
  c1 = await cam(p);
  ok(c1.dist > c0.dist * 1.3 && Math.abs(c1.rot - c0.rot) < 1e-9, `touch: pinch in with a 7 degree drift zooms out (${f(c0.dist)} to ${f(c1.dist)}) and turns by ${f(Math.abs(c1.rot - c0.rot))} rad`);

  // a clean twist: turn only
  c0 = await cam(p);
  h = await two(ramp(16, 220, 220, 0, 0.6));
  await lift(h);
  c1 = await cam(p);
  ok(Math.abs(c1.dist - c0.dist) < 1e-6 && Math.abs(Math.abs(c1.rot - c0.rot) - 0.46) < 0.08, `touch: a 34 degree twist turns the view by ${f(Math.abs(c1.rot - c0.rot))} rad and does not zoom`);

  // a twist where the fingers also drift apart a little (5%) is still only a turn
  c0 = await cam(p);
  h = await two(ramp(16, 220, 231, 0, -0.6));
  await lift(h);
  c1 = await cam(p);
  ok(Math.abs(c1.dist - c0.dist) < 1e-6 && Math.abs(c1.rot - c0.rot) > 0.3, `touch: a twist with the fingers drifting apart turns by ${f(Math.abs(c1.rot - c0.rot))} rad and zooms by ${f(Math.abs(c1.dist - c0.dist))}`);

  // after a pinch, the finger that lifts last does not shove the board
  h = await two(ramp(10, 200, 260, 0, 0));
  await h.a.end(); await wait(30);
  c0 = await cam(p);
  await h.b.move(556, 203); await wait(20); await h.b.move(558, 205); await wait(20);
  await h.b.end(); await wait(150);
  c1 = await cam(p);
  ok(far(c0, c1) < 1e-6, 'touch: lifting the fingers one after the other does not pan');

  // ----- Uplink on touch -----
  await p.evaluate(() => { const s = window.__dbg.sim; s.players[0].energy = 100; });
  await wait(200);
  await p.evaluate(() => { const s = window.__dbg.sim, sp = s.towers.find((x) => x.type === 'spire'); window.__dbg.act.hero(sp.id); });
  await wait(1200);
  ok(await p.evaluate(() => window.__dbg.sim.players[0].heroActive), 'touch: the Uplink is active');

  // The look gain depends on how fast the finger moves, so these two drags carry their own event times: a move
  // sent through the test driver takes about 80 ms to arrive, which would make every swipe look slow.
  const cdp = await p.createCDPSession();
  const drag = async (steps, px, ms) => {
    const t0 = Date.now() / 1000, pt = (x) => [{ x, y: 200, id: 7 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(300), timestamp: t0 });
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(300 + i * px), timestamp: t0 + (i * ms) / 1000 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + ((steps + 1) * ms) / 1000 });
    await wait(120);
  };
  // slow drag: fine aim (100 px in a second)
  let l0 = await look(p);
  await drag(25, 4, 40);
  let l1 = await look(p);
  const fine = Math.abs(l1.yaw - l0.yaw);
  // quick swipe over the same 100 px (in 64 ms)
  l0 = await look(p);
  await drag(4, 25, 16);
  l1 = await look(p);
  const swipe = Math.abs(l1.yaw - l0.yaw);
  ok(fine > 0.2 && fine < 0.6 && swipe > fine * 1.8, `touch: 100 px slowly turns ${f(fine)} rad (${(fine * 57.3).toFixed(0)} deg), the same 100 px as a quick swipe turns ${f(swipe)} rad (${(swipe * 57.3).toFixed(0)} deg)`);

  // hold Draw, aim with the same thumb, let go to loose
  const fire = await p.evaluate(() => { const r = document.getElementById('t-fire').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  l0 = await look(p);
  const arrows0 = await p.evaluate(() => window.__dbg.sim.projs.filter((q) => q.kind === 'arrow').length);
  t = await T.touchStart(fire[0], fire[1]);
  await wait(250);
  const drawing = await p.evaluate(() => window.__dbg.sim.players[0].drawing);
  for (let i = 1; i <= 10; i++) { await t.move(fire[0] - i * 5, fire[1] - i * 2); await wait(40); }
  await wait(500);
  const drawn = await p.evaluate(() => window.__dbg.sim.players[0].draw);
  l1 = await look(p);
  await t.end();
  await wait(120);
  const after = await p.evaluate(() => ({ drawing: window.__dbg.sim.players[0].drawing, arrows: window.__dbg.sim.projs.filter((q) => q.kind === 'arrow').length }));
  ok(drawing && drawn > 0.8 && Math.abs(l1.yaw - l0.yaw) > 0.05 && !after.drawing && after.arrows > arrows0,
    `touch: Draw held (tension ${f(drawn)}), the same thumb turned the view ${f(Math.abs(l1.yaw - l0.yaw))} rad, letting go loosed ${after.arrows - arrows0} arrow`);
  await p.close();
}

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
