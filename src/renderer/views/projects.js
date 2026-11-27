import { h, bytes, icon, button, busy, viewHead, tilde, dirname, age, toast, cleanupToast } from '../ui.js';

const ui = {
  tab: 'code',
  codeFilter: 'all',
  codeSort: 'size',
  mediaFilter: 'all',
  open: new Set(),
  showAll: new Set(),
  scanningProjects: false,
  scanningPlugins: false,
};
const DAY = 86400000;

export function renderProjects(ctx) {
  const { state } = ctx;
  if (state.projectsTab) {
    ui.tab = state.projectsTab;
    state.projectsTab = null;
  }
  if (!state.projects && !ui.scanningProjects) scanProjects(ctx);
  if (ui.tab === 'plugins' && !state.plugins && !ui.scanningPlugins) scanPlugins(ctx);

  const tabs = h(
    'div',
    { class: 'segmented' },
    ...[
      ['code', 'Code'],
      ['media', 'Music & Live'],
      ['plugins', 'Plug-ins & Libraries'],
    ].map(([id, label]) =>
      h(
        'button',
        {
          class: ui.tab === id ? 'active' : '',
          onclick: () => {
            ui.tab = id;
            ctx.render();
          },
        },
        label,
      ),
    ),
  );
  const rescan = button('Rescan', {
    iconName: 'scan',
    disabled: ui.scanningProjects || ui.scanningPlugins,
    onClick: () => (ui.tab === 'plugins' ? scanPlugins(ctx) : scanProjects(ctx)),
  });

  const body = ui.tab === 'plugins' ? pluginsTab(ctx) : ui.scanningProjects || !state.projects ? scanningCard('Finding your projects…', 'Looking through your home folder for code repositories, DAW sessions, keys rigs and presentation libraries.') : ui.tab === 'code' ? codeTab(ctx) : mediaTab(ctx);

  return h(
    'div',
    {},
    viewHead('Projects', 'Silt works out which project your files belong to: code repositories, DAW sessions, keys rigs and the plug-ins and sound libraries behind them.', rescan),
    h('div', { class: 'toolbar' }, tabs),
    body,
  );
}

async function scanProjects(ctx) {
  ui.scanningProjects = true;
  ctx.render();
  try {
    const r = await ctx.api.scanProjects();
    if (r?.type === 'error') toast(`Project scan failed: ${r.message}`);
    else if (!r?.cancelled) ctx.state.projects = r;
  } finally {
    ui.scanningProjects = false;
    if (ctx.state.route === 'projects') ctx.render();
  }
}

async function scanPlugins(ctx) {
  ui.scanningPlugins = true;
  ctx.render();
  try {
    ctx.state.plugins = await ctx.api.scanPlugins();
  } finally {
    ui.scanningPlugins = false;
    if (ctx.state.route === 'projects') ctx.render();
  }
}

function scanningCard(title, text) {
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'welcome' }, h('img', { src: 'assets/icon.png', alt: '' }), h('div', { class: 'grow' }, h('h3', {}, title), h('p', {}, text), h('div', { class: 'progress indeterminate' }, h('div')), h('div', { class: 'faint', 'data-job-progress': '' }, ''), h('div', { class: 'mono faint', 'data-job-current': '', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }))),
    h('div', { style: { marginTop: 12 } }, button('Stop', { kind: 'small', iconName: 'stop', onClick: () => window.silt.cancelJobs() })),
  );
}

function toggleOpen(id, el) {
  el.classList.toggle('open');
  el.classList.contains('open') ? ui.open.add(id) : ui.open.delete(id);
}

function stat(value, label, tone = '') {
  return h('div', { class: `total ${tone}` }, h('b', { class: 'num' }, value), h('span', {}, label));
}

// ───────────── Code ─────────────

