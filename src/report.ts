// BEATSPIRE bug reports: one button, "Report on GitHub", opens a new issue on the game's repository with everything filled
// in, including a state block (snapshot.ts) from which the run can be rebuilt exactly (tools/repro.ts, or Load report in a
// dev build or with ?debug=1). Nothing is sent from here: the player submits the issue on GitHub, signed in to their own
// account. The game state goes into the issue in the way its size allows (see planReport and the limits below):
//  1. it all fits in the new-issue link: GitHub opens with everything filled in, and no file is saved;
//  2. too long for a link: GitHub opens with the text that fits filled in and an "Attach the screenshot file ... here" line,
//     and the game saves one PNG screenshot of the current frame (with a caption strip: version, map, wave) that carries the
//     whole state inside it, as a tEXt chunk 'beatspire-state' (and the issue text as an iTXt chunk 'beatspire-report'; see
//     pngstate.ts). The player drags that one file into the issue. No clipboard: Firefox and most Android browsers cannot put
//     a picture on it, and a pasted state got lost in a real report (issue #1 came without it).
// Does GitHub keep the chunks? Checked 2026-11-19, without uploading anything: GitHub documents nothing about processing
// attachments, and no community source reports PNG text being stripped. Ten public issue attachments were fetched anonymously
// (github.com/user-attachments/assets/<id>): GitHub redirects to the original object in its S3 bucket
// (github-production-user-asset-*.s3.amazonaws.com) and the PNGs came back with their ancillary chunks intact: iCCP, eXIf,
// pHYs, iTXt 'XML:com.adobe.xmp' and Apple's private iDOT (macOS screenshots), JPEGs with their Exif. So uploads are stored
// as sent, not re-encoded or stripped, and the state survives the trip: one file, no companion .txt. (What can lose it is a
// picture pasted from the clipboard instead of the file: the browser re-encodes that. The line in the issue asks for the file.)
// When the browser gives no picture at all (no canvas, toBlob fails), the same state goes into a .txt file instead.
// A small ring buffer keeps the last game events and player actions (logEvents, logAction) and the last console errors and
// warnings (installed when this module loads), with messages only: query strings are cut from URLs, no storage is read.
import { encodeSnapshot, decodeSnapshot, restoreSim, trialRun } from './game/snapshot.ts';
import type { Sim, Ev } from './game/sim.ts';
import { withText, readText, isPng, STATE_KEY, REPORT_KEY } from './pngstate.ts';

declare const __BEATSPIRE_BUILD__: { hash: string; date: string } | undefined;

export const REPO = 'bigzaiko/beatspire';
export const NEW_ISSUE_URL = `https://github.com/${REPO}/issues/new`;
/**
 * Size limits. Measured on 2026-11-18 with curl against github.com/bigzaiko/beatspire/issues/new?title=t&body=<n characters>:
 *  - Signed out, GitHub answers with a redirect to /login?return_to=<the whole URL, percent-encoded once more>. The login page
 *    answers 200 for a return_to of up to about 6990 characters and 500 above that, so a signed-out player only gets back to
 *    the filled-in form while encodeURIComponent(url) stays under that: a body of plain letters went through up to 6937
 *    characters (500 from 6944), a body of encoded line breaks ('%0A', which the redirect encodes again) only up to ~4100.
 *    Re-measured the same day (fetch and curl -I, signed out): a return_to of up to ~6915 characters comes back in the login
 *    form; from ~7100 the login page answers 500; from ~8100 GitHub redirects to a bare /login (status 200, but return_to is
 *    dropped, so the player lands on their dashboard and the filled-in form is lost: a 200 is not success).
 *  - The new-issue page itself answers 500 (no redirect) for a link of ~6940 characters or more, and GitHub's front end
 *    refuses longer request lines outright: no answer for about 8000 to 8200 characters, '414 URI Too Long' above.
 *  - Browsers take much longer URLs (Chrome 2 MB; Firefox and Safari well over 64 K), so GitHub sets the limit.
 *  Signed in, the form opens straight away; that state could not be tested without the owner's session, so the stricter
 *  signed-out limit is used for everyone: URL_MAX for the link itself (the ~6940 above applies signed in too) and
 *  URL_MAX_LOGIN for it encoded once more, each about 8-10 % under the measured edge.
 *  (An issue body may be 65536 characters; the state no longer goes into the body past the link, so that limit is never near.)
 *  - An attached image may be 10 MB (GitHub's documented limit for images; other files 25 MB): SHOT_MAX keeps the PNG under it.
 */
