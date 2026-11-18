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
const renderOnce = (seconds, cues, hot, track, music = 1, bar = 0, calm = []) => page.evaluate(async (seconds, cues, hot, track, music, bar, calm) => {
  const s = window.__volt.sound;
  // the trailer fades in and out; the checks want the plain level. Every pitched note of the score is logged.
  s.noteLog = [];
  const t0 = performance.now();
  const buf = await s.renderOffline(seconds, cues, hot, { track, music: music ? 0.5 : 0, fade: false, bar, calm });
  const ms = performance.now() - t0, notes = s.noteLog; s.noteLog = null;
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
  // K-weighted (BS.1770: high shelf +4 dB at 1.5 kHz, high-pass at 38 Hz) mean square of both channels per window,
  // so levels can be compared the way loudness meters do (LUFS); unweighted RMS overrates the sub-heavy tracks
  const kf = (ch) => {
    const y = new Float64Array(ch.length);
    const run = (x, out, b0, b1, b2, a0, a1, a2) => { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; out[i] = v; } };
    let w = (2 * Math.PI * 1500) / sr, A = Math.pow(10, 4 / 40), al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), q = 2 * Math.sqrt(A) * al;
    run(ch, y, A * (A + 1 + (A - 1) * c + q), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - q), A + 1 - (A - 1) * c + q, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - q);
    w = (2 * Math.PI * 38) / sr; c = Math.cos(w); al = Math.sin(w) / (2 * 0.5);
    run(y, y, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
    return y;
  };
  const KL = kf(L), KR = kf(R), kw = [];
  for (let i = 0; i + win <= n; i += win) { let q = 0; for (let k = i; k < i + win; k++) q += KL[k] * KL[k] + KR[k] * KR[k]; kw.push(q / win); }
  let head = 0;
  if (cues.length) { const a = Math.floor((cues[0].t + 0.012) * sr); for (let i = a; i < a + 20 && i < n; i++) head = Math.max(head, Math.abs(L[i])); }
  let tail = 0;
  for (let i = n - 40; i < n; i++) tail = Math.max(tail, Math.abs(L[i]));
  // clicks: a burst of energy in the highest band (first difference) that is far above its surroundings, lasts under
  // a millisecond and is not there the moment before (a drum onset or a saw's edge rings on or repeats; a click does not)
  const fr = Math.floor(sr * 0.0005), nf = Math.floor((n - 1) / fr), e = new Float64Array(nf);
  for (let f = 0; f < nf; f++) { let q = 0; for (let i = f * fr + 1; i <= (f + 1) * fr; i++) { const d = (L[i] + R[i] - L[i - 1] - R[i - 1]) / 2; q += d * d; } e[f] = q; }
  let clicks = 0;
  const sorted = new Float64Array(80);
  for (let f = 40; f < nf - 40; f += 1) {
    if (e[f] < 1e-6) continue;
    sorted.set(e.subarray(f - 40, f + 40)); sorted.sort();
    const med = sorted[40] + 1e-9;
    if (e[f] > 80 * med && e[f + 4] < 3 * med && e[f - 1] < 3 * med) clicks++;
  }
  return { peak, rms: Math.sqrt(sum / n), hard, nan, step, head, tail, win: rms, kw, live: s.live.length, notes, ms, clicks };
}, seconds, cues, hot, track, music, bar, calm);

const { tracks, form, pcs } = await page.evaluate(async () => {
  const m = await import('/src/game/audio.ts');
  return { tracks: m.TRACKS, form: m.SCORE_FORM, pcs: Object.fromEntries(m.TRACKS.map((t) => [t.id, m.trackPitchClasses(t.id)])) };
});
ok(tracks.length >= 6 && tracks.every((t) => t.bpm >= 88 && t.bpm <= 126) && new Set(tracks.map((t) => t.key)).size === tracks.length,
  `${tracks.length} tracks in different keys, 88 to 126 BPM: ${tracks.map((t) => `${t.name} (${t.key}, ${t.bpm})`).join(', ')}`);

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

