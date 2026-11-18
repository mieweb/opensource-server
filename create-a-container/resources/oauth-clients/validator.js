const { z } = require('zod');

const createOAuthClient = z.object({
  name: z.string().trim().min(1).max(255),
});

const listQuery = z.object({
  // `?all=true` — admins list every user's clients instead of just their own.
  all: z.literal('true').optional(),
});

// The client id (mcp_ + URL-safe random characters).
const idParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

module.exports = { createOAuthClient, listQuery, idParam };
