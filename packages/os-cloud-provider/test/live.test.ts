/**
 * Live inner-loop test against a real Manager (`make dev`: SQLite + the
 * DummyApi mock hypervisor at http://localhost:3000). Skipped unless
 * MIEWEB_OS_LIVE=1.
 *
 *   MIEWEB_OS_LIVE=1 MIEWEB_OS_URL=http://localhost:3000 \
 *   MIEWEB_OS_TOKEN=<key from POST /api/v1/apikeys> MIEWEB_OS_SITE_ID=1 \
 *   pnpm test:live
 *
 * MIEWEB_OS_LIVE_IMAGE / MIEWEB_OS_LIVE_IMAGE2 pick the images for the create
 * and image-change steps (default: the public `nodejs` and `base` images,
 * since `cloud:latest` only exists after the first release).
 *
 * The code sync is disabled here (DummyApi containers have no SSH).
 * Exercises the real API mapping + job polling end to end (create → update →
 * image-change recreate → destroy) and runs the contract's live conformance
 * suite with an `applyIds` hook. It creates and deletes a container named
 * `os-provider-live-<random>` on that site.
 */

import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';
import type { DeployContext, ResourceHandle } from '@mieweb/deploy-contract';
import { runProviderConformance } from '@mieweb/deploy-contract/testkit';
import { createProvider } from '../src/index.ts';

const live = process.env.MIEWEB_OS_LIVE === '1';
const siteId = Number(process.env.MIEWEB_OS_SITE_ID ?? '1');
const name = `os-provider-live-${randomBytes(3).toString('hex')}`;
const image = process.env.MIEWEB_OS_LIVE_IMAGE ?? 'ghcr.io/mieweb/opensource-server/nodejs:latest';
const image2 = process.env.MIEWEB_OS_LIVE_IMAGE2 ?? 'ghcr.io/mieweb/opensource-server/base:latest';
// The DummyApi hypervisor has no real SSH endpoint, so skip the code sync.
const targetConfig = { siteId, image, sync: false };

function ctx(overrides: Partial<DeployContext> = {}): DeployContext {
  return {
    root: tmpdir(),
    target: 'mieweb',
    manifest: { name, vars: { HELLO: 'world' } },
    mieweb: {},
    targetConfig,
    argv: [],
    logger: { info: (m) => console.log(m), warn: (m) => console.warn(m), error: (m) => console.error(m) },
    signal: AbortSignal.timeout(10 * 60 * 1000),
    ...overrides,
  };
}

describe('live Manager', { skip: !live && 'set MIEWEB_OS_LIVE=1 (see file header)' }, () => {
  const provider = createProvider(process.env, { pollIntervalMs: 500 });

  test('whoami', async () => {
    const who = await provider.whoami!(ctx());
    assert.equal(who.authenticated, true);
  });

  test('deploy → redeploy (same handle) → image change → destroy', async () => {
    const first = await provider.deploy(ctx());
    assert.equal(first.resources.length, 1);
    assert.equal(first.resources[0]!.kind, 'container');
    assert.match(first.resources[0]!.id, /\S/);

    const second = await provider.deploy(ctx({ manifest: { name, vars: { HELLO: 'again' } } }));
    assert.deepEqual(second.resources, first.resources);

    const third = await provider.deploy(
      ctx({ targetConfig: { ...targetConfig, image: image2 } }),
    );
    assert.equal(third.resources[0]!.binding, name);

    await provider.destroy!(ctx());
  });

  test('conformance (live, with applyIds)', async () => {
    const report = await runProviderConformance(provider, {
      target: 'mieweb',
      manifest: { name },
      targetConfig,
      root: tmpdir(),
      live: true,
      applyIds: (m: Readonly<Record<string, unknown>>, _r: readonly ResourceHandle[]) => ({ ...m }),
    });
    await provider.destroy!(ctx());
    assert.deepEqual(report.failures, []);
  });
});
