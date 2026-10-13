/**
 * The `mail` service group (issue #67): Postfix + Dovecot + OpenDKIM +
 * opensource-mail-helper (a milter, shipped as its own component under
 * /opt/opensource-server/mail-helper), rendered from the holder-only `mail`
 * section of the config snapshot.
 *
 * Lifecycle: while this agent holds the mail-host claim, the units are
 * enabled and started after each apply; when the group is turned off or the
 * claim is lost, they are stopped and disabled — configs and /var/vmail stay
 * in place. System users (vmail, opensource-mail) come from the
 * opensource-mail-helper package's maintainer scripts; the agent only
 * manages directories and files.
 *
 * Agent-managed mail state (DKIM keys, OpenDKIM tables) lives under
 * $STATE_DIRECTORY/mail, not /etc. Postfix/Dovecot/OpenDKIM daemon configs
 * remain in /etc where their packages expect them.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  enableAndStartServices,
  stopAndDisableServices,
  getServiceState,
  reloadOrRestartService,
  restartService,
} from './system';
import { renderTemplate, type ManagedService } from './apply';
import { log } from './log';
import type { AgentConfig } from './config';
import type { MailConfig, SiteConfig } from './types';

export const MAIL_UNITS = ['opendkim', 'dovecot', 'postfix', 'opensource-mail-helper'];

// Paths are env-overridable for development stacks; defaults match the
// packages. Both milter sockets live inside the Postfix chroot so the
// chrooted smtpd can reach them without inet ports.
const HELPER_DIR = process.env.MAIL_HELPER_DIR || '/opt/opensource-server/mail-helper';
const HELPER_SOCKET_DIR = process.env.MAIL_HELPER_SOCKET_DIR || '/var/spool/postfix/mail-helper';
const OPENDKIM_SOCKET_DIR = process.env.OPENDKIM_SOCKET_DIR || '/var/spool/postfix/opendkim';

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

/** The helper is a separate package; report it like a missing binary. */
export function missingMailHelper(): boolean {
  return !fileExists(path.join(HELPER_DIR, 'src', 'index.js'));
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

/** Agent-managed OpenDKIM material under the agent's state directory. */
function mailStateDir(agent: AgentConfig): string {
  return path.join(agent.stateDir, 'mail');
}

/** Everything the mail templates need, derived from the snapshot + local
 * environment (cert presence, DB passwords from /etc/environment). */
export function buildMailContext(mail: MailConfig, agent: AgentConfig, env: NodeJS.ProcessEnv = process.env) {
  const mysql = mail.db.dialect === 'mysql' || mail.db.dialect === 'mariadb';
  const host = mail.db.host;
  // Postfix map syntax: TCP "host:port", or a unix socket path for local
  // socket auth (Postgres peer / MariaDB unix_socket — no password needed).
  const pfHosts = host
    ? (mail.db.port ? `${host}:${mail.db.port}` : host)
    : (mysql ? 'unix:/var/run/mysqld/mysqld.sock' : 'unix:/var/run/postgresql');
  return {
    mail,
    stateDir: mailStateDir(agent),
    // Milter endpoints as the chrooted smtpd resolves them (queue-dir relative).
    helperMilter: `unix:${path.posix.relative('/var/spool/postfix', path.posix.join(HELPER_SOCKET_DIR, 'milter.sock'))}`,
    opendkimMilter: `unix:${path.posix.relative('/var/spool/postfix', path.posix.join(OPENDKIM_SOCKET_DIR, 'opendkim.sock'))}`,
    opendkimSocket: `local:${path.posix.join(OPENDKIM_SOCKET_DIR, 'opendkim.sock')}`,
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

/** Overlay for the helper's committed config.json (see mail-helper/). */
export function buildHelperLocalConfig(mail: MailConfig, env: NodeJS.ProcessEnv = process.env): string {
  const mysql = mail.db.dialect === 'mysql' || mail.db.dialect === 'mariadb';
  return `${JSON.stringify({
    socket: path.posix.join(HELPER_SOCKET_DIR, 'milter.sock'),
    db: {
      dialect: mysql ? 'mysql' : 'postgres',
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
    async render(config, agent) {
      const mail = mailOf(config);
      if (!mail) return null;
      const context = buildMailContext(mail, agent);
      const files = [
        { dest: '/etc/opendkim.conf', content: await renderTemplate('mail/opendkim.conf.ejs', context) },
        { dest: path.join(context.stateDir, 'opendkim-keytable'), content: await renderTemplate('mail/opendkim-keytable.ejs', context) },
        { dest: path.join(context.stateDir, 'opendkim-signingtable'), content: await renderTemplate('mail/opendkim-signingtable.ejs', context) },
      ];
      // Private keys never serialized anywhere else on this host.
      for (const k of mail.dkim) {
        files.push({
          dest: path.join(context.stateDir, 'dkim', `${k.domain}.private`),
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
    async render(config, agent) {
      const mail = mailOf(config);
      if (!mail) return null;
      const context = buildMailContext(mail, agent);
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
    async render(config, agent) {
      const mail = mailOf(config);
      if (!mail) return null;
      const context = buildMailContext(mail, agent);
      const files = [
        { dest: '/etc/postfix/main.cf', content: await renderTemplate('mail/postfix-main.cf.ejs', context) },
        { dest: '/etc/postfix/master.cf', content: await renderTemplate('mail/postfix-master.cf.ejs', context) },
        { dest: '/etc/postfix/vdomains', content: await renderTemplate('mail/postfix-vdomains.ejs', context) },
        { dest: '/etc/postfix/sni_map', content: await renderTemplate('mail/postfix-sni-map.ejs', context), mode: 0o600 },
        { dest: '/etc/postfix/sql/senders.cf', content: await renderTemplate('mail/postfix-sql-senders.cf.ejs', context), mode: 0o600 },
        { dest: '/etc/postfix/sql/mailboxes.cf', content: await renderTemplate('mail/postfix-sql-mailboxes.cf.ejs', context), mode: 0o600 },
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
      // The committed config.json ships defaults; the agent only writes the
      // environment-specific overlay (same split in dev and production).
      return [{
        dest: path.join(HELPER_DIR, 'config.local.json'),
        content: buildHelperLocalConfig(mail),
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

/** Create the directories the mail stack needs. Idempotent; runs only when
 * this agent holds the claim. System users come from package maintainer
 * scripts (opensource-mail-helper postinst creates vmail + opensource-mail). */
export function ensureMailProvisioned(agent: AgentConfig): void {
  fs.mkdirSync(VMAIL_DIR, { recursive: true });
  sh(['chown', 'vmail:vmail', VMAIL_DIR]);
  sh(['chmod', '0750', VMAIL_DIR]);

  // Agent-managed DKIM material under $STATE_DIRECTORY/mail.
  const stateDir = mailStateDir(agent);
  fs.mkdirSync(path.join(stateDir, 'dkim'), { recursive: true });
  sh(['chown', 'root:opendkim', stateDir, path.join(stateDir, 'dkim')]);
  sh(['chmod', '0750', stateDir, path.join(stateDir, 'dkim')]);

  // Milter socket dirs inside the Postfix chroot. The chrooted smtpd
  // connects as user postfix: setgid keeps sockets group-owned, and postfix
  // joins the opendkim group for OpenDKIM's socket (the standard Debian
  // recipe).
  fs.mkdirSync(HELPER_SOCKET_DIR, { recursive: true });
  sh(['chown', 'opensource-mail:postfix', HELPER_SOCKET_DIR]);
  sh(['chmod', '2750', HELPER_SOCKET_DIR]);
  fs.mkdirSync(OPENDKIM_SOCKET_DIR, { recursive: true });
  sh(['chown', 'opendkim:postfix', OPENDKIM_SOCKET_DIR]);
  sh(['chmod', '2750', OPENDKIM_SOCKET_DIR]);
  try {
    sh(['usermod', '-a', '-G', 'opendkim', 'postfix']);
  } catch {
    /* already a member, or opendkim not installed yet */
  }
}

/** Enable+start the mail units while holding the claim; stop+disable them
 * otherwise (configs and /var/vmail are left in place). The shutdown path
 * only runs when THIS agent started the units (state.mailManaged) — a
 * host's own unrelated postfix/dovecot must never be touched. Returns the
 * new mailManaged value for the caller to persist. */
export async function syncMailUnits(config: SiteConfig, mailManaged: boolean): Promise<boolean> {
  if (config.mail) {
    await enableAndStartServices(MAIL_UNITS);
    return true;
  }
  if (!mailManaged) return false;
  if (config.mailStatus) {
    log.info(`mail: not the mail host (${config.mailStatus}); stopping the units this agent started`);
  }
  await stopAndDisableServices(MAIL_UNITS);
  return false;
}

/** Stop the stack when the `mail` group itself is disabled — again only
 * when this agent started it, and only when something is actually running,
 * so nothing is churned on agents that never ran mail. */
export async function stopMailUnitsIfRunning(): Promise<void> {
  const states = await Promise.all(MAIL_UNITS.map((unit) => getServiceState(unit)));
  if (states.some((state) => state === 'active' || state === 'activating')) {
    log.info('mail: service group disabled but units are running; stopping them');
    await stopAndDisableServices(MAIL_UNITS);
  }
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
