/**
 * Filter decisions, kept free of milter/server plumbing so they are unit
 * testable. The milter runs pre-queue on the submission ports only, where
 * reject_sender_login_mismatch enforces envelope sender == SASL login, except
 * for the null reverse path, which is rejected explicitly below.
 */

'use strict';

const { createUnsubscribeToken } = require('./unsubscribe-token');

/** Envelope address normalization: strip <>, ESMTP params, case. */
function parseAddress(raw) {
  const first = String(raw ?? '').trim().split(/\s+/)[0] ?? '';
  const match = /<([^>]*)>/.exec(first);
  return (match ? match[1] : first).trim().toLowerCase();
}

/**
 * RCPT decision: reject recipients who unsubscribed from this sender. A DB
 * failure DEFERS (fail closed) — delivering to someone who opted out would
 * break the synchronous suppression guarantee, so Postfix must retry.
 *
 * @returns {Promise<{action: 'continue'|'reject'|'tempfail', message?: string}>}
 */
async function rcptDecision(db, sender, recipient) {
  if (!sender) return { action: 'reject', message: '5.7.1 Envelope sender required' };
  if (!recipient) return { action: 'continue' };
  try {
    if (await db.isSuppressed(sender, recipient)) {
      return { action: 'reject', message: `5.7.1 Recipient has unsubscribed from ${sender}` };
    }
    return { action: 'continue' };
  } catch (err) {
    return { action: 'tempfail', message: `4.3.0 Suppression lookup unavailable (${err.code ?? 'db error'})` };
  }
}

/**
 * Headers to add at end-of-message. Tokens identify (account, recipient), so
 * headers are only added when the transaction has exactly one recipient —
 * multi-recipient submissions (rare for app mail) get none.
 *
 * @returns {Promise<{name: string, value: string}[]>} empty when not applicable
 */
async function unsubscribeHeaders({ db, unsubscribe }, sender, recipients) {
  const activeKey = (unsubscribe.keys ?? []).find((k) => k.active);
  if (!activeKey || !unsubscribe.baseUrl || recipients.length !== 1) return [];
  const account = await db.getSender(sender);
  if (!account || !account.unsubscribeHeaders) return [];
  const token = createUnsubscribeToken({ accountId: account.accountId, recipient: recipients[0] }, activeKey);
  return [
    { name: 'List-Unsubscribe', value: `<${unsubscribe.baseUrl}/u/${token}>` },
    { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
  ];
}

/** Header names the helper owns — client-supplied ones are forged and removed. */
function isUnsubscribeHeader(name) {
  return /^list-unsubscribe(-post)?$/i.test(String(name).trim());
}

module.exports = { parseAddress, rcptDecision, unsubscribeHeaders, isUnsubscribeHeader };
