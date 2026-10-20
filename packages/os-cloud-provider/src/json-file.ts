/**
 * Read-modify-write of a small machine-local file (the login cache,
 * known_hosts). Written atomically (`write-file-atomic`) with mode 0600, in a
 * 0700 directory, so readers never see a partial file.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import writeFileAtomic from 'write-file-atomic';

/** Apply `update` to the file's contents (null when missing); return null to leave it as is. */
export async function updateFile(path: string, update: (current: string | null) => string | null): Promise<void> {
  let current: string | null = null;
  try {
    current = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const next = update(current);
  if (next === null || next === current) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFileAtomic(path, next, { mode: 0o600 });
}
