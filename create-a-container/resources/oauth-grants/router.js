/**
 * /api/v1/oauth-grants — "Authorized apps": OAuth clients a user signed in to
 * (issue #514). Wiring only; see controller/service/repository.
 */

const express = require('express');
const { apiAuth } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { listQuery, idParam } = require('./validator');
const ctrl = require('./controller');

const router = express.Router();
router.use(apiAuth);

router.get('/', validate({ query: listQuery }), ctrl.list);
router.delete('/:id', validate({ params: idParam }), ctrl.remove);

module.exports = router;
