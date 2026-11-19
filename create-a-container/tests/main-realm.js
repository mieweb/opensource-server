/**
 * Loaded with Node's native require (see oidc-provider-native.js), so the
 * objects it creates belong to Node's main realm, not Jest's VM context.
 * Plain objects and arrays are copied; functions, classes and other
 * instances are kept by reference.
 */
function toMainRealm(value) {
  if (Array.isArray(value)) return value.map(toMainRealm);
  if (value && typeof value === 'object' && Object.getPrototypeOf(Object.getPrototypeOf(value)) === null
    && Object.prototype.toString.call(value) === '[object Object]') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toMainRealm(v);
    return out;
  }
  return value;
}

/** Node's real global object (oidc-provider's fetch uses its `fetch`). */
const mainGlobal = globalThis;

module.exports = { toMainRealm, mainGlobal };
