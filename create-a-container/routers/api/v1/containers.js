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
  User,
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

async function loadSite(req) {
  const site = await Site.findByPk(parseInt(req.params.siteId, 10));
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
    // Additional users this container is shared with. Sorted for a stable UI;
    // present on every payload so consumers can render/manage sharing.
    collaborators: (c.collaborators || [])
      .map((x) => x.username)
      .sort((a, b) => a.localeCompare(b)),
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
      { association: 'transportService' },
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
 * Build the `where` clause for a container list query, scoped to the given
 * site's nodes and narrowed by the supported query-string filters
 * (`hostname`, `nodeId`). The `nodeId` filter is intersected with the site's
 * own nodes so it can never widen the result set beyond the site.
 * @param {object} query - req.query
 * @param {number[]} nodeIds - IDs of the nodes belonging to the site
 * @returns {object} Sequelize where clause
 */
function buildContainerListWhere(query, nodeIds) {
  const where = { nodeId: nodeIds };
  if (query.hostname) where.hostname = query.hostname;
  if (query.nodeId) {
    const nodeId = parseInt(query.nodeId, 10);
    // Restrict to the requested node only when it belongs to this site;
    // otherwise force an empty result rather than leaking other sites' nodes.
    where.nodeId = Number.isInteger(nodeId) && nodeIds.includes(nodeId) ? nodeId : -1;
  }
  return where;
}

/**
 * Apply the `user` list filter to a Sequelize `where`, enforcing authorization
 * and folding in shared containers. It backs the single containers screen's
 * "User" filter.
 * The `user` query param may be a single username, a comma-separated list of
 * usernames, or the wildcard `*`. Absent/empty -> the caller's own containers
 * (the default screen). `*` -> every owner on the site for admins; the caller's
 * own plus any shared with them for non-admins. A list of names -> those owners
 * for admins; for non-admins the same list intersected with what they may
 * already see (own plus shared), so a non-admin can only narrow down to owners
 * who have shared a container with them and never widen their visibility.
 * @param {object} where - The Sequelize where clause to mutate (already scoped
 *   to the site's nodes).
 * @param {object} req - Express request (uses req.query.user, req.session).
 * @returns {Promise<object>} The same `where`, mutated.
 */
async function applyOwnershipFilter(where, req) {
  const session = req.session;
  const names = parseUserFilter(req.query.user);
  if (names.length === 0) {
    where.username = session.user; // default: the caller's own containers
    return where;
  }
  if (names.includes('*')) {
    if (session.isAdmin) return where; // every owner on the site
    where[Sequelize.Op.or] = await ownVisibleClauses(session.user);
    return where;
  }
  if (session.isAdmin) {
    where.username = names.length === 1 ? names[0] : { [Sequelize.Op.in]: names };
    return where;
  }
  // Non-admin: intersect the requested owners with what they may already see.
  where[Sequelize.Op.and] = [
    { [Sequelize.Op.or]: await ownVisibleClauses(session.user) },
    { username: { [Sequelize.Op.in]: names } },
  ];
  return where;
}

/**
 * Parse the `user` list filter into a de-duplicated array of usernames. Accepts
 * a single value, a repeated query param (array), or a comma-separated string.
 * Returns an empty array when no filter was supplied.
 * @param {*} raw - req.query.user.
 * @returns {string[]}
 */
function parseUserFilter(raw) {
  if (raw === undefined || raw === null) return [];
  const parts = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

/**
 * Sequelize OR clauses matching every container a non-admin may see: their own
 * plus any shared with them. An empty shared set collapses to just their own.
 * @param {string} username - The requesting user's uid.
 * @returns {Promise<object[]>}
 */
async function ownVisibleClauses(username) {
  const shares = await ContainerCollaborator.findAll({
    where: { username },
    attributes: ['containerId'],
  });
  const sharedIds = shares.map((s) => s.containerId);
  return [{ username }, ...(sharedIds.length > 0 ? [{ id: sharedIds }] : [])];
}

/**
 * Whether a session may view/edit a container: its owner, a collaborator it is
 * shared with, or an admin. Requires `collaborators` to be loaded on the record.
 * @param {object} container - Container instance with `collaborators` included.
 * @param {object} session - req.session ({ user, isAdmin }).
 * @returns {boolean}
 */
function userCanAccess(container, session) {
  if (session.isAdmin) return true;
  if (container.username === session.user) return true;
  return (container.collaborators || []).some((c) => c.username === session.user);
}

/**
 * Whether a session may manage a container's sharing (add/remove collaborators)
 * or delete it: only its primary owner or an admin. Collaborators can use a
 * shared container but cannot re-share or delete it.
 * @param {object} container - Container instance.
 * @param {object} session - req.session ({ user, isAdmin }).
 * @returns {boolean}
 */
function userCanManage(container, session) {
  return session.isAdmin || container.username === session.user;
}

/**
 * Load a container by `:id` scoped to the request's site and authorize the
 * session against it. Returns 404 (not 403) on any failure so the route never
 * leaks the existence of containers the caller may not see.
 * @param {object} req - Express request.
 * @param {object} [opts]
 * @param {boolean} [opts.requireManage=false] - Require owner/admin (sharing,
 *   delete) rather than the looser view/edit access.
 * @param {Array} [opts.include] - Override the eager-load graph.
 * @returns {Promise<{site: object, container: object}>}
 */
async function loadContainerForSession(req, { requireManage = false, include } = {}) {
  const site = await loadSite(req);
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, 'not_found', 'Container not found');
  }
  const container = await Container.findByPk(id, {
    include: include || [{ association: 'node' }, { association: 'collaborators' }],
  });
  if (!container || !container.node || container.node.siteId !== site.id) {
    throw new ApiError(404, 'not_found', 'Container not found');
  }
  const authorized = requireManage
    ? userCanManage(container, req.session)
    : userCanAccess(container, req.session);
  if (!authorized) throw new ApiError(404, 'not_found', 'Container not found');
  return { site, container };
}

