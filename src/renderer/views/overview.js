import { h, bytes, button, busy, toast, viewHead, cleanupToast } from '../ui.js';

export function renderOverview(ctx) {
  const { api, state } = ctx;
  const o = state.overview;
  if (!o) {
    return h('div', {}, viewHead('Overview', 'Reading your disk…'), h('div', { class: 'progress indeterminate' }, h('div')));
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
    h('div', { class: 'grid hero' }, scoreCard(o), capacityCard(o)),
    h('div', { class: 'section-title' }, 'What to do'),
    h('div', { class: 'card' }, findingsList(ctx)),
  );
}

export function fdaBanner(api) {
  return h(
    'div',
    { class: 'banner' },
    h('div', { class: 'grow' }, h('b', {}, 'Full Disk Access is off. '), 'Silt can’t measure Mail, Messages, app containers or iPhone backups without it. In development, grant it to the app that launched Silt (e.g. Terminal), then reopen Silt.'),
    button('Open Settings', { onClick: () => api.openFdaSettings() }),
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

function capacityCard(o) {
  const c = o.capacity;
  const used = c.total - c.free;
  const vols = o.apfs?.volumes ?? [];
  const role = (r) => vols.filter((v) => v.role === r).reduce((s, v) => s + v.bytes, 0);
  const system = role('System');
  const overhead = role('Preboot') + role('Recovery') + role('VM') + role('Update');
  const data = role('Data') || used - system - overhead;
  const hidden = o.hidden?.totals?.explained ?? 0;
  const purgeable = Math.min(c.purgeable, data);
  // Inside the Data volume: hidden/system data we explained vs everything else.
  const hiddenPart = Math.min(hidden, Math.max(0, data - purgeable));
  const rest = Math.max(0, data - hiddenPart - purgeable);
  const segs = [
    { label: 'macOS', bytes: system, color: 'var(--c6)' },
    { label: 'System volumes', bytes: overhead, color: 'var(--c3)', title: 'Preboot, Recovery, VM and Update volumes' },
    { label: 'Library & hidden data', bytes: hiddenPart, color: 'var(--c1)', title: 'Everything the System Data scan measured: caches, app data, developer files, backups…' },
    { label: 'Apps & files', bytes: rest, color: 'var(--c2)' },
    { label: 'Purgeable', bytes: purgeable, color: 'var(--c4)' },
  ].filter((s) => s.bytes > 0);
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
      ...segs.map((s) => h('span', {}, h('i', { style: { background: s.color } }), s.label, ' ', h('b', { class: 'num' }, bytes(s.bytes)))),
      h('span', {}, h('i', { style: { background: 'var(--surface-2)', border: '1px solid var(--border-strong)' } }), 'Free ', h('b', { class: 'num' }, bytes(c.free))),
    ),
    !o.hidden ? h('p', { class: 'faint', style: { marginBottom: 0 } }, 'Hidden-data numbers appear after the System Data scan finishes.') : null,
  );
}

function findingsList(ctx) {
  const { api, state } = ctx;
  const o = state.overview;
  const findings = o.evaluation.findings;
  if (state.hiddenScanning && !state.hidden) {
    return h('div', {}, h('div', { class: 'muted' }, 'Scanning for hidden data…'), h('div', { class: 'progress' }, h('div', { 'data-hidden-progress': '', style: { width: '5%' } })));
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
      button('', { kind: 'ghost small', iconName: 'copy', title: `Copy: ${a.command}`, onClick: async () => (await api.copyCommand(a.command), toast('Command copied.')) }),
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
  if (a.type === 'reveal') return [button('Explore', { kind: 'small', onClick: () => ctx.go('explorer', { explorerPath: a.path }) })];
  if (a.type === 'fda') return [button('Open Settings', { kind: 'small', onClick: () => api.openFdaSettings() })];
  return [];
}
