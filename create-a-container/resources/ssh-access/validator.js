const { z } = require('zod');
const { Container } = require('../../models');

// Login name presented by sshd. POSIX-ish; the same rule the model enforces
// before a name can reach a shell or config file. Reuses Container.USERNAME_RE
// as the single source of truth so the API and the container agree.
const usernameParam = z.object({
  username: z
    .string()
    .regex(Container.USERNAME_RE, 'Invalid username'),
});

// Container id from the URL. Coerce so "/:id" (a string) parses, and reject
// non-positive integers before any lookup.
const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

// Site + container ids for the /sites-scoped mint route.
const siteContainerParams = z.object({
  siteId: z.coerce.number().int().positive(),
  id: z.coerce.number().int().positive(),
});

module.exports = { usernameParam, idParam, siteContainerParams };
