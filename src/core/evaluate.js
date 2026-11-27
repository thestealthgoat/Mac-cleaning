'use strict';

const { formatBytes } = require('./format');

const GB = 1e9;

/**
 * Turn the raw scan data into a health score and a ranked list of findings.
 * Pure function: easy to test, no I/O.
 *
 * @param {object} input
 * @param {object} input.capacity   { total, free, purgeable, availableWithPurgeable }
 * @param {object} [input.apfs]     { volumes: [{ role, bytes, name }] }
 * @param {object} [input.snapshots]{ snapshots: [{ kind }] }
 * @param {object} [input.hidden]   result of scanHidden()
 * @param {boolean} [input.fullDiskAccess]
 */
function evaluate({ capacity, apfs, snapshots, hidden, fullDiskAccess = true }) {
  const findings = [];
  const total = capacity.total || 1;
  const freeRatio = capacity.free / total;
  const availRatio = capacity.availableWithPurgeable / total;

  // ── Free space ──
  if (capacity.free < 10 * GB || freeRatio < 0.05) {
    findings.push({
      id: 'free-critical',
      severity: 'critical',
      title: `Only ${formatBytes(capacity.free)} free`,
      detail: 'macOS needs roughly 10–20 GB free for updates, swap and caches. Below that, apps slow down and updates fail.',
    });
  } else if (freeRatio < 0.15) {
    findings.push({
      id: 'free-low',
      severity: 'warning',
      title: `${formatBytes(capacity.free)} free (${Math.round(freeRatio * 100)}%)`,
      detail: 'Keeping at least 15% free helps APFS performance and leaves room for updates.',
    });
  }

  if (capacity.purgeable > 2 * GB) {
    findings.push({
      id: 'purgeable',
      severity: 'info',
      title: `${formatBytes(capacity.purgeable)} is purgeable`,
      detail: 'macOS will release this automatically when space is needed (iCloud files with local copies, caches, snapshots). It counts as "used" in some tools.',
      bytes: capacity.purgeable,
    });
  }

  // ── APFS volumes ──
  const vol = (role) => apfs?.volumes?.filter((v) => v.role === role).reduce((s, v) => s + v.bytes, 0) ?? 0;
  const preboot = vol('Preboot');
  if (preboot > 8 * GB) {
    findings.push({
      id: 'preboot',
      severity: 'warning',
      title: `Preboot volume is ${formatBytes(preboot)}`,
      detail: 'Usually 1–6 GB. A large Preboot normally holds a staged or leftover macOS update. Installing pending updates (or restarting after one) typically shrinks it.',
      bytes: preboot,
    });
  }
  const vm = vol('VM');
  if (vm > 8 * GB) {
    findings.push({
      id: 'vm',
      severity: 'warning',
      title: `Swap & sleep image use ${formatBytes(vm)}`,
      detail: 'The VM volume grows when memory is under pressure. Quitting memory-heavy apps and restarting releases it.',
      bytes: vm,
      action: { type: 'info' },
    });
  }
  const others = apfs?.volumes?.filter((v) => v.role === 'Other' && v.bytes > 5 * GB) ?? [];
  for (const v of others) {
    findings.push({
      id: `volume-${v.device}`,
      severity: 'info',
      title: `Extra volume "${v.name}" uses ${formatBytes(v.bytes)}`,
      detail: 'It shares space with your startup disk. Erase it in Disk Utility if you no longer need it.',
      bytes: v.bytes,
    });
  }

  // ── Snapshots ──
  const tm = snapshots?.snapshots?.filter((s) => s.kind === 'timemachine') ?? [];
  if (tm.length) {
    findings.push({
      id: 'tm-snapshots',
      severity: tm.length > 5 ? 'warning' : 'info',
      title: `${tm.length} local Time Machine snapshot${tm.length === 1 ? '' : 's'}`,
      detail: 'Snapshots keep deleted files on disk until they expire (24 h) or space runs low. Their size is not reported by macOS, but they are a classic cause of runaway System Data.',
      action: { type: 'command', command: 'tmutil thinlocalsnapshots / 999999999999 4' },
    });
  }

  // ── Hidden data catalog ──
  if (hidden) {
    const cleanable = hidden.items
      .filter((i) => i.cleanable && i.uniqueBytes > 0.5 * GB && (i.safety === 'safe' || i.safety === 'review'))
      .sort((a, b) => b.uniqueBytes - a.uniqueBytes);
    for (const item of cleanable.slice(0, 8)) {
      findings.push({
        id: `item-${item.id}`,
        severity: item.uniqueBytes > 10 * GB ? 'warning' : 'info',
        title: `${item.name}: ${formatBytes(item.uniqueBytes)}`,
        detail: item.why,
        bytes: item.uniqueBytes,
        itemId: item.id,
        safety: item.safety,
        action: item.command ? { type: 'command', command: item.command } : { type: 'clean', itemId: item.id },
      });
    }
    // Apple's sound library in both the old (/Library) and new (Logic Pro Library.bundle) layout.
    const audio = hidden.items.find((i) => i.id === 'audio-content');
    const legacy = audio?.paths.find((p) => p.path === '/Library/Application Support/Logic');
    const bundle = audio?.paths.find((p) => p.path.endsWith('/Music/Logic Pro Library.bundle'));
    if (legacy?.bytes > 10 * GB && bundle?.bytes > 10 * GB) {
      findings.push({
        id: 'logic-library-twice',
        severity: 'warning',
        title: `Apple’s sound library may be installed twice (${formatBytes(legacy.bytes)} + ${formatBytes(bundle.bytes)})`,
        detail: 'Newer Logic Pro and MainStage keep instruments and loops in “Logic Pro Library.bundle” in your Music folder; older versions used /Library/Application Support/Logic. Having both large usually means a leftover copy. Check in Logic Pro or MainStage › Sound Library › Open Sound Library Manager which one is in use before removing anything.',
        bytes: Math.min(legacy.bytes, bundle.bytes),
        itemId: 'audio-content',
        action: { type: 'reveal', path: legacy.path },
      });
    }
    const bigInfo = hidden.items.filter((i) => !i.cleanable && i.uniqueBytes > 20 * GB).slice(0, 4);
    for (const item of bigInfo) {
      findings.push({
        id: `info-${item.id}`,
        severity: 'info',
        title: `${item.name}: ${formatBytes(item.uniqueBytes)}`,
        detail: item.why,
        bytes: item.uniqueBytes,
        itemId: item.id,
        action: { type: 'reveal', path: item.paths[0]?.path },
      });
    }
  }

  if (!fullDiskAccess) {
    findings.push({
      id: 'fda',
      severity: 'info',
      title: 'Full Disk Access is off',
      detail: 'Mail, Messages and device backups cannot be measured without it. Grant it in System Settings › Privacy & Security › Full Disk Access.',
      action: { type: 'fda' },
    });
  }

  const order = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (b.bytes ?? 0) - (a.bytes ?? 0));

  return { score: score({ freeRatio, availRatio, hidden, total, preboot, vm, tmCount: tm.length }), findings };
}

/**
 * 0–100. Free space dominates; easy wins (safe reclaimable data) and
 * known bloat lower the score a little so the number reacts to cleaning.
 */
function score({ freeRatio, availRatio, hidden, total, preboot, vm, tmCount }) {
  // 25%+ available → full 70 points; scales linearly down to 0 at 0%.
  let s = Math.min(1, Math.max(freeRatio, availRatio * 0.9) / 0.25) * 70;
  const safe = hidden?.totals?.reclaimableSafe ?? 0;
  s += 20 * (1 - Math.min(1, safe / (total * 0.1))); // up to 20 pts if little cache junk
  s += preboot > 8 * GB ? 0 : 4;
  s += vm > 8 * GB ? 0 : 3;
  s += tmCount > 5 ? 0 : 3;
  return Math.round(Math.max(0, Math.min(100, s)));
}

function grade(scoreValue) {
  if (scoreValue >= 85) return { label: 'Healthy', tone: 'good' };
  if (scoreValue >= 65) return { label: 'Fair', tone: 'ok' };
  if (scoreValue >= 40) return { label: 'Tight', tone: 'warn' };
  return { label: 'Critical', tone: 'bad' };
}

module.exports = { evaluate, score, grade };
