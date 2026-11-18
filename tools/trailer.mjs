// Records the BEATSPIRE trailer from the real game, frame by frame, on the GPU, with the game's own score and sounds.
//   node tools/trailer.mjs                     public/media/trailer.mp4 (1920 x 1080, 30 fps, about 42 s) and poster.jpg
//   SHOT=place,titan node tools/trailer.mjs    only some shots, frames and stills left in tools/trailer/frames for a look
// Needs the dev server (http://localhost:5183, or BASE=...) and ffmpeg. CRF=<n> changes the video quality (default 27, about 13 MB).
//
// The shots (scripted scenes from tools/trailer/scenes.mjs, Switchback seed 3 unless said otherwise):
//   intro     the attract screen's orbit over a bot-played board, title card
//   place     the build phase: a Pulse Turret picked from the bar, held over the deck (ghost, range, route pulse), placed
//   grow      the factory goes up step by step: mines, belts, the splitter, power, the pumpjack and its pipes, the tunnels
//   wave      a wave on the working base: the belts carry ore, every tower fires
//   specials  Bullet Storm, Thunderhead, Flash Freeze (ice shells) and a Barrage
//   colossus  a Colossus pushing down the middle road
//   titan     the Titan's leap from the city onto the gate, the impact, its walk past the factory
//   logo      the attract orbit again, closing card (the poster frame)
// Sound: every sound the frames trigger is logged with its time (window.__volt.sound.cueLog) and the whole soundtrack is
// rendered offline afterwards (score + effects, the "hot" ranges get the full score), then muxed with the frames.
import { mkdirSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { launch, openCapture, installHelpers, installLayout, installScenes } from './trailer/lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const FRAMES = join(ROOT, 'tools/trailer/frames/trailer');
const MEDIA = resolve(process.env.MEDIA || join(ROOT, 'public/media'));
const FPS = 30, DT = 1 / FPS;
const W = 1920, H = 1080;
const ONLY = process.env.SHOT ? process.env.SHOT.split(',') : null;
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(MEDIA, { recursive: true });

const browser = await launch(W, H, 1);
const page = await openCapture(browser);
await page.evaluate(installHelpers);
await page.evaluate(installLayout);
await installScenes(page);
await page.addStyleTag({ content: `
  #tr-cap { position: fixed; left: 0; right: 0; bottom: 22%; z-index: 90; text-align: center; pointer-events: none; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 84px; line-height: 1; letter-spacing: .12em; text-transform: uppercase; color: #efe9d6; text-shadow: 0 2px 0 #100e0c, 0 0 40px rgba(16,14,12,.95); opacity: 0; }
  #tr-cap small { display: block; margin-top: 16px; font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 500; letter-spacing: .3em; color: #f68b56; }
  #tr-cap.mid { bottom: 40%; font-size: 132px; font-family: 'Saira Stencil One', 'Barlow Condensed', sans-serif; font-weight: 400; color: #e3dc92; }
  #tr-fade { position: fixed; inset: 0; z-index: 95; background: #000; opacity: 0; pointer-events: none; }
  body.tr-clean #hud, body.tr-clean #vignette, body.tr-clean #flash, body.tr-clean #announce, body.tr-clean #prep { display: none !important; }
  #toasts, #tip, #tutor, #btn-pause, #btn-speed, #btn-full, #marks, #touch, #intel, #hints, #guide, #notes, #prep { display: none !important; }
  html, body { cursor: none !important; }
` });
await page.evaluate(() => {
  for (const id of ['tr-cap', 'tr-fade']) { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); }
  window.__tr = {
    cap(text, sub, mid) { const c = document.getElementById('tr-cap'); c.textContent = text || ''; if (sub) { const s = document.createElement('small'); s.textContent = sub; c.appendChild(s); } c.className = mid ? 'mid' : ''; },
  };
  window.__volt.sound.cueLog = [];
});

let frameNo = 0, clock = 0;
const hot = [];
const stills = {};

