const crypto = require('crypto');

// Monotonic VMID source for dummy nodes. Seeded from the current time so that
// IDs are unique across separate processes (each `create-container.js` run gets
// its own DummyApi), and incremented so they are never reused within a process.
// Proxmox VMIDs go up to 999999999; we start in a high range to avoid colliding
// with anything a real node would allocate and to leave plenty of headroom.
let nextDummyVmid = 100000 + (Date.now() % 900000000);

/**
 * DummyApi
 *
 * A drop-in stand-in for {@link ProxmoxApi} used by "dummy" nodes (Node.nodeType
 * === 'dummy'). It implements the same method surface so the real container
 * provisioning code path — `bin/create-container.js`, run by the job-runner —
 * executes end-to-end without a Proxmox hypervisor.
 *
 * This is deliberately NOT a short-circuit in the HTTP handler: every method a
 * real run would call is exercised here. Only the Proxmox interactions are
 * faked; everything else (job-runner, model updates, DNS/NetBox hooks, Docker
 * registry digest lookups) runs exactly as it does in production.
 *
 * State is kept in-memory per process keyed by VMID so reads are consistent
 * with writes (e.g. `updateLxcConfig` is reflected by a later `lxcConfig`).
 * The job-runner spawns one process per job, so this lifetime is sufficient.
 */
class DummyApi {
  /**
   * @param {object} [node] - The Node model instance this client represents.
   *   Used only for plausible storage names and logging.
   */
  constructor(node = {}) {
    this.node = node;
    /** @type {Map<number, object>} VMID -> fake LXC config */
    this.configs = new Map();
    console.log(`[DummyApi] initialized for node "${node.name || 'dummy'}" (no Proxmox; provisioning is simulated)`);
  }

  /** Generate a single uppercase hex byte. */
  static _hexByte() {
    return crypto.randomBytes(1)[0].toString(16).padStart(2, '0').toUpperCase();
  }

  /** Build a plausible, locally-administered unicast MAC (02:00:00 prefix). */
  static _fakeMac() {
    // 02:xx:xx has the locally-administered bit set and the multicast bit
    // clear, so it's a valid unicast LAA — not a real vendor OUI.
    return `02:00:00:${DummyApi._hexByte()}:${DummyApi._hexByte()}:${DummyApi._hexByte()}`;
  }

  /** Build a plausible private IPv4 address derived from a VMID. */
  static _fakeIp(vmid) {
    // Spread VMIDs across the 10.x.y.z space using both octets so two dev
    // containers don't collide on the globally-unique ipv4Address column.
    const n = Number(vmid) || 0;
    const third = (Math.floor(n / 254) % 254) + 1;
    const fourth = (n % 254) + 1;
    return `10.0.${third}.${fourth}`;
  }

  /**
   * Ensure a config record exists for a VMID, seeding a net0 with a stable MAC.
   * @param {number} vmid
   * @returns {object}
   */
  _ensureConfig(vmid) {
    let cfg = this.configs.get(vmid);
    if (!cfg) {
      cfg = {
        net0: `name=eth0,hwaddr=${DummyApi._fakeMac()},ip=dhcp,bridge=${this.node.networkBridge || 'vmbr0'}`,
        cores: 4,
        memory: 4096,
        rootfs: `local:vm-${vmid}-disk-0,size=50G`,
      };
      this.configs.set(vmid, cfg);
    }
    return cfg;
  }

  // --- VMID allocation -------------------------------------------------------

  async nextId() {
    // Monotonic and never reused within this process; the time-based seed makes
    // collisions across processes (and thus against the (nodeId, containerId)
    // unique constraint) highly unlikely.
    const vmid = nextDummyVmid++;
    console.log(`[DummyApi] nextId -> ${vmid}`);
    return vmid;
  }

  // --- Storage ---------------------------------------------------------------

