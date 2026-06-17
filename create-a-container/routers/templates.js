const express = require('express');
const { Site, Node, Container, Service, HTTPService, TransportService, ExternalDomain } = require('../models');
const { requireLocalhostOrAdmin } = require('../middlewares');

const router = express.Router();

async function loadDnsmasqSite(siteId) {
  return Site.findByPk(siteId, {
    include: [{
      model: Node,
      as: 'nodes',
      include: [{
        model: Container,
        as: 'containers',
        where: { status: 'running' },
        required: false,
        attributes: ['macAddress', 'ipv4Address', 'hostname'],
      }],
    }],
  });
}

const DNSMASQ_TEMPLATES = ['conf', 'dhcp-hosts', 'hosts', 'dhcp-opts', 'servers'];

router.get('/sites/:siteId/dnsmasq/:file', requireLocalhostOrAdmin, async (req, res) => {
  const { file } = req.params;
  if (!DNSMASQ_TEMPLATES.includes(file)) return res.status(404).send('Not found');
  const site = await loadDnsmasqSite(parseInt(req.params.siteId, 10));
  if (!site) return res.status(404).send('Site not found');
  res.set('Content-Type', 'text/plain');
  return res.render(`dnsmasq/${file}`, { site });
});

router.get('/sites/:siteId/nginx', requireLocalhostOrAdmin, async (req, res) => {
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
        include: [{
          model: Service,
          as: 'services',
          include: [
            {
              model: HTTPService,
              as: 'httpService',
              include: [{ model: ExternalDomain, as: 'externalDomain' }],
            },
            {
              model: TransportService,
              as: 'transportService',
              include: [{ model: ExternalDomain, as: 'externalDomain' }],
            },
          ],
        }],
      }],
    }, {
      model: ExternalDomain,
      as: 'externalDomains',
    }],
  });

  // Bootstrap fallback: if the site does not exist yet, still render an
  // empty nginx config so the manager API remains reachable (over TLS) to
  // create the first site. Without this, bootstrapping would require
  // plaintext HTTP access, which breaks our security requirements for
  // registering nodes and creating the first site.
  if (!site) {
    res.set('Content-Type', 'text/plain');
    return res.render('nginx-conf', {
      httpServices: [],
      streamServices: [],
      externalDomains: [],
    });
  }

  const allServices = [];
  site?.nodes?.forEach((node) => {
    node?.containers?.forEach((container) => {
      container?.services?.forEach((service) => {
        service.Container = container;
        allServices.push(service);
      });
    });
  });

  const httpServices = allServices.filter((s) => s.type === 'http');
  const streamServices = allServices.filter((s) => s.type === 'transport');

  const usedDomainIds = new Set();
  httpServices.forEach((s) => {
    if (s.httpService?.externalDomain?.id) usedDomainIds.add(s.httpService.externalDomain.id);
  });
  (site?.externalDomains || []).forEach((d) => usedDomainIds.add(d.id));
  const externalDomains = await ExternalDomain.findAll({ where: { id: [...usedDomainIds] } });

  res.set('Content-Type', 'text/plain');
  return res.render('nginx-conf', { httpServices, streamServices, externalDomains });
});

module.exports = router;
