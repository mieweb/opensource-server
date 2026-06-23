'use strict';

/**
 * Local development environment seeder.
 *
 * Provisions the minimum data needed to use the Manager locally WITHOUT a real
 * Proxmox cluster. Run automatically by `make dev` (via `npm run db:migrate`,
 * which calls `sequelize-cli db:seed:all`) and safe to run by hand with
 * `npx sequelize-cli db:seed:all`.
 *
 * It creates, idempotently:
 *   - a `localhost` Site,
 *   - a `local-dummy` Node (nodeType: 'dummy') that acts as a mock hypervisor,
 *     and
 *   - a `localhost` ExternalDomain (so image templates that expose an HTTP port,
 *     which auto-add an HTTP service, have a domain to bind to — otherwise the
 *     new-container form is unsubmittable).
 *
 * IMPORTANT: This is deliberately NOT wired into the `/auth/dev` login route.
 * Doing so previously clobbered the Docker Compose bootstrap, which calls
 * `POST /auth/dev` before creating its own "Development" site — stealing site
 * id 1 and importing real nodes/containers into the wrong site.
 *
 * To stay clear of that path entirely, this seeder is a NO-OP if ANY Site
 * already exists. The Docker stack always creates its own site, so running this
 * there does nothing. It only ever populates a fresh, empty local database.
 *
 * It is also a NO-OP when NODE_ENV === 'production' — this is development-only
 * data and must never seed a production database.
 */

const DUMMY_NODE_NAME = 'local-dummy';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    if (process.env.NODE_ENV === 'production') {
      console.log('seed dev-environment: NODE_ENV=production — skipping (dev-only data).');
      return;
    }

    // No-op if any site exists — never interfere with an existing environment
    // (e.g. the Docker Compose "Development" site).
    const [siteRows] = await queryInterface.sequelize.query('SELECT COUNT(*) AS count FROM "Sites"');
    const existingSiteCount = Number(siteRows[0].count);
    if (existingSiteCount > 0) {
      console.log(
        `seed dev-environment: ${existingSiteCount} site(s) already present — nothing to do.`,
      );
      return;
    }

    console.log('seed dev-environment: empty database detected, provisioning local dev environment...');

    const now = new Date();

    await queryInterface.bulkInsert('Sites', [{
      name: 'localhost',
      internalDomain: 'localhost',
      dhcpRange: '10.0.0.100,10.0.0.250',
      subnetMask: '255.255.255.0',
      gateway: '10.0.0.1',
      dnsForwarders: '1.1.1.1,8.8.8.8',
      externalIp: '127.0.0.1',
      createdAt: now,
      updatedAt: now,
    }]);

    // Fetch the id of the site just created so the node/domain can reference it.
    const [createdSiteRows] = await queryInterface.sequelize.query(
      `SELECT id FROM "Sites" WHERE name = 'localhost' ORDER BY id ASC LIMIT 1`,
    );
    const siteId = createdSiteRows[0].id;
    console.log(`  • Site "localhost" created (id=${siteId})`);

    await queryInterface.bulkInsert('Nodes', [{
      name: DUMMY_NODE_NAME,
      nodeType: 'dummy',
      siteId,
      ipv4Address: '127.0.0.1',
      // Placeholder credentials: a dummy node never talks to a real hypervisor,
      // but these must be non-null so code that gates on "has API credentials"
      // (e.g. the live container-status resolver) routes through node.api() and
      // gets the DummyApi instead of treating the node as unreachable.
      apiUrl: 'local',
      tokenId: 'local',
      secret: 'local',
      nvidiaAvailable: false,
      createdAt: now,
      updatedAt: now,
    }]);
    console.log(`  • Dummy Node "${DUMMY_NODE_NAME}" created (nodeType=dummy)`);

    await queryInterface.bulkInsert('ExternalDomains', [{
      name: 'localhost',
      siteId,
      createdAt: now,
      updatedAt: now,
    }]);
    console.log('  • ExternalDomain "localhost" created');

    console.log('seed dev-environment: done. The Manager can now create containers locally (simulated).');
  },

  async down(queryInterface) {
    // Remove only the specific local-dev records this seeder creates.
    await queryInterface.bulkDelete('Nodes', { name: DUMMY_NODE_NAME }, {});
    await queryInterface.bulkDelete('ExternalDomains', { name: 'localhost' }, {});
    await queryInterface.bulkDelete('Sites', { name: 'localhost' }, {});
  }
};
