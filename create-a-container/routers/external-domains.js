const express = require('express');
const router = express.Router();
const { ExternalDomain, Site } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');
const path = require('path');
const { run } = require('../utils');
const axios = require('axios');

// All routes require authentication + admin
router.use(requireAuth);
router.use(requireAdmin);

// GET /external-domains
router.get('/', async (req, res) => {
  const externalDomains = await ExternalDomain.findAll({
    include: [{ model: Site, as: 'site', attributes: ['id', 'name'], required: false }],
    order: [['name', 'ASC']]
  });

  const rows = externalDomains.map(d => ({
    id: d.id,
    name: d.name,
    acmeEmail: d.acmeEmail,
    acmeDirectoryUrl: d.acmeDirectoryUrl,
    cloudflareApiEmail: d.cloudflareApiEmail,
    defaultSite: d.site ? d.site.name : null
  }));

  return res.render('external-domains/index', { rows, req });
});

// GET /external-domains/new
router.get('/new', async (req, res) => {
  const sites = await Site.findAll({ order: [['name', 'ASC']] });
  return res.render('external-domains/form', {
    externalDomain: null,
    sites,
    isEdit: false,
    req
  });
});

// GET /external-domains/:id/edit
router.get('/:id/edit', async (req, res) => {
  const domainId = parseInt(req.params.id, 10);

  const externalDomain = await ExternalDomain.findByPk(domainId);
  if (!externalDomain) {
    await req.flash('error', 'External domain not found');
    return res.redirect('/external-domains');
  }

  const sites = await Site.findAll({ order: [['name', 'ASC']] });
  return res.render('external-domains/form', {
    externalDomain,
    sites,
    isEdit: true,
    req
  });
});

// POST /external-domains
router.post('/', async (req, res) => {
  try {
    const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey, siteId } = req.body;

    const externalDomain = await ExternalDomain.create({
      name,
      acmeEmail: acmeEmail || null,
      acmeDirectoryUrl: acmeDirectoryUrl || null,
      cloudflareApiEmail: cloudflareApiEmail || null,
      cloudflareApiKey: cloudflareApiKey || null,
      siteId: siteId || null
    });

    // TODO: do this async in a Job queue
    // Provision SSL certificates via lego if all required fields are present
    if (externalDomain.name && externalDomain.acmeEmail && externalDomain.cloudflareApiEmail && externalDomain.cloudflareApiKey) {
      try {
        const certsPath = path.join(__dirname, '..', 'certs');
        const legoArgs = [
          '-d', externalDomain.name,
          '-d', `*.${externalDomain.name}`,
          '-a',
          '-m', externalDomain.acmeEmail,
          '--dns', 'cloudflare',
          '--path', certsPath,
          'run'
        ];

        // Add server URL if provided
        if (externalDomain.acmeDirectoryUrl) {
          legoArgs.unshift('-s', externalDomain.acmeDirectoryUrl);

          // If using ZeroSSL, retrieve EAB credentials automatically
          if (externalDomain.acmeDirectoryUrl == 'https://acme.zerossl.com/v2/DV90') {
            try {
              console.log(`Retrieving ZeroSSL EAB credentials for ${externalDomain.acmeEmail}...`);
              const eabResponse = await axios.post('https://api.zerossl.com/acme/eab-credentials-email', 
                new URLSearchParams({ email: externalDomain.acmeEmail }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
              );
              
              if (eabResponse.data.success && eabResponse.data.eab_kid && eabResponse.data.eab_hmac_key) {
                legoArgs.unshift('--eab');
                legoArgs.unshift('--kid', eabResponse.data.eab_kid);
                legoArgs.unshift('--hmac', eabResponse.data.eab_hmac_key);
                console.log('ZeroSSL EAB credentials retrieved successfully');
              } else {
                throw new Error('Failed to retrieve EAB credentials from ZeroSSL');
              }
            } catch (eabError) {
              console.error('ZeroSSL EAB retrieval error:', eabError.response?.data || eabError.message);
              throw new Error(`Failed to retrieve ZeroSSL EAB credentials: ${eabError.response?.data?.error?.type || eabError.message}`);
            }
          }
        }

        const env = {
          ...process.env,
          CF_API_EMAIL: externalDomain.cloudflareApiEmail,
          CF_DNS_API_TOKEN: externalDomain.cloudflareApiKey
        };

        const { stdout, stderr } = await run('lego', legoArgs, { env });
        console.log(`Certificate provisioned for ${externalDomain.name}`);
        
        await req.flash('success', `External domain ${name} created and certificate provisioned successfully`);
      } catch (certError) {
        console.error('Certificate provisioning error:', certError);
        await req.flash('warning', `External domain ${name} created, but certificate provisioning failed: ${certError.message}`);
      }
    } else {
      await req.flash('success', `External domain ${name} created successfully (certificate provisioning skipped - missing required fields)`);
    }

    return res.redirect('/external-domains');
  } catch (error) {
    console.error('Error creating external domain:', error);
    await req.flash('error', 'Failed to create external domain: ' + error.message);
    return res.redirect('/external-domains/new');
  }
});

// PUT /external-domains/:id
router.put('/:id', async (req, res) => {
  const domainId = parseInt(req.params.id, 10);

  try {
    const externalDomain = await ExternalDomain.findByPk(domainId);

    if (!externalDomain) {
      await req.flash('error', 'External domain not found');
      return res.redirect('/external-domains');
    }

    const { name, acmeEmail, acmeDirectoryUrl, cloudflareApiEmail, cloudflareApiKey, siteId } = req.body;

    const updateData = {
      name,
      acmeEmail: acmeEmail || null,
      acmeDirectoryUrl: acmeDirectoryUrl || null,
      cloudflareApiEmail: cloudflareApiEmail || null,
      siteId: siteId || null
    };
    
    // Only update cloudflareApiKey if a new value was provided
    if (cloudflareApiKey && cloudflareApiKey.trim() !== '') {
      updateData.cloudflareApiKey = cloudflareApiKey;
    }

    await externalDomain.update(updateData);

    await req.flash('success', `External domain ${name} updated successfully`);
    return res.redirect('/external-domains');
  } catch (error) {
    console.error('Error updating external domain:', error);
    await req.flash('error', 'Failed to update external domain: ' + error.message);
    return res.redirect(`/external-domains/${domainId}/edit`);
  }
});

// DELETE /external-domains/:id
router.delete('/:id', async (req, res) => {
  const domainId = parseInt(req.params.id, 10);

  try {
    const externalDomain = await ExternalDomain.findByPk(domainId);

    if (!externalDomain) {
      await req.flash('error', 'External domain not found');
      return res.redirect('/external-domains');
    }

    const domainName = externalDomain.name;
    await externalDomain.destroy();

    await req.flash('success', `External domain ${domainName} deleted successfully`);
    return res.redirect('/external-domains');
  } catch (error) {
    console.error('Error deleting external domain:', error);
    await req.flash('error', 'Failed to delete external domain: ' + error.message);
    return res.redirect('/external-domains');
  }
});

module.exports = router;
