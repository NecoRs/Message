// METASPLOIT CLASSIC — an old-school black & white console (offline simulator).
//
// A monochrome CRT terminal "from the beginnings": power-on degauss, BIOS POST,
// an old kernel boot, login, then an endless msf 1.0-style session — a
// Hayes-modem dial-up to a BBS, an old port table, ROT13 decoding, memory
// dumps, a password-policy audit — with screen glitches and the occasional
// system halt and cold reboot. Everything is simulated locally; nothing typed
// or shown touches a real system. Reuses the typing engine and clock from the
// cinematic Metasploit Framework console (js/apps/phantom).
import { h, storageGet, storageSet, clamp } from '../../core/util.js';
import { wm } from '../../core/wm.js';
import { sound } from '../../core/sound.js';
import { SimClock, Cancelled, HumanTypingEngine, TypingScheduler } from '../phantom/engine.js';
import { TerminalRenderer } from '../phantom/render.js';
import { rand, int, pick, chance, hex, shuffle } from '../phantom/data.js';
import { Voice } from '../phantom/voice.js';

const PREFS_KEY = 'kali-desktop.classic.v1';
const DEFAULTS = { volume: 75, muted: false, voice: true, hum: true, typingSpeed: 'normal', audioEnabled: false };
const SPEEDS = ['slow', 'normal', 'fast'];

const CLIPS = {
  ready: ['cvoice-ready'],
  connect: ['cvoice-connect'],
  granted: ['cvoice-granted'],
  denied: ['cvoice-denied'],
  warning: ['cvoice-warning'],
  scan: ['cvoice-scan'],
  decrypt: ['cvoice-decrypt'],
  halt: ['cvoice-halt'],
};

const BANNER = [
  '      __  __ ____  _____ ',
  '     |  \\/  / ___||  ___|',
  '     | |\\/| \\___ \\| |_   ',
  '     | |  | |___) |  _|  ',
  '     |_|  |_|____/|_|    ',
];

const WHISPERS = [
  'THE NETWORK IS WATCHING',
  'NOBODY EVER LOGS OUT',
  'WE NEVER LEFT THE SYSTEM',
  'SOMEONE ELSE IS LOGGED IN AS YOU',
  'DO NOT TRUST THE CLOCK',
  'THE QUIET ONES HEAR EVERYTHING',
  'EVERY PACKET LEAVES A TRACE',
];

const OLD_PORTS = [[21, 'ftp'], [22, 'ssh'], [23, 'telnet'], [25, 'smtp'], [53, 'domain'], [79, 'finger'],
  [80, 'http'], [110, 'pop3'], [111, 'sunrpc'], [143, 'imap'], [513, 'login'], [514, 'shell']];

const MODULES = [
  ['audit/passwd_policy', 'Rate the local password policy'],
  ['crypto/rot13', 'ROT13 encoder / decoder'],
  ['net/dialer', 'Hayes-compatible modem dialer'],
  ['recon/finger_info', 'Query a finger daemon (simulated)'],
  ['report/session_log', 'Write the session transcript'],
  ['scan/tcp_ports', 'Simulated TCP port sweep'],
];

const SEGMENTS = ['segDialer', 'segDialer', 'segScan', 'segScan', 'segRot13', 'segRot13', 'segAudit', 'segDump',
  'segModules', 'segVersion', 'segSessions', 'segClear'];

const rot13 = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65));
const GLYPHS = '#%&@$*+=?/\\|<>[]{}0123456789ABCDEF';

/* ------------------------------------------------------------ audio */

class ClassicAudio {
  constructor(prefs) {
    this.prefs = prefs;
    this.enabled = false;
    this.bus = null;
    this.hum = null;
    this.ducked = false;
  }

  get active() {
    return this.enabled && !this.prefs.muted && sound.ready;
  }

