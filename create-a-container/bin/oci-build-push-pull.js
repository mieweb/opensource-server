#!/usr/bin/env node
/**
 * Bin wrapper for oci-build-push-pull.js
 * 
 * This wrapper allows the job to be called from ScheduledJobs via a simple
 * command path relative to the repository root.
 */

const { run } = require('../utils/oci-build-push-pull');

run();
