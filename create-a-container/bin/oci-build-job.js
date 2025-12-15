#!/usr/bin/env node
// Wrapper to run the oci-build job from the repository bin directory
const path = require('path');
const job = require(path.join(__dirname, '..', 'utils', 'oci-build-job'));

if (require.main === module) {
  job.run().catch(err => {
    console.error('OCI build job failed:', err);
    process.exit(1);
  });
}
module.exports = job;
