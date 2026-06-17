/**
 * /api/v1/sites/:siteId/containers — full CRUD and metadata helpers.
 * Mounted with mergeParams to access :siteId from the parent /sites router.
 */

const express = require('express');
const {
  Container,
  ContainerCollaborator,
  Service,
  HTTPService,
  TransportService,
  DnsService,
  Node,
  Site,
  ExternalDomain,
  Job,
  Setting,
  Sequelize,
  sequelize,
} = require('../../../models');
const { parseDockerRef, getImageConfig, extractImageMetadata } = require('../../../utils/docker-registry');
const { manageDnsRecords } = require('../../../utils/cloudflare-dns');
const { deleteVirtualMachine, withNetbox } = require('../../../utils/netbox');
const {
  computeContainerStatus,
  computeContainerStatuses,
  STATUS,
} = require('../../../utils/container-status');
const { apiAuth, asyncHandler, ok, created, ApiError } = require('../../../middlewares/api');

const router = express.Router({ mergeParams: true });

router.use(apiAuth);

/**
 * Convert the `environmentVars` request payload (an array of { key, value }
 * objects) into the JSON string stored on the container record, or null when
 * there are no valid vars. Keys/values are validated and normalized via
 * Container.normalizeEnvVars so only safe env var names are persisted (keys
 * containing `=`/NUL or non-primitive values are dropped at ingest time).
 * @param {Array<{key: string, value: *}>} environmentVars
 * @returns {string|null}
 */
function serializeUserEnvVars(environmentVars) {
  if (!Array.isArray(environmentVars)) return null;
  const flat = {};
  for (const e of environmentVars) {
    if (e && typeof e.key === 'string') flat[e.key] = e.value;
  }
  const normalized = Container.normalizeEnvVars(flat);
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
}

function normalizeDockerRef(ref) {
  if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('git@')) return ref;
  let tag = 'latest';
  let imagePart = ref;
  const lastColon = ref.lastIndexOf(':');
  if (lastColon !== -1) {
    const potentialTag = ref.substring(lastColon + 1);
    if (!potentialTag.includes('/')) {
      tag = potentialTag;
      imagePart = ref.substring(0, lastColon);
    }
  }
  const parts = imagePart.split('/');
  let host = 'docker.io';
  let org = 'library';
  let image;
  if (parts.length === 1) {
    image = parts[0];
  } else if (parts.length === 2) {
    if (parts[0].includes('.') || parts[0].includes(':')) {
      host = parts[0];
      image = parts[1];
    } else {
      org = parts[0];
      image = parts[1];
    }
  } else {
    host = parts[0];
    image = parts[parts.length - 1];
    org = parts.slice(1, -1).join('/');
  }
  return `${host}/${org}/${image}:${tag}`;
}

/**
 * Load a site by id (typically `req.params.siteId`) or 404.
 * @param {*} siteId - Candidate site id; parsed as a base-10 integer.
 * @returns {Promise<object>} The Site instance.
 */
async function loadSite(siteId) {
  const site = await Site.findByPk(parseInt(siteId, 10));
  if (!site) throw new ApiError(404, 'site_not_found', 'Site not found');
  return site;
}

