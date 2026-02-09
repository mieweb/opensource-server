/**
 * MockProxmoxApi - Simulates Proxmox VE API for testing purposes
 * 
 * This mock implements the same interface as ProxmoxApi but returns
 * simulated responses instead of making actual API calls. Used when
 * TEST_ENABLED=true to allow testing container creation flows without
 * a real Proxmox server.
 */

class MockProxmoxApi {
  constructor(baseUrl, tokenId = null, secret = null, options = {}) {
    this.baseUrl = baseUrl || 'https://mock-proxmox:8006';
    this.tokenId = tokenId;
    this.secret = secret;
    this.options = options;
    
    // Internal state for simulation
    this._nextVmid = 100;
    this._containers = new Map();
    this._tasks = new Map();
    this._taskCounter = 0;
  }

  /**
   * Simulate authentication (always succeeds)
   */
  async authenticate(username, password) {
    console.log(`[MockProxmox] Authenticated as ${username}`);
    return;
  }

  /**
   * Get list of nodes
   */
  async nodes() {
    return [{
      node: 'test-node',
      status: 'online',
      cpu: 0.15,
      maxcpu: 8,
      mem: 4294967296,
      maxmem: 17179869184,
      disk: 21474836480,
      maxdisk: 107374182400,
      uptime: 86400
    }];
  }

  /**
   * Get node network configuration
   */
  async nodeNetwork(node) {
    return [
      {
        iface: 'vmbr0',
        type: 'bridge',
        bridge_ports: 'eth0',
        address: '10.0.0.1',
        netmask: '255.255.255.0',
        gateway: '10.0.0.254',
        active: 1
      },
      {
        iface: 'eth0',
        type: 'eth',
        active: 1
      }
    ];
  }

  /**
   * Get cluster resources
   */
  async clusterResources(type = null) {
    const resources = [
      { type: 'node', node: 'test-node', status: 'online' }
    ];
    
    // Add any containers we've created
    for (const [vmid, container] of this._containers) {
      resources.push({
        type: 'lxc',
        vmid,
        node: 'test-node',
        name: container.hostname,
        status: container.status
      });
    }
    
    if (type) {
      return resources.filter(r => r.type === type);
    }
    return resources;
  }

  /**
   * Get container configuration
   */
  async lxcConfig(node, vmid) {
    const container = this._containers.get(vmid);
    if (!container) {
      throw new Error(`Container ${vmid} not found`);
    }
    return {
      hostname: container.hostname,
      cores: container.cores || 4,
      memory: container.memory || 4096,
      net0: `name=eth0,bridge=vmbr0,hwaddr=${container.macAddress},ip=dhcp`,
      ostemplate: container.ostemplate,
      rootfs: 'local:vm-' + vmid + '-disk-0,size=8G'
    };
  }

  /**
   * Get datastores
   */
  async datastores(node, content = null) {
    const stores = [
      {
        storage: 'local',
        type: 'dir',
        content: 'vztmpl,images,rootdir,backup',
        active: 1,
        enabled: 1,
        shared: 0,
        avail: 53687091200,
        total: 107374182400,
        used: 53687091200
      },
      {
        storage: 'local-lvm',
        type: 'lvm',
        content: 'rootdir,images',
        active: 1,
        enabled: 1,
        shared: 0
      }
    ];
    
    if (content) {
      return stores.filter(s => s.content.includes(content));
    }
    return stores;
  }

  /**
   * Get storage contents
   */
  async storageContents(node, storage, content = null) {
    // Return empty array - simulate no pre-existing templates
    return [];
  }

  /**
   * Get next available VMID
   */
  async nextId() {
    return this._nextVmid++;
  }

  /**
   * Create a task UPID for simulation
   */
  _createTask(type, node = 'test-node') {
    const taskId = ++this._taskCounter;
    const upid = `UPID:${node}:${Date.now().toString(16)}:${taskId}:${type}:mock:root@pam:`;
    this._tasks.set(upid, { status: 'running', type, startTime: Date.now() });
    
    // Auto-complete task after a short delay
    setTimeout(() => {
      const task = this._tasks.get(upid);
      if (task) {
        task.status = 'stopped';
        task.exitstatus = 'OK';
      }
    }, 500);
    
    return upid;
  }

  /**
   * Create a container
   */
  async createLxc(node, options) {
    const vmid = options.vmid;
    const macAddress = this._generateMacAddress();
    
    this._containers.set(vmid, {
      vmid,
      hostname: options.hostname,
      ostemplate: options.ostemplate,
      cores: options.cores || 4,
      memory: options.memory || 4096,
      status: 'stopped',
      macAddress,
      ipv4Address: null
    });
    
    console.log(`[MockProxmox] Created container ${vmid}: ${options.hostname}`);
    return this._createTask('vzcreate', node);
  }

  /**
   * Read task status
   */
  async taskStatus(node, upid) {
    const task = this._tasks.get(upid);
    if (!task) {
      return { status: 'stopped', exitstatus: 'OK' };
    }
    return {
      status: task.status,
      exitstatus: task.exitstatus || null,
      type: task.type,
      starttime: Math.floor(task.startTime / 1000)
    };
  }

