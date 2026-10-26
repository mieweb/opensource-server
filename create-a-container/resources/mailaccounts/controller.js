const svc = require('./service');
const { serializeMailAccount, serializeSuppression } = require('./serializer');
const { asyncHandler, ok, created, noContent } = require('../../middlewares/api');

const PASSWORD_WARNING = 'Save this password — it will not be shown again.';

function sessionOf(req) {
  return { uid: req.session.user, isAdmin: !!req.session.isAdmin };
}

const list = asyncHandler(async (req, res) => {
  const accounts = await svc.listAccounts(sessionOf(req), req.validated.query);
  return ok(res, accounts.map(serializeMailAccount));
});

const listDomains = asyncHandler(async (req, res) => {
  const domains = await svc.listSendableDomains(sessionOf(req));
  return ok(res, domains.map((d) => ({ id: d.id, name: d.name })));
});

const get = asyncHandler(async (req, res) => {
  const account = await svc.getAccount(sessionOf(req), req.validated.params.id);
  return ok(res, serializeMailAccount(account));
});

const create = asyncHandler(async (req, res) => {
  const { account, password, connection } = await svc.createAccount(sessionOf(req), req.validated.body);
  return created(res, {
    ...serializeMailAccount(account),
    password,
    connection,
    warning: PASSWORD_WARNING,
  });
});

const update = asyncHandler(async (req, res) => {
  const account = await svc.updateAccount(sessionOf(req), req.validated.params.id, req.validated.body);
  return ok(res, serializeMailAccount(account));
});

const rotatePassword = asyncHandler(async (req, res) => {
  const { account, password, connection } = await svc.rotatePassword(sessionOf(req), req.validated.params.id);
  return ok(res, {
    ...serializeMailAccount(account),
    password,
    connection,
    warning: PASSWORD_WARNING,
  });
});

const remove = asyncHandler(async (req, res) => {
  await svc.deleteAccount(sessionOf(req), req.validated.params.id);
  return noContent(res);
});

const listSuppressions = asyncHandler(async (req, res) => {
  const suppressions = await svc.listSuppressions(sessionOf(req), req.validated.params.id);
  return ok(res, suppressions.map(serializeSuppression));
});

const removeSuppression = asyncHandler(async (req, res) => {
  await svc.removeSuppression(
    sessionOf(req),
    req.validated.params.id,
    req.validated.params.suppressionId,
  );
  return noContent(res);
});

module.exports = {
  list,
  listDomains,
  get,
  create,
  update,
  rotatePassword,
  remove,
  listSuppressions,
  removeSuppression,
};
