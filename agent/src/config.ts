/** Agent configuration, read from the environment (systemd passes
 * /etc/environment through EnvironmentFile=). */

import { setLogLevel, type LogLevel } from './log';

/** Service groups the agent can run. `mail` is opt-in via AGENT_SERVICES. */
export const KNOWN_SERVICE_GROUPS = ['nginx', 'dnsmasq', 'mail'] as const;
export type ServiceGroup = (typeof KNOWN_SERVICE_GROUPS)[number];

const DEFAULT_SERVICE_GROUPS: ServiceGroup[] = ['nginx', 'dnsmasq'];

export interface AgentConfig {
  siteId: number;
  managerUrl: string;
  apiKey?: string;
  stateDir: string;
  logLevel: LogLevel;
  /** Enabled service groups (AGENT_SERVICES; unset means nginx,dnsmasq). */
  services: ServiceGroup[];
}

function parseServiceGroups(raw: string | undefined): ServiceGroup[] {
  if (!raw || !raw.trim()) return [...DEFAULT_SERVICE_GROUPS];
  const groups: ServiceGroup[] = [];
  for (const part of raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if ((KNOWN_SERVICE_GROUPS as readonly string[]).includes(part)) {
      if (!groups.includes(part as ServiceGroup)) groups.push(part as ServiceGroup);
    } else {
      throw new Error(`AGENT_SERVICES contains unknown service group "${part}" (known: ${KNOWN_SERVICE_GROUPS.join(', ')})`);
    }
  }
  return groups;
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
    services: parseServiceGroups(env.AGENT_SERVICES),
  };
}
