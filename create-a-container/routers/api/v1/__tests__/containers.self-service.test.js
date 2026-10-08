/**
 * Self-service (non-admin) deploy path used by @mieweb/os-cloud-provider
 * (issue #475 §4.4). A regular user must be able to:
 *   - discover usable external domains via GET /containers/new, without
 *     seeing the admin-only Cloudflare credentials on those rows;
 *   - create their own container with one HTTP service, env vars and an rw
 *     volume;
 *   - find it by hostname, update it (services/env/restart), and delete it.
 */

const request = require('supertest');
const { buildApp, bearer } = require('../../../../tests/helpers/app');
const { resetDb, closeDb, createUser, createApiKey } = require('../../../../tests/helpers/db');
const { Site, Node, ExternalDomain, Job, Volume } = require('../../../../models');

describe('non-admin deploy path', () => {
  let app;
  let userKey;
  let site;
  let domain;

  beforeAll(async () => {
    await resetDb();
    app = buildApp();
    await createUser({ uid: 'firstadmin' }); // absorbs the auto-admin promotion
    const user = await createUser({ uid: 'deployer' });
    ({ plainKey: userKey } = await createApiKey(user));
    site = await Site.create({ name: 's', internalDomain: 'ex.test' });
    await Node.create({ siteId: site.id, name: 'n', nodeType: 'dummy' });
    domain = await ExternalDomain.create({
      name: 'apps.example.test',
      siteId: site.id,
      cloudflareApiEmail: 'dns@example.test',
      cloudflareApiKey: 'super-secret-cf-key',
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  const api = (method, path) =>
    request(app)[method](`/api/v1/sites/${site.id}/containers${path}`).set(...bearer(userKey));

  test('GET /containers/new lists domains without Cloudflare credentials', async () => {
    const res = await api('get', '/new');
    expect(res.status).toBe(200);
    expect(res.body.data.externalDomains).toEqual([
      { id: domain.id, name: 'apps.example.test', siteId: site.id },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-cf-key');
  });

  test('create → list by hostname → update → delete', async () => {
    const create = await api('post', '').send({
      hostname: 'myapp',
      template: 'ghcr.io/mieweb/opensource-server/cloud:latest',
      environmentVars: [{ key: 'PORT', value: '8787' }],
      volumes: [{ name: 'data', mountPath: '/mnt/data', mode: 'rw' }],
      services: {
        http: {
          type: 'http',
          internalPort: 8787,
          externalHostname: 'myapp',
          externalDomainId: domain.id,
          authRequired: false,
        },
      },
    });
    expect(create.status).toBe(201);
    const { containerId: id, jobId } = create.body.data;
    expect(await Job.findByPk(jobId)).toBeTruthy();
    expect(await Volume.count({ where: { containerId: id } })).toBe(1);

    const list = await api('get', '?hostname=myapp');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const c = list.body.data[0];
    expect(c.id).toBe(id);
    expect(c.template).toBe('ghcr.io/mieweb/opensource-server/cloud:latest');
    expect(c.environmentVars).toEqual({ PORT: '8787' });
    expect(c.httpEntries[0].externalUrl).toBe('https://myapp.apps.example.test');
    const httpSvc = c.services.find((s) => s.type === 'http');

    // A second create for the same hostname conflicts (the upsert retry path).
    const dup = await api('post', '').send({ hostname: 'myapp', template: 'debian' });
    expect(dup.status).toBe(409);

    const update = await api('put', `/${id}`).send({
      environmentVars: [{ key: 'PORT', value: '9000' }],
      services: {
        old: { id: httpSvc.id, deleted: true },
        http: {
          type: 'http',
          internalPort: 9000,
          externalHostname: 'myapp',
          externalDomainId: domain.id,
          authRequired: true,
        },
      },
      restart: true,
    });
    expect(update.status).toBe(200);
    const after = await api('get', `/${id}`);
    expect(after.body.data.environmentVars).toEqual({ PORT: '9000' });
    const https = after.body.data.services.filter((s) => s.type === 'http');
    expect(https).toHaveLength(1);
    expect(https[0].internalPort).toBe(9000);
    expect(https[0].httpService.authRequired).toBe(true);

    // No job runner here: finish the create job as the runner would, since a
    // container still being created can't be deleted (409 create_in_progress).
    await Job.update({ status: 'success' }, { where: { id: jobId } });
    const del = await api('delete', `/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);
    expect((await api('get', '?hostname=myapp')).body.data).toHaveLength(0);
  });
});
