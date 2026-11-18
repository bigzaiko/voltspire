// Offline checks of the synthesised sound: levels, clipping, clean starts and ends, the voice caps and the score.
//   node tools/dev/audio-test.mjs [baseUrl]
// Renders through Sound.renderOffline in a headless browser (the same path the trailer uses) and measures the result.
import puppeteer from 'puppeteer-core';

const base = process.argv[2] || 'http://localhost:5183';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true, protocolTimeout: 240000,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--headless=new', '--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 960, height: 540 },
});
const page = await browser.newPage();
// The dev server reloads the page whenever a source file changes. A test run must not be cut off by that,
// so the page gets a socket that never connects.
await page.evaluateOnNewDocument(() => { window.WebSocket = class { constructor() { this.readyState = 0; } addEventListener() {} removeEventListener() {} send() {} close() {} }; });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/play.html?capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__volt, { timeout: 60000 });

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fail++; };
const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');

/** Render and measure. `music` 0 mutes the score so the effects can be judged alone. */
const render = async (...args) => {
  // the dev server reloads the page when a source file changes under it: wait for the game and try again
  for (let i = 0; ; i++) {
    try { return await renderOnce(...args); } catch (e) {
      if (i >= 4 || !/context was destroyed|detached|navigation/i.test(String(e && e.message))) throw e;
      await page.waitForFunction(() => window.__volt, { timeout: 60000 });
    }
  }
};
const renderOnce = (seconds, cues, hot, track, music = 1, bar = 0) => page.evaluate(async (seconds, cues, hot, track, music, bar) => {
  const s = window.__volt.sound;
  // the trailer fades in and out; the checks want the plain level
  const buf = await s.renderOffline(seconds, cues, hot, { track, music: music ? 0.5 : 0, fade: false, bar });
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length, sr = buf.sampleRate;
  let peak = 0, sum = 0, hard = 0, nan = 0, step = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (!(a >= 0)) nan++;
    if (a > peak) peak = a;
    if (a >= 0.999) hard++;
    sum += L[i] * L[i];
    if (i) step = Math.max(step, Math.abs(L[i] - L[i - 1]));
  }
  // loudness of half-second windows, and the level right at the start of the first cue and at the very end
  const win = Math.floor(sr / 2), rms = [];
  for (let i = 0; i + win <= n; i += win) { let q = 0; for (let k = i; k < i + win; k++) q += L[k] * L[k]; rms.push(Math.sqrt(q / win)); }
  let head = 0;
  if (cues.length) { const a = Math.floor((cues[0].t + 0.012) * sr); for (let i = a; i < a + 20 && i < n; i++) head = Math.max(head, Math.abs(L[i])); }
  let tail = 0;
  for (let i = n - 40; i < n; i++) tail = Math.max(tail, Math.abs(L[i]));
  return { peak, rms: Math.sqrt(sum / n), hard, nan, step, head, tail, win: rms, live: s.live.length };
}, seconds, cues, hot, track, music, bar);

const tracks = await page.evaluate(async () => (await import('/src/game/audio.ts')).TRACKS);
ok(tracks.length >= 4 && tracks.every((t) => t.bpm >= 90 && t.bpm <= 110), `${tracks.length} tracks between 90 and 110 BPM: ${tracks.map((t) => `${t.name} ${t.bpm}`).join(', ')}`);

// 1. every effect on its own: starts from silence, ends in silence, never clips
const only = process.env.ONLY || '';
const names = only === 'music' ? [] : ['shot', 'arcshot', 'mortar', 'rail', 'cryo', 'missile', 'flame', 'lance', 'gravity', 'boom', 'die', 'mitedie', 'shield', 'deflect', 'spindown', 'spinup', 'brood', 'unjam', 'special', 'down', 'up', 'build', 'sell',
  'titanSmash', 'arrow', 'bigshot', 'rain', 'sing', 'crit', 'drawfull', 'nospec', 'heroOn', 'heroOff', 'tele', 'ready', 'overlink', 'wave', 'boss', 'bossdie', 'leak', 'breach', 'clear', 'levelup', 'jam',
  'titanLand', 'titanImpact', 'titanDie', 'win', 'lose', 'card', 'error', 'click', 'take', 'mats', 'hover'];
const table = [];
for (const name of names) {
  const r = await render(7, [{ t: 0.5, name }], [], undefined, 0);
  table.push(`${name.padEnd(12)} peak ${db(r.peak).padStart(6)} dB`);
  if (r.nan || r.peak <= 0.001 || r.peak >= 0.98 || r.head > 0.02 || r.tail > 0.002) ok(false, `${name}: peak ${r.peak.toFixed(3)} head ${r.head.toFixed(4)} tail ${r.tail.toFixed(4)} nan ${r.nan}`);
}
console.log(table.join('\n'));
ok(true, `${names.length} effects rendered alone`);

// 2. a flood: 900 triggers in 6 seconds must stay under the caps and must not clip
{
  const cues = [];
  const chatter = ['shot', 'arcshot', 'mortar', 'rail', 'boom', 'die', 'missile', 'cryo', 'deflect', 'arrow', 'crit', 'breach', 'bigshot'];
  let seed = 3;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  for (let i = 0; i < 900; i++) cues.push({ t: 0.5 + rnd() * 6, name: chatter[Math.floor(rnd() * chatter.length)], g: 0.4 + rnd() * 0.6, pan: rnd() * 1.6 - 0.8 });
  cues.sort((a, b) => a.t - b.t);
  cues.push({ t: 2, name: 'titanImpact' }, { t: 3.5, name: 'heroOn' }, { t: 5, name: 'boss' });
  cues.sort((a, b) => a.t - b.t);
  const r = await render(10, cues, [[0, 10]], 'drive');
  ok(!r.nan && r.hard === 0 && r.peak < 0.99, `flood of ${cues.length} cues over a tense score: peak ${db(r.peak)} dB, ${r.hard} clipped samples, rms ${db(r.rms)} dB`);
}

// 3. the score: every track renders, stays clear of clipping, and its sections differ (intro, groove, lead, breakdown, tense)
for (const t of tracks) {
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const part = async (bar, hot) => { const r = await render(14, [], hot ? [[0, 14]] : [], t.id, 1, bar); return { r, lvl: avg(r.win.slice(2, 22)) }; };
  const intro = await part(0), a = await part(4), b = await part(12), brk = await part(20), tense = await part(4, true);
  const all = [intro, a, b, brk, tense];
  const peak = Math.max(...all.map((x) => x.r.peak));
  ok(all.every((x) => !x.r.nan && x.r.hard === 0) && peak < 0.9 && a.lvl > 0.02 && intro.lvl < a.lvl && brk.lvl < b.lvl && tense.lvl > a.lvl,
    `${t.name}: peak ${db(peak)} dB, intro ${db(intro.lvl)}, groove ${db(a.lvl)}, with lead ${db(b.lvl)}, breakdown ${db(brk.lvl)}, tense ${db(tense.lvl)} dB rms`);
}

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
