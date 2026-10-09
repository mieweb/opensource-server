/**
 * job-runner claimPendingJob: jobs for one container run one at a time (in
 * order), jobs for different containers and container-less jobs run freely.
 */

const { resetDb, closeDb } = require('../tests/helpers/db');
const { Job } = require('../models');
const { claimPendingJob } = require('../job-runner');
const { jobContainerId } = require('../utils/job-target');

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

const create = (id) => `node bin/create-container.js --container-id=${id}`;
const reconfigure = (id, extra = '') => `node bin/reconfigure-container.js --container-id=${id}${extra}`;

test('jobContainerId parses only an exact --container-id flag', () => {
  expect(jobContainerId(reconfigure(7, ' --memory=2048'))).toBe(7);
  expect(jobContainerId(create(12))).toBe(12);
  expect(jobContainerId('node bin/other.js --container-id=7x')).toBeNull();
  expect(jobContainerId('echo hi')).toBeNull();
});

test("a container's jobs run one at a time and in order; others are not held up", async () => {
  const a1 = await Job.create({ command: reconfigure(1), status: 'pending' });
  const a2 = await Job.create({ command: reconfigure(1, ' --cpus=2'), status: 'pending' });
  const b1 = await Job.create({ command: reconfigure(2), status: 'pending' });
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
  await Job.create({ command: create(5), status: 'running' });
  const r = await Job.create({ command: reconfigure(5), status: 'pending' });
  expect(await claimPendingJob()).toBeNull();
  await Job.update({ status: 'failure' }, { where: { command: create(5) } });
  expect((await claimPendingJob()).id).toBe(r.id);
});