  /**
   * Wait for a task to complete
   */
  async waitForTask(node, upid, pollInterval = 100, timeout = 5000) {
    const startTime = Date.now();
    while (true) {
      const status = await this.taskStatus(node, upid);
      console.log(`[MockProxmox] Task ${upid.split(':')[4]}: status=${status.status}`);
      
      if (status.status === 'stopped') {
        if (status.exitstatus && status.exitstatus !== 'OK') {
          throw new Error(`Task failed with status: ${status.exitstatus}`);
        }
        return status;
      }
      
      if (Date.now() - startTime > timeout) {
        throw new Error(`Task ${upid} timed out`);
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Delete a container
   */
  async deleteContainer(nodeName, containerId, force = false, purge = false) {
    this._containers.delete(containerId);
    console.log(`[MockProxmox] Deleted container ${containerId}`);
    return { data: null };
  }

  /**
   * Get LXC templates
   */
  async getLxcTemplates(node) {
    return [];
  }

  /**
   * Clone an LXC container
   */
  async cloneLxc(node, vmid, newid, options = {}) {
    const source = this._containers.get(vmid);
    if (!source) {
      throw new Error(`Source container ${vmid} not found`);
    }
    
    const macAddress = this._generateMacAddress();
    this._containers.set(newid, {
      vmid: newid,
      hostname: options.hostname || `clone-${newid}`,
      ostemplate: source.ostemplate,
      cores: source.cores,
      memory: source.memory,
      status: 'stopped',
      macAddress,
      ipv4Address: null
    });
    
    console.log(`[MockProxmox] Cloned container ${vmid} to ${newid}`);
    return this._createTask('vzclone', node);
  }

  /**
   * Update LXC configuration
   */
  async updateLxcConfig(node, vmid, config) {
    const container = this._containers.get(vmid);
    if (container) {
      Object.assign(container, config);
    }
    console.log(`[MockProxmox] Updated config for ${vmid}`);
  }

  /**
   * Start a container
   */
  async startLxc(node, vmid) {
    const container = this._containers.get(vmid);
    if (container) {
      container.status = 'running';
      // Assign an IP address when started
      container.ipv4Address = this._generateIpAddress();
      console.log(`[MockProxmox] Started container ${vmid}, IP: ${container.ipv4Address}`);
    }
    return this._createTask('vzstart', node);
  }

  /**
   * Stop a container
   */
  async stopLxc(node, vmid) {
    const container = this._containers.get(vmid);
    if (container) {
      container.status = 'stopped';
      console.log(`[MockProxmox] Stopped container ${vmid}`);
    }
    return this._createTask('vzstop', node);
  }

  /**
   * Get container status
   */
  async getLxcStatus(node, vmid) {
    const container = this._containers.get(vmid);
    if (!container) {
      throw new Error(`Container ${vmid} not found`);
    }
    return {
      status: container.status,
      vmid,
      name: container.hostname,
      uptime: container.status === 'running' ? 3600 : 0,
      cpu: container.status === 'running' ? 0.05 : 0,
      mem: container.status === 'running' ? 536870912 : 0,
      maxmem: container.memory * 1024 * 1024,
      disk: 1073741824,
      maxdisk: 8589934592
    };
  }

  /**
   * Get container network interfaces
   */
  async lxcInterfaces(node, vmid) {
    const container = this._containers.get(vmid);
    if (!container) {
      throw new Error(`Container ${vmid} not found`);
    }
    
    if (container.status !== 'running' || !container.ipv4Address) {
      return [];
    }
    
    return [
      {
        name: 'lo',
        'hardware-address': '00:00:00:00:00:00',
        'ip-addresses': [
          { 'ip-address': '127.0.0.1', 'ip-address-type': 'inet', prefix: 8 }
        ]
      },
      {
        name: 'eth0',
        'hardware-address': container.macAddress,
        'ip-addresses': [
          { 'ip-address': container.ipv4Address, 'ip-address-type': 'inet', prefix: 24 }
        ]
      }
    ];
  }

  /**
   * Pull OCI image (simulated)
   */
  async pullOciImage(node, storage, options) {
    console.log(`[MockProxmox] Pulling OCI image: ${options.reference}`);
    return this._createTask('imgpull', node);
  }

  /**
   * Get MAC address from container
   */
  async getLxcMacAddress(node, vmid) {
    const container = this._containers.get(vmid);
    return container?.macAddress || null;
  }

  /**
   * Get IP address from container
   */
  async getLxcIpAddress(node, vmid, maxRetries = 3, retryDelay = 100) {
    const container = this._containers.get(vmid);
    if (!container || container.status !== 'running') {
      return null;
    }
    return container.ipv4Address;
  }

  /**
   * Get network info
   */
  async getLxcNetworkInfo(node, vmid) {
    const container = this._containers.get(vmid);
    return {
      macAddress: container?.macAddress || null,
      ipv4Address: container?.ipv4Address || null
    };
  }

  /**
   * Create API token (simulated)
   */
  async createApiToken(userId, tokenId, comment = null, expire = 0, privsep = true) {
    return {
      'full-tokenid': `${userId}!${tokenId}`,
      value: 'mock-token-secret-' + Math.random().toString(36).substring(7)
    };
  }

  /**
   * Update ACL (simulated)
   */
  async updateAcl(path, roles, groups = null, propagate = true, tokens = null, users = null) {
    console.log(`[MockProxmox] Updated ACL: ${path} -> ${roles}`);
  }

  /**
   * Generate a random MAC address
   */
  _generateMacAddress() {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    // Use BC:24:11 as OUI (locally administered)
    return `BC:24:11:${hex()}:${hex()}:${hex()}`.toUpperCase();
  }

  /**
   * Generate a random IP address in test range
   */
  _generateIpAddress() {
    const octet = () => Math.floor(Math.random() * 100) + 100;
    return `10.0.0.${octet()}`;
  }
}

module.exports = MockProxmoxApi;
