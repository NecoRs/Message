// Context menus, dropdown menus, menubars and popovers. Only one popup tree
// is open at a time; clicking outside, pressing Escape or blurring closes it.
import { h } from './util.js';
import { icon } from './icons.js';

let layer = null;
let current = null; // the root popup that is open

function getLayer() {
  if (!layer) {
    layer = document.getElementById('popups') || document.body.appendChild(h('div', { id: 'popups' }));
  }
  return layer;
}

export function closeMenus() {
  current?.close();
  current = null;
}

export const isMenuOpen = () => !!current;

function onOutside(e) {
  if (!current) return;
  const t = e.target;
  if (t.closest?.('.popup')) return;
  if (current.opts.ignore?.(t)) return;
  closeMenus();
}

function onKey(e) {
  if (!current) return;
  const deepest = current.deepest();
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (deepest !== current && deepest.parentMenu) {
      deepest.parentMenu.closeSub(true);
      return;
    }
    const back = current.opts.returnFocus;
    closeMenus();
    back?.focus?.({ preventScroll: true });
    return;
  }
  if (deepest.handleKey?.(e)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', () => closeMenus());
  window.addEventListener('resize', () => closeMenus());
}

/* --------------------------------------------------------------- popup */

class Popup {
  constructor(opts = {}) {
    this.opts = opts;
    this.el = null;
    this.child = null;
    this.parentMenu = null;
  }

  deepest() {
    return this.child ? this.child.deepest() : this;
  }

  mount(el, pos) {
    this.el = el;
    el.classList.add('popup');
    getLayer().appendChild(el);
    this.place(pos);
    requestAnimationFrame(() => el.classList.add('open'));
  }

  place(pos) {
    const el = this.el;
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.maxHeight = `${vh - 8}px`;
    const r = el.getBoundingClientRect();
    let x;
    let y;
    if (pos.anchor) {
      const a = pos.anchor.getBoundingClientRect();
      if (pos.side === 'right') {
        x = a.right - 2;
        y = a.top - 4;
        if (x + r.width > vw - 4) x = a.left - r.width + 2;
      } else {
        x = pos.align === 'end' ? a.right - r.width : a.left;
        y = a.bottom + (pos.gap ?? 0);
        if (y + r.height > vh - 4 && a.top - r.height > 4) y = a.top - r.height - (pos.gap ?? 0);
      }
    } else {
      x = pos.x;
      y = pos.y;
      if (x + r.width > vw - 4) x = Math.max(4, x - r.width);
      if (y + r.height > vh - 4) y = Math.max(4, vh - r.height - 4);
    }
    x = Math.max(4, Math.min(x, vw - r.width - 4));
    y = Math.max(4, Math.min(y, vh - r.height - 4));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }

  close() {
    this.child?.close();
    this.child = null;
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    el.remove();
    this.opts.onClose?.();
  }
}

/* ---------------------------------------------------------------- menu */

class Menu extends Popup {
  constructor(items, opts) {
    super(opts);
    this.items = items.filter(Boolean);
    this.active = -1;
    this.rows = [];
    this.subTimer = null;
  }

  open(pos) {
    const el = h('div', { class: `menu ${this.opts.className || ''}`, role: 'menu', tabindex: '-1' });
    this.items.forEach((item, i) => {
      if (item.type === 'separator') {
        el.appendChild(h('div', { class: 'menu-sep', role: 'separator' }));
        this.rows.push(null);
        return;
      }
      if (item.type === 'header') {
        el.appendChild(h('div', { class: 'menu-header' }, item.label));
        this.rows.push(null);
        return;
      }
      const role = item.type === 'checkbox' ? 'menuitemcheckbox' : item.type === 'radio' ? 'menuitemradio' : 'menuitem';
      let lead = '';
      if (item.type === 'checkbox' || item.type === 'radio') lead = item.checked ? icon(item.type === 'radio' ? 'radio-on' : 'check') : '';
      else if (item.icon) lead = item.icon.startsWith('<') ? item.icon : icon(item.icon);
      const row = h('div', {
        class: `menu-item${item.disabled ? ' disabled' : ''}${item.submenu ? ' has-sub' : ''}${item.danger ? ' danger' : ''}`,
        role,
        'aria-disabled': item.disabled ? 'true' : null,
        'aria-checked': item.type ? String(!!item.checked) : null,
        'aria-haspopup': item.submenu ? 'true' : null,
        tabindex: '-1',
      },
      h('span', { class: 'menu-icon', html: lead }),
      h('span', { class: 'menu-label' }, item.label),
      item.shortcut ? h('span', { class: 'menu-shortcut' }, item.shortcut) : null,
      item.submenu ? h('span', { class: 'menu-arrow', html: icon('chevron-right') }) : null);
      row.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch') return;
        this.setActive(i, false);
        clearTimeout(this.subTimer);
        if (item.submenu && !item.disabled) this.subTimer = setTimeout(() => this.openSub(i), 120);
        else this.subTimer = setTimeout(() => this.closeSub(), 160);
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(i);
      });
      row.addEventListener('contextmenu', (e) => e.preventDefault());
      el.appendChild(row);
      this.rows.push(row);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.mount(el, pos);
    if (this.opts.focusFirst) this.move(1);
    else el.focus({ preventScroll: true });
  }

