const { spawn, execSync } = require('child_process');
const ProxmoxApi = require('./proxmox-api');
const MockProxmoxApi = require('./mock-proxmox-api');

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

module.exports = {
  ProxmoxApi,
  MockProxmoxApi,
  run,
  isSafeRelativeUrl,
  getVersionInfo
};
