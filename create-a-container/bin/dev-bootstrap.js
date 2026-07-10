#!/usr/bin/env node
/**
 * dev-bootstrap.js
 *
 * Provisions the minimum data needed to use the Manager locally WITHOUT a real
 * Proxmox cluster. Intended to be run by `make dev` (and safe to run by hand).
 *
 * It creates, idempotently:
 *   - a `localhost` Site,
 *   - a `dummy` Node (nodeType: 'dummy') that acts as a mock hypervisor, and
 *   - a `localhost` ExternalDomain (so image templates that expose an HTTP port,
 *     which auto-add an HTTP service, have a domain to bind to — otherwise the
 *     new-container form is unsubmittable).
 *
 * IMPORTANT: This is deliberately NOT wired into the `/auth/dev` login route.
 * Doing so previously clobbered the Docker Compose bootstrap, which calls
 * `POST /auth/dev` before creating its own "Development" site — stealing site
 * id 1 and importing real nodes/containers into the wrong site.
 *
 * To stay clear of that path entirely, this script is a NO-OP if ANY Site
 * already exists. The Docker stack always creates its own site, so running this
 * there does nothing. It only ever populates a fresh, empty local database.
 *
 * Refuses to run when NODE_ENV === 'production'.
 *
 * Exit code 0 = success (including the intentional no-op).
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'models'));
const { sequelize, Site, Node, ExternalDomain } = db;

const DUMMY_NODE_NAME = 'local-dummy';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('dev-bootstrap: refusing to run in production');
    process.exit(1);
  }

  await sequelize.authenticate();

  // No-op if any site exists — never interfere with an existing environment
  // (e.g. the Docker Compose "Development" site).
  const existingSiteCount = await Site.count();
  if (existingSiteCount > 0) {
    console.log(
      `dev-bootstrap: ${existingSiteCount} site(s) already present — nothing to do.`,
    );
    return;
  }

  console.log('dev-bootstrap: empty database detected, provisioning local dev environment...');

  const site = await Site.create({
    name: 'localhost',
    internalDomain: 'localhost',
    dhcpRange: '10.0.0.100,10.0.0.250',
    subnetMask: '255.255.255.0',
    gateway: '10.0.0.1',
    dnsForwarders: '1.1.1.1,8.8.8.8',
    externalIp: '127.0.0.1',
  });
  console.log(`  • Site "localhost" created (id=${site.id})`);

  const node = await Node.create({
    name: DUMMY_NODE_NAME,
    nodeType: 'dummy',
    siteId: site.id,
    ipv4Address: '127.0.0.1',
    // Placeholder credentials: a dummy node never talks to a real hypervisor,
    // but these must be non-null so code that gates on "has API credentials"
    // (e.g. the live container-status resolver) routes through node.api() and
    // gets the DummyApi instead of treating the node as unreachable.
    apiUrl: 'local',
    tokenId: 'local',
    secret: 'local',
    nvidiaAvailable: false,
  });
  console.log(`  • Dummy Node "${node.name}" created (id=${node.id}, nodeType=dummy)`);

  const domain = await ExternalDomain.create({
    name: 'localhost',
    siteId: site.id,
  });
  console.log(`  • ExternalDomain "localhost" created (id=${domain.id})`);

  console.log('dev-bootstrap: done. The Manager can now create containers locally (simulated).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('dev-bootstrap failed:', err.message);
    process.exit(1);
  });
