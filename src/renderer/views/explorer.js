import { h, bytes, icon, button, busy, viewHead, tilde, dirname, age, squarify, toast, cleanupToast } from '../ui.js';

// Caches survive navigation so going back up is instant.
const listings = new Map(); // dir → { children, error }
const sizes = new Map(); // path → { bytes, partial, needsAccess } | 'pending'
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
let activeDir = null;
let currentBody = null; // the card currently on screen (re-renders replace it)

export function renderExplorer(ctx) {
  const { state } = ctx;
  const home = state.overview?.home ?? '/';
  const dir = state.explorerPath || home;
  activeDir = dir;
  const quick = [
    ['Home', home],
    ['Library', `${home}/Library`],
    ['Applications', '/Applications'],
    ['Whole disk', '/'],
  ];
  const body = h('div', { class: 'card' });
  const root = h(
    'div',
    {},
    viewHead(
      'Explorer',
      'Drill into any folder to see what is taking up room. Folders fill in as they are measured; apps and libraries count as single items.',
      ...quick.map(([label, p]) => button(label, { kind: dir === p ? 'small primary' : 'small', onClick: () => ctx.go('explorer', { explorerPath: p }) })),
    ),
    body,
  );
  currentBody = body;
  load(dir, body, ctx);
  return root;
}

