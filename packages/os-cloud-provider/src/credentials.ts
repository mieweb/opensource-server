/**
 * Machine-local login cache: `~/.mieweb/os.json`, keyed by instance URL so a
 * user can be logged into os.mieweb.org and a self-hosted instance at once
 * (mirrors wrangler's `~/.wrangler` cache). Written 0600 in a 0700 directory.
 *
 * `MIEWEB_OS_CREDENTIALS` (from the provider env) overrides the file path.
 */

import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProviderEnv } from '@mieweb/deploy-contract';

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

export function credentialsPath(env: ProviderEnv): string {
  const override = env.MIEWEB_OS_CREDENTIALS?.trim();
  return override ? override : join(env.HOME?.trim() || homedir(), '.mieweb', 'os.json');
}

async function load(path: string): Promise<CredentialFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, instances: {} };
    throw err;
  }
  try {
    const parsed = JSON.parse(text) as Partial<CredentialFile>;
    return { version: 1, instances: { ...(parsed.instances ?? {}) } };
  } catch {
    throw new Error(`Credential cache ${path} is not valid JSON; delete it and run \`mieweb login\` again`);
  }
}

async function save(path: string, data: CredentialFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export async function readCredential(env: ProviderEnv, instanceUrl: string): Promise<StoredCredential | null> {
  const data = await load(credentialsPath(env));
  return data.instances[instanceUrl] ?? null;
}

export async function writeCredential(env: ProviderEnv, instanceUrl: string, cred: StoredCredential): Promise<void> {
  const path = credentialsPath(env);
  const data = await load(path);
  data.instances[instanceUrl] = cred;
  await save(path, data);
}

export async function deleteCredential(env: ProviderEnv, instanceUrl: string): Promise<boolean> {
  const path = credentialsPath(env);
  const data = await load(path);
  if (!(instanceUrl in data.instances)) return false;
  delete data.instances[instanceUrl];
  await save(path, data);
  return true;
}