export const URL_MAX = 6400;
export const URL_MAX_LOGIN = 6200;
export const SHOT_MAX = 9 * 1024 * 1024;
/** The screenshot's longest side, in pixels (a 4K or high-DPI phone frame is scaled down: smaller file, same story). */
const SHOT_SIDE = 1920;
/** Text limits of the form. */
export const SUMMARY_MAX = 120;
export const WHAT_MAX = 2000;
export const EXPECT_MAX = 1000;
const EVENTS_MAX = 200, CONSOLE_MAX = 50;
/** The line in the issue where the file goes ({file}: its name). */
export const ATTACH_HERE = '**Attach the screenshot file {file} here.** The game saved it to your downloads; the game state is inside it. Drag the file into this box, or use "Paste, drop, or click to add files" below (the file itself: a pasted picture loses the state).';
export const ATTACH_TXT = '**Attach the file {file} here.** The game saved it to your downloads; the game state is inside it. Drag it into this box, or use "Paste, drop, or click to add files" below.';

export const BUILD = typeof __BEATSPIRE_BUILD__ !== 'undefined' && __BEATSPIRE_BUILD__ ? __BEATSPIRE_BUILD__ : { hash: import.meta.env.DEV ? 'dev server' : 'unknown', date: '' };

// ---------- ring buffers ----------
const evLog: string[] = [], conLog: string[] = [];
const push = (a: string[], s: string, max: number) => { a.push(s); if (a.length > max) a.splice(0, a.length - max); };
/** Events too frequent to tell a story (shots, hits, hand-offs between buildings): left out of the log. */
const QUIET: ReadonlySet<string> = new Set(['dmg', 'shot', 'hit', 'boom', 'arc', 'rail', 'lance', 'cryo', 'gravity', 'put', 'take', 'deflect', 'mats', 'nospec']);
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const stamp = (t: number) => (Number.isFinite(t) ? t.toFixed(2).padStart(7) : '      ?');
/** Remember a frame's game events (one compact line each; the noisy kinds are left out). t: the run's clock. */
export function logEvents(evs: readonly Ev[], t: number) {
  for (const e of evs) {
    if (QUIET.has(e.k)) continue;
    let s = stamp(t) + ' ' + e.k;
    for (const k in e) {
      if (k === 'k') continue;
      const v = e[k];
      if (typeof v === 'number') s += ` ${k}=${num(v)}`;
      else if (typeof v === 'string') s += ` ${k}=${v.slice(0, 24)}`;
      else if (typeof v === 'boolean') s += ` ${k}=${v ? 1 : 0}`;
      else if (Array.isArray(v)) s += ` ${k}=[${v.length}]`;
    }
    push(evLog, s.slice(0, 160), EVENTS_MAX);
  }
}
/** Remember a player action (build, sell, upgrade, a card...), marked '>' in the log. */
export function logAction(name: string, args: readonly unknown[], t: number) {
  const a = args.map((v) => (typeof v === 'number' ? num(v) : typeof v === 'string' ? v.slice(0, 24) : v === null ? 'null' : typeof v === 'boolean' ? String(v) : typeof v)).join(' ');
  push(evLog, `${stamp(t)} > ${name} ${a}`.slice(0, 160), EVENTS_MAX);
}
/**
 * A message on one line without what could be personal in it: URLs lose their query strings and fragments; a URL of another
 * site keeps only its origin (a YouTube or Spotify path names the player's own music), a file:// URL only its file name (a
 * local path names the user); anything that reads like a credential ("Bearer ...", "token=...") is blanked.
 */
