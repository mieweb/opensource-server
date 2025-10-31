// api/proxmox_utils.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const https = require('https');

const API_URL = process.env.PROXMOX_API_URL;
const TOKEN_ID = process.env.PROXMOX_TOKEN_ID;
const TOKEN_SECRET = process.env.PROXMOX_TOKEN_SECRET;

if (!API_URL || !TOKEN_ID || !TOKEN_SECRET) {
  // Do not throw; allow functions to be imported but fail loudly when used.
  // Console a warning to help debugging.
  console.warn('Warning: PROXMOX_API_URL, PROXMOX_TOKEN_ID or PROXMOX_TOKEN_SECRET is not set. Requests will fail.');
}

const HEADERS = {
  Authorization: `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
};

// Accept self-signed / insecure if needed (mirrors requests verify=true)
const httpsAgent = new https.Agent({ rejectUnauthorized: true });

async function getNodes() {
  const resp = await axios.get(`${API_URL}/nodes`, { headers: HEADERS, httpsAgent });
  const data = resp.data && resp.data.data ? resp.data.data : [];
  return data.map(n => n.node);
}

async function getStorages(node) {
  const resp = await axios.get(`${API_URL}/nodes/${encodeURIComponent(node)}/storage`, { headers: HEADERS, httpsAgent });
  const data = resp.data && resp.data.data ? resp.data.data : [];
  return data.map(s => s.storage);
}

async function uploadTemplate(node, storage, filepath) {
  const basename = path.basename(filepath);
  const form = new FormData();

  // Append file stream
  form.append('content', fs.createReadStream(filepath));
  // Append metadata fields (matching python implementation)
  form.append('content', 'vztmpl');
  form.append('filename', basename);

  const headers = Object.assign({}, HEADERS, form.getHeaders());

  const resp = await axios.post(
    `${API_URL}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/upload`,
    form,
    { headers, httpsAgent, maxContentLength: Infinity, maxBodyLength: Infinity }
  );

  return resp.data;
}

function chooseDefaultStorage(storages) {
  if (!Array.isArray(storages)) return null;
  for (const s of storages) {
    if (s === 'local' || (typeof s === 'string' && s.toLowerCase().includes('local'))) return s;
  }
  return storages.length ? storages[0] : null;
}

module.exports = {
  getNodes,
  getStorages,
  uploadTemplate,
  chooseDefaultStorage,
};
