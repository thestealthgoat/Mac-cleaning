import { h, bytes, button, busy, toast, viewHead, cleanupToast } from '../ui.js';
import { changesCard } from './history.js';
import { showFdaPrompt } from './fda-prompt.js';

export function renderOverview(ctx) {
  const { api, state } = ctx;
  const o = state.overview;
  if (!o) {
    return h(
      'div',
      {},
      viewHead('Overview', 'Reading your disk…'),
      h('div', { class: 'grid hero' }, h('div', { class: 'card' }, h('div', { class: 'skeleton', style: { height: '210px' } })), h('div', { class: 'card' }, h('div', { class: 'skeleton', style: { height: '28px', width: '40%', marginBottom: '18px' } }), h('div', { class: 'skeleton', style: { height: '22px', marginBottom: '14px' } }), h('div', { class: 'skeleton', style: { height: '14px', width: '70%' } }))),
    );
  }
  const c = o.capacity;
  const exportBtn = button('Export report', { iconName: 'export' });
  exportBtn.onclick = busy(exportBtn, async () => {
    const r = await api.exportReport();
    if (r?.ok) toast('Report saved.');
  });
  const rescan = button(state.hiddenScanning ? 'Scanning…' : 'Rescan', { iconName: 'scan', disabled: state.hiddenScanning, onClick: () => ctx.runHiddenScan() });

  return h(
    'div',
    {},
    viewHead('Overview', `${o.machine.model} · macOS ${o.machine.macos}`, exportBtn, rescan),
    !o.fullDiskAccess ? fdaBanner(api) : null,
    h('div', { class: 'grid hero' }, scoreCard(o), capacityCard(o, ctx)),
    state.hidden?.history ? changesCard(ctx, { compact: true }) : null,
    h('div', { class: 'section-title' }, 'What to do'),
    h('div', { class: 'card' }, findingsList(ctx)),
  );
}

export function fdaBanner(api) {
  return h(
    'div',
    { class: 'banner' },
    h('div', { class: 'grow' }, h('b', {}, 'Full Disk Access is off. '), 'Silt can’t measure app containers, Mail, Messages or iPhone backups without it.'),
    button('Turn On…', { onClick: () => showFdaPrompt(api) }),
  );
}

function scoreCard(o) {
  const { score, findings } = o.evaluation;
  const g = o.grade;
  const R = 62;
  const C = 2 * Math.PI * R;
  const ring = h('div', { class: 'ring' });
  ring.innerHTML = `<svg viewBox="0 0 150 150"><circle class="track" cx="75" cy="75" r="${R}"/><circle class="value tone-${g.tone}" cx="75" cy="75" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - score / 100)}"/></svg>`;
  ring.append(h('div', { class: 'label' }, h('b', {}, String(score)), h('span', {}, 'out of 100')));
  const counts = { critical: 0, warning: 0, info: 0 };
  findings.forEach((f) => counts[f.severity]++);
  return h(
    'div',
    { class: 'card score' },
    h('h2', { style: { alignSelf: 'flex-start' } }, 'Storage health'),
    ring,
    h('div', { class: `grade tone-${g.tone}` }, g.label),
    h('div', { class: 'faint' }, counts.critical + counts.warning ? `${counts.critical + counts.warning} issue${counts.critical + counts.warning === 1 ? '' : 's'} to look at` : 'No pressing issues'),
  );
}

const SEG_COLOR = { macos: 'var(--c6)', volumes: 'var(--c3)', applications: 'var(--c2)', systemData: 'var(--c1)', files: 'var(--c4)', cloud: 'var(--info)', other: 'var(--c5)' };
const SEG_TITLE = {
  macos: 'The sealed macOS system volume',
  volumes: 'Preboot, Recovery, VM (swap) and Update volumes',
  applications: 'Everything inside the Applications folder, as macOS counts it, including folders that aren’t apps',
  systemData: 'Library folders: app support files, caches, sound libraries, plug-ins (see System Data › By app)',
  files: 'Your home folder outside Library',
  cloud: 'Downloaded copies of iCloud Drive and cloud-drive files (Dropbox, Google Drive, OneDrive…)',
  other: 'Used space Silt can’t read: app containers without Full Disk Access, local snapshots, and system files only macOS can see',
};

