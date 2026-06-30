import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { WebApp } from 'meteor/webapp';
import { loadConfigFromEnv, verifyAssertion } from '@mieweb/trusted-proxy-auth';

const config = loadConfigFromEnv();
const headerName = (config.header || '').toLowerCase();

// Short-lived cookie that carries a one-time Meteor login token to the client.
// It is intentionally readable by client JS (Meteor stores resume tokens in
// localStorage anyway) and is cleared by the client immediately after use.
const BOOTSTRAP_COOKIE = 'meteor_proxy_login_token';
const BOOTSTRAP_MAX_AGE_SECONDS = 60;

// Default identity -> Meteor user mapping. Apps override with
// `TrustedProxyAccounts.setUserResolver(async (identity) => userId)`.
let resolveUser = async (identity) => {
  const selector = { 'services.proxyAuth.subject': identity.subject };
  const existing = await Meteor.users.findOneAsync(selector, { fields: { _id: 1 } });
  if (existing) {
    return existing._id;
  }

  return Accounts.insertUserDoc(
    { profile: identity.name ? { name: identity.name } : {} },
    {
      services: { proxyAuth: { subject: identity.subject } },
      emails: identity.email ? [{ address: identity.email, verified: true }] : [],
    },
  );
};

export const TrustedProxyAccounts = {
  /**
   * Override how a verified assertion identity maps to a Meteor user id.
   * @param {(identity: {subject: string, email: string|null, name: string|null, claims: object}) => Promise<string>|string} resolver
   */
  setUserResolver(resolver) {
    if (typeof resolver !== 'function') {
      throw new Error('user resolver must be a function');
    }
    resolveUser = resolver;
  },
};

function wantsHtml(req) {
  return req.method === 'GET' && (req.headers.accept || '').includes('text/html');
}

function setBootstrapCookie(req, res, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${BOOTSTRAP_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${BOOTSTRAP_MAX_AGE_SECONDS}; SameSite=Lax${secure}`,
  );
}

// On a top-level page load, verify the proxy assertion, ensure a matching
// Meteor user exists, mint a one-time login token, and hand it to the client.
WebApp.connectHandlers.use(async (req, res, next) => {
  try {
    if (!headerName || !wantsHtml(req)) {
      return;
    }

    const raw = req.headers[headerName];
    const token = (Array.isArray(raw) ? raw[0] : raw || '').trim();
    if (!token) {
      return;
    }

    const identity = await verifyAssertion(token, config);
    const userId = await resolveUser(identity);
    const stampedToken = Accounts._generateStampedLoginToken();
    await Accounts._insertLoginToken(userId, stampedToken);
    setBootstrapCookie(req, res, stampedToken.token);
  } catch {
    // Never block page delivery on a missing or invalid assertion; the client
    // simply stays logged out and the app enforces its own authorization.
  } finally {
    next();
  }
});
