/** Persistent agent state: last applied config ETag + per-service apply
 * results, stored as JSON under the state dir. */

import fs from 'fs';
import path from 'path';
import type { ApplyResult } from './types';

export interface AgentState {
  etag?: string;
  lastApply: Record<string, ApplyResult>;
}

function stateFile(stateDir: string): string {
  return path.join(stateDir, 'state.json');
}

export function loadState(stateDir: string): AgentState {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(stateDir), 'utf8'));
    return { lastApply: {}, ...raw };
  } catch {
    return { lastApply: {} };
  }
}

export function saveState(stateDir: string, state: AgentState): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile(stateDir), JSON.stringify(state, null, 2));
}
