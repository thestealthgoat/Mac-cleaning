'use strict';

/**
 * Smart uninstall: find everything that belongs to an app, decide which
 * pieces are shared with other installed software, and which are the
 * user's own documents.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, pool } = require('./exec');
const { expandGlob, expandHome, isWithin } = require('./paths');
const { vendorKey } = require('./plugins');

const APP_ROOTS = ['/Applications', '/Applications/Utilities'];

/**
 * Content shared by a family of apps. If another app of the family is still
 * installed, the content stays (unchecked, flagged "also used by …").
 */
const SHARED_GROUPS = [
  {
    id: 'apple-pro-audio',
    label: 'Apple sound library (Logic Pro, MainStage, GarageBand)',
    apps: ['com.apple.logic10', 'com.apple.mainstage3', 'com.apple.garageband10', 'com.apple.garageband'],
    paths: [
      '/Library/Application Support/Logic',
      '/Library/Application Support/GarageBand',
      '/Library/Audio/Apple Loops',
      '/Library/Audio/Apple Loops Index',
      '/Library/Audio/Impulse Responses/Apple',
      '~/Library/Application Support/Logic',
      '~/Library/Audio/Apple Loops',
      '~/Music/Audio Music Apps',
      '~/Music/Logic Pro Library.bundle',
    ],
  },
  {
    id: 'apple-pro-video',
    label: 'Apple pro video content (Final Cut Pro, Motion, Compressor)',
    apps: ['com.apple.FinalCut', 'com.apple.motionapp', 'com.apple.Compressor'],
    paths: ['/Library/Application Support/ProApps', '/Library/Application Support/Final Cut Pro System Support', '/Library/Video/Plug-Ins'],
  },
  {
    id: 'microsoft-office',
    label: 'Microsoft Office shared data',
    apps: ['com.microsoft.Word', 'com.microsoft.Excel', 'com.microsoft.Powerpoint', 'com.microsoft.Outlook', 'com.microsoft.onenote.mac'],
    paths: ['~/Library/Group Containers/UBF8T346G9.Office', '~/Library/Group Containers/UBF8T346G9.OfficeOsfWebHost', '/Library/Application Support/Microsoft/Office365'],
  },
  {
    id: 'adobe',
    label: 'Adobe shared data',
    appPrefix: 'com.adobe.',
    paths: ['~/Library/Application Support/Adobe', '/Library/Application Support/Adobe', '~/Library/Caches/Adobe'],
  },
];

/** Folders where an app keeps the user's own work. Never selected automatically. */
const DOCUMENTS = {
  'com.apple.mainstage3': ['~/Music/MainStage'],
  'com.apple.logic10': ['~/Music/Logic'],
  'com.apple.garageband10': ['~/Music/GarageBand'],
  'com.ableton.live': ['~/Music/Ableton'],
  'com.presonus.studioone': ['~/Documents/Studio One'],
  'com.renewedvision.propresenter': ['~/Documents/ProPresenter'],
  'com.renewedvision.propresenter7': ['~/Documents/ProPresenter'],
  'com.apple.FinalCut': ['~/Movies/*.fcpbundle'],
  'com.apple.iMovieApp': ['~/Movies/iMovie Library.imovielibrary', '~/Movies/iMovie Theater.theater'],
  'com.obsproject.obs-studio': ['~/Movies/*.mkv'],
  'com.blackmagic-design.DaVinciResolve': ['~/Movies/CacheClip'],
  'com.native-instruments.NativeAccess2': [],
};

const CATEGORY_LABEL = {
  app: 'Application',
  support: 'Support data',
  caches: 'Caches',
  prefs: 'Preferences',
  state: 'Saved state & web data',
  containers: 'Sandbox containers',
  logs: 'Logs & crash reports',
  launch: 'Background items',
  shared: 'Content shared by related apps',
  vendor: 'Vendor files',
  plugins: 'Related plug-ins',
  documents: 'Your documents',
};

