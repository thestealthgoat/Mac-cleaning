import { h, bytes, icon, button, busy, viewHead, tilde, toast, age } from '../ui.js';

const UNUSED_DAYS = 180;
const isUnused = (a) => a.lastUsed != null && Date.now() - a.lastUsed > UNUSED_DAYS * 86400000;

const ui = { sort: 'size', breakdown: null, folder: null, byApp: null, pendingTarget: null, query: '', apps: null, loading: false, selected: null, plan: null, planning: false, checked: new Set(), openGroups: new Set() };

const GROUP_ORDER = ['app', 'support', 'caches', 'prefs', 'state', 'containers', 'logs', 'launch', 'shared', 'vendor', 'plugins', 'documents'];

export function renderUninstall(ctx) {
  const { api } = ctx;
  // Opened from System Data › By app with an app chosen.
  if (ctx.state.uninstallTab) {
    ui.sort = ctx.state.uninstallTab;
    ctx.state.uninstallTab = null;
    ui.query = '';
    ui.selected = null;
  }
  if (ctx.state.breakdown) ui.breakdown = ctx.state.breakdown; // includes installer copies once found
  if (ui.sort === 'notapps' && !ui.breakdown) loadBreakdown(ctx);
  if (ctx.state.uninstallTarget) {
    ui.pendingTarget = ctx.state.uninstallTarget;
    ctx.state.uninstallTarget = null;
    ui.query = '';
  }
  if (!ui.apps && !ui.loading) loadApps(ctx);
  else if (ui.apps && ui.pendingTarget) openPending(ctx);

  const search = h('input', {
    type: 'text',
    class: 'search',
    placeholder: 'Uninstall… type an app name, e.g. MainStage',
    value: ui.query,
    oninput: (e) => {
      ui.query = e.target.value;
      paintList(ctx);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        const first = filtered()[0];
        if (first) select(first, ctx);
      }
    },
  });
  requestAnimationFrame(() => {
    if (!ui.selected) search.focus();
  });

  const list = h('div', { class: 'app-list', id: 'app-list' });
  const sortBar = h('div', { class: 'app-sort', id: 'app-sort' });
  const detail = h('div', { class: 'app-detail', id: 'app-detail' });
  const view = h(
    'div',
    {},
    viewHead('Uninstall', 'Remove an app together with everything it left around your Mac. Files other software still needs, and your own documents, are kept unless you choose otherwise.'),
    h('div', { class: 'uninstall-grid' }, h('div', { class: 'card app-col' }, search, sortBar, list), detail),
  );
  requestAnimationFrame(() => {
    paintList(ctx);
    paintDetail(ctx);
  });
  return view;
}

async function loadApps(ctx, refresh = false) {
  ui.loading = true;
  try {
    ui.apps = await ctx.api.listApps({ refresh });
  } finally {
    ui.loading = false;
  }
  loadFootprints(ctx);
  if (ctx.state.route === 'uninstall') {
    if (ui.pendingTarget) return openPending(ctx);
    paintList(ctx);
    // "uninstall mainstage" with a single match: open it straight away.
    const f = filtered();
    if (!ui.selected && ui.query && f.length === 1) select(f[0], ctx);
  }
}

function openPending(ctx) {
  const target = ui.apps?.find((a) => a.path === ui.pendingTarget);
  ui.pendingTarget = null;
  if (target) requestAnimationFrame(() => select(target, ctx));
}

/** The Applications folder's non-app items (shared with Overview's disk breakdown). */
async function loadBreakdown(ctx) {
  if (ui.loadingBreakdown) return;
  ui.loadingBreakdown = true;
  try {
    ui.breakdown = ctx.state.breakdown || (await ctx.api.diskBreakdown());
    if (!ctx.state.breakdown) ctx.state.breakdown = ui.breakdown;
  } catch {
    ui.breakdown = null;
  } finally {
    ui.loadingBreakdown = false;
  }
  if (ctx.state.route === 'uninstall') {
    paintList(ctx);
    paintDetail(ctx);
  }
}

const notApps = () => (ui.breakdown?.applications.items ?? []).filter((i) => i.kind === 'content' || i.kind === 'file');

/** How much System Data each app keeps (shared with the System Data › By app view). */
async function loadFootprints(ctx) {
  try {
    const res = await ctx.api.dataByApp();
    ui.byApp = res.perApp || {};
    if (ctx.state.route === 'uninstall') paintList(ctx);
  } catch {
    /* sizes stay app-only */
  }
}

