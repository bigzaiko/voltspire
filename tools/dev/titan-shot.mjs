// Capture the Titan's wave: bird view at landing, then the Uplink view while it walks.
//   node tools/dev/titan-shot.mjs <outDir> [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] || 'titan-shots'), base = process.argv[3] || 'http://localhost:5183';
mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, protocolTimeout: 120000, args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--window-size=1920,1080'], defaultViewport: { width: 1920, height: 1080 } });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(base + '/play.html?capture=1', { waitUntil: 'load' });
await p.waitForFunction('window.__volt', { timeout: 60000 });
const frames = (n, dt = 1 / 30) => p.evaluate((n, dt) => { for (let i = 0; i < n; i++) window.__volt.frame(dt); }, n, dt);
const info = () => p.evaluate(() => { const s = window.__volt.sim; return { wave: s.wave, phase: s.titan && s.titan.phase, danger: s.titan && +s.titan.danger.toFixed(2), arrive: s.titan && s.titan.wave, overlink: s.overlink, hero: s.players[0].heroActive, enemies: s.enemies.length, time: Math.round(s.time) }; });
await p.evaluate(() => window.__volt.demo(7, 60));
console.log('start', JSON.stringify(await info()));
// run the bot forward until the Titan is on the road
let st = await info();
for (let i = 0; i < 400 && st.phase !== 'landing' && st.phase !== 'walk'; i++) { await p.evaluate(() => { const V = window.__volt; for (let k = 0; k < 600; k++) V.frame(1 / 30); }); st = await info(); if (i % 10 === 0) console.log(JSON.stringify(st)); if (st.phase === 'dead') break; }
console.log('reached', JSON.stringify(st));
await p.screenshot({ path: join(out, 'a-landing.png') });
await frames(100);
console.log(JSON.stringify(await info()));
await p.screenshot({ path: join(out, 'b-after-impact.png') });
await frames(150);
console.log(JSON.stringify(await info()));
await p.screenshot({ path: join(out, 'c-walk.png') });
await frames(200);
console.log(JSON.stringify(await info()));
await p.screenshot({ path: join(out, 'd-walk2.png') });
await b.close();