/**
 * One shot of `seconds`: setup(args) runs in the page, then per frame the string `each` (with i, n, u, args, V, C in
 * scope) and, from node, `node(i, n)` (mouse and keys), then one game frame. Sounds of the setup are dropped; those of
 * the frames are kept at the trailer's clock.
 */
async function shot(name, seconds, opts) {
  if (ONLY && !ONLY.includes(name)) return;
  const n = Math.round(seconds * FPS);
  console.log(`shot ${name}: ${n} frames`);
  await page.evaluate((clean) => document.body.classList.toggle('tr-clean', !!clean), opts.clean);
  const n0 = await page.evaluate(() => window.__volt.sound.cueLog.length);
  const info = await page.evaluate(opts.setup, opts.args || {});
  if (info) console.log('  ', JSON.stringify(info));
  await page.evaluate((n0, t) => { const S = window.__volt.sound; S.cueLog.length = n0; S.clock = t; }, n0, clock);
  await page.evaluate((c) => window.__tr.cap(c[0], c[1], c[2]), opts.caption || ['', '', false]);
  if (opts.hot) hot.push([clock + (opts.hot[0] || 0), clock + (opts.hot[1] || seconds)]);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const capA = opts.caption ? Math.min(1, Math.max(0, (u - 0.08) * 8)) * Math.min(1, Math.max(0, (0.92 - u) * 10)) : 0;
    const fade = Math.max(opts.fadeIn ? 1 - (i / FPS) / opts.fadeIn : 0, opts.fadeOut ? 1 - ((n - 1 - i) / FPS) / opts.fadeOut : 0, 0);
    if (opts.node) await opts.node(i, n);
    await page.evaluate((each, i, n, u, capA, fade, dt, args) => {
      document.getElementById('tr-cap').style.opacity = String(capA);
      document.getElementById('tr-fade').style.opacity = String(Math.min(1, fade));
      if (each) new Function('i', 'n', 'u', 'args', 'V', 'C', each)(i, n, u, args, window.__volt, window.__cap);
      window.__volt.frame(dt);
    }, opts.each || '', i, n, u, capA, fade, DT, opts.args || {});
    const file = join(FRAMES, `f${String(frameNo++).padStart(5, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 94 });
    if (opts.still && i === Math.round(n * opts.still[1])) stills[opts.still[0]] = file;
  }
  clock += seconds;
}
const ease = 'const e = (x) => x * x * (3 - 2 * x);';

await shot('intro', 4, {
  clean: true, fadeIn: 1.4, caption: ['The Static is coming', 'Hold the road. Feed the guns.', true],
  setup: () => { window.__cap.cam(0, 0, 48); window.__volt.attract(); window.__volt.view.setQuality('high'); },
});

// the build phase, HUD on: pick the Pulse Turret, sweep it over the deck to the tile by the belt, place it
let target = null;
await shot('place', 5, {
  caption: ['Place a turret', 'It fires only what the factory brings it'],
  setup: () => {
    const r = base(0.16); const C = window.__cap, V = window.__volt;
    hudNice(); V.sim.gold = 640;
    C.cam(6.5, 2.5, 30, 0.12); settle(0.5);
    return r;
  },
  node: async (i, n) => {
    if (i === 0) {
      await page.keyboard.press('1');
      target = await page.evaluate(() => { const [wx, wz] = cellXZ(16, 12), [x, y] = window.__volt.view.project(wx, 0.3, wz); return [x, y]; });
    }
    // from the bar up to the tile in the first 45 %, a moment's hold, the click at 70 %
    const u = i / (n - 1), k = Math.min(1, u / 0.45), e = k * k * (3 - 2 * k);
    if (u <= 0.7) await page.mouse.move(300 + (target[0] - 300) * e, 1000 + (target[1] - 1000) * e);
    if (i === Math.round(n * 0.7)) { await page.mouse.down(); await page.mouse.up(); }
    // a right click puts the tool down again
    if (i === Math.round(n * 0.85)) { await page.mouse.click(target[0], target[1], { button: 'right' }); await page.mouse.move(W - 4, 6); }
  },
  each: `C.cam(6.5 + u * 0.8, 2.5, 30 - u * 2, 0.12);`,
});

// the rest of the base goes up, a few pieces a second, the camera drifting round the factory pocket
await shot('grow', 6, {
  clean: true, caption: ['Build the factory', 'Mines, belts, power, pipes, tunnels'],
  setup: () => { const r = base(0.18, { lazy: true }); window.__growN = window.__rest.length; settle(0.2); return r; },
  each: `${ease} const left = window.__rest.length, want = Math.ceil(window.__growN * (1 - Math.min(1, u / 0.85))); if (left > want) buildNext(left - want);
    C.orbit(4 + u * 2, 0, 1, 33 - u * 4, -40 + u * 30, 40, 40);`,
});

await shot('wave', 5.5, {
  clean: true, caption: ['Feed the guns', 'Every tower fires what its supply line brings'], hot: [0, 5.5],
  setup: () => { battle(12, 29); settle(0.2); },
  each: `C.orbit(6.5 - u * 1.5, 0, 1.2, 30 - u * 3, -26 + u * 10, 36, 38);`,
});

await shot('specials', 5, {
  clean: true, caption: ['Fire the specials', 'Every tower hides one'], hot: [0, 5],
  setup: () => { battle(12, 33); settle(0.1); },
  each: `if (i === 6) special('pulse', true); if (i === 30) special('arc'); if (i === 52) special('cryo', true); if (i === 80) special('mortar'); if (i === 95) special('missile');
    C.orbit(7 - u * 4, 0.5, 2.5, 25, -8 + u * 20, 34, 40);`,
});

await shot('colossus', 4.5, {
  clean: true, caption: ['Every fifth wave', 'A Colossus'], hot: [0, 4.5],
  setup: () => { battle(10, 1); const b = waitFor('boss', 40); window.__volt.resync(); settle(0.1); return b; },
  each: `const e = V.sim.enemies.find((q) => q.type === 'boss') || { x: 0, z: 0 }; C.orbit(e.x + 1, 1.6, e.z, 20 - u * 3, 30 + u * 14, 22, 40);`,
});

await shot('titan', 9, {
  clean: true, caption: ['The Titan lands', 'Only the specials hurt it at full strength'], hot: [0, 9],
  setup: () => { base(); window.__volt.sim.wave = 21; window.__volt.sim.titanLeap(0); return true; },
  each: `const T = V.sim.titan, e = V.sim.enemies.find((q) => q.type === 'titan');
    if (e) window.__tz = e; const f = window.__tz;
    if (!f) C.orbit(-18, 6, -4, 46, 125, 18, 48);
    else C.orbit(f.x + 1, 5.5, f.z, 32 - u * 4, 125 - u * 10, 22, 46);
    for (const t of V.sim.towers) if (u > 0.65) t.stun = 0;
    if (i === 200) special('flame', true);`,
});

await shot('logo', 5.5, {
  clean: true, fadeOut: 1.6, caption: ['Beatspire', 'Play free in your browser', true], still: ['poster', 0.45],
  setup: () => { window.__cap.cam(0, 0, 48); window.__volt.attract(); },
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
    '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF || '27', '-maxrate', '3000k', '-bufsize', '6000k', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1920:1080:flags=lanczos:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-colorspace', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('wrote', out, (statSync(out).size / 1e6).toFixed(1) + ' MB');
  // the poster keeps the old size (1600 x 900)
  for (const [name, file] of Object.entries(stills)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'scale=1600:900:flags=lanczos', '-q:v', '3', join(MEDIA, name + '.jpg')]);
    console.log('wrote', name + '.jpg');
  }
  if (!process.env.KEEP) rmSync(FRAMES, { recursive: true, force: true });
} else {
  for (const [name, file] of Object.entries(stills)) copyFileSync(file, join(FRAMES, name + '.jpg'));
  console.log('test frames in', FRAMES);
}
