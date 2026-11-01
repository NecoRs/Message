// Hollywood-mode panels. Each panel runs its own coroutine on the shared
// simulation clock and reacts to scenario events on the app bus, so the
// windows move together without showing the same kind of content.
import { TerminalRenderer, bar } from './render.js';
import { SNIPPETS, highlight, rand, int, pick, chance, hex, fmtInt, logLine, processTable, statusClass, DOC_NODES } from './data.js';
import { mqReducedMotion } from '../../core/util.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const flash = (node) => {
  node.classList.remove('ph-flash');
  void node.offsetWidth;
  node.classList.add('ph-flash');
};

class Pane {
  constructor(app, body) {
    this.app = app;
    this.body = body;
    this.visible = false;
    this.offs = [];
  }

  async idle(sl) {
    while (!this.visible) await sl.wait(500);
  }

  on(type, fn) {
    this.offs.push(this.app.bus.on(type, fn));
  }

  /** Panels that only react to bus events have no coroutine. */
  async loop() {}

  reset() {}

  dispose() {
    this.offs.forEach((off) => off());
    this.offs = [];
  }
}

/* -------------------------------------------------------------- code */

/** Types a code snippet line by line with syntax colouring. */
export async function typeCode(term, snippet, sl, app, { shouldStop = () => false, speed = 0.45, sound = 0.25 } = {}) {
  term.seg([['┌─ ', 'ph-dim'], [snippet.file, 'ph-file'], [`  ${snippet.lang}`, 'ph-dim']]);
  const lines = snippet.code.split('\n');
  for (let n = 0; n < lines.length; n++) {
    if (shouldStop()) {
      term.seg([['└─ ', 'ph-dim'], ['stream switched', 'ph-dim']]);
      return false;
    }
    const text = lines[n];
    const line = term.line('ph-code');
    term.span(line, `${String(n + 1).padStart(3)}  `, 'ph-gutter');
    const indent = text.match(/^\s*/)[0];
    if (indent) term.span(line, indent);
    const cursor = el('span', 'ph-cursor ph-cursor-thin');
    line.appendChild(cursor);
    for (const [chunk, cls] of highlight(snippet.lang, text.slice(indent.length))) {
      const span = el('span', cls);
      line.insertBefore(span, cursor);
      let next = sl.now();
      for (const ch of chunk) {
        next += app.typing.base * speed * (0.35 + Math.random() * 1.05);
        await sl.until(next);
        span.textContent += ch;
        if (sound && ch !== ' ' && Math.random() < sound) app.audio.sfx('type', { level: 0.45, pitch: 1.15 });
      }
    }
    cursor.remove();
    term.scroll();
    await sl.wait(text.trim() === '' ? rand(160, 420) : rand(25, 130));
    if (chance(0.03)) await sl.wait(rand(400, 1100)); // thinking
  }
  term.seg([['└─ ', 'ph-dim'], [`${lines.length} lines`, 'ph-dim'], ['   ✓ syntax ok', 'st-ok']]);
  return true;
}

export class CodePane extends Pane {
  constructor(app, body) {
    super(app, body);
    this.term = new TerminalRenderer(body, { maxLines: 220 });
    this.queue = [];
    this.last = null;
  }

  /** Queues a snippet; resolves once it has been typed. */
  enqueue(snippet) {
    return new Promise((resolve) => this.queue.push({ snippet, resolve }));
  }

  async loop(sl) {
    for (;;) {
      await this.idle(sl);
      const job = this.queue.shift();
      let snippet = job?.snippet;
      if (!snippet) {
        const pool = SNIPPETS.filter((s) => s !== this.last);
        snippet = pick(pool);
      }
      this.last = snippet;
      this.app.setPaneMeta('code', snippet.file);
      await typeCode(this.term, snippet, sl, this.app, { shouldStop: () => !job && this.queue.length > 0 });
      job?.resolve();
      await sl.wait(rand(900, 2000));
      this.term.blank();
    }
  }

