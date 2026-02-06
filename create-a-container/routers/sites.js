const dns = require('dns').promises;
const os = require('os');
const path = require('path')
const express = require('express');
const stringify = require('dotenv-stringify');
const { Site, Node, Container, Service, HTTPService, TransportService, DnsService, ExternalDomain, Job, sequelize } = require('../models');
const { requireAuth, requireAdmin, requireLocalhost, setCurrentSite } = require('../middlewares');
const { queueTraefikConfigJob } = require('../utils/traefik');

const router = express.Router();

// GET /sites/:siteId/dnsmasq.conf - Public endpoint for dnsmasq configuration
router.get('/:siteId/dnsmasq.conf', requireLocalhost, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId, {
    include: [{
      model: Node,
      as: 'nodes',
      include: [{
        model: Container,
        as: 'containers',
        where: { status: 'running' },
        required: false,
        attributes: ['macAddress', 'ipv4Address', 'hostname'],
        include: [{
          model: Service,
          as: 'services',
          include: [{
            model: DnsService,
            as: 'dnsService'
          }]
        }]
      }]
    }]
  });
  
  if (!site) {
    return res.status(404).send('Site not found');
  }
  
  res.set('Content-Type', 'text/plain');
  return res.render('dnsmasq-conf', { site });
});

// GET /sites/:siteId/nginx.conf - Public endpoint for nginx configuration
router.get('/:siteId/nginx.conf', requireLocalhost, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  // fetch services for the specific site (only from running containers)
  const site = await Site.findByPk(siteId, {
    include: [{
      model: Node,
      as: 'nodes',
      include: [{
        model: Container,
        as: 'containers',
        where: { status: 'running' },
        required: false,
        include: [{
          model: Service,
          as: 'services',
          include: [
            {
              model: HTTPService,
              as: 'httpService',
              include: [{
                model: ExternalDomain,
                as: 'externalDomain'
              }]
            },
            {
              model: TransportService,
              as: 'transportService'
            }
          ]
        }]
      }]
    }, {
      model: ExternalDomain,
      as: 'externalDomains'
    }]
  });

  // Flatten services from site→nodes→containers→services
  const allServices = [];
  site?.nodes?.forEach(node => {
    node?.containers?.forEach(container => {
      container?.services?.forEach(service => {
        // Add container reference for template compatibility
        service.Container = container;
        allServices.push(service);
      });
    });
  });
  
  // Filter by type
  const httpServices = allServices.filter(s => s.type === 'http');
  const streamServices = allServices.filter(s => s.type === 'transport');
  
  res.set('Content-Type', 'text/plain');
  return res.render('nginx-conf', { httpServices, streamServices, externalDomains: site?.externalDomains || [] });
});

