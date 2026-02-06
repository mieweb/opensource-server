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
  console.log(`[AUTH DEBUG] Authorization header: "${authHeader || 'NONE'}" (length: ${authHeader?.length || 0})`);
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.substring(7);
    console.log(`[AUTH DEBUG] Extracted API key, length: ${apiKey.length}, first 8 chars: ${apiKey.substring(0, 8)}`);
    
    if (apiKey && apiKey.length > 0) {
      const { ApiKey, User } = require('../models');
      const { extractKeyPrefix } = require('../utils/apikey');
      
      const keyPrefix = extractKeyPrefix(apiKey);
      console.log(`[AUTH DEBUG] Key prefix: ${keyPrefix}`);
      
      const apiKeys = await ApiKey.findAll({
        where: { keyPrefix },
        include: [{
          model: User,
          as: 'user',
          include: [{ association: 'groups' }]
        }]
      });

      console.log(`[AUTH DEBUG] Found ${apiKeys.length} API keys with matching prefix`);
      
      if (apiKeys.length === 0) {
        console.log(`[AUTH DEBUG] No API keys found in database with prefix: ${keyPrefix}`);
        console.log(`[AUTH DEBUG] Listing all API key prefixes in database...`);
        const allKeys = await ApiKey.findAll({ attributes: ['keyPrefix', 'description', 'uidNumber'] });
        console.log(`[AUTH DEBUG] All API keys:`, allKeys.map(k => ({ prefix: k.keyPrefix, desc: k.description, uid: k.uidNumber })));
      }

      for (const storedKey of apiKeys) {
        console.log(`[AUTH DEBUG] Validating key for user: ${storedKey.user?.uid || 'NO USER'}`);
        if (!storedKey.user) {
          console.log(`[AUTH DEBUG] API key has no associated user! uidNumber: ${storedKey.uidNumber}`);
          continue;
        }
        
        const isValid = await storedKey.validateKey(apiKey);
        console.log(`[AUTH DEBUG] Key validation result: ${isValid}`);
        
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
          
          console.log(`[AUTH DEBUG] ✓ Authentication successful for user: ${storedKey.user.uid}`);
          return next();
        }
      }
      console.log(`[AUTH DEBUG] ✗ No valid API key matched`);
    } else {
      console.log(`[AUTH DEBUG] API key is empty after extraction!`);
    }
  } else {
    console.log(`[AUTH DEBUG] Authorization header does not start with "Bearer " (case-sensitive, note the space)`);
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

// Localhost-only middleware
// Checks if request is from localhost, accounting for TLS-terminating reverse proxy
function requireLocalhost(req, res, next) {
  const isLocalhost = (ip) => {
    return ip === '127.0.0.1' || 
           ip === '::1' || 
           ip === '::ffff:127.0.0.1' ||
           ip === 'localhost';
  };

  // Get the direct connection IP
  const directIp = req.connection?.remoteAddress || 
                   req.socket?.remoteAddress || 
                   req.ip;

  // Check if direct connection is from localhost
  if (!isLocalhost(directIp)) {
    return res.status(403).send('Forbidden: This endpoint is only accessible from localhost');
  }

  // If X-Real-IP header is present (reverse proxy), verify it's also localhost
  const realIp = req.get('X-Real-IP');
  if (realIp && !isLocalhost(realIp)) {
    return res.status(403).send('Forbidden: This endpoint is only accessible from localhost');
  }

  // Both checks passed
  return next();
}

const { setCurrentSite, loadSites } = require('./currentSite');

module.exports = { 
  requireAuth, 
  requireAdmin, 
  requireLocalhost, 
  setCurrentSite, 
  loadSites 
};
