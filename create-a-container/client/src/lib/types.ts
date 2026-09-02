/**
 * Typed resource models matching /api/v1 response shapes.
 * Keep in sync with the serializers in routers/api/v1/*.
 */

export interface Site {
  id: number;
  name: string;
  internalDomain: string;
  dhcpRange: string | null;
  subnetMask: string | null;
  gateway: string | null;
  dnsForwarders: string | null;
  externalIp: string | null;
  nodeCount?: number;
}

export interface Node {
  id: number;
  name: string;
  nodeType: 'proxmox' | 'dummy' | 'docker';
  siteId: number;
  ipv4Address: string | null;
  apiUrl: string | null;
  tokenId: string | null;
  tlsVerify: boolean | null;
  imageStorage: string;
  volumeStorage: string;
  networkBridge: string;
  nvidiaAvailable: boolean;
  hasSecret: boolean;
}

/** Used/total byte pair for a node hardware resource. */
export interface NodeResourceUsage {
  used: number;
  total: number;
}

/** Per-datastore usage reported by the hypervisor. */
export interface NodeStorageUsage {
  name: string;
  type: string | null;
  content: string | null;
  used: number;
  total: number;
  avail: number;
}

/**
 * Live hardware utilization for a node. `available` is false when the node has
 * no API credentials or the hypervisor could not be reached; the remaining
 * fields keep their shape so the UI can render an "unavailable" state.
 */
export interface NodeStats {
  available: boolean;
  status: string | null;
  /** CPU load as a 0..1 fraction of total capacity. */
  cpu: number | null;
  cpuCount: number | null;
  memory: NodeResourceUsage | null;
  swap: NodeResourceUsage | null;
  rootfs: NodeResourceUsage | null;
  /** Uptime in seconds. */
  uptime: number | null;
  storages: NodeStorageUsage[];
}

export interface AgentServiceStatus {
  /** systemd ActiveState: active, inactive, failed, ... */
  state: string;
  /** Outcome of the agent's last config apply for this service. */
  lastApply: 'success' | 'failure' | 'unknown';
}

/** One container's live usage sample in the per-owner usage report. */
export interface UsageContainer {
  vmid: string;
  name: string | null;
  owner: string | null;
  containerDbId: number | null;
  node: string;
  siteId: number;
  status: string | null;
  cpuUsed: number | null;
  cpuAlloc: number | null;
  memUsed: number | null;
  memAlloc: number | null;
  diskUsed: number | null;
  diskAlloc: number | null;
  diskReadBytes: number | null;
  diskWriteBytes: number | null;
  netInBytes: number | null;
  netOutBytes: number | null;
  /** Seconds since container boot. */
  uptime: number | null;
  /**
   * PSI pressure stall percentages (avg10), probed for the highest-utilization
   * containers only; null means "not probed this cycle", not "no pressure".
   */
  psiCpuSome: number | null;
  psiCpuFull: number | null;
  psiMemSome: number | null;
  psiMemFull: number | null;
  psiIoSome: number | null;
  psiIoFull: number | null;
}

/** Per-owner aggregate row (owner null = unattributed, admin-visible only). */
export interface UsageOwner {
  owner: string | null;
  containerCount: number;
  runningCount: number;
  cpuUsed: number;
  cpuAlloc: number;
  memUsed: number;
  memAlloc: number;
  diskUsed: number;
  diskAlloc: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  netInBytes: number;
  netOutBytes: number;
  /** Worst PSI reading across this owner's probed containers (null = unprobed). */
  pressureMax: number | null;
  containers: UsageContainer[];
}

/** Owner-attribution problem detected during collection (admin-only). */
export interface UsageFinding {
  kind: 'drift' | 'unattributed';
  vmid: string;
  tagOwner: string | null;
  dbOwner: string | null;
}

export interface UsageReport {
  generatedAt: string;
  owners: UsageOwner[];
  /** Physical cluster capacity summed from the hypervisor node rows. */
  capacity: { cpuCores: number; memBytes: number; diskBytes: number };
  /** Admin-only. */
  findings?: UsageFinding[];
  /** Admin-only: cluster members not registered in the manager DB. */
  unknownNodeRows?: number;
}

export interface Agent {
  id: number;
  siteId: number;
  siteName: string | null;
  hostname: string;
  ipv4Address: string | null;
  services: Record<string, AgentServiceStatus> | null;
  lastCheckinAt: string | null;
  /** Server-computed, so it is immune to client clock drift. */
  secondsSinceCheckin: number | null;
}

export type NotificationSeverity = 'info' | 'warning' | 'critical';