  #level() {
    return this.prefs.muted ? 0.0001 : Math.max(0.0001, Math.pow(this.prefs.volume / 100, 1.4));
  }

  async enable() {
    const ok = await sound.unlock();
    if (!ok) return false;
    if (!this.bus) this.bus = sound.bus(this.#level());
    this.enabled = true;
    this.syncHum();
    return true;
  }

  setVolume() {
    if (this.bus) this.bus.gain.setTargetAtTime(this.ducked ? this.#level() * 0.1 : this.#level(), sound.ctx.currentTime, 0.08);
  }

  sfx(name, opts = {}) {
    if (!this.active || this.ducked) return;
    sound.play(name === 'tick' ? 'ckey' : name, { dest: this.bus, ...opts });
  }

  /** Mechanical key clack, called by the typing scheduler per character. */
  typing() {
    if (!this.active || this.ducked) return;
    sound.play('ckey', { dest: this.bus, pitch: 0.9 + Math.random() * 0.18, level: 0.75 + Math.random() * 0.35 });
  }

  syncHum() {
    const want = this.enabled && this.prefs.hum && sound.ready;
    if (want && !this.hum) this.hum = sound.loop('crt', { dest: this.bus });
    else if (!want && this.hum) {
      this.hum.stop(0.8);
      this.hum = null;
    }
  }

  duck(on) {
    if (this.ducked === on) return;
    this.ducked = on;
    this.setVolume();
  }

  dispose() {
    this.hum?.stop(0.4);
    this.hum = null;
    const bus = this.bus;
    this.bus = null;
    this.enabled = false;
    if (bus) {
      bus.gain.setTargetAtTime(0.0001, sound.ctx.currentTime, 0.1);
      setTimeout(() => {
        try {
          bus.disconnect();
        } catch {
          /* ignore */
        }
      }, 1000);
    }
  }
}

/* ------------------------------------------------------------ console */

class ClassicConsole {
  constructor(win) {
    this.win = win;
    this.prefs = { ...DEFAULTS, ...(storageGet(PREFS_KEY, {}) || {}) };
    this.clock = new SimClock();
    this.clock.blocked = () => win.minimized || win.workspace !== wm.workspace || document.hidden;
    this.audio = new ClassicAudio(this.prefs);
    this.voice = new Voice(this.prefs, CLIPS, { cooldown: 2500 });
    this.typing = new HumanTypingEngine(() => this.prefs.typingSpeed);
    this.scheduler = new TypingScheduler(this.typing, this.audio);
    this.mod = null;
    this.state = 'off';
    this.cols = 80;
    this.cleanups = [];
    this.timers = new Set();
    this.disposed = false;

    this.#build();
    this.#bind();
    this.layout();
    this.updateButtons();
    this.clock.start();
    this.#tryRestoreAudio();
    this.start(true);
  }

  /* ---------- DOM */

  #build() {
    this.win.body.classList.add('cl-host');
    this.text = h('div', { class: 'cl-text' });
    this.term = new TerminalRenderer(this.text, { maxLines: 220 });
    this.stLeft = h('span', null, 'METASPLOIT CLASSIC 1.0');
    this.stMid = h('span', { class: 'cl-st-mid' });
    this.stRight = h('span');
    this.statusEl = h('div', { class: 'cl-status' }, this.stLeft, this.stMid, this.stRight);
    this.probe = h('span', { class: 'cl-probe', 'aria-hidden': 'true' }, 'MMMMMMMMMM');
    this.inner = h('div', { class: 'cl-inner' }, this.text, this.statusEl, this.probe);
    this.screen = h('div', { class: 'cl-screen cl-off', role: 'log', 'aria-label': 'Metasploit Classic screen', 'aria-live': 'off' },
      this.inner,
      h('div', { class: 'cl-scan', 'aria-hidden': 'true' }),
      h('div', { class: 'cl-roll', 'aria-hidden': 'true' }),
      h('div', { class: 'cl-noise', 'aria-hidden': 'true' }),
      h('div', { class: 'cl-vignette', 'aria-hidden': 'true' }),
      h('div', { class: 'cl-glare', 'aria-hidden': 'true' }));

    const btn = (fn) => {
      const b = h('button', { class: 'cl-btn', type: 'button' });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    this.btnSound = btn(() => this.onSound());
    this.btnVoice = btn(() => this.togglePref('voice'));
    this.btnHum = btn(() => {
      this.togglePref('hum');
      this.audio.syncHum();
    });
    this.btnSpeed = btn(() => this.cycleSpeed());
    this.btnPause = btn(() => this.setPaused(!this.clock.paused));
    this.btnReboot = btn(() => this.reboot());
    this.led = h('span', { class: 'cl-led', 'aria-hidden': 'true' });
    this.panel = h('div', { class: 'cl-panel' },
      h('div', { class: 'cl-maker' }, this.led, h('span', { class: 'cl-badge' }, 'METASPLOIT'), h('span', { class: 'cl-model' }, 'CLASSIC 1.0 · MONOCHROME · SIMULATOR')),
      h('div', { class: 'cl-buttons' }, this.btnSound, this.btnVoice, this.btnHum, this.btnSpeed, this.btnPause, this.btnReboot));
    this.root = h('div', { class: 'classic', tabindex: '-1' }, h('div', { class: 'cl-bezel' }, this.screen), this.panel);
    this.win.body.appendChild(this.root);
  }

  #bind() {
    this.win.on('close', () => this.dispose());
    this.win.on('reopen', () => this.win.focus());
    this.win.on('activate', () => this.root.focus({ preventScroll: true }));
    const ro = new ResizeObserver(() => this.layout());
    ro.observe(this.screen);
    this.cleanups.push(() => ro.disconnect());

    // "PRESS ANY KEY": the first tap or key press switches the sound on.
    const wake = () => {
      if (!this.audio.enabled) this.enableAudio();
    };
    this.root.addEventListener('pointerdown', wake);
    this.root.addEventListener('keydown', (e) => {
      wake();
      if (e.key === ' ' && e.target === this.root) {
        e.preventDefault();
        this.setPaused(!this.clock.paused);
      }
    });

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
        if (frozen) this.voice.silence();
      }
    }));
  }

  layout() {
    if (this.disposed) return;
    this.inner.style.setProperty('--cl-fs', '20px');
    const ratio = this.probe.getBoundingClientRect().width / 200 || 0.5;
    const w = this.text.clientWidth || this.screen.clientWidth;
    const want = w < 560 ? 50 : 80;
    const fs = clamp(Math.floor((w - 24) / (want * ratio)), 11, 26);
    this.inner.style.setProperty('--cl-fs', `${fs}px`);
    this.cols = Math.max(30, Math.floor((w - 24) / (fs * ratio)));
  }

  /* ---------- prefs, audio, controls */

  #save() {
    storageSet(PREFS_KEY, this.prefs);
  }

  togglePref(key) {
    this.prefs[key] = !this.prefs[key];
    if (key === 'voice' && !this.prefs.voice) this.voice.silence();
    this.#save();
    this.updateButtons();
  }

  cycleSpeed() {
    this.prefs.typingSpeed = SPEEDS[(SPEEDS.indexOf(this.prefs.typingSpeed) + 1) % SPEEDS.length];
    this.#save();
    this.updateButtons();
  }

  async #tryRestoreAudio() {
    if (this.prefs.audioEnabled && (sound.ready || navigator.userActivation?.isActive)) await this.enableAudio(true);
  }

  async enableAudio(silent = false) {
    const ok = await this.audio.enable();
    if (ok) {
      this.prefs.audioEnabled = true;
      this.#save();
      this.audio.setVolume();
      this.updateButtons();
      await this.voice.enable();
      if (!silent && this.state === 'running') this.voice.say('ready', { force: true });
    }
    this.updateButtons();
    return ok;
  }

  onSound() {
    if (!this.audio.enabled) {
      this.enableAudio();
      return;
    }
    this.prefs.muted = !this.prefs.muted;
    if (this.prefs.muted) this.voice.silence();
    this.audio.setVolume();
    this.#save();
    this.updateButtons();
  }

  setPaused(paused) {
    this.clock.paused = paused;
    this.audio.duck(paused || document.hidden);
    if (paused) this.voice.silence();
    this.root.classList.toggle('cl-paused', paused);
    this.updateButtons();
    this.updateStatus();
  }

  reboot() {
    this.clock.restart();
    this.clock.paused = false;
    this.root.classList.remove('cl-paused');
    this.voice.silence();
    this.term.clear();
    this.mod = null;
    this.screen.classList.remove('cl-poweron', 'cl-poweroff', 'cl-glitch');
    this.screen.classList.add('cl-off');
    this.updateButtons();
    this.start(true);
  }

  updateButtons() {
    if (!this.root) return;
    const on = (v) => (v ? 'ON' : 'OFF');
    this.btnSound.textContent = this.audio.enabled ? `SOUND ${on(!this.prefs.muted)}` : 'SOUND OFF';
    this.btnSound.classList.toggle('on', this.audio.enabled && !this.prefs.muted);
    this.btnVoice.textContent = `VOICE ${on(this.prefs.voice)}`;
    this.btnVoice.classList.toggle('on', !!this.prefs.voice);
    this.btnHum.textContent = `HUM ${on(this.prefs.hum)}`;
    this.btnHum.classList.toggle('on', !!this.prefs.hum);
    this.btnSpeed.textContent = `SPEED ${this.prefs.typingSpeed.toUpperCase()}`;
    this.btnPause.textContent = this.clock.paused ? 'RESUME' : 'PAUSE';
    this.btnReboot.textContent = 'REBOOT';
    this.led.classList.toggle('lit', this.state !== 'off');
    this.updateStatus();
  }

  updateStatus() {
    if (!this.root) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    this.stRight.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} · SIM`;
    let mid;
    if (!this.audio.enabled && sound.supported) mid = '> CLICK SCREEN FOR SOUND <';
    else if (this.clock.paused) mid = '*** PAUSED ***';
    else mid = { off: 'NO SIGNAL', boot: 'BOOTING', running: this.mod ? `MODULE ${this.mod.toUpperCase()}` : 'READY' }[this.state] || '';
    this.stMid.textContent = mid;
    this.stMid.classList.toggle('cl-blink', !this.audio.enabled || this.clock.paused);
  }

  /* ---------- output helpers */

  out(text = '', cls = '') {
    return this.term.print(text, cls);
  }

  async lines(sl, list, a = 40, b = 140) {
    for (const item of list) {
      const [text, cls] = Array.isArray(item) ? item : [item, ''];
      this.out(text, cls);
      await sl.wait(rand(a, b));
    }
  }

  /** Reveals a line at modem speed (characters per second). */
  async baud(sl, text, cps = 600, cls = '') {
    const el = this.out('', cls);
    let next = sl.now();
    for (const ch of text) {
      next += 1000 / cps;
      await sl.until(next);
      el.textContent += ch;
    }
    this.term.scroll();
    return el;
  }

  promptText() {
    return this.mod ? `msf ${this.mod} > ` : 'msf > ';
  }

  /** Types a command after a prompt, with mechanical key clacks, then ENTER. */
  async cmd(sl, text, prompt = this.promptText()) {
    const line = this.term.line('cl-cmd');
    this.term.span(line, prompt, 'cl-prompt');
    const typed = this.term.span(line, '', 'cl-typed');
    const cur = h('span', { class: 'cl-cursor' }, ' ');
    line.appendChild(cur);
    this.updateStatus();
    await sl.wait(rand(450, 1300));
    await this.scheduler.type(sl, text, {
      onChar: (ch) => {
        typed.textContent += ch;
        this.term.scroll();
      },
      onBack: () => {
        typed.textContent = typed.textContent.slice(0, -1);
      },
    });
    await sl.wait(rand(200, 520));
    cur.remove();
    this.audio.sfx('ckey', { level: 1, pitch: 0.82 });
  }

  /** CSS-class pulse on a real timer (purely visual). */
  #pulse(cls, ms) {
    this.screen.classList.remove(cls);
    void this.screen.offsetWidth;
    this.screen.classList.add(cls);
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.screen?.classList.remove(cls);
    }, ms);
    this.timers.add(t);
  }

  /* ---------- lifecycle */

  start(cold) {
    const sl = this.clock.sleeper();
    const guard = (p) => p.catch((e) => {
      if (!(e instanceof Cancelled)) console.error('[classic]', e);
    });
    guard(this.main(sl, cold));
    guard(this.statusLoop(sl));
  }

  async statusLoop(sl) {
    for (;;) {
      this.updateStatus();
      await sl.wait(500);
    }
  }

  /** Infinite loop: boot, then sessions, until a halt forces a cold reboot. */
  async main(sl, cold) {
    for (;;) {
      this.state = 'boot';
      this.updateButtons();
      if (cold) await this.powerOn(sl);
      await this.post(sl);
      await this.bootKernel(sl);
      await this.login(sl);
      await this.banner(sl);
      this.state = 'running';
      this.updateButtons();
      this.voice.say('ready', { force: true });
      let last = 'segModules';
      await this.segModules(sl);
      for (let count = 1; ; count++) {
        await sl.wait(rand(600, 1500));
        if (count > 5 && chance(0.12)) break;
        if (count > 1 && chance(0.16)) await this.glitch(sl);
        let seg = pick(SEGMENTS);
        while (seg === last) seg = pick(SEGMENTS);
        last = seg;
        await this[seg](sl);
      }
      await this.halt(sl);
      cold = true;
    }
  }

  /* ---------- boot sequence */

  async powerOn(sl) {
    this.term.clear();
    this.screen.classList.remove('cl-off', 'cl-poweroff');
    this.#pulse('cl-poweron', 1100);
    this.audio.sfx('cpower');
    await sl.wait(1150);
  }

  async post(sl) {
    this.term.clear();
    await this.lines(sl, [
      'PROTO-BIOS v2.11   (C) 1989 KALI SYSTEMS  [simulated]',
      '',
      'CPU  : 80486DX2-66',
      'FPU  : Integrated',
    ], 60, 160);
    const mem = this.out('Memory Test :      0K');
    for (let k = 0; k <= 16384; k += 512) {
      mem.textContent = `Memory Test : ${String(k).padStart(6)}K${k === 16384 ? ' OK' : ''}`;
      if (k % 2048 === 0) this.audio.sfx('ckey', { level: 0.25, pitch: 1.25 });
      await sl.wait(28);
    }
    await sl.wait(250);
    await this.lines(sl, [
      '',
      'Detecting IDE drives ...',
      '  Primary Master   : KL-540A   540 MB',
      '  Secondary Master : None',
      'Keyboard ........... OK',
      'Mouse .............. Not Found',
    ], 90, 260);
    this.audio.sfx('cbeep');
    await sl.wait(300);
    this.out('');
    this.out('Press DEL to enter SETUP', 'cl-dim');
    await sl.wait(900);
    this.term.clear();
  }

  async bootKernel(sl) {
    this.out('LILO boot: linux');
    await sl.wait(500);
    const load = this.out('Loading linux');
    for (let i = 0; i < 26; i++) {
      load.textContent += '.';
      await sl.wait(35);
    }
    await this.lines(sl, [
      'Uncompressing Linux... Ok, booting the kernel.',
      'Linux version 2.0.36 (root@kali) (gcc version 2.7.2.3) #1 Tue Mar 9 03:14:07 1999',
      'Console: colour VGA+ 80x25, 1 virtual console (max 63)',
      'Calibrating delay loop.. ok - 33.18 BogoMIPS',
      'Memory: 15232k/16384k available (612k kernel code, 384k reserved)',
      'Checking 386/387 coupling... Ok, fpu using exception 16 error reporting.',
      'eth0: NE2000 found at 0x300, using IRQ 3.',
      'Serial driver version 4.13 with no serial options enabled',
      'tty00 at 0x03f8 (irq = 4) is a 16550A',
      'INIT: version 2.74 booting',
      'INIT: Entering runlevel: 3',
    ], 30, 170);
    await sl.wait(500);
  }

  async login(sl) {
    await this.lines(sl, ['', 'Kali GNU/Linux classic   tty1', ''], 60, 120);
    await this.cmd(sl, 'root', 'kali login: ');
    const line = this.term.line();
    this.term.span(line, 'Password: ', 'cl-prompt');
    const cur = h('span', { class: 'cl-cursor' }, ' ');
    line.appendChild(cur);
    await sl.wait(rand(500, 900));
    for (let i = 0; i < 8; i++) {
      this.audio.typing();
      await sl.wait(rand(80, 170));
    }
    cur.remove();
    this.audio.sfx('ckey', { level: 1, pitch: 0.82 });
    await sl.wait(400);
    const d = new Date();
    this.out(`Last login: ${d.toDateString()} ${d.toTimeString().slice(0, 8)} on tty1`);
    await sl.wait(500);
    this.term.clear();
  }

  async banner(sl) {
    for (const l of BANNER) {
      this.out(l, 'cl-bright');
      await sl.wait(70);
    }
    await this.lines(sl, [
      '',
      ['       =[ msf v1.0-classic (simulated)                ]', 'cl-dim'],
      ['+ -- --=[ 6 modules - 0 live targets - 1 operator     ]', 'cl-dim'],
      ['+ -- --=[ black & white console - local simulation   ]', 'cl-dim'],
      '',
    ], 80, 140);
  }

  /* ---------- sessions */

  async segVersion(sl) {
    await this.cmd(sl, 'version');
    await this.lines(sl, ['Framework : 1.0-classic', 'Console   : 1.0-classic', 'Build     : 1999-03-09 (simulated)', '']);
  }

  async segModules(sl) {
    await this.cmd(sl, 'show modules');
    await this.lines(sl, ['', 'Modules', '=======', '', '   Name                    Description', '   ----                    -----------'], 30, 80);
    for (const [name, desc] of MODULES) {
      this.out(`   ${name.padEnd(24)}${desc}`);
      this.audio.sfx('ckey', { level: 0.3, pitch: 1.2 });
      await sl.wait(rand(70, 160));
    }
    this.out('');
  }

  async segSessions(sl) {
    await this.cmd(sl, 'sessions -l');
    await this.lines(sl, ['', 'Active sessions', '===============', '', 'No active sessions.', '']);
  }

  async segClear(sl) {
    await this.cmd(sl, 'clear');
    this.term.clear();
    await sl.wait(300);
  }

  async use(sl, mod) {
    await this.cmd(sl, `use ${mod}`);
    this.mod = mod;
    this.updateStatus();
  }

  async back(sl) {
    await this.cmd(sl, 'back');
    this.mod = null;
    this.updateStatus();
  }

  async set(sl, key, value) {
    await this.cmd(sl, `set ${key} ${value}`);
    this.out(`${key} => ${value}`);
  }

  async segDialer(sl) {
    const number = `555-0${int(100, 199)}`;
    await this.use(sl, 'net/dialer');
    await this.set(sl, 'NUMBER', number);
    await this.cmd(sl, 'run');
    await this.lines(sl, ['[*] Initializing modem on /dev/ttyS0 ...', 'ATZ'], 200, 400);
    await sl.wait(350);
    this.out('OK');
    await sl.wait(300);
    this.out(`ATDT${number.replace('-', '')}`);
    this.audio.sfx('cmodem');
    const dots = this.out('', 'cl-dim');
    for (let i = 0; i < 20; i++) {
      dots.textContent += i % 5 === 4 ? '  ' : '.';
      await sl.wait(250);
    }
    this.out('CONNECT 2400', 'cl-bright');
    this.out('[*] Carrier detected. Connection established.');
    this.voice.say('connect');
    await sl.wait(700);
    const w = Math.min(50, this.cols - 4);
    const box = (s) => `|${s.padEnd(w - 2).slice(0, w - 2)}|`;
    for (const l of [
      `+${'-'.repeat(w - 2)}+`,
      box('   T H E   G R I D   .   B B S   .   NODE 3'),
      box('   EST. 1987                 2400 BAUD  8-N-1'),
      `+${'-'.repeat(w - 2)}+`,
    ]) await this.baud(sl, l, 700, 'cl-bright');
    await sl.wait(300);
    await this.baud(sl, '  LOGIN: guest', 260);
    await this.baud(sl, '  PASSWORD: ******', 260);
    await sl.wait(400);
    await this.baud(sl, '  >> ACCESS GRANTED <<', 400, 'cl-bright');
    this.voice.say('granted');
    await sl.wait(500);
    await this.baud(sl, "  [M]ESSAGES  [F]ILES  [W]HO'S ONLINE  [G]OODBYE", 700);
    await this.baud(sl, '  > M', 200);
    await this.baud(sl, `  -- BULLETIN #${int(100, 999)}  FROM: SYSOP --`, 700, 'cl-dim');
    await sl.wait(500);
    await this.baud(sl, `  ${pick(WHISPERS)}.`, 90, 'cl-bright');
    await sl.wait(1200);
    await this.baud(sl, '  > G', 200);
    await sl.wait(400);
    this.out('NO CARRIER', 'cl-bright');
    this.audio.sfx('cbeep');
    this.out('[*] Connection closed.');
    this.out('');
    await this.back(sl);
  }

  async segScan(sl) {
    const ip = pick(['192.0.2.10', '198.51.100.20', '203.0.113.30', '192.0.2.44']);
    await this.use(sl, 'scan/tcp_ports');
    await this.set(sl, 'RHOST', ip);
    await this.cmd(sl, 'run');
    this.out(`[*] Sweeping ${ip} (simulated) ...`);
    this.voice.say('scan');
    await sl.wait(600);
    this.out('');
    this.out('PORT      STATE     SERVICE');
    const ports = shuffle(OLD_PORTS).slice(0, int(5, 7)).sort((a, b) => a[0] - b[0]);
    let open = 0;
    for (const [port, svc] of ports) {
      const state = pick(['open', 'open', 'open', 'closed', 'filtered']);
      if (state === 'open') open++;
      this.out(`${`${port}/tcp`.padEnd(10)}${state.padEnd(10)}${svc}`, state === 'open' ? 'cl-bright' : 'cl-dim');
      this.audio.sfx('ckey', { level: 0.35, pitch: 1.25 });
      await sl.wait(rand(180, 480));
    }
    this.out('');
    this.out(`[*] ${ports.length} ports checked, ${open} open. Scan complete.`);
    this.out('');
    await this.back(sl);
  }

  async segRot13(sl) {
    const plain = pick(WHISPERS);
    const cipher = rot13(plain);
    await this.use(sl, 'crypto/rot13');
    await this.set(sl, 'TEXT', `"${cipher}"`);
    await this.cmd(sl, 'run');
    this.out('[*] Decoding ...');
    this.voice.say('decrypt');
    await sl.wait(500);
    const el = this.out(cipher, 'cl-bright');
    for (let i = 0; i <= plain.length; i++) {
      let s = plain.slice(0, i);
      for (let j = i; j < plain.length; j++) s += plain[j] === ' ' ? ' ' : GLYPHS[int(0, GLYPHS.length - 1)];
      el.textContent = s;
      if (i % 2 === 0) this.audio.sfx('ckey', { level: 0.2, pitch: 1.3 });
      await sl.wait(55);
    }
    el.textContent = plain;
    await sl.wait(900);
    this.out('');
    await this.back(sl);
  }

  async segDump(sl) {
    const base = int(0x1000, 0xff00);
    await this.cmd(sl, `dump 0x${base.toString(16).toUpperCase()}`);
    for (let r = 0; r < 10; r++) {
      const bytes = Array.from({ length: 8 }, () => int(0, 255));
      const hx = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const asc = bytes.map((b) => (b > 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      this.out(`${(base + r * 8).toString(16).toUpperCase().padStart(8, '0')}  ${hx}  |${asc}|`, 'cl-dim');
      await sl.wait(rand(40, 90));
    }
    this.out(`[*] Checksum ${hex(8).toUpperCase()} OK`);
    this.out('');
  }

  async segAudit(sl) {
    await this.use(sl, 'audit/passwd_policy');
    await this.cmd(sl, 'run');
    this.out('[*] Auditing the local password policy (simulated) ...');
    await sl.wait(700);
    const rows = [
      ['minimum length', String(pick([4, 5, 6])), true],
      ['password aging', pick(['off', '365 days']), true],
      ['lockout threshold', pick(['none', '10 tries']), true],
      ['hash algorithm', pick(['des', 'md5']), true],
      ['shadow file', 'present', false],
    ];
    let weak = 0;
    for (const [label, value, bad] of rows) {
      this.out(`   ${label.padEnd(22, '.')} ${value.padEnd(10)} ${bad ? 'WEAK' : 'OK'}`, bad ? 'cl-bright' : 'cl-dim');
      if (bad) weak++;
      await sl.wait(rand(220, 480));
    }
    this.out('');
    this.out(`[!] ${weak} weaknesses found. Recommend a stronger policy.`, 'cl-bright');
    this.audio.sfx('cerror');
    this.voice.say('warning');
    this.out('');
    await this.back(sl);
  }

  /* ---------- horror */

  async glitch(sl) {
    this.#pulse('cl-glitch', 420);
    this.audio.sfx('cglitch');
    await sl.wait(260);
    if (chance(0.55)) {
      this.out(`*** PARITY ERROR AT 0x${hex(4).toUpperCase()} - RECOVERING ***`, 'cl-bright cl-blink');
      this.voice.say('warning');
      await sl.wait(900);
    }
  }

  async halt(sl) {
    this.out('');
    this.out('*** SYSTEM HALTED ***', 'cl-bright cl-blink');
    this.audio.sfx('cerror');
    this.voice.say('halt', { force: true });
    await sl.wait(1700);
    this.state = 'off';
    this.mod = null;
    this.screen.classList.add('cl-poweroff');
    await sl.wait(760);
    this.screen.classList.add('cl-off');
    this.screen.classList.remove('cl-poweroff');
    this.term.clear();
    this.updateButtons();
    await sl.wait(1800);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.clock.dispose();
    this.audio.dispose();
    this.voice.dispose();
    this.cleanups.forEach((fn) => fn());
    this.term.dispose();
    this.root.remove();
    this.root = null;
  }
}

export function mount(win) {
  win.setTitle('Metasploit Classic');
  const app = new ClassicConsole(win);
  win.classic = app;
  return app;
}
