// Lock screen, log out, restart and shut down sequences.
import { h, formatTime, DAYS, MONTHS } from '../core/util.js';
import { icon } from '../core/icons.js';
import { wm } from '../core/wm.js';
import { settings } from '../core/settings.js';
import { messageDialog } from '../core/dialog.js';
import { closeMenus } from '../core/menu.js';

const overlayRoot = () => document.getElementById('overlays');
let active = null;

function closeAllWindows() {
  for (const w of [...wm.windows]) w.close(true);
}

/** Greeter used for both the lock screen and the login screen. */
function greeter({ mode }) {
  if (active) return;
  closeMenus();
  const time = h('div', { class: 'greeter-time' });
  const date = h('div', { class: 'greeter-date' });
  const msg = h('div', { class: 'greeter-msg', role: 'alert' });
  const pass = h('input', { class: 'entry greeter-pass', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password for kali' });
  let failures = 0;
  const update = () => {
    const d = new Date();
    time.textContent = formatTime(d, { h24: settings.get('clock24') });
    date.textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };
  update();
  const timer = setInterval(update, 1000);
  const form = h('form', { class: 'greeter-box' },
    h('div', { class: 'greeter-avatar', html: icon('user') }),
    h('div', { class: 'greeter-user' }, 'kali'),
    h('div', { class: 'greeter-row' }, pass, h('button', { class: 'btn btn-primary greeter-go', type: 'submit', 'aria-label': mode === 'lock' ? 'Unlock' : 'Log In', html: icon('go-forward') })),
    msg);
  const el = h('div', { class: `greeter greeter-${mode}`, role: 'dialog', 'aria-label': mode === 'lock' ? 'Screen locked' : 'Log in' },
    h('div', { class: 'greeter-clock' }, time, date), form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pass.value === 'kali') {
      clearInterval(timer);
      el.classList.add('leaving');
      setTimeout(() => {
        el.remove();
        active = null;
      }, 300);
      return;
    }
    failures++;
    pass.value = '';
    msg.textContent = failures > 1 ? 'Authentication failed. The default password is "kali".' : 'Authentication failed.';
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
  });
  active = el;
  overlayRoot().appendChild(el);
  requestAnimationFrame(() => pass.focus());
}

export function lockScreen() {
  greeter({ mode: 'lock' });
}

function blackScreen(lines, then) {
  closeMenus();
  const log = h('pre', { class: 'boot-log' });
  const el = h('div', { class: 'blackscreen' }, log);
  overlayRoot().appendChild(el);
  active = el;
  let i = 0;
  const step = () => {
    if (i < lines.length) {
      log.textContent += lines[i++] + '\n';
      setTimeout(step, 70 + Math.random() * 90);
    } else {
      setTimeout(() => then(el), 350);
    }
  };
  step();
}

const OK = (s) => `[  OK  ] ${s}`;

function bootSequence(el) {
  const log = el.querySelector('.boot-log');
  log.textContent = '';
  const lines = [
    'Loading Linux 6.16.8-amd64 ...',
    'Loading initial ramdisk ...',
    OK('Started systemd-journald.service - Journal Service.'),
    OK('Reached target local-fs.target - Local File Systems.'),
    OK('Started NetworkManager.service - Network Manager.'),
    OK('Started lightdm.service - Light Display Manager.'),
  ];
  let i = 0;
  const step = () => {
    if (i < lines.length) {
      log.textContent += lines[i++] + '\n';
      setTimeout(step, 110 + Math.random() * 120);
    } else {
      setTimeout(() => {
        el.remove();
        active = null;
        greeter({ mode: 'login' });
      }, 400);
    }
  };
  step();
}

export async function logoutDialog(initial = 'logout') {
  const labels = { logout: 'Log Out', restart: 'Restart', shutdown: 'Shut Down' };
  const r = await messageDialog({
    title: 'Log Out kali',
    heading: `${labels[initial]}?`,
    message: 'Open windows will be closed. Files you saved are kept.',
    icon: initial === 'shutdown' ? 'power' : initial === 'restart' ? 'restart' : 'logout',
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Log Out', value: 'logout', primary: initial === 'logout' },
      { label: 'Restart', value: 'restart', primary: initial === 'restart' },
      { label: 'Shut Down', value: 'shutdown', primary: initial === 'shutdown' },
    ],
    width: 460,
  });
  if (!r.button) return;
  closeAllWindows();
  if (r.button === 'logout') {
    setTimeout(() => greeter({ mode: 'login' }), 250);
  } else if (r.button === 'restart') {
    blackScreen([
      OK('Stopped target graphical.target - Graphical Interface.'),
      OK('Stopped lightdm.service - Light Display Manager.'),
      OK('Stopped NetworkManager.service - Network Manager.'),
      OK('Reached target reboot.target - System Reboot.'),
    ], bootSequence);
  } else {
    blackScreen([
      OK('Stopped target graphical.target - Graphical Interface.'),
      OK('Stopped lightdm.service - Light Display Manager.'),
      OK('Reached target poweroff.target - System Power Off.'),
    ], (el) => {
      el.replaceChildren(h('button', {
        class: 'power-on', type: 'button', 'aria-label': 'Power on', html: icon('power'),
        onclick: () => {
          el.replaceChildren(h('pre', { class: 'boot-log' }));
          bootSequence(el);
        },
      }));
      el.querySelector('.power-on').focus();
    });
  }
}

export const sessionLocked = () => !!active;
