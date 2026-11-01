// AudioController: Phantom Console's link to the desktop sound engine.
// Adds its own volume bus, typing-rate shaping, a reference-counted
// processing loop, crossfaded ambience and ducking while paused/hidden.
import { sound } from '../../core/sound.js';

export class AudioController {
  constructor(prefs) {
    this.prefs = prefs;
    this.enabled = false;
    this.bus = null;
    this.proc = null;
    this.procRefs = 0;
    this.amb = null;
    this.ducked = false;
    this.lastType = 0;
  }

  get active() {
    return this.enabled && this.prefs.sfx && !this.prefs.muted && sound.ready;
  }

  /** Call from a user gesture. Resolves true if audio is running. */
  async enable() {
    const ok = await sound.unlock();
    if (!ok) return false;
    if (!this.bus) this.bus = sound.bus(this.#level());
    this.enabled = true;
    this.syncAmbience();
    return true;
  }

  #level() {
    return this.prefs.muted ? 0.0001 : Math.max(0.0001, Math.pow(this.prefs.volume / 100, 1.4));
  }

  setVolume() {
    if (!this.bus) return;
    this.bus.gain.setTargetAtTime(this.ducked ? this.#level() * 0.12 : this.#level(), sound.ctx.currentTime, 0.08);
  }

  sfx(name, opts = {}) {
    if (!this.active || this.ducked) return;
    sound.play(name, { dest: this.bus, ...opts });
  }

  /** Typing clicks: not every key, with slight pitch variation. */
  typing() {
    if (!this.active || this.ducked) return;
    const now = performance.now();
    if (now - this.lastType < 34 && Math.random() < 0.6) return;
    this.lastType = now;
    sound.play('type', { dest: this.bus, pitch: 0.9 + Math.random() * 0.25, level: 0.8 + Math.random() * 0.4 });
  }

  processingStart() {
    this.procRefs++;
    if (this.procRefs === 1 && this.active && !this.proc) this.proc = sound.loop('processing', { dest: this.bus });
  }

  processingEnd() {
    this.procRefs = Math.max(0, this.procRefs - 1);
    if (this.procRefs === 0 && this.proc) {
      this.proc.stop(1.1);
      this.proc = null;
    }
  }

  /** Starts or crossfades out the ambience layer according to the prefs. */
  syncAmbience() {
    const want = this.enabled && this.prefs.ambience && sound.ready;
    if (want && !this.amb) this.amb = sound.loop('ambience', { dest: this.bus });
    else if (!want && this.amb) {
      this.amb.stop(2.2);
      this.amb = null;
    }
  }

  /** Effects on/off: loops follow the effects switch. */
  syncEffects() {
    if (!this.prefs.sfx && this.proc) {
      this.proc.stop(0.5);
      this.proc = null;
    } else if (this.prefs.sfx && this.procRefs > 0 && !this.proc && this.active) {
      this.proc = sound.loop('processing', { dest: this.bus });
    }
  }

  duck(on) {
    if (this.ducked === on) return;
    this.ducked = on;
    this.setVolume();
  }

  /** Resets loop state after a restart without touching the ambience. */
  resetLoops() {
    this.procRefs = 0;
    if (this.proc) {
      this.proc.stop(0.6);
      this.proc = null;
    }
  }

  dispose() {
    this.resetLoops();
    if (this.amb) {
      this.amb.stop(0.6);
      this.amb = null;
    }
    const bus = this.bus;
    this.bus = null;
    this.enabled = false;
    if (bus) {
      bus.gain.setTargetAtTime(0.0001, sound.ctx.currentTime, 0.15);
      setTimeout(() => {
        try {
          bus.disconnect();
        } catch {
          /* ignore */
        }
      }, 1200);
    }
  }
}
