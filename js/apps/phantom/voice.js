// Spoken announcer for the security tools. Plays pre-rendered robot-voice MP3
// clips (built offline with meSpeak — see assets/sounds/CREDITS.txt) through
// the desktop sound engine's master bus. Because it is ordinary page audio,
// it travels with the rest of the site's sound to Bluetooth / a car screen —
// unlike the browser's own SpeechSynthesis, which stays on the phone.
import { sound } from '../../core/sound.js';

/** Cybersecurity lines for Metasploit Framework (three takes per event). */
export const CYBER_CLIPS = Object.fromEntries(
  ['online', 'operation', 'processing', 'analysis', 'complete', 'warning', 'denied']
    .map((kind) => [kind, [1, 2, 3].map((i) => `voice-${kind}-${i}`)]),
);

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Voice {
  constructor(prefs, clips = CYBER_CLIPS, { cooldown = 4000 } = {}) {
    this.prefs = prefs;
    this.clips = clips;
    this.all = [...new Set(Object.values(clips).flat())];
    this.enabled = false;
    this.last = 0;
    this.lastClip = '';
    this.cooldown = cooldown;
  }

  get supported() {
    return sound.supported;
  }

  get active() {
    return this.enabled && this.prefs.voice !== false && !this.prefs.muted && this.prefs.volume > 0 && sound.ready;
  }

  /** Decodes the clips up front so playback is instant. */
  enable() {
    this.enabled = true;
    return sound.preloadFiles(this.all);
  }

  /** Speak a line for an event kind. `force` ignores the cooldown. */
  say(kind, { force = false } = {}) {
    if (!this.active) return false;
    const now = performance.now();
    if (!force && (now - this.last < this.cooldown || sound.voiceBusy())) return false;
    const list = this.clips[kind];
    if (!list) return false;
    let clip = pick(list);
    if (clip === this.lastClip && list.length > 1) clip = pick(list);
    const level = 0.95 * Math.pow((this.prefs.volume ?? 70) / 100, 1.1);
    const played = sound.voice(clip, { level });
    if (played) {
      this.last = now;
      this.lastClip = clip;
    }
    return played;
  }

  silence() {
    sound.stopVoice();
  }

  dispose() {
    this.enabled = false;
    this.silence();
  }
}
