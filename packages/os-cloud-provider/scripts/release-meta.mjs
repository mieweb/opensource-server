#!/usr/bin/env node
/**
 * Decide what (if anything) a GitHub release publishes to npm. CI runs this
 * from .github/workflows/release.yml; run it locally the same way:
 *
 *   node scripts/release-meta.mjs v2026.10.3            # full release
 *   node scripts/release-meta.mjs v2026.10.3-rc.1 --prerelease
 *
 * Prints `key=value` lines (also appended to $GITHUB_OUTPUT when set):
 *   version   npm version from the tag (v2026.10.3 → 2026.10.3)
 *   dist-tag  `latest`, or `next` for prereleases
 *   skip      `true` when that version is already on npm
 * Exits non-zero when the tag isn't a version or @mieweb/deploy-contract
 * isn't an npmjs release (a preview/git build would break npm installs).
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const REGISTRY = 'https://registry.npmjs.org';
const [tag, ...flags] = process.argv.slice(2);
const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};

if (!tag) fail('usage: release-meta.mjs <tag> [--prerelease]');
const version = tag.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail(`Release tag ${tag} is not a semver version`);
const distTag = flags.includes('--prerelease') ? 'next' : 'latest';

/** `npm view <spec> version` against npmjs; null when it doesn't exist. */
function npmView(spec) {
  try {
    return execFileSync('npm', ['view', spec, 'version', '--registry', REGISTRY], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // a 404 just means "not published"
    }).trim() || null;
  } catch {
    return null;
  }
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const contract = pkg.dependencies?.['@mieweb/deploy-contract'] ?? '';
if (/-pr\d|github:|git\+/.test(contract)) {
  fail(`@mieweb/deploy-contract is '${contract}' (a preview/git build). Switch it to an npmjs release before publishing.`);
}
if (!npmView(`@mieweb/deploy-contract@${contract}`)) fail(`@mieweb/deploy-contract@${contract} is not on npmjs`);

const skip = npmView(`${pkg.name}@${version}`) !== null;
const out = `version=${version}\ndist-tag=${distTag}\nskip=${skip}\n`;
process.stdout.write(out);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
if (skip && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${pkg.name}@${version} is already on npm; skipping.\n`);
}
