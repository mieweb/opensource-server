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
    unsubscribe: { keys: [] },
  },
  stateDir: '/var/lib/opensource-agent/mail',
  srs: null,
  acceptDomains: ['example.com'],
  helperMilter: 'unix:mail-helper/milter.sock',
  opendkimMilter: 'unix:opendkim/opendkim.sock',
  opendkimSocket: 'local:/var/spool/postfix/opendkim/opendkim.sock',
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

test('postfix main.cf: live recipient map, sender ownership, size limit, SNI, milter policy', async () => {
  const out = await render('mail/postfix-main.cf.ejs');
  assert.match(out, /myhostname = mail\.example\.com/);
  assert.match(out, /message_size_limit = 26214400/);
  assert.match(out, /virtual_mailbox_domains = texthash:\/etc\/postfix\/vdomains/);
  // Unknown recipients must be rejected at RCPT (live SQL), not via static:x.
  assert.match(out, /virtual_mailbox_maps = proxy:pgsql:\/etc\/postfix\/sql\/mailboxes\.cf/);
  assert.doesNotMatch(out, /static:x/);
  assert.match(out, /check_policy_service unix:private\/quota-status/);
  // Unknown recipients rejected by Postfix before the policy service, which
  // answers DUNNO for non-mailboxes (SRS bounce addresses must pass).
  assert.match(out, /reject_unauth_destination, reject_unlisted_recipient, check_policy_service/);
  assert.match(out, /smtpd_sender_login_maps = proxy:pgsql:\/etc\/postfix\/sql\/senders\.cf/);
  assert.match(out, /tls_server_sni_maps = hash:\/etc\/postfix\/sni_map/);
  // Helper milter first, OpenDKIM second — the signature covers added headers.
  assert.match(out, /submission_milters = unix:mail-helper\/milter\.sock, unix:opendkim\/opendkim\.sock/);
  assert.match(out, /submission_recipient_restrictions = permit_sasl_authenticated, reject/);
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

test('postfix master.cf: TLS-only AUTH submission referencing main.cf policy, no inet filters', async () => {
  const out = await render('mail/postfix-master.cf.ejs');
  assert.match(out, /submission[\s\S]*?smtpd_tls_security_level=encrypt/);
  assert.match(out, /smtpd_sender_restrictions=reject_sender_login_mismatch/);
  assert.match(out, /-o smtpd_milters=\$submission_milters/);
  assert.match(out, /-o smtpd_recipient_restrictions=\$submission_recipient_restrictions/);
  assert.match(out, /smtps[\s\S]*?smtpd_tls_wrappermode=yes/);
  // The milter architecture removed the content filter, reinjection
  // listener, and policy service — no localhost inet plumbing remains.
  assert.doesNotMatch(out, /127\.0\.0\.1:\d+/);
  assert.doesNotMatch(out, /content_filter/);
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
  assert.match(out, /^quota_status_nouser = DUNNO$/m);
  assert.match(out, /auth_allow_cleartext = no/);
});

test('dovecot.conf: pgsql nests libpq key/values in parameters { } (Dovecot 2.4)', async () => {
  const out = await render('mail/dovecot.conf.ejs');
  // pgsql has no per-key settings — a bare `dbname =` in the pgsql block is
  // rejected by doveconf on Debian 13 (regression: "Unknown setting: dbname").
  assert.match(out, /pgsql \/var\/run\/postgresql \{\s*parameters \{[^}]*dbname = cc[^}]*user = mail_dovecot[^}]*\}/);
  // Peer auth over the socket — no password line at all.
  assert.doesNotMatch(out, /password =/);
});

test('dovecot.conf: pgsql password lands inside parameters when set', async () => {
  const out = await render('mail/dovecot.conf.ejs', {
    ...context,
    db: { ...context.db, dovecotHost: 'db.example', dovecotPassword: 'hunter2' },
  });
  assert.match(out, /pgsql db\.example \{\s*parameters \{[^}]*password = hunter2[^}]*\}/);
});

test('dovecot.conf: mysql keeps its native dbname/user settings in the block', async () => {
  const out = await render('mail/dovecot.conf.ejs', {
    ...context,
    db: { ...context.db, dovecotDriver: 'mysql', dovecotHost: '/var/run/mysqld/mysqld.sock', dovecotPassword: 'hunter2' },
  });
  assert.match(out, /sql_driver = mysql/);
  assert.doesNotMatch(out, /parameters \{/);
  assert.match(out, /mysql \/var\/run\/mysqld\/mysqld\.sock \{[^}]*dbname = cc[^}]*user = mail_dovecot[^}]*password = hunter2[^}]*\}/);
});