function serializeContainer(c, site, status) {
  const services = c.services || [];
  const ssh = services.find(
    (s) =>
      s.type === 'transport' &&
      s.transportService?.protocol === 'tcp' &&
      Number(s.internalPort) === 22,
  );
  const httpEntries = services
    .filter((s) => s.type === 'http')
    .map((s) => {
      const host =
        s.httpService?.externalHostname && s.httpService?.externalDomain?.name
          ? `${s.httpService.externalHostname}.${s.httpService.externalDomain.name}`
          : null;
      return { port: s.internalPort, externalUrl: host ? `https://${host}` : null };
    });
  const primaryHttp = httpEntries[0] || null;
  return {
    id: c.id,
    containerId: c.containerId,
    hostname: c.hostname,
    // Owner (the user who created the container). Surfaced so the admin
    // "all containers" view can show a User column; for the per-user list it
    // simply equals the requesting user.
    owner: c.username,
    // Additional users this container is shared with. Present on every
    // payload so consumers can render/manage sharing.
    collaborators: c.collaboratorNames(),
    ipv4Address: c.ipv4Address,
    macAddress: c.macAddress,
    // Live status computed from Proxmox + jobs + config (see utils/container-status).
    // Kept on every container payload so existing consumers remain non-breaking.
    status: status || STATUS.UNKNOWN,
    template: c.template,
    creationJobId: c.creationJobId,
    entrypoint: c.entrypoint,
    environmentVars: c.environmentVars ? JSON.parse(c.environmentVars) : {},
    nvidiaRequested: !!c.nvidiaRequested,
    sshPort: ssh?.transportService?.externalPort || null,
    sshHost: primaryHttp?.externalUrl ? new URL(primaryHttp.externalUrl).hostname : site?.externalIp,
    httpEntries,
    nodeName: c.node ? c.node.name : null,
    nodeApiUrl: c.node ? c.node.apiUrl : null,
    services: services.map((s) => ({
      id: s.id,
      type: s.type,
      internalPort: s.internalPort,
      httpService: s.httpService
        ? {
            id: s.httpService.id,
            externalHostname: s.httpService.externalHostname,
            externalDomainId: s.httpService.externalDomainId,
            backendProtocol: s.httpService.backendProtocol,
            authRequired: s.httpService.authRequired,
            domain: s.httpService.externalDomain?.name,
          }
        : null,
      transportService: s.transportService
        ? {
            id: s.transportService.id,
            protocol: s.transportService.protocol,
            externalPort: s.transportService.externalPort,
            tls: !!s.transportService.tls,
            backendTls: !!s.transportService.backendTls,
            externalHostname: s.transportService.externalHostname,
            externalDomainId: s.transportService.externalDomainId,
            domain: s.transportService.externalDomain?.name,
          }
        : null,
      dnsService: s.dnsService
        ? { id: s.dnsService.id, recordType: s.dnsService.recordType, dnsName: s.dnsService.dnsName }
        : null,
    })),
    createdAt: c.createdAt,
  };
}

// Eager-load graph shared by every list/show route so status resolution needs
// no per-container queries and the serializer has the data it needs.
const CONTAINER_INCLUDE = [
  {
    association: 'services',
    include: [
      { association: 'httpService', include: [{ association: 'externalDomain' }] },
      { association: 'transportService', include: [{ association: 'externalDomain' }] },
      { association: 'dnsService' },
    ],
  },
  // Full node record (incl. credentials) is required to query live Proxmox status.
  { association: 'node' },
  // Eager-load the create job so status resolution needs no per-container query.
  { association: 'creationJob' },
  // Users the container is shared with, for the serializer's `collaborators`.
  { association: 'collaborators' },
];

/**
 * Build the `where` clause for a container list query — the single arbiter of
 * what a list request may return. Scopes to the given site's nodes, narrows by
 * the supported query-string filters (`hostname`, `nodeId`, `user`), and
 * enforces ownership visibility, folding in shared containers.
 *
 * The `nodeId` filter is intersected with the site's own nodes so it can never
 * widen the result set beyond the site.
 *
 * `query.user` must be an array (callers capture `req.query` once and default
 * it with `query.user ??= []` — Express 5 re-parses req.query on each access;
 * clients send bracket notation, e.g. `user[0]=alice`, which the 'extended'
 * query parser coerces to an array). Empty -> everything the caller
 * may see: every container on the site for admins, their own plus any shared
 * with them for non-admins. A list of names -> those owners for admins; for
 * non-admins the same list intersected with what they may already see (own
 * plus shared), so a non-admin can only narrow down to owners who have shared
 * a container with them and never widen their visibility.
 *
 * @param {object} query - req.query
 * @param {number[]} nodeIds - IDs of the nodes belonging to the site
 * @param {object} session - req.session ({ user, isAdmin })
 * @returns {object} Sequelize where clause
 */
