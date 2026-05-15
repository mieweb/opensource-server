const nodemailer = require('nodemailer');
const { Setting } = require('../models');

/**
 * Parse SMTP URL and create nodemailer transport
 * Format: smtp[s]://[[username][:password]@]<host>[:port]
 */
async function createTransport() {
  const settings = await Setting.getMultiple(['smtp_url', 'smtp_noreply_address']);
  const smtpUrl = settings.smtp_url;
  
  if (!smtpUrl || smtpUrl.trim() === '') {
    throw new Error('SMTP URL is not configured');
  }
  
  try {
    const url = new URL(smtpUrl);
    
    const isSecure = url.protocol === 'smtps:';
    const host = url.hostname;
    const port = url.port || (isSecure ? 465 : 587);
    const auth = url.username ? {
      user: decodeURIComponent(url.username),
      pass: decodeURIComponent(url.password || '')
    } : undefined;
    
    return nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: isSecure,
      auth
    });
  } catch (error) {
    throw new Error(`Invalid SMTP URL format: ${error.message}`);
  }
}

/**
 * Send password reset email
 * @param {string} to - Recipient email address
 * @param {string} username - Username for display
 * @param {string} resetUrl - Full URL for password reset
 */
async function sendPasswordResetEmail(to, username, resetUrl) {
  const settings = await Setting.getMultiple(['smtp_noreply_address']);
  const from = settings.smtp_noreply_address;
  if (!from || from.trim() === '') {
    throw new Error('SMTP no-reply address is not configured');
  }

  const transporter = await createTransport();
  
  const mailOptions = {
    from,
    to,
    subject: 'Password Reset Request',
    text: `Hello ${username},

You have requested to reset your password for the MIE Container Creation system.

Please click the following link to reset your password:
${resetUrl}

This link will expire in 1 hour.

If you did not request this password reset, please ignore this email.

---
Medical Informatics Engineering`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Password Reset Request</h2>
        <p>Hello <strong>${username}</strong>,</p>
        <p>You have requested to reset your password for the MIE Container Creation system.</p>
        <p>Please click the button below to reset your password:</p>
        <div style="margin: 30px 0;">
          <a href="${resetUrl}" 
             style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666; font-size: 14px;">
          ${resetUrl}
        </p>
        <p style="color: #999; font-size: 12px;">This link will expire in 1 hour.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">
          If you did not request this password reset, please ignore this email.
        </p>
        <p style="color: #333; font-size: 14px;">
          <strong>Medical Informatics Engineering</strong>
        </p>
      </div>
    `
  };
  
  await transporter.sendMail(mailOptions);
}

/**
 * Send invite email to a new user
 * @param {string} to - Recipient email address
 * @param {string} inviteUrl - Full URL for registration with invite token
 */
async function sendInviteEmail(to, inviteUrl) {
  const settings = await Setting.getMultiple(['smtp_noreply_address']);
  const from = settings.smtp_noreply_address;
  if (!from || from.trim() === '') {
    throw new Error('SMTP no-reply address is not configured');
  }

  const transporter = await createTransport();
  
  const mailOptions = {
    from,
    to,
    subject: 'You\'re Invited to Join MIE Container Creation',
    text: `Hello,

You have been invited to create an account on the MIE Container Creation system.

Please click the following link to register your account:
${inviteUrl}

This link will expire in 24 hours.

If you did not expect this invitation, please ignore this email.

---
Medical Informatics Engineering`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">You're Invited!</h2>
        <p>Hello,</p>
        <p>You have been invited to create an account on the MIE Container Creation system.</p>
        <p>Please click the button below to register your account:</p>
        <div style="margin: 30px 0;">
          <a href="${inviteUrl}" 
             style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Create Your Account
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666; font-size: 14px;">
          ${inviteUrl}
        </p>
        <p style="color: #999; font-size: 12px;">This link will expire in 24 hours.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">
          If you did not expect this invitation, please ignore this email.
        </p>
        <p style="color: #333; font-size: 14px;">
          <strong>Medical Informatics Engineering</strong>
        </p>
      </div>
    `
  };
  
  await transporter.sendMail(mailOptions);
}

/**
 * Escape HTML special characters to prevent injection in email HTML body
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send a bulk email to multiple recipients (one message per recipient).
 * Returns { sent, failed } where failed is an array of { to, error }.
 *
 * @param {string[]} recipients - List of recipient email addresses
 * @param {string} subject - Email subject
 * @param {string} message - Plain-text message body
 */
async function sendBulkEmail(recipients, subject, message) {
  const settings = await Setting.getMultiple(['smtp_noreply_address']);
  const from = settings.smtp_noreply_address;
  if (!from || from.trim() === '') {
    throw new Error('SMTP no-reply address is not configured');
  }

  const transporter = await createTransport();

  // Convert plain-text body to safe HTML (preserve line breaks)
  const htmlBody = escapeHtml(message).replace(/\r?\n/g, '<br>');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="color: #333; font-size: 14px; line-height: 1.5;">${htmlBody}</div>
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #333; font-size: 14px;">
        <strong>Medical Informatics Engineering</strong>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to: from,
    bcc: recipients.join('; '),
    subject,
    text: message,
    html
  });

  return { sent: recipients, failed: [] };
}

module.exports = {
  createTransport,
  sendPasswordResetEmail,
  sendInviteEmail,
  sendBulkEmail
};
