const { resetDb, closeDb } = require('../../../tests/helpers/db');
const { OAuthPayload } = require('../../../models');
const { sweep } = require('../service/sweep');

const DAY = 24 * 60 * 60 * 1000;

describe('OAuth sweep', () => {
  beforeAll(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  const row = (model, id, fields = {}) => OAuthPayload.create({ model, id, payload: {}, ...fields });

  test('removes expired records, dead grants and stale grant-less dynamic clients only', async () => {
    const now = new Date();
    const old = new Date(now - 31 * DAY);
    const future = new Date(now.getTime() + DAY);

    await row('Client', 'stale', { createdAt: old });
    await row('Client', 'fresh', { createdAt: now });
    await row('Client', 'used', { createdAt: old });
    await row('Client', 'owned', { createdAt: old, accountId: 'alice' });

    await row('Grant', 'live-grant', { clientId: 'used', expiresAt: future });
    await row('RefreshToken', 'live-rt', { grantId: 'live-grant', expiresAt: future });
    await row('Grant', 'dead-grant', { clientId: 'stale', expiresAt: future });
    await row('RefreshToken', 'dead-rt', { grantId: 'dead-grant', expiresAt: new Date(now - 1000) });
    await row('Interaction', 'old-interaction', { expiresAt: new Date(now - 1000) });

    const result = await sweep(now);
    expect(result).toEqual({ expired: 2, grants: 1, clients: 1 });
    const left = (await OAuthPayload.findAll()).map((r) => `${r.model}:${r.id}`).sort();
    expect(left).toEqual([
      'Client:fresh', 'Client:owned', 'Client:used', 'Grant:live-grant', 'RefreshToken:live-rt',
    ]);
  });
});
