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
  cancelJobs: invoke('job:cancel'),
  previewClean: invoke('clean:preview'),
  cleanItem: invoke('clean:catalog'),
  trashPaths: invoke('clean:paths'),
  emptyTrash: invoke('trash:empty'),
  runCommand: invoke('command:run'),
  copyCommand: invoke('command:copy'),
  reveal: invoke('shell:reveal'),
  openFdaSettings: invoke('shell:open-fda-settings'),
  openStorageSettings: invoke('shell:open-storage-settings'),
  openUrl: invoke('shell:open-url'),
  pickFolders: invoke('dialog:pick-folder'),
  exportReport: invoke('report:export'),
  info: invoke('app:info'),
  onHiddenProgress: (fn) => on('hidden:progress', fn),
  onJobProgress: (fn) => on('job:progress', fn),
});
