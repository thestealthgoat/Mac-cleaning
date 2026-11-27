'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

function on(channel, fn) {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('silt', {
  overview: invoke('system:overview'),
  scanHidden: invoke('hidden:scan'),
  listDir: invoke('explore:list'),
  sizeOf: invoke('explore:size'),
  scanLarge: invoke('large:scan'),
  scanDupes: invoke('dupes:scan'),
  scanProjects: invoke('projects:scan'),
  scanPlugins: invoke('plugins:scan'),
  listApps: invoke('apps:list'),
  planUninstall: invoke('uninstall:plan'),
  runUninstall: invoke('uninstall:run'),
  cancelJobs: invoke('job:cancel'),
  previewClean: invoke('clean:preview'),
  cleanItem: invoke('clean:catalog'),
  trashPaths: invoke('clean:paths'),
  emptyTrash: invoke('trash:empty'),
  runCommand: invoke('command:run'),
  copyCommand: invoke('command:copy'),
  reveal: invoke('shell:reveal'),
  openFdaSettings: invoke('shell:open-fda-settings'),
  fdaStatus: invoke('fda:status'),
  relaunch: invoke('app:relaunch'),
  revealApp: invoke('shell:reveal-app'),
  openStorageSettings: invoke('shell:open-storage-settings'),
  openUrl: invoke('shell:open-url'),
  pickFolders: invoke('dialog:pick-folder'),
  exportReport: invoke('report:export'),
  info: invoke('app:info'),
  clearHistory: invoke('history:clear'),
  removePluginFormats: invoke('plugins:remove-formats'),
  dataByApp: invoke('data:by-app'),
  diskBreakdown: invoke('disk:breakdown'),
  installerCopies: invoke('apps:installer-copies'),
  trashLeftovers: invoke('data:trash-leftovers'),
  onHiddenProgress: (fn) => on('hidden:progress', fn),
  onJobProgress: (fn) => on('job:progress', fn),
  onMenu: (fn) => on('menu', fn),
  onUpdate: (fn) => on('update:status', fn),
  updateStatus: invoke('update:status'),
  checkForUpdates: invoke('update:check'),
  installUpdate: invoke('update:install'),
  getSettings: invoke('settings:get'),
  setSetting: invoke('settings:set'),
});
