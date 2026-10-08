/**
 * Mail template rendering tests (node --test): assert the directives the
 * #67 guardrails depend on — real validation happens on-host via
 * `postfix check` / `doveconf -n` / `opendkim -n` at apply time.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');

const TEMPLATES = path.join(__dirname, '..', 'templates');

const context = {
  mail: {
    hostname: 'mail.example.com',
    relayhost: null,
    messageSizeLimitMb: 25,
    defaultQuotaMb: 1024,
    dkim: [
      { domain: 'example.com', selector: 'os20261008', privateKey: 'PEM' },
      { domain: 'other.example', selector: 'os20261001', privateKey: 'PEM2' },
    ],
    receiveDomains: ['example.com'],
    mailboxIds: ['a-1', 'b-2'],
    db: {
      dialect: 'postgres', host: null, port: null, database: 'cc',
      dovecotUser: 'mail_dovecot', postfixUser: 'mail_postfix',
    },
    unsubscribe: { baseUrl: 'https://manager.example.com', keys: [] },
  },
  helper: { filterPort: 10025, reinjectPort: 10026, policyPort: 10027 },
  opendkimPort: 8891,
  certs: {
    fallbackCert: '/etc/ssl/certs/mail.example.com.crt',
    fallbackKey: '/etc/ssl/private/mail.example.com.key',
    domains: [{ name: 'example.com', cert: '/etc/ssl/certs/example.com.crt', key: '/etc/ssl/private/example.com.key' }],
  },
  db: {
    prefix: 'pgsql',
    hosts: 'unix:/var/run/postgresql',
    user: 'mail_postfix',
    password: null,
    dbname: 'cc',
    dovecotDriver: 'pgsql',
    dovecotHost: '/var/run/postgresql',
    dovecotParams: { dbname: 'cc' },
    dovecotUser: 'mail_dovecot',
    dovecotPassword: null,
  },
};

function render(template, data = context) {
  return ejs.renderFile(path.join(TEMPLATES, template), data);
}

test('postfix main.cf: recipient gates, sender ownership, size limit, SNI', async () => {
  const out = await render('mail/postfix-main.cf.ejs');
  assert.match(out, /myhostname = mail\.example\.com/);
  assert.match(out, /message_size_limit = 26214400/);
  assert.match(out, /virtual_mailbox_domains = texthash:\/etc\/postfix\/vdomains/);
  assert.match(out, /check_policy_service unix:private\/quota-status/);
  assert.match(out, /smtpd_sender_login_maps = pgsql:\/etc\/postfix\/sql\/senders\.cf/);
  assert.match(out, /tls_server_sni_maps = hash:\/etc\/postfix\/sni_map/);
  assert.match(out, /mailhelper_destination_recipient_limit = 1/);
  assert.doesNotMatch(out, /relayhost =/);
});

test('postfix main.cf: relayhost with credentials', async () => {
  const out = await render('mail/postfix-main.cf.ejs', {
    ...context,
    mail: { ...context.mail, relayhost: { host: '[relay.net]:587', username: 'u', password: 'p' } },
  });
  assert.match(out, /relayhost = \[relay\.net\]:587/);
  assert.match(out, /smtp_sasl_password_maps = texthash:\/etc\/postfix\/sasl_passwd/);
});

test('postfix master.cf: TLS-only AUTH submission, policy + filter, DKIM on reinject only', async () => {
  const out = await render('mail/postfix-master.cf.ejs');
  assert.match(out, /submission[\s\S]*?smtpd_tls_security_level=encrypt/);
  assert.match(out, /smtpd_sender_restrictions=reject_sender_login_mismatch/);
  assert.match(out, /check_policy_service inet:127\.0\.0\.1:10027/);
  assert.match(out, /content_filter=mailhelper:\[127\.0\.0\.1\]:10025/);
  assert.match(out, /smtps[\s\S]*?smtpd_tls_wrappermode=yes/);
  assert.match(out, /127\.0\.0\.1:10026 inet[\s\S]*?smtpd_milters=inet:127\.0\.0\.1:8891/);
  // The milter must NOT run on the submission listeners.
  assert.doesNotMatch(out, /submission[\s\S]{0,600}smtpd_milters/);
});

test('dovecot.conf: SQL auth with the can_send smtp gate, per-domain certs, postfix sockets', async () => {
  const out = await render('mail/dovecot.conf.ejs');
  assert.match(out, /dovecot_config_version = 2\.4\.0/);
  assert.match(out, /sql_driver = pgsql/);
  assert.match(out, /can_send OR '%\{protocol\}' != 'smtp'/);
  assert.match(out, /local_name example\.com \{/);
  assert.match(out, /unix_listener \/var\/spool\/postfix\/private\/auth/);
  assert.match(out, /unix_listener \/var\/spool\/postfix\/private\/dovecot-lmtp/);
  assert.match(out, /quota-status -p postfix/);
  assert.match(out, /auth_allow_cleartext = no/);
});

test('opendkim: signs on localhost socket and oversigns List-Unsubscribe', async () => {
  const conf = await render('mail/opendkim.conf.ejs');
  assert.match(conf, /Socket\s+inet:8891@127\.0\.0\.1/);
  assert.match(conf, /OversignHeaders\s+From,List-Unsubscribe,List-Unsubscribe-Post/);

  const keytable = await render('mail/opendkim-keytable.ejs');
  assert.match(keytable, /os20261008\._domainkey\.example\.com example\.com:os20261008:\/etc\/dkimkeys\/example\.com\.private/);

  const signing = await render('mail/opendkim-signingtable.ejs');
  assert.match(signing, /\*@example\.com os20261008\._domainkey\.example\.com/);
});

test('vdomains and sni_map list the right domains', async () => {
  assert.match(await render('mail/postfix-vdomains.ejs'), /^example\.com ok$/m);
  assert.match(
    await render('mail/postfix-sni-map.ejs'),
    /^example\.com \/etc\/ssl\/private\/example\.com\.key \/etc\/ssl\/certs\/example\.com\.crt$/m,
  );
});
