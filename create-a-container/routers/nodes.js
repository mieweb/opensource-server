const express = require('express');
const router = express.Router();
const { Node, Container } = require('../models');
const { requireAuth } = require('../middlewares');

// Apply auth to all routes
router.use(requireAuth);

// GET /nodes - List all nodes
router.get('/', async (req, res) => {
  const nodes = await Node.findAll({
    include: [{ 
      model: Container, 
      as: 'containers',
      attributes: ['id']
    }],
    attributes: { exclude: ['secret'] } // Never send secret to frontend
  });

  const rows = nodes.map(n => ({
    id: n.id,
    name: n.name,
    apiUrl: n.apiUrl,
    tlsVerify: n.tlsVerify,
    containerCount: n.containers ? n.containers.length : 0
  }));

  return res.render('nodes/index', {
    rows,
    successMessages: req.flash('success'),
    errorMessages: req.flash('error')
  });
});

// GET /nodes/new - Display form for creating a new node
router.get('/new', (req, res) => {
  res.render('nodes/form', {
    node: null,
    isEdit: false,
    errorMessages: req.flash('error')
  });
});

// GET /nodes/:id/edit - Display form for editing an existing node
router.get('/:id/edit', async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  
  const node = await Node.findByPk(nodeId, {
    attributes: { exclude: ['secret'] } // Never send secret to frontend
  });
  
  if (!node) {
    req.flash('error', 'Node not found');
    return res.redirect('/nodes');
  }

  res.render('nodes/form', {
    node,
    isEdit: true,
    errorMessages: req.flash('error')
  });
});

// POST /nodes - Create a new node
router.post('/', async (req, res) => {
  try {
    const { name, apiUrl, tokenId, secret, tlsVerify } = req.body;
    
    await Node.create({
      name,
      apiUrl: apiUrl || null,
      tokenId: tokenId || null,
      secret: secret || null,
      tlsVerify: tlsVerify === 'true' || tlsVerify === true
    });

    req.flash('success', `Node ${name} created successfully`);
    return res.redirect('/nodes');
  } catch (err) {
    console.error('Error creating node:', err);
    req.flash('error', `Failed to create node: ${err.message}`);
    return res.redirect('/nodes/new');
  }
});

// PUT /nodes/:id - Update an existing node
router.put('/:id', async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  
  try {
    const node = await Node.findByPk(nodeId);
    
    if (!node) {
      req.flash('error', 'Node not found');
      return res.redirect('/nodes');
    }

    const { name, apiUrl, tokenId, secret, tlsVerify } = req.body;
    
    const updateData = {
      name,
      apiUrl: apiUrl || null,
      tokenId: tokenId || null,
      tlsVerify: tlsVerify === 'true' || tlsVerify === true
    };

    // Only update secret if a new value was provided
    if (secret && secret.trim() !== '') {
      updateData.secret = secret;
    }

    await node.update(updateData);

    req.flash('success', `Node ${name} updated successfully`);
    return res.redirect('/nodes');
  } catch (err) {
    console.error('Error updating node:', err);
    req.flash('error', `Failed to update node: ${err.message}`);
    return res.redirect(`/nodes/${nodeId}/edit`);
  }
});

// DELETE /nodes/:id - Delete a node
router.delete('/:id', async (req, res) => {
  const nodeId = parseInt(req.params.id, 10);
  
  try {
    const node = await Node.findByPk(nodeId, {
      include: [{ model: Container, as: 'containers' }]
    });
    
    if (!node) {
      req.flash('error', 'Node not found');
      return res.redirect('/nodes');
    }

    // Check if node has containers
    if (node.containers && node.containers.length > 0) {
      req.flash('error', `Cannot delete node ${node.name}: ${node.containers.length} container(s) still reference this node`);
      return res.redirect('/nodes');
    }

    await node.destroy();
    
    req.flash('success', `Node ${node.name} deleted successfully`);
    return res.redirect('/nodes');
  } catch (err) {
    console.error('Error deleting node:', err);
    req.flash('error', `Failed to delete node: ${err.message}`);
    return res.redirect('/nodes');
  }
});

module.exports = router;