function capacityCard(o, ctx) {
  const c = o.capacity;
  const used = c.total - c.free;
  const b = ctx.state.breakdown;
  let segs;
  let note = null;
  if (b) {
    const route = { applications: () => ctx.go('uninstall', { uninstallTab: b.applications.notApps > 1e9 ? 'notapps' : null }), systemData: () => ctx.go('hidden'), files: () => ctx.go('explorer', { explorerPath: o.home }) };
    segs = b.segments.filter((s) => s.bytes > 0).map((s) => ({ ...s, color: SEG_COLOR[s.id], title: SEG_TITLE[s.id], onClick: route[s.id] }));
    note = [
      'Each part is measured on its own, so nothing is counted twice.',
      b.applications.notApps > 1e9 ? `Applications includes ${bytes(b.applications.notApps)} of folders that aren’t apps.` : null,
      !b.fullDiskAccess ? 'Turn on Full Disk Access to measure app containers, which are under “Not measured” for now.' : null,
    ].filter(Boolean).join(' ');
  } else {
    const vols = o.apfs?.volumes ?? [];
    const role = (r) => vols.filter((v) => v.role === r).reduce((s, v) => s + v.bytes, 0);
    const system = role('System');
    const overhead = role('Preboot') + role('Recovery') + role('VM') + role('Update');
    segs = [
      { id: 'macos', label: 'macOS', bytes: system, color: SEG_COLOR.macos, title: SEG_TITLE.macos },
      { id: 'volumes', label: 'System volumes', bytes: overhead, color: SEG_COLOR.volumes, title: SEG_TITLE.volumes },
      { id: 'rest', label: 'Apps, System Data & files', bytes: Math.max(0, used - system - overhead), color: 'var(--c2)' },
    ].filter((s) => s.bytes > 0);
    note = ctx.state.breakdownLoading || o.hidden ? 'Measuring Applications, System Data and your files…' : 'The full breakdown appears after the System Data scan.';
  }
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Macintosh HD'),
    h(
      'div',
      { class: 'cap-numbers' },
      h('div', {}, h('b', { class: 'num' }, bytes(used)), h('span', {}, 'used')),
      h('div', {}, h('b', { class: 'num' }, bytes(c.free)), h('span', {}, 'free')),
      c.purgeable > 0 ? h('div', {}, h('b', { class: 'num' }, bytes(c.availableWithPurgeable)), h('span', {}, 'available incl. purgeable')) : null,
      h('div', {}, h('b', { class: 'num' }, bytes(c.total)), h('span', {}, 'capacity')),
    ),
    h(
      'div',
      { class: 'stack' },
      ...segs.map((s) => h('div', { style: { flexGrow: s.bytes, background: s.color }, title: `${s.title || s.label}: ${bytes(s.bytes)}` })),
      h('div', { style: { flexGrow: c.free, background: 'transparent' }, title: `Free: ${bytes(c.free)}` }),
    ),
    h(
      'div',
      { class: 'legend' },
      ...segs.map((s) =>
        s.onClick
          ? h('button', { class: 'legend-link', onclick: s.onClick, title: s.title }, h('i', { style: { background: s.color } }), s.label, ' ', h('b', { class: 'num' }, bytes(s.bytes)))
          : h('span', { title: s.title || '' }, h('i', { style: { background: s.color } }), s.label, ' ', h('b', { class: 'num' }, bytes(s.bytes))),
      ),
      h('span', {}, h('i', { style: { background: 'var(--surface-2)', border: '1px solid var(--border-strong)' } }), 'Free ', h('b', { class: 'num' }, bytes(c.free))),
    ),
    note ? h('p', { class: 'faint', style: { marginBottom: 0 } }, note) : null,
  );
}

function findingsList(ctx) {
  const { api, state } = ctx;
  const o = state.overview;
  const findings = o.evaluation.findings;
  if (state.hiddenScanning && !state.hidden) {
    return h(
      'div',
      { class: 'welcome' },
      h('img', { src: 'assets/icon.png', alt: '' }),
      h(
        'div',
        { class: 'grow' },
        h('h3', {}, 'Analyzing your Mac…'),
        h('p', {}, 'Silt is measuring the places macOS hides data. This usually takes under a minute, and nothing is changed.'),
        h('div', { class: 'progress' }, h('div', { 'data-hidden-progress': '', style: { width: '5%' } })),
        h('div', { class: 'steps' }, h('span', {}, 'Caches & logs'), h('span', {}, 'Developer tools'), h('span', {}, 'Backups & media'), h('span', {}, 'Leftover app data')),
      ),
    );
  }
  if (!findings.length) return h('div', { class: 'empty' }, h('h3', {}, 'Looking good'), h('p', {}, 'Nothing stands out. Explore the System Data tab for details.'));
  return h(
    'div',
    { class: 'findings' },
    ...findings.map((f) =>
      h(
        'div',
        { class: 'finding' },
        h('div', { class: `dot sev-${f.severity}` }),
        h('div', {}, h('div', { class: 'title' }, f.title), h('div', { class: 'detail' }, f.detail)),
        h('div', { class: 'acts' }, ...actionsFor(f, ctx)),
      ),
    ),
  );
}

function actionsFor(f, ctx) {
  const { api, state } = ctx;
  const a = f.action;
  if (!a) {
    if (f.id === 'free-critical' || f.id === 'free-low') return [button('Find space', { kind: 'small', onClick: () => ctx.go('hidden') })];
    if (f.id === 'preboot') return [button('Software Update', { kind: 'small', onClick: () => api.openStorageSettings() })];
    return [];
  }
  if (a.type === 'command') {
    return [
      button('Copy', { kind: 'ghost small', iconName: 'copy', title: `Copy: ${a.command}`, onClick: async () => (await api.copyCommand(a.command), toast('Command copied.')) }),
      button('Run in Terminal', { kind: 'small', iconName: 'terminal', onClick: () => api.runCommand(a.command) }),
    ];
  }
  if (a.type === 'clean') {
    const b = button('Clean', { kind: 'small primary' });
    b.onclick = busy(b, async () => {
      const res = await api.cleanItem(a.itemId);
      cleanupToast(res);
      if (res && !res.cancelled) ctx.runHiddenScan();
    });
    return [button('Details', { kind: 'ghost small', onClick: () => ctx.go('hidden', { focusItem: f.itemId }) }), b];
  }
  if (a.type === 'trash-path') {
    const b = button('Move to Trash…', { kind: 'small', iconName: 'trash' });
    b.onclick = busy(b, async () => {
      const res = await api.trashPaths([a.path]);
      cleanupToast(res);
      if (res && !res.cancelled && res.moved) ctx.refreshBreakdown?.();
    });
    return [button('Show in Finder', { kind: 'ghost small', onClick: () => api.reveal(a.path) }), b];
  }
  if (a.type === 'go') return [button('Review', { kind: 'small', onClick: () => ctx.go(a.route, a.opts || {}) })];
  if (a.type === 'reveal') return [button('Explore', { kind: 'small', onClick: () => ctx.go('explorer', { explorerPath: a.path }) })];
  if (a.type === 'fda') return [button('Open Settings', { kind: 'small', onClick: () => api.openFdaSettings() })];
  return [];
}
