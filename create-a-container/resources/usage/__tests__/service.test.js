/** Unit tests for the usage service — repository and collection are mocked. */

jest.mock('../repository');
jest.mock('../../../utils/usage-collection');

const repo = require('../repository');
const { collectUsage } = require('../../../utils/usage-collection');
const svc = require('../service');
const { ApiError } = require('../../../middlewares/api');

beforeEach(() => {
  jest.resetAllMocks();
});

describe('usage service', () => {
  test('getSiteUsage throws ApiError 404 for an unknown site without collecting', async () => {
    repo.findSiteById.mockResolvedValue(null);
    const err = await svc.getSiteUsage(999).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'site_not_found' });
    expect(collectUsage).not.toHaveBeenCalled();
  });

  test('getSiteUsage collects for the site and aggregates samples by owner', async () => {
    repo.findSiteById.mockResolvedValue({ id: 7 });
    collectUsage.mockResolvedValue({
      samples: [
        { owner: 'alice', status: 'running', cpuUsed: 0.5, memUsed: 100 },
        { owner: 'alice', status: 'stopped', cpuUsed: 0.25, memUsed: 50 },
        { owner: null, status: 'running' },
      ],
      findings: [{ kind: 'unattributed', vmid: '104', tagOwner: null, dbOwner: null }],
      unknownNodeRows: 2,
      capacity: { cpuCores: 32, memBytes: 64e9, diskBytes: 1e12 },
    });

    const report = await svc.getSiteUsage(7);

    expect(collectUsage).toHaveBeenCalledWith({ siteId: 7 });
    expect(report.generatedAt).toBeInstanceOf(Date);
    expect(report.capacity).toEqual({ cpuCores: 32, memBytes: 64e9, diskBytes: 1e12 });
    expect(report.findings).toHaveLength(1);
    expect(report.unknownNodeRows).toBe(2);
    // Aggregated: one row per owner, null owner last.
    expect(report.owners.map((o) => o.owner)).toEqual(['alice', null]);
    expect(report.owners[0]).toMatchObject({
      containerCount: 2,
      runningCount: 1,
      cpuUsed: 0.75,
      memUsed: 150,
    });
  });
});
