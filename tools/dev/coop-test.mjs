// Two browser pages against a served build: host a co-op room, join it, build as the guest, compare both HUDs.
//   node tools/dev/coop-test.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
const base = process.argv[2] || 'http://localhost:5184';
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, protocolTimeout: 90000, args: ['--no-sandbox', '--mute-audio', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 720 } });
const errs = [];
const open = async (tag) => { const p = await b.newPage(); p.on('pageerror', (e) => errs.push(tag + ': ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(tag + ': ' + m.text()); }); await p.goto(base + '/play.html'); await p.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 60000 }); return p; };
const A = await open('host'), B = await open('guest');
const T = (p, id) => p.evaluate((id) => document.getElementById(id)?.textContent ?? '(missing)', id);
const click = async (p, sel) => { await p.bringToFront(); await p.evaluate((s) => document.querySelector(s).click(), sel); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await click(A, '#m-coop'); await click(A, '#l-host');
await A.waitForFunction(() => document.getElementById('l-code').textContent.length === 6, { timeout: 25000 });
const code = await T(A, 'l-code'); console.log('room', code);
await click(B, '#m-coop'); await B.evaluate((c) => { document.getElementById('l-input').value = c; }, code); await click(B, '#l-join');
await B.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'), { timeout: 30000 });
await wait(5000);
console.log('gold host/guest before:', await T(A, 'gold'), '/', await T(B, 'gold'));
// guest builds a pulse turret near the middle of the board
await B.bringToFront();
await B.keyboard.press('1');
for (const [x, y] of [[520, 300], [600, 380], [700, 300], [460, 420]]) { await B.mouse.move(x, y); await B.mouse.down(); await B.mouse.up(); await wait(400); }
await wait(2500);
const gb = await T(B, 'gold');
await A.bringToFront(); await wait(1500);
console.log('gold host/guest after guest build:', await T(A, 'gold'), '/', gb);
await click(A, '#btn-wave');
await wait(9000);
const wa = await T(A, 'wave'), la = await T(A, 'lives');
await B.bringToFront(); await wait(1500);
console.log('wave host/guest:', wa, '/', await T(B, 'wave'), '| core host/guest:', la, '/', await T(B, 'lives'));
await A.close();
await B.bringToFront(); await wait(14000);
console.log('guest after host left:', await T(B, 'end-title'), '-', await T(B, 'end-sub'));
await b.close();
console.log(errs.length ? 'ERRORS:\n' + [...new Set(errs)].slice(0, 12).join('\n') : 'no console errors');
