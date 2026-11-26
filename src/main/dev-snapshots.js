'use strict';

// Development helper: `SILT_SNAP_DIR=/some/dir npm start` captures every
// screen to PNG and quits. Used for README screenshots and visual checks.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(win, expr, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await win.webContents.executeJavaScript(expr).catch(() => false)) return true;
    await wait(500);
  }
  return false;
}

module.exports = async function snapAll(win, app, dir) {
  if (process.env.SILT_THEME) require('electron').nativeTheme.themeSource = process.env.SILT_THEME;
  fs.mkdirSync(dir, { recursive: true });
  await waitFor(win, `!!document.querySelector('.ring')`, 30000);
  // Wait for the System Data scan to finish (the Rescan button re-enables).
  await waitFor(win, `[...document.querySelectorAll('.view-head .btn')].some(b => b.textContent.includes('Rescan') && !b.disabled)`, 180000);
  await wait(800);
  const routes = ['overview', 'hidden', 'projects', 'explorer', 'large', 'dupes', 'about'];
  for (let i = 0; i < routes.length; i++) {
    await win.webContents.executeJavaScript(`document.querySelectorAll('.nav-item')[${i}].click()`);
    if (routes[i] === 'explorer') await waitFor(win, `!!document.querySelector('.tile')`, 120000);
    if (routes[i] === 'projects') {
      await waitFor(win, `!!document.querySelector('.project-row')`, 240000);
      for (const [n, tab] of [[1, 'media'], [2, 'plugins']]) {
        await wait(800);
        fs.writeFileSync(path.join(dir, `${i + 1}-projects-${n === 1 ? 'code' : 'media'}.png`), (await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript(`document.querySelectorAll('.segmented button')[${n}].click()`);
        await waitFor(win, `!!document.querySelector('.project-row')`, 240000);
      }
    }
    await wait(1200);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${i + 1}-${routes[i]}.png`), img.toPNG());
    if (routes[i] === 'hidden') {
      await win.webContents.executeJavaScript(`document.querySelector('[data-item]')?.classList.add('open'); document.getElementById('view').scrollTop = 760`);
      await wait(500);
      fs.writeFileSync(path.join(dir, `${i + 1}-${routes[i]}-b.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  const errors = await win.webContents.executeJavaScript('window.__siltErrors || []');
  fs.writeFileSync(path.join(dir, 'errors.json'), JSON.stringify(errors, null, 2));
  app.quit();
};
