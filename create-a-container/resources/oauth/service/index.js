/**
 * Public API of the OAuth service. The protocol itself (authorize, token,
 * registration, revocation, discovery) is oidc-provider (../provider.js);
 * these modules hold what's specific to the manager.
 */

module.exports = {
  ...require('./consent'),
  ...require('./client-auth'),
  ...require('./metadata'),
  ...require('./sweep'),
  policy: require('./policy'),
};
