// XFCE-style top panel.
import { h, formatTime, rafThrottle, DAYS, MONTHS, clamp } from '../core/util.js';
import { icon, batteryIcon, KALI_MARK } from '../core/icons.js';
import { wm } from '../core/wm.js';
import { settings } from '../core/settings.js';
import { showMenu, showPopover, closeMenus, currentPopup } from '../core/menu.js';
import { launch } from '../core/launcher.js';
import { getApp } from '../apps/registry.js';
import { notifier, notify } from '../core/notify.js';
import { sound } from '../core/sound.js';
import { alertDialog, unavailableDialog } from '../core/dialog.js';
import { toggleWhisker } from './whisker.js';
import { lockScreen, logoutDialog } from './session.js';

const LAUNCHERS = ['files', 'terminal', 'firefox', 'phantom'];

export function initPanel(panel) {
  const btn = (cls, label, html, onclick) => {
    const b = h('button', { class: `panel-btn ${cls}`, type: 'button', 'aria-label': label, title: label, html });
    if (onclick) b.addEventListener('click', onclick);
    return b;
  };

  /* ---------- left: menu, launchers, pager */
  const menuBtn = btn('panel-menu', 'Applications', KALI_MARK, () => toggleWhisker(menuBtn));
  menuBtn.setAttribute('aria-haspopup', 'true');

  const launchers = h('div', { class: 'panel-launchers' }, LAUNCHERS.map((id) => {
    const app = getApp(id);
    return btn('panel-launcher', app.name, icon(app.icon), () => launch(id));
  }));

  const pager = h('div', { class: 'pager', role: 'tablist', 'aria-label': 'Workspaces' });
  pager.addEventListener('wheel', (e) => {
    e.preventDefault();
    wm.switchWorkspace(wm.workspace + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  const tasklist = h('div', { class: 'tasklist', role: 'tablist', 'aria-label': 'Open windows' });

  /* ---------- right: tray */
  const netBtn = btn('tray-net', 'Network', '', openNetwork);
  const volBtn = btn('tray-vol', 'Volume', '', openVolume);
  volBtn.addEventListener('wheel', (e) => {
    e.preventDefault();
    setVolume(settings.get('volume') + (e.deltaY < 0 ? 5 : -5));
  }, { passive: false });
  const bellBtn = btn('tray-bell', 'Notifications', '', openNotifications);
  const batBtn = btn('tray-bat', 'Battery', '', openBattery);
  batBtn.hidden = true;
  const clockBtn = h('button', { class: 'panel-btn panel-clock', type: 'button', 'aria-label': 'Date and time' });
  clockBtn.addEventListener('click', openCalendar);
  const powerBtn = btn('tray-power', 'Power', icon('power'), openPower);

  panel.append(
    h('div', { class: 'panel-left' }, menuBtn, h('div', { class: 'panel-sep' }), launchers, h('div', { class: 'panel-sep' }), pager, h('div', { class: 'panel-sep' })),
    tasklist,
    h('div', { class: 'panel-right' }, netBtn, volBtn, bellBtn, batBtn, h('div', { class: 'panel-sep' }), clockBtn, powerBtn),
  );

  /* ---------- task list */
  const taskButtons = new Map();
  const renderTasks = rafThrottle(() => {
    const wins = wm.windows.filter((w) => w.workspace === wm.workspace && !w.skipTaskbar && !(w.isDialog && w.parent));
    tasklist.replaceChildren();
    taskButtons.clear();
    for (const w of wins) {
      const b = h('button', {
        class: `task${wm.active === w ? ' active' : ''}${w.minimized ? ' minimized' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(wm.active === w),
        title: w.title,
      }, h('span', { class: 'task-icon', html: icon(w.iconName) }), h('span', { class: 'task-title' }, w.title));
      b.addEventListener('click', () => wm.toggleFromTaskbar(w));
      b.addEventListener('auxclick', (e) => {
        if (e.button === 1) w.close();
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        w.showWindowMenu({ x: e.clientX, y: e.clientY });
      });
      tasklist.appendChild(b);
      taskButtons.set(w, b);
    }
  });
  wm.taskbarRect = (w) => (taskButtons.get(w) || menuBtn).getBoundingClientRect();

  /* ---------- pager */
  const renderPager = rafThrottle(() => {
    const n = wm.workspaceCount;
    pager.hidden = n < 2;
    pager.replaceChildren();
    const a = wm.area();
    for (let i = 0; i < n; i++) {
      const ws = h('button', { class: `pager-ws${i === wm.workspace ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(i === wm.workspace), 'aria-label': `Workspace ${i + 1}`, title: `Workspace ${i + 1}` });
      for (const w of wm.stack) {
        if (w.workspace !== i || w.minimized || w.closed) continue;
        const g = w.displayGeometry();
        ws.appendChild(h('span', {
          class: `pager-win${wm.active === w ? ' active' : ''}`,
          style: {
            left: `${clamp((g.x / a.w) * 100, -50, 100)}%`,
            top: `${clamp((g.y / a.h) * 100, 0, 100)}%`,
            width: `${Math.min(100, (g.w / a.w) * 100)}%`,
            height: `${Math.min(100, ((w.autoHeight ? w.el.offsetHeight : g.h) / a.h) * 100)}%`,
          },
        }));
      }
      ws.appendChild(h('span', { class: 'pager-num' }, String(i + 1)));
      ws.addEventListener('click', () => wm.switchWorkspace(i));
      pager.appendChild(ws);
    }
  });

  wm.on('change', () => {
    renderTasks();
    renderPager();
  });
  wm.on('geometry', renderPager);
  renderTasks();
  renderPager();

  /* ---------- network */
  const online = () => settings.get('networking') && navigator.onLine;
  const renderNet = () => {
    netBtn.innerHTML = icon(online() ? 'network-wired' : 'network-offline');
    netBtn.title = online() ? 'Wired connection 1 — Connected' : 'Networking disabled';
  };
  renderNet();
  settings.on('change:networking', renderNet);
  window.addEventListener('online', () => {
    renderNet();
    notify({ title: 'Connection Established', body: 'You are now connected to "Wired connection 1".', icon: 'network-wired' });
  });
  window.addEventListener('offline', () => {
    renderNet();
    notify({ title: 'Disconnected', body: 'The network connection was lost.', icon: 'network-offline' });
  });

  function openNetwork() {
    if (popupFor(netBtn)) return;
    const conn = navigator.connection;
    showMenu([
      { type: 'header', label: 'Ethernet Network' },
      { label: online() ? 'Wired connection 1' : 'Disconnected', icon: online() ? 'network-wired' : 'network-offline', disabled: true },
      { type: 'separator' },
      {
        label: 'Enable Networking', type: 'checkbox', checked: settings.get('networking'),
        action: () => {
          settings.toggle('networking');
          notify(settings.get('networking')
            ? { title: 'Connection Established', body: 'You are now connected to "Wired connection 1".', icon: 'network-wired' }
            : { title: 'Networking Disabled', body: 'Apps on this desktop now treat the network as offline.', icon: 'network-offline' });
        },
      },
      {
        label: 'Connection Information', icon: 'info',
        action: () => alertDialog({
          title: 'Connection Information',
          heading: 'Wired connection 1',
          message: [
            `Browser reports: ${navigator.onLine ? 'online' : 'offline'}`,
            conn?.effectiveType ? `Effective type (browser): ${conn.effectiveType}` : null,
            conn?.downlink ? `Estimated downlink (browser): ${conn.downlink} Mbit/s` : null,
            conn?.rtt != null ? `Estimated round-trip time (browser): ${conn.rtt} ms` : null,
            'The desktop does not open real network connections of its own.',
          ].filter(Boolean).join('\n'),
          icon: 'network-wired',
        }),
      },
      { label: 'Edit Connections…', icon: 'settings', action: () => unavailableDialog({ name: 'Network Connections', unavailableReason: 'Connection editing is not available in the browser desktop.' }) },
    ], { anchor: netBtn, align: 'end' }, { ignore: (t) => netBtn.contains(t), returnFocus: netBtn });
  }

  /* ---------- volume */
  const volIcon = () => {
    const v = settings.get('volume');
    if (settings.get('muted') || v === 0) return 'volume-muted';
    return v < 34 ? 'volume-low' : v < 67 ? 'volume-medium' : 'volume-high';
  };
  const renderVol = () => {
    volBtn.innerHTML = icon(volIcon());
    volBtn.title = settings.get('muted') ? 'Volume: muted' : `Volume: ${settings.get('volume')}%`;
  };
  renderVol();
  settings.on('change:volume', renderVol);
  settings.on('change:muted', renderVol);

  function setVolume(v) {
    settings.set('volume', clamp(Math.round(v), 0, 100));
    if (settings.get('muted') && v > 0) settings.set('muted', false);
    if (settings.get('volumeFeedback')) sound.play('blip');
  }

  function openVolume() {
    if (popupFor(volBtn)) return;
    const slider = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(settings.get('volume')), class: 'slider', 'aria-label': 'Volume', autofocus: true });
    const pct = h('span', { class: 'vol-pct' }, `${settings.get('volume')}%`);
    const mute = h('button', { class: 'btn btn-flat', type: 'button' }, settings.get('muted') ? 'Unmute' : 'Mute');
    const ic = h('span', { class: 'vol-icon', html: icon(volIcon()) });
    const sync = () => {
      slider.value = String(settings.get('volume'));
      pct.textContent = settings.get('muted') ? 'Muted' : `${settings.get('volume')}%`;
      mute.textContent = settings.get('muted') ? 'Unmute' : 'Mute';
      ic.innerHTML = icon(volIcon());
    };
    slider.addEventListener('input', () => {
      setVolume(Number(slider.value));
      sync();
    });
    mute.addEventListener('click', () => {
      settings.toggle('muted');
      sync();
    });
    sync();
    showPopover(h('div', { class: 'vol-pop' },
      h('div', { class: 'pop-title' }, 'Audio output'),
      h('div', { class: 'vol-row' }, ic, slider, pct),
      h('div', { class: 'pop-actions' }, mute)), { anchor: volBtn, align: 'end' }, { ignore: (t) => volBtn.contains(t), label: 'Volume', className: 'tray-pop', returnFocus: volBtn });
  }

  /* ---------- notifications */
  const renderBell = () => {
    bellBtn.innerHTML = icon(settings.get('dnd') ? 'bell-off' : 'bell') + (notifier.unread ? '<span class="badge-dot"></span>' : '');
    bellBtn.title = settings.get('dnd') ? 'Notifications: do not disturb' : 'Notifications';
  };
  renderBell();
  notifier.on('change', renderBell);
  settings.on('change:dnd', renderBell);

  function openNotifications() {
    if (popupFor(bellBtn)) return;
    notifier.markRead();
    const list = h('div', { class: 'notif-log' });
    const renderList = () => {
      list.replaceChildren(...(notifier.log.length ? notifier.log.map((n) => h('div', { class: 'notif-entry' },
        h('span', { class: 'notif-entry-icon', html: icon(n.icon) }),
        h('div', null, h('div', { class: 'notif-entry-title' }, n.title), n.body ? h('div', { class: 'notif-entry-body' }, n.body) : null,
          h('div', { class: 'notif-entry-time' }, formatTime(new Date(n.time), { h24: settings.get('clock24') }))))) : [h('div', { class: 'empty-note' }, 'No notifications')]));
    };
    renderList();
    const dnd = switchControl(settings.get('dnd'), (v) => settings.set('dnd', v), 'Do not disturb');
    showPopover(h('div', { class: 'notif-pop' },
      h('div', { class: 'pop-row' }, h('span', null, 'Do not disturb'), dnd),
      h('div', { class: 'pop-sep' }),
      list,
      h('div', { class: 'pop-actions' }, h('button', {
        class: 'btn btn-flat', type: 'button',
        onclick: () => {
          notifier.clear();
          renderList();
        },
      }, 'Clear log'))), { anchor: bellBtn, align: 'end' }, { ignore: (t) => bellBtn.contains(t), label: 'Notifications', className: 'tray-pop', returnFocus: bellBtn });
  }

  /* ---------- battery (only when the browser reports a real one) */
  let battery = null;
  const renderBat = () => {
    if (!battery) return;
    const noBattery = battery.level === 1 && battery.charging && battery.chargingTime === 0;
    batBtn.hidden = noBattery;
    batBtn.innerHTML = batteryIcon(battery.level, battery.charging);
    batBtn.title = `Battery: ${Math.round(battery.level * 100)}%${battery.charging ? ' (charging)' : ''}`;
  };
  navigator.getBattery?.().then((b) => {
    battery = b;
    ['levelchange', 'chargingchange', 'chargingtimechange'].forEach((ev) => b.addEventListener(ev, renderBat));
    renderBat();
  }).catch(() => {});

  function openBattery() {
    if (!battery || popupFor(batBtn)) return;
    showMenu([
      { type: 'header', label: 'Battery (reported by your browser)' },
      { label: `${Math.round(battery.level * 100)}% — ${battery.charging ? 'charging' : 'discharging'}`, disabled: true },
      { type: 'separator' },
      { label: 'Power Manager Settings…', icon: 'settings', action: () => unavailableDialog({ name: 'Power Manager', unavailableReason: 'Power management is not available in the browser desktop.' }) },
    ], { anchor: batBtn, align: 'end' }, { ignore: (t) => batBtn.contains(t) });
  }

  /* ---------- clock */
  const renderClock = () => {
    const d = new Date();
    const time = formatTime(d, { h24: settings.get('clock24'), seconds: settings.get('clockSeconds') });
    clockBtn.textContent = settings.get('clockDate') ? `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}  ${time}` : time;
    clockBtn.title = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  };
  const tick = () => {
    renderClock();
    const ms = settings.get('clockSeconds') ? 1000 - (Date.now() % 1000) : 60000 - (Date.now() % 60000);
    setTimeout(tick, ms + 15);
  };
  tick();
  ['clock24', 'clockDate', 'clockSeconds'].forEach((k) => settings.on(`change:${k}`, renderClock));

  function openCalendar() {
    if (popupFor(clockBtn)) return;
    const now = new Date();
    let view = new Date(now.getFullYear(), now.getMonth(), 1);
    const timeEl = h('div', { class: 'cal-time' });
    const dateEl = h('div', { class: 'cal-date' });
    const title = h('div', { class: 'cal-month' });
    const grid = h('div', { class: 'cal-grid', role: 'grid' });
    const renderTime = () => {
      const d = new Date();
      timeEl.textContent = formatTime(d, { h24: settings.get('clock24'), seconds: true });
      dateEl.textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    };
    const renderGrid = () => {
      title.textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;
      grid.replaceChildren(...['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => h('span', { class: 'cal-dow' }, d)));
      const first = (view.getDay() + 6) % 7;
      const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      const prevDays = new Date(view.getFullYear(), view.getMonth(), 0).getDate();
      const t = new Date();
      for (let i = 0; i < 42; i++) {
        const day = i - first + 1;
        let label = day;
        let cls = 'cal-day';
        if (day < 1) {
          label = prevDays + day;
          cls += ' other';
        } else if (day > days) {
          label = day - days;
          cls += ' other';
        } else if (day === t.getDate() && view.getMonth() === t.getMonth() && view.getFullYear() === t.getFullYear()) cls += ' today';
        grid.appendChild(h('span', { class: cls }, String(label)));
      }
    };
    const nav = (d) => {
      view = new Date(view.getFullYear(), view.getMonth() + d, 1);
      renderGrid();
    };
    renderTime();
    renderGrid();
    const timer = setInterval(renderTime, 1000);
    showPopover(h('div', { class: 'cal-pop' },
      timeEl, dateEl,
      h('div', { class: 'cal-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous month', html: icon('chevron-left'), onclick: () => nav(-1) }),
        title,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next month', html: icon('chevron-right'), onclick: () => nav(1) })),
      grid,
      h('div', { class: 'pop-actions' }, h('button', {
        class: 'btn btn-flat', type: 'button',
        onclick: () => {
          view = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
          renderGrid();
        },
      }, 'Today'))), { anchor: clockBtn, align: 'end' }, { ignore: (t) => clockBtn.contains(t), label: 'Calendar', className: 'tray-pop', onClose: () => clearInterval(timer), returnFocus: clockBtn });
  }

  /* ---------- power */
  function openPower() {
    if (popupFor(powerBtn)) return;
    showMenu([
      { label: 'Lock Screen', icon: 'lock', shortcut: 'Ctrl+Alt+L', action: lockScreen },
      { label: 'Switch User', icon: 'switch-user', action: () => unavailableDialog({ name: 'Switch User', unavailableReason: 'This desktop has a single user account.' }) },
      { type: 'separator' },
      { label: 'Log Out…', icon: 'logout', action: () => logoutDialog('logout') },
      { label: 'Restart…', icon: 'restart', action: () => logoutDialog('restart') },
      { label: 'Shut Down…', icon: 'power', action: () => logoutDialog('shutdown') },
    ], { anchor: powerBtn, align: 'end' }, { ignore: (t) => powerBtn.contains(t), returnFocus: powerBtn });
  }

  /** Clicking a tray button again closes its popover. */
  function popupFor(anchorBtn) {
    const cur = currentPopup();
    if (cur && cur.anchor === anchorBtn) {
      closeMenus();
      return true;
    }
    queueMicrotask(() => {
      const p = currentPopup();
      if (p) p.anchor = anchorBtn;
    });
    return false;
  }

  return { menuBtn };
}

export function switchControl(checked, onChange, label) {
  const sw = h('button', { class: `switch${checked ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label });
  sw.addEventListener('click', () => {
    const v = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(v));
    sw.classList.toggle('on', v);
    onChange(v);
  });
  return sw;
}