function codeTab(ctx) {
  const { api, state } = ctx;
  const all = state.projects.code;
  const now = Date.now();
  const stale = (p) => p.lastActive && now - p.lastActive > 90 * DAY;
  let list = all.filter((p) => (ui.codeFilter === 'stale' ? stale(p) : ui.codeFilter === 'rebuild' ? p.artifactBytes > 0 : true));
  const sorters = { size: (a, b) => b.bytes - a.bytes, rebuild: (a, b) => b.artifactBytes - a.artifactBytes, recent: (a, b) => b.lastActive - a.lastActive, oldest: (a, b) => a.lastActive - b.lastActive };
  list = [...list].sort(sorters[ui.codeSort]);
  const total = all.reduce((s, p) => s + p.bytes, 0);
  const rebuild = all.reduce((s, p) => s + p.artifactBytes, 0);
  const staleRebuild = all.filter(stale).reduce((s, p) => s + p.artifactBytes, 0);

  if (!all.length) return h('div', { class: 'card empty' }, h('h3', {}, 'No code projects found'), h('p', {}, 'Silt looks for folders with Git, package.json, Cargo.toml, Xcode projects and similar markers in your home folder.'));

  const filter = h(
    'select',
    { onchange: (e) => ((ui.codeFilter = e.target.value), ctx.render()) },
    ...[
      ['all', 'All projects'],
      ['rebuild', 'With rebuildable files'],
      ['stale', 'Untouched 3+ months'],
    ].map(([v, l]) => h('option', { value: v, selected: ui.codeFilter === v }, l)),
  );
  const sort = h(
    'select',
    { onchange: (e) => ((ui.codeSort = e.target.value), ctx.render()) },
    ...[
      ['size', 'Sort by size'],
      ['rebuild', 'Sort by rebuildable'],
      ['recent', 'Recently active first'],
      ['oldest', 'Least recently active first'],
    ].map(([v, l]) => h('option', { value: v, selected: ui.codeSort === v }, l)),
  );
  const max = Math.max(1, ...list.map((p) => p.bytes));

  return h(
    'div',
    {},
    h('div', { class: 'card' }, h('div', { class: 'totals' }, stat(String(all.length), `projects · ${bytes(total)}`), stat(bytes(rebuild), 'rebuildable (dependencies, builds, caches)', 'safe'), stat(bytes(staleRebuild), 'rebuildable in projects untouched 3+ months', 'review'))),
    h('div', { class: 'toolbar', style: { marginTop: 16 } }, filter, sort, h('div', { class: 'spacer' }), h('span', { class: 'faint' }, 'Rebuildable files come back with npm install, cargo build, pod install, etc.')),
    h('div', { class: 'card' }, h('div', { class: 'items' }, ...list.map((p) => codeRow(p, max, ctx, stale(p))))),
  );
}

function codeRow(p, max, ctx, isStale) {
  const { api } = ctx;
  const id = `code:${p.path}`;
  const el = h('div', { class: `item ${ui.open.has(id) ? 'open' : ''}` });
  const clean = button(`Clean ${bytes(p.artifactBytes)}`, { kind: 'small primary', iconName: 'trash', title: 'Move rebuildable folders to the Trash' });
  clean.onclick = busy(clean, async () => {
    const res = await api.trashPaths(p.artifacts.map((a) => a.path));
    cleanupToast(res);
    if (res && !res.cancelled) {
      const moved = new Set(res.results.filter((r) => r.ok).map((r) => r.path));
      const freed = p.artifacts.filter((a) => moved.has(a.path)).reduce((s, a) => s + a.bytes, 0);
      p.artifacts = p.artifacts.filter((a) => !moved.has(a.path));
      p.artifactBytes -= freed;
      p.bytes -= p.artifacts.some((a) => a.external) ? 0 : freed;
      ctx.render();
    }
  });
  el.append(
    h(
      'div',
      { class: 'item-row project-row' },
      h(
        'div',
        { class: 'item-name', onclick: () => toggleOpen(id, el) },
        icon('caret', 'caret'),
        h('div', { class: 'stack-text' }, h('div', { class: 'nm' }, h('span', { class: 'ellip' }, p.name), ...p.kinds.filter((k) => k !== 'Git').slice(0, 3).map((k) => h('span', { class: 'pill info tag' }, k)), isStale ? h('span', { class: 'pill review tag' }, 'Stale') : null), h('div', { class: 'sub mono' }, tilde(dirname(p.path)))),
      ),
      h('div', { class: 'faint num when' }, p.lastActive ? age(p.lastActive) : '—'),
      h('div', {}, h('div', { class: 'bar split' }, h('div', { style: { width: `${(p.bytes / max) * 100}%` } }, h('i', { style: { width: `${p.bytes ? Math.min(100, (p.artifactBytes / p.bytes) * 100) : 0}%` } })))),
      h('div', { class: 'size' }, bytes(p.bytes)),
      h('div', { class: 'item-acts' }, p.artifactBytes > 0 ? clean : null, button('Show in Finder', { kind: 'ghost small', title: 'Show in Finder', onClick: () => api.reveal(p.path) })),
    ),
    h(
      'div',
      { class: 'item-body' },
      h('div', { class: 'path-row' }, h('span', { class: 'mono' }, tilde(p.path)), button('Explore', { kind: 'ghost small', title: 'Open in Explorer', onClick: () => ctx.go('explorer', { explorerPath: p.path }) })),
      p.artifacts.length
        ? h(
            'div',
            { class: 'paths' },
            h('div', { class: 'faint', style: { margin: '6px 0 2px' } }, 'Rebuildable — safe to remove, recreated by your tools:'),
            ...p.artifacts.map((a) => h('div', { class: 'path-row' }, h('span', { class: 'pill safe tag' }, a.kind), h('span', { style: { minWidth: '170px' } }, a.label), h('span', { class: 'mono', title: a.path }, a.external ? tilde(a.path) : a.name), h('span', { class: 'size faint' }, bytes(a.bytes)))),
          )
        : h('div', { class: 'faint', style: { marginTop: 6 } }, 'No rebuildable folders — everything here is source or your own files.'),
    ),
  );
  return el;
}

