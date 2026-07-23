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

/** Mirrors the manager's Site model, where every field except id is
 * nullable — a site can be partially configured. Consumers must guard
 * before using these values (see the dnsmasq render skip in apply.ts). */
export interface SiteInfo {
  id: number;
  name: string | null;
  internalDomain: string | null;
  dhcpRange: string | null;
  subnetMask: string | null;
  gateway: string | null;
  dnsForwarders: string | null;
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
