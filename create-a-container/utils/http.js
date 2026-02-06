/**
 * Helper to detect if a request is an API request based on headers.
 * Checks if the client accepts JSON.
 * * @param {import('express').Request} req 
 * @returns {boolean}
 */
function isApiRequest(req) {
  const accept = (req.get('accept') || '').toLowerCase();
  return accept.includes('application/json') || accept.includes('application/vnd.api+json');
}

module.exports = {
  isApiRequest
};