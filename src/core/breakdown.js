'use strict';

/**
 * A measured, non-overlapping breakdown of the startup disk, in the same
 * terms as macOS's Storage settings:
 *
 *   macOS           the sealed system volume
 *   System volumes  Preboot, Recovery, VM (swap) and Update
 *   Applications    everything inside /Applications (as macOS counts it —
 *                   including folders that aren't apps)
 *   System Data     Library folders, attributed by app (see attribution.js)
 *   Your files      your home folder outside Library
 *   iCloud & cloud  local copies of iCloud Drive and cloud-drive files
 *   Not measured    what's left: app containers without Full Disk Access,
 *                   local snapshots, and system files only root can read
 *
 * Each number is measured on its own and no path is counted in two of them.
 */
function breakdown({ capacity, apfs, applications = 0, systemData = 0, homeFiles = 0, homeClaims = 0, cloud = 0 }) {
  const used = Math.max(0, (capacity?.total ?? 0) - (capacity?.free ?? 0));
  const vols = apfs?.volumes ?? [];
  const role = (r) => vols.filter((v) => v.role === r).reduce((s, v) => s + (v.bytes || 0), 0);
  const system = role('System');
  const overhead = role('Preboot') + role('Recovery') + role('VM') + role('Update');
  // Library content that lives in your home folder (e.g. ~/Music/Logic Pro Library.bundle)
  // is counted once, under System Data.
  const files = Math.max(0, homeFiles - homeClaims);
  const measured = system + overhead + applications + systemData + files + cloud;
  const segments = [
    { id: 'macos', label: 'macOS', bytes: system },
    { id: 'volumes', label: 'System volumes', bytes: overhead },
    { id: 'applications', label: 'Applications', bytes: applications },
    { id: 'systemData', label: 'System Data', bytes: systemData },
    { id: 'files', label: 'Your files', bytes: files },
    { id: 'cloud', label: 'iCloud & cloud drives', bytes: cloud },
    { id: 'other', label: 'Not measured', bytes: Math.max(0, used - measured) },
  ];
  return { used, segments, overCounted: Math.max(0, measured - used) };
}

module.exports = { breakdown };
