// The mouse look measured with a real input device: a virtual mouse (uinput) is moved at set speeds, the movement goes
// through the desktop's pointer handling and a visible browser like a hand's would, and the script reads how far the
// Uplink view turned. Needs write access to /dev/uinput, python-evdev and a running dev server. It opens a full-screen
// browser window and captures the pointer for about half a minute: do not touch the mouse meanwhile.
//   node tools/dev/real-mouse-test.mjs [baseUrl]      (AIM=free tests the free-cursor mode)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const helper = new URL('./vmouse.py', import.meta.url).pathname;
const base = process.argv[2] || 'http://localhost:5183';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const free = process.env.AIM === 'free';

const py = spawn('python3', [helper], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: py.stdout });
const queue = [];
lines.on('line', (l) => { const r = queue.shift(); if (r) r(l); });
const next = () => new Promise((r) => queue.push(r));
const cmd = async (c) => { const p = next(); py.stdin.write(c + '\n'); return p; };
await next(); // "ready"

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable', headless: false, defaultViewport: null, protocolTimeout: 120000,
  args: ['--kiosk', '--no-first-run', '--no-default-browser-check', '--mute-audio'],
});
let code = 0;
try {
  const p = (await browser.pages())[0];
  await p.goto(base + '/play.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden') && window.__dbg, { timeout: 60000 });
  await p.evaluate(() => {
    window.__dbg.startGame('solo'); window.__dbg.view.skipIntro?.();
    window.__moves = 0; addEventListener('mousemove', () => { window.__moves++; }, true);
  });
  await wait(1500);
  // is the cursor over the page? only then is a click safe
  await cmd('move 12 200 1'); await cmd('move 12 200 -1'); await wait(300);
  if (!(await p.evaluate(() => window.__moves))) throw new Error('the page saw no mouse movement: the cursor is not over the test window, no click was sent');
  const hero = () => p.evaluate(() => {
    const s = window.__dbg.sim, pl = s.players[0];
    s.opts.pauseOnCards = false;
    if (!pl.heroActive) { pl.energy = 100; window.__dbg.act.hero(s.towers.find((x) => x.type === 'spire').id); }
    pl.heroTime = pl.heroDur;
  });
  if (free) await p.evaluate(() => { const s = document.getElementById('set-aim'); s.value = 'free'; s.dispatchEvent(new Event('change')); });
  await hero(); await wait(600);
  await cmd('click left');
  if (!free) await p.waitForFunction(() => !!document.pointerLockElement, { timeout: 4000 });
  await wait(600);
  const state = () => p.evaluate((free) => ({ yaw: window.__dbg.view.yaw, locked: !!document.pointerLockElement !== free, hero: window.__dbg.sim.players[0].heroActive }), free);
  if (free) console.log('free cursor: captured ' + (await p.evaluate(() => !!document.pointerLockElement)) + ', cursor hidden ' + (await p.evaluate(() => document.body.classList.contains('aimfree') && getComputedStyle(document.getElementById('game') || document.body).cursor)) + ', hint "' + (await p.evaluate(() => document.getElementById('lock-hint').textContent)) + '"');
  const sens = await p.evaluate(() => +document.getElementById('set-sens').value);
  const per = 0.0022 * sens / 100;
  console.log(`${free ? 'free cursor' : 'pointer captured'}, sensitivity ${sens} %. Turn per mouse count if nothing were lost: ${(per * 180 / Math.PI).toFixed(3)} deg`);
  const speeds = [[30, 10, 'very slow, 10 counts/s'], [120, 40, 'slow, 40 counts/s'], [300, 300, 'medium, 300 counts/s'], [600, 800, 'fast, 800 counts/s']];
  let dir = 1;
  for (const mode of free ? ['even'] : ['system', 'even', 'linear']) {
    await p.evaluate((m) => { const s = document.getElementById('set-curve'); s.value = m; s.dispatchEvent(new Event('change')); }, mode);
    console.log(`--- Mouse response: ${mode} ---`);
    for (const [counts, rate, label] of speeds) {
      await hero(); await wait(350);
      const a = await state();
      await cmd(`move ${counts} ${rate} ${dir}`);
      await wait(450);
      const b = await state();
      const got = Math.abs(b.yaw - a.yaw) / per;
      console.log(`${label.padEnd(24)} ${String(counts).padStart(4)} counts -> turned as ${got.toFixed(1).padStart(6)} counts  (${(got / counts * 100).toFixed(0).padStart(3)} %)${a.locked && b.locked && a.hero && b.hero ? '' : '   [capture or Uplink lost during this step]'}`);
      dir = -dir;
    }
  }
  await p.evaluate(() => { for (const [id, v] of [['set-curve', 'even'], ['set-aim', 'auto']]) { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change')); } });
} catch (e) { console.log('FAILED: ' + e.message); code = 1; }
await browser.close();
py.stdin.write('quit\n');
process.exit(code);
