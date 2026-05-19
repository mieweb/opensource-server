const { spawn, execSync } = require('child_process');
const ProxmoxApi = require('./proxmox-api');

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed: ${cmd} ${args.join(' ')}\nExit code: ${code}\nStderr: ${stderr}`);
        reject(error);
      }
    });
  });
}

/**
 * Get version information from git
 * @returns {Object} Version information with hash, date, and tag
 */
function getVersionInfo() {
  try {
    const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', shell: true }).trim();
    const commitDate = execSync('git log -1 --format=%ad --date=short', { encoding: 'utf8', shell: true }).trim();
    const tag = execSync('git describe --tags --exact-match 2>/dev/null || echo ""', { encoding: 'utf8', shell: true }).trim();
    
    return {
      hash: commitHash,
      date: commitDate,
      tag: tag || null,
      display: tag ? `${tag} (${commitHash})` : commitHash,
      url: `https://github.com/mieweb/opensource-server/commit/${commitHash}`
    };
  } catch (error) {
    console.error('Error getting version info:', error);
    return {
      hash: 'unknown',
      date: new Date().toISOString().split('T')[0],
      tag: null,
      display: 'development',
      url: 'https://github.com/mieweb/opensource-server'
    };
  }
}

/**
 * Helper to validate that a redirect URL is a safe relative path.
 * @param {string} url - the URL to validate
 * @returns {boolean}
 */
function isSafeRelativeUrl(url) {
  if (typeof url !== 'string') return false;
  // It must start with a single slash, not double slash, not backslash and not contain any backslash or encoded backslash, and not be protocol-relative.
  return url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.startsWith('/\\') &&
    !url.includes('\\') &&
    !url.includes('%5C') &&
    !url.includes('%2F%2E%2E%2F'); // basic check against encoded path traversal
}

/**
 * Validate that a redirect URL is safe — either a relative path or an absolute
 * URL whose hostname is a subdomain of (or equal to) one of the allowed domains.
 * Used by the login flow to support cross-domain redirects for auth_request.
 * @param {string} url - the URL to validate
 * @param {string[]} allowedDomains - list of allowed root domains (e.g., ['example.com'])
 * @returns {boolean}
 */
function isSafeRedirectUrl(url, allowedDomains = []) {
  if (typeof url !== 'string') return false;
  if (isSafeRelativeUrl(url)) return true;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

    const hostname = parsed.hostname.toLowerCase();
    return allowedDomains.some(domain => {
      const d = domain.toLowerCase();
      return hostname === d || hostname.endsWith('.' + d);
    });
  } catch {
    return false;
  }
}

/**
 * Convert a Sequelize validation or constraint error into a plain-english
 * message by joining the per-item messages from `err.errors`. Falls back to
 * the error's own `message` for non-Sequelize errors.
 * @param {Error} err
 * @returns {string}
 */
function formatSequelizeError(err) {
  if (!err) return 'Unknown error';
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map(e => e.message).filter(Boolean).join(' ');
  }
  return err.message || 'Unknown error';
}

module.exports = {
  ProxmoxApi,
  run,
  isSafeRelativeUrl,
  isSafeRedirectUrl,
  getVersionInfo,
  formatSequelizeError
};
