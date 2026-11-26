// All sound is synthesised with WebAudio: wind, waves, engine, doors, steps, peeps, music.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.listener = null; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(C.destination);
    this.sfx = C.createGain(); this.sfx.connect(this.master);
    // noise buffer
    const n = C.sampleRate * 4, buf = C.createBuffer(1, n, C.sampleRate), d = buf.getChannelData(0);
    let b0 = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = 0.985 * b0 + 0.015 * w; d[i] = b0 * 6; }
    this.brown = buf;
    const wb = C.createBuffer(1, n, C.sampleRate), wd = wb.getChannelData(0); for (let i = 0; i < n; i++) wd[i] = Math.random() * 2 - 1;
    this.white = wb;
    // wind
    this.wind = this.loopNoise(this.brown, 'lowpass', 500, 0.07);
    // sea
    this.sea = this.loopNoise(this.white, 'lowpass', 700, 0.0);
    // engine: two detuned saws through a lowpass
    this.engGain = C.createGain(); this.engGain.gain.value = 0;
    this.engFilter = C.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    this.engOsc = [0, 1].map(i => { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 40 + i * 1.5; o.connect(this.engFilter); o.start(); return o; });
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    // tyre squeal / skid noise
    this.skid = this.loopNoise(this.white, 'bandpass', 1800, 0);
    this.musicGain = C.createGain(); this.musicGain.gain.value = 0.0; this.musicGain.connect(this.master);
  }
  loopNoise(buffer, type, freq, gain) {
    const C = this.ctx, src = C.createBufferSource(); src.buffer = buffer; src.loop = true;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = C.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { src, f, g };
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.9; }
  // per frame
  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const L = this.ctx.listener;
    if (s.listener) {
      const p = s.listener.position, f = s.listener.forward;
      if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    }
    this.wind.g.gain.setTargetAtTime(0.05 + 0.04 * Math.sin(t * 0.13) + (s.windBoost ?? 0), t, 0.5);
    this.wind.f.frequency.setTargetAtTime(380 + 200 * Math.sin(t * 0.21), t, 0.5);
    const near = s.seaNear ?? 0;
    const swell = 0.5 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    this.sea.g.gain.setTargetAtTime(near * (0.05 + 0.12 * swell), t, 0.3);
    this.sea.f.frequency.setTargetAtTime(400 + 900 * swell, t, 0.3);
    const rpm = s.engine ? s.rpm : 0;
    this.engGain.gain.setTargetAtTime(s.engine ? 0.05 + 0.06 * s.throttle : 0, t, 0.1);
    this.engOsc.forEach((o, i) => o.frequency.setTargetAtTime(32 + rpm * 85 + i * 1.7, t, 0.08));
    this.engFilter.frequency.setTargetAtTime(240 + rpm * 900 + s.throttle * 300, t, 0.1);
    this.skid.g.gain.setTargetAtTime(s.skid ? Math.min(0.08, s.skid * 0.02) : 0, t, 0.05);
  }
  panner(pos) {
    const C = this.ctx, p = C.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2; p.maxDistance = 200; p.rolloffFactor = 1.3;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.sfx);
    return p;
  }
  peep(pos, pitch = 1) {
    if (!this.ctx || this.muted) return;
    const C = this.ctx, t = C.currentTime, out = this.panner(pos);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = C.createOscillator(), g = C.createGain();
      const t0 = t + i * 0.11, f0 = (2600 + Math.random() * 700) * pitch;
      o.type = 'sine'; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f0 * 1.35, t0 + 0.05); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.1);
    }
  }
  flutter(pos) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime, out = this.panner(pos);
    const src = C.createBufferSource(); src.buffer = this.white;
    const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
    const g = C.createGain(); g.gain.value = 0;
    for (let i = 0; i < 14; i++) { g.gain.setValueAtTime(0.35, t + i * 0.07); g.gain.linearRampToValueAtTime(0.02, t + i * 0.07 + 0.05); }
    g.gain.linearRampToValueAtTime(0, t + 1.1);
    src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + 1.2);
  }
  thump(gain = 0.5, freq = 120, noise = 0.3) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const o = C.createOscillator(), g = C.createGain();
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.15);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.25);
    this.noiseBurst(noise, 2500, 0.08);
  }
  noiseBurst(gain, freq, dur, type = 'bandpass') {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const src = C.createBufferSource(); src.buffer = this.white;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = C.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx); src.start(t, Math.random() * 3); src.stop(t + dur + 0.05);
  }
  door(open) { this.thump(open ? 0.15 : 0.45, open ? 300 : 90, open ? 0.15 : 0.25); }
  step(surface) { this.noiseBurst(surface === 'road' ? 0.05 : 0.07, surface === 'road' ? 1800 : 900, 0.06); }
  rustle() { this.noiseBurst(0.18, 3000, 0.25, 'highpass'); }
  whoosh() { this.noiseBurst(0.2, 700, 0.35); }
  chime(level) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5].slice(0, 2 + Math.min(level, 3));
    notes.forEach((f, i) => {
      const o = C.createOscillator(), g = C.createGain(); o.type = 'triangle'; o.frequency.value = f;
      const t0 = t + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      o.connect(g); g.connect(this.sfx); o.start(t0); o.stop(t0 + 1.5);
    });
  }
  horn() {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    for (const f of [392, 494]) {
      const o = C.createOscillator(), g = C.createGain(), fl = C.createBiquadFilter(); o.type = 'square'; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = 1500;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.02); g.gain.setValueAtTime(0.06, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(fl); fl.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.5);
    }
  }
  // a slow ambient pad for the intro
  pad(chords, secs) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    this.musicGain.gain.cancelScheduledValues(t); this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(0.5, t + 2);
    chords.forEach((ch, i) => {
      const t0 = t + i * secs;
      ch.forEach(f => {
        const o = C.createOscillator(), g = C.createGain(), fl = C.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
        fl.type = 'lowpass'; fl.frequency.value = 700;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.03, t0 + secs * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + secs * 1.25);
        o.connect(fl); fl.connect(g); g.connect(this.musicGain); o.start(t0); o.stop(t0 + secs * 1.3);
      });
    });
  }
  stopMusic() { if (this.ctx) { const t = this.ctx.currentTime; this.musicGain.gain.cancelScheduledValues(t); this.musicGain.gain.setTargetAtTime(0, t, 0.6); } }
  crackle(on) {
    if (!this.ctx) return;
    if (on && !this.fire) this.fire = this.loopNoise(this.white, 'highpass', 2500, 0.0);
    if (this.fire) this.fire.g.gain.setTargetAtTime(on ? 0.03 : 0, this.ctx.currentTime, 0.4);
  }
  crackleTick() { if (this.fire && Math.random() < 0.3) this.noiseBurst(0.1, 3500, 0.02); }
}
