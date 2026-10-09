#!/usr/bin/env node
/**
 * Point the provider's DEFAULT_IMAGE (src/config.ts) at a given tag of
 * ghcr.io/mieweb/opensource-server/cloud. Used by CI so each published build
 * deploys the image built for it: a release → `cloud:<release tag>`, a PR
 * preview → `cloud:pr-<N>`. Run locally the same way:
 *
 *   node scripts/set-default-image.mjs v2026.10.3
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const IMAGE_REPO = 'ghcr.io/mieweb/opensource-server/cloud';

export function setDefaultImageTag(tag) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag ?? '')) throw new Error(`Invalid image tag: ${JSON.stringify(tag)}`);
  const cfgUrl = new URL('../src/config.ts', import.meta.url);
  const cfg = readFileSync(cfgUrl, 'utf8');
  // Rewrite the constant's tag, whatever its quoting/spacing.
  const re = /(export const DEFAULT_IMAGE\s*=\s*(['"])ghcr\.io\/mieweb\/opensource-server\/cloud):[^'"]+\2/;
  if (!re.test(cfg)) throw new Error('DEFAULT_IMAGE not found in src/config.ts');
  writeFileSync(cfgUrl, cfg.replace(re, `$1:${tag}$2`));
  return `${IMAGE_REPO}:${tag}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(setDefaultImageTag(process.argv[2]));
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
