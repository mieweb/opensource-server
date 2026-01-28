const express = require('express');
const router = express.Router();
const { Container, Node } = require('../models');

// Simple API key middleware (expects Bearer <API_KEY>)
function requireApiKey(req, res, next) {
  const auth = req.get('authorization') || '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && parts[1] === process.env.API_KEY) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// GET /containers?hostname=foo
router.get('/containers', requireApiKey, async (req, res) => {
  try {
    const { hostname } = req.query;
    if (!hostname) {
      // Return empty array to keep client parsing simple
      return res.json([]);
    }

    const containers = await Container.findAll({
      where: { hostname },
      include: [{ model: Node, as: 'node', attributes: ['id', 'name'] }]
    });

    // Normalize to plain JSON
    const out = containers.map(c => ({
      id: c.id,
      hostname: c.hostname,
      ipv4Address: c.ipv4Address,
      macAddress: c.macAddress,
      node: c.node ? { id: c.node.id, name: c.node.name } : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));

    return res.json(out);
  } catch (err) {
    console.error('API GET /containers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /containers - create a new container record (idempotent)
router.post('/containers', requireApiKey, async (req, res) => {
  try {
    const { hostname } = req.body;
    if (!hostname) return res.status(400).json({ error: 'hostname required' });

    let container = await Container.findOne({ where: { hostname } });
    if (container) {
      return res.status(200).json({ containerId: container.id, message: 'Already exists' });
    }

    container = await Container.create({
      hostname,
      username: req.body.username || 'api',
      ipv4Address: req.body.ipv4Address || null,
      macAddress: req.body.macAddress || null
    });

    return res.status(201).json({ containerId: container.id, message: 'Created' });
  } catch (err) {
    console.error('API POST /containers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /containers/:id - update container record
router.put('/containers/:id', requireApiKey, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const container = await Container.findByPk(id);
    if (!container) return res.status(404).json({ error: 'Not found' });

    await container.update({
      ipv4Address: req.body.ipv4Address ?? container.ipv4Address,
      macAddress: req.body.macAddress ?? container.macAddress,
      osRelease: req.body.osRelease ?? container.osRelease
    });

    return res.status(200).json({ message: 'Updated' });
  } catch (err) {
    console.error('API PUT /containers/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /containers/:id
router.delete('/containers/:id', requireApiKey, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const container = await Container.findByPk(id);
    if (!container) return res.status(404).json({ error: 'Not found' });

    await container.destroy();
    return res.status(204).send();
  } catch (err) {
    console.error('API DELETE /containers/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
