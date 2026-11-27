import { h, bytes, button, busy, icon, toast, tilde, cleanupToast } from '../ui.js';

// System Data › By app: every Library folder macOS counts as System Data,
// grouped by the app (or leftover) it belongs to.

const KIND = {
  app: { label: 'Installed app', legend: 'Installed apps', color: 'var(--c1)' },
  shared: { label: 'Shared', legend: 'Shared by several apps', color: 'var(--c2)' },
  plugins: { label: 'Plug-ins', legend: 'Audio plug-ins', color: 'var(--c3)' },
  apple: { label: 'macOS', legend: 'macOS & Apple apps', color: 'var(--c6)' },
  tools: { label: 'Dev tools', legend: 'Developer tools & frameworks', color: 'var(--c4)' },
  leftover: { label: 'No app found', legend: 'No installed app found', color: 'var(--c5)' },
};
const KIND_ORDER = ['app', 'shared', 'plugins', 'apple', 'tools', 'leftover'];

const ui = { loading: false, error: null, open: new Set(), showAll: false, checked: new Set() };

export async function loadByApp(ctx, refresh = false) {
  if (ui.loading) return;
  ui.loading = true;
  ui.error = null;
  if (refresh) ctx.state.byApp = null;
  ctx.render();
  try {
    ctx.state.byApp = await ctx.api.dataByApp({ refresh });
    const left = ctx.state.byApp.owners.find((o) => o.key === 'leftover');
    ui.checked = new Set();
    if (left) ui.open.add('leftover');
  } catch (err) {
    ui.error = err.message || String(err);
  } finally {
    ui.loading = false;
    if (ctx.state.route === 'hidden') ctx.render();
  }
}

export function byAppView(ctx) {
  const data = ctx.state.byApp;
  if (!data && !ui.loading && !ui.error) loadByApp(ctx);
  if (ui.error) {
    return h(
      'div',
      { class: 'card empty' },
      h('h3', {}, 'Couldn’t match System Data to your apps'),
      h('p', {}, ui.error),
      button('Try again', { kind: 'primary', iconName: 'scan', onClick: () => loadByApp(ctx, true) }),
    );
  }
  if (!data) {
    return h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Matching System Data to your apps…'),
      h('p', { class: 'muted' }, 'Silt measures your Library folders and works out which app each one belongs to, using the same rules as Uninstall. This usually takes under a minute.'),
      h('div', { class: 'progress' }, h('div', { 'data-byapp-progress': '', style: { width: '8%' } })),
      ...Array.from({ length: 5 }, () => h('div', { class: 'skeleton', style: { height: '34px', marginTop: '10px' } })),
    );
  }

  const owners = data.owners.filter((o) => o.bytes >= 1e6);
  const top = owners.find((o) => o.kind === 'app');
  const max = Math.max(1, ...owners.map((o) => o.bytes));
  const shown = ui.showAll ? owners : owners.slice(0, 20);

  return h(
    'div',
    {},
    summaryCard(ctx, data, top),
    h('div', { class: 'section-title' }, 'Who uses it'),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'items' }, ...shown.map((o) => ownerRow(o, max, ctx))),
      owners.length > shown.length ? button(`Show all ${owners.length}`, { kind: 'ghost small', onClick: () => ((ui.showAll = true), ctx.render()) }) : null,
    ),
    h(
      'p',
      { class: 'faint', style: { marginTop: 14 } },
      `Measured ${new Date(data.scannedAt).toLocaleTimeString()}: your Library folders, /Library and /Users/Shared. macOS’s own volumes (swap, Preboot, snapshots) are under “By location”.`,
    ),
  );
}

function summaryCard(ctx, data, top) {
  const parts = KIND_ORDER.filter((k) => data.byKind[k] > 0).map((k) => ({ k, bytes: data.byKind[k] }));
  const total = data.total || 1;
  const bar = h('div', { class: 'kind-bar', role: 'img', 'aria-label': parts.map((p) => `${KIND[p.k].legend} ${bytes(p.bytes)}`).join(', ') }, ...parts.map((p) => h('div', { style: { width: `${(p.bytes / total) * 100}%`, background: KIND[p.k].color } })));
  const legend = h('div', { class: 'kind-legend' }, ...parts.map((p) => h('span', {}, h('i', { style: { background: KIND[p.k].color } }), KIND[p.k].legend, h('b', {}, bytes(p.bytes)))));
  const appShare = data.byKind.app || 0;
  const sentence = [
    top ? `${top.name} keeps the most: ${bytes(top.bytes)}.` : null,
    appShare ? `${bytes(appShare)} belongs to apps you have installed; uninstalling an app removes its share.` : null,
    data.byKind.leftover ? `${bytes(data.byKind.leftover)} isn’t linked to any installed app, often left behind by apps you deleted.` : null,
  ].filter(Boolean).join(' ');
  const refresh = button('Measure again', { kind: 'small', iconName: 'scan' });
  refresh.onclick = busy(refresh, () => loadByApp(ctx, true));
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'byapp-head' }, h('div', {}, h('b', { class: 'num big' }, bytes(data.total)), h('span', { class: 'muted' }, ' of System Data in Library folders')), refresh),
    bar,
    legend,
    h('p', { style: { marginBottom: 0 } }, sentence),
    !data.fullDiskAccess ? h('p', { class: 'faint', style: { marginBottom: 0 } }, 'Full Disk Access is off, so app sandbox containers aren’t included yet.') : null,
  );
}

