#!/usr/bin/env node
/**
 * opensource-mail-helper: the mail host's after-queue content filter and
 * submission policy service (issue #67). Shipped in the agent package and
 * managed as part of the `mail` service group.
 *
 *  - Content filter (127.0.0.1:10025): Postfix pipes submitted mail here one
 *    recipient per copy; the helper strips any pre-existing List-Unsubscribe
 *    headers, adds RFC 8058 one-click headers with an encrypted per-recipient
 *    token (unless the account disabled them), and reinjects on
 *    127.0.0.1:10026 — where the OpenDKIM milter signs, so the signature
 *    covers the new headers.
 *  - Policy service (127.0.0.1:10027): at RCPT TO on the submission ports,
 *    rejects recipients who unsubscribed from the authenticated sender
 *    (mail_suppressions_v) with a synchronous 5.7.1.
 *
 * Config: /etc/opensource-server/mail-helper.json, rendered by the agent from
 * the mail-host snapshot. A self-managed MTA can run this daemon too — it
 * only needs the DB views and the unsubscribe keys.
 */

import fs from 'fs';
import net from 'net';
import { createUnsubscribeToken, type UnsubscribeKey } from './unsubscribe-token';
import { log } from './log';

const CONFIG_FILE = process.env.MAIL_HELPER_CONFIG || '/etc/opensource-server/mail-helper.json';

interface HelperConfig {
  listen: { filterPort: number; reinjectPort: number; policyPort: number };
  db: {
    dialect: 'postgres' | 'mysql';
    host: string | null;
    port: number | null;
    database: string | null;
    user: string;
    password: string | null;
  };
  unsubscribe: {
    baseUrl: string | null;
    keys: (UnsubscribeKey & { active: boolean })[];
  };
}

interface SenderInfo {
  accountId: string;
  unsubscribeHeaders: boolean;
}

/** Thin dialect-agnostic wrapper over the two mail views. */
class Db {
  private pool: {
    query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };

  constructor(cfg: HelperConfig['db']) {
    if (cfg.dialect === 'mysql') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mysql = require('mysql2/promise');
      const pool = mysql.createPool({
        ...(cfg.host ? { host: cfg.host, port: cfg.port ?? 3306 } : { socketPath: '/var/run/mysqld/mysqld.sock' }),
        user: cfg.user,
        ...(cfg.password ? { password: cfg.password } : {}),
        database: cfg.database,
        connectionLimit: 5,
      });
      this.pool = {
        async query(sql, params) {
          const [rows] = await pool.query(sql.replace(/\$\d+/g, '?'), params);
          return { rows: rows as Record<string, unknown>[] };
        },
      };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool } = require('pg');
      const pool = new Pool({
        // No host means the local unix socket (peer auth, no password).
        ...(cfg.host ? { host: cfg.host, port: cfg.port ?? 5432 } : { host: '/var/run/postgresql' }),
        user: cfg.user,
        ...(cfg.password ? { password: cfg.password } : {}),
        database: cfg.database ?? undefined,
        max: 5,
      });
      this.pool = pool;
    }
  }

  async getSender(address: string): Promise<SenderInfo | null> {
    const { rows } = await this.pool.query(
      'SELECT account_id, unsubscribe_headers FROM mail_senders_v WHERE sender = $1',
      [address.toLowerCase()],
    );
    if (!rows[0]) return null;
    const raw = rows[0].unsubscribe_headers; // boolean on Postgres, 0/1 on MySQL
    return {
      accountId: String(rows[0].account_id),
      unsubscribeHeaders: raw === true || raw === 1 || raw === '1',
    };
  }

  async isSuppressed(sender: string, recipient: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      'SELECT 1 AS hit FROM mail_suppressions_v WHERE sender = $1 AND recipient = $2',
      [sender.toLowerCase(), recipient.toLowerCase()],
    );
    return rows.length > 0;
  }
}

// --- header manipulation -----------------------------------------------------

const CRLF = '\r\n';

/** Strip client-supplied List-Unsubscribe(-Post) headers (including folded
 * continuation lines) so apps can't forge unsubscribe targets. */