const dataOf = (a) => ui.byApp?.[a.path]?.total ?? 0;
const footprint = (a) => a.bytes + dataOf(a);

function filtered() {
  const q = ui.query.trim().toLowerCase().replace(/^uninstall\s+/, '');
  const apps = ui.apps || [];
  if (!q && ui.sort === 'unused') return apps.filter(isUnused).sort((a, b) => footprint(b) - footprint(a));
  if (!q) return [...apps].sort((a, b) => footprint(b) - footprint(a));
  return apps
    .filter((a) => a.name.toLowerCase().includes(q) || a.fileName.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || footprint(b) - footprint(a));
}

function paintSort(ctx) {
  const el = document.getElementById('app-sort');
  if (!el) return;
  const unused = (ui.apps || []).filter(isUnused);
  const tab = (id, label) =>
    h(
      'button',
      {
        class: `seg ${ui.sort === id ? 'active' : ''}`,
        'aria-pressed': String(ui.sort === id),
        onclick: () => {
          ui.sort = id;
          ui.folder = null;
          if (id === 'notapps' && !ui.breakdown) loadBreakdown(ctx);
          paintList(ctx);
          paintDetail(ctx);
        },
      },
      label,
    );
  el.replaceChildren(
    ...[
    tab('size', 'All apps'),
    tab('unused', `Unused for 6 months${ui.apps ? ` (${unused.length})` : ''}`),
    tab('notapps', `Not apps${ui.breakdown ? ` (${notApps().length})` : ''}`),
    ui.sort === 'unused' && unused.length ? h('span', { class: 'faint' }, `${bytes(unused.reduce((s, a) => s + footprint(a), 0))} in apps you haven’t used since ${new Date(Date.now() - UNUSED_DAYS * 86400000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}, including their System Data`) : null,
      ui.sort === 'notapps'
        ? h('span', { class: 'faint' }, ui.breakdown ? `${bytes(ui.breakdown.applications.notApps)} of your Applications folder is folders and files that aren’t apps. macOS still counts it as “Applications”.` : 'Measuring the Applications folder…')
        : ui.sort === 'unused'
          ? null
          : h('span', { class: 'faint' }, ui.byApp ? 'Sizes include each app’s System Data.' : 'Measuring each app’s System Data…'),
    ].filter(Boolean),
  );
}

function lastUsedLabel(a) {
  if (a.lastUsed == null) return null;
  const when = new Date(a.lastUsed).toLocaleDateString();
  const title = a.lastUsedApprox ? `macOS has no “last opened” date for this app; it last saved its settings on ${when}.` : `Last opened ${when}`;
  return h('span', { class: isUnused(a) ? 'stale' : '', title }, `${a.lastUsedApprox ? 'used' : 'opened'} ${age(a.lastUsed)}`);
}

function paintList(ctx) {
  paintSort(ctx);
  const el = document.getElementById('app-list');
  if (!el) return;
  if (!ui.apps) {
    el.replaceChildren(...Array.from({ length: 8 }, () => h('div', { class: 'skeleton', style: { height: '40px', margin: '6px 0' } })));
    return;
  }
  if (ui.sort === 'notapps') return paintNotApps(el, ctx);
  const apps = filtered();
  if (!apps.length) {
    el.replaceChildren(h('div', { class: 'empty', style: { padding: '24px 8px' } }, h('p', {}, ui.query ? `No app matches “${ui.query}”.` : 'Every app here has been used in the last 6 months.')));
    return;
  }
  el.replaceChildren(
    ...apps.map((a) =>
      h(
        'button',
        { class: `app-item ${ui.selected?.path === a.path ? 'active' : ''}`, onclick: () => select(a, ctx), title: tilde(a.path) },
        a.icon ? h('img', { src: a.icon, alt: '' }) : icon('package', 'app-fallback'),
        h(
          'span',
          { class: 'app-text' },
          h('span', { class: 'app-name' }, a.name, a.version ? h('i', {}, a.version) : null),
          h(
            'span',
            { class: 'app-meta' },
            ...[dataOf(a) ? `${bytes(a.bytes)} app + ${bytes(dataOf(a))} System Data` : `${bytes(a.bytes)} app`, lastUsedLabel(a)].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x])),
          ),
        ),
        h('span', { class: 'size' }, bytes(footprint(a))),
      ),
    ),
  );
}

