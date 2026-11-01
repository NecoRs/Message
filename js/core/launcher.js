// Opens applications: focuses an existing window for single-instance apps,
// otherwise lazily loads the app module and mounts it in a new window.
import { getApp, appByExec, APPS } from '../apps/registry.js';
import { wm } from './wm.js';
import { settings } from './settings.js';
import { unavailableDialog, alertDialog } from './dialog.js';

function recordRecent(id) {
  const recent = settings.get('recent').filter((x) => x !== id);
  recent.unshift(id);
  settings.set('recent', recent.slice(0, 10));
}

export async function launch(id, opts = {}) {
  const app = getApp(id);
  if (!app) return null;
  recordRecent(id);
  if (!app.load) {
    unavailableDialog(app);
    return null;
  }
  if (!opts.newWindow && app.single !== false) {
    const existing = wm.findByApp(id);
    if (existing) {
      wm.restore(existing);
      existing.emit('reopen', opts);
      return existing;
    }
  }
  let mod;
  try {
    mod = await app.load();
  } catch (err) {
    console.error(err);
    alertDialog({ title: app.name, heading: `Failed to start ${app.name}`, message: 'The application files could not be loaded.', icon: 'error' });
    return null;
  }
  const win = wm.create({ appId: id, title: app.name, icon: app.icon, ...app.window, ...opts.window });
  try {
    await mod.mount(win, opts);
  } catch (err) {
    console.error(err);
    win.close(true);
    alertDialog({ title: app.name, heading: `${app.name} stopped unexpectedly`, message: String(err.message || err), icon: 'error' });
    return null;
  }
  return win;
}

export function launchExec(exec, opts) {
  const app = appByExec(exec);
  return app ? launch(app.id, opts) : null;
}

/** Warms the module cache once the desktop is idle. */
export function preloadApps() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => APPS.filter((a) => a.load).forEach((a) => a.load().catch(() => {})));
}
