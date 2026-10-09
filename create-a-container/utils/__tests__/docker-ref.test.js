/**
 * Image reference normalization (Manager `template`) and parsing. The
 * provider (packages/os-cloud-provider normalizeImageRef) mirrors
 * normalizeDockerRef; keep the cases in sync.
 */

const { normalizeDockerRef } = require('../../routers/api/v1/containers');
const { parseDockerRef } = require('../docker-registry');
const { closeDb } = require('../../tests/helpers/db');

afterAll(async () => {
  await closeDb();
});

describe('normalizeDockerRef', () => {
  test.each([
    ['nginx', 'docker.io/library/nginx:latest'],
    ['nginx:1.27', 'docker.io/library/nginx:1.27'],
    ['bitnami/redis', 'docker.io/bitnami/redis:latest'],
    ['docker.io/nginx', 'docker.io/library/nginx:latest'],
    ['a/b/c', 'docker.io/a/b/c:latest'],
    ['ghcr.io/mieweb/opensource-server/cloud:sha-abc', 'ghcr.io/mieweb/opensource-server/cloud:sha-abc'],
    // A registry-qualified ref keeps its path: `library/` is Docker Hub only.
    ['localhost:5000/app', 'localhost:5000/app:latest'],
    ['localhost/app:1', 'localhost/app:1'],
    ['registry.example.com/team/app:2', 'registry.example.com/team/app:2'],
    // Digest-pinned: the digest is the reference (a tag next to it is dropped).
    ['ghcr.io/org/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ghcr.io/org/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['nginx:1.27@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'docker.io/library/nginx@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['localhost:5000/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'localhost:5000/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ])('%s → %s', (input, want) => {
    expect(normalizeDockerRef(input)).toBe(want);
    expect(normalizeDockerRef(want)).toBe(want); // idempotent
  });
});

describe('parseDockerRef', () => {
  test('a digest-pinned ref is fetched by its digest', () => {
    expect(parseDockerRef('ghcr.io/org/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toEqual({ registry: 'ghcr.io', namespace: 'org', image: 'app', tag: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(parseDockerRef('localhost:5000/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toEqual({ registry: 'localhost:5000', namespace: '', image: 'app', tag: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  });

  test('a registry port is not the tag; a registry-root repo has no namespace', () => {
    expect(parseDockerRef('localhost:5000/app:1')).toEqual({ registry: 'localhost:5000', namespace: '', image: 'app', tag: '1' });
    expect(parseDockerRef('docker.io/library/nginx:latest')).toEqual({
      registry: 'docker.io',
      namespace: 'library',
      image: 'nginx',
      tag: 'latest',
    });
  });
});
