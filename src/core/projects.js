'use strict';

/**
 * Figures out which projects your files belong to: coding projects, DAW
 * sessions, live keys rigs and presentation libraries. Pure, synchronous
 * filesystem logic so it can run inside a worker thread and be unit-tested.
 */
const fs = require('fs');
const path = require('path');

// ───────────── Code ─────────────

// A folder is a code project if it directly contains one of these.
const CODE_MARKERS = [
  ['.git', 'Git'],
  ['package.json', 'Node.js'],
  ['deno.json', 'Deno'],
  ['Cargo.toml', 'Rust'],
  ['go.mod', 'Go'],
  ['pyproject.toml', 'Python'],
  ['requirements.txt', 'Python'],
  ['setup.py', 'Python'],
  ['Pipfile', 'Python'],
  ['Package.swift', 'Swift'],
  [/\.xcodeproj$/i, 'Xcode'],
  [/\.xcworkspace$/i, 'Xcode'],
  ['Podfile', 'CocoaPods'],
  ['Gemfile', 'Ruby'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Gradle'],
  ['build.gradle.kts', 'Gradle'],
  ['CMakeLists.txt', 'C/C++'],
  ['composer.json', 'PHP'],
  ['pubspec.yaml', 'Flutter'],
  ['mix.exs', 'Elixir'],
  [/\.(sln|csproj)$/i, '.NET'],
  ['project.godot', 'Godot'],
  ['ProjectSettings', 'Unity'], // with Assets/ — checked below
];

/**
 * Folders inside a project that tools recreate on demand. `when` restricts an
 * entry to projects of a given kind so we never misread a hand-made folder.
 */
const ARTIFACTS = [
  { name: 'node_modules', label: 'Dependencies (npm)', kind: 'dependencies' },
  { name: '.next', label: 'Next.js build', kind: 'build' },
  { name: '.nuxt', label: 'Nuxt build', kind: 'build' },
  { name: '.svelte-kit', label: 'SvelteKit build', kind: 'build' },
  { name: '.turbo', label: 'Turborepo cache', kind: 'cache' },
  { name: '.parcel-cache', label: 'Parcel cache', kind: 'cache' },
  { name: '.vite', label: 'Vite cache', kind: 'cache' },
  { name: '.angular', label: 'Angular cache', kind: 'cache' },
  { name: 'target', label: 'Build output', kind: 'build', when: ['Rust', 'Java'] },
  { name: '.build', label: 'SwiftPM build', kind: 'build', when: ['Swift'] },
  { name: 'Pods', label: 'CocoaPods', kind: 'dependencies', when: ['CocoaPods'] },
  { name: 'DerivedData', label: 'Xcode build', kind: 'build', when: ['Xcode'] },
  { name: '.venv', label: 'Python virtualenv', kind: 'dependencies', when: ['Python'] },
  { name: 'venv', label: 'Python virtualenv', kind: 'dependencies', when: ['Python'] },
  { name: '__pycache__', label: 'Python bytecode', kind: 'cache', when: ['Python'] },
  { name: '.pytest_cache', label: 'pytest cache', kind: 'cache', when: ['Python'] },
  { name: '.mypy_cache', label: 'mypy cache', kind: 'cache', when: ['Python'] },
  { name: '.tox', label: 'tox environments', kind: 'dependencies', when: ['Python'] },
  { name: '.gradle', label: 'Gradle cache', kind: 'cache', when: ['Gradle', 'Java'] },
  { name: '.dart_tool', label: 'Dart tool cache', kind: 'cache', when: ['Flutter'] },
  { name: 'Library', label: 'Unity library cache', kind: 'cache', when: ['Unity'] },
  { name: 'Temp', label: 'Unity temp', kind: 'cache', when: ['Unity'] },
  { name: 'obj', label: '.NET build', kind: 'build', when: ['.NET'] },
  { name: '.godot', label: 'Godot import cache', kind: 'cache', when: ['Godot'] },
];
// Only counted when the project's .gitignore says so (they can be hand-written otherwise).
const IGNORED_BUILD_DIRS = ['dist', 'build', 'out', '.output', 'coverage', 'bin'];

function detectCode(dir, names) {
  const kinds = new Set();
  for (const [m, kind] of CODE_MARKERS) {
    const hit = typeof m === 'string' ? names.has(m) : [...names].some((n) => m.test(n));
    if (!hit) continue;
    if (kind === 'Unity' && !names.has('Assets')) continue;
    kinds.add(kind);
  }
  return kinds;
}

function readGitignore(dir) {
  try {
    const text = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').slice(0, 64 * 1024);
    return new Set(
      text
        .split('\n')
        .map((l) => l.trim().replace(/^\//, '').replace(/\/$/, ''))
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('!') && !/[*?[]/.test(l)),
    );
  } catch {
    return new Set();
  }
}

function safeStat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function describeCodeProject(dir, entries, kinds) {
  const names = new Set(entries.map((e) => e.name));
  const ignored = readGitignore(dir);
  const artifacts = [];
  for (const a of ARTIFACTS) {
    if (!names.has(a.name)) continue;
    if (a.when && !a.when.some((k) => kinds.has(k))) continue;
    const p = path.join(dir, a.name);
    if (safeStat(p)?.isDirectory()) artifacts.push({ name: a.name, path: p, label: a.label, kind: a.kind });
  }
  for (const n of IGNORED_BUILD_DIRS) {
    if (names.has(n) && ignored.has(n) && safeStat(path.join(dir, n))?.isDirectory()) {
      artifacts.push({ name: n, path: path.join(dir, n), label: 'Build output (git-ignored)', kind: 'build' });
    }
  }
  // Last activity: newest of git's index/HEAD and the project's own top-level files.
  const artifactNames = new Set(artifacts.map((a) => a.name));
  let lastActive = 0;
  for (const p of ['.git/index', '.git/HEAD', '.git/FETCH_HEAD', '.git/logs/HEAD']) {
    const st = safeStat(path.join(dir, p));
    if (st) lastActive = Math.max(lastActive, st.mtimeMs);
  }
  for (const e of entries) {
    if (artifactNames.has(e.name) || e.name === '.git' || e.name === '.DS_Store') continue;
    const st = safeStat(path.join(dir, e.name));
    if (st) lastActive = Math.max(lastActive, st.mtimeMs);
  }
  return { name: path.basename(dir), path: dir, kinds: [...kinds], artifacts, lastActive };
}

// ───────────── Music, rigs & presentations ─────────────

/**
 * Session/document types. `package`: the file is a folder bundle.
 * `markers`: sibling folders that mean the parent folder is a dedicated project folder.
 * `skipIn`: parent folder names that hold backups/autosaves rather than real sessions.
 * `backups`: sub-folders of a project folder that are backups or caches.
 */
const MEDIA_TYPES = [
  { ext: 'logicx', app: 'Logic Pro', category: 'daw', package: true },
  { ext: 'logic', app: 'Logic Pro', category: 'daw', package: true },
  { ext: 'band', app: 'GarageBand', category: 'daw', package: true },
  { ext: 'als', app: 'Ableton Live', category: 'daw', markers: ['Ableton Project Info'], skipIn: ['Backup'], backups: ['Backup'] },
  { ext: 'song', app: 'Studio One', category: 'daw', markers: ['Media', 'Cache', 'History', 'Mixdown'], skipIn: ['History', 'Backup', 'Autosaves'], backups: ['History', 'Cache'] },
  { ext: 'ptx', app: 'Pro Tools', category: 'daw', markers: ['Audio Files', 'Session File Backups', 'Bounced Files'], skipIn: ['Session File Backups'], backups: ['Session File Backups'] },
  { ext: 'ptf', app: 'Pro Tools', category: 'daw', markers: ['Audio Files', 'Session File Backups'], skipIn: ['Session File Backups'], backups: ['Session File Backups'] },
  { ext: 'cpr', app: 'Cubase', category: 'daw', markers: ['Audio', 'Edits', 'Images'], skipIn: [], backups: [] },
  { ext: 'npr', app: 'Nuendo', category: 'daw', markers: ['Audio', 'Edits', 'Images'], skipIn: [], backups: [] },
  { ext: 'rpp', app: 'REAPER', category: 'daw', markers: ['Media', 'Audio', 'Peaks'], skipIn: ['Backups'], backups: ['Backups', 'Peaks'] },
  { ext: 'flp', app: 'FL Studio', category: 'daw', markers: ['Audio', 'Samples'], skipIn: ['Backup'], backups: ['Backup'] },
  { ext: 'bwproject', app: 'Bitwig Studio', category: 'daw', markers: ['samples', 'recordings', 'bounce'], skipIn: [], backups: [] },
  { ext: 'reason', app: 'Reason', category: 'daw', markers: [], skipIn: [], backups: [] },
  { ext: 'concert', app: 'MainStage', category: 'rig', package: true },
  { ext: 'gig', app: 'Gig Performer', category: 'rig', markers: [], skipIn: ['Backups'], backups: [] },
  { ext: 'pro', app: 'ProPresenter', category: 'presentation', byFolder: true },
  { ext: 'pro6', app: 'ProPresenter', category: 'presentation', byFolder: true },
  { ext: 'probundle', app: 'ProPresenter', category: 'presentation', byFolder: true },
];
const MEDIA_BY_EXT = new Map(MEDIA_TYPES.map((t) => [t.ext, t]));

// Folder bundles we never walk into (they are measured as single items, or are irrelevant).
const PACKAGE_RE = /\.(app|bundle|framework|plugin|component|vst|vst3|aaxplugin|clap|photoslibrary|fcpbundle|imovielibrary|musiclibrary|tvlibrary|xcodeproj|xcworkspace|xcarchive|logicx|logic|band|concert|sparsebundle|pvm|utm|vmwarevm|lrdata|lrlibrary|cocatalog)$/i;

// Never descend into these folder names anywhere in the walk.
const SKIP_NAMES = new Set(['node_modules', '.git', '.Trash', '.Spotlight-V100', '.fseventsd', '.DocumentRevisions-V100', 'Caches', '.cache', '.npm', '.cargo', '.rustup', '.gradle', '.m2', '.nvm', '.pyenv', '.conda', 'Pods', 'DerivedData']);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Walk `roots` and classify what is found.
 * @returns {{ code, sessions, docs, dirsSeen }}
 *   code:     [{ name, path, kinds, artifacts, lastActive }]
 *   sessions: [{ path, app, category, type }]   (DAW/rig files, grouped later)
 *   docs:     [{ path, app, category, bytes, mtimeMs }] (by-folder types like ProPresenter)
 */
function findProjects(roots, { skip = [], maxDepth = 9, onProgress } = {}) {
  const skipSet = new Set(skip);
  const code = [];
  const sessions = [];
  const docs = [];
  let dirsSeen = 0;
  const stack = roots.map((r) => ({ dir: r, depth: 0, root: r }));
  while (stack.length) {
    const { dir, depth, root } = stack.pop();
    if (skipSet.has(dir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    dirsSeen++;
    onProgress?.(dir, dirsSeen);
    const names = new Set(entries.map((e) => e.name));

    // Containers like ~, ~/Desktop or ~/Documents are never projects themselves.
    const isContainer = depth === 0 || (depth === 1 && /^(Desktop|Documents|Downloads|Music|Movies|Pictures|Developer|Projects|Code|src|repos|GitHub)$/i.test(path.basename(dir)));
    if (!isContainer) {
      const kinds = detectCode(dir, names);
      if (kinds.size) {
        code.push(describeCodeProject(dir, entries, kinds));
        continue; // a project's insides belong to the project
      }
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      const type = MEDIA_BY_EXT.get(extOf(e.name));
      if (e.isDirectory()) {
        if (type?.package) {
          sessions.push({ path: full, app: type.app, category: type.category, type: type.ext });
          continue;
        }
        if (PACKAGE_RE.test(e.name) || SKIP_NAMES.has(e.name)) continue;
        if (depth === 0 && e.name === 'Library') continue; // ~/Library is covered by System Data
        if (depth + 1 <= maxDepth) stack.push({ dir: full, depth: depth + 1, root });
        continue;
      }
      if (!e.isFile() || !type) continue;
      if (type.skipIn?.includes(path.basename(dir))) continue;
      if (type.byFolder) {
        const st = safeStat(full);
        docs.push({ path: full, app: type.app, category: type.category, bytes: st ? st.blocks * 512 : 0, mtimeMs: st?.mtimeMs ?? 0 });
      } else {
        sessions.push({ path: full, app: type.app, category: type.category, type: type.ext });
      }
    }
  }
  return { code, sessions, docs, dirsSeen };
}

/**
 * Turn raw session files into projects: files that share a dedicated project
 * folder (e.g. an Ableton "… Project" folder) become one project with versions.
 */
function groupSessions(sessions) {
  const projects = new Map();
  for (const s of sessions) {
    const type = MEDIA_BY_EXT.get(s.type);
    let projectPath = s.path;
    if (!type.package) {
      const parent = path.dirname(s.path);
      let siblings = [];
      try {
        siblings = fs.readdirSync(parent);
      } catch {
        /* unreadable */
      }
      const dedicated = type.markers?.some((m) => siblings.includes(m));
      if (dedicated) projectPath = parent;
    }
    const st = safeStat(s.path);
    const key = `${s.app}\0${projectPath}`;
    if (!projects.has(key)) {
      projects.set(key, {
        app: s.app,
        category: s.category,
        name: path.basename(projectPath).replace(/\.[^.]+$/, '') || path.basename(projectPath),
        path: projectPath,
        isFolder: projectPath !== s.path || !!type.package,
        files: [],
        lastActive: 0,
        backups: [],
      });
    }
    const p = projects.get(key);
    p.files.push(s.path);
    p.lastActive = Math.max(p.lastActive, st?.mtimeMs ?? 0);
  }
  for (const p of projects.values()) {
    const type = MEDIA_TYPES.find((t) => t.app === p.app && t.backups?.length);
    if (p.isFolder && type && !p.path.endsWith(`.${type.ext}`)) {
      for (const b of type.backups) {
        const bp = path.join(p.path, b);
        if (safeStat(bp)?.isDirectory()) p.backups.push({ name: b, path: bp });
      }
    }
    // Studio One/Ableton projects often hold the session plus dated copies.
    p.versions = p.files.length;
  }
  return [...projects.values()];
}

/** Group by-folder documents (ProPresenter presentations) into one entry per folder. */
function groupDocs(docs) {
  const byFolder = new Map();
  for (const d of docs) {
    const dir = path.dirname(d.path);
    const key = `${d.app}\0${dir}`;
    if (!byFolder.has(key)) byFolder.set(key, { app: d.app, category: d.category, name: path.basename(dir), path: dir, isFolder: true, files: [], bytes: 0, lastActive: 0, backups: [] });
    const g = byFolder.get(key);
    g.files.push(d.path);
    g.bytes += d.bytes;
    g.lastActive = Math.max(g.lastActive, d.mtimeMs);
  }
  return [...byFolder.values()].map((g) => ({ ...g, versions: g.files.length }));
}

module.exports = { findProjects, groupSessions, groupDocs, detectCode, describeCodeProject, MEDIA_TYPES, ARTIFACTS };
