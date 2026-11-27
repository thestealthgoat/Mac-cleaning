'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Worker } = require('worker_threads');

const disk = require('../core/disk');
const { scanHidden, needsFda, measureAll } = require('../core/hidden');
const { scanPlugins, identifyInstalledPlugins, pluginDirs } = require('../core/plugins');
const { installedApps: listInstalledApps } = require('../core/apps');
const uninstall = require('../core/uninstall');
const { isWithin } = require('../core/paths');
const { listDir, sizeOf } = require('../core/size');
const { evaluate, grade } = require('../core/evaluate');
const { trashPaths, planCatalogClean } = require('../core/cleanup');
const { CATALOG } = require('../core/catalog');
const { checkTrashable, HOME } = require('../core/paths');
const { formatBytes } = require('../core/format');
const { buildMarkdownReport } = require('../core/report');
const { run, pool } = require('../core/exec');
const { buildMenu, setupAboutPanel } = require('./menu');
const windowState = require('./window-state');
const Settings = require('./settings');
const { createUpdater } = require('./updater');
const History = require('../core/history');
const pluginFormats = require('../core/plugin-formats');
const attribution = require('../core/attribution');
const appsFolder = require('../core/apps-folder');
const { breakdown } = require('../core/breakdown');

const isDev = process.argv.includes('--dev');
let win;
let lastHidden = null;
let lastProjects = null;
let installedApps = null; // cached app list for the Uninstall view
let pluginInventory = null;
let lastPluginFormats = null;
let byAppJob = null; // in-flight "System Data by app" scan, shared by the views that ask
let lastByApp = null;
let lastBreakdown = null; // measured disk breakdown + Applications folder contents
let breakdownJob = null;
let lastInstallerCopies = null;
const plans = new Map(); // appPath → last uninstall plan shown to the user
const jobs = new Map();
let jobSeq = 0;

// Commands Silt is allowed to hand to Terminal. Only catalog-defined commands
// (plus the snapshot thinning command) — never strings from the renderer.
const ALLOWED_COMMANDS = new Set([
  ...CATALOG.filter((e) => e.command).map((e) => e.command),
  'tmutil thinlocalsnapshots / 999999999999 4',
]);

// Dev builds get their own name so they can run next to an installed Silt
// (separate single-instance lock and settings folder).
app.setName(app.isPackaged ? 'Silt' : 'Silt Dev');

