/**
 * bin/create-container.js must record the provider ID (VMID) as soon as the
 * VM exists. If a later step fails (configuration, ACLs, ...), the record
 * still points at the VM, so deleting it removes the VM node-side instead of
 * orphaning it.
 *
 * Runs the real job script as a child process against the test database, on
 * a dummy node made to fail right after the VM is created.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { resetDb, closeDb, createUser } = require('../../tests/helpers/db');
const { Site, Node, Container } = require('../../models');

describe('create-container.js: provider ID is persisted before configuration', () => {
  let preload;

  beforeAll(async () => {
    await resetDb();
    preload = path.join(os.tmpdir(), `fail-after-create-${process.pid}.js`);
    // Make one node call fail (chosen by FAIL_AT) after the VM was cloned.
    fs.writeFileSync(
      preload,
      `const DummyApi = require(${JSON.stringify(path.join(__dirname, '..', '..', 'utils', 'dummy-api'))});
       const boom = async () => { throw new Error('injected: node error after create'); };
       DummyApi.prototype[process.env.FAIL_AT] = boom;`,
    );
  });

  afterAll(async () => {
    fs.rmSync(preload, { force: true });
    await closeDb();
  });

  let user;
  let site;
  let node;
  beforeAll(async () => {
    user = await createUser({ uid: 'vmidowner' });
    site = await Site.create({ name: 's', internalDomain: 'ex.test' });
    node = await Node.create({ siteId: site.id, name: 'n', nodeType: 'dummy' });
  });

  test.each([
    ['waitForTask', 'the clone task itself fails'],
    ['updateLxcConfig', 'configuring the cloned VM fails'],
    ['lxcConfig', 'reading the template config fails'],
  ])('%s: a failure once the VM may exist (%s) leaves the VMID on the record', async (failAt) => {
    const c = await Container.create({
      hostname: `half-made-${failAt.toLowerCase()}`,
      username: user.uid,
      nodeId: node.id,
      siteId: site.id,
      template: 'dummy-template',
    });

    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'create-container.js'), `--container-id=${c.id}`], {
      env: { ...process.env, NODE_OPTIONS: `--require ${preload}`, FAIL_AT: failAt },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toMatch(/injected: node error after create/);

    await c.reload();
    expect(c.containerId).toMatch(/^\d+$/);
  });
});
