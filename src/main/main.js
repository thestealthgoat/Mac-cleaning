'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Worker } = require('worker_threads');

const disk = require('../core/disk');
const { scanHidden, needsFda, measureAll } = require('../core/hidden');
const { scanPlugins } = require('../core/plugins');
const { isWithin } = require('../core/paths');
const { listDir, sizeOf } = require('../core/size');
const { evaluate, grade } = require('../core/evaluate');
const { trashPaths, planCatalogClean } = require('../core/cleanup');
const { CATALOG } = require('../core/catalog');
const { checkTrashable, HOME } = require('../core/paths');
const { formatBytes } = require('../core/format');
const { buildMarkdownReport } = require('../core/report');
const { run } = require('../core/exec');
const { buildMenu, setupAboutPanel } = require('./menu');
const windowState = require('./window-state');

const isDev = process.argv.includes('--dev');
let win;
let lastHidden = null;
let lastProjects = null;
const jobs = new Map();
let jobSeq = 0;

// Commands Silt is allowed to hand to Terminal. Only catalog-defined commands
// (plus the snapshot thinning command) — never strings from the renderer.
const ALLOWED_COMMANDS = new Set([
  ...CATALOG.filter((e) => e.command).map((e) => e.command),
  'tmutil thinlocalsnapshots / 999999999999 4',
]);

app.setName('Silt');

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
    win.show();
    if (process.env.SILT_SNAP_DIR) require('./dev-snapshots')(win, app, process.env.SILT_SNAP_DIR);
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

app.whenReady().then(() => {
  setupAboutPanel();
  buildMenu({ send, isDev });
  if (!app.isPackaged && app.dock) app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png'));
  registerIpc();
  createWindow();
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

function registerIpc() {
  ipcMain.handle('system:overview', async () => {
    const [machine, capacity, apfs, snapshots] = await Promise.all([
      disk.machine(),
      disk.capacity(),
      disk.apfsVolumes(),
      disk.localSnapshots(),
    ]);
    const fullDiskAccess = disk.hasFullDiskAccess();
    const evaluation = evaluate({ capacity, apfs, snapshots, hidden: lastHidden, fullDiskAccess });
    return { machine, capacity, apfs, snapshots, fullDiskAccess, home: HOME, evaluation, grade: grade(evaluation.score), hidden: lastHidden };
  });

  ipcMain.handle('hidden:scan', async () => {
    const fullDiskAccess = disk.hasFullDiskAccess();
    lastHidden = await scanHidden({ fullDiskAccess, onProgress: (p) => send('hidden:progress', p) });
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
    return { vendors, scannedAt: Date.now() };
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
    return trashPaths(paths, { trashItem: (p) => shell.trashItem(p), sizeHint: map });
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
    const evaluation = evaluate({ capacity, apfs, snapshots, hidden: lastHidden, fullDiskAccess });
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

  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    dark: nativeTheme.shouldUseDarkColors,
    platform: process.platform,
    tmpdir: os.tmpdir(),
  }));
}
