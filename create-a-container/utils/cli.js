/**
 * CLI utility functions for job scripts
 */

/**
 * Parse command line arguments in --key=value format
 * @returns {object} Parsed arguments as key-value pairs
 */
function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

module.exports = {
  parseArgs
};
