const { z } = require('zod');

// Inbound webhook payload (see docs/notification-webhook.md). Mirrors the
// contract in issue #434. Unknown keys are stripped; anything that isn't
// explicitly typed here belongs in `evidence`.
//
// ctid accepts a number or string and is normalised to a string so it lines up
// with Containers.containerId (widened to STRING). ts is epoch seconds; the
// service converts it to eventAt.
const createNotification = z.object({
  source: z.string().min(1).max(255),
  severity: z.enum(['info', 'warning', 'critical']),
  node: z.string().max(255).nullish(),
  ctid: z
    .union([z.number().int(), z.string().max(255)])
    .transform((v) => (v === null || v === undefined ? v : String(v)))
    .nullish(),
  owner: z.string().max(255).nullish(),
  action: z.string().max(255).nullish(),
  message: z.string().min(1).max(4000),
  evidence: z.record(z.string(), z.unknown()).nullish(),
  ts: z.number().int().nonnegative().nullish(),
});

// Notification ids are auto-increment integer PKs. Coerce so "/:id" (a string
// from the URL) parses, and reject non-integers before they reach the DB.
const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

// Listing controls for the bell dropdown. Defaults keep the payload small.
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = { createNotification, idParam, listQuery };