// ───────────── Music & live ─────────────

const CATEGORY = [
  ['daw', 'DAW sessions'],
  ['rig', 'Keys rigs & live performance'],
  ['presentation', 'Presentation libraries'],
];

function mediaTab(ctx) {
  const { state } = ctx;
  const now = Date.now();
  const all = state.projects.media;
  const list = all.filter((m) => (ui.mediaFilter === 'old' ? m.lastActive && now - m.lastActive > 365 * DAY : true));
  if (!all.length) return h('div', { class: 'card empty' }, h('h3', {}, 'No sessions found'), h('p', {}, 'Silt recognises Logic, GarageBand, Ableton Live, Studio One, Pro Tools, Cubase, REAPER, FL Studio, Bitwig, MainStage, Gig Performer and ProPresenter files.'));
  const total = all.reduce((s, m) => s + m.bytes, 0);
  const backups = all.reduce((s, m) => s + m.backupBytes, 0);
  const oldBytes = all.filter((m) => m.lastActive && now - m.lastActive > 365 * DAY).reduce((s, m) => s + m.bytes, 0);
  const filter = h(
    'select',
    { onchange: (e) => ((ui.mediaFilter = e.target.value), ctx.render()) },
    h('option', { value: 'all', selected: ui.mediaFilter === 'all' }, 'All sessions'),
    h('option', { value: 'old', selected: ui.mediaFilter === 'old' }, 'Untouched 1+ year (archive candidates)'),
  );

  const sections = [];
  for (const [cat, title] of CATEGORY) {
    const inCat = list.filter((m) => m.category === cat);
    if (!inCat.length) continue;
    const apps = [...new Set(inCat.map((m) => m.app))].map((app) => ({ app, items: inCat.filter((m) => m.app === app) })).sort((a, b) => b.items.reduce((s, m) => s + m.bytes, 0) - a.items.reduce((s, m) => s + m.bytes, 0));
    sections.push(h('div', { class: 'section-title' }, title));
    for (const g of apps) sections.push(appGroup(g, ctx));
  }
  return h(
    'div',
    {},
    h('div', { class: 'card' }, h('div', { class: 'totals' }, stat(String(all.length), `sessions & libraries · ${bytes(total)}`), stat(bytes(backups), 'in session backups, history & caches', 'review'), stat(bytes(oldBytes), 'untouched for a year or more'))),
    h('div', { class: 'toolbar', style: { marginTop: 16 } }, filter, h('div', { class: 'spacer' }), h('span', { class: 'faint' }, 'Silt never deletes sessions — archive old ones to an external drive.')),
    ...sections,
  );
}

function appGroup({ app, items }, ctx) {
  const total = items.reduce((s, m) => s + m.bytes, 0);
  const key = `app:${app}`;
  const shown = ui.showAll.has(key) ? items : items.slice(0, 12);
  const max = Math.max(1, ...items.map((m) => m.bytes));
  return h(
    'div',
    { class: 'card', style: { marginBottom: '12px' } },
    h('h2', {}, app, h('span', { class: 'sub' }, `${items.length} ${items[0].category === 'presentation' ? 'folder' : 'project'}${items.length === 1 ? '' : 's'} · ${bytes(total)}`)),
    h('div', { class: 'items' }, ...shown.map((m) => mediaRow(m, max, ctx))),
    items.length > shown.length ? h('div', { style: { marginTop: 8 } }, button(`Show all ${items.length}`, { kind: 'ghost small', onClick: () => (ui.showAll.add(key), ctx.render()) })) : null,
  );
}

