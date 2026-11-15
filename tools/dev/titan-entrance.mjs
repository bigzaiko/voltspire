// Check the Titan's entrance as a player sees it: camera swing, slow motion, automatic Uplink.
//   node tools/dev/titan-entrance.mjs <outDir> [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] || 'titan-entrance'), base = process.argv[3] || 'http://localhost:5183';
mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, protocolTimeout: 180000, args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--window-size=1920,1080'], defaultViewport: { width: 1920, height: 1080 } });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(base + '/play.html?capture=1', { waitUntil: 'load' });
await p.waitForFunction('window.__volt', { timeout: 60000 });
await p.evaluate(() => {
  const V = window.__volt; V.demo(7, 560);
  for (let i = 0; i < 1500 && !(V.sim.titan.phase === 'warn' && V.sim.wave === V.sim.titan.wave - 1 && V.sim.queue.length === 0); i++) V.skip(0.5);
  V.resync(); V.takeover(); V.sim.opts.pauseOnCards = false; V.sim.players[0].pending = [];
  V.view.cam.x = 12; V.view.cam.z = 4; V.view.cam.dist = 34;   // the player is looking somewhere else
  V.sim.startWave();
});
const info = () => p.evaluate(() => { const V = window.__volt, s = V.sim, c = V.view.cam; return { phase: s.titan.phase, t: +s.titan.t.toFixed(2), hero: s.players[0].heroActive, cam: [+c.x.toFixed(1), +c.z.toFixed(1), +c.dist.toFixed(1)], enemies: s.enemies.length, stunned: s.towers.filter((t) => t.stun > 0).length }; });
let real = 0;
const run = async (seconds) => { const n = Math.round(seconds * 30); await p.evaluate((n) => { for (let i = 0; i < n; i++) window.__volt.frame(1 / 30); }, n); real += seconds; };
for (const [name, secs] of [['a-leap', 1.2], ['b-before-impact', 1.6], ['c-impact', 1.6], ['d-after', 2.0], ['e-uplink', 3.0]]) {
  await run(secs);
  console.log(name, 'real', real.toFixed(1) + 's', JSON.stringify(await info()));
  await p.screenshot({ path: join(out, name + '.png') });
}
await b.close();
