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
import { updateLockedFile } from './locked-file.ts';

export interface StoredCredential {
  token: string;
  /** API key id, so `logout` can revoke it server-side. */
  apiKeyId: string;
  user?: string;
  savedAt: string;
}

/** A key that is no longer used but couldn't be revoked yet. */
export interface PendingRevocation {
  token: string;
  apiKeyId: string;
  /**
   * Set while a login that just minted this key is still validating/storing
   * it (epoch ms). Other logins/logouts leave it alone until then, so they
   * can't revoke a key its owner is about to commit; after it passes (the
   * login crashed or was killed) anyone may revoke it.
   */
  provisionalUntil?: number;
}

interface CredentialFile {
  version: 1;
  instances: Record<string, StoredCredential>;
  /** Per instance: keys whose server-side revocation failed, retried by login/logout. */
  pendingRevocations: Record<string, PendingRevocation[]>;
}

export function credentialsPath(env: ProviderEnv): string {
  const override = env.MIEWEB_OS_CREDENTIALS?.trim();
  return override ? override : join(env.HOME?.trim() || homedir(), '.mieweb', 'os.json');
}

function parse(path: string, text: string | null): CredentialFile {
  if (text === null) return { version: 1, instances: {}, pendingRevocations: {} };
  try {
    const parsed = JSON.parse(text) as Partial<CredentialFile>;
    return {
      version: 1,
      instances: { ...(parsed.instances ?? {}) },
      pendingRevocations: { ...(parsed.pendingRevocations ?? {}) },
    };
  } catch {
    throw new Error(`Credential cache ${path} is not valid JSON; delete it and run \`mieweb login\` again`);
  }
}

async function load(path: string): Promise<CredentialFile> {
  try {
    return parse(path, await readFile(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return parse(path, null);
    throw err;
  }
}

/**
 * Change the cache under a cross-process lock, re-reading it first, so
 * concurrent logins/logouts (e.g. to two instances) never drop each other's
 * entries. `change` returns false to leave the file untouched.
 */
async function mutate(env: ProviderEnv, change: (data: CredentialFile) => boolean): Promise<void> {
  const path = credentialsPath(env);
  await updateLockedFile(path, (text) => {
    const data = parse(path, text);
    return change(data) ? `${JSON.stringify(data, null, 2)}\n` : null;
  });
}

export async function readCredential(env: ProviderEnv, instanceUrl: string): Promise<StoredCredential | null> {
  const data = await load(credentialsPath(env));
  return data.instances[instanceUrl] ?? null;
}

/**
 * Store `cred` as the instance's login, queueing the key it replaces for
 * revocation in the same locked update, so no concurrent login can make a
 * replaced key untracked.
 */
function queue(data: CredentialFile, instanceUrl: string, key: PendingRevocation): void {
  const list = data.pendingRevocations[instanceUrl] ?? [];
  if (!list.some((p) => p.apiKeyId === key.apiKeyId)) {
    const entry: PendingRevocation = { token: key.token, apiKeyId: key.apiKeyId };
    if (key.provisionalUntil !== undefined) entry.provisionalUntil = key.provisionalUntil;
    data.pendingRevocations[instanceUrl] = [...list, entry];
  }
}

/**
 * Queue a key for revocation. `login` queues a freshly minted key first, so a
 * failure before it is stored as the login can never leave it untracked.
 */
export async function addPendingRevocation(env: ProviderEnv, instanceUrl: string, key: PendingRevocation): Promise<void> {
  await mutate(env, (data) => {
    queue(data, instanceUrl, key);
    return true;
  });
}

/**
 * Store `cred` as the instance's login in one locked update: the key it
 * replaces is queued for revocation, and `cred`'s own key is taken off the
 * queue (it was queued as a safety net until it was stored).
 */
export async function replaceCredential(env: ProviderEnv, instanceUrl: string, cred: StoredCredential): Promise<void> {
  await mutate(env, (data) => {
    const previous = data.instances[instanceUrl];
    if (previous && previous.apiKeyId !== cred.apiKeyId) queue(data, instanceUrl, previous);
    const rest = (data.pendingRevocations[instanceUrl] ?? []).filter((p) => p.apiKeyId !== cred.apiKeyId);
    if (rest.length > 0) data.pendingRevocations[instanceUrl] = rest;
    else delete data.pendingRevocations[instanceUrl];
    data.instances[instanceUrl] = cred;
    return true;
  });
}

/** Remove the instance's login, queueing its key for revocation in the same locked update. */
export async function removeCredential(env: ProviderEnv, instanceUrl: string): Promise<boolean> {
  let had = false;
  await mutate(env, (data) => {
    const cred = data.instances[instanceUrl];
    if (!cred) return false;
    had = true;
    queue(data, instanceUrl, cred);
    delete data.instances[instanceUrl];
    return true;
  });
  return had;
}

export async function readPendingRevocations(env: ProviderEnv, instanceUrl: string): Promise<PendingRevocation[]> {
  return (await load(credentialsPath(env))).pendingRevocations[instanceUrl] ?? [];
}

/** Drop keys from the queue once the Manager confirmed they're revoked. */
export async function removePendingRevocations(env: ProviderEnv, instanceUrl: string, apiKeyIds: readonly string[]): Promise<void> {
  if (apiKeyIds.length === 0) return;
  await mutate(env, (data) => {
    const list = data.pendingRevocations[instanceUrl] ?? [];
    const rest = list.filter((p) => !apiKeyIds.includes(p.apiKeyId));
    if (rest.length === list.length) return false;
    if (rest.length > 0) data.pendingRevocations[instanceUrl] = rest;
    else delete data.pendingRevocations[instanceUrl];
    return true;
  });
}
