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
  // Then the measured disk breakdown and the installer-copy search.
  await waitFor(win, `!!document.querySelector('.legend-link')`, 300000);
  await waitFor(win, `document.body.innerText.includes('second copy') || document.body.innerText.includes('isn’t apps')`, 600000);
  await wait(800);
  const routes = ['overview', 'hidden', 'projects', 'explorer', 'large', 'dupes', 'uninstall', 'about'];
  const only = process.env.SILT_SNAP_ONLY ? process.env.SILT_SNAP_ONLY.split(',') : null;
  for (let i = 0; i < routes.length; i++) {
    if (only && !only.includes(routes[i])) continue;
    await win.webContents.executeJavaScript(`document.querySelectorAll('.nav-item')[${i}].click()`);
    if (routes[i] === 'explorer') await waitFor(win, `!!document.querySelector('.tile')`, 120000);
    if (routes[i] === 'uninstall') {
      await waitFor(win, `!!document.querySelector('.app-item')`, 120000);
      await win.webContents.executeJavaScript(`(() => { const s = document.querySelector('input.search'); s.value = 'mainstage'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
      await waitFor(win, `!!document.querySelector('.uninstall-bar')`, 180000);
      await waitFor(win, `[...document.querySelectorAll('.app-sort .faint')].some(e => e.textContent.startsWith('Sizes include'))`, 120000);
      await wait(1200);
      fs.writeFileSync(path.join(dir, `${i + 1}-uninstall.png`), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`[...document.querySelectorAll('.app-sort .seg')].find(b => b.textContent.startsWith('Not apps')).click()`);
      await waitFor(win, `!!document.querySelector('#app-list .app-item')`, 120000);
      await win.webContents.executeJavaScript(`document.querySelector('#app-list .app-item').click()`);
      await wait(800);
      fs.writeFileSync(path.join(dir, `${i + 1}-uninstall-notapps.png`), (await win.webContents.capturePage()).toPNG());
      continue;
    }
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
      // Default tab is "By app"; also capture an opened owner and the "By location" tab.
      await waitFor(win, `!!document.querySelector('.owner-row')`, 180000);
      await wait(600);
      fs.writeFileSync(path.join(dir, `${i + 1}-hidden.png`), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.getElementById('view').scrollTop = 520`);
      await wait(500);
      fs.writeFileSync(path.join(dir, `${i + 1}-hidden-byapp-b.png`), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`[...document.querySelectorAll('.segmented button')].find(b => b.textContent === 'By location').click()`);
      await wait(800);
      fs.writeFileSync(path.join(dir, `${i + 1}-hidden-location.png`), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.querySelector('[data-item]')?.classList.add('open'); document.getElementById('view').scrollTop = 760`);
      await wait(500);
      fs.writeFileSync(path.join(dir, `${i + 1}-${routes[i]}-b.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  const errors = await win.webContents.executeJavaScript('window.__siltErrors || []');
  fs.writeFileSync(path.join(dir, 'errors.json'), JSON.stringify(errors, null, 2));
  app.quit();
};
