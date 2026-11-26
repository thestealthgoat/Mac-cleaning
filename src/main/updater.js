'use strict';

/**
 * Auto-update from this project's GitHub Releases (electron-updater).
 * Only runs in the packaged, signed app. Updates download in the background
 * and install when the user restarts — never mid-cleanup.
 */
const { app, dialog } = require('electron');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15 * 1000;

function createUpdater({ settings, send, getWindow }) {
  const state = { status: app.isPackaged ? 'idle' : 'dev', version: null, progress: null, error: null, checkedAt: null };
  let autoUpdater = null;
  let timer = null;
  let manual = false;

  const emit = (patch) => {
    Object.assign(state, patch);
    send('update:status', { ...state });
  };

  function load() {
    if (autoUpdater || !app.isPackaged) return autoUpdater;
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => emit({ status: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => {
      emit({ status: 'current', checkedAt: Date.now() });
      if (manual) {
        manual = false;
        dialog.showMessageBox(getWindow(), { type: 'info', message: 'Silt is up to date', detail: `You have the latest version (${app.getVersion()}).` });
      }
    });
    autoUpdater.on('update-available', (info) => {
      emit({ status: 'downloading', version: info.version, progress: 0, checkedAt: Date.now() });
      if (manual) {
        manual = false;
        dialog.showMessageBox(getWindow(), { type: 'info', message: `Silt ${info.version} is available`, detail: 'It is downloading in the background. You will be asked to restart when it is ready.' });
      }
    });
    autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', progress: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => emit({ status: 'ready', version: info.version, progress: 100 }));
    autoUpdater.on('error', (err) => {
      emit({ status: 'error', error: friendly(err) });
      if (manual) {
        manual = false;
        dialog.showMessageBox(getWindow(), { type: 'warning', message: 'Couldn’t check for updates', detail: friendly(err) });
      }
    });
    return autoUpdater;
  }

  function friendly(err) {
    const msg = String(err?.message || err);
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR/.test(msg)) return 'No internet connection.';
    if (/translocat|read-only volume/i.test(msg)) return 'Move Silt to your Applications folder to enable updates.';
    if (/code signature|not signed/i.test(msg)) return 'This copy of Silt is not signed, so it can’t update itself. Download the latest version from GitHub.';
    return msg.split('\n')[0].slice(0, 200);
  }

  async function check({ interactive = false } = {}) {
    if (!app.isPackaged) {
      if (interactive) dialog.showMessageBox(getWindow(), { type: 'info', message: 'Updates are disabled in development builds.' });
      return { ...state };
    }
    if (state.status === 'ready') {
      if (interactive) promptRestart();
      return { ...state };
    }
    manual = interactive;
    try {
      await load().checkForUpdates();
    } catch (err) {
      emit({ status: 'error', error: friendly(err) });
    }
    return { ...state };
  }

  async function promptRestart() {
    const { response } = await dialog.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Silt ${state.version} is ready to install`,
      detail: 'Silt will quit, update and reopen. If you choose Later, the update installs the next time you quit Silt.',
    });
    if (response === 0) install();
  }

  function install() {
    if (state.status !== 'ready' || !autoUpdater) return;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  }

  function schedule() {
    clearInterval(timer);
    timer = null;
    if (!app.isPackaged || !settings.get('autoUpdate')) return;
    setTimeout(() => settings.get('autoUpdate') && check(), FIRST_CHECK_DELAY_MS);
    timer = setInterval(() => settings.get('autoUpdate') && check(), CHECK_EVERY_MS);
  }

  return { check, install, promptRestart, schedule, status: () => ({ ...state, autoUpdate: settings.get('autoUpdate'), version: state.version, current: app.getVersion() }) };
}

module.exports = { createUpdater };
