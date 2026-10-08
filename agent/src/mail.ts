/**
 * The `mail` service group (issue #67): Postfix + Dovecot + OpenDKIM +
 * opensource-mail-helper, rendered from the holder-only `mail` section of
 * the config snapshot.
 *
 * Lifecycle: while this agent holds the mail-host claim, the units are
 * enabled and started after each apply; when the group is turned off or the
 * claim is lost, they are stopped and disabled — configs and /var/vmail stay
 * in place.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  enableAndStartServices,
  stopAndDisableServices,
  reloadOrRestartService,
  restartService,
} from './system';
import { renderTemplate, type ManagedService } from './apply';
import { log } from './log';
import type { MailConfig, SiteConfig } from './types';

export const MAIL_UNITS = ['opendkim', 'dovecot', 'postfix', 'opensource-mail-helper'];

/** Localhost plumbing between Postfix, the helper, and OpenDKIM. */
export const HELPER_PORTS = { filterPort: 10025, reinjectPort: 10026, policyPort: 10027 };
export const OPENDKIM_PORT = 8891;

export const HELPER_CONFIG_FILE = '/etc/opensource-server/mail-helper.json';

const VMAIL_DIR = '/var/vmail';
const GC_STATE_FILE = path.join(VMAIL_DIR, '.gc-state.json');
const GC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function sh(cmd: string[]): void {
  execFileSync(cmd[0], cmd.slice(1), { stdio: 'pipe', encoding: 'utf8' });
}

function fileExists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

// --- render context ---------------------------------------------------------

interface CertPair { name: string; cert: string; key: string }

/** Per-domain cert material shared with nginx. Domains without both files
 * are skipped (they fall back to the fallback chain). */
function domainCerts(mail: MailConfig): CertPair[] {
  const names = new Set<string>([
    ...mail.dkim.map((k) => k.domain),
    ...mail.receiveDomains,
  ]);
  if (mail.hostname) names.add(mail.hostname);
  const pairs: CertPair[] = [];
  for (const name of [...names].sort()) {
    const cert = `/etc/ssl/certs/${name}.crt`;
    const key = `/etc/ssl/private/${name}.key`;
    if (fileExists(cert) && fileExists(key)) pairs.push({ name, cert, key });
  }
  return pairs;
}

function fallbackChain(mail: MailConfig): { fallbackCert: string; fallbackKey: string } {
  if (mail.hostname) {
    const cert = `/etc/ssl/certs/${mail.hostname}.crt`;
    const key = `/etc/ssl/private/${mail.hostname}.key`;
    if (fileExists(cert) && fileExists(key)) return { fallbackCert: cert, fallbackKey: key };
  }
  // ssl-cert package default (an agent package dependency).
  return {
    fallbackCert: '/etc/ssl/certs/ssl-cert-snakeoil.pem',
    fallbackKey: '/etc/ssl/private/ssl-cert-snakeoil.key',
  };
}

/** Everything the mail templates need, derived from the snapshot + local
 * environment (cert presence, DB passwords from /etc/environment). */
export function buildMailContext(mail: MailConfig, env: NodeJS.ProcessEnv = process.env) {
  const mysql = mail.db.dialect === 'mysql' || mail.db.dialect === 'mariadb';
  const host = mail.db.host;
  // Postfix map syntax: TCP "host:port", or a unix socket path for local
  // socket auth (Postgres peer / MariaDB unix_socket — no password needed).
  const pfHosts = host
    ? (mail.db.port ? `${host}:${mail.db.port}` : host)
    : (mysql ? 'unix:/var/run/mysqld/mysqld.sock' : 'unix:/var/run/postgresql');
  return {
    mail,
    helper: HELPER_PORTS,
    opendkimPort: OPENDKIM_PORT,
    certs: { ...fallbackChain(mail), domains: domainCerts(mail) },
    db: {
      prefix: mysql ? 'mysql' : 'pgsql',
      hosts: pfHosts,
      user: mail.db.postfixUser,
      password: env.MAIL_POSTFIX_DB_PASSWORD || null,
      dbname: mail.db.database ?? '',
      dovecotDriver: mysql ? 'mysql' : 'pgsql',
      dovecotHost: host || (mysql ? '/var/run/mysqld/mysqld.sock' : '/var/run/postgresql'),
      dovecotParams: { dbname: mail.db.database ?? '' },
      dovecotUser: mail.db.dovecotUser,
      dovecotPassword: env.MAIL_DOVECOT_DB_PASSWORD || null,
    },
  };
}

