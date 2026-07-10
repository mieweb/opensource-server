/**
 * /api/v1/apikeys — per-user API keys. The plaintext key is returned ONCE at create time.
 */

const express = require('express');
const { ApiKey, User } = require('../../../models');
const { createApiKeyData } = require('../../../utils/apikey');
const { apiAuth, asyncHandler, ok, created, noContent, ApiError } =
  require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth);

async function currentUser(req) {
  const user = await User.findOne({ where: { uid: req.session.user } });
  if (!user) throw new ApiError(401, 'unauthorized', 'Session user not found');
  return user;
}

function serialize(k) {
  return {
    id: k.id,
    keyPrefix: k.keyPrefix,
    description: k.description,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await currentUser(req);
    const keys = await ApiKey.findAll({
      where: { uidNumber: user.uidNumber },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt'],
    });
    return ok(res, keys.map(serialize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await currentUser(req);
    const key = await ApiKey.findOne({
      where: { id: req.params.id, uidNumber: user.uidNumber },
      attributes: ['id', 'keyPrefix', 'description', 'lastUsedAt', 'createdAt', 'updatedAt'],
    });
    if (!key) throw new ApiError(404, 'not_found', 'API key not found');
    return ok(res, serialize(key));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = await currentUser(req);
    const { description } = req.body || {};
    const data = await createApiKeyData(user.uidNumber, description);
    const key = await ApiKey.create({
      uidNumber: data.uidNumber,
      keyPrefix: data.keyPrefix,
      keyHash: data.keyHash,
      description: data.description,
    });
    return created(res, {
      ...serialize(key),
      key: data.plainKey,
      warning: 'This is the only time the full API key will be displayed. Store it securely.',
    });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await currentUser(req);
    const key = await ApiKey.findOne({ where: { id: req.params.id, uidNumber: user.uidNumber } });
    if (!key) throw new ApiError(404, 'not_found', 'API key not found');
    await key.destroy();
    return noContent(res);
  }),
);

module.exports = router;
