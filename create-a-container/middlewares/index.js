// Authentication middleware (single) ---
// Detect API requests and browser requests. API requests return 401 JSON, browser requests redirect to /login.
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  // Heuristics to detect API requests:
  // - X-Requested-With: XMLHttpRequest (old-style AJAX)
  // - Accept header prefers JSON (application/json)
  // - URL path starts with /api/
  const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  const isApiPath = req.path && req.path.startsWith('/api/');

  if (acceptsJSON || isAjax || isApiPath) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Otherwise treat as a browser route: include the original URL as a redirect parameter
  const original = req.originalUrl || req.url || '/';
  const redirectTo = '/login?redirect=' + encodeURIComponent(original);
  return res.redirect(redirectTo);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();

  const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  const isApiPath = req.path && req.path.startsWith('/api/');

  if (acceptsJSON || isAjax || isApiPath) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  return res.status(403).send('Forbidden: Admin access required');
}

module.exports = { requireAuth, requireAdmin };
