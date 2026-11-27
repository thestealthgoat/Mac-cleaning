import { h, button, icon } from '../ui.js';

/**
 * Full Disk Access prompt. Shown when Silt opens without access (until the
 * person ticks "Don't ask again"), and from the "Full Disk Access is off" banner.
 *
 * macOS never lets an app grant itself this permission, so the prompt explains
 * why it's needed, opens the right Settings pane, waits for the switch to be
 * turned on, and offers to restart Silt so the new access takes effect.
 */

let open = null; // { el, poll, onKey, prevFocus }

export async function maybePromptForFda(api, overview) {
  if (!overview || overview.fullDiskAccess) return;
  try {
    const [settings, info] = await Promise.all([api.getSettings(), api.info()]);
    if (!settings.fdaPrompt) return;
    if (!info.packaged && !info.fdaPromptInDev) return; // dev builds get the banner instead
  } catch {
    return;
  }
  showFdaPrompt(api);
}

export function closeFdaPrompt() {
  if (!open) return;
  clearInterval(open.poll);
  document.removeEventListener('keydown', open.onKey, true);
  open.el.remove();
  open.prevFocus?.focus?.();
  open = null;
}

export function showFdaPrompt(api) {
  if (open) return;
  const dontAsk = h('input', { type: 'checkbox', id: 'fda-dont-ask' });
  const body = h('div', { class: 'fda-body' });
  const actions = h('div', { class: 'fda-actions' });
  const dialog = h(
    'div',
    { class: 'fda-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fda-title', 'aria-describedby': 'fda-desc' },
    h('div', { class: 'fda-icon' }, icon('lock')),
    h('h2', { id: 'fda-title' }, 'Let Silt see all of your storage'),
    body,
    actions,
  );
  const overlay = h('div', { class: 'fda-overlay' }, dialog);

  const notNow = async () => {
    if (dontAsk.checked) await api.setSetting('fdaPrompt', false).catch(() => {});
    closeFdaPrompt();
  };

  const restart = button('Restart Silt', { kind: 'primary', onClick: () => api.relaunch() });

  function showIntro() {
    body.replaceChildren(
      h(
        'p',
        { id: 'fda-desc' },
        'macOS keeps some folders private until you allow access: app containers, Mail, Messages and iPhone backups. Without it, part of your System Data can’t be measured or explained.',
      ),
      h(
        'ol',
        { class: 'fda-steps' },
        h('li', {}, 'Click ', h('b', {}, 'Open Settings'), '.'),
        h('li', {}, 'Turn on ', h('b', {}, 'Silt'), ' in the Full Disk Access list. If it isn’t there, click ', h('b', {}, '+'), ' and choose Silt from Applications.'),
        h('li', {}, 'Restart Silt when macOS asks, so the new access takes effect.'),
      ),
      h('p', { class: 'faint' }, 'Silt only reads names and sizes, on your Mac. Nothing about your files ever leaves it, and Silt never deletes anything without asking.'),
      h('label', { class: 'fda-check' }, dontAsk, 'Don’t ask again when Silt opens'),
    );
    const openSettings = button('Open Settings', { kind: 'primary' });
    openSettings.onclick = async () => {
      await api.openFdaSettings();
      showWaiting();
    };
    actions.replaceChildren(button('Not now', { onClick: notNow }), openSettings);
    requestAnimationFrame(() => openSettings.focus());
  }

  function showWaiting() {
    body.replaceChildren(
      h('p', { id: 'fda-desc' }, 'In System Settings, turn on ', h('b', {}, 'Silt'), ' under Privacy & Security › Full Disk Access. If Silt isn’t listed, click ', h('b', {}, '+'), ' and choose it from Applications, or drag it in from Finder.'),
      h('div', { class: 'fda-wait', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Waiting for access…'),
      h('p', { class: 'faint' }, 'If macOS offers “Quit & Reopen”, choose it. Otherwise restart Silt here once the switch is on.'),
    );
    actions.replaceChildren(
      button('Show Silt in Finder', { kind: 'ghost', onClick: () => api.revealApp() }),
      h('span', { class: 'spacer' }),
      button('Not now', { onClick: notNow }),
      restart,
    );
    clearInterval(open.poll);
    open.poll = setInterval(async () => {
      const granted = await api.fdaStatus().catch(() => false);
      if (granted) showGranted();
    }, 1500);
  }

  function showGranted() {
    clearInterval(open.poll);
    body.replaceChildren(h('p', { id: 'fda-desc' }, h('b', {}, 'Full Disk Access is on. '), 'Restart Silt so it can measure everything, including app containers and backups.'));
    actions.replaceChildren(button('Later', { onClick: closeFdaPrompt }), restart);
    requestAnimationFrame(() => restart.focus());
  }

  // Keyboard: Esc means "Not now"; Tab stays inside the dialog.
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      notNow();
    } else if (e.key === 'Tab') {
      const f = [...dialog.querySelectorAll('button, input, [href]')].filter((x) => !x.disabled);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  open = { el: overlay, poll: null, onKey, prevFocus: document.activeElement };
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  showIntro();
}
