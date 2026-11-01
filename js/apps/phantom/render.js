// TerminalRenderer (bounded line buffer with sticky auto-scroll) and
// TableGenerator (msfconsole / nmap style aligned tables that reveal row by
// row and can update cells in place).
import { statusClass, rand, highlight } from './data.js';

export class TerminalRenderer {
  constructor(scrollEl, { maxLines = 400 } = {}) {
    this.scrollEl = scrollEl;
    this.box = document.createElement('div');
    this.box.className = 'ph-lines';
    scrollEl.appendChild(this.box);
    this.max = maxLines;
    this.stick = true;
    this.pending = false;
    this.onScroll = () => {
      const s = this.scrollEl;
      this.stick = s.scrollHeight - s.scrollTop - s.clientHeight < 48;
    };
    scrollEl.addEventListener('scroll', this.onScroll, { passive: true });
  }

  line(cls = '') {
    const el = document.createElement('div');
    el.className = cls ? `ph-line ${cls}` : 'ph-line';
    this.box.appendChild(el);
    this.trim();
    this.scroll();
    return el;
  }

  span(parent, text, cls) {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    parent.appendChild(s);
    return s;
  }

  /** parts: string or array of strings / [text, cls] pairs. */
  seg(parts, cls = '') {
    const el = this.line(cls);
    for (const p of Array.isArray(parts) ? parts : [parts]) {
      if (Array.isArray(p)) this.span(el, p[0], p[1]);
      else this.span(el, p);
    }
    return el;
  }

  print(text, cls = '') {
    const el = this.line(cls);
    el.textContent = text;
    return el;
  }

  blank() {
    return this.line('ph-blank');
  }

  clear() {
    this.box.replaceChildren();
    this.stick = true;
  }

  scroll() {
    if (!this.stick || this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
    });
  }

  trim() {
    while (this.box.childElementCount > this.max) this.box.firstElementChild.remove();
  }

  dispose() {
    this.scrollEl.removeEventListener('scroll', this.onScroll);
  }
}

/** Writes one highlighted code line, revealing characters with `typeChars`. */
export function codeLine(term, lang, text, number) {
  const el = term.line('ph-code');
  term.span(el, String(number).padStart(3, ' ') + '  ', 'ph-gutter');
  const parts = highlight(lang, text);
  return { el, parts };
}

const flash = (el, cls = 'ph-flash') => {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
};

export class TableGenerator {
  constructor(term) {
    this.term = term;
  }

  /**
   * def = { title, columns: [{key, label, min}], rows: [{...}], indent }
   * Each row may carry `<key>Cls` to force a cell class.
   */
  async render(def, { sleeper, audio, rowDelay = [70, 190] }) {
    const t = this.term;
    const indent = ' '.repeat(def.indent ?? 2);
    const widths = def.columns.map((c) => Math.max(c.min || 0, c.label.length, ...def.rows.map((r) => String(r[c.key] ?? '').length)) + 2);
    if (def.title) {
      t.blank();
      t.seg([[indent + def.title, 'ph-table-title']]);
      t.seg([[indent + '='.repeat(def.title.length), 'ph-table-rule']]);
      await sleeper.wait(rand(120, 260));
      t.blank();
    }
    t.seg([[indent + def.columns.map((c, i) => c.label.padEnd(widths[i])).join(''), 'ph-table-head']]);
    t.seg([[indent + def.columns.map((c, i) => '-'.repeat(c.label.length).padEnd(widths[i])).join(''), 'ph-table-rule']]);
    audio?.sfx('row', { level: 0.8 });
    const rows = [];
    for (const r of def.rows) {
      await sleeper.wait(rand(rowDelay[0], rowDelay[1]));
      const el = t.line('ph-table-row');
      t.span(el, indent);
      const cells = new Map();
      def.columns.forEach((c, i) => {
        const v = String(r[c.key] ?? '');
        const cls = r[`${c.key}Cls`] ?? (c.status ? statusClass(v) : c.cls || '');
        cells.set(c.key, t.span(el, v.padEnd(widths[i]), cls));
      });
      rows.push({ el, cells });
      audio?.sfx('row');
      flash(el, 'ph-reveal');
    }
    return {
      rows,
      widths,
      set(i, key, value, cls) {
        const row = rows[i];
        if (!row) return;
        const span = row.cells.get(key);
        const col = def.columns.findIndex((c) => c.key === key);
        if (!span || col < 0) return;
        span.textContent = String(value).padEnd(widths[col]);
        const c = def.columns[col];
        span.className = cls ?? (c.status ? statusClass(value) : c.cls || '');
        flash(span);
      },
    };
  }
}

/** Box-drawn summary block. rows = [[label, value, cls]]. */
export function box(term, title, rows, width = 52) {
  const inner = width - 2;
  const head = `┌─ ${title} `;
  term.seg([[head + '─'.repeat(Math.max(0, width - head.length - 1)) + '┐', 'ph-box']]);
  for (const [label, value, cls] of rows) {
    const l = ` ${label.padEnd(20)}`;
    const v = String(value);
    const pad = Math.max(0, inner - l.length - v.length);
    term.seg([['│', 'ph-box'], [l, 'ph-box-label'], [v, cls || 'ph-box-value'], [' '.repeat(pad), ''], ['│', 'ph-box']]);
  }
  term.seg([['└' + '─'.repeat(inner) + '┘', 'ph-box']]);
}

export const bar = (fraction, width = 24) => {
  const f = Math.max(0, Math.min(1, fraction));
  const full = Math.round(f * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
};
