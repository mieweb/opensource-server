const { withContainerLock } = require('../container-lock');

test('serializes per container, in order; other containers run concurrently; errors release the lock', async () => {
  const events = [];
  const step = (tag, ms) => () =>
    new Promise((resolve) => {
      events.push(`${tag}:start`);
      setTimeout(() => {
        events.push(`${tag}:end`);
        resolve(tag);
      }, ms);
    });
  const failing = withContainerLock(1, async () => {
    events.push('x:start');
    throw new Error('boom');
  });
  const a = withContainerLock(1, step('a', 30));
  const b = withContainerLock(1, step('b', 1));
  const other = withContainerLock(2, step('o', 1));
  await expect(failing).rejects.toThrow('boom');
  expect(await Promise.all([a, b, other])).toEqual(['a', 'b', 'o']);
  // a and b never overlap, b after a; container 2 didn't wait for container 1.
  expect(events.indexOf('b:start')).toBeGreaterThan(events.indexOf('a:end'));
  expect(events.indexOf('o:end')).toBeLessThan(events.indexOf('a:end'));
});
