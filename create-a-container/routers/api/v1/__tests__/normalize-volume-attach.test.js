/**
 * normalizeVolumeAttach (issue #421): validates volume-attach entries, rejects
 * provider-unsafe mount paths, and rejects the reserved quick_and_dirty
 * name/mount point (compared canonically) so a user attach can't collide with a
 * backfilled legacy row.
 */

const { normalizeVolumeAttach } = require('../containers');

describe('normalizeVolumeAttach', () => {
  test('accepts a valid rw volume', () => {
    expect(normalizeVolumeAttach({ name: 'data', mountPath: '/mnt/data', mode: 'rw' })).toEqual({
      name: 'data',
      mountPath: '/mnt/data',
      mode: 'rw',
    });
  });

  test('canonicalizes the mount path (collapses slashes, strips trailing)', () => {
    expect(normalizeVolumeAttach({ name: 'data', mountPath: '/mnt//data/', mode: 'rw' })).toEqual({
      name: 'data',
      mountPath: '/mnt/data',
      mode: 'rw',
    });
  });

  test('rejects a traversal name', () => {
    expect(() => normalizeVolumeAttach({ name: '../x', mountPath: '/mnt/x', mode: 'rw' })).toThrow(
      /safe path segment/,
    );
  });

  test('rejects a relative mount path', () => {
    expect(() => normalizeVolumeAttach({ name: 'ok', mountPath: 'rel', mode: 'rw' })).toThrow(
      /absolute path/,
    );
  });

  test.each([
    ['comma delimiter', '/mnt/a,ro=0'],
    ['colon delimiter', '/mnt/a:b'],
    ['backslash', '/mnt/a\\b'],
    ['whitespace', '/mnt/a b'],
    ['newline', '/mnt/a\nb'],
    ['NUL', '/mnt/a\u0000b'],
    ['traversal segment', '/mnt/../etc'],
  ])('rejects a mount path with %s', (_label, mountPath) => {
    expect(() => normalizeVolumeAttach({ name: 'ok', mountPath, mode: 'rw' })).toThrow(
      /absolute path|delimiters|segments/,
    );
  });

  test('rejects an invalid mode', () => {
    expect(() => normalizeVolumeAttach({ name: 'ok', mountPath: '/mnt/ok', mode: 'x' })).toThrow(
      /mode must be/,
    );
  });

  test('rejects the reserved built-in name', () => {
    expect(() =>
      normalizeVolumeAttach({ name: 'quick_and_dirty', mountPath: '/mnt/other', mode: 'rw' }),
    ).toThrow(/reserved/);
  });

  test('rejects the reserved built-in mount path', () => {
    expect(() =>
      normalizeVolumeAttach({ name: 'other', mountPath: '/mnt/quick_and_dirty', mode: 'rw' }),
    ).toThrow(/reserved/);
  });

  test('rejects equivalent spellings of the reserved mount path', () => {
    for (const mountPath of ['/mnt/quick_and_dirty/', '/mnt//quick_and_dirty']) {
      expect(() => normalizeVolumeAttach({ name: 'other', mountPath, mode: 'rw' })).toThrow(
        /reserved/,
      );
    }
  });
});
