#!/usr/bin/env node
/**
 * Test script for docker-registry utilities
 * Usage: node test-docker-registry.js <image-ref>
 * Example: node test-docker-registry.js nginx:alpine
 */

const { parseDockerRef, getImageConfig, extractImageMetadata } = require('../utils/docker-registry');

// Normalize function copied from routers/containers.js
function normalizeDockerRef(ref) {
  if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('git@')) {
    return ref;
  }

  let tag = 'latest';
  let imagePart = ref;
  
  const lastColon = ref.lastIndexOf(':');
  if (lastColon !== -1) {
    const potentialTag = ref.substring(lastColon + 1);
    if (!potentialTag.includes('/')) {
      tag = potentialTag;
      imagePart = ref.substring(0, lastColon);
    }
  }
  
  const parts = imagePart.split('/');
  
  let host = 'docker.io';
  let org = 'library';
  let image;
  
  if (parts.length === 1) {
    image = parts[0];
  } else if (parts.length === 2) {
    if (parts[0].includes('.') || parts[0].includes(':')) {
      host = parts[0];
      image = parts[1];
    } else {
      org = parts[0];
      image = parts[1];
    }
  } else {
    host = parts[0];
    image = parts[parts.length - 1];
    org = parts.slice(1, -1).join('/');
  }
  
  return `${host}/${org}/${image}:${tag}`;
}

async function test(imageRef) {
  try {
    console.log('Testing image:', imageRef);
    console.log('---');
    
    const normalized = normalizeDockerRef(imageRef);
    console.log('Normalized:', normalized);
    
    const parsed = parseDockerRef(normalized);
    console.log('Parsed:', parsed);
    
    const repo = `${parsed.namespace}/${parsed.image}`;
    console.log('Fetching config from registry...');
    
    const config = await getImageConfig(parsed.registry, repo, parsed.tag);
    console.log('✓ Config fetched successfully');
    
    const metadata = extractImageMetadata(config);
    console.log('---');
    console.log('Metadata:');
    console.log(JSON.stringify(metadata, null, 2));
    
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  }
}

const imageRef = process.argv[2] || 'nginx:alpine';
test(imageRef);