function paintNotApps(el, ctx) {
  if (!ui.breakdown) {
    el.replaceChildren(...Array.from({ length: 4 }, () => h('div', { class: 'skeleton', style: { height: '40px', margin: '6px 0' } })));
    return;
  }
  const items = notApps();
  if (!items.length) {
    el.replaceChildren(h('div', { class: 'empty', style: { padding: '24px 8px' } }, h('p', {}, 'Everything in your Applications folder is an app.'), button('Show all apps', { kind: 'small', onClick: () => ((ui.sort = 'size'), paintList(ctx)) })));
    return;
  }
  el.replaceChildren(
    ...items.map((f) =>
      h(
        'button',
        { class: `app-item ${ui.folder?.path === f.path ? 'active' : ''}`, onclick: () => selectFolder(f, ctx), title: f.path },
        icon(f.kind === 'file' ? 'file' : 'folder', 'app-fallback'),
        h('span', { class: 'app-text' }, h('span', { class: 'app-name' }, f.name), h('span', { class: 'app-meta' }, folderKind(f))),
        h('span', { class: 'size' }, bytes(f.bytes)),
      ),
    ),
  );
}

function copyOf(f) {
  return (ui.breakdown?.installerCopies ?? []).find((c) => c.path === f.path || c.path.startsWith(f.path + '/'));
}

function folderKind(f) {
  if (f.kind === 'file') return 'File';
  if (copyOf(f)) return 'Installer copy of a library you already installed';
  if (f.versions) return `Folder with old versions (V${f.versions.older.map((o) => o.version).join(', V')})`;
  if (f.apps.length) return `Folder with ${f.apps.length} small app${f.apps.length === 1 ? '' : 's'} inside`;
  return 'Folder, no apps inside';
}

function selectFolder(f, ctx) {
  ui.folder = f;
  ui.selected = null;
  paintList(ctx);
  paintDetail(ctx);
}

function folderDetail(f, ctx) {
  const copy = copyOf(f);
  const trash = button(`Move “${f.name}” to Trash…`, { kind: 'small danger', iconName: 'trash' });
  trash.onclick = busy(trash, async () => {
    const res = await ctx.api.trashPaths([f.path]);
    if (!res || res.cancelled) return;
    if (res.moved) {
      toast(`Moved “${f.name}” to the Trash (${bytes(res.bytes)}). Empty the Trash to free the space.`, 6000);
      ui.folder = null;
      ui.breakdown = null;
      ctx.state.breakdown = null;
      loadBreakdown(ctx);
      ctx.refreshBreakdown?.();
    } else toast(res.results?.[0]?.reason || 'Couldn’t move it to the Trash.');
  });
  const old = f.versions ? f.versions.older.reduce((s, o) => s + o.bytes, 0) : 0;
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'app-head' }, icon('folder', 'app-fallback'), h('div', { class: 'grow' }, h('h3', {}, f.name), h('div', { class: 'faint' }, `${bytes(f.bytes)} · ${tilde(f.path)}`))),
    h('div', { class: 'sysdata-note' }, h('b', {}, 'Not an app. '), 'It sits in your Applications folder, so macOS counts it as “Applications”, but it’s a folder of files. Uninstalling apps won’t touch it.'),
    copy
      ? h(
          'div',
          { class: 'banner', style: { margin: '12px 0 0' } },
          h('div', { class: 'grow' }, h('b', {}, `Second copy: ${bytes(copy.matchedBytes)}. `), `${copy.files} of its large files are already installed in ${tilde(copy.installedAt)}. The installer only needs this copy to reinstall. Move it to an external drive, or to the Trash if you can download it again from the vendor.`),
        )
      : null,
    f.versions
      ? h(
          'div',
          { class: 'banner', style: { margin: '12px 0 0' } },
          h('div', { class: 'grow' }, h('b', {}, `Older version still installed: ${bytes(old)}. `), `Folders for V${f.versions.older.map((o) => o.version).join(', V')} sit next to V${f.versions.latest}. If your sessions use V${f.versions.latest}, remove the old version with the vendor’s installer app${/waves/i.test(f.name) ? ' (Waves Central)' : ''} rather than deleting folders by hand.`),
        )
      : null,
    f.apps.length ? h('p', { class: 'faint' }, `Apps inside: ${f.apps.map((a) => a.split('/').pop().replace(/\.app$/, '')).join(', ')}`) : null,
    h(
      'div',
      { class: 'toolbar', style: { marginTop: 14, marginBottom: 0 } },
      button('Show in Finder', { kind: 'small', onClick: () => ctx.api.reveal(f.path) }),
      button('Explore', { kind: 'small', onClick: () => ctx.go('explorer', { explorerPath: f.path }) }),
      h('span', { class: 'spacer' }),
      copy || f.kind === 'file' ? trash : null,
    ),
  );
}

