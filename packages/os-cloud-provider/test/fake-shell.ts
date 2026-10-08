/**
 * RemoteShell fake that executes the sync's remote commands against a local
 * directory, so sync tests exercise the real tar/diff/delete logic.
 */

import { lstat, lutimes, mkdir, readdir, readlink, rm, rmdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import tarStream from 'tar-stream';
import type { ExecResult, RemoteShell } from '../src/ssh.ts';
import { REMOTE } from '../src/sync.ts';

async function toBuffer(stdin: Buffer | NodeJS.ReadableStream | undefined): Promise<Buffer> {
  if (!stdin) return Buffer.alloc(0);
  if (Buffer.isBuffer(stdin)) return stdin;
  const chunks: Buffer[] = [];
  for await (const c of stdin as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

export class FakeShell implements RemoteShell {
  readonly commands: string[] = [];
  readonly owners = new Map<string, string>();
  closed = false;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  /** Paths the last listing reported (to check pruning). */
  listed: string[] = [];
  /** Called before each exec (e.g. to abort mid-sync). */
  beforeExec?: (command: string) => void;

  async exec(command: string, stdin?: Buffer | NodeJS.ReadableStream, signal?: AbortSignal): Promise<ExecResult> {
    this.commands.push(command);
    this.beforeExec?.(command);
    signal?.throwIfAborted();
    const input = await toBuffer(stdin);
    const ok = (stdout = Buffer.alloc(0)): ExecResult => ({ code: 0, stdout, stderr: '' });

    if (command.includes(' find . -mindepth 1 ')) {
      await mkdir(this.dir, { recursive: true });
      // Honor the listing's prune expression like find would: list a matching
      // directory, don't descend into it.
      const prunePaths = [...command.matchAll(/-path \.\/(\S+)/g)].map((m) => m[1]!.replace(/^'|'$/g, ''));
      const pruneNames = [...command.matchAll(/-name (\S+)/g)].map((m) => {
        const glob = m[1]!.replace(/^'|'$/g, '').replace(/\\(.)/g, '$1');
        return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      });
      this.listed = [];
      const out: string[] = [];
      const walk = async (rel: string): Promise<void> => {
        for (const e of await readdir(join(this.dir, rel), { withFileTypes: true })) {
          const p = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            const st = await lstat(join(this.dir, p));
            out.push(p, String(st.size), String(st.mtimeMs / 1000), (st.mode & 0o777).toString(8), 'd', '');
            this.listed.push(p);
            if (prunePaths.includes(p) || pruneNames.some((re) => re.test(e.name))) continue;
            await walk(p);
          } else {
            const st = await lstat(join(this.dir, p));
            const link = st.isSymbolicLink();
            this.listed.push(p);
            out.push(p, String(st.size), String(st.mtimeMs / 1000), (st.mode & 0o777).toString(8), link ? 'l' : 'f', link ? await readlink(join(this.dir, p)) : '');
          }
        }
      };
      await walk('');
      return ok(Buffer.from(out.map((x) => `${x}\0`).join('')));
    }
    if (command === REMOTE.extract) {
      const extract = tarStream.extract();
      const done = (async () => {
        for await (const entry of extract) {
          const h = entry.header;
          const target = join(this.dir, h.name);
          this.owners.set(h.name, `${h.uname}:${h.gname}`);
          if (h.type === 'directory') {
            await mkdir(target, { recursive: true });
            entry.resume();
            continue;
          }
          await mkdir(dirname(target), { recursive: true });
          await rm(target, { force: true });
          if (h.type === 'symlink') {
            await symlink(h.linkname!, target);
            entry.resume();
            await lutimes(target, h.mtime!, h.mtime!);
            continue;
          }
          const chunks: Buffer[] = [];
          for await (const c of entry) chunks.push(c as Buffer);
          await writeFile(target, Buffer.concat(chunks), { mode: h.mode });
          // Like GNU tar: a pax `mtime` record (sub-second) wins over the header's.
          const paxMtime = (h as { pax?: Record<string, string> }).pax?.mtime;
          const mtime = paxMtime ? new Date(Number(paxMtime) * 1000) : h.mtime!;
          await utimes(target, mtime, mtime);
        }
      })();
      Readable.from(input).pipe(extract as unknown as NodeJS.WritableStream);
      await done;
      return ok();
    }
    if (command === REMOTE.remove) {
      for (const p of input.toString().split('\0').filter(Boolean)) await rm(join(this.dir, p), { force: true });
      return ok();
    }
    if (command === REMOTE.removeTrees) {
      for (const p of input.toString().split('\0').filter(Boolean)) await rm(join(this.dir, p), { recursive: true, force: true });
      return ok();
    }
    if (command === REMOTE.pruneDirs) {
      for (let d of input.toString().split('\0').filter(Boolean)) {
        while (d && d !== '.') {
          try {
            await rmdir(join(this.dir, d));
          } catch {
            break;
          }
          d = dirname(d);
        }
      }
      return ok();
    }
    if (command === REMOTE.logs) return ok(Buffer.from(this.recentLogs));
    return { code: 127, stdout: Buffer.alloc(0), stderr: `unknown command: ${command}` };
  }

  /** What the restart stream emits / exits with. */
  restartScript: { chunks: [string, 'stdout' | 'stderr'][]; code: number } = { chunks: [], code: 0 };
  /** Output of the recent-logs command. */
  recentLogs = '';

  /** Chunks `stream()` emits (split across chunk boundaries on purpose), then the exit code. */
  streamScript: { chunks: [string, 'stdout' | 'stderr'][]; code: number; hang?: boolean } = { chunks: [], code: 0 };

  async stream(
    command: string,
    onData: (chunk: Buffer, stream: 'stdout' | 'stderr') => void,
    signal: AbortSignal,
  ): Promise<number> {
    this.commands.push(command);
    if (command === REMOTE.restart) {
      for (const [c, w] of this.restartScript.chunks) onData(Buffer.from(c), w);
      return this.restartScript.code;
    }
    for (const [c, w] of this.streamScript.chunks) onData(Buffer.from(c), w);
    if (!this.streamScript.hang) return this.streamScript.code;
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve(-1), { once: true }));
  }

  close(): void {
    this.closed = true;
  }
}
