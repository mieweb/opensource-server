const express = require('express');
const router = express.Router();

function setUserHeaders(res, user, groups) {
  res.set('X-User-ID', String(user.uidNumber));
  res.set('X-Username', user.uid);
  res.set('X-User-First-Name', user.givenName);
  res.set('X-User-Last-Name', user.sn);
  res.set('X-Email', user.mail);
  res.set('X-Groups', groups.map(g => g.cn).join(','));
}

// GET /verify — lightweight auth check for nginx auth_request subrequests.
// Returns 200 with user identity headers if authenticated, 401 otherwise.
router.get('/', async (req, res) => {
  const { ApiKey, User, Group } = require('../models');

  // Check session authentication
  if (req.session && req.session.user) {
    const user = await User.findOne({
      where: { uid: req.session.user },
      include: [{ model: Group, as: 'groups' }]
    });
    if (user) {
      setUserHeaders(res, user, user.groups || []);
      return res.status(200).send();
    }
  }

  // Check Bearer token authentication
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.substring(7);

    if (apiKey) {
      const { extractKeyPrefix } = require('../utils/apikey');

      const keyPrefix = extractKeyPrefix(apiKey);
      const apiKeys = await ApiKey.findAll({
        where: { keyPrefix },
        include: [{
          model: User,
          as: 'user',
          include: [{ model: Group, as: 'groups' }]
        }]
      });

      for (const storedKey of apiKeys) {
        const isValid = await storedKey.validateKey(apiKey);
        if (isValid) {
          storedKey.recordUsage().catch(err => {
            console.error('Failed to update API key last used timestamp:', err);
          });
          if (storedKey.user) {
            setUserHeaders(res, storedKey.user, storedKey.user.groups || []);
          }
          return res.status(200).send();
        }
      }
    }
  }

  return res.status(401).send();
});

module.exports = router;
