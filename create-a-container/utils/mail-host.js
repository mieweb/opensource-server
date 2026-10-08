/**
 * The mail-host claim (issue #67): at most one agent runs the mail stack.
 *
 * The claim is granted to the first agent that checks in with the `mail`
 * service group enabled and everything installed. Postgres/SQLite enforce
 * single-holder with a partial unique index; the transaction here serializes
 * the race on MySQL/MariaDB too. Mailboxes are local Maildir (Dovecot 2.4 CE
 * has no director/replicator), hence one host at a time.
 */

const { Op } = require('sequelize');
const { sequelize, Agent, Site, Setting } = require('../models');

const MAIL_SERVICE = 'mail';

/** The agent currently holding the mail-host claim (with its site), or null. */
async function getMailHostAgent() {
  return Agent.findOne({
    where: { mailHostSince: { [Op.ne]: null } },
    include: [{ model: Site, as: 'site', attributes: ['id', 'name', 'externalIp'] }],
  });
}

/**
 * The IP mail is sent from: externalIp of the mail host's site, or of the
 * mail_self_managed_site_id site when no agent holds the claim.
 */
async function getMailIp() {
  const holder = await getMailHostAgent();
  if (holder?.site?.externalIp) return holder.site.externalIp;
  const selfManagedSiteId = parseInt(await Setting.get('mail_self_managed_site_id'), 10);
  if (Number.isInteger(selfManagedSiteId)) {
    const site = await Site.findByPk(selfManagedSiteId, { attributes: ['externalIp'] });
    return site?.externalIp || null;
  }
  return null;
}

/**
 * Process an agent's mail claim at check-in.
 *
 * @param {object} agent - the checking-in Agent row
 * @param {object} p
 * @param {boolean} p.wantsMail - agent reports `mail` in enabledServices
 * @param {string[]} p.missingBinaries - as reported by the agent
 * @returns {Promise<{status: string, missing?: string[]}>}
 *   status: holder | conflict | unsupported | missing_packages | disabled
 */
async function processMailClaim(agent, { wantsMail, missingBinaries }) {
  if (!wantsMail) {
    // Turning `mail` off releases the claim; the agent stops/disables the
    // units and leaves configs and /var/vmail in place.
    if (agent.mailHostSince) await agent.update({ mailHostSince: null });
    return { status: 'disabled' };
  }
  if (sequelize.getDialect() === 'sqlite') {
    return { status: 'unsupported' };
  }
  if (Array.isArray(missingBinaries) && missingBinaries.length > 0) {
    return { status: 'missing_packages', missing: missingBinaries };
  }
  return sequelize.transaction(async (transaction) => {
    const holder = await Agent.findOne({
      where: { mailHostSince: { [Op.ne]: null } },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!holder) {
      await agent.update({ mailHostSince: new Date() }, { transaction });
      return { status: 'holder' };
    }
    if (holder.id === agent.id) return { status: 'holder' };
    return { status: 'conflict' };
  });
}

/** Admin release — the next qualifying check-in takes the claim. */
async function releaseMailHost() {
  const holder = await getMailHostAgent();
  if (holder) await holder.update({ mailHostSince: null });
  return holder;
}

module.exports = {
  MAIL_SERVICE,
  getMailHostAgent,
  getMailIp,
  processMailClaim,
  releaseMailHost,
};
