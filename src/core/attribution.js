'use strict';

/**
 * System Data by app.
 *
 * macOS's Storage settings puts most of what apps keep outside their own bundle
 * (support files, caches, containers, sound libraries, plug-ins, logs) into one
 * opaque "System Data" bar. This module measures those Library locations and
 * works out who each folder belongs to:
 *
 *   app       an installed app (using the same matching as Smart Uninstall, so
 *             "MainStage: 158 GB" here is what uninstalling MainStage would find)
 *   shared    content several apps or plug-ins use (e.g. Apple's sound library)
 *   plugins   audio plug-in bundles
 *   apple     macOS and Apple's built-in apps
 *   tools     developer-tool caches and shared frameworks not tied to one app
 *   leftover  no installed app found — often left behind by apps you deleted
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isWithin } = require('./paths');
const { SYSTEM_NAMES } = require('./apps');
const { vendorKey } = require('./plugins');

const KIND_LABEL = {
  app: 'Installed apps',
  shared: 'Shared by several apps',
  plugins: 'Audio plug-ins',
  apple: 'macOS & Apple apps',
  tools: 'Developer tools & frameworks',
  leftover: 'No installed app found',
};

const APPLE_NAMES = /^(com\.apple\.|group\.com\.apple\.|apple)|^(addressbook|callhistorydb|callhistorytransactions|clouddocs|crashreporter|knowledge|mobilesync|icloud|fileprovider|differentialprivacy|appstore|accounts|animoji|calendars?|contacts|dock|facetime|siri|spotlight|ubiquity|syncservices|safari|mail|messages|homekit|photos|podcasts|books|biome|screentime|familycircle|coresimulator|keychains|metadata|cloudkit|assistant|assistants|identityservices|sharedfilelist|soundbanks|sounds|midi drivers|midi devices|impulse responses|apple loops index|diagnostics|diagnosticreports|systemmigration|com\.crashlytics|backgroundassets|staged|tmp|siritts|geoservices|sharedimagecache|familysettings|preferences|fonts|receipts|cookies|suggestions|personalizationportrait|homekit|sharing|trial|spelling|frameworks|keyboard layouts|input methods|services|scripts|colorpickers|compositions|printers|screen savers|speech|favorites|preferencepanes|internet plug-ins|autosave information|daemon containers|launchagents|launchdaemons|privilegedhelpertools|extensions|filesystems|staged extensions|systemextensions|coreanalytics|updates|security|kerberos plugins|managed preferences|modem scripts|opendirectory|perl|quicktime|resources|rules|webserver|documentation|image capture|graphics|video|automator|bundles|contextual menu items|folders|log|temp|apple loops|workflows|calendarservers|bluetooth|corestorage|dictionaries|messages|mail|accessibility|containermanager|frontboard|intelligenceplatform|liveactivities|daemondata|finance|groupcontainersalias|studentmanager|sync|caches|intents|passkit|wallet|weather|stocks|maps|news|translation|voicememos|freeform|journal|reminders|notes|shortcuts|findmy|screensaver|desktoppictures|coresimulator|xcode)$/i;

// Caches of command-line developer tools (installed with npm, Homebrew, pip…, not as apps).
const DEV_TOOLS = /^(python|r|julia|jupyter|androidstudio|android|pnpm|npm|yarn|node-gyp|ms-playwright|puppeteer|cypress|electron-builder|electron|homebrew|cocoapods|carthage|org\.swift\.swiftpm|swiftpm|nuitka|dotslash|ffmpeg[\w-]*|pip|pypoetry|poetry|uv|ruff|mypy|pre-commit|deno|bun|go-build|gopls|gradle|typescript|prisma|turbo|vercel|next|sentry-cli|rustup|cargo|jdk|maven|ccache|sccache|bazel|esbuild|vite|jest|huggingface|torch|whisper|ollama|lm-studio|node|nvm|fnm|volta|pyenv|conda|mamba|composer|bundler|gem|terraform|pulumi|docker|act|codex|gh|git|vscode-[\w-]+)$/i;

// Folder names that belong to a specific Apple developer app.
const ALIASES = { developer: 'com.apple.dt.Xcode', xcode: 'com.apple.dt.Xcode' };

// Folders measured as single units, outside the per-child roots below. Not "System Data"
// in Silt's sense: iCloud Drive and cloud-drive folders are your files (measured separately).
const NOT_SYSTEM_DATA = ['Mobile Documents', 'CloudStorage'];
// Fixed locations outside Library that macOS also counts as System Data.
const SYSTEM_EXTRAS = { '/opt/homebrew': 'tools', '/usr/local': 'tools', '/private/var/folders': 'apple' };

/**
 * Everything else directly inside ~/Library and /Library (fonts, preferences,
 * Python, pnpm, Developer…), plus Homebrew and per-user temporary files.
 * Each becomes a unit of its own. App containers need Full Disk Access.
 */
