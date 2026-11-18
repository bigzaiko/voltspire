// BEATSPIRE sound. Everything is synthesised with Web Audio, there are no audio files.
//
// Signal path: every effect is one "instance" (a small gain node that all of its layers feed). Instances go to
// one of three buses (tower chatter, hero and warnings, interface), the score has its own bus, and all four meet
// in a mix node with headroom. From there: limiter, soft clipper, master volume, output. Nothing can clip.
//
// Rules that keep it free of clicks and crackle:
// - every envelope starts at zero with a linear attack of a few milliseconds and ends at zero with a real release;
// - nothing is scheduled in the past (a short lead on every start);
// - there is a cap on instances per effect and overall. A new effect over the cap fades out an older or less
//   important one over 30 ms, it never cuts it;
// - volume and mute changes glide.

export interface TrackInfo { id: string; name: string; key: string; bpm: number }
export interface Cue { t: number; name: string; g?: number; pan?: number }

interface Tone { f: number; to?: number; dur: number; vol: number; type?: OscillatorType; when?: number; att?: number; rel?: number; flat?: boolean; lp?: number; lpTo?: number; q?: number; det?: number; uni?: number; glide?: number; vib?: number; vibD?: number; out?: AudioNode }
interface Noise { dur: number; vol: number; freq: number; to?: number; q?: number; when?: number; type?: BiquadFilterType; att?: number; flat?: boolean; out?: AudioNode }
interface Inst { name: string; pri: number; end: number; level: number; g: GainNode; srcs: AudioScheduledSourceNode[]; dead: boolean }

/** seconds between "now" and the first scheduled sample of an effect, so its attack is never cut short */
const LEAD = 0.012;
/** most instances alive at once, and most of the lowest priority (tower chatter) among them */
const INST_MAX = 26, CHATTER_MAX = 12;

// Per effect: priority (3 hero actions and warnings, 2 notable, 1 tower chatter, 0 factory ambience that never pushes anything
// else out), most instances at once,
// shortest gap between two triggers in ms, bus (h hero, s chatter, u interface).
type Meta = [pri: number, max: number, gap: number, bus: 'h' | 's' | 'u'];
const DEF: Meta = [2, 2, 60, 's'];
const META: Record<string, Meta> = {
  shot: [1, 3, 70, 's'], arcshot: [1, 2, 90, 's'], mortar: [1, 2, 90, 's'], rail: [1, 2, 90, 's'], cryo: [1, 2, 160, 's'], missile: [1, 2, 90, 's'],
  flame: [1, 2, 220, 's'], lance: [1, 2, 220, 's'], gravity: [1, 1, 400, 's'], boom: [1, 3, 90, 's'], die: [1, 4, 55, 's'], mitedie: [1, 3, 50, 's'],
  shield: [2, 2, 90, 's'], special: [2, 2, 120, 's'], down: [2, 2, 120, 's'], up: [2, 2, 120, 's'], build: [2, 2, 60, 's'], sell: [2, 2, 60, 's'],
  deflect: [2, 3, 90, 's'], spindown: [2, 2, 200, 's'], spinup: [2, 2, 200, 's'], brood: [2, 2, 250, 's'], unjam: [2, 2, 150, 's'], bossdie: [3, 2, 300, 'h'],
  arrow: [3, 4, 45, 'h'], bigshot: [3, 2, 120, 'h'], rain: [3, 1, 300, 'h'], sing: [3, 1, 300, 'h'], crit: [3, 3, 60, 'h'], drawfull: [3, 1, 80, 'h'], nospec: [2, 1, 120, 'h'],
  heroOn: [3, 1, 400, 'h'], heroOff: [3, 1, 400, 'h'], tele: [3, 2, 150, 'h'], ready: [3, 1, 600, 'h'], overlink: [3, 1, 600, 'h'],
  wave: [3, 1, 400, 'h'], boss: [3, 1, 400, 'h'], leak: [3, 2, 150, 'h'], breach: [3, 2, 120, 'h'], clear: [3, 1, 400, 'h'], levelup: [3, 1, 400, 'h'], jam: [3, 2, 200, 'h'],
  titanLand: [3, 1, 1000, 'h'], titanImpact: [3, 1, 1000, 'h'], titanSmash: [2, 1, 1500, 's'], titanDie: [3, 1, 1000, 'h'], win: [3, 1, 1000, 'h'], lose: [3, 1, 1000, 'h'],
  card: [3, 1, 80, 'u'], error: [2, 1, 90, 'u'], click: [2, 2, 30, 'u'], hover: [1, 1, 45, 'u'],
  take: [0, 2, 110, 's'], mats: [1, 2, 220, 's'],
};
/** how far the score steps back for a big moment: depth, seconds held */
const DUCK: Record<string, [number, number]> = { heroOn: [0.5, 1.6], boss: [0.55, 2], titanLand: [0.45, 2.4], titanImpact: [0.3, 2.2], titanDie: [0.3, 3.2], bossdie: [0.55, 1.6], win: [0.25, 4], lose: [0.25, 4] };

// ---------- the score: generated synthwave ----------
// Seven original tracks in three styles: 'dark' (driving darksynth: 16th-note distorted bass, gated snare, Phrygian
// colour), 'outrun' (cinematic: Juno-style pluck arpeggio, octave bass, chorused strings, delayed-vibrato lead) and
// 'drama' (synth-rock: classical broken-chord arpeggios, octave bass, supersaw stabs, gliding lead, a key change).
//
// Every track follows one form (bars): intro 8, verse 16, build 8, chorus 16, breakdown 8, bridge 8, final chorus 16,
// outro 8. After the outro it goes on at the verse, and each pass (a "cycle") picks other drum, bass and arpeggio
// variants and other lead ornaments, so a long run does not sound like one loop.
//
// The game steers it on bar lines: `calm` (planning between waves) drops to pads, a soft arpeggio and a soft kick;
// leaving calm hits a transition into the verse or the chorus; `intense` (the Titan) switches to the track's darkest
// progression with double-time hats, claps, more distortion and a lead riff over everything.
//
// Chords are roman numerals in the minor key ('i', 'bVI', 'V', 'bII', 'vii°', with '7', 'M7', 'sus2', 'sus4', 'add9').
// Lead phrases: 16 characters a bar, one per sixteenth; a digit or letter is a degree of the track's scale counted
// from `leadRoot` (0 = root, 7 = octave, a = 10 ...), '-' holds, '.' rests. Notes that follow a held note glide.
type Pole = 'dark' | 'outrun' | 'drama';
type Sec = 'intro' | 'verse' | 'build' | 'chorus' | 'break' | 'bridge' | 'chorus2' | 'outro';
type ProgKey = 'verse' | 'chorus' | 'build' | 'bridge' | 'dark';
interface Track extends TrackInfo {
  pole: Pole;
  /** pitch class of the key (0 = C) */
  tonic: number;
  /** the scale the lead is written in, semitones above the tonic */
  scale: number[];
  /** MIDI note of lead degree 0 */
  leadRoot: number;
  prog: Record<ProgKey, string[]>;
  /** chorus phrases over the 4 chorus chords: the hook, its last bar the second time, the answer and its last bar */
  hook: string[]; hookEnd: string; answer: string[]; answerEnd: string;
  /** semitones the final chorus is lifted by (0: it lifts the lead an octave instead) */
  lift: number;
}
const TRACK_DEFS: Track[] = [
  {
    id: 'relay', name: 'Night Relay', key: 'A minor', bpm: 100, pole: 'outrun', tonic: 9, scale: [0, 2, 3, 5, 7, 8, 10], leadRoot: 57, lift: 0,
    prog: { verse: ['i', 'bVI', 'bIII', 'bVII'], chorus: ['bVIM7', 'bVII', 'i', 'v'], build: ['iv', 'iv', 'bVI', 'bVII'], bridge: ['bVI', 'bIII', 'iv7', 'V'], dark: ['i', 'bII', 'i', 'bVII'] },
    hook: ['c-----b-9---7---', 'b-----a-8---6---', '9-------b---c-b-', 'b-----------....'], hookEnd: 'b-------8---9---',
    answer: ['7---9---c---9---', 'a---8---d---b---', 'b---9---7---9---', '8-----------....'], answerEnd: '8-------6---8---',
  },
  {
    id: 'rust', name: 'Rust Horizon', key: 'D minor', bpm: 90, pole: 'outrun', tonic: 2, scale: [0, 2, 3, 5, 7, 9, 10], leadRoot: 62, lift: 2,
    prog: { verse: ['i', 'bVII', 'IV', 'i'], chorus: ['bIII', 'bVII', 'IV', 'isus2'], build: ['v', 'bVII', 'v', 'bVII'], bridge: ['bVI', 'bIII', 'bVII', 'V'], dark: ['i', 'bII', 'bVII', 'i'] },
    hook: ['4-----2-4---6---', '8-------7---6---', '5-----4-3---1---', '0-----------....'], hookEnd: '0-------2---4---',
    answer: ['6---7---9---7---', '8---6---8---a---', 'a-------8---7---', '7-----------....'], answerEnd: '7-------9---8---',
  },
  {
    id: 'drive', name: 'Verdigris Drive', key: 'E minor', bpm: 112, pole: 'drama', tonic: 4, scale: [0, 2, 3, 5, 7, 8, 11], leadRoot: 64, lift: 1,
    prog: { verse: ['i', 'bVI', 'iv', 'V', 'i', 'bVI', 'bII', 'V7'], chorus: ['bVI', 'bIII', 'iv', 'V'], build: ['iv', 'iv', 'V', 'V7'], bridge: ['iv', 'bVII', 'bIII', 'bVI', 'ii°', 'V', 'i', 'V7'], dark: ['i', 'bII', 'V', 'i'] },
    hook: ['7-----5-4---7---', '9-------b---9---', 'a-----9-7---a---', '6---------------'], hookEnd: '6-------4---6---',
    answer: ['c-----b-9---7---', 'b-----9-7---9---', 'a---c---a---7---', 'd-------b-------'], answerEnd: 'd---b---8---6---',
  },
  {
    id: 'lowsun', name: 'Low Sun', key: 'F# minor', bpm: 96, pole: 'outrun', tonic: 6, scale: [0, 2, 3, 5, 7, 8, 10], leadRoot: 66, lift: 0,
    prog: { verse: ['i', 'bIII', 'bVI', 'bVII'], chorus: ['iv', 'bVI', 'bIII', 'bVII'], build: ['bVI', 'bVI', 'bVII', 'bVII'], bridge: ['bVI', 'bVII', 'bIII', 'bVI', 'iv', 'iv', 'V', 'V'], dark: ['i', 'bII', 'bVI', 'V'] },
    hook: ['a-----9-7-------', '5-----7-9-------', 'b-------9---6---', '8---------------'], hookEnd: '8-------a---8---',
    answer: ['7---a---9---7---', '9---7---5---7---', '6---9---b---9---', 'a-------8-------'], answerEnd: 'a-------6---8---',
  },
  {
    id: 'gate', name: 'Gatecrash', key: 'C minor', bpm: 118, pole: 'dark', tonic: 0, scale: [0, 2, 3, 5, 7, 8, 11], leadRoot: 60, lift: 0,
    prog: { verse: ['i', 'i', 'bII', 'i'], chorus: ['bVI', 'iv', 'i', 'V'], build: ['iv', 'iv', 'bII', 'bII'], bridge: ['bVI', 'bVI', 'bII', 'bII', 'iv', 'iv', 'V', 'V7'], dark: ['i', 'bII', 'i', 'bII'] },
    hook: ['7-7-9-7-5---9---', '8-7-5-3-5---7---', '4-4-7-4-2---4---', '6---4---1---6---'], hookEnd: '4-------6-------',
    answer: ['c---b---9---7---', 'a---9---7---5---', '7---9---b---9---', 'd-------b-------'], answerEnd: 'd---b---8---d---',
  },
  {
    id: 'requiem', name: 'Iron Requiem', key: 'F minor', bpm: 124, pole: 'dark', tonic: 5, scale: [0, 2, 3, 5, 7, 8, 11], leadRoot: 53, lift: 0,
    prog: { verse: ['i', 'bVI', 'i', 'bII'], chorus: ['i', 'bVII', 'bVI', 'V'], build: ['bVI', 'bVI', 'V', 'V7'], bridge: ['iv', 'iv', 'bII', 'bII', 'bVI', 'bVI', 'V', 'V'], dark: ['i', 'bII', 'i', 'vii°'] },
    hook: ['7-------b---a-9-', 'a-------8-------', '9-----7-5-------', '6-------4-------'], hookEnd: '6---4---6---8---',
    answer: ['b---9---7---b---', 'a---8---a---c---', 'c-------9-------', 'b-------d-------'], answerEnd: 'b---d---e---d---',
  },
  {
    id: 'spire', name: 'Spire Protocol', key: 'G minor', bpm: 106, pole: 'drama', tonic: 7, scale: [0, 2, 3, 5, 7, 8, 11], leadRoot: 55, lift: 2,
    prog: { verse: ['i', 'iv', 'V', 'i', 'bVI', 'iv', 'bII', 'V'], chorus: ['i', 'bVI', 'bIII', 'V'], build: ['iv', 'iv', 'V', 'V7'], bridge: ['bVI', 'bVI', 'bII', 'bII', 'iv', 'vii°', 'V', 'V7'], dark: ['i', 'bII', 'iv', 'V'] },
    hook: ['b-----a-9-----7-', 'c-------b-9-----', '9-----b-e-------', 'd---------------'], hookEnd: 'd-------b---8---',
    answer: ['e---b---9---b---', 'c---9---7---9---', 'b---9---b---e---', 'd-------8-------'], answerEnd: 'd---b---8---d---',
  },
];
/** The built-in tracks, for the Music sheet. */
export const TRACKS: TrackInfo[] = TRACK_DEFS.map(({ id, name, key, bpm }) => ({ id, name, key, bpm }));
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** The form every track follows, in bars. */
export const SCORE_FORM: [Sec, number][] = [['intro', 8], ['verse', 16], ['build', 8], ['chorus', 16], ['break', 8], ['bridge', 8], ['chorus2', 16], ['outro', 8]];
const FORM_START = {} as Record<Sec, number>;
const FORM_BARS = SCORE_FORM.reduce((n, [s, len]) => { FORM_START[s] = n; return n + len; }, 0);
/** where a finished form goes on: the verse */
const LOOP_AT = FORM_START.verse;
/** A track played through once (the playlist then moves on): one pass of the form, three to four minutes. */
const SONG_STEPS = FORM_BARS * 16;
const PROG_OF: Record<Sec, ProgKey> = { intro: 'verse', verse: 'verse', build: 'build', chorus: 'chorus', break: 'verse', bridge: 'bridge', chorus2: 'chorus', outro: 'verse' };

