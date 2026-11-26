import { h, bytes, icon, button, busy, toast, viewHead, safetyPill, tilde, cleanupToast } from '../ui.js';
import { fdaBanner } from './overview.js';

const GROUP_ORDER = ['system', 'caches', 'developer', 'apple', 'apps', 'user'];
const open = new Set();

export function renderHidden(ctx) {
  const { api, state } = ctx;
  const hd = state.hidden;
  const o = state.overview;
  const rescan = button(state.hiddenScanning ? 'Scanning…' : 'Rescan', { iconName: 'scan', disabled: state.hiddenScanning, onClick: () => ctx.runHiddenScan() });
  const head = viewHead(
    'System Data',
    'The places macOS and apps quietly fill up — the stuff Storage settings lumps into “System Data”. Everything Silt removes goes to the Trash first.',
    rescan,
  );
  if (state.focusItem) {
    open.add(state.focusItem);
  }

  if (!hd) {
    return h(
      'div',
      {},
      head,
      h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Measuring hidden folders…'), h('div', { class: 'progress' }, h('div', { 'data-hidden-progress': '', style: { width: '5%' } }))),
    );
  }

  const groups = GROUP_ORDER.map((g) => ({ g, items: hd.items.filter((i) => i.group === g && (i.bytes > 0 || i.needsFullDiskAccess)) })).filter((x) => x.items.length);

  const view = h(
    'div',
    {},
    head,
    o && !o.fullDiskAccess ? fdaBanner(api) : null,
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'totals' },
        h('div', { class: 'total' }, h('b', { class: 'num' }, bytes(hd.totals.explained)), h('span', {}, 'hidden data found')),
        h('div', { class: 'total safe' }, h('b', { class: 'num' }, bytes(hd.totals.reclaimableSafe)), h('span', {}, 'safe to reclaim (regenerates)')),
        h('div', { class: 'total review' }, h('b', { class: 'num' }, bytes(hd.totals.reclaimableReview)), h('span', {}, 'worth reviewing')),
      ),
    ),
    o ? systemCard(ctx) : null,
    ...groups.map(({ g, items }) =>
      h('div', {}, h('div', { class: 'section-title' }, items[0].groupLabel), h('div', { class: 'card' }, h('div', { class: 'items' }, ...items.map((i) => itemRow(i, Math.max(1, ...items.map((x) => x.bytes)), ctx))))),
    ),
    h('p', { class: 'faint', style: { marginTop: 18 } }, `Scanned ${new Date(hd.scannedAt).toLocaleTimeString()}. Sizes are space allocated on disk (like du); APFS clones can make some folders look larger than the space they really use.`),
  );
  if (state.focusItem) {
    const id = state.focusItem;
    state.focusItem = null;
    requestAnimationFrame(() => document.querySelector(`[data-item="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
  return view;
}

function systemCard(ctx) {
  const { api, state } = ctx;
  const o = state.overview;
  const vols = (o.apfs?.volumes ?? []).filter((v) => v.role !== 'Data');
  const snaps = o.snapshots?.snapshots ?? [];
  const tm = snaps.filter((s) => s.kind === 'timemachine');
  const os = snaps.filter((s) => s.kind === 'os-update');
  return h(
    'div',
    {},
    h('div', { class: 'section-title' }, 'Volumes & snapshots'),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'APFS volumes', h('span', { class: 'sub' }, 'share space with your files')),
      ...vols.map((v) => h('div', { class: 'vol-row' }, h('b', {}, v.name), h('div', { class: 'desc' }, v.description), h('div', { class: 'size' }, bytes(v.bytes)))),
      h(
        'div',
        { class: 'vol-row' },
        h('b', {}, 'Purgeable'),
        h('div', { class: 'desc' }, 'Space macOS can release on its own when needed — optimized iCloud files, caches, old snapshots.'),
        h('div', { class: 'size' }, bytes(o.capacity.purgeable)),
      ),
      h(
        'div',
        { class: 'vol-row' },
        h('b', {}, 'Snapshots'),
        h(
          'div',
          { class: 'desc' },
          snaps.length
            ? `${tm.length} Time Machine, ${os.length} macOS update snapshot${os.length === 1 ? '' : 's'}. Snapshots pin deleted files on disk; macOS does not report their size. Update snapshots are removed by macOS after updating.`
            : 'No local snapshots.',
          tm.length
            ? h(
                'div',
                { class: 'cmd' },
                'tmutil thinlocalsnapshots / 999999999999 4',
                button('Run in Terminal', { kind: 'small', iconName: 'terminal', onClick: () => api.runCommand('tmutil thinlocalsnapshots / 999999999999 4') }),
              )
            : null,
        ),
        h('div', { class: 'size' }, String(snaps.length)),
      ),
    ),
  );
}

function itemRow(item, max, ctx) {
  const { api } = ctx;
  const el = h('div', { class: `item ${open.has(item.id) ? 'open' : ''}`, 'data-item': item.id });
  const toggle = () => {
    el.classList.toggle('open');
    el.classList.contains('open') ? open.add(item.id) : open.delete(item.id);
  };
  const nested = item.uniqueBytes < item.bytes && item.paths.every((p) => p.nestedIn);
  el.append(
    h(
      'div',
      { class: 'item-row' },
      h(
        'div',
        { class: 'item-name', onclick: toggle },
        icon('caret', 'caret'),
        h('span', { class: 'nm' }, item.name),
        safetyPill(item.safety),
        item.needsFullDiskAccess ? h('span', { class: 'pill lock', title: 'Some locations need Full Disk Access to measure' }, 'Needs access') : null,
      ),
      h('div', { class: `bar ${item.safety}` }, h('div', { style: { width: `${Math.max(1, (item.bytes / max) * 100)}%` } })),
      h('div', { class: 'size', title: item.partial ? 'Some folders could not be read; the real size may be larger.' : '' }, bytes(item.bytes), item.partial ? '+' : ''),
      h('div', { class: 'item-acts' }, ...itemActions(item, ctx)),
    ),
    h(
      'div',
      { class: 'item-body' },
      h('div', {}, item.why),
      nested ? h('div', { class: 'faint', style: { marginTop: 4 } }, 'Already counted inside a larger item above, so it is not added to the totals twice.') : null,
      item.minAgeDays ? h('div', { class: 'faint', style: { marginTop: 4 } }, `Cleaning only removes items older than ${item.minAgeDays} days.`) : null,
      item.command
        ? h(
            'div',
            { class: 'cmd' },
            item.command,
            button('', { kind: 'ghost small', iconName: 'copy', title: 'Copy command', onClick: async () => (await api.copyCommand(item.command), toast('Command copied.')) }),
          )
        : null,
      item.breakdown?.length ? breakdown(item, ctx) : null,
      h(
        'div',
        { class: 'paths' },
        ...item.paths
          .slice(0, 30)
          .map((p) =>
            h(
              'div',
              { class: 'path-row' },
              h('span', { class: 'mono', title: p.path }, tilde(p.path)),
              h('span', { class: 'size faint' }, bytes(p.bytes)),
              button('', { kind: 'ghost small', iconName: 'reveal', title: 'Show in Finder', onClick: () => api.reveal(p.path) }),
              button('', { kind: 'ghost small', iconName: 'explorer', title: 'Open in Explorer', onClick: () => ctx.go('explorer', { explorerPath: p.path }) }),
            ),
          ),
        item.paths.length > 30 ? h('div', { class: 'faint' }, `…and ${item.paths.length - 30} more locations`) : null,
      ),
    ),
  );
  return el;
}

function breakdown(item, ctx) {
  const top = item.breakdown[0]?.bytes || 1;
  return h(
    'div',
    { style: { margin: '10px 0 6px' } },
    h('div', { class: 'faint', style: { marginBottom: 4 } }, 'Largest folders inside:'),
    ...item.breakdown.map((b) =>
      h(
        'div',
        { class: 'path-row' },
        h('span', { class: 'mono', title: b.path, style: { flex: '0 1 260px' } }, b.name),
        b.orphan ? h('span', { class: 'pill orphan', title: 'Silt could not find an installed app this folder belongs to. It may be left over from an app you deleted — check before removing.' }, 'No matching app') : null,
        h('div', { class: 'bar info', style: { flex: 1 } }, h('div', { style: { width: `${(b.bytes / top) * 100}%` } })),
        h('span', { class: 'size faint' }, bytes(b.bytes)),
        button('', { kind: 'ghost small', iconName: 'explorer', title: 'Open in Explorer', onClick: () => ctx.go('explorer', { explorerPath: b.path }) }),
      ),
    ),
  );
}

function itemActions(item, ctx) {
  const { api } = ctx;
  if (!item.bytes) return [];
  const acts = [];
  if (item.action === 'trash-contents' || item.action === 'trash-paths') {
    const b = button('Clean', { kind: 'small primary', iconName: 'trash' });
    b.onclick = busy(b, async () => {
      const res = await api.cleanItem(item.id);
      cleanupToast(res);
      if (res && !res.cancelled) ctx.runHiddenScan();
    });
    acts.push(b);
  } else if (item.action === 'command') {
    acts.push(button('Run in Terminal', { kind: 'small', iconName: 'terminal', onClick: () => api.runCommand(item.command) }));
  } else if (item.action === 'empty-trash') {
    const b = button('Empty Trash', { kind: 'small danger', iconName: 'trash' });
    b.onclick = busy(b, async () => {
      const res = await api.emptyTrash();
      if (res?.ok) {
        toast(`Emptied the Trash — ${bytes(res.bytes)} freed.`);
        ctx.runHiddenScan();
      } else if (res?.error) toast(`Couldn’t empty the Trash: ${res.error}`);
    });
    acts.push(b);
  } else if (item.paths[0]) {
    acts.push(button('Explore', { kind: 'small', onClick: () => ctx.go('explorer', { explorerPath: item.paths[0].path }) }));
  }
  return acts;
}
