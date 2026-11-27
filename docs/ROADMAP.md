# Silt: competitors, gaps and roadmap

*Last reviewed November 2026.*

This compares Silt with the Mac storage tools people actually use, lists what each one misses, and sets out what Silt builds next. Pull requests against any item are welcome.

## The field

| App | Model | Strong at | Weak at |
| --- | --- | --- | --- |
| **CleanMyMac** (MacPaw) | Subscription (~$40/yr) or ~$120+ one-time | One-click "Smart Care", Space Lens map, menu bar monitor, app updater, cloud cleanup, malware scan | Cleans caches that come straight back; System Data stays a black box; many tools unrelated to storage; price |
| **DaisyDisk** | ~$10 one-time | Fast sunburst map of any disk (external, network); shows purgeable and hidden space | Only a map: no advice, no uninstaller, no history |
| **Sensei** | Paid | Cleaner, uninstaller, plus hardware monitoring (SSD health, battery, temperatures) | Storage advice is generic; closed source |
| **Pearcleaner** | Free, source-available ("fair-code", not OSI open source) | Uninstaller with orphaned-file finder, Finder extension, watches the Trash for dragged-out apps, Homebrew manager | Uninstall-focused; no System Data breakdown or disk evaluation |
| **Mole** (tw93) | Free open-source CLI, paid GUI | Terminal-first cleaning, dev-artifact purge, status/monitoring | GUI is paid; CLI isn't approachable for most people |
| **AppCleaner** | Free | Drag-an-app uninstall, SmartDelete | Uninstall only; no shared-file awareness |
| **OnyX** | Free | Maintenance scripts, rebuilding indexes | Not a storage tool; easy to misuse |
| **GrandPerspective / OmniDiskSweeper** | Free | Simple size maps | No explanations or cleanup guidance |
| **macOS Storage settings** | Built in | Recommendations, empty Trash after 30 days | "System Data" is one opaque bar |

Common complaints about the category (Apple Community, Malwarebytes forums, Macworld reviews): System Data "comes back" days after a cleanup; cleaners delete caches that just regrow; subscriptions for an app that runs locally; and a general distrust of what gets deleted.

## Where Silt is already ahead

- **Free and MIT-licensed**: the whole app, not a free CLI with a paid GUI.
- **System Data, explained by location**: 50+ places, APFS volumes (Preboot, VM, Recovery, Update), purgeable space and local snapshots, each with a plain-English "why".
- **Knows what files belong to**: code projects with rebuildable folders, DAW sessions, MainStage and Gig Performer rigs, and plug-in vendors with their sound libraries. No competitor does this.
- **Uninstall that knows about shared content**: keeps Apple's sound library when Logic still needs it, and keeps vendor folders that other plug-ins use. Your documents are never pre-selected.
- **Everything goes to the Trash**, with root-owned items moved through macOS's own password prompt.

## Gaps closed in 0.2