export function stripUnsubscribeHeaders(headerBlock: string): string {
  const lines = headerBlock.split(CRLF);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^list-unsubscribe(-post)?\s*:/i.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^[ \t]/.test(line)) continue; // folded continuation
    skipping = false;
    kept.push(line);
  }
  return kept.join(CRLF);
}

/** Add the RFC 8058 headers for one recipient. `message` is the raw DATA
 * payload (dot-stuffed lines are untouched — headers never start with '.'). */
export function addUnsubscribeHeaders(
  message: string,
  { baseUrl, token }: { baseUrl: string; token: string },
): string {
  const splitAt = message.indexOf(CRLF + CRLF);
  const headers = splitAt === -1 ? message : message.slice(0, splitAt);
  const rest = splitAt === -1 ? '' : message.slice(splitAt);
  const cleaned = stripUnsubscribeHeaders(headers);
  const added =
    `List-Unsubscribe: <${baseUrl}/u/${token}>${CRLF}` +
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`;
  return `${added}${CRLF}${cleaned}${rest}`;
}

// --- minimal SMTP client (reinjection) ----------------------------------------

function reinject(
  port: number,
  envelope: { sender: string; recipient: string },
  message: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.setTimeout(30_000, () => socket.destroy(new Error('reinjection timed out')));
    let buffer = '';
    const steps: { expect: RegExp; send: string | null }[] = [
      { expect: /^220 /, send: `HELO mail-helper${CRLF}` },
      { expect: /^250/, send: `MAIL FROM:<${envelope.sender}>${CRLF}` },
      { expect: /^250/, send: `RCPT TO:<${envelope.recipient}>${CRLF}` },
      { expect: /^250/, send: `DATA${CRLF}` },
      { expect: /^354/, send: `${message}${CRLF}.${CRLF}` },
      { expect: /^250/, send: `QUIT${CRLF}` },
      { expect: /^221/, send: null },
    ];
    let step = 0;
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // Process complete (possibly multi-line) SMTP replies.
      let eol;
      while ((eol = buffer.indexOf(CRLF)) !== -1) {
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        if (/^\d{3}-/.test(line)) continue; // multi-line reply continues
        const current = steps[step];
        if (!current.expect.test(line)) {
          socket.destroy();
          return reject(new Error(`reinjection step ${step} got "${line}"`));
        }
        step += 1;
        if (current.send !== null) socket.write(current.send);
        if (step === steps.length) {
          socket.end();
          return resolve();
        }
      }
    });
    socket.on('error', reject);
  });
}

// --- content filter SMTP server ------------------------------------------------

interface FilterDeps {
  db: Db;
  unsubscribe: HelperConfig['unsubscribe'];
  reinjectPort: number;
}

/** Build the final message for one (sender, recipient) copy. Exported for tests. */
export async function processMessage(
  deps: Pick<FilterDeps, 'db' | 'unsubscribe'>,
  envelope: { sender: string; recipient: string },
  message: string,
): Promise<string> {
  const activeKey = deps.unsubscribe.keys.find((k) => k.active);
  const { baseUrl } = deps.unsubscribe;
  if (!activeKey || !baseUrl) return message;
  const sender = await deps.db.getSender(envelope.sender);
  if (!sender || !sender.unsubscribeHeaders) return message;
  const token = createUnsubscribeToken(
    { accountId: sender.accountId, recipient: envelope.recipient },
    activeKey,
  );
  return addUnsubscribeHeaders(message, { baseUrl, token });
}

function startContentFilter(deps: FilterDeps, port: number): net.Server {
  const server = net.createServer((socket) => {
    socket.setTimeout(5 * 60_000, () => socket.destroy());
    let buffer = '';
    let inData = false;
    let sender = '';
    let recipient = '';
    let data = '';

    const reply = (line: string) => socket.write(`${line}${CRLF}`);
    reply('220 mail-helper ESMTP');

    const reset = () => {
      sender = '';
      recipient = '';
      data = '';
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      void (async () => {
        let eol;
        while ((eol = buffer.indexOf(CRLF)) !== -1) {
          const line = buffer.slice(0, eol);
          buffer = buffer.slice(eol + 2);

          if (inData) {
            if (line === '.') {
              inData = false;
              try {
                const message = await processMessage(deps, { sender, recipient }, data);
                await reinject(deps.reinjectPort, { sender, recipient }, message);
                reply('250 2.0.0 Ok');
              } catch (err) {
                // Tempfail: Postfix keeps the message queued and retries.
                log.error(`mail-helper: filter failed: ${(err as Error).message}`);
                reply('451 4.3.0 content filter failure');
              }
              reset();
            } else {
              data += (data ? CRLF : '') + line;
            }
            continue;
          }

          const upper = line.toUpperCase();
          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
            reply('250-mail-helper');
            reply('250-8BITMIME');
            reply('250 XFORWARD NAME ADDR PORT PROTO HELO IDENT SOURCE');
          } else if (upper.startsWith('XFORWARD')) {
            reply('250 2.0.0 Ok');
          } else if (upper.startsWith('MAIL FROM:')) {
            sender = (line.slice(10).match(/<([^>]*)>/)?.[1] ?? line.slice(10)).trim();
            reply('250 2.1.0 Ok');
          } else if (upper.startsWith('RCPT TO:')) {
            // mailhelper_destination_recipient_limit = 1 — one recipient per copy.
            recipient = (line.slice(8).match(/<([^>]*)>/)?.[1] ?? line.slice(8)).trim();
            reply('250 2.1.5 Ok');
          } else if (upper === 'DATA') {
            inData = true;
            reply('354 End data with <CR><LF>.<CR><LF>');
          } else if (upper === 'RSET' || upper === 'NOOP') {
            if (upper === 'RSET') reset();
            reply('250 2.0.0 Ok');
          } else if (upper === 'QUIT') {
            reply('221 2.0.0 Bye');
            socket.end();
          } else {
            reply('502 5.5.2 Command not recognized');
          }
        }
      })();
    });
    socket.on('error', () => socket.destroy());
  });
  server.listen(port, '127.0.0.1', () => log.info(`mail-helper: content filter on 127.0.0.1:${port}`));
  return server;
}

// --- Postfix policy service ------------------------------------------------------

function startPolicyService(db: Db, port: number): net.Server {
  const server = net.createServer((socket) => {
    socket.setTimeout(60_000, () => socket.destroy());
    let buffer = '';
    const attrs: Record<string, string> = {};
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      void (async () => {
        let eol;
        while ((eol = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, eol).replace(/\r$/, '');
          buffer = buffer.slice(eol + 1);
          if (line !== '') {
            const eq = line.indexOf('=');
            if (eq > 0) attrs[line.slice(0, eq)] = line.slice(eq + 1);
            continue;
          }
          // Blank line = end of request. Sender == SASL login on these ports
          // (reject_sender_login_mismatch), but prefer the login when present.
          const sender = attrs.sasl_username || attrs.sender || '';
          const recipient = attrs.recipient || '';
          let action = 'DUNNO';
          try {
            if (sender && recipient && (await db.isSuppressed(sender, recipient))) {
              action = `REJECT 5.7.1 Recipient has unsubscribed from ${sender}`;
            }
          } catch (err) {
            // Fail open: a DB hiccup must not block all submission.
            log.error(`mail-helper: policy lookup failed: ${(err as Error).message}`);
          }
          socket.write(`action=${action}\n\n`);
          for (const k of Object.keys(attrs)) delete attrs[k];
        }
      })();
    });
    socket.on('error', () => socket.destroy());
  });
  server.listen(port, '127.0.0.1', () => log.info(`mail-helper: policy service on 127.0.0.1:${port}`));
  return server;
}

// --- main ------------------------------------------------------------------------

function main(): void {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as HelperConfig;
  const db = new Db(config.db);
  startContentFilter(
    { db, unsubscribe: config.unsubscribe, reinjectPort: config.listen.reinjectPort },
    config.listen.filterPort,
  );
  startPolicyService(db, config.listen.policyPort);
}

if (require.main === module) {
  main();
}
