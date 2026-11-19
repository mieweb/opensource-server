/**
 * RFC 9728 protected resource metadata. The manager is both the resource
 * server (/mcp, /api/v1) and the authorization server, so both point at the
 * manager origin. The authorization server metadata (RFC 8414) is served by
 * oidc-provider itself.
 */

const { SCOPE } = require('./policy');

/**
 * @param {string} origin manager origin
 * @param {string} [resourcePath] '' for the root document, '/mcp' for the
 *   path-specific one (RFC 9728 §3.1: `resource` must equal the URL the
 *   well-known path was derived from).
 */
function protectedResourceMetadata(origin, resourcePath = '') {
  return {
    resource: `${origin}${resourcePath}`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'MIE Opensource Manager',
    resource_documentation: 'https://os.mieweb.org/users/mcp-server/',
  };
}

module.exports = { protectedResourceMetadata };
