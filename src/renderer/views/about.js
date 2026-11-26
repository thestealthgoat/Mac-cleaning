import { h, button } from '../ui.js';

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
        h('div', { class: 'steps' }, h('span', {}, info ? `Version ${info.version}` : 'Version …'), h('span', {}, 'MIT License'), h('span', {}, 'No tracking, no network')),
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
          h('li', {}, 'No network access, no telemetry, no accounts. Silt never sends data anywhere.'),
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
        h('h3', {}, 'Permissions'),
        h('p', {}, 'Full Disk Access lets Silt measure protected folders such as Mail, Messages, app containers and device backups. It is optional.'),
        button('Open Full Disk Access settings', { onClick: () => api.openFdaSettings() }),
        h('h3', {}, 'License'),
        h('p', {}, 'MIT. Contributions to the hidden-data catalog (', h('code', {}, 'src/core/catalog.js'), ') are especially welcome.'),
      ),
    ),
  );
  return root;
}