function buildContainerListWhere(query, nodeIds, session) {
  const where = { nodeId: nodeIds };
  if (query.hostname) where.hostname = query.hostname;
  if (query.nodeId) {
    const nodeId = parseInt(query.nodeId, 10);
    // Restrict to the requested node only when it belongs to this site;
    // otherwise force an empty result rather than leaking other sites' nodes.
    where.nodeId = Number.isInteger(nodeId) && nodeIds.includes(nodeId) ? nodeId : -1;
  }

  const names = query.user;
  if (session.isAdmin) {
    // Admins may see every owner on the site; a name list simply narrows it.
    if (names.length > 0) where.username = names;
    return where;
  }
  // Non-admins may only see their own containers plus any shared with them.
  const visible = visibleToClauses(session.user);
  if (names.length === 0) {
    where[Sequelize.Op.or] = visible;
  } else {
    // Intersect the requested owners with what the caller may already see.
    where[Sequelize.Op.and] = [{ [Sequelize.Op.or]: visible }, { username: names }];
  }
  return where;
}

/**
 * The owner-or-shared visibility rule, as a fragment of Sequelize clauses to
 * OR together: a container is visible to a user if they own it or it has been
 * shared with them. This is the single source of that rule, consumed by both
 * the list query (`buildContainerListWhere`) and the single-container loader
 * (`loadContainerForSession`).
 *
 * The shared set is expressed as an `IN (SELECT …)` subquery so the whole
 * visibility check resolves inside the caller's query — a single round trip —
 * instead of a separate lookup. (A plain JOIN on the eager-loaded
 * `collaborators` association would filter the joined rows and truncate the
 * serialized collaborator list, so a subquery is used.) It is built with the
 * dialect's query generator so identifier quoting and value escaping stay
 * correct across sqlite/mysql/postgres; selectQuery emits a trailing ';' which
 * is invalid inside IN (…), hence the slice.
 * @param {string} username - The requesting user's uid.
 * @returns {object[]} Clauses to OR together (own + shared).
 */
function visibleToClauses(username) {
  const shared = sequelize.dialect.queryGenerator
    .selectQuery(
      ContainerCollaborator.getTableName(),
      { attributes: ['containerId'], where: { username } },
      ContainerCollaborator,
    )
    .slice(0, -1);
  return [{ username }, { id: { [Sequelize.Op.in]: Sequelize.literal(`(${shared})`) } }];
}

/**
 * Load a container by id scoped to a site and authorize the session against
 * it. View access is enforced in the query itself: a non-admin only ever loads
 * a container they own or one shared with them, so an unauthorized row never
 * comes back and the route 404s without leaking the existence of containers
 * the caller may not see. Manage access (owner/admin, for sharing/delete) is
 * checked in-app and returns 403 — the caller can already view the container,
 * so it leaks nothing new and tells a collaborator why they can't manage it.
 * @param {*} siteId - Candidate site id (typically `req.params.siteId`).
 * @param {*} containerId - Candidate container id (typically `req.params.id`).
 * @param {object} session - req.session ({ user, isAdmin }).
 * @param {object} [opts]
 * @param {boolean} [opts.requireManage=false] - Require owner/admin (sharing,
 *   delete). Fails with 403 rather than the looser view access.
 * @param {Array} [opts.include] - Override the eager-load graph.
 * @returns {Promise<{site: object, container: object}>}
 */
async function loadContainerForSession(siteId, containerId, session, { requireManage = false, include } = {}) {
  const site = await loadSite(siteId);
  const id = parseInt(containerId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'invalid_request', 'Container id must be a positive integer');
  }
  const where = { id };
  // Enforce view access in the query so an unauthorized container never loads.
  if (!session.isAdmin) {
    where[Sequelize.Op.or] = visibleToClauses(session.user);
  }
  const container = await Container.findOne({
    where,
    include: include || [{ association: 'node' }, { association: 'collaborators' }],
  });
  if (!container || !container.node || container.node.siteId !== site.id) {
    throw new ApiError(404, 'not_found', 'Container not found');
  }
  if (requireManage && !(session.isAdmin || container.canEdit(session.user))) {
    throw new ApiError(403, 'forbidden', 'Only the owner may manage this container');
  }
  return { site, container };
}

/**
 * Whether an insert failure means a collaborator username has no matching
 * Users.uid row (foreign-key violation), as opposed to some other DB error.
 * @param {Error} err
 * @returns {boolean}
 */
