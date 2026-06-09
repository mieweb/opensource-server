/**
 * NetBox API integration utility.
 *
 * Manages virtual machine entries in NetBox that mirror containers managed by
 * this system. Each container gets a corresponding NetBox VM record with its
 * IPv4 address and the site cluster name.
 *
 * Settings keys (stored in the Settings table):
 *   netbox_url   — Base URL of the NetBox instance (e.g. https://netbox.example.com)
 *   netbox_token — API token for a NetBox user with write access to IPAM/Virtualization
 *
 * NetBox objects created per container:
 *   virtualization.virtual-machine  — one per container (name = hostname)
 *   virtualization.interface        — "eth0" on that VM
 *   ipam.ip-address                 — the container's IPv4 address assigned to eth0
 */

const NETBOX_COMMENT = 'This container was built using opensource-server';

/**
 * Build request headers for NetBox API calls.
 * @param {string} token - NetBox API token
 */
function headers(token) {
  return {
    Authorization: `Token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Perform a fetch against the NetBox API.
 * Throws on non-2xx responses. Returns null for 204 No Content.
 * @param {string} baseUrl - NetBox base URL (no trailing slash)
 * @param {string} token - API token
 * @param {string} path - API path (must start with /)
 * @param {object} [options] - Additional fetch options
 * @returns {Promise<object|null>}
 */
async function nbFetch(baseUrl, token, path, options = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(token), ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NetBox API error (${path}): HTTP ${res.status} — ${body}`);
  }
  return res.json();
}

/**
 * Look up a NetBox cluster by name.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} clusterName - Should match the Site.name value
 * @returns {Promise<number>} Cluster ID
 * @throws {Error} If the cluster is not found in NetBox
 */
async function findClusterId(baseUrl, token, clusterName) {
  const data = await nbFetch(
    baseUrl,
    token,
    `/virtualization/clusters/?name=${encodeURIComponent(clusterName)}&limit=1`,
  );
  if (!data?.results?.length) {
    throw new Error(`NetBox: cluster "${clusterName}" not found`);
  }
  return data.results[0].id;
}

/**
 * Create a virtual machine record in NetBox for a newly provisioned container.
 *
 * Steps:
 *   1. Resolve cluster ID from site name
 *   2. Create the VM record
 *   3. Create an eth0 interface on the VM
 *   4. Create an IP address assigned to that interface
 *   5. Set the VM's primary_ip4 to the new IP
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {object} opts
 * @param {string} opts.hostname    - Container hostname (becomes VM name)
 * @param {string} opts.clusterName - Site name used to resolve the NetBox cluster
 * @param {string} opts.ipv4Address - Container IPv4 address (CIDR or bare IP)
 * @param {string} [opts.createdBy] - Username of the person who created the container
 * @returns {Promise<object>} The created NetBox VM object
 */
async function createVirtualMachine(baseUrl, token, { hostname, clusterName, ipv4Address, createdBy }) {
  const clusterId = await findClusterId(baseUrl, token, clusterName);
  const comment = createdBy
    ? `${NETBOX_COMMENT}\nCreated by: ${createdBy}`
    : NETBOX_COMMENT;

  const vm = await nbFetch(baseUrl, token, '/virtualization/virtual-machines/', {
    method: 'POST',
    body: JSON.stringify({
      name: hostname,
      cluster: clusterId,
      status: 'active',
      comments: comment,
    }),
  });

  const iface = await nbFetch(baseUrl, token, '/virtualization/interfaces/', {
    method: 'POST',
    body: JSON.stringify({
      virtual_machine: vm.id,
      name: 'eth0',
    }),
  });

  // NetBox requires CIDR notation — default to /32 for a bare address
  const cidr = ipv4Address.includes('/') ? ipv4Address : `${ipv4Address}/32`;
  const ip = await nbFetch(baseUrl, token, '/ipam/ip-addresses/', {
    method: 'POST',
    body: JSON.stringify({
      address: cidr,
      assigned_object_type: 'virtualization.vminterface',
      assigned_object_id: iface.id,
      comments: NETBOX_COMMENT,
    }),
  });

  await nbFetch(baseUrl, token, `/virtualization/virtual-machines/${vm.id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ primary_ip4: ip.id }),
  });

  return vm;
}

/**
 * Delete a virtual machine from NetBox by container hostname.
 * Also removes the associated interface and IP address.
 *
 * Non-throwing: logs errors but never propagates them so that a NetBox
 * outage does not block container deletion in the primary system.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} hostname - Container hostname
 * @returns {Promise<void>}
 */
async function deleteVirtualMachine(baseUrl, token, hostname) {
  try {
    const data = await nbFetch(
      baseUrl,
      token,
      `/virtualization/virtual-machines/?name=${encodeURIComponent(hostname)}&limit=1`,
    );
    if (!data?.results?.length) {
      console.log(`NetBox: no VM found for "${hostname}", skipping deletion`);
      return;
    }
    const vm = data.results[0];

    const ifaceData = await nbFetch(
      baseUrl,
      token,
      `/virtualization/interfaces/?virtual_machine_id=${vm.id}`,
    );
    for (const iface of ifaceData?.results || []) {
      const ipData = await nbFetch(
        baseUrl,
        token,
        `/ipam/ip-addresses/?assigned_object_type=virtualization.vminterface&assigned_object_id=${iface.id}`,
      );
      for (const ip of ipData?.results || []) {
        await nbFetch(baseUrl, token, `/ipam/ip-addresses/${ip.id}/`, { method: 'DELETE' });
      }
      await nbFetch(baseUrl, token, `/virtualization/interfaces/${iface.id}/`, { method: 'DELETE' });
    }

    await nbFetch(baseUrl, token, `/virtualization/virtual-machines/${vm.id}/`, { method: 'DELETE' });
    console.log(`NetBox: VM "${hostname}" deleted`);
  } catch (err) {
    console.error(`NetBox: failed to delete VM "${hostname}": ${err.message}`);
  }
}

/**
 * Load NetBox credentials from the Settings model and invoke a callback.
 * Returns null without calling fn if NetBox is not configured.
 *
 * @param {object} Setting - Sequelize Setting model
 * @param {function(string, string): Promise<*>} fn - Called with (baseUrl, token)
 * @returns {Promise<*|null>}
 */
async function withNetbox(Setting, fn) {
  const settings = await Setting.getMultiple(['netbox_url', 'netbox_token']);
  const baseUrl = settings.netbox_url;
  const token = settings.netbox_token;
  if (!baseUrl || !token) return null;
  return fn(baseUrl, token);
}

module.exports = { createVirtualMachine, deleteVirtualMachine, withNetbox };
