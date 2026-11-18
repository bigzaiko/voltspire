// Shared helpers of the capture scripts (tools/shot.mjs, tools/previews.mjs, tools/trailer.mjs).
// Headless Chromium on the real GPU (NVIDIA through ANGLE/GL); CPU=1 falls back to SwiftShader for functional runs only.
import puppeteer from 'puppeteer-core';

export const BASE = process.env.BASE || 'http://localhost:5183';
export const GPU_FLAGS = ['--headless=new', '--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'];
export const CPU_FLAGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];

/** Launch Chromium at w x h CSS pixels (scale = device pixel ratio). */
export async function launch(w, h, scale = 1, extra = {}) {
  const flags = process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ') : process.env.CPU ? CPU_FLAGS : GPU_FLAGS;
  return puppeteer.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    headless: 'new', protocolTimeout: 600000,
    args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', `--window-size=${w},${h}`, ...flags],
    defaultViewport: { width: w, height: h, deviceScaleFactor: scale, ...extra },
  });
}

/**
 * Open play.html?capture=1 (window.__volt, the deterministic stepper) in a new page and wait until it has loaded.
 * The dev server's reload socket is stubbed, so an edit elsewhere in the repo cannot reload the page mid-recording.
 * Returns the page; throws unless the renderer is a real GPU (or CPU=1 was asked for).
 */
