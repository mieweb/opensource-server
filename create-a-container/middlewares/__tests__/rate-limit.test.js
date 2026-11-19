const express = require('express');
const request = require('supertest');
const { rateLimit } = require('../rate-limit');

function appWith(limiter) {
  const app = express();
  app.set('trust proxy', 1);
  app.post('/x', limiter, (_req, res) => res.status(204).end());
  return app;
}

describe('rateLimit', () => {
  test('allows `max` requests per IP per window, then 429 with Retry-After', async () => {
    const app = appWith(rateLimit({ windowMs: 60_000, max: 2 }));
    const ip = ['X-Forwarded-For', '198.51.100.1'];
    expect((await request(app).post('/x').set(...ip)).status).toBe(204);
    expect((await request(app).post('/x').set(...ip)).status).toBe(204);
    const limited = await request(app).post('/x').set(...ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await request(app).post('/x').set('X-Forwarded-For', '198.51.100.2')).status).toBe(204);
  });

  test('custom onLimit renders the rejection', async () => {
    const app = appWith(rateLimit({ windowMs: 60_000, max: 0, onLimit: (_q, res) => res.status(429).json({ error: 'slow' }) }));
    const res = await request(app).post('/x');
    expect(res.body).toEqual({ error: 'slow' });
  });
});
