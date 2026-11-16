// Uplink mode, one scripted run: the mode chip on the setup sheet, the start on the Spire, build mode with the mouse and
// the keyboard on a desktop window, then the same on a phone-sized touch screen (CDP touch emulation). The run is played
// on Overpass, whose road bridges over itself, so the hex pick is also checked against a raised road.
// It checks what the game does, with numbers, and saves three screenshots.
//   node tools/dev/uplink-test.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { GW, worldToCell } from '../../src/game/hex.ts';

const base = process.argv[2] || 'http://localhost:5183';
const SHOTS = '/tmp/claude-1000/uplink-shots';
mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true, protocolTimeout: 120000,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
});
const errors = [];
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const f = (v, n = 3) => (typeof v === 'number' ? v.toFixed(n) : String(v));
const shots = [];
const open = async (vp) => {
  const p = await browser.newPage();
  await p.setViewport(vp);
  // the dev server reloads the page when a source file changes: a socket that never connects keeps the run in one piece
  await p.evaluateOnNewDocument(() => { window.WebSocket = class { constructor() { this.readyState = 0; } addEventListener() {} removeEventListener() {} send() {} close() {} }; });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/play.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden') && window.__dbg, { timeout: 60000 });
  // note every sound played from here on (the deny sound is checked)
  await p.evaluate(() => {
    window.__sounds = [];
    const s = window.__dbg.sound, play = s.play.bind(s);
    s.play = (name, ...a) => { window.__sounds.push(name); return play(name, ...a); };
  });
  return p;
};
/** wait for the player to be on a Spire, then hook the sim of this run: arrows loosed are counted */
const onSpire = async (p) => {
  await p.waitForFunction(() => window.__dbg.sim.players[0]?.heroActive, { timeout: 20000 });
  await p.evaluate(() => {
    const s = window.__dbg.sim, loose = s.loose;
    window.__looses = 0;
    s.loose = function (...a) { window.__looses++; return loose.apply(this, a); };
  });
};
const state = (p) => p.evaluate(() => {
  const d = window.__dbg, s = d.sim, pl = s.players[0];
  return { ...d.build, hero: pl.heroActive, spire: s.towerById(pl.heroTower)?.type, gold: s.gold, towers: s.towers.length, time: s.time, looses: window.__looses || 0, drawing: pl.drawing, draw: pl.draw };
});
const shown = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && !!e.getClientRects().length; }, sel);
const sounds = (p) => p.evaluate(() => window.__sounds.splice(0));
/** two animation frames, so the view has drawn the current look */
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/**
 * Turn the view until the crosshair is on what is wanted, looking through the turns from the current direction outward:
 * 'near' / 'far' a hex the chosen tower can go on, close to the Spire or a long way off; 'road' a road hex; 'raised' a
 * stretch of raised road or bridge; a number, that tower. Returns where the crosshair landed, or null.
 */
