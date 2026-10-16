// audio.js — small WebAudio synth. The context is created/resumed only from a user gesture (mobile autoplay rules).
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
export class Sound {
  constructor() { this.ctx = null; this.master = null; this.enabled = true; this.volume = 0.8; this.voices = 0; this.noiseBuf = null; this.lastDanger = 0; }
  unlock() {
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume * 0.6;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp); comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      return true;
    } catch { return false; }
  }
  set(volume, enabled) {
    this.volume = volume; this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? volume * 0.6 : 0;
  }
  _ok() { return this.enabled && this.ctx && this.ctx.state === 'running' && this.voices < 28; }
  tone(freq, dur, type = 'sine', vol = 0.12, slide = 0, delay = 0) {
    if (!this._ok()) return;
    try {
      const t0 = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.03);
      this.voices++; o.onended = () => { this.voices--; };
    } catch { /* ignore */ }
  }
  noise(dur, vol = 0.1, cutoff = 1800, delay = 0) {
    if (!this._ok()) return;
    try {
      if (!this.noiseBuf) {
        const n = this.ctx.sampleRate; this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = this.ctx.currentTime + delay, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = this.noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t0); f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.2), t0 + dur);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t0, Math.random() * 0.5, dur + 0.05);
      this.voices++; s.onended = () => { this.voices--; };
    } catch { /* ignore */ }
  }
  j(x, a = 0.06) { return x * (1 + (Math.random() * 2 - 1) * a); }   // pitch jitter so repeats never sound identical
  // ---- game events
  click() { this.tone(this.j(620), 0.05, 'triangle', 0.06); }
  shoot() { this.tone(this.j(520), 0.11, 'sawtooth', 0.07, -300); this.noise(0.08, 0.05, 3000); }
  insert() { this.tone(this.j(170), 0.1, 'sine', 0.16, -70); this.tone(this.j(900), 0.03, 'square', 0.03); }
  join() { this.tone(this.j(300), 0.05, 'triangle', 0.05); }
  swap() { this.tone(this.j(760), 0.04, 'triangle', 0.06); this.tone(this.j(980), 0.05, 'triangle', 0.05, 0, 0.04); }
  match(n, combo) {
    const base = 330 * Math.pow(2, (Math.min(combo, 8) - 1) * 2 / 12), cnt = Math.min(n, 7);
    for (let k = 0; k < cnt - 1; k++) this.tone(base * Math.pow(2, PENTA[k] / 12), 0.16, k % 2 ? 'triangle' : 'sine', 0.1, 0, k * 0.045);
    this.tone(base / 2, 0.18, 'sine', 0.12, -40);
    if (n >= 5) this.tone(base * 2, 0.35, 'sine', 0.07, 0, 0.12);
  }
  bomb() { this.noise(0.55, 0.28, 2400); this.tone(140, 0.5, 'sawtooth', 0.14, -100); this.tone(70, 0.6, 'sine', 0.2, -30); }
  rainbow() { for (let k = 0; k < 6; k++) this.tone(this.j(660 * Math.pow(2, PENTA[k] / 12), 0.01), 0.14, 'sine', 0.07, 0, k * 0.04); }
  slowOn() { this.tone(520, 0.5, 'sine', 0.1, -330); this.tone(260, 0.55, 'triangle', 0.06, -150); }
  slowOff() { this.tone(240, 0.25, 'sine', 0.07, 200); }
  reverseOn() { this.tone(700, 0.4, 'sawtooth', 0.05, -500); this.tone(500, 0.45, 'square', 0.03, -380, 0.05); }
  powerGain() { this.tone(this.j(880), 0.12, 'sine', 0.09); this.tone(this.j(1320), 0.2, 'sine', 0.08, 0, 0.07); }
  surge() { this.tone(70, 0.7, 'sawtooth', 0.09, 30); this.noise(0.5, 0.05, 500); }
  danger(level) {
    const now = this.ctx ? this.ctx.currentTime : 0, gap = 0.9 - 0.55 * level;
    if (now - this.lastDanger < gap) return;
    this.lastDanger = now; this.tone(110 + 40 * level, 0.14, 'square', 0.06 + 0.04 * level); this.tone(82, 0.2, 'sine', 0.12, 0, 0.12);
  }
  lifeLost() { this.noise(0.6, 0.2, 900); this.tone(220, 0.7, 'sawtooth', 0.12, -150); this.tone(110, 0.8, 'sine', 0.16, -60); }
  go() { this.tone(523, 0.1, 'triangle', 0.09); this.tone(784, 0.18, 'triangle', 0.09, 0, 0.09); }
  complete() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.1, 0, i * 0.09)); }
  gameOver() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.07, -10, i * 0.2)); }
}