/**
 * A node-side event surfaced in the notification bell. Named AppNotification to
 * avoid clashing with the DOM's global `Notification` type.
 */
export interface AppNotification {
  id: number;
  source: string;
  severity: NotificationSeverity;
  node: string | null;
  ctid: string | null;
  owner: string | null;
  action: string | null;
  message: string;
  evidence: Record<string, unknown> | null;
  eventAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalDomain {
  id: number;
  name: string;
  acmeEmail: string | null;
  acmeDirectoryUrl: string | null;
  cloudflareApiEmail: string | null;
  siteId: number | null;
  site: { id: number; name: string } | null;
  authServer: string | null;
  hasCloudflareApiKey: boolean;
}

export interface ServiceHttp {
  id: number;
  externalHostname: string;
  externalDomainId: number;
  backendProtocol: 'http' | 'https';
  authRequired: boolean;
  domain?: string;
}
export interface ServiceTransport {
  id: number;
  protocol: 'tcp' | 'udp';
  externalPort: number;
}
export interface ServiceDns {
  id: number;
  recordType: string;
  dnsName: string;
}
export interface ContainerService {
  id: number;
  type: 'http' | 'transport' | 'dns';
  internalPort: number;
  /** Proxy-reported last access (ISO datetime); null when never accessed. */
  lastAccessedAt: string | null;
  httpService: ServiceHttp | null;
  transportService: ServiceTransport | null;
  dnsService: ServiceDns | null;
}

export interface Container {
  id: number;
  containerId: number | null;
  hostname: string;
  owner: string;
  /** Usernames this container is shared with (collaborators). */
  collaborators: string[];
  ipv4Address: string | null;
  macAddress: string | null;
  status: ContainerStatus;
  template: string | null;
  creationJobId: number | null;
  entrypoint: string | null;
  environmentVars: Record<string, string>;
  nvidiaRequested: boolean;
  sshPort: number | null;
  sshHost: string | null;
  httpEntries: { port: number; externalUrl: string | null }[];
  /** Max lastAccessedAt across services; null when never accessed. */
  lastAccessedAt: string | null;
  nodeName: string | null;
  nodeApiUrl: string | null;
  services: ContainerService[];
  createdAt: string;
}

/**
 * Live container status resolved from Proxmox run-state + create-job state.
 * Embedded on each Container returned by the list/show/create endpoints.
 */
export type ContainerStatus =
  | 'running'
  | 'offline'
  | 'creating'
  | 'failed'
  | 'missing'
  | 'unknown';

export interface ContainerCreateResult {
  containerId: number;
  jobId: number;
  hostname: string;
  status: ContainerStatus;
}

export interface ContainerNewBootstrap {
  siteId: number;
  externalDomains: { id: number; name: string }[];
  nvidiaAvailable: boolean;
}

export interface ContainerMetadata {
  ports?: { port: number; protocol: string }[];
  httpServices?: { port: number; hostnameSuffix?: string; requireAuth?: boolean }[];
  entrypoint?: string;
  env?: Record<string, string>;
}

export interface Job {
  id: number;
  command: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface JobStatusRow {
  id: number;
  jobId: number;
  output: string;
  createdAt: string;
}

export interface User {
  uidNumber: number;
  uid: string;
  givenName: string;
  sn: string;
  cn: string;
  mail: string;
  status: 'pending' | 'active' | 'disabled';
  groups?: { gidNumber: number; cn: string; isAdmin: boolean }[];
  isAdmin: boolean;
}

export interface Group {
  gidNumber: number;
  cn: string;
  isAdmin: boolean;
  userCount?: number;
}

export interface ApiKey {
  id: number;
  keyPrefix: string;
  description: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyCreated extends ApiKey {
  key: string;
  warning: string;
}

export interface AppSettings {
  smtpUrl: string;
  smtpNoreplyAddress: string;
  netboxUrl: string;
  netboxToken: string;
  defaultContainerEnvVars: { key: string; value: string; description?: string }[];
  /** Announcement banner shown to all users. Supports [text](url) links. */
  bannerMessage: string;
  /** Max PSI probes per usage report; '' uses the server default (16), '0' disables. */
  usagePsiProbeLimit: string;
}

export type ResourceType = 'memory' | 'swap' | 'cpus' | 'rootfs';

export interface ResourceRequest {
  id: number;
  siteId: number;
  hostname: string;
  username: string;
  requestedBy?: never;
  resourceType: ResourceType;
  value: number;
  status: 'pending' | 'approved' | 'denied';
  comment: string | null;
  adminComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  site?: { id: number; name: string };
}

export interface EffectiveResources {
  memory: number;
  swap: number;
  cpus: number;
  rootfs: number;
}
