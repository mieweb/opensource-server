#!/usr/bin/env node
/**
 * Stamp a PR preview build of the provider (os-cloud-provider-preview.yml).
 * Run locally the same way:
 *
 *   node scripts/stamp-preview.mjs <pr-number> <run-number>
 *
 * - version:       <base version>-pr<PR>.<run>
 * - default image: ghcr.io/mieweb/opensource-server/cloud:pr-<PR> (what
 *   build-images.yml pushes for the PR; `latest` only exists after a release)
 *
 * Prints `version=<v>` (also appended to $GITHUB_OUTPUT when set). Edits
 * package.json and src/config.ts in place; meant for CI checkouts.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const [pr, run] = process.argv.slice(2);
if (!/^\d+$/.test(pr ?? '') || !/^\d+$/.test(run ?? '')) {
  console.error('usage: stamp-preview.mjs <pr-number> <run-number>');
  process.exit(1);
}

const pkgUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
pkg.version = `${pkg.version.replace(/-.*$/, '')}-pr${pr}.${run}`;
writeFileSync(pkgUrl, `${JSON.stringify(pkg, null, 2)}\n`);

// Rewrite the DEFAULT_IMAGE constant's tag, whatever its quoting/spacing.
const cfgUrl = new URL('../src/config.ts', import.meta.url);
const cfg = readFileSync(cfgUrl, 'utf8');
const re = /(export const DEFAULT_IMAGE\s*=\s*(['"])ghcr\.io\/mieweb\/opensource-server\/cloud):[^'"]+\2/;
if (!re.test(cfg)) {
  console.error('::error::DEFAULT_IMAGE not found in src/config.ts');
  process.exit(1);
}
writeFileSync(cfgUrl, cfg.replace(re, `$1:pr-${pr}$2`));

const out = `version=${pkg.version}\n`;
process.stdout.write(out);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
