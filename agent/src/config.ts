/** Agent configuration, read from the environment (systemd passes
 * /etc/environment through EnvironmentFile=). */

export interface AgentConfig {
  siteId: number;
  managerUrl: string;
  apiKey?: string;
  stateDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const siteId = parseInt(env.SITE_ID ?? '', 10);
  const managerUrl = env.MANAGER_URL;
  if (!Number.isInteger(siteId) || !managerUrl) {
    throw new Error('SITE_ID and MANAGER_URL must be set in the environment');
  }
  return {
    siteId,
    managerUrl: managerUrl.replace(/\/+$/, ''),
    apiKey: env.API_KEY || undefined,
    stateDir: env.STATE_DIR || '/var/lib/opensource-agent',
  };
}
