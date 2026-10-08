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
    // Fail the first call after the clone (the template-config read).
    fs.writeFileSync(
      preload,
      `const DummyApi = require(${JSON.stringify(path.join(__dirname, '..', '..', 'utils', 'dummy-api'))});
       DummyApi.prototype.lxcConfig = async () => { throw new Error('injected: node error after create'); };`,
    );
  });

  afterAll(async () => {
    fs.rmSync(preload, { force: true });
    await closeDb();
  });

  test('a failure after creation leaves the VMID on the record', async () => {
    const user = await createUser({ uid: 'vmidowner' });
    const site = await Site.create({ name: 's', internalDomain: 'ex.test' });
    const node = await Node.create({ siteId: site.id, name: 'n', nodeType: 'dummy' });
    const c = await Container.create({
      hostname: 'half-made',
      username: user.uid,
      nodeId: node.id,
      siteId: site.id,
      template: 'dummy-template',
    });

    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'create-container.js'), `--container-id=${c.id}`], {
      env: { ...process.env, NODE_OPTIONS: `--require ${preload}` },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toMatch(/injected: node error after create/);

    await c.reload();
    expect(c.containerId).toMatch(/^\d+$/);
  });
});
