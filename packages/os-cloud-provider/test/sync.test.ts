import { strict as assert } from 'node:assert';
import { chmod, lstat, lutimes, mkdir, mkdtemp, readFile, readlink, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { IgnoreRules, planSync, REMOTE, scanLocal, syncWorktree } from '../src/sync.ts';
import { FakeShell } from './fake-shell.ts';

const logger = { info() {}, warn() {}, error() {} };
let base: string;
let local: string;
let remote: string;

async function put(root: string, rel: string, content: string): Promise<void> {
  await mkdir(join(root, rel, '..'), { recursive: true });
  await writeFile(join(root, rel), content);
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'os-sync-'));
  local = join(base, 'local');
  remote = join(base, 'remote');
  await put(local, '.gitignore', 'node_modules/\n*.log\ndist\n!keep.log\n');
  await put(local, 'package.json', '{}');
  await put(local, 'src/index.js', 'v1');
  await put(local, 'src/.gitignore', 'secret.txt\n');
  await put(local, 'src/secret.txt', 'nope');
  await put(local, 'untracked.txt', 'not staged, still synced');
  await put(local, 'debug.log', 'ignored');
  await put(local, 'keep.log', 'unignored by negation');
  await put(local, 'node_modules/x/index.js', 'local deps');
  await put(local, 'dist/out.js', 'build');
  await put(local, '.git/HEAD', 'ref: refs/heads/main');
  await symlink('src/index.js', join(local, 'link.js'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('IgnoreRules', () => {
  test('scoped, nested, negation, ancestors, .git', () => {
    const r = new IgnoreRules();
    r.add('', 'node_modules/\n*.log\n!keep.log\n/build\n');
    r.add('pkg', 'tmp/\n');
    assert.equal(r.ignores('node_modules/a/b.js'), true);
    assert.equal(r.ignores('pkg/node_modules/a.js'), true);
    assert.equal(r.ignores('a/b.log'), true);
    assert.equal(r.ignores('keep.log'), false);
    assert.equal(r.ignores('build/x'), true);
    assert.equal(r.ignores('pkg/build/x'), false);
    assert.equal(r.ignores('pkg/tmp/x'), true);
    assert.equal(r.ignores('tmp/x'), false);
    assert.equal(r.ignores('.git/HEAD'), true);
    assert.equal(r.ignores('src/.gitkeep'), false);
  });
});

describe('scanLocal', () => {
  test('honors .gitignore, skips .git, includes untracked files and symlinks', async () => {
    const { files } = await scanLocal(local);
    assert.deepEqual([...files.keys()].sort(), [
      '.gitignore',
      'keep.log',
      'link.js',
      'package.json',
      'src/.gitignore',
      'src/index.js',
      'untracked.txt',
    ]);
    assert.equal(files.get('link.js')!.type, 'symlink');
  });
});

describe('syncWorktree', () => {
  test('first sync uploads everything, owned by mieweb, and restarts', async () => {
    const shell = new FakeShell(remote);
    const plan = await syncWorktree(local, shell, logger);
    assert.equal(plan.upload.length, 7);
    assert.equal(await readFile(join(remote, 'src/index.js'), 'utf8'), 'v1');
    assert.equal(await readlink(join(remote, 'link.js')), 'src/index.js');
    await assert.rejects(lstat(join(remote, 'src/secret.txt')));
    await assert.rejects(lstat(join(remote, '.git')));
    assert.equal(shell.owners.get('src/index.js'), 'mieweb:mieweb');
    assert.equal(shell.owners.get('src'), 'mieweb:mieweb');
    assert.equal(shell.commands.at(-1), REMOTE.restart);
  });

  test('second sync is incremental; deletes removed files; keeps remote ignored paths', async () => {
    await syncWorktree(local, new FakeShell(remote), logger);
    await put(remote, 'node_modules/installed/index.js', 'remote deps');
    await put(remote, 'dist/built.js', 'remote build');

    const same = await syncWorktree(local, new FakeShell(remote), logger);
    assert.deepEqual(same, { upload: [], remove: [] });

    await writeFile(join(local, 'src/index.js'), 'v2!');
    const future = new Date(Date.now() + 5000);
    await utimes(join(local, 'src/index.js'), future, future);
    await rm(join(local, 'untracked.txt'));
    await rm(join(local, 'src/.gitignore'));
    const shell = new FakeShell(remote);
    const plan = await syncWorktree(local, shell, logger);
    assert.deepEqual(plan.upload.map((f) => f.path).sort(), ['src/index.js', 'src/secret.txt']);
    assert.deepEqual(plan.remove, ['src/.gitignore', 'untracked.txt']);
    assert.equal(await readFile(join(remote, 'src/index.js'), 'utf8'), 'v2!');
    await assert.rejects(lstat(join(remote, 'untracked.txt')));
    assert.equal(await readFile(join(remote, 'node_modules/installed/index.js'), 'utf8'), 'remote deps');
    assert.equal(await readFile(join(remote, 'dist/built.js'), 'utf8'), 'remote build');
  });

  test('a permission-only change (chmod +x) is synced', async () => {
    await syncWorktree(local, new FakeShell(remote), logger);
    const st = await lstat(join(local, 'src/index.js'));
    await chmod(join(local, 'src/index.js'), 0o755);
    await utimes(join(local, 'src/index.js'), st.atime, st.mtime); // chmod alone keeps mtime
    const plan = await syncWorktree(local, new FakeShell(remote), logger);
    assert.deepEqual(plan.upload.map((f) => f.path), ['src/index.js']);
    assert.equal((await lstat(join(remote, 'src/index.js'))).mode & 0o777, 0o755);
  });

  test('a file↔symlink swap and a same-length, same-second symlink retarget are synced', async () => {
    await put(local, 'src/other.js', 'v1');
    await syncWorktree(local, new FakeShell(remote), logger);
    const t = (await lstat(join(local, 'link.js'))).mtime;
    // Retarget link.js to a same-length path, keeping its mtime.
    await rm(join(local, 'link.js'));
    await symlink('src/other.js', join(local, 'link.js'));
    await lutimes(join(local, 'link.js'), t, t);
    // Replace untracked.txt (a file) with a symlink of the same size.
    const st = await lstat(join(local, 'untracked.txt'));
    await rm(join(local, 'untracked.txt'));
    await symlink('x'.repeat(st.size), join(local, 'untracked.txt'));
    await lutimes(join(local, 'untracked.txt'), st.mtime, st.mtime);
    const plan = await syncWorktree(local, new FakeShell(remote), logger);
    assert.deepEqual(plan.upload.map((f) => f.path).sort(), ['link.js', 'untracked.txt']);
    assert.equal(await readlink(join(remote, 'link.js')), 'src/other.js');
    assert.equal((await lstat(join(remote, 'untracked.txt'))).isSymbolicLink(), true);
  });

  test('cancellation stops the sync before it uploads or deletes', async () => {
    const ac = new AbortController();
    const shell = new FakeShell(remote);
    shell.beforeExec = (cmd) => {
      if (cmd === REMOTE.list) ac.abort(new Error('user cancelled'));
    };
    await assert.rejects(syncWorktree(local, shell, logger, ac.signal), /user cancelled/);
    assert.deepEqual(shell.commands, [REMOTE.list]);
  });

  test('empty directories left by deletions are pruned', async () => {
    await put(local, 'old/deep/file.txt', 'x');
    await syncWorktree(local, new FakeShell(remote), logger);
    await rm(join(local, 'old'), { recursive: true });
    await syncWorktree(local, new FakeShell(remote), logger);
    await assert.rejects(lstat(join(remote, 'old')));
  });

  test('restart output is streamed line by line', async () => {
    const shell = new FakeShell(remote);
    shell.restartScript = { chunks: [['Installing depend', 'stdout'], ['encies: npm ci\nadded 3 packages\n', 'stdout']], code: 0 };
    const logs: string[] = [];
    await syncWorktree(local, shell, { info: (m) => logs.push(m), warn() {}, error() {} });
    assert.ok(logs.includes('  | Installing dependencies: npm ci'));
    assert.ok(logs.includes('  | added 3 packages'));
    assert.equal(logs.at(-1), 'App restarted and running');
  });

  test('a failed install/build fails the sync and shows recent logs', async () => {
    const shell = new FakeShell(remote);
    shell.restartScript = { chunks: [['npm ERR! missing script\n', 'stdout']], code: 1 };
    shell.recentLogs = 'npm ERR! missing script\nProcess exited';
    const errors: string[] = [];
    await assert.rejects(
      syncWorktree(local, shell, { info() {}, warn() {}, error: (m) => errors.push(m) }),
      /Restarting the app failed \(exit 1\): dependency install or build failed/,
    );
    assert.match(errors[0]!, /Recent app\.service logs:\nnpm ERR! missing script/);
  });

  test('an app that crashes right after starting fails the sync', async () => {
    const shell = new FakeShell(remote);
    shell.restartScript = { chunks: [], code: 86 };
    await assert.rejects(syncWorktree(local, shell, logger), /started but stopped within 5s/);
  });

  test('a failing remote command fails the sync with its stderr', async () => {
    const shell = new FakeShell(remote);
    shell.exec = async () => ({ code: 1, stdout: Buffer.alloc(0), stderr: 'sudo: a password is required' });
    await assert.rejects(syncWorktree(local, shell, logger), /listing failed \(exit 1\): sudo: a password is required/);
  });
});

test('planSync diff', () => {
  const rules = new IgnoreRules();
  rules.add('', 'node_modules/\n');
  const localFiles = new Map([
    ['a', { path: 'a', type: 'file' as const, size: 1, mtime: 10, mode: 0o644 }],
    ['b', { path: 'b', type: 'file' as const, size: 2, mtime: 10, mode: 0o644 }],
  ]);
  const remoteFiles = new Map([
    ['a', { type: 'file' as const, size: 1, mtime: 10 }],
    ['b', { type: 'file' as const, size: 2, mtime: 9 }],
    ['c', { type: 'file' as const, size: 1, mtime: 1 }],
    ['node_modules/x', { type: 'file' as const, size: 1, mtime: 1 }],
  ]);
  const plan = planSync(localFiles, remoteFiles, rules);
  assert.deepEqual(plan.upload.map((f) => f.path), ['b']);
  assert.deepEqual(plan.remove, ['c']);
});