  /**
   * Pretend the preferred storage exists and supports the requested content
   * type, so `resolveStorage()` in create-container.js resolves cleanly.
   */
  async datastores(node, content = null) {
    const preferred =
      content === 'vztmpl'
        ? this.node.imageStorage || 'local'
        : this.node.volumeStorage || 'local-lvm';
    return [
      {
        storage: preferred,
        type: 'dir',
        content: content || 'rootdir',
        enabled: 1,
        active: 1,
        total: 1024 * 1024 * 1024 * 1024, // 1 TiB
        avail: 1024 * 1024 * 1024 * 1024,
        used: 0,
      },
    ];
  }

  /**
   * Report the requested template as already present so the OCI pull path is
   * skipped. For other content types (e.g. snippets), report nothing.
   */
  async storageContents(node, storage, content = null) {
    if (content === 'vztmpl') {
      // create-container.js builds the expected volid as
      // `${storage}:vztmpl/${filename}.tar` and checks for its presence. We
      // can't know the exact filename here, so returning a permissive match is
      // not possible; instead we return empty and rely on pullOciImage being a
      // no-op. (Kept explicit for clarity.)
      return [];
    }
    return [];
  }

  async pullOciImage(node, storage, options = {}) {
    console.log(`[DummyApi] pullOciImage(${options.reference || '?'}) -> simulated`);
    return this._fakeUpid('imgpull');
  }

  // --- Container lifecycle ---------------------------------------------------

  _fakeUpid(kind) {
    const rnd = crypto.randomBytes(4).toString('hex');
    return `UPID:dummy:0000${rnd}:00000000:00000000:${kind}::dummy@local:`;
  }

  async createLxc(node, options = {}) {
    const vmid = options.vmid;
    const cfg = this._ensureConfig(vmid);
    if (options.cores != null) cfg.cores = parseInt(options.cores, 10);
    if (options.memory != null) cfg.memory = parseInt(options.memory, 10);
    if (options.rootfs) {
      // rootfs is passed as "storage:sizeGb" at create time; normalize to a
      // readable size= form so parseRootfsSizeGb() can read it back.
      const m = /:(\d+)$/.exec(options.rootfs);
      if (m) cfg.rootfs = `${options.rootfs.split(':')[0]}:vm-${vmid}-disk-0,size=${m[1]}G`;
    }
    if (options.net0) {
      // Preserve the generated hwaddr; create-container passes net0 without one.
      const hwaddr = /hwaddr=([0-9A-Fa-f:]+)/.exec(cfg.net0)?.[1] || DummyApi._fakeMac();
      cfg.net0 = `${options.net0},hwaddr=${hwaddr}`;
    }
    console.log(`[DummyApi] createLxc vmid=${vmid} -> simulated`);
    return this._fakeUpid('vzcreate');
  }

  async cloneLxc(node, vmid, newid, options = {}) {
    this._ensureConfig(newid);
    console.log(`[DummyApi] cloneLxc ${vmid} -> ${newid} (simulated)`);
    return this._fakeUpid('vzclone');
  }

  async getLxcTemplates(node) {
    // Surface whatever template name the container asked for as available, so
    // the Proxmox-template branch of create-container.js can find it.
    return [{ vmid: 8999, name: this._requestedTemplateName || 'dummy-template', template: 1 }];
  }

  async updateLxcConfig(node, vmid, config = {}) {
    const cfg = this._ensureConfig(vmid);
    Object.assign(cfg, config);
    console.log(`[DummyApi] updateLxcConfig vmid=${vmid} keys=${Object.keys(config).join(',') || '(none)'}`);
  }

  async lxcConfig(node, vmid) {
    return { ...this._ensureConfig(vmid) };
  }

  async startLxc(node, vmid) {
    const cfg = this._ensureConfig(vmid);
    cfg._running = true;
    console.log(`[DummyApi] startLxc vmid=${vmid} (simulated)`);
    return this._fakeUpid('vzstart');
  }