/** opensource-mail-helper daemon config (JSON, root:opensource-mail 0640). */
export function buildHelperConfig(mail: MailConfig, env: NodeJS.ProcessEnv = process.env): string {
  const context = buildMailContext(mail, env);
  return `${JSON.stringify({
    listen: HELPER_PORTS,
    db: {
      dialect: context.db.prefix === 'mysql' ? 'mysql' : 'postgres',
      host: mail.db.host,
      port: mail.db.port,
      database: mail.db.database,
      user: mail.db.postfixUser,
      password: env.MAIL_POSTFIX_DB_PASSWORD || null,
    },
    unsubscribe: mail.unsubscribe,
  }, null, 2)}\n`;
}

// --- managed services --------------------------------------------------------

/** Mail is managed only while this agent holds the claim. */
function mailOf(config: SiteConfig): MailConfig | null {
  return config.mail ?? null;
}

export const mailServices: ManagedService[] = [
  {
    unit: 'opendkim',
    group: 'mail',
    async render(config) {
      const mail = mailOf(config);
      if (!mail) return null;
      const context = buildMailContext(mail);
      const files = [
        { dest: '/etc/opendkim.conf', content: await renderTemplate('mail/opendkim.conf.ejs', context) },
        { dest: '/etc/opendkim/keytable', content: await renderTemplate('mail/opendkim-keytable.ejs', context) },
        { dest: '/etc/opendkim/signingtable', content: await renderTemplate('mail/opendkim-signingtable.ejs', context) },
      ];
      // Private keys never serialized anywhere else on this host.
      for (const k of mail.dkim) {
        files.push({
          dest: `/etc/dkimkeys/${k.domain}.private`,
          content: k.privateKey,
          mode: 0o600,
          owner: 'opendkim:opendkim',
        } as (typeof files)[number]);
      }
      return files;
    },
    test: ['opendkim', '-n'],
    reload() {
      return restartService('opendkim');
    },
  },
  {
    unit: 'dovecot',
    group: 'mail',
    async render(config) {
      const mail = mailOf(config);
      if (!mail) return null;
      const context = buildMailContext(mail);
      return [{
        dest: '/etc/dovecot/dovecot.conf',
        content: await renderTemplate('mail/dovecot.conf.ejs', context),
        // Embeds the mail_dovecot DB password when TCP auth is used.
        mode: 0o600,
      }];
    },
    test: ['doveconf', '-n'],
    async reload() {
      await reloadOrRestartService('dovecot');
      // Flush cached credentials so disables/rotations apply immediately.
      try {
        sh(['doveadm', 'auth', 'cache', 'flush']);
      } catch {
        /* dovecot still starting — the cache is empty anyway */
      }
    },
  },
  {
    unit: 'postfix',
    group: 'mail',
    // Debian's postfix.service is a wrapper; the real daemon state lives on
    // the postfix@- instance.
    statusUnit: 'postfix@-',
    async render(config) {
      const mail = mailOf(config);
      if (!mail) return null;
      const context = buildMailContext(mail);
      const files = [
        { dest: '/etc/postfix/main.cf', content: await renderTemplate('mail/postfix-main.cf.ejs', context) },
        { dest: '/etc/postfix/master.cf', content: await renderTemplate('mail/postfix-master.cf.ejs', context) },
        { dest: '/etc/postfix/vdomains', content: await renderTemplate('mail/postfix-vdomains.ejs', context) },
        { dest: '/etc/postfix/sni_map', content: await renderTemplate('mail/postfix-sni-map.ejs', context), mode: 0o600 },
        { dest: '/etc/postfix/sql/senders.cf', content: await renderTemplate('mail/postfix-sql-senders.cf.ejs', context), mode: 0o600 },
      ];
      if (mail.relayhost?.username) {
        files.push({
          dest: '/etc/postfix/sasl_passwd',
          content: `${mail.relayhost.host} ${mail.relayhost.username}:${mail.relayhost.password ?? ''}\n`,
          mode: 0o600,
        } as (typeof files)[number]);
      }
      return files;
    },
    // Compile the SNI key+chain hash before validating.
    postWrite: [['postmap', '-F', 'hash:/etc/postfix/sni_map']],
    test: ['postfix', 'check'],
    reload() {
      return reloadOrRestartService('postfix');
    },
  },
  {
    unit: 'opensource-mail-helper',
    group: 'mail',
    async render(config) {
      const mail = mailOf(config);
      if (!mail) return null;
      return [{
        dest: HELPER_CONFIG_FILE,
        content: buildHelperConfig(mail),
        mode: 0o640,
        owner: 'root:opensource-mail',
      }];
    },
    reload() {
      return restartService('opensource-mail-helper');
    },
  },
];

