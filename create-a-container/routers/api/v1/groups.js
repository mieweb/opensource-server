/**
 * /api/v1/groups — admin-only CRUD.
 */

const express = require('express');
const { Group, User } = require('../../../models');
const { apiAuth, apiAdmin, asyncHandler, ok, created, noContent, ApiError } =
  require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth, apiAdmin);

function serialize(g) {
  return {
    gidNumber: g.gidNumber,
    cn: g.cn,
    isAdmin: g.isAdmin,
    userCount: g.users ? g.users.length : undefined,
  };
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const groups = await Group.findAll({
      include: [
        {
          model: User,
          as: 'users',
          attributes: ['uidNumber', 'uid'],
          through: { attributes: [] },
        },
      ],
      order: [['gidNumber', 'ASC']],
    });
    return ok(res, groups.map(serialize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const g = await Group.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'users',
          attributes: ['uidNumber', 'uid'],
          through: { attributes: [] },
        },
      ],
    });
    if (!g) throw new ApiError(404, 'not_found', 'Group not found');
    return ok(res, serialize(g));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { gidNumber, cn, isAdmin } = req.body || {};
    const g = await Group.create({
      gidNumber: parseInt(gidNumber, 10),
      cn,
      isAdmin: isAdmin === true || isAdmin === 'true' || isAdmin === 'on',
    });
    return created(res, serialize(g));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const g = await Group.findByPk(req.params.id);
    if (!g) throw new ApiError(404, 'not_found', 'Group not found');
    const { cn, isAdmin } = req.body || {};
    await g.update({
      cn,
      isAdmin: isAdmin === true || isAdmin === 'true' || isAdmin === 'on',
    });
    return ok(res, serialize(g));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const g = await Group.findByPk(req.params.id);
    if (!g) throw new ApiError(404, 'not_found', 'Group not found');
    await g.destroy();
    return noContent(res);
  }),
);

module.exports = router;