function mediaRow(m, max, ctx) {
  const { api } = ctx;
  const extra = [];
  if (m.versions > 1) extra.push(m.category === 'presentation' ? `${m.versions} presentations` : `${m.versions} versions`);
  if (m.backupBytes) extra.push(`${bytes(m.backupBytes)} backups/cache`);
  return h(
    'div',
    { class: 'item' },
    h(
      'div',
      { class: 'item-row project-row' },
      h('div', { class: 'item-name' }, h('div', { class: 'stack-text' }, h('div', { class: 'nm', title: m.path }, h('span', { class: 'ellip' }, m.name), ...extra.map((t) => h('span', { class: 'pill info tag' }, t))), h('div', { class: 'sub mono' }, tilde(m.isFolder ? dirname(m.path) : dirname(m.path))))),
      h('div', { class: 'faint num when' }, m.lastActive ? age(m.lastActive) : '—'),
      h('div', { class: 'bar' }, h('div', { style: { width: `${(m.bytes / max) * 100}%` } })),
      m.bytes > 0 ? h('div', { class: 'size' }, bytes(m.bytes)) : h('div', { class: 'size faint', title: 'Not stored on this Mac — the files are online-only in Dropbox, iCloud or another cloud drive.' }, 'In cloud'),
      h(
        'div',
        { class: 'item-acts' },
        button('Show in Finder', { kind: 'ghost small', title: 'Show in Finder', onClick: () => api.reveal(m.path) }),
        m.isFolder ? button('Explore', { kind: 'ghost small', title: 'Open in Explorer', onClick: () => ctx.go('explorer', { explorerPath: m.path }) }) : null,
      ),
    ),
  );
}

// ───────────── Plug-ins ─────────────

function pluginsTab(ctx) {
  const { api, state } = ctx;
  if (ui.scanningPlugins || !state.plugins) return scanningCard('Reading your plug-ins…', 'Identifying every Audio Unit, VST, VST3, AAX and CLAP plug-in and matching each vendor’s sound libraries and support files.');
  const vendors = state.plugins.vendors;
  const pluginCount = vendors.reduce((s, v) => s + v.plugins.filter((p) => !p.formats.includes('App')).length, 0);
  const contentBytes = vendors.reduce((s, v) => s + v.contentBytes, 0);
  const orphanBytes = vendors.filter((v) => v.orphan).reduce((s, v) => s + v.bytes, 0);
  const max = Math.max(1, ...vendors.map((v) => v.bytes));
  return h(
    'div',
    {},
    h('div', { class: 'card' }, h('div', { class: 'totals' }, stat(String(pluginCount), `plug-ins from ${vendors.filter((v) => v.plugins.length).length} vendors`), stat(bytes(contentBytes), 'in sound libraries & vendor data'), stat(bytes(orphanBytes), 'from vendors with no plug-ins installed', 'review'))),
    formatsCard(ctx),
    h('div', { class: 'section-title' }, 'By vendor'),
    h('div', { class: 'card' }, h('div', { class: 'items' }, ...vendors.map((v) => vendorRow(v, max, ctx)))),
    h('p', { class: 'faint', style: { marginTop: 14 } }, 'Libraries are matched to vendors by folder name in Application Support, /Users/Shared, Music and Documents. Libraries you relocated to another drive are not counted. Uninstall plug-ins with the vendor’s installer or manager app so licences and leftovers are handled properly.'),
  );
}

const FORMAT_HOSTS = {
  AAX: 'Pro Tools (and Media Composer)',
  VST: 'Ableton Live, Cubase, REAPER, FL Studio, Bitwig and other VST hosts',
  VST3: 'Ableton Live, Cubase, Studio One, REAPER, Bitwig and other VST3 hosts',
  CLAP: 'Bitwig, REAPER, FL Studio and Studio One',
};

