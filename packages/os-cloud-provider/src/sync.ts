/**
 * Code delivery: copy the local worktree into the converged container over
 * SSH and restart `app.service`. rsync-like, implemented in JS (no local
 * rsync/ssh binaries):
 *
 * 1. Scan the worktree. `.gitignore` rules are honored (nested files too, via
 *    the `ignore` package), `.git/` is skipped. Staged vs. committed status
 *    doesn't matter; the files on disk are what gets sent.
 * 2. List the remote tree (`find -printf`) and diff by size + mtime.
 * 3. Stream a tar of the changed files into `sudo tar -x` (owned by the
 *    `mieweb` service account, mtimes preserved so the next diff is exact).
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
import tarStream from 'tar-stream';
import type { RemoteShell } from './ssh.ts';

export const REMOTE_APP_DIR = '/opt/app/src';
const OWNER = 'mieweb';

export interface FileEntry {
  /** POSIX path relative to the root. */
  path: string;
  type: 'file' | 'symlink';
  size: number;
  /** Seconds since the epoch (whole seconds; tar precision). */
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
      if (parts[i - 1] === '.git' && subIsDir) return true;
      if (this.matches(sub, subIsDir)) return true;
    }
    return false;
  }
}

/** Walk the worktree, honoring .gitignore. */
export async function scanLocal(root: string): Promise<{ files: Map<string, FileEntry>; rules: IgnoreRules }> {
  const rules = new IgnoreRules();
  const files = new Map<string, FileEntry>();

  const walk = async (dir: string): Promise<void> => {
    const abs = join(root, dir);
    try {
      rules.add(dir, await readFile(join(abs, '.gitignore'), 'utf8'));
    } catch {
      // no .gitignore here
    }
    const entries = await readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const rel = dir === '' ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!rules.ignores(rel, true)) await walk(rel);
        continue;
      }
      if (rules.ignores(rel)) continue;
      const st = await lstat(join(root, rel));
      if (st.isSymbolicLink()) {
        const linkname = await readlink(join(root, rel));
        files.set(rel, { path: rel, type: 'symlink', size: Buffer.byteLength(linkname), mtime: Math.floor(st.mtimeMs / 1000), mode: 0o777, linkname });
      } else if (st.isFile()) {
        files.set(rel, { path: rel, type: 'file', size: st.size, mtime: Math.floor(st.mtimeMs / 1000), mode: st.mode & 0o777 });
      }
      // sockets, fifos, devices: skipped
    }
  };
  await walk('');
  return { files, rules };
}

/** Parse `find -printf '%P\0%s\0%T@\0'` output. */
export function parseRemoteListing(out: Buffer): Map<string, { size: number; mtime: number }> {
  const map = new Map<string, { size: number; mtime: number }>();
  const parts = out.toString('utf8').split('\0');
  for (let i = 0; i + 2 < parts.length; i += 3) {
    map.set(parts[i]!, { size: Number(parts[i + 1]), mtime: Math.floor(Number(parts[i + 2])) });
  }
  return map;
}

export interface SyncPlan {
  upload: FileEntry[];
  remove: string[];
}

export function planSync(
  local: Map<string, FileEntry>,
  remote: Map<string, { size: number; mtime: number }>,
  rules: IgnoreRules,
): SyncPlan {
  const upload: FileEntry[] = [];
  for (const f of local.values()) {
    const r = remote.get(f.path);
    if (!r || r.size !== f.size || r.mtime !== f.mtime) upload.push(f);
  }
  const remove = [...remote.keys()].filter((p) => !local.has(p) && !rules.ignores(p)).sort();
  return { upload, remove };
}

function ancestors(path: string): string[] {
  const out: string[] = [];
  for (let d = posix.dirname(path); d !== '.' && d !== '/'; d = posix.dirname(d)) out.push(d);
  return out;
}

/** A tar stream of `files` (plus their parent dirs), all owned by OWNER. */
export function packTar(root: string, files: readonly FileEntry[]): Readable {
  const pack = tarStream.pack();
  const owner = { uname: OWNER, gname: OWNER, uid: 0, gid: 0 };
  void (async () => {
    try {
      const dirs = new Set<string>();
      for (const f of files) for (const d of ancestors(f.path)) dirs.add(d);
      for (const d of [...dirs].sort()) {
        pack.entry({ name: d, type: 'directory', mode: 0o755, ...owner });
      }
      for (const f of files) {
        const mtime = new Date(f.mtime * 1000);
        if (f.type === 'symlink') {
          pack.entry({ name: f.path, type: 'symlink', linkname: f.linkname, mode: 0o777, mtime, ...owner });
          continue;
        }
        const entry = pack.entry({ name: f.path, type: 'file', size: f.size, mode: f.mode, mtime, ...owner });
        await pipeline(createReadStream(join(root, f.path)), entry);
      }
      pack.finalize();
    } catch (err) {
      pack.destroy(err as Error);
    }
  })();
  return Readable.from(pack);
}

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Seconds the app must stay running after a restart to count as started. */
export const APP_SETTLE_SECONDS = 5;
/** Exit code the restart script uses for "started, then stopped/crashed". */
const APP_NOT_RUNNING = 86;

