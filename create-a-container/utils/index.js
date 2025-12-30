const { spawn } = require('child_process');
const https = require('https');
const ProxmoxApi = require('./proxmox-api');
const { Node, Sequelize } = require('../models');

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
 * Get available Proxmox templates from all configured nodes for a site
 * @param {number} siteId - The site ID to query nodes for
 * @returns {Promise<Array>} - Array of template objects with volid, name, size, node, storage
 */
async function getAvailableProxmoxTemplates(siteId) {
  const templates = [];
  const nodes = await Node.findAll({
    where: {
      [Sequelize.Op.and]: {
        siteId,
        apiUrl: { [Sequelize.Op.ne]: null },
        tokenId: { [Sequelize.Op.ne]: null },
        secret: { [Sequelize.Op.ne]: null }
      }
    },
  });

  for (const node of nodes) {
    const client = new ProxmoxApi(node.apiUrl, node.tokenId, node.secret, {
      httpsAgent: new https.Agent({
        rejectUnauthorized: node.tlsVerify !== false
      })
    });

    const datastores = await client.datastores(node.name, 'vztmpl', true);

    for (const datastore of datastores) {
      const contents = await client.storageContents(node.name, datastore.storage, 'vztmpl');
      
      for (const item of contents) {
        templates.push({
          volid: item.volid,
          name: item.volid.split('/').pop(),
          size: item.size,
          node: node.name,
          storage: datastore.storage
        });
      }
    }
  }

  return templates;
}

module.exports = {
  ProxmoxApi,
  run,
  isSafeRelativeUrl,
  getAvailableProxmoxTemplates
};