// GET /sites/:siteId/traefik.json - Dynamic configuration for Traefik HTTP provider
router.get('/:siteId/traefik.json', async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  // Fetch services for the specific site (only from running containers)
  const site = await Site.findByPk(siteId, {
    include: [{
      model: Node,
      as: 'nodes',
      include: [{
        model: Container,
        as: 'containers',
        where: { status: 'running' },
        required: false,
        include: [{
          model: Service,
          as: 'services',
          include: [
            {
              model: HTTPService,
              as: 'httpService',
              include: [{
                model: ExternalDomain,
                as: 'externalDomain'
              }]
            },
            {
              model: TransportService,
              as: 'transportService'
            }
          ]
        }]
      }]
    }, {
      model: ExternalDomain,
      as: 'externalDomains'
    }]
  });

  if (!site) {
    return res.status(404).json({ error: 'Site not found' });
  }

  // Build Traefik dynamic configuration
  const config = {
    http: {
      routers: {},
      services: {}
    },
    tcp: {
      routers: {},
      services: {}
    },
    udp: {
      routers: {},
      services: {}
    }
  };

  // Helper to sanitize names for Traefik identifiers
  const sanitizeName = (name) => name.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Process all services from site→nodes→containers→services
  site?.nodes?.forEach(node => {
    node?.containers?.forEach(container => {
      container?.services?.forEach(service => {
        if (service.type === 'http' && service.httpService) {
          const hs = service.httpService;
          const domain = hs.externalDomain;
          if (!domain) return;

          const fqdn = `${hs.externalHostname}.${domain.name}`;
          const routerName = sanitizeName(fqdn);
          const serviceName = sanitizeName(fqdn);
          const resolverName = domain.name.replace(/[.-]/g, '_');

          // HTTP Router
          config.http.routers[routerName] = {
            rule: `Host(\`${fqdn}\`)`,
            service: serviceName,
            entryPoints: ['websecure'],
            tls: {
              certResolver: resolverName
            }
          };

          // HTTP Service
          config.http.services[serviceName] = {
            loadBalancer: {
              servers: [
                { url: `http://${container.ipv4Address}:${service.internalPort}` }
              ]
            }
          };

        } else if (service.type === 'transport' && service.transportService) {
          const ts = service.transportService;
          const protocol = ts.protocol;
          const port = ts.externalPort;
          const entryPointName = `${protocol}-${port}`;
          const routerName = sanitizeName(`${container.hostname}-${protocol}-${port}`);
          const serviceName = routerName;

          if (protocol === 'tcp') {
            // TCP Router
            config.tcp.routers[routerName] = {
              entryPoints: [entryPointName],
              rule: 'HostSNI(`*`)',
              service: serviceName
            };

            // Add TLS if configured
            if (ts.tls) {
              config.tcp.routers[routerName].tls = {};
            }

            // TCP Service
            config.tcp.services[serviceName] = {
              loadBalancer: {
                servers: [
                  { address: `${container.ipv4Address}:${service.internalPort}` }
                ]
              }
            };

          } else if (protocol === 'udp') {
            // UDP Router
            config.udp.routers[routerName] = {
              entryPoints: [entryPointName],
              service: serviceName
            };

            // UDP Service
            config.udp.services[serviceName] = {
              loadBalancer: {
                servers: [
                  { address: `${container.ipv4Address}:${service.internalPort}` }
                ]
              }
            };
          }
        }
      });
    });
  });

  // Clean up empty sections
  if (Object.keys(config.http.routers).length === 0) {
    delete config.http;
  }
  if (Object.keys(config.tcp.routers).length === 0) {
    delete config.tcp;
  }
  if (Object.keys(config.udp.routers).length === 0) {
    delete config.udp;
  }

  res.set('Content-Type', 'application/json');
  return res.json(config);
});

