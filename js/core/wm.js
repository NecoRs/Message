// Window manager: creation, stacking, focus, drag, resize, snapping,
// minimise/maximise, workspaces and window menus (xfwm4-like behaviour).
import { Emitter } from './events.js';
import { h, clamp, uid, mqMobile, mqReducedMotion } from './util.js';
import { icon } from './icons.js';
import { settings } from './settings.js';
import { showMenu, closeMenus } from './menu.js';

const EDGE = 8; // px from the screen edge that triggers snapping
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export class Win extends Emitter {
  constructor(wm, opts) {
    super();
    this.wm = wm;
    this.id = uid('win');
    this.appId = opts.appId || 'window';
    this.title = opts.title || '';
    this.iconName = opts.icon || 'file-generic';
    this.minW = opts.minWidth ?? 300;
    this.minH = opts.minHeight ?? 180;
    this.resizable = opts.resizable !== false;
    this.maximizable = opts.maximizable !== false && this.resizable;
    this.minimizable = opts.minimizable !== false;
    this.isDialog = !!opts.dialog;
    this.modal = !!opts.modal;
    this.parent = opts.parent || null;
    this.autoHeight = opts.height === 'auto';
    this.skipTaskbar = !!opts.skipTaskbar;
    this.workspace = this.parent ? this.parent.workspace : wm.workspace;
    this.state = 'normal';
    this.minimized = false;
    this.closed = false;
    this.onTop = false;
    this.beforeClose = null;
    this.geom = { x: 0, y: 0, w: opts.width ?? 720, h: this.autoHeight ? 200 : opts.height ?? 480 };
    this.#build(opts);
  }

  #build(opts) {
    const btn = (cls, label, ic, fn) => {
      const b = h('button', { class: `win-btn ${cls}`, type: 'button', 'aria-label': label, title: label, tabindex: '-1', html: icon(ic) });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      return b;
    };
    this.iconEl = h('button', { class: 'win-icon', type: 'button', tabindex: '-1', 'aria-label': 'Window menu', html: icon(this.iconName) });
    this.titleEl = h('div', { class: 'win-title' }, this.title);
    this.minBtn = this.minimizable ? btn('win-min', 'Minimize', 'win-min', () => this.minimize()) : null;
    this.maxBtn = this.maximizable ? btn('win-max', 'Maximize', 'win-max', () => this.toggleMaximize()) : null;
    this.closeBtn = btn('win-close', 'Close', 'win-close', () => this.close());
    this.titlebar = h('header', { class: 'win-titlebar' }, this.iconEl, this.titleEl,
      h('div', { class: 'win-buttons' }, this.minBtn, this.maxBtn, this.closeBtn));
    this.body = h('div', { class: 'win-body' });
    this.el = h('section', {
      class: `win${this.isDialog ? ' win-dialog' : ''}${opts.className ? ' ' + opts.className : ''}`,
      role: this.isDialog ? 'alertdialog' : 'dialog',
      'aria-label': this.title,
      tabindex: '-1',
      dataset: { app: this.appId, id: this.id },
    }, this.titlebar, this.body);
    if (this.resizable) {
      for (const d of HANDLES) {
        const handle = h('div', { class: `win-resize win-resize-${d}`, 'aria-hidden': 'true' });
        handle.addEventListener('pointerdown', (e) => this.#startResize(e, d));
        this.el.appendChild(handle);
      }
    }

    this.el.addEventListener('pointerdown', () => this.wm.focus(this, { fromPointer: true }), true);
    this.el.addEventListener('focusin', () => {
      if (this.wm.active !== this) this.wm.focus(this, { fromPointer: true });
    });
    this.titlebar.addEventListener('pointerdown', (e) => this.#startDrag(e));
    this.titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.win-btn')) return;
      if (e.target.closest('.win-icon')) this.close();
      else if (this.maximizable) this.toggleMaximize();
    });
    this.titlebar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showWindowMenu({ x: e.clientX, y: e.clientY });
    });
    this.iconEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showWindowMenu({ anchor: this.iconEl });
    });
    this.iconEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /* ---------- public API */

  setTitle(title) {
    this.title = title;
    this.titleEl.textContent = title;
    this.el.setAttribute('aria-label', title);
    this.wm.emit('title', this);
    this.wm.emit('change');
  }

  setIcon(name) {
    this.iconName = name;
    this.iconEl.innerHTML = icon(name);
    this.wm.emit('change');
  }

  focus() {
    this.wm.focus(this);
  }

  minimize() {
    this.wm.minimize(this);
  }

  restore() {
    this.wm.restore(this);
  }

  maximize() {
    if (!this.maximizable) return;
    this.state = 'maximized';
    this.applyGeometry(true);
  }

  unmaximize() {
    this.state = 'normal';
    this.applyGeometry(true);
  }

  toggleMaximize() {
    if (!this.maximizable) return;
    if (this.state === 'normal') this.maximize();
    else this.unmaximize();
  }

  tile(side) {
    if (!this.resizable) return;
    this.state = side === 'left' ? 'tile-left' : 'tile-right';
    this.applyGeometry(true);
  }

  async close(force = false) {
    if (this.closed) return;
    if (!force && this.beforeClose) {
      const ok = await this.beforeClose();
      if (!ok) return;
    }
    this.wm.destroy(this);
  }

  /** Displayed geometry, taking maximised and tiled states into account. */
  displayGeometry() {
    const a = this.wm.area();
    if (this.wm.mobile && !this.isDialog) return { x: 0, y: 0, w: a.w, h: a.h };
    switch (this.state) {
      case 'maximized':
        return { x: 0, y: 0, w: a.w, h: a.h };
      case 'tile-left':
        return { x: 0, y: 0, w: Math.round(a.w / 2), h: a.h };
      case 'tile-right':
        return { x: Math.round(a.w / 2), y: 0, w: a.w - Math.round(a.w / 2), h: a.h };
      default:
        return this.geom;
    }
  }

  applyGeometry(animate = false) {
    const g = this.displayGeometry();
    const el = this.el;
    const max = this.state === 'maximized' || (this.wm.mobile && !this.isDialog);
    if (animate && this.wm.animations) {
      el.classList.add('win-animating');
      clearTimeout(this._animT);
      this._animT = setTimeout(() => el.classList.remove('win-animating'), 200);
    }
    el.style.translate = `${Math.round(g.x)}px ${Math.round(g.y)}px`;
    el.style.width = `${Math.round(g.w)}px`;
    el.style.height = this.autoHeight && this.state === 'normal' && !max ? 'auto' : `${Math.round(g.h)}px`;
    el.classList.toggle('maximized', max);
    el.classList.toggle('tiled', this.state.startsWith('tile'));
    if (this.maxBtn) {
      const isMax = this.state !== 'normal';
      this.maxBtn.innerHTML = icon(isMax ? 'win-restore' : 'win-max');
      this.maxBtn.setAttribute('aria-label', isMax ? 'Restore' : 'Maximize');
      this.maxBtn.title = isMax ? 'Restore' : 'Maximize';
    }
    this.wm.emit('geometry', this);
    this.emit('resize', g);
  }

  showWindowMenu(pos) {
    const wm = this.wm;
    const ws = Array.from({ length: wm.workspaceCount }, (_, i) => ({
      label: `Workspace ${i + 1}`,
      disabled: i === this.workspace,
      action: () => wm.moveToWorkspace(this, i),
    }));
    showMenu([
      { label: 'Minimize', icon: 'win-min', disabled: !this.minimizable, action: () => this.minimize() },
      { label: this.state === 'normal' ? 'Maximize' : 'Unmaximize', icon: this.state === 'normal' ? 'win-max' : 'win-restore', disabled: !this.maximizable || wm.mobile, action: () => this.toggleMaximize() },
      { label: 'Tile Left', disabled: !this.resizable || wm.mobile, action: () => this.tile('left') },
      { label: 'Tile Right', disabled: !this.resizable || wm.mobile, action: () => this.tile('right') },
      { type: 'separator' },
      { label: 'Always on Top', type: 'checkbox', checked: this.onTop, action: () => wm.setOnTop(this, !this.onTop) },
      { label: 'Move to Another Workspace', disabled: wm.workspaceCount < 2 || !!this.parent, submenu: ws },
      { type: 'separator' },
      { label: 'Close', icon: 'win-close', shortcut: 'Alt+F4', action: () => this.close() },
    ], pos, { returnFocus: this.el });
  }

  /* ---------- dragging */

  #startDrag(e) {
    if (e.button !== 0 || e.target.closest('.win-btn, .win-icon')) return;
    if (this.wm.mobile && !this.isDialog) return;
    e.preventDefault();
    const wm = this.wm;
    const area = wm.areaRect();
    const start = { x: e.clientX, y: e.clientY };
    const shown = this.displayGeometry();
    let off = { x: e.clientX - area.left - shown.x, y: e.clientY - area.top - shown.y };
    let moved = false;
    let snap = null;
    const pointerId = e.pointerId;
    this.titlebar.setPointerCapture(pointerId);

    const move = (ev) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
        moved = true;
        closeMenus();
        this.el.classList.add('dragging');
        if (this.state !== 'normal') {
          const ratio = clamp(off.x / shown.w, 0.1, 0.9);
          this.state = 'normal';
          off = { x: Math.round(this.geom.w * ratio), y: Math.min(off.y, 15) };
          this.applyGeometry();
        }
      }
      const a = wm.area();
      const px = ev.clientX - area.left;
      const py = ev.clientY - area.top;
      this.geom.x = clamp(px - off.x, -this.geom.w + 80, a.w - 80);
      this.geom.y = clamp(py - off.y, 0, a.h - 32);
      this.el.style.translate = `${Math.round(this.geom.x)}px ${Math.round(this.geom.y)}px`;
      wm.emit('geometry', this);

      if (settings.get('snapping') && this.resizable && !this.isDialog) {
        let next = null;
        if (py <= EDGE - 2 || ev.clientY <= area.top + 2) next = 'maximized';
        else if (px <= EDGE) next = 'tile-left';
        else if (px >= a.w - EDGE) next = 'tile-right';
        if (next !== snap) {
          snap = next;
          wm.showSnapPreview(snap);
        }
      }
    };

    const up = () => {
      this.titlebar.releasePointerCapture?.(pointerId);
      this.titlebar.removeEventListener('pointermove', move);
      this.titlebar.removeEventListener('pointerup', up);
      this.titlebar.removeEventListener('pointercancel', up);
      this.el.classList.remove('dragging');
      wm.showSnapPreview(null);
      if (snap) {
        this.state = snap;
        this.applyGeometry(true);
      }
    };
    this.titlebar.addEventListener('pointermove', move);
    this.titlebar.addEventListener('pointerup', up);
    this.titlebar.addEventListener('pointercancel', up);
  }

  /* ---------- resizing */

  #startResize(e, dir) {
    if (e.button !== 0 || this.wm.mobile) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    if (this.state !== 'normal') {
      this.geom = { ...this.displayGeometry() };
      this.state = 'normal';
      this.applyGeometry();
    }
    if (this.autoHeight) {
      this.geom.h = this.el.offsetHeight;
      this.autoHeight = false;
    }
    const s = { x: e.clientX, y: e.clientY, ...this.geom };
    const a = this.wm.area();
    handle.setPointerCapture(e.pointerId);
    this.el.classList.add('resizing');
    const move = (ev) => {
      const dx = ev.clientX - s.x;
      const dy = ev.clientY - s.y;
      let { x, y, w, h: hh } = s;
      if (dir.includes('e')) w = clamp(s.w + dx, this.minW, a.w - s.x);
      if (dir.includes('s')) hh = clamp(s.h + dy, this.minH, a.h - s.y);
      if (dir.includes('w')) {
        w = clamp(s.w - dx, this.minW, s.x + s.w);
        x = s.x + s.w - w;
      }
      if (dir.includes('n')) {
        hh = clamp(s.h - dy, this.minH, s.y + s.h);
        y = s.y + s.h - hh;
      }
      this.geom = { x, y, w, h: hh };
      this.applyGeometry();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.el.classList.remove('resizing');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
}

