/**
 * /api/v1/apikeys — per-user API keys. The plaintext key is returned ONCE at
 * create time.
 */

const express = require('express');
const { apiAuth } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { createApiKey, idParam } = require('./validator');
const ctrl = require('./controller');

const router = express.Router();

router.use(apiAuth);

router.get('/', ctrl.list);
router.get('/:id', validate({ params: idParam }), ctrl.get);
router.post('/', validate(createApiKey), ctrl.create);
router.delete('/:id', validate({ params: idParam }), ctrl.remove);

module.exports = router;
