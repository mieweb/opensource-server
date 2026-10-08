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
const { Site, Node, Container, Service, HTTPService, TransportService, ExternalDomain, Volume, DkimKey, Setting, MailUnsubscribeKey } = require('../models');
const { isAgentlessNodeType } = require('./volumes');
const { DEFAULT_QUOTA_MB } = require('./mail-account');

// Owning host UID/GID for volume directories: Proxmox maps an unprivileged CT's
// UID/GID 0 to host 100000, so RW volumes must be owned by 100000 to be writable
// from inside a consuming unprivileged container as its root.
//
// The agent applies this ownership BEST-EFFORT so it is correct regardless of
// whether the agent itself runs in an unprivileged or (rare) privileged guest:
//   - Unprivileged agent guest (the norm — `pct create` defaults to
//     --unprivileged 1, so this includes the embedded Manager agent): the
//     agent's root already maps to host 100000, so mkdir yields the right owner.
//     A chown to 100000 then targets an id outside the guest's mapped range and
//     is a tolerated no-op (EINVAL/EPERM ignored by the agent).
//   - Privileged agent guest (only if an operator deliberately creates it with
//     --unprivileged 0): the agent is host root, so mkdir would yield a
//     root-owned (0:0) dir; the chown to 100000 fixes it so the unprivileged
//     consumer can write.
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
 *  - volumes on agentless nodes (Docker, dummy — see isAgentlessNodeType):
 *    they're marked ready locally without the agent, and the site agent may not
 *    even have their paths mounted, so advertising them would let it report a
 *    spurious failure and flip a valid volume to `failed`.
 * Deterministic order keeps the strong ETag stable.
 *
 * @param {object} site - Site with eager-loaded nodes (used to scope containers)
 * @returns {Promise<Array<object>>}
 */
async function buildSiteVolumes(site) {
  // Only nodes whose directories the site agent actually provisions (see above).
  const agentProvisionedNodeIds = (site.nodes || [])
    .filter((n) => !isAgentlessNodeType(n.nodeType))
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

/**
 * The `mail` snapshot section, sent ONLY to the agent holding the mail-host
 * claim (issue #67). Carries everything the agent templates into
 * Postfix/Dovecot/OpenDKIM config that is NOT read live from SQL: DKIM
 * private keys for can-send domains, receiving domains, mail_hostname,
 * relayhost, limits, and the DB connection. The mail_dovecot/mail_postfix
 * DB passwords are NOT included — they live in /etc/default/container-creator
 * on the mail host (bin/setup-mail-db-roles.sh) or socket auth is used.
 *
 * @param {object} dbConfig - resolved config/config.js entry for this env
 * @returns {Promise<object>}
 */
async function buildMailSnapshot(dbConfig) {
  const settings = await Setting.getMultiple([
    'mail_hostname', 'mail_relayhost', 'mail_relayhost_username', 'mail_relayhost_password',
    'mail_db_host', 'mail_default_quota_mb', 'mail_message_size_limit_mb',
    'mail_unsubscribe_base_url',
  ]);

  const sendDomains = await ExternalDomain.findAll({
    where: { mailEnabled: true, mailDnsVerified: true },
    include: [{ model: DkimKey, as: 'dkimKeys', where: { status: 'active' }, required: true }],
    order: [['name', 'ASC'], [{ model: DkimKey, as: 'dkimKeys' }, 'createdAt', 'DESC']],
  });
  const receiveDomains = await ExternalDomain.findAll({
    where: { mailEnabled: true, mailMxVerified: true },
    attributes: ['name'],
    order: [['name', 'ASC']],
  });

  return {
    hostname: settings.mail_hostname || null,
    relayhost: settings.mail_relayhost
      ? {
        host: settings.mail_relayhost,
        username: settings.mail_relayhost_username || null,
        password: settings.mail_relayhost_password || null,
      }
      : null,
    messageSizeLimitMb: parseInt(settings.mail_message_size_limit_mb, 10) || 25,
    defaultQuotaMb: parseInt(settings.mail_default_quota_mb, 10) || DEFAULT_QUOTA_MB,
    // DKIM signing material for domains that can send (newest active key).
    dkim: sendDomains.map((d) => ({
      domain: d.name,
      selector: d.dkimKeys[0].selector,
      privateKey: d.dkimKeys[0].privateKey,
    })),
    // Domains Postfix accepts inbound mail for on :25.
    receiveDomains: receiveDomains.map((d) => d.name),
    db: {
      dialect: dbConfig.dialect,
      host: settings.mail_db_host || dbConfig.host || null,
      port: dbConfig.port ? Number(dbConfig.port) : null,
      database: dbConfig.database || null,
      dovecotUser: 'mail_dovecot',
      postfixUser: 'mail_postfix',
    },
    // opensource-mail-helper mints List-Unsubscribe tokens with the active
    // key; retired-but-verifiable keys ride along so old links keep working
    // after a rotation. The manager verifies with the same set.
    unsubscribe: await buildUnsubscribeSection(settings.mail_unsubscribe_base_url),
  };
}

async function buildUnsubscribeSection(baseUrl) {
  await MailUnsubscribeKey.ensureActive();
  const keys = await MailUnsubscribeKey.verifiable();
  return {
    baseUrl: baseUrl || null,
    keys: keys.map((k) => ({ kid: k.kid, secret: k.secret, active: k.status === 'active' })),
  };
}

module.exports = { buildAgentConfig, buildMailSnapshot, computeConfigEtag };