  setActive(i, focus = true) {
    this.rows[this.active]?.classList.remove('active');
    this.active = i;
    const row = this.rows[i];
    if (row) {
      row.classList.add('active');
      if (focus) row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  move(dir) {
    const n = this.items.length;
    let i = this.active;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      const it = this.items[i];
      if (this.rows[i] && !it.disabled) {
        this.setActive(i);
        return;
      }
    }
  }

  openSub(i) {
    const item = this.items[i];
    if (this.child?.index === i) return;
    this.closeSub();
    const items = typeof item.submenu === 'function' ? item.submenu() : item.submenu;
    const sub = new Menu(items, { className: this.opts.className });
    sub.index = i;
    sub.parentMenu = this;
    this.child = sub;
    sub.open({ anchor: this.rows[i], side: 'right' });
    this.rows[i].classList.add('sub-open');
  }

  closeSub(focusParent = false) {
    if (!this.child) return;
    this.rows[this.child.index]?.classList.remove('sub-open');
    this.child.close();
    this.child = null;
    if (focusParent) this.rows[this.active]?.focus({ preventScroll: true });
  }

  activate(i) {
    const item = this.items[i];
    if (!item || item.disabled) return;
    if (item.submenu) {
      this.openSub(i);
      this.child?.move(1);
      return;
    }
    closeMenus();
    item.action?.();
  }

  handleKey(e) {
    switch (e.key) {
      case 'ArrowDown':
        this.move(1);
        return true;
      case 'ArrowUp':
        this.move(-1);
        return true;
      case 'Home':
        this.active = -1;
        this.move(1);
        return true;
      case 'End':
        this.active = this.items.length;
        this.move(-1);
        return true;
      case 'ArrowRight':
        if (this.items[this.active]?.submenu) {
          this.activate(this.active);
          return true;
        }
        if (root(this).opts.onNavigate) {
          root(this).opts.onNavigate('right');
          return true;
        }
        return false;
      case 'ArrowLeft':
        if (this.parentMenu) {
          this.parentMenu.closeSub(true);
          return true;
        }
        if (this.opts.onNavigate) {
          this.opts.onNavigate('left');
          return true;
        }
        return false;
      case 'Enter':
      case ' ':
        if (this.active >= 0) this.activate(this.active);
        return true;
      default:
        return false;
    }
  }
}

const root = (m) => (m.parentMenu ? root(m.parentMenu) : m);

/**
 * Opens a menu.
 * @param items [{label, icon, shortcut, action, disabled, type:'separator'|'header'|'checkbox'|'radio', checked, submenu, danger}]
 * @param pos {x, y} or {anchor: Element, align: 'start'|'end', side: 'bottom'|'right'}
 * @param opts {onClose, ignore(target), returnFocus, focusFirst, onNavigate(dir), className}
 */
export function showMenu(items, pos, opts = {}) {
  listen();
  closeMenus();
  const m = new Menu(items, opts);
  current = m;
  m.open(pos);
  return m;
}

/** Opens arbitrary content in a popover anchored to an element. */
export function showPopover(content, pos, opts = {}) {
  listen();
  closeMenus();
  const p = new Popup(opts);
  current = p;
  const el = h('div', { class: `popover ${opts.className || ''}`, role: opts.role || 'dialog', 'aria-label': opts.label || null, tabindex: '-1' }, content);
  p.mount(el, pos);
  if (opts.focus !== false) (el.querySelector('[autofocus]') || el).focus({ preventScroll: true });
  p.reposition = () => p.el && p.place(pos);
  return p;
}

export const currentPopup = () => current;

/**
 * Builds a menubar. `menus` = [{label, items: () => menuItems}].
 */
export function createMenuBar(menus) {
  const bar = h('div', { class: 'menubar', role: 'menubar' });
  let openIndex = -1;
  const buttons = menus.map((m, i) => {
    const btn = h('button', { class: 'menubar-item', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': 'false', type: 'button' }, m.label);
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (openIndex === i) closeMenus();
      else open(i, false);
    });
    btn.addEventListener('pointerenter', () => {
      if (openIndex !== -1 && openIndex !== i) open(i, false);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        open(i, true);
      }
    });
    bar.appendChild(btn);
    return btn;
  });

  function open(i, keyboard) {
    closeMenus();
    const btn = buttons[i];
    openIndex = i;
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    showMenu(menus[i].items(), { anchor: btn }, {
      focusFirst: keyboard,
      returnFocus: btn,
      ignore: (t) => buttons.some((b) => b.contains(t)),
      onNavigate: (dir) => open((i + (dir === 'right' ? 1 : -1) + menus.length) % menus.length, true),
      onClose: () => {
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        if (openIndex === i) openIndex = -1;
      },
    });
  }

  return bar;
}
