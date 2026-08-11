/**
 * Unit tests for the notifications service — the wire-payload coercions that
 * are easiest to pin below the HTTP layer.
 */

const { resetDb, closeDb } = require('../../../tests/helpers/db');
const { Site, Node, Container, Notification } = require('../../../models');
const svc = require('../service');

describe('notifications service', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('ingest maps ts (epoch seconds) to eventAt', async () => {
    const n = await svc.ingest({
      source: 'lxc-oomd',
      severity: 'critical',
      message: 'x',
      ts: 1771234560,
    });
    expect(n.eventAt.getTime()).toBe(1771234560 * 1000);
  });

  test('ingest leaves eventAt null when ts is absent', async () => {
    const n = await svc.ingest({ source: 's', severity: 'info', message: 'x' });
    expect(n.eventAt).toBeNull();
  });

  test('ingest coerces ctid to a string', async () => {
    const n = await svc.ingest({ source: 's', severity: 'info', message: 'x', ctid: '392' });
    expect(n.ctid).toBe('392');
  });

  test('ingest keeps an explicit owner without touching the container table', async () => {
    const n = await svc.ingest({
      source: 's',
      severity: 'info',
      message: 'x',
      owner: 'alice',
      node: 'unknown',
      ctid: 1,
    });
    expect(n.owner).toBe('alice');
  });

  test('ingest resolves owner from node + ctid when omitted', async () => {
    const site = await Site.create({ name: 'site', internalDomain: 's.test' });
    const node = await Node.create({ name: 'pve1', siteId: site.id });
    await Container.create({
      hostname: 'ct1',
      username: 'dave',
      nodeId: node.id,
      siteId: site.id,
      containerId: '500',
    });

    const n = await svc.ingest({
      source: 's',
      severity: 'warning',
      message: 'x',
      node: 'pve1',
      ctid: 500,
    });
    expect(n.owner).toBe('dave');
  });

  test('acknowledgeAll reports the number acked and skips already-acked rows', async () => {
    await Notification.bulkCreate([
      { source: 's', severity: 'info', owner: 'eve', message: '1' },
      { source: 's', severity: 'info', owner: 'eve', message: '2' },
      { source: 's', severity: 'info', owner: 'eve', message: '3', acknowledgedAt: new Date() },
    ]);
    const result = await svc.acknowledgeAll('eve');
    expect(result.acknowledged).toBe(2);
  });

  // Defense-in-depth: the HTTP validator normally rejects a bad severity first,
  // but the model/DB constraint must also reject it if something bypasses the
  // validator (e.g. a direct model write).
  describe('column constraints', () => {
    test('rejects a severity outside the ENUM', async () => {
      await expect(
        Notification.create({ source: 's', severity: 'emergency', message: 'm' })
      ).rejects.toThrow();
    });

    test('rejects an empty source', async () => {
      await expect(
        Notification.create({ source: '', severity: 'info', message: 'm' })
      ).rejects.toThrow();
    });

    test('rejects an empty message', async () => {
      await expect(
        Notification.create({ source: 's', severity: 'info', message: '' })
      ).rejects.toThrow();
    });

    test('accepts each valid severity', async () => {
      for (const severity of Notification.SEVERITIES) {
        // eslint-disable-next-line no-await-in-loop
        const n = await Notification.create({ source: 's', severity, message: 'm' });
        expect(n.severity).toBe(severity);
      }
    });
  });
});
