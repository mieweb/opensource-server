const svc = require('./service');
const { serializeApiKey } = require('./serializer');
const { asyncHandler, ok, created, noContent } = require('../../middlewares/api');

const list = asyncHandler(async (req, res) => {
  const keys = await svc.listKeys(req.session.user);
  return ok(res, keys.map(serializeApiKey));
});

const get = asyncHandler(async (req, res) => {
  const key = await svc.getKey(req.session.user, req.validated.params.id);
  return ok(res, serializeApiKey(key));
});

const create = asyncHandler(async (req, res) => {
  const { key, plainKey } = await svc.createKey(req.session.user, req.validated.body);
  return created(res, {
    ...serializeApiKey(key),
    key: plainKey,
    warning: 'This is the only time the full API key will be displayed. Store it securely.',
  });
});

const remove = asyncHandler(async (req, res) => {
  await svc.deleteKey(req.session.user, req.validated.params.id);
  return noContent(res);
});

module.exports = { list, get, create, remove };
