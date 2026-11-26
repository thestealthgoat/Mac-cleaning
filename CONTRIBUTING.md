# Contributing to Silt

Thanks for helping! Silt is deliberately small: plain Node + Electron, vanilla JS, no bundler and no runtime dependencies.

## Getting started

```bash
npm install
npm start
npm test
```

## Adding a hidden-data location (the best first contribution)

Edit [`src/core/catalog.js`](src/core/catalog.js) and add an entry:

```js
{
  id: 'my-app-cache',                // unique, kebab-case
  name: 'My App cache',
  group: 'apps',                      // system | caches | developer | apple | apps | user
  paths: ['~/Library/Application Support/MyApp/Cache'],  // ~ and * allowed
  safety: 'safe',                     // safe | review | info
  action: 'trash-contents',           // trash-contents | trash-paths | command | none
  why: 'What this is and what happens if it is removed.',
}
```

Guidelines:

- **`safe`** means the app regenerates it with no user-visible loss (caches, build products, re-downloadable files).
- **`review`** is for user data or anything that is expensive to get back (backups, archives, models, VMs).
- **`info`** entries explain space but are never removable from Silt.
- If a tool owns the data (Docker, simulators, package managers), prefer `action: 'command'` with the tool's own cleanup command.
- Please link a source (docs, issue, forum post) in your PR description.
- `npm test` validates the catalog shape and checks that cleanable paths pass the safety guard.

## Safety rules for code changes

- Never call `fs.rm`/`unlink` on user data. All removals go through `trashPaths()` in `src/core/cleanup.js`, which runs `checkTrashable()`.
- The renderer must never supply paths for catalog cleanups or commands; the main process re-resolves them from the catalog.
- Without Full Disk Access, never read inside `~/Library/Containers` or `~/Library/Group Containers` — macOS blocks the read on a permission prompt.
- Keep `src/core` free of Electron imports so it stays unit-testable.

## Pull requests

- Keep PRs focused; include a screenshot for UI changes (`SILT_SNAP_DIR=/tmp/shots npm start`).
- Make sure `npm test` passes.
