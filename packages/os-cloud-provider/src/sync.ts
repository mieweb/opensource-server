/**
 * Code delivery: copy the local worktree into the converged container over
 * SSH and restart `app.service`. rsync-like, implemented in JS (no local
 * rsync/ssh binaries):
 *
 * 1. Scan the worktree. `.gitignore` rules are honored (nested files too, via
 *    the `ignore` package), `.git/` is skipped. Staged vs. committed status
 *    doesn't matter; the files on disk are what gets sent.
 * 2. List the remote tree (`find -printf`) and diff: files by size,
 *    millisecond mtime and permissions; symlinks by target; plus type changes.
 * 3. Stream a tar of the changed files into `sudo tar -x` (owned by the
 *    `mieweb` service account; a pax `mtime` record keeps millisecond mtimes so
 *    the next diff is exact).
 * 4. Delete remote files that no longer exist locally. Remote paths matching
 *    the ignore rules (node_modules, build output) are left alone.
 * 5. `sudo systemctl restart app.service`, streaming the unit's journal while
 *    it installs/builds (ExecStartPre) and failing the deploy if the restart
 *    fails or the app doesn't stay up for APP_SETTLE_SECONDS.
 *
 * LDAP users have passwordless sudo in the base image.
 */

import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { posix, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DeployLogger } from '@mieweb/deploy-contract';
import ignore, { type Ignore } from 'ignore';
import { quote } from 'shell-quote';
import tarStream from 'tar-stream';
import type { RemoteShell } from './ssh.ts';

export const REMOTE_APP_DIR = '/opt/app/src';
const OWNER = 'mieweb';

export interface FileEntry {
  /** POSIX path relative to the root. */
  path: string;
  type: 'file' | 'symlink';
  size: number;
  /**
   * Milliseconds since the epoch. Carried to the container in a pax `mtime`
   * record (ustar headers only hold whole seconds, which would miss a
   * same-size rewrite within one second).
   */
  mtime: number;
  mode: number;
  linkname?: string;
}

/** `.gitignore` rules scoped to the directories that declare them. */
export class IgnoreRules {
  private readonly scopes: { prefix: string; ig: Ignore }[] = [];

  add(dir: string, content: string): void {
    this.scopes.push({ prefix: dir === '' ? '' : `${dir}/`, ig: ignore().add(content) });
  }

  /** Whether `path` itself (not its ancestors) matches a rule. */
  private matches(path: string, isDir: boolean): boolean {
    let ignored = false;
    for (const { prefix, ig } of this.scopes) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      if (rel === '') continue;
      const r = ig.test(isDir ? `${rel}/` : rel);
      if (r.ignored) ignored = true;
      else if (r.unignored) ignored = false;
    }
    return ignored;
  }

  /** Whether `path` or any directory above it is ignored (or is `.git`). */
  ignores(path: string, isDir = false): boolean {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const sub = parts.slice(0, i).join('/');
      const subIsDir = i < parts.length || isDir;
      // `.git` is a directory in a normal checkout but a file in linked
      // worktrees and submodules (it holds the local gitdir path): skip both.
      if (parts[i - 1] === '.git') return true;
      if (this.matches(sub, subIsDir)) return true;
    }
    return false;
  }
}

