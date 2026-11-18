// The gallery and hero screenshots of BEATSPIRE (1920 x 1080 JPEG), rendered from the real game on the GPU.
//   node tools/shot.mjs                 every shot below, into public/media
//   node tools/shot.mjs factory,titan   some of them; OUT=<dir> writes them somewhere else (PNG=1: lossless PNG as well)
// Needs the dev server (http://localhost:5183, or BASE=...) and ffmpeg.
//
//   shot-factory   (og:image, landing) a mid game on Switchback: the scripted base (tools/trailer/scenes.mjs) feeding a firing defence
//   shot-build     the build phase: HUD, supply cues, a Pulse Turret ghost with its route pulse before the wave is called
//   shot-bird      (landing) a late wave from the game's own bird camera
//   shot-colossus  a Colossus pushing down the middle road through the defence
//   shot-titan     the Titan walking past the factory after its landing
//   shot-cryo      a Cryo Emitter's Flash Freeze on a crowd: ice shells
//   shot-cards     (landing) the level-up screen with three upgrade cards
//   shot-editor    the map editor with deposits and supply crates
//   shot-phone     a phone in landscape (844 x 390 at 3x, scaled to 1920 wide), touch HUD
// Every scene is deterministic: Switchback, seed 3, the same scripted base; waves are called by the script.
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { launch, openCapture, installHelpers, installLayout, installScenes, clean, BASE } from './trailer/lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(process.env.OUT || join(ROOT, 'public/media'));
const ALL = ['factory', 'build', 'bird', 'colossus', 'titan', 'cryo', 'cards', 'editor', 'phone'];
const only = process.argv[2] ? process.argv[2].split(',') : ALL;
for (const n of only) if (!ALL.includes(n)) { console.error('unknown shot: ' + n); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const TMP = join(ROOT, 'tools/trailer/frames/shots');
mkdirSync(TMP, { recursive: true });

/** PNG screenshot -> JPEG (ffmpeg -q:v 4: about 300-600 KB at 1920 x 1080) */
async function save(page, name, w = 1920) {
  const png = join(TMP, name + '.png');
  await page.screenshot({ path: png });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', `scale=${w}:-2:flags=lanczos`, '-q:v', '4', join(OUT, name + '.jpg')]);
  if (process.env.PNG) execFileSync('cp', [png, join(OUT, name + '.png')]);
  console.log(join(OUT, name + '.jpg'));
}
async function capturePage(browser) {
  const page = await openCapture(browser);
  await page.evaluate(installHelpers);
  await page.evaluate(installLayout);
  await installScenes(page);
  return page;
}

const browser = await launch(1920, 1080, 1);
try {
  let page = null;
  const game = async () => (page ||= await capturePage(browser));

  if (only.includes('factory')) {
    const p = await game();
    await clean(p);
    console.log(await p.evaluate(() => JSON.stringify(battle(12, 31))));
    // the turrets of the middle road in a Bullet Storm, an Arc Pylon's Thunderhead
    await p.evaluate(() => { __cap.orbit(6.5, 0, 1.2, 31, -24, 38, 38); settle(0.6); special('pulse', true); special('arc'); settle(0.5); });
    await save(p, 'shot-factory');
  }
  if (only.includes('build')) {
    const p = await game();
    await clean(p, false);
    // the base nearly done, before wave 4: time stands still, the cues show what will be supplied; the player holds a Pulse Turret over a free tile by the belt
    await p.evaluate(() => { base(0.82); __cap.wave(3); __volt.skip(240); __volt.resync(); __volt.sim.gold = 2400; __cap.cam(3, 2.5, 34, 0.22); hudNice(); settle(1); });
    await p.keyboard.press('1');
    const [x, y] = await p.evaluate(() => { const [wx, wz] = cellXZ(16, 11); const [x, y] = __volt.view.project(wx, 0.3, wz); return [x, y]; });
    await p.mouse.move(x - 40, y - 30); await p.mouse.move(x, y, { steps: 6 });
    await p.evaluate(() => settle(0.8));
    await save(p, 'shot-build');
    await p.keyboard.press('Escape');
    await p.mouse.move(5, 5);
  }
  if (only.includes('cards')) {
    const p = await game();
    await clean(p, false);
    await p.evaluate(() => {
      battle(7, 30); const s = __volt.sim;
      __cap.cam(4, 1.5, 40, 0); hudNice(); settle(0.5);
      s.opts.pauseOnCards = true; s.players[0].pending = [['p_crit', 'bp_lance', 'c_deep']];
      settle(0.6);
    });
    await new Promise((r) => setTimeout(r, 700));
    await p.evaluate(() => settle(0.1));
    await save(p, 'shot-cards');
    await p.evaluate(() => { __volt.sim.players[0].pending = []; __volt.sim.opts.pauseOnCards = false; });
  }
  if (only.includes('bird')) {
    const p = await game();
    await clean(p);
    await p.evaluate(() => { battle(17, 21); __cap.cam(2, 1.5, 47, 0); settle(1.2); });
    await save(p, 'shot-bird');
  }
  if (only.includes('colossus')) {
    const p = await game();
    await clean(p);
    const b = await p.evaluate(() => { battle(10, 1); return waitFor('boss', 46); });
    console.log('colossus', JSON.stringify(b));
    await p.evaluate(() => { __volt.resync(); const e = __volt.sim.enemies.find((q) => q.type === 'boss'); __cap.orbit(e.x + 1, 1.6, e.z, 20, 35, 30, 40); settle(1.2); const f = __volt.sim.enemies.find((q) => q.type === 'boss'); __cap.orbit(f.x + 1, 1.6, f.z, 20, 35, 30, 40); settle(0.1); });
    await save(p, 'shot-colossus');
  }
  if (only.includes('titan')) {
    const p = await game();
    await clean(p);
    const t = await p.evaluate(() => { base(); __volt.sim.wave = 21; return titan(15); });
    console.log('titan', JSON.stringify(t));
    await p.evaluate(() => { const e = __volt.sim.enemies.find((q) => q.type === 'titan'); __cap.orbit(e.x + 1, 5.5, e.z, 30, 125, 22, 46); settle(0.2); });
    await save(p, 'shot-titan');
  }
  if (only.includes('cryo')) {
    const p = await game();
    await clean(p);
    await p.evaluate(() => {
      battle(12, 1);
      const s = __volt.sim, c = s.towers.find((t) => t.type === 'cryo');
      // run on until a crowd is in its reach, then freeze it
      for (let i = 0; i < 240; i++) { if (s.enemies.filter((e) => e.alive && Math.hypot(e.x - c.x, e.z - c.z) < 6).length >= 7) break; __volt.skip(0.25); }
      __volt.resync(); settle(0.3); special('cryo'); settle(0.9);
      __cap.orbit(c.x + 0.5, 1, c.z - 0.5, 17, 30, 34, 40); settle(0.05);
    });
    await save(p, 'shot-cryo');
  }
  if (page) { await page.close(); page = null; }

  if (only.includes('editor')) {
    // the dev page (no capture hook): menu -> Map editor
    const p = await browser.newPage();
    await p.evaluateOnNewDocument(() => { window.WebSocket = class { constructor() { this.readyState = 0; } addEventListener() {} removeEventListener() {} send() {} close() {} }; });
    await p.goto(BASE + '/play.html', { waitUntil: 'load' });
    await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 120000 });
    await p.evaluate(() => document.getElementById('m-editor').click());
    await new Promise((r) => setTimeout(r, 800));
    // start from Switchback: its roads, core, wreckage and the deposits laid out for it
    await p.evaluate(() => { const b = [...document.querySelectorAll('#editor button')].find((q) => q.textContent.trim().toLowerCase() === 'switchback'); b?.click(); });
    await new Promise((r) => setTimeout(r, 600));
    await p.keyboard.press('r');
    await new Promise((r) => setTimeout(r, 600));
    await save(p, 'shot-editor');
    await p.close();
  }
  if (only.includes('phone')) {
    const p = await browser.newPage();
    await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true });
    await p.evaluateOnNewDocument(() => { window.WebSocket = class { constructor() { this.readyState = 0; } addEventListener() {} removeEventListener() {} send() {} close() {} }; });
    await p.setBypassCSP(true);
    await p.goto(BASE + '/play.html?capture=1', { waitUntil: 'load' });
    await p.waitForFunction('window.__volt', { timeout: 120000 });
    await p.evaluate(installHelpers); await p.evaluate(installLayout); await installScenes(p);
    await p.evaluate(() => { battle(12, 30); __cap.cam(5, 1.5, 30, 0.1); hudNice(); settle(1); });
    await save(p, 'shot-phone', 1920);
    await p.close();
  }
} finally {
  await browser.close();
  if (!process.env.KEEP) rmSync(TMP, { recursive: true, force: true });
}
