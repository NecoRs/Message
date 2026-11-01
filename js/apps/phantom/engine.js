// Timing core for Phantom Console.
//
// SimClock advances "simulation time" from requestAnimationFrame, so pausing,
// speed changes and background tabs all work through one place: when the
// clock is frozen every animation coroutine simply stops at its next wait.
// Restarting bumps the epoch, which cancels every coroutine started before.
import { rand, pick } from './data.js';

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

export class SimClock {
  constructor() {
    this.t = 0;
    this.speed = 1;
    this.paused = false;
    this.blocked = () => false;
    this.epoch = 0;
    this.waiters = [];
    this.hooks = new Set();
    this.raf = 0;
    this.last = 0;
    this.disposed = false;
    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  get frozen() {
    return this.paused || this.blocked();
  }

  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    const real = Math.min(100, Math.max(0, now - this.last));
    this.last = now;
    const frozen = this.frozen;
    if (!frozen) {
      this.t += real * this.speed;
      this.#flush();
    }
    for (const fn of this.hooks) fn(real, frozen);
  }

  #flush() {
    const w = this.waiters;
    let n = 0;
    while (n < w.length && w[n].at <= this.t) n++;
    if (!n) return;
    for (const item of w.splice(0, n)) item.resolve();
  }

  #insert(item) {
    const w = this.waiters;
    let lo = 0;
    let hi = w.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (w[mid].at <= item.at) lo = mid + 1;
      else hi = mid;
    }
    w.splice(lo, 0, item);
  }

  until(at, epoch = this.epoch) {
    if (this.disposed || epoch !== this.epoch) return Promise.reject(new Cancelled());
    if (at <= this.t) return Promise.resolve();
    return new Promise((resolve, reject) => this.#insert({ at, resolve, reject }));
  }

  /** A waiter bound to the current epoch; it rejects once restart() runs. */
  sleeper() {
    const epoch = this.epoch;
    const clock = this;
    return {
      epoch,
      get alive() {
        return !clock.disposed && epoch === clock.epoch;
      },
      now: () => clock.t,
      until: (at) => clock.until(at, epoch),
      wait: (ms) => clock.until(clock.t + Math.max(0, ms), epoch),
    };
  }

  onFrame(fn) {
    this.hooks.add(fn);
    return () => this.hooks.delete(fn);
  }

  /** Cancels every pending wait and invalidates existing sleepers. */
  restart() {
    this.epoch++;
    const w = this.waiters;
    this.waiters = [];
    for (const item of w) item.reject(new Cancelled());
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.restart();
    this.hooks.clear();
  }
}

/* ----------------------------------------------------- HumanTypingEngine */

export const TYPING_SPEEDS = { slow: 120, normal: 60, fast: 31, extreme: 11 };

const NEIGHBORS = {
  a: 'qwsz', b: 'vghn', c: 'xdfv', d: 'serfcx', e: 'wsdr', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', i: 'ujko',
  j: 'huikmn', k: 'jiolm', l: 'kop', m: 'njk', n: 'bhjm', o: 'iklp', p: 'ol', q: 'wa', r: 'edft', s: 'awedxz',
  t: 'rfgy', u: 'yhji', v: 'cfgb', w: 'qase', x: 'zsdc', y: 'tghu', z: 'asx',
};

/**
 * Plans keystrokes the way a person types: uneven gaps, slower symbols and
 * capitals, hesitations at word starts and the occasional corrected typo.
 */
export class HumanTypingEngine {
  constructor(getSpeed) {
    this.getSpeed = getSpeed;
  }

  get base() {
    return TYPING_SPEEDS[this.getSpeed()] ?? TYPING_SPEEDS.normal;
  }

  charDelay(ch, prev, factor) {
    const b = this.base;
    let d = b * factor * (0.5 + Math.random() * 0.6 + Math.random() * 0.45);
    if (ch === ' ') d *= 1.2;
    else if (/[A-Z]/.test(ch)) d *= 1.35;
    else if (/[0-9]/.test(ch)) d *= 1.2;
    else if (/[^a-z]/i.test(ch)) d *= 1.5;
    if (ch === prev) d *= 0.7;
    if (prev === ' ' && Math.random() < 0.07) d += b * rand(2.5, 6);
    return d;
  }

  /** Returns [{type: 'char', ch, delay} | {type: 'back', delay}]. */
  plan(text, { typos = true, factor = rand(0.8, 1.25) } = {}) {
    const steps = [];
    const b = this.base;
    let typoAt = -1;
    if (typos && text.length > 7 && this.getSpeed() !== 'extreme' && Math.random() < 0.32) {
      const candidates = [];
      for (let i = 3; i < text.length - 1; i++) if (NEIGHBORS[text[i]]) candidates.push(i);
      if (candidates.length) typoAt = pick(candidates);
    }
    let prev = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (i === typoAt) {
        const wrong = pick([...NEIGHBORS[ch]]);
        steps.push({ type: 'char', ch: wrong, delay: this.charDelay(wrong, prev, factor) });
        const overshoot = Math.random() < 0.3 && i + 1 < text.length ? 1 : 0;
        if (overshoot) steps.push({ type: 'char', ch: text[i + 1], delay: this.charDelay(text[i + 1], wrong, factor) });
        steps.push({ type: 'back', delay: b * rand(3.5, 7) });
        for (let k = 0; k < overshoot; k++) steps.push({ type: 'back', delay: b * rand(1.3, 2.1) });
        steps.push({ type: 'char', ch, delay: b * rand(1.3, 2.3) });
      } else {
        steps.push({ type: 'char', ch, delay: this.charDelay(ch, prev, factor) });
      }
      prev = ch;
    }
    return steps;
  }
}

/**
 * Plays a keystroke plan against the simulation clock. Characters that fall
 * inside the same frame are applied together, so fast speeds stay smooth.
 */
export class TypingScheduler {
  constructor(engine, audio) {
    this.engine = engine;
    this.audio = audio;
  }

  async run(sleeper, plan, { onChar, onBack, sound = true }) {
    let next = sleeper.now();
    for (const step of plan) {
      next += step.delay;
      await sleeper.until(next);
      if (step.type === 'char') {
        onChar(step.ch);
        if (sound && step.ch !== ' ') this.audio?.typing();
      } else {
        onBack();
        if (sound) this.audio?.sfx('tick', { level: 0.6 });
      }
    }
  }

  async type(sleeper, text, handlers, opts) {
    return this.run(sleeper, this.engine.plan(text, opts), handlers);
  }
}
