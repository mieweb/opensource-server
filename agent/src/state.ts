/** Persistent agent state: last applied config ETag + per-service apply
 * results, stored as JSON under the state dir. */

import fs from 'fs';
import path from 'path';
import type { ApplyResult } from './types';

export class State {
  etag?: string;
  lastApply: Record<string, ApplyResult> = {};

  private constructor(private readonly file: string) {}

  static load(stateDir: string): State {
    const state = new State(path.join(stateDir, 'state.json'));
    let raw: string;
    try {
      raw = fs.readFileSync(state.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return state; // first run
      throw err;
    }
    try {
      const data = JSON.parse(raw) as { etag?: string; lastApply?: Record<string, ApplyResult> };
      state.etag = data.etag;
      state.lastApply = data.lastApply ?? {};
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      // A corrupt state file just means a full re-apply on this run.
      console.error(`Ignoring unparsable state file ${state.file}: ${err.message}`);
    }
    return state;
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify({ etag: this.etag, lastApply: this.lastApply }, null, 2),
    );
  }
}