async function readInfo(appPath) {
  const res = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], { timeout: 8000 });
  if (res.code !== 0) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

/**
 * Apps a user can uninstall: bundles in /Applications and ~/Applications,
 * excluding Apple's built-in apps (which are protected by macOS).
 */
async function listApps({ home = os.homedir() } = {}) {
  const bundles = [];
  for (const dir of [...APP_ROOTS, path.join(home, 'Applications')]) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith('.app')) bundles.push(path.join(dir, n));
  }
  const limit = pool(8);
  const apps = await Promise.all(
    bundles.map((p) =>
      limit(async () => {
        const info = await readInfo(p);
        if (!info) return null;
        const id = info.CFBundleIdentifier || '';
        const fromAppStore = fs.existsSync(path.join(p, 'Contents', '_MASReceipt'));
        // Built-in Apple apps (Safari etc.) are sealed by macOS; App Store Apple apps (MainStage, Logic) are removable.
        if (id.startsWith('com.apple.') && !fromAppStore) return null;
        return {
          path: p,
          id,
          iconFile: info.CFBundleIconFile || null,
          name: info.CFBundleDisplayName || info.CFBundleName || path.basename(p, '.app'),
          fileName: path.basename(p, '.app'),
          executable: info.CFBundleExecutable || null,
          version: info.CFBundleShortVersionString || null,
          fromAppStore,
        };
      }),
    ),
  );
  const list = apps.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const used = await lastUsedDates(list.map((a) => a.path));
  list.forEach((a, i) => {
    a.lastUsed = used[i];
    a.lastUsedApprox = false;
    if (a.lastUsed == null) {
      // Spotlight often has no record (App Store apps, apps opened from the Dock).
      // Apps write their settings and window state while in use, so those dates stand in.
      a.lastUsed = activityDate(a, home);
      a.lastUsedApprox = a.lastUsed != null;
    }
  });
  return list;
}

/** Latest change to an app's preferences, saved window state or caches (not sandbox containers: reading those can trigger a privacy prompt). */
function activityDate(app, home = os.homedir()) {
  if (!app.id) return null;
  const L = path.join(home, 'Library');
  let latest = null;
  for (const p of [path.join(L, 'Preferences', `${app.id}.plist`), path.join(L, 'Saved Application State', `${app.id}.savedState`), path.join(L, 'Caches', app.id), path.join(L, 'HTTPStorages', app.id)]) {
    try {
      const t = fs.statSync(p).mtimeMs;
      if (latest == null || t > latest) latest = t;
    } catch {
      /* not there */
    }
  }
  return latest;
}

/** Parse `mdls -raw` output for several files: NUL-separated values, "(null)" when unknown. */
function parseMdlsDates(stdout, count) {
  const parts = String(stdout).split('\0');
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = (parts[i] ?? '').trim();
    const m = v.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
    out.push(m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : null);
  }
  return out;
}

/**
 * When each app was last opened, from Spotlight's metadata (what Finder shows
 * as "Last opened"). null when macOS has no record.
 */
