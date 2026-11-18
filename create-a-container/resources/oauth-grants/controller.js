const svc = require('./service');
const { serializeOAuthGrant } = require('./serializer');
const { asyncHandler, ok, noContent } = require('../../middlewares/api');

function sessionOf(req) {
  return { uid: req.session.user, isAdmin: !!req.session.isAdmin };
}

const list = asyncHandler(async (req, res) => {
  const grants = await svc.listGrants(sessionOf(req), { all: req.validated.query.all === 'true' });
  return ok(res, grants.map(serializeOAuthGrant));
});

const remove = asyncHandler(async (req, res) => {
  await svc.revokeGrant(sessionOf(req), req.validated.params.id);
  return noContent(res);
});

module.exports = { list, remove };
