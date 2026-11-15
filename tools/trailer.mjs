// Records the VOLTSPIRE trailer from the real game, frame by frame, with headless Chromium.
//   node tools/trailer.mjs            (needs the dev server on http://localhost:5183 and ffmpeg)
// Output: public/media/trailer.mp4, poster.jpg and the landing-page screenshots.
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FRAMES = join(ROOT, 'tools/trailer/frames');
const MEDIA = join(ROOT, 'public/media');
const BASE = process.env.BASE || 'http://localhost:5183';
const FPS = 30, DT = 1 / FPS;
const W = 1920, H = 1080;
const ONLY = process.env.SHOT ? process.env.SHOT.split(',') : null; // e.g. SHOT=uplink for a quick test
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(MEDIA, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`, ...(process.env.CHROME_FLAGS || '--use-gl=angle --use-angle=gl --ignore-gpu-blocklist').split(' ')],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
// the recorder injects a style tag and small scripts; a production build's CSP would block them
await page.setBypassCSP(true);
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(BASE + '/play.html?capture=1', { waitUntil: 'load' });
await page.waitForFunction('window.__volt', { timeout: 60000 });
await page.addStyleTag({ content: `
  #tr-cap { position: fixed; left: 0; right: 0; bottom: 24%; z-index: 90; text-align: center; pointer-events: none; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 84px; line-height: 1; letter-spacing: .12em; text-transform: uppercase; color: #efe9d6; text-shadow: 0 2px 0 #100e0c, 0 0 40px rgba(16,14,12,.95); opacity: 0; }
  #tr-cap small { display: block; margin-top: 16px; font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 500; letter-spacing: .3em; color: #f68b56; }
  #tr-cap.mid { bottom: 40%; font-size: 132px; font-family: 'Saira Stencil One', 'Barlow Condensed', sans-serif; font-weight: 400; color: #e3dc92; }
  #tr-fade { position: fixed; inset: 0; z-index: 95; background: #000; opacity: 0; pointer-events: none; }
  body.tr-clean #hud, body.tr-clean #vignette { display: none !important; }
  #toasts, #tip, #tutor, #btn-pause, #btn-speed, #btn-full, #bottom, #marks, #touch { display: none !important; }
` });
await page.evaluate(() => {
  for (const id of ['tr-cap', 'tr-fade', 'tr-bars']) { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); }
  window.__tr = {
    cap(text, sub, mid) { const c = document.getElementById('tr-cap'); c.textContent = text || ''; if (sub) { const s = document.createElement('small'); s.textContent = sub; c.appendChild(s); } c.className = mid ? 'mid' : ''; },
  };
});

let frameNo = 0, clock = 0;
const hot = [];
const stills = {};
const ease = (u) => u * u * (3 - 2 * u);

/** Run one shot: `frames` frames; per-frame hook `each` runs inside the page with (i, n, args). */
async function shot(name, seconds, opts) {
  if (ONLY && !ONLY.includes(name)) return;
  const n = Math.round(seconds * FPS);
  console.log(`shot ${name}: ${n} frames`);
  await page.evaluate((clean) => document.body.classList.toggle('tr-clean', !!clean), opts.clean);
  await page.evaluate(opts.setup, opts.args || {});
  await page.evaluate((t) => { window.__volt.sound.clock = t; }, clock);
  await page.evaluate((c) => window.__tr.cap(c[0], c[1], c[2]), opts.caption || ['', '', false]);
  if (opts.hot) hot.push([clock + (opts.hot[0] || 0), clock + (opts.hot[1] || seconds)]);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    // caption + fade envelopes
    const capA = opts.caption ? Math.min(1, Math.max(0, (u - 0.08) * 8)) * Math.min(1, Math.max(0, (0.92 - u) * 10)) : 0;
    const fade = Math.max(opts.fadeIn ? 1 - (i / FPS) / opts.fadeIn : 0, opts.fadeOut ? 1 - ((n - 1 - i) / FPS) / opts.fadeOut : 0, 0);
    await page.evaluate((each, i, n, u, capA, fade, dt, args) => {
      document.getElementById('tr-cap').style.opacity = String(capA);
      document.getElementById('tr-fade').style.opacity = String(Math.min(1, fade));
      if (each) new Function('i', 'n', 'u', 'args', 'V', each)(i, n, u, args, window.__volt);
      window.__volt.frame(dt);
    }, opts.each || '', i, n, u, capA, fade, DT, opts.args || {});
    const file = join(FRAMES, `f${String(frameNo++).padStart(5, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 93 });
    if (opts.still && i === Math.round(n * opts.still[1])) stills[opts.still[0]] = file;
  }
  clock += seconds;
}

