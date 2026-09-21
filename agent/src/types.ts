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
  /**
   * Per-volume directory-provisioning results, keyed by the manager-assigned
   * Volume id: `{ <volumeId>: { applied, message? } }`. Present only when the
   * agent processed volumes this pass. The manager writes these into
   * Volume.status (ready/failed) at check-in.
   */
  volumes?: Record<string, VolumeResult>;
}

/** Outcome of ensuring one volume directory on this node. */
export interface VolumeResult {
  applied: boolean;
  message?: string;
}

/** A volume directory the agent must ensure exists on this node, as carried in
 * the config snapshot. `uid`/`gid` are the owning host ids (the unprivileged
 * CT's id-mapped root) so RW volumes are writable from inside the container. */
export interface SiteVolume {
  id: number;
  hostPath: string;
  mode: 'ro' | 'rw';
  uid: number;
  gid: number;
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
  /** Volume directories to ensure on this node. Absent on older managers. */
  volumes?: SiteVolume[];
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
  /** Manager Services.id — reported back by the accounting module. */
  id: number;
  internalPort: number;
  container: { ipv4Address: string };
  externalHostname: string;
  backendProtocol: string;
  authRequired: boolean;
  externalDomain: { name: string; authServer: string | null };
}

export interface StreamService {
  /** Manager Services.id — reported back by the accounting module. */
  id: number;
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
