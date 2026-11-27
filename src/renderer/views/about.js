import { h, button } from '../ui.js';
import { showFdaPrompt } from './fda-prompt.js';

let info = null;

export function renderAbout(ctx) {
  const { api, state } = ctx;
  const o = state.overview;
  const root = h('div', {});
  const meta = h('dl', { class: 'kv' });
  const fill = () =>
    meta.replaceChildren(
      h('dt', {}, 'Version'),
      h('dd', {}, info ? `${info.version} (Electron ${info.electron})` : '…'),
      h('dt', {}, 'Full Disk Access'),
      h('dd', {}, o ? (o.fullDiskAccess ? 'Granted' : 'Not granted') : '…'),
      h('dt', {}, 'Mac'),
      h('dd', {}, o ? `${o.machine.model} · macOS ${o.machine.macos} · ${o.machine.arch}` : '…'),
    );
  fill();
  if (!info) api.info().then((i) => ((info = i), fill(), ctx.state.route === 'about' && ctx.render()));

  root.append(
    h(
      'div',
      { class: 'card welcome', style: { marginBottom: '16px' } },
      h('img', { src: 'assets/icon.png', alt: '', style: { animation: 'none' } }),
      h(
        'div',
        { class: 'grow' },
        h('h3', { style: { fontSize: '22px' } }, 'Silt'),
        h('p', {}, 'Storage, explained. A free, open-source storage analyzer and cleaner for macOS.'),
        h('div', { class: 'steps' }, h('span', {}, info ? `Version ${info.version}` : 'Version …'), h('span', {}, 'MIT License'), h('span', {}, 'No tracking')),
      ),
      button('View on GitHub', { onClick: () => api.openUrl('https://github.com/thestealthgoat/Mac-cleaning') }),
    ),
    h(
      'div',
      { class: 'grid two' },
      h(
        'div',
        { class: 'card prose' },
        h('h3', { style: { marginTop: 0 } }, 'How Silt keeps your data safe'),
        h(
          'ul',
          {},
          h('li', {}, 'Nothing is deleted permanently. Every cleanup moves items to the Trash, where you can put them back.'),
          h('li', {}, 'Only “Empty Trash” is permanent, and it always asks first.'),
          h('li', {}, 'System folders, iCloud Drive, Mail, Messages, Keychains and Preferences are on a hard-coded deny list.'),
          h('li', {}, 'Tool-managed data (Docker, simulators, Homebrew, npm…) is reclaimed with the tool’s own command, shown to you in Terminal.'),
          h('li', {}, 'No telemetry, no accounts, and nothing about your files ever leaves your Mac. The only network request is checking GitHub for a newer version, which you can turn off. Scan history is kept in Silt’s own folder on this Mac, and you can clear it from System Data.'),
        ),
        h('h3', {}, 'Why “System Data” is so big'),
        h(
          'p',
          {},
          'macOS’s Storage settings files anything it can’t classify under System Data: app caches, logs, developer tools, virtual machines, iPhone backups, local snapshots, swap, and leftovers from deleted apps. Silt measures each of these separately so you can see what is actually there.',
        ),
      ),
      h(
        'div',
        { class: 'card prose' },
        h('h3', { style: { marginTop: 0 } }, 'This Mac'),
        meta,
        updatesSection(ctx),
        h('h3', {}, 'License'),
        h('p', {}, 'MIT. Contributions to the hidden-data catalog (', h('code', {}, 'src/core/catalog.js'), ') are especially welcome.'),
      ),
    ),
  );
  return root;
}

function updatesSection(ctx) {
  const { api, state } = ctx;
  const u = state.update || {};
  const box = h('div', {});
  const statusText = {
    dev: 'Updates are off in development builds.',
    idle: 'Not checked yet.',
    checking: 'Checking…',
    current: `You have the latest version${u.checkedAt ? ` (checked ${new Date(u.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : ''}.`,
    downloading: `Downloading Silt ${u.version || ''}… ${u.progress != null ? `${u.progress}%` : ''}`,
    ready: `Silt ${u.version} is ready to install.`,
    error: `Couldn’t check: ${u.error || 'unknown error'}`,
  }[u.status] || '';
  const toggle = h('input', {
    type: 'checkbox',
    checked: u.autoUpdate !== false,
    disabled: u.status === 'dev',
    onchange: async (e) => {
      await api.setSetting('autoUpdate', e.target.checked);
      state.update = { ...u, autoUpdate: e.target.checked };
    },
  });
  box.append(
    h('h3', {}, 'Updates'),
    h('label', { class: 'switch-row' }, toggle, 'Check for updates automatically'),
    h('p', { style: { margin: '4px 0 10px' } }, statusText),
    u.status === 'ready'
      ? button('Restart to Update', { kind: 'primary', onClick: () => api.installUpdate() })
      : button('Check Now', { disabled: u.status === 'dev' || u.status === 'checking' || u.status === 'downloading', onClick: () => api.checkForUpdates() }),
  );
  const granted = !!state.overview?.fullDiskAccess;
  const ask = h('input', {
    type: 'checkbox',
    checked: state.settings?.fdaPrompt !== false,
    disabled: granted,
    onchange: async (e) => {
      state.settings = await api.setSetting('fdaPrompt', e.target.checked);
    },
  });
  box.append(
    h('h3', { style: { marginTop: 22 } }, 'Full Disk Access'),
    h('p', { style: { margin: '4px 0 10px' } }, granted ? 'On. Silt can measure everything, including app containers and backups.' : 'Off. App containers, Mail, Messages and iPhone backups can’t be measured.'),
    granted ? null : h('label', { class: 'switch-row' }, ask, 'Ask when Silt opens'),
    granted ? null : button('Turn On…', { kind: 'primary', onClick: () => showFdaPrompt(api) }),
  );
  return box;
}
