// XFCE/GTK style dialogs, shown as small windows through the window manager.
import { h } from './util.js';
import { icon } from './icons.js';
import { wm } from './wm.js';

/**
 * Shows a dialog and resolves with { button, value } (button = the clicked
 * button's value, or null if the dialog was closed).
 */
export function messageDialog({
  title = '',
  heading = '',
  message = '',
  icon: ic = 'info',
  buttons = [{ label: 'OK', value: true, primary: true }],
  parent = null,
  input = null, // { value, placeholder, selectBase }
  width = 420,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (button) => {
      if (settled) return;
      settled = true;
      resolve({ button, value: field ? field.value : null });
      win.close(true);
    };
    const win = wm.create({
      appId: 'dialog',
      title,
      icon: ic,
      width,
      height: 'auto',
      dialog: true,
      modal: !!parent,
      parent,
      resizable: false,
      minimizable: false,
      maximizable: false,
    });
    win.on('close', () => {
      if (!settled) {
        settled = true;
        resolve({ button: null, value: null });
      }
    });

    const field = input ? h('input', { class: 'entry dialog-entry', type: 'text', value: input.value ?? '', placeholder: input.placeholder || '', spellcheck: 'false', 'aria-label': heading || title }) : null;
    const btnEls = buttons.map((b) => h('button', {
      class: `btn${b.primary ? ' btn-primary' : ''}${b.danger ? ' btn-danger' : ''}`,
      type: 'button',
      onclick: () => finish(b.value),
    }, b.label));

    const symbolic = ['info', 'warning', 'error', 'question'].includes(ic);
    win.body.classList.add('dialog');
    win.body.append(
      h('div', { class: 'dialog-main' },
        h('div', { class: `dialog-icon${symbolic ? ` dialog-icon-${ic}` : ''}`, html: icon(ic) }),
        h('div', { class: 'dialog-text' },
          heading ? h('div', { class: 'dialog-heading' }, heading) : null,
          message ? h('div', { class: 'dialog-message' }, message) : null,
          field)),
      h('div', { class: 'dialog-buttons' }, btnEls));

    win.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.target.closest('button')) {
        e.preventDefault();
        const primary = buttons.find((b) => b.primary) || buttons[buttons.length - 1];
        finish(primary.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    });

    wm.recenter(win);
    requestAnimationFrame(() => {
      if (field) {
        field.focus();
        const dot = input.selectBase ? field.value.lastIndexOf('.') : -1;
        field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
      } else {
        const primaryIndex = Math.max(0, buttons.findIndex((b) => b.primary));
        btnEls[primaryIndex]?.focus();
      }
    });
    win.on('activate', () => (field || btnEls[btnEls.length - 1])?.focus());
  });
}

export async function alertDialog(opts) {
  await messageDialog(opts);
}

export async function confirmDialog({ confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, ...opts }) {
  const r = await messageDialog({
    icon: 'question',
    ...opts,
    buttons: [{ label: cancelLabel, value: false }, { label: confirmLabel, value: true, primary: !danger, danger }],
  });
  return r.button === true;
}

export async function promptDialog({ value = '', okLabel = 'OK', placeholder = '', selectBase = false, ...opts }) {
  const r = await messageDialog({
    icon: 'edit',
    ...opts,
    input: { value, placeholder, selectBase },
    buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: true }],
  });
  return r.button === true ? r.value : null;
}

/** Clear "not available" state for apps that are not implemented. */
export function unavailableDialog(app, parent = null) {
  return alertDialog({
    title: app.name,
    heading: `${app.name} is not available`,
    message: app.unavailableReason || `${app.name} is not included in this browser desktop. Nothing was started.`,
    icon: 'info',
    parent,
  });
}