function isUnknownUserError(err) {
  return err?.name === 'SequelizeForeignKeyConstraintError';
}

// Map an incoming transport service `type` to its persisted shape.
// The API exposes `tcp`, `udp`, and `tls` types, but the DB only stores
// protocol `tcp`/`udp`; a `tls` type is a TCP service with `backendTls` set
// (the load balancer re-encrypts to the backend via `proxy_ssl`).
function parseTransportType(type) {
  if (type === 'tls') return { protocol: 'tcp', backendTls: true };
  return { protocol: type, backendTls: false };
}

// Validate and normalize the TLS flag for a transport (TCP/UDP) service.
// Returns a boolean. Throws ApiError(400) when the request is inconsistent:
//   - TLS is only supported for TCP (nginx stream `ssl`; UDP would need DTLS).
//   - A TLS-enabled TCP service must reference an external domain so the load
//     balancer knows which certificate to terminate with.
function parseTransportTls(tls, protocol, externalDomainId) {
  const tlsEnabled = tls === true || tls === 'true';
  if (!tlsEnabled) return false;
  if (protocol !== 'tcp') {
    throw new ApiError(400, 'invalid_service', 'TLS can only be enabled for TCP services');
  }
  if (!externalDomainId) {
    throw new ApiError(400, 'invalid_service', 'TLS-enabled TCP services must have an externalDomainId');
  }
  return true;
}

// GET /containers/metadata?image=...
router.get(
  '/metadata',
  asyncHandler(async (req, res) => {
    const { image } = req.query;
    if (!image || !image.trim()) throw new ApiError(400, 'invalid_request', 'image is required');
    const normalized = normalizeDockerRef(image.trim());
    const parsed = parseDockerRef(normalized);
    try {
      const config = await getImageConfig(parsed.registry, `${parsed.namespace}/${parsed.image}`, parsed.tag);
      return ok(res, extractImageMetadata(config));
    } catch (err) {
      if (err.message.includes('HTTP 404')) {
        throw new ApiError(404, 'image_not_found', 'Image not found in registry');
      }
      throw new ApiError(502, 'registry_error', err.message);
    }
  }),
);

// GET /containers/new — bootstrap data for the create form
router.get(
  '/new',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req.params.siteId);
    const externalDomains = await site.getSortedExternalDomains();
    const nvidiaAvailable =
      (await Node.count({ where: { siteId: site.id, nvidiaAvailable: true } })) > 0;
    return ok(res, { siteId: site.id, externalDomains, nvidiaAvailable });
  }),
);

// GET /containers
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req.params.siteId);
    const nodes = await Node.findAll({ where: { siteId: site.id }, attributes: ['id'] });
    const nodeIds = nodes.map((n) => n.id);
    // `user` filter backs the list page's User filter: omitted, it returns
    // everything the caller may see (all owners for admins; own + shared for
    // non-admins); `user[0]=<name>` narrows to specific owners. See
    // buildContainerListWhere. Express 5's req.query is a getter that re-parses
    // on every access, so capture it once — defaulting `req.query.user` directly
    // would mutate a throwaway object.
    const query = req.query;
    query.user ??= [];
    const where = buildContainerListWhere(query, nodeIds, req.session);
    const rows = await Container.findAll({ where, include: CONTAINER_INCLUDE });
    // Resolve live statuses for the whole page in one pass: one Proxmox snapshot
    // per node (shared), and no per-container DB queries (create job is loaded above).
    const statuses = await computeContainerStatuses(rows, Job);
    return ok(
      res,
      rows.map((c) => serializeContainer(c, site, statuses.get(c.id))),
    );
  }),
);

// GET /containers/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { site, container: c } = await loadContainerForSession(
      req.params.siteId,
      req.params.id,
      req.session,
      { include: CONTAINER_INCLUDE },
    );
    const status = await computeContainerStatus({ container: c, Job });
    return ok(res, serializeContainer(c, site, status));
  }),
);

