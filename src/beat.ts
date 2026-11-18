// Beat timing for music the game does not make itself.
// - Phase maths: where in the beat a moment falls, given a BPM and the moment the track started.
// - TempoTracker: tempo and phase from an onset-strength envelope (spectral flux, autocorrelation
//   over 60..200 BPM with a soft preference for 120, a half/double-time guard and phase by comb matching).
// - BeatListener: the opt-in "Listen for the beat" mode that feeds the tracker from captured tab audio
//   (or the microphone). It is only ever started by the player pressing a button.
// Everything except BeatListener runs in Node too (tools/music-test.ts).

/** Fraction of the current beat at `now` (0 = on the beat), or null when there is no clock. All times in ms. */
export function beatPhase(now: number, originMs: number, bpm: number | null): number | null {
  if (!bpm || !isFinite(bpm) || bpm <= 0 || !isFinite(originMs)) return null;
  const spb = 60000 / bpm;
  const t = (now - originMs) / spb;
  return t - Math.floor(t);
}
/** Track start on the performance clock from a reported playback position. */
export function trackStart(positionMs: number, reportedAt: number): number { return reportedAt - Math.max(0, positionMs || 0); }
/** The beat offset inside the track that a tap at `tapAt` sets (0 .. one beat). */
export function tapOffset(tapAt: number, start: number, bpm: number): number {
  const spb = 60000 / bpm;
  const o = (tapAt - start) % spb;
  return o < 0 ? o + spb : o;
}

/** Half-wave rectified spectral flux between two log-magnitude spectra. */
export function spectralFlux(prev: Float32Array | null, cur: Float32Array, bins = cur.length): number {
  if (!prev) return 0;
  let s = 0;
  for (let i = 1; i < bins; i++) { const d = cur[i] - prev[i]; if (d > 0) s += d; }
  return s;
}

/** In-place radix-2 FFT magnitude of a real frame (length a power of two), log-compressed like log(1 + 100 |X|). */
export function logSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)); // Hann window
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = Math.log(1 + 100 * Math.hypot(re[i], im[i]) / n);
  return out;
}

export interface TempoEstimate { bpm: number; conf: number; /** frames since the last beat */ lastBeat: number }

export class TempoTracker {
  readonly fps: number;
  private buf: Float32Array;
  private count = 0;
  constructor(fps = 100, windowSec = 8) { this.fps = fps; this.buf = new Float32Array(Math.round(fps * windowSec)); }
  push(v: number): void { this.buf[this.count % this.buf.length] = isFinite(v) && v > 0 ? v : 0; this.count++; }
  reset(): void { this.count = 0; this.buf.fill(0); }
  frames(): number { return Math.min(this.count, this.buf.length); }

