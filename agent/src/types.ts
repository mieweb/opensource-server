/**
 * Shared types: check-in request/response shapes exchanged with the manager's
 * POST /api/v1/agents endpoint.
 */

export type ApplyResult = 'success' | 'failure';

export interface ServiceStatus {
  /** systemd ActiveState: active, inactive, failed, ... */
  state: string;
  /** Outcome of the last config apply for this service. */
  lastApply: ApplyResult | 'unknown';
}

export interface CheckinRequest {
  siteId: number;
  hostname: string;
  /** Current agent time, epoch seconds UTC. */
  currentTime: number;
  ipv4Address: string | null;
  services: Record<string, ServiceStatus>;
}

export interface SiteContainer {
  hostname: string;
  ipv4Address: string;
  macAddress: string | null;
}

export interface SiteNode {
  name: string;
  ipv4Address: string | null;
  containers: SiteContainer[];
}

export interface SiteInfo {
  id: number;
  name: string;
  internalDomain: string;
  dhcpRange: string;
  subnetMask: string;
  gateway: string;
  dnsForwarders: string;
  nodes: SiteNode[];
}

export interface HttpService {
  internalPort: number;
  container: { ipv4Address: string };
  externalHostname: string;
  backendProtocol: string;
  authRequired: boolean;
  externalDomain: { name: string; authServer: string | null };
}

export interface StreamService {
  internalPort: number;
  container: { ipv4Address: string };
  externalPort: number;
  protocol: string;
}

export interface NginxConfig {
  httpServices: HttpService[];
  streamServices: StreamService[];
  externalDomains: { name: string }[];
}

/** Config snapshot for the whole site. `site` is null before the first site
 * exists (bootstrap); only the fallback nginx config is rendered then. */
export interface SiteConfig {
  site: SiteInfo | null;
  nginx: NginxConfig;
}