// POST /containers — create + service rows + creation job (single transaction)
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req.params.siteId);
    const t = await sequelize.transaction();
    try {
      let {
        hostname,
        template,
        customTemplate,
        services,
        environmentVars,
        entrypoint,
        nvidiaRequested,
        collaborators,
      } = req.body || {};

      if (!hostname || !hostname.trim()) throw new ApiError(400, 'invalid_request', 'hostname is required');

      // Contract: `collaborators`, when present, is an array of usernames.
      // Validated here so the insert below can trust its shape.
      collaborators ??= [];
      if (!Array.isArray(collaborators) || !collaborators.every((c) => typeof c === 'string')) {
        throw new ApiError(400, 'invalid_request', 'collaborators must be an array of usernames');
      }

      const wantsNvidia = !!nvidiaRequested;
      // Only the user-defined env vars are persisted on the container record;
      // NVIDIA and admin-defined system defaults are merged in at configure-time.
      const envVarsJson = serializeUserEnvVars(environmentVars);

      const imageRef = template === 'custom' ? customTemplate?.trim() : template;
      if (!imageRef) throw new ApiError(400, 'invalid_request', 'template is required');
      const templateName = normalizeDockerRef(imageRef);

      // Select the least-loaded provisionable node in the site, balancing by
      // container count. A node is provisionable if it's a dummy node or a node
      // with full API configuration (apiUrl/tokenId/secret). This excludes
      // half-configured nodes that would only fail later in node.api(). Beyond
      // that, the NodeApi abstraction (`node.api()`) hides how a node is
      // provisioned.
      const nodeWhere = {
        siteId: site.id,
        [Sequelize.Op.or]: [
          { nodeType: 'dummy' },
          {
            apiUrl: { [Sequelize.Op.ne]: null },
            tokenId: { [Sequelize.Op.ne]: null },
            secret: { [Sequelize.Op.ne]: null },
          },
        ],
      };
      if (wantsNvidia) nodeWhere.nvidiaAvailable = true;
      const node = await Node.findOne({
        where: nodeWhere,
        include: [{ model: Container, as: 'containers', attributes: [], required: false }],
        attributes: {
          include: [[Sequelize.fn('COUNT', Sequelize.col('containers.id')), 'containerCount']],
        },
        group: ['Node.id'],
        order: [[Sequelize.fn('COUNT', Sequelize.col('containers.id')), 'ASC']],
        subQuery: false,
      });
      if (!node && wantsNvidia) {
        throw new ApiError(409, 'no_nvidia_node', 'No NVIDIA-capable nodes available in this site');
      }
      if (!node) throw new ApiError(409, 'no_node', 'No provisionable nodes available in this site (a node needs API access or must be a dummy node)');

      const container = await Container.create(
        {
          hostname,
          username: req.session.user,
          template: templateName,
          nodeId: node.id,
          siteId: site.id,
          containerId: null,
          macAddress: null,
          ipv4Address: null,
          nvidiaRequested: wantsNvidia,
          environmentVars: envVarsJson,
          entrypoint: entrypoint && entrypoint.trim() ? entrypoint.trim() : null,
        },
        { transaction: t },
      );

      // Share with the requested collaborators (shape validated above). The
      // creator already owns the container, so they're skipped if listed.
      // Duplicates are absorbed by ignoreDuplicates (ON CONFLICT DO NOTHING /
      // INSERT OR IGNORE, which also covers repeats within the statement);
      // existence is enforced by the ContainerCollaborators.username ->
      // Users.uid foreign key, so an unknown username rolls back the whole
      // create rather than silently dropping a share. bulkCreate([]) is a no-op.
      try {
        await ContainerCollaborator.bulkCreate(
          collaborators
            .filter((username) => username !== container.username)
            .map((username) => ({ containerId: container.id, username })),
          { transaction: t, ignoreDuplicates: true },
        );
      } catch (err) {
        if (isUnknownUserError(err)) {
          throw new ApiError(404, 'user_not_found', 'One or more collaborators do not exist');
        }
        throw err;
      }

      if (services && typeof services === 'object') {
        for (const key in services) {
          const svc = services[key];
          const { type, internalPort, externalHostname, externalDomainId, dnsName, authRequired, tls } = svc;
          if (!type || !internalPort) continue;
          let serviceType;
          let protocol = null;
          let backendTls = false;
          if (type === 'http' || type === 'https') serviceType = 'http';
          else if (type === 'srv') serviceType = 'dns';
          else {
            serviceType = 'transport';
            ({ protocol, backendTls } = parseTransportType(type));
          }
          const createdService = await Service.create(
            { containerId: container.id, type: serviceType, internalPort: parseInt(internalPort, 10) },
            { transaction: t },
          );
          if (serviceType === 'http') {
            if (!externalHostname || !externalDomainId) {
              throw new ApiError(400, 'invalid_service', 'HTTP services must have an externalHostname and externalDomainId');
            }
            await HTTPService.create(
              {
                serviceId: createdService.id,
                externalHostname,
                externalDomainId: parseInt(externalDomainId, 10),
                backendProtocol: type === 'https' ? 'https' : 'http',
                authRequired: authRequired === true || authRequired === 'true',
              },
              { transaction: t },
            );
          } else if (serviceType === 'dns') {
            if (!dnsName) throw new ApiError(400, 'invalid_service', 'DNS services must have a dnsName');
            await DnsService.create(
              { serviceId: createdService.id, recordType: 'SRV', dnsName },
              { transaction: t },
            );
          } else {
            const tlsEnabled = parseTransportTls(tls, protocol, externalDomainId);
            const externalPort = await TransportService.nextAvailablePortInRange(protocol, 2000, 65535, t);
            await TransportService.create(
              {
                serviceId: createdService.id,
                protocol,
                externalPort,
                tls: tlsEnabled,
                backendTls,
                externalHostname: tlsEnabled ? externalHostname : null,
                externalDomainId: tlsEnabled ? parseInt(externalDomainId, 10) : null,
              },
              { transaction: t },
            );
          }
        }
      }

      const job = await Job.create(
        {
          command: `node bin/create-container.js --container-id=${container.id}`,
          createdBy: req.session.user,
          status: 'pending',
        },
        { transaction: t },
      );
      await container.update({ creationJobId: job.id }, { transaction: t });
      await t.commit();
      return created(res, {
        containerId: container.id,
        jobId: job.id,
        hostname: container.hostname,
        // A create job was just enqueued and there is no Proxmox VMID yet, so the
        // live status resolver would report 'creating' — return it directly.
        status: STATUS.CREATING,
      });
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }),
);

