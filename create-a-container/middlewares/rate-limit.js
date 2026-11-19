/**
 * Fixed-window, per-client-IP rate limiter for unauthenticated endpoints
 * (OAuth registration/token). In memory: the manager is a single Node
 * process, and a restart resetting the windows is harmless.
 *
 * The client IP is `req.ip`, which honors `trust proxy` (X-Forwarded-For from
 * nginx).
 */

const { LRUCache } = require('lru-cache');

/**
 * @param {object} opts
 * @param {number} opts.windowMs  Window length.
 * @param {number} opts.max       Requests allowed per IP per window.
 * @param {(req, res, retryAfterSec: number) => void} [opts.onLimit]
 *   Sends the rejection; defaults to a bare 429 with the JSON v1 envelope.
 * @returns {import('express').RequestHandler}
 */
function rateLimit({ windowMs, max, onLimit }) {
  const hits = new LRUCache({ max: 50_000, ttl: windowMs });

  return function rateLimiter(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry) {
      entry = { count: 0, resetAt: now + windowMs };
      // The window is fixed from the first hit (get() doesn't refresh the TTL).
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count <= max) return next();

    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.set('Retry-After', String(retryAfterSec));
    if (onLimit) return onLimit(req, res, retryAfterSec);
    return res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests' } });
  };
}

module.exports = { rateLimit };
