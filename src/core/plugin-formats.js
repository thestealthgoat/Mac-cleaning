'use strict';

/**
 * Plug-in formats nothing on this Mac can load.
 *
 * Many installers copy every format they have (AU, VST, VST3, AAX, CLAP) for
 * every plug-in. If you only use Logic and MainStage, the AAX copies are only
 * read by Pro Tools, and the VST/VST3/CLAP copies are only read by hosts you
 * don't have. Silt works out which formats your installed apps can load and
 * lists the rest.
 *
 * Conservative by design:
 *   - Audio Units are never suggested — macOS itself and many apps load them.
 *   - If no known host is found at all, nothing is suggested (you may use a
 *     host Silt doesn't recognise).
 *   - Formats a host *might* load are counted as loadable.
 */
const path = require('path');

const FORMAT_BY_EXT = { component: 'AU', vst: 'VST', vst3: 'VST3', aaxplugin: 'AAX', clap: 'CLAP' };
const CANDIDATES = new Set(['VST', 'VST3', 'AAX', 'CLAP']);

// Host apps, matched on the normalised .app name (lowercase letters/digits) or bundle id.
const HOSTS = [
  { name: 'Logic Pro', re: /^logicpro/, formats: ['AU'] },
  { name: 'MainStage', re: /^mainstage/, formats: ['AU'] },
  { name: 'GarageBand', re: /^garageband/, formats: ['AU'] },
  { name: 'Final Cut Pro', re: /^finalcutpro/, formats: ['AU'] },
  { name: 'Pro Tools', re: /^protools/, id: /^com\.avid\.protools/, formats: ['AAX'] },
  { name: 'Media Composer', re: /^mediacomposer/, formats: ['AAX'] },
  { name: 'Ableton Live', re: /^abletonlive/, id: /^com\.ableton\.live/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Studio One', re: /^studioone/, formats: ['AU', 'VST', 'VST3', 'CLAP'] },
  { name: 'Bitwig Studio', re: /^bitwig/, formats: ['VST', 'VST3', 'CLAP'] },
  { name: 'REAPER', re: /^reaper/, id: /^com\.cockos\.reaper/, formats: ['AU', 'VST', 'VST3', 'CLAP'] },
  { name: 'Cubase / Nuendo', re: /^(cubase|nuendo|dorico|wavelab|vstlive)/, formats: ['VST', 'VST3'] },
  { name: 'FL Studio', re: /^flstudio/, formats: ['AU', 'VST', 'VST3', 'CLAP'] },
  { name: 'Gig Performer', re: /^gigperformer/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Digital Performer', re: /^digitalperformer/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Reason', re: /^reason/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'LUNA', re: /^luna$/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Mixbus / Ardour', re: /^(mixbus|ardour)/, formats: ['AU', 'VST', 'VST3', 'CLAP'] },
  { name: 'Waveform', re: /^waveform/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Renoise', re: /^renoise/, formats: ['AU', 'VST', 'VST3', 'CLAP'] },
  { name: 'Audacity', re: /^audacity/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Maschine', re: /^maschine/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Komplete Kontrol', re: /^kompletekontrol/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Vienna Ensemble Pro', re: /^viennaensemblepro/, formats: ['AU', 'VST', 'VST3', 'AAX'] },
  { name: 'Unify', re: /^unify/, formats: ['AU', 'VST', 'VST3', 'CLAP'] },
  { name: 'Camelot Pro', re: /^camelot/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Cantabile / Element / Carla', re: /^(element|carla)$/, formats: ['AU', 'VST', 'VST3', 'CLAP'] },
  { name: 'Hindenburg', re: /^hindenburg/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Adobe Audition / Premiere', re: /^adobe(audition|premiere)/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'DaVinci Resolve', re: /^davinciresolve/, formats: ['AU', 'VST', 'VST3'] },
  { name: 'Plugin Doctor / hosts for testing', re: /^(plugindoctor|pluginguru|blueca|patchwork)/, formats: ['AU', 'VST', 'VST3', 'AAX', 'CLAP'] },
];

const formatOf = (p) => FORMAT_BY_EXT[path.extname(p).slice(1).toLowerCase()] ?? null;

/** Hosts found among installed apps ({ names, ids } from apps.installedApps). */
function detectHosts(apps) {
  const names = apps?.names ?? [];
  const ids = apps?.ids ?? [];
  return HOSTS.filter((h) => names.some((n) => h.re.test(n)) || (h.id && ids.some((i) => h.id.test(i))));
}

/**
 * `vendors` from scanPlugins (each plug-in carries `files: [{ path, format, bytes }]`).
 * Returns { hosts, loadable, unused: [{ format, count, bytes, items }] }.
 */
function analyze(vendors, apps) {
  const hosts = detectHosts(apps);
  const loadable = new Set(['AU', ...hosts.flatMap((h) => h.formats)]);
  const result = { hosts: hosts.map((h) => h.name), loadable: [...loadable], unused: [], noHosts: hosts.length === 0 };
  if (!hosts.length) return result;
  const byFormat = new Map();
  for (const v of vendors ?? []) {
    for (const p of v.plugins ?? []) {
      for (const f of p.files ?? []) {
        const format = f.format || formatOf(f.path);
        if (!CANDIDATES.has(format) || loadable.has(format)) continue;
        if (!byFormat.has(format)) byFormat.set(format, { format, count: 0, bytes: 0, items: [] });
        const g = byFormat.get(format);
        g.count += 1;
        g.bytes += f.bytes || 0;
        g.items.push({ path: f.path, plugin: p.name, vendor: v.name, bytes: f.bytes || 0, otherFormats: (p.formats || []).filter((x) => x !== format) });
      }
    }
  }
  result.unused = [...byFormat.values()].map((g) => ({ ...g, items: g.items.sort((a, b) => b.bytes - a.bytes) })).sort((a, b) => b.bytes - a.bytes);
  return result;
}

/**
 * Whether `p` is a plug-in bundle Silt may move to the Trash for format cleanup:
 * a bundle with the given format's extension, inside one of the plug-in folders.
 */
function isRemovablePluginBundle(p, format, pluginDirs) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || path.resolve(p) !== p) return false;
  if (formatOf(p) !== format || !CANDIDATES.has(format)) return false;
  return pluginDirs.some((d) => {
    const rel = path.relative(d, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(path.sep).length <= 3;
  });
}

module.exports = { analyze, detectHosts, isRemovablePluginBundle, formatOf, HOSTS, CANDIDATES };
