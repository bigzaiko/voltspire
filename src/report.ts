// BEATSPIRE bug reports: one button, "Report on GitHub", opens a new issue on the game's repository with everything filled
// in, including a state block (snapshot.ts) from which the run can be rebuilt exactly (tools/repro.ts, or Load report in a
// dev build or with ?debug=1). Nothing is sent from here: the player submits the issue on GitHub, signed in to their own
// account. The game state goes into the issue in the way its size allows (see planReport and the limits below):
//  1. it all fits in the new-issue link: GitHub opens with everything filled in;
//  2. too long for a link, short enough for one issue: GitHub opens with the text filled in and a PASTE STATE HERE line, the
//     rest (the state block, and the logs if they did not fit either) goes on the clipboard;
//  3. too long even for one issue: the game also downloads a report file (with a screenshot in it) to drag into the issue.
// A small ring buffer keeps the last game events and player actions (logEvents, logAction) and the last console errors and
// warnings (installed when this module loads), with messages only: query strings are cut from URLs, no storage is read.
import { encodeSnapshot, decodeSnapshot, restoreSim, trialRun } from './game/snapshot.ts';
import type { Sim, Ev } from './game/sim.ts';

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
 *  - An issue body may be 65536 characters (GitHub's documented limit, "Body is too long (maximum is 65536 characters)").
 *    Not tested here: that needs a real issue, and none is ever created. BODY_MAX leaves room for the player's own edits.
 */
export const URL_MAX = 6400;
export const URL_MAX_LOGIN = 6200;
export const BODY_MAX = 60000;
/** Text limits of the form. */
export const SUMMARY_MAX = 120;
export const WHAT_MAX = 2000;
export const EXPECT_MAX = 1000;
const EVENTS_MAX = 200, CONSOLE_MAX = 50;
export const PASTE_HERE = 'PASTE STATE HERE: the game copied it to your clipboard. Select this line and paste with Ctrl+V (Cmd+V on a Mac), or long-press and Paste on a phone.';
export const ATTACH_HERE = 'ATTACH THE REPORT FILE HERE: the game downloaded it as {file}. Drag it into this box, or use "Paste, drop, or click to add files" below.';

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
  path: 1 | 2 | 3;
  title: string;
  /** the new-issue link to open */
  url: string;
  /** the body as the link fills it in */
  urlBody: string;
  /** path 2: what goes on the clipboard */
  clip: string;
  /** path 3: the report file (its name and text; the screenshot is added on the way out) */
  fileName: string; file: string;
  /** the body as it reads once the player pasted or attached the rest (what the preview shows) */
  body: string;
}
export const issueUrl = (title: string, body: string) => NEW_ISSUE_URL + '?' + new URLSearchParams({ title, labels: 'bug', body }).toString();
/** True if a new-issue link is short enough for GitHub, signed in or out (see URL_MAX). */
export const urlFits = (url: string) => url.length <= URL_MAX && encodeURIComponent(url).length <= URL_MAX_LOGIN;
export const titleOf = (summary: string) => '[Bug] ' + (summary.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX) || 'untitled');
/**
 * Choose how a report goes to GitHub (see the header): the whole issue in the link when it fits; else the text that fits
 * (the player's text and the game's details first, then the logs) in the link with a PASTE STATE HERE line, the rest on the
 * clipboard; else, when the pasted issue would pass BODY_MAX, an ATTACH line and a downloaded file with everything.
 * `force` (a test hook) skips the paths before it.
 */