  reset() {
    this.term.clear();
    this.queue.forEach((j) => j.resolve());
    this.queue = [];
  }

  dispose() {
    super.dispose();
    this.term.dispose();
  }
}

/* ----------------------------------------------------------- network */

export class NetPane extends Pane {
  constructor(app, body) {
    super(app, body);
    this.grid = el('div', 'ph-grid ph-grid-net');
    this.foot = el('div', 'ph-pane-foot');
    body.append(this.grid, this.foot);
    this.rx = 12.4;
    this.tx = 3.1;
    this.build();
    this.on('net', ({ node, state, latency }) => {
      const row = this.rows.find((r) => r.node === node);
      if (!row) return;
      if (state) this.setState(row, state);
      if (latency != null) this.setLatency(row, latency);
    });
  }

  build() {
    this.grid.replaceChildren();
    const head = el('div', 'ph-grid-row ph-grid-head');
    ['NODE', 'ADDRESS', 'STATE', 'MS'].forEach((t) => head.appendChild(el('span', null, t)));
    this.grid.appendChild(head);
    this.rows = DOC_NODES.slice(0, 6).map(({ node, ip }) => {
      const r = { node, ip, state: 'SYNCED', latency: rand(2, 38) };
      r.el = el('div', 'ph-grid-row');
      r.stateEl = el('span', statusClass('SYNCED'), 'SYNCED');
      r.latEl = el('span', 'ph-num', r.latency.toFixed(1));
      r.el.append(el('span', 'ph-strong', node), el('span', 'ph-dim2', ip), r.stateEl, r.latEl);
      this.grid.appendChild(r.el);
      return r;
    });
  }

  setState(r, state) {
    r.state = state;
    r.stateEl.textContent = state;
    r.stateEl.className = statusClass(state);
    flash(r.el);
  }

  setLatency(r, v) {
    r.latency = v;
    r.latEl.textContent = v.toFixed(1);
    r.latEl.className = v > 120 ? 'ph-num st-warn' : 'ph-num';
    flash(r.latEl);
  }

  async loop(sl) {
    for (;;) {
      await this.idle(sl);
      await sl.wait(rand(600, 1600));
      const r = pick(this.rows);
      const degraded = r.state === 'DEGRADED';
      this.setLatency(r, degraded ? rand(120, 260) : Math.max(1, r.latency + rand(-6, 6)));
      if (r.state === 'SYNCED' && chance(0.04)) this.setState(r, 'DEGRADED');
      else if (degraded && chance(0.3)) this.setState(r, 'SYNCED');
      const L = this.app.status.load;
      this.rx = Math.max(0.4, this.rx + rand(-2, 2) + (L * 40 - this.rx) * 0.12);
      this.tx = Math.max(0.1, this.tx + rand(-0.8, 0.8) + (L * 9 - this.tx) * 0.12);
      this.foot.textContent = `RX ${this.rx.toFixed(1)} MB/s   TX ${this.tx.toFixed(1)} MB/s   streams 3   nodes ${this.rows.length}`;
    }
  }

  reset() {
    this.build();
  }
}

/* -------------------------------------------------------- activity */

export class ActivityPane extends Pane {
  constructor(app, body) {
    super(app, body);
    this.canvas = el('canvas', 'ph-spark');
    this.label = el('div', 'ph-spark-label', 'CPU HISTORY');
    this.grid = el('div', 'ph-grid ph-grid-proc');
    body.append(this.label, this.canvas, this.grid);
    this.procs = processTable(6);
    this.render();
    this.on('status', () => this.visible && this.draw());
  }

  render() {
    const head = el('div', 'ph-grid-row ph-grid-head');
    ['PID', 'PROCESS', 'CPU', 'MEM', 'STATUS'].forEach((t) => head.appendChild(el('span', null, t)));
    const rows = [...this.procs].sort((a, b) => b.cpu - a.cpu).map((p) => {
      const r = el('div', 'ph-grid-row');
      r.title = `${p.name} (${p.user})`;
      r.append(el('span', 'ph-dim2', p.pid), el('span', 'ph-strong', p.name),
        el('span', `ph-num${p.cpu > 60 ? ' st-warn' : ''}`, `${p.cpu.toFixed(1)}%`), el('span', 'ph-num', `${p.mem.toFixed(1)}%`),
        el('span', statusClass(p.status), p.status));
      return r;
    });
    this.grid.replaceChildren(head, ...rows);
  }