async function load(dir, body, ctx, force = false) {
  const { api } = ctx;
  if (force) {
    listings.delete(dir);
    for (const k of [...sizes.keys()]) if (k.startsWith(dir === '/' ? '/' : dir + '/')) sizes.delete(k);
  }
  if (!listings.has(dir)) {
    body.replaceChildren(crumbs(dir, ctx), h('div', { class: 'progress indeterminate' }, h('div')));
    try {
      listings.set(dir, await api.listDir(dir));
    } catch (err) {
      body.replaceChildren(crumbs(dir, ctx), h('div', { class: 'empty' }, h('h3', {}, 'Couldn’t read this folder'), h('p', {}, String(err.message || err))));
      return;
    }
  }
  if (activeDir !== dir) return;
  const listing = listings.get(dir);
  let frame = 0;
  const paint = () => {
    if (activeDir !== dir || ctx.state.route !== 'explorer') return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => currentBody.replaceChildren(...content(dir, listing, ctx, () => load(dir, currentBody, ctx, true))));
  };
  paint();

  // Measure folders largest-first is unknowable, so go in listing order, 3 at a time.
  const pending = listing.children.filter((c) => c.isDir && !c.isSymlink && !sizes.has(c.path));
  let last = 0;
  const throttled = () => {
    const now = Date.now();
    if (now - last > 350) {
      last = now;
      paint();
    }
  };
  const worker = async () => {
    while (pending.length && activeDir === dir) {
      const c = pending.shift();
      sizes.set(c.path, 'pending');
      try {
        sizes.set(c.path, await api.sizeOf(c.path));
      } catch {
        sizes.set(c.path, { bytes: 0, partial: true });
      }
      throttled();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  paint();
}

function sizeOfChild(c) {
  if (!c.isDir || c.isSymlink) return { bytes: c.isSymlink ? 0 : c.bytes ?? 0, done: true };
  const s = sizes.get(c.path);
  if (!s || s === 'pending') return { bytes: 0, done: false };
  return { bytes: s.bytes, done: true, partial: s.partial, needsAccess: s.needsAccess };
}

function crumbs(dir, ctx) {
  const parts = dir.split('/').filter(Boolean);
  const nodes = [h('button', { onclick: () => ctx.go('explorer', { explorerPath: '/' }) }, 'Macintosh HD')];
  parts.forEach((p, i) => {
    const full = '/' + parts.slice(0, i + 1).join('/');
    nodes.push(h('span', { class: 'sep' }, '›'), h('button', { onclick: () => ctx.go('explorer', { explorerPath: full }) }, p));
  });
  return h('div', { class: 'crumbs' }, ...nodes);
}

function content(dir, listing, ctx, reload) {
  const { api } = ctx;
  const rows = listing.children.map((c) => ({ c, ...sizeOfChild(c) }));
  const measuring = rows.filter((r) => !r.done).length;
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  rows.sort((a, b) => b.bytes - a.bytes || (a.done === b.done ? 0 : a.done ? -1 : 1));

  const top = h(
    'div',
    { class: 'toolbar' },
    crumbs(dir, ctx),
    h('div', { class: 'spacer' }),
    measuring ? h('span', { class: 'faint' }, `measuring ${measuring} folder${measuring === 1 ? '' : 's'}…`) : null,
    h('b', { class: 'num' }, bytes(total)),
  );
  const controls = h(
    'div',
    { class: 'toolbar' },
    dir !== '/' ? button('Up', { kind: 'small', iconName: 'up', onClick: () => ctx.go('explorer', { explorerPath: dirname(dir) }) }) : null,
    button('Show in Finder', { kind: 'small', iconName: 'reveal', onClick: () => api.reveal(dir) }),
    button('Re-measure', { kind: 'small', iconName: 'scan', onClick: reload }),
  );
  if (listing.error === 'permission') {
    return [
      top,
      controls,
      h(
        'div',
        { class: 'empty' },
        h('h3', {}, 'macOS protects this folder'),
        h('p', {}, 'Grant Full Disk Access in System Settings › Privacy & Security to look inside. (Silt skips it otherwise so macOS doesn’t interrupt you with permission prompts.)'),
        button('Open Settings', { onClick: () => api.openFdaSettings() }),
      ),
    ];
  }
  if (!rows.length) return [top, controls, h('div', { class: 'empty' }, h('h3', {}, 'Empty folder'), h('p', {}, 'Nothing here.'))];

  const map = h('div', { class: 'treemap' });
  const sized = rows.filter((r) => r.bytes > 0);
  requestAnimationFrame(() => drawTreemap(map, sized, total, ctx));
  const shown = rows.slice(0, 250);
  return [
    top,
    controls,
    sized.length ? map : null,
    h('div', { style: { marginTop: 16 } }, ...shown.map((r) => row(r, total, ctx, reload))),
    rows.length > shown.length ? h('div', { class: 'faint', style: { marginTop: 8 } }, `${rows.length - shown.length} smaller items not shown`) : null,
  ];
}

function drawTreemap(el, rows, total, ctx) {
  const shown = rows.slice(0, 40);
  const rest = rows.slice(40).reduce((s, r) => s + r.bytes, 0);
  const items = shown.map((r, i) => ({ value: r.bytes, c: r.c, i }));
  if (rest > 0) items.push({ value: rest, other: true, count: rows.length - 40 });
  const rects = squarify(items, el.clientWidth, el.clientHeight);
  el.replaceChildren(
    ...rects.map(({ x, y, w, h: ht, item }) => {
      const big = w > 70 && ht > 34;
      const c = item.c;
      const canOpen = c && c.isDir && !c.isPackage && !c.isSymlink;
      return h(
        'div',
        {
          class: 'tile',
          style: {
            left: `${x}px`,
            top: `${y}px`,
            width: `${w}px`,
            height: `${ht}px`,
            background: item.other ? 'var(--c6)' : COLORS[item.i % COLORS.length],
            opacity: item.other ? 0.7 : 1 - Math.min(0.45, item.i * 0.02),
          },
          title: item.other ? `${item.count} smaller items · ${bytes(item.value)}` : `${c.name} · ${bytes(item.value)} (${Math.round((item.value / total) * 100)}%)`,
          onclick: () => canOpen && ctx.go('explorer', { explorerPath: c.path }),
        },
        big ? h('b', {}, item.other ? `${item.count} others` : c.name) : null,
        big ? h('span', {}, bytes(item.value)) : null,
      );
    }),
  );
}

function row({ c, bytes: size, done, partial, needsAccess }, total, ctx, reload) {
  const { api } = ctx;
  const canOpen = c.isDir && !c.isSymlink;
  const trash = button('', { kind: 'ghost small', iconName: 'trash', title: 'Move to Trash' });
  trash.onclick = busy(trash, async (e) => {
    e.stopPropagation();
    const res = await api.trashPaths([c.path]);
    if (res?.failed && res.results?.[0]?.reason) toast(res.results[0].reason, 5000);
    else cleanupToast(res);
    if (res && !res.cancelled && res.moved) reload();
  });
  return h(
    'div',
    { class: `list-row ${c.isDir ? 'dir' : ''}`, ondblclick: () => canOpen && ctx.go('explorer', { explorerPath: c.path }) },
    icon(c.isPackage ? 'package' : c.isDir ? 'folder' : 'file', 'icon'),
    h(
      'div',
      { class: 'nm', title: c.path },
      c.name,
      c.isSymlink ? h('span', { class: 'faint' }, '  → link') : null,
      needsAccess ? h('span', { class: 'pill lock', style: { marginLeft: 8 } }, 'Needs access') : null,
    ),
    done ? h('div', { class: 'bar' }, h('div', { style: { width: `${total ? Math.max(0.5, (size / total) * 100) : 0}%` } })) : h('div', { class: 'progress indeterminate', style: { margin: 0 } }, h('div')),
    h('div', { class: 'size', title: partial ? 'Some contents could not be read' : '' }, done ? bytes(size) + (partial && size ? '+' : '') : '…'),
    h(
      'div',
      { class: 'row-acts' },
      canOpen ? button('', { kind: 'ghost small', iconName: 'caret', title: 'Open', onClick: () => ctx.go('explorer', { explorerPath: c.path }) }) : null,
      button('', { kind: 'ghost small', iconName: 'reveal', title: `Show in Finder · modified ${age(c.mtimeMs)}`, onClick: () => api.reveal(c.path) }),
      trash,
    ),
  );
}
