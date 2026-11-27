import { h, bytes, button, busy, viewHead, tilde, basename, age, cleanupToast } from '../ui.js';

const opts = { minBytes: 1e6, roots: null, selected: new Set(), scanning: false };

export function renderDupes(ctx) {
  const { api, state } = ctx;
  const home = state.overview?.home ?? '';
  const roots = opts.roots || [home];

  const minSel = h(
    'select',
    { onchange: (e) => (opts.minBytes = Number(e.target.value)) },
    ...[
      [100e3, '≥ 100 KB'],
      [1e6, '≥ 1 MB'],
      [10e6, '≥ 10 MB'],
      [100e6, '≥ 100 MB'],
    ].map(([v, l]) => h('option', { value: v, selected: v === opts.minBytes }, l)),
  );
  const pick = button('Choose folders…', {
    onClick: async () => {
      const r = await api.pickFolders();
      if (r.length) {
        opts.roots = r;
        ctx.render();
      }
    },
  });
  const scan = async () => {
    opts.scanning = true;
    opts.selected.clear();
    ctx.render();
    try {
      state.dupes = await api.scanDupes({ roots, minBytes: opts.minBytes });
    } finally {
      opts.scanning = false;
      ctx.render();
    }
  };
  const scanBtn = button(opts.scanning ? 'Scanning…' : 'Find duplicates', { kind: 'primary', iconName: 'scan', disabled: opts.scanning, onClick: scan });

  const view = h(
    'div',
    {},
    viewHead('Duplicates', 'Files with byte-for-byte identical content. Silt compares size, then a quick fingerprint, then a full SHA-256 hash.'),
    h('div', { class: 'toolbar' }, minSel, pick, h('span', { class: 'faint' }, roots.map(tilde).join(', ')), h('div', { class: 'spacer' }), scanBtn),
  );

  if (opts.scanning) {
    view.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'muted', 'data-job-progress': '' }, 'Starting…'),
        h('div', { class: 'progress indeterminate' }, h('div')),
        h('div', { class: 'mono faint', 'data-job-current': '', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }),
        h('div', { style: { marginTop: 10 } }, button('Stop', { kind: 'small', iconName: 'stop', onClick: () => api.cancelJobs() })),
      ),
    );
    return view;
  }

  const res = state.dupes;
  if (!res) {
    view.append(
      h(
        'div',
        { class: 'card empty' },
        h('h3', {}, 'Find copies of the same file'),
        h('p', {}, 'Scans your home folder except ~/Library and cloud-synced folders (so nothing gets downloaded). Pick specific folders for a faster scan.'),
        button('Find duplicates', { kind: 'primary', onClick: scan }),
      ),
    );
    return view;
  }
  if (res.type === 'error') {
    view.append(h('div', { class: 'card empty' }, h('h3', {}, 'Scan failed'), h('p', {}, res.message)));
    return view;
  }

  const groups = res.groups || [];
  const wasted = groups.reduce((s, g) => s + g.wasted, 0);
  const selBytes = groups.flatMap((g) => g.files).filter((f) => opts.selected.has(f.path)).reduce((s, f) => s + f.bytes, 0);

  const autoSelect = (keep) => {
    opts.selected.clear();
    for (const g of groups) {
      const sorted = [...g.files].sort((a, b) => a.mtimeMs - b.mtimeMs);
      const keeper = keep === 'oldest' ? sorted[0] : sorted[sorted.length - 1];
      for (const f of g.files) if (f !== keeper) opts.selected.add(f.path);
    }
    ctx.render();
  };

  const trashBtn = button(opts.selected.size ? `Move ${opts.selected.size} to Trash (${bytes(selBytes)})` : 'Move to Trash', { kind: 'primary', iconName: 'trash', disabled: !opts.selected.size });
  trashBtn.onclick = busy(trashBtn, async () => {
    const r = await api.trashPaths([...opts.selected]);
    cleanupToast(r);
    if (r && !r.cancelled) {
      const moved = new Set(r.results.filter((x) => x.ok).map((x) => x.path));
      for (const g of groups) g.files = g.files.filter((f) => !moved.has(f.path));
      res.groups = groups.filter((g) => g.files.length > 1).map((g) => ({ ...g, wasted: g.bytes * (g.files.length - 1) }));
      opts.selected.clear();
      ctx.render();
    }
  });

  view.append(
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'toolbar' },
        h('b', {}, `${groups.length} sets · ${bytes(wasted)} in extra copies`),
        h('span', { class: 'faint' }, `${res.filesSeen.toLocaleString()} files checked in ${(res.ms / 1000).toFixed(1)} s${res.cancelled ? ' (stopped early)' : ''}`),
        h('div', { class: 'spacer' }),
        groups.length ? button('Keep oldest', { kind: 'small', onClick: () => autoSelect('oldest'), title: 'Select every copy except the oldest in each set' }) : null,
        groups.length ? button('Keep newest', { kind: 'small', onClick: () => autoSelect('newest') }) : null,
        groups.length ? button('Clear', { kind: 'small ghost', onClick: () => (opts.selected.clear(), ctx.render()) }) : null,
        trashBtn,
      ),
      h('p', { class: 'faint', style: { marginTop: 0 } }, 'Note: APFS can store copies as space-sharing clones. Removing a clone frees less than its size suggests.'),
      groups.length
        ? h(
            'div',
            {},
            ...groups.slice(0, 300).map((g) => {
              const allSel = g.files.every((f) => opts.selected.has(f.path));
              return h(
                'div',
                { class: 'dupe-group' },
                h('div', { class: 'dupe-head' }, h('b', {}, basename(g.files[0].path)), h('span', { class: 'faint' }, `${g.files.length} copies × ${bytes(g.bytes)}`), h('span', { class: 'num', style: { marginLeft: 'auto', fontWeight: 600 } }, `${bytes(g.wasted)} extra`)),
                allSel ? h('div', { class: 'faint', style: { color: 'var(--bad)' } }, 'Every copy in this set is selected — keep at least one.') : null,
                ...g.files.map((f) =>
                  h(
                    'div',
                    { class: 'dupe-file' },
                    h('input', {
                      type: 'checkbox',
                      checked: opts.selected.has(f.path),
                      onchange: (e) => {
                        e.target.checked ? opts.selected.add(f.path) : opts.selected.delete(f.path);
                        ctx.render();
                      },
                    }),
                    h('span', { class: 'mono', title: f.path }, tilde(f.path)),
                    h('span', { class: 'faint' }, age(f.mtimeMs)),
                    button('Show in Finder', { kind: 'ghost small', title: 'Show in Finder', onClick: () => api.reveal(f.path) }),
                  ),
                ),
              );
            }),
          )
        : h('div', { class: 'empty' }, h('h3', {}, 'No duplicates found'), h('p', {}, 'Try a smaller minimum size or a different folder.')),
    ),
  );
  return view;
}
