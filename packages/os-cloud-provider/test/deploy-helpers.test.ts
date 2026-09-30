import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { Container } from '../src/api-types.ts';
import { buildEnv, envUnchanged, MANAGED_ENV, normalizeImageRef, pickDomain, planServices, servicesUnchanged } from '../src/deploy.ts';

describe('normalizeImageRef (mirrors the Manager)', () => {
  const cases: [string, string][] = [
    ['nginx', 'docker.io/library/nginx:latest'],
    ['nginx:1.27', 'docker.io/library/nginx:1.27'],
    ['bitnami/redis', 'docker.io/bitnami/redis:latest'],
    ['ghcr.io/mieweb/opensource-server/cloud', 'ghcr.io/mieweb/opensource-server/cloud:latest'],
    ['ghcr.io/mieweb/opensource-server/cloud:sha-abc', 'ghcr.io/mieweb/opensource-server/cloud:sha-abc'],
    ['localhost:5000/app', 'localhost:5000/library/app:latest'],
  ];
  for (const [input, want] of cases) {
    test(input, () => assert.equal(normalizeImageRef(input), want));
  }
  test('idempotent', () => {
    for (const [, want] of cases) assert.equal(normalizeImageRef(want), want);
  });
});

describe('pickDomain', () => {
  const form = { siteId: 1, nvidiaAvailable: false, externalDomains: [{ id: 3, name: 'a.test' }, { id: 4, name: 'b.test' }] };
  test('defaults to the first (site default) domain', () => assert.deepEqual(pickDomain(form, undefined), { id: 3, name: 'a.test' }));
  test('by name or id', () => {
    assert.equal(pickDomain(form, 'b.test').id, 4);
    assert.equal(pickDomain(form, 3).name, 'a.test');
  });
  test('unknown / none', () => {
    assert.throws(() => pickDomain(form, 'c.test'), /not available.*a\.test \(3\)/);
    assert.throws(() => pickDomain({ ...form, externalDomains: [] }, undefined), /no external domains/);
  });
});

describe('buildEnv', () => {
  const base = {
    settings: { port: 8787, start: undefined },
  };

  test('vars + secrets + managed keys, full set', () => {
    const warnings: string[] = [];
    const env = buildEnv({
      ...base,
      manifest: { vars: { GREETING: 'hi', FLAGS: { a: 1 }, PORT: '1' } },
      env: { MIEWEB_OS_SECRET_API_KEY: 's3cret', MIEWEB_OS_SECRET_: 'ignored', OTHER: 'x' },
      warn: (m) => warnings.push(m),
    });
    const map = Object.fromEntries(env.map((e) => [e.key, e.value]));
    assert.equal(map.GREETING, 'hi');
    assert.equal(map.FLAGS, '{"a":1}');
    assert.equal(map.API_KEY, 's3cret');
    assert.equal(map.OTHER, undefined);
    assert.equal(map[''], undefined);
    assert.equal(map.PORT, '8787');
    assert.equal(map.MIEWEB_S3_SECRET_ACCESS_KEY, map.MINIO_ROOT_PASSWORD);
    assert.ok(map.MINIO_ROOT_PASSWORD!.length >= 24);
    assert.equal(map.MIEWEB_LIBSQL_URL, 'http://127.0.0.1:8080');
    assert.equal(map.MIEWEB_APP_START, undefined);
    assert.deepEqual(warnings, ['Env var PORT is managed by the provider; ignoring the app\'s value']);
  });

  test('reuses the existing MinIO credentials', () => {
    const env = buildEnv({
      ...base,
      manifest: {},
      env: {},
      existing: { [MANAGED_ENV.minioPassword]: 'keep-me', [MANAGED_ENV.minioUser]: 'u' },
      warn: () => {},
    });
    const map = Object.fromEntries(env.map((e) => [e.key, e.value]));
    assert.equal(map.MINIO_ROOT_PASSWORD, 'keep-me');
    assert.equal(map.MINIO_ROOT_USER, 'u');
    assert.equal(map.MIEWEB_S3_ACCESS_KEY_ID, 'u');
  });
});

describe('planServices', () => {
  const http = { internalPort: 8787, externalHostname: 'app', externalDomainId: 7, authRequired: false };
  const svc = (id: number, port: number, host = 'app', domainId = 7): NonNullable<Container['services']>[number] => ({
    id,
    type: 'http',
    internalPort: port,
    httpService: { externalHostname: host, externalDomainId: domainId, backendProtocol: 'http', authRequired: true },
  });

  test('empty → create http', () => {
    assert.deepEqual(planServices([], http, []), { http: { type: 'http', ...http } });
  });

  test('matching http is kept (authRequired toggled)', () => {
    assert.deepEqual(planServices([svc(1, 8787)], http, []), {
      'keep-1': { id: 1, type: 'http', internalPort: 8787, authRequired: false },
    });
  });

  test('changed port / host / duplicates are replaced', () => {
    const plan = planServices([svc(1, 3000), svc(2, 8787, 'other'), svc(3, 8787), svc(4, 8787)], http, []);
    assert.deepEqual(Object.keys(plan).sort(), ['del-1', 'del-2', 'del-4', 'keep-3']);
    assert.equal(plan['del-1']!.deleted, true);
  });

  test('non-http services are preserved; missing extras added', () => {
    const current: Container['services'] = [
      svc(1, 8787),
      { id: 2, type: 'transport', internalPort: 22, transportService: { protocol: 'tcp', externalPort: 2222 } },
    ];
    const plan = planServices(current, http, [
      { type: 'tcp', internalPort: 22 },
      { type: 'udp', internalPort: 53 },
      { type: 'srv', internalPort: 5060, dnsName: '_sip._udp' },
    ]);
    assert.deepEqual(plan['extra-1'], { type: 'udp', internalPort: 53 });
    assert.deepEqual(plan['extra-2'], { type: 'srv', internalPort: 5060, dnsName: '_sip._udp' });
    assert.equal(plan['extra-0'], undefined);
    assert.equal(Object.values(plan).some((p) => p.id === 2), false);
  });
});

describe('change detection', () => {
  test('servicesUnchanged', () => {
    const cur: Container['services'] = [
      { id: 1, type: 'http', internalPort: 8787, httpService: { externalHostname: 'a', externalDomainId: 7, backendProtocol: 'http', authRequired: false } },
    ];
    assert.equal(servicesUnchanged(cur, { 'keep-1': { id: 1, type: 'http', internalPort: 8787, authRequired: false } }), true);
    assert.equal(servicesUnchanged(cur, { 'keep-1': { id: 1, type: 'http', internalPort: 8787, authRequired: true } }), false);
    assert.equal(servicesUnchanged(cur, { http: { type: 'http', internalPort: 1 } }), false);
  });
  test('envUnchanged', () => {
    assert.equal(envUnchanged({ A: '1', B: '2' }, [{ key: 'B', value: '2' }, { key: 'A', value: '1' }]), true);
    assert.equal(envUnchanged({ A: '1', B: '2' }, [{ key: 'A', value: '1' }]), false);
    assert.equal(envUnchanged({ A: '1' }, [{ key: 'A', value: '2' }]), false);
  });
});
