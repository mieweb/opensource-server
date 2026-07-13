/**
 * /api/v1/sites/:siteId/nodes — admin-only CRUD + Proxmox storages + Proxmox import.
 */

const express = require('express');
const https = require('https');
const { Node, Site, Container } = require('../../../models');
const { isValidDockerHost } = require('../../../utils/docker-api');
const { apiAuth, apiAdmin, asyncHandler, ok, created, noContent, ApiError } =
  require('../../../middlewares/api');

const router = express.Router({ mergeParams: true });

router.use(apiAuth);

function serialize(n) {
  return {
    id: n.id,
    name: n.name,
    nodeType: n.nodeType,
    siteId: n.siteId,
    ipv4Address: n.ipv4Address,
    apiUrl: n.apiUrl,
    tokenId: n.tokenId,
    tlsVerify: n.tlsVerify,
    imageStorage: n.imageStorage,
    volumeStorage: n.volumeStorage,
    networkBridge: n.networkBridge,
    nvidiaAvailable: n.nvidiaAvailable,
    hasSecret: !!n.secret,
  };
}

async function loadSite(req) {
  const site = await Site.findByPk(parseInt(req.params.siteId, 10));
  if (!site) throw new ApiError(404, 'site_not_found', 'Site not found');
  return site;
}

function normalizeNodeType(nodeType) {
  return nodeType || 'proxmox';
}

function validateNodeInput({ nodeType, apiUrl }) {
  const type = normalizeNodeType(nodeType);

  if (!['proxmox', 'docker', 'dummy'].includes(type)) {
    throw new ApiError(400, 'invalid_node_type', 'Node type must be proxmox, docker, or dummy');
  }

  if (type === 'docker' && (!apiUrl || !isValidDockerHost(apiUrl))) {
    throw new ApiError(
      400,
      'invalid_docker_host',
      'Docker host must use unix://, tcp://, http://, or https:// without extra path components',
    );
  }

  return type;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
    const nodes = await Node.findAll({ where: { siteId: site.id }, order: [['name', 'ASC']] });
    return ok(res, nodes.map(serialize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
    const node = await Node.findOne({
      where: { id: parseInt(req.params.id, 10), siteId: site.id },
    });
    if (!node) throw new ApiError(404, 'not_found', 'Node not found');
    return ok(res, serialize(node));
  }),
);

router.get(
  '/:id/storages',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
    const node = await Node.findOne({
      where: { id: parseInt(req.params.id, 10), siteId: site.id },
    });
    if (!node || !node.hasApiAccess()) return ok(res, []);
    try {
      const client = await node.api();
      const storages = await client.datastores(node.name, 'vztmpl', true);
      return ok(res, storages.map((s) => ({ name: s.storage, total: s.total, available: s.avail })));
    } catch (err) {
      console.error('Error fetching storages:', err.message);
      return ok(res, []);
    }
  }),
);

router.post(
  '/',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
    const { name, nodeType, ipv4Address, apiUrl, tokenId, secret, tlsVerify, imageStorage, volumeStorage, networkBridge, nvidiaAvailable } =
      req.body || {};
    const type = validateNodeInput({ nodeType, apiUrl });
    const node = await Node.create({
      name,
      nodeType: type,
      ipv4Address: ipv4Address || null,
      apiUrl: apiUrl || null,
      tokenId: tokenId || null,
      secret: secret || null,
      tlsVerify:
        tlsVerify === '' || tlsVerify === null || tlsVerify === undefined ? null : tlsVerify === true || tlsVerify === 'true',
      imageStorage: imageStorage || 'local',
      volumeStorage: volumeStorage || 'local-lvm',
      networkBridge: networkBridge || 'vmbr0',
      nvidiaAvailable: nvidiaAvailable === true || nvidiaAvailable === 'true',
      siteId: site.id,
    });
    return created(res, serialize(node));
  }),
);

router.put(
  '/:id',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
    const node = await Node.findOne({
      where: { id: parseInt(req.params.id, 10), siteId: site.id },
    });
    if (!node) throw new ApiError(404, 'not_found', 'Node not found');
    const { name, nodeType, ipv4Address, apiUrl, tokenId, secret, tlsVerify, imageStorage, volumeStorage, networkBridge, nvidiaAvailable } =
      req.body || {};
    const type = validateNodeInput({
      nodeType: nodeType || node.nodeType,
      apiUrl,
    });
    const update = {
      name,
      nodeType: type,
      ipv4Address: ipv4Address || null,
      apiUrl: apiUrl || null,
      tokenId: tokenId || null,
      tlsVerify:
        tlsVerify === '' || tlsVerify === null || tlsVerify === undefined ? null : tlsVerify === true || tlsVerify === 'true',
      imageStorage: imageStorage || 'local',
      volumeStorage: volumeStorage || 'local-lvm',
      networkBridge: networkBridge || 'vmbr0',
      nvidiaAvailable: nvidiaAvailable === true || nvidiaAvailable === 'true',
    };
    if (secret && secret.trim() !== '') update.secret = secret;
    await node.update(update);
    return ok(res, serialize(node));
  }),
);

