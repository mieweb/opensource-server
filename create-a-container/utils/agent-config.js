/**
 * Builds the site configuration snapshot returned to agents at check-in.
 *
 * The snapshot is plain JSON with a deterministic shape so a strong ETag can
 * be computed over it: agents send the ETag back via If-None-Match and get a
 * 304 when nothing changed. The shape mirrors what the agent's EJS templates
 * (agent/templates/) expect.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const { Site, Node, Container, Service, HTTPService, TransportService, ExternalDomain, Volume } = require('../models');

// Default unprivileged-LXC id-map offset. Proxmox maps container UID/GID 0 to
// host 100000 for unprivileged CTs, so a RW bind directory must be owned by
// this host UID/GID to be writable from inside the container as its root.
const UNPRIVILEGED_ID_OFFSET = 100000;

/**
 * Load a site with everything the agent templates need, serialized to plain
 * JSON. Returns `{ site: null, nginx: { ... empty ... } }` when the site does
 * not exist yet — a bootstrap fallback so a fresh manager's own agent can
 * render a minimal nginx config (manager reachable over TLS) before the first
 * site is created.
 *
 * @param {number} siteId
 * @returns {Promise<object>} `{ site, nginx: { httpServices, streamServices, externalDomains } }`
 */
async function buildAgentConfig(siteId) {
  const site = await Site.findByPk(siteId, {
    include: [{
      model: Node,
      as: 'nodes',
      include: [{
        model: Container,
        as: 'containers',
        where: { ipv4Address: { [Op.ne]: null } },
        required: false,
        include: [{
          model: Service,
          as: 'services',
          include: [
            {
              model: HTTPService,
              as: 'httpService',
              include: [{ model: ExternalDomain, as: 'externalDomain' }],
            },
            { model: TransportService, as: 'transportService' },
          ],
        }],
      }],
    }, {
      model: ExternalDomain,
      as: 'externalDomains',
    }],
    order: [
      [{ model: Node, as: 'nodes' }, 'id', 'ASC'],
      [{ model: Node, as: 'nodes' }, { model: Container, as: 'containers' }, 'id', 'ASC'],
      [{ model: Node, as: 'nodes' }, { model: Container, as: 'containers' }, { model: Service, as: 'services' }, 'id', 'ASC'],
      [{ model: ExternalDomain, as: 'externalDomains' }, 'id', 'ASC'],
    ],
  });

  if (!site) {
    return {
      site: null,
      nginx: { httpServices: [], streamServices: [], externalDomains: [] },
    };
  }

  const httpServices = [];
  const streamServices = [];
  for (const node of site.nodes || []) {
    for (const container of node.containers || []) {
      for (const service of container.services || []) {
        const base = {
          id: service.id,
          internalPort: service.internalPort,
          container: { ipv4Address: container.ipv4Address },
        };
        if (service.type === 'http' && service.httpService && service.httpService.externalDomain) {
          httpServices.push({
            ...base,
            externalHostname: service.httpService.externalHostname,
            backendProtocol: service.httpService.backendProtocol,
            authRequired: !!service.httpService.authRequired,
            externalDomain: {
              name: service.httpService.externalDomain.name,
              authServer: service.httpService.externalDomain.authServer || null,
            },
          });
        } else if (service.type === 'transport' && service.transportService) {
          streamServices.push({
            ...base,
            externalPort: service.transportService.externalPort,
            protocol: service.transportService.protocol,
          });
        }
      }
    }
  }

  // Domains needing a TLS server block: any domain referenced by an HTTP
  // service plus the site's own external domains.
  const usedDomainIds = new Set();
  for (const node of site.nodes || []) {
    for (const container of node.containers || []) {
      for (const service of container.services || []) {
        const id = service.httpService?.externalDomain?.id;
        if (id) usedDomainIds.add(id);
      }
    }
  }
  for (const d of site.externalDomains || []) usedDomainIds.add(d.id);
  const externalDomains = await ExternalDomain.findAll({
    where: { id: [...usedDomainIds] },
    order: [['id', 'ASC']],
  });

  // Desired volume directories the agent must ensure exist, grouped by node.
  // Loaded independently of the nginx container graph because a volume must be
  // advertised to the agent BEFORE its container gets an IP (during creation),
  // whereas the nginx graph only includes containers that already have one.
  // Built-in volumes (the retired quick_and_dirty shared mount) are admin-
  // provisioned and excluded — the agent only owns user volume directories.
  const volumesByNodeName = await buildNodeVolumes(site);

  return {
    site: {
      id: site.id,
      name: site.name,
      internalDomain: site.internalDomain,
      dhcpRange: site.dhcpRange,
      subnetMask: site.subnetMask,
      gateway: site.gateway,
      dnsForwarders: site.dnsForwarders,
      nodes: (site.nodes || []).map((node) => ({
        name: node.name,
        ipv4Address: node.ipv4Address,
        containers: (node.containers || []).map((c) => ({
          hostname: c.hostname,
          ipv4Address: c.ipv4Address,
          macAddress: c.macAddress,
        })),
        // Volume directories to ensure on this node (id, hostPath, mode, uid, gid).
        volumes: volumesByNodeName.get(node.name) || [],
      })),
    },
    nginx: {
      httpServices,
      streamServices,
      externalDomains: externalDomains.map((d) => ({ name: d.name })),
    },
  };
}

/**
 * Build the per-node list of desired volume directories for the agent's config
 * snapshot. Keyed by node name. Each entry carries the host path, mode, and the
 * owning host UID/GID (the unprivileged CT's id-mapped root) so RW volumes are
 * writable from inside the container. Built-in and host-path-less volumes are
 * excluded (the former are admin-provisioned; the latter aren't provisionable
 * yet). Deterministic order keeps the strong ETag stable.
 *
 * @param {object} site - Site with eager-loaded nodes
 * @returns {Promise<Map<string, Array<object>>>}
 */
async function buildNodeVolumes(site) {
  const byNodeName = new Map();
  const nodeById = new Map((site.nodes || []).map((n) => [n.id, n]));
  if (nodeById.size === 0) return byNodeName;

  const volumes = await Volume.findAll({
    include: [
      {
        model: Container,
        as: 'container',
        attributes: ['id', 'nodeId', 'hostname'],
        where: { nodeId: [...nodeById.keys()] },
        required: true,
      },
    ],
    where: { builtin: false, hostPath: { [Op.ne]: null } },
    order: [['id', 'ASC']],
  });

  for (const v of volumes) {
    const node = nodeById.get(v.container.nodeId);
    if (!node) continue;
    if (!byNodeName.has(node.name)) byNodeName.set(node.name, []);
    byNodeName.get(node.name).push({
      id: v.id,
      hostPath: v.hostPath,
      mode: v.mode,
      // Owning host UID/GID for the unprivileged CT's id-mapped root.
      uid: UNPRIVILEGED_ID_OFFSET,
      gid: UNPRIVILEGED_ID_OFFSET,
    });
  }
  return byNodeName;
}

/**
 * Strong ETag over a config snapshot. Deterministic because buildAgentConfig
 * constructs the object with stable key/array ordering.
 */
function computeConfigEtag(config) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
  return `"${hash}"`;
}

module.exports = { buildAgentConfig, computeConfigEtag };
