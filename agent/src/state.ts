/** Persistent agent state: last applied config ETag + per-service apply
 * results + pending per-volume provisioning results, stored as JSON under the
 * state dir. */

import fs from 'fs';
import path from 'path';
import { log } from './log';
import type { ApplyResult, VolumeResult } from './types';

export class State {
  etag?: string;
  lastApply: Record<string, ApplyResult> = {};
  // Volume provisioning results not yet confirmed delivered to the manager.
  // Persisted so they survive a process exit between reconcile and the next
  // check-in — otherwise a saved ETag would 304 the next run and the result
  // would be lost, leaving the volume pending until the create barrier times
  // out. Cleared only after a check-in that carried them completes.
  pendingVolumeResults: Record<string, VolumeResult> = {};

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
      const data = JSON.parse(raw) as {
        etag?: string;
        lastApply?: Record<string, ApplyResult>;
        pendingVolumeResults?: Record<string, VolumeResult>;
      };
      state.etag = data.etag;
      state.lastApply = data.lastApply ?? {};
      state.pendingVolumeResults = data.pendingVolumeResults ?? {};
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      // A corrupt state file just means a full re-apply on this run.
      log.warn(`Ignoring unparsable state file ${state.file}: ${err.message}`);
    }
    return state;
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify(
        { etag: this.etag, lastApply: this.lastApply, pendingVolumeResults: this.pendingVolumeResults },
        null,
        2,
      ),
    );
  }
}
