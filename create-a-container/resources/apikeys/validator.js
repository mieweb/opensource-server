const { z } = require('zod');

// Matches the ApiKeys.description column (STRING(255), nullable). Length is
// enforced here so oversized input fails as a 400 instead of a
// dialect-dependent DB error. nullish (null | undefined) preserves the
// legacy contract: clients may send an explicit JSON null for the optional
// field and it is stored as NULL.
const createApiKey = z.object({
  description: z.string().max(255).nullish(),
});

// API key ids are UUIDv4 primary keys; reject garbage before it reaches the
// database (postgres would otherwise error on an unparsable uuid literal).
const idParam = z.object({
  id: z.uuid(),
});

module.exports = { createApiKey, idParam };
