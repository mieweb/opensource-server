/**
 * /api/v1/mail-accounts — email service accounts (issue #67).
 * Wiring only; see controller/service/repository per the MVC manifesto.
 */

const express = require('express');
const { apiAuth } = require('../../middlewares/api');
const { validate } = require('../../middlewares/validate');
const { createMailAccount, updateMailAccount, idParam, suppressionParams, listQuery } = require('./validator');
const ctrl = require('./controller');

const router = express.Router();

router.use(apiAuth);

// `/domains` must precede `/:id`.
router.get('/domains', ctrl.listDomains);

router.get('/', validate({ query: listQuery }), ctrl.list);
router.post('/', validate(createMailAccount), ctrl.create);
router.get('/:id', validate({ params: idParam }), ctrl.get);
router.patch('/:id', validate({ params: idParam, body: updateMailAccount }), ctrl.update);
router.post('/:id/rotate-password', validate({ params: idParam }), ctrl.rotatePassword);
router.delete('/:id', validate({ params: idParam }), ctrl.remove);

router.get('/:id/suppressions', validate({ params: idParam }), ctrl.listSuppressions);
router.delete(
  '/:id/suppressions/:suppressionId',
  validate({ params: suppressionParams }),
  ctrl.removeSuppression,
);

module.exports = router;
