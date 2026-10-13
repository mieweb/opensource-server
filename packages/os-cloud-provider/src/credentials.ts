/**
 * Machine-local login cache: `~/.mieweb/os.json`, keyed by instance URL so a
 * user can be logged into os.mieweb.org and a self-hosted instance at once
 * (mirrors wrangler's `~/.wrangler` cache). Written 0600 in a 0700 directory.
 *
 * `MIEWEB_OS_CREDENTIALS` (from the provider env) overrides the file path.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderEnv } from '@mieweb/deploy-contract';
import { updateFile } from './json-file.ts';

export interface StoredCredential {
  token: string;
  /** API key id, so `logout` can revoke it server-side. */
  apiKeyId: string;
  user?: string;
  savedAt: string;
}

interface CredentialFile {
  version: 1;
  instances: Record<string, StoredCredential>;
}

function credentialsPath(env: ProviderEnv): string {
  const override = env.MIEWEB_OS_CREDENTIALS?.trim();
  return override ? override : join(env.HOME?.trim() || homedir(), '.mieweb', 'os.json');
}

function parse(path: string, text: string | null): CredentialFile {
  if (text === null) return { version: 1, instances: {} };
  try {
    return { version: 1, instances: { ...((JSON.parse(text) as Partial<CredentialFile>).instances ?? {}) } };
  } catch {
    throw new Error(`Credential cache ${path} is not valid JSON; delete it and run \`mieweb login\` again`);
  }
}

export async function readCredential(env: ProviderEnv, instanceUrl: string): Promise<StoredCredential | null> {
  const path = credentialsPath(env);
  try {
    return parse(path, await readFile(path, 'utf8')).instances[instanceUrl] ?? null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Set (or with `cred` null, remove) the instance's login. Returns the
 * credential it replaced, so its key can be revoked.
 */
export async function writeCredential(
  env: ProviderEnv,
  instanceUrl: string,
  cred: StoredCredential | null,
): Promise<StoredCredential | null> {
  const path = credentialsPath(env);
  let previous: StoredCredential | null = null;
  await updateFile(path, (text) => {
    const data = parse(path, text);
    previous = data.instances[instanceUrl] ?? null;
    if (cred) data.instances[instanceUrl] = cred;
    else if (previous) delete data.instances[instanceUrl];
    else return null;
    return `${JSON.stringify(data, null, 2)}\n`;
  });
  return previous;
}