// GET /sites/:siteId/ldap.conf - Public endpoint for LDAP configuration
router.get('/:siteId/ldap.conf', requireLocalhost, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    return res.status(404).send('Site not found');
  }

  // Get push notification settings
  const { Setting } = require('../models');
  const settings = await Setting.getMultiple(['push_notification_url', 'push_notification_enabled']);
  const pushNotificationUrl = settings.push_notification_url || '';
  const pushNotificationEnabled = settings.push_notification_enabled === 'true';

  // define the environment object
  const env = {
    DIRECTORY_BACKEND: 'sql',
    REQUIRE_AUTH_FOR_SEARCH: false,
  };

  // Configure AUTH_BACKENDS and NOTIFICATION_URL based on push notification settings
  if (pushNotificationEnabled && pushNotificationUrl.trim() !== '') {
    env.AUTH_BACKENDS = 'sql,notification';
    env.NOTIFICATION_URL = `${pushNotificationUrl}/send-notification`;
  } else {
    env.AUTH_BACKENDS = 'sql';
  }

  // Get the real IP from the request or the x-forwarded-for header
  // and do a reverse DNS lookup to get the hostname. If the clientIP is any
  // localhost address, use the FQDN of the server instead.
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const isLocalhost = clientIp === '127.0.0.1' || 
                      clientIp === '::1' || 
                      clientIp === '::ffff:127.0.0.1' ||
                      clientIp === 'localhost';
  if (isLocalhost) {
    env.LDAP_COMMON_NAME = os.hostname();
  } else {
    env.LDAP_COMMON_NAME = await dns.reverse(clientIp).then(names => names[0]).catch(() => clientIp);
  }

  // Parse site.internalDomain into DN format, i.e. dc=example,dc=com
  env.LDAP_BASE_DN = site.internalDomain
    .split('.')
    .map(part => `dc=${part}`)
    .join(',');

  // Parse the DB config from the environment variables used in
  // config/config.js and construct the SQL URL
  const config = require('../config/config')[process.env.NODE_ENV || 'development'];   
  const sqlUrlBuilder = new URL(`${config.dialect}://`);
  sqlUrlBuilder.hostname = config.host || '';
  sqlUrlBuilder.username = config.username || '';
  sqlUrlBuilder.password = config.password || '';
  sqlUrlBuilder.port = config.port || '';
  sqlUrlBuilder.pathname = config.database || path.resolve(config.storage);
  env.SQL_URI = sqlUrlBuilder.toString();

  // Use sequelize to generate properly quoted queries for the current database dialect
  const qi = sequelize.getQueryInterface();
  env.SQL_QUERY_ALL_USERS = `
    SELECT
      ${qi.quoteIdentifier('uid')} AS username,
      ${qi.quoteIdentifier('uidNumber')} AS uid_number,
      ${qi.quoteIdentifier('gidNumber')} AS gid_number,
      ${qi.quoteIdentifier('cn')} AS full_name,
      ${qi.quoteIdentifier('sn')} AS surname,
      ${qi.quoteIdentifier('mail')},
      ${qi.quoteIdentifier('homeDirectory')} AS home_directory,
      ${qi.quoteIdentifier('userPassword')} AS password
    FROM ${qi.quoteIdentifier('Users')}
  `.replace(/\n/g, ' ');
  env.SQL_QUERY_ONE_USER = `
    ${env.SQL_QUERY_ALL_USERS}
    WHERE ${qi.quoteIdentifier('uid')} = ?
  `.replace(/\n/g, ' ');

  env.SQL_QUERY_ALL_GROUPS = `
    SELECT
      g.${qi.quoteIdentifier('cn')} AS name,
      g.${qi.quoteIdentifier('gidNumber')} AS gid_number
    FROM ${qi.quoteIdentifier('Groups')} g
  `.replace(/\n/g, ' ');
  env.SQL_QUERY_GROUPS_BY_MEMBER = `
    ${env.SQL_QUERY_ALL_GROUPS}
    INNER JOIN ${qi.quoteIdentifier('UserGroups')} ug
      ON g.${qi.quoteIdentifier('gidNumber')} = ug.${qi.quoteIdentifier('gidNumber')}
    INNER JOIN ${qi.quoteIdentifier('Users')} u
      ON ug.${qi.quoteIdentifier('uidNumber')} = u.${qi.quoteIdentifier('uidNumber')}
    WHERE u.${qi.quoteIdentifier('uid')} = ?
  `.replace(/\n/g, ' ');

  res.set('Content-Type', 'text/plain');
  return res.send(stringify(env));
});

// Apply auth to all routes below this point
router.use(requireAuth);

// store the current site for routes with :siteId
router.use('/:siteId', setCurrentSite);

// Mount sub-routers
const nodesRouter = require('./nodes');
const containersRouter = require('./containers');
const externalDomainsRouter = require('./external-domains');
router.use('/:siteId/nodes', nodesRouter);
router.use('/:siteId/containers', containersRouter);
router.use('/:siteId/external-domains', externalDomainsRouter);