/** Plug-in formats none of the installed apps can load. */
function formatsCard(ctx) {
  const f = ctx.state.plugins?.formats;
  if (!f || f.noHosts || !f.unused.length) return null;
  const rows = f.unused.map((g) => {
    const key = `format:${g.format}`;
    const only = g.items.filter((i) => !i.otherFormats.length).length;
    const btn = button('Move to Trash…', { kind: 'small', iconName: 'trash' });
    btn.onclick = busy(btn, async () => {
      const res = await ctx.api.removePluginFormats({ format: g.format, paths: g.items.map((i) => i.path) });
      if (res?.error) return toast(res.error);
      cleanupToast(res);
      if (res && !res.cancelled && res.moved) scanPlugins(ctx);
    });
    const list = ui.open.has(key)
      ? h(
          'div',
          { class: 'chips', style: { gridColumn: '1 / -1', marginTop: 4 } },
          ...g.items.slice(0, 200).map((i) => h('span', { class: 'chip', title: tilde(i.path) }, i.plugin, h('i', {}, i.otherFormats.length ? `also ${i.otherFormats.join(' ')}` : `${g.format} only`))),
        )
      : null;
    return h(
      'div',
      { class: 'format-row' },
      h(
        'div',
        {},
        h('b', {}, `${g.format} — ${g.count} plug-in${g.count === 1 ? '' : 's'}`),
        h('div', { class: 'faint' }, `Loaded by ${FORMAT_HOSTS[g.format] || 'other hosts'}. ${only ? `${only} exist only as ${g.format}.` : 'Every one is also installed in a format your apps load.'}`),
        h('button', { class: 'link', onclick: () => (ui.open.has(key) ? ui.open.delete(key) : ui.open.add(key), ctx.render()) }, ui.open.has(key) ? 'Hide list' : 'Show list'),
      ),
      h('span', { class: 'size' }, bytes(g.bytes)),
      btn,
      list,
    );
  });
  return h(
    'div',
    {},
    h('div', { class: 'section-title' }, 'Formats your apps don’t load'),
    h(
      'div',
      { class: 'card format-card' },
      h('p', { class: 'muted', style: { marginTop: 0 } }, `Plug-in hosts on this Mac: ${f.hosts.join(', ')}. They load ${f.loadable.join(', ')}. Installers often copy every format, so these copies sit unused. If you use a plug-in host Silt didn’t find, keep them.`),
      ...rows,
    ),
  );
}

function vendorRow(v, max, ctx) {
  const { api } = ctx;
  const id = `vendor:${v.key}`;
  const el = h('div', { class: `item ${ui.open.has(id) ? 'open' : ''}` });
  const formats = Object.entries(v.formats)
    .filter(([f]) => f !== 'App')
    .map(([f, n]) => `${f} ${n}`)
    .join(' · ');
  const realPlugins = v.plugins.filter((p) => !p.formats.includes('App'));
  el.append(
    h(
      'div',
      { class: 'item-row project-row' },
      h(
        'div',
        { class: 'item-name', onclick: () => toggleOpen(id, el) },
        icon('caret', 'caret'),
        h(
          'div',
          { class: 'stack-text' },
          h('div', { class: 'nm' }, h('span', { class: 'ellip' }, v.name), v.orphan ? h('span', { class: 'pill orphan tag', title: 'Silt found this vendor’s files but none of its plug-ins or apps. They may be left over from an uninstall.' }, 'No plug-ins installed') : null, v.appOnly ? h('span', { class: 'pill info tag' }, 'App data') : null),
          h('div', { class: 'sub' }, realPlugins.length ? `${realPlugins.length} plug-in${realPlugins.length === 1 ? '' : 's'}${formats ? ` · ${formats}` : ''}` : v.plugins.length ? v.plugins.map((p) => p.name).join(', ') : 'Library / support files only'),
        ),
      ),
      h('div', { class: 'faint num when' }, v.contentBytes ? `${bytes(v.contentBytes)} libraries` : ''),
      h('div', { class: 'bar' }, h('div', { style: { width: `${(v.bytes / max) * 100}%` } })),
      h('div', { class: 'size' }, bytes(v.bytes)),
      h('div', { class: 'item-acts' }, v.content[0] ? button('Explore', { kind: 'ghost small', title: 'Open largest library in Explorer', onClick: () => ctx.go('explorer', { explorerPath: v.content[0].path }) }) : null),
    ),
    h(
      'div',
      { class: 'item-body' },
      v.content.length
        ? h(
            'div',
            { class: 'paths' },
            h('div', { class: 'faint', style: { margin: '2px 0' } }, 'Sound libraries & support files:'),
            ...v.content.map((c) => h('div', { class: 'path-row' }, h('span', { class: 'mono', title: c.path }, tilde(c.path)), h('span', { class: 'size faint' }, bytes(c.bytes)), button('Show in Finder', { kind: 'ghost small', title: 'Show in Finder', onClick: () => api.reveal(c.path) }), button('Explore', { kind: 'ghost small', title: 'Open in Explorer', onClick: () => ctx.go('explorer', { explorerPath: c.path }) }))),
          )
        : null,
      realPlugins.length
        ? h('div', { style: { marginTop: 10 } }, h('div', { class: 'faint', style: { marginBottom: 4 } }, `Plug-ins (${bytes(v.pluginBytes)}):`), h('div', { class: 'chips' }, ...realPlugins.map((p) => h('span', { class: 'chip', title: p.paths.map(tilde).join('\n') }, p.name, h('i', {}, p.formats.join(' '))))))
        : null,
    ),
  );
  return el;
}