const aimAt = async (p, want) => {
  const list = await p.evaluate((want, GW) => {
    const d = window.__dbg, v = d.view, s = d.sim, o = s.heroOrigin(0), g = v.camera.position.clone(), found = [];
    const y0 = v.yaw, p0 = v.pitch;
    for (let k = 0; k < 72 && found.length < 40; k++) {
      const yaw = y0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 36);
      for (let pitch = -1.2; pitch <= 0.05 && found.length < 40; pitch += 0.04) {
        v.yaw = yaw; v.pitch = pitch; d.pick();
        const b = d.build, id = v.buildPick(g), dist = Math.hypot(g.x - o.x, g.z - o.z);
        if (b.cx < 0) continue;
        const grid = s.grid[b.cz * GW + b.cx];
        const hit = want === 'near' ? b.ok && dist < 9 : want === 'far' ? b.ok && dist > 20
          : want === 'road' ? id === 0 && !b.tower && grid === 1 && v.deckY(g.x, g.z) < 0.05
          : want === 'raised' ? id === 0 && grid === 1 && g.y > 0.5
          : b.tower === want;
        if (!hit) continue;
        // where the same ray would meet flat ground: on a bridge that is another hex, under or behind it
        const P = g.clone(), D = g.clone();
        v.camPose(P, D);
        const u = -P.y / D.y;
        found.push({ yaw, pitch, dist, x: g.x, y: g.y, z: g.z, cx: b.cx, cz: b.cz, fx: P.x + D.x * u, fz: P.z + D.z * u });
        if (want !== 'raised') break;
      }
      if (want !== 'raised' && found.length) break;
    }
    v.yaw = y0; v.pitch = p0; d.pick();
    return found;
  }, want, GW);
  // a raised road is only worth checking where flat ground would have given another hex
  const r = want === 'raised' ? list.find((c) => !same(cellOf(c), worldToCell(c.fx, c.fz))) : list[0];
  if (r) await p.evaluate((yaw, pitch) => { const d = window.__dbg; d.view.yaw = yaw; d.view.pitch = pitch; d.pick(); }, r.yaw, r.pitch);
  await frames(p);
  return r || null;
};
const lineText = (p) => p.evaluate(() => [...document.getElementById('build-line').children].map((e) => e.textContent).filter(Boolean).join(' / '));
/** the hex in the middle of the screen as the drawn camera sees it: where its centre ray meets the deck, raised roads included */
const screenHex = (p) => p.evaluate(() => {
  const v = window.__dbg.view, c = v.camera, o = c.position, dir = c.getWorldDirection(c.position.clone());
  let t = 0.2;
  for (; t < 160; t += 0.05) if (o.y + dir.y * t <= v.deckY(o.x + dir.x * t, o.z + dir.z * t)) break;
  const flat = v.groundPoint(innerWidth / 2, innerHeight / 2);
  return { x: o.x + dir.x * t, z: o.z + dir.z * t, fx: flat.x, fz: flat.z };
});
const ghostHex = (p) => p.evaluate(() => { const v = window.__dbg.view; return { x: v.ghost.position.x, z: v.ghost.position.z, mark: v.cellMark.visible, model: v.ghost.visible, cross: v.cellCross.visible }; });
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const cellOf = (pt) => worldToCell(pt.x, pt.z);
/** sim seconds per second of game time, over about a second of animation frames. Measured against the same clamped
 *  frame time the game steps with (a frame never counts for more than 0.1 s), so a slow frame on a busy machine is no failure. */
const rate = (p, ms = 1000) => p.evaluate((ms) => new Promise((res) => {
  const s = window.__dbg.sim, t0 = s.time;
  let last = performance.now(), sum = 0;
  const end = last + ms;
  const f = (now) => { sum += Math.min(0.1, (now - last) / 1000); last = now; if (now < end) requestAnimationFrame(f); else res((s.time - t0) / sum); };
  requestAnimationFrame(f);
}), ms);

