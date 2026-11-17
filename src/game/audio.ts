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

// ---------- the score: generated synthwave tracks ----------
// Notes are semitones above the key root. A chord lists the pad voicing (its first note is the bass note).
// Step strings have 16 characters, one per sixteenth. Bass: r root, o octave, f fifth, s seventh. Drums: x hit, o open hat.
// Lead: a digit or letter is a degree of the natural minor scale (0 = root, 7 = octave, a = 10 ...), - holds, . rests.
interface Track extends TrackInfo {
  /** MIDI note of the key root in the bass register */
  root: number; chords: number[][]; bass: string; arp: number[]; kick: string; snare: string; hat: string; leadA: string[]; leadB: string[]; wave: OscillatorType;
}
const TRACK_DEFS: Track[] = [
  {
    id: 'relay', name: 'Night Relay', key: 'A minor', bpm: 100, root: 33, wave: 'sawtooth',
    chords: [[0, 3, 7, 14], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 12]],
    bass: 'r.r.o.r.r.r.o.rr', arp: [0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...o.',
    leadA: ['4-----2-4---7---', '5-----4-2-------', '4-----2-4---8---', '6-----4-3-------'],
    leadB: ['7---6-4---2-4---', '5---4-2---0-2---', '4---6-7---8-9---', '8-------6-------'],
  },
  {
    id: 'rust', name: 'Rust Horizon', key: 'D minor', bpm: 92, root: 38, wave: 'square',
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -4, 0, 3], [-5, -1, 2, 7]],
    bass: 'r..r..r.r..r..o.', arp: [0, -1, 2, -1, 1, -1, 3, -1, 2, -1, 4, -1, 3, -1, 1, -1],
    kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.o.',
    leadA: ['7-----6-4-------', '5---4---2---0---', '3-----4-5---7---', '8-------4---1---'],
    leadB: ['4---7---9-8-7---', '5-------7---9---', 'a---9---7---5---', '8-----7-8-------'],
  },
  {
    id: 'drive', name: 'Verdigris Drive', key: 'E minor', bpm: 108, root: 40, wave: 'sawtooth',
    chords: [[0, 3, 7, 14], [0, 3, 7, 14], [-4, 0, 3, 7], [-4, 0, 3, 7], [3, 7, 10, 14], [3, 7, 10, 14], [-2, 2, 5, 10], [-5, -1, 2, 7]],
    bass: 'r.r.o.r.r.r.o.ro', arp: [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 2, 1, 3, 6, 3],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.ox',
    leadA: ['4-------7-----6-', '4-------2---1---', '2-------4-----5-', '4---2---0-------'],
    leadB: ['2---4---6---9---', '8-----7-6-------', '6---8---a---8---', '8-------b-------'],
  },
  {
    id: 'lowsun', name: 'Low Sun', key: 'F# minor', bpm: 94, root: 42, wave: 'square',
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 10]],
    bass: 'r...r..rr...r.o.', arp: [0, -1, 1, 2, -1, 3, 2, -1, 1, -1, 2, 4, -1, 3, 2, 1],
    kick: 'x.......x.x.....', snare: '....x.......x...', hat: '..x...x...x.o.x.',
    leadA: ['4---------2-4---', '5-----4---2-----', '2-----4-6---8---', '6-------8---3---'],
    leadB: ['7---6---4---2---', '5---7---9---7---', '8---9---b---9---', 'a-------8-------'],
  },
  {
    id: 'gate', name: 'Gatecrash', key: 'C minor', bpm: 104, root: 36, wave: 'sawtooth',
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 10], [0, 3, 7, 12], [-4, 0, 3, 7], [-7, -4, 0, 3], [-5, -1, 2, 7]],
    bass: 'r.r.r.o.r.r.rro.', arp: [0, 1, 2, 4, 2, 1, 2, 4, 0, 1, 2, 5, 4, 2, 1, 2],
    kick: 'x...x...x...x.x.', snare: '....x.......x...', hat: '..x...x...o...x.',
    leadA: ['7-----6-4---2---', '5-----4-2---0---', '4---6---9---8---', '8-------6---3---'],
    leadB: ['2---4---7---9---', '7-----5-7-------', '5---7---a---7---', '8-------4-------'],
  },
];
/** The built-in tracks, for the Music sheet. */
export const TRACKS: TrackInfo[] = TRACK_DEFS.map(({ id, name, key, bpm }) => ({ id, name, key, bpm }));
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** One arrangement cycle after the 4 bar intro: A (groove), B (with the lead), a breakdown, C (lead and fills). */
const CYCLE = 28;
/** A track played through once: the intro and three rounds of the arrangement, a little over three minutes. */
const SONG_STEPS = (4 + CYCLE * 3) * 16;
interface MusicBus { all: GainNode; duck: GainNode; soft: GainNode; drums: GainNode }

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

  init() {
    if (this.ctx) { this.wake(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.build(c);
    // A context that was put to sleep (a hidden tab, a phone call) is woken as soon as the page is back.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.wake(); });
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
    this.musG = bus(this.scoreMuted ? 0 : this.musicVol * 0.9, 0.16);
    this.musDuck = c.createGain(); this.musDuck.connect(this.musG);
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
  /** Fade the running track out. Notes that were already scheduled die with its bus. */
  private dropBus() {
    const c = this.ctx, old = this.mb;
    this.mb = null;
    if (!c || !old) return;
    old.all.gain.cancelScheduledValues(c.currentTime);
    old.all.gain.setTargetAtTime(0, c.currentTime, 0.12);
    setTimeout(() => old.all.disconnect(), 1200);
  }
  private restart() {
    const c = this.ctx!;
    this.dropBus();
    this.mb = this.makeBus(c, this.tr);
    this.nextT = c.currentTime + 0.2; this.step = 0; this.beats.length = 0;
    this.seed = 1 + Math.floor(Math.random() * 1e6);
  }
  private makeBus(c: BaseAudioContext, tr: Track): MusicBus {
    const g = () => c.createGain();
    const all = g(), duck = g(), soft = g(), drums = g();
    all.connect(this.musDuck); duck.connect(all); soft.connect(all); drums.connect(all);
    // arpeggio and lead also feed a dotted-eighth echo
    const dly = c.createDelay(1.5), fb = g(), tone = c.createBiquadFilter(), into = g();
    dly.delayTime.value = (15 / tr.bpm) * 3; fb.gain.value = 0.36; into.gain.value = 0.3;
    tone.type = 'lowpass'; tone.frequency.value = 2600;
    soft.connect(into).connect(dly).connect(tone).connect(fb).connect(dly);
    tone.connect(all);
    return { all, duck, soft, drums };
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
    this.scheduleUntil(c.currentTime + (document.hidden ? 1.6 : 0.4), undefined, moveOn ? SONG_STEPS : Infinity);
  }
  /**
   * Render the score plus recorded cues to a buffer (used for the trailer soundtrack and the sound checks).
   * The work is scheduled two seconds at a time while the render is held, so a long render stays fast.
   */
  async renderOffline(seconds: number, cues: Cue[], hot: [number, number][], opts: { track?: string; music?: number; fade?: boolean; bar?: number } = {}): Promise<AudioBuffer> {
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
    this.nextT = 0.4; this.step = Math.max(0, Math.floor(opts.bar || 0)) * 16; this.seed = 7;
    const hotAt = (t: number) => hot.some(([a, b]) => t >= a && t < b);
    const list = cues.filter((q) => q && typeof q.name === 'string' && q.t >= 0 && q.t <= seconds - 0.5).sort((a, b) => a.t - b.t);
    let qi = 0;
    const fill = (until: number) => {
      this.scheduleUntil(Math.min(seconds - 2, until), hotAt);
      for (; qi < list.length && list[qi].t < until; qi++) { const q = list[qi]; this.offset = Math.max(0, q.t - c.currentTime); this.emit(q.name, q.g, q.pan); }
      this.offset = 0;
    };
    const CHUNK = 2;
    fill(CHUNK + 0.5);
    for (let t = CHUNK; t < seconds; t += CHUNK) void c.suspend(t).then(() => { fill(t + CHUNK + 0.5); void c.resume(); });
    return c.startRendering();
  }
  private scheduleUntil(limit: number, hotAt?: (t: number) => boolean, lastStep = Infinity) {
    const spb = 15 / this.tr.bpm; // one sixteenth
    while (this.nextT < limit && this.step < lastStep) {
      this.scoreStep(this.step, this.nextT, hotAt ? hotAt(this.nextT) : this.intense > 0.5, !hotAt);
      this.nextT += spb; this.step++;
    }
  }
  /** a small seeded generator, so a track's fills do not depend on what else used Math.random */
  private rnd(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0; return (this.seed >>> 0) / 4294967296; }

  /** Schedule everything that starts on sixteenth `n` of the track, at audio time `t`. */
  private scoreStep(n: number, t: number, hot: boolean, live: boolean) {
    const tr = this.tr, B = this.mb!, c = this.ctx!;
    const s = n % 16, bar = Math.floor(n / 16), spb = 15 / tr.bpm, barLen = spb * 16;
    // where in the arrangement this bar is
    let sec: 'intro' | 'A' | 'B' | 'break' | 'C' = 'intro', sb = bar, secLen = 4, cyc = 0;
    if (bar >= 4) {
      const k = (bar - 4) % CYCLE;
      cyc = Math.floor((bar - 4) / CYCLE);
      if (k < 8) { sec = 'A'; sb = k; secLen = 8; } else if (k < 16) { sec = 'B'; sb = k - 8; secLen = 8; } else if (k < 20) { sec = 'break'; sb = k - 16; secLen = 4; } else { sec = 'C'; sb = k - 20; secLen = 8; }
    }
    const full = hot || sec === 'A' || sec === 'B' || sec === 'C';
    const lastBar = sb === secLen - 1;
    const ch = tr.chords[bar % tr.chords.length];
    const padBase = tr.root + (tr.root < 38 ? 24 : 12);
    this.cur = null; this.base = t;
    const T = (o: Tone) => this.tone(o), N = (o: Noise) => this.noise(o);
    if (live && s % 4 === 0) { this.beats.push({ t, a: s === 0 ? 1 : full ? 0.75 : 0.5 }); if (this.beats.length > 32) this.beats.shift(); }

    // --- drums ---
    let kick = false;
    if (full) {
      kick = tr.kick[s] === 'x' || (hot && s === 14 && bar % 2 === 1);
      if (tr.snare[s] === 'x') this.snare(t, B.drums, 1);
      else if (hot && s === 15 && bar % 2 === 0) this.snare(t, B.drums, 0.35);
      const h = tr.hat[s];
      if (h === 'o') N({ dur: 0.22, vol: 0.045, freq: 7800, type: 'highpass', out: B.drums });
      else if (h === 'x') N({ dur: 0.04, vol: 0.05, freq: 8200, type: 'highpass', out: B.drums });
      else if (hot) N({ dur: 0.03, vol: 0.03, freq: 9000, type: 'highpass', out: B.drums });
      // a tom fill into the next section
      if (lastBar && s >= 12 && sec !== 'A') T({ f: [190, 150, 120, 95][s - 12], to: [190, 150, 120, 95][s - 12] * 0.55, dur: 0.22, vol: 0.12, out: B.drums });
    } else if (sec === 'intro') {
      if (sb >= 2 && s % 4 === 2) N({ dur: 0.04, vol: 0.04, freq: 8200, type: 'highpass', out: B.drums });
      if (sb === 3) { kick = s === 0 || s === 8; if (s >= 12) this.snare(t, B.drums, 0.3 + (s - 12) * 0.2); }
    } else {
      // breakdown: one kick a bar, hats on the off beat, a snare roll at the end
      kick = s === 0;
      if (s % 4 === 2) N({ dur: 0.04, vol: 0.04, freq: 8200, type: 'highpass', out: B.drums });
      if (lastBar && s >= 8) this.snare(t, B.drums, 0.2 + (s - 8) * 0.1);
    }
    if (kick) {
      T({ f: 165, to: 47, glide: 0.09, dur: 0.32, vol: 0.36, att: 0.003, out: B.drums });
      N({ dur: 0.014, vol: 0.07, freq: 3500, q: 0.8, out: B.drums });
    }
    // the kick pushes pad and bass down for a moment (and in the breakdown the pad keeps pumping without it)
    if (kick || (!full && s % 4 === 0 && sec === 'break')) {
      const depth = kick ? 0.3 : 0.6;
      B.duck.gain.setTargetAtTime(depth, t, 0.006); B.duck.gain.setTargetAtTime(1, t + 0.07, spb * 0.9);
      B.soft.gain.setTargetAtTime(0.55 + depth * 0.5, t, 0.006); B.soft.gain.setTargetAtTime(1, t + 0.07, spb * 0.9);
    }
    if (s === 0 && sb === 0 && sec !== 'intro') N({ dur: 1.7, vol: 0.06, freq: 5200, type: 'highpass', out: B.drums }); // crash
    if (s === 0 && lastBar) N({ dur: barLen, vol: 0.045, freq: 700, to: 6000, q: 0.9, att: barLen * 0.88, flat: true, out: B.drums }); // riser

    // --- pad: one chord a bar, two detuned saws a note, one filter for all of them ---
    if (s === 0) {
      const top = hot ? 1700 : sec === 'intro' ? 480 + sb * 160 : sec === 'break' ? 760 : 1050;
      const f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'lowpass'; f.Q.value = 0.7;
      f.frequency.value = top * 0.6; f.frequency.setValueAtTime(top * 0.6, t); f.frequency.linearRampToValueAtTime(top, t + barLen * 0.5); f.frequency.linearRampToValueAtTime(top * 0.7, t + barLen * 1.05);
      const end = this.env(g.gain, t, 0.03, barLen * 0.16, barLen * 1.08, true, barLen * 0.22);
      f.connect(g).connect(B.duck);
      for (const note of ch) for (const det of [-8, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = hz(padBase + note); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(end + 0.02);
      }
    }

    // --- bass ---
    let bn = ((ch[0] % 12) + 12) % 12;
    if (tr.root + bn > 45) bn -= 12;
    const bm = tr.root + bn;
    if (full) {
      const k = tr.bass[s];
      if (k !== '.') {
        let len = 1;
        while (len < 4 && s + len < 16 && tr.bass[s + len] === '.') len++;
        const m = bm + (k === 'o' ? 12 : k === 'f' ? 7 : k === 's' ? 10 : 0) + (sec === 'C' && k === 'r' && s % 8 === 6 ? 12 : 0);
        const dur = len * spb * 0.9;
        T({ f: hz(m), dur, vol: 0.12, type: 'sawtooth', lp: hot ? 1500 : 1000, lpTo: 190, q: 4, att: 0.005, flat: true, rel: 0.04, out: B.duck });
        T({ f: hz(m), dur, vol: 0.11, att: 0.006, flat: true, rel: 0.04, out: B.duck });
      } else if (hot) T({ f: hz(bm + 12), dur: spb * 0.7, vol: 0.12, type: 'square', lp: 1100, lpTo: 300, q: 2, flat: true, rel: 0.04, out: B.duck });
    } else if (s === 0 && (sec === 'break' || sb >= 2)) {
      T({ f: hz(bm), dur: barLen * 0.95, vol: 0.1, att: 0.08, flat: true, rel: 0.3, out: B.duck });
    }

    // --- arpeggio: chord notes over two octaves; every other cycle it runs backwards ---
    if (sec !== 'intro' || sb >= 1 || hot) {
      const ai = tr.arp[cyc % 2 ? 15 - s : s];
      if (ai >= 0) {
        const m = padBase + 12 + ch[ai % ch.length] + 12 * Math.floor(ai / ch.length);
        const open = sec === 'intro' ? 0.4 + sb * 0.15 : sec === 'break' ? 1.15 : 1;
        T({ f: hz(m), dur: spb * (tr.arp[(s + 1) % 16] < 0 ? 1.8 : 0.95), vol: (sec === 'B' || sec === 'C' ? 0.075 : 0.1) * (sec === 'intro' ? 0.7 : 1) * (tr.wave === 'square' ? 0.8 : 1), type: tr.wave, lp: 2600 * open, lpTo: 800 * open, q: 2.2, att: 0.005, flat: true, rel: 0.05, out: B.soft });
        if (hot && s % 2 === 1) T({ f: hz(m + 12), dur: spb * 0.8, vol: 0.05, type: 'square', lp: 3600, lpTo: 1200, q: 3, flat: true, rel: 0.04, out: B.soft });
      }
    }
    // the tense layer: a nervous pedal note on the eighths, root and fifth in turn
    if (hot && s % 2 === 0) T({ f: hz(padBase + 12 + (s % 4 ? 7 : 0)), dur: spb * 0.7, vol: 0.12, type: 'sawtooth', lp: 2200, lpTo: 700, q: 6, att: 0.004, flat: true, rel: 0.04, out: B.soft });

    // --- lead ---
    if (sec === 'B' || sec === 'C') {
      const first = (sec === 'B') === (cyc % 2 === 0) ? tr.leadA : tr.leadB, second = first === tr.leadA ? tr.leadB : tr.leadA;
      const line = (sb < 4 ? first : second)[sb % 4], k = line[s];
      if (k !== '.' && k !== '-') {
        const deg = parseInt(k, 36);
        let len = 1;
        while (s + len < 16 && line[s + len] === '-') len++;
        const m = padBase + 12 + MINOR[deg % 7] + 12 * Math.floor(deg / 7);
        // now and then a note is left out, so two passes of the phrase are not identical
        if (this.rnd() > 0.06) T({ f: hz(m), dur: len * spb * 0.96, vol: 0.17, type: 'sawtooth', lp: 3200, lpTo: 1700, q: 1.6, att: 0.014, flat: true, rel: 0.07, uni: 9, out: B.soft });
      }
    }
  }
  /** Gated snare: a body knock, a crack, and a noise tail that is held and then shut instead of ringing out. */
  private snare(t: number, out: AudioNode, vol: number) {
    const c = this.ctx!;
    this.base = t;
    this.tone({ f: 225, to: 165, dur: 0.09, vol: 0.12 * vol, type: 'triangle', out });
    this.noise({ dur: 0.035, vol: 0.08 * vol, freq: 5200, type: 'highpass', out });
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = 'bandpass'; f.frequency.value = 2100; f.Q.value = 0.5;
    const p = g.gain, v = 0.17 * vol;
    p.value = 0; p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + 0.003); p.exponentialRampToValueAtTime(v * 0.42, t + 0.17); p.linearRampToValueAtTime(0, t + 0.2);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + 0.22);
  }
}
