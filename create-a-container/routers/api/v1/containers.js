/**
 * /api/v1/sites/:siteId/containers — full CRUD and metadata helpers.
 * Mounted with mergeParams to access :siteId from the parent /sites router.
 */

const express = require('express');
const {
  Container,
  Service,
  HTTPService,
  TransportService,
  DnsService,
  Node,
  Site,
  ExternalDomain,
  Job,
  Sequelize,
  sequelize,
} = require('../../../models');
const { parseDockerRef, getImageConfig, extractImageMetadata } = require('../../../utils/docker-registry');
const { manageDnsRecords } = require('../../../utils/cloudflare-dns');
const { apiAuth, asyncHandler, ok, created, ApiError } = require('../../../middlewares/api');

const router = express.Router({ mergeParams: true });

router.use(apiAuth);

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

function serializeContainer(c, site) {
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
    ipv4Address: c.ipv4Address,
    macAddress: c.macAddress,
    status: c.status,
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
    const where = { username: req.session.user, nodeId: nodeIds };
    if (req.query.hostname) where.hostname = req.query.hostname;
    const rows = await Container.findAll({
      where,
      include: [
        {
          association: 'services',
          include: [
            { association: 'httpService', include: [{ association: 'externalDomain' }] },
            { association: 'transportService' },
            { association: 'dnsService' },
          ],
        },
        { association: 'node', attributes: ['id', 'name', 'apiUrl'] },
      ],
    });
    return ok(res, rows.map((c) => serializeContainer(c, site)));
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
      where: { id: containerId, username: req.session.user },
      include: [
        {
          association: 'services',
          include: [
            { association: 'httpService', include: [{ association: 'externalDomain' }] },
            { association: 'transportService' },
            { association: 'dnsService' },
          ],
        },
        { association: 'node' },
      ],
    });
    if (!c || !c.node || c.node.siteId !== site.id) {
      throw new ApiError(404, 'not_found', 'Container not found');
    }
    return ok(res, serializeContainer(c, site));
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
      } = req.body || {};

      if (!hostname || !hostname.trim()) throw new ApiError(400, 'invalid_request', 'hostname is required');

      const wantsNvidia = !!nvidiaRequested;
      let envVarsJson = null;
      if (Array.isArray(environmentVars) && environmentVars.length > 0) {
        const envObj = {};
        for (const e of environmentVars) {
          if (e?.key && e.key.trim()) envObj[e.key.trim()] = e.value || '';
        }
        if (Object.keys(envObj).length > 0) envVarsJson = JSON.stringify(envObj);
      }
      if (wantsNvidia) {
        const obj = envVarsJson ? JSON.parse(envVarsJson) : {};
        if (!obj.NVIDIA_VISIBLE_DEVICES) obj.NVIDIA_VISIBLE_DEVICES = 'all';
        if (!obj.NVIDIA_DRIVER_CAPABILITIES) obj.NVIDIA_DRIVER_CAPABILITIES = 'utility compute';
        envVarsJson = JSON.stringify(obj);
      }

      const imageRef = template === 'custom' ? customTemplate?.trim() : template;
      if (!imageRef) throw new ApiError(400, 'invalid_request', 'template is required');
      const templateName = normalizeDockerRef(imageRef);

      const nodeWhere = {
        siteId: site.id,
        apiUrl: { [Sequelize.Op.ne]: null },
        tokenId: { [Sequelize.Op.ne]: null },
        secret: { [Sequelize.Op.ne]: null },
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
      if (!node) throw new ApiError(409, 'no_node', 'No nodes with API access available in this site');

      const container = await Container.create(
        {
          hostname,
          username: req.session.user,
          status: 'pending',
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

      // Local dev: short-circuit Proxmox provisioning. The on-demand `local`
      // node (apiUrl === 'local') has no real hypervisor, so mark the container
      // running immediately with placeholder VMID/MAC/IP. This is the hook point
      // where a real Docker-based local provisioner can plug in later.
      if (process.env.NODE_ENV !== 'production' && node.apiUrl === 'local') {
        const fakeVmid = 9000 + container.id;
        const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
        await container.update(
          {
            containerId: fakeVmid,
            macAddress: `BC:24:11:${hex()}:${hex()}:${hex()}`,
            ipv4Address: `10.0.0.${100 + (container.id % 150)}`,
            status: 'running',
          },
          { transaction: t },
        );
        await t.commit();
        return created(res, {
          containerId: container.id,
          hostname: container.hostname,
          status: 'running',
        });
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
        status: 'pending',
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
      where: { id: parseInt(req.params.id, 10), username: req.session.user },
      include: [{ model: Node, as: 'node', where: { siteId: site.id } }],
    });
    if (!container) throw new ApiError(404, 'not_found', 'Container not found');

    const { services, environmentVars, entrypoint } = req.body || {};
    const forceRestart = req.body?.restart === true || req.body?.restart === 'true';
    const isRestartOnly = forceRestart && !services && !environmentVars && entrypoint === undefined;

    let envVarsJson = container.environmentVars;
    if (!isRestartOnly && Array.isArray(environmentVars)) {
      const obj = {};
      for (const e of environmentVars) {
        if (e?.key) obj[e.key.trim()] = e.value || '';
      }
      envVarsJson = Object.keys(obj).length > 0 ? JSON.stringify(obj) : null;
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
            status: needsRestart && container.containerId ? 'restarting' : container.status,
          },
          { transaction: t },
        );
      } else if (forceRestart && container.containerId) {
        await container.update({ status: 'restarting' }, { transaction: t });
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
      where: { id: parseInt(req.params.id, 10), username: req.session.user },
      include: [
        { model: Node, as: 'node' },
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
    if (container.containerId && node.apiUrl && node.tokenId) {
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
        console.log(`Proxmox deletion skipped or failed: ${err.message}`);
      }
    }
    await container.destroy();
    return ok(res, { deleted: true, dnsWarnings });
  }),
);

module.exports = router;
