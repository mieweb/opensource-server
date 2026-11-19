/**
 * Jest moduleNameMapper target for `oidc-provider`.
 *
 * oidc-provider is ESM-only. Node (>= 20.19 / 22.12) can require() it from
 * CommonJS, and that's how the app loads it in production, but Jest's module
 * registry can't, so it's loaded with Node's native require here.
 *
 * Jest also runs test code in its own VM realm, so the app's configuration
 * object literals fail oidc-provider's plain-object checks; they're copied
 * into the main realm first. Production has a single realm and needs neither.
 */
const { createRequire } = process.getBuiltinModule('module');

const nativeRequire = createRequire(__filename);
const oidc = nativeRequire('oidc-provider');
const { toMainRealm } = nativeRequire('./main-realm.js');

class Provider extends oidc.Provider {
  constructor(issuer, configuration) {
    super(issuer, toMainRealm(configuration));
  }
}

module.exports = { ...oidc, Provider };
