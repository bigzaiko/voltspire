// Screenshots of the menus and the landing page from a served build.
//   node tools/dev/ui-shots.mjs <outDir> [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] || 'ui-shots');
const base = process.argv[3] || 'http://localhost:5184';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true, protocolTimeout: 90000,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
});
const errors = [];
const open = async (path, vp) => {
  const p = await browser.newPage();
  if (vp) await p.setViewport(vp);
  p.on('pageerror', (e) => errors.push(path + ': ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(path + ': ' + m.text()); });
  await p.goto(base + path, { waitUntil: 'load' });
  return p;
};
const ready = (p) => p.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 60000 });
const click = (p, sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);
const snap = async (p, name) => { await new Promise((r) => setTimeout(r, 700)); await p.screenshot({ path: join(out, name + '.png') }); console.log(name); };

const g = await open('/play.html');
await ready(g);
await new Promise((r) => setTimeout(r, 1500));
await snap(g, 'menu');
await click(g, '#m-solo'); await snap(g, 'setup');
await click(g, '#setup-back');
await click(g, '#m-settings'); await snap(g, 'settings');
await click(g, '#s-back');
await click(g, '#m-music'); await snap(g, 'music');
await g.close();

const e = await open('/play.html');
await ready(e);
await click(e, '#m-editor'); await snap(e, 'editor');
await e.close();

const l = await open('/index.html', { width: 1440, height: 900 });
await snap(l, 'landing');
await l.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.3)); await snap(l, 'landing-2');
await l.close();
const m = await open('/index.html', { width: 390, height: 844, isMobile: true, hasTouch: true });
await snap(m, 'landing-phone');
await m.close();
const t = await open('/play.html', { width: 844, height: 390, isMobile: true, hasTouch: true });
await ready(t);
await new Promise((r) => setTimeout(r, 1000));
await snap(t, 'menu-phone');
await t.close();

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