// start the bot's uplink at frame `at` and keep it alive until `tail` frames before the end
const UPLINK = `
  const p = V.sim.players[0];
  if (i === args.at) p.energy = 100;
  if (p.heroActive && i < n - args.tail) { p.heroTime = Math.max(p.heroTime, 3); }
`;

await shot('intro', 5, {
  clean: true, fadeIn: 1.6, caption: ['Nyx-9, 2187', 'The Static is coming', true],
  setup: () => { window.__volt.attract(); },
});
await shot('deploy', 6, {
  caption: ['Raise the grid', 'Eleven towers. Every tile counts.'],
  setup: () => { const V = window.__volt; V.demo(11, 0, 'crossfire'); V.sim.gold = 900; V.view.cam.x = 0; V.view.cam.z = 2; V.view.cam.dist = 56; },
  each: `V.view.cam.dist = 56 - u * 12;`,
});
await shot('battle', 6.5, {
  caption: ['Hold the line', 'A Colossus marches every fifth wave'], still: ['shot-bird', 0.55],
  setup: () => { const V = window.__volt; V.demo(7, 352, 'overpass'); V.view.cam.x = 4; V.view.cam.z = 1; V.view.cam.dist = 46; },
  each: `V.view.cam.x = 4 - u * 7; V.view.cam.dist = 46 - u * 9;`,
});
await shot('cards', 4, {
  caption: ['Draft your power', 'Blueprints, tower upgrades, hero skills'], still: ['shot-cards', 0.6],
  setup: () => {
    const V = window.__volt; V.demo(7, 300); V.takeover();
    for (const t of ['arc', 'mortar', 'rail', 'beacon']) V.sim.unlocked.add(t);
    V.sim.players[0].pending = [['p_crit', 'arcarrow', 'capbank']];
  },
});
await shot('uplink', 13, {
  caption: ['Take the Spire', 'Uplink and fight it yourself'], hot: [1.2, 13], still: ['shot-hero', 0.5],
  setup: () => { const V = window.__volt; V.demo(7, 372); V.view.cam.x = -4; V.view.cam.z = 2; V.view.cam.dist = 40; },
  each: UPLINK, args: { at: 12, tail: 30 },
});
await shot('specials', 9, {
  caption: ['Shoot the node', 'Every tower hides a special'], hot: [0.8, 9],
  setup: () => { const V = window.__volt; V.demo(21, 640, 'highline'); for (const t of V.sim.towers) if (t.type !== 'spire') t.charge = 1; V.view.cam.x = 0; V.view.cam.z = 2; V.view.cam.dist = 42; },
  each: UPLINK, args: { at: 6, tail: 20 },
});
await shot('sectors', 5.5, {
  caption: ['No two sectors alike', 'Generated maps, bridges, three difficulties'],
  setup: () => { const V = window.__volt; V.demo(5, 420, 'gen-3-4242'); V.view.cam.x = 6; V.view.cam.z = 2; V.view.cam.dist = 58; },
  each: `V.view.cam.x = 6 - u * 12; V.view.cam.dist = 58 - u * 14;`,
});
await shot('logo', 6, {
  clean: true, fadeOut: 1.8, caption: ['Voltspire', 'Play free in your browser. Solo, co-op or 1 v 1.', true], still: ['poster', 0.4],
  setup: () => { window.__volt.attract(); },
});

const total = clock;
console.log(`frames: ${frameNo}, ${total.toFixed(1)}s - rendering soundtrack`);
const wav = await page.evaluate((s, h) => window.__volt.renderAudio(s, h), total, hot);
const wavPath = join(FRAMES, 'audio.wav');
writeFileSync(wavPath, Buffer.from(wav, 'base64'));
await browser.close();

if (!ONLY) {
  const out = join(MEDIA, 'trailer.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(FRAMES, 'f%05d.jpg'), '-i', wavPath,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF || '25', '-pix_fmt', 'yuv420p', '-vf', 'scale=1600:900:flags=lanczos',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('wrote', out);
  for (const [name, file] of Object.entries(stills)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-q:v', '3', join(MEDIA, name + '.jpg')]);
    console.log('wrote', name + '.jpg');
  }
} else {
  for (const [name, file] of Object.entries(stills)) copyFileSync(file, join(FRAMES, name + '.jpg'));
  console.log('test frames in', FRAMES);
}
