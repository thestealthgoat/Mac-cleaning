'use strict';

// macOS Finder and "About This Mac" use decimal units (1 GB = 1,000,000,000 bytes),
// so Silt does the same to keep numbers comparable with what users see elsewhere.
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

function formatBytes(bytes, digits = 1) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  const sign = bytes < 0 ? '-' : '';
  let n = Math.abs(bytes);
  let i = 0;
  while (n >= 1000 && i < UNITS.length - 1) {
    n /= 1000;
    i++;
  }
  const d = i === 0 ? 0 : n >= 100 ? 0 : digits;
  return `${sign}${n.toFixed(d)} ${UNITS[i]}`;
}

function percent(part, whole, digits = 0) {
  if (!whole) return '0%';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

function formatAge(ms, now = Date.now()) {
  const days = Math.floor((now - ms) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365.25);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

module.exports = { formatBytes, percent, formatAge };