/**
 * Validate a username to share a container with. Confirms the user exists and
 * is not already the container's primary owner, and returns the canonical uid.
 * @param {*} rawUsername - Candidate username from the request body.
 * @param {object} container - The container being shared.
 * @param {object} [opts] - Optional { transaction } for the lookup.
 * @returns {Promise<string>} The canonical uid to store as a collaborator.
 */
async function resolveShareUsername(rawUsername, container, { transaction } = {}) {
  const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
  if (!username) throw new ApiError(400, 'invalid_request', 'A username is required');
  const user = await User.findOne({ where: { uid: username }, transaction });
  if (!user) throw new ApiError(404, 'user_not_found', `User "${username}" does not exist`);
  if (user.uid === container.username) {
    throw new ApiError(409, 'already_owner', `${user.uid} already owns this container`);
  }
  return user.uid;
}

/**
 * Load the current collaborator usernames for a container, sorted for a stable
 * UI. Shared shape returned by the share/unshare endpoints.
 * @param {number} containerId
 * @returns {Promise<string[]>}
 */
async function listCollaboratorUsernames(containerId) {
  const rows = await ContainerCollaborator.findAll({
    where: { containerId },
    attributes: ['username'],
    order: [['username', 'ASC']],
  });
  return rows.map((r) => r.username);
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
    const site = await loadSite(req);
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
    const site = await loadSite(req);
    const nodes = await Node.findAll({ where: { siteId: site.id }, attributes: ['id'] });
    const nodeIds = nodes.map((n) => n.id);
    const where = buildContainerListWhere(req.query, nodeIds);
    // `user` filter drives the Mine/All toggle and folds in shared containers:
    // defaults to the requesting user (Mine); admins may pass `user=*` for every
    // owner or `user=<name>` for a specific one; non-admins passing `user=*` get
    // their own plus any containers shared with them. See applyOwnershipFilter.
    await applyOwnershipFilter(where, req);
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
    const site = await loadSite(req);
    // Guard against non-numeric ids (e.g. "undefined", "NaN"): parseInt would
    // yield NaN and reach the DB as an invalid integer comparison, surfacing as
    // a 500. Treat anything non-numeric as "not found".
    const containerId = parseInt(req.params.id, 10);
    if (!Number.isInteger(containerId) || containerId <= 0) {
      throw new ApiError(404, 'not_found', 'Container not found');
    }
    const c = await Container.findOne({
      where: { id: containerId },
      include: CONTAINER_INCLUDE,
    });
    if (!c || !c.node || c.node.siteId !== site.id || !userCanAccess(c, req.session)) {
      throw new ApiError(404, 'not_found', 'Container not found');
    }
    const status = await computeContainerStatus({ container: c, Job });
    return ok(res, serializeContainer(c, site, status));
  }),
);

