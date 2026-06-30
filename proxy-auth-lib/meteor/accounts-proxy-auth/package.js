Package.describe({
  name: 'mieweb:accounts-proxy-auth',
  version: '0.1.0',
  summary: 'Log Meteor users in from a trusted upstream proxy identity assertion',
  documentation: 'README.md',
});

// Reuse the audited verification core shared by the other languages.
Npm.depends({
  '@mieweb/trusted-proxy-auth': '0.1.0',
});

Package.onUse(function (api) {
  api.versionsFrom('3.0.1');

  api.use('ecmascript');
  api.use(['accounts-base', 'webapp', 'ddp'], 'server');
  api.use('accounts-base', 'client');

  api.mainModule('server/proxy-login.js', 'server');
  api.mainModule('client/proxy-login.js', 'client');

  api.export('TrustedProxyAccounts', 'server');
});
