/**
 * Shared request-validation middleware (see docs/mvc-manifesto.md §4).
 *
 * Usage in a resource router:
 *   const { validate } = require('../../middlewares/validate');
 *   const { createThing } = require('./validator');
 *
 *   router.post('/', validate(createThing), ctrl.create);            // body only
 *   router.put('/:id', validate({ params: idParam, body: schema })); // multiple parts
 *
 * Parsed/coerced values land on req.validated.{body,params,query}. Validation
 * failures become ApiError(400, 'invalid_request') with per-field messages,
 * rendered by jsonErrorHandler using the standard error envelope.
 */

const { ApiError } = require('./api');

function isSchema(value) {
  return value && typeof value.safeParse === 'function';
}

// validate(schema) — treats the schema as the body schema.
// validate({ body?, params?, query? }) — validates each part independently.
function validate(schemas) {
  const map = isSchema(schemas) ? { body: schemas } : schemas;
  for (const [part, schema] of Object.entries(map)) {
    if (!['body', 'params', 'query'].includes(part)) {
      throw new Error(`validate(): unknown request part "${part}"`);
    }
    if (!isSchema(schema)) {
      throw new Error(`validate(): "${part}" is not a zod schema`);
    }
  }

  return (req, _res, next) => {
    const validated = { ...req.validated };
    for (const [part, schema] of Object.entries(map)) {
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        const fields = {};
        for (const issue of result.error.issues) {
          fields[issue.path.join('.') || part] = issue.message;
        }
        return next(new ApiError(400, 'invalid_request', 'Invalid request', fields));
      }
      validated[part] = result.data;
    }
    req.validated = validated;
    return next();
  };
}

module.exports = { validate };