router.delete(
  '/:id',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
    const node = await Node.findOne({
      where: { id: parseInt(req.params.id, 10), siteId: site.id },
      include: [{ model: Container, as: 'containers' }],
    });
    if (!node) throw new ApiError(404, 'not_found', 'Node not found');
    if (node.containers && node.containers.length > 0) {
      throw new ApiError(
        409,
        'has_containers',
        `Cannot delete node ${node.name}: ${node.containers.length} container(s) still reference it`,
      );
    }
    await node.destroy();
    return noContent(res);
  }),
);

// POST /nodes/import — import nodes (and their containers) from Proxmox
router.post(
  '/import',
  apiAdmin,
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
    const { apiUrl, username, password, tlsVerify } = req.body || {};
    if (!apiUrl || !username || !password) {
      throw new ApiError(400, 'invalid_request', 'apiUrl, username, password are required');
    }
    const httpsAgent = new https.Agent({ rejectUnauthorized: tlsVerify !== false && tlsVerify !== 'false' });
    void httpsAgent;
    try {
      const tempNode = Node.build({
        name: 'temp',
        apiUrl,
        tokenId: username,
        secret: password,
        tlsVerify: tlsVerify !== false && tlsVerify !== 'false',
      });
      const client = await tempNode.api();
      const proxNodes = await client.nodes();

      const nodesWithIp = await Promise.all(
        proxNodes.map(async (n) => {
          let ipv4Address = null;
          let imageStorage = 'local';
          let volumeStorage = 'local-lvm';
          try {
            const ifaces = await client.nodeNetwork(n.node);
            const primary = ifaces.find(
              (i) => i.iface === 'vmbr0' || (i.type === 'bridge' && i.active),
            );
            ipv4Address = primary?.address || null;
          } catch (err) {
            console.error(`Failed to fetch network for ${n.node}:`, err.message);
          }
          try {
            const storages = await client.datastores(n.node, 'vztmpl', true);
            if (storages.length > 0) {
              const largest = storages.reduce((max, s) => (s.total > max.total ? s : max), storages[0]);
              imageStorage = largest.storage;
            }
          } catch (err) {
            console.error(`Failed to fetch image storages for ${n.node}:`, err.message);
          }
          try {
            const storages = await client.datastores(n.node, 'rootdir', true);
            if (storages.length > 0) {
              const largest = storages.reduce((max, s) => (s.total > max.total ? s : max), storages[0]);
              volumeStorage = largest.storage;
            }
          } catch (err) {
            console.error(`Failed to fetch volume storages for ${n.node}:`, err.message);
          }
          return {
            name: n.node,
            ipv4Address,
            apiUrl,
            tokenId: username,
            secret: password,
            tlsVerify: tlsVerify !== false && tlsVerify !== 'false',
            imageStorage,
            volumeStorage,
            networkBridge: 'vmbr0',
            siteId: site.id,
          };
        }),
      );
      const importedNodes = await Node.bulkCreate(nodesWithIp);

      const containerList = await client.clusterResources('lxc');
      const containerRows = await Promise.all(
        containerList.map(async (c) => {
          const config = await client.lxcConfig(c.node, c.vmid);
          const macMatch = config.net0?.match(/hwaddr=([0-9A-Fa-f:]+)/);
          const macAddress = macMatch ? macMatch[1] : null;
          let ipv4Address = null;
          const ipMatch = config.net0?.match(/ip=([^,]+)/);
          if (ipMatch && ipMatch[1] !== 'dhcp') {
            ipv4Address = ipMatch[1].split('/')[0];
          } else if (ipMatch && ipMatch[1] === 'dhcp') {
            try {
              ipv4Address = await client.getLxcIpAddress(c.node, c.vmid, 3, 2000);
            } catch (err) {
              console.error(`Failed to get IP for DHCP container ${c.vmid}: ${err.message}`);
            }
          }
          return {
            hostname: config.hostname,
            username: req.session.user,
            nodeId: importedNodes.find((n) => n.name === c.node).id,
            siteId: site.id,
            containerId: c.vmid,
            macAddress,
            ipv4Address,
          };
        }),
      );
      await Container.bulkCreate(containerRows);
      return created(res, {
        nodes: importedNodes.map(serialize),
        importedContainerCount: containerRows.length,
      });
    } catch (err) {
      console.error('Import failed:', err);
      throw new ApiError(502, 'import_failed', `Failed to import nodes: ${err.message}`);
    }
  }),
);

module.exports = router;
