// Whisker-style application menu.
import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { settings } from '../core/settings.js';
import { showPopover, closeMenus, currentPopup } from '../core/menu.js';
import { launch } from '../core/launcher.js';
import { APPS, CATEGORIES, getApp, isAvailable } from '../apps/registry.js';
import { lockScreen, logoutDialog } from './session.js';

let lastCategory = 'favorites';

export function toggleWhisker(anchor) {
  const cur = currentPopup();
  if (cur && cur.whisker) {
    closeMenus();
    return;
  }
  openWhisker(anchor);
}

function appsIn(cat) {
  if (cat === 'favorites') return settings.get('favorites').map(getApp).filter(Boolean);
  if (cat === 'recent') return settings.get('recent').map(getApp).filter(Boolean);
  const list = cat === 'all' ? [...APPS] : APPS.filter((a) => a.categories.includes(cat));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function openWhisker(anchor) {
  let category = lastCategory;
  let results = [];
  let active = 0;

  const search = h('input', { class: 'entry whisker-search', type: 'search', placeholder: 'Search…', 'aria-label': 'Search applications', autofocus: true, spellcheck: 'false' });
  const list = h('div', { class: 'whisker-apps', role: 'listbox', 'aria-label': 'Applications' });
  const cats = h('div', { class: 'whisker-cats', role: 'tablist', 'aria-label': 'Categories' });

  const run = (app) => {
    closeMenus();
    launch(app.id);
  };

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    if (q) {
      results = APPS.filter((a) => [a.name, a.comment, a.exec, ...(a.keywords || [])].some((s) => s?.toLowerCase().includes(q)))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
    } else results = appsIn(category);
    active = Math.min(active, Math.max(0, results.length - 1));
    const favs = settings.get('favorites');
    list.replaceChildren(...(results.length ? results.map((app, i) => {
      const fav = favs.includes(app.id);
      const star = h('button', {
        class: `whisker-fav${fav ? ' on' : ''}`, type: 'button', tabindex: '-1',
        'aria-label': fav ? `Remove ${app.name} from Favorites` : `Add ${app.name} to Favorites`,
        title: fav ? 'Remove from Favorites' : 'Add to Favorites',
        html: icon(fav ? 'star-filled' : 'star'),
      });
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = settings.get('favorites');
        settings.set('favorites', cur.includes(app.id) ? cur.filter((x) => x !== app.id) : [...cur, app.id]);
        renderList();
      });
      const row = h('div', {
        class: `whisker-app${i === active ? ' active' : ''}${isAvailable(app) ? '' : ' unavailable'}`,
        role: 'option',
        'aria-selected': String(i === active),
        title: app.comment || app.name,
      },
      h('span', { class: 'whisker-app-icon', html: icon(app.icon) }),
      h('span', { class: 'whisker-app-text' },
        h('span', { class: 'whisker-app-name' }, app.name),
        h('span', { class: 'whisker-app-comment' }, isAvailable(app) ? app.comment : 'Not available')),
      star);
      row.addEventListener('click', () => run(app));
      row.addEventListener('pointerenter', () => setActive(i));
      return row;
    }) : [h('div', { class: 'empty-note' }, q ? 'No applications found' : 'Nothing here yet')]));
  };

  const setActive = (i) => {
    list.children[active]?.classList.remove('active');
    active = i;
    const row = list.children[active];
    row?.classList.add('active');
    row?.scrollIntoView({ block: 'nearest' });
  };

  const renderCats = () => {
    cats.replaceChildren(...CATEGORIES.map((c) => {
      const b = h('button', { class: `whisker-cat${c.id === category && !search.value ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(c.id === category), html: icon(c.icon) });
      b.appendChild(h('span', null, c.name));
      b.addEventListener('click', () => {
        category = lastCategory = c.id;
        search.value = '';
        active = 0;
        renderCats();
        renderList();
        search.focus();
      });
      return b;
    }));
  };

  search.addEventListener('input', () => {
    active = 0;
    renderCats();
    renderList();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(results.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) run(results[active]);
    }
  });

  const action = (label, ic, fn) => h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, html: icon(ic), onclick: () => { closeMenus(); fn(); } });

  renderCats();
  renderList();
  const content = h('div', { class: 'whisker' },
    h('div', { class: 'whisker-head' },
      h('span', { class: 'whisker-avatar', html: icon('user') }),
      h('span', { class: 'whisker-user' }, 'kali'),
      h('span', { class: 'whisker-actions' },
        action('All Settings', 'settings', () => launch('settings')),
        action('Lock Screen', 'lock', lockScreen),
        action('Log Out', 'logout', () => logoutDialog('logout')))),
    h('div', { class: 'whisker-searchrow' }, h('span', { class: 'whisker-search-icon', html: icon('search') }), search),
    h('div', { class: 'whisker-body' }, list, cats));

  const p = showPopover(content, { anchor }, { ignore: (t) => anchor.contains(t), label: 'Applications menu', className: 'whisker-pop', returnFocus: anchor, onClose: () => anchor.classList.remove('open') });
  p.whisker = true;
  anchor.classList.add('open');
}