// PUT /containers/:id — service add/delete + env/entrypoint changes + optional restart job.
// Owner/admin only; collaborators get a read-only view of a shared container.
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { site, container } = await loadContainerForSession(
      req.params.siteId,
      req.params.id,
      req.session,
      { requireManage: true },
    );

    const { services, environmentVars, entrypoint } = req.body || {};
    const forceRestart = req.body?.restart === true || req.body?.restart === 'true';
    const isRestartOnly = forceRestart && !services && !environmentVars && entrypoint === undefined;

    let envVarsJson = container.environmentVars;
    if (!isRestartOnly && Array.isArray(environmentVars)) {
      envVarsJson = serializeUserEnvVars(environmentVars);
    } else if (!isRestartOnly && !environmentVars) {
      envVarsJson = null;
    }
    const newEntrypoint = isRestartOnly
      ? container.entrypoint
      : entrypoint && entrypoint.trim()
        ? entrypoint.trim()
        : null;
    const envChanged = !isRestartOnly && container.environmentVars !== envVarsJson;
    const entrypointChanged = !isRestartOnly && container.entrypoint !== newEntrypoint;
    const needsRestart = forceRestart || envChanged || entrypointChanged;

    let restartJob = null;
    const dnsWarnings = [];
    await sequelize.transaction(async (t) => {
      if (envChanged || entrypointChanged) {
        await container.update(
          {
            environmentVars: envVarsJson,
            entrypoint: newEntrypoint,
          },
          { transaction: t },
        );
      }
      if (needsRestart && container.containerId) {
        restartJob = await Job.create(
          {
            command: `node bin/reconfigure-container.js --container-id=${container.id}`,
            createdBy: req.session.user,
            status: 'pending',
          },
          { transaction: t },
        );
      }

      if (services && typeof services === 'object') {
        const deletedHttp = [];
        for (const key in services) {
          const { id, deleted } = services[key];
          if ((deleted === true || deleted === 'true') && id) {
            const svc = await Service.findByPk(parseInt(id, 10), {
              include: [
                {
                  model: HTTPService,
                  as: 'httpService',
                  include: [{ model: ExternalDomain, as: 'externalDomain' }],
                },
              ],
              transaction: t,
            });
            if (svc?.httpService?.externalDomain) {
              deletedHttp.push({
                externalHostname: svc.httpService.externalHostname,
                ExternalDomain: svc.httpService.externalDomain,
              });
            }
            await Service.destroy({
              where: { id: parseInt(id, 10), containerId: container.id },
              transaction: t,
            });
          }
        }
        for (const key in services) {
          const { id, deleted, authRequired } = services[key];
          if (deleted === true || deleted === 'true' || !id) continue;
          const svc = await Service.findByPk(parseInt(id, 10), {
            include: [{ model: HTTPService, as: 'httpService' }],
            transaction: t,
          });
          if (svc?.httpService) {
            const next = authRequired === true || authRequired === 'true';
            if (svc.httpService.authRequired !== next) {
              await svc.httpService.update({ authRequired: next }, { transaction: t });
            }
          }
        }
        const newHttp = [];
        for (const key in services) {
          const { id, deleted, type, internalPort, externalHostname, externalDomainId, dnsName, authRequired, tls } =
            services[key];
          if (deleted === true || deleted === 'true' || id || !type || !internalPort) continue;
          const serviceType =
            type === 'srv' ? 'dns' : type === 'http' || type === 'https' ? 'http' : 'transport';
          const { protocol, backendTls } =
            serviceType === 'transport' ? parseTransportType(type) : { protocol: null, backendTls: false };
          const createdService = await Service.create(
            { containerId: container.id, type: serviceType, internalPort: parseInt(internalPort, 10) },
            { transaction: t },
          );
          if (serviceType === 'http') {
            await HTTPService.create(
              {
                serviceId: createdService.id,
                externalHostname,
                externalDomainId,
                backendProtocol: type === 'https' ? 'https' : 'http',
                authRequired: authRequired === true || authRequired === 'true',
              },
              { transaction: t },
            );
            const domain = await ExternalDomain.findByPk(parseInt(externalDomainId, 10), { transaction: t });
            if (domain) newHttp.push({ externalHostname, ExternalDomain: domain });
          } else if (serviceType === 'dns') {
            await DnsService.create(
              { serviceId: createdService.id, recordType: 'SRV', dnsName },
              { transaction: t },
            );
          } else {
            const tlsEnabled = parseTransportTls(tls, protocol, externalDomainId);
            const externalPort = await TransportService.nextAvailablePortInRange(protocol, 2000, 65535);
            await TransportService.create(
              {
                serviceId: createdService.id,
                protocol,
                externalPort,
                tls: tlsEnabled,
                backendTls,
                externalHostname: tlsEnabled ? externalHostname : null,
                externalDomainId: tlsEnabled ? parseInt(externalDomainId, 10) : null,
              },
              { transaction: t },
            );
          }
        }
        if (deletedHttp.length > 0) {
          dnsWarnings.push(...(await manageDnsRecords(deletedHttp, site, 'delete')));
        }
        if (newHttp.length > 0) {
          dnsWarnings.push(...(await manageDnsRecords(newHttp, site, 'create')));
        }
      }
    });

    return ok(res, {
      containerId: container.id,
      jobId: restartJob ? restartJob.id : null,
      dnsWarnings,
      message: restartJob ? 'Container is restarting' : 'Container updated',
    });
  }),
);

