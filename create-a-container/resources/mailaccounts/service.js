/**
 * Mail accounts business logic (issue #67).
 *
 * Accounts exist only on domains that can send (mailEnabled + DNS verified).
 * Passwords are generated server-side, returned exactly once, and stored as
 * Argon2id (p=1) hashes that Dovecot verifies live through mail_accounts_v.
 */

const repo = require('./repository');
const { ApiError } = require('../../middlewares/api');
const {
  DEFAULT_QUOTA_MB,
  generateMailPassword,
  hashMailPassword,
  isReservedLocalPart,
} = require('../../utils/mail-account');

const MB = 1024 * 1024;

async function requireUser(session) {
  const user = await repo.findUserByUid(session.uid);
  if (!user) throw new ApiError(401, 'unauthorized', 'Session user not found');
  return user;
}

function domainCanSend(domain) {
  return !!(domain.mailEnabled && domain.mailDnsVerified);
}

/** Owner or admin may see the account; others get a 404 (existence hidden). */
async function loadAccountFor(session, id, user) {
  const account = await repo.findById(id);
  if (!account || (!session.isAdmin && account.uidNumber !== user.uidNumber)) {
    throw new ApiError(404, 'not_found', 'Mail account not found');
  }
  return account;
}

/** SMTP/IMAP client settings returned alongside one-time passwords. */
async function connectionInfo(account) {
  const mailHostname = await repo.getSetting('mail_hostname');
  const address = `${account.localPart}@${account.domain.name}`;
  return {
    host: mailHostname || account.domain.name,
    username: address,
    smtp: { ports: [587, 465] },
    imap: { ports: [993, 143] },
  };
}

async function listAccounts(session, { all } = {}) {
  const user = await requireUser(session);
  if (all && !session.isAdmin) {
    throw new ApiError(403, 'forbidden', 'Admin access required to list all accounts');
  }
  return repo.findAll(all && session.isAdmin ? {} : { uidNumber: user.uidNumber });
}

async function getAccount(session, id) {
  const user = await requireUser(session);
  return loadAccountFor(session, id, user);
}

async function listSendableDomains(session) {
  await requireUser(session);
  return repo.findSendableDomains();
}

/** Returns { account, password, connection } — password shown exactly once. */
async function createAccount(session, { externalDomainId, localPart, description, quotaMb }) {
  const user = await requireUser(session);

  const domain = await repo.findDomain(externalDomainId);
  if (!domain) throw new ApiError(404, 'domain_not_found', 'External domain not found');
  if (!domainCanSend(domain)) {
    throw new ApiError(422, 'domain_cannot_send', 'Mail is not enabled (or DNS is not verified) for this domain');
  }
  if (isReservedLocalPart(localPart) && !session.isAdmin) {
    throw new ApiError(403, 'reserved_local_part', `"${localPart}" is reserved for administrators`);
  }
  if (quotaMb !== undefined && !session.isAdmin) {
    throw new ApiError(403, 'admin_required', 'Only admins can set a quota');
  }
  if (await repo.findByAddress(externalDomainId, localPart)) {
    throw new ApiError(409, 'address_taken', 'That address already exists');
  }

  const defaultQuotaMb = parseInt(await repo.getSetting('mail_default_quota_mb'), 10) || DEFAULT_QUOTA_MB;
  const password = generateMailPassword();
  const account = await repo.create({
    uidNumber: user.uidNumber,
    externalDomainId,
    localPart,
    description: description || null,
    passwordHash: await hashMailPassword(password),
    quotaBytes: (quotaMb ?? defaultQuotaMb) * MB,
  });
  return { account, password, connection: await connectionInfo(account) };
}

async function updateAccount(session, id, body) {
  const user = await requireUser(session);
  const account = await loadAccountFor(session, id, user);

  if ((body.quotaMb !== undefined || body.username !== undefined) && !session.isAdmin) {
    throw new ApiError(403, 'admin_required', 'Only admins can change quota or transfer ownership');
  }

  const fields = {};
  if (body.description !== undefined) fields.description = body.description;
  if (body.enabled !== undefined) fields.enabled = body.enabled;
  if (body.unsubscribeHeaders !== undefined) fields.unsubscribeHeaders = body.unsubscribeHeaders;
  if (body.quotaMb !== undefined) fields.quotaBytes = body.quotaMb * MB;
  if (body.username !== undefined) {
    const target = await repo.findUserByUid(body.username);
    if (!target) throw new ApiError(404, 'user_not_found', 'Target user not found');
    if (target.status !== 'active') throw new ApiError(422, 'user_inactive', 'Target user is not active');
    fields.uidNumber = target.uidNumber;
  }
  return repo.update(account, fields);
}

/** Returns { account, password, connection } — fresh password shown exactly once. */
async function rotatePassword(session, id) {
  const user = await requireUser(session);
  const account = await loadAccountFor(session, id, user);
  const password = generateMailPassword();
  const updated = await repo.update(account, {
    passwordHash: await hashMailPassword(password),
    lastRotatedAt: new Date(),
  });
  return { account: updated, password, connection: await connectionInfo(updated) };
}

async function deleteAccount(session, id) {
  const user = await requireUser(session);
  const account = await loadAccountFor(session, id, user);
  await repo.destroy(account);
}

async function listSuppressions(session, id) {
  const user = await requireUser(session);
  await loadAccountFor(session, id, user);
  return repo.findSuppressions(id);
}

/** Admin-only: an app owner must not be able to quietly re-subscribe people. */
async function removeSuppression(session, id, suppressionId) {
  const user = await requireUser(session);
  await loadAccountFor(session, id, user);
  if (!session.isAdmin) {
    throw new ApiError(403, 'admin_required', 'Only admins can remove suppressions');
  }
  const suppression = await repo.findSuppression(id, suppressionId);
  if (!suppression) throw new ApiError(404, 'not_found', 'Suppression not found');
  await repo.destroySuppression(suppression);
}

module.exports = {
  listAccounts,
  getAccount,
  listSendableDomains,
  createAccount,
  updateAccount,
  rotatePassword,
  deleteAccount,
  listSuppressions,
  removeSuppression,
};