// ---------- mouse and keyboard ----------
{
  const p = await open({ width: 1600, height: 900 });
  const K = (key) => p.keyboard.press(key);
  // On the Spire the mouse turns the view. Every click below lands on the middle of the screen, so the mouse goes
  // there once now (in the menu) and never travels again.
  const mid = async (button = 'left') => { await p.mouse.down({ button }); await wait(30); await p.mouse.up({ button }); };

  // the setup sheet: a third mode chip, remembered with the setup
  await p.click('#m-solo');
  await wait(300);
  await p.click('#setup-mode [data-v="uplink"]');
  await p.click('#map-row .mapcard[title="Overpass"]');
  await wait(150);
  const chip = await p.evaluate(() => ({
    on: [...document.querySelectorAll('#setup-mode .chip.on')].map((c) => c.dataset.v), n: document.querySelectorAll('#setup-mode .chip').length,
    desc: document.getElementById('setup-desc').textContent,
  }));
  ok(chip.n === 3 && chip.on.join() === 'uplink' && /Uplink mode/.test(chip.desc), `setup: ${chip.n} mode chips, Uplink chosen; "${chip.desc.slice(chip.desc.indexOf('Uplink'))}"`);
  await p.click('#setup-go');
  const t0 = Date.now();
  await p.mouse.move(800, 450);
  await wait(100);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('beatspire') || '{}').setup);
  const run = await p.evaluate(() => ({ uplink: window.__dbg.sim.opts.uplink, survival: window.__dbg.sim.opts.survival, map: window.__dbg.sim.map.def.name }));
  ok(run.uplink === true && run.survival === false && saved?.uplink === true, `start: the run has sim.opts.uplink ${run.uplink} on ${run.map}, and the saved setup remembers uplink: ${saved?.uplink}`);

  // the intro: the board assembles in the bird view and the sim waits for it; then the player is on the Spire
  const during = [];
  for (;;) {
    // one sample per poll, read in a single step, so the intro cannot end between reading it and reading the sim
    const q = await p.evaluate(() => ({ intro: window.__dbg.view.introActive(), t: window.__dbg.sim.time, hero: window.__dbg.sim.players[0].heroActive }));
    if (!q.intro) break;
    during.push(q);
    await wait(150);
    if (Date.now() - t0 > 15000) break;
  }
  const introS = (Date.now() - t0) / 1000;
  await onSpire(p);
  const onS = (Date.now() - t0) / 1000;
  ok(during.length >= 5 && during.every((s) => s.t === 0 && !s.hero), `intro: ${during.length} samples over ${f(introS, 2)} s, the sim held at time 0 and the player in the bird view throughout`);
  await wait(900);
  let s = await state(p);
  ok(s.hero && s.spire === 'spire' && onS - introS < 1, `start: on the Spire ${f(onS - introS, 2)} s after the intro ended (${f(onS, 2)} s after Start)`);
  const hidden = { speed: !(await shown(p, '#btn-speed')), ult: !(await shown(p, '#ult')), time: !(await shown(p, '#hero-time')), build: await shown(p, '#sk-build'), prep: await shown(p, '#prep') };
  ok(hidden.speed && hidden.ult && hidden.time && hidden.build && hidden.prep, `HUD: speed button hidden ${hidden.speed}, Uplink bar hidden ${hidden.ult}, Uplink timer hidden ${hidden.time}, build key hint shown ${hidden.build}, first wave note shown ${hidden.prep}`);
  const tip = await p.evaluate(() => (document.getElementById('tutor').classList.contains('hidden') ? '' : document.getElementById('tutor-text').textContent));
  ok(/build/i.test(tip) && /Spire/.test(tip), `tip: "${tip}"`);
  await K(' ');
  await wait(200);
  s = await state(p);
  ok(s.hero && !(await sounds(p)).includes('error'), 'Space does nothing in Uplink mode (no deny sound, still on the Spire)');
  // the board stays empty while the build checks run: no wave, no kills, no credits from anywhere else
  await p.evaluate(() => { window.__dbg.sim.nextWaveIn = 900; });

  // a hotkey opens build mode with that tower; the ghost sits on the hex under the crosshair
  await K('2');
  await wait(1100);
  s = await state(p);
  ok(s.open && s.type === 'cryo', `key 2 opens build mode with ${s.type}`);
  for (const want of ['near', 'far']) {
    const a = await aimAt(p, want);
    if (!a) { ok(false, `build: found no ${want} hex to aim at`); continue; }
    await wait(60);
    const b = await state(p), g = await ghostHex(p), sh = await screenHex(p);
    const pick = [b.cx, b.cz], gh = cellOf(g), scr = cellOf(sh);
    ok(b.ok && g.mark && g.model && same(pick, gh) && same(pick, scr),
      `build, a ${want} hex ${f(a.dist, 1)} units from the Spire: picked (${pick}), ghost on (${gh}), the screen centre meets the deck on (${scr})`);
  }
  // a raised road: the crosshair marks the bridge, not the ground behind or under it
  {
    const a = await aimAt(p, 'raised');
    if (!a) ok(false, 'build: found no raised road to aim at');
    else {
      const b = await state(p), sh = await screenHex(p), g = await ghostHex(p);
      const pick = [b.cx, b.cz], scr = cellOf(sh), flat = worldToCell(sh.fx, sh.fz);
      ok(same(pick, scr) && !same(pick, flat) && !b.ok && g.cross,
        `build, a raised road ${f(a.y, 2)} high: picked (${pick}), the deck under the crosshair (${scr}), shown as invalid ("${await lineText(p)}"); flat ground would have been (${flat})`);
    }
  }

  // a left click builds exactly one tower on that hex, takes its cost, and looses no arrow
  const near = await aimAt(p, 'near');
  await wait(60);
  const b0 = await state(p);
  const cost = await p.evaluate(() => window.__dbg.sim.cost('cryo'));
  await p.screenshot({ path: `${SHOTS}/build-valid.png` });
  shots.push(`${SHOTS}/build-valid.png`);
  await mid();
  await wait(300);
  const b1 = await state(p);
  const built = await p.evaluate((cx, cz) => window.__dbg.sim.towers.filter((t) => t.cx === cx && t.cz === cz).map((t) => ({ id: t.id, type: t.type })), b0.cx, b0.cz);
  ok(!!near && b1.towers === b0.towers + 1 && built.length === 1 && built[0].type === 'cryo' && b0.gold - b1.gold === cost && b1.looses === 0 && !b1.drawing && b1.open,
    `click: ${b1.towers - b0.towers} tower built, a ${built[0]?.type} on (${b0.cx},${b0.cz}); credits ${b0.gold} to ${b1.gold} (cost ${cost}); arrows loosed ${b1.looses}; still open ${b1.open}`);
  const cryoId = built[0]?.id || -1;

  // an invalid hex builds nothing and only gets the deny sound
  await aimAt(p, 'road');
  await wait(60);
  await sounds(p);
  const r0 = await state(p);
  await mid();
  await wait(250);
  const r1 = await state(p), heard = await sounds(p);
  const line = await lineText(p);
  ok(r0.cx >= 0 && !r0.ok && r1.towers === r0.towers && r1.gold === r0.gold && heard.includes('error') && r1.looses === 0,
    `click on a road hex (${r0.cx},${r0.cz}): towers ${r0.towers} to ${r1.towers}, credits ${r0.gold} to ${r1.gold}, sounds [${heard}], line "${line}"`);
  await p.screenshot({ path: `${SHOTS}/build-invalid.png` });
  shots.push(`${SHOTS}/build-invalid.png`);

  // the wheel steps through the unlocked towers
  const w0 = (await state(p)).type;
  await p.mouse.wheel({ deltaY: 100 });
  await wait(300);
  const w1 = (await state(p)).type;
  await p.mouse.wheel({ deltaY: 100 });
  await wait(300);
  const w2 = (await state(p)).type;
  await p.mouse.wheel({ deltaY: -100 });
  await wait(300);
  const w3 = (await state(p)).type;
  const unlocked = await p.evaluate(() => [...window.__dbg.sim.unlocked]);
  ok(w1 !== w0 && w2 !== w1 && w3 === w1 && unlocked.includes(w1) && unlocked.includes(w2), `wheel: ${w0}, down to ${w1}, down to ${w2}, up to ${w3} (unlocked: ${unlocked.join(', ')})`);

  // solo time runs at a quarter while build mode is open, eased, and at full speed after
  await wait(200);
  const slow = await rate(p);
  await K('b');
  const easing = [];
  // the ease back to full speed, sampled until it gets there (it takes about 150 ms; a busy machine gets 600)
  for (let i = 0; i < 20; i++) { await wait(30); easing.push((await state(p)).slow); if (easing[easing.length - 1] === 1) break; }
  await wait(200);
  const full = await rate(p);
  s = await state(p);
  ok(Math.abs(slow - 0.25) < 0.05 && Math.abs(full - 1) < 0.12 && !s.open && easing[0] < 1 && easing[easing.length - 1] === 1,
    `time: ${f(slow)}x with build mode open, ${f(full)}x after B closed it (eased back over ${easing.map((x) => f(x, 2)).join(', ')})`);

  // the bow: a draw in progress comes down when build mode opens, and nothing flies
  await p.mouse.down();
  await wait(500);
  const drawn = await state(p);
  await K('b');
  await wait(100);
  await p.mouse.up();
  await wait(250);
  const after = await state(p);
  ok(drawn.drawing && drawn.draw > 0.3 && after.open && !after.drawing && after.draw === 0 && after.looses === 0,
    `bow: drawn to ${f(drawn.draw, 2)} when B opened build mode; after letting go drawing ${after.drawing}, tension ${after.draw}, arrows loosed ${after.looses}`);

  // Q in build mode closes it and arms Arrow Rain: its area shows under the crosshair and nothing is cast yet;
  // the left button casts it there and looses no arrow
  const skillState = async () => ({ ...(await state(p)), area: await p.evaluate(() => window.__dbg.view.skillMark.visible), cds: await p.evaluate(() => [...window.__dbg.sim.players[0].cds]) });
  const cd0 = await p.evaluate(() => [...window.__dbg.sim.players[0].cds]);
  await K('q');
  await wait(200);
  const a1 = await skillState(), aLine = await lineText(p);
  await p.screenshot({ path: `${SHOTS}/skill-rain.png` });
  shots.push(`${SHOTS}/skill-rain.png`);
  await mid();
  await wait(200);
  const a2 = await skillState();
  ok(!a1.open && a1.area && a1.cds[1] <= cd0[1] && /Arrow Rain/.test(aLine) && a2.cds[1] > cd0[1] + 1 && !a2.area && a2.looses === 0 && !a2.drawing,
    `skills: Q in build mode closes it and shows the Arrow Rain area ("${aLine}", nothing cast yet); LMB casts it (cooldown ${f(a2.cds[1], 1)} s), no arrow loosed`);
  // E shows the Singularity area; E again puts it away without casting, and so does the right button
  await K('e');
  await wait(200);
  const g1 = await skillState();
  await p.screenshot({ path: `${SHOTS}/skill-singularity.png` });
  shots.push(`${SHOTS}/skill-singularity.png`);
  await K('e');
  await wait(150);
  const g2 = await skillState();
  await K('e');
  await wait(150);
  await mid('right');
  await wait(200);
  const g3 = await skillState();
  ok(g1.area && !g2.area && !g3.area && g3.cds[2] <= 0 && g3.cds[0] <= 0 && g3.looses === 0,
    `skills: E shows the Singularity area (${g1.area}); E again (${!g2.area}) or RMB (${!g3.area}) puts it away, nothing cast (Singularity ${f(Math.max(0, g3.cds[2]), 1)} s, Rail Shot ${f(Math.max(0, g3.cds[0]), 1)} s)`);
  // Rail Shot: holding the right button zooms in and charges the bow; letting go of the left one fires it.
  // Letting go of the right button without the left puts it away.
  const fov0 = await p.evaluate(() => window.__dbg.view.camera.fov);
  await p.mouse.down({ button: 'right' });
  await wait(600);
  const rs1 = await p.evaluate(() => ({ fov: window.__dbg.view.camera.fov, charge: window.__dbg.view.railCharge, scope: getComputedStyle(document.getElementById('rail-scope')).display, cd: window.__dbg.sim.players[0].cds[0] }));
  await p.screenshot({ path: `${SHOTS}/skill-rail.png` });
  shots.push(`${SHOTS}/skill-rail.png`);
  await p.mouse.down();
  await wait(60);
  const r2cd = await p.evaluate(() => window.__dbg.sim.players[0].cds[0]);
  await p.mouse.up();
  await wait(150);
  const rs3 = await skillState();
  await p.mouse.up({ button: 'right' });
  await wait(400);
  const fov2 = await p.evaluate(() => window.__dbg.view.camera.fov);
  ok(rs1.fov < fov0 - 20 && rs1.charge === 1 && rs1.scope === 'block' && rs1.cd <= 0 && r2cd <= 0 && rs3.cds[0] > 1 && rs3.looses === 0 && Math.abs(fov2 - fov0) < 1,
    `Rail Shot: holding RMB zooms from ${f(fov0, 0)} to ${f(rs1.fov, 0)} degrees and charges the bow (${rs1.charge}); nothing fires on LMB down, LMB up fires it (cooldown ${f(rs3.cds[0], 1)} s), the view opens again (${f(fov2, 0)})`);
  await wait(Math.ceil(rs3.cds[0] * 1000) + 300);
  await p.mouse.down({ button: 'right' });
  await wait(200);
  await p.mouse.up({ button: 'right' });
  await wait(200);
  const rs4 = await skillState();
  ok(rs4.cds[0] <= 0 && !rs4.area, `Rail Shot: RMB pressed and let go without LMB fires nothing (cooldown ${f(Math.max(0, rs4.cds[0]), 1)} s)`);
  // the right button in build mode closes it and casts no Rail Shot
  await K('b');
  await wait(200);
  await mid('right');
  await wait(200);
  const cd2 = await p.evaluate(() => [...window.__dbg.sim.players[0].cds]);
  s = await state(p);
  ok(!s.open && cd2[0] <= 0 && s.looses === 0, `a right click closes build mode (open ${s.open}) and Rail Shot stays ready (${f(Math.max(0, cd2[0]), 1)} s)`);

  // Escape closes build mode without pausing; the next Escape pauses
  await K('b');
  await wait(200);
  await K('Escape');
  await wait(250);
  const e1 = { ...(await state(p)), sheet: await shown(p, '#pause') };
  await wait(400);
  await K('Escape');
  await wait(250);
  const e2 = { ...(await state(p)), sheet: await shown(p, '#pause') };
  ok(!e1.open && !e1.paused && !e1.sheet && e2.paused && e2.sheet, `Escape: the first press closes build mode (paused ${e1.paused}), the second pauses (paused ${e2.paused}, sheet shown ${e2.sheet})`);
  await K('Escape');
  await wait(250);
  ok(!(await state(p)).paused, 'Escape again resumes');

  // U upgrades and X sells the tower under the crosshair
  await K('b');
  await wait(500);
  const at = await aimAt(p, cryoId);
  const u0 = await state(p);
  const upCost = await p.evaluate((id) => { const t = window.__dbg.sim.towerById(id); return t ? window.__dbg.sim.upCost(t) : -1; }, cryoId);
  const lineT = await lineText(p);
  await K('u');
  await wait(200);
  const u1 = await state(p);
  const lvl = await p.evaluate((id) => window.__dbg.sim.towerById(id)?.lvl, cryoId);
  const sellV = await p.evaluate((id) => { const t = window.__dbg.sim.towerById(id); return t ? window.__dbg.sim.sellValue(t) : -1; }, cryoId);
  await K('x');
  await wait(200);
  const x1 = await state(p);
  const gone = await p.evaluate((id) => !window.__dbg.sim.towerById(id), cryoId);
  ok(!!at && u0.tower === cryoId && lvl === 2 && u0.gold - u1.gold === upCost && gone && x1.gold - u1.gold === sellV && x1.towers === u1.towers - 1,
    `marked tower: line "${lineT}"; U took it to Mk ${lvl} for ${u0.gold - u1.gold} credits; X sold it for ${x1.gold - u1.gold} (sell value ${sellV})`);
  // the Spire the player stands on cannot be sold, and the reason is given
  const own = await p.evaluate(() => window.__dbg.sim.players[0].heroTower);
  const refused = await p.evaluate((id) => window.__dbg.act.sell(id), own);
  await wait(100);
  const toast = await p.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).pop() || '');
  ok(refused === false && /Spire/.test(toast) && (await p.evaluate((id) => !!window.__dbg.sim.towerById(id), own)), `selling the Spire she stands on is refused: "${toast}"`);
  // with no tower in the crosshair U upgrades the Spire the player stands on (the crosshair never marks that one),
  // in build mode and outside it
  await p.evaluate(() => { window.__dbg.sim.gold += 3000; });
  await frames(p);
  const spLvl = () => p.evaluate((id) => window.__dbg.sim.towerById(id)?.lvl, own);
  const sp0 = await spLvl(), upLabel = await p.evaluate(() => document.getElementById('bk-up').textContent), g0u = (await state(p)).gold;
  await K('u');
  await wait(200);
  const sp1 = await spLvl(), g1u = (await state(p)).gold;
  await K('b');
  await wait(200);
  await K('u');
  await wait(200);
  const sp2 = await spLvl();
  ok((await state(p)).tower === 0 && sp1 === sp0 + 1 && sp2 === sp1 + 1 && g0u > g1u && /Upgrade Spire \d+/.test(upLabel),
    `own Spire: the U label read "${upLabel}"; U in build mode took the Spire from Mk ${sp0} to Mk ${sp1} (${g0u - g1u} credits), U outside it to Mk ${sp2}`);

  // the free cursor aim mode: nothing captures the mouse and the cursor is hidden, so it cannot click the tower bar;
  // a click still builds on the hex under the crosshair
  await p.evaluate(() => { const s = document.getElementById('set-aim'); s.value = 'free'; s.dispatchEvent(new Event('change')); });
  await K('1');
  await wait(500);
  const fa = await aimAt(p, 'near');
  await wait(60);
  const fr0 = await state(p), pulse = await p.evaluate(() => window.__dbg.sim.cost('pulse'));
  const free = await p.evaluate(() => {
    const b = document.querySelector('#build .tw').getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { hidden: document.body.classList.contains('aimfree'), locked: !!document.pointerLockElement, bar: !!e?.closest('.tw') };
  });
  await mid();
  await wait(300);
  const fr1 = await state(p);
  ok(!!fa && free.hidden && !free.locked && !free.bar && fr1.towers === fr0.towers + 1 && fr0.gold - fr1.gold === pulse && fr1.looses === 0,
    `free cursor: cursor hidden ${free.hidden}, mouse captured ${free.locked}, the bar takes clicks ${free.bar}; a click built ${fr1.towers - fr0.towers} ${fr0.type} on (${fr0.cx},${fr0.cz}) for ${fr0.gold - fr1.gold} credits`);
  await K('b');
  await p.evaluate(() => { const s = document.getElementById('set-aim'); s.value = 'auto'; s.dispatchEvent(new Event('change')); });

  // 40 simulated seconds later, waves and all, the player is still on a Spire
  const ff = await p.evaluate(() => {
    const s = window.__dbg.sim, t0 = s.time;
    s.nextWaveIn = 2;
    let away = 0;
    for (let i = 0; i < 2400; i++) {
      if (s.players[0].pending.length) s.pickCard(0, 0);
      s.step(1 / 60);
      if (!s.players[0].heroActive) away++;
    }
    return { dt: s.time - t0, away, wave: s.wave, enemies: s.enemies.length, hero: s.players[0].heroActive, on: s.towerById(s.players[0].heroTower)?.type };
  });
  await wait(300);
  s = await state(p);
  ok(ff.dt > 39.9 && ff.away === 0 && ff.hero && ff.on === 'spire' && s.hero, `40 s: ${f(ff.dt, 1)} simulated seconds later (wave ${ff.wave}, ${ff.enemies} enemies) the player never left the Spire (${ff.away} steps away)`);

  // the Titan lands: the camera stays on the Spire, nothing calls an Overlink, and the player stays put
  await p.evaluate(() => { const s = window.__dbg.sim; while (s.players[0].pending.length) s.pickCard(0, 0); s.titanLeap(0); });
  const said = new Set();
  let blend = 1, walk = null;
  for (let i = 0; i < 50 && !walk; i++) {
    await wait(200);
    const q = await p.evaluate(() => ({ a: document.getElementById('announce').textContent, b: window.__dbg.view.heroBlend, ph: window.__dbg.sim.titan.phase, t: window.__dbg.sim.titan.t, hero: window.__dbg.sim.players[0].heroActive }));
    said.add(q.a); blend = Math.min(blend, q.b);
    if (q.ph === 'walk' && q.t > 3) walk = q;
  }
  const toasts = await p.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | '));
  ok(!!walk && walk.hero && blend > 0.99 && ![...said].some((a) => /Overlink/i.test(a)) && !/Overlink/i.test(toasts),
    `Titan: it landed and walks (${f(walk?.t ?? 0, 1)} s), the view never left the Spire (lowest blend ${f(blend, 2)}), announced: ${[...said].filter(Boolean).join(' | ')}`);

  // the run ends: Uplink mode keeps its own record, shown on the end sheet and on the map card, apart from the campaign's
  await p.evaluate(() => { const s = window.__dbg.sim; s.over = true; s.won = false; });
  await p.waitForFunction(() => !document.getElementById('end').classList.contains('hidden'), { timeout: 10000 });
  const end = await p.evaluate(() => {
    const st = [...document.getElementById('end-stats').children].map((e) => e.textContent), recs = JSON.parse(localStorage.getItem('beatspire')).records;
    const k = Object.keys(recs).find((x) => x.startsWith('overpass|'));
    return { rows: st, rec: k ? recs[k] : null, open: document.body.classList.contains('building') };
  });
  const row = end.rows.findIndex((x) => /Uplink mode/.test(x));
  await p.click('#e-menu');
  await wait(300);
  await p.click('#m-solo');
  await wait(300);
  const cardUp = await p.$eval('#map-row .mapcard[title="Overpass"] .rec', (e) => e.textContent);
  await p.click('#setup-mode [data-v="campaign"]');
  await wait(100);
  const cardCamp = await p.$eval('#map-row .mapcard[title="Overpass"] .rec', (e) => e.textContent);
  ok(row >= 0 && end.rec && end.rec.upWave >= 1 && end.rec.wave === 0 && !end.open && /Held/.test(cardUp) && /No record/.test(cardCamp),
    `records: end sheet "${end.rows[row]}: ${end.rows[row + 1]}", saved upWave ${end.rec?.upWave} and campaign wave ${end.rec?.wave}; the map card reads "${cardUp}" in Uplink mode and "${cardCamp}" in the campaign`);
  await p.close();
}

