'use strict';

const fs = require('fs');
const path = require('path');
const { run, runPlist } = require('./exec');
const { HOME } = require('./paths');

// JXA snippet that asks Foundation for the same capacity numbers the Finder uses.
// "Important usage" capacity includes purgeable space macOS will free on demand.
const CAPACITY_JXA = `
ObjC.import("Foundation");
var u = $.NSURL.fileURLWithPath("/");
var keys = ["NSURLVolumeTotalCapacityKey","NSURLVolumeAvailableCapacityKey","NSURLVolumeAvailableCapacityForImportantUsageKey","NSURLVolumeAvailableCapacityForOpportunisticUsageKey"];
var r = u.resourceValuesForKeysError($(keys), null);
var o = {};
keys.forEach(function (k) { var v = r.objectForKey(k); o[k] = (v && !v.isNil()) ? v.doubleValue : null; });
JSON.stringify(o);
`;

async function capacity() {
  const res = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', CAPACITY_JXA], { timeout: 20000 });
  if (res.code === 0) {
    try {
      const o = JSON.parse(res.stdout.trim());
      const total = o.NSURLVolumeTotalCapacityKey;
      const free = o.NSURLVolumeAvailableCapacityKey;
      const important = o.NSURLVolumeAvailableCapacityForImportantUsageKey;
      return {
        total,
        free,
        availableWithPurgeable: Math.max(important ?? free, free),
        purgeable: Math.max(0, (important ?? free) - free),
        source: 'foundation',
      };
    } catch {
      /* fall through */
    }
  }
  const st = fs.statfsSync('/');
  return {
    total: st.blocks * st.bsize,
    free: st.bavail * st.bsize,
    availableWithPurgeable: st.bavail * st.bsize,
    purgeable: 0,
    source: 'statfs',
  };
}

const ROLE_INFO = {
  System: 'The read-only, sealed macOS system. Can only shrink by updating macOS.',
  Data: 'Your apps, files, caches and everything else that is writable.',
  Preboot: 'Boot files and staged macOS updates. Large values often mean leftover update data.',
  Recovery: 'macOS Recovery. Required; cannot be removed safely.',
  VM: 'Swap files and the sleep image. Grows under memory pressure; restarting frees it.',
  Update: 'Scratch space for macOS software updates.',
};

/** Describe every volume in the APFS container that holds the startup disk. */
async function apfsVolumes() {
  const info = await runPlist('/usr/sbin/diskutil', ['info', '-plist', '/']);
  const list = await runPlist('/usr/sbin/diskutil', ['apfs', 'list', '-plist']);
  if (!info || !list) return null;
  const ref = info.APFSContainerReference;
  const container = (list.Containers || []).find((c) => c.ContainerReference === ref);
  if (!container) return null;
  return {
    container: ref,
    capacity: container.CapacityCeiling,
    free: container.CapacityFree,
    volumes: (container.Volumes || []).map((v) => {
      const role = (v.Roles && v.Roles[0]) || 'Other';
      return {
        name: v.Name,
        role,
        device: v.DeviceIdentifier,
        bytes: v.CapacityInUse,
        description: ROLE_INFO[role] || 'Additional APFS volume (another macOS install, or a volume you created).',
      };
    }),
  };
}

/** Local APFS snapshots of the startup volume group (Time Machine and OS update snapshots). */
async function localSnapshots() {
  const res = await run('/usr/bin/tmutil', ['listlocalsnapshots', '/'], { timeout: 20000 });
  if (res.code !== 0) return { available: false, snapshots: [] };
  const snapshots = res.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('com.apple.'))
    .map((name) => {
      const m = name.match(/(\d{4}-\d{2}-\d{2}-\d{6})/);
      return {
        name,
        kind: name.includes('TimeMachine') ? 'timemachine' : name.includes('os.update') ? 'os-update' : 'other',
        date: m ? m[1] : null,
      };
    });
  return { available: true, snapshots };
}

/**
 * Full Disk Access check. These folders are TCC-protected; if we can list them,
 * the app (or the terminal running it in development) has Full Disk Access.
 */
function hasFullDiskAccess() {
  const probes = [
    path.join(HOME, 'Library', 'Mail'),
    path.join(HOME, 'Library', 'Safari'),
    path.join(HOME, 'Library', 'Application Support', 'com.apple.TCC'),
  ];
  for (const p of probes) {
    try {
      fs.readdirSync(p);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      return false;
    }
  }
  return false;
}

async function machine() {
  const model = await run('/usr/sbin/sysctl', ['-n', 'hw.model']);
  const ver = await run('/usr/bin/sw_vers', ['-productVersion']);
  const arch = await run('/usr/bin/uname', ['-m']);
  return { model: model.stdout.trim(), macos: ver.stdout.trim(), arch: arch.stdout.trim() };
}

module.exports = { capacity, apfsVolumes, localSnapshots, hasFullDiskAccess, machine, ROLE_INFO };
