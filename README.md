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
- **Projects** — Silt works out what your files belong to:
  - **Code**: every Git/Node/Python/Rust/Swift/Xcode/… project with its size, last activity and how much is rebuildable (`node_modules`, `.venv`, `target`, `.next`, Pods, git-ignored build output, and Xcode DerivedData traced back to its project). One click moves the rebuildable parts of a stale project to the Trash.
  - **Music & live**: Logic, GarageBand, Ableton Live, Studio One, Pro Tools, Cubase, Nuendo, REAPER, FL Studio, Bitwig and Reason sessions grouped into project folders with their versions, backups and caches; MainStage concerts and Gig Performer rigs; ProPresenter libraries. Online-only cloud sessions are labelled.
  - **Plug-ins & libraries**: every AU, VST, VST3, AAX and CLAP plug-in grouped by vendor, with each vendor’s sound libraries and support folders attached — plus libraries from vendors whose plug-ins are no longer installed.
- **Where the space really is** — the Overview disk bar is measured piece by piece in macOS’s own terms (macOS, system volumes, Applications, System Data, your files, iCloud and cloud drives), with nothing counted twice and anything Silt can’t read shown as “Not measured” instead of being folded into another number.
- **Not apps** — macOS counts everything in the Applications folder as “Applications”, including sample-library installers and vendor data folders. Uninstall › Not apps lists those, spots installer copies of libraries you’ve already installed (a common 50–100 GB duplicate for keys rigs) and old plug-in versions installed side by side.
- **System Data by app** — every Library folder macOS counts as System Data, matched to the app it belongs to (using the same rules as Smart Uninstall), to content shared by several apps, to plug-ins, to macOS itself, or to nothing installed at all (usually leftovers from apps you deleted, which you can review and move to the Trash). The Uninstall list shows each app’s System Data next to the app itself.
- **What changed** — Silt remembers past scans (on your Mac only) and shows what grew since about a day ago, how free space moved, and how much it has freed overall. Items that refill with normal use (caches, logs, build files) are marked **Comes back**, and if one regrows after you cleaned it Silt says so — instead of selling the same cache cleanup over and over.
- **Unused plug-in formats** — Silt checks which plug-in hosts you have (Logic, MainStage, Pro Tools, Live, Studio One, Bitwig, REAPER, Gig Performer…) and finds the AAX, VST, VST3 and CLAP copies none of them can load. Audio Units are never touched.
- **Smart Uninstall** — type an app’s name (or press ⌘U) and Silt finds the app plus its support data, caches, preferences, saved state, logs, background helpers and sandbox containers, with the space each one frees. The app list shows when each app was last used and can filter to apps unused for six months. Content shared with other installed software (e.g. Apple’s sound library used by Logic Pro *and* MainStage, or a vendor folder your plug-ins still need) is flagged and kept by default, and your own documents are never selected for you. System-owned files go to the Trash through macOS’s own password prompt.
- **The parts macOS hides** — APFS volumes (Preboot, VM/swap, Recovery, Update), purgeable space, and local Time Machine / update snapshots.
- **Explorer** — drill down through any folder with a live treemap; sizes stream in as they’re measured.
- **Large Files** — the biggest files anywhere in your home folder, filterable by size and how long since they were touched.
- **Duplicates** — byte-for-byte identical files (size → quick fingerprint → full SHA-256), with “keep oldest/newest” auto-select.
- **Automatic updates** — new releases download in the background from GitHub and install when you restart Silt (signed builds only; can be turned off in About).
- **Asks for Full Disk Access, once** — when Silt opens without it, a short prompt explains why, opens the right Settings pane, waits for the switch, and offers to restart. “Not now” or “Don’t ask again” are always there; About has the same controls.
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
| Private | No analytics, no accounts; nothing about your files leaves your Mac. The only network request is the update check against this repo's GitHub Releases (switch it off in About). The renderer runs sandboxed with a strict CSP. |

## Install

**[⬇ Download for Apple Silicon (M1, M2, M3, M4…)](https://github.com/thestealthgoat/Mac-cleaning/releases/latest/download/Silt-Apple-Silicon.dmg)** · **[⬇ Download for Intel Macs](https://github.com/thestealthgoat/Mac-cleaning/releases/latest/download/Silt-Intel.dmg)**

Not sure which Mac you have?  › About This Mac — “Chip: Apple M…” means Apple Silicon, “Processor: Intel” means Intel. All versions are on the [Releases](https://github.com/thestealthgoat/Mac-cleaning/releases) page.

Open the DMG and drag **Silt** into **Applications**. Silt keeps itself up to date after that.

Signed, notarized releases open normally. If a release is marked *unsigned*, macOS blocks the first launch: Open Silt once, then go to *System Settings › Privacy & Security*, scroll down and click **Open Anyway**. (On macOS 14 and earlier, right-click **Silt.app → Open** also works.) Or remove the quarantine flag in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Silt.app
```

For full results, grant Silt **Full Disk Access** in *System Settings › Privacy & Security › Full Disk Access*. It’s optional; without it Mail, Messages, app containers and device backups are simply not measured.

## Build from source

Requires macOS and Node.js 22+.

```bash
git clone https://github.com/thestealthgoat/Mac-cleaning.git silt && cd silt
npm install
npm start          # run the app
npm test           # unit tests (node:test, no extra dependencies)
npm run dist       # build .dmg and .zip into dist/ (signed if a Developer ID is in your keychain)
```

Code signing and notarization are set up in CI; see [docs/SIGNING.md](docs/SIGNING.md).

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
    projects.js    project detection: code markers, rebuildable folders, DAW sessions, rigs
    plugins.js     plug-in identification and vendor ↔ library matching
    uninstall.js   app file discovery, shared-content detection, admin-safe moves
    walk-worker.js worker thread for Large Files, Duplicates and Projects
    apps.js        installed-app index for leftover detection
    report.js      Markdown report
  renderer/        vanilla JS UI (ES modules, no framework, no bundler)
```

Sizes are measured with the system `du` (allocated blocks, hard links counted once, one filesystem only), so they match what is really charged to the disk. APFS clones and snapshots mean some numbers can still differ from the Finder’s — Silt says so where it matters.

## Keyboard shortcuts

| | |
| --- | --- |
| <kbd>⌘1</kbd>–<kbd>⌘7</kbd> | Overview, System Data, Projects, Explorer, Large Files, Duplicates, Uninstall |
| <kbd>⌘U</kbd> | Uninstall an app |
| <kbd>⌘R</kbd> | Rescan |
| <kbd>⌘E</kbd> | Export report |

## Contributing

The most valuable contributions are new entries for [`src/core/catalog.js`](src/core/catalog.js) (a place where macOS or a popular app hoards data), new DAW/project types in [`src/core/projects.js`](src/core/projects.js), and audio vendors in [`src/core/plugins.js`](src/core/plugins.js). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
