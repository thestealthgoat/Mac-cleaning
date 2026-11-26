'use strict';

/**
 * Renders Silt's brand art with Electron's offscreen renderer:
 *   build/icon.png            1024×1024 master icon
 *   build/icon.icns           macOS icon (via iconutil)
 *   build/background.png      DMG window background (+ @2x)
 *   src/renderer/assets/icon.png  128px icon for the app's sidebar
 *
 * Run with: npm run art
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const ASSETS = path.join(ROOT, 'src', 'renderer', 'assets');

// Apple's icon shape is a continuous-curvature "squircle"; a superellipse with n≈5 is a close match.
function squircle(x, y, size, n = 5, steps = 360) {
  const a = size / 2;
  const cx = x + a;
  const cy = y + a;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push(`${(cx + a * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(2)},${(cy + a * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

// A soft sediment layer: gentle wave on top, filled to the bottom of the canvas.
function stratum(baseY, amp, phase, width = 1024) {
  const pts = [];
  for (let x = 0; x <= width; x += 8) {
    const y = baseY + Math.sin((x / width) * Math.PI * 2 + phase) * amp + Math.sin((x / width) * Math.PI * 5 + phase * 1.7) * amp * 0.25;
    pts.push(`${x},${y.toFixed(2)}`);
  }
  return `M0,1024L${pts.join('L')}L${width},1024Z`;
}

function sparkle(cx, cy, r) {
  const k = r * 0.16; // waist of the four-point star
  return `M${cx},${cy - r} C${cx + k},${cy - k} ${cx + k},${cy - k} ${cx + r},${cy} C${cx + k},${cy + k} ${cx + k},${cy + k} ${cx},${cy + r} C${cx - k},${cy + k} ${cx - k},${cy + k} ${cx - r},${cy} C${cx - k},${cy - k} ${cx - k},${cy - k} ${cx},${cy - r}Z`;
}

function iconSvg() {
  const shape = squircle(100, 100, 824);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="clip"><path d="${shape}"/></clipPath>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFF8EC"/>
      <stop offset="1" stop-color="#F3DFBF"/>
    </linearGradient>
    <linearGradient id="l1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EBC58D"/><stop offset="1" stop-color="#DFAF6C"/></linearGradient>
    <linearGradient id="l2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D99D57"/><stop offset="1" stop-color="#C98942"/></linearGradient>
    <linearGradient id="l3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BC773A"/><stop offset="1" stop-color="#A9662F"/></linearGradient>
    <linearGradient id="l4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#94552A"/><stop offset="1" stop-color="#6E3C1E"/></linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".55"/>
      <stop offset=".45" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dy="14"/>
      <feComponentTransfer><feFuncA type="linear" slope=".32"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="10" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="layerShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
      <feOffset dy="-6"/>
      <feComponentTransfer><feFuncA type="linear" slope=".18"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#drop)">
    <path d="${shape}" fill="url(#sky)"/>
  </g>
  <g clip-path="url(#clip)">
    <path d="${stratum(520, 26, 0.4)}" fill="url(#l1)" filter="url(#layerShadow)"/>
    <path d="${stratum(618, 22, 1.6)}" fill="url(#l2)" filter="url(#layerShadow)"/>
    <path d="${stratum(712, 20, 2.9)}" fill="url(#l3)" filter="url(#layerShadow)"/>
    <path d="${stratum(800, 16, 4.1)}" fill="url(#l4)" filter="url(#layerShadow)"/>
    <path d="${shape}" fill="url(#gloss)"/>
  </g>
  <g filter="url(#glow)" fill="#FFFFFF">
    <path d="${sparkle(662, 322, 118)}"/>
    <path d="${sparkle(792, 222, 46)}" opacity=".9"/>
    <path d="${sparkle(548, 214, 30)}" opacity=".75"/>
  </g>
  <path d="${sparkle(662, 322, 118)}" fill="#FFFFFF"/>
  <path d="${shape}" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="2"/>
</svg>`;
}

function dmgSvg(scale) {
  const w = 600 * scale;
  const h = 400 * scale;
  const s = (v) => v * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 600 400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFAF1"/><stop offset="1" stop-color="#F4E6CF"/></linearGradient>
    <linearGradient id="a" gradientUnits="userSpaceOnUse" x1="232" y1="0" x2="352" y2="0"><stop offset="0" stop-color="#D9A161" stop-opacity=".3"/><stop offset="1" stop-color="#C47F37"/></linearGradient>
  </defs>
  <rect width="600" height="400" fill="url(#bg)"/>
  <path d="${stratum(352, 6, 0.6, 600).replace(/1024/g, '400')}" fill="#EBCB9C" opacity=".55"/>
  <path d="${stratum(372, 5, 2.1, 600).replace(/1024/g, '400')}" fill="#D9A465" opacity=".55"/>
  <text x="300" y="70" text-anchor="middle" font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif" font-size="22" font-weight="650" fill="#3A2614" letter-spacing="-0.3">Install Silt</text>
  <text x="300" y="96" text-anchor="middle" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif" font-size="13" fill="#8A6A4A">Drag the icon into your Applications folder</text>
  <path d="M232 205 H352" stroke="url(#a)" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M340 191 L358 205 L340 219" stroke="#C47F37" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;
}

async function render(win, svg, width, height) {
  const html = `<html><head><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body>${svg}</body></html>`;
  win.setContentSize(width, height);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width, height });
  return img.resize({ width, height, quality: 'best' });
}

app.whenReady().then(async () => {
  fs.mkdirSync(ASSETS, { recursive: true });
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);

  const icon = await render(win, iconSvg(), 1024, 1024);
  fs.writeFileSync(path.join(BUILD, 'icon.png'), icon.toPNG());
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), icon.resize({ width: 128, height: 128, quality: 'best' }).toPNG());

  // .icns via iconutil
  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'silt-icon-')) + '/icon.iconset';
  fs.mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${size}x${size}.png`), icon.resize({ width: size, height: size, quality: 'best' }).toPNG());
    fs.writeFileSync(path.join(set, `icon_${size}x${size}@2x.png`), icon.resize({ width: size * 2, height: size * 2, quality: 'best' }).toPNG());
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', path.join(BUILD, 'icon.icns')]);

  fs.writeFileSync(path.join(BUILD, 'background.png'), (await render(win, dmgSvg(1), 600, 400)).toPNG());
  fs.writeFileSync(path.join(BUILD, 'background@2x.png'), (await render(win, dmgSvg(2), 1200, 800)).toPNG());
  console.log('Art written to build/ and src/renderer/assets/');
  app.quit();
});