// ---------- touch ----------
{
  const p = await open({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const T = p.touchscreen;
  const tapOn = async (sel) => {
    const r = await p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, sel);
    if (r) await T.tap(r[0], r[1]);
    return !!r;
  };
  await p.evaluate(() => { window.__dbg.startGame('solo', { uplink: true }); });
  await onSpire(p);
  await wait(900);
  await p.evaluate(() => { window.__dbg.sim.nextWaveIn = 900; });
  // a first finger on the view switches the touch controls on (and only aims)
  let t = await T.touchStart(420, 160); await wait(40); await t.end();
  await wait(200);
  const btn ={ build: await shown(p, '#t-build'), exit: await shown(p, '#t-exit'), sell: await shown(p, '#t-bsell') };
  ok(btn.build && !btn.exit && !btn.sell, `touch: Build button shown ${btn.build}, Exit hidden ${!btn.exit}, Sell hidden ${!btn.sell}`);
  await tapOn('#t-build');
  await wait(400);
  let s = await state(p);
  const bar = await shown(p, '#bottom'), place = await p.evaluate(() => getComputedStyle(document.querySelector('#t-fire .place')).display !== 'none');
  ok(s.open && bar && place, `touch: Build opens build mode (${s.open}), the tower bar shows (${bar}), Draw reads Place (${place})`);
  await tapOn('#build .tw:nth-child(2)');
  await wait(300);
  s = await state(p);
  ok(s.type === 'cryo', `touch: tapping the second tower in the bar chooses ${s.type}`);
  const a = await aimAt(p, 'near');
  await wait(100);
  const b0 = await state(p);
  await p.screenshot({ path: `${SHOTS}/touch-build.png` });
  shots.push(`${SHOTS}/touch-build.png`);
  await tapOn('#t-fire');
  await wait(300);
  const b1 = await state(p);
  const built = await p.evaluate((cx, cz) => window.__dbg.sim.towers.find((t) => t.cx === cx && t.cz === cz), b0.cx, b0.cz);
  ok(!!a && b0.ok && b1.towers === b0.towers + 1 && built?.type === 'cryo' && b1.looses === 0 && b1.open,
    `touch: Place built a ${built?.type} on (${b0.cx},${b0.cz}), credits ${b0.gold} to ${b1.gold}, arrows loosed ${b1.looses}, build mode still open ${b1.open}`);
  await aimAt(p, built?.id);
  await wait(150);
  const sellShown = await shown(p, '#t-bsell');
  const g0 = (await state(p)).gold;
  await tapOn('#t-bsell');
  await wait(300);
  const s1 = await state(p);
  const gone = await p.evaluate((id) => !window.__dbg.sim.towerById(id), built?.id);
  ok(sellShown && gone && s1.gold > g0, `touch: Sell shows on the marked tower (${sellShown}) and sells it, credits ${g0} to ${s1.gold}`);
  // Upgrade: with the crosshair on the empty hex the tower stood on, it upgrades the player's own Spire
  await p.evaluate(() => { window.__dbg.sim.gold += 3000; });
  const mine = await p.evaluate(() => window.__dbg.sim.players[0].heroTower);
  const tl0 = await p.evaluate((id) => window.__dbg.sim.towerById(id)?.lvl, mine);
  const upShown = await shown(p, '#t-bup');
  await tapOn('#t-bup');
  await wait(300);
  const tl1 = await p.evaluate((id) => window.__dbg.sim.towerById(id)?.lvl, mine);
  ok(upShown && tl1 === tl0 + 1, `touch: Upgrade shows in build mode (${upShown}) and, with no tower marked, takes her Spire from Mk ${tl0} to Mk ${tl1}`);
  await tapOn('#t-build');
  await wait(200);
  ok(!(await state(p)).open && !(await shown(p, '#bottom')), 'touch: Build again closes build mode and the bar');
  // Rain: its area shows and Draw reads Cast; Cast lets it go
  const rc0 = await p.evaluate(() => window.__dbg.sim.players[0].cds[1]);
  await tapOn('#t-s1');
  await wait(200);
  const armedT = await p.evaluate(() => window.__dbg.view.skillMark.visible), castT = await shown(p, '#t-fire .cast');
  await tapOn('#t-fire');
  await wait(250);
  const rc1 = await p.evaluate(() => window.__dbg.sim.players[0].cds[1]), goneT = await p.evaluate(() => !window.__dbg.view.skillMark.visible);
  ok(armedT && castT && rc1 > rc0 + 1 && goneT, `touch: Rain shows its area (${armedT}) and Draw reads Cast (${castT}); Cast lets it go (cooldown ${f(rc1, 1)} s)`);
  await p.close();
}

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ') : ''));
await browser.close();
console.log('screenshots:\n' + shots.map((x) => '  ' + x).join('\n'));
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
