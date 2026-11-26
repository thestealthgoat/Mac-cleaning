import { h, bytes, button, busy, viewHead, tilde, basename, dirname, age, toast, cleanupToast } from '../ui.js';

const opts = { minBytes: 500e6, roots: null, olderThanDays: 0, selected: new Set(), scanning: false };

export function renderLarge(ctx) {
  const { api, state } = ctx;
  const home = state.overview?.home ?? '';
  const roots = opts.roots || [home];

  const minSel = h(
    'select',
    { onchange: (e) => (opts.minBytes = Number(e.target.value)) },
    ...[
      [100e6, '≥ 100 MB'],
      [250e6, '≥ 250 MB'],
      [500e6, '≥ 500 MB'],
      [1e9, '≥ 1 GB'],
      [5e9, '≥ 5 GB'],
    ].map(([v, l]) => h('option', { value: v, selected: v === opts.minBytes }, l)),
  );
  const ageSel = h(
    'select',
    {
      onchange: (e) => {
        opts.olderThanDays = Number(e.target.value);
        ctx.render();
      },
    },
    ...[
      [0, 'Any age'],
      [90, 'Untouched 3+ months'],
      [365, 'Untouched 1+ year'],
      [730, 'Untouched 2+ years'],
    ].map(([v, l]) => h('option', { value: v, selected: v === opts.olderThanDays }, l)),
  );

  const scanBtn = button(opts.scanning ? 'Scanning…' : 'Scan', { kind: 'primary', iconName: 'scan', disabled: opts.scanning });
  scanBtn.onclick = async () => {
    opts.scanning = true;
    opts.selected.clear();
    ctx.render();
    try {
      state.large = await api.scanLarge({ roots, minBytes: opts.minBytes });
    } finally {
      opts.scanning = false;
      ctx.render();
    }
  };
  const pick = button('Choose folders…', {
    onClick: async () => {
      const r = await api.pickFolders();
      if (r.length) {
        opts.roots = r;
        ctx.render();
      }
    },
  });

  const view = h(
    'div',
    {},
    viewHead('Large Files', 'The biggest individual files, wherever they hide — old videos, disk images, archives, VM disks.'),
    h('div', { class: 'toolbar' }, minSel, ageSel, pick, h('span', { class: 'faint' }, roots.map(tilde).join(', ')), h('div', { class: 'spacer' }), scanBtn),
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

  const res = state.large;
  if (!res) {
    view.append(h('div', { class: 'card empty' }, h('h3', {}, 'Find what’s big'), h('p', {}, 'Scans your home folder (including hidden folders and Library). Nothing is changed until you choose to move files to the Trash.'), scanBtn.cloneNode(true)));
    view.querySelector('.empty .btn').onclick = scanBtn.onclick;
    return view;
  }
  if (res.type === 'error') {
    view.append(h('div', { class: 'card empty' }, h('h3', {}, 'Scan failed'), h('p', {}, res.message)));
    return view;
  }

  const cutoff = opts.olderThanDays ? Date.now() - opts.olderThanDays * 86400000 : Infinity;
  const files = res.files.filter((f) => f.mtimeMs < cutoff);
  const selBytes = files.filter((f) => opts.selected.has(f.path)).reduce((s, f) => s + f.bytes, 0);
  const trashBtn = button(opts.selected.size ? `Move ${opts.selected.size} to Trash (${bytes(selBytes)})` : 'Move to Trash', { kind: 'primary', iconName: 'trash', disabled: !opts.selected.size });
  trashBtn.onclick = busy(trashBtn, async () => {
    const r = await api.trashPaths([...opts.selected]);
    cleanupToast(r);
    if (r && !r.cancelled) {
      const moved = new Set(r.results.filter((x) => x.ok).map((x) => x.path));
      res.files = res.files.filter((f) => !moved.has(f.path));
      opts.selected.clear();
      ctx.render();
    }
  });

  const total = files.reduce((s, f) => s + f.bytes, 0);
  view.append(
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'toolbar' },
        h('b', {}, `${files.length} files · ${bytes(total)}`),
        h('span', { class: 'faint' }, `${res.filesSeen.toLocaleString()} files checked in ${(res.ms / 1000).toFixed(1)} s${res.cancelled ? ' (stopped early)' : ''}`),
        h('div', { class: 'spacer' }),
        trashBtn,
      ),
      files.length
        ? h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Name'), h('th', {}, 'Location'), h('th', {}, 'Modified'), h('th', { class: 'r' }, 'Size'), h('th', {}, ''))),
            h(
              'tbody',
              {},
              ...files.map((f) =>
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    {},
                    h('input', {
                      type: 'checkbox',
                      checked: opts.selected.has(f.path),
                      onchange: (e) => {
                        e.target.checked ? opts.selected.add(f.path) : opts.selected.delete(f.path);
                        ctx.render();
                      },
                    }),
                  ),
                  h('td', {}, h('span', { class: 'fname' }, basename(f.path))),
                  h('td', { class: 'path', title: f.path }, tilde(dirname(f.path))),
                  h('td', { class: 'faint' }, age(f.mtimeMs)),
                  h('td', { class: 'r num' }, bytes(f.bytes)),
                  h('td', {}, button('', { kind: 'ghost small', iconName: 'reveal', title: 'Show in Finder', onClick: () => api.reveal(f.path) })),
                ),
              ),
            ),
          )
        : h('div', { class: 'empty' }, h('p', {}, 'No files match these filters.')),
    ),
  );
  return view;
}