export function cleanMsg(s: string, max = 300, own = typeof location !== 'undefined' ? location.origin : ''): string {
  return s
    .replace(/\b(?:https?|blob|file):\/\/[^\s'"()<>]*/g, (u) => {
      const bare = u.replace(/[?#].*$/, '');
      if (/^file:/i.test(bare)) return 'file://.../' + (bare.split('/').pop() || '');
      if (/^blob:/i.test(bare)) return 'blob:...';
      const m = /^(https?:\/\/[^/]+)(.*)$/i.exec(bare);
      return m && m[1] !== own ? m[1] + (m[2] ? '/...' : '') : bare;
    })
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 ...')
    .replace(/\b((?:access_|refresh_|id_)?token|api_?key|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2...')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
function argText(v: unknown): string {
  if (v instanceof Error) {
    const frame = (v.stack || '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('at ') || /@/.test(l)) || '';
    return `${v.name}: ${v.message}${frame ? ' | ' + frame : ''}`;
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) { try { return JSON.stringify(v).slice(0, 200); } catch { return '[object]'; } }
  return String(v);
}
const logCon = (kind: string, text: string) => push(conLog, `${(performance.now() / 1000).toFixed(1).padStart(7)}s ${kind} ${cleanMsg(text)}`, CONSOLE_MAX);
(() => {
  if (typeof console === 'undefined') return;
  for (const lvl of ['error', 'warn'] as const) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...a: unknown[]) => { try { logCon(lvl, a.map(argText).join(' ')); } catch { /* never break the console */ } orig(...a); };
  }
  if (typeof addEventListener !== 'function') return;
  addEventListener('error', (e: ErrorEvent) => logCon('uncaught', `${e.message}${e.error instanceof Error ? ' | ' + argText(e.error).split(' | ')[1] : ''} (${cleanMsg(e.filename || '')}:${e.lineno}:${e.colno})`));
  addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => logCon('rejection', argText(e.reason)));
})();

// ---------- the report text ----------
export interface ReportFields { summary: string; what: string; expected: string }
/** What the game tells about itself and the run (play.ts fills it in). */
export interface ReportContext { run: string; quality: string; gpu: string; touch: boolean }
/** The browser and OS from the user agent, as "Chrome 142" / "Windows" (the full user agent string is not sent). */
export function browserOs(ua: string): { browser: string; os: string } {
  const v = (re: RegExp) => { const m = re.exec(ua); return m ? m[1] : ''; };
  const browser = /Edg\//.test(ua) ? 'Edge ' + v(/Edg\/(\d+)/) : /OPR\//.test(ua) ? 'Opera ' + v(/OPR\/(\d+)/) : /(Firefox|FxiOS)\//.test(ua) ? 'Firefox ' + v(/(?:Firefox|FxiOS)\/(\d+)/)
    : /(Chrome|CriOS)\//.test(ua) ? 'Chrome ' + v(/(?:Chrome|CriOS)\/(\d+)/) : /Safari\//.test(ua) ? 'Safari ' + v(/Version\/(\d+(?:\.\d+)?)/) : 'unknown browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android ' + v(/Android (\d+)/) : /iPhone|iPad|iPod/.test(ua) ? 'iOS ' + v(/OS (\d+)_/) : /Mac OS X/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return { browser: browser.trim(), os: os.trim() };
}
/** A code fence around `s`, made of more backticks than the longest run of them inside, so nothing in it can close it early. */
export function fence(s: string): string {
  const run = Math.max(0, ...(s.match(/`+/g) || []).map((r) => r.length));
  const f = '`'.repeat(Math.max(3, run + 1));
  return f + 'text\n' + s + '\n' + f;
}
/**
 * Free text (the player's own, a map name, the GPU string) made safe to put in the issue's Markdown as it stands: a line that
 * would open a code fence gets a backslash (an unclosed fence would swallow every section after it, the state included), and
 * '<' becomes '&lt;' (an unclosed HTML comment or tag would hide the rest of the issue). It still reads the same on GitHub.
 */
export function mdSafe(s: string): string {
  return s.replace(/</g, '&lt;').replace(/^( {0,3})(`{3,}|~{3,})/gm, '$1\\$2');
}
/** The part of the body every report has: the player's text and the game's details. */
export function headText(f: ReportFields, c: ReportContext, env: { ua: string; screen: string }): string {
  const bo = browserOs(env.ua);
  return [
    '### What happened', mdSafe(f.what.trim().slice(0, WHAT_MAX)) || '_(not given)_', '',
    '### What I expected', mdSafe(f.expected.trim().slice(0, EXPECT_MAX)) || '_(not given)_', '',
    '### Game',
    `- Version: ${BUILD.hash}${BUILD.date ? ` (built ${BUILD.date})` : ''}`,
    `- Run: ${mdSafe(c.run.replace(/\s+/g, ' '))}`,
    `- Browser: ${bo.browser}; OS: ${bo.os}${c.touch ? '; touch controls' : ''}`,
    `- GPU: ${mdSafe(cleanMsg(c.gpu, 160)) || 'unknown'}`,
    `- Screen: ${env.screen}`,
    `- Quality: ${c.quality}`,
  ].join('\n');
}
/** The recent game events and console messages. */
export function logText(): string {
  return [
    `### Recent events (last ${evLog.length}; '>' marks the player's actions)`, fence(evLog.join('\n') || '(none)'), '',
    `### Console errors and warnings (last ${conLog.length})`, fence(conLog.join('\n') || '(none)'),
  ].join('\n');
}
/** The state section: the block in a code fence (or a note when there is no run to save). */
export function stateText(block: string): string {
  return ['### State', block ? 'Load it with `node tools/repro.ts` (or Load report in a dev build). Please leave it as it is.' : '', block ? fence(block) : '_(no run in progress)_'].filter(Boolean).join('\n');
}

// ---------- how it goes to GitHub ----------
export interface Plan {
  path: 1 | 2;
  title: string;
  /** the new-issue link to open */
  url: string;
  /** the body as the link fills it in */
  urlBody: string;
  /** path 2: the file to attach (beatspire-report-<time>.png, or .txt when there is no picture) */
  fileName: string;
  /** path 2: the issue text that goes into the file beside the state (title, the player's text, details, logs) */
  fileText: string;
  /** the body as it reads once the player attached the file (what the preview shows) */
  body: string;
}
export const issueUrl = (title: string, body: string) => NEW_ISSUE_URL + '?' + new URLSearchParams({ title, labels: 'bug', body }).toString();
/** True if a new-issue link is short enough for GitHub, signed in or out (see URL_MAX). */
export const urlFits = (url: string) => url.length <= URL_MAX && encodeURIComponent(url).length <= URL_MAX_LOGIN;
export const titleOf = (summary: string) => '[Bug] ' + (summary.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX) || 'untitled');
/** The file name of a report's attachment: beatspire-report-<time>.png (or .txt). */
export const attachName = (stamp: string, png = true) => `beatspire-report-${stamp}.${png ? 'png' : 'txt'}`;
/**
 * Choose how a report goes to GitHub (see the header): the whole issue in the link when it fits; else the parts that fit
 * (the player's text and the game's details first, then the logs; never the state) in the link with an ATTACH line, and
 * everything in the file. `png` false: there is no picture, the file is a .txt. `force` (a test hook) skips path 1.
 */
export function planReport(title: string, head: string, log: string, state: string, force: 0 | 1 | 2 = 0, stamp = 'report', png = true): Plan {
  const parts = [head, log, state], join = (p: string[]) => p.join('\n\n');
  const full = join(parts), url1 = issueUrl(title, full);
  if (force !== 2 && (urlFits(url1) || force === 1)) return { path: 1, title, url: url1, urlBody: full, fileName: '', fileText: '', body: full };
  const fileName = attachName(stamp, png), mark = (png ? ATTACH_HERE : ATTACH_TXT).replace('{file}', fileName);
  let urlBody = '', url = '';
  for (let k = parts.length - 1; k >= 0; k--) {
    urlBody = join([...parts.slice(0, k), mark]); url = issueUrl(title, urlBody);
    if (urlFits(url)) break;
  }
  // (the issue text without the state section: the state has a chunk of its own; for a .txt the block follows the text)
  const fileText = `${title}\n\n${join([head, log])}\n`;
  const kb = (n: number) => Math.max(1, Math.round(n / 1024));
  return { path: 2, title, url, urlBody, fileName, fileText, body: urlBody + `\n\n[attached: ${fileName}${png ? ', the screenshot' : ''}, with the game state (${kb(state.length)} KB) and the whole report inside]` };
}
/** The .txt attachment when there is no picture: the report, then the state section (decodeSnapshot finds the block in it). */
export const txtFile = (p: Plan, state: string) => `BEATSPIRE bug report\n${p.fileText}\n${state}\n`;
/** The screenshot with the state and the report put inside (synchronous: it runs inside the click). */
export function shotWithState(png: Uint8Array, block: string, p: Plan): Uint8Array {
  return withText(png, [
    ...(block ? [{ key: STATE_KEY, text: block }] : []),
    { key: REPORT_KEY, text: p.fileText, utf8: true },
    { key: 'Software', text: 'BEATSPIRE ' + BUILD.hash.replace(/[^\x20-\x7e]/g, '') },
  ]);
}
/** The state block inside a report screenshot ('' when it carries none). Throws when the file is not a readable PNG. */
export function stateFromPng(png: Uint8Array): string { return readText(png).get(STATE_KEY) || ''; }

// ---------- the form ----------
/** What the game gives the report form. */
export interface ReportHost {
  /** the run to save, or null outside a run */
  sim(): Sim | null;
  context(): ReportContext;
  canvas: HTMLCanvasElement;
  /** draw a frame now (a screenshot is read straight after it) */
  render(): void;
  /** the form closed (the game puts back what was open and lets time run again) */
  closed(): void;
  /** a report block was loaded (dev builds and ?debug=1 only) */
  load(sim: Sim, note: string): void;
}
/** Test hooks (exposed on the dev server and with ?debug=1): force a path, catch the opened link and the saved file, read the last plan. */
export const reportHooks = {
  force: 0 as 0 | 1 | 2,
  open: null as null | ((url: string) => void),
  download: null as null | ((name: string, file: Blob) => void),
  last: null as null | Plan,
  /** the state block of the open form ('' outside a run) */
  get block() { return block; },
  /** the screenshot of the open form, without the state (null while it is made, or when the browser gave no picture) */
  get shot() { return shot; },
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let host: ReportHost | null = null;
let block = '', packing: Promise<void> | null = null, shot: Uint8Array | null = null, thumbUrl = '', lastFocus: Element | null = null, prevTimer = 0, openId = 0;
let thumb: HTMLImageElement | null = null;
const fields = (): ReportFields => ({ summary: $<HTMLInputElement>('rp-sum').value, what: $<HTMLTextAreaElement>('rp-what').value, expected: $<HTMLTextAreaElement>('rp-exp').value });
const env = () => ({ ua: navigator.userAgent, screen: `${screen.width}x${screen.height}, window ${innerWidth}x${innerHeight} at ${(devicePixelRatio || 1).toFixed(2)}x` });
const status = (text: string, bad = false) => { const s = $('rp-status'); s.textContent = text; s.classList.toggle('bad', bad); };
const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

function plan(force = reportHooks.force): Plan {
  const f = fields(), c = host!.context();
  const p = planReport(titleOf(f.summary), headText(f, c, env()), logText(), stateText(block), force, fileStamp(), !!shot);
  if (force === reportHooks.force) reportHooks.last = p;
  return p;
}
const HOW: Record<1 | 2, string> = {
  1: 'Fits in the link: GitHub opens with everything filled in.',
  2: 'GitHub opens with the text filled in. This screenshot, with the game state inside, is saved for you to attach there.',
};
function preview() {
  clearTimeout(prevTimer);
  const f = fields();
  $('rp-what-n').textContent = `${f.what.length} / ${WHAT_MAX}`;
  if (packing) { $('rp-how').textContent = 'Packing the game state...'; $('rp-preview').textContent = ''; $('rp-shot').classList.add('hidden'); return; }
  const p = plan();
  $('rp-how').textContent = HOW[p.path] + ` (${p.body.length.toLocaleString('en')} characters)`;
  $('rp-preview').textContent = `${p.title}\n\n${p.body}`;
  $('rp-shotbox').classList.toggle('attach', p.path === 2);
  // (path 2 saves the screenshot anyway: the button is for path 1)
  $('rp-shot').classList.toggle('hidden', p.path !== 1 || !shot);
}

// ---------- the screenshot ----------
const cssVar = (k: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
const toPng = (c: HTMLCanvasElement) => new Promise<Uint8Array | null>((res) => {
  try { c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), () => res(null)) : res(null)), 'image/png'); } catch { res(null); }
});
/** The frame with a caption strip under it (version, map, wave, time; the date on the right when there is room). */
function compose(frame: HTMLCanvasElement | null, k: number, cap: string[]): HTMLCanvasElement {
  const w = frame ? Math.max(1, Math.round(frame.width * k)) : 960, fh = frame ? Math.max(1, Math.round(frame.height * k)) : 360;
  const H = Math.round(Math.min(64, Math.max(30, w * 0.03))), c = document.createElement('canvas');
  c.width = w; c.height = fh + H;
  const g = c.getContext('2d');
  if (!g) return c;
  const soot = cssVar('--soot-0', '#100e0c'), sand = cssVar('--sand', '#e3dc92'), bone = cssVar('--bone', '#efe9d6'), muted = cssVar('--muted', '#9c9384');
  g.fillStyle = soot; g.fillRect(0, 0, w, fh + H);
  if (frame) { g.imageSmoothingQuality = 'high'; g.drawImage(frame, 0, 0, w, fh); }
  else { g.fillStyle = muted; g.font = `500 ${Math.round(H * 0.6)}px "IBM Plex Mono", ui-monospace, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('no picture from this browser', w / 2, fh / 2); g.textAlign = 'left'; }
  g.fillStyle = sand; g.fillRect(0, fh, w, Math.max(2, Math.round(H / 16)));
  const y = fh + H / 2 + H / 32, pad = Math.round(H * 0.45);
  g.textBaseline = 'middle';
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  g.font = `500 ${Math.round(H * 0.4)}px "IBM Plex Mono", ui-monospace, monospace`;
  const dw = g.measureText(date).width;
  g.font = `700 ${Math.round(H * 0.56)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  let x = pad;
  g.fillStyle = sand; g.fillText('BEATSPIRE', x, y); x += g.measureText('BEATSPIRE').width;
  g.font = `600 ${Math.round(H * 0.5)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  for (const s of cap) {
    const sep = '  /  ', need = g.measureText(sep + s).width;
    if (x + need > w - pad) break;
    g.fillStyle = muted; g.fillText(sep, x, y); x += g.measureText(sep).width;
    g.fillStyle = bone; g.fillText(s, x, y); x += g.measureText(s).width;
  }
  if (x + dw + pad * 2 < w - pad) { g.font = `500 ${Math.round(H * 0.4)}px "IBM Plex Mono", ui-monospace, monospace`; g.fillStyle = muted; g.textAlign = 'right'; g.fillText(date, w - pad, y); }
  return c;
}
/**
 * The screenshot as a PNG (without the state: that goes in at the click). The frame is drawn and copied at once (a WebGL
 * canvas keeps its picture only until then), scaled to SHOT_SIDE, then captioned; a PNG over SHOT_MAX is made again smaller.
 * With no picture to read, a captioned card. null only when the browser makes no PNG at all.
 */
async function makeShot(cap: string[]): Promise<Uint8Array | null> {
  let frame: HTMLCanvasElement | null = null;
  try {
    host!.render();
    const src = host!.canvas, k = Math.min(1, SHOT_SIDE / Math.max(src.width, src.height, 1));
    if (src.width && src.height) {
      frame = document.createElement('canvas');
      frame.width = Math.round(src.width * k); frame.height = Math.round(src.height * k);
      const g = frame.getContext('2d');
      if (g) { g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, frame.width, frame.height); } else frame = null;
    }
  } catch { frame = null; }
  try { await Promise.all(['700 20px "Barlow Condensed"', '600 20px "Barlow Condensed"', '500 20px "IBM Plex Mono"'].map((f) => document.fonts.load(f))); } catch { /* the fallback fonts do */ }
  for (let k = 1; k > 0.2; k *= 0.7) {
    const png = await toPng(compose(frame, k, cap));
    if (!png || png.length <= SHOT_MAX - 512 * 1024 || !frame) return png; // (half a MB left for the state and the text)
  }
  return null;
}
/** What the caption strip says about the run. */
function caption(sim: Sim | null): string[] {
  const v = BUILD.hash + (BUILD.date ? ' ' + BUILD.date.slice(0, 10) : '');
  if (!sim) return [v, 'main menu'];
  const t = Math.floor(sim.time);
  return [v, sim.map.def.name, `wave ${sim.wave}${sim.campaign ? ' of ' + sim.winWave : ''}`, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`];
}

/** Open the report form (pauses nothing itself: the caller does). */
export function openReport() {
  if (!host) return;
  const id = ++openId;
  lastFocus = document.activeElement;
  $('report').classList.remove('hidden');
  status('');
  $('rp-link').classList.add('hidden');
  block = ''; shot = null;
  if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = ''; }
  thumb!.removeAttribute('src'); $('rp-shotbox').classList.add('hidden');
  const sim = host.sim();
  const shooting = makeShot(caption(sim)).then((png) => {
    if (id !== openId || !png) return;
    shot = png;
    thumbUrl = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
    thumb!.src = thumbUrl; $('rp-shotbox').classList.remove('hidden');
  }, (e: unknown) => console.warn('report screenshot: ' + argText(e)));
  const packed = sim ? encodeSnapshot(sim, { build: BUILD.hash, date: new Date().toISOString() }).then((b) => { if (id === openId) block = b; }, (e: unknown) => { if (id === openId) { block = ''; status('The game state could not be packed: ' + argText(e), true); console.error(e); } }) : Promise.resolve();
  packing = Promise.all([packed, shooting]).then(() => undefined).finally(() => { if (id === openId) { packing = null; preview(); } });
  preview();
  $('rp-sum').focus();
}
export const reportOpen = () => !$('report').classList.contains('hidden');
function closeReport() {
  if (!reportOpen()) return;
  openId++; packing = null;
  $('report').classList.add('hidden');
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
  host?.closed();
}
function openTab(url: string) {
  if (reportHooks.open) { reportHooks.open(url); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}
function download(name: string, file: Blob) {
  if (reportHooks.download) { reportHooks.download(name, file); return; }
  const a = document.createElement('a'), u = URL.createObjectURL(file);
  a.href = u; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
/** The file of a path-2 plan: the screenshot with the state inside, or the .txt when there is no picture. */
const attachment = (p: Plan) => (shot ? new Blob([shotWithState(shot, block, p) as BlobPart], { type: 'image/png' }) : new Blob([txtFile(p, stateText(block))], { type: 'text/plain' }));

/**
 * The Report button. Everything up to opening the tab runs inside the click, with no wait in between (a popup blocker lets a
 * window.open through only then, and some browsers save a file only then): the state was packed and the screenshot made
 * while the player wrote; putting the state into the PNG is a copy of bytes.
 */
function send(e: Event) {
  e.preventDefault();
  const f = fields();
  if (!f.summary.trim()) { status('Write a one-line summary first.', true); $('rp-sum').focus(); return; }
  if (!f.what.trim()) { status('Say what happened first.', true); $('rp-what').focus(); return; }
  if (packing) { status('Still packing the game state: press Report on GitHub again in a moment.', true); return; }
  const p = plan();
  const link = $<HTMLAnchorElement>('rp-link');
  link.href = p.url; link.classList.remove('hidden');
  if (p.path === 2) download(p.fileName, attachment(p));
  openTab(p.url);
  status(p.path === 1 ? 'GitHub is open in a new tab with everything filled in. Check it and press Create there.'
    : `Saved ${p.fileName} to your downloads. On GitHub, drag it into the issue where it says so, then press Create.`);
}
/** Save screenshot (path 1, where nothing is saved otherwise): the same PNG, state inside. */
function saveShot() {
  if (packing || !shot) return;
  const p = plan(2);
  download(p.fileName, attachment(p));
  status(`Saved ${p.fileName}. Attach it on GitHub if a picture helps.`);
}

// ---------- Load report (dev builds and ?debug=1) ----------
export function openLoad() {
  lastFocus = document.activeElement;
  $('loadrep').classList.remove('hidden');
  $('lr-status').textContent = '';
  $('lr-text').focus();
}
export const loadOpen = () => !$('loadrep').classList.contains('hidden');
function closeLoad(back = true) {
  if (!loadOpen()) return;
  $('loadrep').classList.add('hidden');
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
  if (back) host?.closed();
}
async function loadGo() {
  const s = $('lr-status'), text = $<HTMLTextAreaElement>('lr-text').value;
  s.classList.remove('bad'); s.textContent = 'Reading...';
  try {
    const snap = await decodeSnapshot(text), sim = restoreSim(snap);
    trialRun(snap); // (a block is anyone's text: it must run ten seconds on a copy before the game continues it)
    const m = snap.meta, note = `Report state loaded: ${sim.map.def.name}, wave ${sim.wave}, ${sim.time.toFixed(1)} s in${m?.build ? `, written by build ${m.build}` : ''}${m?.build && m.build !== BUILD.hash ? ` (this is ${BUILD.hash})` : ''}. Paused.`;
    closeLoad(false);
    host?.load(sim, note);
  } catch (e) { s.classList.add('bad'); s.textContent = 'Could not load it: ' + (e instanceof Error ? e.message : String(e)); }
}
/** Close whichever form is open (Escape with the focus outside them). True if one was. */
export function closeForms(): boolean { const was = reportOpen() || loadOpen(); closeReport(); closeLoad(); return was; }
/** The banner over the game after a load (or any other note that has to stay until dismissed). */
export function showBanner(text: string) { $('rp-banner-text').textContent = text; $('rp-banner').classList.remove('hidden'); }

/** Keep Tab inside a modal form: from its last control back to its first, and the other way with Shift. */
function trapTab(e: KeyboardEvent, id: string) {
  e.stopPropagation();
  const els = [...$(id).querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1], at = document.activeElement;
  if (e.shiftKey && (at === first || !$(id).contains(at))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (at === last || !$(id).contains(at))) { e.preventDefault(); first.focus(); }
}
/** Wire the report and load forms up (once, at boot). `debug`: Load report is offered. */
export function initReport(h: ReportHost, debug: boolean) {
  host = h;
  $<HTMLInputElement>('rp-sum').maxLength = SUMMARY_MAX; $<HTMLTextAreaElement>('rp-what').maxLength = WHAT_MAX; $<HTMLTextAreaElement>('rp-exp').maxLength = EXPECT_MAX;
  $('rp-form').addEventListener('submit', send);
  $('rp-form').addEventListener('input', () => { clearTimeout(prevTimer); prevTimer = window.setTimeout(preview, 150); });
  // the screenshot beside the line that says how the report goes (built here: play.html holds the form's fixed parts)
  thumb = document.createElement('img');
  thumb.className = 'rp-thumb'; thumb.alt = 'The screenshot that goes with the report'; thumb.decoding = 'async';
  const box = document.createElement('figure'), badge = document.createElement('figcaption'), row = document.createElement('div');
  box.id = 'rp-shotbox'; box.className = 'rp-shotbox hidden'; badge.className = 'rp-badge'; badge.textContent = 'state inside';
  box.append(thumb, badge); row.className = 'rp-shotrow';
  const how = $('rp-how');
  how.before(row); row.append(box, how);
  $('rp-shot').textContent = 'Save screenshot';
  $('rp-shot').addEventListener('click', saveShot);
  $('rp-clipbox').remove(); // (the clipboard path is gone)
  $('rp-cancel').addEventListener('click', closeReport);
  // Escape closes the form, from inside a field too; it goes no further (the game would read it as "pause")
  // (Tab goes round inside the open form: it is modal, the game behind it takes no focus)
  $('report').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeReport(); } else if (e.key === 'Tab') trapTab(e, 'report'); else e.stopPropagation(); });
  $('loadrep').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLoad(); } else if (e.key === 'Tab') trapTab(e, 'loadrep'); else e.stopPropagation(); });
  $('rp-banner-x').addEventListener('click', () => $('rp-banner').classList.add('hidden'));
  $('lr-go').addEventListener('click', () => void loadGo());
  $('lr-cancel').addEventListener('click', () => closeLoad());
  $<HTMLInputElement>('lr-file').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 40 * 1024 * 1024) { $('lr-status').textContent = 'That file is too big to be a report.'; return; }
    const s = $('lr-status'), bytes = new Uint8Array(await f.arrayBuffer());
    s.classList.remove('bad');
    if (isPng(bytes)) {
      // a report screenshot: the state is in its 'beatspire-state' chunk
      let st = '';
      try { st = stateFromPng(bytes); } catch (err) { s.classList.add('bad'); s.textContent = `${f.name}: ${err instanceof Error ? err.message : String(err)}`; return; }
      if (!st) { s.classList.add('bad'); s.textContent = `${f.name}: a picture with no game state inside (a screenshot pasted or re-saved loses it).`; return; }
      $<HTMLTextAreaElement>('lr-text').value = st;
      s.textContent = `${f.name}: game state read from the screenshot (${Math.ceil(st.length / 1024)} KB). Press Load.`;
      return;
    }
    $<HTMLTextAreaElement>('lr-text').value = new TextDecoder().decode(bytes);
    s.textContent = `${f.name}: ${Math.ceil(f.size / 1024)} KB read. Press Load.`;
  });
  $<HTMLInputElement>('lr-file').accept = '.png,.txt,.md,image/png,text/plain';
  for (const id of ['m-load', 'p-load']) $(id).classList.toggle('hidden', !debug);
}