  async stopLxc(node, vmid) {
    const cfg = this._ensureConfig(vmid);
    cfg._running = false;
    console.log(`[DummyApi] stopLxc vmid=${vmid} (simulated)`);
    return this._fakeUpid('vzstop');
  }

  async getLxcStatus(node, vmid) {
    const cfg = this._ensureConfig(vmid);
    return { status: cfg._running ? 'running' : 'stopped', vmid };
  }

  async deleteContainer(nodeName, vmid) {
    this.configs.delete(vmid);
    console.log(`[DummyApi] deleteContainer vmid=${vmid} (simulated)`);
    return { data: null };
  }

  // --- Tasks -----------------------------------------------------------------

  async taskStatus(node, upid) {
    return { status: 'stopped', exitstatus: 'OK', upid };
  }

  /** Always succeeds immediately — there is no real task to poll. */
  async waitForTask(node, upid) {
    console.log(`[DummyApi] waitForTask ${upid} -> OK (immediate)`);
    return { status: 'stopped', exitstatus: 'OK' };
  }

  // --- Network introspection -------------------------------------------------

  async lxcInterfaces(node, vmid) {
    const cfg = this._ensureConfig(vmid);
    const mac = /hwaddr=([0-9A-Fa-f:]+)/.exec(cfg.net0)?.[1] || DummyApi._fakeMac();
    return [
      {
        name: 'eth0',
        hwaddr: mac,
        inet: `${DummyApi._fakeIp(vmid)}/24`,
        'ip-addresses': [
          { 'ip-address-type': 'inet', 'ip-address': DummyApi._fakeIp(vmid) },
        ],
      },
    ];
  }

  async getLxcMacAddress(node, vmid) {
    const cfg = this._ensureConfig(vmid);
    const mac = /hwaddr=([0-9A-Fa-f:]+)/.exec(cfg.net0)?.[1] || null;
    console.log(`[DummyApi] getLxcMacAddress vmid=${vmid} -> ${mac}`);
    return mac;
  }

  async getLxcIpAddress(node, vmid) {
    const ip = DummyApi._fakeIp(vmid);
    console.log(`[DummyApi] getLxcIpAddress vmid=${vmid} -> ${ip}`);
    return ip;
  }

  async getLxcNetworkInfo(node, vmid) {
    return {
      macAddress: await this.getLxcMacAddress(node, vmid),
      ipv4Address: await this.getLxcIpAddress(node, vmid),
    };
  }

  // --- ACL / realm (no-ops) --------------------------------------------------

  async updateAcl() {
    console.log('[DummyApi] updateAcl -> no-op');
  }

  async syncLdapRealm() {
    console.log('[DummyApi] syncLdapRealm -> no-op');
  }

  // --- Misc read APIs used by routers ---------------------------------------

  async nodes() {
    return [{ node: this.node.name || 'dummy', status: 'online', type: 'node' }];
  }

  /**
   * Report a cluster-resources snapshot for this dummy node. The live status
   * resolver (utils/container-status.js) calls this with type 'lxc' and treats
   * any returned entry as a running LXC. DummyApi state is per-process, so we
   * derive the snapshot from the database instead: every container on this
   * dummy node that already has a VMID (containerId) is reported as running.
   * This keeps simulated containers showing as `running` after creation.
   * @param {string} [type]
   * @returns {Promise<Array<object>>}
   */
  async clusterResources(type = null) {
    if (type && type !== 'lxc') return [];
    if (this.node.id == null) return [];
    // Lazy require to avoid a load-time cycle (models/node.js -> dummy-api.js).
    const { Container } = require('../models');
    const containers = await Container.findAll({
      where: { nodeId: this.node.id, containerId: { [require('sequelize').Op.ne]: null } },
      attributes: ['containerId', 'hostname'],
    });
    return containers.map((c) => ({
      vmid: c.containerId,
      name: c.hostname,
      type: 'lxc',
      status: 'running',
      node: this.node.name || 'dummy',
    }));
  }
}

module.exports = DummyApi;
