// User preferences, persisted in localStorage.
import { Emitter } from './events.js';
import { storageGet, storageSet, storageRemove } from './util.js';

const KEY = 'kali-desktop.settings.v1';

export const DEFAULTS = Object.freeze({
  // Appearance
  theme: 'dark', // 'dark' | 'light'
  accent: 'blue',
  fontSize: 13,
  animations: true,
  // Desktop
  wallpaper: 'kali-dragon', // wallpaper id or 'solid'
  wallpaperColor: '#0B1020',
  wallpaperStyle: 'cover', // 'cover' | 'contain' | 'center'
  desktopIcons: true,
  iconSize: 48,
  iconPositions: {},
  // Panel
  clock24: true,
  clockDate: false,
  clockSeconds: false,
  workspaceCount: 4,
  // Window manager
  snapping: true,
  // Sound
  volume: 60,
  muted: false,
  volumeFeedback: false,
  // Notifications
  dnd: false,
  // Network
  networking: true,
  // Menu
  favorites: ['terminal', 'firefox', 'files', 'editor', 'settings'],
  recent: [],
  // Terminal
  promptStyle: 'twoline', // 'twoline' | 'oneline' | 'classic'
  termFontSize: 14,
  termCursor: 'block', // 'block' | 'underline' | 'bar'
  termBlink: true,
  // Files
  showHidden: false,
  filesView: 'icons', // 'icons' | 'list'
  filesZoom: 48,
  // Editor
  editorWrap: true,
  editorLineNumbers: true,
  editorFontSize: 14,
});

class Settings extends Emitter {
  #values;

  constructor() {
    super();
    const stored = storageGet(KEY, {});
    this.#values = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
  }

  get(key) {
    return this.#values[key];
  }

  set(key, value) {
    if (this.#values[key] === value && typeof value !== 'object') return;
    this.#values[key] = value;
    this.#save();
    this.emit('change', key, value);
    this.emit(`change:${key}`, value);
  }

  toggle(key) {
    this.set(key, !this.#values[key]);
  }

  all() {
    return { ...this.#values };
  }

  reset() {
    storageRemove(KEY);
    this.#values = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      this.emit('change', key, this.#values[key]);
      this.emit(`change:${key}`, this.#values[key]);
    }
  }

  #save() {
    const diff = {};
    for (const [k, v] of Object.entries(this.#values)) {
      if (JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])) diff[k] = v;
    }
    storageSet(KEY, diff);
  }
}

export const settings = new Settings();

export const ACCENTS = {
  blue: { label: 'Kali Blue', main: '#2777FF', second: '#00A8FF' },
  cyan: { label: 'Cyan', main: '#00A8FF', second: '#3fd0ff' },
  purple: { label: 'Purple', main: '#8b5cf6', second: '#b18cff' },
  green: { label: 'Green', main: '#1fb36b', second: '#3fd88a' },
  orange: { label: 'Orange', main: '#f2771a', second: '#ffa04d' },
  red: { label: 'Red', main: '#e5484d', second: '#ff7a7e' },
};

export const WALLPAPERS = [
  { id: 'kali-dragon', name: 'Kali Dragon', file: 'assets/wallpapers/kali-dragon.svg', position: '62% 50%' },
  { id: 'kali-emblem', name: 'Emblem', file: 'assets/wallpapers/kali-emblem.svg', position: '50% 50%' },
  { id: 'kali-flow', name: 'Flow', file: 'assets/wallpapers/kali-flow.svg', position: '50% 50%' },
  { id: 'kali-horizon', name: 'Horizon', file: 'assets/wallpapers/kali-horizon.svg', position: '50% 100%' },
];

export const wallpaperById = (id) => WALLPAPERS.find((w) => w.id === id);
