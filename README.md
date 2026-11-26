<p align="center">
  <img src="build/icon.png" width="112" alt="Silt icon" />
</p>

<h1 align="center">Silt</h1>

<p align="center">
  <b>Find out where your Mac’s storage actually went — including the bloated “System Data”.</b><br/>
  Free, open-source, private. Nothing leaves your Mac, and nothing is deleted without going through the Trash.
</p>

---

macOS’s Storage settings dump everything they can’t classify into one big grey bar called **System Data**. It’s often 100 GB+, and macOS won’t tell you what’s in it. Silt measures each piece separately, explains what it is, and tells you how safe it is to remove.

## Features

- **Storage health score** — a 0–100 evaluation of your disk with a ranked list of what to do about it.
- **System Data, explained** — 50+ known locations measured and grouped:
  - App caches, logs, crash reports, browser and Electron (Slack, Discord, VS Code, Teams…) caches
  - Xcode DerivedData, archives, device support, iOS simulators and runtimes
  - Docker / OrbStack disk images, npm, pnpm, Yarn, Homebrew, pip, Conda, Gradle, Maven, Cargo, Go caches
  - AI model downloads (Ollama, Hugging Face, LM Studio)
  - iPhone/iPad backups, iOS firmware files, Messages attachments, Mail downloads
  - Old macOS installers, installer `.dmg`/`.pkg` files in Downloads, the Trash
  - Virtual machines, Steam games, Logic/GarageBand sound libraries, Adobe media cache
  - **Leftovers from deleted apps** in Application Support (flagged “No matching app”)
- **The parts macOS hides** — APFS volumes (Preboot, VM/swap, Recovery, Update), purgeable space, and local Time Machine / update snapshots.
- **Explorer** — drill down through any folder with a live treemap; sizes stream in as they’re measured.
- **Large Files** — the biggest files anywhere in your home folder, filterable by size and how long since they were touched.
- **Duplicates** — byte-for-byte identical files (size → quick fingerprint → full SHA-256), with “keep oldest/newest” auto-select.
- **Export report** — a shareable Markdown storage report (paths shown as `~`, so your username isn’t leaked).

## Safety model

Silt is designed so you can’t hurt your Mac with it:

| Rule | How |
| --- | --- |
| Nothing is deleted permanently | Every cleanup uses the macOS Trash (`shell.trashItem`). Only **Empty Trash** is permanent and it always asks first. |
| System files are off limits | A hard-coded deny list in [`src/core/paths.js`](src/core/paths.js) blocks `/System`, `/usr`, Keychains, Preferences, iCloud Drive, cloud drives, Mail and Messages — checked in the main process for every single path. |
| Tool-managed data uses the tool | Docker, simulators, Homebrew, npm, pnpm, Conda, Go… are reclaimed with their own command, opened visibly in Terminal. Silt only runs commands from its own catalog. |
| Clear labels | Every item is tagged **Safe** (regenerates automatically), **Review** (your data — look first) or **Info** (explained, not removable from Silt). |
| No surprise permission prompts | Without Full Disk Access, Silt skips the folders macOS protects (app containers, Mail, Messages) instead of triggering blocking prompts. |
| Private | No network access, no analytics, no accounts. The renderer runs sandboxed with a strict CSP. |

## Install

Download the latest `.dmg` from [**Releases**](https://github.com/thestealthgoat/Mac-cleaning/releases). Builds are currently unsigned: the first time, right-click **Silt.app → Open**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Silt.app
```

For full results, grant Silt **Full Disk Access** in *System Settings › Privacy & Security › Full Disk Access*. It’s optional; without it Mail, Messages, app containers and device backups are simply not measured.

## Build from source

Requires macOS and Node.js 20+.

```bash
git clone https://github.com/thestealthgoat/Mac-cleaning.git silt && cd silt
npm install
npm start          # run the app
npm test           # unit tests (node:test, no extra dependencies)
npm run dist       # build .dmg and .zip into dist/
```

While developing, macOS attributes file access to the app that launched Electron — grant Full Disk Access to your terminal if you want protected folders measured.

`SILT_SNAP_DIR=/tmp/shots npm start` captures every screen to PNG and quits (handy for screenshots and visual checks).

## How it works

```
src/
  main/            Electron main process: window, IPC, confirmations, Trash
    main.js
    preload.js     the only bridge to the renderer (contextIsolation + sandbox)
  core/            plain Node modules, no Electron — unit-tested
    catalog.js     ★ the list of hidden-data locations (contributions welcome)
    hidden.js      measures the catalog with as few `du` passes as possible
    disk.js        capacity & purgeable (Foundation via JXA), APFS volumes, snapshots
    evaluate.js    health score + findings
    cleanup.js     plans and performs Trash moves through the safety check
    paths.js       glob expansion and the deny list
    walk-worker.js worker thread for Large Files and Duplicates
    apps.js        installed-app index for leftover detection
    report.js      Markdown report
  renderer/        vanilla JS UI (ES modules, no framework, no bundler)
```

Sizes are measured with the system `du` (allocated blocks, hard links counted once, one filesystem only), so they match what is really charged to the disk. APFS clones and snapshots mean some numbers can still differ from the Finder’s — Silt says so where it matters.

## Contributing

The most valuable contributions are new entries for [`src/core/catalog.js`](src/core/catalog.js): a place where macOS or a popular app hoards data, what it is, and whether it’s safe to remove. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
