/**
 * normalizeVolumeAttach (issue #421): validates volume-attach entries and
 * rejects the reserved built-in name/mount point so a user attach can't later
 * collide with the lazily-seeded quick_and_dirty built-in.
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
});
