// Small DOM + formatting helpers shared by every view.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // only ever used with static, trusted strings (icons)
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
export function bytes(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  const d = i === 0 ? 0 : v >= 100 ? 0 : digits;
  return `${n < 0 ? '-' : ''}${v.toFixed(d)} ${UNITS[i]}`;
}

export function age(ms) {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(days / 365.25);
  return `${years} yr${years === 1 ? '' : 's'} ago`;
}

let HOME = '';
export function setHome(h) {
  HOME = h;
}
export function tilde(p) {
  return HOME && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
}
export function basename(p) {
  return p.split('/').filter(Boolean).pop() || '/';
}
export function dirname(p) {
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
}

const ICONS = {
  overview: '<path d="M3 13a9 9 0 1 1 18 0"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.2"/><path d="M5 19h14"/>',
  hidden: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  explorer: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
  large: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/>',
  dupes: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 11l-2 2 2 2M14 11l2 2-2 2"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  package: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  reveal: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  scan: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  caret: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  export: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}

export function button(label, { kind = '', iconName, onClick, title, disabled } = {}) {
  return h(
    'button',
    { class: `btn ${kind}`.trim(), title, disabled, onclick: onClick },
    iconName ? icon(iconName) : null,
    label ? h('span', {}, label) : null,
  );
}

/** Wrap an async click handler: disables the button while it runs. */
export function busy(btn, fn) {
  return async (...args) => {
    btn.disabled = true;
    try {
      return await fn(...args);
    } finally {
      btn.disabled = false;
    }
  };
}

let toastTimer;
export function toast(msg, ms = 3200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function cleanupToast(res) {
  if (!res || res.cancelled) return;
  if (res.moved === 0 && res.failed === 0) return toast('Nothing to clean.');
  const freed = res.bytes ? ` (${bytes(res.bytes)})` : '';
  const failed = res.failed ? ` · ${res.failed} skipped` : '';
  toast(`Moved ${res.moved} item${res.moved === 1 ? '' : 's'} to the Trash${freed}${failed}. Empty the Trash to free the space.`, 5200);
}

export function viewHead(title, subtitle, ...actions) {
  return h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, title), subtitle ? h('p', {}, subtitle) : null), h('div', { class: 'actions' }, ...actions));
}

export function safetyPill(safety) {
  const label = { safe: 'Safe', review: 'Review', info: 'Info' }[safety] || safety;
  return h('span', { class: `pill ${safety}` }, label);
}

/** Squarified treemap layout. items: [{ value, ... }] → [{ x, y, w, h, item }] in a w×h box. */
export function squarify(items, width, height) {
  const out = [];
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total || !width || !height) return out;
  const scale = (width * height) / total;
  const nodes = items.filter((i) => i.value > 0).map((i) => ({ item: i, area: i.value * scale }));
  let x = 0,
    y = 0,
    w = width,
    hgt = height;
  let row = [];
  const worst = (r, side) => {
    const s = r.reduce((a, n) => a + n.area, 0);
    const max = Math.max(...r.map((n) => n.area));
    const min = Math.min(...r.map((n) => n.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const layoutRow = (r) => {
    const s = r.reduce((a, n) => a + n.area, 0);
    if (w >= hgt) {
      const rw = s / hgt;
      let cy = y;
      for (const n of r) {
        const nh = n.area / rw;
        out.push({ x, y: cy, w: rw, h: nh, item: n.item });
        cy += nh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const n of r) {
        const nw = n.area / rh;
        out.push({ x: cx, y, w: nw, h: rh, item: n.item });
        cx += nw;
      }
      y += rh;
      hgt -= rh;
    }
  };
  for (const n of nodes) {
    const side = Math.min(w, hgt);
    if (row.length === 0 || worst([...row, n], side) <= worst(row, side)) {
      row.push(n);
    } else {
      layoutRow(row);
      row = [n];
    }
  }
  if (row.length) layoutRow(row);
  return out;
}