/** Walk the worktree, honoring .gitignore. */
export async function scanLocal(
  root: string,
  signal?: AbortSignal,
): Promise<{ files: Map<string, FileEntry>; rules: IgnoreRules; ignoredDirs: string[]; rootIgnore: string; dirs: Set<string> }> {
  const rules = new IgnoreRules();
  const files = new Map<string, FileEntry>();
  const ignoredDirs: string[] = [];
  /** Every (non-ignored) directory, so empty ones are synced too. */
  const dirs = new Set<string>();
  let rootIgnore = '';

  const walk = async (dir: string): Promise<void> => {
    signal?.throwIfAborted();
    const abs = join(root, dir);
    try {
      const content = await readFile(join(abs, '.gitignore'), 'utf8');
      if (dir === '') rootIgnore = content;
      rules.add(dir, content);
    } catch (err) {
      // Only "there is no .gitignore here" is fine. An unreadable one must
      // stop the sync: skipping its rules could upload excluded files (secrets).
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Cannot read ${join(abs, '.gitignore')}: ${(err as Error).message}`, { cause: err });
      }
    }
    const entries = await readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const rel = dir === '' ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!rules.ignores(rel, true)) {
          dirs.add(rel);
          await walk(rel);
        } else ignoredDirs.push(rel);
        continue;
      }
      if (rules.ignores(rel)) continue;
      const st = await lstat(join(root, rel));
      if (st.isSymbolicLink()) {
        const linkname = await readlink(join(root, rel));
        files.set(rel, { path: rel, type: 'symlink', size: Buffer.byteLength(linkname), mtime: Math.round(st.mtimeMs), mode: 0o777, linkname });
      } else if (st.isFile()) {
        files.set(rel, { path: rel, type: 'file', size: st.size, mtime: Math.round(st.mtimeMs), mode: st.mode & 0o777 });
      }
      // sockets, fifos, devices: skipped
    }
  };
  await walk('');
  return { files, rules, ignoredDirs, rootIgnore, dirs };
}

export interface RemoteEntry {
  type: 'file' | 'symlink' | 'dir';
  size: number;
  mtime: number;
  /** Permission bits; undefined for symlinks (always 0777). */
  mode?: number;
  /** Symlink target. */
  linkname?: string;
}

/** Parse `find -printf '%P\0%s\0%T@\0%m\0%y\0%l\0'` output. */
export function parseRemoteListing(out: Buffer): Map<string, RemoteEntry> {
  const map = new Map<string, RemoteEntry>();
  const parts = out.toString('utf8').split('\0');
  for (let i = 0; i + 5 < parts.length; i += 6) {
    const kind = parts[i + 4];
    const symlink = kind === 'l';
    map.set(parts[i]!, {
      type: symlink ? 'symlink' : kind === 'd' ? 'dir' : 'file',
      size: Number(parts[i + 1]),
      // %T@ is seconds with a fraction; compare at millisecond precision.
      mtime: Math.round(Number(parts[i + 2]) * 1000),
      mode: symlink ? undefined : Number.parseInt(parts[i + 3]!, 8),
      linkname: symlink ? parts[i + 5] : undefined,
    });
  }
  return map;
}

export interface SyncPlan {
  upload: FileEntry[];
  /** Remote files/symlinks that no longer exist locally. */
  remove: string[];
  /**
   * Remote paths in the way of an upload, removed recursively before
   * extracting: a directory where a file now goes, or a file/symlink where a
   * directory now goes (an ancestor of an uploaded path).
   */
  conflicts: string[];
  /** Local directories missing remotely (e.g. empty ones), created by the upload. */
  mkdirs: string[];
  /** Remote directories gone locally; removed (deepest first) only once empty. */
  rmdirs: string[];
}

export function planSync(
  local: Map<string, FileEntry>,
  remote: Map<string, RemoteEntry>,
  rules: IgnoreRules,
  localDirs: ReadonlySet<string> = new Set(),
): SyncPlan {
  const upload: FileEntry[] = [];
  const conflicts = new Set<string>();
  for (const f of local.values()) {
    const r0 = remote.get(f.path);
    if (r0?.type === 'dir') conflicts.add(f.path);
    for (const a of ancestors(f.path)) {
      const ra = remote.get(a);
      if (ra && ra.type !== 'dir') conflicts.add(a);
    }
  }
  // Anything under a conflicting path is removed with it.
  const removedWith = (p: string): boolean => [...conflicts].some((c) => p === c || p.startsWith(`${c}/`));
  for (const f of local.values()) {
    const r = removedWith(f.path) ? undefined : remote.get(f.path);
    // Files: size, millisecond mtime and permissions (`chmod +x` changes
    // neither size nor mtime). Symlinks: their target (link mtimes aren't
    // reliably preserved). Plus a file↔symlink swap.
    const changed =
      !r ||
      r.type !== f.type ||
      (f.type === 'file' && (r.size !== f.size || r.mtime !== f.mtime || (r.mode !== undefined && r.mode !== f.mode))) ||
      (f.type === 'symlink' && r.linkname !== f.linkname);
    if (changed) upload.push(f);
  }
  const remove = [...remote]
    .filter(([p, r]) => r.type !== 'dir' && !local.has(p) && !rules.ignores(p) && !removedWith(p))
    .map(([p]) => p)
    .sort();
  // A local directory where the remote has a file/symlink is a conflict too.
  for (const d of localDirs) {
    const r = remote.get(d);
    if (r && r.type !== 'dir') conflicts.add(d);
  }
  const mkdirs = [...localDirs].filter((d) => remote.get(d)?.type !== 'dir' || removedWith(d)).sort();
  const rmdirs = [...remote]
    .filter(([p, r]) => r.type === 'dir' && !localDirs.has(p) && !rules.ignores(p, true) && !removedWith(p))
    .map(([p]) => p)
    .sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b));
  return { upload, remove, conflicts: [...conflicts].sort(), mkdirs, rmdirs };
}

function ancestors(path: string): string[] {
  const out: string[] = [];
  for (let d = posix.dirname(path); d !== '.' && d !== '/'; d = posix.dirname(d)) out.push(d);
  return out;
}

/** A tar stream of `files` (plus their parent dirs), all owned by OWNER. */
export function packTar(root: string, files: readonly FileEntry[], signal?: AbortSignal, extraDirs: readonly string[] = []): Readable {
  const pack = tarStream.pack();
  const owner = { uname: OWNER, gname: OWNER, uid: 0, gid: 0 };
  void (async () => {
    try {
      const dirs = new Set<string>();
      for (const f of files) for (const d of ancestors(f.path)) dirs.add(d);
      for (const d of extraDirs) for (const x of [d, ...ancestors(d)]) dirs.add(x);
      for (const d of [...dirs].sort()) {
        pack.entry({ name: d, type: 'directory', mode: 0o755, ...owner });
      }
      for (const f of files) {
        const mtime = new Date(f.mtime);
        if (f.type === 'symlink') {
          pack.entry({ name: f.path, type: 'symlink', linkname: f.linkname, mode: 0o777, mtime, ...owner });
          continue;
        }
        // tar-stream writes a pax header when `pax` is set (its types omit it).
        const header = { name: f.path, type: 'file' as const, size: f.size, mode: f.mode, mtime, ...owner };
        const entry = pack.entry({ ...header, pax: { mtime: (f.mtime / 1000).toFixed(3) } } as typeof header);
        await pipeline(createReadStream(join(root, f.path)), entry, { signal });
      }
      pack.finalize();
    } catch (err) {
      pack.destroy(err as Error);
    }
  })();
  return Readable.from(pack);
}

/** Seconds the app must stay running after a restart to count as started. */
export const APP_SETTLE_SECONDS = 5;
/** Exit code the restart script uses for "started, then stopped/crashed/restarted". */
const APP_NOT_RUNNING = 86;

const LISTING_FORMAT = '%P\\0%s\\0%T@\\0%m\\0%y\\0%l\\0';

/**
 * Directory-name patterns from the root `.gitignore` that `find -name` can
 * prune anywhere: plain names (globs allowed), optionally with a trailing
 * slash. Anything path-shaped or using `**` is left to the client-side rules,
 * and nothing is pruned by name if the file re-includes anything (`!`).
 */
export function pruneNames(rootIgnore: string): string[] {
  const lines = rootIgnore.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.some((l) => l.startsWith('!'))) return [];
  return lines
    .map((l) => l.replace(/\/$/, ''))
    .filter((l) => l && !l.includes('/') && !l.includes('**') && !l.startsWith('\\'));
}

/**
 * List the remote tree, without descending into ignored directories
 * (`node_modules`, build output, ...): git never re-includes anything under
 * an excluded directory, so their contents can't matter, and walking them
 * would make every incremental deploy O(all generated files). Pruned
 * directories are still listed themselves, so a file↔directory conflict at
 * that path is still detected.
 */
export function listCommand(prune: { paths: readonly string[]; names: readonly string[] }): string {
  const conds = [
    ...prune.paths.map((p) => ['-path', `./${p}`]),
    ...prune.names.map((n) => ['-name', n]),
  ];
  const pruneExpr =
    conds.length === 0
      ? []
      : ['(', ...conds.flatMap((c, i) => (i === 0 ? c : ['-o', ...c])), ')', '-type', 'd', '-prune', '-printf', LISTING_FORMAT, '-o'];
  return `${quote(['sudo', 'mkdir', '-p', REMOTE_APP_DIR])} && ${quote(['cd', REMOTE_APP_DIR])} && ${quote([
    'sudo', 'find', '.', '-mindepth', '1', ...pruneExpr,
    '(', '-type', 'f', '-o', '-type', 'l', '-o', '-type', 'd', ')', '-printf', LISTING_FORMAT,
  ])}`;
}

export const REMOTE = {
  list: listCommand({ paths: [], names: [] }),
  extract: quote(['sudo', 'tar', '-x', '-f', '-', '-C', REMOTE_APP_DIR]),
  remove: `${quote(['cd', REMOTE_APP_DIR])} && sudo xargs -0 -r rm -f --`,
  removeTrees: `${quote(['cd', REMOTE_APP_DIR])} && sudo xargs -0 -r rm -rf --`,
  // Only empty directories go (a directory still holding ignored content,
  // like node_modules, stays). The caller passes them deepest first.
  rmdirs: `${quote(['cd', REMOTE_APP_DIR])} && sudo xargs -0 -r rmdir --ignore-fail-on-non-empty --`,
  /**
   * Follow the journal (live install/build output) while restarting; exit
   * non-zero if the restart fails (ExecStartPre install/build failed) or the
   * app isn't still active after the settle period (crashed on start).
   */
  restart: [
    'sudo journalctl -u app.service -o cat -f -n 0 & j=$!',
    'sleep 1',
    'sudo systemctl restart app.service; rc=$?',
    // Healthy = still active *and* still the same invocation after the settle
    // period: a crash followed by an automatic restart (Restart=on-failure)
    // gets a new InvocationID, even if it happens to be active at the check.
    'inv=$(sudo systemctl show -p InvocationID --value app.service)',
    `if [ $rc -eq 0 ]; then sleep ${APP_SETTLE_SECONDS}; ` +
      `if ! sudo systemctl is-active --quiet app.service || ` +
      `[ "$(sudo systemctl show -p InvocationID --value app.service)" != "$inv" ]; then rc=${APP_NOT_RUNNING}; fi; fi`,
    'sleep 1; sudo kill $j 2>/dev/null; kill $j 2>/dev/null; wait $j 2>/dev/null',
    'exit $rc',
  ].join('\n'),
  /** Recent journal, shown when the restart fails. */
  logs: 'sudo journalctl -u app.service -o cat --no-pager -n 50',
};

async function run(
  shell: RemoteShell,
  what: string,
  cmd: string,
  signal: AbortSignal,
  stdin?: Buffer | NodeJS.ReadableStream,
): Promise<Buffer> {
  const res = await shell.exec(cmd, stdin, signal);
  if (res.code !== 0) {
    throw new Error(`Remote ${what} failed (exit ${res.code})${res.stderr.trim() ? `: ${res.stderr.trim()}` : ''}`);
  }
  return res.stdout;
}

function human(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;
}

/**
 * Re-split stdout/stderr chunks into whole lines (a chunk can end mid-line),
 * so each line is one logger call. Call `flush()` once the stream ends.
 */
export function lineSplitter(onLine: (line: string, stream: 'stdout' | 'stderr') => void) {
  const pending = { stdout: '', stderr: '' };
  return {
    push: (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      const lines = (pending[stream] + chunk.toString('utf8')).split('\n');
      pending[stream] = lines.pop() ?? '';
      for (const l of lines) onLine(l, stream);
    },
    flush: (): void => {
      for (const stream of ['stdout', 'stderr'] as const) {
        if (pending[stream]) onLine(pending[stream], stream);
        pending[stream] = '';
      }
    },
  };
}

/** Restart app.service, streaming its output; throw if it doesn't come up. */
export async function restartApp(shell: RemoteShell, logger: DeployLogger, signal: AbortSignal): Promise<void> {
  // stdout is the unit's journal; stderr is sudo/systemctl's own errors.
  const lines = lineSplitter((l, stream) => (stream === 'stderr' ? l.trim() && logger.warn(`  ${l}`) : logger.info(`  | ${l}`)));
  const code = await shell.stream(REMOTE.restart, lines.push, signal);
  lines.flush();
  if (code === 0) return;
  if (code === -1) {
    throw signal.aborted
      ? (signal.reason ?? new Error('Restart aborted'))
      : new Error('The SSH connection closed before the app restart finished; check `mieweb tail`');
  }
  const tail = await shell.exec(REMOTE.logs).catch(() => null);
  const recent = tail?.code === 0 ? tail.stdout.toString('utf8').trim() : '';
  if (recent) logger.error(`Recent app.service logs:\n${recent}`);
  throw new Error(
    code === APP_NOT_RUNNING
      ? `The app started but stopped within ${APP_SETTLE_SECONDS}s; see the logs above (\`mieweb tail\` for more)`
      : `Restarting the app failed (exit ${code}): dependency install or build failed; see the logs above`,
  );
}

/** Lock serializing deploys to one container (held from listing through restart). */
export const DEPLOY_LOCK = '/run/mieweb-deploy.lock';
const LOCKED = 'MIEWEB_DEPLOY_LOCKED';
const LOCK_BUSY = 75;

/**
 * Take the container's deploy lock for the duration of `fn`. `flock -n`
 * fails fast if another deploy holds it; the lock lives as long as the SSH
 * channel, so a crashed or killed deploy (dropped connection) releases it.
 */
async function withDeployLock<T>(shell: RemoteShell, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const cmd = `sudo flock -n -E ${LOCK_BUSY} ${quote([DEPLOY_LOCK])} sh -c ${quote([`echo ${LOCKED}; exec cat >/dev/null`])}`;
  let lock: { release(): void };
  try {
    lock = await shell.hold(cmd, LOCKED, signal);
  } catch (err) {
    if ((err as { code?: number }).code === LOCK_BUSY) {
      throw new Error('Another deploy to this container is in progress; try again when it finishes');
    }
    throw new Error(`Could not take the deploy lock: ${(err as Error).message}`, { cause: err });
  }
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

/** Sync `root` into the container and restart the app. */
export async function syncWorktree(
  root: string,
  shell: RemoteShell,
  logger: DeployLogger,
  signal: AbortSignal = new AbortController().signal,
): Promise<SyncPlan> {
  // Two deploys to the same app must not interleave listing, upload, delete
  // and restart (the result would mix both worktrees).
  return withDeployLock(shell, signal, () => syncLocked(root, shell, logger, signal));
}

async function syncLocked(root: string, shell: RemoteShell, logger: DeployLogger, signal: AbortSignal): Promise<SyncPlan> {
  const { files, rules, ignoredDirs, rootIgnore, dirs } = await scanLocal(root, signal);
  const list = listCommand({ paths: ignoredDirs, names: pruneNames(rootIgnore) });
  const listing = await run(shell, 'listing', list, signal);
  const plan = planSync(files, parseRemoteListing(listing), rules, dirs);
  const bytes = plan.upload.reduce((n, f) => n + (f.type === 'file' ? f.size : 0), 0);
  logger.info(
    `Syncing ${root} → ${REMOTE_APP_DIR}: ${files.size} files, ` +
      `${plan.upload.length} to upload (${human(bytes)}), ${plan.remove.length + plan.conflicts.length} to delete`,
  );

  const nul = (xs: string[]): Buffer => Buffer.from(xs.map((x) => `${x}\0`).join(''));
  if (plan.conflicts.length > 0) await run(shell, 'conflict removal', REMOTE.removeTrees, signal, nul(plan.conflicts));
  if (plan.upload.length > 0 || plan.mkdirs.length > 0) {
    await run(shell, 'extract', REMOTE.extract, signal, packTar(root, plan.upload, signal, plan.mkdirs));
  }
  if (plan.remove.length > 0) await run(shell, 'delete', REMOTE.remove, signal, nul(plan.remove));
  if (plan.rmdirs.length > 0) await run(shell, 'directory cleanup', REMOTE.rmdirs, signal, nul(plan.rmdirs));
  logger.info('Code synced; restarting the app (install/build output follows)');
  await restartApp(shell, logger, signal);
  logger.info('App restarted and running');
  return plan;
}