export const REMOTE = {
  list: `sudo mkdir -p ${q(REMOTE_APP_DIR)} && cd ${q(REMOTE_APP_DIR)} && sudo find . -mindepth 1 \\( -type f -o -type l \\) -printf '%P\\0%s\\0%T@\\0'`,
  extract: `sudo tar -x -f - -C ${q(REMOTE_APP_DIR)}`,
  remove: `cd ${q(REMOTE_APP_DIR)} && sudo xargs -0 -r rm -f --`,
  pruneDirs: `cd ${q(REMOTE_APP_DIR)} && sudo xargs -0 -r rmdir -p --ignore-fail-on-non-empty -- 2>/dev/null; true`,
  /**
   * Follow the journal (live install/build output) while restarting; exit
   * non-zero if the restart fails (ExecStartPre install/build failed) or the
   * app isn't still active after the settle period (crashed on start).
   */
  restart: [
    'sudo journalctl -u app.service -o cat -f -n 0 & j=$!',
    'sleep 1',
    'sudo systemctl restart app.service; rc=$?',
    `if [ $rc -eq 0 ]; then sleep ${APP_SETTLE_SECONDS}; sudo systemctl is-active --quiet app.service || rc=${APP_NOT_RUNNING}; fi`,
    'sleep 1; sudo kill $j 2>/dev/null; kill $j 2>/dev/null; wait $j 2>/dev/null',
    'exit $rc',
  ].join('\n'),
  /** Recent journal, shown when the restart fails. */
  logs: 'sudo journalctl -u app.service -o cat --no-pager -n 50',
};

async function run(shell: RemoteShell, what: string, cmd: string, stdin?: Buffer | NodeJS.ReadableStream): Promise<Buffer> {
  const res = await shell.exec(cmd, stdin);
  if (res.code !== 0) {
    throw new Error(`Remote ${what} failed (exit ${res.code})${res.stderr.trim() ? `: ${res.stderr.trim()}` : ''}`);
  }
  return res.stdout;
}

function human(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;
}

/** Restart app.service, streaming its output; throw if it doesn't come up. */
export async function restartApp(shell: RemoteShell, logger: DeployLogger, signal: AbortSignal): Promise<void> {
  let pending = '';
  const code = await shell.stream(
    REMOTE.restart,
    (chunk, which) => {
      if (which === 'stderr') {
        // sudo/systemctl errors; surface them as-is.
        for (const l of chunk.toString('utf8').split('\n')) if (l.trim()) logger.warn(`  ${l}`);
        return;
      }
      const lines = (pending + chunk.toString('utf8')).split('\n');
      pending = lines.pop() ?? '';
      for (const l of lines) logger.info(`  | ${l}`);
    },
    signal,
  );
  if (pending) logger.info(`  | ${pending}`);
  if (code === 0) return;
  if (code === -1) throw signal.reason ?? new Error('Restart aborted');
  const tail = await shell.exec(REMOTE.logs).catch(() => null);
  const recent = tail?.code === 0 ? tail.stdout.toString('utf8').trim() : '';
  if (recent) logger.error(`Recent app.service logs:\n${recent}`);
  throw new Error(
    code === APP_NOT_RUNNING
      ? `The app started but stopped within ${APP_SETTLE_SECONDS}s; see the logs above (\`mieweb tail\` for more)`
      : `Restarting the app failed (exit ${code}): dependency install or build failed; see the logs above`,
  );
}

/** Sync `root` into the container and restart the app. */
export async function syncWorktree(
  root: string,
  shell: RemoteShell,
  logger: DeployLogger,
  signal: AbortSignal = new AbortController().signal,
): Promise<SyncPlan> {
  const [{ files, rules }, listing] = await Promise.all([scanLocal(root), run(shell, 'listing', REMOTE.list)]);
  const plan = planSync(files, parseRemoteListing(listing), rules);
  const bytes = plan.upload.reduce((n, f) => n + (f.type === 'file' ? f.size : 0), 0);
  logger.info(
    `Syncing ${root} → ${REMOTE_APP_DIR}: ${files.size} files, ` +
      `${plan.upload.length} to upload (${human(bytes)}), ${plan.remove.length} to delete`,
  );

  if (plan.upload.length > 0) await run(shell, 'extract', REMOTE.extract, packTar(root, plan.upload));
  if (plan.remove.length > 0) {
    const nul = (xs: string[]): Buffer => Buffer.from(xs.map((x) => `${x}\0`).join(''));
    await run(shell, 'delete', REMOTE.remove, nul(plan.remove));
    const dirs = [...new Set(plan.remove.map((p) => posix.dirname(p)).filter((d) => d !== '.'))];
    if (dirs.length > 0) await run(shell, 'cleanup', REMOTE.pruneDirs, nul(dirs));
  }
  logger.info('Code synced; restarting the app (install/build output follows)');
  await restartApp(shell, logger, signal);
  logger.info('App restarted and running');
  return plan;
}
