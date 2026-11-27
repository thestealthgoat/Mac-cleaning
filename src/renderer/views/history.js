import { h, bytes, button, toast } from '../ui.js';

const day = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${bytes(Math.abs(n))}`;

/** Item id → change since the baseline scan (for the delta tags in System Data). */
export function deltaMap(history) {
  const m = new Map();
  for (const c of [...(history?.changes?.grew ?? []), ...(history?.changes?.shrank ?? [])]) m.set(c.id, c.delta);
  return m;
}

export function deltaTag(delta) {
  if (!delta) return null;
  return h('span', { class: `delta ${delta > 0 ? 'up' : 'down'}`, title: 'Change since the comparison scan' }, signed(delta));
}

function sparkline(series) {
  if (!series || series.length < 3) return null;
  const W = 220;
  const H = 40;
  const vals = series.map((s) => s.free);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = series.map((s, i) => `${((i / (series.length - 1)) * W).toFixed(1)},${(H - 4 - ((s.free - min) / span) * (H - 8)).toFixed(1)}`).join(' ');
  const el = h('div', { class: 'spark', title: `Free space over your last ${series.length} scans: ${bytes(min)} – ${bytes(max)}` });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" /></svg>`;
  el.append(h('span', { class: 'faint' }, 'Free space, last scans'));
  return el;
}

/**
 * "What changed" card: what grew and shrank since a scan about a day (or more)
 * ago, how free space moved, and how much Silt has freed overall.
 */
export function changesCard(ctx, { compact = false } = {}) {
  const hist = ctx.state.hidden?.history;
  if (!hist) return null;
  const { changes, lifetime } = hist;
  const total = lifetime?.freed ? h('div', { class: 'faint', style: { marginTop: 10 } }, `Silt has freed ${bytes(lifetime.freed)} across ${lifetime.cleanups} cleanup${lifetime.cleanups === 1 ? '' : 's'}.`) : null;
  if (!changes) {
    return h(
      'div',
      { class: 'card changes' },
      h('h2', {}, 'What changed'),
      h('p', { class: 'muted' }, 'Silt saved this scan. Next time, it will show exactly what grew in between — the usual reason System Data “comes back”.'),
      total,
    );
  }
  const grew = changes.grew.slice(0, compact ? 4 : 8);
  const shrank = changes.shrank.slice(0, compact ? 2 : 4);
  const row = (c) =>
    h(
      'button',
      { class: 'change-row', onclick: () => ctx.go('hidden', { focusItem: c.id }), title: `${bytes(c.before)} → ${bytes(c.after)}` },
      h('span', { class: 'nm' }, c.name),
      h('span', { class: 'faint' }, `${bytes(c.before)} → ${bytes(c.after)}`),
      deltaTag(c.delta),
    );
  const free = changes.freeDelta != null
    ? h('div', { class: 'free-change' }, h('b', { class: changes.freeDelta < 0 ? 'down' : 'up' }, signed(changes.freeDelta)), h('span', {}, ` free space (${bytes(changes.freeBefore)} → ${bytes(changes.freeAfter)})`))
    : null;
  return h(
    'div',
    { class: 'card changes' },
    h('div', { class: 'changes-head' }, h('div', {}, h('h2', {}, `What changed since ${day(changes.since)}`), free), sparkline(hist.free)),
    grew.length ? h('div', {}, h('div', { class: 'faint label' }, 'Grew'), ...grew.map(row)) : h('p', { class: 'muted' }, 'Nothing grew by more than 50 MB.'),
    shrank.length ? h('div', { style: { marginTop: 8 } }, h('div', { class: 'faint label' }, 'Shrank'), ...shrank.map(row)) : null,
    changes.cleanedSince ? h('div', { class: 'faint', style: { marginTop: 8 } }, `Silt cleaned ${bytes(changes.cleanedSince)} in that time.`) : null,
    total,
    compact
      ? null
      : h(
          'div',
          { style: { marginTop: 10 } },
          button('Clear history', {
            kind: 'ghost small',
            onClick: async () => {
              const r = await ctx.api.clearHistory();
              if (r?.ok) {
                toast('Storage history cleared.');
                if (ctx.state.hidden) ctx.state.hidden.history = null;
                ctx.render();
              }
            },
          }),
        ),
  );
}

/** "Came back" note for an item Silt cleaned before. */
export function regrowthNote(item, history) {
  const r = history?.regrown?.[item.id];
  if (!r) return null;
  return h(
    'div',
    { class: 'regrow-note' },
    h('b', {}, 'Came back: '),
    `${bytes(r.regrown)} in ${r.days} day${r.days === 1 ? '' : 's'} since you cleaned it on ${day(r.cleanedAt)}. Cleaning it again only helps for a while — this is normal for caches and build files.`,
  );
}