  draw() {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(this.body);
    const color = css.getPropertyValue('--ph-fg').trim() || '#00ff88';
    g.strokeStyle = 'rgba(255,255,255,.06)';
    g.lineWidth = 1;
    for (let y = 0.5; y < h; y += h / 4) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    const hist = this.app.status.cpuHistory;
    g.beginPath();
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * w;
      const y = h - (v / 100) * (h - 4) - 2;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.shadowColor = color;
    g.shadowBlur = 6;
    g.stroke();
    g.shadowBlur = 0;
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.globalAlpha = 0.12;
    g.fillStyle = color;
    g.fill();
    g.globalAlpha = 1;
  }

  async loop(sl) {
    for (;;) {
      await this.idle(sl);
      await sl.wait(rand(1100, 1700));
      const L = this.app.status.load;
      for (const p of this.procs) {
        p.cpu = Math.max(0.1, Math.min(97, p.cpu + rand(-5, 5) + (L * 45 * (p.name.startsWith('parser') || p.name === 'indexer' ? 1.3 : 0.4) - p.cpu) * 0.25));
        p.mem = Math.max(0.2, Math.min(40, p.mem + rand(-0.4, 0.5)));
        if (chance(0.06)) p.status = p.cpu > 2 ? 'RUNNING' : pick(['SLEEPING', 'IDLE']);
      }
      if (chance(0.08)) {
        this.procs[int(0, this.procs.length - 1)] = processTable(1)[0];
      }
      this.render();
    }
  }

  reset() {
    this.procs = processTable(6);
    this.render();
  }
}

/* ------------------------------------------------------------- logs */

export class LogsPane extends Pane {
  constructor(app, body) {
    super(app, body);
    this.term = new TerminalRenderer(body, { maxLines: 150 });
    this.on('log', (entry) => this.write(entry));
  }

  write({ time, level, source, msg }) {
    if (!this.visible) return;
    const cls = { INFO: 'st-ok', DEBUG: 'ph-dim', WARN: 'st-warn', ERROR: 'st-err' }[level] || '';
    this.term.seg([[`${time} `, 'ph-dim'], [level.padEnd(6), cls], [`${source.padEnd(11)} `, 'ph-info'], [msg, level === 'DEBUG' ? 'ph-dim' : '']]);
  }

  async loop(sl) {
    for (;;) {
      await this.idle(sl);
      const L = this.app.status.load;
      await sl.wait(rand(220, 1200) * (1 - L * 0.6));
      this.write(logLine(L));
      if (chance(0.15)) {
        await sl.wait(rand(40, 120));
        this.write(logLine(L));
      }
    }
  }

  reset() {
    this.term.clear();
  }

  dispose() {
    super.dispose();
    this.term.dispose();
  }
}

/* -------------------------------------------------------- data analysis */

export class DataPane extends Pane {
  constructor(app, body) {
    super(app, body);
    this.metrics = el('div', 'ph-metrics');
    this.list = el('div', 'ph-tasks');
    body.append(this.metrics, this.list);
    this.tasks = [];
    this.anomalies = 0;
    this.confidence = 97.2;
    this.metricEls = {};
    for (const [k, label] of [['rate', 'RECORDS/S'], ['anom', 'ANOMALIES'], ['conf', 'CONFIDENCE']]) {
      const v = el('div', 'ph-metric-value', '—');
      this.metricEls[k] = v;
      this.metrics.appendChild(el('div', 'ph-metric')).append(el('div', 'ph-metric-label', label), v);
    }
    this.on('processing:start', ({ label, ms }) => this.spawn(label, ms, true));
    this.on('anomaly', (n) => {
      this.anomalies += n;
      this.updateMetrics();
      flash(this.metricEls.anom);
    });
    this.on('status', () => this.visible && this.updateMetrics());
  }

