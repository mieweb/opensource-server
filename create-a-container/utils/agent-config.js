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

// Owning host UID/GID for volume directories: Proxmox maps an unprivileged CT's
// UID/GID 0 to host 100000, so RW volumes must be owned by 100000 to be writable
// from inside a consuming unprivileged container as its root.
//
// The agent applies this ownership BEST-EFFORT, which makes it correct in both
// agent topologies:
//   - Unprivileged agent guest (production): the agent's root already maps to
//     host 100000, so mkdir yields the right owner; a chown to 100000 is a
//     harmless no-op and, if the guest can't chown, the EPERM is ignored.
//   - Privileged agent guest (e.g. the dev stack's Manager CT, created without
//     --unprivileged 1): the agent is host root, so mkdir would otherwise yield
//     a root-owned (0:0) dir; the explicit chown to 100000 fixes it (real root
//     can chown), making the volume writable by the unprivileged consumer.
const VOLUME_OWNER_UID = 100000;
const VOLUME_OWNER_GID = 100000;

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

  // Desired volume directories the agent must ensure exist. Advertised at the
  // SITE level (not per node): there is one agent per site, and the volumes root
  // lives on storage shared across the site's nodes and bind-mounted into the
  // agent, so a single agent creates every site volume's directory regardless of
  // which node the container is placed on. Loaded independently of the nginx
  // container graph because a volume must be advertised to the agent BEFORE its
  // container gets an IP (during creation). Built-in volumes (the retired
  // quick_and_dirty mount recorded on pre-existing containers) are excluded —
  // the agent only owns user volume directories.
  const volumes = await buildSiteVolumes(site);

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
      })),
      // Volume directories to ensure for this site (id, hostPath, mode).
      volumes,
    },
    nginx: {
      httpServices,
      streamServices,
      externalDomains: externalDomains.map((d) => ({ name: d.name })),
    },
  };
}

/**
 * Build the site-level list of desired volume directories for the agent's
 * config snapshot. Each entry carries the host path and mode. Excluded:
 *  - built-in volumes (admin-provisioned legacy mounts),
 *  - host-path-less volumes (not derived/provisionable yet), and
 *  - volumes on Docker nodes — Docker auto-creates their bind sources and marks
 *    them ready locally; the site agent may not even have the Docker volumes
 *    root mounted, so advertising them would let the agent report a spurious
 *    failure and flip a valid Docker volume to `failed`.
 * Deterministic order keeps the strong ETag stable.
 *
 * @param {object} site - Site with eager-loaded nodes (used to scope containers)
 * @returns {Promise<Array<object>>}
 */
async function buildSiteVolumes(site) {
  // Only nodes whose directories the site agent actually provisions — i.e. not
  // Docker nodes (see above).
  const agentProvisionedNodeIds = (site.nodes || [])
    .filter((n) => n.nodeType !== 'docker')
    .map((n) => n.id);
  if (agentProvisionedNodeIds.length === 0) return [];

  const volumes = await Volume.findAll({
    include: [
      {
        model: Container,
        as: 'container',
        attributes: ['id', 'nodeId'],
        where: { nodeId: agentProvisionedNodeIds },
        required: true,
      },
    ],
    where: { builtin: false, hostPath: { [Op.ne]: null } },
    order: [['id', 'ASC']],
  });

  return volumes.map((v) => ({
    id: v.id,
    hostPath: v.hostPath,
    mode: v.mode,
    // Owning host UID/GID the agent applies best-effort (see comment above).
    uid: VOLUME_OWNER_UID,
    gid: VOLUME_OWNER_GID,
  }));
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
