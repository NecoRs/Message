// Minimal event emitter used by the window manager, settings and filesystem.
export class Emitter {
  #handlers = new Map();

  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(type, fn) {
    this.#handlers.get(type)?.delete(fn);
  }

  emit(type, ...args) {
    const set = this.#handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[${type}] handler failed`, err);
      }
    }
  }
}
