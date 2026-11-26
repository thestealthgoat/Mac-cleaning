'use strict';

/**
 * Audio plug-ins grouped by vendor, with the sound libraries and support
 * files each vendor installs elsewhere on the disk.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, pool } = require('./exec');
const { installedApps, matchesInstalledApp } = require('./apps');

const FORMAT_BY_EXT = { component: 'AU', vst: 'VST', vst3: 'VST3', aaxplugin: 'AAX', clap: 'CLAP' };

function pluginDirs(home) {
  return [
    '/Library/Audio/Plug-Ins/Components',
    '/Library/Audio/Plug-Ins/VST',
    '/Library/Audio/Plug-Ins/VST3',
    '/Library/Audio/Plug-Ins/CLAP',
    '/Library/Application Support/Avid/Audio/Plug-Ins',
    path.join(home, 'Library/Audio/Plug-Ins/Components'),
    path.join(home, 'Library/Audio/Plug-Ins/VST'),
    path.join(home, 'Library/Audio/Plug-Ins/VST3'),
    path.join(home, 'Library/Audio/Plug-Ins/CLAP'),
  ];
}

// Where vendors put sample libraries, presets and support data.
function contentRoots(home) {
  return ['/Library/Application Support', path.join(home, 'Library/Application Support'), '/Users/Shared', '/Library/Audio/Presets', path.join(home, 'Music'), path.join(home, 'Documents')];
}

/**
 * Known audio vendors (normalized). Lets Silt recognise a vendor's library
 * folder even when none of its plug-ins are installed any more.
 */
const KNOWN_AUDIO_VENDORS = [
  'spectrasonics', 'nativeinstruments', 'toontrack', 'eastwest', 'spitfire', 'arturia', 'output', 'heavyocity', 'uvi', 'steinberg',
  'presonus', 'ableton', 'waves', 'izotope', 'fabfilter', 'soundtoys', 'universalaudio', 'slatedigital', 'pluginalliance', 'brainworx',
  'kilohearts', 'xfer', 'xferrecords', 'uhe', 'robpapen', 'celemony', 'antares', 'eventide', 'valhalla', 'softube', 'ikmultimedia',
  'xlnaudio', 'splice', 'orchestraltools', '8dio', 'cinesamples', 'modartt', 'liquidsonics', 'neuraldsp', 'overloud', 'oeksound',
  'ssl', 'solidstatelogic', 'sonicacademy', 'supertone', 'd16group', 'eiosis', 'harrison', 'propellerheadsoftware', 'reasonstudios',
  'avid', 'audiothing', 'tokyodawn', 'goodhertz', 'sonnox', 'mcdsp', 'acustica', 'airmusictech', 'sonible', 'baby audio', 'babyaudio',
  'krotos', 'musiclab', 'ujam', 'samplelogic', 'impactsoundworks', 'audioimperia', 'projectsam', 'embertone', 'cinematicstudios',
  'loopmasters', 'bluecataudio', 'tbproaudio', 'melda', 'meldaproduction', 'apogee', 'focusrite', 'novation', 'korg',
  'roland', 'yamaha', 'moog', 'nugenaudio', 'zynaptiq', 'accusonus', 'audiomodern', 'soundiron', 'sonokinetic', 'vir2', 'keyscape',
  'gforce', 'lennardigital', 'reveal', 'revealsound', 'vengeance', 'tal', 'togu', 'dmgaudio', 'plugininc', 'pulsar', 'kiive', 'cableguys',
];

// Suffixes that differ between a vendor's plug-in name and its folders.
function vendorKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[,.]?\s*(llc|inc|ltd|gmbh|corp|co|sarl|s\.?a\.?|ab|oy|limited)\.?$/g, '')
    .replace(/\b(audio|software|music|dsp|instruments?|technologies|labs?|sound|studios?|plugins?|digital|connect|records|productions?)\b/g, (m, w, off, s) => (off === 0 ? m : ''))
    .replace(/[^a-z0-9]/g, '');
}

function titleCase(s) {
  return s.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

/** "WavesAudio" → "Waves Audio" (some vendors register camel-cased names). */
function prettyVendor(s) {
  return s.replace(/([a-z])([A-Z][a-z])/g, '$1 $2');
}

async function readPlist(file) {
  const res = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { timeout: 8000 });
  if (res.code !== 0) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

function listBundles(dir, depth = 0, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const ext = e.name.split('.').pop().toLowerCase();
    const full = path.join(dir, e.name);
    if (FORMAT_BY_EXT[ext]) out.push({ path: full, format: FORMAT_BY_EXT[ext], file: e.name });
    else if (depth < 2 && e.isDirectory()) listBundles(full, depth + 1, out); // vendor sub-folders (common for AAX/VST3)
  }
  return out;
}