class WindowManager extends Emitter {
  constructor() {
    super();
    this.windows = [];
    this.stack = [];
    this.active = null;
    this.z = 10;
    this.workspace = 0;
    this.mobile = mqMobile.matches;
    this.container = null;
    this.taskbarRect = null; // (win) => DOMRect | null, provided by the panel
    this.desktopShown = null;
  }

  get workspaceCount() {
    return clamp(settings.get('workspaceCount'), 1, 4);
  }

  get animations() {
    return settings.get('animations') && !mqReducedMotion.matches;
  }

  init(container) {
    this.container = container;
    this.snapEl = h('div', { class: 'snap-preview', 'aria-hidden': 'true' });
    container.appendChild(this.snapEl);
    document.body.classList.toggle('is-mobile', this.mobile);
    mqMobile.addEventListener('change', (e) => {
      this.mobile = e.matches;
      document.body.classList.toggle('is-mobile', this.mobile);
      this.windows.forEach((w) => {
        this.#fitInside(w);
        w.applyGeometry();
      });
      this.emit('change');
    });
    let raf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        this.windows.forEach((w) => {
          this.#fitInside(w);
          w.applyGeometry();
        });
      });
    });
    settings.on('change:workspaceCount', () => {
      const n = this.workspaceCount;
      this.windows.forEach((w) => {
        if (w.workspace >= n) w.workspace = n - 1;
      });
      if (this.workspace >= n) this.switchWorkspace(n - 1);
      else this.#syncWorkspace();
      this.emit('change');
    });
  }

  area() {
    return { w: this.container.clientWidth, h: this.container.clientHeight };
  }

  areaRect() {
    return this.container.getBoundingClientRect();
  }

  #fitInside(w) {
    const a = this.area();
    const g = w.geom;
    g.w = Math.min(g.w, a.w);
    if (!w.autoHeight) g.h = Math.min(g.h, a.h);
    g.x = clamp(g.x, -g.w + 80, Math.max(0, a.w - 80));
    g.y = clamp(g.y, 0, Math.max(0, a.h - 32));
  }

  #place(win, opts) {
    const a = this.area();
    const g = win.geom;
    g.w = Math.min(g.w, a.w - (this.mobile ? 0 : 24));
    if (!win.autoHeight) g.h = Math.min(g.h, a.h - (this.mobile ? 0 : 24));
    if (opts.x != null && opts.y != null) {
      g.x = opts.x;
      g.y = opts.y;
    } else if (win.parent) {
      const p = win.parent.displayGeometry();
      g.x = p.x + (p.w - g.w) / 2;
      g.y = p.y + Math.max(30, (p.h - (win.autoHeight ? 180 : g.h)) / 3);
    } else {
      const visible = this.windows.filter((w) => w !== win && !w.minimized && w.workspace === this.workspace && !w.isDialog && w.state === 'normal');
      const last = visible[visible.length - 1];
      if (last && !win.isDialog) {
        g.x = last.geom.x + 32;
        g.y = last.geom.y + 32;
        if (g.x + g.w > a.w - 8 || g.y + g.h > a.h - 8) {
          g.x = 40 + (visible.length % 5) * 24;
          g.y = 20 + (visible.length % 5) * 24;
        }
      } else {
        g.x = (a.w - g.w) / 2;
        g.y = Math.max(0, (a.h - (win.autoHeight ? 180 : g.h)) / 2.4);
      }
    }
    g.x = Math.round(clamp(g.x, 0, Math.max(0, a.w - g.w)));
    g.y = Math.round(clamp(g.y, 0, Math.max(0, a.h - 60)));
  }

  /** Creates and shows a window. */
  create(opts = {}) {
    const win = new Win(this, opts);
    this.#place(win, opts);
    this.windows.push(win);
    this.stack.push(win);
    this.container.appendChild(win.el);
    win.applyGeometry();
    if (win.parent) {
      win.parent.children = win.parent.children || new Set();
      win.parent.children.add(win);
      if (win.modal) win.parent.el.classList.add('win-blocked');
    }
    if (opts.maximized && win.maximizable) {
      win.state = 'maximized';
      win.applyGeometry();
    }
    this.#syncWorkspace();
    if (this.animations) {
      win.el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 150, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
    this.focus(win);
    this.emit('open', win);
    this.emit('change');
    return win;
  }

  /** After content is mounted, re-centre auto-height dialogs. */
  recenter(win) {
    if (!win.autoHeight) return;
    const a = this.area();
    const hgt = win.el.offsetHeight;
    win.geom.h = hgt;
    if (win.parent) {
      const p = win.parent.displayGeometry();
      win.geom.y = clamp(p.y + (p.h - hgt) / 3, 0, Math.max(0, a.h - hgt));
    } else {
      win.geom.y = clamp((a.h - hgt) / 2.4, 0, Math.max(0, a.h - hgt));
    }
    win.applyGeometry();
  }

  focus(win, { fromPointer = false } = {}) {
    if (!win || win.closed) return;
    const modalChild = win.children && [...win.children].find((c) => c.modal && !c.closed);
    if (modalChild) {
      this.focus(modalChild);
      return;
    }
    if (win.workspace !== this.workspace) this.switchWorkspace(win.workspace, false);
    if (win.minimized) {
      this.restore(win);
      return;
    }
    this.#raise(win);
    if (win.children) for (const c of win.children) this.#raise(c);
    if (this.active !== win) {
      this.active?.el.classList.remove('active');
      this.active = win;
      win.el.classList.add('active');
      this.emit('focus', win);
      this.emit('change');
    }
    if (!fromPointer) {
      requestAnimationFrame(() => {
        if (win.closed || this.active !== win) return;
        if (!win.el.contains(document.activeElement)) {
          win.emit('activate');
          if (!win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true });
        }
      });
    }
  }

  #raise(win) {
    this.stack = this.stack.filter((w) => w !== win);
    this.stack.push(win);
    this.stack.sort((a, b) => (a.onTop === b.onTop ? 0 : a.onTop ? 1 : -1));
    this.stack.forEach((w, i) => (w.el.style.zIndex = String(10 + i + (w.onTop ? 500 : 0))));
  }

  setOnTop(win, value) {
    win.onTop = value;
    this.#raise(win);
  }

  #focusNext(exclude) {
    const next = [...this.stack].reverse().find((w) => w !== exclude && !w.minimized && !w.closed && w.workspace === this.workspace);
    if (next) this.focus(next);
    else {
      this.active?.el.classList.remove('active');
      this.active = null;
      this.emit('focus', null);
      this.emit('change');
    }
  }

  #animateToTaskbar(win, reverse) {
    if (!this.animations) return null;
    const target = this.taskbarRect?.(win);
    const r = win.el.getBoundingClientRect();
    let transform = 'translateY(24px) scale(0.6)';
    if (target) {
      const dx = target.left + target.width / 2 - (r.left + r.width / 2);
      const dy = target.top + target.height / 2 - (r.top + r.height / 2);
      transform = `translate(${dx}px, ${dy}px) scale(0.12)`;
    }
    const frames = [{ transform: 'none', opacity: 1 }, { transform, opacity: 0 }];
    return win.el.animate(reverse ? frames.reverse() : frames, { duration: 190, easing: reverse ? 'cubic-bezier(.2,.7,.2,1)' : 'cubic-bezier(.5,0,.75,0)' });
  }

  minimize(win) {
    if (!win.minimizable || win.minimized) return;
    win.minimized = true;
    if (win.children) for (const c of win.children) c.el.classList.add('minimized');
    const anim = this.#animateToTaskbar(win, false);
    const done = () => {
      if (win.minimized) win.el.classList.add('minimized');
    };
    if (anim) anim.onfinish = done;
    else done();
    if (this.active === win) this.#focusNext(win);
    this.emit('minimize', win);
    this.emit('change');
  }

  restore(win) {
    if (!win.minimized) {
      this.focus(win);
      return;
    }
    win.minimized = false;
    win.el.classList.remove('minimized');
    if (win.children) for (const c of win.children) c.el.classList.remove('minimized');
    this.#animateToTaskbar(win, true);
    this.focus(win);
    this.emit('restore', win);
    this.emit('change');
  }

  destroy(win) {
    if (win.closed) return;
    if (win.children) for (const c of [...win.children]) c.close(true);
    win.closed = true;
    win.emit('close');
    this.windows = this.windows.filter((w) => w !== win);
    this.stack = this.stack.filter((w) => w !== win);
    if (win.parent) {
      win.parent.children?.delete(win);
      if (win.modal && ![...(win.parent.children || [])].some((c) => c.modal)) win.parent.el.classList.remove('win-blocked');
    }
    const remove = () => win.el.remove();
    if (this.animations && !win.minimized) {
      win.el.style.pointerEvents = 'none';
      const a = win.el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 120, easing: 'ease-in' });
      a.onfinish = remove;
    } else remove();
    if (this.active === win) {
      this.active = null;
      if (win.parent && !win.parent.closed) this.focus(win.parent);
      else this.#focusNext(win);
    }
    this.emit('close', win);
    this.emit('change');
  }

  findByApp(appId) {
    const list = this.windows.filter((w) => w.appId === appId && !w.isDialog);
    return list.find((w) => w.workspace === this.workspace) || list[0] || null;
  }

  byApp(appId) {
    return this.windows.filter((w) => w.appId === appId && !w.isDialog);
  }

  /** Clicking a taskbar button: focus, restore or minimise. */
  toggleFromTaskbar(win) {
    if (win.minimized) this.restore(win);
    else if (this.active === win) this.minimize(win);
    else this.focus(win);
  }

  showDesktop() {
    const here = this.windows.filter((w) => w.workspace === this.workspace && !w.isDialog);
    if (this.desktopShown && this.desktopShown.ws === this.workspace) {
      const list = this.desktopShown.list.filter((w) => !w.closed);
      this.desktopShown = null;
      list.forEach((w) => this.restore(w));
      return;
    }
    const visible = here.filter((w) => !w.minimized);
    if (!visible.length) return;
    this.desktopShown = { ws: this.workspace, list: visible };
    visible.forEach((w) => this.minimize(w));
  }

  cycle(dir = 1) {
    const list = this.stack.filter((w) => w.workspace === this.workspace && !w.isDialog);
    if (list.length < 2) return;
    const target = dir > 0 ? list[0] : list[list.length - 2];
    this.focus(target);
  }

  switchWorkspace(i, focusTop = true) {
    i = clamp(i, 0, this.workspaceCount - 1);
    if (i === this.workspace) return;
    this.workspace = i;
    this.desktopShown = null;
    this.#syncWorkspace();
    if (focusTop) {
      const top = [...this.stack].reverse().find((w) => w.workspace === i && !w.minimized);
      if (top) this.focus(top);
      else {
        this.active?.el.classList.remove('active');
        this.active = null;
      }
    }
    this.emit('workspace', i);
    this.emit('change');
  }

  moveToWorkspace(win, i) {
    win.workspace = i;
    if (win.children) for (const c of win.children) c.workspace = i;
    this.#syncWorkspace();
    if (this.active === win && i !== this.workspace) this.#focusNext(win);
    this.emit('change');
    this.emit('geometry', win);
  }

  #syncWorkspace() {
    for (const w of this.windows) w.el.classList.toggle('other-workspace', w.workspace !== this.workspace);
  }

  showSnapPreview(state) {
    const el = this.snapEl;
    if (!state) {
      el.classList.remove('show');
      return;
    }
    const a = this.area();
    const g = state === 'maximized' ? { x: 0, y: 0, w: a.w, h: a.h }
      : state === 'tile-left' ? { x: 0, y: 0, w: a.w / 2, h: a.h }
        : { x: a.w / 2, y: 0, w: a.w / 2, h: a.h };
    el.style.translate = `${g.x + 6}px ${g.y + 6}px`;
    el.style.width = `${g.w - 12}px`;
    el.style.height = `${g.h - 12}px`;
    el.classList.add('show');
  }
}

export const wm = new WindowManager();
