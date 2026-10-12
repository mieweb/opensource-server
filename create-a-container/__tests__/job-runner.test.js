/**
 * job-runner claimPendingJob: jobs for one container run one at a time (in
 * order), jobs for different containers and container-less jobs run freely.
 */

const { resetDb, closeDb } = require('../tests/helpers/db');
const { Job } = require('../models');
const { claimPendingJob } = require('../job-runner');

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

const create = (id) => ({ command: `node bin/create-container.js --container-id=${id}`, containerId: id });
const reconfigure = (id, extra = '') => ({
  command: `node bin/reconfigure-container.js --container-id=${id}${extra}`,
  containerId: id,
});

test("a container's jobs run one at a time and in order; others are not held up", async () => {
  const a1 = await Job.create({ ...reconfigure(1), status: 'pending' });
  const a2 = await Job.create({ ...reconfigure(1, ' --cpus=2'), status: 'pending' });
  const b1 = await Job.create({ ...reconfigure(2), status: 'pending' });
  const other = await Job.create({ command: 'echo maintenance', status: 'pending' });

  expect((await claimPendingJob()).id).toBe(a1.id);
  // Container 1 is busy: its second job waits; container 2 and the
  // container-less job don't.
  expect((await claimPendingJob()).id).toBe(b1.id);
  expect((await claimPendingJob()).id).toBe(other.id);
  expect(await claimPendingJob()).toBeNull();

  await a1.update({ status: 'success' });
  expect((await claimPendingJob()).id).toBe(a2.id);
});

test('a reconfigure waits for a running create of the same container', async () => {
  await Job.create({ ...create(5), status: 'running' });
  const r = await Job.create({ ...reconfigure(5), status: 'pending' });
  expect(await claimPendingJob()).toBeNull();
  await Job.update({ status: 'failure' }, { where: { containerId: 5, status: 'running' } });
  expect((await claimPendingJob()).id).toBe(r.id);
});