function ownerIcon(o) {
  if (o.icon) return h('img', { src: o.icon, alt: '', class: 'owner-icon' });
  const name = { plugins: 'projects', apple: 'hidden', tools: 'terminal', leftover: 'trash', shared: 'package' }[o.kind] || 'package';
  return icon(name, 'owner-icon fallback');
}

function membersText(o) {
  if (o.kind === 'shared' && o.members.length) return `Used by ${o.members.join(', ')}`;
  if (o.kind === 'leftover') return `${o.items.length} folder${o.items.length === 1 ? '' : 's'} Silt couldn’t match to an installed app`;
  if (o.kind === 'apple') return 'Part of macOS and Apple’s apps; macOS manages it';
  if (o.kind === 'tools') return 'Caches of command-line and developer tools; safe to clear, they come back';
  if (o.kind === 'plugins') return 'Plug-in files for your music apps';
  return `${o.items.length} location${o.items.length === 1 ? '' : 's'}`;
}

function primaryAction(o, ctx) {
  if (o.kind === 'app' && o.appPath) return button('Uninstall…', { kind: 'small', onClick: () => ctx.go('uninstall', { uninstallTarget: o.appPath }) });
  if (o.kind === 'plugins') return button('Review plug-ins', { kind: 'small', onClick: () => ctx.go('projects', { projectsTab: 'plugins' }) });
  if (o.kind === 'leftover') return null; // chosen per folder below
  return null;
}

function ownerRow(o, max, ctx) {
  const open = ui.open.has(o.key);
  const toggle = () => {
    open ? ui.open.delete(o.key) : ui.open.add(o.key);
    ctx.render();
  };
  return h(
    'div',
    { class: `item ${open ? 'open' : ''}` },
    h(
      'div',
      { class: 'item-row owner-row' },
      h(
        'button',
        { class: 'item-name owner-name', onclick: toggle, 'aria-expanded': String(open) },
        icon('caret', 'caret'),
        ownerIcon(o),
        h('span', { class: 'owner-text' }, h('span', { class: 'nm' }, o.name), h('span', { class: 'sub' }, membersText(o))),
        h('span', { class: `pill kind-${o.kind}` }, KIND[o.kind]?.label || o.kind),
      ),
      h('div', { class: 'bar' }, h('div', { style: { width: `${Math.max(1, (o.bytes / max) * 100)}%`, background: KIND[o.kind]?.color } })),
      h('div', { class: 'size' }, bytes(o.bytes)),
      h('div', { class: 'item-acts' }, primaryAction(o, ctx)),
    ),
    open ? h('div', { class: 'item-body' }, o.kind === 'leftover' ? leftoverList(o, ctx) : pathList(o, ctx)) : null,
  );
}

function pathRow(i, ctx, lead = null) {
  return h(
    'div',
    { class: 'path-row' },
    lead,
    h('span', { class: 'mono', title: i.path }, tilde(i.path)),
    h('span', { class: 'size faint' }, bytes(i.bytes)),
    button('Show in Finder', { kind: 'ghost small', onClick: () => ctx.api.reveal(i.path) }),
    button('Explore', { kind: 'ghost small', onClick: () => ctx.go('explorer', { explorerPath: i.path }) }),
  );
}

function pathList(o, ctx) {
  const items = o.items.filter((i) => i.bytes >= 1e6);
  return h('div', { class: 'paths' }, ...(items.length ? items : o.items.slice(0, 5)).slice(0, 40).map((i) => pathRow(i, ctx)));
}

function leftoverList(o, ctx) {
  const items = o.items.filter((i) => i.bytes >= 1e6);
  const chosen = items.filter((i) => ui.checked.has(i.path));
  const total = chosen.reduce((s, i) => s + i.bytes, 0);
  const move = button(chosen.length ? `Move ${chosen.length} to Trash (${bytes(total)})` : 'Move to Trash', { kind: 'small danger', iconName: 'trash', disabled: !chosen.length });
  move.onclick = busy(move, async () => {
    const res = await ctx.api.trashLeftovers(chosen.map((i) => i.path));
    if (!res || res.cancelled) return;
    cleanupToast(res);
    if (res.failed) toast(`${res.failed} couldn’t be moved: ${res.results.find((r) => !r.ok)?.reason || 'unknown error'}`, 6000);
    if (res.moved) loadByApp(ctx, true);
  });
  return h(
    'div',
    {},
    h('p', { class: 'muted', style: { margin: '0 0 8px' } }, 'Check the names before removing anything: tools installed from the command line, and apps kept outside Applications, can show up here too. Nothing is selected for you.'),
    h(
      'div',
      { class: 'paths' },
      ...items.slice(0, 60).map((i) =>
        pathRow(
          i,
          ctx,
          h('input', {
            type: 'checkbox',
            checked: ui.checked.has(i.path),
            disabled: !i.removable,
            title: i.removable ? '' : 'Silt only removes folders in known app locations',
            'aria-label': `Select ${tilde(i.path)}`,
            onchange: (e) => {
              e.target.checked ? ui.checked.add(i.path) : ui.checked.delete(i.path);
              ctx.render();
            },
          }),
        ),
      ),
    ),
    h('div', { class: 'leftover-bar' }, h('span', { class: 'faint' }, 'Selected folders go to the Trash, so you can put them back until you empty it.'), move),
  );
}