function createWindow() {
  const bounds = windowState.load({ width: 1240, height: 800 });
  win = new BrowserWindow({
    ...bounds,
    minWidth: 980,
    minHeight: 640,
    title: 'Silt',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  windowState.track(win);
  win.once('ready-to-show', () => {
    if (process.env.SILT_SNAP_DIR) {
      // Screenshot runs stay in the background: no focus, no Dock icon, click-through.
      app.dock?.hide();
      win.setIgnoreMouseEvents(true);
      win.showInactive();
      require('./dev-snapshots')(win, app, process.env.SILT_SNAP_DIR);
      return;
    }
    win.show();
  });
  win.webContents.on('console-message', (e) => {
    if (isDev || process.env.SILT_SNAP_DIR) console.log(`[renderer:${e.level}] ${e.message}`);
  });
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  // Block navigation and new windows; open external links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// One window, one instance: a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

let settings;
let updater;
let historyFile;

/** Move items ({ path, bytes }) to the Trash, using the administrator prompt for root-owned ones. */
async function trashWithAdmin(items, prompt) {
  const adminItems = items.filter((i) => !uninstall.userCanMove(i.path));
  const results = [];
  for (const i of items.filter((x) => !adminItems.includes(x))) {
    try {
      await shell.trashItem(i.path);
      results.push({ path: i.path, ok: true, bytes: i.bytes });
    } catch {
      adminItems.push(i);
    }
  }
  if (adminItems.length) {
    const as = uninstall.adminAppleScript(adminItems.map((i) => i.path), { home: HOME, prompt });
    const res = await run('/usr/bin/osascript', ['-e', as], { timeout: 30 * 60 * 1000 });
    for (const i of adminItems) {
      const moved = res.code === 0 && !fs.existsSync(i.path);
      results.push({ path: i.path, ok: moved, bytes: moved ? i.bytes : 0, reason: moved ? null : res.stderr.includes('-128') ? 'Cancelled at the password prompt.' : res.stderr.trim() || 'Could not move' });
    }
  }
  return { results, moved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, bytes: results.reduce((s, r) => s + (r.ok ? r.bytes : 0), 0) };
}

/** Log what Silt freed, for "what grew since" and the lifetime total. Never fails a cleanup. */
function logCleanup(entry) {
  try {
    History.save(historyFile, History.recordCleanup(History.load(historyFile), entry));
  } catch {
    /* history is a convenience */
  }
}

app.whenReady().then(() => {
  settings = Settings.create(app.getPath('userData'));
  historyFile = path.join(app.getPath('userData'), 'history.json');
  updater = createUpdater({ settings, send, getWindow: () => win });
  setupAboutPanel();
  buildMenu({ send, isDev, onCheckUpdates: () => updater.check({ interactive: true }) });
  if (!app.isPackaged && app.dock) app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png'));
  registerIpc();
  createWindow();
  updater.schedule();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function confirm({ message, detail, okLabel = 'Move to Trash', destructive = false }) {
  const { response } = await dialog.showMessageBox(win, {
    type: destructive ? 'warning' : 'question',
    buttons: [okLabel, 'Cancel'],
    defaultId: destructive ? 1 : 0,
    cancelId: 1,
    message,
    detail,
  });
  return response === 0;
}

async function totalSize(paths) {
  const sized = await Promise.all(paths.map((p) => sizeOf(p)));
  return { total: sized.reduce((s, x) => s + x.bytes, 0), map: new Map(sized.map((x) => [x.path, x.bytes])) };
}

function startWorker(mode, opts) {
  const id = ++jobSeq;
  const worker = new Worker(path.join(__dirname, '..', 'core', 'walk-worker.js'), { workerData: { mode, ...opts } });
  const promise = new Promise((resolve) => {
    worker.on('message', (m) => {
      if (m.type === 'progress') send('job:progress', { id, mode, ...m });
      else {
        jobs.delete(id);
        resolve(m);
      }
    });
    worker.on('error', (err) => {
      jobs.delete(id);
      resolve({ type: 'error', message: err.message });
    });
    worker.on('exit', (code) => {
      if (jobs.has(id)) {
        jobs.delete(id);
        resolve({ type: 'done', cancelled: true, files: [], groups: [] });
      }
    });
  });
  jobs.set(id, worker);
  send('job:started', { id, mode });
  return promise;
}

// Without Full Disk Access, walking into these makes macOS block on a privacy prompt.
function protectedSkips() {
  if (disk.hasFullDiskAccess()) return [];
  return ['Containers', 'Group Containers', 'Mail', 'Messages', 'Safari', 'Application Support/MobileSync'].map((p) =>
    path.join(HOME, 'Library', p),
  );
}

function validRoots(roots) {
  return (roots || []).filter((r) => typeof r === 'string' && path.isAbsolute(r) && fs.existsSync(r));
}

/** System Data attributed to apps; one shared in-flight job, cached until something is removed. */
function getByApp(refresh = false) {
  if (lastByApp && !refresh) return Promise.resolve(lastByApp);
  if (!byAppJob) {
    byAppJob = (async () => {
      if (!installedApps || refresh) installedApps = await uninstall.listApps();
      if (!pluginInventory) pluginInventory = await identifyInstalledPlugins();
      const fullDiskAccess = disk.hasFullDiskAccess();
      const res = await attribution.scanByApp({
        apps: installedApps,
        plugins: pluginInventory,
        home: HOME,
        fullDiskAccess,
        measure: (paths, opts) => measureAll(paths, opts),
        findAppFiles: uninstall.findAppFiles,
        pluginDirs: pluginDirs(HOME),
        onProgress: (p) => send('job:progress', { mode: 'by-app', ...p, filesSeen: p.done ?? 0, bytesSeen: 0 }),
      });
      const iconDir = path.join(app.getPath('userData'), 'app-icons');
      const limit = pool(6);
      await Promise.all(
        res.owners.map((o) =>
          limit(async () => {
            const a = o.appPath && installedApps.find((x) => x.path === o.appPath);
            if (a) o.icon = await uninstall.appIcon(a, iconDir).catch(() => null);
            // Which items Silt may move to the Trash from here (leftovers only).
            o.items = o.items.slice(0, 60).map((i) => ({ ...i, removable: o.kind === 'leftover' && uninstall.checkUninstallable(i.path, HOME).ok }));
          }),
        ),
      );
      lastByApp = res;
      return res;
    })().finally(() => {
      byAppJob = null;
    });
  }
  return byAppJob;
}

function registerIpc() {
  ipcMain.handle('system:overview', async () => {
    const [machine, capacity, apfs, snapshots] = await Promise.all([
      disk.machine(),
      disk.capacity(),
      disk.apfsVolumes(),
      disk.localSnapshots(),
    ]);
    const fullDiskAccess = disk.hasFullDiskAccess();
    const evaluation = evaluate({ capacity, apfs, snapshots, hidden: lastHidden, fullDiskAccess, appsFolder: lastBreakdown });
    return { machine, capacity, apfs, snapshots, fullDiskAccess, home: HOME, evaluation, grade: grade(evaluation.score), hidden: lastHidden };
  });

  ipcMain.handle('hidden:scan', async () => {
    const fullDiskAccess = disk.hasFullDiskAccess();
    lastHidden = await scanHidden({ fullDiskAccess, onProgress: (p) => send('hidden:progress', p) });
    try {
      const capacity = await disk.capacity();
      const { state, view } = History.update(History.load(historyFile), lastHidden, capacity);
      History.save(historyFile, state);
      lastHidden.history = view;
    } catch {
      lastHidden.history = null;
    }
    return lastHidden;
  });

  ipcMain.handle('explore:list', async (_e, dir) => {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Invalid folder');
    if (!disk.hasFullDiskAccess() && needsFda(dir, HOME)) return { dir, children: [], error: 'permission' };
    return listDir(dir);
  });

  ipcMain.handle('explore:size', async (_e, p) => {
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('Invalid path');
    const fullDiskAccess = disk.hasFullDiskAccess();
    if (!fullDiskAccess && needsFda(p, HOME)) return { path: p, bytes: 0, exists: true, partial: true, needsAccess: true };
    return sizeOf(p, { fullDiskAccess });
  });

  ipcMain.handle('large:scan', async (_e, { roots, minBytes }) => {
    const r = validRoots(roots);
    return startWorker('large', {
      roots: r.length ? r : [HOME],
      minBytes: Math.max(1e6, Number(minBytes) || 100e6),
      limit: 500,
      skip: [path.join(HOME, '.Trash'), ...protectedSkips()],
    });
  });

  ipcMain.handle('dupes:scan', async (_e, { roots, minBytes }) => {
    const r = validRoots(roots);
    return startWorker('dupes', {
      roots: r.length ? r : [HOME],
      minBytes: Math.max(1024, Number(minBytes) || 1e6),
      // Skip cloud-backed and app-private folders: hashing could download files or touch app databases.
      skip: [
        path.join(HOME, 'Library'),
        path.join(HOME, '.Trash'),
        path.join(HOME, 'Library', 'Mobile Documents'),
        path.join(HOME, 'Library', 'CloudStorage'),
        ...protectedSkips(),
      ],
    });
  });

  ipcMain.handle('projects:scan', async () => {
    const found = await startWorker('projects', {
      roots: [HOME],
      skip: [path.join(HOME, '.Trash'), path.join(HOME, 'Library'), ...protectedSkips()],
    });
    if (found.type !== 'done' || found.cancelled) return found;
    send('job:progress', { mode: 'projects', phase: 'sizes', filesSeen: found.dirsSeen, bytesSeen: 0 });

    // Link Xcode DerivedData folders back to the project that produced them.
    const ddRoot = path.join(HOME, 'Library', 'Developer', 'Xcode', 'DerivedData');
    let ddNames = [];
    try {
      ddNames = fs.readdirSync(ddRoot);
    } catch {
      /* no Xcode */
    }
    for (const n of ddNames) {
      const res = await run('/usr/bin/plutil', ['-extract', 'WorkspacePath', 'raw', '-o', '-', path.join(ddRoot, n, 'info.plist')], { timeout: 5000 });
      const ws = res.code === 0 ? res.stdout.trim() : null;
      const project = ws && found.code.find((c) => isWithin(ws, c.path));
      if (project) project.artifacts.push({ name: 'DerivedData', path: path.join(ddRoot, n), label: 'Xcode DerivedData', kind: 'build', external: true });
    }

    const paths = [
      ...found.code.flatMap((c) => [c.path, ...c.artifacts.map((a) => a.path)]),
      ...found.sessions.flatMap((s) => [s.path, ...s.backups.map((b) => b.path)]),
    ];
    const sizes = await measureAll(paths, { excludeNames: disk.hasFullDiskAccess() ? null : ['Containers', 'Group Containers'] });
    const b = (p) => sizes.get(p)?.bytes ?? 0;
    const code = found.code
      .map((c) => {
        const artifacts = c.artifacts.map((a) => ({ ...a, bytes: b(a.path) })).filter((a) => a.bytes > 0).sort((x, y) => y.bytes - x.bytes);
        return { ...c, bytes: b(c.path), artifacts, artifactBytes: artifacts.reduce((s, a) => s + a.bytes, 0) };
      })
      .sort((x, y) => y.bytes - x.bytes);
    const media = [...found.sessions, ...found.docs]
      .map((s) => {
        const backups = s.backups.map((x) => ({ ...x, bytes: b(x.path) })).filter((x) => x.bytes > 0);
        return { ...s, bytes: s.bytes ?? b(s.path), backups, backupBytes: backups.reduce((t, x) => t + x.bytes, 0) };
      })
      .sort((x, y) => y.bytes - x.bytes);
    lastProjects = { code, media, scannedAt: Date.now(), ms: found.ms, dirsSeen: found.dirsSeen };
    return lastProjects;
  });

  ipcMain.handle('plugins:scan', async () => {
    const vendors = await scanPlugins({ measure: (p) => measureAll(p), onProgress: (p) => send('job:progress', { mode: 'plugins', ...p, filesSeen: p.done ?? 0, bytesSeen: 0 }) });
    const formats = pluginFormats.analyze(vendors, await listInstalledApps());
    lastPluginFormats = formats;
    return { vendors, formats, scannedAt: Date.now() };
  });

  // Move plug-in bundles of formats no installed app loads to the Trash.
  ipcMain.handle('plugins:remove-formats', async (_e, { format, paths } = {}) => {
    const group = lastPluginFormats?.unused.find((g) => g.format === format);
    if (!group || !Array.isArray(paths)) throw new Error('Scan plug-ins first');
    const dirs = pluginDirs(HOME);
    // Only bundles Silt itself listed for this format, re-checked here.
    const chosen = group.items.filter((i) => paths.includes(i.path) && pluginFormats.isRemovablePluginBundle(i.path, format, dirs) && fs.existsSync(i.path));
    if (!chosen.length) return { moved: 0, failed: 0, bytes: 0, results: [] };
    const total = chosen.reduce((s, i) => s + i.bytes, 0);
    const adminItems = chosen.filter((i) => !uninstall.userCanMove(i.path));
    const hosts = lastPluginFormats.hosts.join(', ');
    const ok = await confirm({
      message: `Move ${chosen.length} ${format} plug-in${chosen.length === 1 ? '' : 's'} to the Trash? About ${formatBytes(total)}.`,
      detail: [
        `None of the apps Silt found (${hosts}) load ${format} plug-ins. If you use another plug-in host Silt doesn’t know about, cancel.`,
        'Everything goes to the Trash, so you can put it back until you empty the Trash. Your other formats of the same plug-ins are kept.',
        adminItems.length ? `${adminItems.length} item${adminItems.length === 1 ? '' : 's'} need your administrator password; macOS will ask for it.` : null,
      ].filter(Boolean).join('\n\n'),
    });
    if (!ok) return { cancelled: true };
    const res = await trashWithAdmin(chosen, `Silt needs your password to move unused ${format} plug-ins to the Trash.`);
    logCleanup({ source: 'plugins', name: `${format} plug-ins`, bytes: res.bytes, count: res.moved });
    pluginInventory = null;
    lastByApp = null;
    lastBreakdown = null;
    return res;
  });

  // System Data attributed to the apps (and leftovers) it belongs to.
  ipcMain.handle('data:by-app', async (_e, { refresh } = {}) => getByApp(refresh));

  // Measured disk breakdown: Applications folder, System Data, your files, the rest.
  ipcMain.handle('disk:breakdown', async (_e, { refresh } = {}) => {
    if (lastBreakdown && !refresh) return lastBreakdown;
    if (!breakdownJob) {
      breakdownJob = (async () => {
        const [byApp, capacity, apfs] = await Promise.all([getByApp(refresh), disk.capacity(), disk.apfsVolumes()]);
        // Applications folder, including apps nested in vendor folders.
        const tops = fs.readdirSync('/Applications', { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.endsWith('.app') && !e.name.startsWith('.'));
        const nested = tops.flatMap((e) => appsFolder.appsInside(path.join('/Applications', e.name)));
        const appSizes = await measureAll(['/Applications', ...nested], { depthFor: (p) => (p === '/Applications' ? 1 : 0) });
        const apps = appsFolder.listAppsFolder(appSizes);
        for (const item of apps.items.filter((i) => i.kind === 'content' && i.bytes > 1e9)) {
          const v = appsFolder.versionedFolders(item.path);
          if (!v) continue;
          const older = v.older.flatMap((o) => o.paths);
          const sz = await measureAll(older);
          item.versions = { latest: v.latest, older: v.older.map((o) => ({ version: o.version, paths: o.paths, bytes: o.paths.reduce((s, p) => s + (sz.get(p)?.bytes ?? 0), 0) })) };
        }
        // Your home folder outside Library.
        const fullDiskAccess = disk.hasFullDiskAccess();
        const homeKids = fs.readdirSync(HOME).filter((n) => n !== 'Library').map((n) => path.join(HOME, n));
        const homeSizes = await measureAll(homeKids, { excludeNames: fullDiskAccess ? null : ['Containers', 'Group Containers'] });
        const homeItems = homeKids.map((p) => ({ path: p, name: path.basename(p), bytes: homeSizes.get(p)?.bytes ?? 0 })).filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes);
        const homeFiles = homeItems.reduce((s, i) => s + i.bytes, 0);
        const libraryDir = path.join(HOME, 'Library');
        const homeClaims = byApp.owners.flatMap((o) => o.allItems ?? o.items).filter((i) => isWithin(i.path, HOME) && !isWithin(i.path, libraryDir)).reduce((s, i) => s + i.bytes, 0);
        // Local copies of iCloud Drive and cloud-drive files (Dropbox, Google Drive, OneDrive…).
        const cloudPaths = ['Mobile Documents', 'CloudStorage'].map((n) => path.join(libraryDir, n)).filter((p) => fs.existsSync(p));
        const cloudSizes = await measureAll(cloudPaths);
        const cloud = cloudPaths.reduce((s, p) => s + (cloudSizes.get(p)?.bytes ?? 0), 0);
        const parts = breakdown({ capacity, apfs, applications: apps.total, systemData: byApp.total, homeFiles, homeClaims, cloud });
        lastBreakdown = { ...parts, applications: apps, home: homeItems.slice(0, 12), measuredAt: Date.now(), fullDiskAccess, installerCopies: lastInstallerCopies };
        return lastBreakdown;
      })().finally(() => {
        breakdownJob = null;
      });
    }
    return breakdownJob;
  });

  // Folders that duplicate a library you already installed (e.g. a sample library's installer data).
  ipcMain.handle('apps:installer-copies', async () => {
    const b = lastBreakdown;
    const candidates = [
      ...(b?.applications.items.filter((i) => i.kind === 'content' && i.bytes > 1e9).map((i) => i.path) ?? []),
      ...['Downloads', 'Desktop', 'Documents'].flatMap((d) => {
        try {
          return fs.readdirSync(path.join(HOME, d), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(HOME, d, e.name));
        } catch {
          return [];
        }
      }),
    ];
    const roots = ['/Applications', '/Library/Application Support', '/Users/Shared', path.join(HOME, 'Library', 'Application Support'), ...['Downloads', 'Desktop', 'Documents', 'Music'].map((d) => path.join(HOME, d))].filter((r) => fs.existsSync(r));
    const res = await startWorker('large', {
      roots,
      minBytes: 50e6,
      limit: 100000,
      skip: protectedSkips(),
      skipNames: ['node_modules', '.git', 'scratch-workspaces', 'DerivedData', '.Trash', 'Caches'],
    });
    if (res.type !== 'done' || res.cancelled) return { cancelled: true };
    lastInstallerCopies = appsFolder.installerCopies(res.files, candidates);
    if (lastBreakdown) lastBreakdown.installerCopies = lastInstallerCopies;
    return lastInstallerCopies;
  });


  // Move folders Silt couldn't match to an installed app to the Trash.
  ipcMain.handle('data:trash-leftovers', async (_e, paths) => {
    const leftover = lastByApp?.owners.find((o) => o.key === 'leftover');
    if (!leftover || !Array.isArray(paths)) throw new Error('Scan System Data by app first');
    const chosen = leftover.items.filter((i) => paths.includes(i.path) && i.removable && uninstall.checkUninstallable(i.path, HOME).ok);
    if (!chosen.length) return { moved: 0, failed: 0, bytes: 0, results: [] };
    const total = chosen.reduce((s, i) => s + i.bytes, 0);
    const names = chosen.slice(0, 8).map((i) => '• ' + i.path.replace(HOME, '~')).join('\n');
    const ok = await confirm({
      message: chosen.length === 1 ? `Move “${path.basename(chosen[0].path)}” to the Trash? ${formatBytes(total)}.` : `Move ${chosen.length} folders to the Trash? ${formatBytes(total)}.`,
      detail: `Silt couldn’t match ${chosen.length === 1 ? 'this folder' : 'these folders'} to an installed app. Command-line tools and apps kept outside Applications can look like this too, so check the names.\n\n${names}${chosen.length > 8 ? `\n…and ${chosen.length - 8} more` : ''}\n\nEverything goes to the Trash, so you can put it back until you empty the Trash.`,
    });
    if (!ok) return { cancelled: true };
    const res = await trashWithAdmin(chosen, 'Silt needs your password to move leftover system files to the Trash.');
    logCleanup({ source: 'leftovers', name: 'Leftovers', bytes: res.bytes, count: res.moved });
    lastByApp = null;
    lastBreakdown = null;
    return res;
  });

  ipcMain.handle('apps:list', async (_e, { refresh } = {}) => {
    if (!installedApps || refresh) installedApps = await uninstall.listApps();
    const sizes = await measureAll(installedApps.map((a) => a.path));
    const iconDir = path.join(app.getPath('userData'), 'app-icons');
    const limit = pool(6);
    return Promise.all(installedApps.map((a) => limit(async () => ({ ...a, bytes: sizes.get(a.path)?.bytes ?? 0, icon: await uninstall.appIcon(a, iconDir).catch(() => null) }))));
  });

  ipcMain.handle('uninstall:plan', async (_e, appPath) => {
    if (!installedApps) installedApps = await uninstall.listApps();
    const target = installedApps.find((a) => a.path === appPath);
    if (!target) throw new Error('Unknown app');
    if (!pluginInventory) pluginInventory = await identifyInstalledPlugins();
    const fullDiskAccess = disk.hasFullDiskAccess();
    const items = uninstall.classify(uninstall.findAppFiles(target, { home: HOME, installed: installedApps, plugins: pluginInventory, fullDiskAccess }));
    const sizes = await measureAll(items.map((i) => i.path), { excludeNames: fullDiskAccess ? null : ['Containers', 'Group Containers'] });
    const planned = items.map((i) => {
      const allowed = uninstall.checkUninstallable(i.path, HOME);
      return { ...i, bytes: sizes.get(i.path)?.bytes ?? 0, admin: !uninstall.userCanMove(i.path), removable: allowed.ok, blockedReason: allowed.ok ? null : allowed.reason };
    });
    const plan = { app: target, items: planned, running: await uninstall.isRunning(target), fullDiskAccess };
    plans.set(appPath, plan);
    return plan;
  });

  ipcMain.handle('uninstall:run', async (_e, { appPath, paths }) => {
    const plan = plans.get(appPath);
    if (!plan) throw new Error('Plan the uninstall first');
    // Only items Silt itself proposed for this app can be removed.
    const chosen = plan.items.filter((i) => paths.includes(i.path) && i.removable && uninstall.checkUninstallable(i.path, HOME).ok);
    if (!chosen.length) return { moved: 0, failed: 0, bytes: 0, results: [] };
    if (await uninstall.isRunning(plan.app)) return { error: `Quit ${plan.app.name} first, then try again.` };
    const total = chosen.reduce((s, i) => s + i.bytes, 0);
    const kept = plan.items.filter((i) => !chosen.includes(i) && i.bytes > 0);
    const keptShared = kept.filter((i) => i.shared.length);
    const keptDocs = kept.filter((i) => i.category === 'documents');
    const adminItems = chosen.filter((i) => i.admin);
    const lines = [`Frees about ${formatBytes(total)}. Everything goes to the Trash, so you can restore it until you empty the Trash.`];
    if (keptShared.length) lines.push(`Kept because other software uses it: ${keptShared.map((i) => path.basename(i.path)).slice(0, 4).join(', ')}${keptShared.length > 4 ? '…' : ''}.`);
    if (keptDocs.length) lines.push(`Your documents are kept: ${keptDocs.map((i) => i.path.replace(HOME, '~')).join(', ')}.`);
    if (adminItems.length) lines.push(`${adminItems.length} system-level item${adminItems.length === 1 ? '' : 's'} need your administrator password; macOS will ask for it.`);
    const ok = await confirm({
      message: `Uninstall ${plan.app.name}? ${chosen.length} item${chosen.length === 1 ? '' : 's'}, ${formatBytes(total)}.`,
      detail: lines.join('\n\n'),
      okLabel: 'Uninstall',
      destructive: true,
    });
    if (!ok) return { cancelled: true };

    const results = [];
    for (const i of chosen.filter((x) => !x.admin)) {
      try {
        await shell.trashItem(i.path);
        results.push({ path: i.path, ok: true, bytes: i.bytes });
      } catch (err) {
        // Permission surprises fall back to the administrator path.
        adminItems.push(i);
      }
    }
    if (adminItems.length) {
      const as = uninstall.adminAppleScript(adminItems.map((i) => i.path), { home: HOME, prompt: `Silt needs your password to move ${plan.app.name}’s system files to the Trash.` });
      const res = await run('/usr/bin/osascript', ['-e', as], { timeout: 30 * 60 * 1000 });
      for (const i of adminItems) {
        const moved = res.code === 0 && !fs.existsSync(i.path);
        results.push({ path: i.path, ok: moved, bytes: moved ? i.bytes : 0, reason: moved ? null : res.stderr.includes('-128') ? 'Cancelled at the password prompt.' : res.stderr.trim() || 'Could not move' });
      }
    }
    plans.delete(appPath);
    lastByApp = null;
    lastBreakdown = null;
    logCleanup({ source: 'uninstall', name: plan.app.name, bytes: results.reduce((s, r) => s + (r.ok ? r.bytes : 0), 0), count: results.filter((r) => r.ok).length });
    if (results.some((r) => r.ok && r.path === plan.app.path)) installedApps = installedApps.filter((a) => a.path !== plan.app.path);
    return { results, moved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, bytes: results.reduce((s, r) => s + (r.ok ? r.bytes : 0), 0) };
  });

  ipcMain.handle('job:cancel', async () => {
    for (const [id, w] of jobs) {
      w.terminate();
      jobs.delete(id);
    }
    return true;
  });

  ipcMain.handle('clean:preview', async (_e, itemId) => {
    const { entry, targets } = planCatalogClean(itemId, { fullDiskAccess: disk.hasFullDiskAccess() });
    const { total } = await totalSize(targets);
    return { id: entry.id, name: entry.name, count: targets.length, bytes: total, sample: targets.slice(0, 12) };
  });

  ipcMain.handle('clean:catalog', async (_e, itemId) => {
    const { entry, targets } = planCatalogClean(itemId, { fullDiskAccess: disk.hasFullDiskAccess() });
    if (!targets.length) return { moved: 0, failed: 0, bytes: 0, results: [] };
    const { total, map } = await totalSize(targets);
    const ok = await confirm({
      message: `Move ${targets.length} item${targets.length === 1 ? '' : 's'} from “${entry.name}” to the Trash?`,
      detail: `About ${formatBytes(total)}. Nothing is deleted permanently — you can restore from the Trash until you empty it.${
        entry.group === 'caches' ? '\n\nTip: quit open apps first so they do not recreate their caches immediately.' : ''
      }`,
    });
    if (!ok) return { cancelled: true };
    const res = await trashPaths(targets, { trashItem: (p) => shell.trashItem(p), sizeHint: map });
    logCleanup({ source: 'catalog', id: entry.id, name: entry.name, bytes: res.bytes, count: res.moved });
    return res;
  });

  ipcMain.handle('clean:paths', async (_e, paths) => {
    if (!Array.isArray(paths) || !paths.length) return { moved: 0, failed: 0, bytes: 0, results: [] };
    const allowed = paths.filter((p) => checkTrashable(p).ok);
    const blocked = paths.length - allowed.length;
    if (!allowed.length) return trashPaths(paths, { trashItem: () => Promise.reject(new Error('blocked')) });
    const { total, map } = await totalSize(allowed);
    const names = allowed.slice(0, 8).map((p) => '• ' + p.replace(HOME, '~')).join('\n');
    const ok = await confirm({
      message: `Move ${allowed.length} item${allowed.length === 1 ? '' : 's'} to the Trash?`,
      detail: `${formatBytes(total)} total.\n\n${names}${allowed.length > 8 ? `\n…and ${allowed.length - 8} more` : ''}${
        blocked ? `\n\n${blocked} protected item${blocked === 1 ? ' was' : 's were'} skipped.` : ''
      }`,
    });
    if (!ok) return { cancelled: true };
    const res = await trashPaths(paths, { trashItem: (p) => shell.trashItem(p), sizeHint: map });
    logCleanup({ source: 'files', bytes: res.bytes, count: res.moved });
    if (res.moved) {
      lastBreakdown = null;
      lastByApp = null;
      if (lastInstallerCopies) lastInstallerCopies = lastInstallerCopies.filter((c) => fs.existsSync(c.path));
    }
    return res;
  });

  ipcMain.handle('trash:empty', async () => {
    const trash = await sizeOf(path.join(HOME, '.Trash'));
    const ok = await confirm({
      message: 'Empty the Trash?',
      detail: `This permanently deletes ${trash.bytes ? formatBytes(trash.bytes) : 'everything'} in your Trash. This cannot be undone.`,
      okLabel: 'Empty Trash',
      destructive: true,
    });
    if (!ok) return { cancelled: true };
    const res = await run('/usr/bin/osascript', ['-e', 'tell application "Finder" to empty trash'], { timeout: 10 * 60 * 1000 });
    return { ok: res.code === 0, bytes: trash.bytes, error: res.code === 0 ? null : res.stderr.trim() };
  });

  ipcMain.handle('command:run', async (_e, command) => {
    if (!ALLOWED_COMMANDS.has(command)) throw new Error('Command not allowed');
    const ok = await confirm({
      message: 'Open Terminal and run this command?',
      detail: `${command}\n\nYou will see the command and its output in Terminal.`,
      okLabel: 'Open in Terminal',
    });
    if (!ok) return { cancelled: true };
    const script = `tell application "Terminal"\n activate\n do script ${JSON.stringify(command)}\nend tell`;
    const res = await run('/usr/bin/osascript', ['-e', script]);
    return { ok: res.code === 0, error: res.stderr.trim() || null };
  });

  ipcMain.handle('command:copy', async (_e, command) => {
    if (!ALLOWED_COMMANDS.has(command)) throw new Error('Command not allowed');
    clipboard.writeText(command);
    return true;
  });

  ipcMain.handle('shell:reveal', async (_e, p) => {
    if (typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p)) shell.showItemInFolder(p);
  });

  ipcMain.handle('fda:status', async () => disk.hasFullDiskAccess());
  ipcMain.handle('app:relaunch', async () => {
    app.relaunch();
    app.exit(0);
  });
  // The Silt.app bundle (packaged) so it can be dragged into the Full Disk Access list.
  ipcMain.handle('shell:reveal-app', async () => {
    const bundle = app.isPackaged ? path.resolve(process.execPath, '..', '..', '..') : process.execPath;
    shell.showItemInFolder(bundle);
  });
  ipcMain.handle('shell:open-fda-settings', async () => {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
  });

  ipcMain.handle('shell:open-storage-settings', async () => {
    await shell.openExternal('x-apple.systempreferences:com.apple.settings.Storage');
  });

  ipcMain.handle('shell:open-url', async (_e, url) => {
    if (typeof url === 'string' && /^https:\/\/github\.com\//.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle('dialog:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'], defaultPath: HOME });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('report:export', async () => {
    const [capacity, apfs, snapshots] = await Promise.all([disk.capacity(), disk.apfsVolumes(), disk.localSnapshots()]);
    const machine = await disk.machine();
    const fullDiskAccess = disk.hasFullDiskAccess();
    const evaluation = evaluate({ capacity, apfs, snapshots, hidden: lastHidden, fullDiskAccess, appsFolder: lastBreakdown });
    const md = buildMarkdownReport({ machine, capacity, apfs, snapshots, hidden: lastHidden, evaluation, home: HOME });
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(HOME, 'Desktop', `Silt storage report ${new Date().toISOString().slice(0, 10)}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { cancelled: true };
    fs.writeFileSync(filePath, md);
    shell.showItemInFolder(filePath);
    return { ok: true, filePath };
  });

  ipcMain.handle('update:status', async () => updater.status());
  ipcMain.handle('update:check', async () => updater.check({ interactive: false }));
  ipcMain.handle('update:install', async () => updater.promptRestart());
  ipcMain.handle('history:clear', async () => {
    const ok = await confirm({ message: 'Clear Silt’s storage history?', detail: 'Silt forgets past scan sizes and the record of what it cleaned. Nothing on your disk changes.', okLabel: 'Clear History' });
    if (!ok) return { cancelled: true };
    History.save(historyFile, History.empty());
    if (lastHidden) lastHidden.history = null;
    return { ok: true };
  });
  ipcMain.handle('settings:get', async () => settings.all());
  ipcMain.handle('settings:set', async (_e, key, value) => {
    const all = settings.set(key, value);
    if (key === 'autoUpdate') updater.schedule();
    return all;
  });

  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    dark: nativeTheme.shouldUseDarkColors,
    platform: process.platform,
    packaged: app.isPackaged,
    fdaPromptInDev: !!process.env.SILT_FDA_PROMPT,
    tmpdir: os.tmpdir(),
  }));
}
