// Capture three 1920x1080 screenshots of VOLTSPIRE with headless Chromium.
//   node tools/shot.mjs <outDir> [baseUrl] [quality]
// Needs the Vite dev server (default http://localhost:5183) to be running.
// Uses the deterministic capture mode (play.html?capture=1 -> window.__volt).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] || 'shots');
const base = process.argv[3] || 'http://localhost:5183';
const quality = process.argv[4] || 'high';
const only = process.env.SHOTS ? process.env.SHOTS.split(',') : ['bird', 'hero', 'menu'];
mkdirSync(out, { recursive: true });

const FLAGS = (process.env.CHROME_FLAGS || '--use-gl=angle --use-angle=gl --ignore-gpu-blocklist').split(' ');

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--window-size=1920,1080', ...FLAGS],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.error('[' + m.type() + ']', m.text()); });
  await page.goto(base + '/play.html?capture=1', { waitUntil: 'load' });
  await page.waitForFunction('window.__volt', { timeout: 60000 });
  const info = await page.evaluate((q) => {
    const v = window.__volt.view;
    v.setQuality(q);
    const gl = v.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }, quality);
  console.log('renderer:', info);
  const frames = (n, dt = 1 / 30) => page.evaluate((n, dt) => { for (let i = 0; i < n; i++) window.__volt.frame(dt); }, n, dt);
  const time = (n) => page.evaluate((n) => {
    const v = window.__volt.view, gl = v.renderer.getContext();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) window.__volt.frame(1 / 60);
    gl.finish(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return (performance.now() - t0) / n;
  }, n);
  const snap = async (name) => { const p = join(out, name + '.png'); await page.screenshot({ path: p }); console.log(p); };

  if (only.includes('bird')) {
    await page.evaluate(() => window.__volt.demo(7, 330));
    // keep the bot from triggering the Uplink so this stays a bird-view shot
    for (let i = 0; i < 10; i++) { await page.evaluate(() => { window.__volt.sim.players[0].energy = 0; }); await frames(10); }
    await snap('bird');
    if (process.env.TIME) console.log('bird ms/frame:', (await time(60)).toFixed(2));
  }
  if (only.includes('hero')) {
    await page.evaluate(() => window.__volt.demo(7, 330));
    await frames(30);
    let on = false;
    for (let i = 0; i < 60 && !on; i++) {
      await page.evaluate(() => { window.__volt.sim.players[0].energy = 100; });
      await frames(10);
      on = await page.evaluate(() => !!window.__volt.sim.players[0].heroActive);
    }
    if (!on) console.error('hero mode did not trigger');
    for (let i = 0; i < 9; i++) {
      await page.evaluate(() => { const p = window.__volt.sim.players[0]; if (p.heroActive) { p.heroTime = 60; p.heroDur = 60; } });
      await frames(10);
    }
    await new Promise((r) => setTimeout(r, 900)); // let the DOM screen-flash fade
    await frames(2);
    await snap('hero');
    if (process.env.TIME) console.log('hero ms/frame:', (await time(60)).toFixed(2));
  }
  if (only.includes('menu')) {
    await page.evaluate(() => window.__volt.menu());
    await frames(90);
    await snap('menu');
  }
} finally {
  await browser.close();
}