// DELETE /containers/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    // Deleting is owner/admin only; collaborators may use but not destroy a
    // shared container (requireManage -> 403 for a viewer who isn't the owner).
    const { site, container } = await loadContainerForSession(
      req.params.siteId,
      req.params.id,
      req.session,
      {
        requireManage: true,
        include: [
          { association: 'node' },
          { association: 'collaborators' },
          {
            association: 'services',
            include: [{ association: 'httpService', include: [{ association: 'externalDomain' }] }],
          },
        ],
      },
    );
    const node = container.node;
    let dnsWarnings = [];
    const httpServices = (container.services || [])
      .filter((s) => s.httpService?.externalDomain)
      .map((s) => ({
        externalHostname: s.httpService.externalHostname,
        ExternalDomain: s.httpService.externalDomain,
      }));
    if (httpServices.length > 0) {
      dnsWarnings = await manageDnsRecords(httpServices, site, 'delete');
    }
    // Delete the backing VM through the node's API. The NodeApi abstraction
    // (`node.api()`) hides the provider; a dummy node simply no-ops here. We
    // only attempt this when the container was actually provisioned (has a
    // VMID/containerId).
    if (container.containerId) {
      try {
        const api = await node.api();
        const config = await api.lxcConfig(node.name, container.containerId);
        if (config.hostname && config.hostname !== container.hostname) {
          throw new ApiError(
            409,
            'hostname_mismatch',
            `Hostname mismatch (DB: ${container.hostname} vs Proxmox: ${config.hostname}). Delete aborted.`,
          );
        }
        await api.deleteContainer(node.name, container.containerId, true, true);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.log(`Node-side deletion skipped or failed: ${err.message}`);
      }
    }
    // Sharing grants are removed by the database via the containerId foreign
    // key's ON DELETE CASCADE.
    await container.destroy();

    // Remove the VM from NetBox if the integration is configured
    await withNetbox(Setting, (baseUrl, token) =>
      deleteVirtualMachine(baseUrl, token, container.hostname),
    );

    return ok(res, { deleted: true, dnsWarnings });
  }),
);

