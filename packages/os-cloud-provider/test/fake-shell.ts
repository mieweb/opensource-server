/**
 * RemoteShell fake that executes the sync's remote commands against a local
 * directory, so sync tests exercise the real tar/diff/delete logic.
 */

import { lstat, mkdir, readdir, rm, rmdir, symlink, utimes, lutimes, writeFile } from 'node:fs/promises';
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

  async exec(command: string, stdin?: Buffer | NodeJS.ReadableStream): Promise<ExecResult> {
    this.commands.push(command);
    const input = await toBuffer(stdin);
    const ok = (stdout = Buffer.alloc(0)): ExecResult => ({ code: 0, stdout, stderr: '' });

    if (command === REMOTE.list) {
      await mkdir(this.dir, { recursive: true });
      const out: string[] = [];
      const walk = async (rel: string): Promise<void> => {
        for (const e of await readdir(join(this.dir, rel), { withFileTypes: true })) {
          const p = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(p);
          else {
            const st = await lstat(join(this.dir, p));
            out.push(p, String(st.size), String(st.mtimeMs / 1000));
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
          await utimes(target, h.mtime!, h.mtime!);
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
    if (command === REMOTE.restart) return ok();
    return { code: 127, stdout: Buffer.alloc(0), stderr: `unknown command: ${command}` };
  }

  /** Chunks `stream()` emits (split across chunk boundaries on purpose), then the exit code. */
  streamScript: { chunks: [string, 'stdout' | 'stderr'][]; code: number; hang?: boolean } = { chunks: [], code: 0 };

  async stream(
    command: string,
    onData: (chunk: Buffer, stream: 'stdout' | 'stderr') => void,
    signal: AbortSignal,
  ): Promise<number> {
    this.commands.push(command);
    for (const [c, w] of this.streamScript.chunks) onData(Buffer.from(c), w);
    if (!this.streamScript.hang) return this.streamScript.code;
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve(-1), { once: true }));
  }

  close(): void {
    this.closed = true;
  }
}