interface Chord { root: number; tones: number[] }
const NUM: Record<string, number> = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };
/** 'bVI' -> root 8 above the tonic, major triad. Lower case is minor, '°' diminished. */
function parseChord(sym: string): Chord {
  const m = /^(b?)([ivIV]+)(°?)(.*)$/.exec(sym);
  if (!m) return { root: 0, tones: [0, 3, 7] };
  const num = m[2], minor = num === num.toLowerCase(), ext = m[4];
  const root = (NUM[num.toLowerCase()] ?? 0) - (m[1] ? 1 : 0);
  let tones = m[3] ? [0, 3, 6] : minor ? [0, 3, 7] : [0, 4, 7];
  if (ext === 'sus2') tones = [0, 2, 7];
  else if (ext === 'sus4') tones = [0, 5, 7];
  else if (ext === '7') tones = [...tones, m[3] ? 9 : minor || num.toLowerCase() === 'v' ? 10 : 10];
  else if (ext === 'M7') tones = [...tones, 11];
  else if (ext === 'add9') tones = [...tones, 14];
  return { root: (root + 12) % 12, tones };
}
/** Pitch classes (0 = C) a track may use, by section group: the analysis tools check renders against this. */
export function trackPitchClasses(id: string): { home: number[]; lifted: number[] } {
  const tr = TRACK_DEFS.find((x) => x.id === id) || TRACK_DEFS[0], home = new Set<number>(), lifted = new Set<number>();
  for (const d of tr.scale) home.add((tr.tonic + d) % 12);
  for (const k of ['verse', 'chorus', 'build', 'bridge', 'dark'] as ProgKey[]) for (const s of tr.prog[k]) { const c = parseChord(s); for (const x of c.tones) home.add((tr.tonic + c.root + x) % 12); }
  for (const s of tr.prog.chorus) { const c = parseChord(s); for (const x of c.tones) lifted.add((tr.tonic + c.root + x + tr.lift) % 12); }
  for (const d of tr.scale) lifted.add((tr.tonic + d + tr.lift) % 12);
  return { home: [...home].sort((a, b) => a - b), lifted: [...lifted].sort((a, b) => a - b) };
}
/** Four voices for a chord, as close as possible to the last voicing (smooth voice leading), bottom note between 50 and 62. */
function voiceChord(ch: Chord, tonic: number, prev: number[] | null): number[] {
  const iv = ch.tones.length >= 4 ? ch.tones.slice(0, 4) : [...ch.tones, 12];
  const pcs = iv.map((x) => (tonic + ch.root + x) % 12);
  let best: number[] = [], cost = Infinity;
  for (let r = 0; r < 4; r++) {
    const v: number[] = [];
    let n = 50 + ((pcs[r] - 50) % 12 + 12) % 12;
    v.push(n);
    for (let k = 1; k < 4; k++) { const pc = pcs[(r + k) % 4]; n = n + 1 + (((pc - n - 1) % 12) + 12) % 12; v.push(n); }
    if (v[3] - v[0] > 19) continue;
    const c = prev ? v.reduce((s, x, i) => s + Math.abs(x - prev[i]), 0) : Math.abs(v[0] - 55) + Math.abs(v[3] - 67);
    if (c < cost) { cost = c; best = v; }
  }
  return best;
}

// Per style: drum, bass, arpeggio and stab patterns (16 steps; several variants are rotated by cycle) and the sound.
// Drums: x hit, X accent, o open hat. Bass: r root, o octave, f fifth, - holds. Arpeggio: index into the voicing and
// the voicing an octave up (0..7), -1 rests.
interface Style {
  kick: { verse: string[]; chorus: string[]; half: string[] };
  hat: { verse: string; chorus: string; half: string };
  bass: { verse: string[]; chorus: string[]; half: string[] };
  arp: number[][]; stab: string; counter: string[];
  /** sidechain: the level pad, bass and arpeggio dip to on a kick */
  duck: number;
  bassDrive: number; bassQ: number; bassCut: number; leadDrive: number; leadCut: number; glide: number; vib: number; padCut: number; hard: boolean;
}
const STYLE: Record<Pole, Style> = {
  dark: {
    kick: { verse: ['x...x...x...x...', 'x...x...x...x..x', 'x...x...x.x.x...'], chorus: ['x...x...x...x...', 'x...x...x...xx..'], half: ['x.........x.....', 'x.......x.x.....'] },
    hat: { verse: 'x.X.x.X.x.X.x.X.', chorus: 'x.o.x.o.x.o.x.o.', half: 'x...x...x...x...' },
    bass: { verse: ['rrorrrorrrorrror', 'rrrrorrrrrrrorro'], chorus: ['rorororororororo', 'rrorrorrrrorrorr'], half: ['r-------r-----o-'] },
    arp: [[0, 4, 1, 4, 2, 4, 1, 4, 0, 4, 1, 4, 2, 4, 3, 4], [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3], [4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 7]],
    stab: 'x..x..x...x..x..', counter: ['x-------..x-x---', 'x-----x-----x---'],
    duck: 0.3, bassDrive: 3.2, bassQ: 5, bassCut: 320, leadDrive: 3, leadCut: 3800, glide: 0.03, vib: 10, padCut: 1300, hard: true,
  },
  outrun: {
    kick: { verse: ['x.......x.x.....', 'x.....x.x.......'], chorus: ['x...x...x...x...', 'x...x...x...x.x.'], half: ['x.........x.....'] },
    hat: { verse: '..x...x...x...x.', chorus: 'x.x.x.x.x.x.x.o.', half: '..x...x...x...x.' },
    bass: { verse: ['r-r-o-r-r-r-o-r-', 'r-o-r-o-r-o-r-o-'], chorus: ['r-o-r-o-r-o-r-o-', 'r-r-o-r-r-r-o-ro'], half: ['r-----------o---'] },
    arp: [[0, -1, 2, -1, 1, -1, 3, -1, 4, -1, 2, -1, 5, -1, 3, -1], [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 2, 1, 3, 6, 3], [0, 4, 2, 4, 1, 4, 2, 4, 0, 4, 3, 4, 2, 4, 1, 4]],
    stab: '', counter: ['x-------x-------', 'x-----x---x-----'],
    duck: 0.45, bassDrive: 1.4, bassQ: 7, bassCut: 240, leadDrive: 1.2, leadCut: 2600, glide: 0.05, vib: 14, padCut: 1100, hard: false,
  },
  drama: {
    kick: { verse: ['x..x..x...x.....', 'x..x..x...x...x.'], chorus: ['x...x...x...x...', 'x...x...x...x..x'], half: ['x.......x.......'] },
    hat: { verse: 'XxxxXxxxXxxxXxxx', chorus: 'XxxxXxxxXxxxXxox', half: 'x.x.x.x.x.x.x.x.' },
    bass: { verse: ['r-r-r-r-r-r-r-o-', 'rrrrrrrrrrrrrrro'], chorus: ['rorororororororo', 'rororororororfro'], half: ['r-------o-------'] },
    arp: [[0, 2, 1, 2, 0, 2, 1, 2, 0, 3, 2, 3, 0, 3, 2, 3], [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3], [0, 2, 4, 6, 4, 2, 0, 2, 1, 3, 5, 7, 5, 3, 1, 3]],
    stab: 'x.....x.....x...', counter: ['x-------x-------', 'x-----------x---'],
    duck: 0.5, bassDrive: 2, bassQ: 3, bassCut: 380, leadDrive: 1.6, leadCut: 3400, glide: 0.09, vib: 16, padCut: 1500, hard: false,
  },
};
/** a riff for the lead over any chord while the Titan is on the field */
const HOT_RIFF = ['x.x.x..x..x.x...', 'x..x..x.x...x.x.'];
/** detune (cents) and level of the seven saws of the supersaw lead; outer voices go left and right */
const SUPER: [number, number][] = [[0, 1], [-11, 0.62], [12, 0.62], [-23, 0.48], [24, 0.48], [-36, 0.36], [37, 0.36]];

// ---------- generated drum kit and plate (computed once per sample rate, shared by every render) ----------
type Chans = Float32Array[];
interface KitData { kick: Chans; kickHard: Chans; snare: Chans; clap: Chans; tom: Chans; hat: Chans; ohat: Chans; crash: Chans; rcrash: Chans; impact: Chans; plate: Chans }
const KITS = new Map<number, KitData>();
function lcg(seed: number) { let s = seed | 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 2147483648 - 1; }
/** an RBJ biquad run over the samples in place */
function biq(x: Float32Array, sr: number, type: 'lp' | 'hp' | 'bp', f: number, q: number) {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
  let b0: number, b1: number, b2: number;
  if (type === 'lp') { b1 = 1 - cw; b0 = b2 = b1 / 2; } else if (type === 'hp') { b1 = -(1 + cw); b0 = b2 = (1 + cw) / 2; } else { b0 = al; b1 = 0; b2 = -al; }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
function norm(ch: Chans, peak: number): Chans {
  let m = 0;
  for (const x of ch) for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  for (const x of ch) { for (let i = 0; i < x.length; i++) x[i] *= peak / (m || 1); const f = Math.min(x.length, 64); for (let i = 0; i < f; i++) x[x.length - 1 - i] *= i / f; }
  return ch;
}
/** a gated reverb tail: dense decorrelated noise, held, then shut at `gate` seconds */
function gatedTail(sr: number, len: number, gate: number, seed: number, lp: number): Float32Array {
  const r = lcg(seed), x = new Float32Array(Math.floor(sr * len));
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] = r() * Math.min(1, t / 0.006) * Math.exp(-t / 0.55) * (t < gate ? 1 : Math.max(0, 1 - (t - gate) / 0.018));
  }
  biq(x, sr, 'lp', lp, 0.7); biq(x, sr, 'hp', 350, 0.7);
  return x;
}
function metal(sr: number, len: number, decay: number, seed: number): Float32Array {
  const x = new Float32Array(Math.floor(sr * len)), r = lcg(seed), fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 1.47);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const f of fr) v += Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1;
    x[i] = (v / 6 + r() * 0.5) * Math.min(1, t / 0.0006) * Math.exp(-t / decay);
  }
  biq(x, sr, 'bp', 10000, 0.9); biq(x, sr, 'hp', 7000, 0.7);
  return x;
}
function kitFor(sr: number): KitData {
  const have = KITS.get(sr);
  if (have) return have;
  const N = (s: number) => new Float32Array(Math.floor(sr * s));
  const kick = (hard: boolean): Chans => {
    const x = N(0.5), r = lcg(hard ? 11 : 12);
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, f = (hard ? 47 : 52) + (hard ? 150 : 105) * Math.exp(-t / 0.028) + 60 * Math.exp(-t / 0.004);
      ph += (2 * Math.PI * f) / sr;
      const a = Math.min(1, t / 0.0007) * (t < 0.025 ? 1 : Math.exp(-(t - 0.025) / (hard ? 0.2 : 0.15)));
      const k = hard ? 2.4 : 1.5;
      x[i] = Math.tanh(k * Math.sin(ph) * a) / Math.tanh(k) + (r() * 0.5 * Math.exp(-t / 0.0022) * Math.min(1, t / 0.0003) + Math.sin(2 * Math.PI * 1900 * t) * 0.22 * Math.exp(-t / 0.005)) * (hard ? 1.3 : 0.8);
    }
    return norm([x], 1);
  };
  const snare = (): Chans => {
    const r = lcg(21), body = N(0.42), crack = N(0.42);
    let ph = 0;
    for (let i = 0; i < body.length; i++) {
      const t = i / sr; ph += (2 * Math.PI * (185 + 60 * Math.exp(-t / 0.012))) / sr;
      body[i] = (Math.sin(ph) * 0.7 * Math.exp(-t / 0.07) + Math.sin(2 * Math.PI * 330 * t) * 0.25 * Math.exp(-t / 0.04)) * Math.min(1, t / 0.0008);
      crack[i] = r() * Math.exp(-t / 0.11) * Math.min(1, t / 0.0005);
    }
    biq(crack, sr, 'bp', 3200, 0.6);
    const L = gatedTail(sr, 0.42, 0.25, 22, 7000), R = gatedTail(sr, 0.42, 0.25, 23, 7000);
    for (let i = 0; i < body.length; i++) { const d = body[i] + crack[i] * 1.6; L[i] = d + L[i] * 0.55; R[i] = d + R[i] * 0.55; }
    return norm([L, R], 1);
  };
  const clap = (): Chans => {
    const r = lcg(31), x = N(0.3);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      let e = Math.exp(-t / 0.08) * 0.5;
      for (const at of [0, 0.011, 0.023]) if (t >= at) e += Math.exp(-(t - at) / 0.004) * Math.min(1, (t - at) / 0.0004);
      x[i] = r() * e;
    }
    biq(x, sr, 'bp', 1150, 1.1);
    const L = gatedTail(sr, 0.3, 0.17, 32, 6000), R = gatedTail(sr, 0.3, 0.17, 33, 6000);
    for (let i = 0; i < x.length; i++) { L[i] = x[i] + L[i] * 0.25; R[i] = x[i] + R[i] * 0.25; }
    return norm([L, R], 1);
  };
  const tom = (): Chans => {
    const r = lcg(41), x = N(0.6), hit = N(0.6);
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr; ph += (2 * Math.PI * 110 * (1 + 0.55 * Math.exp(-t / 0.06))) / sr;
      x[i] = Math.sin(ph) * Math.exp(-t / 0.28) * Math.min(1, t / 0.0008);
      hit[i] = r() * Math.exp(-t / 0.012);
    }
    biq(hit, sr, 'bp', 1400, 0.8);
    const tail = gatedTail(sr, 0.6, 0.3, 42, 4000);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(1.4 * x[i]) + hit[i] * 0.5 + tail[i] * 0.22;
    return norm([x], 1);
  };
  const crash = (len: number, decay: number, seed: number): Chans => {
    const out: Chans = [];
    for (let ch = 0; ch < 2; ch++) {
      const r = lcg(seed + ch), x = N(len), m = metal(sr, len, decay, seed + 7 + ch);
      for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = r() * Math.exp(-t / decay) * Math.min(1, t / 0.001); }
      biq(x, sr, 'hp', 3800, 0.6);
      for (let i = 0; i < x.length; i++) x[i] = x[i] + m[i] * 0.6;
      out.push(x);
    }
    return norm(out, 1);
  };
  const impact = (): Chans => {
    const r = lcg(61), x = N(1.8), n = N(1.8);
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr; ph += (2 * Math.PI * (34 + 50 * Math.exp(-t / 0.09))) / sr;
      x[i] = Math.sin(ph) * Math.exp(-t / 0.7) * Math.min(1, t / 0.001);
      n[i] = r() * Math.exp(-t / 0.35);
    }
    biq(n, sr, 'lp', 500, 0.7);
    for (let i = 0; i < x.length; i++) x[i] += n[i] * 0.6;
    return norm([x], 1);
  };
  const plate = (): Chans => {
    // a bright plate: 15 ms pre-delay, 2.2 s decay, highs dying faster than mids, no lows (they would muddy the bass)
    const len = 2.4, pre = Math.floor(sr * 0.015), out: Chans = [];
    for (let ch = 0; ch < 2; ch++) {
      const r = lcg(71 + ch), x = N(len);
      let lp = 0, hp = 0, prev = 0;
      for (let i = pre; i < x.length; i++) {
        const t = (i - pre) / sr, k = 0.75 - 0.6 * Math.min(1, t / 1.6);
        lp += (r() - lp) * k;
        hp = 0.985 * (hp + lp - prev); prev = lp;
        x[i] = hp * Math.exp((-6.9 * t) / 2.2) * Math.min(1, t / 0.004);
      }
      out.push(x);
    }
    let e = 0;
    for (const x of out) for (let i = 0; i < x.length; i++) e += x[i] * x[i];
    for (const x of out) for (let i = 0; i < x.length; i++) x[i] /= Math.sqrt(e / 2) * 0.6;
    return out;
  };
  const cr = crash(2.6, 0.75, 51), rc = crash(1.6, 0.55, 55).map((x) => x.slice().reverse());
  const k: KitData = { kick: kick(false), kickHard: kick(true), snare: snare(), clap: clap(), tom: tom(), hat: [metal(sr, 0.12, 0.035, 81)], ohat: [metal(sr, 0.6, 0.22, 82)], crash: cr, rcrash: norm(rc, 1), impact: impact(), plate: plate() };
  norm(k.hat, 1); norm(k.ohat, 1);
  KITS.set(sr, k);
  return k;
}
/** tanh saturation curves, by drive */
const CURVES = new Map<number, Float32Array<ArrayBuffer>>();
function satCurve(drive: number): Float32Array<ArrayBuffer> {
  let c = CURVES.get(drive);
  if (!c) { c = new Float32Array(1025); for (let i = 0; i < c.length; i++) { const x = (i / 1024) * 2 - 1; c[i] = Math.tanh(drive * x) / Math.tanh(drive); } CURVES.set(drive, c); }
  return c;
}
/**
 * Drums with a pitched body (the kick's tail at 47 or 52 Hz, the snare's at 185 Hz) beat against the bass or sound
 * a tritone in some keys, so each track plays them a little faster or slower: onto the key's root or fifth if one is
 * within 1.5 semitones, else onto the nearest note of the tonic chord (never more than about 2 semitones away).
 */
