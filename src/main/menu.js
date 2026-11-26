'use strict';

const { app, Menu, shell } = require('electron');
const path = require('path');

const REPO = 'https://github.com/thestealthgoat/Mac-cleaning';

const VIEWS = [
  ['overview', 'Overview'],
  ['hidden', 'System Data'],
  ['projects', 'Projects'],
  ['explorer', 'Explorer'],
  ['large', 'Large Files'],
  ['dupes', 'Duplicates'],
];

function setupAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: 'Silt',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Copyright © 2026 Silt contributors',
    credits: 'Storage, explained.\nFree and open source under the MIT License.',
    website: REPO,
    iconPath: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
  });
}

/** Native macOS menu bar. `send(channel, payload)` forwards actions to the renderer. */
function buildMenu({ send, isDev }) {
  const template = [
    {
      label: 'Silt',
      submenu: [
        { role: 'about', label: 'About Silt' },
        { type: 'separator' },
        { label: 'Releases…', click: () => shell.openExternal(`${REPO}/releases`) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Silt' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Silt' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Rescan', accelerator: 'CmdOrCtrl+R', click: () => send('menu', { action: 'rescan' }) },
        { label: 'Export Report…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', { action: 'export' }) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...VIEWS.map(([route, label], i) => ({ label, accelerator: `CmdOrCtrl+${i + 1}`, click: () => send('menu', { action: 'go', route }) })),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Silt on GitHub', click: () => shell.openExternal(REPO) },
        { label: 'Report an Issue…', click: () => shell.openExternal(`${REPO}/issues/new`) },
        { type: 'separator' },
        { label: 'Open Full Disk Access Settings', click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu, setupAboutPanel, REPO };
