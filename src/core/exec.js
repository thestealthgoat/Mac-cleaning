'use strict';

const { execFile, spawn } = require('child_process');

/** Run a binary with arguments (never through a shell). Resolves even on non-zero exit. */
function run(cmd, args = [], { timeout = 120000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), error });
    });
    if (input != null) {
      child.stdin.end(input);
    }
  });
}

/** Run a command and parse its plist stdout as JSON via the built-in plutil. */
async function runPlist(cmd, args) {
  const res = await run(cmd, args);
  if (res.code !== 0 || !res.stdout.trim()) return null;
  const conv = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: res.stdout });
  if (conv.code !== 0) return null;
  try {
    return JSON.parse(conv.stdout);
  } catch {
    return null;
  }
}

/** Limit concurrency of async tasks. */
function pool(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

module.exports = { run, runPlist, pool, spawn };
