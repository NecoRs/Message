// Synthesised "computer" voice for Phantom Console, using the browser's
// SpeechSynthesis. It prefers a female English system voice when the device
// has one, speaks short classified-ops phrases, keeps a cooldown so it never
// chatters, and follows the Phantom volume / mute / enable settings.

const PHRASES = {
  online: ['System online.', 'Phantom online.', 'All systems nominal.'],
  operation: ['New operation.', 'Initializing sequence.', 'Standby for operation.'],
  processing: ['Processing.', 'Processing data streams.', 'Working.'],
  analysis: ['Analyzing.', 'Running analysis.', 'Scanning.'],
  complete: ['Operation complete.', 'Access granted.', 'Report ready.', 'Sequence complete.'],
  warning: ['Warning. Anomaly detected.', 'Warning.', 'Alert. Anomaly flagged.'],
  denied: ['Access denied.', 'Integrity check failed.', 'Error detected.'],
};

const FEMALE_HINTS = /female|woman|samantha|zira|susan|victoria|karen|moira|tessa|fiona|serena|google uk english female|google us english|aria|jenny|sonia|catherine|hazel/i;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Voice {
  constructor(prefs) {
    this.prefs = prefs;
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voice = null;
    this.last = 0;
    this.enabled = false;
    this.cooldown = 4500;
    this.lastText = '';
    if (this.synth) {
      this.#pickVoice();
      // voices often load asynchronously
      this.synth.addEventListener?.('voiceschanged', () => this.#pickVoice());
    }
  }

  get supported() {
    return !!this.synth && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  #pickVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices?.() || [];
    if (!voices.length) return;
    const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
    const pool = en.length ? en : voices;
    this.voice = pool.find((v) => FEMALE_HINTS.test(v.name))
      || pool.find((v) => /en-GB/i.test(v.lang))
      || pool.find((v) => /en-US/i.test(v.lang))
      || pool[0];
  }

  get active() {
    return this.supported && this.enabled && this.prefs.voice && !this.prefs.muted && this.prefs.volume > 0;
  }

  /** Speak a phrase for an event kind. `force` ignores the cooldown. */
  say(kind, { force = false } = {}) {
    if (!this.active) return;
    const now = performance.now();
    if (!force && now - this.last < this.cooldown) return;
    const list = PHRASES[kind];
    if (!list) return;
    let text = pick(list);
    if (text === this.lastText && list.length > 1) text = pick(list);
    this.speak(text);
  }

  speak(text) {
    if (!this.active || !this.voice) return;
    this.last = performance.now();
    this.lastText = text;
    try {
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = this.voice;
      u.lang = this.voice.lang || 'en-US';
      u.rate = 0.92;
      u.pitch = 1.08;
      u.volume = Math.min(1, Math.pow(this.prefs.volume / 100, 1.3));
      this.synth.speak(u);
    } catch {
      /* speech unavailable */
    }
  }

  enable() {
    this.enabled = true;
    this.#pickVoice();
  }

  silence() {
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
  }

  dispose() {
    this.enabled = false;
    this.silence();
  }
}
