// METASPLOIT FRAMEWORK — cinematic cyber operations console (offline simulator).
// (Internally still the "phantom" app: ids, CSS classes and prefs keep that name.)
//
// Components:
//   SimClock / HumanTypingEngine / TypingScheduler  (engine.js)
//   TerminalRenderer / TableGenerator              (render.js)
//   LogGenerator / StatusSimulator                 (data.js)
//   ScenarioManager + scenarios                    (scenarios.js)
//   Hollywood panels                               (panes.js)
//   AudioController                                (audio.js)
//   LoopController (InfiniteScenarioEngine)        (this file)
//
// Everything shown is simulated locally. User input is matched against a
// fixed list of demo commands; nothing is executed on the host.
import { h, storageGet, storageSet, mqReducedMotion, isTextInput } from '../../core/util.js';
import { Emitter } from '../../core/events.js';
import { icon } from '../../core/icons.js';
import { wm } from '../../core/wm.js';
import { sound } from '../../core/sound.js';
import { SimClock, Cancelled, HumanTypingEngine, TypingScheduler } from './engine.js';
import { TerminalRenderer } from './render.js';
import { StatusSimulator, PHASES, rand, hex, clockTime, fmtInt } from './data.js';
import { ScenarioManager, ScenarioContext, transition, SCENARIOS } from './scenarios.js';
import { CodePane, NetPane, ActivityPane, LogsPane, DataPane, BinaryPane, StatusPane, typeCode } from './panes.js';
import { AudioController } from './audio.js';
import { Voice } from './voice.js';

const PREFS_KEY = 'kali-desktop.phantom.v1';
const DEFAULTS = {
  typingSpeed: 'normal',
  animSpeed: 1,
  volume: 70,
  sfx: true,
  ambience: false,
  voice: true,
  radio: true,
  muted: false,
  panels: 8,
  theme: 'phantom',
  autoLoop: true,
  crt: true,
  autoFocus: true,
  hollywood: true,
  audioEnabled: false,
};

const PANES = [
  { id: 'main', num: '01', title: 'MAIN CONSOLE' },
  { id: 'code', num: '02', title: 'CODE STREAM' },
  { id: 'net', num: '03', title: 'NETWORK MONITOR' },
  { id: 'act', num: '04', title: 'SYSTEM ACTIVITY' },
  { id: 'logs', num: '05', title: 'EVENT LOGS' },
  { id: 'data', num: '06', title: 'DATA ANALYSIS' },
  { id: 'bin', num: '07', title: 'BINARY STREAM' },
  { id: 'stat', num: '08', title: 'SYSTEM STATUS' },
];

const LAYOUTS = {
  1: ['main'],
  2: ['main', 'stat'],
  4: ['main', 'code', 'logs', 'stat'],
  6: ['main', 'code', 'net', 'logs', 'data', 'stat'],
  8: ['main', 'code', 'net', 'act', 'logs', 'data', 'bin', 'stat'],
};