function extraUnits(home = os.homedir(), fullDiskAccess = true, rootList = roots(home, fullDiskAccess)) {
  const out = [];
  const L = path.join(home, 'Library');
  const skip = new Set([...rootList, ...NOT_SYSTEM_DATA.map((n) => path.join(L, n)), path.join(L, 'Containers'), path.join(L, 'Group Containers')]);
  for (const dir of [L, '/Library']) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      const p = path.join(dir, n);
      if (n.startsWith('.') || skip.has(p)) continue;
      out.push({ path: p });
    }
  }
  for (const [p, kind] of Object.entries(SYSTEM_EXTRAS)) if (fs.existsSync(p)) out.push({ path: p, kind });
  return out;
}

/** Library locations whose contents macOS reports as System Data. */
function roots(home = os.homedir(), fullDiskAccess = true) {
  const L = path.join(home, 'Library');
  return [
    path.join(L, 'Application Support'),
    path.join(L, 'Caches'),
    path.join(L, 'Logs'),
    path.join(L, 'HTTPStorages'),
    path.join(L, 'WebKit'),
    path.join(L, 'Saved Application State'),
    path.join(L, 'Application Scripts'),
    path.join(L, 'Developer'),
    path.join(L, 'Audio'),
    ...(fullDiskAccess ? [path.join(L, 'Containers'), path.join(L, 'Group Containers')] : []),
    '/Library/Application Support',
    '/Library/Caches',
    '/Library/Logs',
    '/Library/Audio',
    '/Users/Shared',
  ];
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** The installed app a Library folder name belongs to, or null. Conservative. */
function ownerApp(name, apps) {
  const lower = name.toLowerCase().replace(/^[0-9a-z]{10}\.(?=[a-z]+\.)/, ''); // team-id prefix on group containers
  const n = norm(lower.replace(/\.(savedstate|binarycookies|plist)$/, ''));
  if (ALIASES[n]) return apps.find((a) => a.id === ALIASES[n]) ?? null;
  for (const a of apps) {
    const id = a.id.toLowerCase();
    if (!id) continue;
    if (lower === id || lower.startsWith(id + '.') || lower === `group.${id}` || lower.startsWith(`group.${id}`)) return a;
  }
  if (n.length < 3) return null;
  for (const a of apps) if ([a.name, a.fileName].some((x) => x && norm(x) === n)) return a;
  if (n.length >= 5) {
    const hits = apps.filter((a) => [a.name, a.fileName].some((x) => x && norm(x).length >= 5 && (norm(x).startsWith(n) || n.startsWith(norm(x)))));
    if (hits.length === 1) return hits[0];
  }
  // Bundle-id style name from the same vendor and product ("com.vendor.product.helper").
  if (lower.includes('.')) {
    const [, vendor, product] = lower.split('.');
    if (vendor && product) {
      const hits = apps.filter((a) => {
        const [, av, ap] = a.id.toLowerCase().split('.');
        return av === vendor && ap && (ap === product || norm(ap) === norm(product));
      });
      if (hits.length === 1) return hits[0];
    }
  }
  return null;
}

/**
 * Attribute measured folders to owners. Pure, for tests.
 *   apps      installed apps [{ path, id, name, fileName }]
 *   appFiles  Map(app.path → findAppFiles() items)
 *   units     the folders to attribute: children of the roots [{ path, bytes }]
 *   claimSize Map(path → bytes) for claimed paths not among the units
 *   pluginDirs plug-in folders; anything containing or inside one is "plugins"
 *   pluginVendors vendor keys of installed plug-ins
 */
function attribute({ apps, appFiles, units, claimSize = new Map(), pluginDirs = [], pluginVendors = new Set(), minBytes = 1024 * 1024 }) {
  // 1. Claims from Smart Uninstall's matcher.
  const claims = new Map(); // path → { key, kind, name, appPath?, members:Set, category }
  const ownerKey = (app, item) => {
    if (item.category === 'shared') return { key: `shared:${item.group}`, kind: 'shared', name: item.group };
    if (item.category === 'vendor' && item.sharedWith?.length) return { key: `vendor:${path.basename(item.path)}`, kind: 'shared', name: `${path.basename(item.path)} (vendor files)` };
    return { key: `app:${app.path}`, kind: 'app', name: app.name, appPath: app.path };
  };
  for (const app of apps) {
    for (const item of appFiles.get(app.path) ?? []) {
      if (['app', 'documents', 'plugins'].includes(item.category)) continue;
      const o = ownerKey(app, item);
      const prev = claims.get(item.path);
      if (prev) {
        prev.members.add(app.name);
        if (prev.kind === 'app' && prev.appPath !== app.path) Object.assign(prev, { key: `multi:${item.path}`, kind: 'shared', name: path.basename(item.path), appPath: undefined });
        continue;
      }
      const others = (item.sharedWith ?? []).filter((m) => !/plug-in/.test(m));
      const usedByPlugins = (item.sharedWith ?? []).some((m) => /plug-in/.test(m));
      // "Shared" content that only this app uses right now is simply this app's.
      const solo = o.kind === 'shared' && !others.length && !usedByPlugins;
      const owner = solo ? { key: `app:${app.path}`, kind: 'app', name: app.name, appPath: app.path } : o;
      claims.set(item.path, { ...owner, members: new Set([app.name, ...others, ...(usedByPlugins ? ['plug-ins'] : [])]), category: item.category });
    }
  }

  const owners = new Map();
  const give = (o, p, bytes) => {
    if (!(bytes > 0)) return;
    if (!owners.has(o.key)) owners.set(o.key, { key: o.key, kind: o.kind, name: o.name, appPath: o.appPath, members: new Set(), bytes: 0, items: [] });
    const w = owners.get(o.key);
    w.bytes += bytes;
    w.items.push({ path: p, bytes });
    for (const m of o.members ?? []) w.members.add(m);
  };
  const isPluginish = (p) => pluginDirs.some((d) => isWithin(d, p) || isWithin(p, d) || d === p) || /\/Audio\/Plug-Ins$/.test(p);

  // 2. Units (children of the roots). Claimed descendants get their own share.
  const claimPaths = [...claims.keys()];
  const usedClaims = new Set();
  for (const u of units) {
    if (claims.has(u.path)) {
      give(claims.get(u.path), u.path, u.bytes);
      usedClaims.add(u.path);
      continue;
    }
    let rest = u.bytes;
    for (const c of claimPaths) {
      if (c !== u.path && isWithin(c, u.path) && !claimPaths.some((q) => q !== c && isWithin(c, q) && isWithin(q, u.path))) {
        const b = claimSize.get(c) ?? 0;
        give(claims.get(c), c, b);
        usedClaims.add(c);
        rest -= b;
      }
    }
    if (rest < minBytes) continue;
    const name = path.basename(u.path);
    const app = ownerApp(name, apps);
    if (u.kind === 'tools') give({ key: 'tools', kind: 'tools', name: 'Developer tools & frameworks' }, u.path, rest);
    else if (u.kind === 'apple') give({ key: 'apple', kind: 'apple', name: 'macOS & Apple apps' }, u.path, rest);
    else if (isPluginish(u.path)) give({ key: 'plugins', kind: 'plugins', name: 'Audio plug-ins' }, u.path, rest);
    else if (app) give({ key: `app:${app.path}`, kind: 'app', name: app.name, appPath: app.path, members: [app.name] }, u.path, rest);
    else if (APPLE_NAMES.test(name)) give({ key: 'apple', kind: 'apple', name: 'macOS & Apple apps' }, u.path, rest);
    else if (pluginVendors.has(vendorKey(name))) give({ key: `vendor:${name}`, kind: 'shared', name: `${name} (plug-in content)`, members: ['your plug-ins'] }, u.path, rest);
    else if (DEV_TOOLS.test(name) || SYSTEM_NAMES.some((re) => re.test(name))) give({ key: 'tools', kind: 'tools', name: 'Developer tools & frameworks' }, u.path, rest);
    else give({ key: 'leftover', kind: 'leftover', name: 'No installed app found' }, u.path, rest);
  }
  // 3. Claimed paths outside every root (preferences, background items, ~/Music libraries).
  for (const [p, o] of claims) {
    if (usedClaims.has(p) || units.some((u) => isWithin(p, u.path))) continue;
    give(o, p, claimSize.get(p) ?? 0);
  }

  const list = [...owners.values()]
    .map((o) => ({ ...o, members: [...o.members], items: o.items.sort((a, b) => b.bytes - a.bytes) }))
    .sort((a, b) => b.bytes - a.bytes);
  const byKind = {};
  for (const o of list) byKind[o.kind] = (byKind[o.kind] || 0) + o.bytes;
  const perApp = {};
  for (const app of apps) {
    const mine = (appFiles.get(app.path) ?? []).filter((i) => !['app', 'documents', 'plugins'].includes(i.category));
    const size = (p) => claimSize.get(p) ?? units.find((u) => u.path === p)?.bytes ?? 0;
    const exclusive = list.find((o) => o.key === `app:${app.path}`)?.bytes ?? 0;
    const shared = mine.filter((i) => claims.get(i.path)?.kind === 'shared').reduce((s, i) => s + size(i.path), 0);
    if (exclusive || shared) perApp[app.path] = { exclusive, shared, total: exclusive + shared };
  }
  return { owners: list, byKind, perApp, total: list.reduce((s, o) => s + o.bytes, 0) };
}

/**
 * Measure and attribute. `measure(paths, opts)` is measureAll from hidden.js;
 * `findAppFiles(app, opts)` comes from uninstall.js (injected to avoid a cycle).
 */
async function scanByApp({ apps, plugins = [], home = os.homedir(), fullDiskAccess = true, measure, findAppFiles, pluginDirs = [], onProgress }) {
  onProgress?.({ phase: 'matching' });
  const appFiles = new Map();
  for (const app of apps) {
    try {
      appFiles.set(app.path, findAppFiles(app, { home, installed: apps, plugins, fullDiskAccess }));
    } catch {
      appFiles.set(app.path, []);
    }
  }
  const rootList = roots(home, fullDiskAccess).filter((r) => fs.existsSync(r));
  const extras = extraUnits(home, fullDiskAccess, rootList);
  const claimed = [...new Set([...appFiles.values()].flat().filter((i) => !['app', 'documents', 'plugins'].includes(i.category)).map((i) => i.path))];
  onProgress?.({ phase: 'measuring', total: rootList.length });
  let done = 0;
  const sizes = await measure([...rootList, ...extras.map((e) => e.path), ...claimed], {
    depthFor: (p) => (rootList.includes(p) ? 1 : 0),
    excludeNames: fullDiskAccess ? null : ['Containers', 'Group Containers'],
    onDone: () => onProgress?.({ phase: 'measuring', done: ++done, total: rootList.length }),
  });
  const units = [];
  for (const [p, v] of sizes) if (rootList.includes(path.dirname(p)) && !rootList.includes(p)) units.push({ path: p, bytes: v.bytes });
  for (const e of extras) units.push({ ...e, bytes: sizes.get(e.path)?.bytes ?? 0 });
  const claimSize = new Map(claimed.map((p) => [p, sizes.get(p)?.bytes ?? 0]));
  const pluginVendors = new Set(plugins.flatMap((p) => [vendorKey(p.vendor || ''), vendorKey(p.idVendor || '')]).filter((k) => k.length >= 3));
  const result = attribute({ apps, appFiles, units, claimSize, pluginDirs, pluginVendors });
  return { ...result, roots: rootList, fullDiskAccess, scannedAt: Date.now() };
}

module.exports = { scanByApp, attribute, ownerApp, roots, extraUnits, KIND_LABEL, APPLE_NAMES, DEV_TOOLS, NOT_SYSTEM_DATA };