  updateMetrics() {
    this.metricEls.rate.textContent = fmtInt(this.app.status.rate);
    this.metricEls.anom.textContent = String(this.anomalies);
    this.metricEls.anom.className = `ph-metric-value${this.anomalies ? ' st-warn' : ''}`;
    this.confidence = Math.max(88, Math.min(99.9, this.confidence + rand(-0.3, 0.3)));
    this.metricEls.conf.textContent = `${this.confidence.toFixed(1)}%`;
  }

  spawn(label, ms, priority = false) {
    const row = el('div', `ph-task${priority ? ' ph-task-hot' : ''}`);
    const name = el('span', 'ph-task-name', label);
    const barEl = el('span', 'ph-task-bar');
    const fill = el('span', 'ph-task-fill');
    barEl.appendChild(fill);
    const pct = el('span', 'ph-num', '0%');
    const result = el('span', 'ph-task-result st-proc', 'PROCESSING');
    row.append(name, barEl, pct, result);
    row.title = label;
    this.list.prepend(row);
    const task = { row, fill, pct, result, start: this.app.clock.t, ms, done: false };
    this.tasks.unshift(task);
    while (this.tasks.length > 6) this.tasks.pop().row.remove();
    return task;
  }

  async loop(sl) {
    const labels = ['entropy profile', 'dedupe events', 'rebuild index', 'compress archive', 'sessionize logs', 'rollup metrics', 'validate schema', 'checksum blocks'];
    let nextSpawn = 0;
    for (;;) {
      await this.idle(sl);
      await sl.wait(110);
      const t = this.app.clock.t;
      if (t > nextSpawn && this.tasks.filter((x) => !x.done).length < 3) {
        this.spawn(pick(labels), rand(2500, 9000));
        nextSpawn = t + rand(2500, 7000);
      }
      for (const task of this.tasks) {
        if (task.done) continue;
        const f = Math.min(1, (t - task.start) / task.ms);
        task.fill.style.width = `${(f * 100).toFixed(1)}%`;
        task.pct.textContent = `${Math.floor(f * 100)}%`;
        if (f >= 1) {
          task.done = true;
          const flagged = chance(0.1);
          task.result.textContent = flagged ? 'FLAGGED' : 'COMPLETE';
          task.result.title = `${((t - task.start) / 1000).toFixed(1)}s`;
          task.result.className = `ph-task-result ${flagged ? 'st-warn' : 'st-ok'}`;
          task.row.classList.add('done');
          if (flagged) this.app.bus.emit('anomaly', 1);
        }
      }
    }
  }

  reset() {
    this.tasks.forEach((t) => t.row.remove());
    this.tasks = [];
    this.anomalies = 0;
  }
}

/* ------------------------------------------------------ binary stream */

export class BinaryPane extends Pane {
  constructor(app, body) {
    super(app, body);
    this.canvas = el('canvas', 'ph-rain');
    const scroller = el('div', 'ph-hex');
    body.append(this.canvas, scroller);
    this.term = new TerminalRenderer(scroller, { maxLines: 90 });
    this.offset = int(0x10000, 0xfff00) & ~0xf;
    this.drops = [];
    this.acc = 0;
    this.offFrame = app.clock.onFrame((dt, frozen) => this.frame(dt, frozen));
  }