/** Identify one plug-in bundle: vendor and product name. */
function identify(bundle, plist) {
  const au = plist?.AudioComponents?.[0]?.name; // "Vendor: Product"
  let vendor = null;
  let product = null;
  if (au && au.includes(':')) {
    vendor = au.split(':')[0].trim();
    product = au.split(':').slice(1).join(':').trim();
  }
  const id = plist?.CFBundleIdentifier || '';
  const idVendor = id.split('.')[1] || '';
  if (!vendor) vendor = idVendor ? titleCase(idVendor) : null;
  if (!product) product = plist?.CFBundleName || bundle.file.replace(/\.[^.]+$/, '');
  if (!vendor) vendor = 'Unknown vendor';
  return { vendor, fromAu: !!(au && au.includes(':')), product: product.replace(/\s*\((AU|VST3?|AAX|Mono|Stereo)\)$/i, ''), id, idVendor: idVendor.toLowerCase(), version: plist?.CFBundleShortVersionString || null };
}

/**
 * Scan installed plug-ins and the vendor folders around them.
 * `measure(paths)` must return Map(path → { bytes }) — injected so tests can fake it.
 */
async function scanPlugins({ home = os.homedir(), measure, onProgress } = {}) {
  const bundles = pluginDirs(home).flatMap((d) => listBundles(d));
  const limit = pool(8);
  let done = 0;
  const identified = await Promise.all(
    bundles.map((b) =>
      limit(async () => {
        const plist = await readPlist(path.join(b.path, 'Contents', 'Info.plist'));
        onProgress?.({ phase: 'plugins', done: ++done, total: bundles.length });
        return { ...b, ...identify(b, plist) };
      }),
    ),
  );

  // Group by vendor. Bundle-id vendor joins AU-name vendor ("com.fabfilter…" ↔ "FabFilter").
  const vendors = new Map();
  const aliasToKey = new Map();
  const votes = new Map();
  for (const p of identified) {
    // AU names carry the real vendor; VST3/AAX bundles are matched to it through their bundle id.
    // Majority vote, because a vendor sometimes ships another brand under its bundle id.
    if (p.fromAu && p.idVendor && p.idVendor.length >= 3) {
      const key = vendorKey(p.vendor);
      if (!votes.has(p.idVendor)) votes.set(p.idVendor, new Map());
      votes.get(p.idVendor).set(key, (votes.get(p.idVendor).get(key) || 0) + 1);
    }
  }
  for (const [idVendor, counts] of votes) aliasToKey.set(idVendor, [...counts].sort((a, b) => b[1] - a[1])[0][0]);
  for (const p of identified) {
    let key = vendorKey(p.vendor);
    if (!p.fromAu && aliasToKey.has(p.idVendor)) key = aliasToKey.get(p.idVendor);
    if (!vendors.has(key)) vendors.set(key, { key, name: prettyVendor(p.vendor), plugins: new Map(), bundles: [], content: [], aliases: new Set() });
    const v = vendors.get(key);
    if (p.fromAu && vendorKey(p.vendor) === key && p.vendor.length > v.name.length) v.name = prettyVendor(p.vendor); // prefer the fuller spelling
    if (p.idVendor && (aliasToKey.get(p.idVendor) ?? key) === key) v.aliases.add(p.idVendor.replace(/[^a-z0-9]/g, ''));
    const pk = p.product.toLowerCase();
    if (!v.plugins.has(pk)) v.plugins.set(pk, { name: p.product, formats: [], paths: [], version: p.version });
    const pl = v.plugins.get(pk);
    if (!pl.formats.includes(p.format)) pl.formats.push(p.format);
    pl.paths.push(p.path);
    v.bundles.push(p.path);
  }

  // Match vendor content folders.
  const candidates = [];
  for (const root of contentRoots(home)) {
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const n of names) {
      const full = path.join(root, n);
      try {
        if (!fs.lstatSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      candidates.push({ name: n, path: full, key: vendorKey(n) });
    }
  }
  const matchVendor = (c) => {
    if (c.key.length < 3) return null;
    for (const v of vendors.values()) {
      const keys = [v.key, ...v.aliases].filter((k) => k.length >= 3);
      if (keys.some((k) => c.key === k || (k.length >= 5 && (c.key.startsWith(k) || k.startsWith(c.key) && c.key.length >= 5)))) return v;
    }
    return null;
  };
  const apps = await installedApps();
  const pdirs = pluginDirs(home);
  const orphans = new Map();
  for (const c of candidates) {
    // A folder that holds plug-in bundles (e.g. /Library/Application Support/Avid) would double count them.
    if (pdirs.some((d) => d.startsWith(c.path + path.sep))) continue;
    const v = matchVendor(c);
    if (v) v.content.push({ name: c.name, path: c.path });
    else {
      const known = KNOWN_AUDIO_VENDORS.find((k) => c.key === k || (k.length >= 5 && c.key.startsWith(k)));
      if (known) {
        // Vendor content for an installed app (Studio One, Ableton Live…) is app data, not a leftover.
        const hasApp = matchesInstalledApp(c.name, apps);
        if (!orphans.has(known)) orphans.set(known, { key: known, name: c.name, plugins: new Map(), bundles: [], content: [], aliases: new Set(), orphan: !hasApp, appOnly: hasApp });
        orphans.get(known).content.push({ name: c.name, path: c.path });
      }
    }
  }

  // Apple's own instruments and loops (Logic Pro, MainStage, GarageBand) live outside plug-in folders.
  const appleContent = ['/Library/Application Support/Logic', '/Library/Application Support/GarageBand', '/Library/Audio/Apple Loops', '/Library/Audio/Impulse Responses/Apple']
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ name: path.basename(p), path: p }));
  const appleApps = ['Logic Pro', 'MainStage', 'GarageBand'].filter((a) => fs.existsSync(`/Applications/${a}.app`) || fs.existsSync(`/Applications/${a} X.app`) || fs.existsSync(`/Applications/${a} 3.app`));
  const all = [...vendors.values(), ...orphans.values()];
  if (appleContent.length) {
    all.push({ key: 'apple', name: 'Apple (Logic, MainStage, GarageBand)', plugins: new Map(appleApps.map((a) => [a, { name: a, formats: ['App'], paths: [] }])), bundles: [], content: appleContent, aliases: new Set(), orphan: appleApps.length === 0 });
  }

  onProgress?.({ phase: 'sizes' });
  const sizes = await measure([...all.flatMap((v) => v.bundles), ...all.flatMap((v) => v.content.map((c) => c.path))]);
  const bytesOf = (p) => sizes.get(p)?.bytes ?? 0;

  return all
    .map((v) => {
      const plugins = [...v.plugins.values()].map((p) => ({ ...p, bytes: p.paths.reduce((s, x) => s + bytesOf(x), 0) })).sort((a, b) => a.name.localeCompare(b.name));
      const content = v.content.map((c) => ({ ...c, bytes: bytesOf(c.path) })).filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes);
      const pluginBytes = plugins.reduce((s, p) => s + p.bytes, 0);
      const contentBytes = content.reduce((s, c) => s + c.bytes, 0);
      const formats = {};
      for (const p of plugins) for (const f of p.formats) formats[f] = (formats[f] || 0) + 1;
      return { key: v.key, name: v.name, orphan: !!v.orphan, appOnly: !!v.appOnly, plugins, content, pluginBytes, contentBytes, bytes: pluginBytes + contentBytes, formats };
    })
    .filter((v) => v.bytes > 0 || v.plugins.length)
    .sort((a, b) => b.bytes - a.bytes);
}

/** Lightweight inventory (no sizes): one entry per product with its bundle paths. */
async function identifyInstalledPlugins({ home = os.homedir() } = {}) {
  const bundles = pluginDirs(home).flatMap((d) => listBundles(d));
  const limit = pool(8);
  const found = await Promise.all(bundles.map((b) => limit(async () => ({ ...b, ...identify(b, await readPlist(path.join(b.path, 'Contents', 'Info.plist'))) }))));
  const byProduct = new Map();
  for (const p of found) {
    const k = `${vendorKey(p.vendor)}\0${p.product.toLowerCase()}`;
    if (!byProduct.has(k)) byProduct.set(k, { vendor: p.vendor, idVendor: p.idVendor, name: p.product, paths: [] });
    byProduct.get(k).paths.push(p.path);
  }
  return [...byProduct.values()];
}

module.exports = { scanPlugins, identifyInstalledPlugins, identify, vendorKey, listBundles, KNOWN_AUDIO_VENDORS };