// POST /containers — create + service rows + creation job (single transaction)
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
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
        additionalOwners,
      } = req.body || {};

      if (!hostname || !hostname.trim()) throw new ApiError(400, 'invalid_request', 'hostname is required');

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

      // Additional owners (collaborators) the creator chose to share with.
      // Each must be an existing user and is validated up front so a typo fails
      // the whole create (rolled back) rather than silently dropping a share.
      // The creator is the owner already, so skip them if they list themselves.
      if (Array.isArray(additionalOwners) && additionalOwners.length > 0) {
        const seen = new Set();
        for (const raw of additionalOwners) {
          const trimmed = typeof raw === 'string' ? raw.trim() : '';
          if (!trimmed || trimmed === container.username) continue;
          const username = await resolveShareUsername(raw, container, { transaction: t });
          if (seen.has(username)) continue;
          seen.add(username);
          await ContainerCollaborator.create(
            { containerId: container.id, username },
            { transaction: t },
          );
        }
      }

      if (services && typeof services === 'object') {
        for (const key in services) {
          const svc = services[key];
          const { type, internalPort, externalHostname, externalDomainId, dnsName, authRequired } = svc;
          if (!type || !internalPort) continue;
          let serviceType;
          let protocol = null;
          if (type === 'http' || type === 'https') serviceType = 'http';
          else if (type === 'srv') serviceType = 'dns';
          else {
            serviceType = 'transport';
            protocol = type;
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
            const externalPort = await TransportService.nextAvailablePortInRange(protocol, 2000, 65565, t);
            await TransportService.create(
              { serviceId: createdService.id, protocol, externalPort },
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

// PUT /containers/:id — service add/delete + env/entrypoint changes + optional restart job
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req);
    const container = await Container.findOne({
      where: { id: parseInt(req.params.id, 10) },
      include: [
        { model: Node, as: 'node', where: { siteId: site.id } },
        { association: 'collaborators' },
      ],
    });
    if (!container || !userCanAccess(container, req.session)) {
      throw new ApiError(404, 'not_found', 'Container not found');
    }

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
          const { id, deleted, type, internalPort, externalHostname, externalDomainId, dnsName, authRequired } =
            services[key];
          if (deleted === true || deleted === 'true' || id || !type || !internalPort) continue;
          const serviceType =
            type === 'srv' ? 'dns' : type === 'http' || type === 'https' ? 'http' : 'transport';
          const protocol = serviceType === 'transport' ? type : null;
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
            const externalPort = await TransportService.nextAvailablePortInRange(protocol, 2000, 65565);
            await TransportService.create(
              { serviceId: createdService.id, protocol, externalPort },
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
    const site = await loadSite(req);
    const container = await Container.findOne({
      where: { id: parseInt(req.params.id, 10) },
      include: [
        { model: Node, as: 'node' },
        { association: 'collaborators' },
        {
          model: Service,
          as: 'services',
          include: [
            {
              model: HTTPService,
              as: 'httpService',
              include: [{ model: ExternalDomain, as: 'externalDomain' }],
            },
          ],
        },
      ],
    });
    if (!container || !container.node || container.node.siteId !== site.id) {
      throw new ApiError(404, 'not_found', 'Container not found');
    }
    // Deleting is owner/admin only; collaborators may use but not destroy a
    // shared container.
    if (!userCanManage(container, req.session)) {
      throw new ApiError(404, 'not_found', 'Container not found');
    }
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
    // Remove sharing grants explicitly so the rows are gone regardless of
    // whether the DB enforces the ON DELETE CASCADE foreign key.
    await ContainerCollaborator.destroy({ where: { containerId: container.id } });
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
    const { container } = await loadContainerForSession(req);
    return ok(res, { collaborators: await listCollaboratorUsernames(container.id) });
  }),
);

// POST /containers/:id/collaborators — share with another user (owner/admin).
// Body: { username }. 404 user_not_found if the username doesn't exist.
router.post(
  '/:id/collaborators',
  asyncHandler(async (req, res) => {
    const { container } = await loadContainerForSession(req, { requireManage: true });
    const username = await resolveShareUsername(req.body?.username, container);
    const [, isNew] = await ContainerCollaborator.findOrCreate({
      where: { containerId: container.id, username },
    });
    if (!isNew) {
      throw new ApiError(409, 'already_shared', `Already shared with ${username}`);
    }
    return created(res, { collaborators: await listCollaboratorUsernames(container.id) });
  }),
);

// DELETE /containers/:id/collaborators/:username — stop sharing (owner/admin).
router.delete(
  '/:id/collaborators/:username',
  asyncHandler(async (req, res) => {
    const { container } = await loadContainerForSession(req, { requireManage: true });
    const removed = await ContainerCollaborator.destroy({
      where: { containerId: container.id, username: req.params.username },
    });
    if (!removed) throw new ApiError(404, 'not_found', 'Collaborator not found');
    return ok(res, { collaborators: await listCollaboratorUsernames(container.id) });
  }),
);

module.exports = router;
