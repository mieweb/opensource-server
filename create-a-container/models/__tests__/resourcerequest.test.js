const { resetDb, closeDb } = require('../../tests/helpers/db');
const { Site, ResourceRequest } = require('..');

describe('ResourceRequest.getApprovedResources', () => {
  let site;
  beforeEach(async () => {
    await resetDb();
    site = await Site.create({ name: 's', internalDomain: 'ex.test' });
  });
  afterAll(closeDb);

  const approve = (resourceType, value, reviewedAt) =>
    ResourceRequest.create({
      siteId: site.id, hostname: 'web', username: 'alice',
      resourceType, value, status: 'approved', reviewedAt,
    });

  test('a newer approved zero wins over an older nonzero approval', async () => {
    await approve('swap', 512, new Date('2026-01-01'));
    await approve('swap', 0, new Date('2026-02-01'));
    await approve('memory', 16384, new Date('2026-01-15'));
    expect(await ResourceRequest.getApprovedResources(site.id, 'web', 'alice'))
      .toEqual({ swap: 0, memory: 16384 });
  });
});
