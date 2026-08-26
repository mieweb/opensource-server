const { z } = require('zod');

// Service ids are integer PKs; coerce because path params arrive as strings.
const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

module.exports = { idParam };