| Gap | Who had it | What Silt does now |
| --- | --- | --- |
| "Why does System Data keep coming back?" | Nobody | **What changed**: Silt keeps a local history of scans and shows what grew since about a day ago, how free space moved, and its lifetime total freed |
| Cleaners counting regrowing caches as wins | Nobody, and it's the top complaint | Items that refill are marked **Comes back**; totals split into space that stays freed and space that refills; Silt notes when something you cleaned has regrown |
| Unused apps | CleanMyMac | Uninstall shows when each app was last used and filters to apps unused for 6 months (falls back to the app's own settings dates when Spotlight has no record) |
| Plug-in formats no host loads | Nobody | Finds AAX / VST / VST3 / CLAP copies that none of your installed hosts can load, and moves them to the Trash on request. Audio Units are never suggested |
| "System Data is a few hundred GB, but whose is it?" | Nobody (DaisyDisk shows folders, not owners) | **System Data by app**: every Library folder matched to an installed app, shared content, plug-ins, macOS, developer tools, or no installed app (leftovers you can review and move to the Trash). Uninstall shows each app's System Data alongside the app |
| Apple's sound library installed twice | Nobody | Overview warns when both the old `/Library/Application Support/Logic` and the new `Logic Pro Library.bundle` are large, and points to Sound Library Manager |

## Next

Ordered by value to users and how well it fits Silt's "explain, then move to the Trash" model.

### Soon (0.3)

1. **Menu bar free-space monitor and low-space alert.** A small free-space meter, plus a notification when free space drops below a threshold or something grows by more than X GB in a day (using the new history). *(Matches CleanMyMac Menu and Sensei.)*
2. **Catch apps dragged to the Trash.** When an app lands in the Trash, offer its leftovers using the existing Smart Uninstall plan. *(Matches Pearcleaner Sentinel and AppCleaner SmartDelete.)*
3. **Free up iCloud and cloud-drive space safely.** List the largest downloaded iCloud Drive files and offer "Remove download" (`brctl evict`). The file stays in iCloud, so this is reversible. *(CleanMyMac has cloud cleanup.)*
4. **Scheduled scans with a weekly summary.** Opt-in background scan that only records history and notifies, never deletes.
5. **Scan other drives.** A volume picker for Explorer and Large Files covering external and network disks. *(DaisyDisk.)*

### Music and keys-rig depth (Silt's niche)

6. **Relocate big libraries to an external drive**, using only the vendor-supported method: Logic and MainStage Sound Library Manager, Native Access library location, Spectrasonics STEAM folder alias, Kontakt library paths. Silt measures, explains the steps, and verifies afterwards.
7. **Session clean-up.** Find unused audio files, freeze files, old "Project File Backups", Ableton `Backup` folders and duplicate bounces inside a project, and show each project's lasting savings.
8. **Duplicate sample content across drives.** The same library installed in two places, or on both internal and external disks.
9. **VST2 copies of plug-ins that also exist as VST3**, flagged for review. Older sessions may still reference VST2, so this stays opt-in and well explained.

### Later

10. **`silt` command-line tool** (`silt scan --json`, `silt changes`) for power users and scripts, using the same core modules. *(Mole's strength.)*
11. **Disk health**: SMART status and, where macOS exposes it, SSD wear. *(Sensei.)*
12. **Background items**: list login items, launch agents and daemons, flagging ones whose app is gone.
13. **Scheduled clean rules** for "Comes back" items with age limits (for example, Xcode DerivedData older than 30 days), opt-in and logged. *(Hazel-style.)*
14. **Localisation** and an accessibility pass.

## Deliberately not doing

- **Malware scanning, "RAM cleaning" and "speed boosters".** They are outside storage, and in macOS they're mostly snake oil.
- **Thinning universal binaries.** It breaks code signatures and app updates for a few hundred MB.
- **Similar-photo cleanup inside Photos libraries.** Editing a Photos library from outside Photos risks corrupting it. Use Photos' own Duplicates album.
- **Permanent deletion by default.** Silt always uses the Trash.

## Sources

- [Macworld: best Mac cleaners tested](https://www.macworld.com/article/673271/best-mac-cleaner-tested-compared.html)
- [Setapp: best Mac cleaner apps 2026](https://setapp.com/how-to/best-mac-cleaner-software)
- [Cindori: best Mac cleaner apps 2026](https://cindori.com/reviews/best-mac-cleaner-apps-2026)
- [CleanMyMac release notes](https://macpaw.com/cleanmymac/whats-new) and [MacRumors on the 2024 redesign](https://www.macrumors.com/2024/10/16/macpaw-releases-redesigned-cleanmymac/)
- [Pearcleaner on GitHub](https://github.com/alienator88/Pearcleaner)
- [Mole on GitHub](https://github.com/tw93/Mole)
- [Malwarebytes forum: safe Mac cleaners](https://forums.malwarebytes.com/topic/315282-what-are-the-safe-to-use-mac-os-system-cleaners)
- [Apple Community: System Data returning after cleaning](https://origin-discussions2-us-dr-prz.apple.com/en/thread/256018854)
