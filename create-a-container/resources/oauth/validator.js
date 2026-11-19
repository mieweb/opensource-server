/**
 * Shape check for dynamic registration requests, before the manager's
 * registration policy (service/policy.js checkRegistration) and oidc-provider
 * see them. Only types are pinned; the original body is what the provider
 * gets, so metadata we don't check here still reaches it.
 */

const { z } = require('zod');
const { ApiError } = require('../../middlewares/api');

const str = (max = 2048) => z.string().max(max);

const registerClient = z.object({
  redirect_uris: z.array(z.string()).min(1),
  client_name: str(255).trim().optional(),
  client_uri: z.url().max(2048).optional(),
  token_endpoint_auth_method: str(64).optional(),
  grant_types: z.array(str(64)).optional(),
  response_types: z.array(str(64)).optional(),
  scope: str(1024).optional(),
});

/** Parse `data` with `schema`, failing with an OAuth error code. */
function parseOAuth(schema, data, errorCode = 'invalid_request') {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue.path.join('.') || 'request';
  throw new ApiError(400, errorCode, `${where}: ${issue.message}`);
}

module.exports = { registerClient, parseOAuth };