async function select(app, ctx) {
  ui.folder = null;
  ui.selected = app;
  ui.plan = null;
  ui.planning = true;
  paintList(ctx);
  paintDetail(ctx);
  try {
    const plan = await ctx.api.planUninstall(app.path);
    if (ui.selected?.path !== app.path) return;
    ui.plan = plan;
    ui.checked = new Set(plan.items.filter((i) => i.checked && i.removable).map((i) => i.path));
  } catch (err) {
    toast(`Couldn’t inspect ${app.name}: ${err.message}`);
  } finally {
    ui.planning = false;
    paintDetail(ctx);
  }
}

function paintDetail(ctx) {
  const el = document.getElementById('app-detail');
  if (!el) return;
  if (ui.sort === 'notapps' && ui.folder) {
    el.replaceChildren(folderDetail(ui.folder, ctx));
    return;
  }
  if (ui.sort === 'notapps' && !ui.selected) {
    el.replaceChildren(h('div', { class: 'card empty' }, icon('folder', 'empty-icon'), h('h3', {}, 'Choose a folder'), h('p', {}, 'These sit in your Applications folder but aren’t apps, so the app list never shows them. Silt says what each one is and whether it duplicates something you already installed.')));
    return;
  }
  const a = ui.selected;
  if (!a) {
    el.replaceChildren(h('div', { class: 'card empty' }, icon('uninstall', 'empty-icon'), h('h3', {}, 'Choose an app'), h('p', {}, 'Silt finds its support files, caches, preferences, background helpers and shared content, and tells you what is safe to remove.')));
    return;
  }
  const head = h(
    'div',
    { class: 'app-head' },
    a.icon ? h('img', { src: a.icon, alt: '' }) : null,
    h('div', { class: 'grow' }, h('h3', {}, a.name), h('div', { class: 'faint' }, [a.version && `Version ${a.version}`, a.fromAppStore && 'App Store', tilde(a.path)].filter(Boolean).join(' · '))),
  );
  if (ui.planning || !ui.plan) {
    el.replaceChildren(h('div', { class: 'card' }, head, h('div', { class: 'muted', style: { marginTop: 14 } }, `Finding everything that belongs to ${a.name}…`), h('div', { class: 'progress indeterminate' }, h('div'))));
    return;
  }
  const plan = ui.plan;
  const items = plan.items.filter((i) => i.bytes > 0 || i.category === 'app' || i.category === 'prefs');
  const byCat = GROUP_ORDER.map((c) => ({ c, items: items.filter((i) => i.category === c) })).filter((g) => g.items.length);
  const chosen = items.filter((i) => ui.checked.has(i.path));
  const total = chosen.reduce((s, i) => s + i.bytes, 0);
  const keptShared = items.filter((i) => !ui.checked.has(i.path) && i.shared.length).reduce((s, i) => s + i.bytes, 0);
  const keptDocs = items.filter((i) => !ui.checked.has(i.path) && i.category === 'documents').reduce((s, i) => s + i.bytes, 0);
  const needsPassword = chosen.some((i) => i.admin);
  const appBytes = items.filter((i) => i.category === 'app').reduce((s, i) => s + i.bytes, 0);
  const sysData = items.filter((i) => i.category !== 'app' && i.category !== 'documents').reduce((s, i) => s + i.bytes, 0);
  const chosenSys = chosen.filter((i) => i.category !== 'app').reduce((s, i) => s + i.bytes, 0);

  const run = button(`Uninstall ${a.name}`, { kind: 'primary danger-fill', iconName: 'trash', disabled: !chosen.length || plan.running });
  run.onclick = busy(run, async () => {
    const res = await ctx.api.runUninstall({ appPath: a.path, paths: chosen.map((i) => i.path) });
    if (!res || res.cancelled) return;
    if (res.error) return toast(res.error, 5000);
    const failed = res.results.filter((r) => !r.ok);
    toast(failed.length ? `Moved ${res.moved} items (${bytes(res.bytes)}) to the Trash. ${failed.length} couldn’t be moved: ${failed[0].reason}` : `${a.name} uninstalled — ${bytes(res.bytes)} moved to the Trash. Empty the Trash to free the space.`, 7000);
    ui.selected = null;
    ui.plan = null;
    await loadApps(ctx, true);
    paintDetail(ctx);
    ctx.runHiddenScan();
  });

  el.replaceChildren(
    h(
      'div',
      { class: 'card' },
      head,
      plan.running ? h('div', { class: 'banner', style: { margin: '14px 0 0' } }, h('div', { class: 'grow' }, h('b', {}, `${a.name} is running. `), 'Quit it before uninstalling.')) : null,
      sysData
        ? h(
            'div',
            { class: 'sysdata-note' },
            h('b', {}, `${bytes(sysData)} of System Data. `),
            `${a.name}.app itself is ${bytes(appBytes)}. The rest is support files, caches and content it keeps in your Library, which macOS counts as System Data rather than Applications. Every item is listed below.`,
          )
        : null,
      !plan.fullDiskAccess ? h('div', { class: 'faint', style: { marginTop: 10 } }, 'Without Full Disk Access, sandbox containers can’t be checked, so a few small files may be missed.') : null,
      ...byCat.map(({ c, items: list }) => group(c, list, ctx)),
    ),
    h(
      'div',
      { class: 'card uninstall-bar' },
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'bar-total' }, `Frees ${bytes(total)}`, h('span', { class: 'faint' }, ` · ${chosen.length} item${chosen.length === 1 ? '' : 's'} to the Trash${chosenSys ? ` · ${bytes(chosenSys)} of it System Data` : ''}`)),
        h(
          'div',
          { class: 'faint' },
          [keptShared && `Keeps ${bytes(keptShared)} other software still uses`, keptDocs && `keeps your ${bytes(keptDocs)} of documents`, needsPassword && 'macOS will ask for your password for system files'].filter(Boolean).join(' · ') || 'Nothing shared or personal is affected.',
        ),
      ),
      run,
    ),
  );
}

