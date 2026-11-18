// Captures of the menus and HUD states that are hard to reach by hand: the map picker, the Music sheet,
// the Titan bar, its landing and walk with the towers stunned, a jammed tower, and the F3 diagnostics.
//   node tools/dev/hud-shots.mjs <outDir> [baseUrl]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] || 'hud-shots');
const base = process.argv[3] || 'http://localhost:5183';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true, protocolTimeout: 120000,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--headless=new', '--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
});
const errors = [];
const open = async (vp) => {
  const p = await browser.newPage();
  if (vp) await p.setViewport(vp);
  // the dev server reloads the page when a source file changes: a socket that never connects keeps the run in one piece
  await p.evaluateOnNewDocument(() => { window.WebSocket = class { constructor() { this.readyState = 0; } addEventListener() {} removeEventListener() {} send() {} close() {} }; });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base + '/play.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden') && window.__dbg, { timeout: 60000 });
  return p;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (p, sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);
const snap = async (p, name, ms = 500) => { await wait(ms); await p.screenshot({ path: join(out, name + '.png') }); console.log(name); };
const fits = (p, id) => p.evaluate((id) => { const o = document.getElementById(id), s = o.firstElementChild.getBoundingClientRect(); return { sheet: Math.round(s.height), view: innerHeight, scrolls: o.scrollHeight > o.clientHeight + 1 }; }, id);

// 1. the run setup at three window sizes: the sheet has to fit, with the grid scrolling inside it
for (const [w, h] of [[1600, 900], [1280, 720], [1920, 1080]]) {
  const p = await open({ width: w, height: h });
  await click(p, '#m-solo');
  await wait(300);
  const all = await fits(p, 'setup');
  if (w === 1600) await snap(p, 'setup-all');
  await click(p, '#map-tier [data-v="3"]');
  const one = await fits(p, 'setup');
  const cards = await p.evaluate(() => [...document.querySelectorAll('.mapcard')].filter((c) => !c.classList.contains('hidden')).length);
  if (w === 1280) await snap(p, 'setup-complex-720');
  await click(p, '#setup-src [data-v="generated"]');
  await wait(200);
  const gen = await fits(p, 'setup');
  if (w === 1600) await snap(p, 'setup-generated');
  console.log(`setup ${w}x${h}: sheet ${all.sheet} / ${one.sheet} / ${gen.sheet} px of ${all.view}, page scrolls: ${all.scrolls || one.scrolls || gen.scrolls}, complex maps shown: ${cards}`);
  if (all.scrolls || one.scrolls || gen.scrolls || all.sheet !== one.sheet || all.sheet !== gen.sheet) errors.push(`setup sheet at ${w}x${h} moves or overflows`);
  await p.close();
}

// 2. Music sheet and Settings
{
  const p = await open();
  await click(p, '#m-music'); await snap(p, 'music');
  await click(p, '#mu-back');
  await click(p, '#m-settings'); await snap(p, 'settings');
  await p.close();
}

// 3. a run: Titan warning, landing and walk (towers stunned), a jammed tower, the diagnostics
{
  const p = await open();
  await p.evaluate(() => { window.__dbg.startGame('solo'); });
  await wait(1500);
  await p.evaluate(() => {
    const s = window.__dbg.sim;
    s.gold = 5000;
    for (const [t, cx, cz] of [['pulse', 10, 8], ['pulse', 12, 11], ['arc', 14, 7]]) for (let d = 0; d < 6 && !s.build(t, cx + d, cz); d++);
    s.titan.phase = 'warn'; s.titan.wave = s.wave + 2; s.titan.danger = 0.62;
    const t = s.towers[0];
    if (t) t.jam = 30;
  });
  await p.mouse.click(800, 450);
  await p.evaluate(() => { const s = window.__dbg.sim, t = s.towers.find((x) => x.jam > 0); if (t) { const [x, y] = window.__dbg.view.project(t.x, 0.5, t.z); window.__pick = [x, y]; } });
  const pick = await p.evaluate(() => window.__pick);
  if (pick) await p.mouse.click(pick[0], pick[1]);
  await p.keyboard.press('F3');
  await snap(p, 'titan-warn-jam', 1300);
  await p.evaluate(() => { const s = window.__dbg.sim; s.titanLeap(0); });
  await snap(p, 'titan-landing', 1200);
  await snap(p, 'titan-walk', 3400);
  const state = await p.evaluate(() => { const s = window.__dbg.sim; return { phase: s.titan.phase, stunned: s.towers.filter((t) => t.stun > 0).length, bar: document.getElementById('titan-label').textContent }; });
  console.log('after the landing:', JSON.stringify(state));
  await p.close();
}

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no errors');
process.exit(errors.length ? 1 : 0);
