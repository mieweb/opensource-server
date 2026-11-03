#!/usr/bin/env node
/**
 * opensource-mail-helper: a Postfix milter (issue #67, PR #495 review).
 *
 * Runs pre-queue on the submission ports (587/465), listening on a unix
 * socket inside the Postfix chroot. Ordered BEFORE OpenDKIM in
 * submission_milters so the DKIM signature covers the headers added here.
 *
 *  - RCPT: rejects recipients who one-click-unsubscribed from the
 *    authenticated sender (mail_suppressions_v) with a synchronous 5.7.1;
 *    DB outages DEFER (fail closed).
 *  - End of message: strips client-forged List-Unsubscribe headers and, for
 *    single-recipient submissions, injects RFC 8058 one-click headers with
 *    an encrypted per-recipient token.
 *
 * Config: ./config.json (committed defaults) + ./config.local.json overlay
 * (written by the agent from the mail-host snapshot; gitignored). A
 * self-managed MTA can run this daemon too — it only needs the DB views and
 * the unsubscribe keys.
 */

'use strict';

const { Decision, MilterServer, SMFIF } = require('milter');
const { loadConfig } = require('./config');
const { Db } = require('./db');
const { parseAddress, rcptDecision, unsubscribeHeaders, isUnsubscribeHeader } = require('./filter');

function main() {
  const config = loadConfig();
  const db = new Db(config.db);

  const server = new MilterServer({
    socketPath: config.socket,
    // Group postfix (unit Group=) + 0660 lets the chrooted smtpd connect.
    chmod: 0o660,
    // We never need the body — decisions use only envelope and headers.
    collectBody: false,
    actions: SMFIF.ADDHDRS | SMFIF.CHGHDRS,
  });

  // Per-transaction state keyed on the milter context.
  const transactions = new WeakMap();
  const stateOf = (ctx) => {
    let state = transactions.get(ctx);
    if (!state) {
      state = { sender: '', recipients: [], forged: {} };
      transactions.set(ctx, state);
    }
    return state;
  };

  server.on('mail', (from, ctx) => {
    transactions.delete(ctx); // new transaction on the same connection
    stateOf(ctx).sender = parseAddress(from[0]);
    return Decision.continue();
  });

  server.on('rcpt', async (to, ctx) => {
    const state = stateOf(ctx);
    const address = parseAddress(to[0]);
    const decision = await rcptDecision(db, state.sender, address);
    if (decision.action === 'reject') {
      ctx.replyCode('550', decision.message);
      return Decision.reject();
    }
    if (decision.action === 'tempfail') {
      ctx.replyCode('451', decision.message);
      return Decision.tempfail();
    }
    state.recipients.push(address);
    return Decision.continue();
  });

  server.on('headerLine', (name, _value, ctx) => {
    // Track client-supplied List-Unsubscribe headers (forgeries) by their
    // per-name occurrence index so they can be deleted at end of message.
    if (isUnsubscribeHeader(name)) {
      const state = stateOf(ctx);
      state.forged[name] = (state.forged[name] ?? 0) + 1;
    }
    return Decision.continue();
  });

  server.on('bodyEnd', async (_body, ctx) => {
    const state = stateOf(ctx);
    try {
      for (const [name, count] of Object.entries(state.forged)) {
        for (let index = count; index >= 1; index--) {
          ctx.changeHeader(name, index, ''); // empty value deletes
        }
      }
      for (const header of await unsubscribeHeaders({ db, unsubscribe: config.unsubscribe }, state.sender, state.recipients)) {
        ctx.addHeader(header.name, header.value);
      }
    } catch (err) {
      // Header injection is best-effort; suppression enforcement already
      // happened at RCPT. Never block delivery here.
      console.error(`mail-helper: header injection failed: ${err.message}`);
    } finally {
      transactions.delete(ctx);
    }
    return Decision.accept();
  });

  server.on('abort', (ctx) => transactions.delete(ctx));
  server.on('close', (ctx) => transactions.delete(ctx));
  server.on('error', (error, ctx) => {
    console.error('mail-helper: milter error', ctx?.id, error);
  });

  return server.listen().then(() => {
    console.log(`mail-helper: milter listening on ${config.socket}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack ?? String(err));
    process.exit(1);
  });
}
