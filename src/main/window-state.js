'use strict';

// Remembers the window's size and position between launches.
const { app, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'window-state.json');

function load(defaults) {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const visible = screen.getAllDisplays().some(({ workArea: a }) => s.x >= a.x - 50 && s.y >= a.y - 50 && s.x + 200 <= a.x + a.width && s.y + 100 <= a.y + a.height);
    if (visible && s.width >= 600 && s.height >= 400) return { x: s.x, y: s.y, width: s.width, height: s.height };
  } catch {
    /* first launch or unreadable — use defaults */
  }
  return defaults;
}

function track(win) {
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      try {
        fs.mkdirSync(path.dirname(file()), { recursive: true });
        fs.writeFileSync(file(), JSON.stringify(win.getBounds()));
      } catch {
        /* non-fatal */
      }
    }, 400);
  };
  win.on('resize', save);
  win.on('move', save);
}

module.exports = { load, track };
