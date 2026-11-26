import { h, icon, bytes, setHome, toast } from './ui.js';
import { renderOverview } from './views/overview.js';
import { renderHidden } from './views/hidden.js';
import { renderExplorer } from './views/explorer.js';
import { renderLarge } from './views/large.js';
import { renderDupes } from './views/dupes.js';
import { renderAbout } from './views/about.js';
import { renderProjects } from './views/projects.js';

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
  projects: null,
  plugins: null,
  jobProgress: null,
  route: 'overview',
};

const ROUTES = [
  { id: 'overview', label: 'Overview', icon: 'overview', render: renderOverview, key: 1 },
  { id: 'hidden', label: 'System Data', icon: 'hidden', render: renderHidden, key: 2 },
  { id: 'projects', label: 'Projects', icon: 'projects', render: renderProjects, key: 3 },
  { id: 'explorer', label: 'Explorer', icon: 'explorer', render: renderExplorer, key: 4 },
  { id: 'large', label: 'Large Files', icon: 'large', render: renderLarge, key: 5 },
  { id: 'dupes', label: 'Duplicates', icon: 'dupes', render: renderDupes, key: 6 },
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
  const same = view.dataset.route === r.id;
  const scroll = same ? view.scrollTop : 0;
  const node = r.render({ api, state, go, render, refreshOverview, runHiddenScan });
  if (!same) node.classList.add('view-enter'); // animate only when switching screens
  view.replaceChildren(node);
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
        { class: `nav-item ${state.route === r.id ? 'active' : ''}`, onclick: () => go(r.id), title: r.key ? `${r.label}  ⌘${r.key}` : r.label },
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

function progressText(p) {
  const n = (x) => (x ?? 0).toLocaleString();
  if (p.mode === 'projects') return p.phase === 'sizes' ? `${n(p.filesSeen)} folders checked · measuring project sizes…` : `${n(p.filesSeen)} folders checked`;
  if (p.mode === 'plugins') return p.phase === 'sizes' ? 'Measuring sound libraries…' : `${n(p.done)} of ${n(p.total)} plug-ins identified`;
  const hashing = p.phase === 'quick-hash' || p.phase === 'full-hash' ? ` · comparing ${n(p.hashed)} candidates` : '';
  return `${n(p.filesSeen)} files · ${bytes(p.bytesSeen ?? 0)} scanned${hashing}`;
}

api.onJobProgress((p) => {
  state.jobProgress = p;
  const el = document.querySelector('[data-job-progress]');
  if (el) {
    el.textContent = progressText(p);
  }
  const cur = document.querySelector('[data-job-current]');
  if (cur && p.current) cur.textContent = p.current.replace(state.overview?.home ?? '', '~');
});

api.onMenu(async (m) => {
  if (m.action === 'go') go(m.route);
  else if (m.action === 'rescan') runHiddenScan();
  else if (m.action === 'export') {
    const r = await api.exportReport();
    if (r?.ok) toast('Report saved.');
  }
});

renderNav();
render();
refreshOverview().then(() => runHiddenScan());
