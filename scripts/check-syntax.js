'use strict';
// Syntax-check every source file (CommonJS with `node --check`, renderer ES modules by parsing as modules).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) {
      const isModule = full.includes(`${path.sep}renderer${path.sep}`) && !e.name.startsWith('errors');
      try {
        if (isModule) execFileSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(full) });
        else execFileSync(process.execPath, ['--check', full]);
      } catch (err) {
        failed++;
        console.error(`✖ ${path.relative(root, full)}\n${err.stderr || err.message}`);
      }
    }
  }
}
walk(path.join(root, 'src'));
walk(path.join(root, 'test'));
if (failed) process.exit(1);
console.log('Syntax OK');
