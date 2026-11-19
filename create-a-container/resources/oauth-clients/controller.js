const svc = require('./service');
const { serializeOAuthClient } = require('./serializer');
const { asyncHandler, ok, created, noContent } = require('../../middlewares/api');

function sessionOf(req) {
  return { uid: req.session.user, isAdmin: !!req.session.isAdmin };
}

const list = asyncHandler(async (req, res) => {
  const clients = await svc.listClients(sessionOf(req), { all: req.validated.query.all === 'true' });
  return ok(res, clients.map(serializeOAuthClient));
});

const create = asyncHandler(async (req, res) => {
  const { client, clientSecret } = await svc.createClient(sessionOf(req), req.validated.body);
  res.set('Cache-Control', 'no-store');
  return created(res, {
    ...serializeOAuthClient(client),
    clientSecret,
    warning: 'This is the only time the client secret will be displayed. Store it securely.',
  });
});

const remove = asyncHandler(async (req, res) => {
  await svc.deleteClient(sessionOf(req), req.validated.params.id);
  return noContent(res);
});

module.exports = { list, create, remove };