export function planReport(title: string, head: string, log: string, state: string, force: 0 | 1 | 2 | 3 = 0, stamp = 'report'): Plan {
  const parts = [head, log, state], join = (p: string[]) => p.join('\n\n');
  const full = join(parts), url1 = issueUrl(title, full);
  const fileName = `beatspire-${stamp}.txt`;
  const base = { title, clip: '', fileName: '', file: '' };
  if (force <= 1 && (urlFits(url1) || force === 1)) return { ...base, path: 1, url: url1, urlBody: full, body: full };
  // the link takes the first parts that fit, the rest goes on the clipboard (or into the file)
  const split = (mark: string) => {
    for (let k = parts.length - 1; k >= 0; k--) {
      const urlBody = join([...parts.slice(0, k), mark]), url = issueUrl(title, urlBody);
      if (urlFits(url) || k === 0) return { k, urlBody, url };
    }
    throw new Error('unreachable');
  };
  const s2 = split(PASTE_HERE), clip = join(parts.slice(s2.k));
  if (force <= 2 && (full.length <= BODY_MAX || force === 2)) return { ...base, path: 2, url: s2.url, urlBody: s2.urlBody, clip, body: full };
  const s3 = split(ATTACH_HERE.replace('{file}', fileName));
  const file = `BEATSPIRE bug report\n${title}\n\n${full}\n`;
  return { ...base, path: 3, url: s3.url, urlBody: s3.urlBody, fileName, file, body: s3.urlBody + `\n\n[attached: ${fileName}, ${Math.ceil(file.length / 1024)} KB, with the whole report, the state and a screenshot]` };
}

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
/** Test hooks (exposed on the dev server and with ?debug=1): force a path, catch the opened link and the download, read the last plan. */
export const reportHooks = {
  force: 0 as 0 | 1 | 2 | 3,
  open: null as null | ((url: string) => void),
  download: null as null | ((name: string, text: string) => void),
  last: null as null | Plan,
  /** the state block of the open form ('' outside a run) */
  get block() { return block; },
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let host: ReportHost | null = null;
let block = '', packing: Promise<void> | null = null, shotUrl = '', lastFocus: Element | null = null, prevTimer = 0, openId = 0;
const fields = (): ReportFields => ({ summary: $<HTMLInputElement>('rp-sum').value, what: $<HTMLTextAreaElement>('rp-what').value, expected: $<HTMLTextAreaElement>('rp-exp').value });
const env = () => ({ ua: navigator.userAgent, screen: `${screen.width}x${screen.height}, window ${innerWidth}x${innerHeight} at ${(devicePixelRatio || 1).toFixed(2)}x` });
const status = (text: string, bad = false) => { const s = $('rp-status'); s.textContent = text; s.classList.toggle('bad', bad); };
const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

function plan(): Plan {
  const f = fields(), c = host!.context();
  const p = planReport(titleOf(f.summary), headText(f, c, env()), logText(), stateText(block), reportHooks.force, fileStamp());
  reportHooks.last = p;
  return p;
}
const HOW: Record<1 | 2 | 3, string> = {
  1: 'It all fits in the link: GitHub opens with everything filled in.',
  2: 'Too long for a link: GitHub opens with the text filled in, and the game state goes on your clipboard to paste where it says PASTE STATE HERE.',
  3: 'Too long for one issue: GitHub opens with the text filled in, and the game downloads a report file (with a screenshot) to drag into the issue.',
};
function preview() {
  clearTimeout(prevTimer);
  const f = fields();
  $('rp-what-n').textContent = `${f.what.length} / ${WHAT_MAX}`;
  if (packing) { $('rp-how').textContent = 'Packing the game state...'; $('rp-preview').textContent = ''; return; }
  const p = plan();
  $('rp-how').textContent = HOW[p.path] + ` (${p.body.length.toLocaleString('en')} characters)`;
  $('rp-preview').textContent = `${p.title}\n\n${p.body}`;
}
/** Capture the frame on the canvas as a PNG (drawn right before it is read: a WebGL canvas keeps its picture only until then). */
function grab(): Promise<Blob | null> {
  return new Promise((res) => { try { host!.render(); host!.canvas.toBlob((b) => res(b), 'image/png'); } catch { res(null); } });
}

/** Open the report form (pauses nothing itself: the caller does). */
export function openReport() {
  if (!host) return;
  const id = ++openId;
  lastFocus = document.activeElement;
  $('report').classList.remove('hidden');
  status('');
  $('rp-link').classList.add('hidden'); $('rp-clipbox').classList.add('hidden');
  shotUrl = ''; block = '';
  void grab().then((b) => (b ? blobData(b) : '')).then((u) => { if (id === openId) shotUrl = u; });
  const sim = host.sim();
  packing = sim ? encodeSnapshot(sim, { build: BUILD.hash, date: new Date().toISOString() }).then((b) => { if (id === openId) block = b; }, (e: unknown) => { if (id === openId) { block = ''; status('The game state could not be packed: ' + argText(e), true); console.error(e); } }).finally(() => { if (id === openId) { packing = null; preview(); } }) : null;
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
function download(name: string, text: string) {
  if (reportHooks.download) { reportHooks.download(name, text); return; }
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.href = u; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
/**
 * Copy text inside the click itself (a hidden textarea and execCommand: synchronous, and it works in Firefox and Safari as
 * well as Chrome), so the GitHub tab can still open in the same click: a browser blocks a window opened later than that.
 */
function copyNow(text: string): boolean {
  const ta = document.createElement('textarea'), back = document.activeElement;
  ta.className = 'rp-offscreen'; ta.readOnly = true; ta.value = text; ta.setAttribute('aria-hidden', 'true'); ta.tabIndex = -1;
  $('report').appendChild(ta);
  let ok = false;
  try { ta.select(); ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (back instanceof HTMLElement) back.focus();
  return ok;
}
const blobData = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(''); r.readAsDataURL(b); });

/**
 * The Report button. Everything up to opening the tab runs inside the click, with no wait in between (a popup blocker lets a
 * window.open through only then): the state was packed and the screenshot read while the player wrote.
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
  const okMsg = 'The game state is on your clipboard. On GitHub, paste with Ctrl+V / long-press Paste where it says PASTE STATE HERE, then press Create.';
  const byHand = () => {
    const ta = $<HTMLTextAreaElement>('rp-clip');
    ta.value = p.clip; $('rp-clipbox').classList.remove('hidden');
    status('Your browser did not let the game use the clipboard: copy the text in the box below by hand, then paste it on GitHub where it says PASTE STATE HERE.', true);
  };
  if (p.path === 1) {
    openTab(p.url);
    status('GitHub is open in a new tab with everything filled in. Check it and press Create there.');
  } else if (p.path === 2) {
    if (copyNow(p.clip)) { openTab(p.url); status(okMsg); return; }
    // (no synchronous copy: the Clipboard API, then the tab; it answers in a moment, well inside the click's grace period)
    const cb = navigator.clipboard;
    const tryApi = cb && typeof cb.writeText === 'function' ? cb.writeText(p.clip).then(() => true, () => false) : Promise.resolve(false);
    void tryApi.then((ok) => { openTab(p.url); if (ok) status(okMsg); else byHand(); });
  } else {
    download(p.fileName, p.file + (shotUrl ? `\n### Screenshot (PNG as a data URL)\n${shotUrl}\n` : '\n(no screenshot: the browser did not give the game its picture)\n'));
    openTab(p.url);
    status(`The game downloaded ${p.fileName}. On GitHub, drag that file into the issue where it says ATTACH THE REPORT FILE HERE, then press Create.`);
  }
}
async function copyShot() {
  const C = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!C || !navigator.clipboard || typeof navigator.clipboard.write !== 'function') { status('This browser cannot put a picture on the clipboard. Use your system\'s screenshot tool instead if a picture helps.', true); return; }
  try {
    // (the picture is handed over as a promise, inside the click: Safari needs that)
    await navigator.clipboard.write([new C({ 'image/png': grab().then((b) => { if (!b) throw new Error('no picture'); return b; }) })]);
    status('A screenshot is on your clipboard: paste it into the issue on GitHub with Ctrl+V / long-press Paste.');
  } catch { status('The browser did not let the game copy a screenshot. Use your system\'s screenshot tool instead if a picture helps.', true); }
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
  $('rp-shot').addEventListener('click', () => void copyShot());
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
    $<HTMLTextAreaElement>('lr-text').value = await f.text();
    $('lr-status').textContent = `${f.name}: ${Math.ceil(f.size / 1024)} KB read. Press Load.`;
  });
  for (const id of ['m-load', 'p-load']) $(id).classList.toggle('hidden', !debug);
}
