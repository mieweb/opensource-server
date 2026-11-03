/**
 * Config loading: the committed ./config.json ships defaults; the agent (or
 * a developer) overlays environment-specific values in ./config.local.json —
 * the same split in development and production. MAIL_HELPER_DIR overrides
 * the directory for tests and dev stacks.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`mail-helper: cannot read ${file}: ${err.message}`);
  }
}

/** Plain-object deep merge; local values win, arrays replace. */
function merge(base, overlay) {
  if (overlay === null || overlay === undefined) return base;
  if (Array.isArray(base) || Array.isArray(overlay) || typeof base !== 'object' || typeof overlay !== 'object') {
    return overlay;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    out[key] = merge(base[key], value);
  }
  return out;
}

function loadConfig(dir = process.env.MAIL_HELPER_DIR || path.join(__dirname, '..')) {
  const defaults = readJson(path.join(dir, 'config.json'));
  if (!defaults) throw new Error(`mail-helper: missing config.json in ${dir}`);
  return merge(defaults, readJson(path.join(dir, 'config.local.json')));
}

module.exports = { loadConfig, merge };
