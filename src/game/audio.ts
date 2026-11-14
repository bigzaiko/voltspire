// Synthesised audio - no asset files. Cinematic direction: deep impacts, filtered pads,
// horn-like swells and a dark hybrid score. Everything runs through a generated reverb.
interface V { f: number; to?: number; dur: number; type?: OscillatorType; vol: number; when?: number; att?: number; lp?: number; lpTo?: number; det?: number; out?: AudioNode }
interface N { dur: number; vol: number; freq: number; to?: number; q?: number; when?: number; type?: BiquadFilterType; att?: number; out?: AudioNode }

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfxG!: GainNode; private musG!: GainNode; private uiG!: GainNode;
  private last: Record<string, number> = {};
  private noiseBuf!: AudioBuffer;
  private timer = 0; private step = 0; private nextT = 0;
  volume = 0.7; musicVol = 0.5; intense = 0; playing = false;
  /** Trailer capture: when set, play() only records cue names against `clock`. */
  cueLog: { t: number; name: string }[] | null = null;
  clock = 0;
  private offset = 0;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.build((this.ctx = new AC()));
  }
  private build(c: BaseAudioContext) {
    this.master = c.createGain(); this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master.connect(comp).connect(c.destination);
    // generated hall reverb
    const len = Math.floor(c.sampleRate * 3.2), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.42 * t); d[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1); }
    }
    const rev = c.createConvolver(); rev.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.9;
    rev.connect(wet).connect(this.master);
    const bus = (dry: number, send: number) => { const g = c.createGain(); g.gain.value = dry; g.connect(this.master); const s = c.createGain(); s.gain.value = send; g.connect(s).connect(rev); return g; };
    this.sfxG = bus(0.9, 0.28);
    this.uiG = bus(0.8, 0.12);
    this.musG = bus(this.musicVol * 0.55, 0.5);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }
  setMusic(v: number) { this.musicVol = v; if (this.ctx) this.musG.gain.value = v * 0.55; }

  private v(o: V) {
    const c = this.ctx!, t = c.currentTime + this.offset + (o.when || 0), att = o.att ?? 0.006;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t);
    if (o.det) osc.detune.value = o.det;
    if (o.to && o.to !== o.f) osc.frequency.exponentialRampToValueAtTime(Math.max(18, o.to), t + o.dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node: AudioNode = osc;
    if (o.lp) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, t + o.dur);
      osc.connect(f); node = f;
    }
    node.connect(g).connect(o.out || this.sfxG);
    osc.start(t); osc.stop(t + o.dur + 0.03);
  }
  private n(o: N) {
    const c = this.ctx!, t = c.currentTime + this.offset + (o.when || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 1; f.frequency.setValueAtTime(o.freq, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const g = c.createGain();
    if (o.att) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol, t + o.att); } else g.gain.setValueAtTime(o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f).connect(g).connect(o.out || this.sfxG);
    s.start(t, Math.random()); s.stop(t + o.dur + 0.03);
  }
  /** Low body hit: pitched-down sine plus a dull noise layer. */
  private thump(f: number, dur: number, vol: number, when = 0, out?: AudioNode) {
    this.v({ f, to: f * 0.38, dur, vol, when, out });
    this.n({ dur: dur * 0.7, vol: vol * 0.5, freq: f * 4, to: f * 1.5, type: 'lowpass', when, out });
  }
  /** Brass-like swell on several notes. */
  private horn(freqs: number[], dur: number, vol: number, lp = 520, when = 0, out?: AudioNode) {
    for (const f of freqs) for (const det of [-7, 6]) this.v({ f, dur, type: 'sawtooth', vol: vol / freqs.length, att: dur * 0.22, lp, lpTo: lp * 0.55, det, when, out });
  }

  play(name: string) {
    const log = this.cueLog;
    if (!log && (!this.ctx || this.ctx.state !== 'running')) return;
    const now = log ? this.clock * 1000 : performance.now(), gap = name === 'shot' || name === 'hit' ? 85 : name === 'die' || name === 'arrow' ? 50 : 35;
    if (now - (this.last[name] || 0) < gap && now >= (this.last[name] || 0)) return;
    this.last[name] = now;
    if (log) { log.push({ t: this.clock, name }); return; }
    this.emit(name);
  }
  private emit(name: string) {
    const r = 0.92 + Math.random() * 0.16, ui = this.uiG;
    switch (name) {
      case 'shot': this.n({ dur: 0.06, vol: 0.09, freq: 1700 * r, q: 1.4 }); this.v({ f: 210 * r, to: 95, dur: 0.07, vol: 0.09 }); break;
      case 'arcshot': this.n({ dur: 0.16, vol: 0.1, freq: 4200, to: 1500, q: 2, type: 'highpass' }); this.n({ dur: 0.05, vol: 0.12, freq: 2600, when: 0.05 }); this.v({ f: 92, dur: 0.2, vol: 0.08, type: 'sawtooth', lp: 300 }); break;
      case 'mortar': this.thump(85, 0.4, 0.4); this.n({ dur: 0.25, vol: 0.1, freq: 900, to: 200, type: 'lowpass' }); break;
      case 'rail': this.n({ dur: 0.28, vol: 0.16, freq: 6000, to: 900, q: 0.8 }); this.v({ f: 58, to: 30, dur: 0.45, vol: 0.3, type: 'sawtooth', lp: 380 }); this.v({ f: 1300, to: 180, dur: 0.16, vol: 0.05 }); break;
      case 'cryo': this.n({ dur: 0.35, vol: 0.07, freq: 5200, to: 2400, q: 1.6, att: 0.03 }); this.v({ f: 520, to: 260, dur: 0.3, vol: 0.035 }); break;
      case 'boom': this.thump(72, 0.7, 0.55); this.n({ dur: 0.8, vol: 0.2, freq: 600, to: 90, type: 'lowpass' }); break;
      case 'die': this.n({ dur: 0.11, vol: 0.1, freq: 900 * r, q: 0.9 }); this.v({ f: 300 * r, to: 80, dur: 0.16, vol: 0.07, type: 'triangle' }); this.v({ f: 120, to: 48, dur: 0.14, vol: 0.12 }); break;
      case 'bossdie': this.thump(60, 2.2, 0.7); this.v({ f: 44, to: 26, dur: 2.6, vol: 0.4, type: 'sawtooth', lp: 260 }); this.n({ dur: 2.4, vol: 0.3, freq: 1400, to: 70, type: 'lowpass' }); this.thump(90, 0.6, 0.4, 0.35); break;
      case 'arrow': this.n({ dur: 0.07, vol: 0.12, freq: 2400 * r, type: 'highpass' }); this.v({ f: 170 * r, to: 85, dur: 0.09, vol: 0.16 }); this.n({ dur: 0.22, vol: 0.05, freq: 1500, to: 600, q: 1.2, att: 0.03 }); break;
      case 'bigshot': this.thump(110, 0.9, 0.6); this.n({ dur: 0.7, vol: 0.22, freq: 5000, to: 300, type: 'lowpass' }); this.v({ f: 55, to: 28, dur: 1.1, vol: 0.35, type: 'sawtooth', lp: 420 }); break;
      case 'rain': for (let i = 0; i < 7; i++) this.n({ dur: 0.3, vol: 0.07, freq: 3200 - i * 220, to: 700, q: 1.5, att: 0.04, when: i * 0.07 }); this.thump(70, 0.5, 0.2, 0.25); break;
      case 'sing': this.v({ f: 36, to: 95, dur: 1.5, vol: 0.32, type: 'sawtooth', lp: 240, att: 0.5 }); this.n({ dur: 1.5, vol: 0.14, freq: 200, to: 2600, q: 1.2, att: 0.9 }); break;
      case 'heroOn': this.n({ dur: 0.7, vol: 0.2, freq: 300, to: 5000, q: 0.9, att: 0.55 }); this.thump(66, 1.3, 0.7, 0.6); this.horn([73.4, 110, 146.8], 2.2, 0.38, 700, 0.6); this.n({ dur: 1.4, vol: 0.14, freq: 4000, to: 200, type: 'lowpass', when: 0.6 }); break;
      case 'heroOff': this.v({ f: 260, to: 55, dur: 0.8, vol: 0.18, type: 'sawtooth', lp: 500, lpTo: 120 }); this.n({ dur: 0.6, vol: 0.08, freq: 2400, to: 200, type: 'lowpass' }); break;
      case 'tele': this.n({ dur: 0.3, vol: 0.14, freq: 500, to: 3800, q: 1.3, att: 0.18 }); this.thump(95, 0.35, 0.3, 0.2); this.v({ f: 420, to: 1100, dur: 0.22, vol: 0.04 }); break;
      case 'ready': this.horn([146.8, 220], 0.9, 0.24, 800); this.horn([174.6, 261.6], 1.3, 0.26, 900, 0.32); this.thump(60, 0.6, 0.25); break;
      case 'build': this.thump(120, 0.16, 0.3); this.n({ dur: 0.05, vol: 0.09, freq: 2600, q: 2 }); this.v({ f: 180, to: 320, dur: 0.22, vol: 0.05, type: 'triangle', when: 0.05 }); this.n({ dur: 0.06, vol: 0.07, freq: 3400, q: 2, when: 0.24 }); break;
      case 'sell': this.n({ dur: 0.06, vol: 0.08, freq: 2800, q: 2 }); this.thump(100, 0.14, 0.2, 0.04); this.v({ f: 330, dur: 0.35, vol: 0.04, type: 'triangle', when: 0.06 }); break;
      case 'error': this.v({ f: 105, to: 80, dur: 0.12, vol: 0.2, out: ui }); this.v({ f: 92, to: 70, dur: 0.14, vol: 0.2, when: 0.11, out: ui }); break;
      case 'click': this.n({ dur: 0.025, vol: 0.07, freq: 3200, q: 1.5, out: ui }); this.v({ f: 140, to: 90, dur: 0.05, vol: 0.09, out: ui }); break;
      case 'hover': this.n({ dur: 0.018, vol: 0.03, freq: 4200, q: 2, out: ui }); break;
      case 'levelup': this.horn([146.8, 174.6, 220, 293.7], 1.6, 0.34, 950); this.thump(62, 0.8, 0.3); this.v({ f: 1174.7, dur: 1.4, vol: 0.02, att: 0.4 }); break;
      case 'card': this.thump(80, 0.45, 0.35, 0, ui); this.v({ f: 587.3, dur: 0.9, vol: 0.035, att: 0.02, out: ui }); this.v({ f: 880, dur: 1.1, vol: 0.02, att: 0.08, out: ui }); break;
      case 'wave': this.horn([73.4, 110], 1.7, 0.36, 520); this.thump(58, 0.9, 0.4); break;
      case 'boss': this.horn([55, 58.3, 82.4], 2.8, 0.5, 400); this.thump(48, 1.6, 0.6); this.thump(48, 1.2, 0.45, 0.7); break;
      case 'leak': this.thump(90, 0.5, 0.45); this.v({ f: 98, to: 78, dur: 0.6, vol: 0.2, type: 'sawtooth', lp: 320 }); break;
      case 'clear': this.horn([146.8, 220, 293.7], 1.4, 0.22, 800); this.v({ f: 880, dur: 1.2, vol: 0.018, att: 0.3 }); break;
      case 'win': this.thump(60, 1.4, 0.6); this.horn([73.4, 146.8, 220, 293.7, 370, 440], 4.2, 0.6, 1300); this.v({ f: 1174.7, dur: 3.5, vol: 0.025, att: 1 }); break;
      case 'lose': this.thump(52, 2, 0.7); this.v({ f: 110, to: 49, dur: 3.6, vol: 0.34, type: 'sawtooth', lp: 320, lpTo: 90 }); this.v({ f: 116.5, to: 52, dur: 3.6, vol: 0.26, type: 'sawtooth', lp: 320, lpTo: 90 }); break;
      case 'shield': this.v({ f: 1400, to: 620, dur: 0.25, vol: 0.05 }); this.n({ dur: 0.2, vol: 0.06, freq: 5200, type: 'highpass' }); break;
    }
  }

  // ---------- score ----------
  startMusic() {
    if (!this.ctx || this.playing) return;
    this.playing = true; this.nextT = this.ctx.currentTime + 0.15; this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 90);
  }
  stopMusic() { this.playing = false; clearInterval(this.timer); }
  private schedule() {
    const c = this.ctx!;
    if (c.state !== 'running') return;
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.05;
    this.scheduleUntil(c.currentTime + 0.3);
  }
  /** Render the score plus recorded cues to a buffer (used for the trailer soundtrack). */
  async renderOffline(seconds: number, cues: { t: number; name: string }[], hot: [number, number][]): Promise<AudioBuffer> {
    const c = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
    this.ctx = c as unknown as AudioContext;
    this.build(c);
    this.musG.gain.value = 0.42;
    this.master.gain.setValueAtTime(0.0001, 0); this.master.gain.exponentialRampToValueAtTime(0.9, 1.2);
    this.master.gain.setValueAtTime(0.9, seconds - 3); this.master.gain.exponentialRampToValueAtTime(0.0001, seconds - 0.05);
    this.nextT = 0.4; this.step = 0;
    this.scheduleUntil(seconds - 2, (t) => hot.some(([a, b]) => t >= a && t < b));
    for (const q of cues) { if (q.t < 0 || q.t > seconds - 0.5) continue; this.offset = q.t; this.emit(q.name); }
    this.offset = 0;
    return c.startRendering();
  }
  private scheduleUntil(limit: number, hotAt?: (t: number) => boolean) {
    const c = this.ctx!;
    let hot = this.intense > 0.5;
    let spb = 60 / (hot ? 104 : 84) / 4; // sixteenth
    const roots = [38, 34, 31, 33]; // D, Bb, G, A
    const third = [3, 4, 3, 4];
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    const M = this.musG;
    while (this.nextT < limit) {
      if (hotAt) hot = hotAt(this.nextT);
      spb = 60 / (hot ? 104 : 84) / 4;
      const s = this.step % 16, barN = Math.floor(this.step / 16), bar = barN % 4, w = this.nextT - c.currentTime;
      const root = roots[bar], bl = spb * 16;
      if (s === 0) {
        // pad: root, fifth, third an octave up - slow filtered saws
        for (const [n, vol] of [[0, 0.1], [7, 0.07], [12 + third[bar], 0.05], [12, 0.05]] as const)
          for (const det of [-9, 8]) this.v({ f: hz(root + n), dur: bl * 1.08, type: 'sawtooth', vol, att: bl * 0.3, lp: hot ? 900 : 520, lpTo: hot ? 500 : 300, det, when: w, out: M });
        this.v({ f: hz(root - 12), dur: bl, vol: 0.2, att: 0.4, when: w, out: M });
        // sparse high motif every other bar
        if (barN % 2 === 0) [14, 12, 7].forEach((n, i) => this.v({ f: hz(root + 24 + (i === 0 && bar % 2 ? 15 : n)), dur: spb * 6, type: 'triangle', vol: 0.03, att: 0.05, when: w + i * spb * 4, out: M }));
      }
      // heartbeat bass
      if (s % 4 === 0 || (hot && s % 2 === 0)) this.v({ f: hz(root), dur: spb * 1.7, type: 'sawtooth', vol: hot ? 0.13 : 0.09, lp: hot ? 420 : 240, lpTo: 110, when: w, out: M });
      // war drums
      if (s === 0 || s === 10 || (hot && (s === 6 || s === 12 || s === 14))) this.thump(s === 0 ? 62 : 78, 0.5, s === 0 ? 0.42 : 0.26, w, M);
      if (hot && (s === 4 || s === 12)) this.n({ dur: 0.16, vol: 0.13, freq: 1400, to: 500, q: 0.8, when: w, out: M });
      // string-like ostinato when the uplink is active
      if (hot) { const o = [0, 0, 7, 0, 12, 0, 7, third[bar]][this.step % 8]; this.v({ f: hz(root + 12 + o), dur: spb * 0.85, type: 'sawtooth', vol: 0.055, lp: 1500, lpTo: 500, when: w, out: M }); }
      else if (s % 8 === 4) this.n({ dur: 0.5, vol: 0.012, freq: 5000, q: 0.6, att: 0.2, when: w, out: M });
      this.nextT += spb; this.step++;
    }
  }
}