const svg = (inner, fill = false) =>
  `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const IC = {
  play: svg('<path d="M5 3.2v9.6l7.6-4.8z"/>', true),
  pause: svg('<path d="M5.5 3.5v9M10.5 3.5v9"/>'),
  restart: icon('reload'),
  panes: svg('<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M8 2.5v11M2 8h6"/>'),
  keyboard: svg('<rect x="1.5" y="4" width="13" height="8" rx="1.2"/><path d="M4 6.6h.01M6.7 6.6h.01M9.3 6.6h.01M12 6.6h.01M4.6 9.4h6.8"/>'),
  sound: icon('volume-high'),
  muted: icon('volume-muted'),
  settings: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3"/>'),
  fullscreen: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  exitFullscreen: svg('<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/>'),
  close: icon('close'),
};

const BANNER = [
  ' ███╗   ███╗███████╗███████╗   ███████╗██████╗  █████╗ ███╗   ███╗███████╗',
  ' ████╗ ████║██╔════╝██╔════╝   ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝',
  ' ██╔████╔██║███████╗█████╗     █████╗  ██████╔╝███████║██╔████╔██║█████╗  ',
  ' ██║╚██╔╝██║╚════██║██╔══╝     ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ',
  ' ██║ ╚═╝ ██║███████║██║        ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗',
  ' ╚═╝     ╚═╝╚══════╝╚═╝        ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝',
];

const COMMANDS = [
  ['help', 'show this list'],
  ['status', 'engine, scenario and system status'],
  ['clear', 'clear the main console'],
  ['pause / resume', 'freeze or continue every panel'],
  ['restart', 'reboot the console and start a new scenario'],
  ['speed [slow|normal|fast|extreme]', 'typing speed'],
  ['theme [phantom|ice|amber]', 'colour theme'],
  ['hollywood [on|off]', 'multi-panel mode'],
  ['panels [2|4|6|8]', 'number of panels in Hollywood mode'],
  ['sound [on|off]', 'sound effects'],
  ['voice [on|off]', 'system voice announcer'],
  ['radio [on|off]', 'random radio chatter'],
  ['scenarios', 'list the available scenarios'],
  ['auto', 'leave demo mode and resume the automatic console'],
];

class PhantomConsole {
  constructor(win) {
    this.win = win;
    this.prefs = { ...DEFAULTS, ...(storageGet(PREFS_KEY, {}) || {}) };
    this.bus = new Emitter();
    this.clock = new SimClock();
    this.clock.speed = this.prefs.animSpeed;
    this.clock.blocked = () => win.minimized || win.workspace !== wm.workspace || document.hidden;
    this.status = new StatusSimulator();
    this.audio = new AudioController(this.prefs);
    this.voice = new Voice(this.prefs);
    this.typing = new HumanTypingEngine(() => this.prefs.typingSpeed);
    this.scheduler = new TypingScheduler(this.typing, this.audio);
    this.manager = new ScenarioManager();
    this.mode = 'auto';
    this.state = 'boot';
    this.phase = null;
    this.scenario = null;
    this.startRequested = false;
    this.history = [];
    this.histIndex = 0;
    this.focusTimer = 0;
    this.cleanups = [];
    this.mainCols = 80;
    this.disposed = false;

    this.#build();
    this.#bind();
    this.applyLayout();
    this.clock.start();
    this.#tryRestoreAudio();
    this.startAll(true);
  }

  /* ------------------------------------------------------------ DOM */

  #build() {
    const win = this.win;
    win.body.classList.add('ph-host');
    const ctl = (cls, label, html, fn) => {
      const b = h('button', { class: `ph-ctl ${cls}`, type: 'button', title: label, 'aria-label': label });
      b.innerHTML = html;
      b.addEventListener('click', fn);
      return b;
    };

    this.audioBtn = h('button', { class: 'ph-enable-audio', type: 'button', onclick: () => this.enableAudio() }, 'ENABLE AUDIO');
    this.playBtn = ctl('ph-play', 'Pause', IC.pause, () => this.onPlay());
    this.restartBtn = ctl('ph-restart', 'Restart', IC.restart, () => this.restart());
    this.hollyBtn = ctl('ph-holly', 'Hollywood mode', `${IC.panes}<span>HOLLYWOOD</span>`, () => this.setPref('hollywood', !this.prefs.hollywood));
    this.modeBtn = ctl('ph-mode', 'Interactive demo mode', `${IC.keyboard}<span>AUTO</span>`, () => this.setMode(this.mode === 'auto' ? 'interactive' : 'auto'));
    this.soundBtn = ctl('ph-sound', 'Sound', IC.sound, () => this.onSound());
    this.settingsBtn = ctl('ph-settings-btn', 'Settings', IC.settings, () => this.toggleSettings());
    this.fsBtn = ctl('ph-fs', 'Fullscreen', IC.fullscreen, () => this.toggleFullscreen());

    this.scnEl = h('span', { class: 'ph-scn' }, 'STANDBY');
    this.phaseEls = PHASES.map((p) => h('span', { class: 'ph-phase-pill', title: p }, h('i'), h('b', null, p)));

    const top = h('div', { class: 'ph-topbar' },
      h('div', { class: 'ph-brand' },
        h('span', { class: 'ph-logo', html: icon('phantom') }),
        h('div', { class: 'ph-brand-text' }, h('div', { class: 'ph-brand-name' }, 'METASPLOIT'), h('div', { class: 'ph-brand-sub' }, 'FRAMEWORK CONSOLE · OFFLINE SIMULATOR'))),
      h('div', { class: 'ph-phase' }, this.scnEl, h('div', { class: 'ph-phases' }, this.phaseEls)),
      h('div', { class: 'ph-controls' }, this.audioBtn, this.playBtn, this.restartBtn, this.hollyBtn, this.modeBtn, this.soundBtn, this.settingsBtn, this.fsBtn));

    this.stage = h('div', { class: 'ph-stage' });
    this.paneEls = {};
    this.metaEls = {};
    this.ledEls = {};
    for (const p of PANES) {
      const meta = h('span', { class: 'ph-pane-meta' });
      const led = h('span', { class: 'ph-led', 'aria-hidden': 'true' });
      const body = h('div', { class: `ph-body ph-body-${p.id}` });
      const pane = h('section', { class: 'ph-pane', dataset: { pane: p.id }, 'aria-label': p.title },
        h('header', { class: 'ph-pane-head' }, h('span', { class: 'ph-pane-num' }, p.num), h('span', { class: 'ph-pane-title' }, p.title), meta, led),
        body);
      this.paneEls[p.id] = pane;
      this.metaEls[p.id] = meta;
      this.ledEls[p.id] = led;
      this.stage.appendChild(pane);
    }

    // main console + interactive input
    const mainBody = this.paneEls.main.querySelector('.ph-body');
    this.main = new TerminalRenderer(mainBody, { maxLines: 380 });
    this.input = h('input', { class: 'ph-input', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Phantom demo command' });
    this.inputRow = h('div', { class: 'ph-input-row', hidden: true }, this.#prompt(h('span', { class: 'ph-input-prompt' })), this.input);
    this.paneEls.main.appendChild(this.inputRow);
    this.probe = h('span', { class: 'ph-probe', 'aria-hidden': 'true' }, 'MMMMMMMMMM');
    mainBody.appendChild(this.probe);

    const body = (id) => this.paneEls[id].querySelector('.ph-body');
    this.panes = {
      code: new CodePane(this, body('code')),
      net: new NetPane(this, body('net')),
      act: new ActivityPane(this, body('act')),
      logs: new LogsPane(this, body('logs')),
      data: new DataPane(this, body('data')),
      bin: new BinaryPane(this, body('bin')),
      stat: new StatusPane(this, body('stat')),
    };
    this.aux = Object.values(this.panes);
    this.metaEls.net.textContent = 'passive';
    this.metaEls.logs.textContent = 'tail -f';
    this.metaEls.stat.textContent = 'live';
    this.metaEls.bin.textContent = 'hex/crc32';
    this.metaEls.main.textContent = 'root@msf';

    // boot overlay
    this.bootLines = h('div', { class: 'ph-boot-lines' });
    this.bootAudio = h('button', { class: 'ph-enable-audio ph-boot-audio', type: 'button', onclick: () => this.enableAudio() }, 'ENABLE AUDIO');
    this.bootEl = h('div', { class: 'ph-boot' }, h('div', { class: 'ph-boot-inner' }, this.bootLines, h('span', { class: 'ph-cursor ph-boot-cursor' })), this.bootAudio);
    this.pausedEl = h('div', { class: 'ph-paused', hidden: true }, 'PAUSED');
    this.stage.append(this.bootEl, this.pausedEl);

    this.footer = h('div', { class: 'ph-footer' });
    this.footItems = {};
    for (const k of ['state', 'scenario', 'cpu', 'mem', 'queue', 'rate', 'uptime']) {
      this.footItems[k] = h('span', { class: `ph-foot-${k}` });
      this.footer.appendChild(this.footItems[k]);
    }
    this.footer.appendChild(h('span', { class: 'ph-foot-sim' }, 'SIMULATION · OFFLINE'));

    this.settingsEl = this.#buildSettings();

    this.root = h('div', { class: 'phantom', tabindex: '-1', dataset: { theme: this.prefs.theme } },
      top, this.stage, this.footer, h('div', { class: 'ph-crt', 'aria-hidden': 'true' }), this.settingsEl);
    win.body.appendChild(this.root);
    this.#applyVisualPrefs();
    this.updateControls();
    this.updateFooter();
  }

  #prompt(el) {
    el.append(h('span', { class: 'ph-p-user' }, 'root@msf'), h('span', { class: 'ph-p-sep' }, ':'), h('span', { class: 'ph-p-path' }, '~'), h('span', { class: 'ph-p-hash' }, '# '));
    return el;
  }

  #buildSettings() {
    const row = (label, control) => h('div', { class: 'ph-set-row' }, h('span', { class: 'ph-set-label' }, label), control);
    const seg = (key, options) => {
      const wrap = h('div', { class: 'ph-seg', role: 'radiogroup', 'aria-label': key });
      const render = () => wrap.querySelectorAll('button').forEach((b) => {
        const on = String(this.prefs[key]) === b.dataset.value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      for (const [value, label] of options) {
        const b = h('button', { type: 'button', role: 'radio', dataset: { value: String(value) } }, label);
        b.addEventListener('click', () => {
          this.setPref(key, typeof DEFAULTS[key] === 'number' ? Number(value) : value);
          render();
        });
        wrap.appendChild(b);
      }
      this.settingRenderers.push(render);
      render();
      return wrap;
    };
    const toggle = (key) => {
      const b = h('button', { class: 'ph-toggle', type: 'button', role: 'switch' });
      const render = () => {
        b.classList.toggle('on', !!this.prefs[key]);
        b.setAttribute('aria-checked', String(!!this.prefs[key]));
        b.textContent = this.prefs[key] ? 'ON' : 'OFF';
      };
      b.addEventListener('click', () => {
        this.setPref(key, !this.prefs[key]);
        render();
      });
      this.settingRenderers.push(render);
      render();
      return b;
    };
    const range = (key, min, max, step, fmt) => {
      const out = h('span', { class: 'ph-range-val' });
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), class: 'ph-range', 'aria-label': key });
      const render = () => {
        input.value = String(this.prefs[key]);
        out.textContent = fmt(this.prefs[key]);
      };
      input.addEventListener('input', () => {
        this.setPref(key, Number(input.value));
        out.textContent = fmt(this.prefs[key]);
      });
      this.settingRenderers.push(render);
      render();
      return h('div', { class: 'ph-range-wrap' }, input, out);
    };
    this.settingRenderers = [];
    const closeBtn = h('button', { class: 'ph-ctl', type: 'button', 'aria-label': 'Close settings', html: IC.close, onclick: () => this.toggleSettings(false) });
    const panel = h('aside', { class: 'ph-settings', hidden: true, 'aria-label': 'Metasploit settings' },
      h('div', { class: 'ph-set-head' }, h('span', null, 'SETTINGS'), closeBtn),
      h('div', { class: 'ph-set-body' },
        row('Typing speed', seg('typingSpeed', [['slow', 'SLOW'], ['normal', 'NORMAL'], ['fast', 'FAST'], ['extreme', 'EXTREME']])),
        row('Animation speed', range('animSpeed', 0.5, 3, 0.25, (v) => `${v.toFixed(2)}×`)),
        row('Sound volume', range('volume', 0, 100, 1, (v) => `${v}%`)),
        row('Sound effects', toggle('sfx')),
        row('Background ambience', toggle('ambience')),
        row('System voice', toggle('voice')),
        row('Radio chatter', toggle('radio')),
        row('Terminal panels', seg('panels', [[2, '2'], [4, '4'], [6, '6'], [8, '8']])),
        row('Theme', seg('theme', [['phantom', 'MSF'], ['ice', 'ICE'], ['amber', 'AMBER']])),
        row('Auto loop', toggle('autoLoop')),
        row('CRT effects', toggle('crt')),
        row('Auto focus', toggle('autoFocus')),
        h('div', { class: 'ph-set-actions' }, h('button', {
          class: 'ph-ctl ph-text-btn', type: 'button',
          onclick: () => {
            const keepAudio = this.prefs.audioEnabled;
            Object.assign(this.prefs, DEFAULTS, { audioEnabled: keepAudio });
            this.#savePrefs();
            this.#applyVisualPrefs();
            this.clock.speed = this.prefs.animSpeed;
            this.audio.setVolume();
            this.audio.syncAmbience();
            this.audio.syncEffects();
            this.applyLayout();
            this.settingRenderers.forEach((r) => r());
            this.updateControls();
          },
        }, 'RESET TO DEFAULTS'))));
    return panel;
  }

  /* ------------------------------------------------------------ events */

  #bind() {
    const win = this.win;
    const offClose = () => this.dispose();
    win.on('close', offClose);
    win.on('reopen', () => win.focus());
    win.on('activate', () => {
      if (this.mode === 'interactive') this.input.focus({ preventScroll: true });
      else this.root.focus({ preventScroll: true });
    });

    const ro = new ResizeObserver(() => this.applyLayout());
    ro.observe(this.stage);
    this.cleanups.push(() => ro.disconnect());

    const onFs = () => {
      const fs = document.fullscreenElement === this.root;
      this.root.classList.toggle('ph-fullscreen', fs);
      this.fsBtn.innerHTML = fs ? IC.exitFullscreen : IC.fullscreen;
      this.fsBtn.title = fs ? 'Exit fullscreen' : 'Fullscreen';
    };
    document.addEventListener('fullscreenchange', onFs);
    this.cleanups.push(() => document.removeEventListener('fullscreenchange', onFs));

    const onVis = () => {
      this.audio.duck(document.hidden || this.clock.frozen);
      if (document.hidden) this.voice.silence();
    };
    document.addEventListener('visibilitychange', onVis);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVis));

    let wasFrozen = false;
    this.cleanups.push(this.clock.onFrame((dt, frozen) => {
      if (frozen !== wasFrozen) {
        wasFrozen = frozen;
        this.audio.duck(frozen);
      }
    }));

    // the user opted into audio before: resume it on their first interaction
    this.root.addEventListener('pointerdown', () => {
      if (this.prefs.audioEnabled && !this.audio.enabled) this.enableAudio();
    });

    this.root.addEventListener('keydown', (e) => {
      if (e.target === this.input) return this.#onInputKey(e);
      if (isTextInput(e.target) || e.target.closest?.('.ph-settings')) {
        if (e.key === 'Escape') this.toggleSettings(false);
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        this.onPlay();
      } else if (k === 'f') this.toggleFullscreen();
      else if (k === 'h') this.setPref('hollywood', !this.prefs.hollywood);
      else if (k === 'm') this.onSound();
      else if (k === 'i') {
        e.preventDefault();
        this.setMode(this.mode === 'auto' ? 'interactive' : 'auto');
      } else if (k === 'escape') this.toggleSettings(false);
    });
    this.paneEls.main.addEventListener('click', () => {
      if (this.mode === 'interactive' && !window.getSelection()?.toString()) this.input.focus({ preventScroll: true });
    });
  }

  /* ------------------------------------------------------------ prefs */

  #savePrefs() {
    storageSet(PREFS_KEY, this.prefs);
  }

  #applyVisualPrefs() {
    this.root.dataset.theme = this.prefs.theme;
    this.root.classList.toggle('ph-crt-on', !!this.prefs.crt);
  }

  setPref(key, value) {
    this.prefs[key] = value;
    this.#savePrefs();
    switch (key) {
      case 'animSpeed':
        this.clock.speed = value;
        break;
      case 'volume':
      case 'muted':
        this.audio.setVolume();
        break;
      case 'sfx':
        this.audio.syncEffects();
        break;
      case 'ambience':
        if (value && !this.audio.enabled) this.enableAudio();
        else this.audio.syncAmbience();
        break;
      case 'voice':
        if (value && !this.audio.enabled) this.enableAudio();
        else if (!value) this.voice.silence();
        break;
      case 'radio':
        if (value && !this.audio.enabled) this.enableAudio();
        break;
      case 'panels':
      case 'hollywood':
        this.applyLayout();
        if (this.prefs.hollywood) this.audio.sfx('sweep', { level: 0.6 });
        break;
      case 'theme':
      case 'crt':
        this.#applyVisualPrefs();
        break;
      case 'autoFocus':
        if (!value) this.#clearFocus();
        break;
      default:
    }
    this.settingRenderers?.forEach((r) => r());
    this.updateControls();
  }

  /* ------------------------------------------------------------ audio */

  async #tryRestoreAudio() {
    if (!this.prefs.audioEnabled) return;
    if (sound.ready || navigator.userActivation?.isActive) await this.enableAudio(true);
    this.updateControls();
  }

  async enableAudio(silent = false) {
    const ok = await this.audio.enable();
    if (ok) {
      this.prefs.audioEnabled = true;
      this.#savePrefs();
      this.audio.setVolume();
      if (!silent) this.audio.sfx('sweep', { level: 0.7 });
      this.updateControls();
      await this.voice.enable();
      if (!silent) this.voice.say('online', { force: true });
    }
    this.updateControls();
    return ok;
  }

  onSound() {
    if (!this.audio.enabled) {
      this.enableAudio();
      return;
    }
    this.setPref('muted', !this.prefs.muted);
  }

  /* ------------------------------------------------------------ layout */

  applyLayout() {
    if (this.disposed) return;
    const w = this.stage.clientWidth;
    const hgt = this.stage.clientHeight;
    let cap = w >= 1040 ? 8 : w >= 780 ? 6 : w >= 540 ? 4 : 2;
    if (hgt < 360) cap = Math.min(cap, 2);
    if (hgt < 260 || w < 300) cap = 1;
    const n = this.prefs.hollywood ? [8, 6, 4, 2].find((x) => x <= Math.min(this.prefs.panels, cap)) || 1 : 1;
    const effective = cap === 1 ? 1 : n;
    this.stage.dataset.layout = String(effective);
    const ids = LAYOUTS[effective];
    for (const p of PANES) {
      const vis = ids.includes(p.id);
      this.paneEls[p.id].hidden = !vis;
      if (this.panes[p.id]) this.panes[p.id].visible = vis;
    }
    const charW = this.probe.getBoundingClientRect().width / 10 || 8;
    this.mainCols = Math.max(20, Math.floor((this.paneEls.main.clientWidth - 24) / charW));
    this.root?.classList.toggle('ph-narrow', w < 640);
  }

  /* ------------------------------------------------------------ UI state */

  updateControls() {
    if (!this.root) return;
    const paused = this.clock.paused;
    const idle = this.state === 'idle';
    this.playBtn.innerHTML = paused || idle ? IC.play : IC.pause;
    const label = idle ? 'Start next scenario' : paused ? 'Resume' : 'Pause';
    this.playBtn.title = label;
    this.playBtn.setAttribute('aria-label', label);
    this.hollyBtn.classList.toggle('on', !!this.prefs.hollywood);
    this.hollyBtn.setAttribute('aria-pressed', String(!!this.prefs.hollywood));
    this.modeBtn.classList.toggle('on', this.mode === 'interactive');
    this.modeBtn.querySelector('span').textContent = this.mode === 'interactive' ? 'DEMO' : 'AUTO';
    const audioOn = this.audio.enabled;
    this.audioBtn.hidden = audioOn || !sound.supported;
    this.bootAudio.hidden = audioOn || !sound.supported;
    this.soundBtn.innerHTML = audioOn && !this.prefs.muted ? IC.sound : IC.muted;
    this.soundBtn.title = !audioOn ? 'Enable audio' : this.prefs.muted ? 'Unmute' : 'Mute';
    this.soundBtn.classList.toggle('on', audioOn && !this.prefs.muted);
    this.pausedEl.hidden = !paused;
    this.root.classList.toggle('ph-is-paused', paused);
  }

  updateFooter() {
    const s = this.status;
    const f = this.footItems;
    const state = this.clock.paused ? 'PAUSED' : this.state === 'boot' ? 'BOOTING' : this.state === 'idle' ? 'STANDBY' : this.mode === 'interactive' ? 'DEMO MODE' : 'RUNNING';
    f.state.textContent = `● ${state}`;
    f.state.className = `ph-foot-state ${this.clock.paused || this.state === 'idle' ? 'st-warn' : 'st-ok'}`;
    f.scenario.textContent = this.scenario ? `${this.scenario.name}${this.phase ? ' · ' + this.phase : ''}` : 'STANDBY';
    f.cpu.textContent = `CPU ${Math.round(s.cpu)}%`;
    f.mem.textContent = `MEM ${Math.round(s.mem)}%`;
    f.queue.textContent = `QUEUE ${s.queue}`;
    f.rate.textContent = `${fmtInt(s.rate)} rec/s`;
    f.uptime.textContent = `UP ${s.uptime}`;
  }

  setPhase(name) {
    this.phase = name;
    const idx = PHASES.indexOf(name);
    this.phaseEls.forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('done', idx >= 0 && i < idx);
    });
    this.scnEl.textContent = this.scenario ? this.scenario.name : 'STANDBY';
    if (name === 'REPORT') this.focus('main', 4000);
    if (name === 'PROCESSING') this.voice.say('processing');
    else if (name === 'ANALYSIS') this.voice.say('analysis');
    else if (name === 'REPORT') this.voice.say('complete');
    if (name) this.bus.emit('log', { time: clockTime(true), level: 'INFO', source: 'engine', msg: `phase ${name.toLowerCase()}` });
    this.updateFooter();
  }

  setPaneMeta(id, text) {
    if (this.metaEls[id]) this.metaEls[id].textContent = text;
  }

  flashLed(id) {
    const led = this.ledEls[id];
    if (!led) return;
    led.classList.remove('blink');
    void led.offsetWidth;
    led.classList.add('blink');
  }

  focus(id, ms = 3500) {
    if (!this.prefs.autoFocus || !this.prefs.hollywood) return;
    const pane = this.paneEls[id];
    if (!pane || pane.hidden) return;
    this.#clearFocus();
    pane.classList.add('ph-focus');
    this.stage.classList.add('ph-has-focus');
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => this.#clearFocus(), ms / Math.max(0.5, this.clock.speed));
  }

  #clearFocus() {
    for (const el of Object.values(this.paneEls)) el.classList.remove('ph-focus');
    this.stage.classList.remove('ph-has-focus');
  }

  toggleSettings(force) {
    const open = force ?? this.settingsEl.hidden;
    this.settingsEl.hidden = !open;
    this.settingsBtn.classList.toggle('on', open);
    if (open) {
      this.settingRenderers.forEach((r) => r());
      this.settingsEl.querySelector('button')?.focus({ preventScroll: true });
      this.audio.sfx('blip', { level: 0.4 });
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement === this.root) {
      document.exitFullscreen?.();
      return;
    }
    if (this.root.requestFullscreen) this.root.requestFullscreen().catch(() => this.win.toggleMaximize());
    else this.win.toggleMaximize();
  }

  /* ------------------------------------------------------------ control */

  onPlay() {
    if (this.state === 'idle') {
      this.startRequested = true;
      if (this.clock.paused) this.setPaused(false);
      return;
    }
    this.setPaused(!this.clock.paused);
  }

  setPaused(paused) {
    this.clock.paused = paused;
    this.audio.duck(paused || document.hidden);
    if (paused) this.voice.silence();
    this.updateControls();
    this.updateFooter();
  }

  restart() {
    this.clock.restart();
    this.audio.resetLoops();
    this.clock.paused = false;
    this.startRequested = false;
    this.main.clear();
    for (const p of this.aux) p.reset();
    this.manager.reset();
    this.scenario = null;
    this.setPhase(null);
    this.#clearFocus();
    this.status.setLoad(0);
    this.audio.duck(false);
    this.updateControls();
    this.startAll(true);
  }

  /** Waits while the automatic console is held (demo mode). */
  async gate(sl) {
    while (this.mode === 'interactive') await sl.wait(250);
  }

  startAll(boot) {
    const sl = this.clock.sleeper();
    const guard = (p) => p.catch((e) => {
      if (!(e instanceof Cancelled)) console.error('[phantom]', e);
    });
    guard(this.loopController(sl, boot));
    for (const p of this.aux) guard(p.loop(sl));
    guard(this.statusLoop(sl));
    guard(this.flickerLoop(sl));
    guard(this.radioLoop(sl));
  }

  /* -------------------------------------------- LoopController / engine */

  /** InfiniteScenarioEngine: boot once, then play scenarios forever. */
  async loopController(sl, boot) {
    this.state = 'boot';
    this.updateFooter();
    if (boot) await this.runBoot(sl);
    this.state = 'running';
    this.updateControls();
    this.updateFooter();
    await this.banner(sl);
    for (;;) {
      const sc = this.manager.next();
      this.scenario = sc;
      this.scnEl.textContent = sc.name;
      this.audio.sfx('stinger', { level: 0.6 });
      this.voice.say('operation');
      const ctx = new ScenarioContext(this, sc, sl);
      await sc.run(ctx);
      await transition(ctx);
      if (!this.prefs.autoLoop) {
        this.state = 'idle';
        this.setPhase(null);
        this.updateControls();
        this.main.seg([['[*] ', 'ph-info'], ['Auto loop is off — press START or type "resume" in demo mode to run the next scenario.', 'ph-dim']]);
        this.startRequested = false;
        while (!this.startRequested) await sl.wait(200);
        this.state = 'running';
        this.updateControls();
      }
    }
  }

  async statusLoop(sl) {
    for (;;) {
      await sl.wait(600);
      this.status.step();
      this.bus.emit('status');
      this.updateFooter();
    }
  }

  /** Fires the radio-chatter squelch at random intervals. */
  async radioLoop(sl) {
    await sl.wait(rand(6000, 12000));
    for (;;) {
      await sl.wait(rand(14000, 42000));
      if (this.prefs.radio && this.audio.active && !this.clock.frozen) {
        this.audio.sfx('radio', { level: 0.55 + Math.random() * 0.4 });
        this.flashLed('logs');
        if (Math.random() < 0.4) {
          await sl.wait(rand(500, 1400));
          if (this.prefs.radio && this.audio.active) this.audio.sfx('radio', { level: 0.5 });
        }
      }
    }
  }

  async flickerLoop(sl) {
    for (;;) {
      await sl.wait(rand(8000, 17000));
      if (!this.prefs.crt || mqReducedMotion.matches) continue;
      this.root.classList.add('ph-flicker');
      setTimeout(() => this.root?.classList.remove('ph-flicker'), 180);
    }
  }

  async runBoot(sl) {
    const boot = this.bootEl;
    boot.hidden = false;
    boot.classList.remove('done');
    this.bootLines.replaceChildren();
    this.stage.classList.add('ph-booting');
    await sl.wait(1000);
    this.audio.sfx('boot');
    // Ominous "classified" header (clearly a local simulation).
    const header = [
      ['╔══════════════════════════════════════════════╗', 'ph-boot-frame'],
      [`║${'   M E T A S P L O I T   ·   v6.4.0-sim'.padEnd(46)}║`, 'ph-boot-sigil'],
      [`║${'   CLASSIFIED // FRAMEWORK · OFFLINE SIMULATOR'.padEnd(46)}║`, 'ph-boot-class'],
      ['╚══════════════════════════════════════════════╝', 'ph-boot-frame'],
      [`  NODE 0x${hex(4)}   OPERATOR root   CLEARANCE OMEGA-9`, 'ph-boot-meta'],
      ['  ▓▒░ RESTRICTED ENVIRONMENT — AUTHORIZED USE ONLY ░▒▓', 'ph-boot-warn'],
      ['  » local simulation · no live systems · no network «', 'ph-boot-meta'],
    ];
    for (const [text, cls] of header) {
      this.bootLines.appendChild(h('div', { class: `ph-boot-line ${cls}` }, text));
      this.audio.sfx('tick', { level: 0.5, pitch: 0.7 });
      await sl.wait(rand(120, 260));
    }
    this.bootLines.appendChild(h('div', { class: 'ph-boot-line ph-boot-gap' }, ' '));
    await sl.wait(500);
    const steps = [
      ['INITIALIZING METASPLOIT FRAMEWORK…', 650],
      ['LOADING SYSTEM MODULES…', 900, true],
      ['ESTABLISHING LOCAL SIMULATION ENVIRONMENT…', 750],
      ['SYNCING DATA STREAMS…', 850],
      ['INITIALIZING VISUAL ENGINE…', 650],
    ];
    for (const [text, ms, modules] of steps) {
      const line = h('div', { class: 'ph-boot-line' });
      const label = h('span', { class: 'ph-boot-text' });
      const ok = h('span', { class: 'ph-boot-ok' });
      line.append(label, ok);
      this.bootLines.appendChild(line);
      let next = sl.now();
      for (const ch of text) {
        next += rand(8, 22);
        await sl.until(next);
        label.textContent += ch;
        if (Math.random() < 0.3) this.audio.sfx('type', { level: 0.5, pitch: 1.2 });
      }
      if (modules) {
        const meter = h('span', { class: 'ph-boot-meter' });
        line.insertBefore(meter, ok);
        const end = sl.now() + ms;
        while (sl.now() < end) {
          const f = 1 - (end - sl.now()) / ms;
          meter.textContent = ` ${'▮'.repeat(Math.round(f * 18)).padEnd(18, '▯')} ${String(Math.round(f * 42)).padStart(2)}/42`;
          await sl.wait(50);
        }
        meter.textContent = ` ${'▮'.repeat(18)} 42/42`;
      } else await sl.wait(ms * rand(0.7, 1.2));
      ok.textContent = '[ OK ]';
      this.audio.sfx('tick', { pitch: 1.2 });
    }
    await sl.wait(300);
    const ready = h('div', { class: 'ph-boot-line ph-boot-ready' }, 'SYSTEM READY.');
    this.bootLines.appendChild(ready);
    this.audio.sfx('success', { level: 0.8 });
    this.voice.say('online', { force: true });
    await sl.wait(800);
    boot.classList.add('done');
    this.stage.classList.remove('ph-booting');
    this.audio.sfx('sweep');
    await sl.wait(600);
    boot.hidden = true;
  }

  async banner(sl) {
    const t = this.main;
    t.blank();
    if (this.mainCols >= 76) {
      for (const line of BANNER) {
        t.seg([[line, 'ph-banner']], 'ph-banner-line');
        await sl.wait(55);
      }
    } else {
      t.seg([['  ▌ M E T A S P L O I T ▐', 'ph-banner']]);
    }
    t.blank();
    const info = [
      ['       =[ ', 'metasploit v6.4.0-sim'],
      ['+ -- --=[ ', `${SCENARIOS.length} scenarios · 42 modules · 0 live targets`],
      ['+ -- --=[ ', 'mode: local simulation · network: none'],
    ];
    for (const [a, b] of info) {
      t.seg([[a, 'ph-dim'], [b, 'ph-info']]);
      await sl.wait(90);
    }
    t.blank();
    t.seg([['[*] ', 'ph-info'], ['All data on this console is generated locally. No external connections are made.', 'ph-dim']]);
    await sl.wait(500);
  }

  /** Prompt + human typing + ENTER. */
  async typeCommand(sl, cmd) {
    const line = this.main.line('ph-cmdline');
    this.#prompt(line);
    const text = this.main.span(line, '', 'ph-typed');
    const cur = h('span', { class: 'ph-cursor' });
    line.appendChild(cur);
    await sl.wait(rand(380, 1150));
    await this.scheduler.type(sl, cmd, {
      onChar: (ch) => {
        text.textContent += ch;
        this.main.scroll();
      },
      onBack: () => {
        text.textContent = text.textContent.slice(0, -1);
      },
    });
    await sl.wait(rand(220, 650));
    cur.remove();
    this.audio.sfx('execute');
    this.flashLed('main');
    this.bus.emit('log', { time: clockTime(true), level: 'INFO', source: 'shell', msg: `exec ${cmd.split(' ').slice(0, 3).join(' ')}` });
  }

  /** Code goes to the code stream if it is visible, else into the console. */
  async showCode(sl, snippet) {
    if (this.panes.code.visible) {
      this.setPaneMeta('code', snippet.file);
      return { done: this.panes.code.enqueue(snippet) };
    }
    await this.typeCommand(sl, `cat ./modules/${snippet.file}`);
    await typeCode(this.main, snippet, sl, this, { speed: 0.26, sound: 0.3 });
    return { done: Promise.resolve() };
  }

  /* ------------------------------------------------------ demo mode */

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.inputRow.hidden = mode !== 'interactive';
    this.root.classList.toggle('ph-interactive', mode === 'interactive');
    if (mode === 'interactive') {
      this.main.blank();
      this.main.seg([['[*] ', 'ph-info'], ['Interactive demo mode. The automatic console is held; the other panels keep running.', '']]);
      this.main.seg([['[*] ', 'ph-info'], ['Type ', ''], ['help', 'ph-strong'], [' for the list of demo commands. Nothing typed here runs on your computer.', 'ph-dim']]);
      requestAnimationFrame(() => this.input.focus({ preventScroll: true }));
    } else {
      this.main.seg([['[*] ', 'ph-info'], ['Automatic mode resumed.', '']]);
      this.root.focus({ preventScroll: true });
    }
    this.audio.sfx('blip', { level: 0.5 });
    this.updateControls();
    this.updateFooter();
  }

  #onInputKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = this.input.value;
      this.input.value = '';
      this.exec(value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.histIndex > 0) this.input.value = this.history[--this.histIndex] ?? '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.histIndex < this.history.length) this.input.value = this.history[++this.histIndex] ?? '';
    } else if (e.key === 'Escape') {
      this.input.value = '';
    } else if (e.key.length === 1) {
      this.audio.typing();
    }
    e.stopPropagation();
  }

  exec(raw) {
    const line = raw.trim();
    const echo = this.main.line('ph-cmdline');
    this.#prompt(echo);
    this.main.span(echo, raw, 'ph-typed');
    if (!line) return;
    this.history.push(line);
    if (this.history.length > 50) this.history.shift();
    this.histIndex = this.history.length;
    this.audio.sfx('execute');
    const [cmd, arg] = line.toLowerCase().split(/\s+/);
    const t = this.main;
    const info = (msg) => t.seg([['[*] ', 'ph-info'], [msg, '']]);
    const ok = (msg) => t.seg([['[+] ', 'st-ok'], [msg, '']]);
    const bad = (msg) => t.seg([['[-] ', 'st-err'], [msg, '']]);
    const choose = (key, allowed, label) => {
      if (!arg) return info(`${label}: ${this.prefs[key]}`);
      if (!allowed.includes(arg)) return bad(`usage: ${cmd} [${allowed.join('|')}]`);
      this.setPref(key, typeof DEFAULTS[key] === 'number' ? Number(arg) : arg);
      ok(`${label} set to ${arg}`);
    };
    switch (cmd) {
      case 'help':
        t.blank();
        t.seg([['  Demo commands', 'ph-table-title']]);
        t.seg([['  =============', 'ph-table-rule']]);
        t.blank();
        for (const [c, d] of COMMANDS) t.seg([[`  ${c.padEnd(36)}`, 'ph-strong'], [d, 'ph-dim']]);
        t.blank();
        break;
      case 'status': {
        const s = this.status;
        t.blank();
        for (const [k, v] of [
          ['engine', this.clock.paused ? 'paused' : 'running'],
          ['mode', this.mode === 'interactive' ? 'interactive demo' : 'automatic'],
          ['scenario', this.scenario ? `${this.scenario.name} (${this.phase || '—'})` : 'standby'],
          ['scenarios run', String(this.manager.count)],
          ['cpu / memory', `${Math.round(s.cpu)}% / ${Math.round(s.mem)}%`],
          ['queue / rate', `${s.queue} / ${fmtInt(s.rate)} rec/s`],
          ['uptime', s.uptime],
          ['typing speed', this.prefs.typingSpeed],
          ['theme', this.prefs.theme],
          ['sound', !this.audio.enabled ? 'not enabled' : this.prefs.muted ? 'muted' : 'on'],
          ['network', 'none (simulation)'],
        ]) t.seg([[`  ${k.padEnd(16)}`, 'ph-dim'], [v, 'ph-info']]);
        t.blank();
        break;
      }
      case 'clear':
        t.clear();
        break;
      case 'restart':
        info('Restarting Metasploit…');
        setTimeout(() => this.restart(), 300);
        break;
      case 'pause':
        this.setPaused(true);
        ok('All panels paused. Type "resume" to continue.');
        break;
      case 'resume':
      case 'start':
        if (this.state === 'idle') this.startRequested = true;
        this.setPaused(false);
        ok('Resumed.');
        break;
      case 'speed':
        choose('typingSpeed', ['slow', 'normal', 'fast', 'extreme'], 'typing speed');
        break;
      case 'theme':
        choose('theme', ['phantom', 'ice', 'amber'], 'theme');
        break;
      case 'panels':
        choose('panels', ['2', '4', '6', '8'], 'panels');
        break;
      case 'hollywood':
        if (arg && !['on', 'off'].includes(arg)) bad('usage: hollywood [on|off]');
        else {
          this.setPref('hollywood', arg ? arg === 'on' : !this.prefs.hollywood);
          ok(`Hollywood mode ${this.prefs.hollywood ? 'on' : 'off'}`);
        }
        break;
      case 'sound':
        if (arg && !['on', 'off'].includes(arg)) bad('usage: sound [on|off]');
        else {
          const on = arg ? arg === 'on' : this.prefs.muted || !this.audio.enabled;
          if (on && !this.audio.enabled) this.enableAudio();
          this.setPref('muted', !on);
          ok(`Sound ${on ? 'on' : 'off'}`);
        }
        break;
      case 'voice':
      case 'radio':
        if (arg && !['on', 'off'].includes(arg)) bad(`usage: ${cmd} [on|off]`);
        else {
          const on = arg ? arg === 'on' : !this.prefs[cmd];
          if (on && !this.audio.enabled) this.enableAudio();
          this.setPref(cmd, on);
          ok(`${cmd === 'voice' ? 'System voice' : 'Radio chatter'} ${on ? 'on' : 'off'}`);
          if (cmd === 'voice' && on) this.voice.say('online', { force: true });
          if (cmd === 'radio' && on) this.audio.sfx('radio');
        }
        break;
      case 'scenarios':
        t.blank();
        SCENARIOS.forEach((s, i) => t.seg([[`  ${String(i + 1).padStart(2)}  `, 'ph-dim'], [s.name, this.scenario === s ? 'st-ok' : 'ph-strong']]));
        t.blank();
        break;
      case 'auto':
      case 'exit':
        this.setMode('auto');
        break;
      default:
        bad(`Unknown command: ${cmd}`);
        info('Type "help" for the list of demo commands.');
        this.audio.sfx('error', { level: 0.4 });
    }
  }

  /* ------------------------------------------------------------ cleanup */

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.focusTimer);
    this.clock.dispose();
    this.audio.dispose();
    this.voice.dispose();
    this.cleanups.forEach((fn) => fn());
    this.aux.forEach((p) => p.dispose());
    this.main.dispose();
    if (document.fullscreenElement === this.root) document.exitFullscreen?.();
    this.root.remove();
    this.root = null;
  }
}

export function mount(win) {
  win.setTitle('Metasploit Framework');
  const app = new PhantomConsole(win);
  win.phantom = app;
  return app;
}
