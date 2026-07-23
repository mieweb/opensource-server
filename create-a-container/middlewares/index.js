function isApiRequest(req) {
  const acceptsJSON = req.get('Accept') && req.get('Accept').includes('application/json');
  const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
  const isApiPath = req.path && req.path.startsWith('/api/');
  return acceptsJSON || isAjax || isApiPath;
}

// Authentication middleware (single) ---
// Detect API requests and browser requests. API requests return 401 JSON, browser requests redirect to /login.
// Also accepts API key authentication via Authorization header.
async function requireAuth(req, res, next) {
  // First check session authentication
  if (req.session && req.session.user) return next();
  
  // Try API key authentication
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.substring(7);
    
    if (apiKey) {
      const { ApiKey, User } = require('../models');
      const { extractKeyPrefix } = require('../utils/apikey');
      
      const keyPrefix = extractKeyPrefix(apiKey);
      
      const apiKeys = await ApiKey.findAll({
        where: { keyPrefix },
        include: [{
          model: User,
          as: 'user',
          include: [{ association: 'groups' }]
        }]
      });

      for (const storedKey of apiKeys) {
        const isValid = await storedKey.validateKey(apiKey);
        if (isValid) {
          req.user = storedKey.user;
          req.apiKey = storedKey;
          req.isAdmin = storedKey.user.groups?.some(g => g.isAdmin) || false;
          
          // Populate req.session for compatibility with routes that check req.session.user
          if (!req.session) {
            req.session = {};
          }
          req.session.user = storedKey.user.uid;
          req.session.isAdmin = req.isAdmin;
          
          storedKey.recordUsage().catch(err => {
            console.error('Failed to update API key last used timestamp:', err);
          });
          
          return next();
        }
      }
    }
  }
  
  // Neither session nor API key authentication succeeded
  if (isApiRequest(req))
    return res.status(401).json({ error: 'Unauthorized' });

  // Otherwise treat as a browser route: include the original URL as a redirect parameter
  const original = req.originalUrl || req.url || '/';
  const redirectTo = '/login?redirect=' + encodeURIComponent(original);
  return res.redirect(redirectTo);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (isApiRequest(req))
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  return res.status(403).send('Forbidden: Admin access required');
}

// True when the request comes directly from localhost (and was not proxied
// on behalf of a remote client, per X-Real-IP / X-Forwarded-For).
function isLocalhostRequest(req) {
  const isLocalhost = (ip) => {
    return ip === '127.0.0.1' || 
           ip === '::1' || 
           ip === '::ffff:127.0.0.1' ||
           ip === 'localhost';
  };

  const directIp = req.connection?.remoteAddress || 
                   req.socket?.remoteAddress || 
                   req.ip;

  const realIp = req.get('X-Real-IP');
  // First hop of X-Forwarded-For is the original client (covers proxies that
  // set it without also setting X-Real-IP).
  const forwardedFor = (req.get('X-Forwarded-For') || '').split(',')[0].trim();

  return isLocalhost(directIp)
    && (!realIp || isLocalhost(realIp))
    && (!forwardedFor || isLocalhost(forwardedFor));
}

const { setCurrentSite, loadSites } = require('./currentSite');

module.exports = { 
  isApiRequest,
  isLocalhostRequest,
  requireAuth, 
  requireAdmin, 
  setCurrentSite, 
  loadSites 
};
