/**
 * /api/v1/users — admin-only CRUD + invite.
 */

const express = require('express');
const { User, Group, InviteToken, Setting } = require('../../../models');
const { sendInviteEmail, sendBulkEmail } = require('../../../utils/email');
const { sendPushNotificationInvite } = require('../../../utils/push-notification-invite');
const { apiAuth, apiAdmin, asyncHandler, ok, created, noContent, ApiError } =
  require('../../../middlewares/api');

const router = express.Router();

router.use(apiAuth, apiAdmin);

function serialize(u) {
  return {
    uidNumber: u.uidNumber,
    uid: u.uid,
    givenName: u.givenName,
    sn: u.sn,
    cn: u.cn,
    mail: u.mail,
    status: u.status,
    groups: u.groups
      ? u.groups.map((g) => ({ gidNumber: g.gidNumber, cn: g.cn, isAdmin: g.isAdmin }))
      : undefined,
    isAdmin: u.groups?.some((g) => g.isAdmin) || false,
  };
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await User.findAll({
      include: [{ association: 'groups', attributes: ['gidNumber', 'cn', 'isAdmin'] }],
      order: [['uidNumber', 'ASC']],
    });
    return ok(res, users.map(serialize));
  }),
);

router.get(
  '/:uidNumber',
  asyncHandler(async (req, res) => {
    const u = await User.findByPk(req.params.uidNumber, {
      include: [{ association: 'groups' }],
    });
    if (!u) throw new ApiError(404, 'not_found', 'User not found');
    return ok(res, serialize(u));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { uid, givenName, sn, mail, userPassword, status, groupIds } = req.body || {};
    if (!uid || !givenName || !sn || !mail || !userPassword) {
      throw new ApiError(400, 'invalid_request', 'uid, givenName, sn, mail, userPassword are required');
    }
    const trimmedGiven = givenName.trim();
    const trimmedSn = sn.trim();
    const user = await User.create({
      uidNumber: await User.nextUidNumber(),
      uid,
      givenName: trimmedGiven,
      sn: trimmedSn,
      cn: `${trimmedGiven} ${trimmedSn}`,
      mail,
      userPassword,
      status: status || 'pending',
      homeDirectory: `/home/${uid}`,
      loginShell: '/bin/bash',
      gidNumber: 2001,
    });
    if (Array.isArray(groupIds) && groupIds.length > 0) {
      const groups = await Group.findAll({ where: { gidNumber: groupIds } });
      await user.setGroups(groups);
    }
    return created(res, serialize(user));
  }),
);

router.put(
  '/:uidNumber',
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.uidNumber);
    if (!user) throw new ApiError(404, 'not_found', 'User not found');
    const { uid, givenName, sn, mail, userPassword, status, groupIds } = req.body || {};
    const trimmedGiven = (givenName || '').trim();
    const trimmedSn = (sn || '').trim();
    const previousStatus = user.status;

    user.uid = uid ?? user.uid;
    user.givenName = trimmedGiven || user.givenName;
    user.sn = trimmedSn || user.sn;
    user.cn = `${user.givenName} ${user.sn}`;
    user.mail = mail ?? user.mail;
    user.status = status || user.status;
    user.homeDirectory = `/home/${user.uid}`;
    if (userPassword && userPassword.trim() !== '') {
      user.userPassword = userPassword;
    }
    await user.save();

    let twoFactorWarning;
    if (previousStatus !== 'active' && user.status === 'active') {
      const inviteResult = await sendPushNotificationInvite(user);
      if (inviteResult && !inviteResult.success) {
        twoFactorWarning = inviteResult.error;
      }
    }
    if (Array.isArray(groupIds)) {
      const groups = await Group.findAll({ where: { gidNumber: groupIds } });
      await user.setGroups(groups);
    }
    return ok(res, { ...serialize(user), ...(twoFactorWarning ? { twoFactorWarning } : {}) });
  }),
);

router.delete(
  '/:uidNumber',
  asyncHandler(async (req, res) => {
    const u = await User.findByPk(req.params.uidNumber);
    if (!u) throw new ApiError(404, 'not_found', 'User not found');
    await u.destroy();
    return noContent(res);
  }),
);

// POST /api/v1/users/invite — send an invitation email
router.post(
  '/invite',
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    if (!email || email.trim() === '') {
      throw new ApiError(400, 'invalid_request', 'email is required');
    }
    const normalized = email.toLowerCase().trim();
    const settings = await Setting.getMultiple(['smtp_url']);
    if (!settings.smtp_url || settings.smtp_url.trim() === '') {
      throw new ApiError(409, 'smtp_not_configured', 'SMTP is not configured');
    }
    const existing = await User.findOne({ where: { mail: normalized } });
    if (existing) throw new ApiError(409, 'duplicate_email', 'A user with this email already exists');

    const { token } = await InviteToken.generateToken(normalized, 24);
    const inviteUrl = `${req.protocol}://${req.get('host')}/register?token=${token}`;
    try {
      await sendInviteEmail(normalized, inviteUrl);
    } catch (err) {
      console.error('Invite email failed:', err);
      throw new ApiError(502, 'email_failed', 'Failed to send invitation email');
    }
    return ok(res, { email: normalized, message: 'Invitation sent' });
  }),
);

// POST /api/v1/users/email-all — broadcast an email to every user with an address
router.post(
  '/email-all',
  asyncHandler(async (req, res) => {
    const { subject, message } = req.body || {};
    if (!subject || subject.trim() === '' || !message || message.trim() === '') {
      throw new ApiError(400, 'invalid_request', 'subject and message are required');
    }

    const settings = await Setting.getMultiple(['smtp_url']);
    if (!settings.smtp_url || settings.smtp_url.trim() === '') {
      throw new ApiError(409, 'smtp_not_configured', 'SMTP is not configured');
    }

    const users = await User.findAll({ attributes: ['mail'] });
    const recipients = [
      ...new Set(
        users
          .map((u) => (u.mail || '').trim().toLowerCase())
          .filter((m) => m.length > 0),
      ),
    ];
    if (recipients.length === 0) {
      throw new ApiError(409, 'no_recipients', 'No users with email addresses');
    }

    const { sent, failed } = await sendBulkEmail(recipients, subject.trim(), message);
    if (failed.length > 0) {
      console.error('Bulk email failures:', failed);
    }
    return ok(res, {
      sent: sent.length,
      failed: failed.length,
      recipients: recipients.length,
    });
  }),
);

module.exports = router;
