// Desktop icons (xfdesktop-like): special icons plus the files in ~/Desktop.
import { h, clamp, onLongPress, longPressed, rafThrottle } from '../core/util.js';
import { icon, iconForEntry } from '../core/icons.js';
import { vfs, HOME, TRASH, parseDesktopEntry } from '../core/vfs.js';
import { settings } from '../core/settings.js';
import { showMenu } from '../core/menu.js';
import { launch, launchExec } from '../core/launcher.js';
import { appByExec, CATEGORIES, APPS } from '../apps/registry.js';
import { promptDialog, confirmDialog, alertDialog } from '../core/dialog.js';
import { notify } from '../core/notify.js';

const DESKTOP = `${HOME}/Desktop`;
const PAD = 8;

export function initDesktop(root) {
  let items = [];
  let selected = new Set();
  let cells = new Map(); // id -> {col,row}
  const els = new Map();

  const cellW = () => (settings.get('iconSize') > 56 ? 104 : 88);
  const cellH = () => settings.get('iconSize') + 46;
  const rows = () => Math.max(1, Math.floor((root.clientHeight - PAD * 2) / cellH()));
  const cols = () => Math.max(1, Math.floor((root.clientWidth - PAD * 2) / cellW()));

  function collect() {
    const list = [
      { id: 'special:home', label: 'Home', icon: 'home', special: true, open: () => launch('files', { path: HOME }) },
      { id: 'special:fs', label: 'File System', icon: 'filesystem', special: true, open: () => launch('files', { path: '/' }) },
      { id: 'special:trash', label: 'Trash', icon: vfs.trashCount ? 'trash-full' : 'trash-empty', special: true, trash: true, open: () => launch('files', { path: 'trash:///' }) },
    ];
    let entries = [];
    try {
      entries = vfs.readdir(DESKTOP).filter((e) => !e.name.startsWith('.'));
    } catch {
      entries = [];
    }
    entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    const order = ['qterminal.desktop', 'firefox-esr.desktop', 'xfce-settings-manager.desktop', 'phantom-console.desktop', 'metasploit-classic.desktop'];
    entries.sort((a, b) => {
      const ia = order.indexOf(a.name);
      const ib = order.indexOf(b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    for (const e of entries) {
      const item = { id: `file:${e.name}`, path: e.path, name: e.name, label: e.name, icon: iconForEntry(e.name, e.target || e.node), file: true };
      if (e.name.endsWith('.desktop') && e.node.type === 'file') {
        const d = parseDesktopEntry(e.node.content);
        const app = appByExec(d.exec);
        item.label = d.name || e.name;
        item.icon = app?.icon || 'file-binary';
        item.launcher = true;
        item.open = () => (app ? launch(app.id) : launchExec(d.exec));
      } else if (e.isDir) {
        item.open = () => launch('files', { path: e.path });
      } else if ((e.target || e.node)?.image) {
        item.open = () => launch('imageviewer', { path: e.path });
      } else {
        item.open = () => launch('editor', { path: e.path });
      }
      list.push(item);
    }
    return list;
  }

  function layout() {
    const saved = settings.get('iconPositions') || {};
    const R = rows();
    const C = cols();
    const taken = new Set();
    cells = new Map();
    const key = (c, r) => `${c}:${r}`;
    for (const it of items) {
      const p = saved[it.id];
      if (p && p.col < C && p.row < R && !taken.has(key(p.col, p.row))) {
        cells.set(it.id, { col: p.col, row: p.row });
        taken.add(key(p.col, p.row));
      }
    }
    let c = 0;
    let r = 0;
    for (const it of items) {
      if (cells.has(it.id)) continue;
      while (taken.has(key(c, r))) {
        r++;
        if (r >= R) {
          r = 0;
          c++;
        }
      }
      cells.set(it.id, { col: c, row: r });
      taken.add(key(c, r));
    }
  }

  const posOf = (id) => {
    const cell = cells.get(id);
    return { x: PAD + cell.col * cellW(), y: PAD + cell.row * cellH() };
  };

  function render() {
    root.hidden = !settings.get('desktopIcons');
    items = collect();
    layout();
    root.style.setProperty('--dicon-size', `${settings.get('iconSize')}px`);
    root.style.setProperty('--dicon-w', `${cellW()}px`);
    const keep = new Set(items.map((i) => i.id));
    for (const [id, el] of els) {
      if (!keep.has(id)) {
        el.remove();
        els.delete(id);
      }
    }
    selected = new Set([...selected].filter((id) => keep.has(id)));
    for (const it of items) {
      let el = els.get(it.id);
      if (!el) {
        el = h('button', { class: 'dicon', type: 'button', dataset: { id: it.id } },
          h('span', { class: 'dicon-img' }), h('span', { class: 'dicon-label' }));
        bindIcon(el);
        els.set(it.id, el);
        root.appendChild(el);
      }
      el.querySelector('.dicon-img').innerHTML = icon(it.icon);
      el.querySelector('.dicon-label').textContent = it.label;
      el.setAttribute('aria-label', it.label);
      el.title = it.label;
      const p = posOf(it.id);
      el.style.translate = `${p.x}px ${p.y}px`;
      el.classList.toggle('selected', selected.has(it.id));
    }
  }

  const item = (id) => items.find((i) => i.id === id);

  function select(id, { toggle = false, keep = false } = {}) {
    if (toggle) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    } else if (!keep || !selected.has(id)) selected = new Set([id]);
    for (const [eid, el] of els) el.classList.toggle('selected', selected.has(eid));
  }

  function clearSelection() {
    selected.clear();
    for (const el of els.values()) el.classList.remove('selected');
  }

  /* ---------- icon interaction */

  function bindIcon(el) {
    const id = el.dataset.id;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      select(id, { toggle: e.ctrlKey || e.metaKey, keep: true });
      startDrag(e, el);
    });
    el.addEventListener('dblclick', () => item(id)?.open());
    el.addEventListener('keydown', (e) => onKey(e, id));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selected.has(id)) select(id);
      iconMenu(item(id), e);
    });
    onLongPress(el, (e) => {
      if (!selected.has(id)) select(id);
      iconMenu(item(id), e);
    });
  }

  function startDrag(e, el) {
    const start = { x: e.clientX, y: e.clientY };
    const moving = [...selected].map((sid) => ({ id: sid, el: els.get(sid), from: posOf(sid) }));
    let dragging = false;
    const pid = e.pointerId;
    el.setPointerCapture(pid);
    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < 5) return;
      dragging = true;
      root.classList.add('dragging-icons');
      for (const m of moving) m.el.style.translate = `${m.from.x + dx}px ${m.from.y + dy}px`;
      const trashEl = els.get('special:trash');
      const over = trashEl && !selected.has('special:trash') && hit(trashEl, ev.clientX, ev.clientY);
      trashEl?.classList.toggle('drop-target', !!over);
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      root.classList.remove('dragging-icons');
      const trashEl = els.get('special:trash');
      trashEl?.classList.remove('drop-target');
      if (!dragging) {
        if (ev.pointerType === 'touch' && ev.type === 'pointerup' && !longPressed(el)) item(el.dataset.id)?.open();
        return;
      }
      if (trashEl && !selected.has('special:trash') && hit(trashEl, ev.clientX, ev.clientY)) {
        trashSelected();
        return;
      }
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const saved = { ...(settings.get('iconPositions') || {}) };
      const R = rows();
      const C = cols();
      const occupied = new Map();
      for (const [cid, cell] of cells) if (!moving.some((m) => m.id === cid)) occupied.set(`${cell.col}:${cell.row}`, cid);
      for (const m of moving) {
        let col = clamp(Math.round((m.from.x + dx - PAD) / cellW()), 0, C - 1);
        let row = clamp(Math.round((m.from.y + dy - PAD) / cellH()), 0, R - 1);
        let guard = 0;
        while (occupied.has(`${col}:${row}`) && guard++ < R * C) {
          row++;
          if (row >= R) {
            row = 0;
            col = (col + 1) % C;
          }
        }
        occupied.set(`${col}:${row}`, m.id);
        saved[m.id] = { col, row };
      }
      settings.set('iconPositions', saved);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  const hit = (el, x, y) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  function onKey(e, id) {
    const it = item(id);
    if (e.key === 'Enter') {
      e.preventDefault();
      it?.open();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      trashSelected();
    } else if (e.key === 'F2' && it?.file) {
      e.preventDefault();
      rename(it);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const cur = cells.get(id);
      const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      let best = null;
      let bestScore = Infinity;
      for (const [cid, c] of cells) {
        if (cid === id) continue;
        const dc = c.col - cur.col;
        const dr = c.row - cur.row;
        if (Math.sign(dc) !== d[0] && d[0] !== 0) continue;
        if (Math.sign(dr) !== d[1] && d[1] !== 0) continue;
        const score = d[0] ? Math.abs(dc) * 10 + Math.abs(dr) : Math.abs(dr) * 10 + Math.abs(dc);
        if ((d[0] && dc === 0) || (d[1] && dr === 0)) continue;
        if (score < bestScore) {
          bestScore = score;
          best = cid;
        }
      }
      if (best) {
        select(best);
        els.get(best).focus();
      }
    }
  }

  /* ---------- actions */

  function trashSelected() {
    const files = [...selected].map(item).filter((i) => i?.file);
    if (!files.length) return;
    for (const f of files) {
      try {
        vfs.trash(f.path);
      } catch (err) {
        alertDialog({ title: 'Error', heading: `Could not move "${f.label}" to the Trash`, message: err.message, icon: 'error' });
      }
    }
    clearSelection();
  }

  async function rename(it) {
    const isLauncher = it.launcher;
    const value = await promptDialog({ title: 'Rename', heading: `Rename "${it.label}"`, value: isLauncher ? it.label : it.name, okLabel: 'Rename', selectBase: !isLauncher });
    if (!value || value === (isLauncher ? it.label : it.name)) return;
    try {
      if (isLauncher) {
        const content = vfs.readFile(it.path).replace(/^Name=.*$/m, `Name=${value}`);
        vfs.writeFile(it.path, content);
      } else {
        if (value.includes('/')) throw new Error('File names cannot contain "/".');
        if (vfs.exists(`${DESKTOP}/${value}`)) throw new Error('A file with that name already exists.');
        vfs.move(it.path, `${DESKTOP}/${value}`);
      }
    } catch (err) {
      alertDialog({ title: 'Error', heading: 'Failed to rename', message: err.message, icon: 'error' });
    }
  }

  async function create(kind) {
    const folder = kind === 'folder';
    const base = vfs.uniqueName(DESKTOP, folder ? 'Untitled Folder' : 'Untitled Document');
    const name = await promptDialog({ title: folder ? 'Create New Folder' : 'Create Document', heading: folder ? 'Enter the new folder name:' : 'Enter the new file name:', value: base, okLabel: 'Create' });
    if (!name) return;
    try {
      if (name.includes('/')) throw new Error('Names cannot contain "/".');
      if (vfs.exists(`${DESKTOP}/${name}`)) throw new Error(`"${name}" already exists.`);
      if (folder) vfs.mkdir(`${DESKTOP}/${name}`);
      else vfs.writeFile(`${DESKTOP}/${name}`, '');
    } catch (err) {
      alertDialog({ title: 'Error', heading: folder ? 'Failed to create folder' : 'Failed to create file', message: err.message, icon: 'error' });
    }
  }

  function iconMenu(it, e) {
    if (!it) return;
    const pos = { x: e.clientX, y: e.clientY };
    if (it.trash) {
      showMenu([
        { label: 'Open', icon: 'open', action: it.open },
        { type: 'separator' },
        { label: 'Empty Trash', icon: 'trash', disabled: !vfs.trashCount, action: emptyTrash },
      ], pos);
      return;
    }
    showMenu([
      { label: it.launcher ? 'Launch' : 'Open', icon: 'open', action: it.open },
      { type: 'separator' },
      { label: 'Rename…', icon: 'edit', shortcut: 'F2', disabled: !it.file, action: () => rename(it) },
      { label: 'Move to Trash', icon: 'trash', shortcut: 'Delete', disabled: !it.file, action: trashSelected },
    ], pos);
  }

  async function emptyTrash() {
    const ok = await confirmDialog({ title: 'Empty Trash', heading: 'Remove all files and folders from the Trash?', message: 'If you choose to empty the Trash, all items in it will be permanently lost.', confirmLabel: 'Empty Trash', danger: true, icon: 'warning' });
    if (!ok) return;
    vfs.emptyTrash();
    notify({ title: 'Trash emptied', body: 'All items in the Trash were deleted permanently.', icon: 'trash-empty' });
  }

  function appsSubmenu() {
    return CATEGORIES.filter((c) => !['favorites', 'recent', 'all'].includes(c.id)).map((c) => ({
      label: c.name,
      icon: c.icon,
      submenu: () => APPS.filter((a) => a.categories.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ label: a.name, icon: a.icon, action: () => launch(a.id) })),
    }));
  }

  function desktopMenu(e) {
    showMenu([
      { label: 'Open Terminal Here', icon: 'terminal', action: () => launch('terminal', { cwd: DESKTOP }) },
      { type: 'separator' },
      { label: 'Create Folder…', icon: 'folder-new', action: () => create('folder') },
      { label: 'Create Document', icon: 'document-new', submenu: [{ label: 'Empty File', icon: 'document', action: () => create('file') }] },
      { type: 'separator' },
      { label: 'Arrange Desktop Icons', icon: 'view-grid', action: () => settings.set('iconPositions', {}) },
      { label: 'Desktop Settings…', icon: 'image', action: () => launch('settings', { panel: 'desktop' }) },
      { type: 'separator' },
      { label: 'Applications', icon: 'apps', submenu: appsSubmenu },
    ], { x: e.clientX, y: e.clientY });
  }

  /* ---------- desktop background: rubber band + menu */

  const band = h('div', { class: 'rubberband', hidden: true });
  root.appendChild(band);
  root.addEventListener('pointerdown', (e) => {
    if (e.target !== root || e.button !== 0) return;
    clearSelection();
    if (e.pointerType === 'touch') return;
    const r = root.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    root.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const box = { l: Math.min(sx, x), t: Math.min(sy, y), r: Math.max(sx, x), b: Math.max(sy, y) };
      band.hidden = false;
      band.style.translate = `${box.l}px ${box.t}px`;
      band.style.width = `${box.r - box.l}px`;
      band.style.height = `${box.b - box.t}px`;
      selected = new Set();
      for (const [id, el] of els) {
        const p = posOf(id);
        const w = cellW() - 8;
        const hh = cellH() - 6;
        const inside = p.x < box.r && p.x + w > box.l && p.y < box.b && p.y + hh > box.t;
        if (inside) selected.add(id);
        el.classList.toggle('selected', inside);
      }
    };
    const up = () => {
      band.hidden = true;
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  });
  root.addEventListener('contextmenu', (e) => {
    if (e.target !== root) return;
    e.preventDefault();
    clearSelection();
    desktopMenu(e);
  });
  onLongPress(root, (e) => {
    if (e.target === root) desktopMenu(e);
  });

  /* ---------- live updates */
  const rerender = rafThrottle(render);
  vfs.on('change', ({ path, reset }) => {
    if (reset || path.startsWith(DESKTOP) || path.startsWith(TRASH)) rerender();
  });
  ['iconSize', 'desktopIcons', 'iconPositions'].forEach((k) => settings.on(`change:${k}`, rerender));
  window.addEventListener('resize', rerender);
  render();
}
