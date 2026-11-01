// Desktop sound engine. Every effect is synthesised with the Web Audio API
// (no sample files), routed through a master bus that follows the desktop
// volume and mute settings. Effects are throttled so rapid events (typing,
// table rows) never pile up into noise.
import { settings } from './settings.js';

const MIN_INTERVAL = { type: 26, tick: 40, row: 55, blip: 60 }; // ms between repeats
const MAX_VOICES = 28;

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = {};
    this.last = {};
    this.voices = 0;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get supported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  /** Must be called from a user gesture the first time (autoplay policy). */
  async unlock() {
    if (!this.supported) return false;
    if (!this.ctx) this.#create();
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* blocked until a gesture */
      }
    }
    return this.ready;
  }

  #create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.#applyVolume(true);
    settings.on('change:volume', () => this.#applyVolume());
    settings.on('change:muted', () => this.#applyVolume());

    // Noise buffers are rendered once and reused by every effect.
    this.noise.white = this.#noiseBuffer(1.5, 'white');
    this.noise.brown = this.#noiseBuffer(4, 'brown');
  }

  #noiseBuffer(seconds, kind) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      } else d[i] = w;
    }
    return buf;
  }

  #applyVolume(immediate = false) {
    if (!this.master) return;
    const v = settings.get('muted') ? 0 : Math.pow(settings.get('volume') / 100, 1.6);
    const g = this.master.gain;
    if (immediate) g.value = v;
    else g.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** A gain node connected to the master bus, for per-app volume. */
  bus(level = 1) {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(this.master);
    return g;
  }

  /* ------------------------------------------------------------ helpers */

  #env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  #osc(type, freq, t, dur, dest, peak, attack = 0.004) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    this.#env(g, t, attack, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.02);
    this.#track(o);
    return o;
  }

  #noiseBurst(t, dur, dest, peak, filterType, freq, q = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.white;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.#env(g, t, 0.002, peak, dur);
    src.connect(f).connect(g).connect(dest);
    const offset = Math.random() * (src.buffer.duration - dur - 0.05);
    src.start(t, Math.max(0, offset), dur + 0.05);
    this.#track(src);
    return { src, filter: f, gain: g };
  }

  #track(node) {
    this.voices++;
    node.onended = () => {
      this.voices--;
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  /* ------------------------------------------------------------ effects */

  /**
   * Plays a one-shot effect. Names: type, tick, row, execute, success,
   * warning, error, sweep, boot, blip. Returns false if throttled.
   */
  play(name, { dest, level = 1, pitch = 1 } = {}) {
    if (!this.ready) return false;
    const nowMs = performance.now();
    const gap = MIN_INTERVAL[name];
    if (gap && nowMs - (this.last[name] || 0) < gap) return false;
    if (this.voices > MAX_VOICES) return false;
    this.last[name] = nowMs;
    const out = dest || this.master;
    const t = this.ctx.currentTime + 0.005;
    const v = level;
    const r = () => 0.85 + Math.random() * 0.3;
    switch (name) {
      case 'type': {
        // light electronic key: filtered tick + faint high blip
        this.#noiseBurst(t, 0.014, out, 0.05 * v, 'bandpass', 3200 * r() * pitch, 2.5);
        this.#osc('sine', 1900 * r() * pitch, t, 0.018, out, 0.018 * v, 0.001);
        break;
      }
      case 'tick':
        this.#osc('sine', 2600 * r() * pitch, t, 0.02, out, 0.03 * v, 0.001);
        break;
      case 'row':
        this.#osc('triangle', 1500 * r() * pitch, t, 0.03, out, 0.035 * v, 0.002);
        this.#noiseBurst(t, 0.01, out, 0.02 * v, 'highpass', 5000, 0.7);
        break;
      case 'blip':
        this.#osc('sine', 1200 * pitch, t, 0.05, out, 0.05 * v);
        break;
      case 'execute': {
        // "digital execute": quick rising two-tone with a click
        this.#noiseBurst(t, 0.012, out, 0.07 * v, 'highpass', 2500, 0.8);
        this.#osc('square', 740 * pitch, t, 0.05, this.#lowpass(out, 2600), 0.05 * v);
        this.#osc('square', 1110 * pitch, t + 0.055, 0.07, this.#lowpass(out, 3200), 0.05 * v);
        this.#osc('sine', 2220 * pitch, t + 0.055, 0.09, out, 0.025 * v);
        break;
      }
      case 'success': {
        const notes = [659.25, 880, 1318.5];
        notes.forEach((f, i) => {
          this.#osc('triangle', f * pitch, t + i * 0.075, 0.22, out, 0.055 * v, 0.006);
          this.#osc('sine', f * 2 * pitch, t + i * 0.075, 0.12, out, 0.015 * v, 0.004);
        });
        break;
      }
      case 'warning': {
        const lp = this.#lowpass(out, 1400);
        this.#osc('square', 329.6 * pitch, t, 0.12, lp, 0.06 * v, 0.004);
        this.#osc('square', 246.9 * pitch, t + 0.14, 0.18, lp, 0.06 * v, 0.004);
        break;
      }
      case 'error': {
        const lp = this.#lowpass(out, 900);
        this.#osc('sawtooth', 140 * pitch, t, 0.09, lp, 0.07 * v);
        this.#osc('sawtooth', 140 * pitch, t + 0.13, 0.12, lp, 0.07 * v);
        break;
      }
      case 'sweep': {
        // futuristic sweep: band-passed noise gliding upward with a soft tone
        const ctx = this.ctx;
        const dur = 0.55;
        const n = this.#noiseBurst(t, dur, out, 0.06 * v, 'bandpass', 300, 6);
        n.filter.frequency.setValueAtTime(260, t);
        n.filter.frequency.exponentialRampToValueAtTime(5200, t + dur);
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(180 * pitch, t);
        o.frequency.exponentialRampToValueAtTime(880 * pitch, t + dur);
        this.#env(g, t, 0.08, 0.03 * v, dur - 0.08);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + dur + 0.05);
        this.#track(o);
        break;
      }
      case 'boot': {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(60, t);
        o.frequency.exponentialRampToValueAtTime(420 * pitch, t + 0.7);
        this.#env(g, t, 0.05, 0.08 * v, 0.75);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.85);
        this.#track(o);
        this.#noiseBurst(t, 0.3, out, 0.03 * v, 'lowpass', 400, 0.7);
        break;
      }
      default:
        return false;
    }
    return true;
  }

  #lowpass(dest, freq) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.connect(dest);
    // disconnect once the voices feeding it are long finished
    setTimeout(() => {
      try {
        f.disconnect();
      } catch {
        /* ignore */
      }
    }, 1500);
    return f;
  }

  /**
   * Starts a looping layer that fades in. Names: 'processing', 'ambience'.
   * Returns { stop(fadeSeconds), setLevel(level, seconds) }.
   */
  loop(name, { dest, level = 1 } = {}) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(dest || this.master);
    const nodes = [];
    const start = (n) => {
      n.start();
      nodes.push(n);
      return n;
    };
    let peak;
    let fadeIn;

    if (name === 'processing') {
      // low digital hum with a slowly moving filter
      peak = 0.05 * level;
      fadeIn = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.Q.value = 4;
      lp.connect(out);
      for (const [f, type, g] of [[55, 'sawtooth', 0.5], [110.4, 'square', 0.18], [164.8, 'sine', 0.3]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = g;
        o.connect(og).connect(lp);
        start(o);
      }
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.45;
      const depth = ctx.createGain();
      depth.gain.value = 180;
      lfo.connect(depth).connect(lp.frequency);
      start(lfo);
      const n = ctx.createBufferSource();
      n.buffer = this.noise.white;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 8;
      const ng = ctx.createGain();
      ng.gain.value = 0.05;
      n.connect(bp).connect(ng).connect(out);
      start(n);
    } else if (name === 'ambience') {
      // dark, barely-there drone: detuned low sines over filtered brown noise
      peak = 0.06 * level;
      fadeIn = 2.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      lp.connect(out);
      for (const f of [41.2, 41.6, 61.7, 82.4, 123.5]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = f > 100 ? 0.12 : 0.35;
        o.connect(og).connect(lp);
        start(o);
      }
      const n = ctx.createBufferSource();
      n.buffer = this.noise.brown;
      n.loop = true;
      const ng = ctx.createGain();
      ng.gain.value = 0.5;
      n.connect(ng).connect(lp);
      start(n);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const depth = ctx.createGain();
      depth.gain.value = 0.25;
      const amp = ctx.createGain();
      amp.gain.value = 0.75;
      lfo.connect(depth).connect(amp.gain);
      lp.disconnect();
      lp.connect(amp).connect(out);
      start(lfo);
      // faint digital shimmer
      const sh = ctx.createOscillator();
      sh.type = 'sine';
      sh.frequency.value = 2093;
      const shg = ctx.createGain();
      shg.gain.value = 0.004;
      const trem = ctx.createOscillator();
      trem.frequency.value = 0.21;
      const tremDepth = ctx.createGain();
      tremDepth.gain.value = 0.004;
      trem.connect(tremDepth).connect(shg.gain);
      sh.connect(shg).connect(out);
      start(sh);
      start(trem);
    } else {
      out.disconnect();
      return null;
    }

    const t = ctx.currentTime;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(peak, t + fadeIn);
    let stopped = false;
    return {
      setLevel(l, seconds = 0.6) {
        if (stopped) return;
        out.gain.setTargetAtTime(Math.max(0.0001, peak * l), ctx.currentTime, seconds / 3);
      },
      stop(fade = 0.8) {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), now);
        out.gain.exponentialRampToValueAtTime(0.0001, now + fade);
        setTimeout(() => {
          for (const n of nodes) {
            try {
              n.stop();
              n.disconnect();
            } catch {
              /* already stopped */
            }
          }
          try {
            out.disconnect();
          } catch {
            /* ignore */
          }
        }, fade * 1000 + 60);
      },
    };
  }
}

export const sound = new SoundEngine();
