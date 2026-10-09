#!/usr/bin/env node
/**
 * Stamp a PR preview build of the provider (os-cloud-provider-preview.yml).
 * Run locally the same way:
 *
 *   node scripts/stamp-preview.mjs <pr-number> <run-number> [<run-attempt>]
 *
 * - version:       <base version>-pr<PR>.<run>.<attempt> (a rerun keeps the run
 *   number, and a published version is immutable, so the attempt is part of it)
 * - default image: ghcr.io/mieweb/opensource-server/cloud:pr-<PR> (what
 *   build-images.yml pushes for the PR; `latest` only exists after a release)
 *
 * Prints `version=<v>` (also appended to $GITHUB_OUTPUT when set). Edits
 * package.json and src/config.ts in place; meant for CI checkouts.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { setDefaultImageTag } from './set-default-image.mjs';

const [pr, run, attempt = '1'] = process.argv.slice(2);
if (!/^\d+$/.test(pr ?? '') || !/^\d+$/.test(run ?? '') || !/^\d+$/.test(attempt)) {
  console.error('usage: stamp-preview.mjs <pr-number> <run-number> [<run-attempt>]');
  process.exit(1);
}

const pkgUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
pkg.version = `${pkg.version.replace(/-.*$/, '')}-pr${pr}.${run}.${attempt}`;
writeFileSync(pkgUrl, `${JSON.stringify(pkg, null, 2)}\n`);

setDefaultImageTag(`pr-${pr}`);

const out = `version=${pkg.version}\n`;
process.stdout.write(out);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
