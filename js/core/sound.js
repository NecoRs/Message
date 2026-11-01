// Desktop sound engine. Plays recorded sound effects (MP3, Kenney's CC0
// Interface and Sci-Fi packs — see assets/sounds/CREDITS.txt) through a
// master bus that follows the desktop volume and mute settings. Buffers are
// decoded once and reused; rapid events are throttled so they never pile up.
import { settings } from './settings.js';

const BASE = new URL('../../assets/sounds/', import.meta.url);

/** One-shot effects: variants, base gain and minimum gap between repeats (ms). */
const EFFECTS = {
  type: { files: ['type-1', 'type-2', 'type-3', 'type-4', 'type-5'], gain: 0.22, gap: 26 },
  tick: { files: ['tick'], gain: 0.3, gap: 40 },
  row: { files: ['row-1', 'row-2'], gain: 0.24, gap: 55 },
  blip: { files: ['blip'], gain: 0.34, gap: 60 },
  execute: { files: ['execute'], gain: 0.5, gap: 80 },
  success: { files: ['success-1', 'success-2'], gain: 0.5, gap: 200 },
  warning: { files: ['warning'], gain: 0.55, gap: 200 },
  error: { files: ['error'], gain: 0.55, gap: 200 },
  sweep: { files: ['sweep-1', 'sweep-2', 'sweep-3'], gain: 0.4, gap: 150 },
  boot: { files: ['boot'], gain: 0.6, gap: 500 },
  radio: { files: ['radio-1', 'radio-2', 'radio-3'], gain: 0.42, gap: 400 },
};

/** Looping layers. */
const LOOPS = {
  processing: { file: 'loop-processing', gain: 0.2, fadeIn: 0.6 },
  ambience: { file: 'loop-ambience', gain: 0.32, fadeIn: 2.5 },
};

const MAX_VOICES = 24;
const LOOP_TRIM = 0.025; // skip MP3 encoder padding at the loop edges

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = new Map(); // file -> AudioBuffer
    this.loading = new Map(); // file -> Promise<AudioBuffer|null>
    this.last = {};
    this.lastVariant = {};
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
    if (this.ready) this.preload();
    return this.ready;
  }

  #create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.#applyVolume(true);
    settings.on('change:volume', () => this.#applyVolume());
    settings.on('change:muted', () => this.#applyVolume());
  }

  #applyVolume(immediate = false) {
    if (!this.master) return;
    const v = settings.get('muted') ? 0 : Math.pow(settings.get('volume') / 100, 1.6);
    const g = this.master.gain;
    if (immediate) g.value = v;
    else g.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /* ------------------------------------------------------------ buffers */

  #load(file) {
    if (this.loading.has(file)) return this.loading.get(file);
    const p = fetch(new URL(`${file}.mp3`, BASE))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${file}.mp3`);
        return r.arrayBuffer();
      })
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buf) => {
        this.buffers.set(file, buf);
        return buf;
      })
      .catch((err) => {
        console.warn('[sound] could not load', file, err.message || err);
        return null;
      });
    this.loading.set(file, p);
    return p;
  }

  /** Fetches and decodes every effect once; later plays reuse the buffers. */
  preload() {
    if (!this.ctx) return Promise.resolve();
    const files = [...Object.values(EFFECTS).flatMap((e) => e.files), ...Object.values(LOOPS).map((l) => l.file)];
    return Promise.all(files.map((f) => this.#load(f)));
  }

  #variant(name, files) {
    if (files.length === 1) return files[0];
    let i = Math.floor(Math.random() * files.length);
    if (files[i] === this.lastVariant[name]) i = (i + 1) % files.length;
    this.lastVariant[name] = files[i];
    return files[i];
  }

  /** A gain node connected to the master bus, for per-app volume. */
  bus(level = 1) {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(this.master);
    return g;
  }

  /* ------------------------------------------------------------ effects */

  /**
   * Plays a one-shot effect: type, tick, row, blip, execute, success,
   * warning, error, sweep, boot. Returns false if throttled or not loaded.
   */
  play(name, { dest, level = 1, pitch = 1 } = {}) {
    if (!this.ready) return false;
    const def = EFFECTS[name];
    if (!def) return false;
    const now = performance.now();
    if (now - (this.last[name] || 0) < def.gap) return false;
    if (this.voices >= MAX_VOICES) return false;
    const file = this.#variant(name, def.files);
    const buf = this.buffers.get(file);
    if (!buf) {
      this.#load(file);
      return false;
    }
    this.last[name] = now;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.max(0.8, Math.min(1.3, pitch));
    const g = ctx.createGain();
    g.gain.value = def.gain * level;
    src.connect(g).connect(dest || this.master);
    this.voices++;
    src.onended = () => {
      this.voices--;
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    src.start(ctx.currentTime + 0.003);
    return true;
  }

  /**
   * Starts a looping layer ('processing' or 'ambience') that fades in.
   * Returns { stop(fadeSeconds), setLevel(level, seconds) }.
   */
  loop(name, { dest, level = 1 } = {}) {
    if (!this.ready) return null;
    const def = LOOPS[name];
    if (!def) return null;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(dest || this.master);
    const peak = Math.max(0.0001, def.gain * level);
    let src = null;
    let stopped = false;

    const begin = (buf) => {
      if (stopped || !buf) return;
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = LOOP_TRIM;
      src.loopEnd = Math.max(LOOP_TRIM * 2, buf.duration - LOOP_TRIM);
      src.connect(out);
      const t = ctx.currentTime;
      src.start(t, LOOP_TRIM);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(peak, t + def.fadeIn);
    };
    const buf = this.buffers.get(def.file);
    if (buf) begin(buf);
    else this.#load(def.file).then(begin);

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
          try {
            src?.stop();
            src?.disconnect();
            out.disconnect();
          } catch {
            /* already stopped */
          }
        }, fade * 1000 + 60);
      },
    };
  }
}

export const sound = new SoundEngine();
