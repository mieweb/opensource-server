const svc = require('./service');
const { asyncHandler, noContent } = require('../../middlewares/api');

// GET /:username — sshd asks whether this user may log in. The container is
// already authenticated (req.container) and the username validated. Allow is
// 204; deny/invalid are thrown by the service/validator as ApiError.
const check = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  svc.assertUserAllowed(req.container, req.validated.params.username);
  return noContent(res);
});

module.exports = { check };