  frame(dt, frozen) {
    if (!this.visible || frozen || mqReducedMotion.matches) return;
    this.acc += dt * this.app.clock.speed;
    if (this.acc < 45) return;
    this.acc = 0;
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    const g = c.getContext('2d');
    const size = 12;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      this.drops = Array.from({ length: Math.ceil(w / size) }, () => rand(-h / size, 0));
    }
    const css = getComputedStyle(this.body);
    const color = css.getPropertyValue('--ph-fg').trim() || '#00ff88';
    g.fillStyle = 'rgba(3, 5, 7, 0.24)';
    g.fillRect(0, 0, w, h);
    g.font = `${size - 1}px "JetBrains Mono", monospace`;
    const glyphs = '01010101ABCDEF0123456789';
    for (let i = 0; i < this.drops.length; i++) {
      if (Math.random() < 0.18) continue; // a few idle columns keep it subtle
      const y = this.drops[i] * size;
      g.fillStyle = Math.random() < 0.1 ? '#e8fff4' : color;
      g.globalAlpha = 0.55 + Math.random() * 0.45;
      g.fillText(glyphs[int(0, glyphs.length - 1)], i * size, y);
      if (y > h && Math.random() > 0.96) this.drops[i] = 0;
      this.drops[i] += 1;
    }
    g.globalAlpha = 1;
  }

  async loop(sl) {
    let count = 0;
    for (;;) {
      await this.idle(sl);
      await sl.wait(rand(110, 320) * (1 - this.app.status.load * 0.5));
      const bytes = Array.from({ length: 16 }, () => int(0, 255));
      const hexs = bytes.map((b) => b.toString(16).padStart(2, '0'));
      const ascii = bytes.map((b) => (b >= 33 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      this.term.seg([[`0x${this.offset.toString(16).padStart(8, '0')}  `, 'ph-dim'], [`${hexs.slice(0, 8).join(' ')}  ${hexs.slice(8).join(' ')}  `, ''], [`|${ascii}|`, 'ph-dim2']]);
      this.offset += 16;
      if (++count % 8 === 0) {
        const warn = chance(0.06);
        this.term.seg([['BLOCK ', 'ph-info'], [`0x${hex(4)}  `, ''], ['CRC32 ', 'ph-dim'], [`${hex(8)}  `, ''], [warn ? 'RETRY' : 'OK', warn ? 'st-warn' : 'st-ok']]);
      }
    }
  }

  reset() {
    this.term.clear();
  }

  dispose() {
    super.dispose();
    this.offFrame();
    this.term.dispose();
  }
}

/* -------------------------------------------------------- system status */

export class StatusPane extends Pane {
  constructor(app, body) {
    super(app, body);
    this.items = {};
    const gauges = [['cpu', 'CPU LOAD', true], ['mem', 'MEMORY USAGE', true], ['modules', 'ACTIVE MODULES', true], ['queue', 'TASK QUEUE', true], ['rate', 'PROCESSING RATE', false], ['uptime', 'SYSTEM UPTIME', false]];
    for (const [key, label, hasBar] of gauges) {
      const row = el('div', 'ph-gauge');
      const value = el('span', 'ph-gauge-value', '—');
      row.append(el('span', 'ph-gauge-label', label), value);
      let fill = null;
      if (hasBar) {
        const b = el('span', 'ph-gauge-bar');
        fill = el('span', 'ph-gauge-fill');
        b.appendChild(fill);
        row.appendChild(b);
      }
      body.appendChild(row);
      this.items[key] = { value, fill };
    }
    this.on('status', () => this.visible && this.update());
  }

  update() {
    const s = this.app.status;
    const set = (k, text, frac, warn) => {
      const it = this.items[k];
      it.value.textContent = text;
      it.value.classList.toggle('st-warn', !!warn);
      if (it.fill) {
        it.fill.style.width = `${Math.round(frac * 100)}%`;
        it.fill.classList.toggle('warn', !!warn);
      }
    };
    set('cpu', `${s.cpu.toFixed(0)}%`, s.cpu / 100, s.cpu > 85);
    set('mem', `${s.mem.toFixed(0)}%`, s.mem / 100, s.mem > 85);
    set('modules', `${s.modules} / 42`, s.modules / 42);
    set('queue', String(s.queue), Math.min(1, s.queue / 60), s.queue > 45);
    set('rate', `${fmtInt(s.rate)} rec/s`);
    set('uptime', s.uptime);
  }
}

export { bar };