// GET /containers/:id/collaborators — list users a container is shared with.
// Visible to anyone who can access the container (owner, collaborator, admin).
router.get(
  '/:id/collaborators',
  asyncHandler(async (req, res) => {
    // The loader already eager-loads `collaborators`, so no second query.
    const { container } = await loadContainerForSession(req.params.siteId, req.params.id, req.session);
    return ok(res, { collaborators: container.collaboratorNames() });
  }),
);

// POST /containers/:id/collaborators — share with another user (owner/admin).
// Body: { username }. Idempotent: sharing with an existing collaborator is a
// no-op that returns the current list. 404 user_not_found if the username
// doesn't exist (enforced by the Users.uid foreign key).
router.post(
  '/:id/collaborators',
  asyncHandler(async (req, res) => {
    const { container } = await loadContainerForSession(req.params.siteId, req.params.id, req.session, {
      requireManage: true,
    });
    // Contract: `username` is a required non-empty string; existence is
    // enforced by the Users.uid foreign key at insert (mapped to 404 below).
    const username = req.body?.username;
    if (typeof username !== 'string' || !username) {
      throw new ApiError(400, 'invalid_request', 'username must be a non-empty string');
    }
    if (username === container.username) {
      throw new ApiError(409, 'already_owner', `${username} already owns this container`);
    }
    try {
      const [collaborator, isNew] = await ContainerCollaborator.findOrCreate({
        where: { containerId: container.id, username },
      });
      // The eager load predates the insert; push the new row in place (the
      // association shares one array with dataValues) instead of re-querying.
      if (isNew) container.collaborators.push(collaborator);
    } catch (err) {
      if (isUnknownUserError(err)) {
        throw new ApiError(404, 'user_not_found', `User "${username}" does not exist`);
      }
      throw err;
    }
    return created(res, { collaborators: container.collaboratorNames() });
  }),
);

// DELETE /containers/:id/collaborators/:username — stop sharing (owner/admin).
router.delete(
  '/:id/collaborators/:username',
  asyncHandler(async (req, res) => {
    const { container } = await loadContainerForSession(req.params.siteId, req.params.id, req.session, {
      requireManage: true,
    });
    const removed = await ContainerCollaborator.destroy({
      where: { containerId: container.id, username: req.params.username },
    });
    if (!removed) throw new ApiError(404, 'not_found', 'Collaborator not found');
    // Splice the removed row out of the eager-loaded association in place (it
    // shares one array with dataValues; reassignment would desync them).
    const idx = container.collaborators.findIndex((c) => c.username === req.params.username);
    if (idx !== -1) container.collaborators.splice(idx, 1);
    return ok(res, { collaborators: container.collaboratorNames() });
  }),
);

module.exports = router;
