const express = require('express');
const router = express.Router({ mergeParams: true });
const { Template, Site } = require('../models');
const { requireAuth, requireAdmin } = require('../middlewares');
const { getAvailableProxmoxTemplates } = require('../utils');

router.use(requireAuth);

// GET /sites/:siteId/templates - List all templates for this site
router.get('/', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const templates = await Template.findAll({
    where: { siteId },
    order: [['displayName', 'ASC']]
  });

  return res.render('templates/index', {
    templates,
    site,
    req
  });
});

// GET /sites/:siteId/templates/new - Display form for creating a new template
router.get('/new', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  
  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const availableTemplates = await getAvailableProxmoxTemplates(siteId);

  return res.render('templates/form', {
    template: null,
    availableTemplates,
    site,
    isEdit: false,
    req
  });
});

// GET /sites/:siteId/templates/:id/edit - Display form for editing a template
router.get('/:id/edit', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const templateId = parseInt(req.params.id, 10);

  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  const template = await Template.findOne({
    where: { id: templateId, siteId }
  });

  if (!template) {
    req.flash('error', 'Template not found');
    return res.redirect(`/sites/${siteId}/templates`);
  }

  const availableTemplates = await getAvailableProxmoxTemplates(siteId);

  return res.render('templates/form', {
    template,
    availableTemplates,
    site,
    isEdit: true,
    req
  });
});

// POST /sites/:siteId/templates - Create a new template
router.post('/', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);

  const site = await Site.findByPk(siteId);
  if (!site) {
    req.flash('error', 'Site not found');
    return res.redirect('/sites');
  }

  try {
    const { displayName, proxmoxTemplateName } = req.body;

    await Template.create({
      displayName,
      proxmoxTemplateName,
      siteId
    });

    req.flash('success', `Template ${displayName} created successfully`);
    return res.redirect(`/sites/${siteId}/templates`);
  } catch (error) {
    console.error('Error creating template:', error);
    req.flash('error', 'Failed to create template: ' + error.message);
    return res.redirect(`/sites/${siteId}/templates/new`);
  }
});

// PUT /sites/:siteId/templates/:id - Update an existing template
router.put('/:id', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const templateId = parseInt(req.params.id, 10);

  try {
    const site = await Site.findByPk(siteId);
    if (!site) {
      req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const template = await Template.findOne({
      where: { id: templateId, siteId }
    });

    if (!template) {
      req.flash('error', 'Template not found');
      return res.redirect(`/sites/${siteId}/templates`);
    }

    const { displayName, proxmoxTemplateName } = req.body;

    await template.update({
      displayName,
      proxmoxTemplateName
    });

    req.flash('success', `Template ${displayName} updated successfully`);
    return res.redirect(`/sites/${siteId}/templates`);
  } catch (error) {
    console.error('Error updating template:', error);
    req.flash('error', 'Failed to update template: ' + error.message);
    return res.redirect(`/sites/${siteId}/templates/${templateId}/edit`);
  }
});

// DELETE /sites/:siteId/templates/:id - Delete a template
router.delete('/:id', requireAdmin, async (req, res) => {
  const siteId = parseInt(req.params.siteId, 10);
  const templateId = parseInt(req.params.id, 10);

  try {
    const site = await Site.findByPk(siteId);
    if (!site) {
      req.flash('error', 'Site not found');
      return res.redirect('/sites');
    }

    const template = await Template.findOne({
      where: { id: templateId, siteId }
    });

    if (!template) {
      req.flash('error', 'Template not found');
      return res.redirect(`/sites/${siteId}/templates`);
    }

    const templateName = template.displayName;
    await template.destroy();

    req.flash('success', `Template ${templateName} deleted successfully`);
    return res.redirect(`/sites/${siteId}/templates`);
  } catch (error) {
    console.error('Error deleting template:', error);
    req.flash('error', 'Failed to delete template: ' + error.message);
    return res.redirect(`/sites/${siteId}/templates`);
  }
});

module.exports = router;
