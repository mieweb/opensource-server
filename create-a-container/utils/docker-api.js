const axios = require('axios');

const MANAGER_NODE_LABEL = 'org.mieweb.opensource-server.node-id';
const MANAGER_CONTAINER_LABEL = 'org.mieweb.opensource-server.container-id';

function parseDockerHost(host) {
  const raw = host || process.env.DOCKER_HOST || 'unix:///var/run/docker.sock';

  if (raw.startsWith('unix://')) {
    const url = new URL(raw);
    return {
      baseURL: 'http://docker',
      socketPath: decodeURIComponent(url.pathname),
    };
  }

  if (raw.startsWith('tcp://')) {
    const url = new URL(raw);
    return {
      baseURL: `http://${url.host}`,
    };
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return {
      baseURL: raw.replace(/\/$/, ''),
    };
  }

  throw new Error(
    `Unsupported Docker host "${raw}". Supported formats: unix://, tcp://, http://, https://`,
  );
}

function parseEnvString(envStr) {
  const env = {};
  if (!envStr || typeof envStr !== 'string') return env;

  for (const pair of envStr.split('\0')) {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      env[pair.substring(0, eq)] = pair.substring(eq + 1);
    }
  }

  return env;
}

function envObjectToArray(envObj) {
  return Object.entries(envObj || {}).map(([key, value]) => `${key}=${value}`);
}

function envArrayToObject(envArray) {
  const env = {};
  for (const pair of envArray || []) {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      env[pair.substring(0, eq)] = pair.substring(eq + 1);
    }
  }
  return env;
}

function task(kind, id = '') {
  return `docker:${kind}:${id}`;
}

class DockerApi {
  constructor(node = {}) {
    this.node = node;
    const dockerHost = node.apiUrl || process.env.DOCKER_HOST || 'unix:///var/run/docker.sock';
    const dockerConfig = parseDockerHost(dockerHost);

    this.http = axios.create({
      ...dockerConfig,
      timeout: 120000,
    });

    this.lastPulledImage = null;
  }

  async request(method, url, options = {}) {
    const response = await this.http.request({
      method,
      url,
      params: options.params,
      data: options.data,
      responseType: options.responseType,
    });
    return response.data;
  }

  labels(vmid) {
    return {
      [MANAGER_NODE_LABEL]: String(this.node.id || this.node.name || 'docker'),
      [MANAGER_CONTAINER_LABEL]: String(vmid),
    };
  }

  labelFilters(extra = {}) {
    return JSON.stringify({
      label: [
        `${MANAGER_NODE_LABEL}=${String(this.node.id || this.node.name || 'docker')}`,
        ...Object.entries(extra).map(([k, v]) => `${k}=${v}`),
      ],
    });
  }

  async findContainerByVmid(vmid) {
    const containers = await this.request('get', '/containers/json', {
      params: {
        all: true,
        filters: this.labelFilters({ [MANAGER_CONTAINER_LABEL]: String(vmid) }),
      },
    });

    if (!containers.length) {
      throw new Error(`Docker container for manager id ${vmid} not found`);
    }

    return containers[0];
  }

  async inspectByVmid(vmid) {
    const container = await this.findContainerByVmid(vmid);
    return this.request('get', `/containers/${container.Id}/json`);
  }

  async nextId() {
    const existing = await this.request('get', '/containers/json', {
      params: {
        all: true,
        filters: this.labelFilters(),
      },
    });

    const used = new Set(
      existing
        .map((c) => c.Labels?.[MANAGER_CONTAINER_LABEL])
        .filter(Boolean)
        .map(Number),
    );

    let candidate = Date.now() % 1000000000;
    while (used.has(candidate)) candidate += 1;
    return candidate;
  }

  async nodes() {
    const info = await this.request('get', '/info');
    return [
      {
        node: this.node.name || info.Name || 'docker',
        status: 'online',
        type: 'node',
      },
    ];
  }

  async nodeNetwork() {
    return [];
  }

