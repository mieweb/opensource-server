const { asyncHandler } = require('../../middlewares/api');
const svc = require('./service');

/**
 * Container-token auth: the caller is sshd inside a container, authenticating
 * with the container's own bearer token (not a user session). On success the
 * authenticated container (collaborators loaded) is attached to req.container.
 *
 * Runs after validate({ params: idParam }), so req.validated.params.id is a
 * positive integer. Mounted after the app-level CSRF guard, but GET is exempt
 * and the Bearer-without-cookie path is exempt regardless.
 */
const containerTokenAuth = asyncHandler(async (req, _res, next) => {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  req.container = await svc.authenticateContainer(req.validated.params.id, token);
  next();
});

module.exports = { containerTokenAuth };
