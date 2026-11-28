import fs from 'node:fs';
import * as acorn from 'acorn';

const INVISIBLE = new RegExp('[' + [[0xAD, 0xAD], [0x61C, 0x61C], [0x180E, 0x180E], [0x200B, 0x200F], [0x2028, 0x202E], [0x2060, 0x206F], [0xFEFF, 0xFEFF], [0xFFF9, 0xFFFB]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');
const esc = (ch) => '\\u' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');

function tidy(src, ranges) {
  ranges.sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  const touched = new Set();
  for (const { start, end } of ranges) {
    let s = start;
    let e = end;
    const lineStart = src.lastIndexOf('\n', s - 1) + 1;
    const before = src.slice(lineStart, s);
    let lineEnd = src.indexOf('\n', e);
    if (lineEnd < 0) lineEnd = src.length;
    const after = src.slice(e, lineEnd);
    if (!before.trim() && !after.trim()) {
      s = lineStart;
      e = Math.min(src.length, lineEnd + 1);
    } else {
      while (s > pos && (src[s - 1] === ' ' || src[s - 1] === '\t')) s--;
      if (!before.trim()) { while (e < src.length && (src[e] === ' ' || src[e] === '\t')) e++; }
    }
    if (s < pos) s = pos;
    out += src.slice(pos, s);
    touched.add(out.length);
    pos = e;
  }
  out += src.slice(pos);
  const lines = out.split('\n');
  let idx = 0;
  const marks = [...touched].sort((a, b) => a - b);
  let mi = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = idx + lines[i].length;
    let hit = false;
    while (mi < marks.length && marks[mi] <= end) { if (marks[mi] >= idx) hit = true; mi++; }
    if (hit) lines[i] = lines[i].replace(/\{\s+\}/g, '{}').replace(/\s+$/, '');
    idx = end + 1;
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s*\n/, '');
}

export function stripJs(src, { keepBang = false } = {}) {
  const comments = [];
  const fixes = [];
  const opts = { ecmaVersion: 'latest', sourceType: /^\s*(import|export)\b/m.test(src) ? 'module' : 'script', allowHashBang: true, onComment: comments };
  for (const tok of acorn.tokenizer(src, opts)) {
    if (tok.type === acorn.tokTypes.regexp) {
      const raw = src.slice(tok.start, tok.end);
      const fixed = raw.replace(/[^\x00-\x7F]/g, esc);
      if (fixed !== raw) fixes.push({ start: tok.start, end: tok.end, text: fixed });
    } else if (tok.type === acorn.tokTypes.string || tok.type === acorn.tokTypes.template) {
      const raw = src.slice(tok.start, tok.end);
      const fixed = raw.replace(INVISIBLE, esc);
      if (fixed !== raw) fixes.push({ start: tok.start, end: tok.end, text: fixed });
    }
  }
  let patched = src;
  for (const f of fixes.sort((a, b) => b.start - a.start)) patched = patched.slice(0, f.start) + f.text + patched.slice(f.end);
  if (fixes.length) return stripJs(patched, { keepBang });
  const drop = comments.filter((c) => !(keepBang && c.type === 'Block' && c.value.startsWith('!')));
  const out = tidy(src, drop.map((c) => ({ start: c.start, end: c.end })));
  acorn.parse(out, opts);
  return out;
}

export function stripCss(src) {
  const ranges = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      ranges.push({ start: i, end: end < 0 ? src.length : end + 2 });
      i = end < 0 ? src.length : end + 2;
    } else i++;
  }
  return tidy(src, ranges);
}

export function stripHtml(src) {
  let out = '';
  let pos = 0;
  const re = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>|<!--[\s\S]*?-->/gi;
  let m;
  const ranges = [];
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) { ranges.push({ start: m.index, end: m.index + m[0].length }); continue; }
    const inner = m[2];
    const innerStart = m.index + m[0].indexOf('>') + 1;
    if (!inner.trim() || /\bsrc=/.test(m[0].slice(0, m[0].indexOf('>')))) continue;
    const cleaned = m[1].toLowerCase() === 'script' ? stripJs(inner) : stripCss(inner);
    ranges.push({ start: innerStart, end: innerStart + inner.length, text: cleaned.endsWith('\n') ? cleaned : cleaned + '\n' });
  }
  const commentsOnly = ranges.filter((r) => r.text === undefined);
  const repl = ranges.filter((r) => r.text !== undefined);
  for (const r of repl.sort((a, b) => a.start - b.start)) { out += src.slice(pos, r.start) + r.text; pos = r.end; }
  out += src.slice(pos);
  if (!commentsOnly.length) return out;
  const re2 = /<!--[\s\S]*?-->/g;
  const cr = [];
  while ((m = re2.exec(out))) cr.push({ start: m.index, end: m.index + m[0].length });
  return tidy(out, cr);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of process.argv.slice(2)) {
    const src = fs.readFileSync(file, 'utf8');
    const out = file.endsWith('.css') ? stripCss(src) : file.endsWith('.html') ? stripHtml(src) : stripJs(src);
    fs.writeFileSync(file, out);
    console.log(file, src.length, '->', out.length);
  }
}