function keyRate(tr: Track, f: number): number {
  const base = 12 * Math.log2(f / 440) + 69;
  const near = (pcs: number[]) => { let best = 99; for (let m = Math.floor(base) - 7; m <= base + 7; m++) if (pcs.includes(((m % 12) + 12) % 12) && Math.abs(m - base) < Math.abs(best)) best = m - base; return best; };
  let d = near([tr.tonic, (tr.tonic + 7) % 12]);
  if (Math.abs(d) > 1.5) d = near([tr.tonic, (tr.tonic + 3) % 12, (tr.tonic + 7) % 12]);
  return Math.pow(2, d / 12);
}
type Buffers = Record<Exclude<keyof KitData, 'plate'>, AudioBuffer>;
interface Mono { o: OscillatorNode[]; f: BiquadFilterNode; g: GainNode }
interface MusicBus {
  all: GainNode; duck: GainNode; drums: GainNode; snareBus: GainNode; hat: AudioNode; toms: AudioNode[]; rev: GainNode;
  /** persistent sources, stopped when the bus is dropped */
  oscs: AudioScheduledSourceNode[];
  pad: { o: OscillatorNode[][]; pwm: DelayNode[]; depth: GainNode[]; f: BiquadFilterNode; g: GainNode };
  stab: { o: OscillatorNode[][]; f: BiquadFilterNode; g: GainNode };
  bass: Mono & { drive: GainNode; post: GainNode };
  arp: Mono;
  lead: Mono & { vib: GainNode; drive: GainNode; on: boolean; m: number; end: number };
  kit: Buffers; st: Style;
  /** playback rates that tune the kick's and the snare's pitched bodies to the key (see keyRate) */
  kickRate: number; snareRate: number;
}
interface BarState { sec: Sec | 'calm'; sb: number; calm: boolean; hot: boolean; v: number[]; ch: Chord; bass: number; lift: number; fill: '' | 'toms' | 'snare' | 'stutter' | 'drop' | 'small'; cyc: number }

export class Sound {
  ctx: AudioContext | null = null;
  private mix!: GainNode; private master!: GainNode; private sfxG!: GainNode; private heroG!: GainNode; private musG!: GainNode; private uiG!: GainNode; private musDuck!: GainNode;
  private last: Record<string, number> = {};
  /** per effect: a count of recent triggers that decays over half a second, and the audio time it was last updated */
  private busy: Record<string, [number, number]> = {};
  private noiseBuf!: AudioBuffer;
  private live: Inst[] = [];
  /** the instance being built, and the audio time its layers are measured from */
  private cur: Inst | null = null; private base = 0;
  private timer = 0; private step = 0; private nextT = 0;
  volume = 0.7; musicVol = 0.5; intense = 0; playing = false;
  /** Trailer capture: when set, play() only records cue names against `clock`. */
  cueLog: Cue[] | null = null;
  clock = 0;
  private offset = 0;
  /** Scheduled beats of the score (audio clock time, accent 0..1), read by beatLevel(). */
  private beats: { t: number; a: number }[] = [];
  private scoreMuted = false;
  /** the player's choice: a track id or 'shuffle' */
  private choice = 'shuffle';
  /** the tracks the playlist goes through, in list order (all of them unless the player picked some) */
  private list: Track[] = TRACK_DEFS;
  private tr: Track = TRACK_DEFS[0];
  private mb: MusicBus | null = null;
  private seed = 1;
  private picked = false;
  /**
   * Planning between waves (the game sets it each frame): the score drops to pads, a soft arpeggio and a soft kick,
   * and the bar after it goes false hits a transition into the full groove. Changes land on bar lines.
   */
  calm = false;
  /** Checks only: when set, every pitched note of the score is logged here (MIDI note and section). */
  noteLog: { m: number; sec: string }[] | null = null;
  /** the score's chain: the tracks' sum (`musIn`) through a glue compressor, and the shared plate it sends to */
  private musIn!: GainNode; private plateIn!: GainNode;
  /** where the score is: bar of the form, calm or playing, the Titan's last state, passes through the form, the last chord voicing and lead note */
  private pos = 0; private fresh = true; private mode: 'calm' | 'play' = 'play'; private wasHot = false; private exits = 0; private calmBar = 0; private cyc = 0;
  private voicing: number[] | null = null; private leadM = -1;
  private bs!: BarState;

