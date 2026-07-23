const { z } = require('zod');
const { validate } = require('../validate');
const { ApiError } = require('../api');

function run(mw, req) {
  return new Promise((resolve) => mw(req, {}, resolve));
}

describe('validate middleware', () => {
  const bodySchema = z.object({
    name: z.string().trim().min(1),
    count: z.coerce.number().int().optional(),
  });

  test('bare schema validates req.body and stores parsed data', async () => {
    const req = { body: { name: '  widget  ', count: '3' } };
    const err = await run(validate(bodySchema), req);
    expect(err).toBeUndefined();
    expect(req.validated.body).toEqual({ name: 'widget', count: 3 });
  });

  test('invalid body produces ApiError 400 with per-field messages', async () => {
    const req = { body: { name: '' } };
    const err = await run(validate(bodySchema), req);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('invalid_request');
    expect(err.fields).toHaveProperty('name');
  });

  test('missing body is treated as {} (optional-only schemas pass)', async () => {
    const req = {};
    const err = await run(validate(z.object({ note: z.string().optional() })), req);
    expect(err).toBeUndefined();
    expect(req.validated.body).toEqual({});
  });

  test('map form validates multiple request parts independently', async () => {
    const mw = validate({
      params: z.object({ id: z.coerce.number().int().positive() }),
      body: z.object({ name: z.string() }),
    });
    const req = { params: { id: '42' }, body: { name: 'x' } };
    const err = await run(mw, req);
    expect(err).toBeUndefined();
    expect(req.validated).toEqual({ params: { id: 42 }, body: { name: 'x' } });
  });

  test('map form reports the failing part', async () => {
    const mw = validate({ params: z.object({ id: z.coerce.number().int() }) });
    const err = await run(mw, { params: { id: 'nope' } });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.fields).toHaveProperty('id');
  });

  test('nested field paths are dotted in the fields map', async () => {
    const mw = validate(z.object({ svc: z.object({ port: z.number() }) }));
    const err = await run(mw, { body: { svc: { port: 'http' } } });
    expect(err.fields).toHaveProperty(['svc.port']);
  });

  test('rejects unknown request parts at construction time', () => {
    expect(() => validate({ cookies: z.object({}) })).toThrow(/unknown request part/);
  });

  test('rejects non-schema values at construction time', () => {
    expect(() => validate({ body: { not: 'a schema' } })).toThrow(/not a zod schema/);
  });
});
