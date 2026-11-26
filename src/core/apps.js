'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, pool } = require('./exec');

const HOME = os.homedir();
const APP_DIRS = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  path.join(HOME, 'Applications'),
  // Audio plug-ins and other bundles count as "installed software" for vendor folders.
  '/Library/Audio/Plug-Ins/Components',
  '/Library/Audio/Plug-Ins/VST3',
  '/Library/Audio/Plug-Ins/VST',
  '/Library/Application Support/Avid/Audio/Plug-Ins',
  path.join(HOME, 'Library/Audio/Plug-Ins/Components'),
  path.join(HOME, 'Library/Audio/Plug-Ins/VST3'),
  '/Library/PreferencePanes',
  '/Library/Screen Savers',
];
const BUNDLE_EXT = /\.(app|component|vst3|vst|aaxplugin|prefPane|saver)$/i;

/**
 * Folder names in Application Support / Containers that belong to macOS itself
 * or to shared frameworks, so they are never flagged as leftovers.
 */
const SYSTEM_NAMES = [
  /^com\.apple\./i,
  /^group\.com\.apple\./i,
  /^apple$/i,
  /^(addressbook|callhistorydb|callhistorytransactions|clouddocs|crashreporter|knowledge|mobilesync|icloud|fileprovider|differentialprivacy|caches|appstore|accounts|animoji|calendars?|contacts|dock|facetime|siri|spotlight|ubiquity|syncservices|com\.crashlytics|crashpad|cef|google|microsoft|adobe|mozilla|chromium|electron|node|npm|yarn|jetbrains|discord|slack)$/i,
  /^[0-9A-Z]{10}\./, // team-id prefixed group containers (owner shown by the app)
];

/** Names and bundle identifiers of every installed app (one level deep in the standard folders). */
async function installedApps() {
  const bundles = [];
  for (const dir of APP_DIRS) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) if (BUNDLE_EXT.test(n)) bundles.push(path.join(dir, n));
  }
  const limit = pool(8);
  const ids = await Promise.all(
    bundles.map((b) =>
      limit(async () => {
        const res = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(b, 'Contents', 'Info.plist')], { timeout: 5000 });
        return res.code === 0 ? res.stdout.trim() : null;
      }),
    ),
  );
  return {
    names: bundles.map((b) => norm(path.basename(b).replace(BUNDLE_EXT, ''))),
    ids: ids.filter(Boolean).map((s) => s.toLowerCase()),
  };
}

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Heuristic: does a support-folder name correspond to an installed app?
 * Errs on the side of "yes" — a false "leftover" label is worse than a miss.
 */
function matchesInstalledApp(folderName, apps) {
  if (SYSTEM_NAMES.some((re) => re.test(folderName))) return true;
  const lower = folderName.toLowerCase();
  if (apps.ids.some((id) => id === lower || id.startsWith(lower + '.') || lower.startsWith(id))) return true;
  const n = norm(folderName);
  if (n.length < 3) return true;
  // Vendor match: "RenewedVision" ↔ com.renewedvision.ProPresenter, "com.adobe.x" ↔ com.adobe.Photoshop.
  const vendorOf = (id) => norm(id.split('.')[1] || '');
  const folderVendor = lower.includes('.') ? vendorOf(lower) : n;
  if (folderVendor.length >= 3 && apps.ids.some((id) => vendorOf(id) === folderVendor || vendorOf(id) === n)) return true;
  // Bundle-id style folder ("com.vendor.product"): compare the last components.
  const tail = lower.split('.').slice(-1)[0];
  const tn = norm(tail);
  return apps.names.some((a) => a === n || a.includes(n) || n.includes(a) || (tn.length >= 3 && (a.includes(tn) || tn.includes(a))));
}

module.exports = { installedApps, matchesInstalledApp, SYSTEM_NAMES };
