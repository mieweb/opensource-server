/**
 * Helper to detect API bearer requests
 * @param {Object} req - Express request object
 * @returns {boolean} - True if this is an API request
 */
function isApiRequest(req) {
  const accept = (req.get('accept') || '').toLowerCase();
  return accept.includes('application/json') || accept.includes('application/vnd.api+json');
}

module.exports = {
  isApiRequest
};