  estimate(): TempoEstimate | null {
    const N = this.frames(), fps = this.fps;
    if (N < fps * 3) return null;
    const x = new Float32Array(N);
    const start = this.count - N;
    for (let i = 0; i < N; i++) x[i] = this.buf[(start + i) % this.buf.length];
    // subtract a moving mean (half a second) and keep what rises above it
    const w = Math.max(1, Math.round(fps * 0.25)), y = new Float32Array(N);
    let acc = 0;
    const pre = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) { acc += x[i]; pre[i + 1] = acc; }
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - w), b = Math.min(N, i + w + 1);
      const d = x[i] - (pre[b] - pre[a]) / (b - a);
      y[i] = d > 0 ? d : 0;
    }
    const maxLag = Math.min(Math.floor(N / 2), Math.ceil((60 * fps) / 60) * 2 + 2);
    const ac = new Float64Array(maxLag + 1);
    for (let L = 0; L <= maxLag; L++) { let s = 0; for (let i = 0; i + L < N; i++) s += y[i] * y[i + L]; ac[L] = s / (N - L); }
    if (ac[0] <= 1e-12) return null;
    const at = (l: number): number => { const i = Math.floor(l), f = l - i; return i + 1 > maxLag ? 0 : ac[i] * (1 - f) + ac[i + 1] * f; };
    // correlation summed over a frame either side: peaks are narrow and a fractional period splits between two lags
    const peak = (l: number): number => { const c = Math.round(l); let m = 0; for (let i = c - 1; i <= c + 1; i++) if (i >= 0 && i <= maxLag) m += ac[i]; return m; };
    const lo = Math.floor((60 * fps) / 200), hi = Math.ceil((60 * fps) / 60);
    const score = new Float64Array(hi + 2);
    let best = -1, bestS = -Infinity, mean = 0;
    for (let L = lo; L <= hi; L++) {
      const bpm = (60 * fps) / L, oct = Math.log2(bpm / 120);
      const s = (peak(L) + 0.5 * peak(2 * L)) * Math.exp(-0.5 * oct * oct);
      score[L] = s; mean += peak(L);
      if (s > bestS) { bestS = s; best = L; }
    }
    mean /= hi - lo + 1;
    if (best < 0) return null;
    let lag = best;
    if (best > lo && best < hi) {
      const a = score[best - 1], b = score[best], c = score[best + 1], den = a - 2 * b + c;
      if (den < 0) lag = best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    }
    // half/double time: when the half lag correlates nearly as well, the pulse is really the faster one
    if ((60 * fps) / (lag / 2) <= 200 && peak(lag / 2) >= 0.5 * peak(lag)) lag /= 2;
    let bpm = (60 * fps) / lag;
    while (bpm > 180) { bpm /= 2; lag *= 2; }
    while (bpm < 70) { bpm *= 2; lag /= 2; }
    const conf = Math.max(0, Math.min(1, (peak(lag) - mean) / (peak(0) - mean)));
    // phase: the offset whose comb of beats collects the most onset strength, recent beats weighted more
    const P = lag, steps = Math.max(1, Math.round(P));
    let bestPh = 0, bestPs = -1;
    for (let ph = 0; ph < steps; ph++) {
      let s = 0;
      for (let k = 0; ; k++) {
        const idx = Math.round(N - 1 - ph - k * P);
        if (idx < 1) break;
        s += (y[idx] + 0.5 * (y[idx - 1] + (idx + 1 < N ? y[idx + 1] : 0))) * Math.pow(0.92, k);
      }
      if (s > bestPs) { bestPs = s; bestPh = ph; }
    }
    return { bpm: Math.round(bpm * 10) / 10, conf: Math.round(conf * 100) / 100, lastBeat: bestPh };
  }
}

/** Onset envelope of a mono signal at 100 frames a second (offline; used by the tests). */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, fps = 100, size = 1024): number[] {
  const hop = sampleRate / fps, out: number[] = [];
  let prev: Float32Array | null = null;
  const frame = new Float32Array(size);
  for (let pos = 0; pos + size <= samples.length; pos += hop) {
    const p = Math.floor(pos);
    for (let i = 0; i < size; i++) frame[i] = samples[p + i];
    const spec = logSpectrum(frame);
    out.push(spectralFlux(prev, spec));
    prev = spec;
  }
  return out;
}

/** A tempo that holds: a new estimate replaces the old one only after it agreed with itself for `holdMs`. */
export class TempoHold {
  bpm: number | null = null;
  private cand: number | null = null;
  private since = 0;
  private holdMs: number;
  constructor(holdMs = 3000) { this.holdMs = holdMs; }
  feed(bpm: number, now: number): number | null {
    const near = (a: number, b: number): boolean => Math.abs(a - b) / b < 0.04;
    if (this.bpm === null) { this.bpm = bpm; this.cand = null; return this.bpm; }
    if (near(bpm, this.bpm)) { this.bpm = this.bpm * 0.8 + bpm * 0.2; this.cand = null; return this.bpm; }
    if (this.cand === null || !near(bpm, this.cand)) { this.cand = bpm; this.since = now; }
    else if (now - this.since >= this.holdMs) { this.bpm = bpm; this.cand = null; }
    return this.bpm;
  }
  reset(): void { this.bpm = null; this.cand = null; }
}

