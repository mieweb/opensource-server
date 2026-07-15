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
const { Site, Node, Container, Service, HTTPService, TransportService, ExternalDomain } = require('../models');

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
    },
    nginx: {
      httpServices,
      streamServices,
      externalDomains: externalDomains.map((d) => ({ name: d.name })),
    },
  };
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