test('opendkim: unix socket in the postfix chroot, state-dir tables, oversigned List-Unsubscribe', async () => {
  const conf = await render('mail/opendkim.conf.ejs');
  assert.match(conf, /Socket\s+local:\/var\/spool\/postfix\/opendkim\/opendkim\.sock/);
  assert.match(conf, /OversignHeaders\s+From,List-Unsubscribe,List-Unsubscribe-Post/);
  assert.match(conf, /KeyTable\s+\/var\/lib\/opensource-agent\/mail\/opendkim-keytable/);

  const keytable = await render('mail/opendkim-keytable.ejs');
  assert.match(keytable, /os20261008\._domainkey\.example\.com example\.com:os20261008:\/var\/lib\/opensource-agent\/mail\/dkim\/example\.com\.private/);

  const signing = await render('mail/opendkim-signingtable.ejs');
  assert.match(signing, /\*@example\.com os20261008\._domainkey\.example\.com/);
});

test('sql maps, vdomains, and sni_map list the right entries', async () => {
  assert.match(await render('mail/postfix-vdomains.ejs'), /^example\.com ok$/m);
  assert.match(
    await render('mail/postfix-sni-map.ejs'),
    /^example\.com \/etc\/ssl\/private\/example\.com\.key \/etc\/ssl\/certs\/example\.com\.crt$/m,
  );
  assert.match(await render('mail/postfix-sql-mailboxes.cf.ejs'), /SELECT 1 FROM mail_recipients_v WHERE recipient = '%s'/);
  assert.match(await render('mail/postfix-sql-senders.cf.ejs'), /SELECT login FROM mail_senders_v WHERE sender = '%s'/);
  assert.match(await render('mail/postfix-sql-forwards.cf.ejs'), /SELECT destination FROM mail_forwards_v WHERE source = '%s'/);
});

const srs = {
  domain: 'mail.example.com',
  excludeDomains: ['example.com', 'mail.example.com', 'other.example'],
  forwardPort: 10001,
  reversePort: 10002,
};

test('postfix main.cf: forwards via proxied SQL alias map; no SRS maps without postsrsd', async () => {
  const out = await render('mail/postfix-main.cf.ejs');
  assert.match(out, /virtual_alias_maps = proxy:pgsql:\/etc\/postfix\/sql\/forwards\.cf/);
  assert.doesNotMatch(out, /canonical_maps/);
});

test('postfix main.cf + postsrsd: SRS canonical maps and default file', async () => {
  const data = { ...context, srs, acceptDomains: ['example.com', 'mail.example.com'] };
  const main = await render('mail/postfix-main.cf.ejs', data);
  assert.match(main, /sender_canonical_maps = tcp:127\.0\.0\.1:10001/);
  assert.match(main, /sender_canonical_classes = envelope_sender/);
  assert.match(main, /recipient_canonical_maps = tcp:127\.0\.0\.1:10002/);
  assert.match(main, /recipient_canonical_classes = envelope_recipient, header_recipient/);

  // The SRS domain is accepted so bounces to SRS0= addresses come back.
  assert.match(await render('mail/postfix-vdomains.ejs', data), /^mail\.example\.com ok$/m);

  const def = await render('mail/postsrsd.default.ejs', data);
  assert.match(def, /^SRS_DOMAIN=mail\.example\.com$/m);
  assert.match(def, /^SRS_EXCLUDE_DOMAINS=example\.com,mail\.example\.com,other\.example$/m);
  assert.match(def, /^SRS_FORWARD_PORT=10001$/m);
  assert.match(def, /^SRS_LISTEN_ADDR=127\.0\.0\.1$/m);
});

test('buildMailContext: SRS only with postsrsd installed and a mail hostname', () => {
  const { buildMailContext } = require('../dist/mail.js');
  const agent = { stateDir: '/var/lib/opensource-agent' };
  const withSrs = buildMailContext(context.mail, agent, {}, true);
  assert.deepStrictEqual(withSrs.srs, srs);
  assert.deepStrictEqual(withSrs.acceptDomains, ['example.com', 'mail.example.com']);

  assert.strictEqual(buildMailContext(context.mail, agent, {}, false).srs, null);
  const noHost = buildMailContext({ ...context.mail, hostname: null }, agent, {}, true);
  assert.strictEqual(noHost.srs, null);
  assert.deepStrictEqual(noHost.acceptDomains, ['example.com']);
});
