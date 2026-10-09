/**
 * bin/reconfigure-container.js on a Docker node: attaching a volume must
 * actually add its bind (Docker has no mpN, so binds are compared directly),
 * and every recreate (env, binds) must store the new container ID, or later
 * steps and the record point at a container that no longer exists.
 *
 * Runs the real job script as a child process against the test database; the
 * Docker Engine is an in-memory fake installed over DockerApi.request.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { resetDb, closeDb, createUser } = require('../../tests/helpers/db');
const { Site, Node, Container, Volume } = require('../../models');

const ENGINE = `
const fs = require('fs');
const DockerApi = require(${JSON.stringify(path.join(__dirname, '..', '..', 'utils', 'docker-api'))});
const STATE = process.env.FAKE_DOCKER_STATE;
const load = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s));
DockerApi.prototype.request = async function (method, url, options = {}) {
  const s = load();
  const m = /^\\/containers\\/([^/]+)(?:\\/(json|stop|start|update))?$/.exec(url);
  const err404 = () => Object.assign(new Error('no such container ' + (m && m[1])), { response: { status: 404 } });
  try {
    if (method === 'post' && url === '/containers/create') {
      const id = 'c' + s.next++;
      s.containers[id] = { Id: id, Name: '/' + options.params.name, State: { Running: false },
        Config: { Image: options.data.Image, Hostname: options.data.Hostname, Env: options.data.Env, Labels: options.data.Labels },
        HostConfig: options.data.HostConfig,
        NetworkSettings: { Networks: { bridge: { MacAddress: '02:42:ac:11:00:02', IPAddress: '172.17.0.2' } } } };
      return { Id: id };
    }
    if (!m) throw new Error('fake engine: unsupported ' + method + ' ' + url);
    const c = s.containers[m[1]];
    if (!c) throw err404();
    if (method === 'get' && m[2] === 'json') return c;
    if (method === 'post' && m[2] === 'stop') { c.State.Running = false; return {}; }
    if (method === 'post' && m[2] === 'start') { c.State.Running = true; return {}; }
    if (method === 'post' && m[2] === 'update') return {};
    if (method === 'delete' && !m[2]) { delete s.containers[m[1]]; return {}; }
    throw new Error('fake engine: unsupported ' + method + ' ' + url);
  } finally {
    save(s);
  }
};
`;

describe('reconfigure-container.js on a Docker node', () => {
  let dir;
  let preload;
  let state;
  let user;
  let site;
  let node;

  beforeAll(async () => {
    await resetDb();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-docker-'));
    preload = path.join(dir, 'engine.js');
    state = path.join(dir, 'state.json');
    fs.writeFileSync(preload, ENGINE);
    user = await createUser({ uid: 'dockerowner' });
    site = await Site.create({ name: 's', internalDomain: 'ex.test' });
    node = await Node.create({ siteId: site.id, name: 'd', nodeType: 'docker', apiUrl: 'unix:///var/run/docker.sock' });
  });

  afterAll(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    await closeDb();
  });

  test('a newly attached volume gets its bind, and the recreated container ID is stored', async () => {
    fs.writeFileSync(
      state,
      JSON.stringify({
        next: 2,
        containers: {
          c1: {
            Id: 'c1', Name: '/app', State: { Running: true },
            Config: { Image: 'img', Hostname: 'app', Env: ['A=1'], Labels: {} },
            HostConfig: { NetworkMode: 'bridge' },
            NetworkSettings: { Networks: { bridge: { MacAddress: '02:42:ac:11:00:02', IPAddress: '172.17.0.2' } } },
          },
        },
      }),
    );
    const c = await Container.create({
      hostname: 'app', username: user.uid, nodeId: node.id, siteId: site.id, containerId: 'c1', template: 'docker.io/library/img:latest',
      environmentVars: JSON.stringify({ A: '2' }),
    });
    await Volume.create({ containerId: c.id, name: 'data', mountPath: '/mnt/data', mode: 'rw', scope: 'container', builtin: false, status: 'pending' });

    const run = spawnSync(process.execPath, ['-r', preload, path.join(__dirname, '..', 'reconfigure-container.js'), `--container-id=${c.id}`], {
      env: { ...process.env, FAKE_DOCKER_STATE: state },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect({ status: run.status, out: run.stdout + run.stderr }).toMatchObject({ status: 0 });

    const engine = JSON.parse(fs.readFileSync(state, 'utf8'));
    await c.reload();
    const live = engine.containers[c.containerId];
    expect(live).toBeDefined(); // the record points at a container that exists
    expect(Object.keys(engine.containers)).toEqual([c.containerId]);
    expect(live.State.Running).toBe(true);
    expect(live.HostConfig.Binds).toEqual([expect.stringMatching(/\/app\/data:\/mnt\/data$/)]);
    expect(live.Config.Env).toContain('A=2');
  });
});