// --- lifecycle ---------------------------------------------------------------

/** Create the system users/dirs the mail stack needs. Idempotent; runs only
 * when this agent holds the claim. */
export function ensureMailProvisioned(): void {
  const ensureUser = (name: string, opts: string[]) => {
    try {
      sh(['id', '-u', name]);
    } catch {
      sh(['useradd', '--system', ...opts, name]);
    }
  };
  // Mailbox owner (Dovecot mail_uid/mail_gid).
  ensureUser('vmail', ['--home-dir', VMAIL_DIR, '--create-home', '--shell', '/usr/sbin/nologin']);
  // The helper daemon's unprivileged user (reads its config via group).
  ensureUser('opensource-mail', ['--no-create-home', '--shell', '/usr/sbin/nologin']);
  fs.mkdirSync(VMAIL_DIR, { recursive: true });
  sh(['chown', 'vmail:vmail', VMAIL_DIR]);
  sh(['chmod', '0750', VMAIL_DIR]);
  fs.mkdirSync('/etc/dkimkeys', { recursive: true });
  fs.mkdirSync('/etc/opensource-server', { recursive: true });
}

/** Enable+start the mail units while holding the claim; stop+disable them
 * otherwise (configs and /var/vmail are left in place). */
export async function syncMailUnits(config: SiteConfig): Promise<void> {
  if (config.mail) {
    await enableAndStartServices(MAIL_UNITS);
    return;
  }
  if (config.mailStatus) {
    log.info(`mail: not the mail host (${config.mailStatus}); ensuring units are stopped`);
  }
  await stopAndDisableServices(MAIL_UNITS);
}

/** Remove Maildirs of deleted accounts after a retention window. A dir is
 * eligible once its account id stops appearing in the snapshot's mailboxIds;
 * first-missing timestamps persist in /var/vmail/.gc-state.json. */
export function gcMailboxes(mail: MailConfig, now = Date.now()): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(VMAIL_DIR).filter((e) => !e.startsWith('.'));
  } catch {
    return;
  }
  let gcState: Record<string, number> = {};
  try {
    gcState = JSON.parse(fs.readFileSync(GC_STATE_FILE, 'utf8'));
  } catch {
    /* first run or corrupt state — rebuild from scratch */
  }
  const known = new Set(mail.mailboxIds);
  const next: Record<string, number> = {};
  for (const entry of entries) {
    if (known.has(entry)) continue;
    const firstMissing = gcState[entry] ?? now;
    if (now - firstMissing >= GC_RETENTION_MS) {
      log.info(`mail: removing mailbox of deleted account ${entry}`);
      fs.rmSync(path.join(VMAIL_DIR, entry), { recursive: true, force: true });
    } else {
      next[entry] = firstMissing;
    }
  }
  fs.writeFileSync(GC_STATE_FILE, JSON.stringify(next, null, 2));
}
