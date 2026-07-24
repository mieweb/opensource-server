/** Agent configuration, read from the environment (systemd passes
 * /etc/environment through EnvironmentFile=). */

import { setLogLevel, type LogLevel } from './log';

export interface AgentConfig {
  siteId: number;
  managerUrl: string;
  apiKey?: string;
  stateDir: string;
  logLevel: LogLevel;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  // Set the log level first so any warnings below (and from callers) honor it.
  const logLevel = setLogLevel(env.LOG_LEVEL);
  const siteId = parseInt(env.SITE_ID ?? '', 10);
  const managerUrl = env.MANAGER_URL;
  if (!Number.isInteger(siteId) || !managerUrl) {
    throw new Error('SITE_ID and MANAGER_URL must be set in the environment');
  }
  return {
    siteId,
    managerUrl: managerUrl.replace(/\/+$/, ''),
    apiKey: env.API_KEY || undefined,
    // Set by systemd from StateDirectory=; fallback for manual runs.
    stateDir: env.STATE_DIRECTORY || '/var/lib/opensource-agent',
    logLevel,
  };
}
