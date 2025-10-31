#!/usr/bin/env node
// api/proxmox_upload.js
const path = require('path');
const fs = require('fs');
const { getNodes, getStorages, uploadTemplate, chooseDefaultStorage } = require('./proxmox_utils');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && argv[i + 1]) {
      out.file = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs();
  if (!args.file) {
    console.error('Error: --file is required');
    process.exit(1);
  }

  const filepath = args.file;
  if (!fs.existsSync(filepath)) {
    console.error(`Error: file not found: ${filepath}`);
    process.exit(1);
  }

  console.log(`Starting template upload for: ${filepath}`);

  try {
    const nodes = await getNodes();
    if (!nodes || !nodes.length) {
      console.error('Error: No Proxmox nodes found.');
      process.exit(1);
    }

    console.log(`Found nodes: ${nodes.join(', ')}`);

    for (const node of nodes) {
      console.log(`--- Processing Node: ${node} ---`);
      const storagesList = await getStorages(node);
      const storage = chooseDefaultStorage(storagesList);
      if (!storage) {
        console.warn(`Warning: No suitable storage found on node ${node}. Skipping.`);
        continue;
      }

      console.log(`Uploading to ${node}:${storage}...`);
      try {
        const result = await uploadTemplate(node, storage, filepath);
        console.log(`Successfully uploaded to ${node}:${storage}. Task: ${JSON.stringify(result.data || result)}`);
      } catch (e) {
        console.error(`Error uploading to ${node}:${storage}: ${e.message || e}`);
      }
    }
  } catch (e) {
    console.error(`An unexpected error occurred: ${e.message || e}`);
    process.exit(1);
  }

  console.log('Template upload process finished.');
}

if (require.main === module) {
  main();
}
