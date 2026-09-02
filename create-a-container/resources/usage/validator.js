const { z } = require('zod');

// siteId arrives via the parent /sites/:siteId mount (mergeParams). Coerce
// and reject garbage here so it fails as a 400 instead of reaching the DB.
const siteIdParam = z.object({
  siteId: z.coerce.number().int().positive(),
});

module.exports = { siteIdParam };
