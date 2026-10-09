/**
 * Per-container mutual exclusion inside the Manager process (the Manager is a
 * single Node process, and every job that acts on a container is enqueued by
 * it; the job runner only executes them).
 *
 * DELETE holds a container's lock from its busy-job check until the row is
 * gone, and every path that enqueues a job for an existing container holds it
 * around the insert. So no job can be enqueued between the delete's check and
 * the VM/row removal, and an enqueue that waited for a delete sees the
 * container gone.
 */

const tails = new Map();

/**
 * Run `fn` while holding the lock for `containerId`; calls queue in order.
 * @template T
 * @param {number} containerId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withContainerLock(containerId, fn) {
  const key = Number(containerId);
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

module.exports = { withContainerLock };
