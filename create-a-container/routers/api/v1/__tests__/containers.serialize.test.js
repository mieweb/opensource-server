/**
 * serializeContainer — per-service lastAccessedAt plus the container-level
 * rollup (max across services; null when never accessed). Exercised directly
 * against stub objects so no Proxmox/status machinery is involved.
 */

const { serializeContainer } = require('../containers');
const { closeDb } = require('../../../../tests/helpers/db');

afterAll(async () => {
  await closeDb();
});

function stubService(overrides = {}) {
  return {
    id: 10,
    type: 'http',
    internalPort: 80,
    httpService: null,
    transportService: null,
    dnsService: null,
    lastAccessedAt: null,
    ...overrides,
  };
}

function stubContainer(services) {
  return {
    id: 1,
    containerId: '101',
    hostname: 'testct',
    username: 'alice',
    collaboratorNames: () => [],
    ipv4Address: '10.254.1.5',
    macAddress: null,
    template: null,
    creationJobId: null,
    entrypoint: null,
    environmentVars: null,
    nvidiaRequested: false,
    node: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    services,
  };
}

const site = { externalIp: null };

test('services carry lastAccessedAt and the container rolls up the max', () => {
  const older = new Date('2026-08-11T09:00:00Z');
  const newer = new Date('2026-08-11T10:30:00Z');
  const out = serializeContainer(
    stubContainer([
      stubService({ id: 10, lastAccessedAt: older }),
      stubService({ id: 11, internalPort: 8080, lastAccessedAt: newer }),
      stubService({ id: 12, internalPort: 9090, lastAccessedAt: null }),
    ]),
    site,
    'running',
  );
  expect(out.services.map((s) => s.lastAccessedAt)).toEqual([older, newer, null]);
  expect(out.lastAccessedAt).toEqual(newer);
});

test('container lastAccessedAt is null when no service was ever accessed', () => {
  const out = serializeContainer(stubContainer([stubService()]), site, 'running');
  expect(out.lastAccessedAt).toBeNull();
});

test('container lastAccessedAt is null with no services', () => {
  const out = serializeContainer(stubContainer([]), site, 'running');
  expect(out.lastAccessedAt).toBeNull();
});
