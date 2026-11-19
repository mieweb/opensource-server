/**
 * Client authentication at /oauth/token and /oauth/revoke, before the request
 * reaches oidc-provider:
 *
 *   - Client secrets are stored hashed (adapter.js), and the provider compares
 *     the presented secret with the stored value as-is, so the presented
 *     secret is replaced by its hash here.
 *   - The provider requires the exact method the client registered (Basic
 *     header vs. form body). Clients disagree on which to use, so the secret
 *     is moved to the registered method. Either way it is checked.
 */

const repo = require('../repository');
const { hashSecret } = require('./hash');

const formEncode = (s) => encodeURIComponent(s).replace(/%20/g, '+');
const formDecode = (s) => decodeURIComponent(s.replace(/\+/g, ' '));

/** RFC 6749 §2.3.1 Basic credentials, or undefined. */
function parseBasic(header) {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return undefined;
  try {
    return { id: formDecode(decoded.slice(0, sep)), secret: formDecode(decoded.slice(sep + 1)) };
  } catch {
    return undefined;
  }
}

/**
 * @param {{ authorization?: string, body: object }} request
 * @returns {Promise<{ authorization?: string, body: object }>} rewritten request parts
 */
async function normalizeClientAuth({ authorization, body }) {
  const basic = parseBasic(authorization);
  const id = basic ? basic.id : body.client_id;
  const secret = basic ? basic.secret : body.client_secret;
  if (!id || !secret) return { authorization, body };

  const row = await repo.findRecord('Client', id);
  const method = row?.payload?.token_endpoint_auth_method || (basic ? 'client_secret_basic' : 'client_secret_post');
  const hashed = hashSecret(secret);
  const { client_secret: _ignored, ...rest } = body;

  if (method === 'client_secret_post') {
    return { authorization: undefined, body: { ...rest, client_id: id, client_secret: hashed } };
  }
  const { client_id: _id, ...withoutId } = rest;
  return {
    authorization: `Basic ${Buffer.from(`${formEncode(id)}:${formEncode(hashed)}`).toString('base64')}`,
    body: withoutId,
  };
}

module.exports = { normalizeClientAuth, parseBasic };
