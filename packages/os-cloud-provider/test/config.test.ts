import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { DeployContext } from '@mieweb/deploy-contract';
import {
  appName,
  ConfigError,
  DEFAULT_IMAGE,
  instanceFromArgv,
  normalizeInstanceUrl,
  resolveInstanceUrl,
  resolveTargetSettings,
} from '../src/config.ts';

function ctx(manifest: Record<string, unknown>, targetConfig: Record<string, unknown> = {}): DeployContext {
  return {
    root: '/tmp',
    target: 'mieweb',
    manifest,
    targetConfig,
    argv: [],
    logger: { info() {}, warn() {}, error() {} },
    signal: new AbortController().signal,
  };
}

describe('normalizeInstanceUrl', () => {
  test('canonicalizes host case, trailing slash and /api/v1', () => {
    assert.equal(normalizeInstanceUrl('https://OS.mieweb.org/'), 'https://os.mieweb.org');
    assert.equal(normalizeInstanceUrl('http://localhost:3000/api/v1/'), 'http://localhost:3000');
    assert.equal(normalizeInstanceUrl('https://x.test/manager'), 'https://x.test/manager');
  });
  test('rejects non-http and credentials', () => {
    assert.throws(() => normalizeInstanceUrl('ftp://x'), ConfigError);
    assert.throws(() => normalizeInstanceUrl('https://u:p@x'), ConfigError);
    assert.throws(() => normalizeInstanceUrl('not a url'), ConfigError);
  });
});

test('instance URL precedence: env → targetConfig → default', () => {
  assert.equal(resolveInstanceUrl({ MIEWEB_OS_URL: 'http://a.test' }, { instanceUrl: 'http://b.test' }), 'http://a.test');
  assert.equal(resolveInstanceUrl({}, { instanceUrl: 'http://b.test' }), 'http://b.test');
  assert.equal(resolveInstanceUrl({}, {}), 'https://os.mieweb.org');
});

test('instanceFromArgv', () => {
  assert.equal(instanceFromArgv(['--instance', 'http://a.test']), 'http://a.test');
  assert.equal(instanceFromArgv(['-x', '--instance=http://b.test']), 'http://b.test');
  assert.equal(instanceFromArgv([]), undefined);
  for (const bad of [['--instance'], ['--instance='], ['--instance', ''], ['--instance', '--other']]) {
    assert.throws(() => instanceFromArgv(bad), /--instance needs a Manager URL/, JSON.stringify(bad));
  }
});

describe('appName', () => {
  test('must be a DNS label', () => {
    assert.equal(appName({ name: 'my-app1' }), 'my-app1');
    for (const bad of [undefined, '', 'My_App', '-x', 'x-', 'a'.repeat(64)]) {
      assert.throws(() => appName({ name: bad }), ConfigError, String(bad));
    }
  });
});

describe('resolveTargetSettings', () => {
  test('siteId is optional (chosen at deploy time), env overrides config, must be an integer', () => {
    assert.equal(resolveTargetSettings(ctx({ name: 'app' }), {}).siteId, undefined);
    assert.equal(resolveTargetSettings(ctx({ name: 'app' }, { siteId: 3 }), { MIEWEB_OS_SITE_ID: '5' }).siteId, 5);
    assert.throws(() => resolveTargetSettings(ctx({ name: 'app' }), { MIEWEB_OS_SITE_ID: 'x' }), /MIEWEB_OS_SITE_ID must be/);
    assert.throws(() => resolveTargetSettings(ctx({ name: 'app' }, { siteId: 'one' }), {}), /positive integer/);
  });

  test('defaults', () => {
    const s = resolveTargetSettings(ctx({ name: 'app' }, { siteId: 3 }), {});
    assert.equal(s.siteId, 3);
    assert.equal(s.image, DEFAULT_IMAGE);
    assert.equal(s.port, 8787);
    assert.equal(s.externalHostname, 'app');
    assert.equal(s.authRequired, false);
    assert.deepEqual(s.services, []);
    assert.equal(s.instanceUrl, 'https://os.mieweb.org');
  });

  test('overrides and extra services', () => {
    const s = resolveTargetSettings(
      ctx(
        { name: 'app' },
        {
          siteId: '4',
          image: 'ghcr.io/x/y:pr-1',
          port: 3000,
          externalHostname: 'www-app',
          domain: 'apps.example.test',
          authRequired: true,
          services: [{ type: 'tcp', internalPort: 22 }, { type: 'srv', internalPort: 5060, dnsName: '_sip._udp' }],
        },
      ),
      { MIEWEB_OS_URL: 'http://localhost:3000' },
    );
    assert.equal(s.siteId, 4);
    assert.equal(s.image, 'ghcr.io/x/y:pr-1');
    assert.equal(s.port, 3000);
    assert.equal(s.externalHostname, 'www-app');
    assert.equal(s.domain, 'apps.example.test');
    assert.equal(s.authRequired, true);
    assert.equal(s.services.length, 2);
    assert.equal(s.instanceUrl, 'http://localhost:3000');
  });

  test('rejects bad service/port config', () => {
    const base = { siteId: 1 };
    assert.throws(() => resolveTargetSettings(ctx({ name: 'a' }, { ...base, port: 70000 }), {}), /TCP port/);
    assert.throws(() => resolveTargetSettings(ctx({ name: 'a' }, { ...base, services: [{ type: 'http', internalPort: 1 }] }), {}), /tcp, udp or srv/);
    assert.throws(() => resolveTargetSettings(ctx({ name: 'a' }, { ...base, services: [{ type: 'srv', internalPort: 1 }] }), {}), /dnsName/);
    assert.throws(() => resolveTargetSettings(ctx({ name: 'a' }, { ...base, authRequired: 'yes' }), {}), /boolean/);
  });
});
