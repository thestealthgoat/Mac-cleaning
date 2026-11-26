import { h, icon, bytes, setHome } from './ui.js';
import { renderOverview } from './views/overview.js';
import { renderHidden } from './views/hidden.js';
import { renderExplorer } from './views/explorer.js';
import { renderLarge } from './views/large.js';
import { renderDupes } from './views/dupes.js';
import { renderAbout } from './views/about.js';

const api = window.silt;

// Shared, in-memory app state. Views read from and write to this.
export const state = {
  overview: null,
  hidden: null,
  hiddenScanning: false,
  hiddenProgress: null,
  explorerPath: null,
  large: null,
  dupes: null,
  jobProgress: null,
  route: 'overview',
};

const ROUTES = [
  { id: 'overview', label: 'Overview', icon: 'overview', render: renderOverview },
  { id: 'hidden', label: 'System Data', icon: 'hidden', render: renderHidden },
  { id: 'explorer', label: 'Explorer', icon: 'explorer', render: renderExplorer },
  { id: 'large', label: 'Large Files', icon: 'large', render: renderLarge },
  { id: 'dupes', label: 'Duplicates', icon: 'dupes', render: renderDupes },
  { id: 'about', label: 'About', icon: 'about', render: renderAbout },
];

export function go(route, opts = {}) {
  state.route = route;
  Object.assign(state, opts);
  renderNav();
  render();
}

export function render() {
  const view = document.getElementById('view');
  const r = ROUTES.find((x) => x.id === state.route) || ROUTES[0];
  const scroll = view.dataset.route === r.id ? view.scrollTop : 0;
  view.replaceChildren(r.render({ api, state, go, render, refreshOverview, runHiddenScan }));
  view.dataset.route = r.id;
  view.scrollTop = scroll;
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(
    ...ROUTES.map((r) => {
      let badge = null;
      if (r.id === 'hidden' && state.hidden) badge = bytes(state.hidden.totals.reclaimableSafe, 0);
      if (r.id === 'hidden' && state.hiddenScanning) badge = '…';
      return h(
        'button',
        { class: `nav-item ${state.route === r.id ? 'active' : ''}`, onclick: () => go(r.id) },
        icon(r.icon),
        h('span', {}, r.label),
        badge ? h('span', { class: 'badge' }, badge) : null,
      );
    }),
  );
  const foot = document.getElementById('sidebar-foot');
  const c = state.overview?.capacity;
  if (c) {
    const used = c.total - c.free;
    foot.replaceChildren(
      h('div', {}, `${bytes(c.free)} free of ${bytes(c.total)}`),
      h('div', { class: 'mini-bar' }, h('div', { style: { width: `${(used / c.total) * 100}%` } })),
      h('div', {}, `Macintosh HD · ${Math.round((used / c.total) * 100)}% used`),
    );
  }
}

export async function refreshOverview() {
  state.overview = await api.overview();
  setHome(state.overview.home);
  if (!state.explorerPath) state.explorerPath = state.overview.home;
  renderNav();
  render();
}

export async function runHiddenScan() {
  if (state.hiddenScanning) return;
  state.hiddenScanning = true;
  state.hiddenProgress = { done: 0, total: 1 };
  renderNav();
  render();
  try {
    state.hidden = await api.scanHidden();
  } finally {
    state.hiddenScanning = false;
  }
  await refreshOverview(); // re-evaluates the score with the new data
}

api.onHiddenProgress((p) => {
  state.hiddenProgress = p;
  const bar = document.querySelector('[data-hidden-progress]');
  if (bar) bar.style.width = `${(p.done / p.total) * 100}%`;
});

api.onJobProgress((p) => {
  state.jobProgress = p;
  const el = document.querySelector('[data-job-progress]');
  if (el) {
    el.textContent = `${p.filesSeen.toLocaleString()} files · ${bytes(p.bytesSeen)} scanned${p.phase ? ` · comparing ${p.hashed.toLocaleString()} candidates` : ''}`;
  }
  const cur = document.querySelector('[data-job-current]');
  if (cur && p.current) cur.textContent = p.current.replace(state.overview?.home ?? '', '~');
});

renderNav();
render();
refreshOverview().then(() => runHiddenScan());
