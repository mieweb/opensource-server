/**
 * Public origin of the manager as the client sees it, e.g.
 * "https://manager.os.mieweb.org". Honors `trust proxy` (X-Forwarded-Proto /
 * X-Forwarded-Host from nginx), so it's the external origin even though the
 * app itself listens on plain HTTP behind the proxy.
 *
 * Used as the OAuth issuer and as the token audience (see
 * resources/oauth/README.md).
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function requestOrigin(req) {
  // Express 5: req.host includes the port and, with trust proxy, comes from
  // X-Forwarded-Host when present.
  return `${req.protocol}://${req.host}`.toLowerCase();
}

module.exports = { requestOrigin };
