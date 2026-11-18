/**
 * Authentication gate in front of the /mcp reverse proxy (issue #513).
 *
 * MCP clients only start OAuth discovery when /mcp answers 401 with
 * `WWW-Authenticate: Bearer resource_metadata="…"` (MCP authorization spec,
 * RFC 9728 §5.1). So the Bearer is validated here, before forwarding:
 *
 *   - missing          -> 401 challenge
 *   - invalid/expired  -> 401 challenge with error="invalid_token" (clients refresh)
 *   - valid API key or manager-issued OAuth access token -> forwarded untouched
 *
 * The header is forwarded as-is; the MCP server passes it on to /api/v1,
 * where apiAuth resolves the user again (ForwardAuthorizationHeader in
 * manager_control_program/server.py).
 *
 * OAuth tokens must be audienced to this origin. API keys have no audience.
 */

const { authenticateBearer, bearerToken, bearerChallenge } = require('./api');
const { requestOrigin } = require('../utils/request-origin');

function challenge(req, res, details) {
  const origin = requestOrigin(req);
  res.set('WWW-Authenticate', bearerChallenge(`${origin}/.well-known/oauth-protected-resource/mcp`, details));
  // Browser-based MCP clients must be able to read the challenge cross-origin.
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Expose-Headers', 'WWW-Authenticate');
  return res.status(401).json({
    error: { code: 'unauthorized', message: details.description || 'Authentication required' },
  });
}

async function mcpAuth(req, res, next) {
  // CORS preflights never carry credentials; let the MCP server answer them.
  if (req.method === 'OPTIONS') return next();

  const token = bearerToken(req);
  if (!token) return challenge(req, res, {});

  try {
    const result = await authenticateBearer(token, { expectedAudience: requestOrigin(req) });
    if (result.error) return challenge(req, res, { error: result.error, description: result.reason });
  } catch (err) {
    return next(err);
  }
  return next();
}

module.exports = { mcpAuth };