  init() {
    if (this.ctx) { this.wake(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.build(c);
    // A context that was put to sleep (a hidden tab, a phone call) is woken as soon as the page is back.
    // Going hidden, the sequencer looks further ahead at once: background timers may fire only once a second from now.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.wake(); else if (this.playing) this.schedule(); });
    c.addEventListener('statechange', () => { if (!document.hidden) this.wake(); });
  }
  private wake() {
    const c = this.ctx;
    if (c && c.state !== 'running' && c.state !== 'closed') void c.resume().catch(() => {});
  }
  private build(c: BaseAudioContext) {
    // mix (headroom) > limiter > soft clipper > master volume > output
    this.mix = c.createGain(); this.mix.gain.value = 0.8;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -9; lim.knee.value = 8; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.16;
    // The clipper is linear up to 0.6 and bends into 1.0 above that. Its input is halved so peaks up to 2.0 land on the curve.
    const pre = c.createGain(); pre.gain.value = 0.5;
    const clip = c.createWaveShaper(), N = 2049, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = ((i / (N - 1)) * 2 - 1) * 2, a = Math.abs(x); curve[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.38 * Math.tanh((a - 0.6) / 0.38)); }
    clip.curve = curve; clip.oversample = '2x';
    this.master = c.createGain(); this.master.gain.value = this.volume;
    this.mix.connect(lim).connect(pre).connect(clip).connect(this.master).connect(c.destination);
    // room: three early reflections and a short generated hall
    const send = c.createGain();
    const len = Math.floor(c.sampleRate * 2.1), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.42 * t); d[i] = lp * Math.pow(1 - t, 2.8) * (i < 500 ? i / 500 : 1); }
    }
    const rev = c.createConvolver(); rev.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.7;
    send.connect(rev).connect(wet).connect(this.mix);
    for (const [time, gain] of [[0.013, 0.2], [0.029, 0.15], [0.047, 0.1]]) {
      const d = c.createDelay(0.1), g = c.createGain();
      d.delayTime.value = time; g.gain.value = gain;
      send.connect(d).connect(g).connect(this.mix);
    }
    const bus = (dry: number, wetSend: number) => { const g = c.createGain(); g.gain.value = dry; g.connect(this.mix); const s = c.createGain(); s.gain.value = wetSend; g.connect(s).connect(send); return g; };
    this.sfxG = bus(0.62, 0.22);
    this.heroG = bus(0.85, 0.24);
    this.uiG = bus(0.8, 0.08);
    this.musG = bus(this.scoreMuted ? 0 : this.musicVol * 0.9, 0.06);
    this.musDuck = c.createGain(); this.musDuck.connect(this.musG);
    // the score: tracks > glue compressor (slow attack, so the kick still punches) > trim > the duck for big moments.
    // The plate is shared by every track, so a track change does not build a new convolver.
    this.musIn = c.createGain();
    // nothing under 30 Hz (no rumble, no DC): the kick and the sub still have their 40-60 Hz
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.6;
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 10; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.22;
    // a mastering tilt: a little less boom, a little more presence and air
    const lows = c.createBiquadFilter(); lows.type = 'lowshelf'; lows.frequency.value = 90; lows.gain.value = -3;
    const highs = c.createBiquadFilter(); highs.type = 'highshelf'; highs.frequency.value = 2800; highs.gain.value = 2.5;
    const trim = c.createGain(); trim.gain.value = 0.68;
    this.musIn.connect(hp).connect(lows).connect(highs).connect(glue).connect(trim).connect(this.musDuck);
    const plate = kitFor(c.sampleRate).plate, pb = c.createBuffer(2, plate[0].length, c.sampleRate);
    plate.forEach((x, i) => pb.copyToChannel(x as Float32Array<ArrayBuffer>, i));
    const conv = c.createConvolver(); conv.normalize = false; conv.buffer = pb;
    this.plateIn = c.createGain(); this.plateIn.gain.value = 0.22;
    this.plateIn.connect(conv).connect(this.musIn);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.live = []; this.mb = null; this.busy = {};
  }
  private glide(p: AudioParam, v: number) {
    const c = this.ctx;
    if (c) { p.cancelScheduledValues(c.currentTime); p.setTargetAtTime(v, c.currentTime, 0.03); }
  }
  setVolume(v: number) { this.volume = v; if (this.ctx) this.glide(this.master.gain, v); }
  setMusic(v: number) { this.musicVol = v; if (this.ctx) this.glide(this.musG.gain, this.scoreMuted ? 0 : v * 0.9); }
  /** Silence the built-in score (the player's own music is playing) without touching the saved volume. */
  setScoreMuted(on: boolean) {
    if (this.scoreMuted === on) return;
    this.scoreMuted = on;
    if (this.ctx) this.glide(this.musG.gain, on ? 0 : this.musicVol * 0.9);
  }
  /**
   * Beat envelope of the score: 1 on a beat, decaying to 0 before the next one. It follows the tempo of the track
   * that plays. 0 when the score is off, muted or silent. The sequencer schedules a little ahead, so the beats are known.
   */
  beatLevel(): number {
    const c = this.ctx;
    if (!c || !this.playing || this.scoreMuted || this.musicVol <= 0 || c.state !== 'running') return 0;
    const now = c.currentTime, b = this.beats;
    while (b.length > 1 && b[1].t <= now) b.shift();
    if (!b.length || b[0].t > now) return 0;
    const age = now - b[0].t;
    return age > 1 ? 0 : b[0].a * Math.exp(-age * 5.5);
  }

  // ---------- voices ----------
  /** Linear attack from zero, then either a natural decay or a held level, and a release that ends at zero. Returns the end time. */
  private env(g: AudioParam, t: number, vol: number, att: number, dur: number, flat?: boolean, rel = 0.014): number {
    att = Math.min(att, dur * (flat ? 0.9 : 0.6));
    // The resting value has to be zero as well: a source can start a sample before its first envelope point,
    // and that one sample at the default gain of 1 is an audible tick.
    g.value = 0;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vol, t + att);
    if (flat) {
      const r = Math.min(Math.max(rel, 0.02), (dur - att) * 0.8);
      g.setValueAtTime(vol, t + dur - r);
      g.linearRampToValueAtTime(0, t + dur);
      return t + dur;
    }
    g.exponentialRampToValueAtTime(vol * 0.004, t + dur);
    g.linearRampToValueAtTime(0, t + dur + rel);
    return t + dur + rel;
  }
  private keep(src: AudioScheduledSourceNode, t: number, stop: number, off = -1) {
    if (off >= 0) (src as AudioBufferSourceNode).start(t, off); else src.start(t);
    src.stop(stop);
    const v = this.cur;
    if (v) { v.srcs.push(src); if (stop > v.end) v.end = stop; }
  }
  /** An oscillator (or two, detuned) through an optional low-pass with its own sweep. */
  private tone(o: Tone) {
    const c = this.ctx!, t = this.base + (o.when || 0), g = c.createGain();
    const end = this.env(g.gain, t, o.vol * (o.uni ? 0.62 : 1), Math.max(0.004, o.att ?? 0.006), o.dur, o.flat, o.rel);
    let head: AudioNode = g;
    if (o.lp) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q ?? 0.8; f.frequency.value = o.lp; f.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpTo), t + o.dur);
      f.connect(g); head = f;
    }
    for (const det of o.uni ? [-o.uni, o.uni] : [o.det || 0]) {
      const osc = c.createOscillator();
      osc.type = o.type || 'sine'; osc.frequency.value = o.f; osc.frequency.setValueAtTime(o.f, t);
      if (det) osc.detune.value = det;
      if (o.to && o.to !== o.f) osc.frequency.exponentialRampToValueAtTime(Math.max(18, o.to), t + (o.glide || o.dur));
      // vibrato: `vib` times a second, `vibD` Hz either way (the warp of the gravity pulse, the flutter of a flame)
      if (o.vib) { const l = c.createOscillator(), d = c.createGain(); l.frequency.value = o.vib; d.gain.value = o.vibD || 5; l.connect(d).connect(osc.frequency); this.keep(l, t, end + 0.02); }
      osc.connect(head);
      this.keep(osc, t, end + 0.02);
    }
    g.connect(o.out || this.cur!.g);
  }
  /** Filtered noise with a filter sweep. */
  private noise(o: Noise) {
    const c = this.ctx!, t = this.base + (o.when || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 1; f.frequency.value = o.freq; f.frequency.setValueAtTime(o.freq, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t + o.dur);
    const g = c.createGain();
    const end = this.env(g.gain, t, o.vol, Math.max(0.003, o.att ?? 0.003), o.dur, o.flat);
    s.connect(f).connect(g).connect(o.out || this.cur!.g);
    if (this.cur) this.keep(s, t, end + 0.02, Math.random() * 1.5); else { s.start(t, Math.random() * 1.5); s.stop(end + 0.02); }
  }
  /**
   * Sparks: one band of bright noise opened for a few milliseconds at `n` random moments over `dur`, thinning out
   * toward the end. One source for the whole crackle, so it costs as much as a single noise layer.
   */
  private crackle(dur: number, vol: number, n: number, hp = 3000, when = 0) {
    const c = this.ctx!, t = this.base + when;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; f.Q.value = 0.7;
    const g = c.createGain(), p = g.gain;
    p.value = 0; p.setValueAtTime(0, t);
    const at: number[] = [];
    for (let i = 0; i < n; i++) at.push(Math.pow(Math.random(), 1.5) * dur);
    at.sort((a, b) => a - b);
    let free = 0;
    for (const a of at) {
      // every spark is over before the next one opens, so the automation never overlaps
      const s0 = Math.max(a, free), len = 0.002 + Math.random() * 0.007, v = vol * (0.25 + Math.random() * 0.75) * Math.max(0.25, 1 - (0.6 * s0) / dur);
      p.setValueAtTime(0, t + s0); p.linearRampToValueAtTime(v, t + s0 + 0.0008); p.linearRampToValueAtTime(0, t + s0 + len);
      free = s0 + len + 0.001;
    }
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    s.connect(f).connect(g).connect(this.cur!.g);
    this.keep(s, t, t + free + 0.02, Math.random() * 1.5);
  }
  /**
   * A tesla coil's discharge: a sawtooth at `f` (the low hum) heard through a band around its upper harmonics, and the
   * same saw chopping a band of bright noise f times a second, which is the rasp of a real coil. The two are switched on
   * in `bursts` of [start, length, level] that must not overlap; each burst snaps on and sags before it cuts.
   */
  private buzz(f: number, bursts: [number, number, number][], vol: number, o: { bp?: number; hp?: number; hum?: number; rasp?: number; att?: number; when?: number } = {}) {
    const c = this.ctx!, t = this.base + (o.when || 0);
    const gate = c.createGain(), p = gate.gain;
    p.value = 0; p.setValueAtTime(0, t);
    let end = t;
    for (const [at, len, a] of bursts) {
      const s = t + at, v = vol * a, att = Math.min(o.att ?? 0.002, len * 0.4);
      p.setValueAtTime(0, s); p.linearRampToValueAtTime(v, s + att); p.linearRampToValueAtTime(v * 0.45, s + len - 0.005); p.linearRampToValueAtTime(0, s + len);
      end = Math.max(end, s + len);
    }
    const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.bp ?? f * 6; bp.Q.value = 0.9;
    const hum = c.createGain(); hum.gain.value = o.hum ?? 0.7;
    osc.connect(bp).connect(hum).connect(gate);
    // and the body: the lowest few harmonics, the part of a coil you feel more than hear
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * 3; lp.Q.value = 0.7;
    const body = c.createGain(); body.gain.value = (o.hum ?? 0.7) * 0.8;
    osc.connect(lp).connect(body).connect(gate);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = o.hp ?? 2500; hp.Q.value = 0.7;
    // the saw swings -1..1, so 0.5 + 0.5 * saw opens the noise from nothing to full once per cycle
    const am = c.createGain(), depth = c.createGain(); am.gain.value = 0.5; depth.gain.value = 0.5;
    osc.connect(depth).connect(am.gain);
    const rasp = c.createGain(); rasp.gain.value = o.rasp ?? 0.6;
    n.connect(hp).connect(am).connect(rasp).connect(gate);
    gate.connect(this.cur!.g);
    this.keep(osc, t, end + 0.02); this.keep(n, t, end + 0.02, Math.random() * 1.5);
  }
  /** Two-operator FM: metal, glass, bells and electric buzz. `index` is the modulation depth at the start, it decays with the note. */
  private fm(f: number, ratio: number, index: number, dur: number, vol: number, when = 0, out?: AudioNode) {
    const c = this.ctx!, t = this.base + when, g = c.createGain();
    const end = this.env(g.gain, t, vol, 0.004, dur);
    const car = c.createOscillator(), mod = c.createOscillator(), depth = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * ratio; depth.gain.value = index * f;
    depth.gain.setValueAtTime(index * f, t); depth.gain.exponentialRampToValueAtTime(Math.max(1, index * f * 0.05), t + dur);
    mod.connect(depth).connect(car.frequency);
    car.connect(g).connect(out || this.cur!.g);
    this.keep(car, t, end + 0.02); this.keep(mod, t, end + 0.02);
  }
  /** Low body hit: a sine that drops in pitch, a dull noise layer and a short knock on top. */
  private thump(f: number, dur: number, vol: number, when = 0, out?: AudioNode) {
    this.tone({ f: f * 1.5, to: f * 0.4, glide: dur * 0.35, dur, vol, when, att: 0.004, out });
    this.noise({ dur: dur * 0.7, vol: vol * 0.45, freq: f * 4, to: f * 1.5, type: 'lowpass', when, out });
    this.noise({ dur: 0.02, vol: vol * 0.18, freq: 1800, q: 0.7, when, out });
  }
  /** Brass-like swell on several notes: detuned saws under a filter that closes again. */
  private horn(freqs: number[], dur: number, vol: number, lp = 520, when = 0, out?: AudioNode) {
    for (const f of freqs) this.tone({ f, dur, type: 'sawtooth', vol: (vol * 1.5) / freqs.length, att: dur * 0.2, rel: dur * 0.4, flat: true, lp, lpTo: lp * 0.55, uni: 8, when, out });
  }

  // ---------- effects ----------
  /**
   * Play an effect. `level` (0..1) is how near it is to the listener: far effects are quieter and duller.
   * `pan` is -1 (left) to 1 (right).
   */
  play(name: string, level = 1, pan = 0) {
    const log = this.cueLog;
    if (!log && (!this.ctx || this.ctx.state !== 'running')) return;
    const now = log ? this.clock * 1000 : performance.now();
    const gap = (META[name] || DEF)[2];
    if (now - (this.last[name] || 0) < gap && now >= (this.last[name] || 0)) return;
    this.last[name] = now;
    if (log) { log.push(level < 1 || pan ? { t: this.clock, name, g: level, pan } : { t: this.clock, name }); return; }
    this.emit(name, level, pan);
  }
  /** Fade an instance out over 30 ms. Used when the caps are reached: an effect is never cut dead. */
  private steal(v: Inst, t: number) {
    v.dead = true;
    const g = v.g.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(v.level, t); g.linearRampToValueAtTime(0, t + 0.03);
    for (const s of v.srcs) { try { s.stop(t + 0.04); } catch { /* already over */ } }
    v.end = t + 0.04;
  }
  /** Make room for a new instance. False when it has to be dropped (everything alive is more important). */
  private room(name: string, pri: number, max: number, t: number): boolean {
    const L = this.live;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].end <= t) L.splice(i, 1);
    let same = 0, first: Inst | null = null, low = 0, firstLow: Inst | null = null, alive = 0;
    for (const v of L) {
      if (v.dead) continue;
      alive++;
      if (v.name === name) { same++; if (!first) first = v; }
      if (v.pri <= 1) { low++; if (!firstLow || v.pri < firstLow.pri) firstLow = v; }
    }
    // factory ambience only plays into free room: it never fades out a shot or a kill
    if (pri <= 0 && (low >= CHATTER_MAX - 2 || alive >= INST_MAX - 2 || same >= max)) return false;
    if (same >= max && first) { this.steal(first, t); alive--; if (first.pri <= 1) { low--; if (firstLow === first) firstLow = null; } }
    if (pri <= 1 && low >= CHATTER_MAX) { if (!firstLow) return false; this.steal(firstLow, t); alive--; }
    if (alive >= INST_MAX) {
      let victim: Inst | null = null;
      for (const v of L) if (!v.dead && v.pri <= pri && (!victim || v.pri < victim.pri)) victim = v;
      if (!victim) return false;
      this.steal(victim, t);
    }
    return true;
  }
  private emit(name: string, level = 1, pan = 0) {
    const c = this.ctx!, [pri, max, , busId] = META[name] || DEF;
    const t0 = c.currentTime + LEAD + this.offset;
    if (!this.room(name, pri, max, t0)) return;
    level = Math.max(0.05, Math.min(1, Number.isFinite(level) ? level : 1));
    // An effect that is triggered over and over (forty towers firing) plays each instance a little softer, so a barrage
    // stays a texture instead of a wall. Its distance filter still follows `level`, so it is not dulled.
    let gain = level;
    if (pri <= 1) {
      const [n0, t1] = this.busy[name] || [0, t0], n = n0 * Math.exp(-Math.max(0, t0 - t1) / 0.5) + 1;
      this.busy[name] = [n, t0];
      gain *= 1 / Math.sqrt(1 + 0.2 * Math.max(0, n - 2));
    }
    const g = c.createGain(); g.gain.value = gain;
    let tail: AudioNode = g;
    if (level < 0.85) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5; f.frequency.value = 900 + 13000 * level * level; tail.connect(f); tail = f; }
    if (pan && Number.isFinite(pan) && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); tail.connect(p); tail = p; }
    tail.connect(busId === 'h' ? this.heroG : busId === 'u' ? this.uiG : this.sfxG);
    const inst: Inst = { name, pri, end: t0, level: gain, g, srcs: [], dead: false };
    this.cur = inst; this.base = t0;
    this.recipe(name);
    this.cur = null;
    if (!inst.srcs.length) { tail.disconnect(); return; }
    this.live.push(inst);
    const dk = DUCK[name];
    if (dk && level > 0.6) { const d = this.musDuck.gain; d.setTargetAtTime(dk[0], t0, 0.04); d.setTargetAtTime(1, t0 + dk[1], 0.5); }
  }
  private recipe(name: string) {
    // a little pitch and tone variation on every trigger
    const r = 0.94 + Math.random() * 0.12, b = 0.85 + Math.random() * 0.3;
    const T = (o: Tone) => this.tone(o), N = (o: Noise) => this.noise(o);
    switch (name) {
      // --- tower chatter ---
      case 'shot':
        // Pulse Turret: a click, a tight bolt that drops fast, a knock under it and a short ring. Pitch, brightness and the
        // ring's note change every shot, so a row of turrets sounds like a texture rather than one sample on repeat.
        N({ dur: 0.008, vol: 0.07, freq: 5200 * b, type: 'highpass', att: 0.001 });
        T({ f: 1250 * r, to: 240 * r, glide: 0.045, dur: 0.07, vol: 0.07, type: 'square', lp: 4200 * b, lpTo: 700 });
        T({ f: 190 * r, to: 70, glide: 0.04, dur: 0.07, vol: 0.12 });
        T({ f: [660, 740, 880, 990][Math.floor(Math.random() * 4)] * r, dur: 0.1, vol: 0.014, type: 'triangle', when: 0.01 });
        break;
      case 'arcshot': {
        // Arc Pylon: a tesla coil. A low hum (70 to 125 Hz) that rasps, fired in two to four bursts with sparks over
        // them. Hum pitch, colour and the burst pattern are new on every discharge.
        const f = 70 + Math.random() * 55, k = 2 + Math.floor(Math.random() * 3), bursts: [number, number, number][] = [];
        let at = 0;
        for (let i = 0; i < k; i++) { const len = i ? 0.02 + Math.random() * 0.05 : 0.05 + Math.random() * 0.06; bursts.push([at, len, i ? 0.45 + Math.random() * 0.5 : 1]); at += len + 0.008 + Math.random() * 0.03; }
        this.buzz(f, bursts, 0.21, { bp: f * (4 + Math.random() * 5), hp: 1800 * b, hum: 1, rasp: 0.5 });
        this.crackle(at, 0.09, 6 + Math.floor(Math.random() * 6), 3000);
        N({ dur: 0.006, vol: 0.08, freq: 4000, type: 'highpass', att: 0.001 });
        break;
      }
      case 'mortar':
        // Mortar: a deep tube thump, the chuff of the charge, and the faint whistle of the shell climbing away
        T({ f: 150 * r, to: 46, glide: 0.09, dur: 0.34, vol: 0.32 });
        N({ dur: 0.07, vol: 0.12, freq: 520 * b, q: 1.2 });
        N({ dur: 0.28, vol: 0.06, freq: 2400 * b, to: 260, type: 'lowpass', att: 0.01 });
        T({ f: 1500 * r, to: 2600 * r, dur: 0.42, vol: 0.012, when: 0.05, att: 0.12 });
        break;
      case 'rail':
        // Railgun: the crack of the slug, a falling electric zing, a heavy sub, a metal ring and a short buzz of spent coils
        N({ dur: 0.035, vol: 0.2, freq: 3200, type: 'highpass', att: 0.001 });
        T({ f: 3600 * r, to: 380, glide: 0.14, dur: 0.2, vol: 0.05 });
        T({ f: 70 * r, to: 30, dur: 0.45, vol: 0.2, type: 'sawtooth', lp: 380, uni: 12 });
        this.fm(240 * r, 2.76, 5, 0.32, 0.045);
        this.buzz(150 * r, [[0.03, 0.09, 1]], 0.07, { bp: 1400, hp: 3000 });
        break;
      case 'cryo': {
        // Cryo: an icy, crystalline burst. Frost hiss, a cold puff, and three glassy chimes at random high pitches.
        N({ dur: 0.3, vol: 0.04, freq: 8000, to: 4200, type: 'highpass', att: 0.008 });
        N({ dur: 0.12, vol: 0.09, freq: 1800 * b, to: 600, q: 0.9 });
        T({ f: 900 * r, to: 420, dur: 0.12, vol: 0.05, type: 'triangle' });
        const ice = [1760, 2093, 2637, 3136, 3520];
        for (let i = 0; i < 3; i++) this.fm(ice[Math.floor(Math.random() * 5)] * r, 3.01, 0.9, 0.22 + Math.random() * 0.12, 0.034, i * 0.022 + Math.random() * 0.01);
        break;
      }
      case 'missile':
        // Missile: an ignition pop, then the rocket's whoosh sweeping up and away over a rough, sputtering roar
        N({ dur: 0.03, vol: 0.09, freq: 1600 * b, q: 1.2 });
        T({ f: 120 * r, to: 55, dur: 0.14, vol: 0.12 });
        N({ dur: 0.5, vol: 0.11, freq: 450, to: 3800 * b, q: 1.6, att: 0.07 });
        N({ dur: 0.55, vol: 0.06, freq: 1400, to: 300, type: 'lowpass', att: 0.04 });
        this.crackle(0.35, 0.035, 8, 2500, 0.03);
        break;
      case 'flame':
        // Firewall: a low, rough roar with a fluttering rumble under it and sparks spitting out of it
        N({ dur: 0.55, vol: 0.11, freq: 700 * b, to: 380, type: 'lowpass', q: 0.9, att: 0.05 });
        N({ dur: 0.4, vol: 0.04, freq: 1800, q: 0.6, att: 0.04 });
        T({ f: 62, to: 48, dur: 0.5, vol: 0.035, att: 0.05, vib: 11, vibD: 6 });
        this.crackle(0.45, 0.05, 10, 2800);
        break;
      case 'lance':
        // Lance: a sizzling beam. A frying hum, a bright detuned beam tone over it, and sparks.
        this.buzz(55 + Math.random() * 20, [[0, 0.24, 1]], 0.07, { bp: 700 * b, hp: 4500, att: 0.03, rasp: 0.5 });
        T({ f: 310 * r, to: 300 * r, dur: 0.26, vol: 0.045, type: 'sawtooth', lp: 1800, att: 0.03, uni: 11, flat: true, rel: 0.06 });
        this.crackle(0.24, 0.035, 8, 4000);
        break;
      case 'gravity':
        // Graviton Well: a deep warping pulse. A wobbling sub falls away, a growl under it, and space rushes back in after.
        T({ f: 96, to: 30, dur: 0.85, vol: 0.24, vib: 6.5, vibD: 9 });
        T({ f: 48, to: 30, dur: 0.7, vol: 0.1, type: 'sawtooth', lp: 700, lpTo: 90, q: 4, vib: 6.5, vibD: 4 });
        this.fm(55, 0.5, 4, 0.6, 0.05);
        N({ dur: 0.45, vol: 0.05, freq: 200, to: 1400, type: 'lowpass', att: 0.25, flat: true, when: 0.15 });
        break;
      case 'boom':
        // a shell lands: a sub thump, a dull blast that closes, a crack, and debris
        this.thump(62 * r, 0.6, 0.42);
        N({ dur: 0.55, vol: 0.15, freq: 1600 * b, to: 90, type: 'lowpass' });
        N({ dur: 0.04, vol: 0.1, freq: 2600 * b, q: 0.9 });
        this.crackle(0.4, 0.05, 9, 1800, 0.03);
        break;
      case 'die':
        // A machine destroyed, the reward the whole game pays out: a crisp snap, a round pop, a crunch of debris, a sub
        // knock and a faint glassy shard. Short, and never quite the same twice, so it can be heard hundreds of times.
        N({ dur: 0.012, vol: 0.09, freq: 3600 * b, q: 1.1, att: 0.001 });
        T({ f: 560 * r, to: 150, glide: 0.05, dur: 0.08, vol: 0.11, type: 'triangle' });
        N({ dur: 0.13, vol: 0.09, freq: 5200 * b, to: 700, type: 'lowpass', q: 1.4 });
        T({ f: 120 * r, to: 46, dur: 0.17, vol: 0.12 });
        this.crackle(0.09, 0.07, 5, 1500);
        this.fm(2400 * b, 1.41, 2, 0.09, 0.014, 0.01);
        break;
      case 'mitedie':
        // a mite squashed: a tiny snap, a chirp and a crunch
        N({ dur: 0.02, vol: 0.08, freq: 3600 * b, q: 1.5, att: 0.001 });
        T({ f: 1300 * r, to: 360, glide: 0.03, dur: 0.05, vol: 0.075, type: 'triangle' });
        T({ f: 200 * r, to: 90, dur: 0.06, vol: 0.05 });
        this.crackle(0.05, 0.045, 3, 2500);
        break;
      case 'shield':
        // a shield breaks: glass shatters (scattered pings and a hiss) and the dome collapses with a soft falling tone
        N({ dur: 0.18, vol: 0.07, freq: 6500 * b, to: 3000, type: 'highpass', att: 0.001 });
        for (let i = 0; i < 4; i++) this.fm((2200 + Math.random() * 3000) * r, 2.76, 1.5, 0.12 + Math.random() * 0.1, 0.02, i * 0.018 + Math.random() * 0.012);
        T({ f: 520 * r, to: 140, dur: 0.22, vol: 0.06, type: 'triangle' });
        break;
      case 'deflect': this.fm(1250 * r, 3.53, 3, 0.24, 0.06); N({ dur: 0.03, vol: 0.07, freq: 4500, type: 'highpass' }); T({ f: 2100 * r, to: 1500, dur: 0.13, vol: 0.022, type: 'triangle' }); break;
      case 'spindown': T({ f: 260, to: 70, dur: 0.9, vol: 0.12, type: 'sawtooth', lp: 900, lpTo: 200, uni: 10 }); N({ dur: 0.8, vol: 0.05, freq: 1800, to: 300, q: 1.2 }); this.thump(110, 0.18, 0.2, 0.78); break;
      case 'spinup': T({ f: 80, to: 300, dur: 0.8, vol: 0.1, type: 'sawtooth', lp: 1200, att: 0.25, flat: true, rel: 0.15, uni: 10 }); N({ dur: 0.8, vol: 0.04, freq: 400, to: 2400, q: 1.2, att: 0.5 }); break;
      case 'brood':
        // the carrier opens: a hatch knock, then a burst of chitter
        this.thump(140, 0.12, 0.14);
        for (let i = 0; i < 6; i++) this.fm((1700 + i * 170) * r, 2.2, 4, 0.05, 0.035, 0.05 + i * 0.038 + Math.random() * 0.01);
        N({ dur: 0.32, vol: 0.04, freq: 3000, to: 5200, q: 1.5, att: 0.06 });
        break;
      case 'unjam': T({ f: 220, to: 520, dur: 0.22, vol: 0.09, type: 'triangle' }); N({ dur: 0.04, vol: 0.08, freq: 3000, q: 2, when: 0.2 }); this.fm(1320, 2, 1.5, 0.3, 0.04, 0.2); break;
      case 'special': this.thump(84, 0.7, 0.42); this.horn([110, 164.8], 1.0, 0.2, 900); N({ dur: 0.5, vol: 0.1, freq: 600, to: 4200, q: 1, att: 0.3 }); this.fm(220, 3, 4, 0.5, 0.05); break;
      case 'down':
        // power lost or a tower ran dry: the hum winds down and sputters out in shrinking bursts
        T({ f: 240, to: 60, dur: 0.45, vol: 0.09, type: 'sawtooth', lp: 900, lpTo: 150, uni: 9 });
        this.buzz(70, [[0, 0.06, 1], [0.09, 0.04, 0.6], [0.17, 0.03, 0.35]], 0.06, { bp: 500, hp: 2000 });
        break;
      case 'up':
        // power restored or a tower fed again: a rising tone that lands on a click and a small chime
        T({ f: 180, to: 360, dur: 0.18, vol: 0.09, type: 'triangle' });
        N({ dur: 0.02, vol: 0.06, freq: 3200, q: 2, when: 0.16, att: 0.001 });
        this.fm(1318.5, 2, 1, 0.3, 0.022, 0.16);
        break;
      case 'build':
        // a part set down: a solid clunk, two ratchet ticks as it is bolted, and a warm rising chime
        this.thump(110, 0.18, 0.26);
        N({ dur: 0.03, vol: 0.08, freq: 2400 * b, q: 1.5, att: 0.001 });
        N({ dur: 0.015, vol: 0.05, freq: 3400 * b, q: 3, when: 0.07, att: 0.001 });
        N({ dur: 0.015, vol: 0.05, freq: 3800 * b, q: 3, when: 0.12, att: 0.001 });
        this.fm(523.3, 2, 0.9, 0.35, 0.03, 0.12); this.fm(784, 2, 0.8, 0.45, 0.028, 0.18);
        break;
      case 'sell':
        // taken apart and refunded: a release whoosh, a soft knock and two coin clinks falling
        N({ dur: 0.14, vol: 0.05, freq: 3000, to: 700, q: 1.2, att: 0.01 });
        this.thump(96, 0.14, 0.16, 0.03);
        this.fm(1975.5 * r, 2.01, 1.2, 0.18, 0.03, 0.05); this.fm(1568 * r, 2.01, 1.2, 0.26, 0.03, 0.12);
        break;
      case 'titanSmash': this.thump(50, 1.4, 0.3); N({ dur: 1.7, vol: 0.14, freq: 500, to: 60, type: 'lowpass', att: 0.08 }); N({ dur: 0.9, vol: 0.04, freq: 1400, to: 300, q: 0.7, when: 0.2, att: 0.1 }); break;

      // --- Kestrel and the bow ---
      case 'arrow': N({ dur: 0.05, vol: 0.11, freq: 2600 * b, type: 'highpass' }); T({ f: 190 * r, to: 95, dur: 0.1, vol: 0.14, type: 'triangle' }); N({ dur: 0.24, vol: 0.05, freq: 1700, to: 650, q: 1.2, att: 0.03 }); this.fm(380 * r, 2, 2, 0.12, 0.04); break;
      case 'bigshot': this.thump(105, 0.9, 0.38); N({ dur: 0.7, vol: 0.17, freq: 5200, to: 300, type: 'lowpass' }); T({ f: 55, to: 28, dur: 1.1, vol: 0.22, type: 'sawtooth', lp: 420, uni: 12 }); this.fm(110, 2.5, 6, 0.5, 0.1); break;
      case 'rain': for (let i = 0; i < 6; i++) N({ dur: 0.3, vol: 0.07, freq: 3200 - i * 240, to: 700, q: 1.5, att: 0.04, when: i * 0.075 }); this.thump(70, 0.5, 0.2, 0.25); this.fm(660, 2, 2, 0.4, 0.03); break;
      case 'sing': T({ f: 36, to: 95, dur: 1.5, vol: 0.28, type: 'sawtooth', lp: 240, att: 0.5, uni: 10 }); N({ dur: 1.5, vol: 0.12, freq: 200, to: 2600, q: 1.2, att: 0.9 }); this.fm(72, 0.5, 4, 1.4, 0.08); break;
      case 'crit': N({ dur: 0.05, vol: 0.1, freq: 3600, type: 'highpass' }); this.fm(1320 * r, 2.76, 2, 0.2, 0.06); this.thump(120, 0.18, 0.2); break;
      case 'drawfull': N({ dur: 0.022, vol: 0.09, freq: 4600, q: 2.5 }); T({ f: 1320, dur: 0.09, vol: 0.04, type: 'triangle' }); break;
      case 'nospec': N({ dur: 0.03, vol: 0.05, freq: 620, q: 1.6 }); T({ f: 180, to: 120, dur: 0.08, vol: 0.06, type: 'triangle' }); break;
      case 'heroOn': N({ dur: 0.7, vol: 0.18, freq: 300, to: 5200, q: 0.9, att: 0.55 }); this.thump(64, 1.3, 0.6, 0.6); this.horn([73.4, 110, 146.8], 2.2, 0.34, 700, 0.6); N({ dur: 1.4, vol: 0.12, freq: 4000, to: 200, type: 'lowpass', when: 0.6 }); this.fm(880, 2, 1, 1.2, 0.03, 0.6); break;
      case 'heroOff': T({ f: 260, to: 55, dur: 0.8, vol: 0.16, type: 'sawtooth', lp: 500, lpTo: 120, uni: 9 }); N({ dur: 0.6, vol: 0.07, freq: 2400, to: 200, type: 'lowpass' }); break;
      case 'tele': N({ dur: 0.3, vol: 0.12, freq: 500, to: 4000, q: 1.3, att: 0.18 }); this.thump(92, 0.35, 0.26, 0.2); T({ f: 420, to: 1100, dur: 0.22, vol: 0.04 }); this.fm(660, 1.5, 3, 0.25, 0.04, 0.2); break;
      case 'ready': this.horn([146.8, 220], 0.9, 0.2, 800); this.horn([174.6, 261.6], 1.3, 0.22, 900, 0.32); this.thump(60, 0.6, 0.2); this.fm(1174.7, 2, 1, 1.2, 0.025, 0.32); break;
      case 'overlink': this.horn([110, 164.8, 220], 1.6, 0.3, 900); this.horn([146.8, 220, 293.7], 2.0, 0.3, 1100, 0.4); this.thump(58, 0.9, 0.3); for (let i = 0; i < 4; i++) this.fm([880, 1174.7, 1318.5, 1760][i], 2, 1.2, 0.9, 0.022, 0.4 + i * 0.11); break;

      // --- the run: warnings and milestones ---
      case 'wave':
        // a wave is called: the horn over a deep gong, and the air rising
        this.horn([73.4, 110], 1.7, 0.32, 520); this.thump(58, 0.9, 0.36); this.fm(73.4, 1.41, 3, 1.5, 0.06);
        N({ dur: 0.9, vol: 0.04, freq: 400, to: 2400, q: 0.8, att: 0.6 });
        break;
      case 'boss': this.horn([55, 58.3, 82.4], 2.8, 0.44, 400); this.thump(48, 1.6, 0.5); this.thump(48, 1.2, 0.4, 0.7); break;
      case 'bossdie':
        // a Colossus falls: the blast, the hull groaning, debris raining for a second, two secondary blasts, and a bright glint to close
        this.thump(52, 2.2, 0.6);
        T({ f: 44, to: 24, dur: 2.4, vol: 0.3, type: 'sawtooth', lp: 260, uni: 12 });
        N({ dur: 2.2, vol: 0.24, freq: 2200, to: 70, type: 'lowpass' });
        N({ dur: 0.05, vol: 0.16, freq: 3000, q: 0.9 });
        this.fm(70, 1.41, 7, 1.6, 0.08, 0.05);
        this.crackle(1.2, 0.08, 26, 1500, 0.05);
        this.thump(88, 0.6, 0.3, 0.35); this.thump(72, 0.6, 0.28, 0.7);
        this.fm(1174.7, 2, 1, 1.4, 0.02, 0.4); this.fm(1568, 2, 1, 1.4, 0.016, 0.52);
        break;
      case 'leak':
        // a machine reached the core: a heavy hit and a two-note alarm that falls a semitone
        this.thump(80, 0.5, 0.4);
        T({ f: 98, to: 78, dur: 0.6, vol: 0.16, type: 'sawtooth', lp: 380 });
        T({ f: 466.2, dur: 0.12, vol: 0.05, type: 'square', lp: 1500, flat: true, rel: 0.03 });
        T({ f: 440, dur: 0.16, vol: 0.05, type: 'square', lp: 1300, flat: true, rel: 0.05, when: 0.13 });
        break;
      case 'breach':
        // the core's discharge that destroys a machine attacking it: a tesla strike, a crack, a body hit and sparks
        this.buzz(95 * r, [[0, 0.07, 1], [0.085, 0.04, 0.6], [0.14, 0.05, 0.45]], 0.24, { bp: 1100, hp: 2400 });
        N({ dur: 0.01, vol: 0.16, freq: 3500, type: 'highpass', att: 0.001 });
        this.thump(90, 0.35, 0.36);
        this.crackle(0.25, 0.08, 12, 3000);
        N({ dur: 0.45, vol: 0.05, freq: 2000, to: 200, type: 'lowpass', when: 0.05, att: 0.02 });
        break;
      case 'clear':
        // a wave cleared: a soft chord and three bells climbing over it
        this.horn([146.8, 220, 293.7], 1.4, 0.2, 800); this.thump(70, 0.5, 0.16);
        for (let i = 0; i < 3; i++) this.fm([880, 1108.7, 1318.5][i], 2, 1.1, 1.0, 0.024, 0.06 + i * 0.09);
        break;
      case 'levelup':
        this.horn([146.8, 174.6, 220, 293.7], 1.6, 0.3, 950); this.thump(62, 0.8, 0.26);
        for (let i = 0; i < 4; i++) this.fm([587.3, 740, 880, 1174.7][i], 2, 1.5, 0.7, 0.028, 0.1 + i * 0.09);
        N({ dur: 0.5, vol: 0.03, freq: 3000, to: 9000, type: 'highpass', att: 0.3, when: 0.1 });
        break;
      case 'jam':
        // a mite has latched on: the tower's hum chokes in three stutters
        T({ f: 420, to: 110, dur: 0.36, vol: 0.08, type: 'sawtooth', lp: 1400, lpTo: 300, uni: 14 });
        for (let i = 0; i < 3; i++) { N({ dur: 0.07, vol: 0.06, freq: 2400 * b, q: 0.7, when: i * 0.1 }); this.fm(95, 0.5, 8, 0.08, 0.07, i * 0.1); }
        break;
      case 'titanLand':
        // the leap: a falling roar that grows for as long as it is in the air, and a warning horn under it
        N({ dur: 2.45, vol: 0.14, freq: 2600, to: 300, q: 0.8, att: 2.1, flat: true });
        T({ f: 220, to: 45, dur: 2.45, vol: 0.2, type: 'sawtooth', lp: 600, lpTo: 200, att: 2.1, flat: true, rel: 0.05, uni: 12 });
        this.horn([58.3, 87.3], 2.4, 0.3, 500);
        break;
      case 'titanImpact':
        this.thump(44, 2.2, 0.8); this.thump(70, 0.9, 0.5, 0.05);
        N({ dur: 2.4, vol: 0.32, freq: 2400, to: 60, type: 'lowpass' });
        T({ f: 38, to: 22, dur: 2.6, vol: 0.34, type: 'sawtooth', lp: 220, uni: 12 });
        N({ dur: 1.2, vol: 0.1, freq: 1800, to: 400, q: 0.7, when: 0.15, att: 0.05 });
        // the shock that stuns the towers
        this.fm(110, 7, 10, 0.9, 0.1, 0.1); T({ f: 1800, to: 90, dur: 0.7, vol: 0.06, when: 0.1 });
        break;
      case 'titanDie':
        this.thump(46, 3, 0.8);
        T({ f: 60, to: 20, dur: 3.4, vol: 0.36, type: 'sawtooth', lp: 300, lpTo: 80, uni: 12 });
        N({ dur: 3.2, vol: 0.3, freq: 1800, to: 50, type: 'lowpass' });
        for (const [w, f] of [[0.5, 80], [1.1, 64], [1.9, 52]]) this.thump(f, 0.9, 0.42, w);
        this.fm(90, 1.41, 6, 2.5, 0.1);
        this.horn([73.4, 110, 146.8, 220], 2.6, 0.3, 1000, 2.2);
        break;
      case 'win': this.thump(60, 1.4, 0.5); this.horn([73.4, 146.8, 220, 293.7, 370, 440], 4.2, 0.5, 1300); this.fm(1174.7, 2, 1, 3.2, 0.025, 0.4); break;
      case 'lose': this.thump(52, 2, 0.6); T({ f: 110, to: 49, dur: 3.6, vol: 0.3, type: 'sawtooth', lp: 320, lpTo: 90, uni: 20 }); T({ f: 116.5, to: 52, dur: 3.6, vol: 0.2, type: 'sawtooth', lp: 320, lpTo: 90 }); break;

      // --- interface ---
      case 'card':
        // a card is taken: a short whoosh into a soft hit and a chord of bells
        N({ dur: 0.12, vol: 0.05, freq: 900, to: 4800, q: 1.1, att: 0.06 });
        this.thump(80, 0.4, 0.26, 0.05);
        this.fm(587.3, 2, 1.5, 0.9, 0.04, 0.05); this.fm(880, 2, 1.2, 1.1, 0.028, 0.11); this.fm(1174.7, 2, 1, 1.0, 0.016, 0.17);
        break;
      case 'error': T({ f: 220, to: 196, dur: 0.07, vol: 0.06, type: 'square', lp: 900 }); T({ f: 185, to: 165, dur: 0.1, vol: 0.06, type: 'square', lp: 800, when: 0.09 }); T({ f: 90, to: 70, dur: 0.12, vol: 0.08 }); break;
      case 'click': N({ dur: 0.01, vol: 0.06, freq: 3800 * b, q: 2, att: 0.001 }); T({ f: 1100, to: 700, dur: 0.025, vol: 0.03, type: 'triangle' }); T({ f: 170, to: 110, dur: 0.04, vol: 0.06 }); break;
      // --- factory ---
      // a tower picks an item off a belt: a soft, quiet tick
      case 'take': N({ dur: 0.012, vol: 0.055, freq: 2600 * b, q: 3, att: 0.001 }); T({ f: 720 * r, to: 520, dur: 0.03, vol: 0.03, type: 'triangle' }); break;
      // a building delivers materials: two small clinks and a knock
      case 'mats': this.fm(1318.5 * r, 2.01, 1, 0.16, 0.022); this.fm(1760 * r, 2.01, 1, 0.2, 0.018, 0.06); T({ f: 140, to: 90, dur: 0.07, vol: 0.05 }); break;
      case 'hover': N({ dur: 0.02, vol: 0.055, freq: 4200, q: 2 }); break;
    }
  }

  // ---------- score ----------
  /** The built-in track that plays, or the one that will. */
  get trackId(): string { return this.tr.id; }
  get trackChoice(): string { return this.choice; }
  /** Choose a built-in track by id, or 'shuffle' for the playlist. Switches at once while the score plays. */
  setTrack(id: string) {
    const t = TRACK_DEFS.find((x) => x.id === id);
    this.choice = t ? t.id : 'shuffle';
    if (t && t !== this.tr) { this.tr = t; if (this.playing) this.restart(); }
    else if (!t && this.playing && !this.list.includes(this.tr)) { this.pick(); this.restart(); }
  }
  /** Which tracks the playlist goes through. Unknown ids are dropped; an empty list means all tracks. */
  setPlaylist(ids: string[]) {
    const l = TRACK_DEFS.filter((x) => ids.includes(x.id));
    this.list = l.length ? l : TRACK_DEFS;
    // a track that was taken off the playlist while it plays makes room for the next one
    if (this.choice === 'shuffle' && this.playing && !this.list.includes(this.tr)) { this.pick(); this.restart(); }
  }
  private pick() {
    const t = TRACK_DEFS.find((x) => x.id === this.choice);
    if (t) { this.tr = t; return; }
    // the playlist: any of its tracks the first time, afterwards the one that follows in the list
    const l = this.list;
    if (!this.picked) { this.picked = true; this.tr = l[Math.floor(Math.random() * l.length)] || TRACK_DEFS[0]; return; }
    const from = TRACK_DEFS.indexOf(this.tr);
    this.tr = l.find((x) => TRACK_DEFS.indexOf(x) > from) || l[0];
  }
  /** Start the score. `fresh` marks a new run: on shuffle it moves on to another track. */
  startMusic(fresh = false) {
    if (!this.ctx) return;
    if (this.playing) { if (fresh && this.choice === 'shuffle' && this.list.length > 1) { this.pick(); this.restart(); } return; }
    if (fresh || !this.mb) this.pick();
    this.playing = true;
    this.restart();
    this.timer = window.setInterval(() => this.schedule(), 60);
  }
  stopMusic() {
    this.playing = false; clearInterval(this.timer); this.beats.length = 0;
    this.dropBus();
  }
  /** Fade the running track out. Its synths stop once the fade is over and the bus is let go. */
  private dropBus() {
    const c = this.ctx, old = this.mb;
    this.mb = null;
    if (!c || !old) return;
    const t = c.currentTime;
    old.all.gain.cancelScheduledValues(t);
    old.all.gain.setTargetAtTime(0, t, 0.12);
    for (const o of old.oscs) { try { o.stop(t + 1.1); } catch { /* already stopped */ } }
    setTimeout(() => old.all.disconnect(), 1200);
  }
  private restart() {
    const c = this.ctx!;
    this.dropBus();
    this.mb = this.makeBus(c, this.tr);
    this.nextT = c.currentTime + 0.2; this.step = 0; this.beats.length = 0;
    this.seed = 1 + Math.floor(Math.random() * 1e6);
    this.resetForm(0);
  }
  private resetForm(bar: number) {
    this.pos = Math.max(0, Math.min(FORM_BARS - 1, bar)); this.fresh = true; this.mode = 'play'; this.wasHot = false; this.exits = 0; this.calmBar = 0; this.cyc = 0; this.voicing = null; this.leadM = -1;
  }
  /**
   * One track's synths, built once and kept running (notes are automation on them, not new nodes): a four-voice PWM
   * pad, a four-voice supersaw stab, a mono bass (two saws an octave apart and a sine sub through a resonant low-pass
   * and a saturator), a mono pluck arpeggio, and a seven-saw mono lead with portamento, delayed vibrato and drive.
   * Pad, stab, bass and arpeggio sit on `duck`, which the kick pumps. Arpeggio and lead feed a ping-pong delay synced
   * to the tempo; pad, stab and arpeggio go through a stereo chorus; everything that sends gets the shared plate.
   */
  private makeBus(c: BaseAudioContext, tr: Track): MusicBus {
    const st = STYLE[tr.pole], oscs: AudioScheduledSourceNode[] = [], t0 = c.currentTime;
    const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
    const osc = (type: OscillatorType, det = 0) => { const o = c.createOscillator(); o.type = type; o.detune.value = det; o.frequency.value = 110; o.start(t0); oscs.push(o); return o; };
    const lp = (f: number, q: number, type: BiquadFilterType = 'lowpass') => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    const all = g(); all.connect(this.musIn);
    const duck = g(); duck.connect(all);
    const drums = g(); drums.connect(all);
    const rev = g(); rev.connect(this.plateIn);
    // tempo-synced ping-pong delay: a dotted eighth, each repeat a little darker
    const dIn = g(), dl = c.createDelay(2), dr = c.createDelay(2), dfb = g(0.38), dlp = lp(3200, 0.5), mer = c.createChannelMerger(2), dOut = g(0.55);
    dl.delayTime.value = dr.delayTime.value = (45 / tr.bpm);
    dIn.connect(dl); dl.connect(dlp).connect(dr); dr.connect(dfb).connect(dl);
    dl.connect(mer, 0, 0); dr.connect(mer, 0, 1); mer.connect(dOut).connect(all); dOut.connect(g(0.25)).connect(rev);
    // stereo chorus: two short delays swept in opposite directions
    const chIn = g(), cl = c.createDelay(0.05), cr = c.createDelay(0.05), cm = c.createChannelMerger(2), clfo = osc('sine');
    clfo.frequency.value = 0.47; cl.delayTime.value = 0.008; cr.delayTime.value = 0.0125;
    clfo.connect(g(0.0021)).connect(cl.delayTime); clfo.connect(g(-0.0021)).connect(cr.delayTime);
    chIn.connect(cl).connect(cm, 0, 0); chIn.connect(cr).connect(cm, 0, 1);
    cm.connect(g(0.75)).connect(duck); chIn.connect(g(0.55)).connect(duck);
    // pad: per voice a PWM pulse (a saw minus itself delayed by a swept part of its period) and a saw 9 cents sharp
    const padF = lp(st.padCut, 0.9), padG = g(0), plfo = osc('sine'), flfo = osc('sine');
    plfo.frequency.value = 0.31; flfo.frequency.value = 0.09; flfo.connect(g(st.padCut * 0.22)).connect(padF.frequency);
    padF.connect(padG).connect(chIn); padG.connect(g(0.5)).connect(rev);
    const pad = { o: [] as OscillatorNode[][], pwm: [] as DelayNode[], depth: [] as GainNode[], f: padF, g: padG };
    for (let i = 0; i < 4; i++) {
      const a = osc('sawtooth'), b = osc('sawtooth', 9), d = c.createDelay(0.05), dep = g(0), inv = g(-1);
      d.delayTime.value = 0.002; plfo.connect(dep).connect(d.delayTime);
      a.connect(padF); a.connect(d).connect(inv).connect(padF); b.connect(g(0.6)).connect(padF);
      pad.o.push([a, b]); pad.pwm.push(d); pad.depth.push(dep);
    }
    // stab: four voices of three saws spread left, centre, right
    const sm = c.createChannelMerger(2), stabF = lp(800, 1.2), stabG = g(0);
    sm.connect(stabF).connect(stabG).connect(chIn); stabG.connect(g(0.6)).connect(rev);
    const stab = { o: [] as OscillatorNode[][], f: stabF, g: stabG };
    for (let i = 0; i < 4; i++) {
      const l = osc('sawtooth', -16), m = osc('sawtooth'), r = osc('sawtooth', 17);
      l.connect(sm, 0, 0); r.connect(sm, 0, 1); m.connect(sm, 0, 0); m.connect(sm, 0, 1);
      stab.o.push([l, m, r]);
    }
    // bass
    const b1 = osc('sawtooth'), b2 = osc('sawtooth', 4), sub = osc('sine');
    const bassF = lp(st.bassCut, st.bassQ), bDrive = g(0.6), shp = c.createWaveShaper(), bPost = g(1), bassG = g(0);
    shp.curve = satCurve(st.bassDrive);
    b1.connect(bassF); b2.connect(g(0.4)).connect(bassF);
    bassF.connect(bDrive).connect(shp).connect(bPost).connect(bassG);
    // the sub skips the filter and the saturation: it stays a clean sine under everything
    sub.connect(g(0.26)).connect(bassG);
    bassG.connect(duck);
    // arpeggio: saw and square, a resonant pluck, the lows cut so it stays out of the bass
    const a1 = osc('sawtooth'), a2 = osc('square', 7), arpF = lp(1800, 3.2), arpH = lp(220, 0.7, 'highpass'), arpG = g(0);
    a1.connect(arpF); a2.connect(g(0.45)).connect(arpF);
    arpF.connect(arpH).connect(arpG).connect(chIn); arpG.connect(g(0.32)).connect(dIn); arpG.connect(g(0.25)).connect(rev);
    // lead: seven detuned saws, odd voices left and even ones right, with vibrato on all of them
    const lm = c.createChannelMerger(2), leadF = lp(st.leadCut, 1.1), lDrive = g(0.28), lshp = c.createWaveShaper(), leadG = g(0), vib = g(0), vlfo = osc('sine');
    vlfo.frequency.value = 5.6; vlfo.connect(vib);
    lshp.curve = satCurve(st.leadDrive); lshp.oversample = '2x';
    const lo: OscillatorNode[] = [];
    SUPER.forEach(([det, lvl], i) => {
      const o = osc('sawtooth', det), lg = g(lvl);
      vib.connect(o.detune); o.connect(lg);
      if (i === 0) { lg.connect(lm, 0, 0); lg.connect(lm, 0, 1); } else lg.connect(lm, 0, i % 2);
      lo.push(o);
    });
    lm.connect(leadF).connect(lDrive).connect(lshp).connect(leadG).connect(all);
    leadG.connect(g(0.42)).connect(dIn); leadG.connect(g(0.35)).connect(rev);
    // drums: hats a little right, toms spread, the snare's own small plate send on top of its gated tail
    const hat = c.createStereoPanner(), hatG = g(0.75); hat.pan.value = 0.28; hat.connect(hatG).connect(drums);
    const toms = [-0.45, 0, 0.45].map((p) => { const n = c.createStereoPanner(); n.pan.value = p; n.connect(drums); n.connect(rev); return n; });
    const snareBus = g(); snareBus.connect(drums); snareBus.connect(g(0.18)).connect(rev);
    const K = kitFor(c.sampleRate), kit = {} as Buffers;
    for (const k of Object.keys(K) as (keyof KitData)[]) {
      if (k === 'plate') continue;
      const d = K[k], b = c.createBuffer(d.length, d[0].length, c.sampleRate);
      d.forEach((x, i) => b.copyToChannel(x as Float32Array<ArrayBuffer>, i));
      kit[k] = b;
    }
    return {
      all, duck, drums, snareBus, hat, toms, rev, oscs, pad, stab, kit, st,
      bass: { o: [b1, b2, sub], f: bassF, g: bassG, drive: bDrive, post: bPost },
      arp: { o: [a1, a2], f: arpF, g: arpG },
      lead: { o: lo, f: leadF, g: leadG, vib, drive: lDrive, on: false, m: -1, end: 0 },
      kickRate: keyRate(tr, st.hard ? 47 : 52), snareRate: keyRate(tr, 185),
    };
  }
  private schedule() {
    const c = this.ctx!;
    if (c.state !== 'running' || !this.mb) return;
    // the playlist: a track that has played through hands over to the next one once its last bar has sounded
    const moveOn = this.choice === 'shuffle' && this.list.length > 1;
    if (moveOn && this.step >= SONG_STEPS) {
      if (c.currentTime < this.nextT - 0.03) return;
      this.pick(); this.restart();
    }
    if (this.nextT < c.currentTime + 0.02) this.nextT = c.currentTime + 0.06;
    // timers are slowed down in a hidden tab, so the horizon is longer there
    this.scheduleUntil(c.currentTime + (document.hidden ? 1.6 : 0.4), undefined, undefined, moveOn ? SONG_STEPS : Infinity);
  }
  /**
   * Render the score plus recorded cues to a buffer (used for the trailer soundtrack and the sound checks).
   * The work is scheduled two seconds at a time while the render is held, so a long render stays fast.
   * `hot` and `opts.calm` are time ranges in which the score plays intense or calm; `opts.bar` starts it at that bar of the form.
   */
  async renderOffline(seconds: number, cues: Cue[], hot: [number, number][], opts: { track?: string; music?: number; fade?: boolean; bar?: number; calm?: [number, number][] } = {}): Promise<AudioBuffer> {
    const c = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
    this.ctx = c as unknown as AudioContext;
    this.build(c);
    this.musG.gain.value = opts.music ?? 0.5;
    if (opts.fade === false) this.master.gain.value = 1;
    else {
      this.master.gain.setValueAtTime(0, 0); this.master.gain.linearRampToValueAtTime(0.9, 1.2);
      this.master.gain.setValueAtTime(0.9, Math.max(1.3, seconds - 3)); this.master.gain.linearRampToValueAtTime(0, Math.max(1.4, seconds - 0.05));
    }
    this.tr = TRACK_DEFS.find((x) => x.id === opts.track) || TRACK_DEFS[0];
    this.mb = this.makeBus(c, this.tr);
    this.nextT = 0.4; this.step = 0; this.seed = 7;
    this.resetForm(Math.floor(opts.bar || 0));
    const hotAt = (t: number) => hot.some(([a, b]) => t >= a && t < b);
    const calm = opts.calm || [];
    const calmAt = (t: number) => calm.some(([a, b]) => t >= a && t < b);
    const list = cues.filter((q) => q && typeof q.name === 'string' && q.t >= 0 && q.t <= seconds - 0.5).sort((a, b) => a.t - b.t);
    let qi = 0;
    const fill = (until: number) => {
      this.scheduleUntil(Math.min(seconds - 2, until), hotAt, calmAt);
      for (; qi < list.length && list[qi].t < until; qi++) { const q = list[qi]; this.offset = Math.max(0, q.t - c.currentTime); this.emit(q.name, q.g, q.pan); }
      this.offset = 0;
    };
    const CHUNK = 2;
    fill(CHUNK + 0.5);
    for (let t = CHUNK; t < seconds; t += CHUNK) void c.suspend(t).then(() => { fill(t + CHUNK + 0.5); void c.resume(); });
    return c.startRendering();
  }
  private scheduleUntil(limit: number, hotAt?: (t: number) => boolean, calmAt?: (t: number) => boolean, lastStep = Infinity) {
    const spb = 15 / this.tr.bpm; // one sixteenth
    while (this.nextT < limit && this.step < lastStep) {
      const t = this.nextT;
      this.scoreStep(this.step, t, hotAt ? hotAt(t) : this.intense > 0.5, calmAt ? calmAt(t) : this.calm, !hotAt);
      this.nextT += spb; this.step++;
    }
  }
  /** a small seeded generator, so a track's variations do not depend on what else used Math.random */
  private rnd(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0; return (this.seed >>> 0) / 4294967296; }
  /** a value that is the same for a given cycle, bar and salt: variations repeat within a pass and change between passes */
  private vary(n: number, salt: number): number { let h = Math.imul(this.cyc * 7919 + salt * 104729 + n, 2654435761) ^ (this.tr.bpm * 31); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0) / 4294967296; }

  /** Decide what the bar that starts at `t` is: where in the form, calm or intense, the chord, the fill. */
  private newBar(t: number, hot: boolean, calm: boolean) {
    const tr = this.tr, B = this.mb!, st = B.st, spb = 15 / tr.bpm, bar = spb * 16;
    let enter = '';
    if (calm) {
      if (this.mode !== 'calm' && !this.fresh) enter = 'calm';
      this.mode = 'calm'; this.calmBar++;
    } else {
      // a wave starts: straight into the verse, every other time into the chorus
      if (this.mode === 'calm') { if (!this.fresh) { this.pos = this.exits++ % 2 ? FORM_START.chorus : FORM_START.verse; enter = 'wave'; } }
      else if (!this.fresh) { this.pos++; if (this.pos >= FORM_BARS) { this.pos = LOOP_AT; this.cyc++; } }
      this.mode = 'play';
    }
    if (hot && !this.wasHot && !calm && !this.fresh) enter = 'hot';
    this.wasHot = hot; this.fresh = false;
    let sec: Sec | 'calm' = 'calm', sb = this.calmBar - 1;
    if (!calm) for (const [s, len] of SCORE_FORM) if (this.pos >= FORM_START[s] && this.pos < FORM_START[s] + len) { sec = s; sb = this.pos - FORM_START[s]; }
    const chorus = sec === 'chorus' || sec === 'chorus2';
    const pk: ProgKey = sec === 'calm' ? 'verse' : hot && !chorus ? 'dark' : PROG_OF[sec];
    const prog = tr.prog[pk], ch = parseChord(prog[sb % prog.length]);
    const lift = sec === 'chorus2' ? tr.lift : 0;
    const v = voiceChord(ch, tr.tonic, this.voicing);
    this.voicing = v;
    const bass = 28 + ((tr.tonic + ch.root - 4 + 24) % 12) + lift;
    // fills: the last bar of every 8 a big one, of every 4 a small one (not in the calm, the intro's first half or a build)
    let fill: BarState['fill'] = '';
    const drumsOn = sec !== 'calm' && !(sec === 'intro' && sb < 4) && sec !== 'break';
    if (drumsOn && sec !== 'build' && sb % 8 === 7) fill = (['toms', 'snare', 'stutter', 'toms', 'drop'] as const)[Math.floor(this.vary(this.pos, 1) * 5)];
    else if (drumsOn && sb % 4 === 3) fill = 'small';
    this.bs = { sec, sb, calm, hot, v, ch, bass, lift, fill, cyc: this.cyc };

    // ---- per bar sound settings ----
    const P = B.pad, at = t;
    const padLvl = calm ? 0.022 : sec === 'intro' ? 0.014 + sb * 0.002 : sec === 'break' || sec === 'outro' ? 0.024 : chorus ? 0.019 : sec === 'bridge' ? 0.024 : 0.016;
    P.g.gain.setTargetAtTime(padLvl, at, 0.25);
    const cut = st.padCut * (calm ? 0.55 : sec === 'intro' ? 0.25 + sb * 0.09 : sec === 'build' ? 0.6 + sb * 0.12 : chorus ? 1.25 : sec === 'break' ? 0.7 : 0.9) * (hot ? 1.3 : 1);
    P.f.frequency.setTargetAtTime(cut, at, sec === 'intro' || sec === 'build' ? bar * 0.3 : 0.15);
    v.forEach((m, i) => {
      const f = hz(m + lift);
      this.log(f);
      for (const o of P.o[i]) o.frequency.setTargetAtTime(f, at, 0.006);
      // the pulse width swings between 15% and 85% of the period
      P.pwm[i].delayTime.setTargetAtTime(0.5 / f, at, 0.01); P.depth[i].gain.setTargetAtTime(0.35 / f, at, 0.01);
      for (const o of B.stab.o[i]) o.frequency.setTargetAtTime(hz(m + 12 + lift), at, 0.004);
    });
    B.bass.drive.gain.setTargetAtTime((calm ? 0.25 : 0.6) * (hot ? 1.8 : 1), at, 0.05);
    B.bass.post.gain.setTargetAtTime(hot ? 0.8 : 1, at, 0.05);
    B.lead.drive.gain.setTargetAtTime(0.28 * (hot ? 1.8 : 1), at, 0.05);

    // ---- transitions ----
    const K = B.kit;
    if (enter === 'wave' || enter === 'hot') { this.hit(K.impact, t, 0.55, B.drums); this.hit(K.crash, t, 0.3, B.drums); }
    if (enter === 'calm') this.sweep(t, bar, 5200, 300, 0.05, B.drums); // a downlifter as the wave ends
    if (!calm && sb === 0 && (chorus || sec === 'verse' || sec === 'bridge' || sec === 'outro') && !enter) {
      this.hit(K.crash, t, chorus ? 0.3 : 0.22, B.drums);
      if (chorus) this.hit(K.impact, t, 0.4, B.drums);
    }
    if (chorus && sb === 8) this.hit(K.crash, t, 0.22, B.drums);
    if (sec === 'chorus2' && sb === 0) this.sweep(t, bar * 2, 6000, 400, 0.035, B.drums);
    // risers into the big downbeats, a reversed crash landing exactly on them
    if (sec === 'build' && sb === 4) this.sweep(t, bar * 4, 400, 7000, 0.06, B.drums);
    if ((sec === 'break' && sb === 6) || (sec === 'bridge' && sb === 6)) this.sweep(t, bar * 2, 500, 6500, 0.05, B.drums);
    if ((sec === 'build' || sec === 'bridge') && sb === 7) { const d = K.rcrash.duration; this.hit(K.rcrash, t + bar - d, 0.22, B.drums); }
  }
  /** a noise sweep (riser or downlifter) through a band-pass that moves from `f0` to `f1` */
  private sweep(t: number, dur: number, f0: number, f1: number, vol: number, out: AudioNode) {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const up = f1 > f0, p = g.gain;
    p.value = 0; p.setValueAtTime(0, t);
    if (up) { p.linearRampToValueAtTime(vol * 0.15, t + dur * 0.5); p.linearRampToValueAtTime(vol, t + dur - 0.01); p.linearRampToValueAtTime(0, t + dur); }
    else { p.linearRampToValueAtTime(vol, t + 0.02); p.exponentialRampToValueAtTime(vol * 0.01, t + dur); p.linearRampToValueAtTime(0, t + dur + 0.02); }
    s.connect(f).connect(g).connect(out); g.connect(this.mb!.rev);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  private log(f: number) { if (this.noteLog) this.noteLog.push({ m: Math.round(12 * Math.log2(f / 440) + 69), sec: this.bs ? (this.bs.hot ? 'hot:' : '') + this.bs.sec : '' }); }
  /** one shot from the drum kit */
  private hit(buf: AudioBuffer, t: number, vol: number, out: AudioNode, rate = 1) {
    const c = this.ctx!, s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; if (rate !== 1) s.playbackRate.value = rate; g.gain.value = vol;
    s.connect(g).connect(out); s.start(Math.max(t, c.currentTime));
  }
  /** an FM bell (sparse: intro, breakdown and the calm) */
  private bell(t: number, f: number, vol: number, out: AudioNode) {
    const c = this.ctx!, car = c.createOscillator(), mod = c.createOscillator(), dep = c.createGain(), g = c.createGain();
    this.log(f);
    car.frequency.value = f; mod.frequency.value = f * 3.5; dep.gain.setValueAtTime(f * 2.2, t); dep.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.2);
    const p = g.gain; p.value = 0; p.setValueAtTime(0, t); p.linearRampToValueAtTime(vol, t + 0.004); p.exponentialRampToValueAtTime(vol * 0.003, t + 1.6); p.linearRampToValueAtTime(0, t + 1.65);
    mod.connect(dep).connect(car.frequency); car.connect(g).connect(out); g.connect(this.mb!.rev);
    car.start(t); mod.start(t); car.stop(t + 1.7); mod.stop(t + 1.7);
  }
  /** Retrigger (or glide) a mono synth: amplitude and filter envelopes as automation on persistent nodes. */
  private mono(v: Mono, t: number, f: number, dur: number, vol: number, o: { att?: number; dec?: number; sus?: number; rel?: number; cut: number; peak: number; fdec: number; glide?: number }) {
    this.log(f);
    for (const x of v.o) { if (o.glide) x.frequency.setTargetAtTime(f * (x === v.o[1] && v.o.length === 3 ? 2 : 1), t, o.glide / 3); else x.frequency.setValueAtTime(f * (x === v.o[1] && v.o.length === 3 ? 2 : 1), t); }
    const g = v.g.gain, att = o.att ?? 0.003, rel = o.rel ?? 0.03;
    g.setTargetAtTime(vol, t, att / 3);
    g.setTargetAtTime(vol * (o.sus ?? 1), t + att, (o.dec ?? 0.1) / 3);
    g.setTargetAtTime(0, t + Math.max(att, dur - rel * 0.5), rel / 3);
    const fr = v.f.frequency;
    if (!o.glide) { fr.setTargetAtTime(o.peak, t, 0.002); fr.setTargetAtTime(o.cut, t + 0.004, o.fdec / 3); }
  }
  /** A lead note: glides from the last one if it is still sounding, vibrato comes in after a moment. */
  private leadNote(t: number, m: number, dur: number, vol: number, legato: boolean) {
    const L = this.mb!.lead, st = this.mb!.st, f = hz(m), glide = legato && L.end > t - 0.02;
    this.log(f);
    for (const o of L.o) { if (glide) o.frequency.setTargetAtTime(f, t, st.glide / 3); else o.frequency.setValueAtTime(f, t); }
    const g = L.g.gain;
    if (!glide) { g.setTargetAtTime(vol, t, 0.004); L.f.frequency.setTargetAtTime(st.leadCut * 1.6, t, 0.003); L.f.frequency.setTargetAtTime(st.leadCut, t + 0.01, 0.12); }
    else g.setTargetAtTime(vol, t, 0.02);
    g.setTargetAtTime(0, t + dur - 0.02, 0.025);
    // above G5 a driven supersaw turns shrill (its distortion lands in the 2-5 kHz the ear is most sensitive to):
    // less drive, so fewer of those harmonics and a little less level, about 4 dB an octave
    L.drive.gain.setTargetAtTime(0.28 * (this.bs && this.bs.hot ? 1.8 : 1) * (m > 79 ? Math.pow(2, -(m - 79) / 18) : 1), t, glide ? 0.03 : 0.004);
    const vb = L.vib.gain;
    vb.setTargetAtTime(0, t, 0.02);
    if (dur > 0.3) vb.setTargetAtTime(st.vib, t + 0.22, 0.12);
    L.end = t + dur; L.m = m;
  }

  /** Schedule everything that starts on sixteenth `n` of the track, at audio time `t`. */
  private scoreStep(n: number, t: number, hot: boolean, calm: boolean, live: boolean) {
    const tr = this.tr, B = this.mb!, st = B.st, s = n % 16, spb = 15 / tr.bpm;
    if (s === 0) this.newBar(t, hot, calm);
    const S = this.bs, K = B.kit, sec = S.sec, sb = S.sb, chorus = sec === 'chorus' || sec === 'chorus2';
    hot = S.hot; calm = S.calm;
    this.cur = null; this.base = t;
    // what plays in this bar
    const grooveSec = hot && (sec === 'intro' || sec === 'break' || sec === 'outro') ? 'verse' : sec;
    const half = grooveSec === 'bridge' || (grooveSec === 'outro' && sb >= 4);
    const drums = grooveSec !== 'calm' && !(grooveSec === 'intro' && sb < 4) && grooveSec !== 'break';
    const vi = Math.floor(this.vary(0, 2 + this.cyc) * 8);
    const pick = (a: string[]) => a[(vi + (sb >> 2)) % a.length];

    // --- drums ---
    let kick = false, kv = 1;
    const fillOn = S.fill && S.fill !== 'small' ? s >= (S.fill === 'toms' ? 8 : 12) : S.fill === 'small' && s >= 14;
    if (calm) { kick = s === 0 || s === 8; kv = 0.45; if (s % 4 === 2) this.hit(K.hat, t, 0.05, B.hat); }
    else if (grooveSec === 'break') {
      if (sb >= 2 && s % 4 === 2) this.hit(K.hat, t, 0.06, B.hat);
      if (sb === 6 && s % 2 === 0) this.hit(K.snare, t, 0.06 + s * 0.006, B.snareBus, B.snareRate);
      if (sb === 7) this.hit(K.snare, t, 0.1 + s * 0.017, B.snareBus, B.snareRate);
      if (sb === 7 && s === 0) { kick = true; kv = 0.6; }
    } else if (drums) {
      const fill = fillOn ? S.fill : '';
      const kp = half ? pick(st.kick.half) : grooveSec === 'build' || chorus ? pick(st.kick.chorus) : pick(st.kick.verse);
      const intro = grooveSec === 'intro';
      if (fill === 'drop') { /* everything stops for the last beat */ }
      else if (fill === 'toms') {
        // a descending 80s tom roll: two on each tom, then the floor tom twice
        const k = s - 8, which = k < 2 ? 0 : k < 4 ? 1 : 2, rate = [1.55, 1.55, 1.2, 1.2, 0.9, 0.9, 0.78, 0.78][k];
        this.hit(K.tom, t, 0.42 + k * 0.03, B.toms[which], rate);
        if (k === 0 || k === 4) kick = true;
      } else if (fill === 'snare') { this.hit(K.snare, t, 0.18 + (s - 12) * 0.08, B.snareBus, B.snareRate); if (s === 12) kick = true; }
      else if (fill === 'stutter') { if (s % 2 === 0) { kick = true; this.hit(K.snare, t, 0.3, B.snareBus, B.snareRate); } }
      else {
        if (fill === 'small') { if (s === 14) this.hit(K.tom, t, 0.32, B.toms[1], 1.3); if (s === 15) this.hit(K.tom, t, 0.34, B.toms[2], 0.95); }
        kick = kp[s] === 'x' && !(fill === 'small' && s >= 14);
        if (grooveSec === 'build') kick = s % 4 === 0;
        kv = intro ? 0.7 : 1;
        // snare: the backbeat (on 3 in a half-time bar); the build turns it into a roll that speeds up
        let sn = 0;
        if (grooveSec === 'build') { sn = sb < 4 ? (s === 4 || s === 12 ? 1 : 0) : sb < 6 ? (s % 4 === 0 ? 0.55 + sb * 0.05 : 0) : sb === 6 ? (s % 2 === 0 ? 0.5 + s * 0.02 : 0) : 0.35 + s * 0.04; }
        else if (!intro) sn = half ? (s === 8 ? 1 : 0) : s === 4 || s === 12 ? 1 : 0;
        else if (sb === 7 && s >= 12) sn = 0.25 + (s - 12) * 0.12;
        if (sn) { this.hit(K.snare, t, 0.5 * sn, B.snareBus, B.snareRate); if ((hot || st.hard || tr.pole === 'drama') && sn === 1 && !half) this.hit(K.clap, t, hot ? 0.24 : 0.14, B.snareBus); }
        // ghost notes on the snare now and then (dark and drama grooves)
        if (!intro && !half && tr.pole !== 'outrun' && s === 15 && this.vary(this.pos * 16 + s, 3) < 0.35) this.hit(K.snare, t, 0.07, B.snareBus, B.snareRate);
      }
      if (fill !== 'drop' && fill !== 'toms') {
        // hats: the groove's pattern; intense doubles them into sixteenths
        const hp = half ? st.hat.half : chorus || grooveSec === 'build' ? st.hat.chorus : st.hat.verse, h = hot ? (s % 4 === 2 ? 'o' : s % 2 ? 'x' : 'X') : hp[s];
        const hv = intro ? 0.6 : 1;
        if (h === 'o') this.hit(K.ohat, t, 0.07 * hv, B.hat);
        else if (h === 'X') this.hit(K.hat, t, 0.11 * hv, B.hat);
        else if (h === 'x') this.hit(K.hat, t, (s % 2 ? 0.055 : 0.08) * hv * (0.85 + this.vary(n, 4) * 0.3), B.hat);
      }
    } else if (grooveSec === 'intro' && sb >= 2 && s % 4 === 2) this.hit(K.hat, t, 0.04, B.hat);
    if (kick) {
      this.hit(st.hard ? K.kickHard : K.kick, t, 0.52 * kv, B.drums, B.kickRate);
      // sidechain: pad, stab, bass and arpeggio dip and come back over an eighth
      const depth = calm ? 1 - (1 - st.duck) * 0.35 : st.duck, d = B.duck.gain;
      d.setTargetAtTime(depth, t, 0.0025); d.setTargetAtTime(1, t + 0.035, spb * 0.75);
    }
    // the beat the visuals pulse to: every kick, and a softer pulse on the quarter notes the kick leaves out
    if (live && (kick || s % 4 === 0)) { this.beats.push({ t, a: kick ? (calm ? 0.5 : s === 0 ? 1 : 0.85) : calm ? 0.3 : 0.4 }); if (this.beats.length > 32) this.beats.shift(); }

    // --- bass ---
    const bm = S.bass, bass = B.bass;
    const bassOn = !(sec === 'intro' && sb < 4);
    if (calm || grooveSec === 'break' || grooveSec === 'intro') {
      if (s === 0 && bassOn) this.mono(bass, t, hz(bm), spb * 15, calm ? 0.13 : 0.15, { att: 0.04, rel: 0.25, cut: st.bassCut * 0.7, peak: st.bassCut * 1.4, fdec: 0.6 });
    } else {
      const bp = half ? pick(st.bass.half) : chorus ? pick(st.bass.chorus) : pick(st.bass.verse), k = bp[s];
      if (k !== '-' && k !== '.' && !(S.fill === 'drop' && s >= 12)) {
        let len = 1;
        while (s + len < 16 && bp[s + len] === '-') len++;
        const m = bm + (k === 'o' ? 12 : k === 'f' ? 7 : 0);
        const accent = s % 4 === 0 ? 1 : 0.8;
        this.mono(bass, t, hz(m), len * spb * 0.92, 0.14 * accent, { att: 0.003, dec: 0.12, sus: 0.8, rel: 0.02, cut: st.bassCut * (chorus ? 1.25 : 1) * (hot ? 1.4 : 1), peak: st.bassCut * (st.hard ? 5 : 3.5), fdec: st.hard ? 0.09 : 0.16 });
      }
    }

    // --- stabs: dark and drama choruses, and everywhere while the Titan is out ---
    if ((st.stab && chorus) || (hot && !calm)) {
      const sp = st.stab || 'x.....x.....x...';
      if (sp[s] === 'x') {
        const g = B.stab.g.gain, f = B.stab.f.frequency;
        g.setTargetAtTime(0.03, t, 0.002); g.setTargetAtTime(0.012, t + 0.01, 0.08); g.setTargetAtTime(0, t + spb * 2.2, 0.03);
        f.setTargetAtTime(4200, t, 0.002); f.setTargetAtTime(900, t + 0.005, 0.09);
      }
    }

    // --- arpeggio ---
    const arpOn = calm ? s % 2 === 0 : !(sec === 'intro' && sb < 2);
    if (arpOn) {
      const pat = st.arp[(S.cyc + (sec === 'calm' ? 0 : FORM_START[sec] / 8) + (hot ? 1 : 0)) % st.arp.length];
      const rot = (S.cyc * 4) % 16, ai = pat[(s + rot) % 16];
      if (ai >= 0) {
        const m = S.v[ai % 4] + 12 * Math.floor(ai / 4) + S.lift + (chorus && tr.pole === 'drama' ? 12 : 0);
        const open = calm ? 0.5 : sec === 'intro' ? 0.4 + sb * 0.08 : sec === 'build' ? 0.8 + sb * 0.1 : sec === 'break' ? 0.75 : chorus ? 1.15 : 1;
        const next = pat[(s + rot + 1) % 16];
        this.mono(B.arp, t, hz(m), spb * (next < 0 ? 1.7 : 0.85), (calm ? 0.075 : 0.12) * (chorus ? 0.85 : 1), { att: 0.002, dec: 0.12, sus: 0.45, rel: 0.03, cut: 650 * open, peak: 4200 * open, fdec: 0.11 });
      }
    }
    // bells: the intro, the breakdown and the calm get a slow chime on the top of the chord
    if ((sec === 'intro' || sec === 'break' || calm) && (s === 0 || (s === 8 && sb % 2 === 1))) this.bell(t, hz(S.v[(sb + (s ? 1 : 3)) % 4] + 24 + S.lift), 0.03, B.duck);

    // --- lead ---
    if (calm) return;
    if (chorus) {
      const second = sb >= 8, bb = sb % 8;
      const ph = second ? tr.answer : tr.hook, line = bb === 7 ? (second ? tr.answerEnd : tr.hookEnd) : ph[bb % 4];
      const up = sec === 'chorus2' && tr.lift === 0 && second ? 12 : 0;
      this.leadLine(line, s, t, spb, up + S.lift, 0.15);
    } else if (hot || (grooveSec === 'verse' && sb >= 8 && tr.pole !== 'dark') || grooveSec === 'bridge' || (grooveSec === 'verse' && sb >= 8 && S.cyc % 2 === 1)) {
      // a line made from the chord's own notes, so it fits whatever the harmony does
      const rh = hot ? HOT_RIFF[(sb >> 1) % 2] : st.counter[(sb >> 2) % 2];
      if (rh[s] === 'x') {
        let len = 1;
        while (s + len < 16 && rh[s + len] === '-') len++;
        const tones = S.ch.tones.map((x) => (tr.tonic + S.ch.root + x) % 12), lo = tr.leadRoot + 3, hi = tr.leadRoot + 17;
        const cands: number[] = [];
        for (let m = lo; m <= hi; m++) if (tones.includes(m % 12)) cands.push(m);
        const prev = this.leadM < 0 ? tr.leadRoot + 7 : this.leadM, dir = this.vary(this.pos * 16 + s, 5) < 0.5 ? -1 : 1;
        let best = cands[0], bc = Infinity;
        for (const m of cands) { const d = (m - prev) * dir, c2 = d <= 0 ? 50 - d : Math.abs(d - 3); if (m !== prev && c2 < bc) { bc = c2; best = m; } }
        this.leadM = best;
        const legato = !hot && s > 0 && rh[s - 1] === '-';
        this.leadNote(t, best + S.lift + (hot && tr.leadRoot + 29 <= 86 ? 12 : 0), len * spb * (hot ? 0.8 : 0.97), hot ? 0.11 : grooveSec === 'bridge' ? 0.12 : 0.095, legato);
      }
    }
  }
  /** Play the lead phrase `line` at step `s`: notes, holds and glides. */
  private leadLine(line: string, s: number, t: number, spb: number, shift: number, vol: number) {
    const k = line[s];
    if (k === '.' || k === '-' || k === undefined) return;
    const tr = this.tr, deg = parseInt(k, 36);
    let len = 1;
    while (s + len < 16 && line[s + len] === '-') len++;
    const m = tr.leadRoot + tr.scale[deg % 7] + 12 * Math.floor(deg / 7) + shift;
    // ornament, different each pass: a long note now and then starts with a quick turn from the note above
    if (len >= 6 && this.vary(this.pos * 16 + s, 6) < 0.3) {
      const up = tr.leadRoot + tr.scale[(deg + 1) % 7] + 12 * Math.floor((deg + 1) / 7) + shift;
      this.leadNote(t, up, spb * 0.9, vol * 0.9, false);
      this.leadNote(t + spb, m, (len - 1) * spb * 0.97, vol, true);
      this.leadM = m; return;
    }
    const legato = s > 0 && line[s - 1] === '-';
    this.leadNote(t, m, len * spb * 0.97, vol, legato);
    this.leadM = m;
  }
}
