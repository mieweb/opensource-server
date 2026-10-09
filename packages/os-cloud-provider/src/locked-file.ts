/**
 * Read-modify-write of a small machine-local file (the login cache,
 * known_hosts), safe against concurrent `mieweb` processes: a cross-process
 * lock (`proper-lockfile`) around re-reading the current contents, and an
 * atomic replace (`write-file-atomic`) so readers never see a partial file.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';

/**
 * Apply `update` to the file's current contents (null when it doesn't exist)
 * under an exclusive lock. Return null from `update` to leave the file as is.
 */
export async function updateLockedFile(path: string, update: (current: string | null) => string | null): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // realpath: false lets the file not exist yet (the lock is `<path>.lock`).
  const release = await lockfile.lock(path, { realpath: false, stale: 10_000, retries: { retries: 20, minTimeout: 50, maxTimeout: 500 } });
  try {
    let current: string | null = null;
    try {
      current = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const next = update(current);
    if (next !== null && next !== current) await writeFileAtomic(path, next, { mode: 0o600 });
  } finally {
    await release();
  }
}