export type ListenState = { on: boolean; bpm: number | null; conf: number; origin: number; source: 'tab' | 'mic' | '' };

/**
 * "Listen for the beat": tab audio (Chromium desktop, the player ticks "share tab audio") or the microphone.
 * The analyser is never connected to the speakers, so nothing plays twice.
 */
export class BeatListener {
  state: ListenState = { on: false, bpm: null, conf: 0, origin: 0, source: '' };
  onChange: (s: ListenState) => void = () => {};
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private timer = 0;
  private tracker = new TempoTracker(100, 8);
  private hold = new TempoHold(3000);
  private gen = 0; // bumped by every start and stop: a prompt answered after Stop (or a second start) must not leave a stream open

  static canTab(): boolean { return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'; }
  static canMic(): boolean { return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'; }

  async start(kind: 'tab' | 'mic'): Promise<string | null> {
    this.stop();
    const gen = ++this.gen;
    let stream: MediaStream;
    try {
      if (kind === 'tab') {
        const opts = { audio: true, video: { frameRate: 1 }, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include' } as DisplayMediaStreamOptions;
        stream = await navigator.mediaDevices.getDisplayMedia(opts);
        for (const v of stream.getVideoTracks()) v.stop(); // only the sound is wanted
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      }
    } catch { return 'Listening was cancelled or is not allowed.'; }
    if (gen !== this.gen) { for (const t of stream.getTracks()) t.stop(); return 'Listening was cancelled.'; }
    if (!stream.getAudioTracks().length) { for (const t of stream.getTracks()) t.stop(); return 'No sound was shared. Tick "Share tab audio" and try again.'; }
    this.stream = stream;
    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {}); // the permission prompt may have used up the click
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024; an.smoothingTimeConstant = 0;
    src.connect(an);
    const db = new Float32Array(an.frequencyBinCount);
    let prev: Float32Array | null = null;
    const bins = Math.min(db.length, Math.ceil((8000 / (ctx.sampleRate / 2)) * db.length)); // up to 8 kHz
    const t0 = performance.now();
    let frames = 0, lastEst = 0;
    this.tracker.reset(); this.hold.reset();
    this.state = { on: true, bpm: null, conf: 0, origin: 0, source: kind };
    for (const t of stream.getAudioTracks()) t.addEventListener('ended', () => this.stop());
    this.timer = window.setInterval(() => {
      const now = performance.now();
      const due = Math.floor((now - t0) / 10);
      if (due <= frames) return;
      an.getFloatFrequencyData(db);
      const cur = new Float32Array(bins);
      for (let i = 0; i < bins; i++) cur[i] = Math.log(1 + 100 * Math.pow(10, (isFinite(db[i]) ? db[i] : -160) / 20));
      // frames missed by a late timer get no onset; the current one gets the flux
      while (frames < due - 1) { this.tracker.push(0); frames++; }
      this.tracker.push(spectralFlux(prev, cur, bins)); frames++;
      prev = cur;
      if (now - lastEst < 500) return;
      lastEst = now;
      const e = this.tracker.estimate();
      if (!e) return;
      const bpm = this.hold.feed(e.bpm, now);
      if (!bpm) return;
      const spb = 60000 / bpm, fresh = now - e.lastBeat * 10;
      // phase: follow the measured beat softly, jump when far off
      let origin = this.state.origin || fresh;
      let d = ((fresh - origin) % spb + spb) % spb;
      if (d > spb / 2) d -= spb;
      origin += Math.abs(d) > spb * 0.25 ? d : d * 0.3;
      this.state = { on: true, bpm: Math.round(bpm * 10) / 10, conf: e.conf, origin, source: kind };
      this.onChange(this.state);
    }, 5);
    this.onChange(this.state);
    return null;
  }
  stop(): void {
    this.gen++;
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    if (this.ctx) { void this.ctx.close().catch(() => {}); this.ctx = null; }
    const was = this.state.on;
    this.state = { on: false, bpm: null, conf: 0, origin: 0, source: '' };
    if (was) this.onChange(this.state);
  }
}
