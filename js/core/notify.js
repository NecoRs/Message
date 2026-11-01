// xfce4-notifyd style notifications with a log (shown from the panel bell).
import { Emitter } from './events.js';
import { h } from './util.js';
import { icon } from './icons.js';
import { settings } from './settings.js';

class Notifier extends Emitter {
  constructor() {
    super();
    this.log = [];
    this.unread = 0;
    this.container = null;
  }

  init(container) {
    this.container = container;
  }

  notify({ title, body = '', icon: ic = 'info', timeout = 5000 }) {
    const entry = { title, body, icon: ic, time: Date.now() };
    this.log.unshift(entry);
    this.log.length = Math.min(this.log.length, 50);
    if (settings.get('dnd') || !this.container) {
      this.unread++;
      this.emit('change');
      return;
    }
    const close = () => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 180);
    };
    const el = h('div', { class: 'notification', role: 'status' },
      h('div', { class: 'notification-icon', html: icon(ic) }),
      h('div', { class: 'notification-text' },
        h('div', { class: 'notification-title' }, title),
        body ? h('div', { class: 'notification-body' }, body) : null),
      h('button', { class: 'notification-close', type: 'button', 'aria-label': 'Close notification', html: icon('close'), onclick: close }));
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.notification-close')) close();
    });
    this.container.prepend(el);
    while (this.container.children.length > 4) this.container.lastElementChild.remove();
    if (timeout) setTimeout(close, timeout);
    this.emit('change');
  }

  markRead() {
    this.unread = 0;
    this.emit('change');
  }

  clear() {
    this.log = [];
    this.unread = 0;
    this.emit('change');
  }
}

export const notifier = new Notifier();
export const notify = (opts) => notifier.notify(opts);