// 2b. a busy wave over the darkest, densest track: the effects must stay well audible over the score and the limiter
// must not pump. Score alone, effects alone and both together, compared in half-second windows.
{
  const cues = [];
  const chatter = ['shot', 'shot', 'shot', 'arcshot', 'cryo', 'cryo', 'die', 'mortar', 'boom', 'rail', 'mitedie', 'special'];
  let seed = 11;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  for (let i = 0; i < 12 * 20; i++) cues.push({ t: 1 + rnd() * 20, name: chatter[Math.floor(rnd() * chatter.length)], g: 0.5 + rnd() * 0.5, pan: rnd() * 1.6 - 0.8 });
  cues.sort((a, b) => a.t - b.t);
  const mus = await render(22, [], [], 'requiem', 1, 32), fx = await render(22, cues, [], 'requiem', 0, 32), both = await render(22, cues, [], 'requiem', 1, 32);
  let gr = Infinity, ratio = [];
  for (let i = 3; i < 42; i++) {
    gr = Math.min(gr, both.win[i] / Math.hypot(mus.win[i], fx.win[i]));
    ratio.push(fx.win[i] / mus.win[i]);
  }
  ratio.sort((a, b) => a - b);
  const med = ratio[ratio.length >> 1];
  ok(gr > 0.75 && med > 0.4, `busy wave over the score: effects ${db(med)} dB against the score (median), deepest limiter dip ${db(gr)} dB`);
}

// 3. the score: every track renders, stays clear of clipping and clicks, plays only the notes of its key, and its
// sections differ: intro, verse, chorus, breakdown, intense (the Titan) and calm (planning between waves). The loop
// from the outro back into the verse is seamless, and the level stays in the window the effects were balanced against.
const start = {};
let bars = 0;
for (const [name, len] of form) { start[name] = bars; bars += len; }
let renderMs = 0, renderSec = 0;
const verses = [];
for (const t of tracks) {
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const bar = (60 / t.bpm) * 4;
  const part = async (b, mode, secs = 14) => {
    const r = await render(secs, [], mode === 'hot' ? [[0, secs]] : [], t.id, 1, b, mode === 'calm' ? [[0, secs]] : []);
    renderMs += r.ms; renderSec += secs;
    return { r, lvl: avg(r.win.slice(2, Math.floor(secs * 2) - 4)) };
  };
  const intro = await part(0), verse = await part(start.verse), chorus = await part(start.chorus), brk = await part(start.break);
  const tense = await part(start.verse, 'hot'), calm = await part(start.verse, 'calm');
  // bridge into the final chorus (with its key change) and the loop seam: the last two bars of the outro into the verse
  const lift = await part(start.chorus2 - 4, '', 4 * bar + 8), seam = await part(bars - 2, '', 2 * bar + 8);
  const all = [intro, verse, chorus, brk, tense, calm, lift, seam];
  const peak = Math.max(...all.map((x) => x.r.peak));
  // pitch: every note in the key (with the chords' own colours), the final chorus in its lifted key
  let wrong = 0, count = 0;
  for (const x of all) for (const nt of x.r.notes) {
    count++;
    const set = nt.sec.endsWith('chorus2') ? pcs[t.id].lifted : pcs[t.id].home;
    if (!set.includes(((nt.m % 12) + 12) % 12)) wrong++;
  }
  const clicks = all.reduce((n, x) => n + x.r.clicks, 0);
  // the seam: no gap where the outro hands over to the verse (every half second keeps at least a quarter of the level)
  const seamMin = Math.min(...seam.r.win.slice(2, seam.r.win.length - 4));
  const kv = verse.r.kw.slice(2, verse.r.kw.length - 4);
  verses.push(10 * Math.log10(kv.reduce((a, b) => a + b, 0) / kv.length) - 0.691);
  ok(all.every((x) => !x.r.nan && x.r.hard === 0) && peak < 0.9 && verse.lvl > 0.02 && verse.lvl < 0.16 && intro.lvl < verse.lvl && brk.lvl < chorus.lvl && tense.lvl > verse.lvl * 0.95 && calm.lvl < verse.lvl && wrong === 0 && clicks === 0 && seamMin > seam.lvl * 0.25,
    `${t.name}: peak ${db(peak)} dB, intro ${db(intro.lvl)}, verse ${db(verse.lvl)}, chorus ${db(chorus.lvl)}, breakdown ${db(brk.lvl)}, intense ${db(tense.lvl)}, calm ${db(calm.lvl)} dB rms; ${count} notes, ${wrong} out of key; ${clicks} clicks; seam low ${db(seamMin)} dB`);
}
// every track at about the same level, so a playlist does not jump (and the effects stay balanced against all of them)
const spread = Math.max(...verses) - Math.min(...verses);
ok(spread < 1.5, `verse loudness of all tracks within ${spread.toFixed(1)} LU (limit 1.5): ${verses.map((v) => v.toFixed(1)).join(', ')} LUFS`);
console.log(`score render cost: ${(renderMs / renderSec).toFixed(1)} ms per second of audio`);

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
