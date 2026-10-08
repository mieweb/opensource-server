const { z } = require('zod');

// Conservative RFC 5321 dot-atom subset; stored lowercase.
const localPart = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/, 'invalid local part');

const createMailAccount = z.object({
  externalDomainId: z.coerce.number().int().positive(),
  localPart,
  description: z.string().max(255).nullish(),
  // Admin-only (service enforces); non-admins get the default quota.
  quotaMb: z.coerce.number().int().min(1).max(1048576).optional(),
});

const updateMailAccount = z.object({
  description: z.string().max(255).nullable().optional(),
  enabled: z.boolean().optional(),
  unsubscribeHeaders: z.boolean().optional(),
  // Admin-only (service enforces).
  quotaMb: z.coerce.number().int().min(1).max(1048576).optional(),
  // Admin-only ownership transfer — target user's uid (username).
  username: z.string().trim().min(1).max(255).optional(),
});

const idParam = z.object({
  id: z.uuid(),
});

const suppressionParams = z.object({
  id: z.uuid(),
  suppressionId: z.coerce.number().int().positive(),
});

const listQuery = z.object({
  // `?all=true` — admins list every account instead of just their own.
  all: z.literal('true').optional(),
});

module.exports = { createMailAccount, updateMailAccount, idParam, suppressionParams, listQuery };
