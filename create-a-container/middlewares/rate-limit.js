/**
 * Minimal in-memory fixed-window per-IP rate limiter. Good enough for the
 * public unsubscribe endpoint (single-process deployment); swap for a
 * store-backed limiter if the manager ever runs multi-process.
 */

/**
 * @param {object} options
 * @param {number} options.windowMs - window length
 * @param {number} options.max - allowed requests per window per IP
 */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    // Opportunistic pruning keeps the map bounded without a timer.
    if (hits.size > 10000) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k);
      }
    }
    const key = req.ip || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests' } });
    }
    return next();
  };
}

module.exports = { rateLimit };
