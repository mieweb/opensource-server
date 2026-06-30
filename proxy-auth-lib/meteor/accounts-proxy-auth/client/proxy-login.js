import { Meteor } from 'meteor/meteor';

// The server hands us a one-time Meteor login token in a short-lived cookie
// after it verifies the upstream proxy assertion. Consume it once on startup,
// then clear it so it cannot be replayed.
const BOOTSTRAP_COOKIE = 'meteor_proxy_login_token';

function readBootstrapToken() {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${BOOTSTRAP_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function clearBootstrapToken() {
  document.cookie = `${BOOTSTRAP_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

Meteor.startup(() => {
  if (Meteor.userId()) {
    clearBootstrapToken();
    return;
  }

  const token = readBootstrapToken();
  if (!token) {
    return;
  }

  Meteor.loginWithToken(token, () => {
    clearBootstrapToken();
  });
});
