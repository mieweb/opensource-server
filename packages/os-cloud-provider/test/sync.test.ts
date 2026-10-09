import { strict as assert } from 'node:assert';
import { chmod, lstat, lutimes, mkdir, mkdtemp, readFile, readlink, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { IgnoreRules, planSync, pruneNames, REMOTE, scanLocal, syncWorktree } from '../src/sync.ts';
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
    assert.equal(r.ignores('.git'), true, 'a .git file (linked worktree / submodule)');
    assert.equal(r.ignores('vendor/lib/.git'), true);
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
    assert.deepEqual(same, { upload: [], remove: [], conflicts: [], mkdirs: [], rmdirs: [] });

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

  test('an unreadable .gitignore stops the sync instead of being skipped', async () => {
    await rm(join(local, 'src/.gitignore'));
    await mkdir(join(local, 'src/.gitignore')); // EISDIR on read; a permission error behaves the same
    const shell = new FakeShell(remote);
    await assert.rejects(syncWorktree(local, shell, logger), /Cannot read .*src\/\.gitignore/);
    await assert.rejects(lstat(join(remote, 'src/secret.txt')));
  });

  test('a same-size rewrite within the same second is synced', async () => {
    const f = join(local, 'src/index.js');
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000 + 100); // x.100s
    await utimes(f, t0, t0);
    await syncWorktree(local, new FakeShell(remote), logger);
    await writeFile(f, 'v9'); // same length as 'v1'
    const t1 = new Date(t0.getTime() + 400); // same whole second, x.500s
    await utimes(f, t1, t1);
    const plan = await syncWorktree(local, new FakeShell(remote), logger);
    assert.deepEqual(plan.upload.map((x) => x.path), ['src/index.js']);
    assert.equal(await readFile(join(remote, 'src/index.js'), 'utf8'), 'v9');
    // ...and an unchanged tree stays a no-op at millisecond precision.
    assert.deepEqual(await syncWorktree(local, new FakeShell(remote), logger), { upload: [], remove: [], conflicts: [], mkdirs: [], rmdirs: [] });
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

  test('a file that became a directory, and a directory that became a file, converge', async () => {
    await put(local, 'thing', 'a file');
    await put(local, 'lib/a.js', 'a');
    await put(local, 'lib/sub/b.js', 'b');
    await syncWorktree(local, new FakeShell(remote), logger);

    await rm(join(local, 'thing'));
    await put(local, 'thing/inside.js', 'now a dir');
    await rm(join(local, 'lib'), { recursive: true });
    await put(local, 'lib', 'now a file');
    const shell = new FakeShell(remote);
    const plan = await syncWorktree(local, shell, logger);
    assert.deepEqual(plan.conflicts, ['lib', 'thing']);
    assert.deepEqual(plan.remove, [], 'nothing is deleted twice');
    assert.equal(await readFile(join(remote, 'thing/inside.js'), 'utf8'), 'now a dir');
    assert.equal(await readFile(join(remote, 'lib'), 'utf8'), 'now a file');
    // Conflicts are cleared before extraction.
    assert.ok(shell.commands.indexOf(REMOTE.removeTrees) < shell.commands.indexOf(REMOTE.extract));
    assert.deepEqual(await syncWorktree(local, new FakeShell(remote), logger), { upload: [], remove: [], conflicts: [], mkdirs: [], rmdirs: [] });
  });

  test('empty directories are created and removed like files', async () => {
    await mkdir(join(local, 'uploads/tmp'), { recursive: true }); // empty, not ignored
    await mkdir(join(local, 'node_modules/ignored-empty'), { recursive: true }); // ignored
    const first = await syncWorktree(local, new FakeShell(remote), logger);
    assert.deepEqual(first.mkdirs.filter((d) => d.startsWith('uploads')), ['uploads', 'uploads/tmp']);
    assert.ok((await lstat(join(remote, 'uploads/tmp'))).isDirectory());
    await assert.rejects(lstat(join(remote, 'node_modules')), 'ignored dirs are not created');

    // Removed locally → removed remotely; a dir still holding ignored
    // content (remote-only node_modules) is kept.
    await put(remote, 'keepme/node_modules/x.js', 'deps');
    await mkdir(join(remote, 'gone/deeper'), { recursive: true });
    await rm(join(local, 'uploads'), { recursive: true });
    const second = await syncWorktree(local, new FakeShell(remote), logger);
    assert.deepEqual(second.rmdirs, ['gone/deeper', 'uploads/tmp', 'gone', 'keepme', 'uploads']);
    await assert.rejects(lstat(join(remote, 'uploads')));
    await assert.rejects(lstat(join(remote, 'gone')));
    assert.equal(await readFile(join(remote, 'keepme/node_modules/x.js'), 'utf8'), 'deps');

    // A directory that stays locally but loses its files is kept (and stable).
    await put(local, 'data/only.txt', 'x');
    await syncWorktree(local, new FakeShell(remote), logger);
    await rm(join(local, 'data/only.txt'));
    await syncWorktree(local, new FakeShell(remote), logger);
    assert.ok((await lstat(join(remote, 'data'))).isDirectory());
    const settled = await syncWorktree(local, new FakeShell(remote), logger);
    assert.deepEqual(settled.mkdirs, []);
    assert.deepEqual(settled.rmdirs, ['keepme']); // only the kept non-empty one is retried
  });

  test('a remote file replaced by an empty local directory (or one inside it) syncs', async () => {
    await put(local, 'cache', 'was a file');
    await put(local, 'logs', 'also a file');
    await syncWorktree(local, new FakeShell(remote), logger);
    await rm(join(local, 'cache'));
    await rm(join(local, 'logs'));
    await mkdir(join(local, 'cache')); // the file becomes an empty dir
    await mkdir(join(local, 'logs/app'), { recursive: true }); // ...or the parent of one
    const plan = await syncWorktree(local, new FakeShell(remote), logger);
    assert.deepEqual(plan.conflicts, ['cache', 'logs']);
    assert.deepEqual(plan.remove, [], 'not also removed after the extract');
    assert.ok((await lstat(join(remote, 'cache'))).isDirectory());
    assert.ok((await lstat(join(remote, 'logs/app'))).isDirectory());
    assert.deepEqual(await syncWorktree(local, new FakeShell(remote), logger), { upload: [], remove: [], conflicts: [], mkdirs: [], rmdirs: [] });
  });

  test('the tree is read and changed as the app account, never as root', () => {
    // The running app owns the tree and can swap a directory for a symlink at
    // any time; as root, rm/tar/find would follow it out of /opt/app/src.
    for (const cmd of [REMOTE.extract, REMOTE.remove, REMOTE.removeTrees, REMOTE.rmdirs, REMOTE.list]) {
      const privileged = cmd.split('&&').map((c) => c.trim()).filter((c) => c.startsWith('sudo '));
      for (const c of privileged) {
        assert.ok(c.startsWith('sudo -u mieweb -- ') || c.startsWith('sudo install -d '), c);
      }
    }
  });

  test('refuses to sync when the app could redirect the sync root (old image)', async () => {
    const shell = new FakeShell(remote);
    shell.unsafeRoot = true;
    await assert.rejects(syncWorktree(local, shell, logger), /could be redirected by the app/);
    assert.ok(!shell.commands.some((c) => c === REMOTE.extract || c.includes('mkdir')), 'no privileged command ran');
  });

  test('the remote listing does not descend into ignored directories', async () => {
    await syncWorktree(local, new FakeShell(remote), logger);
    // Remote-only build output and installed deps, like the container has.
    await put(remote, 'node_modules/big/index.js', 'x');
    await put(remote, 'node_modules/big/lib/deep.js', 'x');
    await put(remote, 'dist/out.js', 'x');
    const shell = new FakeShell(remote);
    const plan = await syncWorktree(local, shell, logger);
    assert.deepEqual(plan, { upload: [], remove: [], conflicts: [], mkdirs: [], rmdirs: [] });
    assert.ok(shell.listed.includes('node_modules'), 'pruned dir itself is listed');
    assert.ok(!shell.listed.some((p) => p.startsWith('node_modules/') || p.startsWith('dist/')), shell.listed.join(','));
    assert.equal(await readFile(join(remote, 'node_modules/big/index.js'), 'utf8'), 'x', 'left untouched');
  });

  test('pruneNames: plain names only, none if anything is re-included', () => {
    assert.deepEqual(pruneNames('node_modules/\n*.log\ndist\n/build\nsrc/gen/\n# c\n**/tmp\n'), ['node_modules', '*.log', 'dist']);
    assert.deepEqual(pruneNames('node_modules/\n!keep\n'), []);
  });

  test('concurrent deploys to the same container are serialized by the deploy lock', async () => {
    const a = new FakeShell(remote);
    const b = new FakeShell(remote);
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => (releaseFirst = r));
    // Hold deploy A inside its critical section (at the listing).
    const origExec = a.exec.bind(a);
    a.exec = async (cmd, stdin, sig) => {
      if (cmd.includes(' find ')) await gate;
      return origExec(cmd, stdin, sig);
    };
    const first = syncWorktree(local, a, logger);
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(syncWorktree(local, b, logger), /Another deploy to this container is in progress/);
    assert.ok(!b.commands.some((c) => c.includes(' find ')), 'B touched nothing');
    releaseFirst();
    await first;
    // Released (also on failure): the next deploy proceeds.
    await syncWorktree(local, new FakeShell(remote), logger);
    assert.equal(FakeShell.locks.size, 0);
  });

  test('the deploy lock is released when the sync fails', async () => {
    const shell = new FakeShell(remote);
    shell.restartScript = { chunks: [], code: 1 };
    await assert.rejects(syncWorktree(local, shell, logger));
    assert.equal(FakeShell.locks.size, 0);
  });

  test('cancellation stops the sync before it uploads or deletes', async () => {
    const ac = new AbortController();
    const shell = new FakeShell(remote);
    shell.beforeExec = (cmd) => {
      if (cmd.includes(' find ')) ac.abort(new Error('user cancelled'));
    };
    await assert.rejects(syncWorktree(local, shell, logger, ac.signal), /user cancelled/);
    // The lock, the root check, then the listing; nothing after.
    assert.equal(shell.commands.length, 3);
    assert.match(shell.commands[0]!, /flock/);
    assert.equal(shell.commands[1], REMOTE.checkRoot);
    assert.match(shell.commands[2]!, / find \. /);
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

  test('an SSH connection lost during the restart fails the sync', async () => {
    const shell = new FakeShell(remote);
    shell.restartScript = { chunks: [], code: -1 };
    await assert.rejects(syncWorktree(local, shell, logger), /SSH connection closed before the app restart finished/);
  });

  test('an app that crashes right after starting fails the sync', async () => {
    const shell = new FakeShell(remote);
    shell.restartScript = { chunks: [], code: 86 };
    await assert.rejects(syncWorktree(local, shell, logger), /started but stopped within 5s/);
  });

  test('a failing remote command fails the sync with its stderr', async () => {
    const shell = new FakeShell(remote);
    shell.exec = async () => ({ code: 1, stdout: Buffer.alloc(0), stderr: 'sudo: a password is required' });
    await assert.rejects(syncWorktree(local, shell, logger), /root check failed \(exit 1\): sudo: a password is required/);
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