async function lastUsedDates(paths) {
  const out = [];
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const res = await run('/usr/bin/mdls', ['-name', 'kMDItemLastUsedDate', '-raw', ...chunk], { timeout: 20000 });
    out.push(...(res.code === 0 ? parseMdlsDates(res.stdout, chunk.length) : chunk.map(() => null)));
  }
  return out;
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Is `p` writable by the current user (so it can go to the Trash without a password)? */
function userCanMove(p) {
  try {
    fs.accessSync(path.dirname(p), fs.constants.W_OK);
    if (fs.lstatSync(p).isDirectory()) fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locations an uninstall may remove. Stricter than "anything in Library":
 * each pattern is one level below a known per-app location.
 */
function uninstallAllowlist(home) {
  const L = path.join(home, 'Library');
  return [
    /^\/Applications\/[^/]+\.app$/,
    /^\/Applications\/Utilities\/[^/]+\.app$/,
    new RegExp(`^${esc(home)}/Applications/[^/]+\\.app$`),
    ...['Application Support', 'Caches', 'Logs', 'Containers', 'Group Containers', 'Application Scripts', 'Saved Application State', 'HTTPStorages', 'WebKit', 'Cookies', 'LaunchAgents', 'Preferences', 'Preferences/ByHost', 'Logs/DiagnosticReports', 'Audio/Plug-Ins/Components', 'Audio/Plug-Ins/VST', 'Audio/Plug-Ins/VST3', 'Audio/Apple Loops'].map(
      (d) => new RegExp(`^${esc(path.join(L, d))}/[^/]+$`),
    ),
    ...['Application Support', 'Caches', 'Logs', 'Preferences', 'LaunchAgents', 'LaunchDaemons', 'PrivilegedHelperTools', 'Audio/Plug-Ins/Components', 'Audio/Plug-Ins/VST', 'Audio/Plug-Ins/VST3', 'Audio/Plug-Ins/CLAP', 'Application Support/Avid/Audio/Plug-Ins', 'Audio/Apple Loops', 'Audio/Impulse Responses', 'Video/Plug-Ins'].map(
      (d) => new RegExp(`^${esc(path.join('/Library', d))}/[^/]+$`),
    ),
    /^\/Library\/Audio\/Apple Loops$/,
    /^\/Library\/Audio\/Apple Loops Index$/,
    /^\/Users\/Shared\/[^/]+$/,
    new RegExp(`^${esc(path.join(home, 'Music'))}/[^/]+$`),
    new RegExp(`^${esc(path.join(home, 'Documents'))}/[^/]+$`),
    new RegExp(`^${esc(path.join(home, 'Movies'))}/[^/]+$`),
  ];
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NEVER = ['/System', '/usr', '/bin', '/sbin', '/private/etc', '/private/var/db'];

function checkUninstallable(p, home = os.homedir()) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || path.resolve(p) !== p) return { ok: false, reason: 'Invalid path.' };
  if (NEVER.some((n) => isWithin(p, n))) return { ok: false, reason: 'System location.' };
  for (const keep of ['Keychains', 'Mobile Documents', 'CloudStorage', 'Mail', 'Messages']) {
    if (isWithin(p, path.join(home, 'Library', keep))) return { ok: false, reason: 'Protected location.' };
  }
  if (!uninstallAllowlist(home).some((re) => re.test(p))) return { ok: false, reason: 'Not a recognised app location.' };
  if (!exists(p)) return { ok: false, reason: 'Already gone.' };
  return { ok: true };
}

/** Find every candidate path for an app. Returns raw items (no sizes). */
function findAppFiles(app, { home = os.homedir(), installed = [], plugins = [], fullDiskAccess = true } = {}) {
  const L = path.join(home, 'Library');
  const items = new Map();
  const add = (p, category, extra = {}) => {
    if (!p || items.has(p) || !exists(p)) return;
    if ([...items.keys()].some((q) => isWithin(p, q))) return; // already inside something listed
    items.set(p, { path: p, category, ...extra });
  };
  const id = app.id;
  const names = [...new Set([app.name, app.fileName, app.executable].filter((n) => n && n.length >= 3))];
  const idLower = id.toLowerCase();

  add(app.path, 'app');

  // Shared families first, so the generic name/id search below does not claim them.
  const others = installed.filter((a) => a.path !== app.path);
  for (const g of SHARED_GROUPS) {
    const member = g.apps ? g.apps.includes(id) : g.appPrefix && id.startsWith(g.appPrefix);
    if (!member) continue;
    const sharedWith = others.filter((a) => (g.apps ? g.apps.includes(a.id) : a.id.startsWith(g.appPrefix))).map((a) => a.name);
    for (const p of g.paths.flatMap((x) => expandGlob(x, home))) add(p, 'shared', { group: g.label, sharedWith });
  }

  // Your documents.
  for (const p of (DOCUMENTS[id] || []).flatMap((x) => expandGlob(x, home))) add(p, 'documents');

  const byIdAndName = (dir, category, opts = {}) => {
    for (const key of [id, ...(opts.idOnly ? [] : names)]) add(path.join(dir, key), category);
  };
  byIdAndName(path.join(L, 'Application Support'), 'support');
  byIdAndName('/Library/Application Support', 'support');
  byIdAndName(path.join(L, 'Caches'), 'caches');
  byIdAndName('/Library/Caches', 'caches', { idOnly: true });
  byIdAndName(path.join(L, 'Logs'), 'logs');
  byIdAndName('/Library/Logs', 'logs');
  add(path.join(L, 'Preferences', `${id}.plist`), 'prefs');
  add(path.join('/Library/Preferences', `${id}.plist`), 'prefs');
  for (const p of expandGlob(`~/Library/Preferences/ByHost/${id}.*.plist`, home)) add(p, 'prefs');
  add(path.join(L, 'Saved Application State', `${id}.savedState`), 'state');
  add(path.join(L, 'HTTPStorages', id), 'state');
  add(path.join(L, 'HTTPStorages', `${id}.binarycookies`), 'state');
  add(path.join(L, 'WebKit', id), 'state');
  add(path.join(L, 'Cookies', `${id}.binarycookies`), 'state');
  add(path.join(L, 'Application Scripts', id), 'containers');
  if (fullDiskAccess) {
    add(path.join(L, 'Containers', id), 'containers');
    for (const p of expandGlob(`~/Library/Group Containers/*.${id}`, home)) add(p, 'containers');
    for (const p of expandGlob(`~/Library/Group Containers/group.${id}*`, home)) add(p, 'containers');
  }
  for (const dir of [path.join(L, 'LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons', '/Library/PrivilegedHelperTools']) {
    let ns = [];
    try {
      ns = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of ns) if (n.toLowerCase().startsWith(idLower)) add(path.join(dir, n), 'launch');
  }
  if (app.executable) {
    for (const p of expandGlob(`~/Library/Logs/DiagnosticReports/${app.executable}*`, home)) add(p, 'logs');
  }
  for (const n of names) add(path.join('/Users/Shared', n), 'support');

  // Vendor folders (e.g. "/Library/Application Support/Native Instruments") — shared
  // when the same vendor has other apps or plug-ins installed.
  const vendor = id.split('.')[1] || '';
  const vk = vendorKey(vendor);
  // "slatedigital" (bundle id) ↔ "Slate Digital" (folder, normalised to "slate").
  const sameVendor = (k) => !!k && (k === vk || (Math.min(k.length, vk.length) >= 4 && (k.startsWith(vk) || vk.startsWith(k))));
  if (vk.length >= 4 && vendor.toLowerCase() !== 'apple') {
    const sameVendorApps = others.filter((a) => sameVendor(vendorKey(a.id.split('.')[1] || ''))).map((a) => a.name);
    const vendorPlugins = plugins.filter((p) => sameVendor(vendorKey(p.idVendor || '')) || sameVendor(vendorKey(p.vendor || '')));
    const sharedWith = [...sameVendorApps, ...(vendorPlugins.length ? [`${vendorPlugins.length} plug-in${vendorPlugins.length === 1 ? '' : 's'}`] : [])];
    for (const root of [path.join(L, 'Application Support'), '/Library/Application Support', '/Users/Shared', path.join(L, 'Caches')]) {
      let ns = [];
      try {
        ns = fs.readdirSync(root);
      } catch {
        continue;
      }
      for (const n of ns) if (sameVendor(vendorKey(n))) add(path.join(root, n), 'vendor', { sharedWith });
    }
    // The vendor's plug-ins: listed so you can see them, never selected automatically.
    for (const p of vendorPlugins) for (const bp of p.paths || []) add(bp, 'plugins', { sharedWith: ['your DAWs'], pluginName: p.name });
  }

  return [...items.values()];
}

/** Decide default selection and flags for each item. */
function classify(items) {
  return items.map((it) => {
    const shared = (it.sharedWith || []).filter(Boolean);
    let checked = true;
    let note = null;
    if (it.category === 'documents') {
      checked = false;
      note = 'Your own work — kept unless you select it.';
    } else if (it.category === 'plugins') {
      checked = false;
      note = 'Plug-in used by your DAWs — kept unless you select it.';
    } else if (shared.length) {
      checked = false;
      note = `Also used by ${listNames(shared)} — kept so they keep working.`;
    } else if (it.category === 'shared' || it.category === 'vendor') {
      note = 'No other installed software uses this.';
    }
    return { ...it, label: CATEGORY_LABEL[it.category], shared, checked, note };
  });
}

function listNames(names) {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

async function isRunning(app) {
  const res = await run('/bin/ps', ['-axo', 'comm=']);
  const prefix = path.join(app.path, 'Contents', 'MacOS') + '/';
  return res.stdout.split('\n').some((l) => l.trim().startsWith(prefix));
}

/** Shell-quote for /bin/sh. */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the shell script that moves root-owned items into the user's Trash
 * (run once through macOS's own administrator prompt).
 */
function adminMoveScript(paths, { home = os.homedir(), uid = process.getuid(), stamp = new Date() } = {}) {
  const trash = path.join(home, '.Trash');
  const tag = stamp.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const lines = ['set -e'];
  const used = new Set();
  for (const p of paths) {
    // Two items with the same name would otherwise land inside each other.
    let name = `${path.basename(p)} (uninstalled ${tag})`;
    for (let n = 2; used.has(name); n++) name = `${path.basename(p)} (uninstalled ${tag} ${n})`;
    used.add(name);
    const dest = path.join(trash, name);
    lines.push(`mv ${shq(p)} ${shq(dest)}`, `chown -R ${Number(uid)} ${shq(dest)}`);
  }
  return lines.join('\n');
}

/**
 * AppleScript that runs the move script through macOS's administrator prompt.
 * Without `admin` it runs as the current user (used by tests).
 */
function adminAppleScript(paths, { home = os.homedir(), uid, stamp, prompt = 'Silt needs your password to move system files to the Trash.', admin = true } = {}) {
  const script = adminMoveScript(paths, { home, uid, stamp })
    .split('\n')
    .filter((l) => l !== 'set -e')
    .join(' && ');
  const asString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `do shell script ${asString(script)}${admin ? ` with administrator privileges with prompt ${asString(prompt)}` : ''}`;
}

/**
 * App icon as a PNG data URL, converted from the bundle's .icns with the
 * built-in `sips` tool and cached. (Electron's getFileIcon can hang the main
 * process on recent macOS, so it is not used.)
 */
async function appIcon(app, cacheDir) {
  if (!app.iconFile) return null;
  const name = app.iconFile.endsWith('.icns') ? app.iconFile : `${app.iconFile}.icns`;
  const src = path.join(app.path, 'Contents', 'Resources', name);
  if (!exists(src)) return null;
  const key = `${app.id || path.basename(app.path)}-${Math.round(fs.statSync(src).mtimeMs)}.png`.replace(/[^\w.-]/g, '_');
  const out = path.join(cacheDir, key);
  if (!exists(out)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const res = await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '64', src, '--out', out], { timeout: 15000 });
    if (res.code !== 0 || !exists(out)) return null;
  }
  return `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`;
}

module.exports = {
  parseMdlsDates,
  activityDate,
  lastUsedDates, listApps, appIcon, adminAppleScript, findAppFiles, classify, checkUninstallable, userCanMove, isRunning, adminMoveScript, SHARED_GROUPS, DOCUMENTS, CATEGORY_LABEL, expandHome };