  async clusterResources(type = null) {
    if (type && type !== 'lxc' && type !== 'vm') return [];

    const containers = await this.request('get', '/containers/json', {
      params: {
        all: true,
        filters: this.labelFilters(),
      },
    });

    return containers.map((c) => ({
      vmid: Number(c.Labels?.[MANAGER_CONTAINER_LABEL]),
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      type: 'lxc',
      status: c.State === 'running' ? 'running' : 'stopped',
      node: this.node.name || 'docker',
    }));
  }

  async datastores() {
    return [
      {
        storage: 'docker',
        type: 'docker',
        content: 'container',
        enabled: 1,
        active: 1,
        total: 0,
        avail: 0,
        used: 0,
      },
    ];
  }

  async storageContents() {
    return [];
  }

  async pullOciImage(node, storage, options = {}) {
    const image = options.reference;
    if (!image) throw new Error('Docker image reference is required');

    this.lastPulledImage = image;

    const stream = await this.request('post', '/images/create', {
      params: { fromImage: image },
      responseType: 'stream',
    });

    await new Promise((resolve, reject) => {
      stream.on('data', () => {});
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    return task('pull', image);
  }

  async createLxc(node, options = {}) {
    if (!this.lastPulledImage) {
      throw new Error('No Docker image has been pulled for this create operation');
    }

    const vmid = options.vmid;
    const name = options.hostname || `manager-${vmid}`;

    const body = {
      Image: this.lastPulledImage,
      Hostname: name,
      Labels: this.labels(vmid),
      Env: [],
      HostConfig: {
        NetworkMode: 'bridge',
      },
    };

    if (options.memory) {
      body.HostConfig.Memory = Number(options.memory) * 1024 * 1024;
    }

    if (options.cores) {
      body.HostConfig.NanoCpus = Number(options.cores) * 1000000000;
    }

    const created = await this.request('post', '/containers/create', {
      params: { name },
      data: body,
    });

    return task('create', created.Id);
  }

  async getLxcTemplates() {
    return [];
  }

  async cloneLxc() {
    throw new Error('Docker nodes do not support cloning Proxmox LXC templates; use a Docker image template');
  }

  async lxcConfig(node, vmid) {
    const inspect = await this.inspectByVmid(vmid);

    const network = Object.values(inspect.NetworkSettings?.Networks || {})[0] || {};
    const env = (inspect.Config?.Env || []).join('\0');
    const entrypoint = Array.isArray(inspect.Config?.Entrypoint)
      ? inspect.Config.Entrypoint.join(' ')
      : inspect.Config?.Entrypoint || null;

    return {
      hostname: inspect.Config?.Hostname || inspect.Name?.replace(/^\//, ''),
      env,
      entrypoint,
      cores: inspect.HostConfig?.NanoCpus
        ? Math.round(inspect.HostConfig.NanoCpus / 1000000000)
        : null,
      memory: inspect.HostConfig?.Memory
        ? Math.round(inspect.HostConfig.Memory / 1024 / 1024)
        : null,
      rootfs: null,
      net0: `name=eth0,hwaddr=${network.MacAddress || ''},ip=${network.IPAddress || 'dhcp'},bridge=docker0`,
    };
  }

  async recreateForConfig(vmid, config = {}) {
    const inspect = await this.inspectByVmid(vmid);
    const existing = await this.findContainerByVmid(vmid);

    const wasRunning = inspect.State?.Running;
    const name = inspect.Name?.replace(/^\//, '') || inspect.Config?.Hostname || `manager-${vmid}`;

    const env = envArrayToObject(inspect.Config?.Env || []);
    const deleteList = typeof config.delete === 'string' ? config.delete.split(',') : [];

    if (deleteList.includes('env')) {
      for (const key of Object.keys(env)) delete env[key];
    }

    Object.assign(env, parseEnvString(config.env));

    let entrypoint = inspect.Config?.Entrypoint || undefined;
    if (deleteList.includes('entrypoint')) entrypoint = undefined;
    if (config.entrypoint) entrypoint = config.entrypoint.split(' ');

    if (wasRunning) {
      await this.request('post', `/containers/${existing.Id}/stop`).catch(() => {});
    }

    await this.request('delete', `/containers/${existing.Id}`, {
      params: { force: true },
    });

    const body = {
      Image: inspect.Config.Image,
      Hostname: inspect.Config.Hostname,
      Labels: {
        ...(inspect.Config.Labels || {}),
        ...this.labels(vmid),
      },
      Env: envObjectToArray(env),
      Entrypoint: entrypoint,
      HostConfig: {
        ...(inspect.HostConfig || {}),
        NetworkMode: inspect.HostConfig?.NetworkMode || 'bridge',
      },
    };

    delete body.HostConfig.Binds;
    delete body.HostConfig.Mounts;
    delete body.HostConfig.PortBindings;

    await this.request('post', '/containers/create', {
      params: { name },
      data: body,
    });
  }

  async updateLxcConfig(node, vmid, config = {}) {
    const hasContainerConfigChanges =
      config.env !== undefined ||
      config.entrypoint !== undefined ||
      String(config.delete || '').includes('env') ||
      String(config.delete || '').includes('entrypoint');

    if (hasContainerConfigChanges) {
      await this.recreateForConfig(vmid, config);
    }

    const container = await this.findContainerByVmid(vmid);
    const update = {};

    if (config.memory) update.Memory = Number(config.memory) * 1024 * 1024;
    if (config.cores) update.NanoCpus = Number(config.cores) * 1000000000;

    if (Object.keys(update).length > 0) {
      await this.request('post', `/containers/${container.Id}/update`, {
        data: update,
      });
    }
  }

  async startLxc(node, vmid) {
    const container = await this.findContainerByVmid(vmid);
    await this.request('post', `/containers/${container.Id}/start`);
    return task('start', container.Id);
  }

  async stopLxc(node, vmid) {
    const container = await this.findContainerByVmid(vmid);
    await this.request('post', `/containers/${container.Id}/stop`).catch((err) => {
      if (err.response?.status !== 304) throw err;
    });
    return task('stop', container.Id);
  }

  async getLxcStatus(node, vmid) {
    const inspect = await this.inspectByVmid(vmid);
    return {
      status: inspect.State?.Running ? 'running' : 'stopped',
      vmid,
    };
  }

  async deleteContainer(node, vmid, force = false) {
    const container = await this.findContainerByVmid(vmid);
    await this.request('delete', `/containers/${container.Id}`, {
      params: { force: !!force },
    });
    return { data: null };
  }

  async waitForTask() {
    return { status: 'stopped', exitstatus: 'OK' };
  }

  async lxcInterfaces(node, vmid) {
    const inspect = await this.inspectByVmid(vmid);
    const network = Object.values(inspect.NetworkSettings?.Networks || {})[0] || {};

    return [
      {
        name: 'eth0',
        hwaddr: network.MacAddress || null,
        inet: network.IPAddress ? `${network.IPAddress}/24` : null,
        'ip-addresses': network.IPAddress
          ? [{ 'ip-address-type': 'inet', 'ip-address': network.IPAddress }]
          : [],
      },
    ];
  }

  async getLxcMacAddress(node, vmid) {
    const interfaces = await this.lxcInterfaces(node, vmid);
    return interfaces[0]?.hwaddr || null;
  }

  async getLxcIpAddress(node, vmid, maxRetries = 10, retryDelay = 3000) {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const interfaces = await this.lxcInterfaces(node, vmid);
      const ip = interfaces[0]?.['ip-addresses']?.[0]?.['ip-address'];

      if (ip) return ip;

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    return null;
  }

  async getLxcNetworkInfo(node, vmid) {
    return {
      macAddress: await this.getLxcMacAddress(node, vmid),
      ipv4Address: await this.getLxcIpAddress(node, vmid),
    };
  }

  async updateAcl() {
    // Docker has no Proxmox-style ACL path. No-op to keep NodeApi contract.
  }

  async syncLdapRealm() {
    // Docker has no Proxmox LDAP realm. No-op to keep NodeApi contract.
  }
}

module.exports = DockerApi;