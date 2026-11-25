/**
 * State persistence test (node --test): pendingVolumeResults must survive a
 * save/load round-trip so a process exit between reconcile and the next
 * check-in does not lose volume results (which would otherwise leave a volume
 * pending behind a cached ETag until the create barrier times out).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { State } = require('../dist/state.js');

test('pendingVolumeResults round-trips through save/load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-state-'));

  const s1 = State.load(dir);
  s1.etag = '"abc"';
  s1.pendingVolumeResults['42'] = { applied: false, message: 'mkdir: boom' };
  s1.pendingVolumeResults['43'] = { applied: true };
  s1.save();

  const s2 = State.load(dir);
  assert.equal(s2.etag, '"abc"');
  assert.deepEqual(s2.pendingVolumeResults, {
    42: { applied: false, message: 'mkdir: boom' },
    43: { applied: true },
  });

  // Clearing a delivered result and re-saving persists the removal.
  delete s2.pendingVolumeResults['43'];
  s2.save();
  const s3 = State.load(dir);
  assert.deepEqual(Object.keys(s3.pendingVolumeResults), ['42']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('load with no state file starts empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-state-'));
  const s = State.load(dir);
  assert.equal(s.etag, undefined);
  assert.deepEqual(s.pendingVolumeResults, {});
  fs.rmSync(dir, { recursive: true, force: true });
});
