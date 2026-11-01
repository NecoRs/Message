// Desktop bootstrap: applies preferences, starts the window manager, panel,
// desktop icons and global keyboard shortcuts.
import { settings, ACCENTS, wallpaperById } from './core/settings.js';
import { wm } from './core/wm.js';
import { notifier, notify } from './core/notify.js';
import { closeMenus, isMenuOpen } from './core/menu.js';
import { launch, preloadApps } from './core/launcher.js';
import { isTextInput } from './core/util.js';
import { initPanel } from './ui/panel.js';
import { initDesktop } from './ui/desktop.js';
import { toggleWhisker } from './ui/whisker.js';
import { lockScreen, sessionLocked } from './ui/session.js';

const root = document.documentElement;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function applyAppearance() {
  root.dataset.theme = settings.get('theme');
  const a = ACCENTS[settings.get('accent')] || ACCENTS.blue;
  root.style.setProperty('--accent', a.main);
  root.style.setProperty('--accent-2', a.second);
  root.style.setProperty('--accent-rgb', hexToRgb(a.main));
  root.style.setProperty('--fs', `${settings.get('fontSize')}px`);
  root.classList.toggle('no-anim', !settings.get('animations'));
}

function applyWallpaper() {
  const el = document.getElementById('wallpaper');
  const id = settings.get('wallpaper');
  const wp = wallpaperById(id);
  el.style.backgroundColor = settings.get('wallpaperColor');
  if (!wp || id === 'solid') {
    el.style.backgroundImage = 'none';
    return;
  }
  const style = settings.get('wallpaperStyle');
  el.style.backgroundImage = `url("${wp.file}")`;
  el.style.backgroundSize = style === 'contain' ? 'contain' : style === 'center' ? 'auto' : 'cover';
  el.style.backgroundPosition = wp.position || 'center';
}

function trackViewport() {
  const vv = window.visualViewport;
  const set = () => root.style.setProperty('--app-h', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
  set();
  (vv || window).addEventListener('resize', set);
}

function shortcuts(menuBtn) {
  let metaAlone = false;
  document.addEventListener('keydown', (e) => {
    if (sessionLocked()) return;
    if (e.key === 'Meta' || e.key === 'OS') {
      metaAlone = true;
      return;
    }
    metaAlone = false;
    const ctrlAlt = e.ctrlKey && e.altKey;
    if (e.ctrlKey && !e.altKey && e.key === 'Escape') {
      e.preventDefault();
      toggleWhisker(menuBtn);
    } else if (ctrlAlt && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      launch('terminal', { newWindow: true });
    } else if (ctrlAlt && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      wm.showDesktop();
    } else if (ctrlAlt && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      lockScreen();
    } else if (ctrlAlt && e.key === 'ArrowLeft') {
      e.preventDefault();
      wm.switchWorkspace(wm.workspace - 1);
    } else if (ctrlAlt && e.key === 'ArrowRight') {
      e.preventDefault();
      wm.switchWorkspace(wm.workspace + 1);
    } else if (ctrlAlt && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      wm.switchWorkspace(Number(e.key) - 1);
    } else if (e.altKey && e.key === 'F4' && wm.active) {
      e.preventDefault();
      wm.active.close();
    } else if (e.altKey && e.key === 'F9' && wm.active) {
      e.preventDefault();
      wm.active.minimize();
    } else if (e.altKey && e.key === 'F10' && wm.active) {
      e.preventDefault();
      wm.active.toggleMaximize();
    } else if (e.altKey && e.key === '`') {
      e.preventDefault();
      wm.cycle();
    } else if (e.key === 'Escape' && !isMenuOpen() && !isTextInput(e.target)) {
      closeMenus();
    }
  });
  document.addEventListener('keyup', (e) => {
    if ((e.key === 'Meta' || e.key === 'OS') && metaAlone && !sessionLocked()) toggleWhisker(menuBtn);
    metaAlone = false;
  });
}

function boot() {
  applyAppearance();
  applyWallpaper();
  trackViewport();
  ['theme', 'accent', 'fontSize', 'animations'].forEach((k) => settings.on(`change:${k}`, applyAppearance));
  ['wallpaper', 'wallpaperColor', 'wallpaperStyle'].forEach((k) => settings.on(`change:${k}`, applyWallpaper));

  wm.init(document.getElementById('windows'));
  notifier.init(document.getElementById('notifications'));
  const { menuBtn } = initPanel(document.getElementById('panel'));
  initDesktop(document.getElementById('desktop-icons'));
  shortcuts(menuBtn);

  // The page itself never shows the browser's context menu, except in text fields.
  document.addEventListener('contextmenu', (e) => {
    if (!isTextInput(e.target) && !e.target.closest?.('.allow-native-menu')) e.preventDefault();
  });

  if (settings.get('networking') && navigator.onLine) {
    setTimeout(() => notify({ title: 'Connection Established', body: 'You are now connected to "Wired connection 1".', icon: 'network-wired' }), 1600);
  }
  preloadApps();
  document.body.classList.add('ready');
}

boot();