export async function openCapture(browser, path = '/play.html?capture=1') {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { window.WebSocket = class { constructor() { this.readyState = 0; } addEventListener() {} removeEventListener() {} send() {} close() {} }; });
  await page.setBypassCSP(true);
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(BASE + path, { waitUntil: 'load' });
  if (path.includes('capture')) await page.waitForFunction('window.__volt', { timeout: 120000 });
  else await page.waitForFunction(() => window.__dbg && document.getElementById('loading')?.classList.contains('hidden'), { timeout: 120000 });
  const gpu = await page.evaluate(() => {
    const v = (window.__volt || window.__dbg).view, gl = v.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('renderer:', gpu);
  if (!process.env.CPU && !/nvidia|amd|radeon|intel/i.test(gpu)) throw new Error('not on the GPU: ' + gpu + ' (CPU=1 to allow SwiftShader)');
  return page;
}

/** CSS that leaves nothing but the game canvas (no HUD, no vignette, no flashes). */
export const CANVAS_ONLY = 'body > *:not(#c) { display: none !important; } html, body { background: #000 !important; cursor: none !important; }';

/**
 * Installed in the page: helpers for a "real rules" scene. V.demo() starts a bot-played free run (no supply needed);
 * __cap.real() takes it over and switches supply back on, so mines, belts and towers work as in a normal game.
 */
export function installHelpers() {
  const V = window.__volt;
  const cap = {
    /** a fresh match on map `mapId` (seed), the bot removed, supply rules on, money plenty, waves only when called */
    real(seed, mapId, o = {}) {
      V.demo(seed, 0, mapId); V.takeover();
      const s = V.sim;
      s.opts.pauseOnCards = false; s.opts.free = !!o.free; s.xpNext = 1e9; s.gold = 1e6; s.mats = 1e4;
      s.autoWaves = false; s.nextWaveIn = 1e9;
      for (const t of ['pulse', 'cryo', 'arc', 'mortar', 'rail', 'beacon', 'flame', 'lance', 'missile', 'gravity']) s.unlocked.add(t);
      V.view.skipIntro(); V.view.setQuality('high');
      s.events.length = 0;
      return s;
    },
    tower(type, cx, cz, lvl = 1) {
      const s = V.sim, t = s.build(type, cx, cz);
      if (!t) throw new Error(`cannot build ${type} at ${cx},${cz}`);
      while (t.lvl < lvl) s.upgrade(t.id);
      return t;
    },
    fac(type, cx, cz, dir = 0, lvl = 1) {
      const s = V.sim, why = s.facBlock(type, cx, cz);
      const f = s.buildFac(type, cx, cz, dir);
      if (!f) throw new Error(`cannot build ${type} at ${cx},${cz}: ${why}`);
      while (f.lvl < lvl) if (!s.upgradeFac(f.id)) break;
      return f;
    },
    /** run the sim forward without drawing (factory, towers, enemies) */
    run(seconds) { V.skip(seconds); },
    /** the game's own bird camera: look target, distance, turn (radians); hands the camera back from look() */
    cam(x, z, dist, rot = 0) { cap.eye = null; Object.assign(V.view.cam, { x, z, dist, rot }); },
    /** a free camera on top of the game's: eye and target in world units, field of view in degrees */
    look(ex, ey, ez, tx, ty, tz, fov = 38) { cap.eye = { ex, ey, ez, tx, ty, tz, fov }; },
    /** an orbit camera: target, distance R, azimuth (degrees round from the south, +x side), elevation (degrees) */
    orbit(tx, ty, tz, R, az, el, fov = 38) {
      const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
      cap.look(tx + R * Math.cos(e) * Math.sin(a), ty + R * Math.sin(e), tz + R * Math.cos(e) * Math.cos(a), tx, ty, tz, fov);
    },
    eye: null,
    /** start a wave as if it were wave n (enemies of that wave, at its strength) */
    wave(n) { const s = V.sim; s.wave = n - 1; s.next = null; s.startWave(); s.events.length = 0; },
    /** step n frames of dt (drawn) */
    frames(n, dt = 1 / 30) { for (let i = 0; i < n; i++) V.frame(dt); },
  };
  const view = V.view, baseCam = view.updateCamera.bind(view);
  view.updateCamera = (dt) => {
    baseCam(dt);
    const f = cap.eye;
    if (!f) return;
    const c = view.camera;
    c.position.set(f.ex, f.ey, f.ez); c.lookAt(f.tx, f.ty, f.tz);
    if (Math.abs(c.fov - f.fov) > 1e-3) { c.fov = f.fov; c.updateProjectionMatrix(); }
  };
  window.__cap = cap;
}

/**
 * Installed in the page after installHelpers: hex maths and the layout tools the scripted bases are built with.
 * Cells are (cx, cz) in odd-r offset coordinates (see src/game/hex.ts); directions 0..5 = E, SE, SW, W, NW, NE.
 */
export function installLayout() {
  const V = window.__volt, GW = 26, GH = 20;
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const ax = (cx, cz) => [cx - (cz - (cz & 1)) / 2, cz];
  const off = (q, r) => [q + (r - (r & 1)) / 2, r];
  const nb = (cx, cz, d) => { const [q, r] = ax(cx, cz), D = DIRS[((d % 6) + 6) % 6]; return off(q + D[0], r + D[1]); };
  const dirTo = (a, b) => { for (let d = 0; d < 6; d++) { const n = nb(a[0], a[1], d); if (n[0] === b[0] && n[1] === b[1]) return d; } return -1; };
  const free = (cx, cz) => cx >= 0 && cz >= 0 && cx < GW && cz < GH && V.sim.grid[cz * GW + cx] === 0;
  /** shortest path of free tiles from a to b (both included; a and b may be taken), avoiding `avoid` (a Set of 'cx,cz') and ore if it can */
  function path(a, b, avoid = new Set(), oreCost = 4) {
    const key = (c) => c[0] + ',' + c[1], goal = key(b);
    const dist = new Map([[key(a), 0]]), prev = new Map(), open = [[0, a]];
    while (open.length) {
      open.sort((x, y) => x[0] - y[0]);
      const [d0, c] = open.shift(), k = key(c);
      if (k === goal) break;
      if (d0 > dist.get(k)) continue;
      for (let d = 0; d < 6; d++) {
        const n = nb(c[0], c[1], d), nk = key(n);
        if (nk !== goal && (!free(n[0], n[1]) || avoid.has(nk))) continue;
        const nd = d0 + 1 + (V.sim.factory.ore[n[1] * GW + n[0]] ? oreCost : 0) + (d !== (prev.get(k)?.d ?? d) ? 0.15 : 0);
        if (nd < (dist.get(nk) ?? 1e9)) { dist.set(nk, nd); prev.set(nk, { c, d }); open.push([nd, n]); }
      }
    }
    if (!dist.has(goal)) throw new Error('no path ' + a + ' -> ' + b);
    const out = [b];
    for (let k = goal; prev.has(k); ) { const p = prev.get(k).c; out.unshift(p); k = key(p); }
    return out;
  }
  /** belts along cells, each pointing at the next; the last one points at `last` (a cell next to it, or a direction 0..5) */
  function belt(cells, last) {
    const out = [];
    for (let i = 0; i < cells.length; i++) {
      const to = i < cells.length - 1 ? cells[i + 1] : last;
      const d = Array.isArray(to) ? dirTo(cells[i], to) : to;
      if (!(d >= 0 && d < 6)) throw new Error(`belt at ${cells[i]}: ${to} is not next to it`);
      out.push(window.__cap.fac('belt', cells[i][0], cells[i][1], d));
    }
    return out;
  }
  const pipe = (cells) => cells.map((c) => window.__cap.fac('pipe', c[0], c[1]));
  /** world x, z of a cell */
  const wx = (cx, cz) => (cx + 0.5 * (cz & 1) - GW / 2 + 0.25) * 2, wz = (cz) => (cz - (GH - 1) / 2) * 1.7320508;
  /** an overlay with every cell's coordinates, projected through the current camera (for laying out bases by eye) */
  function labels(on = true) {
    let el = document.getElementById('cap-labels');
    if (el) el.remove();
    if (!on) return;
    el = document.createElement('div'); el.id = 'cap-labels';
    el.style.cssText = 'position:fixed;inset:0;z-index:999;pointer-events:none;font:10px monospace;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000';
    for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
      const [x, y, vis] = V.view.project(wx(cx, cz), 0, wz(cz));
      if (!vis) continue;
      const s = document.createElement('span'); s.textContent = cx + ',' + cz; s.style.cssText = `position:absolute;left:${x - 12}px;top:${y - 6}px`;
      el.appendChild(s);
    }
    document.body.appendChild(el);
  }
  Object.assign(window.__cap, { nb, dirTo, free, path, belt, pipe, wx, wz, labels });
}

/** Define the functions of tools/trailer/scenes.mjs in the page as globals (base(), battle(), titan(), ...). */
export async function installScenes(page) {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./scenes.mjs', import.meta.url), 'utf8').replace(/^export \{[^}]*\};?$/gm, '').replace(/^export /gm, '');
  await page.evaluate(src);
}

/** Hide the HUD and the overlays for a clean picture (true), or bring them back (false). */
export async function clean(page, on = true) {
  await page.evaluate((on) => {
    let st = document.getElementById('cap-clean');
    if (!on) { st?.remove(); return; }
    if (!st) { st = document.createElement('style'); st.id = 'cap-clean'; document.head.appendChild(st); }
    st.textContent = '#hud, #vignette, #flash, #announce, #intel, #hints, #guide, #toasts, #tip, #bottom, #marks, #btn-pause, #btn-speed, #btn-full, #prep, #notes, #tutor, #touch, #fpanel, #tower, #opanel, #oretip { display: none !important; } html, body { cursor: none !important; }';
  }, on);
}