function group(category, list, ctx) {
  const { api } = ctx;
  const label = list[0].label;
  const sum = list.reduce((s, i) => s + i.bytes, 0);
  const many = list.length > 6;
  const open = !many || ui.openGroups.has(category);
  const shown = open ? list : list.slice(0, 4);
  const allChecked = list.every((i) => ui.checked.has(i.path) || !i.removable);
  const toggleAll = h('input', {
    type: 'checkbox',
    checked: allChecked,
    onchange: (e) => {
      for (const i of list) if (i.removable) e.target.checked ? ui.checked.add(i.path) : ui.checked.delete(i.path);
      paintDetail(ctx);
    },
  });
  return h(
    'div',
    { class: 'un-group' },
    h('div', { class: 'un-group-head' }, toggleAll, h('b', {}, label), h('span', { class: 'faint' }, `${list.length} · ${bytes(sum)}`)),
    ...shown.map((i) =>
      h(
        'label',
        { class: `un-item ${i.removable ? '' : 'disabled'}` },
        h('input', {
          type: 'checkbox',
          checked: ui.checked.has(i.path),
          disabled: !i.removable,
          onchange: (e) => {
            e.target.checked ? ui.checked.add(i.path) : ui.checked.delete(i.path);
            paintDetail(ctx);
          },
        }),
        h(
          'div',
          { class: 'un-text' },
          h('div', { class: 'mono', title: i.path }, i.pluginName || tilde(i.path)),
          i.note || i.blockedReason ? h('div', { class: `un-note ${i.shared.length ? 'shared' : ''}` }, i.blockedReason ? `Can’t be removed by Silt: ${i.blockedReason}` : i.note) : null,
        ),
        i.admin ? h('span', { class: 'pill lock tag', title: 'Owned by the system; macOS will ask for your password.' }, 'Password') : null,
        i.shared.length ? h('span', { class: 'pill review tag' }, 'Shared') : null,
        h('span', { class: 'size' }, bytes(i.bytes)),
        button('Show in Finder', { kind: 'ghost small', onClick: (e) => (e.preventDefault(), api.reveal(i.path)) }),
      ),
    ),
    !open ? button(`Show all ${list.length}`, { kind: 'ghost small', onClick: () => (ui.openGroups.add(category), paintDetail(ctx)) }) : null,
  );
}

/** Pre-fill the search (e.g. from "uninstall mainstage"). */
export function setUninstallQuery(q) {
  ui.query = q;
  ui.selected = null;
  ui.plan = null;
}
