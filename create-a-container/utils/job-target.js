/**
 * Jobs that act on a container name it as `--container-id=<id>` in their
 * command (bin/create-container.js, bin/reconfigure-container.js).
 */

const CONTAINER_ID_FLAG = /(?:^|\s)--container-id=(\d+)(?=\s|$)/;

/**
 * The container a job command acts on, or null.
 * @param {string} command
 * @returns {number|null}
 */
function jobContainerId(command) {
  const m = CONTAINER_ID_FLAG.exec(command || '');
  return m ? Number(m[1]) : null;
}

module.exports = { jobContainerId };
