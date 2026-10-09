/**
 * Concurrent updates to the machine-local caches must not drop each other's
 * entries (parallel logins to different instances, parallel deploys pinning
 * different hosts).
 */

import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { readPendingRevocations, removeCredential, replaceCredential } from '../src/credentials.ts';
import { forgetHostKey, pinHostKey } from '../src/ssh.ts';

let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'os-locking-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('parallel logins to different instances all survive', async () => {
  const env = { MIEWEB_OS_CREDENTIALS: join(dir, 'os.json') };
  const urls = Array.from({ length: 12 }, (_, i) => `https://m${i}.example.test`);
  await Promise.all(
    urls.map((u, i) => replaceCredential(env, u, { token: `t${i}`, apiKeyId: `k${i}`, savedAt: 'now' })),
  );
  const data = JSON.parse(await readFile(env.MIEWEB_OS_CREDENTIALS, 'utf8'));
  assert.deepEqual(Object.keys(data.instances).sort(), [...urls].sort());
});

test('a replaced or removed key is queued for revocation in the same update', async () => {
  const env = { MIEWEB_OS_CREDENTIALS: join(dir, 'os2.json') };
  const u = 'https://m.example.test';
  await replaceCredential(env, u, { token: 'a', apiKeyId: 'ka', savedAt: 'now' });
  // Two logins racing: both replaced keys must end up queued.
  await Promise.all([
    replaceCredential(env, u, { token: 'b', apiKeyId: 'kb', savedAt: 'now' }),
    replaceCredential(env, u, { token: 'c', apiKeyId: 'kc', savedAt: 'now' }),
  ]);
  assert.equal(await removeCredential(env, u), true);
  const queued = (await readPendingRevocations(env, u)).map((k) => k.apiKeyId).sort();
  assert.deepEqual(queued, ['ka', 'kb', 'kc']);
});

test('parallel host-key pins merge; a conflicting concurrent pin is rejected', async () => {
  const file = join(dir, 'known_hosts');
  await Promise.all(Array.from({ length: 12 }, (_, i) => pinHostKey(file, `[h${i}]:22`, `SHA256:k${i}`)));
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 12);
  await assert.rejects(pinHostKey(file, '[h0]:22', 'SHA256:other'), /different key .* pinned/);
  await pinHostKey(file, '[h0]:22', 'SHA256:k0'); // same key: no-op
  await forgetHostKey(file, 'h0', 22);
  assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 11);
});
