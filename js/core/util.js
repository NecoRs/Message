// Small DOM and formatting helpers shared by every module.

/**
 * Tiny hyperscript helper.
 *   h('button', { class: 'btn', onclick: fn, 'aria-label': 'Close' }, 'Text', childNode)
 * Props: class, style (string or object), dataset (object), html (innerHTML),
 * on<event> listeners, booleans for attributes, everything else as attributes.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else Object.assign(el.style, v);
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function rafThrottle(fn) {
  let queued = false;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${(++idCounter).toString(36)}`;

/** Thunar style sizes: "4.0 KiB", "1.2 MiB". */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} byte${bytes === 1 ? '' : 's'}`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

const pad = (n) => String(n).padStart(2, '0');

export function formatTime(d, { h24 = true, seconds = false } = {}) {
  let hh = d.getHours();
  const mm = pad(d.getMinutes());
  const ss = seconds ? `:${pad(d.getSeconds())}` : '';
  if (h24) return `${pad(hh)}:${mm}${ss}`;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return `${hh}:${mm}${ss} ${ampm}`;
}

/** File manager style dates: "Today at 07:10", "Yesterday at 22:01", "2026-10-28". */
export function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  const t = formatTime(d);
  if (diff === 0) return `Today at ${t}`;
  if (diff === 1) return `Yesterday at ${t}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const mqMobile = window.matchMedia('(max-width: 767px), (max-height: 480px) and (pointer: coarse)');
export const mqCoarse = window.matchMedia('(pointer: coarse)');
export const mqReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Calls `cb(event)` when a touch is held still for 500 ms, so touch screens
 * can reach context menus. Returns a cleanup function.
 */
export function onLongPress(el, cb) {
  let timer = null;
  let start = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  const down = (e) => {
    if (e.pointerType !== 'touch') return;
    start = { x: e.clientX, y: e.clientY };
    const target = e.target;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      el.dataset.longpress = '1';
      cb({ clientX: start.x, clientY: start.y, target, preventDefault() {}, stopPropagation() {} });
      setTimeout(() => delete el.dataset.longpress, 400);
    }, 500);
  };
  const move = (e) => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', cancel);
    el.removeEventListener('pointercancel', cancel);
  };
}

/** True while a long press just fired on `el` (used to swallow the follow-up click). */
export const longPressed = (el) => el.dataset.longpress === '1';

export function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Tracks selection-like state for keyboard focus inside lists. */
export function isTextInput(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}
