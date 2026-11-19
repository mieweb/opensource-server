/**
 * /api/v1/oauth-clients — OAuth clients for the client_credentials grant
 * (issue #518). Wiring only; see controller/service/repository.
 */

const express = require('express');
const { apiAuth } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { createOAuthClient, listQuery, idParam } = require('./validator');
const ctrl = require('./controller');

const router = express.Router();
router.use(apiAuth);

router.get('/', validate({ query: listQuery }), ctrl.list);
router.post('/', validate(createOAuthClient), ctrl.create);
router.delete('/:id', validate({ params: idParam }), ctrl.remove);

module.exports = router;
