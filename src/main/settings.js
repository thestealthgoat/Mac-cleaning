'use strict';

// Tiny JSON settings store in the app's user-data folder.
const fs = require('fs');
const path = require('path');

const DEFAULTS = { autoUpdate: true };

function create(dir) {
  const file = path.join(dir, 'settings.json');
  let cache = null;
  const read = () => {
    if (cache) return cache;
    try {
      cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      cache = { ...DEFAULTS };
    }
    return cache;
  };
  return {
    get: (key) => read()[key],
    all: () => ({ ...read() }),
    set(key, value) {
      if (!(key in DEFAULTS) || typeof value !== typeof DEFAULTS[key]) throw new Error(`Invalid setting: ${key}`);
      cache = { ...read(), [key]: value };
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cache, null, 2));
      return cache;
    },
  };
}

module.exports = { create, DEFAULTS };