// POST /sites/:siteId/reconfigure-traefik - Queue Traefik config regeneration job (admin only)
router.post('/:siteId/reconfigure-traefik', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  try {
    const site = await Site.findByPk(siteId);
    if (!site) {
      await req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const job = await queueTraefikConfigJob(siteId, req.session.user);
    
    if (job) {
      return res.redirect(`/jobs/${job.id}`);
    } else {
      // Job already pending - find it and redirect to it
      const existingJob = await Job.findOne({
        where: {
          serialGroup: `traefik-config-${siteId}`,
          status: ['pending', 'running']
        },
        order: [['createdAt', 'DESC']]
      });
      
      if (existingJob) {
        await req.flash('info', 'Traefik config job already in progress');
        return res.redirect(`/jobs/${existingJob.id}`);
      }
      
      await req.flash('info', 'Traefik config job already pending');
      return res.redirect(`/sites/${siteId}/nodes`);
    }
  } catch (err) {
    console.error('Error queuing Traefik config job:', err);
    await req.flash('error', `Failed to queue Traefik config job: ${err.message}`);
    return res.redirect(`/sites/${siteId}/nodes`);
  }
});

// GET /sites - List all sites (available to all authenticated users)
router.get('/', async (req, res) => {
  const sites = await Site.findAll({
    include: [{
      model: Node,
      as: 'nodes',
      attributes: ['id', 'name']
    }],
    order: [['id', 'ASC']]
  });

  const rows = sites.map(s => ({
    id: s.id,
    name: s.name,
    internalDomain: s.internalDomain,
    dhcpRange: s.dhcpRange,
    gateway: s.gateway,
    nodeCount: s.nodes ? s.nodes.length : 0
  }));

  return res.render('sites/index', {
    rows,
    req
  });
});

// GET /sites/new - Display form for creating a new site (admin only)
router.get('/new', requireAdmin, async (req, res) => {
  res.render('sites/form', {
    site: null,
    isEdit: false,
    req
  });
});

// GET /sites/:id/edit - Display form for editing an existing site (admin only)
router.get('/:id/edit', requireAdmin, async (req, res) => {
  const site = await Site.findByPk(req.params.id);
  
  if (!site) {
    await req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  res.render('sites/form', {
    site,
    isEdit: true,
    req
  });
});

// POST /sites - Create a new site (admin only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, internalDomain, dhcpRange, subnetMask, gateway, dnsForwarders } = req.body;
    
    await Site.create({
      name,
      internalDomain,
      dhcpRange,
      subnetMask,
      gateway,
      dnsForwarders
    });

    await req.flash('success', `Site ${name} created successfully`);
    return res.redirect('/sites');
  } catch (error) {
    console.error('Error creating site:', error);
    await req.flash('error', 'Failed to create site: ' + error.message);
    return res.redirect('/sites/new');
  }
});

// PUT /sites/:id - Update an existing site (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const site = await Site.findByPk(req.params.id);
    
    if (!site) {
      await req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const { name, internalDomain, dhcpRange, subnetMask, gateway, dnsForwarders } = req.body;
    
    await site.update({
      name,
      internalDomain,
      dhcpRange,
      subnetMask,
      gateway,
      dnsForwarders
    });

    await req.flash('success', `Site ${name} updated successfully`);
    return res.redirect('/sites');
  } catch (error) {
    console.error('Error updating site:', error);
    await req.flash('error', 'Failed to update site: ' + error.message);
    return res.redirect(`/sites/${req.params.id}/edit`);
  }
});

// DELETE /sites/:id - Delete a site (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const site = await Site.findByPk(req.params.id, {
      include: [{ model: Node, as: 'nodes' }]
    });
    
    if (!site) {
      await req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    if (site.nodes && site.nodes.length > 0) {
      await req.flash('error', 'Cannot delete site with associated nodes');
      return res.redirect('/sites');
    }

    const siteName = site.name;
    await site.destroy();

    await req.flash('success', `Site ${siteName} deleted successfully`);
    return res.redirect('/sites');
  } catch (error) {
    console.error('Error deleting site:', error);
    await req.flash('error', 'Failed to delete site: ' + error.message);
    return res.redirect('/sites');
  }
});

module.exports = router;
